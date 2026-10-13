import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, BriefcaseBusiness, CalendarDays, MapPin, Phone, UsersRound } from 'lucide-react'
import { Button } from '../components/ui/button'
import { useAuth } from '../lib/auth'
import { getSalesProfiles, searchLeads, setSalesActive, updateSalesProfile } from './api'
import type { SalesProfile } from './types'
import { supabase } from '../lib/supabase'

interface Metrics { leads: number; won: number; meetings: number; demos: number }
async function metricsFor(id: string): Promise<Metrics> {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  const [leads, won, meetings, demos] = await Promise.all([
    searchLeads({ assignee: id, pageSize: 1 }),
    searchLeads({ assignee: id, status: 'won', pageSize: 1 }),
    supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('sales_rep_id', id).eq('kind', 'meeting').eq('status', 'completed'),
    supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('sales_rep_id', id).eq('kind', 'demo').eq('status', 'completed'),
  ])
  if (meetings.error || demos.error) throw new Error(meetings.error?.message ?? demos.error!.message)
  return { leads: leads.total, won: won.total, meetings: meetings.count ?? 0, demos: demos.count ?? 0 }
}
export function SalesPage() {
  const { profile } = useAuth()
  const [sales, setSales] = useState<SalesProfile[]>([])
  const [metrics, setMetrics] = useState<Record<string, Metrics>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    getSalesProfiles().then(async people => {
      const team = people.filter(person => person.role === 'sales_rep' || person.id === profile?.id)
      const pairs = await Promise.all(team.map(person => metricsFor(person.id).then(metric => [person.id, metric] as const)))
      if (active) { setSales(team); setMetrics(Object.fromEntries(pairs)) }
    }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [profile?.id])
  return <div className="crm-page"><div className="crm-page-head"><div><span className="section-kicker">CRM / ÉQUIPE</span><h1>Commerciaux</h1><p>Portefeuille, activité et zone de prospection de l’équipe.</p></div></div>{error && <div className="crm-alert" role="alert">{error}</div>}{loading ? <div className="crm-empty">Chargement de l’équipe…</div> : <div className="crm-team-grid">{sales.map(person => <Link className="crm-team-card" key={person.id} to={`/commerciaux/${person.id}`}><div className="crm-team-top"><span className="team-avatar">{person.full_name[0]?.toUpperCase()}</span><span className={person.is_active ? 'crm-active' : 'crm-inactive'}>{person.is_active ? 'Actif' : 'Inactif'}</span></div><h2>{person.full_name}</h2><p><MapPin size={14} /> {person.territory || 'Zone non renseignée'}</p><div className="crm-team-metrics"><div><strong>{metrics[person.id]?.leads ?? '…'}</strong><span>prospects</span></div><div><strong>{metrics[person.id]?.meetings ?? '…'}</strong><span>RDV réalisés</span></div><div><strong>{metrics[person.id]?.won ?? '…'}</strong><span>gagnés</span></div></div><span className="crm-team-open">Voir la fiche <ArrowRight size={15} /></span></Link>)}{sales.length === 0 && <div className="crm-empty">Aucun commercial visible.</div>}</div>}</div>
}

export function SalesDetail() {
  const { id } = useParams()
  const { profile } = useAuth()
  const [person, setPerson] = useState<SalesProfile | null>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [territory, setTerritory] = useState('')
  const [phone, setPhone] = useState('')
  const [joined, setJoined] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (!id) return
    let active = true
    Promise.all([getSalesProfiles(), metricsFor(id)]).then(([people, nextMetrics]) => {
      if (!active) return
      const selected = people.find(item => item.id === id)
      if (!selected) throw new Error('Profil inaccessible.')
      setPerson(selected); setMetrics(nextMetrics); setTerritory(selected.territory ?? ''); setPhone(selected.phone ?? ''); setJoined(selected.joined_at ?? '')
    }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id, refresh])
  async function save(event: FormEvent) {
    event.preventDefault(); if (!id) return
    setBusy(true); setError(null)
    try { await updateSalesProfile(id, { territory: territory || null, phone: phone || null, joined_at: joined || null }); setRefresh(x => x + 1) }
    catch (e) { setError(e instanceof Error ? e.message : 'Profil non modifié.') }
    finally { setBusy(false) }
  }
  async function toggle() {
    if (!person || !id) return
    setBusy(true); setError(null)
    try { await setSalesActive(id, !person.is_active); setRefresh(x => x + 1) }
    catch (e) { setError(e instanceof Error ? e.message : 'Statut non modifié.') }
    finally { setBusy(false) }
  }
  return <div className="crm-page"><Link className="crm-back" to="/commerciaux"><ArrowLeft size={16} /> Équipe commerciale</Link>{loading ? <div className="crm-empty">Chargement…</div> : !person ? <div className="crm-alert">{error ?? 'Profil introuvable.'}</div> : <><div className="crm-detail-head"><span className="detail-logo"><BriefcaseBusiness size={30} /></span><div><span className="section-kicker">COMMERCIAL / {person.id.slice(0, 8).toUpperCase()}</span><h1>{person.full_name}</h1><div className="detail-sub"><span className={person.is_active ? 'crm-active' : 'crm-inactive'}>{person.is_active ? 'Actif' : 'Inactif'}</span><span>{person.territory || 'Zone non renseignée'}</span></div></div></div>{error && <div className="crm-alert" role="alert">{error}</div>}<div className="crm-sales-overview"><div><UsersRound size={19} /><strong>{metrics?.leads ?? 0}</strong><span>Prospects attribués</span></div><div><CalendarDays size={19} /><strong>{metrics?.meetings ?? 0}</strong><span>Rendez-vous réalisés</span></div><div><BriefcaseBusiness size={19} /><strong>{metrics?.demos ?? 0}</strong><span>Démonstrations réalisées</span></div><div><ArrowRight size={19} /><strong>{metrics?.won ?? 0}</strong><span>Opportunités gagnées</span></div></div><div className="crm-detail-grid"><section className="crm-section"><h2>Informations professionnelles</h2><div className="crm-facts"><div><span>Identifiant</span><strong>{person.id}</strong></div><div><span>Téléphone</span><strong>{person.phone || '—'}</strong></div><div><span>Zone de prospection</span><strong>{person.territory || '—'}</strong></div><div><span>Date d’intégration</span><strong>{person.joined_at || '—'}</strong></div></div>{person.phone && <a className="crm-quick-link" href={`tel:${person.phone.replace(/[^\d+]/g, '')}`}><Phone size={15} /> Appeler</a>}</section>{(profile?.role === 'admin' || profile?.role === 'sales_manager') && <section className="crm-section"><h2>Organisation</h2><form className="crm-inline-form" onSubmit={e => void save(e)}><label className="crm-field">Zone de prospection<input value={territory} onChange={e => setTerritory(e.target.value)} /></label><label className="crm-field">Téléphone professionnel<input value={phone} onChange={e => setPhone(e.target.value)} /></label><label className="crm-field">Date d’intégration<input type="date" value={joined} onChange={e => setJoined(e.target.value)} /></label><Button type="submit" disabled={busy}>Enregistrer</Button></form>{profile.role === 'admin' && person.role === 'sales_rep' && <Button variant="secondary" disabled={busy} onClick={() => void toggle()}>{person.is_active ? 'Désactiver le commercial' : 'Activer le commercial'}</Button>}</section>}</div></>}</div>
}
