import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '../components/ui/button'
import { useAuth } from '../lib/auth'
import { addActivity, saveAppointment, saveFollowUp, searchLeads } from './api'
import { activityTypes, appointmentStatusLabels, followUpStatusLabels, outcomeLabels, type Appointment, type FollowUp, type Lead } from './types'

const lomeFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
export function toLomeInput(iso?: string | null): string {
  const parts = Object.fromEntries(lomeFormatter.formatToParts(new Date(iso ?? Date.now())).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}
export function fromLomeInput(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Date et heure invalides.')
  return new Date(`${value}:00Z`).toISOString()
}

export function LeadPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<Lead[]>([])
  useEffect(() => {
    let active = true
    searchLeads({ search, pageSize: 30 }).then(result => { if (active) setRows(result.rows) }).catch(() => {})
    return () => { active = false }
  }, [search])
  return <label className="crm-field">Prospect<input aria-label="Rechercher un prospect" placeholder="Rechercher une entreprise…" value={search} onChange={e => setSearch(e.target.value)} /><select required value={value} onChange={e => onChange(e.target.value)}><option value="">Sélectionner un prospect</option>{rows.map(row => <option key={row.id} value={row.id}>{row.company_name}</option>)}{value && !rows.some(row => row.id === value) && <option value={value}>Prospect sélectionné</option>}</select></label>
}

export function ActivityForm({ leadId, initialType, onSaved }: { leadId?: string; initialType?: string; onSaved: () => void }) {
  const [targetId, setTargetId] = useState(leadId ?? '')
  const [type, setType] = useState(initialType ?? 'call')
  const [channel, setChannel] = useState(initialType === 'visit' ? 'in_person' : 'phone')
  const [status, setStatus] = useState('completed')
  const [outcome, setOutcome] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [occurred, setOccurred] = useState(toLomeInput())
  const [nextAction, setNextAction] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null)
    try { await addActivity({ lead_id: targetId, activity_type: type, channel, interaction_status: status, outcome,
      subject, body, occurred_at: fromLomeInput(occurred), next_action_at: nextAction ? fromLomeInput(nextAction) : undefined }); onSaved() }
    catch (e) { setError(e instanceof Error ? e.message : 'Activité non enregistrée.') }
    finally { setBusy(false) }
  }
  return <form className="crm-inline-form" onSubmit={e => void submit(e)}>{!leadId && <LeadPicker value={targetId} onChange={setTargetId} />}<div className="crm-form-grid"><label className="crm-field">Type<select value={type} onChange={e => setType(e.target.value)}>{activityTypes.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="crm-field">Canal<select value={channel} onChange={e => setChannel(e.target.value)}><option value="phone">Téléphone</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="in_person">Sur place</option><option value="video">Visio</option><option value="other">Autre</option></select></label><label className="crm-field">État de l’interaction<select value={status} onChange={e => setStatus(e.target.value)}><option value="attempted">Tentée</option><option value="completed">Réalisée</option><option value="no_answer">Sans réponse</option><option value="cancelled">Annulée</option></select></label><label className="crm-field">Résultat<select value={outcome} onChange={e => setOutcome(e.target.value)}><option value="">Non renseigné</option>{outcomeLabels.map(label => <option key={label}>{label}</option>)}</select></label><label className="crm-field">Date et heure<input type="datetime-local" required value={occurred} onChange={e => setOccurred(e.target.value)} /></label><label className="crm-field">Prochaine action<input type="datetime-local" value={nextAction} onChange={e => setNextAction(e.target.value)} /></label><label className="crm-field crm-field-wide">Objet<input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Résumé de l’échange" /></label><label className="crm-field crm-field-wide">Note<textarea rows={3} value={body} onChange={e => setBody(e.target.value)} /></label></div>{error && <div className="crm-alert" role="alert">{error}</div>}<Button disabled={busy || !targetId} type="submit">{busy ? 'Enregistrement…' : 'Enregistrer l’activité'}</Button></form>
}

