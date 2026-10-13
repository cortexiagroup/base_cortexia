import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ArrowRight, ChevronDown, CircleHelp, Compass, LayoutGrid, LogOut, Menu, RotateCcw, Search, X, UsersRound, CalendarDays, ShoppingBag, WalletCards } from 'lucide-react'
import { Button } from './components/ui/button'
import { useAuth, roleLabels } from './lib/auth'
import { getDashboardStats, getInspectionData, type DashboardStats, type InspectionData } from './lib/dashboard'
import { modules, zones, type ZoneId } from './lib/modules'
import { supabase } from './lib/supabase'
import { xof } from './lib/utils'
import { ProspectsPage, LeadEditor } from './crm/Prospects'
import { LeadDetail } from './crm/LeadDetail'
import { SalesPage, SalesDetail } from './crm/Sales'
import { ActivitiesPage } from './crm/Activities'
import { ImportsPage } from './crm/Imports'
import { OffersPage, OfferEditor, OfferDetail } from './commercial/Offers'
import { ProposalsPage, ProposalEditor, ProposalDetail } from './commercial/Proposals'
import { OrdersPage, OrderDetail } from './commercial/Orders'
import { PaymentsPage } from './payments/PaymentsPage'
import { PaymentDetail } from './payments/PaymentDetail'
import { PaymentSettings } from './payments/PaymentSettings'
import { OrderPayments } from './payments/OrderPayments'
import { FieldFinancePage } from './field/FieldFinancePage'
import { CommissionPage } from './field/CommissionPage'
import { ReportsPage } from './field/ReportsPage'
import { fieldOverview } from './field/api'

const CommandScene = lazy(() => import('./components/CommandScene'))
const zoneModule = (id: ZoneId) => modules.find(module => module.id === zones.find(zone => zone.id === id)?.moduleId)!

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

function Logo() {
  return <span className="brand-mark" aria-hidden="true"><span className="brand-core" /></span>
}

function AuthFrame({ children, register = false }: { children: ReactNode; register?: boolean }) {
  return <div className="login-page">
    <header className="login-header"><Link to="/connexion" className="login-brand"><Logo /><span>Cortexia <strong>Base</strong></span></Link><Link className="login-header-action" to={register ? '/connexion' : '/inscription'}>{register ? 'Se connecter' : "S’inscrire"} <ArrowRight size={15} /></Link></header>
    <div className="login-layout">
      <section className="login-intro"><div className="eyebrow">CORTEXIA / GESTION COMMERCIALE</div><h1>Votre activité,<br /><em>en perspective.</em></h1><p>Du premier contact à la livraison, retrouvez le parcours commercial dans un seul espace de travail.</p><div className="login-motif" aria-hidden="true"><span /><span /><span /><span /><span /><span /></div></section>
      {children}
    </div>
  </div>
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const { session } = useAuth()
  if (session) return <Navigate to="/" replace />
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setPending(true); setMessage(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setMessage(error.message)
    setPending(false)
  }
  return <AuthFrame>
      <form className="login-form" onSubmit={handleSubmit}><span className="section-kicker">ACCÈS SÉCURISÉ</span><h2>Connexion</h2><p>Connectez-vous avec votre adresse e-mail et votre mot de passe.</p>
        <label htmlFor="email">Adresse e-mail</label><input id="email" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} placeholder="nom@cortexia.tg" />
        <label htmlFor="password">Mot de passe</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} placeholder="Votre mot de passe" />
        {message && <div className="form-error" role="alert">{message}</div>}
        {!supabase && <div className="form-error" role="alert">Connexion Supabase non configurée. Renseignez VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY.</div>}
        <Button type="submit" disabled={!supabase || pending}>{pending ? 'Connexion en cours…' : 'Se connecter'} <ArrowRight size={17} /></Button>
        <div className="login-form-footer">Pas encore de compte ? <Link to="/inscription">S’inscrire</Link></div>
      </form>
  </AuthFrame>
}

