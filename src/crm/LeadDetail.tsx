import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarPlus, Clock3, Edit3, MapPin, MessageCircle, Phone, Plus, UserRound, X } from 'lucide-react'
import { Button } from '../components/ui/button'
import { useAuth } from '../lib/auth'
import { addContact, assignLeads, getActivities, getAppointments, getAssignments, getContacts, getFollowUps, getLead, getSalesProfiles, setLeadStatus } from './api'
import { ActivityForm, AppointmentForm, FollowUpForm } from './Forms'
import { appointmentStatusLabels, followUpStatusLabels, priorityLabels, statusLabels, type Activity, type Appointment, type Assignment, type Contact, type FollowUp, type Lead, type LeadStatus, type SalesProfile } from './types'
import { getOrders, getProposals } from '../commercial/api'
import { orderStatusLabels, proposalStatusLabels, xofAmount, type Order, type Proposal } from '../commercial/types'

const lomeDate = new Intl.DateTimeFormat('fr-TG', { timeZone: 'Africa/Lome', dateStyle: 'medium', timeStyle: 'short' })
function when(value?: string | null) { return value ? lomeDate.format(new Date(value)) : 'Non renseigné' }
function phoneLink(phone?: string | null) { return phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : undefined }
function whatsappLink(phone?: string | null) {
  if (!phone) return undefined
  const digits = phone.replace(/\D/g, '')
  return `https://wa.me/${digits.length === 8 ? `228${digits}` : digits}`
}
type Action = 'activity' | 'visit' | 'appointment' | 'follow_up' | 'contact' | null

