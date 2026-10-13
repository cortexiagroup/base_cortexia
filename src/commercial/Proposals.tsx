import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Download, FileCheck2, FilePlus2, Send } from 'lucide-react'
import { Button } from '../components/ui/button'
import { useAuth } from '../lib/auth'
import { getContacts, getLead, getLeadNames } from '../crm/api'
import type { Contact, Lead } from '../crm/types'
import { approveProposal, closeProposal, createOrder, getOffers, getOrders, getProposal, getProposalDocuments, getProposalEvents, getProposals, getSettings, issueProposal, recordAcceptance, saveProposal, sendProposal, signedDocumentUrl, submitProposal, verifyAcceptance } from './api'
import { paymentPlanLabels, proposalStatusLabels, xofAmount, type CommercialEvent, type Offer, type Order, type PaymentPlan, type Proposal, type ProposalDocument, type ProposalInput } from './types'

const date = (value: string) => new Intl.DateTimeFormat('fr-TG', { timeZone: 'Africa/Lome', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
const dateOnly = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))

export function ProposalsPage() {
  const [items, setItems] = useState<Proposal[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { getProposals().then(async data => { setItems(data); setNames(await getLeadNames(data.map(item => item.lead_id))) }).catch(e => setError(e.message)) }, [])
  const shown = items.filter(item => (!status || item.status === status) &&
    (!search || `${item.proposal_number} ${names[item.lead_id] ?? ''}`.toLowerCase().includes(search.toLowerCase())))
  return <div className="crm-page"><div className="crm-page-head"><div><span className="section-kicker">COMMERCIAL / DOCUMENTS</span><h1>Propositions</h1><p>Des conditions approuvées, un PDF conservé et une acceptation traçable.</p></div></div>{error && <div className="crm-alert" role="alert">{error}</div>}<div className="crm-toolbar"><div className="crm-search"><input placeholder="Numéro ou entreprise…" aria-label="Rechercher une proposition" value={search} onChange={e => setSearch(e.target.value)} /></div><select aria-label="Filtrer par statut" value={status} onChange={e => setStatus(e.target.value)}><option value="">Tous les statuts</option>{Object.entries(proposalStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Proposition</th><th>Entreprise</th><th>Montant</th><th>Statut</th><th>Créée le</th><th /></tr></thead><tbody>{shown.map(item => <tr key={item.id}><td><strong>{item.proposal_number}</strong><small>Offre V{item.offer_version}</small></td><td>{names[item.lead_id] || String(item.client_snapshot.company_name ?? '—')}</td><td>{xofAmount(item.amount_xof)}</td><td><span className={`commercial-badge commercial-${item.status}`}>{proposalStatusLabels[item.status]}</span></td><td>{date(item.created_at)}</td><td><Link to={`/propositions/${item.id}`}><ArrowRight size={16} /></Link></td></tr>)}</tbody></table>{shown.length === 0 && <div className="crm-empty">Aucune proposition visible. Créez-en une depuis la fiche d’un prospect.</div>}</div></div>
}

export function ProposalEditor() {
  const { leadId, id } = useParams()
  const navigate = useNavigate()
  const [lead, setLead] = useState<Lead | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [offers, setOffers] = useState<Offer[]>([])
  const [form, setForm] = useState<ProposalInput>({ lead_id: leadId ?? '', offer_id: '', service_description: '', discount_xof: 0, payment_plan: 'full_upfront', expires_at: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    Promise.all([getOffers(), id ? getProposal(id) : Promise.resolve(null)]).then(async ([catalog, proposal]) => {
      const target = proposal?.lead_id ?? leadId
      if (!target) throw new Error('Prospect requis.')
      const selectedLead = await getLead(target)
      const people = await getContacts(selectedLead.company_id)
      if (!active) return
      setOffers(catalog.filter(item => item.status === 'active'))
      setLead(selectedLead); setContacts(people)
      if (proposal) setForm({ lead_id: proposal.lead_id, contact_id: proposal.contact_id,
        offer_id: proposal.offer_template_id, service_description: proposal.service_description,
        quoted_price_xof: proposal.base_price_xof, discount_xof: proposal.discount_xof,
        payment_plan: proposal.payment_plan, special_terms: proposal.special_terms,
        expires_at: dateOnly(proposal.expires_at) })
    }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [id, leadId])
  const chosen = offers.find(item => item.id === form.offer_id)
  function selectOffer(value: string) {
    const selected = offers.find(item => item.id === value)
    setForm(old => ({ ...old, offer_id: value, quoted_price_xof: selected?.price_xof,
      expires_at: selected?.validity_days ? dateOnly(new Date(Date.now() + selected.validity_days * 86400000).toISOString()) : old.expires_at }))
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null)
    try { const saved = await saveProposal(id ?? null, { ...form, expires_at: `${form.expires_at}T23:59:59Z` }); navigate(`/propositions/${saved}`) }
    catch (e) { setError(e instanceof Error ? e.message : 'Proposition non enregistrée.') }
    finally { setBusy(false) }
  }
  return <div className="crm-page"><Link className="crm-back" to={id ? `/propositions/${id}` : leadId ? `/prospects/${leadId}` : '/propositions'}><ArrowLeft size={16} /> Retour</Link><div className="crm-page-head"><div><span className="section-kicker">PROPOSITION / BROUILLON</span><h1>{id ? 'Modifier la proposition' : 'Créer une proposition'}</h1><p>{lead?.company_name ?? 'Chargement du prospect…'} · les montants sont calculés et contrôlés par Supabase.</p></div></div>{error && <div className="crm-alert" role="alert">{error}</div>}{lead && <form className="crm-form" onSubmit={e => void submit(e)}><div className="crm-form-grid"><label className="crm-field">Offre active *<select required value={form.offer_id} onChange={e => selectOffer(e.target.value)}><option value="">Choisir une offre</option>{offers.map(item => <option key={item.id} value={item.id}>{item.name} · V{item.version} · {xofAmount(item.price_xof)}</option>)}</select></label><label className="crm-field">Contact destinataire<select value={form.contact_id ?? ''} onChange={e => setForm({ ...form, contact_id: e.target.value || null })}><option value="">Entreprise uniquement</option>{contacts.map(item => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></label><label className="crm-field crm-field-wide">Description de la prestation *<textarea rows={4} required value={form.service_description} onChange={e => setForm({ ...form, service_description: e.target.value })} /></label><label className="crm-field">Prix proposé en FCFA *<input type="number" min={chosen?.price_xof ?? 0} step="1" required disabled={!chosen || !chosen.price_is_starting} value={form.quoted_price_xof ?? chosen?.price_xof ?? ''} onChange={e => setForm({ ...form, quoted_price_xof: Number(e.target.value) })} /></label><label className="crm-field">Remise demandée en FCFA<input type="number" min="0" step="1" value={form.discount_xof} onChange={e => setForm({ ...form, discount_xof: Number(e.target.value) })} /><small>Une remise exige l’approbation d’un responsable.</small></label><label className="crm-field">Échéancier contractuel<select value={form.payment_plan} onChange={e => setForm({ ...form, payment_plan: e.target.value as PaymentPlan })}>{Object.entries(paymentPlanLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="crm-field">Date limite de validité *<input type="date" required value={form.expires_at} onChange={e => setForm({ ...form, expires_at: e.target.value })} /></label><label className="crm-field crm-field-wide">Conditions particulières<textarea rows={3} value={form.special_terms ?? ''} onChange={e => setForm({ ...form, special_terms: e.target.value })} /><small>Une condition particulière exige l’approbation d’un responsable.</small></label></div>{chosen && <div className="commercial-quote-preview"><div><span>{chosen.name} · version {chosen.version}</span><strong>{chosen.price_is_starting ? 'À partir de ' : ''}{xofAmount(chosen.price_xof)}</strong></div><div><span>Prix proposé</span><strong>{xofAmount(form.quoted_price_xof ?? chosen.price_xof)}</strong></div><div><span>Remise soumise à validation</span><strong>- {xofAmount(form.discount_xof)}</strong></div><div className="total"><span>Montant proposé</span><strong>{xofAmount((form.quoted_price_xof ?? chosen.price_xof) - form.discount_xof)}</strong></div><p>Ceci est un aperçu. Supabase recalcule le montant et vérifie les autorisations à l’enregistrement.</p></div>}<div className="crm-form-actions"><Button type="submit" disabled={busy || !chosen || !Number.isSafeInteger(form.discount_xof)}>{busy ? 'Enregistrement…' : 'Enregistrer le brouillon'}</Button></div></form>}</div>
}

export function ProposalDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const manager = profile?.role === 'admin' || profile?.role === 'sales_manager'
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [events, setEvents] = useState<CommercialEvent[]>([])
  const [documents, setDocuments] = useState<ProposalDocument[]>([])
  const [order, setOrder] = useState<Order | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [channel, setChannel] = useState('email')
  const [reference, setReference] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => { if (!id) return; Promise.all([getProposal(id), getProposalEvents(id), getProposalDocuments(id)]).then(async ([p, e, d]) => { setProposal(p); setEvents(e); setDocuments(d); setOrder((await getOrders(p.lead_id)).find(item => item.proposal_id === id) ?? null) }).catch(e => setError(e.message)) }, [id, refresh])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  async function act(work: () => Promise<unknown>) { setBusy(true); setError(null); try { await work(); setRefresh(x => x + 1) } catch (e) { setError(e instanceof Error ? e.message : 'Opération impossible.') } finally { setBusy(false) } }
  async function showPreview() { if (!proposal) return; setBusy(true); setError(null); try { const { renderProposalPdf } = await import('../../supabase/functions/_shared/proposal-pdf'); const bytes = await renderProposalPdf({ proposal, settings: await getSettings() }, undefined, true); setPreview(URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }))) } catch (e) { setError(e instanceof Error ? e.message : 'Aperçu indisponible.') } finally { setBusy(false) } }
  async function openDocument(document: ProposalDocument) {
    const tab = window.open('', '_blank')
    if (!tab) { setError('Autorisez les fenêtres surgissantes pour ouvrir le document.'); return }
    try { tab.opener = null; tab.location.href = await signedDocumentUrl(document.storage_path) }
    catch (e) { tab.close(); setError(e instanceof Error ? e.message : 'Document inaccessible.') }
  }
  if (!id) return null
  return <div className="crm-page"><Link className="crm-back" to="/propositions"><ArrowLeft size={16} /> Propositions</Link>{error && <div className="crm-alert" role="alert">{error}</div>}{!proposal ? <div className="crm-empty">Chargement…</div> : <><div className="crm-detail-head"><span className="detail-logo"><FileCheck2 size={24} /></span><div><span className="section-kicker">PROPOSITION / {proposal.proposal_number}</span><h1>{String(proposal.client_snapshot.company_name ?? 'Entreprise')}</h1><div className="detail-sub"><span className={`commercial-badge commercial-${proposal.status}`}>{proposalStatusLabels[proposal.status]}</span><span>{xofAmount(proposal.amount_xof)}</span></div></div></div><div className="crm-head-actions commercial-actions"><Button variant="secondary" disabled={busy} onClick={() => void showPreview()}>Aperçu PDF</Button>{proposal.status === 'draft' && <><Button variant="secondary" asChild><Link to={`/propositions/${id}/modifier`}>Modifier</Link></Button><Button disabled={busy} onClick={() => void act(() => submitProposal(id))}>Soumettre</Button></>}{proposal.status === 'pending_approval' && manager && <Button disabled={busy} onClick={() => void act(() => approveProposal(id, reason))}>Approuver l’exception</Button>}{['approved','sent','accepted'].includes(proposal.status) && <Button disabled={busy} onClick={() => void act(() => issueProposal(id))}><FilePlus2 size={16} /> {documents.length ? 'Retrouver le PDF' : 'Émettre le PDF'}</Button>}{proposal.status === 'accepted' && proposal.acceptance_verified && <Button disabled={busy} onClick={() => void act(async () => navigate(`/commandes/${await createOrder(id)}`))}>Créer la commande</Button>}</div><div className="crm-detail-grid"><div><section className="crm-section"><h2>Conditions proposées</h2><p>{proposal.service_description}</p><div className="crm-facts"><div><span>Offre</span><strong>{String(proposal.offer_snapshot.name)} · V{proposal.offer_version}</strong></div><div><span>Prix de base</span><strong>{xofAmount(proposal.base_price_xof)}</strong></div><div><span>Remise</span><strong>{xofAmount(proposal.discount_xof)}</strong></div><div><span>Montant final</span><strong>{xofAmount(proposal.amount_xof)}</strong></div><div><span>Échéancier</span><strong>{paymentPlanLabels[proposal.payment_plan]}</strong></div><div><span>Validité</span><strong>{date(proposal.expires_at)}</strong></div><div><span>Délai indicatif</span><strong>{proposal.delivery_days == null ? 'Non renseigné' : `${proposal.delivery_days} jours`}</strong></div><div><span>Conditions particulières</span><strong>{proposal.special_terms || 'Aucune'}</strong></div></div></section><section className="crm-section"><h2>Document officiel</h2>{documents.map(document => <div className="crm-list-row" key={document.id}><div><strong>{document.document_number}</strong><small>Émis le {date(document.issued_at)} · empreinte {document.content_hash.slice(0, 12)}…</small></div><button className="crm-quick-link" onClick={() => void openDocument(document)}><Download size={15} /> Télécharger</button></div>)}{documents.length === 0 && <p className="crm-muted">Aucun PDF émis. L’aperçu n’est pas un document officiel.</p>}{proposal.status === 'approved' && documents.length > 0 && <div className="commercial-action-form"><p>Partagez le PDF vous-même, puis consignez le canal utilisé. Cette action n’envoie rien automatiquement.</p><select value={channel} onChange={e => setChannel(e.target.value)}><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="in_person">En main propre</option><option value="other">Autre</option></select><Button disabled={busy} onClick={() => void act(() => sendProposal(id, channel))}><Send size={15} /> Confirmer l’envoi manuel</Button></div>}</section><section className="crm-section"><h2>Historique</h2>{events.map(event => <div className="crm-list-row" key={event.id}><div><strong>{event.event_type.replace(/_/g, ' ')}</strong><small>{date(event.created_at)}</small></div></div>)}</section></div><aside><section className="crm-section"><h2>Validation</h2><p>Exception de prix ou de conditions : {proposal.requires_approval ? 'approbation requise' : 'conditions standard'}.</p>{proposal.status === 'pending_approval' && manager && <label className="crm-field">Motif d’approbation<input value={reason} onChange={e => setReason(e.target.value)} /></label>}{proposal.status === 'sent' && <div className="commercial-action-form"><p>Déclarez l’acceptation du client. Elle restera non vérifiée jusqu’au contrôle d’un responsable.</p><select value={channel} onChange={e => setChannel(e.target.value)}><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="signed_document">Document signé</option><option value="in_person">En personne</option><option value="other">Autre</option></select><input placeholder="Référence ou preuve (facultatif)" value={reference} onChange={e => setReference(e.target.value)} /><Button disabled={busy} onClick={() => void act(() => recordAcceptance(id, channel, reference))}>Déclarer l’acceptation</Button></div>}{proposal.status === 'accepted' && <><p>{proposal.acceptance_verified ? 'Acceptation vérifiée' : 'Acceptation déclarée, non encore vérifiée'} · {proposal.acceptance_channel || 'canal inconnu'}</p>{!proposal.acceptance_verified && manager && <div className="commercial-action-form"><input required placeholder="Référence vérifiable *" value={reference} onChange={e => setReference(e.target.value)} /><Button disabled={busy || !reference.trim()} onClick={() => void act(() => verifyAcceptance(id, reference))}>Vérifier l’acceptation</Button></div>}</>}{order && <Link className="crm-quick-link" to={`/commandes/${order.id}`}>Commande {order.order_number} <ArrowRight size={15} /></Link>}</section>{['draft','pending_approval','approved','sent'].includes(proposal.status) && <section className="crm-section"><h2>Clôturer</h2><input className="crm-reason" placeholder="Motif obligatoire" value={reason} onChange={e => setReason(e.target.value)} /><div className="crm-head-actions"><Button size="sm" variant="secondary" disabled={busy || !reason.trim()} onClick={() => void act(() => closeProposal(id, 'cancelled', reason))}>Annuler</Button>{proposal.status === 'sent' && <Button size="sm" variant="secondary" disabled={busy || !reason.trim()} onClick={() => void act(() => closeProposal(id, 'rejected', reason))}>Refusée</Button>}</div></section>}</aside></div>{preview && <section className="crm-section"><h2>Aperçu non émis</h2><iframe src={preview} title="Aperçu de la proposition" className="commercial-pdf-preview" /></section>}</>}</div>
}
