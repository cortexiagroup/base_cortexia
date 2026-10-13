import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Download, Plus, X } from 'lucide-react'
import { Button } from '../components/ui/button'
import { getActivities, getAppointments, getFollowUps, getLeadNames } from './api'
import { ActivityForm, AppointmentForm, FollowUpForm } from './Forms'
import { exportActivities, exportFollowUps } from './excel'
import { appointmentStatusLabels, followUpStatusLabels, type Activity, type Appointment, type FollowUp } from './types'

const dateTime = new Intl.DateTimeFormat('fr-TG', { timeZone: 'Africa/Lome', dateStyle: 'medium', timeStyle: 'short' })
const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lome', year: 'numeric', month: '2-digit', day: '2-digit' })
function when(value: string) { return dateTime.format(new Date(value)) }
type Tab = 'journal' | 'agenda' | 'relances'
type Editor = 'activity' | 'appointment' | 'follow_up' | null

export function ActivitiesPage() {
  const [tab, setTab] = useState<Tab>('journal')
  const [editor, setEditor] = useState<Editor>(null)
  const [editingAppointment, setEditingAppointment] = useState<Appointment | undefined>()
  const [editingFollowUp, setEditingFollowUp] = useState<FollowUp | undefined>()
  const [activities, setActivities] = useState<Activity[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true); setError(null)
    Promise.all([getActivities(), getAppointments(), getFollowUps()]).then(async ([a, meetings, follow]) => {
      const lookup = await getLeadNames([...a.map(item => item.lead_id), ...meetings.map(item => item.lead_id), ...follow.map(item => item.lead_id)])
      if (active) { setActivities(a); setAppointments(meetings); setFollowUps(follow); setNames(lookup) }
    }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [refresh])
  const today = dateKey.format(new Date())
  const followSummary = useMemo(() => ({
    overdue: followUps.filter(item => item.status === 'todo' && dateKey.format(new Date(item.due_at)) < today).length,
    today: followUps.filter(item => item.status === 'todo' && dateKey.format(new Date(item.due_at)) === today).length,
    upcoming: followUps.filter(item => item.status === 'todo' && dateKey.format(new Date(item.due_at)) > today).length,
    completed: followUps.filter(item => item.status === 'completed').length,
  }), [followUps, today])
  function closeEditor() { setEditor(null); setEditingAppointment(undefined); setEditingFollowUp(undefined) }
  function saved() { closeEditor(); setRefresh(x => x + 1) }
  async function download() {
    try { if (tab === 'relances') await exportFollowUps(followUps); else await exportActivities(activities) }
    catch (e) { setError(e instanceof Error ? e.message : 'Export impossible.') }
  }
  return <div className="crm-page"><div className="crm-page-head"><div><span className="section-kicker">CRM / INTERACTIONS</span><h1>Activités et rendez-vous</h1><p>Un journal fidèle des échanges, une vue claire des prochaines actions.</p></div><div className="crm-head-actions"><Button variant="secondary" onClick={() => void download()}><Download size={16} /> Exporter</Button><Button onClick={() => setEditor(tab === 'agenda' ? 'appointment' : tab === 'relances' ? 'follow_up' : 'activity')}><Plus size={17} /> {tab === 'agenda' ? 'Planifier' : tab === 'relances' ? 'Relancer' : 'Nouvelle activité'}</Button></div></div>
    <div className="crm-tabs"><button className={tab === 'journal' ? 'active' : ''} onClick={() => setTab('journal')}>Journal</button><button className={tab === 'agenda' ? 'active' : ''} onClick={() => setTab('agenda')}>Agenda</button><button className={tab === 'relances' ? 'active' : ''} onClick={() => setTab('relances')}>Relances</button></div>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    {editor && <section className="crm-action-panel"><div className="crm-panel-title"><h2>{editor === 'activity' ? 'Enregistrer une activité' : editor === 'appointment' ? 'Rendez-vous ou démonstration' : 'Programmer une relance'}</h2><button aria-label="Fermer" onClick={closeEditor}><X size={18} /></button></div>{editor === 'activity' ? <ActivityForm onSaved={saved} /> : editor === 'appointment' ? <AppointmentForm current={editingAppointment} onSaved={saved} /> : <FollowUpForm current={editingFollowUp} onSaved={saved} />}</section>}
    {loading ? <div className="crm-empty">Chargement…</div> : tab === 'journal' ? <section className="crm-section"><div className="crm-section-head"><h2>Dernières interactions</h2><span>{activities.length} affichée(s)</span></div>{activities.map(item => <div className="crm-feed-row" key={item.id}><span className="crm-feed-icon"><CalendarDays size={18} /></span><div><Link to={`/prospects/${item.lead_id}`}><strong>{names[item.lead_id] || 'Prospect'}</strong></Link><p>{item.subject || item.activity_type} · {item.outcome || item.interaction_status || 'Résultat non renseigné'}</p>{item.body && <small>{item.body}</small>}</div><time>{when(item.occurred_at)}</time></div>)}{activities.length === 0 && <div className="crm-empty">Aucune activité enregistrée. Utilisez « Nouvelle activité » pour commencer.</div>}</section>
      : tab === 'agenda' ? <section className="crm-section"><div className="crm-section-head"><h2>Rendez-vous et démonstrations</h2><span>{appointments.length} entrée(s)</span></div>{appointments.map(item => <div className="crm-feed-row" key={item.id}><span className="crm-feed-icon"><CalendarDays size={18} /></span><div><Link to={`/prospects/${item.lead_id}`}><strong>{names[item.lead_id] || 'Prospect'}</strong></Link><p>{item.kind === 'demo' ? 'Démonstration' : 'Rendez-vous'} · {item.location_or_channel || 'Lieu à définir'}</p><small>{item.outcome || 'Résultat non renseigné'}</small></div><div className="crm-feed-end"><time>{when(item.scheduled_at)}</time><span>{appointmentStatusLabels[item.status]}</span><button onClick={() => { setEditingAppointment(item); setEditor('appointment') }}>Modifier</button></div></div>)}{appointments.length === 0 && <div className="crm-empty">Aucun rendez-vous enregistré.</div>}</section>
      : <><div className="crm-follow-summary"><div><strong>{followSummary.overdue}</strong><span>En retard</span></div><div><strong>{followSummary.today}</strong><span>Aujourd’hui</span></div><div><strong>{followSummary.upcoming}</strong><span>À venir</span></div><div><strong>{followSummary.completed}</strong><span>Terminées</span></div></div><section className="crm-section"><div className="crm-section-head"><h2>Relances commerciales</h2><span>{followUps.length} entrée(s)</span></div>{followUps.map(item => <div className="crm-feed-row" key={item.id}><span className="crm-feed-icon"><CalendarDays size={18} /></span><div><Link to={`/prospects/${item.lead_id}`}><strong>{names[item.lead_id] || 'Prospect'}</strong></Link><p>{item.reason}</p><small>{item.notes || followUpStatusLabels[item.status]}</small></div><div className="crm-feed-end"><time>{when(item.due_at)}</time><span>{followUpStatusLabels[item.status]}</span><button onClick={() => { setEditingFollowUp(item); setEditor('follow_up') }}>Modifier</button></div></div>)}{followUps.length === 0 && <div className="crm-empty">Aucune relance enregistrée.</div>}</section></>}
  </div>
}
