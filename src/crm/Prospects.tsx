import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Download, KanbanSquare, List, Plus, Search, UserRoundPlus, X } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Button } from '../components/ui/button'
import { assignLeads, getLead, getSalesProfiles, saveLead, searchLeads, setLeadStatus, type LeadFilters } from './api'
import { pipelineStatuses, priorityLabels, statusLabels, type Lead, type LeadInput, type LeadPriority, type LeadStatus, type SalesProfile } from './types'
import { exportLeads } from './excel'

const dateDisplay = new Intl.DateTimeFormat('fr-TG', { timeZone: 'Africa/Lome', day: '2-digit', month: 'short', year: 'numeric' })
function date(value: string | null) { return value ? dateDisplay.format(new Date(value)) : '—' }
function Status({ value }: { value: LeadStatus }) { return <span className={`crm-status crm-status-${value}`}>{statusLabels[value]}</span> }
function Priority({ value }: { value: LeadPriority }) { return <span className={`crm-priority crm-priority-${value}`}>{priorityLabels[value]}</span> }

export function ProspectsPage() {
  const { profile } = useAuth()
  const manager = profile?.role === 'admin' || profile?.role === 'sales_manager'
  const [view, setView] = useState<'table' | 'kanban'>('table')
  const [filters, setFilters] = useState<LeadFilters>({ page: 1, pageSize: 20, sort: 'recent' })
  const [searchText, setSearchText] = useState('')
  const [result, setResult] = useState<{ rows: Lead[]; total: number }>({ rows: [], total: 0 })
  const [cards, setCards] = useState<Record<string, Lead[]>>({})
  const [sales, setSales] = useState<SalesProfile[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [assignee, setAssignee] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => { getSalesProfiles().then(setSales).catch(() => {}) }, [])
  useEffect(() => {
    let active = true
    setLoading(true); setError(null)
    if (view === 'table') {
      searchLeads(filters).then(data => { if (active) setResult(data) }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
    } else {
      Promise.all(pipelineStatuses.map(status => searchLeads({ ...filters, status, page: 1, pageSize: 40 }).then(data => [status, data.rows] as const)))
        .then(entries => { if (active) setCards(Object.fromEntries(entries)) })
        .catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
    }
    return () => { active = false }
  }, [view, filters, refresh])
  useEffect(() => { const timer = setTimeout(() => setFilters(old => ({ ...old, search: searchText, page: 1 })), 300); return () => clearTimeout(timer) }, [searchText])
  function patchFilters(patch: Partial<LeadFilters>) { setFilters(old => ({ ...old, ...patch, page: 1 })) }
  async function moveLead(lead: Lead, target: LeadStatus) {
    if (target === lead.status || busy) return
    const before = cards
    setCards(current => ({ ...current, [lead.status]: (current[lead.status] ?? []).filter(item => item.id !== lead.id), [target]: [{ ...lead, status: target }, ...(current[target] ?? [])] }))
    setBusy(true); setError(null)
    try { await setLeadStatus(lead.id, target); setRefresh(value => value + 1) }
    catch (e) { setCards(before); setError(e instanceof Error ? e.message : 'Changement de statut refusé.') }
    finally { setBusy(false) }
  }
  async function bulkAssign() {
    if (!selectedIds.length || busy) return
    setBusy(true); setError(null)
    try { await assignLeads(selectedIds, assignee || null, reason); setSelectedIds([]); setReason(''); setRefresh(value => value + 1) }
    catch (e) { setError(e instanceof Error ? e.message : 'Attribution refusée.') }
    finally { setBusy(false) }
  }
  async function handleExport() {
    setBusy(true); setError(null)
    try {
      const rows: Lead[] = []
      let page = 1
      while (true) {
        const batch = await searchLeads({ ...filters, page, pageSize: 100 })
        rows.push(...batch.rows)
        if (rows.length >= batch.total || batch.rows.length === 0) break
        page += 1
      }
      await exportLeads(rows)
    } catch (e) { setError(e instanceof Error ? e.message : 'Export impossible.') }
    finally { setBusy(false) }
  }
  const pageCount = Math.max(1, Math.ceil(result.total / 20))
  return <div className="crm-page">
    <div className="crm-page-head"><div><span className="section-kicker">CRM / PROSPECTION</span><h1>Prospects</h1><p>Retrouvez chaque entreprise, son responsable et les prochaines actions.</p></div><div className="crm-head-actions"><Button variant="secondary" onClick={() => void handleExport()} disabled={busy}><Download size={16} /> Exporter</Button><Button asChild><Link to="/prospects/nouveau"><Plus size={17} /> Nouveau prospect</Link></Button></div></div>
    <div className="crm-toolbar"><div className="crm-search"><Search size={17} /><input aria-label="Rechercher un prospect" placeholder="Entreprise, contact, téléphone…" value={searchText} onChange={e => setSearchText(e.target.value)} /></div><select aria-label="Filtrer par statut" value={filters.status ?? ''} onChange={e => patchFilters({ status: e.target.value as LeadStatus | '' })}><option value="">Tous les statuts</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="Filtrer par priorité" value={filters.priority ?? ''} onChange={e => patchFilters({ priority: e.target.value as LeadPriority | '' })}><option value="">Toutes priorités</option>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{manager && <select aria-label="Filtrer par commercial" value={filters.assignee ?? ''} onChange={e => patchFilters({ assignee: e.target.value, unassigned: e.target.value === '__none' })}><option value="">Tous les commerciaux</option><option value="__none">Non attribués</option>{sales.filter(person => person.role === 'sales_rep').map(person => <option key={person.id} value={person.id}>{person.full_name}</option>)}</select>}<div className="crm-view-switch"><button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')} aria-label="Vue tableau"><List size={17} /></button><button className={view === 'kanban' ? 'active' : ''} onClick={() => setView('kanban')} aria-label="Vue pipeline"><KanbanSquare size={17} /></button></div></div>
    {manager && selectedIds.length > 0 && <div className="crm-bulk"><strong>{selectedIds.length} sélectionné(s)</strong><UserRoundPlus size={16} /><select aria-label="Attribuer à" value={assignee} onChange={e => setAssignee(e.target.value)}><option value="">Non attribué</option>{sales.filter(person => person.role === 'sales_rep' && person.is_active).map(person => <option key={person.id} value={person.id}>{person.full_name}</option>)}</select><input aria-label="Motif d’attribution" placeholder="Motif (facultatif)" value={reason} onChange={e => setReason(e.target.value)} /><Button size="sm" onClick={() => void bulkAssign()} disabled={busy}>Appliquer</Button><button aria-label="Annuler la sélection" onClick={() => setSelectedIds([])}><X size={16} /></button></div>}
    {error && <div className="crm-alert" role="alert">{error}</div>}
    {loading ? <div className="crm-empty">Chargement des prospects…</div> : view === 'table' ? <>
      <div className="crm-table-wrap"><table className="crm-table"><thead><tr>{manager && <th><input type="checkbox" aria-label="Tout sélectionner sur cette page" checked={result.rows.length > 0 && selectedIds.length === result.rows.length} onChange={e => setSelectedIds(e.target.checked ? result.rows.map(item => item.id) : [])} /></th>}<th>Entreprise</th><th>Contact</th><th>Statut</th><th>Priorité</th><th>Commercial</th><th>Dernier échange</th><th>Prochaine relance</th><th /></tr></thead><tbody>{result.rows.map(lead => <tr key={lead.id}>{manager && <td><input type="checkbox" aria-label={`Sélectionner ${lead.company_name}`} checked={selectedIds.includes(lead.id)} onChange={e => setSelectedIds(old => e.target.checked ? [...old, lead.id] : old.filter(id => id !== lead.id))} /></td>}<td><Link to={`/prospects/${lead.id}`} className="crm-company"><span className="company-avatar">{lead.company_name.slice(0, 1).toUpperCase()}</span><span><strong>{lead.company_name}</strong><small>{[lead.industry, lead.city].filter(Boolean).join(' · ') || 'Informations à compléter'}</small></span></Link></td><td><strong>{lead.contact?.full_name ?? '—'}</strong><small>{lead.contact?.phone || lead.phone || 'Aucun numéro'}</small></td><td><Status value={lead.status} /></td><td><Priority value={lead.priority} /></td><td>{lead.assigned_name ?? 'Non attribué'}</td><td>{date(lead.last_activity_at)}</td><td>{date(lead.next_follow_up_at)}</td><td><Link to={`/prospects/${lead.id}`} aria-label={`Ouvrir ${lead.company_name}`}><ArrowRight size={16} /></Link></td></tr>)}</tbody></table>{result.rows.length === 0 && <div className="crm-empty">Aucun prospect ne correspond à cette recherche.</div>}</div>
      <div className="crm-pagination"><span>{result.total} prospect(s) accessibles</span><div><button disabled={(filters.page ?? 1) <= 1} onClick={() => setFilters(old => ({ ...old, page: (old.page ?? 1) - 1 }))}><ChevronLeft size={17} /></button><strong>{filters.page ?? 1} / {pageCount}</strong><button disabled={(filters.page ?? 1) >= pageCount} onClick={() => setFilters(old => ({ ...old, page: (old.page ?? 1) + 1 }))}><ChevronRight size={17} /></button></div></div>
    </> : <div className="crm-kanban" aria-label="Pipeline commercial">{pipelineStatuses.map(status => <section key={status} className="crm-kanban-col" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); const lead = Object.values(cards).flat().find(item => item.id === id); if (lead) void moveLead(lead, status) }}><header><span className={`kanban-dot kanban-${status}`} /><strong>{statusLabels[status]}</strong><small>{cards[status]?.length ?? 0}</small></header><div className="crm-kanban-list">{(cards[status] ?? []).map(lead => <article key={lead.id} draggable={!busy} onDragStart={e => e.dataTransfer.setData('text/plain', lead.id)} className="crm-kanban-card"><Link to={`/prospects/${lead.id}`}><strong>{lead.company_name}</strong><small>{lead.city || 'Ville non renseignée'}</small></Link><div><Priority value={lead.priority} /><span>{lead.assigned_name ?? 'Non attribué'}</span></div><small>Relance : {date(lead.next_follow_up_at)}</small><select aria-label={`Changer le statut de ${lead.company_name}`} value={lead.status} disabled={busy} onChange={e => void moveLead(lead, e.target.value as LeadStatus)}>{pipelineStatuses.map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></article>)}</div></section>)}</div>}
  </div>
}

