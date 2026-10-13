/** Domain types used until `supabase gen types typescript --local` is available. */
export type AppRole = 'admin' | 'sales_manager' | 'sales_rep'
export type LeadStatus = 'new' | 'qualified' | 'contacted' | 'meeting' | 'demo' | 'proposal' | 'won' | 'lost' | 'archived'
export type OrderStatus = 'draft' | 'confirmed' | 'cancelled' | 'completed'
export type PaymentStatus = 'pending' | 'confirmed' | 'rejected' | 'refunded' | 'corrected'
export type PaymentMethod = 'merchant_account' | 'bank_transfer' | 'cash'

export interface MoneyXof { amountXof: number }
export interface Profile { id: string; full_name: string; role: AppRole; is_active: boolean }
export interface Company { id: string; legal_name: string; industry: string | null; city: string | null; phone: string | null; normalized_phone: string | null }
export interface Lead { id: string; company_id: string; assigned_to: string | null; status: LeadStatus; next_follow_up_at: string | null }
export interface Order extends MoneyXof { id: string; order_number: string; company_id: string; sales_rep_id: string; offer_version: number | null; offer_snapshot: Record<string, unknown>; order_status: OrderStatus }
export interface Payment extends MoneyXof { id: string; order_id: string; method: PaymentMethod; status: PaymentStatus; verified_by: string | null; correction_of: string | null }
