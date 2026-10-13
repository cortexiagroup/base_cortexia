import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, FileText, Plus, Settings2 } from 'lucide-react'
import { Button } from '../components/ui/button'
import { useAuth } from '../lib/auth'
import { cloneOffer, getOffer, getOffers, getSettings, saveOffer, saveSettings, setOfferStatus } from './api'
import { offerStatusLabels, xofAmount, type CommercialSettings, type Offer, type OfferInput, type OfferStatus } from './types'
import type { PdfPayload } from '../../supabase/functions/_shared/proposal-pdf'

const empty: OfferInput = { name: '', category: '', description: '', price_xof: 0, price_is_starting: false,
  benefits: [], included_services: [], exclusions: [], delivery_days: null, payment_terms: '', validity_days: null }
const split = (value: string) => value.split('\n').map(item => item.trim()).filter(Boolean)
const join = (value: string[]) => (value ?? []).join('\n')

export function OffersPage() {
  const { profile } = useAuth()
  const admin = profile?.role === 'admin'
  const [offers, setOffers] = useState<Offer[]>([])
  const [settings, setSettings] = useState<CommercialSettings | null>(null)
  const [editingSettings, setEditingSettings] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { Promise.all([getOffers(), getSettings()]).then(([items, company]) => { setOffers(items); setSettings(company) }).catch(e => setError(e.message)).finally(() => setLoading(false)) }, [])
  async function updateSettings(event: FormEvent) {
    event.preventDefault(); if (!settings) return
    setBusy(true); setError(null)
    try { await saveSettings({ company_name: settings.company_name, professional_email: settings.professional_email,
      professional_phone: settings.professional_phone, postal_address: settings.postal_address,
      legal_mentions: settings.legal_mentions }); setEditingSettings(false) }
    catch (e) { setError(e instanceof Error ? e.message : 'Coordonnées non enregistrées.') }
    finally { setBusy(false) }
  }
  return <div className="crm-page"><div className="crm-page-head"><div><span className="section-kicker">COMMERCIAL / CATALOGUE</span><h1>Offres commerciales</h1><p>Une version publiée conserve son prix et ses conditions. Les évolutions créent une nouvelle version.</p></div>{admin && <Button asChild><Link to="/offres/nouveau"><Plus size={16} /> Nouvelle offre</Link></Button>}</div>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    {loading ? <div className="crm-empty">Chargement du catalogue…</div> : <div className="commercial-offer-grid">{offers.map(offer => <Link to={`/offres/${offer.id}`} className="commercial-offer-card" key={offer.id}><div className="commercial-offer-card-top"><span className="section-kicker">{offer.category || 'OFFRE'} / V{offer.version}</span><span className={`commercial-badge commercial-${offer.status}`}>{offerStatusLabels[offer.status]}</span></div><FileText size={26} /><h2>{offer.name}</h2><p>{offer.description || 'Description à compléter.'}</p><div className="commercial-offer-price">{offer.price_is_starting && <small>À partir de</small>}<strong>{xofAmount(offer.price_xof)}</strong></div><span className="commercial-offer-open">Voir les conditions <ArrowRight size={16} /></span></Link>)}{offers.length === 0 && <div className="crm-empty">Aucune offre accessible. Un administrateur peut préparer le catalogue.</div>}</div>}
    {admin && settings && <section className="crm-section commercial-settings"><div className="crm-section-head"><div><span className="section-kicker">DOCUMENTS OFFICIELS</span><h2>Coordonnées Cortexia</h2><p>Ces informations apparaissent sur les prochains PDF émis. Ne saisissez que des coordonnées vérifiées.</p></div><Button variant="secondary" onClick={() => setEditingSettings(!editingSettings)}><Settings2 size={15} /> {editingSettings ? 'Fermer' : 'Configurer'}</Button></div>{editingSettings && <form onSubmit={e => void updateSettings(e)} className="crm-form-grid"><label className="crm-field">Nom commercial<input required value={settings.company_name} onChange={e => setSettings({ ...settings, company_name: e.target.value })} /></label><label className="crm-field">Email professionnel<input type="email" value={settings.professional_email ?? ''} onChange={e => setSettings({ ...settings, professional_email: e.target.value || null })} /></label><label className="crm-field">Téléphone<input value={settings.professional_phone ?? ''} onChange={e => setSettings({ ...settings, professional_phone: e.target.value || null })} /></label><label className="crm-field">Adresse professionnelle<input value={settings.postal_address ?? ''} onChange={e => setSettings({ ...settings, postal_address: e.target.value || null })} /></label><label className="crm-field crm-field-wide">Mentions légales vérifiées<textarea value={settings.legal_mentions ?? ''} onChange={e => setSettings({ ...settings, legal_mentions: e.target.value || null })} /></label><Button type="submit" disabled={busy}>Enregistrer les coordonnées</Button></form>}</section>}
  </div>
}