function Signup() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<'email' | 'approval' | null>(null)
  const { session } = useAuth()
  if (session && !pending && !success) return <Navigate to="/" replace />
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase) return
    if (fullName.trim().length < 2) { setError('Renseignez votre nom complet.'); return }
    if (password.length < 8) { setError('Le mot de passe doit contenir au moins 8 caractères.'); return }
    if (password !== confirmation) { setError('Les mots de passe ne correspondent pas.'); return }
    setPending(true); setError(null)
    try {
      const { data: ready, error: readinessError } = await supabase.rpc('cortexia_signup_ready')
      if (readinessError || ready !== true) throw new Error("L’inscription n’est pas encore activée sur ce projet Supabase. Contactez l’administrateur.")
      const { data, error: signupError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(), password,
        options: { data: { full_name: fullName.trim() }, emailRedirectTo: `${window.location.origin}/connexion` },
      })
      if (signupError) throw signupError
      if (data.session) await supabase.auth.signOut()
      setSuccess(data.session ? 'approval' : 'email')
      setPassword(''); setConfirmation('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "L’inscription a échoué. Réessayez.")
    } finally { setPending(false) }
  }
  return <AuthFrame register>
    <form className="login-form" onSubmit={handleSubmit}><span className="section-kicker">REJOINDRE CORTEXIA</span><h2>Créer un compte</h2><p>Inscrivez-vous, confirmez votre adresse e-mail, puis attendez la validation de l’administrateur.</p>
      {success ? <div className="form-success" role="status">Votre demande est enregistrée. {success === 'email' ? 'Vérifiez votre boîte e-mail pour confirmer votre adresse. ' : ''}Votre accès sera disponible après validation par un administrateur. <Link to="/connexion">Aller à la connexion</Link></div> : <>
        <label htmlFor="signup-name">Nom complet</label><input id="signup-name" type="text" autoComplete="name" minLength={2} required value={fullName} onChange={event => setFullName(event.target.value)} placeholder="Votre nom complet" />
        <label htmlFor="signup-email">Adresse e-mail</label><input id="signup-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="nom@cortexia.tg" />
        <label htmlFor="signup-password">Mot de passe</label><input id="signup-password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)} placeholder="8 caractères minimum" />
        <label htmlFor="signup-confirmation">Confirmer le mot de passe</label><input id="signup-confirmation" type="password" autoComplete="new-password" required value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder="Répétez le mot de passe" />
        {error && <div className="form-error" role="alert">{error}</div>}
        {!supabase && <div className="form-error" role="alert">Connexion Supabase non configurée. Renseignez VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY.</div>}
        <Button type="submit" disabled={!supabase || pending}>{pending ? 'Inscription en cours…' : "S’inscrire"} <ArrowRight size={17} /></Button>
      </>}
      <div className="login-form-footer">Déjà inscrit ? <Link to="/connexion">Se connecter</Link></div>
    </form>
  </AuthFrame>
}

function Protected({ children }: { children: ReactNode }) {
  const { session, profile, loading, error } = useAuth()
  if (loading) return <div className="app-loading">Chargement de votre espace…</div>
  if (!session) return <Navigate to="/connexion" replace />
  if (!profile || !profile.is_active) return <div className="access-state"><Logo /><h1>Accès indisponible</h1><p>{error ?? 'Votre profil doit être activé par un administrateur.'}</p><Button onClick={() => void supabase?.auth.signOut()}>Déconnexion</Button></div>
  return <>{children}</>
}

