import { supabase } from '../lib/supabase'
import { crmChanged } from '../crm/api'
import type { AccountInput, Adjustment, FinanceJob, LedgerEntry, Payment, PaymentAccount } from './types'
import type { Order } from '../commercial/types'

function db() { if (!supabase) throw new Error('Connexion Supabase non configurée.'); return supabase }
function fail(error: { message: string } | null) { if (error) throw new Error(error.message) }
const changed = () => crmChanged()

export async function listAccounts(): Promise<PaymentAccount[]> {
  const { data, error } = await db().rpc('finance_list_accounts')
  fail(error); return (data ?? []) as PaymentAccount[]
}
export async function saveAccount(id: string | null, input: AccountInput): Promise<string> {
  const { data, error } = await db().rpc('finance_save_account', { p_id: id, p_data: input })
  fail(error); changed(); return data as string
}
export async function listVerifiers(): Promise<{ user_id: string; enabled: boolean }[]> {
  const { data, error } = await db().from('finance_verifiers').select('user_id,enabled')
  fail(error); return data ?? []
}
export async function setVerifier(userId: string, enabled: boolean) {
  const { error } = await db().rpc('finance_set_verifier', { p_user_id: userId, p_enabled: enabled })
  fail(error); changed()
}
export async function setReceiptPrefix(prefix: string) {
  const { error } = await db().rpc('finance_set_receipt_prefix', { p_prefix: prefix })
  fail(error)
}
export async function getReceiptPrefix(): Promise<string> {
  const { data, error } = await db().from('finance_settings').select('receipt_prefix').eq('id', true).single()
  fail(error); return data?.receipt_prefix ?? 'CTX-REC'
}
export async function declarePayment(input: { orderId: string; accountId: string; amount: number;
  reference: string; paidAt: string; installmentId: string | null; notes: string;
  cashReceiverId: string | null }): Promise<string> {
  const { data, error } = await db().rpc('finance_declare_payment', {
    p_order_id: input.orderId, p_account_id: input.accountId, p_amount_xof: input.amount,
    p_reference: input.reference, p_paid_at: input.paidAt, p_installment_id: input.installmentId,
    p_notes: input.notes, p_cash_received_by: input.cashReceiverId,
  })
  fail(error); changed(); return data as string
}
export async function uploadProof(paymentId: string, file: File): Promise<void> {
  if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type) || file.size > 5 * 1024 * 1024)
    throw new Error('Justificatif PDF, JPEG ou PNG, maximum 5 Mo.')
  const extension = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg'
  const path = `payments/${paymentId}/${crypto.randomUUID()}.${extension}`
  const { error: uploadError } = await db().storage.from('cortexia-payment-proofs').upload(path, file, {
    contentType: file.type, upsert: false,
  })
  fail(uploadError)
  const { error } = await db().rpc('finance_attach_proof', { p_payment_id: paymentId, p_path: path })
  fail(error); changed()
}
export async function signedProofUrl(path: string): Promise<string> {
  const { data, error } = await db().storage.from('cortexia-payment-proofs').createSignedUrl(path, 60)
  fail(error); if (!data?.signedUrl) throw new Error('Justificatif inaccessible.'); return data.signedUrl
}
export async function signedFinanceDocument(path: string, seconds = 60): Promise<string> {
  const { data, error } = await db().storage.from('cortexia-documents').createSignedUrl(path, seconds)
  fail(error); if (!data?.signedUrl) throw new Error('Document inaccessible.'); return data.signedUrl
}
export async function getPayments(orderId?: string): Promise<Payment[]> {
  const all: Payment[] = []
  for (let from = 0; ; from += 500) {
    let query = db().from('payments').select('*').order('created_at', { ascending: false }).range(from, from + 499)
    if (orderId) query = query.eq('order_id', orderId)
    const { data, error } = await query
    fail(error); all.push(...(data ?? []) as Payment[])
    if ((data ?? []).length < 500) break
  }
  return all
}
export async function getFinanceOrders(): Promise<Order[]> {
  const all: Order[] = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await db().from('orders').select('*').order('id').range(from, from + 499)
    fail(error); all.push(...(data ?? []) as Order[])
    if ((data ?? []).length < 500) break
  }
  return all
}
export async function getPayment(id: string): Promise<Payment> {
  const { data, error } = await db().from('payments').select('*').eq('id', id).single()
  fail(error); if (!data) throw new Error('Paiement introuvable.'); return data as Payment
}
export async function getLedger(orderId?: string): Promise<LedgerEntry[]> {
  const all: LedgerEntry[] = []
  for (let from = 0; ; from += 500) {
    let query = db().from('financial_ledger').select('*').order('id').range(from, from + 499)
    if (orderId) query = query.eq('order_id', orderId)
    const { data, error } = await query
    fail(error); all.push(...(data ?? []) as LedgerEntry[])
    if ((data ?? []).length < 500) break
  }
  return all
}
export async function getFinanceJobs(orderId?: string, paymentId?: string): Promise<FinanceJob[]> {
  let query = db().from('finance_document_jobs').select('*').order('created_at', { ascending: false })
  if (orderId) query = query.eq('order_id', orderId)
  if (paymentId) query = query.eq('payment_id', paymentId)
  const { data, error } = await query
  fail(error); return data as FinanceJob[]
}
export async function requestInstructions(orderId: string, installmentId: string | null): Promise<string> {
  const { data, error } = await db().rpc('finance_request_instructions', { p_order_id: orderId, p_installment_id: installmentId })
  fail(error); changed(); return data as string
}
export async function issueFinanceJob(jobId: string): Promise<string> {
  const { data, error } = await db().functions.invoke('issue-finance-document', { body: { job_id: jobId } })
  fail(error); if (!data?.document_id) throw new Error(data?.error ?? 'Document non généré.')
  changed(); return data.document_id as string
}
export async function reviewPayment(id: string, action: 'request_info' | 'reject' | 'cancel', reason: string): Promise<void> {
  const { error } = await db().rpc('finance_review_payment', { p_payment_id: id, p_action: action, p_reason: reason })
  fail(error); changed()
}
export async function confirmPayment(input: { paymentId: string; source: string; verifiedReference: string;
  note: string; cashHandoverAt: string | null }): Promise<string> {
  const { data, error } = await db().rpc('finance_confirm_payment', {
    p_payment_id: input.paymentId, p_source: input.source,
    p_verified_reference: input.verifiedReference, p_note: input.note,
    p_cash_handed_over_at: input.cashHandoverAt,
  })
  fail(error); changed(); return data as string
}
export async function getPaymentEvents(id: string): Promise<{ id: string; event_type: string; details: Record<string, unknown>; created_at: string }[]> {
  const { data, error } = await db().from('payment_events').select('id,event_type,details,created_at').eq('payment_id', id).order('created_at', { ascending: false })
  fail(error); return data ?? []
}
export async function getAdjustments(paymentId?: string): Promise<Adjustment[]> {
  let query = db().from('financial_adjustments').select('*').order('requested_at', { ascending: false })
  if (paymentId) query = query.eq('payment_id', paymentId)
  const { data, error } = await query
  fail(error); return data as Adjustment[]
}
export async function requestAdjustment(paymentId: string, kind: 'correction' | 'refund', amount: number, reason: string): Promise<string> {
  const { data, error } = await db().rpc('finance_request_adjustment', {
    p_payment_id: paymentId, p_kind: kind, p_amount_xof: amount, p_reason: reason,
  })
  fail(error); changed(); return data as string
}
export async function approveAdjustment(id: string, approved: boolean): Promise<void> {
  const { error } = await db().rpc('finance_approve_adjustment', { p_id: id, p_approve: approved })
  fail(error); changed()
}
export async function executeAdjustment(id: string, source: string, reference: string): Promise<void> {
  const { error } = await db().rpc('finance_execute_adjustment', {
    p_id: id, p_source: source, p_external_reference: reference,
  })
  fail(error); changed()
}
