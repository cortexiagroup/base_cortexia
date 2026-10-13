import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, BadgePercent, ShieldCheck } from 'lucide-react'
import { Button } from '../components/ui/button'
import { useAuth } from '../lib/auth'
import { getSalesProfiles } from '../crm/api'
import type { SalesProfile } from '../crm/types'
import { getFinanceOrders } from '../payments/api'
import type { Order } from '../commercial/types'
import { xofAmount } from '../commercial/types'
import { approveCommission, commissionData, publishCommissionPolicy, recalculateCommission,
  recordCommissionPayout, uploadFieldProof } from './api'
import { sumXof } from './types'

const today = () => new Date().toISOString().slice(0,10)
const nowInput = () => new Date().toISOString().slice(0,16)
const when = (value:string) => new Intl.DateTimeFormat('fr-TG',{dateStyle:'medium',timeZone:'Africa/Lome'}).format(new Date(value))

export function CommissionPage() {
  const { profile } = useAuth()
  const [data,setData] = useState<Awaited<ReturnType<typeof commissionData>>|null>(null)
  const [orders,setOrders] = useState<Order[]>([])
  const [sales,setSales] = useState<SalesProfile[]>([])
  const [refresh,setRefresh] = useState(0)
  const [error,setError] = useState<string|null>(null)
  const [message,setMessage] = useState<string|null>(null)
  const [busy,setBusy] = useState(false)
  const [name,setName] = useState('Commission sur encaissements')
  const [effective,setEffective] = useState(today)
  const [basis,setBasis] = useState<'confirmed_collected_amount'|'fixed_per_sale'|'gross_margin'>('confirmed_collected_amount')
  const [vesting,setVesting] = useState<'progressive'|'full_collection'>('full_collection')
  const [rate,setRate] = useState('')
  const [fixed,setFixed] = useState('')
  const [scopeRep,setScopeRep] = useState('')
  const [scopeOffer,setScopeOffer] = useState('')
  const [approveAmount,setApproveAmount] = useState<Record<string,string>>({})
  const [payAmount,setPayAmount] = useState<Record<string,string>>({})
  const [payMethod,setPayMethod] = useState<Record<string,string>>({})
  const [payRef,setPayRef] = useState<Record<string,string>>({})
  const [payDate,setPayDate] = useState(nowInput)
  const [payProof,setPayProof] = useState<Record<string,File|null>>({})
  useEffect(() => { Promise.all([commissionData(),getFinanceOrders(),getSalesProfiles()])
    .then(([c,o,s])=>{setData(c);setOrders(o);setSales(s)})
    .catch(e=>setError(e.message)) },[refresh])
  const orderMap = useMemo(()=>Object.fromEntries(orders.map(item=>[item.id,item])),[orders])
  const policyMap = useMemo(()=>Object.fromEntries((data?.policies??[]).map(item=>[item.id,item])),[data?.policies])
  const paid = (id:string) => sumXof((data?.payouts??[]).filter(item=>item.position_id===id))
  const totalAcquired = (data?.positions??[]).reduce((sum,item)=>sum+Number(item.acquired_xof),0)
  const totalApproved = (data?.positions??[]).reduce((sum,item)=>sum+Number(item.approved_xof),0)
  const totalPaid = sumXof(data?.payouts??[])
  const totalPayable = (data?.positions??[]).reduce((sum,item)=>sum+Math.max(0,Math.min(item.approved_xof,item.acquired_xof)-paid(item.id)),0)
  const repName = (id:string) => sales.find(item=>item.id===id)?.full_name??id.slice(0,8)
  async function run(action:()=>Promise<unknown>,success:string) {
    setBusy(true);setError(null);setMessage(null)
    try {await action();setMessage(success);setRefresh(value=>value+1)}
    catch(e){setError(e instanceof Error?e.message:'Opération impossible.')}
    finally{setBusy(false)}
  }
  async function publish(event:FormEvent) {
    event.preventDefault()
    await run(()=>publishCommissionPolicy({name,effective_from:effective,basis,vesting,
      rate_bps:basis==='fixed_per_sale'?null:Math.round(Number(rate)*100),
      fixed_amount_xof:basis==='fixed_per_sale'?Number(fixed):null,
      sales_rep_id:scopeRep||null,offer_template_id:scopeOffer||null,
      refund_rule:'recalculate'}),'Politique publiée. Aucune commission n’est versée automatiquement.')
  }
  async function payout(id:string) {
    let proofPath:string|null=null
    setBusy(true);setError(null);setMessage(null)
    try {
      const file=payProof[id]
      if(file) proofPath=await uploadFieldProof('commission_payout',id,file)
      await recordCommissionPayout(id,Number(payAmount[id]),new Date(payDate).toISOString(),
        payMethod[id]??'',payRef[id]??'',proofPath)
      setMessage('Versement effectif enregistré séparément de l’approbation.');setRefresh(value=>value+1)
    } catch(e){setError(e instanceof Error?e.message:'Versement non enregistré.')}
    finally{setBusy(false)}
  }
  return <div className="crm-page field-page"><Link to="/depenses" className="crm-back"><ArrowLeft size={15}/> Dépenses</Link>
    <div className="crm-page-head"><div><span className="section-kicker">RÉMUNÉRATION / CONDITIONS VÉRIFIÉES</span><h1>Commissions</h1><p>Une commission calculée ou approuvée n’est pas un versement. Le calcul utilise le journal des encaissements vérifiés.</p></div><Link className="crm-quick-link" to="/rapports">Voir les performances <ArrowRight size={15}/></Link></div>
    {error&&<div className="crm-alert" role="alert">{error}</div>}{message&&<div className="finance-success" role="status">{message}</div>}
    {!data?<div className="crm-empty">Chargement des commissions autorisées…</div>:<>
      <div className="field-kpis"><div><span>Acquises selon politique</span><strong>{xofAmount(totalAcquired)}</strong></div><div><span>Approuvées</span><strong>{xofAmount(totalApproved)}</strong></div><div><span>Payables maintenant</span><strong>{xofAmount(totalPayable)}</strong></div><div><span>Réellement versées</span><strong>{xofAmount(totalPaid)}</strong></div></div>
      <div className="field-two-col"><div><section className="crm-section"><h2>Positions par commande</h2>{data.positions.length===0&&<p>Aucune commission calculée. Une politique explicite et des encaissements confirmés sont nécessaires.</p>}{data.positions.map(item=>{const order=orderMap[item.order_id];const policy=policyMap[item.policy_id];const paidAmount=paid(item.id);const payable=Math.max(0,Math.min(item.approved_xof,item.acquired_xof)-paidAmount);return <div className="field-commission" key={item.id}><div className="field-row"><div><strong>{order?.order_number??item.order_id.slice(0,8)} · {repName(item.sales_rep_id)}</strong><small>{policy?.name??'Politique conservée'} · calculé le {when(item.calculated_at)}</small></div><BadgePercent size={18}/></div><div className="field-money-line"><span>Base {xofAmount(item.eligible_base_xof)}</span><span>Acquise {xofAmount(item.acquired_xof)}</span><span>Approuvée {xofAmount(item.approved_xof)}</span><span>Versée {xofAmount(paidAmount)}</span></div><p className="commercial-note">Reste payable : {xofAmount(payable)}{paidAmount>item.acquired_xof?' · versement antérieur supérieur à la commission actuelle : revue manuelle requise':''}</p>{profile?.role==='admin'&&<><div className="field-review"><input aria-label="Montant de commission approuvé" type="number" min="0" max={item.acquired_xof} placeholder="Montant à approuver" value={approveAmount[item.id]??String(item.acquired_xof)} onChange={e=>setApproveAmount({...approveAmount,[item.id]:e.target.value})}/><Button size="sm" variant="secondary" disabled={busy} onClick={()=>void run(()=>approveCommission(item.id,Number(approveAmount[item.id]??item.acquired_xof)),'Commission approuvée, non encore versée.')}><ShieldCheck size={14}/> Approuver</Button></div>{payable>0&&<div className="field-review field-payout"><input aria-label="Montant versé" type="number" min="1" max={payable} placeholder="Montant versé" value={payAmount[item.id]??''} onChange={e=>setPayAmount({...payAmount,[item.id]:e.target.value})}/><input aria-label="Moyen de versement" placeholder="Moyen" value={payMethod[item.id]??''} onChange={e=>setPayMethod({...payMethod,[item.id]:e.target.value})}/><input aria-label="Référence de versement" placeholder="Référence externe" value={payRef[item.id]??''} onChange={e=>setPayRef({...payRef,[item.id]:e.target.value})}/><label className="crm-field">Preuve facultative<input type="file" accept="application/pdf,image/png,image/jpeg" onChange={e=>setPayProof({...payProof,[item.id]:e.target.files?.[0]??null})}/></label><Button size="sm" disabled={busy||!Number(payAmount[item.id])||!(payMethod[item.id]??'').trim()||!(payRef[item.id]??'').trim()} onClick={()=>void payout(item.id)}>Consigner le versement</Button></div>}</>}</div>})}</section></div>
      <aside>{profile?.role==='admin'&&<><section className="crm-section"><h2>Calculer depuis une commande</h2><p>Le recalcul conserve la politique capturée lors du premier calcul. Un remboursement client diminue l’acquis, sans effacer les versements antérieurs.</p>{orders.filter(item=>['confirmed','in_progress','completed'].includes(item.order_status)).map(item=><div className="field-row" key={item.id}><strong>{item.order_number}</strong><span>{xofAmount(item.amount_xof)}</span><Button size="sm" variant="secondary" disabled={busy} onClick={()=>void run(()=>recalculateCommission(item.id),'Position recalculée depuis le journal vérifié.')}>Calculer</Button></div>)}</section><section className="crm-section"><h2>Publier une règle</h2><p>Aucun taux n’est actif par défaut. Une nouvelle version ne modifie pas les positions déjà établies.</p><form className="field-form" onSubmit={e=>void publish(e)}><label className="crm-field field-wide">Nom<input required value={name} onChange={e=>setName(e.target.value)}/></label><label className="crm-field">Prise d’effet<input type="date" required value={effective} onChange={e=>setEffective(e.target.value)}/></label><label className="crm-field">Base<select value={basis} onChange={e=>setBasis(e.target.value as typeof basis)}><option value="confirmed_collected_amount">Encaissements confirmés</option><option value="fixed_per_sale">Montant fixe par vente</option><option value="gross_margin">Marge brute — calcul suspendu sans coûts</option></select></label><label className="crm-field">Acquisition<select value={vesting} onChange={e=>setVesting(e.target.value as typeof vesting)}><option value="full_collection">Après encaissement complet</option><option value="progressive">Au fil des encaissements</option></select></label>{basis==='fixed_per_sale'?<label className="crm-field">Montant fixe FCFA<input type="number" min="0" required value={fixed} onChange={e=>setFixed(e.target.value)}/></label>:<label className="crm-field">Taux %<input type="number" min="0" max="100" step="0.01" required value={rate} onChange={e=>setRate(e.target.value)}/></label>}<label className="crm-field">Commercial concerné<select value={scopeRep} onChange={e=>setScopeRep(e.target.value)}><option value="">Tous</option>{sales.filter(item=>item.role==='sales_rep').map(item=><option key={item.id} value={item.id}>{item.full_name}</option>)}</select></label><label className="crm-field">Offre concernée<select value={scopeOffer} onChange={e=>setScopeOffer(e.target.value)}><option value="">Toutes</option>{[...new Map(orders.map(item=>[item.offer_template_id,{id:item.offer_template_id,name:String(item.offer_snapshot.name??'Offre')}])).values()].map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><Button type="submit" disabled={busy}>Publier la politique</Button></form>{basis==='gross_margin'&&<p className="crm-hint">La politique peut être consignée, mais le calcul refusera une marge sans coûts directs et revenu reconnu fiables.</p>}</section></>}
      <section className="crm-section"><h2>Politiques publiées</h2>{data.policies.length===0&&<p>Aucune politique. Il n’y a aucune commission automatique.</p>}{data.policies.map(item=><div className="field-row" key={item.id}><div><strong>V{item.version_no} · {item.name}</strong><small>Depuis le {when(item.effective_from)} · {item.vesting==='full_collection'?'encaissement complet':'progressif'}</small></div><b>{item.rate_bps!=null?`${item.rate_bps/100} %`:xofAmount(item.fixed_amount_xof??0)}</b></div>)}</section></aside></div>
      {profile?.role==='admin'&&<section className="crm-section"><h2>Versements enregistrés</h2>{data.payouts.length===0&&<p>Aucun versement de commission enregistré.</p>}{data.payouts.map(item=><div className="field-row" key={item.id}><div><strong>{xofAmount(item.amount_xof)}</strong><small>{when(item.paid_at)} · {item.method} · {item.external_reference}</small></div></div>)}<label className="crm-field">Date de versement à consigner<input type="datetime-local" value={payDate} onChange={e=>setPayDate(e.target.value)}/></label></section>}
      <p className="commercial-note">Aucune déduction automatique n’est appliquée sur la rémunération. Les contrats et la conformité locale doivent être validés avant versement réel. Arrondi des commissions au FCFA le plus proche.</p>
    </>}
  </div>
}
