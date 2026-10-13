import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Banknote, CircleCheck, FileUp, RotateCcw, ShieldCheck, WalletCards } from 'lucide-react'
import { Button } from '../components/ui/button'
import { useAuth } from '../lib/auth'
import { getSalesProfiles } from '../crm/api'
import type { SalesProfile } from '../crm/types'
import { xofAmount } from '../commercial/types'
import { advanceBalance, sumXof, type FieldAdvance, type FieldBudget } from './types'
import { approveAdvance, closeAdvance, createFieldBudget, declareRestitution, disburseAdvance,
  fieldData, fieldProofUrl, payReimbursement, publishFieldPolicy, requestAdvance,
  reviewFieldExpense, setBudgetPermission, submitFieldExpense, uploadFieldProof,
  verifyRestitution } from './api'

const today = () => new Date().toISOString().slice(0, 10)
const plusDays = (days:number) => { const date=new Date();date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10) }
const dateTime = () => new Date().toISOString().slice(0, 16)
const when = (input?: string | null) => input ? new Intl.DateTimeFormat('fr-TG', { dateStyle: 'medium', timeZone: 'Africa/Lome' }).format(new Date(input)) : '—'
const status: Record<string,string> = { approved:'Approuvé',active:'Actif',closed:'Clôturé',requested:'Demandée',
  disbursed:'Versée',submitted:'Soumise',needs_info:'Précisions demandées',rejected:'Rejetée',verified:'Vérifiée',
  declared:'Déclarée',regularized:'Régularisée' }

