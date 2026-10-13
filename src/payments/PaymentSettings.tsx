import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, ShieldCheck, WalletCards } from 'lucide-react'
import { Button } from '../components/ui/button'
import { useAuth } from '../lib/auth'
import { getSalesProfiles } from '../crm/api'
import { getReceiptPrefix, listAccounts, listVerifiers, saveAccount, setReceiptPrefix, setVerifier } from './api'
import { methodLabels, type AccountInput, type PaymentAccount, type PaymentMethod } from './types'
import type { SalesProfile } from '../crm/types'

const blank: AccountInput = { method: 'merchant_account', provider_name: null, holder_name: null,
  account_identifier: null, client_instructions: '', cash_responsible_id: null, is_active: false, internal_notes: null }

export function PaymentSettings() {
  const { profile } = useAuth()
  const [accounts, setAccounts] = useState<PaymentAccount[]>([])
  const [sales, setSales] = useState<SalesProfile[]>([])
  const [verifiers, setVerifiers] = useState<{ user_id: string; enabled: boolean }[]>([])
  const [receiptPrefix, setPrefix] = useState('CTX-REC')
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState<AccountInput>(blank)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => { if (profile?.role !== 'admin') return
    Promise.all([listAccounts(), getSalesProfiles(), listVerifiers(), getReceiptPrefix()])
      .then(([a, s, v, p]) => { setAccounts(a); setSales(s); setVerifiers(v); setPrefix(p) })
      .catch(e => setError(e.message))
  }, [profile?.role, refresh])
  if (profile?.role !== 'admin') return <div className="crm-page"><div className="crm-alert">Configuration réservée à l’administrateur.</div></div>
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null)
    try { await saveAccount(editing, form); setEditing(null); setForm(blank); setRefresh(x => x + 1) }
    catch (e) { setError(e instanceof Error ? e.message : 'Compte non enregistré.') }
    finally { setBusy(false) }
  }
  async function toggleVerifier(userId: string, enabled: boolean) {
    setBusy(true); setError(null)
    try { await setVerifier(userId, enabled); setRefresh(x => x + 1) }
    catch (e) { setError(e instanceof Error ? e.message : 'Permission non modifiée.') }
    finally { setBusy(false) }
  }
  return <div className="crm-page finance-page"><Link className="crm-back" to="/paiements"><ArrowLeft size={16} /> Paiements</Link>
    <div className="crm-page-head"><div><span className="section-kicker">PARAMÈTRES / FINANCE</span><h1>Moyens de paiement officiels</h1><p>Seules les coordonnées vérifiées par Cortexia doivent être activées et communiquées aux clients.</p></div><Button onClick={() => { setEditing(''); setForm(blank) }}><Plus size={16} /> Ajouter un compte</Button></div>
    {error && <div className="crm-alert" role="alert">{error}</div>}
<div className="finance-account-grid">{accounts.map(account => <section className="crm-section finance-account" key={account.id}><div className="finance-account-top"><span className="finance-icon"><WalletCards size={19} /></span><span className={`finance-pill ${account.is_active ? 'is-confirmed' : 'is-muted'}`}>{account.is_active ? 'Actif' : 'Inactif'}</span></div><h2>{methodLabels[account.method]}{account.provider_name ? ` · ${account.provider_name}` : ''}</h2><p>{account.holder_name || 'Réception en espèces'}{account.account_identifier ? ` · ${account.account_identifier}` : ''}</p><small>{account.client_instructions}</small><Button variant="secondary" size="sm" onClick={() => { setEditing(account.id); setForm({ method: account.method, provider_name: account.provider_name, holder_name: account.holder_name, account_identifier: account.account_identifier, client_instructions: account.client_instructions, cash_responsible_id: account.cash_responsible_id, is_active: account.is_active, internal_notes: account.internal_notes ?? null }) }}>Modifier</Button></section>)}{accounts.length === 0 && <div className="crm-empty">Aucun compte officiel configuré. Aucune instruction de paiement ne sera émise.</div>}</div>
    {editing !== null && <section className="crm-section"><h2>{editing ? 'Modifier le compte' : 'Nouveau compte officiel'}</h2><form className="crm-form-grid" onSubmit={e => void submit(e)}><label className="crm-field">Moyen<select value={form.method} onChange={e => setForm({ ...form, method: e.target.value as PaymentMethod, account_identifier: e.target.value === 'cash' ? null : form.account_identifier })}>{Object.entries(methodLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><label className="crm-field">Opérateur ou banque<input value={form.provider_name ?? ''} required={form.method !== 'cash'} onChange={e => setForm({ ...form, provider_name: e.target.value || null })} /></label><label className="crm-field">Titulaire officiel<input value={form.holder_name ?? ''} required={form.method !== 'cash'} onChange={e => setForm({ ...form, holder_name: e.target.value || null })} /></label>{form.method !== 'cash' && <label className="crm-field">Identifiant destiné au client<input required value={form.account_identifier ?? ''} onChange={e => setForm({ ...form, account_identifier: e.target.value || null })} /></label>}{form.method === 'cash' && <label className="crm-field">Responsable de caisse<select required={form.is_active} value={form.cash_responsible_id ?? ''} onChange={e => setForm({ ...form, cash_responsible_id: e.target.value || null })}><option value="">Choisir une personne</option>{sales.filter(item => item.is_active).map(item => <option value={item.id} key={item.id}>{item.full_name}</option>)}</select></label>}<label className="crm-field crm-field-wide">Instructions visibles par le client<textarea required rows={3} value={form.client_instructions} onChange={e => setForm({ ...form, client_instructions: e.target.value })} /></label><label className="crm-field crm-field-wide">Note interne<textarea rows={2} value={form.internal_notes ?? ''} onChange={e => setForm({ ...form, internal_notes: e.target.value || null })} /></label><label className="finance-check"><input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} /> Activer après contrôle des coordonnées</label><div className="crm-form-actions"><Button type="submit" disabled={busy}>Enregistrer</Button><Button type="button" variant="secondary" onClick={() => setEditing(null)}>Annuler</Button></div></form></section>}
    <div className="finance-settings-grid"><section className="crm-section"><h2>Numérotation des reçus</h2><p>Préfixe de 3 à 20 lettres majuscules, chiffres ou tirets. Les numéros déjà émis restent inchangés.</p><div className="finance-inline"><input value={receiptPrefix} onChange={e => setPrefix(e.target.value.toUpperCase())} /><Button disabled={busy} onClick={() => { setBusy(true); setError(null); void setReceiptPrefix(receiptPrefix).catch(e => setError(e.message)).finally(() => setBusy(false)) }}>Enregistrer</Button></div></section><section className="crm-section"><h2><ShieldCheck size={18} /> Habilitation de vérification</h2><p>Les responsables commerciaux ne peuvent confirmer un paiement que sur habilitation explicite. L’administrateur conserve ce droit.</p>{sales.filter(item => item.role === 'sales_manager' && item.is_active).map(item => { const enabled = verifiers.find(entry => entry.user_id === item.id)?.enabled ?? false; return <div className="finance-verifier" key={item.id}><span>{item.full_name}</span><Button size="sm" variant="secondary" disabled={busy} onClick={() => void toggleVerifier(item.id, !enabled)}>{enabled ? 'Retirer le droit' : 'Autoriser'}</Button></div> })}</section></div>
  </div>
}
