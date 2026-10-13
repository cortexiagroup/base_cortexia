import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ShoppingBag } from 'lucide-react'
import { Button } from '../components/ui/button'
import { useAuth } from '../lib/auth'
import { getLeadNames } from '../crm/api'
import { getConfirmedCollected, getInstallments, getOrder, getOrderEvents, getOrders, getProductionStatus, getProposal, setOrderStatus } from './api'
import { orderStatusLabels, paymentPlanLabels, xofAmount, type CommercialEvent, type Installment, type Order, type OrderStatus, type Proposal } from './types'

const when = (value: string) => new Intl.DateTimeFormat('fr-TG', { timeZone: 'Africa/Lome', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

export function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState<'recent' | 'oldest' | 'amount'>('recent')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { getOrders().then(async items => { setOrders(items); setNames(await getLeadNames(items.map(item => item.lead_id))) }).catch(e => setError(e.message)) }, [])
  const shown = orders.filter(item => (!status || item.order_status === status) &&
    (!search || `${item.order_number} ${names[item.lead_id] ?? ''}`.toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => sort === 'amount' ? b.amount_xof - a.amount_xof : sort === 'oldest' ? a.ordered_at.localeCompare(b.ordered_at) : b.ordered_at.localeCompare(a.ordered_at))
  return <div className="crm-page"><div className="crm-page-head"><div><span className="section-kicker">COMMERCIAL / COMMANDES</span><h1>Commandes</h1><p>Contrats et échéanciers. Une échéance attendue n’est jamais un encaissement.</p></div></div>{error && <div className="crm-alert" role="alert">{error}</div>}<div className="crm-toolbar"><div className="crm-search"><input aria-label="Rechercher une commande" placeholder="Numéro ou entreprise…" value={search} onChange={e => setSearch(e.target.value)} /></div><select aria-label="Filtrer par statut" value={status} onChange={e => setStatus(e.target.value)}><option value="">Tous les statuts</option>{Object.entries(orderStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="Trier" value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="recent">Plus récentes</option><option value="oldest">Plus anciennes</option><option value="amount">Montant décroissant</option></select></div><div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Commande</th><th>Client</th><th>Montant contractuel</th><th>Statut commercial</th><th>Date</th><th /></tr></thead><tbody>{shown.map(item => <tr key={item.id}><td><strong>{item.order_number}</strong><small>Offre V{item.offer_version}</small></td><td>{names[item.lead_id] || String((item.offer_snapshot.client as Record<string, unknown> | undefined)?.company_name ?? '—')}</td><td>{xofAmount(item.amount_xof)}</td><td><span className={`commercial-badge commercial-${item.order_status}`}>{orderStatusLabels[item.order_status]}</span></td><td>{when(item.ordered_at)}</td><td><Link to={`/commandes/${item.id}`}><ArrowRight size={16} /></Link></td></tr>)}</tbody></table>{shown.length === 0 && <div className="crm-empty">Aucune commande correspondante. Une commande naît d’une proposition acceptée et vérifiée.</div>}</div></div>
}

export function OrderDetail() {
  const { id } = useParams()
  const { profile } = useAuth()
  const manager = profile?.role === 'admin' || profile?.role === 'sales_manager'
  const [order, setOrder] = useState<Order | null>(null)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [installments, setInstallments] = useState<Installment[]>([])
  const [events, setEvents] = useState<CommercialEvent[]>([])
  const [collected, setCollected] = useState<number | null>(null)
  const [productionStatus, setProductionStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => { if (!id) return; getOrder(id).then(async item => {
    const [p, scheduled, history, paid, production] = await Promise.all([getProposal(item.proposal_id), getInstallments(id), getOrderEvents(id), getConfirmedCollected(id), getProductionStatus(id)])
    setOrder(item); setProposal(p); setInstallments(scheduled); setEvents(history); setCollected(paid); setProductionStatus(production)
  }).catch(e => setError(e.message)) }, [id, refresh])
  async function change(status: OrderStatus) { if (!id) return; setBusy(true); setError(null); try { await setOrderStatus(id, status); setRefresh(x => x + 1) } catch (e) { setError(e instanceof Error ? e.message : 'Statut non modifié.') } finally { setBusy(false) } }
  return <div className="crm-page"><Link to="/commandes" className="crm-back"><ArrowLeft size={16} /> Commandes</Link>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    {!order ? <div className="crm-empty">Chargement de la commande…</div> : <>
      <div className="crm-detail-head"><span className="detail-logo"><ShoppingBag size={25} /></span><div><span className="section-kicker">COMMANDE / {order.order_number}</span><h1>{String((order.offer_snapshot.client as Record<string, unknown> | undefined)?.company_name ?? 'Client')}</h1><div className="detail-sub"><span className={`commercial-badge commercial-${order.order_status}`}>{orderStatusLabels[order.order_status]}</span><span>{xofAmount(order.amount_xof)} contractuels</span></div></div></div>
      {manager && <div className="crm-head-actions commercial-actions">{order.order_status === 'draft' && <Button disabled={busy} onClick={() => void change('confirmed')}>Confirmer la commande</Button>}{order.order_status === 'confirmed' && <Button disabled={busy} onClick={() => void change('in_progress')}>Marquer en cours</Button>}{order.order_status === 'in_progress' && <Button disabled={busy} onClick={() => void change('completed')}>Marquer terminée</Button>}{['draft','confirmed','in_progress'].includes(order.order_status) && <Button variant="secondary" disabled={busy} onClick={() => void change('cancelled')}>Annuler la commande</Button>}</div>}
      <div className="crm-detail-grid"><div>
        <section className="crm-section"><h2>Contrat conservé</h2><div className="crm-facts"><div><span>Proposition</span><strong>{proposal?.proposal_number ?? '—'}</strong></div><div><span>Offre et version</span><strong>{String(order.offer_snapshot.name ?? 'Offre')} · V{order.offer_version}</strong></div><div><span>Montant contractuel</span><strong>{xofAmount(order.amount_xof)}</strong></div><div><span>Échéancier</span><strong>{paymentPlanLabels[order.payment_plan]}</strong></div><div><span>Conditions particulières</span><strong>{order.contractual_terms || 'Aucune'}</strong></div><div><span>Confirmée le</span><strong>{order.confirmed_at ? when(order.confirmed_at) : 'En attente'}</strong></div></div><p className="commercial-note">Ces conditions sont copiées depuis la proposition acceptée. Une nouvelle version de l’offre ne les modifiera pas.</p>{proposal && <Link className="crm-quick-link" to={`/propositions/${proposal.id}`}>Voir la proposition et son PDF <ArrowRight size={15} /></Link>}</section>
        <section className="crm-section"><h2>Échéancier contractuel attendu</h2>{installments.map(item => <div className="commercial-installment" key={item.id}><div><strong>{item.installment_number === 1 ? 'Acompte attendu' : 'Solde attendu'}</strong><small>{item.trigger_event === 'at_order' ? 'À la commande' : 'À l’étape de livraison acceptée'} · {item.percentage_bps / 100} %</small></div><strong>{xofAmount(item.amount_xof)}</strong></div>)}<p className="commercial-note">Les échéances prévues ne prouvent aucun encaissement.</p><Link className="crm-quick-link" to={`/commandes/${order.id}/paiements`}>Voir paiements, instructions et reçus <ArrowRight size={15} /></Link></section>
        <section className="crm-section"><h2>Historique commercial</h2>{events.map(event => <div className="crm-list-row" key={event.id}><div><strong>{event.event_type.replace(/_/g, ' ')}</strong><small>{when(event.created_at)}</small></div></div>)}</section>
      </div><aside><section className="crm-section"><h2>Paiement réel</h2><div className="commercial-payment-real"><span>Encaissement net vérifié</span><strong>{collected === null ? 'Indisponible' : xofAmount(collected)}</strong></div><p>Solde restant : {collected === null ? 'indisponible' : xofAmount(Math.max(0, order.amount_xof - collected))}. Les déclarations ne sont pas comptées avant vérification.</p><Link className="crm-quick-link" to={`/commandes/${order.id}/paiements`}>Ouvrir le dossier financier <ArrowRight size={15} /></Link></section><section className="crm-section"><h2>Production</h2><p>{productionStatus ? `Statut de production enregistré : ${productionStatus.replace(/_/g, ' ')}. Le statut commercial ne vaut pas livraison.` : 'Aucun projet de production lié à cette commande.'}</p></section></aside></div>
    </>}
  </div>
}