export function OfferEditor() {
  const { id } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [offer, setOffer] = useState<Offer | null>(null)
  const [form, setForm] = useState<OfferInput>(empty)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(Boolean(id))
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => { if (!id) return; getOffer(id).then(item => { setOffer(item); setForm({ name: item.name, category: item.category ?? '', description: item.description ?? '', price_xof: item.price_xof, price_is_starting: item.price_is_starting, benefits: item.benefits, included_services: item.included_services, exclusions: item.exclusions, delivery_days: item.delivery_days, payment_terms: item.payment_terms ?? '', validity_days: item.validity_days }) }).catch(e => setError(e.message)).finally(() => setLoading(false)) }, [id])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  if (profile?.role !== 'admin') return <div className="crm-alert">Édition réservée à l’administrateur.</div>
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null)
    try { const saved = await saveOffer(id ?? null, form); navigate(`/offres/${saved}`) }
    catch (e) { setError(e instanceof Error ? e.message : 'Offre non enregistrée.') }
    finally { setBusy(false) }
  }
  async function showPreview() {
    setBusy(true); setError(null)
    try {
      const company = await getSettings()
      const payload: PdfPayload = { settings: company, proposal: {
        proposal_number: 'APERÇU - NON ÉMIS', created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString(),
        offer_version: offer?.version ?? 1, offer_snapshot: { ...form }, client_snapshot: { company_name: 'Destinataire non sélectionné' },
        service_description: form.description || form.name, base_price_xof: form.price_xof, discount_xof: 0,
        amount_xof: form.price_xof, payment_plan: 'full_upfront', special_terms: null,
        delivery_days: form.delivery_days, status: 'draft',
      } }
      const { renderProposalPdf } = await import('../../supabase/functions/_shared/proposal-pdf')
      const bytes = await renderProposalPdf(payload, undefined, true)
      setPreview(URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })))
    } catch (e) { setError(e instanceof Error ? e.message : 'Aperçu indisponible.') }
    finally { setBusy(false) }
  }
  return <div className="crm-page"><Link className="crm-back" to={id ? `/offres/${id}` : '/offres'}><ArrowLeft size={16} /> Catalogue</Link><div className="crm-page-head"><div><span className="section-kicker">OFFRE / BROUILLON</span><h1>{id ? 'Modifier la version' : 'Créer une offre'}</h1><p>Le prix et les prestations d’une version publiée ne seront plus modifiables.</p></div></div>
    {loading ? <div className="crm-empty">Chargement…</div> : <form className="crm-form" onSubmit={e => void submit(e)}><div className="crm-form-grid"><label className="crm-field">Nom de l’offre *<input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label><label className="crm-field">Catégorie<input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} /></label><label className="crm-field">Prix publié en FCFA *<input type="number" min="0" step="1" required value={form.price_xof} onChange={e => setForm({ ...form, price_xof: Number(e.target.value) })} /></label><label className="crm-field">Type de prix<select value={form.price_is_starting ? 'starting' : 'fixed'} onChange={e => setForm({ ...form, price_is_starting: e.target.value === 'starting' })}><option value="fixed">Prix fixe</option><option value="starting">Prix de départ</option></select></label><label className="crm-field">Délai indicatif (jours)<input type="number" min="0" value={form.delivery_days ?? ''} onChange={e => setForm({ ...form, delivery_days: e.target.value ? Number(e.target.value) : null })} /></label><label className="crm-field">Validité conseillée (jours)<input type="number" min="1" max="365" value={form.validity_days ?? ''} onChange={e => setForm({ ...form, validity_days: e.target.value ? Number(e.target.value) : null })} /></label><label className="crm-field crm-field-wide">Description<textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label><label className="crm-field">Bénéfices (un par ligne)<textarea rows={5} value={join(form.benefits)} onChange={e => setForm({ ...form, benefits: split(e.target.value) })} /></label><label className="crm-field">Prestations incluses (une par ligne)<textarea rows={5} value={join(form.included_services)} onChange={e => setForm({ ...form, included_services: split(e.target.value) })} /></label><label className="crm-field">Exclusions (une par ligne)<textarea rows={5} value={join(form.exclusions)} onChange={e => setForm({ ...form, exclusions: split(e.target.value) })} /></label><label className="crm-field">Conditions de paiement<textarea rows={5} value={form.payment_terms} onChange={e => setForm({ ...form, payment_terms: e.target.value })} /></label></div>{error && <div className="crm-alert" role="alert">{error}</div>}<div className="crm-form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={() => void showPreview()}>Aperçu PDF</Button><Button type="submit" disabled={busy || !Number.isSafeInteger(form.price_xof)}>{busy ? 'Traitement…' : 'Enregistrer le brouillon'}</Button></div>{preview && <iframe className="commercial-pdf-preview" src={preview} title="Aperçu PDF de l’offre" />}</form>}
  </div>
}

