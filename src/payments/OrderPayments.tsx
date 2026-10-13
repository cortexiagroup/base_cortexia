import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, FileDown, FilePlus2, WalletCards } from 'lucide-react'
import { Button } from '../components/ui/button'
import { getInstallments, getOrder } from '../commercial/api'
import { xofAmount, type Installment, type Order } from '../commercial/types'
import { declarePayment, getFinanceJobs, getLedger, getPayments, issueFinanceJob, listAccounts, requestInstructions, signedFinanceDocument, uploadProof } from './api'
import { ledgerBalance, methodLabels, statusLabels, type FinanceJob, type LedgerEntry, type Payment, type PaymentAccount } from './types'

const when = (input: string) => new Intl.DateTimeFormat('fr-TG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lome' }).format(new Date(input))
const todayInput = () => new Date().toISOString().slice(0, 16)

export function OrderPayments() {
  const { id } = useParams()
  const [order, setOrder] = useState<Order | null>(null)
  const [installments, setInstallments] = useState<Installment[]>([])
  const [accounts, setAccounts] = useState<PaymentAccount[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [jobs, setJobs] = useState<FinanceJob[]>([])
  const [accountId, setAccountId] = useState('')
  const [installmentId, setInstallmentId] = useState('')
  const [instructionInstallmentId, setInstructionInstallmentId] = useState('')
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [paidAt, setPaidAt] = useState(todayInput)
  const [notes, setNotes] = useState('')
  const [proof, setProof] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => { if (!id) return
    Promise.all([getOrder(id), getInstallments(id), listAccounts(), getPayments(id), getLedger(id), getFinanceJobs(id)])
      .then(([o, i, a, p, l, j]) => { setOrder(o); setInstallments(i); setAccounts(a.filter(x => x.is_active)); setPayments(p); setLedger(l); setJobs(j) })
      .catch(e => setError(e.message))
  }, [id, refresh])
  const account = accounts.find(item => item.id === accountId)
  const balance = order ? ledgerBalance(order.amount_xof, ledger) : null
  async function declare(event: FormEvent) {
    event.preventDefault(); if (!id || !account) return
    setBusy(true); setError(null); setMessage(null)
    let paymentId: string | null = null
    try {
      paymentId = await declarePayment({ orderId: id, accountId, amount: Number(amount), reference,
        paidAt: new Date(paidAt).toISOString(), installmentId: installmentId || null,
        notes, cashReceiverId: account.method === 'cash' ? account.cash_responsible_id : null })
      if (proof) await uploadProof(paymentId, proof)
      setMessage('Déclaration enregistrée. Aucun fonds n’est considéré comme encaissé avant vérification sur le canal officiel.')
      setAmount(''); setReference(''); setNotes(''); setProof(null); setRefresh(x => x + 1)
    } catch (e) {
      setError(paymentId ? `Déclaration ${paymentId} enregistrée, mais le justificatif n’a pas été lié : ${e instanceof Error ? e.message : 'erreur'}. Ouvrez le paiement pour compléter le dossier.` : e instanceof Error ? e.message : 'Déclaration impossible.')
      if (paymentId) setRefresh(x => x + 1)
    } finally { setBusy(false) }
  }
  async function createInstructions() {
    if (!id) return
    setBusy(true); setError(null); setMessage(null)
    try {
      const jobId = await requestInstructions(id, instructionInstallmentId || null)
      setRefresh(x => x + 1)
      try { await issueFinanceJob(jobId); setMessage('Fiche d’instructions générée. Elle ne constitue pas un reçu.'); setRefresh(x => x + 1) }
      catch (e) { setError(`Demande conservée, mais PDF non généré : ${e instanceof Error ? e.message : 'erreur'}. Réessayez depuis la liste des documents.`) }
    } catch (e) { setError(e instanceof Error ? e.message : 'Instructions indisponibles.') }
    finally { setBusy(false) }
  }
  async function retry(jobId: string) { setBusy(true); setError(null); try { await issueFinanceJob(jobId); setRefresh(x => x + 1) } catch (e) { setError(e instanceof Error ? e.message : 'Nouvelle tentative impossible.') } finally { setBusy(false) } }
  async function open(job: FinanceJob) {
    if (!job.storage_path) return
    const tab = window.open('', '_blank')
    if (!tab) { setError('Autorisez l’ouverture d’un nouvel onglet.'); return }
    try { tab.opener = null; tab.location.href = await signedFinanceDocument(job.storage_path) }
    catch (e) { tab.close(); setError(e instanceof Error ? e.message : 'Document inaccessible.') }
  }
  async function copyMessage() {
    if (!order) return
    const due = instructionInstallmentId ? installments.find(item => item.id === instructionInstallmentId)?.amount_xof : order.amount_xof
    const lines = accounts.map(item => `${methodLabels[item.method]}${item.provider_name ? ` (${item.provider_name})` : ''} : ${item.account_identifier ?? 'voir la fiche officielle'} · Titulaire : ${item.holder_name ?? 'Cortexia'}${item.client_instructions ? ` · ${item.client_instructions}` : ''}`)
    const text = `Bonjour, voici les instructions de paiement pour la commande ${order.order_number}. Montant attendu : ${xofAmount(due ?? 0)}.\n${lines.join('\n')}\nMerci de transmettre votre référence de transaction à Cortexia après paiement. Cette demande n’est pas un reçu. Vérifiez les coordonnées sur la fiche PDF officielle avant de payer.`
    try { await navigator.clipboard.writeText(text); setMessage('Texte copié. Aucun message n’a été envoyé automatiquement.') }
    catch { setError('Copie impossible sur cet appareil.') }
  }
  return <div className="crm-page finance-page"><Link to={id ? `/commandes/${id}` : '/commandes'} className="crm-back"><ArrowLeft size={16} /> Commande</Link>
    <div className="crm-page-head"><div><span className="section-kicker">FINANCE / COMMANDE</span><h1>{order ? `Paiements · ${order.order_number}` : 'Paiements de la commande'}</h1><p>Les échéances et déclarations restent séparées des fonds vérifiés.</p></div></div>
    {error && <div className="crm-alert" role="alert">{error}</div>}{message && <div className="finance-success" role="status">{message}</div>}
    {!order ? <div className="crm-empty">Chargement du dossier financier…</div> : <>
      <div className="finance-kpis"><div><span>Montant contractuel</span><strong>{xofAmount(order.amount_xof)}</strong></div><div><span>Réellement encaissé</span><strong>{xofAmount(balance?.collected ?? 0)}</strong></div><div><span>Reste dû</span><strong>{xofAmount(balance?.remaining ?? order.amount_xof)}</strong><small>{balance?.label}</small></div></div>
      <div className="finance-columns"><div><section className="crm-section"><h2>Échéancier prévu</h2>{installments.map(item => <div className="commercial-installment" key={item.id}><div><strong>{item.installment_number === 1 ? 'Acompte' : 'Solde'} attendu</strong><small>{item.trigger_event === 'at_order' ? 'À la commande' : 'À la livraison acceptée'}</small></div><strong>{xofAmount(item.amount_xof)}</strong></div>)}<p className="commercial-note">Une échéance prévue n’est jamais un encaissement.</p></section>
      <section className="crm-section"><h2>Historique des déclarations</h2>{payments.length === 0 && <p className="crm-muted">Aucun paiement déclaré pour cette commande.</p>}{payments.map(item => <Link to={`/paiements/${item.id}`} className="finance-history-row" key={item.id}><div><strong>{xofAmount(item.amount_xof)}</strong><small>{methodLabels[item.method]} · {when(item.declared_at)}</small></div><span className={`finance-pill is-${item.status}`}>{statusLabels[item.status]}</span><ArrowRight size={15} /></Link>)}</section>
      <section className="crm-section"><h2>Documents financiers</h2>{jobs.length === 0 && <p className="crm-muted">Aucune fiche ou reçu émis.</p>}{jobs.map(job => <div className="finance-history-row" key={job.id}><div><strong>{job.document_number}</strong><small>{job.kind === 'receipt' ? 'Reçu de paiement' : 'Instructions de paiement'} · {job.status === 'completed' ? 'émis' : job.status === 'failed' ? 'à réessayer' : 'en cours'}</small></div>{job.status === 'completed' ? <Button variant="secondary" size="sm" onClick={() => void open(job)}><FileDown size={14} /> Ouvrir</Button> : <Button variant="secondary" size="sm" disabled={busy} onClick={() => void retry(job.id)}>Réessayer</Button>}</div>)}</section></div>
      <aside><section className="crm-section"><h2>Instructions officielles</h2><p>La fiche affiche les coordonnées actives au moment de son émission et ne prouve aucun paiement.</p><label className="crm-field">Échéance<select value={instructionInstallmentId} onChange={e => setInstructionInstallmentId(e.target.value)}><option value="">Montant contractuel total</option>{installments.map(item => <option key={item.id} value={item.id}>{item.installment_number === 1 ? 'Acompte' : 'Solde'} · {xofAmount(item.amount_xof)}</option>)}</select></label><div className="finance-actions"><Button disabled={busy || accounts.length === 0} onClick={() => void createInstructions()}><FilePlus2 size={15} /> Générer les instructions</Button><Button variant="secondary" onClick={() => void copyMessage()}>Copier le texte WhatsApp</Button></div>{accounts.length === 0 && <p className="commercial-note">Aucun compte actif : demandez à l’administrateur de configurer les moyens de paiement.</p>}</section>
      <section className="crm-section"><h2><WalletCards size={18} /> Déclarer un paiement</h2><p>Déclaration du client uniquement. La vérification reste administrative et manuelle.</p><form className="finance-form" onSubmit={e => void declare(e)}><label className="crm-field">Compte Cortexia destinataire *<select required value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">Choisir un compte actif</option>{accounts.map(item => <option value={item.id} key={item.id}>{methodLabels[item.method]} {item.provider_name || ''} · {item.holder_name || 'Caisse'}</option>)}</select></label><label className="crm-field">Échéance concernée<select value={installmentId} onChange={e => { setInstallmentId(e.target.value); const found = installments.find(item => item.id === e.target.value); if (found) setAmount(String(found.amount_xof)) }}><option value="">Paiement non attribué</option>{installments.map(item => <option value={item.id} key={item.id}>Échéance {item.installment_number} · {xofAmount(item.amount_xof)}</option>)}</select></label><label className="crm-field">Montant déclaré (FCFA) *<input required type="number" min="1" max={order.amount_xof} step="1" value={amount} onChange={e => setAmount(e.target.value)} /></label><label className="crm-field">Date indiquée par le client *<input required type="datetime-local" value={paidAt} onChange={e => setPaidAt(e.target.value)} /></label><label className="crm-field">Référence {account?.method === 'cash' ? '(facultative)' : '*'}<input required={account?.method !== 'cash'} value={reference} onChange={e => setReference(e.target.value)} /></label><label className="crm-field">Justificatif facultatif (PDF/JPEG/PNG, 5 Mo)<input type="file" accept="application/pdf,image/jpeg,image/png" onChange={e => setProof(e.target.files?.[0] ?? null)} /></label><label className="crm-field">Notes<textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} /></label>{account?.method === 'cash' && <p className="commercial-note">Réception attribuée au responsable de caisse configuré. La remise en caisse sera vérifiée séparément.</p>}<Button type="submit" disabled={busy || !account || !Number.isSafeInteger(Number(amount))}>{busy ? 'Enregistrement…' : 'Enregistrer une déclaration'}</Button></form></section></aside></div>
    </>}
  </div>
}
