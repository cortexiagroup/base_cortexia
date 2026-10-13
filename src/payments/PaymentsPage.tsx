import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Download, Settings2, ShieldCheck } from 'lucide-react'
import { Button } from '../components/ui/button'
import { useAuth } from '../lib/auth'
import { protectExcelText } from '../crm/excel'
import { xofAmount, type Order } from '../commercial/types'
import { getFinanceOrders, getLedger, getPayments, listVerifiers } from './api'
import { ledgerBalance, methodLabels, statusLabels, type LedgerEntry, type Payment, type PaymentMethod } from './types'

const when = (input: string) => new Intl.DateTimeFormat('fr-TG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lome' }).format(new Date(input))

export function PaymentsPage({ pendingOnly = false }: { pendingOnly?: boolean }) {
  const { profile } = useAuth()
  const [payments, setPayments] = useState<Payment[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [canVerify, setCanVerify] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [method, setMethod] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  useEffect(() => {
    Promise.all([getPayments(), getFinanceOrders(), getLedger(), listVerifiers()])
      .then(([p, o, l, v]) => { setPayments(p); setOrders(o); setLedger(l); setCanVerify(profile?.role === 'admin' || (profile?.role === 'sales_manager' && v.some(item => item.user_id === profile.id && item.enabled))) })
      .catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [profile?.id, profile?.role])
  const orderMap = useMemo(() => Object.fromEntries(orders.map(item => [item.id, item])), [orders])
  const shown = payments.filter(item => (!pendingOnly || item.status === 'pending') &&
    (!status || item.status === status) && (!method || item.method === method) &&
    (!from || item.declared_at.slice(0, 10) >= from) && (!to || item.declared_at.slice(0, 10) <= to) &&
    (!search || `${orderMap[item.order_id]?.order_number ?? ''} ${item.transaction_reference ?? ''} ${item.verification_reference ?? ''}`.toLowerCase().includes(search.toLowerCase())))
  const windowEntries = ledger.filter(item => (!from || item.recorded_at.slice(0, 10) >= from) && (!to || item.recorded_at.slice(0, 10) <= to))
  const net = windowEntries.reduce((sum, entry) => sum + entry.amount_xof, 0)
  const byMethod = (key: PaymentMethod) => windowEntries.filter(item => item.entry_kind === 'collection' && payments.find(payment => payment.id === item.payment_id)?.method === key).reduce((sum, entry) => sum + entry.amount_xof, 0)
  const activeOrders = orders.filter(item => ['confirmed', 'in_progress', 'completed'].includes(item.order_status))
  const partial = activeOrders.filter(item => { const balance = ledgerBalance(item.amount_xof, ledger.filter(entry => entry.order_id === item.id)); return balance.collected > 0 && balance.remaining > 0 }).length
  const due = activeOrders.reduce((sum, item) => sum + ledgerBalance(item.amount_xof, ledger.filter(entry => entry.order_id === item.id)).remaining, 0)
  async function exportVisible() {
    try {
      const { default: writeExcelFile } = await import('write-excel-file/browser')
      const rows = shown.map(item => [protectExcelText(orderMap[item.order_id]?.order_number ?? ''),
        xofAmount(item.amount_xof), methodLabels[item.method], statusLabels[item.status],
        protectExcelText(item.transaction_reference ?? ''), when(item.declared_at),
        item.verified_at ? when(item.verified_at) : '', protectExcelText(item.verification_source ?? '')])
      await writeExcelFile([{ sheet: 'Paiements autorisés', data: [['Commande','Montant déclaré','Moyen','Statut','Référence déclarée','Date déclaration','Date vérification','Source'], ...rows] }])
        .toFile(`paiements-cortexia-${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Export impossible.') }
  }
  if (pendingOnly && !canVerify && !loading) return <div className="crm-page"><div className="crm-alert">Vérification réservée aux personnes habilitées.</div></div>
  return <div className="crm-page finance-page"><div className="crm-page-head"><div><span className="section-kicker">FINANCE / DONNÉES RÉELLES</span><h1>{pendingOnly ? 'Paiements à vérifier' : 'Paiements et reçus'}</h1><p>Une déclaration ou un justificatif ne prouve jamais l’encaissement. Les totaux proviennent du journal vérifié.</p></div><div className="crm-head-actions">{canVerify && <Button variant="secondary" asChild><Link to="/paiements/a-verifier"><ShieldCheck size={15} /> À vérifier</Link></Button>}{profile?.role === 'admin' && <Button variant="secondary" asChild><Link to="/parametres/moyens-paiement"><Settings2 size={15} /> Comptes officiels</Link></Button>}{['admin','sales_manager'].includes(profile?.role ?? '') && <Button variant="secondary" onClick={() => void exportVisible()}><Download size={15} /> Export Excel</Button>}</div></div>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    {loading ? <div className="crm-empty">Chargement des écritures…</div> : <><div className="finance-kpis"><div><span>Encaissement net vérifié{from || to ? ' · période filtrée' : ''}</span><strong>{xofAmount(net)}</strong></div><div><span>Mobile Money confirmé</span><strong>{xofAmount(byMethod('merchant_account'))}</strong></div><div><span>Banque confirmée</span><strong>{xofAmount(byMethod('bank_transfer'))}</strong></div><div><span>Espèces confirmées</span><strong>{xofAmount(byMethod('cash'))}</strong></div><div><span>Déclarations en attente</span><strong>{payments.filter(item => item.status === 'pending').length}</strong></div><div><span>Commandes partiellement payées</span><strong>{partial}</strong></div><div><span>Soldes contractuels restants</span><strong>{xofAmount(due)}</strong></div></div>
      <div className="crm-toolbar finance-toolbar"><div className="crm-search"><input aria-label="Rechercher" placeholder="Commande ou référence…" value={search} onChange={e => setSearch(e.target.value)} /></div><select aria-label="Statut" value={status} onChange={e => setStatus(e.target.value)}><option value="">Tous les statuts</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select aria-label="Moyen" value={method} onChange={e => setMethod(e.target.value)}><option value="">Tous les moyens</option>{Object.entries(methodLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><label>Du <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>Au <input type="date" value={to} onChange={e => setTo(e.target.value)} /></label></div>
      <div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Commande</th><th>Client</th><th>Montant déclaré</th><th>Moyen</th><th>Référence</th><th>Statut</th><th>Date</th><th /></tr></thead><tbody>{shown.map(item => { const order = orderMap[item.order_id]; const client = order?.offer_snapshot.client as Record<string, unknown> | undefined; return <tr key={item.id}><td><strong>{order?.order_number ?? item.order_id.slice(0, 8)}</strong></td><td>{String(client?.company_name ?? '—')}</td><td>{xofAmount(item.amount_xof)}</td><td>{methodLabels[item.method]}</td><td>{item.transaction_reference ?? '—'}</td><td><span className={`finance-pill is-${item.status}`}>{statusLabels[item.status]}</span></td><td>{when(item.declared_at)}</td><td><Link to={`/paiements/${item.id}`} aria-label="Ouvrir le paiement"><ArrowRight size={16} /></Link></td></tr> })}</tbody></table>{shown.length === 0 && <div className="crm-empty">Aucune déclaration correspondante.</div>}</div>
      <p className="commercial-note">Les montants par moyen affichent les collectes brutes confirmées. Le total net tient compte des corrections et remboursements exécutés.</p>
    </>}
  </div>
}
