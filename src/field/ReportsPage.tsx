import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Download } from 'lucide-react'
import { Button } from '../components/ui/button'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { getSalesProfiles } from '../crm/api'
import { protectExcelText } from '../crm/excel'
import type { SalesProfile } from '../crm/types'
import { getFinanceOrders, getLedger } from '../payments/api'
import { xofAmount, type Order } from '../commercial/types'
import { commissionData, fieldData } from './api'
import { sumXof } from './types'

interface LeadRow { id:string; assigned_to:string|null; status:string; source:string|null; created_at:string; converted_at:string|null }
interface ActivityRow { id:string; author_id:string; activity_type:string; occurred_at:string; lead_id:string }
interface MeetingRow { id:string; sales_rep_id:string; kind:string; status:string; scheduled_at:string; completed_at:string|null }
interface ProposalRow { id:string; sales_rep_id:string; status:string; sent_at:string|null }
function db() { if(!supabase) throw new Error('Connexion Supabase non configurée.');return supabase }
async function all<T>(table:string):Promise<T[]> {
  const result:T[]=[]
  for(let from=0;;from+=500) {
    const {data,error}=await db().from(table).select('*').range(from,from+499)
    if(error) throw new Error(error.message)
    result.push(...(data??[]) as T[])
    if((data??[]).length<500)break
  }
  return result
}
const inPeriod=(date:string|null|undefined,from:string,to:string) => Boolean(date&&date.slice(0,10)>=from&&date.slice(0,10)<=to)