export function OfferDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const admin = profile?.role === 'admin'
  const [offer, setOffer] = useState<Offer | null>(null)
  const [history, setHistory] = useState<Offer[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => { if (!id) return; Promise.all([getOffer(id), getOffers()]).then(([item, items]) => { setOffer(item); setHistory(items.filter(other => other.family_id === item.family_id).sort((a, b) => b.version - a.version)) }).catch(e => setError(e.message)) }, [id, refresh])
  async function change(status: OfferStatus) { if (!id) return; setBusy(true); setError(null); try { await setOfferStatus(id, status); setRefresh(x => x + 1) } catch (e) { setError(e instanceof Error ? e.message : 'Statut inchangé.') } finally { setBusy(false) } }
  async function clone() { if (!id) return; setBusy(true); setError(null); try { navigate(`/offres/${await cloneOffer(id)}/modifier`) } catch (e) { setError(e instanceof Error ? e.message : 'Version non créée.') } finally { setBusy(false) } }
  return <div className="crm-page"><Link className="crm-back" to="/offres"><ArrowLeft size={16} /> Catalogue</Link>{error && <div className="crm-alert" role="alert">{error}</div>}{!offer ? <div className="crm-empty">Chargement de l’offre…</div> : <><div className="crm-detail-head"><span className="detail-logo"><FileText size={25} /></span><div><span className="section-kicker">{offer.category || 'OFFRE'} / VERSION {offer.version}</span><h1>{offer.name}</h1><div className="detail-sub"><span className={`commercial-badge commercial-${offer.status}`}>{offerStatusLabels[offer.status]}</span><span>{offer.price_is_starting ? 'À partir de ' : ''}{xofAmount(offer.price_xof)}</span></div></div></div><div className="crm-head-actions commercial-actions">{admin && offer.status === 'draft' && <><Button asChild variant="secondary"><Link to={`/offres/${offer.id}/modifier`}>Modifier</Link></Button><Button disabled={busy} onClick={() => void change('active')}>Publier</Button></>}{admin && offer.status === 'active' && <Button variant="secondary" disabled={busy} onClick={() => void change('suspended')}>Suspendre</Button>}{admin && offer.status === 'suspended' && <><Button disabled={busy} onClick={() => void change('active')}>Réactiver</Button><Button variant="secondary" disabled={busy} onClick={() => void change('archived')}>Archiver</Button></>}{admin && offer.status !== 'draft' && <Button variant="secondary" disabled={busy} onClick={() => void clone()}>Créer une nouvelle version</Button>}</div><div className="crm-detail-grid"><div><section className="crm-section"><h2>Description</h2><p>{offer.description || 'Non renseignée.'}</p><div className="crm-facts"><div><span>Délai indicatif</span><strong>{offer.delivery_days == null ? 'Non défini' : `${offer.delivery_days} jours`}</strong></div><div><span>Conditions de paiement</span><strong>{offer.payment_terms || 'À définir pour la proposition'}</strong></div></div></section>{[['Bénéfices', offer.benefits], ['Prestations incluses', offer.included_services], ['Exclusions', offer.exclusions]].map(([label, values]) => <section className="crm-section" key={label as string}><h2>{label as string}</h2><ul className="commercial-list">{(values as string[]).map(item => <li key={item}>{item}</li>)}{(values as string[]).length === 0 && <li>Non renseigné</li>}</ul></section>)}</div><aside><section className="crm-section"><h2>Versions conservées</h2><div className="commercial-history">{history.map(item => <Link key={item.id} to={`/offres/${item.id}`}><strong>Version {item.version}</strong><span>{xofAmount(item.price_xof)} · {offerStatusLabels[item.status]}</span></Link>)}</div></section></aside></div></>}</div>
}