export function AppointmentForm({ leadId, current, onSaved }: { leadId?: string; current?: Appointment; onSaved: () => void }) {
  const { profile } = useAuth()
  const [targetId, setTargetId] = useState(current?.lead_id ?? leadId ?? '')
  const [kind, setKind] = useState<Appointment['kind']>(current?.kind ?? 'meeting')
  const [when, setWhen] = useState(toLomeInput(current?.scheduled_at))
  const [status, setStatus] = useState<Appointment['status']>(current?.status ?? 'scheduled')
  const [location, setLocation] = useState(current?.location_or_channel ?? '')
  const [solution, setSolution] = useState(current?.solution_presented ?? '')
  const [objections, setObjections] = useState(current?.objections ?? '')
  const [outcome, setOutcome] = useState(current?.outcome ?? '')
  const [notes, setNotes] = useState(current?.notes ?? '')
  const [nextAction, setNextAction] = useState(current?.next_action_at ? toLomeInput(current.next_action_at) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null)
    try { await saveAppointment({ id: current?.id, lead_id: targetId, sales_rep_id: current?.sales_rep_id ?? profile!.id, kind,
      scheduled_at: fromLomeInput(when), status, location_or_channel: location, solution_presented: solution,
      objections, outcome, notes, next_action_at: nextAction ? fromLomeInput(nextAction) : null }); onSaved() }
    catch (e) { setError(e instanceof Error ? e.message : 'Rendez-vous non enregistré.') }
    finally { setBusy(false) }
  }
  return <form className="crm-inline-form" onSubmit={e => void submit(e)}>{!leadId && !current && <LeadPicker value={targetId} onChange={setTargetId} />}<div className="crm-form-grid"><label className="crm-field">Type<select value={kind} onChange={e => setKind(e.target.value as Appointment['kind'])}><option value="meeting">Rendez-vous</option><option value="demo">Démonstration</option></select></label><label className="crm-field">Date et heure à Lomé<input type="datetime-local" required value={when} onChange={e => setWhen(e.target.value)} /></label><label className="crm-field">Statut<select value={status} onChange={e => setStatus(e.target.value as Appointment['status'])}>{Object.entries(appointmentStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="crm-field">Lieu ou canal<input value={location} onChange={e => setLocation(e.target.value)} placeholder="Bureau, chez le client, visio…" /></label>{kind === 'demo' && <><label className="crm-field">Solution présentée<input value={solution} onChange={e => setSolution(e.target.value)} /></label><label className="crm-field">Objections<input value={objections} onChange={e => setObjections(e.target.value)} /></label></>}<label className="crm-field">Résultat<input value={outcome} onChange={e => setOutcome(e.target.value)} /></label><label className="crm-field">Prochaine action<input type="datetime-local" value={nextAction} onChange={e => setNextAction(e.target.value)} /></label><label className="crm-field crm-field-wide">Notes<textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></label></div>{error && <div className="crm-alert" role="alert">{error}</div>}<Button disabled={busy || !targetId} type="submit">{busy ? 'Enregistrement…' : current ? 'Enregistrer les modifications' : 'Planifier'}</Button></form>
}

export function FollowUpForm({ leadId, current, onSaved }: { leadId?: string; current?: FollowUp; onSaved: () => void }) {
  const { profile } = useAuth()
  const [targetId, setTargetId] = useState(current?.lead_id ?? leadId ?? '')
  const [due, setDue] = useState(toLomeInput(current?.due_at))
  const [reason, setReason] = useState(current?.reason ?? '')
  const [status, setStatus] = useState<FollowUp['status']>(current?.status ?? 'todo')
  const [notes, setNotes] = useState(current?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null)
    try { await saveFollowUp({ id: current?.id, lead_id: targetId, responsible_id: current?.responsible_id ?? profile!.id,
      due_at: fromLomeInput(due), reason, status, notes }); onSaved() }
    catch (e) { setError(e instanceof Error ? e.message : 'Relance non enregistrée.') }
    finally { setBusy(false) }
  }
  return <form className="crm-inline-form" onSubmit={e => void submit(e)}>{!leadId && !current && <LeadPicker value={targetId} onChange={setTargetId} />}<div className="crm-form-grid"><label className="crm-field">Échéance à Lomé<input type="datetime-local" required value={due} onChange={e => setDue(e.target.value)} /></label><label className="crm-field">Statut<select value={status} onChange={e => setStatus(e.target.value as FollowUp['status'])}>{Object.entries(followUpStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="crm-field crm-field-wide">Motif<input required value={reason} onChange={e => setReason(e.target.value)} /></label><label className="crm-field crm-field-wide">Note<textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></label></div>{error && <div className="crm-alert" role="alert">{error}</div>}<Button disabled={busy || !targetId} type="submit">{busy ? 'Enregistrement…' : current ? 'Enregistrer les modifications' : 'Programmer la relance'}</Button></form>
}
