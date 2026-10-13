import { supabase } from '../lib/supabase'
import { crmChanged } from '../crm/api'
import type { CommissionPolicy, CommissionPosition, CommissionPayout, FieldAdvance,
  FieldBudget, FieldExpense, FieldPolicy, FieldRestitution } from './types'
import { advanceBalance, sumXof } from './types'

function db() { if (!supabase) throw new Error('Connexion Supabase non configurée.'); return supabase }
function check(error: { message: string } | null) { if (error) throw new Error(error.message) }
async function rows<T>(table: string): Promise<T[]> {
  const result: T[] = []
  for (let offset=0;;offset+=500) {
    const { data,error } = await db().from(table).select('*').range(offset,offset+499)
    check(error); result.push(...(data ?? []) as T[])
    if ((data ?? []).length<500) break
  }
  return result
}
async function call<T>(name: string,args: Record<string,unknown>): Promise<T> {
  const { data,error } = await db().rpc(name,args)
  check(error); crmChanged(); return data as T
}
export const fieldData = async () => {
  const [policies,permissions,budgets,advances,expenses,restitutions] = await Promise.all([
    rows<FieldPolicy>('field_policy_versions'),rows<{user_id:string;enabled:boolean}>('field_budget_permissions'),
    rows<FieldBudget>('field_budgets'),rows<FieldAdvance>('field_advances'),
    rows<FieldExpense>('field_expenses'),rows<FieldRestitution>('field_restitutions')])
  return { policies,permissions,budgets,advances,expenses,restitutions }
}
export const commissionData = async () => {
  const [policies,positions,payouts] = await Promise.all([
    rows<CommissionPolicy>('sales_commission_policies'),rows<CommissionPosition>('sales_commission_positions'),
    rows<CommissionPayout>('sales_commission_payouts')])
  return { policies,positions,payouts }
}
export async function fieldOverview() {
  const [f,c] = await Promise.all([fieldData(),commissionData()])
  const activeTransport = f.budgets.filter(item => item.kind==='transport' && item.status!=='cancelled')
  const funded = f.advances.filter(item => ['disbursed','closed'].includes(item.status))
  const justified = f.expenses.filter(item => ['approved','regularized'].includes(item.status))
  const paidByPosition = new Map<string,number>()
  for (const payout of c.payouts) paidByPosition.set(payout.position_id,(paidByPosition.get(payout.position_id)??0)+Number(payout.amount_xof))
  return {
    transportAuthorized: activeTransport.reduce((sum,item)=>sum+Number(item.authorized_xof),0),
    advancesDisbursed: funded.reduce((sum,item)=>sum+Number(item.disbursed_xof??0),0),
    expensesJustified: sumXof(justified),
    advancesToRegularize: f.advances.filter(item=>item.status==='disbursed')
      .reduce((sum,item)=>sum+advanceBalance(item,f.expenses,f.restitutions).toRegularize,0),
    commissionsPayable: c.positions.reduce((sum,item)=>sum+
      Math.max(0,Math.min(item.acquired_xof,item.approved_xof)-(paidByPosition.get(item.id)??0)),0),
  }
}
export const publishFieldPolicy = (data: Record<string,unknown>) => call<string>('field_publish_policy',{p_data:data})
export const setBudgetPermission = (id: string,enabled: boolean) => call<void>('field_set_budget_permission',{p_user_id:id,p_enabled:enabled})
export const createFieldBudget = (input: {rep:string;kind:string;amount:number|null;start:string;end:string;purpose:string;zone:string;exceptionOf?:string|null;exceptionReason?:string|null}) =>
  call<string>('field_create_budget',{p_rep:input.rep,p_kind:input.kind,p_amount:input.amount,
    p_start:input.start,p_end:input.end,p_purpose:input.purpose,p_zone:input.zone,
    p_exception_of:input.exceptionOf??null,p_exception_reason:input.exceptionReason??null})
export const requestAdvance = (budget:string,amount:number) => call<string>('field_request_advance',{p_budget:budget,p_amount:amount})
export const approveAdvance = (id:string,approve:boolean,amount?:number) => call<void>('field_approve_advance',{p_id:id,p_approve:approve,p_amount:amount??null})
export const disburseAdvance = (id:string,amount:number,method:string,reference:string) => call<void>('field_disburse_advance',{p_id:id,p_amount:amount,p_method:method,p_reference:reference})
export const submitFieldExpense = (input: {budget:string;category:string;source:string;amount:number;date:string;description:string;
  advance:string|null;start:string|null;end:string|null;zone:string|null;transportMode:string|null;phone:string|null;reference:string|null;lead:string|null}) =>
  call<string>('field_submit_expense',{p_budget:input.budget,p_category:input.category,p_source:input.source,p_amount:input.amount,
    p_incurred_at:input.date,p_description:input.description,p_advance:input.advance,p_period_start:input.start,
    p_period_end:input.end,p_zone:input.zone,p_transport_mode:input.transportMode,p_phone:input.phone,
    p_reference:input.reference,p_lead:input.lead})
export const reviewFieldExpense = (id:string,action:'approve'|'reject'|'request_info',reason:string) =>
  call<void>('field_review_expense',{p_id:id,p_action:action,p_reason:reason})
export const payReimbursement = (id:string,reference:string) => call<void>('field_pay_reimbursement',{p_id:id,p_reference:reference})
export const declareRestitution = (advance:string,amount:number,reason:string) =>
  call<string>('field_declare_restitution',{p_advance:advance,p_amount:amount,p_reason:reason})
export const verifyRestitution = (id:string,reference:string,accept:boolean) =>
  call<void>('field_verify_restitution',{p_id:id,p_reference:reference,p_accept:accept})
export const closeAdvance = (id:string) => call<void>('field_close_advance',{p_id:id})
export const publishCommissionPolicy = (data:Record<string,unknown>) => call<string>('sales_publish_commission_policy',{p_data:data})
export const recalculateCommission = (order:string) => call<string>('sales_recalculate_commission',{p_order:order})
export const approveCommission = (id:string,amount:number) => call<void>('sales_approve_commission',{p_position:id,p_amount:amount})
export const recordCommissionPayout = (id:string,amount:number,date:string,method:string,reference:string,proof:string|null) =>
  call<string>('sales_record_commission_payout',{p_position:id,p_amount:amount,p_paid_at:date,p_method:method,p_reference:reference,p_proof:proof})

export async function uploadFieldProof(kind:'advance'|'expense'|'restitution'|'commission_payout',id:string,file:File): Promise<string> {
  if (!['application/pdf','image/png','image/jpeg'].includes(file.type) || file.size>5*1024*1024)
    throw new Error('Justificatif PDF, PNG ou JPEG de 5 Mo maximum.')
  const { data:session,error:authError } = await db().auth.getUser()
  check(authError); if (!session.user) throw new Error('Session expirée.')
  const ext=file.type==='application/pdf'?'pdf':file.type==='image/png'?'png':'jpg'
  const path=`field/${session.user.id}/${kind}/${id}/${crypto.randomUUID()}.${ext}`
  const { error } = await db().storage.from('cortexia-field-proofs').upload(path,file,{upsert:false,contentType:file.type})
  check(error)
  if (kind!=='commission_payout') await call<void>('field_attach_proof',{p_kind:kind,p_id:id,p_path:path})
  return path
}
export async function fieldProofUrl(path:string):Promise<string> {
  const { data,error } = await db().storage.from('cortexia-field-proofs').createSignedUrl(path,60)
  check(error); if (!data?.signedUrl) throw new Error('Justificatif inaccessible.'); return data.signedUrl
}
