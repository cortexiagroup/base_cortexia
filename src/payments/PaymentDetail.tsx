import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, FileDown, ShieldCheck, WalletCards } from 'lucide-react'
import { Button } from '../components/ui/button'
import { useAuth } from '../lib/auth'
import { getOrder } from '../commercial/api'
import { xofAmount, type Order } from '../commercial/types'
import { approveAdjustment, confirmPayment, executeAdjustment, getAdjustments, getFinanceJobs, getLedger, getPayment, getPaymentEvents, issueFinanceJob, listVerifiers, requestAdjustment, reviewPayment, signedFinanceDocument, signedProofUrl, uploadProof } from './api'
import { ledgerBalance, methodLabels, statusLabels, type Adjustment, type FinanceJob, type LedgerEntry, type Payment } from './types'

const when = (input?: string | null) => input ? new Intl.DateTimeFormat('fr-TG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lome' }).format(new Date(input)) : '—'
const sources: Record<string, { code: string; label: string }> = {
  merchant_account: { code: 'merchant_portal', label: 'Compte marchand officiel' },
  bank_transfer: { code: 'bank_statement', label: 'Relevé bancaire officiel' },
  cash: { code: 'cash_register', label: 'Registre de caisse et remise des fonds' },
}

export function PaymentDetail() {
  const { id } = useParams()
  const { profile } = useAuth()
  const [payment, setPayment] = useState<Payment | null>(null)
  const [order, setOrder] = useState<Order | null>(null)
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [jobs, setJobs] = useState<FinanceJob[]>([])
  const [adjustments, setAdjustments] = useState<Adjustment[]>([])
  const [events, setEvents] = useState<{ id: string; event_type: string; details: Record<string, unknown>; created_at: string }[]>([])
  const [canVerify, setCanVerify] = useState(false)
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [checked, setChecked] = useState(false)
  const [handover, setHandover] = useState('')
  const [proof, setProof] = useState<File | null>(null)
  const [adjustKind, setAdjustKind] = useState<'correction' | 'refund'>('correction')
  const [adjustAmount, setAdjustAmount] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [externalSource, setExternalSource] = useState('')
  const [externalReference, setExternalReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => { if (!id) return
    getPayment(id).then(async item => {
      const [o, l, j, a, e, v] = await Promise.all([getOrder(item.order_id), getLedger(item.order_id),
        getFinanceJobs(undefined, id), getAdjustments(id), getPaymentEvents(id), listVerifiers()])
      setPayment(item); setOrder(o); setLedger(l); setJobs(j); setAdjustments(a); setEvents(e)
      setCanVerify(profile?.role === 'admin' || (profile?.role === 'sales_manager' && v.some(entry => entry.user_id === profile.id && entry.enabled)))
      setReference(item.transaction_reference ?? '')
    }).catch(e => setError(e.message))
  }, [id, profile?.id, profile?.role, refresh])
  const balance = order ? ledgerBalance(order.amount_xof, ledger) : null
  async function doConfirm() {
    if (!id || !payment || !checked) return
    setBusy(true); setError(null); setMessage(null)
    let jobId: string | null = null
    try {
      jobId = await confirmPayment({ paymentId: id, source: sources[payment.method].code,
        verifiedReference: reference, note, cashHandoverAt: payment.method === 'cash' ? new Date(handover).toISOString() : null })
      setMessage('Encaissement confirmé et journalisé. Le reçu est demandé et sera généré sans modifier cette confirmation.')
      setRefresh(x => x + 1)
      try { await issueFinanceJob(jobId); setMessage('Encaissement confirmé ; reçu PDF émis.'); setRefresh(x => x + 1) }
      catch (e) { setError(`Encaissement confirmé, mais reçu en attente : ${e instanceof Error ? e.message : 'erreur'}. Utilisez « Réessayer » ci-dessous.`) }
    } catch (e) { setError(e instanceof Error ? e.message : 'Confirmation impossible.') }
    finally { setBusy(false); setChecked(false) }
  }
  async function doReview(action: 'request_info' | 'reject' | 'cancel') {
    if (!id) return
    setBusy(true); setError(null)
    try { await reviewPayment(id, action, reason); setReason(''); setRefresh(x => x + 1) }
    catch (e) { setError(e instanceof Error ? e.message : 'Décision impossible.') }
    finally { setBusy(false) }
  }
  async function openPath(path: string, proofFile = false) {
    const tab = window.open('', '_blank')
    if (!tab) { setError('Autorisez les nouveaux onglets pour consulter ce document.'); return }
    try { tab.opener = null; tab.location.href = proofFile ? await signedProofUrl(path) : await signedFinanceDocument(path) }
    catch (e) { tab.close(); setError(e instanceof Error ? e.message : 'Document inaccessible.') }
  }
  async function shareReceipt(job: FinanceJob) {
    if (!job.storage_path || !order) return
    try { const url = await signedFinanceDocument(job.storage_path, 600)
      await navigator.clipboard.writeText(`Bonjour, voici le reçu ${job.document_number} pour la commande ${order.order_number}. Lien privé valable environ 10 minutes : ${url}`)
      setMessage('Lien temporaire et message copiés. Aucun message WhatsApp ou email n’a été envoyé automatiquement.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Partage impossible.') }
  }
  async function retry(jobId: string) { setBusy(true); setError(null); try { await issueFinanceJob(jobId); setRefresh(x => x + 1) } catch (e) { setError(e instanceof Error ? e.message : 'Réessai impossible.') } finally { setBusy(false) } }
  async function doAdjustment() {
    if (!id) return
    setBusy(true); setError(null)
    try { await requestAdjustment(id, adjustKind, Number(adjustAmount), adjustReason); setAdjustAmount(''); setAdjustReason(''); setRefresh(x => x + 1) }
    catch (e) { setError(e instanceof Error ? e.message : 'Demande impossible.') }
    finally { setBusy(false) }
  }
  async function changeAdjustment(adjustment: Adjustment, action: 'approve' | 'reject' | 'execute') {
    setBusy(true); setError(null)
    try { if (action === 'execute') await executeAdjustment(adjustment.id, externalSource, externalReference)
      else await approveAdjustment(adjustment.id, action === 'approve')
      setRefresh(x => x + 1)
    } catch (e) { setError(e instanceof Error ? e.message : 'Opération impossible.') }
    finally { setBusy(false) }
  }
  return <div className="crm-page finance-page"><Link to="/paiements" className="crm-back"><ArrowLeft size={16} /> Paiements</Link>
    {error && <div className="crm-alert" role="alert">{error}</div>}{message && <div className="finance-success" role="status">{message}</div>}
    {!payment || !order ? <div className="crm-empty">Chargement du dossier…</div> : <><div className="crm-detail-head"><span className="detail-logo"><WalletCards size={24} /></span><div><span className="section-kicker">PAIEMENT / {order.order_number}</span><h1>{xofAmount(payment.amount_xof)}</h1><div className="detail-sub"><span className={`finance-pill is-${payment.status}`}>{statusLabels[payment.status]}</span><span>{methodLabels[payment.method]} · déclaré le {when(payment.declared_at)}</span></div></div></div>
      <div className="finance-kpis"><div><span>Montant contractuel</span><strong>{xofAmount(order.amount_xof)}</strong></div><div><span>Encaissement net réel</span><strong>{xofAmount(balance?.collected ?? 0)}</strong></div><div><span>Reste dû</span><strong>{xofAmount(balance?.remaining ?? order.amount_xof)}</strong><small>{balance?.label}</small></div></div>
      <div className="finance-columns"><div><section className="crm-section"><h2>Dossier de déclaration</h2><div className="crm-facts"><div><span>Commande</span><strong><Link to={`/commandes/${order.id}`}>{order.order_number}</Link></strong></div><div><span>Moyen</span><strong>{methodLabels[payment.method]}</strong></div><div><span>Référence déclarée</span><strong>{payment.transaction_reference || 'Aucune'}</strong></div><div><span>Date indiquée par le client</span><strong>{when(payment.paid_at)}</strong></div><div><span>Statut de revue</span><strong>{payment.review_state === 'needs_info' ? 'Complément demandé' : payment.review_state === 'resolved' ? 'Décision enregistrée' : 'À vérifier'}</strong></div><div><span>Source de vérification</span><strong>{payment.verification_source || 'Non vérifié'}</strong></div><div><span>Référence vérifiée</span><strong>{payment.verification_reference || '—'}</strong></div><div><span>Vérifié le</span><strong>{when(payment.verified_at)}</strong></div></div>{payment.proof_path ? <Button variant="secondary" size="sm" onClick={() => void openPath(payment.proof_path!, true)}>Consulter le justificatif privé</Button> : <p className="commercial-note">Aucun justificatif joint. Une capture seule ne suffit jamais à confirmer les fonds.</p>}{payment.status === 'pending' && payment.created_by === profile?.id && <div className="finance-form"><label className="crm-field">Ajouter un justificatif<input type="file" accept="application/pdf,image/jpeg,image/png" onChange={e => setProof(e.target.files?.[0] ?? null)} /></label><Button variant="secondary" size="sm" disabled={busy || !proof} onClick={() => { if (!proof) return; setBusy(true); void uploadProof(payment.id, proof).then(() => setRefresh(x => x + 1)).catch(e => setError(e.message)).finally(() => setBusy(false)) }}>Joindre au dossier</Button></div>}</section>
      <section className="crm-section"><h2>Reçus et historique documentaire</h2>{jobs.length === 0 && <p className="crm-muted">Aucun reçu. Un reçu ne naît qu’après confirmation réelle.</p>}{jobs.map(job => <div className="finance-history-row" key={job.id}><div><strong>{job.document_number}</strong><small>{job.status === 'completed' ? 'PDF émis' : job.status === 'failed' ? `Échec contrôlé · ${job.last_error ?? ''}` : 'Génération en attente'}</small></div>{job.status === 'completed' && job.storage_path ? <div className="finance-actions"><Button size="sm" variant="secondary" onClick={() => void openPath(job.storage_path!)}><FileDown size={14} /> Ouvrir</Button><Button size="sm" variant="secondary" onClick={() => void shareReceipt(job)}>Copier le lien 10 min</Button></div> : <Button size="sm" variant="secondary" disabled={busy} onClick={() => void retry(job.id)}>Réessayer</Button>}</div>)}</section>
      <section className="crm-section"><h2>Chronologie</h2>{events.map(event => <div className="finance-history-row" key={event.id}><div><strong>{event.event_type.replace(/_/g, ' ')}</strong><small>{when(event.created_at)}</small></div></div>)}</section></div>
      <aside>{payment.status === 'pending' && canVerify && <section className="crm-section"><h2><ShieldCheck size={18} /> Vérification administrative</h2><p>Consultez le canal officiel hors de Cortexia Base. Le système ne vérifie aucune transaction automatiquement.</p><div className="finance-form"><label className="crm-field">Source officielle<input readOnly value={sources[payment.method].label} /></label><label className="crm-field">Référence constatée sur le canal officiel *<input required value={reference} onChange={e => setReference(e.target.value)} /></label>{payment.method === 'cash' && <label className="crm-field">Remise en caisse réellement constatée *<input type="datetime-local" required value={handover} onChange={e => setHandover(e.target.value)} /></label>}<label className="crm-field">Note de contrôle<textarea rows={2} value={note} onChange={e => setNote(e.target.value)} /></label><label className="finance-check"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} /> J’ai constaté les fonds sur le canal officiel indiqué.</label><Button disabled={busy || !checked || !reference.trim() || (payment.method === 'cash' && !handover)} onClick={() => void doConfirm()}>Confirmer l’encaissement</Button><label className="crm-field">Motif de décision<input value={reason} onChange={e => setReason(e.target.value)} placeholder="Obligatoire pour rejet ou complément" /></label><div className="finance-actions"><Button variant="secondary" size="sm" disabled={busy || !reason.trim()} onClick={() => void doReview('request_info')}>Demander un complément</Button><Button variant="secondary" size="sm" disabled={busy || !reason.trim()} onClick={() => void doReview('reject')}>Rejeter</Button><Button variant="secondary" size="sm" disabled={busy || !reason.trim()} onClick={() => void doReview('cancel')}>Annuler</Button></div></div></section>}
      {profile?.role === 'admin' && payment.status === 'confirmed' && <section className="crm-section"><h2>Corrections et remboursements</h2><p>Une opération corrective préserve le reçu et l’écriture initiale. Ne marquez un remboursement exécuté qu’après preuve externe.</p><div className="finance-form"><select value={adjustKind} onChange={e => setAdjustKind(e.target.value as 'correction' | 'refund')}><option value="correction">Correction comptable</option><option value="refund">Remboursement</option></select><input type="number" min="1" max={payment.amount_xof} step="1" placeholder="Montant FCFA" value={adjustAmount} onChange={e => setAdjustAmount(e.target.value)} /><input placeholder="Motif documenté" value={adjustReason} onChange={e => setAdjustReason(e.target.value)} /><Button variant="secondary" disabled={busy || !adjustReason.trim() || !Number.isSafeInteger(Number(adjustAmount)) || Number(adjustAmount) <= 0} onClick={() => void doAdjustment()}>Demander l’opération</Button></div>{adjustments.map(item => <div className="finance-adjustment" key={item.id}><strong>{item.kind === 'refund' ? 'Remboursement' : 'Correction'} · {xofAmount(item.amount_xof)}</strong><small>{item.status} · {item.reason}</small>{item.status === 'requested' && <div className="finance-actions"><Button size="sm" variant="secondary" disabled={busy} onClick={() => void changeAdjustment(item, 'approve')}>Approuver</Button><Button size="sm" variant="secondary" disabled={busy} onClick={() => void changeAdjustment(item, 'reject')}>Rejeter</Button></div>}{item.status === 'approved' && <div className="finance-form"><input placeholder="Source officielle de vérification" value={externalSource} onChange={e => setExternalSource(e.target.value)} /><input placeholder="Référence externe vérifiable" value={externalReference} onChange={e => setExternalReference(e.target.value)} /><Button size="sm" disabled={busy || !externalSource.trim() || !externalReference.trim()} onClick={() => void changeAdjustment(item, 'execute')}>Consigner l’exécution vérifiée</Button></div>}</div>)}</section>}
      {profile?.role !== 'admin' && adjustments.length > 0 && <section className="crm-section"><h2>Opérations correctives</h2>{adjustments.map(item => <div className="finance-history-row" key={item.id}><div><strong>{item.kind === 'refund' ? 'Remboursement' : 'Correction'} · {xofAmount(item.amount_xof)}</strong><small>{item.status} · {when(item.executed_at)}</small></div></div>)}</section>}
      </aside></div></>}
  </div>
}
