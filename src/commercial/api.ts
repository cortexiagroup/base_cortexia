import { supabase } from '../lib/supabase'
import { crmChanged } from '../crm/api'
import type { CommercialEvent, CommercialSettings, Installment, Offer, OfferInput, OfferStatus, Order, OrderStatus, Proposal, ProposalDocument, ProposalInput, ProposalStatus } from './types'

function db() { if (!supabase) throw new Error('Connexion Supabase non configurée.'); return supabase }
function changed() { crmChanged() }
function fail(error: { message: string } | null) { if (error) throw new Error(error.message) }

export async function getOffers(): Promise<Offer[]> {
  const { data, error } = await db().from('offer_templates').select('*').order('created_at', { ascending: false })
  fail(error); return data as Offer[]
}
export async function getOffer(id: string): Promise<Offer> {
  const { data, error } = await db().from('offer_templates').select('*').eq('id', id).single()
  fail(error); if (!data) throw new Error('Offre introuvable.'); return data as Offer
}
export async function saveOffer(id: string | null, input: OfferInput): Promise<string> {
  const { data, error } = await db().rpc('commercial_save_offer', { p_id: id, p_data: input })
  fail(error); changed(); return data as string
}
export async function cloneOffer(id: string): Promise<string> {
  const { data, error } = await db().rpc('commercial_clone_offer', { p_id: id })
  fail(error); changed(); return data as string
}
export async function setOfferStatus(id: string, status: OfferStatus): Promise<void> {
  const { error } = await db().rpc('commercial_set_offer_status', { p_id: id, p_status: status })
  fail(error); changed()
}
export async function getSettings(): Promise<CommercialSettings> {
  const { data, error } = await db().from('commercial_settings').select('*').eq('id', true).single()
  fail(error); if (!data) throw new Error('Coordonnées professionnelles absentes.'); return data as CommercialSettings
}
export async function saveSettings(input: Partial<CommercialSettings>): Promise<void> {
  const { error } = await db().from('commercial_settings').update(input).eq('id', true)
  fail(error); changed()
}
export async function getProposals(leadId?: string): Promise<Proposal[]> {
  let query = db().from('commercial_proposals').select('*').order('created_at', { ascending: false }).limit(200)
  if (leadId) query = query.eq('lead_id', leadId)
  const { data, error } = await query
  fail(error); return data as Proposal[]
}
export async function getProposal(id: string): Promise<Proposal> {
  const { data, error } = await db().from('commercial_proposals').select('*').eq('id', id).single()
  fail(error); if (!data) throw new Error('Proposition introuvable.'); return data as Proposal
}
export async function saveProposal(id: string | null, input: ProposalInput): Promise<string> {
  const { data, error } = await db().rpc('commercial_save_proposal', { p_id: id, p_data: input })
  fail(error); changed(); return data as string
}
export async function submitProposal(id: string): Promise<ProposalStatus> {
  const { data, error } = await db().rpc('commercial_submit_proposal', { p_id: id })
  fail(error); changed(); return data as ProposalStatus
}
export async function approveProposal(id: string, reason: string): Promise<void> {
  const { error } = await db().rpc('commercial_approve_proposal', { p_id: id, p_reason: reason || null })
  fail(error); changed()
}
export async function issueProposal(id: string): Promise<string> {
  const { data, error } = await db().functions.invoke('issue-proposal', { body: { proposal_id: id } })
  fail(error); if (!data?.document_id) throw new Error(data?.error ?? 'Document non généré.')
  changed(); return data.document_id as string
}
export async function sendProposal(id: string, channel: string): Promise<void> {
  const { error } = await db().rpc('commercial_send_proposal', { p_id: id, p_channel: channel })
  fail(error); changed()
}
export async function recordAcceptance(id: string, channel: string, reference: string): Promise<void> {
  const { error } = await db().rpc('commercial_record_acceptance', { p_id: id, p_channel: channel, p_reference: reference || null })
  fail(error); changed()
}
export async function verifyAcceptance(id: string, reference: string): Promise<void> {
  const { error } = await db().rpc('commercial_verify_acceptance', { p_id: id, p_reference: reference })
  fail(error); changed()
}
export async function closeProposal(id: string, status: 'rejected' | 'expired' | 'cancelled', reason: string): Promise<void> {
  const { error } = await db().rpc('commercial_close_proposal', { p_id: id, p_status: status, p_reason: reason })
  fail(error); changed()
}
export async function getProposalEvents(id: string): Promise<CommercialEvent[]> {
  const { data, error } = await db().from('commercial_proposal_events').select('*').eq('proposal_id', id).order('created_at', { ascending: false })
  fail(error); return data as CommercialEvent[]
}
export async function getProposalDocuments(id: string): Promise<ProposalDocument[]> {
  const { data, error } = await db().from('documents').select('id,proposal_id,document_number,document_version,storage_path,content_hash,issued_at,document_status').eq('proposal_id', id).order('document_version', { ascending: false })
  fail(error); return data as ProposalDocument[]
}
export async function signedDocumentUrl(path: string): Promise<string> {
  const { data, error } = await db().storage.from('cortexia-documents').createSignedUrl(path, 60)
  fail(error); if (!data?.signedUrl) throw new Error('Lien de téléchargement indisponible.')
  return data.signedUrl
}
export async function getOrders(leadId?: string): Promise<Order[]> {
  let query = db().from('orders').select('*').not('proposal_id', 'is', null).order('ordered_at', { ascending: false }).limit(200)
  if (leadId) query = query.eq('lead_id', leadId)
  const { data, error } = await query
  fail(error); return data as Order[]
}
export async function getOrder(id: string): Promise<Order> {
  const { data, error } = await db().from('orders').select('*').eq('id', id).single()
  fail(error); if (!data) throw new Error('Commande introuvable.'); return data as Order
}
export async function createOrder(proposalId: string): Promise<string> {
  const { data, error } = await db().rpc('commercial_create_order', { p_proposal_id: proposalId })
  fail(error); changed(); return data as string
}
export async function setOrderStatus(id: string, status: OrderStatus): Promise<void> {
  const { error } = await db().rpc('commercial_set_order_status', { p_id: id, p_status: status })
  fail(error); changed()
}
export async function getInstallments(orderId: string): Promise<Installment[]> {
  const { data, error } = await db().from('order_installments').select('*').eq('order_id', orderId).order('installment_number')
  fail(error); return data as Installment[]
}
export async function getOrderEvents(orderId: string): Promise<CommercialEvent[]> {
  const { data, error } = await db().from('commercial_order_events').select('*').eq('order_id', orderId).order('created_at', { ascending: false })
  fail(error); return data as CommercialEvent[]
}
export async function getProductionStatus(orderId: string): Promise<string | null> {
  const { data, error } = await db().from('production_projects').select('status').eq('order_id', orderId).maybeSingle()
  fail(error); return data?.status ?? null
}
export async function getConfirmedCollected(orderId: string): Promise<number> {
  let total = 0
  for (let from = 0; ; from += 500) {
    const { data, error } = await db().from('financial_ledger').select('amount_xof')
      .eq('order_id', orderId).order('id').range(from, from + 499)
    fail(error)
    for (const item of data ?? []) total += Number(item.amount_xof)
    if ((data ?? []).length < 500) break
  }
  return total
}