export function LeadDetail() {
  const { id } = useParams()
  const { profile } = useAuth()
  const manager = profile?.role === 'admin' || profile?.role === 'sales_manager'
  const [lead, setLead] = useState<Lead | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [sales, setSales] = useState<SalesProfile[]>([])
  const [action, setAction] = useState<Action>(null)
  const [status, setStatus] = useState<LeadStatus>('new')
  const [assignee, setAssignee] = useState('')
  const [reason, setReason] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (!id) return
    let active = true
    setLoading(true); setError(null)
    Promise.all([getLead(id), getActivities(id), getAppointments(id), getFollowUps(id), getAssignments(id), getSalesProfiles(), getProposals(id), getOrders(id)])
      .then(async ([nextLead, nextActivities, nextAppointments, nextFollowUps, nextAssignments, nextSales, nextProposals, nextOrders]) => {
        const nextContacts = await getContacts(nextLead.company_id)
        if (!active) return
        setLead(nextLead); setStatus(nextLead.status); setAssignee(nextLead.assigned_to ?? '')
        setContacts(nextContacts); setActivities(nextActivities); setAppointments(nextAppointments)
        setFollowUps(nextFollowUps); setAssignments(nextAssignments); setSales(nextSales)
        setProposals(nextProposals); setOrders(nextOrders)
      }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id, refresh])
  async function updateStatus() {
    if (!id || !lead) return
    setBusy(true); setError(null)
    try { await setLeadStatus(id, status, reason); setReason(''); setRefresh(x => x + 1) }
    catch (e) { setStatus(lead.status); setError(e instanceof Error ? e.message : 'Statut non modifié.') }
    finally { setBusy(false) }
  }
  async function updateAssignee() {
    if (!id) return
    setBusy(true); setError(null)
    try { await assignLeads([id], assignee || null, reason); setReason(''); setRefresh(x => x + 1) }
    catch (e) { setAssignee(lead?.assigned_to ?? ''); setError(e instanceof Error ? e.message : 'Attribution non modifiée.') }
    finally { setBusy(false) }
  }
  async function createContact(event: FormEvent) {
    event.preventDefault(); if (!lead) return
    setBusy(true); setError(null)
    try { await addContact(lead.company_id, { full_name: contactName, phone: contactPhone, email: contactEmail }); setAction(null); setContactName(''); setContactPhone(''); setContactEmail(''); setRefresh(x => x + 1) }
    catch (e) { setError(e instanceof Error ? e.message : 'Contact non créé.') }
    finally { setBusy(false) }
  }
  if (!id) return null
  return <div className="crm-page"><Link className="crm-back" to="/prospects"><ArrowLeft size={16} /> Tous les prospects</Link>
    {loading ? <div className="crm-empty">Chargement de la fiche…</div> : !lead ? <div className="crm-alert" role="alert">{error ?? 'Prospect introuvable.'}</div> : <>
      <div className="crm-detail-head"><div className="detail-logo">{lead.company_name[0]?.toUpperCase()}</div><div><span className="section-kicker">FICHE PROSPECT / {lead.id.slice(0, 8).toUpperCase()}</span><h1>{lead.company_name}</h1><div className="detail-sub"><span className={`crm-status crm-status-${lead.status}`}>{statusLabels[lead.status]}</span><span>{[lead.industry, lead.city, lead.neighborhood].filter(Boolean).join(' · ') || 'Localisation à compléter'}</span></div></div><Button variant="secondary" asChild><Link to={`/prospects/${id}/modifier`}><Edit3 size={16} /> Modifier</Link></Button></div>
      <div className="crm-detail-actions"><Button size="sm" asChild><Link to={`/prospects/${id}/proposition/nouvelle`}>Créer une proposition</Link></Button><Button size="sm" variant="secondary" onClick={() => setAction('activity')}><Plus size={15} /> Activité</Button><Button size="sm" variant="secondary" onClick={() => setAction('visit')}>Visite terrain</Button><Button size="sm" variant="secondary" onClick={() => setAction('appointment')}><CalendarPlus size={15} /> Rendez-vous</Button><Button size="sm" variant="secondary" onClick={() => setAction('follow_up')}><Clock3 size={15} /> Relance</Button>{phoneLink(lead.contact?.phone || lead.phone) && <a className="crm-quick-link" href={phoneLink(lead.contact?.phone || lead.phone)}><Phone size={15} /> Appeler</a>}{whatsappLink(lead.contact?.whatsapp || lead.contact?.phone || lead.phone) && <a className="crm-quick-link" target="_blank" rel="noopener noreferrer" href={whatsappLink(lead.contact?.whatsapp || lead.contact?.phone || lead.phone)}><MessageCircle size={15} /> WhatsApp</a>}{(lead.address || lead.city) && <a className="crm-quick-link" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([lead.address, lead.neighborhood, lead.city, 'Togo'].filter(Boolean).join(', '))}`}><MapPin size={15} /> Itinéraire</a>}</div>
      {error && <div className="crm-alert" role="alert">{error}</div>}
      {action && <section className="crm-action-panel"><div className="crm-panel-title"><h2>{action === 'activity' ? 'Nouvelle activité' : action === 'visit' ? 'Enregistrer une visite' : action === 'appointment' ? 'Planifier un rendez-vous' : action === 'follow_up' ? 'Programmer une relance' : 'Ajouter un contact'}</h2><button onClick={() => setAction(null)} aria-label="Fermer"><X size={18} /></button></div>{action === 'activity' || action === 'visit' ? <ActivityForm key={action} leadId={id} initialType={action === 'visit' ? 'visit' : undefined} onSaved={() => { setAction(null); setRefresh(x => x + 1) }} /> : action === 'appointment' ? <AppointmentForm leadId={id} onSaved={() => { setAction(null); setRefresh(x => x + 1) }} /> : action === 'follow_up' ? <FollowUpForm leadId={id} onSaved={() => { setAction(null); setRefresh(x => x + 1) }} /> : <form className="crm-inline-form" onSubmit={e => void createContact(e)}><div className="crm-form-grid"><label className="crm-field">Nom du contact<input required value={contactName} onChange={e => setContactName(e.target.value)} /></label><label className="crm-field">Téléphone<input value={contactPhone} onChange={e => setContactPhone(e.target.value)} /></label><label className="crm-field">Email<input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} /></label></div><Button type="submit" disabled={busy}>Ajouter le contact</Button></form>}</section>}
      <div className="crm-detail-grid"><div className="crm-detail-main">
        <section className="crm-section"><div className="crm-section-head"><h2>Entreprise et contacts</h2><button onClick={() => setAction('contact')}><Plus size={16} /> Ajouter un contact</button></div><div className="crm-facts"><div><span>Secteur</span><strong>{lead.industry || '—'}</strong></div><div><span>Localisation</span><strong>{[lead.city, lead.neighborhood].filter(Boolean).join(', ') || '—'}</strong></div><div><span>Site web</span><strong>{lead.has_website === false ? 'Aucun site' : lead.website || (lead.has_website ? 'Présent, adresse non renseignée' : 'Non renseigné')}</strong></div><div><span>Besoin</span><strong>{lead.identified_need || 'À qualifier'}</strong></div><div><span>Offre envisagée</span><strong>{lead.interested_offer || '—'}</strong></div><div><span>Source</span><strong>{lead.source || '—'}</strong></div></div><div className="crm-contact-list">{contacts.map(contact => <div key={contact.id}><span className="contact-avatar"><UserRound size={17} /></span><div><strong>{contact.full_name}</strong><small>{contact.job_title || 'Contact'} · {contact.phone || contact.email || 'Coordonnées à compléter'}</small></div>{contact.is_primary && <span className="crm-minor-badge">Principal</span>}</div>)}{contacts.length === 0 && <p>Aucun contact enregistré.</p>}</div></section>
        <section className="crm-section"><div className="crm-section-head"><h2>Historique des échanges</h2><span>{activities.length} activité(s)</span></div><div className="crm-timeline">{activities.map(item => <div key={item.id}><span className="timeline-dot" /><div><strong>{item.subject || item.activity_type}</strong><small>{when(item.occurred_at)} · {item.interaction_status === 'attempted' ? 'Tentative' : item.interaction_status === 'no_answer' ? 'Sans réponse' : item.outcome || item.channel || 'Interaction'}</small>{item.body && <p>{item.body}</p>}{item.activity_type === 'status_change' && <p>Statut : {String(item.metadata?.from ?? '')} → {String(item.metadata?.to ?? '')}</p>}</div></div>)}{activities.length === 0 && <p>Aucune activité enregistrée.</p>}</div></section>
        <section className="crm-section"><div className="crm-section-head"><h2>Rendez-vous et démonstrations</h2></div>{appointments.map(item => <div className="crm-list-row" key={item.id}><div><strong>{item.kind === 'demo' ? 'Démonstration' : 'Rendez-vous'}</strong><small>{when(item.scheduled_at)} · {item.location_or_channel || 'Lieu à préciser'}</small></div><span>{appointmentStatusLabels[item.status]}</span></div>)}{appointments.length === 0 && <p className="crm-muted">Aucun rendez-vous planifié.</p>}</section>
        <section className="crm-section"><div className="crm-section-head"><h2>Propositions et commandes</h2></div>{proposals.map(item => <div className="crm-list-row" key={item.id}><div><Link to={`/propositions/${item.id}`}><strong>{item.proposal_number} · {xofAmount(item.amount_xof)}</strong></Link><small>{proposalStatusLabels[item.status]} · {when(item.created_at)}</small></div></div>)}{orders.map(item => <div className="crm-list-row" key={item.id}><div><Link to={`/commandes/${item.id}`}><strong>{item.order_number} · {xofAmount(item.amount_xof)}</strong></Link><small>{orderStatusLabels[item.order_status]} · {when(item.ordered_at)}</small></div></div>)}{proposals.length === 0 && orders.length === 0 && <p className="crm-muted">Aucune proposition ni commande liée à ce prospect.</p>}</section>
      </div><aside className="crm-detail-side"><section className="crm-section"><h2>Suivi</h2><div className="crm-facts"><div><span>Responsable</span><strong>{lead.assigned_name || 'Non attribué'}</strong></div><div><span>Priorité</span><strong>{priorityLabels[lead.priority]}</strong></div><div><span>Prochaine relance</span><strong>{when(lead.next_follow_up_at)}</strong></div><div><span>Créé le</span><strong>{when(lead.created_at)}</strong></div></div><label className="crm-field">Faire évoluer le statut<select value={status} onChange={e => setStatus(e.target.value as LeadStatus)}>{Object.entries(statusLabels).filter(([key]) => key !== 'archived').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><input className="crm-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="Motif (facultatif)" /><Button size="sm" disabled={busy || status === lead.status} onClick={() => void updateStatus()}>Enregistrer le statut</Button>{manager && <div className="crm-assign-control"><label className="crm-field">Attribuer à<select value={assignee} onChange={e => setAssignee(e.target.value)}><option value="">Non attribué</option>{sales.filter(person => person.role === 'sales_rep' && person.is_active).map(person => <option key={person.id} value={person.id}>{person.full_name}</option>)}</select></label><Button size="sm" variant="secondary" disabled={busy || assignee === (lead.assigned_to ?? '')} onClick={() => void updateAssignee()}>Réattribuer</Button></div>}</section>
        <section className="crm-section"><h2>Relances</h2>{followUps.map(item => <div className="crm-list-row" key={item.id}><div><strong>{item.reason}</strong><small>{when(item.due_at)}</small></div><span>{followUpStatusLabels[item.status]}</span></div>)}{followUps.length === 0 && <p className="crm-muted">Aucune relance prévue.</p>}</section>
        <section className="crm-section"><h2>Attributions</h2>{assignments.map(item => <div className="crm-list-row" key={item.id}><div><strong>{sales.find(person => person.id === item.old_assignee_id)?.full_name || 'Non attribué'} → {sales.find(person => person.id === item.new_assignee_id)?.full_name || 'Non attribué'}</strong><small>{when(item.created_at)} · {item.reason || 'Sans motif'}</small></div></div>)}{assignments.length === 0 && <p className="crm-muted">Aucune réattribution.</p>}</section>
        {lead.notes && <section className="crm-section"><h2>Notes</h2><p className="crm-muted">{lead.notes}</p></section>}
      </aside></div>
    </>}
  </div>
}