export function LeadEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const manager = profile?.role === 'admin' || profile?.role === 'sales_manager'
  const [sales, setSales] = useState<SalesProfile[]>([])
  const [form, setForm] = useState<LeadInput>({ company_name: '', priority: 'normal' })
  const [loading, setLoading] = useState(Boolean(id))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!id) return
    getLead(id).then(lead => setForm({ company_name: lead.company_name, industry: lead.industry ?? '', city: lead.city ?? '', neighborhood: lead.neighborhood ?? '', address: lead.address ?? '', company_email: lead.company_email ?? '', phone: lead.phone ?? '', website: lead.website ?? '', has_website: lead.has_website, contact_id: lead.contact?.id, contact_name: lead.contact?.full_name ?? '', contact_title: lead.contact?.job_title ?? '', contact_phone: lead.contact?.phone ?? '', whatsapp: lead.contact?.whatsapp ?? '', email: lead.contact?.email ?? '', identified_need: lead.identified_need ?? '', interested_offer: lead.interested_offer ?? '', source: lead.source ?? '', priority: lead.priority, notes: lead.notes ?? '' })).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [id])
  useEffect(() => { if (manager) getSalesProfiles().then(setSales).catch(() => {}) }, [manager])
  function field(key: keyof LeadInput, label: string, required = false, type = 'text') { return <label className="crm-field">{label}<input type={type} required={required} value={(form[key] as string) ?? ''} onChange={e => setForm(old => ({ ...old, [key]: e.target.value }))} /></label> }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null)
    try { const saved = await saveLead(id ?? null, form); navigate(`/prospects/${saved}`) }
    catch (e) { setError(e instanceof Error ? e.message : 'Enregistrement impossible.') }
    finally { setBusy(false) }
  }
  return <div className="crm-page"><Link className="crm-back" to={id ? `/prospects/${id}` : '/prospects'}><ArrowLeft size={16} /> Prospects</Link><div className="crm-page-head"><div><span className="section-kicker">CRM / FICHE</span><h1>{id ? 'Modifier le prospect' : 'Nouveau prospect'}</h1><p>Commencez par le nom de l’entreprise. Les autres informations peuvent être ajoutées plus tard.</p></div></div>{loading ? <div className="crm-empty">Chargement…</div> : <form className="crm-form" onSubmit={e => void submit(e)}><div className="crm-form-section"><h2>Entreprise</h2><div className="crm-form-grid">{field('company_name', 'Nom de l’entreprise *', true)}{field('industry', 'Secteur d’activité')}{field('city', 'Ville')}{field('neighborhood', 'Quartier')}{field('address', 'Adresse')}{field('phone', 'Téléphone')}{field('company_email', 'Email professionnel', false, 'email')}<label className="crm-field">Présence d’un site web<select value={form.has_website === null || form.has_website === undefined ? '' : String(form.has_website)} onChange={e => setForm(old => ({ ...old, has_website: e.target.value === '' ? null : e.target.value === 'true' }))}><option value="">Non renseigné</option><option value="true">Oui</option><option value="false">Non</option></select></label>{field('website', 'Site web existant', false, 'url')}</div></div><div className="crm-form-section"><h2>Contact principal</h2><div className="crm-form-grid">{field('contact_name', 'Nom du contact')}{field('contact_title', 'Fonction')}{field('contact_phone', 'Téléphone du contact')}{field('whatsapp', 'WhatsApp')}{field('email', 'Email du contact', false, 'email')}</div></div><div className="crm-form-section"><h2>Suivi commercial</h2><div className="crm-form-grid">{field('source', 'Source du prospect')}{field('interested_offer', 'Offre susceptible d’intéresser')}{field('identified_need', 'Besoin identifié')}<label className="crm-field">Priorité<select value={form.priority ?? 'normal'} onChange={e => setForm(old => ({ ...old, priority: e.target.value as LeadPriority }))}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{!id && manager && <label className="crm-field">Commercial responsable<select value={form.assigned_to ?? ''} onChange={e => setForm(old => ({ ...old, assigned_to: e.target.value }))}><option value="">Moi-même</option>{sales.filter(person => person.role === 'sales_rep' && person.is_active).map(person => <option key={person.id} value={person.id}>{person.full_name}</option>)}</select></label>}<label className="crm-field crm-field-wide">Notes<textarea rows={4} value={form.notes ?? ''} onChange={e => setForm(old => ({ ...old, notes: e.target.value }))} /></label></div></div>{error && <div className="crm-alert" role="alert">{error}</div>}<div className="crm-form-actions"><Button variant="secondary" asChild><Link to={id ? `/prospects/${id}` : '/prospects'}>Annuler</Link></Button><Button type="submit" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer le prospect'}</Button></div></form>}</div>
}