export function ReportsPage() {
  const {profile}=useAuth()
  const [sales,setSales]=useState<SalesProfile[]>([])
  const [leads,setLeads]=useState<LeadRow[]>([])
  const [activities,setActivities]=useState<ActivityRow[]>([])
  const [meetings,setMeetings]=useState<MeetingRow[]>([])
  const [proposals,setProposals]=useState<ProposalRow[]>([])
  const [orders,setOrders]=useState<Order[]>([])
  const [ledger,setLedger]=useState<Awaited<ReturnType<typeof getLedger>>>([])
  const [field,setField]=useState<Awaited<ReturnType<typeof fieldData>>|null>(null)
  const [commissions,setCommissions]=useState<Awaited<ReturnType<typeof commissionData>>|null>(null)
  const [from,setFrom]=useState(()=>`${new Date().getFullYear()}-01-01`)
  const [to,setTo]=useState(()=>new Date().toISOString().slice(0,10))
  const [rep,setRep]=useState('')
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState<string|null>(null)
  useEffect(()=>{Promise.all([getSalesProfiles(),all<LeadRow>('leads'),all<ActivityRow>('activities'),
    all<MeetingRow>('appointments'),all<ProposalRow>('commercial_proposals'),getFinanceOrders(),
    getLedger(),fieldData(),commissionData()]).then(([s,l,a,m,p,o,j,f,c])=>{
      setSales(s);setLeads(l);setActivities(a);setMeetings(m);setProposals(p)
      setOrders(o);setLedger(j);setField(f);setCommissions(c)
    }).catch(e=>setError(e.message)).finally(()=>setLoading(false))},[])
  const rows=useMemo(()=>{
    const reps=sales.filter(item=>item.role==='sales_rep'&&(!rep||item.id===rep)&&
      (profile?.role!=='sales_rep'||item.id===profile.id))
    return reps.map(person=>{
      const ownLeads=leads.filter(item=>item.assigned_to===person.id&&inPeriod(item.created_at,from,to))
      const converted=ownLeads.filter(item=>item.converted_at&&item.converted_at.slice(0,10)<=to)
      const ownActivities=activities.filter(item=>item.author_id===person.id&&inPeriod(item.occurred_at,from,to))
      const ownMeetings=meetings.filter(item=>item.sales_rep_id===person.id&&inPeriod(item.scheduled_at,from,to))
      const ownOrders=orders.filter(item=>item.sales_rep_id===person.id&&
        ['confirmed','in_progress','completed'].includes(item.order_status)&&inPeriod(item.confirmed_at??item.ordered_at,from,to))
      const orderIds=new Set(orders.filter(item=>item.sales_rep_id===person.id).map(item=>item.id))
      const collected=ledger.filter(item=>orderIds.has(item.order_id)&&inPeriod(item.recorded_at,from,to))
        .reduce((sum,item)=>sum+Number(item.amount_xof),0)
      const costs=(field?.expenses??[]).filter(item=>item.sales_rep_id===person.id&&
        ['approved','regularized'].includes(item.status)&&inPeriod(item.incurred_at,from,to))
      const positions=(commissions?.positions??[]).filter(item=>item.sales_rep_id===person.id)
      const positionIds=new Set(positions.map(item=>item.id))
      const paidCommissions=(commissions?.payouts??[]).filter(item=>positionIds.has(item.position_id)&&inPeriod(item.paid_at,from,to))
      const acquiredCommissions=positions.filter(item=>inPeriod(item.calculated_at,from,to))
        .reduce((sum,item)=>sum+Number(item.acquired_xof),0)
      const confirmedClients=new Set(ownOrders.map(item=>item.company_id)).size
      const acquisitionCost=sumXof(costs)+sumXof(paidCommissions)
      return {person,assigned:ownLeads.length,contacted:new Set(ownActivities.filter(item=>['call','message','visit'].includes(item.activity_type)).map(item=>item.lead_id)).size,
        qualified:ownLeads.filter(item=>['qualified','meeting','demo','proposal','won'].includes(item.status)).length,
        meetingsPlanned:ownMeetings.filter(item=>item.kind==='meeting'&&item.status!=='cancelled').length,
        meetingsDone:ownMeetings.filter(item=>item.kind==='meeting'&&item.status==='completed').length,
        demos:ownMeetings.filter(item=>item.kind==='demo'&&item.status==='completed').length,
        proposalsSent:proposals.filter(item=>item.sales_rep_id===person.id&&inPeriod(item.sent_at,from,to)).length,
        orders:ownOrders.length,converted:converted.length,clients:confirmedClients,collected,
        communication:sumXof(costs.filter(item=>item.category==='communication')),
        transport:sumXof(costs.filter(item=>item.category==='transport')),
        other:sumXof(costs.filter(item=>item.category==='other')),
        expenseCost:sumXof(costs),acquiredCommissions,paidCommissions:sumXof(paidCommissions),
        acquisitionCost,cac:confirmedClients>0?Math.round(acquisitionCost/confirmedClients):null,
        meetingCost:ownMeetings.some(item=>item.kind==='meeting'&&item.status==='completed')?
          Math.round(acquisitionCost/ownMeetings.filter(item=>item.kind==='meeting'&&item.status==='completed').length):null,
        conversion:ownLeads.length>0?Math.round(converted.length/ownLeads.length*100):null}
    })
  },[sales,rep,leads,activities,meetings,proposals,orders,ledger,field,commissions,from,to,profile?.id,profile?.role])
  const totals={expenses:rows.reduce((sum,row)=>sum+row.expenseCost,0),
    collected:rows.reduce((sum,row)=>sum+row.collected,0),
    commissions:rows.reduce((sum,row)=>sum+row.acquiredCommissions,0),
    clients:rows.reduce((sum,row)=>sum+row.clients,0)}
  async function exportReport() {
    try { const {default:writeExcelFile}=await import('write-excel-file/browser')
      const header=['Commercial','Prospects attribués','Contactés','RDV réalisés','Démos','Propositions envoyées',
        'Commandes','Encaissements nets FCFA','Communication FCFA','Transport FCFA','Autres dépenses FCFA',
        'Commissions acquises FCFA','Commissions versées FCFA','CAC partiel FCFA']
      const data=rows.map(row=>[protectExcelText(row.person.full_name),row.assigned,row.contacted,row.meetingsDone,row.demos,
        row.proposalsSent,row.orders,row.collected,row.communication,row.transport,row.other,row.acquiredCommissions,
        row.paidCommissions,row.cac??'Données insuffisantes'])
      await writeExcelFile([{sheet:'Performance autorisée',data:[header,...data]}])
        .toFile(`cortexia-performance-${from}-${to}.xlsx`)
    } catch(e){setError(e instanceof Error?e.message:'Export impossible.')} }
  return <div className="crm-page field-page"><Link className="crm-back" to="/depenses"><ArrowLeft size={15}/> Dépenses</Link>
    <div className="crm-page-head"><div><span className="section-kicker">ANALYSE / DONNÉES AUTORISÉES</span><h1>Performance commerciale</h1><p>Activité, ventes, encaissements et coûts sont présentés séparément.</p></div>{profile?.role!=='sales_rep'&&<Button variant="secondary" onClick={()=>void exportReport()}><Download size={15}/> Exporter Excel</Button>}</div>
    {error&&<div className="crm-alert" role="alert">{error}</div>}
    <div className="crm-toolbar finance-toolbar"><label>Du <input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Au <input type="date" min={from} value={to} onChange={e=>setTo(e.target.value)}/></label>{profile?.role!=='sales_rep'&&<select aria-label="Commercial" value={rep} onChange={e=>setRep(e.target.value)}><option value="">Tous les commerciaux accessibles</option>{sales.filter(item=>item.role==='sales_rep').map(item=><option key={item.id} value={item.id}>{item.full_name}</option>)}</select>}</div>
    {loading?<div className="crm-empty">Calcul des indicateurs…</div>:<><div className="field-kpis"><div><span>Encaissement net vérifié</span><strong>{xofAmount(totals.collected)}</strong></div><div><span>Dépenses justifiées</span><strong>{xofAmount(totals.expenses)}</strong></div><div><span>Commissions acquises</span><strong>{xofAmount(totals.commissions)}</strong></div><div><span>Clients avec commande confirmée</span><strong>{totals.clients}</strong></div></div>
      <section className="crm-section"><h2>Par commercial</h2><div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Commercial</th><th>Prospects</th><th>Contactés</th><th>RDV réalisés</th><th>Démos</th><th>Propositions</th><th>Commandes</th><th>Encaissé net</th><th>Dépenses justifiées</th><th>Commissions acquises*</th><th>CAC partiel</th></tr></thead><tbody>{rows.map(row=><tr key={row.person.id}><td><strong>{row.person.full_name}</strong></td><td>{row.assigned}</td><td>{row.contacted}</td><td>{row.meetingsDone}</td><td>{row.demos}</td><td>{row.proposalsSent}</td><td>{row.orders}</td><td>{xofAmount(row.collected)}</td><td>{xofAmount(row.expenseCost)}</td><td>{xofAmount(row.acquiredCommissions)}</td><td>{row.cac==null?'Données insuffisantes':xofAmount(row.cac)}</td></tr>)}</tbody></table></div>{rows.length===0&&<div className="crm-empty">Aucun commercial accessible.</div>}<p className="commercial-note">* Cumul actuel des positions recalculées dans la période, pas une charge comptable périodique.</p></section>
      <div className="field-two-col"><section className="crm-section"><h2>Coût de prospection observé</h2><p>Dépenses approuvées de transport, communication et autres frais : {xofAmount(totals.expenses)}. Les avances versées ne s’ajoutent pas à ces dépenses.</p><p>Le CAC affiché par commercial est partiel : (dépenses justifiées + commissions effectivement versées dans la période) / entreprises ayant une commande confirmée dans la période. Salaires et frais non attribués exclus. Ne pas l’interpréter comme un coût complet.</p></section><section className="crm-section"><h2>Rentabilité et marge</h2><p>Données insuffisantes. Les coûts directs de production et une règle de reconnaissance du revenu ne sont pas encore saisis ; aucun chiffre de marge brute ni de bénéfice net n’est calculé.</p><p>L’encaissement net vérifié est une mesure de trésorerie, pas un revenu comptable reconnu.</p></section></div>
    </>}
  </div>
}
