export type OfferStatus = 'draft' | 'active' | 'suspended' | 'archived'
export type ProposalStatus = 'draft' | 'pending_approval' | 'approved' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'cancelled'
export type PaymentPlan = 'full_upfront' | 'half_on_delivery'
export type OrderStatus = 'draft' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'
export interface Offer {
  id: string; family_id: string; version: number; name: string; category: string | null;
  description: string | null; price_xof: number; currency: 'XOF'; price_is_starting: boolean;
  benefits: string[]; included_services: string[]; exclusions: string[];
  delivery_days: number | null; payment_terms: string | null; validity_days: number | null;
  status: OfferStatus; is_active: boolean; created_by: string | null; updated_by: string | null;
  created_at: string; updated_at: string; published_at: string | null;
}
export interface OfferInput { name: string; category: string; description: string; price_xof: number;
  price_is_starting: boolean; benefits: string[]; included_services: string[]; exclusions: string[];
  delivery_days: number | null; payment_terms: string; validity_days: number | null }
export interface Proposal {
  id: string; proposal_number: string; lead_id: string; company_id: string; contact_id: string | null;
  sales_rep_id: string; offer_template_id: string; offer_version: number;
  offer_snapshot: Record<string, unknown>; client_snapshot: Record<string, unknown>;
  service_description: string; base_price_xof: number; discount_xof: number; amount_xof: number;
  payment_plan: PaymentPlan; special_terms: string | null; delivery_days: number | null;
  expires_at: string; status: ProposalStatus; requires_approval: boolean;
  approved_by: string | null; approved_at: string | null; sent_at: string | null;
  sent_channel: string | null; accepted_at: string | null; acceptance_channel: string | null;
  acceptance_reference: string | null; acceptance_verified: boolean;
  acceptance_verified_by: string | null; acceptance_verified_at: string | null;
  created_by: string; created_at: string; updated_at: string;
}
export interface ProposalInput { lead_id: string; contact_id?: string | null; offer_id: string;
  service_description: string; quoted_price_xof?: number; discount_xof: number; payment_plan: PaymentPlan;
  special_terms?: string | null; expires_at: string }
export interface CommercialEvent { id: string; actor_id: string; event_type: string;
  details: Record<string, unknown>; created_at: string }
export interface ProposalDocument { id: string; proposal_id: string; document_number: string;
  document_version: number; storage_path: string; content_hash: string; issued_at: string; document_status: string }
export interface Order { id: string; order_number: string; proposal_id: string; company_id: string;
  lead_id: string; sales_rep_id: string; offer_template_id: string; offer_version: number;
  offer_snapshot: Record<string, unknown>; amount_xof: number; contractual_terms: string | null;
  payment_plan: PaymentPlan; payment_terms_snapshot: Record<string, unknown>;
  order_status: OrderStatus; confirmed_at: string | null; ordered_at: string; created_at: string }
export interface Installment { id: string; installment_number: number; trigger_event: 'at_order' | 'at_delivery';
  percentage_bps: number; amount_xof: number; due_at: string | null; terms: string | null }
export interface CommercialSettings { id: true; company_name: string; professional_email: string | null;
  professional_phone: string | null; postal_address: string | null; legal_mentions: string | null;
  logo_storage_path: string | null }
export const offerStatusLabels: Record<OfferStatus, string> = { draft: 'Brouillon', active: 'Active', suspended: 'Suspendue', archived: 'Archivée' }
export const proposalStatusLabels: Record<ProposalStatus, string> = { draft: 'Brouillon', pending_approval: 'À approuver', approved: 'Approuvée', sent: 'Envoyée', accepted: 'Acceptée', rejected: 'Refusée', expired: 'Expirée', cancelled: 'Annulée' }
export const orderStatusLabels: Record<OrderStatus, string> = { draft: 'À confirmer', confirmed: 'Confirmée', in_progress: 'En cours', completed: 'Terminée', cancelled: 'Annulée' }
export const paymentPlanLabels: Record<PaymentPlan, string> = { full_upfront: '100 % à la commande', half_on_delivery: '50 % à la commande · 50 % à la livraison' }
export const xofAmount = (amount: number) => `${new Intl.NumberFormat('fr-TG').format(amount)} FCFA`