function Shell({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth()
  const location = useLocation()
  const current = modules.find(module => module.path === location.pathname || (module.path !== '/' && location.pathname.startsWith(`${module.path}/`))) ?? modules[0]
  const [menuOpen, setMenuOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  useEffect(() => setMenuOpen(false), [location.pathname])
  return <div className="app-shell">
    <header className="topbar">
      <Link to="/" className="top-brand"><Logo /><span>Cortexia <strong>Base</strong></span></Link>
      <span className="top-divider" />
      <Button variant="ghost" size="icon" className="mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="Ouvrir les modules"><Menu size={21} /></Button>
      <div className="breadcrumb"><span>ESPACE DE TRAVAIL</span><strong>{current.label}</strong></div>
      <div className="top-spacer" />
      <div className="search-future" aria-label="Recherche bientôt disponible"><Search size={17} /><span>Rechercher dans Cortexia</span><kbd>À VENIR</kbd></div>
      <button className="account-trigger" type="button" onClick={() => setAccountOpen(!accountOpen)} aria-expanded={accountOpen}><span className="avatar">{profile?.full_name?.slice(0, 1).toUpperCase()}</span><span className="account-name"><strong>{profile?.full_name}</strong><small>{profile && roleLabels[profile.role]}</small></span><ChevronDown size={15} /></button>
      {accountOpen && <div className="account-menu"><div><strong>{profile?.full_name}</strong><small>{profile && roleLabels[profile.role]}</small></div><button onClick={() => void signOut()}><LogOut size={16} /> Se déconnecter</button></div>}
    </header>
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
      <div className="sidebar-caption">NAVIGATION</div>
      <nav aria-label="Modules Cortexia">{modules.map(module => <NavLink key={module.id} to={module.path} end={module.id === 'dashboard'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><module.icon size={18} strokeWidth={1.9} /><span>{module.label}</span></NavLink>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-help"><CircleHelp size={19} /><div><strong>Besoin d’aide ?</strong><small>Contactez votre administrateur.</small></div></div><span>CORTEXIA BASE</span></div>
    </aside>
    {menuOpen && <button className="sidebar-backdrop" aria-label="Fermer les modules" onClick={() => setMenuOpen(false)} />}
    <main className="main-content">{children}</main>
  </div>
}

function KpiStrip({ stats, loading, error }: { stats: DashboardStats | null; loading: boolean; error: string | null }) {
  const items = [
    { label: 'Prospects actifs', value: stats && xof.format(stats.activeLeads), icon: UsersRound, tone: 'blue' },
    { label: 'Rendez-vous à venir', value: stats && xof.format(stats.scheduledMeetings), icon: CalendarDays, tone: 'blue' },
    { label: 'Commandes confirmées', value: stats && xof.format(stats.confirmedOrders), icon: ShoppingBag, tone: 'blue' },
    { label: 'Encaissement net vérifié', value: stats && `${xof.format(stats.confirmedPaymentsXof)} FCFA`, icon: WalletCards, tone: 'green' },
  ]
  return <div className="kpi-strip" aria-label="Indicateurs commerciaux">{items.map((item, index) => <div className="kpi-item" key={item.label}><span className={`kpi-icon ${item.tone}`}><item.icon size={19} strokeWidth={2} /></span><div><span className="kpi-label">{item.label}</span><strong className="kpi-value">{error ? 'Indisponible' : loading ? '…' : item.value}</strong></div>{index < items.length - 1 && <span className="kpi-divider" />}</div>)}</div>
}

function SceneFallback({ onSelect, selected }: { onSelect: (id: ZoneId) => void; selected: ZoneId | null }) {
  return <div className="scene-fallback"><div className="fallback-grid">{zones.map(zone => <button type="button" className={`fallback-zone ${selected === zone.id ? 'selected' : ''}`} onClick={() => onSelect(zone.id)} key={zone.id}><span>{zone.number}</span><strong>{zone.label}</strong><small>{zone.description}</small><ArrowRight size={16} /></button>)}</div></div>
}

function Inspection({ id, onClose, refreshToken }: { id: ZoneId; onClose: () => void; refreshToken: number }) {
  const [data, setData] = useState<InspectionData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    setData(null); setError(null); setLoading(true)
    getInspectionData(id).then(result => { if (active) setData(result) }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Erreur de chargement') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id, refreshToken])
  const zone = zones.find(item => item.id === id)!
  const module = zoneModule(id)
  return <aside className="inspection" aria-label={`Détails : ${zone.label}`}><div className="inspection-head"><span className="section-kicker">ZONE {zone.number} / 06</span><button type="button" aria-label="Fermer le panneau" onClick={onClose}><X size={18} /></button></div><div className="inspection-icon"><module.icon size={25} /></div><h2>{zone.label}</h2><p>{zone.description}</p><div className="inspection-rule" />
    {loading ? <div className="inspection-loading">Chargement des données…</div> : error ? <div className="inspection-error" role="alert">Données indisponibles : {error}</div> : data && <><div className="inspection-metric"><span>{data.metric}</span><strong>{data.value}</strong></div><div className="inspection-details">{data.details.map(row => <div key={row.label}><span>{row.label}</span><strong>{row.value}</strong></div>)}</div></>}
    <Link className="inspection-link" to={module.path}>Ouvrir le module <ArrowRight size={17} /></Link>
  </aside>
}

function Dashboard() {
  const { profile } = useAuth()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ZoneId | null>(null)
  const [resetSignal, setResetSignal] = useState(0)
  const [inspectionRefresh, setInspectionRefresh] = useState(0)
  const [fieldStats, setFieldStats] = useState<Awaited<ReturnType<typeof fieldOverview>> | null>(null)
  const [force2d, setForce2d] = useState(() => window.matchMedia('(max-width: 640px)').matches)
  const [supportsWebgl, setSupportsWebgl] = useState(true)
  useEffect(() => {
    try { const canvas = document.createElement('canvas'); setSupportsWebgl(Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))) } catch { setSupportsWebgl(false) }
    let active = true
    const refresh = () => { setInspectionRefresh(value => value + 1); getDashboardStats().then(result => { if (active) { setStats(result); setError(null) } }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Erreur de connexion') }).finally(() => { if (active) setLoading(false) }); if (profile?.role==='admin') void fieldOverview().then(result => { if(active)setFieldStats(result) }).catch(() => { if(active)setFieldStats(null) }) }
    refresh()
    window.addEventListener('cortexia:crm-changed', refresh)
    return () => { active = false; window.removeEventListener('cortexia:crm-changed', refresh) }
  }, [profile?.role])
  const use2d = force2d || !supportsWebgl
  return <div className="dashboard"><div className="page-heading"><div><span className="section-kicker">CORTEXIA COMMAND CENTER</span><h1>Vue d’ensemble</h1><p>Votre parcours commercial, du premier échange à la livraison.</p></div><span className="live-note"><span /> DONNÉES DE VOTRE ESPACE</span></div>
    {error && <div className="data-error" role="alert">Impossible de charger les indicateurs : {error}</div>}
    <section className="command-stage" aria-label="Parcours commercial interactif">
      <KpiStrip stats={stats} loading={loading} error={error} />
      <div className="scene-area">
        <div className="scene-heading"><span className="scene-overline">PARCOURS CORTEXIA</span><h2>Six étapes. Une vision claire.</h2><p>Sélectionnez un espace pour explorer son activité.</p></div>
        <div className="scene-tools"><button onClick={() => setForce2d(!force2d)} disabled={!supportsWebgl} aria-label={use2d ? 'Afficher la vue 3D' : 'Afficher la vue 2D'}>{use2d ? 'Vue 3D' : 'Vue 2D'}</button><button onClick={() => { setSelected(null); setResetSignal(x => x + 1) }} aria-label="Recentrer la scène"><RotateCcw size={17} /></button></div>
        {use2d ? <SceneFallback selected={selected} onSelect={setSelected} /> : <SceneBoundary fallback={<SceneFallback selected={selected} onSelect={setSelected} />}><Suspense fallback={<div className="scene-loading">Chargement de la scène…</div>}><CommandScene selected={selected} onSelect={setSelected} resetSignal={resetSignal} /></Suspense></SceneBoundary>}
        <div className="scene-hint"><Compass size={15} /> {use2d ? 'Sélectionnez une étape' : 'Glisser pour orienter · Molette pour zoomer'}</div>
      </div>
      {selected && <Inspection id={selected} refreshToken={inspectionRefresh} onClose={() => setSelected(null)} />}
    </section>
    <div className="zone-access"><div className="zone-access-title"><LayoutGrid size={18} /><strong>Accès aux étapes</strong><span>Sélection possible au clavier</span></div><div className="zone-buttons">{zones.map(zone => <button key={zone.id} className={selected === zone.id ? 'selected' : ''} onClick={() => setSelected(zone.id)}><span>{zone.number}</span>{zone.label}<ArrowRight size={14} /></button>)}</div></div>
    {profile?.role==='admin'&&fieldStats&&<section className="field-admin-strip" aria-label="Pilotage financier du terrain"><div><span>Transport autorisé</span><strong>{xof.format(fieldStats.transportAuthorized)} FCFA</strong></div><div><span>Avances remises</span><strong>{xof.format(fieldStats.advancesDisbursed)} FCFA</strong></div><div><span>Dépenses justifiées</span><strong>{xof.format(fieldStats.expensesJustified)} FCFA</strong></div><div><span>À régulariser</span><strong>{xof.format(fieldStats.advancesToRegularize)} FCFA</strong></div><div><span>Commissions payables</span><strong>{xof.format(fieldStats.commissionsPayable)} FCFA</strong></div><Link to="/rapports">Analyse détaillée <ArrowRight size={14}/></Link></section>}
  </div>
}

function ModulePage({ moduleId }: { moduleId: string }) {
  const module = modules.find(item => item.id === moduleId)!
  return <div className="module-page"><div className="page-heading"><div><span className="section-kicker">MODULE CORTEXIA</span><h1>{module.label}</h1><p>{module.description}</p></div></div><section className="module-pending"><div className="module-icon"><module.icon size={31} strokeWidth={1.6} /></div><span className="section-kicker">PROCHAINE ÉTAPE</span><h2>Ce module arrive bientôt.</h2><p>Son espace est réservé dans Cortexia Base. Les données et actions seront disponibles lors de son implémentation.</p><Link to="/" className="module-back">Revenir au Command Center <ArrowRight size={16} /></Link></section></div>
}

export default function App() {
  const page = (content: ReactNode) => <Protected><Shell>{content}</Shell></Protected>
  return <Routes><Route path="/connexion" element={<Login />} /><Route path="/inscription" element={<Signup />} /><Route path="/" element={page(<Dashboard />)} />
    <Route path="/prospects" element={page(<ProspectsPage />)} /><Route path="/prospects/nouveau" element={page(<LeadEditor />)} /><Route path="/prospects/:id/modifier" element={page(<LeadEditor />)} /><Route path="/prospects/:id" element={page(<LeadDetail />)} />
    <Route path="/commerciaux" element={page(<SalesPage />)} /><Route path="/commerciaux/:id" element={page(<SalesDetail />)} /><Route path="/activites" element={page(<ActivitiesPage />)} /><Route path="/imports" element={page(<ImportsPage />)} />
    <Route path="/offres" element={page(<OffersPage />)} /><Route path="/offres/nouveau" element={page(<OfferEditor />)} /><Route path="/offres/:id/modifier" element={page(<OfferEditor />)} /><Route path="/offres/:id" element={page(<OfferDetail />)} />
    <Route path="/propositions" element={page(<ProposalsPage />)} /><Route path="/propositions/:id/modifier" element={page(<ProposalEditor />)} /><Route path="/propositions/:id" element={page(<ProposalDetail />)} /><Route path="/prospects/:leadId/proposition/nouvelle" element={page(<ProposalEditor />)} />
    <Route path="/commandes" element={page(<OrdersPage />)} /><Route path="/commandes/:id" element={page(<OrderDetail />)} />
    <Route path="/commandes/:id/paiements" element={page(<OrderPayments />)} />
    <Route path="/paiements" element={page(<PaymentsPage />)} /><Route path="/paiements/a-verifier" element={page(<PaymentsPage pendingOnly />)} /><Route path="/paiements/:id" element={page(<PaymentDetail />)} />
    <Route path="/parametres/moyens-paiement" element={page(<PaymentSettings />)} />
    <Route path="/depenses" element={page(<FieldFinancePage />)} />
    <Route path="/commissions" element={page(<CommissionPage />)} />
    <Route path="/rapports" element={page(<ReportsPage />)} />
    {modules.filter(module => !['dashboard', 'prospects', 'sales', 'activities', 'imports', 'offers', 'proposals', 'orders', 'payments', 'expenses', 'commissions', 'reports'].includes(module.id)).map(module => <Route key={module.id} path={module.path} element={page(<ModulePage moduleId={module.id} />)} />)}<Route path="*" element={<Navigate to="/" replace />} /></Routes>
}