export function FieldFinancePage() {
  const { profile } = useAuth()
  const [data,setData] = useState<Awaited<ReturnType<typeof fieldData>> | null>(null)
  const [sales,setSales] = useState<SalesProfile[]>([])
  const [tab,setTab] = useState<'overview'|'budgets'|'expenses'|'regularize'|'settings'>('overview')
  const [refresh,setRefresh] = useState(0)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState<string|null>(null)
  const [message,setMessage] = useState<string|null>(null)
  const [budgetRep,setBudgetRep] = useState('')
  const [budgetKind,setBudgetKind] = useState<'startup'|'transport'|'other'>('transport')
  const [budgetAmount,setBudgetAmount] = useState('')
  const [budgetStart,setBudgetStart] = useState(today)
  const [budgetEnd,setBudgetEnd] = useState(()=>plusDays(30))
  const [budgetPurpose,setBudgetPurpose] = useState('')
  const [budgetZone,setBudgetZone] = useState('')
  const [budgetException,setBudgetException] = useState('')
  const [budgetExceptionReason,setBudgetExceptionReason] = useState('')
  const [transferAmount,setTransferAmount] = useState<Record<string,string>>({})
  const [transferMethod,setTransferMethod] = useState<Record<string,string>>({})
  const [transferRef,setTransferRef] = useState<Record<string,string>>({})
  const [expenseBudget,setExpenseBudget] = useState('')
  const [expenseCategory,setExpenseCategory] = useState<'communication'|'transport'|'other'>('transport')
  const [expenseSource,setExpenseSource] = useState<'advance'|'personal'|'company'>('advance')
  const [expenseAmount,setExpenseAmount] = useState('')
  const [expenseDate,setExpenseDate] = useState(dateTime)
  const [expenseDescription,setExpenseDescription] = useState('')
  const [expenseZone,setExpenseZone] = useState('')
  const [expenseMode,setExpenseMode] = useState('')
  const [expensePeriod,setExpensePeriod] = useState(today)
  const [expenseProof,setExpenseProof] = useState<File|null>(null)
  const [reviewReason,setReviewReason] = useState<Record<string,string>>({})
  const [returnAmount,setReturnAmount] = useState<Record<string,string>>({})
  const [returnRef,setReturnRef] = useState<Record<string,string>>({})
  const [policyStart,setPolicyStart] = useState(()=>plusDays(1))
  const [policyInitial,setPolicyInitial] = useState('5000')
  const [policyCommunication,setPolicyCommunication] = useState('500')
  const [policyInterval,setPolicyInterval] = useState('3')

  useEffect(() => { Promise.all([fieldData(),getSalesProfiles()]).then(([d,s]) => {
    setData(d); setSales(s); if (!budgetRep) setBudgetRep(s.find(item => item.role==='sales_rep' && item.is_active)?.id ?? '')
  }).catch(e => setError(e.message)) }, [refresh,profile?.id])

  const canManage = profile?.role==='admin' || (profile?.role==='sales_manager' &&
    data?.permissions.some(item => item.user_id===profile.id && item.enabled))
  const repName = (id:string) => sales.find(item => item.id===id)?.full_name ?? id.slice(0,8)
  const budgets = data?.budgets ?? []
  const advances = data?.advances ?? []
  const expenses = data?.expenses ?? []
  const restitutions = data?.restitutions ?? []
  const currentPolicy = [...(data?.policies ?? [])].filter(item => item.effective_from<=today())
    .sort((a,b) => b.effective_from.localeCompare(a.effective_from))[0]
  const myBudgets = budgets.filter(item => item.sales_rep_id===profile?.id && ['approved','active'].includes(item.status))
  const eligibleAdvance = advances.find(item => item.budget_id===expenseBudget && item.status==='disbursed')
  const periodEnd = useMemo(() => { const date = new Date(`${expensePeriod}T12:00:00Z`)
    date.setUTCDate(date.getUTCDate()+(currentPolicy?.communication_interval_days ?? 3)-1)
    return date.toISOString().slice(0,10) }, [expensePeriod,currentPolicy?.communication_interval_days])
  const startupPaid = advances.filter(item => ['disbursed','closed'].includes(item.status) &&
    budgets.find(budget => budget.id===item.budget_id)?.kind==='startup')
  const transportBudgets = budgets.filter(item => item.kind==='transport' && item.status!=='cancelled')
  const transportPaid = advances.filter(item => ['disbursed','closed'].includes(item.status) &&
    budgets.find(budget => budget.id===item.budget_id)?.kind==='transport')
  const justified = expenses.filter(item => ['approved','regularized'].includes(item.status))
  const openAdvances = advances.filter(item => item.status==='disbursed')
  const kpis = [
    ['Dotation initiale versée',xofAmount(startupPaid.reduce((n,item) => n+Number(item.disbursed_xof??0),0))],
    ['Communication consommée',xofAmount(sumXof(justified.filter(item => item.category==='communication')))],
    ['Transport ultérieur autorisé',xofAmount(transportBudgets.reduce((n,item) => n+Number(item.authorized_xof),0))],
    ['Transport effectivement financé',xofAmount(transportPaid.reduce((n,item) => n+Number(item.disbursed_xof??0),0))],
    ['Dépenses justifiées',xofAmount(sumXof(justified))],
    ['Avances à régulariser',xofAmount(openAdvances.reduce((n,item) => n+advanceBalance(item,expenses,restitutions).toRegularize,0))],
  ]
  async function run(action:()=>Promise<unknown>,success:string) {
    setBusy(true); setError(null); setMessage(null)
    try { await action(); setMessage(success); setRefresh(value=>value+1) }
    catch (e) { setError(e instanceof Error?e.message:'Opération impossible.') }
    finally { setBusy(false) }
  }
  function openProof(path:string) {
    const tab=window.open('','_blank'); if (!tab) { setError('Autorisez les nouveaux onglets.'); return }
    void fieldProofUrl(path).then(url => { tab.opener=null; tab.location.href=url })
      .catch(e => { tab.close(); setError(e.message) })
  }
  async function createBudget(event:FormEvent) {
    event.preventDefault()
    await run(() => createFieldBudget({rep:budgetRep,kind:budgetKind,
      amount:budgetKind==='startup'&&!budgetAmount?null:Number(budgetAmount),
      start:budgetStart,end:budgetEnd,purpose:budgetPurpose,zone:budgetZone,
      exceptionOf:budgetException||null,exceptionReason:budgetExceptionReason||null}),
      'Budget autorisé. Aucun fonds n’a encore été versé.')
  }
  async function submitExpense(event:FormEvent) {
    event.preventDefault()
    let id:string|null=null
    setBusy(true);setError(null);setMessage(null)
    try {
      id=await submitFieldExpense({budget:expenseBudget,category:expenseCategory,source:expenseSource,
        amount:Number(expenseAmount),date:new Date(expenseDate).toISOString(),description:expenseDescription,
        advance:expenseSource==='advance'?eligibleAdvance?.id??null:null,
        start:expenseCategory==='communication'?expensePeriod:null,
        end:expenseCategory==='communication'?periodEnd:null,
        zone:expenseCategory==='transport'?expenseZone:null,
        transportMode:expenseCategory==='transport'?expenseMode:null,
        phone:null,reference:null,lead:null})
      if (expenseProof) await uploadFieldProof('expense',id,expenseProof)
      setMessage('Dépense soumise. Elle ne sera justifiée qu’après validation.')
      setExpenseAmount('');setExpenseDescription('');setExpenseProof(null);setRefresh(value=>value+1)
    } catch(e) { setError(id?`Dépense ${id} soumise, mais justificatif non lié : ${e instanceof Error?e.message:'erreur'}`:
      e instanceof Error?e.message:'Déclaration impossible.'); if(id) setRefresh(value=>value+1) }
    finally { setBusy(false) }
  }
  return <div className="crm-page field-page">
    <div className="crm-page-head"><div><span className="section-kicker">TERRAIN / CONTRÔLE DES FONDS</span><h1>Dépenses commerciales</h1><p>Une autorisation n’est pas un versement. Une dépense déclarée n’est pas encore justifiée.</p></div><Link to="/commissions" className="crm-quick-link">Voir les commissions <ArrowRight size={15}/></Link></div>
    {error && <div className="crm-alert" role="alert">{error}</div>}{message && <div className="finance-success" role="status">{message}</div>}
    {!data ? <div className="crm-empty">Chargement des données autorisées…</div> : <>
      <div className="field-tabs" role="tablist">{([['overview','Vue d’ensemble'],['budgets','Dotations & budgets'],['expenses','Dépenses'],['regularize','Régularisations'],['settings','Règles']] as const).map(([key,label]) =>
        <button key={key} role="tab" aria-selected={tab===key} className={tab===key?'active':''} onClick={()=>setTab(key)}>{label}</button>)}</div>
      {tab==='overview' && <><div className="field-flow" aria-label="Étapes du financement"><span>Autorisé</span><ArrowRight size={15}/><span>Remis</span><ArrowRight size={15}/><span>Justifié</span><ArrowRight size={15}/><span>Régularisé</span></div><div className="field-kpis">{kpis.map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><p className="commercial-note">Les recharges et trajets financés par une avance sont des utilisations de cette avance, jamais une seconde remise de fonds.</p></>}
      {tab==='budgets' && <><div className="field-two-col"><div>
        {canManage && <section className="crm-section"><h2>Décider une attribution</h2><p>Le transport ultérieur ne se crée jamais automatiquement. Indiquez un montant et une période explicites.</p><form className="field-form" onSubmit={e=>void createBudget(e)}><label className="crm-field">Commercial<select required value={budgetRep} onChange={e=>setBudgetRep(e.target.value)}>{sales.filter(item=>item.role==='sales_rep'&&item.is_active).map(item=><option key={item.id} value={item.id}>{item.full_name}</option>)}</select></label><label className="crm-field">Nature<select value={budgetKind} onChange={e=>setBudgetKind(e.target.value as typeof budgetKind)}><option value="transport">Transport ultérieur</option>{profile?.role==='admin' && <option value="startup">Dotation de démarrage</option>}<option value="other">Autres frais</option></select></label><label className="crm-field">Montant autorisé (FCFA){budgetKind==='startup'&&<small>Vide : politique en vigueur ({xofAmount(currentPolicy?.startup_amount_xof??5000)})</small>}<input type="number" min="1" required={budgetKind!=='startup'} value={budgetAmount} onChange={e=>setBudgetAmount(e.target.value)}/></label><label className="crm-field">Début<input type="date" required value={budgetStart} onChange={e=>setBudgetStart(e.target.value)}/></label><label className="crm-field">Fin<input type="date" min={budgetStart} required value={budgetEnd} onChange={e=>setBudgetEnd(e.target.value)}/></label><label className="crm-field">Zone de prospection<input value={budgetZone} onChange={e=>setBudgetZone(e.target.value)}/></label><label className="crm-field field-wide">Motif<input required value={budgetPurpose} onChange={e=>setBudgetPurpose(e.target.value)}/></label>{budgetKind==='startup'&&profile?.role==='admin'&&<><label className="crm-field">Exception à une dotation existante<select value={budgetException} onChange={e=>setBudgetException(e.target.value)}><option value="">Aucune — dotation normale unique</option>{budgets.filter(item=>item.sales_rep_id===budgetRep&&item.kind==='startup').map(item=><option key={item.id} value={item.id}>{item.id.slice(0,8)} · {xofAmount(item.authorized_xof)}</option>)}</select></label>{budgetException&&<label className="crm-field">Motif exceptionnel<input required value={budgetExceptionReason} onChange={e=>setBudgetExceptionReason(e.target.value)}/></label>}</>}<Button disabled={busy} type="submit">Autoriser le budget</Button></form></section>}
        <section className="crm-section"><h2>Budgets décidés</h2>{budgets.length===0&&<p>Aucun budget attribué.</p>}{budgets.map(item=>{const advance=advances.find(a=>a.budget_id===item.id);return <div className="field-row" key={item.id}><div><strong>{item.kind==='startup'?'Dotation initiale':item.kind==='transport'?'Transport ultérieur':'Autres frais'} · {repName(item.sales_rep_id)}</strong><small>{when(item.period_start)} – {when(item.period_end)} · {item.purpose}{item.prospecting_zone?` · ${item.prospecting_zone}`:''}</small><small>Autorisé par {repName(item.authorized_by)} · {status[item.status]??item.status}</small></div><b>{xofAmount(item.authorized_xof)}</b>{!advance&&<Button size="sm" variant="secondary" disabled={busy||(!canManage&&item.sales_rep_id!==profile?.id)} onClick={()=>void run(()=>requestAdvance(item.id,item.authorized_xof),'Avance demandée, non versée.')}>Demander l’avance</Button>}</div>})}</section>
      </div><div><section className="crm-section"><h2>Avances : décision puis remise</h2>{advances.length===0&&<p>Aucune avance demandée.</p>}{advances.map(item=><AdvanceRow key={item.id} item={item} budget={budgets.find(b=>b.id===item.budget_id)} name={repName(item.sales_rep_id)} canManage={Boolean(canManage)} busy={busy} transferAmount={transferAmount[item.id]??String(item.approved_xof??item.requested_xof)} transferMethod={transferMethod[item.id]??''} transferRef={transferRef[item.id]??''} onAmount={value=>setTransferAmount({...transferAmount,[item.id]:value})} onMethod={value=>setTransferMethod({...transferMethod,[item.id]:value})} onRef={value=>setTransferRef({...transferRef,[item.id]:value})} onAction={(action)=>{
          if(action==='approve') void run(()=>approveAdvance(item.id,true),'Avance approuvée, pas encore versée.')
          if(action==='reject') void run(()=>approveAdvance(item.id,false),'Demande refusée.')
          if(action==='disburse') void run(()=>disburseAdvance(item.id,Number(transferAmount[item.id]??item.approved_xof),transferMethod[item.id]??'',transferRef[item.id]??''),'Remise effective consignée.')
        }} onProof={file=>void run(()=>uploadFieldProof('advance',item.id,file),'Preuve de remise liée.')}/>)}</section></div></div></>}
      {tab==='expenses' && <div className="field-two-col"><section className="crm-section"><h2>Déclarer une dépense</h2><p>Rapide sur téléphone. La source de financement détermine si la dépense réduit une avance ou crée un remboursement à valider.</p><form className="field-form" onSubmit={e=>void submitExpense(e)}><label className="crm-field">Budget autorisé<select required value={expenseBudget} onChange={e=>setExpenseBudget(e.target.value)}><option value="">Choisir</option>{myBudgets.map(item=><option key={item.id} value={item.id}>{item.kind} · {xofAmount(item.authorized_xof)} · {item.purpose}</option>)}</select></label><label className="crm-field">Catégorie<select value={expenseCategory} onChange={e=>setExpenseCategory(e.target.value as typeof expenseCategory)}><option value="transport">Transport</option><option value="communication">Communication</option><option value="other">Autre</option></select></label><label className="crm-field">Financement<select value={expenseSource} onChange={e=>setExpenseSource(e.target.value as typeof expenseSource)}><option value="advance">Avance déjà reçue</option><option value="personal">Fonds personnels</option><option value="company">Payé directement par Cortexia</option></select></label><label className="crm-field">Montant FCFA<input type="number" min="1" required value={expenseAmount} onChange={e=>setExpenseAmount(e.target.value)}/></label><label className="crm-field">Date<input type="datetime-local" required value={expenseDate} onChange={e=>setExpenseDate(e.target.value)}/></label>{expenseCategory==='communication'&&<label className="crm-field">Période de recharge<input type="date" required value={expensePeriod} onChange={e=>setExpensePeriod(e.target.value)}/><small>jusqu’au {periodEnd} · référence {xofAmount(currentPolicy?.communication_amount_xof??500)} / {currentPolicy?.communication_interval_days??3} jours</small></label>}{expenseCategory==='transport'&&<><label className="crm-field">Zone ou itinéraire<input required value={expenseZone} onChange={e=>setExpenseZone(e.target.value)}/></label><label className="crm-field">Moyen de transport<input required value={expenseMode} onChange={e=>setExpenseMode(e.target.value)}/></label></>}<label className="crm-field field-wide">Motif<input required value={expenseDescription} onChange={e=>setExpenseDescription(e.target.value)}/></label><label className="crm-field field-wide">Justificatif PDF/JPEG/PNG, 5 Mo<input type="file" accept="application/pdf,image/png,image/jpeg" onChange={e=>setExpenseProof(e.target.files?.[0]??null)}/></label>{expenseSource==='advance'&&!eligibleAdvance&&<p className="crm-alert field-wide">Ce budget n’a pas d’avance effectivement versée.</p>}<Button disabled={busy||!expenseBudget||(expenseSource==='advance'&&!eligibleAdvance)} type="submit">Soumettre la dépense</Button></form></section><section className="crm-section"><h2>{canManage?'Dépenses à valider':'Mes dépenses'}</h2>{expenses.length===0&&<p>Aucune dépense déclarée.</p>}{expenses.map(item=><div className="field-row" key={item.id}><div><strong>{item.category} · {repName(item.sales_rep_id)}</strong><small>{item.description} · {when(item.incurred_at)} · financé par {item.funding_source==='advance'?'avance':item.funding_source==='personal'?'fonds personnels':'Cortexia'}</small><small>{status[item.status]??item.status}{item.reimbursement_status==='due'?' · remboursement non versé':''}</small>{item.proof_path&&<button className="field-link" onClick={()=>openProof(item.proof_path!)}><FileUp size={13}/> Justificatif</button>}{canManage&&item.status==='submitted'&&<div className="field-review"><input aria-label="Motif de décision" placeholder="Motif si rejet ou complément" value={reviewReason[item.id]??''} onChange={e=>setReviewReason({...reviewReason,[item.id]:e.target.value})}/><Button size="sm" disabled={busy} onClick={()=>void run(()=>reviewFieldExpense(item.id,'approve',''),'Dépense approuvée.')}>Approuver</Button><Button size="sm" variant="secondary" disabled={busy||!(reviewReason[item.id]??'').trim()} onClick={()=>void run(()=>reviewFieldExpense(item.id,'reject',reviewReason[item.id]),'Dépense rejetée.')}>Rejeter</Button><Button size="sm" variant="secondary" disabled={busy||!(reviewReason[item.id]??'').trim()} onClick={()=>void run(()=>reviewFieldExpense(item.id,'request_info',reviewReason[item.id]),'Précisions demandées.')}>Précisions</Button></div>}{canManage&&item.reimbursement_status==='due'&&<div className="field-review"><input aria-label="Référence du remboursement" placeholder="Référence du remboursement effectif" value={returnRef[item.id]??''} onChange={e=>setReturnRef({...returnRef,[item.id]:e.target.value})}/><Button size="sm" disabled={busy||!(returnRef[item.id]??'').trim()} onClick={()=>void run(()=>payReimbursement(item.id,returnRef[item.id]),'Remboursement effectif consigné.')}>Consigner le remboursement</Button></div>}</div><b>{xofAmount(item.amount_xof)}</b></div>)}</section></div>}
      {tab==='regularize' && <div className="field-two-col"><section className="crm-section"><h2>Soldes des avances</h2>{advances.filter(item=>['disbursed','closed'].includes(item.status)).map(item=>{const balance=advanceBalance(item,expenses,restitutions);return <div className="field-row" key={item.id}><div><strong>{repName(item.sales_rep_id)} · {status[item.status]}</strong><small>Versé {xofAmount(balance.funded)} · justifié {xofAmount(balance.justified)} · restitué {xofAmount(balance.returned)}</small><small>Reste à régulariser : {xofAmount(balance.toRegularize)}</small>{item.status==='disbursed'&&<div className="field-review"><input aria-label="Montant à restituer" type="number" min="1" placeholder="Montant à restituer" value={returnAmount[item.id]??''} onChange={e=>setReturnAmount({...returnAmount,[item.id]:e.target.value})}/><Button size="sm" variant="secondary" disabled={busy||!Number(returnAmount[item.id])} onClick={()=>void run(()=>declareRestitution(item.id,Number(returnAmount[item.id]),'Régularisation de l’avance'),'Restitution déclarée, non vérifiée.')}>Déclarer la restitution</Button>{canManage&&<Button size="sm" disabled={busy||balance.toRegularize!==0} onClick={()=>void run(()=>closeAdvance(item.id),'Avance clôturée après régularisation.')}>Clôturer</Button>}</div>}</div></div>})}</section><section className="crm-section"><h2>Restitutions à contrôler</h2>{restitutions.length===0&&<p>Aucune restitution déclarée.</p>}{restitutions.map(item=><div className="field-row" key={item.id}><div><strong>{repName(advances.find(a=>a.id===item.advance_id)?.sales_rep_id??'')} · {status[item.status]}</strong><small>{when(item.declared_at)} · {item.received_reference??'sans référence officielle'}</small>{item.proof_path&&<button className="field-link" onClick={()=>openProof(item.proof_path!)}>Ouvrir la preuve</button>}{item.status==='declared'&&<><label className="crm-field">Preuve de retour<input type="file" accept="application/pdf,image/png,image/jpeg" onChange={e=>{const file=e.target.files?.[0];if(file)void run(()=>uploadFieldProof('restitution',item.id,file),'Preuve liée.')}}/></label>{canManage&&<div className="field-review"><input aria-label="Référence de restitution" placeholder="Référence constatée en caisse" value={returnRef[item.id]??''} onChange={e=>setReturnRef({...returnRef,[item.id]:e.target.value})}/><Button size="sm" disabled={busy||!item.proof_path||!(returnRef[item.id]??'').trim()} onClick={()=>void run(()=>verifyRestitution(item.id,returnRef[item.id],true),'Retour des fonds vérifié.')}>Vérifier</Button><Button size="sm" variant="secondary" disabled={busy} onClick={()=>void run(()=>verifyRestitution(item.id,'',false),'Restitution rejetée.')}>Rejeter</Button></div>}</>}</div><b>{xofAmount(item.amount_xof)}</b></div>)}</section></div>}
      {tab==='settings' && <div className="field-two-col"><section className="crm-section"><h2>Politique de dépenses</h2><p>Version en vigueur : {currentPolicy?`V${currentPolicy.version_no} depuis le ${when(currentPolicy.effective_from)}`:'aucune'}. La dotation est unique ; la fréquence de communication est une référence, pas un versement automatique.</p>{profile?.role==='admin'&&<form className="field-form" onSubmit={e=>{e.preventDefault();void run(()=>publishFieldPolicy({effective_from:policyStart,startup_amount_xof:Number(policyInitial),communication_amount_xof:Number(policyCommunication),communication_interval_days:Number(policyInterval)}),'Nouvelle version publiée sans modifier l’historique.')}}><label className="crm-field">Application à partir du<input required type="date" value={policyStart} onChange={e=>setPolicyStart(e.target.value)}/></label><label className="crm-field">Dotation initiale FCFA<input required min="1" type="number" value={policyInitial} onChange={e=>setPolicyInitial(e.target.value)}/></label><label className="crm-field">Communication FCFA<input required min="1" type="number" value={policyCommunication} onChange={e=>setPolicyCommunication(e.target.value)}/></label><label className="crm-field">Intervalle (jours)<input required min="1" type="number" value={policyInterval} onChange={e=>setPolicyInterval(e.target.value)}/></label><Button disabled={busy} type="submit">Publier une nouvelle version</Button></form>}</section><section className="crm-section"><h2><ShieldCheck size={17}/> Habilitations budgétaires</h2><p>Le rôle responsable commercial ne suffit pas à lui seul : l’administrateur accorde ou retire ce droit nominativement.</p>{sales.filter(item=>item.role==='sales_manager').map(item=>{const enabled=data.permissions.find(p=>p.user_id===item.id)?.enabled??false;return <div className="field-row" key={item.id}><strong>{item.full_name}</strong><span>{enabled?'Autorisé':'Non autorisé'}</span>{profile?.role==='admin'&&<Button size="sm" variant="secondary" disabled={busy} onClick={()=>void run(()=>setBudgetPermission(item.id,!enabled),'Permission mise à jour.')}>{enabled?'Retirer':'Autoriser'}</Button>}</div>})}</section></div>}
    </>}
  </div>
}

function AdvanceRow({item,budget,name,canManage,busy,transferAmount,transferMethod,transferRef,onAmount,onMethod,onRef,onAction,onProof}:{
  item:FieldAdvance;budget:FieldBudget|undefined;name:string;canManage:boolean;busy:boolean;
  transferAmount:string;transferMethod:string;transferRef:string;
  onAmount:(value:string)=>void;onMethod:(value:string)=>void;onRef:(value:string)=>void;
  onAction:(action:'approve'|'reject'|'disburse')=>void;onProof:(file:File)=>void
}) {
  return <div className="field-advance"><div className="field-advance-head"><span className="field-icon"><WalletCards size={17}/></span><div><strong>{name} · {budget?.kind==='startup'?'Dotation initiale':budget?.kind==='transport'?'Transport':'Avance'}</strong><small>{status[item.status]??item.status} · {when(item.created_at)}</small></div><b>{xofAmount(item.disbursed_xof??item.approved_xof??item.requested_xof)}</b></div>
    <div className="field-money-line"><span>Demandée {xofAmount(item.requested_xof)}</span><span>Approuvée {item.approved_xof?xofAmount(item.approved_xof):'—'}</span><span>Versée {item.disbursed_xof?xofAmount(item.disbursed_xof):'—'}</span></div>
    {canManage&&item.status==='requested'&&<div className="field-review"><Button size="sm" disabled={busy} onClick={()=>onAction('approve')}><CircleCheck size={14}/> Approuver</Button><Button size="sm" variant="secondary" disabled={busy} onClick={()=>onAction('reject')}>Refuser</Button></div>}
    {canManage&&item.status==='approved'&&<div className="field-review"><label className="crm-field">Preuve de remise<input type="file" accept="application/pdf,image/png,image/jpeg" onChange={e=>{const file=e.target.files?.[0];if(file)onProof(file)}}/></label><input type="number" min="1" max={item.approved_xof??undefined} aria-label="Montant réellement versé" value={transferAmount} onChange={e=>onAmount(e.target.value)}/><input aria-label="Moyen de versement" placeholder="Moyen de remise" value={transferMethod} onChange={e=>onMethod(e.target.value)}/><input aria-label="Référence de remise" placeholder="Référence constatée" value={transferRef} onChange={e=>onRef(e.target.value)}/><Button size="sm" disabled={busy||!item.handover_proof_path||!transferMethod.trim()||!transferRef.trim()||!Number(transferAmount)} onClick={()=>onAction('disburse')}><Banknote size={14}/> Consigner la remise effective</Button></div>}
    {item.status==='disbursed'&&<small className="field-caption"><RotateCcw size={13}/> À rapprocher avec les dépenses et restitutions.</small>}
  </div>
}
