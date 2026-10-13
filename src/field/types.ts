export interface FieldPolicy { id: string; version_no: number; effective_from: string;
  startup_amount_xof: number; communication_amount_xof: number; communication_interval_days: number;
  allowed_categories: string[]; receipt_required_categories: string[]; period_cap_xof: number | null }
export interface FieldBudget { id: string; sales_rep_id: string; kind: 'startup'|'transport'|'other';
  policy_id: string; period_start: string; period_end: string; authorized_xof: number;
  purpose: string; prospecting_zone: string | null; status: string; authorized_by: string;
  exception_of: string | null; created_at: string }
export interface FieldAdvance { id: string; budget_id: string; sales_rep_id: string;
  requested_xof: number; approved_xof: number | null; disbursed_xof: number | null;
  status: 'requested'|'approved'|'disbursed'|'rejected'|'cancelled'|'closed';
  handover_proof_path: string | null; transfer_reference: string | null;
  disbursed_at: string | null; approved_at: string | null; created_at: string }
export interface FieldExpense { id: string; sales_rep_id: string; budget_id: string; advance_id: string | null;
  category: 'communication'|'transport'|'other'; funding_source: 'advance'|'personal'|'company';
  amount_xof: number; incurred_at: string; period_start: string | null; period_end: string | null;
  description: string; prospecting_zone: string | null; transport_mode: string | null;
  proof_path: string | null; status: 'submitted'|'needs_info'|'approved'|'rejected'|'regularized';
  reimbursement_status: 'not_applicable'|'due'|'paid'; created_at: string }
export interface FieldRestitution { id: string; advance_id: string; amount_xof: number;
  status: 'declared'|'verified'|'rejected'; proof_path: string | null;
  received_reference: string | null; declared_at: string }
export interface CommissionPolicy { id: string; version_no: number; name: string; effective_from: string;
  basis: 'confirmed_collected_amount'|'fixed_per_sale'|'gross_margin';
  vesting: 'progressive'|'full_collection'; rate_bps: number | null; fixed_amount_xof: number | null;
  offer_template_id: string | null; sales_rep_id: string | null }
export interface CommissionPosition { id: string; order_id: string; sales_rep_id: string; policy_id: string;
  policy_snapshot: Record<string, unknown>; eligible_base_xof: number; acquired_xof: number;
  approved_xof: number; calculated_at: string }
export interface CommissionPayout { id: string; position_id: string; amount_xof: number; paid_at: string;
  method: string; external_reference: string; proof_path: string | null }

export const sumXof = (rows: { amount_xof: number }[]) => rows.reduce((total, row) => total + Number(row.amount_xof), 0)
export function advanceBalance(advance: FieldAdvance, expenses: FieldExpense[], returns: FieldRestitution[]) {
  const funded = Number(advance.disbursed_xof ?? 0)
  const justified = sumXof(expenses.filter(item => item.advance_id === advance.id &&
    (item.status === 'approved' || item.status === 'regularized')))
  const returned = sumXof(returns.filter(item => item.advance_id === advance.id && item.status === 'verified'))
  return { funded, justified, returned, toRegularize: Math.max(0, funded - justified - returned) }
}
export function commissionPotential(base: number, rateBps: number): number {
  return Math.floor((base * rateBps + 5000) / 10000)
}
