import { supabase } from './supabase'
import type { ZoneId } from './modules'

export interface DashboardStats {
  activeLeads: number
  scheduledMeetings: number
  confirmedOrders: number
  confirmedPaymentsXof: bigint
}
export interface InspectionData { metric: string; value: string; details: { label: string; value: string }[] }

function client() {
  if (!supabase) throw new Error('Connexion Supabase non configurée.')
  return supabase
}
function countResult(result: { count: number | null; error: { message: string } | null }): number {
  if (result.error) throw new Error(result.error.message)
  return result.count ?? 0
}

export function totalConfirmedXof(payments: { amount_xof: string | number; status: string }[]): bigint {
  return payments.reduce((sum, payment) => payment.status === 'confirmed' ? sum + BigInt(String(payment.amount_xof)) : sum, 0n)
}

async function sumConfirmedPayments(): Promise<bigint> {
  const db = client()
  let total = 0n
  let from = 0
  const pageSize = 500
  while (true) {
    const { data, error } = await db.from('financial_ledger').select('amount_xof').order('id').range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const page = data ?? []
    for (const entry of page) total += BigInt(String(entry.amount_xof))
    if (page.length < pageSize) break
    from += pageSize
  }
  return total
}

async function sumConfirmedOrderAmounts(): Promise<bigint> {
  const db = client()
  let total = 0n
  let from = 0
  const pageSize = 500
  while (true) {
    const { data, error } = await db.from('orders').select('amount_xof').in('order_status', ['confirmed', 'in_progress', 'completed']).order('id').range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const page = data ?? []
    for (const item of page) total += BigInt(String(item.amount_xof))
    if (page.length < pageSize) break
    from += pageSize
  }
  return total
}

async function sumActiveInstallments(): Promise<bigint> {
  const db = client()
  let total = 0n
  let from = 0
  const pageSize = 500
  while (true) {
    const { data, error } = await db.from('order_installments')
      .select('amount_xof,orders!inner(order_status)')
      .in('orders.order_status', ['draft', 'confirmed', 'in_progress', 'completed'])
      .order('id').range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const page = data ?? []
    for (const item of page) total += BigInt(String(item.amount_xof))
    if (page.length < pageSize) break
    from += pageSize
  }
  return total
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const db = client()
  const now = new Date().toISOString()
  const [leads, meetings, orders, confirmedPaymentsXof] = await Promise.all([
    db.from('leads').select('id', { count: 'exact', head: true }).not('status', 'in', '(won,lost,archived)'),
    db.from('appointments').select('id', { count: 'exact', head: true }).eq('kind', 'meeting').in('status', ['scheduled', 'confirmed']).gte('scheduled_at', now),
    db.from('orders').select('id', { count: 'exact', head: true }).in('order_status', ['confirmed', 'in_progress', 'completed']),
    sumConfirmedPayments(),
  ])
  return { activeLeads: countResult(leads), scheduledMeetings: countResult(meetings), confirmedOrders: countResult(orders), confirmedPaymentsXof }
}

export async function getInspectionData(zone: ZoneId): Promise<InspectionData> {
  const db = client()
  const now = new Date().toISOString()
  switch (zone) {
    case 'prospects': {
      const [total, followUps, recent] = await Promise.all([
        db.from('leads').select('id', { count: 'exact', head: true }),
        db.from('leads').select('id', { count: 'exact', head: true }).gte('next_follow_up_at', now),
        db.from('activities').select('id, activity_type, occurred_at').order('occurred_at', { ascending: false }).limit(1),
      ])
      if (recent.error) throw new Error(recent.error.message)
      return { metric: 'Prospects accessibles', value: String(countResult(total)), details: [
        { label: 'Relances à venir', value: String(countResult(followUps)) },
        { label: 'Dernière activité', value: recent.data?.[0] ? new Date(recent.data[0].occurred_at).toLocaleDateString('fr-TG') : 'Aucune' },
      ] }
    }
    case 'activities': {
      const [future, past, demos] = await Promise.all([
        db.from('appointments').select('id', { count: 'exact', head: true }).eq('kind', 'meeting').in('status', ['scheduled', 'confirmed']).gte('scheduled_at', now),
        db.from('activities').select('id', { count: 'exact', head: true }).lt('occurred_at', now),
        db.from('appointments').select('id', { count: 'exact', head: true }).eq('kind', 'demo').eq('status', 'completed'),
      ])
      return { metric: 'Rendez-vous programmés', value: String(countResult(future)), details: [{ label: 'Démonstrations réalisées', value: String(countResult(demos)) }, { label: 'Activités passées', value: String(countResult(past)) }] }
    }
    case 'offers': {
      const [offers, proposals, accepted, orders, recent, contractTotal] = await Promise.all([
        db.from('offer_templates').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        db.from('commercial_proposals').select('id', { count: 'exact', head: true }).in('status', ['approved', 'sent']),
        db.from('commercial_proposals').select('id', { count: 'exact', head: true }).eq('status', 'accepted'),
        db.from('orders').select('id', { count: 'exact', head: true }).in('order_status', ['confirmed', 'in_progress', 'completed']),
        db.from('orders').select('order_number,amount_xof').order('ordered_at', { ascending: false }).limit(1),
        sumConfirmedOrderAmounts(),
      ])
      if (recent.error) throw new Error(recent.error.message)
      return { metric: 'Commandes confirmées', value: String(countResult(orders)), details: [
        { label: 'Offres actives', value: String(countResult(offers)) },
        { label: 'Propositions en cours', value: String(countResult(proposals)) },
        { label: 'Propositions acceptées', value: String(countResult(accepted)) },
        { label: 'Montant contractuel confirmé', value: `${new Intl.NumberFormat('fr-TG').format(contractTotal)} FCFA` },
        { label: 'Dernière commande', value: recent.data?.[0] ? `${recent.data[0].order_number} · ${new Intl.NumberFormat('fr-TG').format(recent.data[0].amount_xof)} FCFA` : 'Aucune' },
      ] }
    }
    case 'payments': {
      const [total, pending, installments, expected] = await Promise.all([
        sumConfirmedPayments(),
        db.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        db.from('order_installments').select('id', { count: 'exact', head: true }),
        sumActiveInstallments(),
      ])
      return { metric: 'Encaissement net vérifié', value: `${new Intl.NumberFormat('fr-TG').format(total)} FCFA`, details: [{ label: 'Échéances contractuelles', value: String(countResult(installments)) }, { label: 'Solde contractuel estimé', value: `${new Intl.NumberFormat('fr-TG').format(expected > total ? expected - total : 0n)} FCFA` }, { label: 'Paiements à vérifier', value: String(countResult(pending)) }] }
    }
    case 'production': {
      const [active, blocked] = await Promise.all([
        db.from('production_projects').select('id', { count: 'exact', head: true }).eq('status', 'in_progress'),
        db.from('production_projects').select('id', { count: 'exact', head: true }).eq('status', 'blocked'),
      ])
      return { metric: 'Projets en production', value: String(countResult(active)), details: [{ label: 'Projets bloqués', value: String(countResult(blocked)) }] }
    }
    case 'delivery': {
      const [delivered, ready] = await Promise.all([
        db.from('production_projects').select('id', { count: 'exact', head: true }).eq('status', 'delivered'),
        db.from('production_projects').select('id', { count: 'exact', head: true }).eq('status', 'ready_for_delivery'),
      ])
      return { metric: 'Projets livrés', value: String(countResult(delivered)), details: [{ label: 'Prêts à livrer', value: String(countResult(ready)) }] }
    }
  }
}
