export type PaymentMethod = 'merchant_account' | 'bank_transfer' | 'cash'
export type PaymentStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled' | 'refunded' | 'corrected'
export interface PaymentAccount {
  id: string; method: PaymentMethod; provider_name: string | null; holder_name: string | null;
  account_identifier: string | null; client_instructions: string; cash_responsible_id: string | null;
  is_active: boolean; internal_notes?: string | null; created_at: string; updated_at: string
}
export interface AccountInput extends Omit<PaymentAccount, 'id' | 'created_at' | 'updated_at'> { internal_notes?: string | null }
export interface Payment {
  id: string; order_id: string; amount_xof: number; method: PaymentMethod;
  transaction_reference: string | null; paid_at: string; status: PaymentStatus;
  payment_account_id: string | null; installment_id: string | null;
  declared_at: string; review_state: 'declared' | 'awaiting' | 'needs_info' | 'resolved';
  proof_path: string | null; verification_source: string | null;
  verification_reference: string | null; verification_note: string | null;
  verified_by: string | null; verified_at: string | null;
  cash_received_by: string | null; cash_handed_over_at: string | null;
  notes: string | null; created_by: string; created_at: string
}
export interface LedgerEntry { id: number; order_id: string; payment_id: string | null;
  adjustment_id: string | null; entry_kind: 'collection' | 'correction' | 'refund';
  amount_xof: number; recorded_at: string }
export interface FinanceJob { id: string; kind: 'receipt' | 'instructions'; payment_id: string | null;
  order_id: string; installment_id: string | null; document_number: string;
  snapshot: Record<string, unknown>; status: 'pending' | 'processing' | 'failed' | 'completed';
  attempts: number; last_error: string | null; storage_path: string | null;
  document_id: string | null; created_at: string; completed_at: string | null }
export interface Adjustment { id: string; payment_id: string; order_id: string;
  kind: 'correction' | 'refund'; amount_xof: number;
  status: 'requested' | 'approved' | 'executed' | 'rejected';
  reason: string; verification_source: string | null; external_reference: string | null;
  requested_at: string; executed_at: string | null }
export const methodLabels: Record<PaymentMethod, string> = {
  merchant_account: 'Mobile Money', bank_transfer: 'Virement bancaire', cash: 'Espèces',
}
export const statusLabels: Record<PaymentStatus, string> = {
  pending: 'En attente de vérification', confirmed: 'Confirmé', rejected: 'Rejeté',
  cancelled: 'Annulé', refunded: 'Remboursé', corrected: 'Corrigé',
}
export function ledgerBalance(contractAmount: number, entries: Pick<LedgerEntry, 'amount_xof'>[]) {
  const collected = entries.reduce((sum, entry) => sum + Number(entry.amount_xof), 0)
  return { collected, remaining: Math.max(0, contractAmount - collected),
    label: collected <= 0 ? 'Non payé' : collected >= contractAmount ? 'Entièrement payé' : 'Partiellement payé' }
}
