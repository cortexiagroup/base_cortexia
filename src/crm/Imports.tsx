import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Download, FileSpreadsheet, Upload } from 'lucide-react'
import { Button } from '../components/ui/button'
import { supabase } from '../lib/supabase'
import { commitImport, getImportHistory, getImportRows, getLeadNames, prepareImport, uploadImportFile } from './api'
import { downloadTemplate, guessMapping, importFields, parseImportFile, rowsToLeads, selectImportSheet, sha256, type ParsedFile, type ParsedWorkbook } from './excel'
import type { ImportBatch, ImportRow } from './types'

type Decision = { action: 'create' | 'update' | 'skip'; lead_id?: string }
const actionLabel: Record<ImportRow['action'], string> = { create: 'Nouveau', update: 'Mise à jour', duplicate: 'Doublon dans le fichier', reject: 'À rejeter', conflict: 'Conflit', skip: 'Ignoré' }

export function ImportsPage() {
  const [step, setStep] = useState(1)
  const [file, setFile] = useState<File | null>(null)
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null)
  const [selectedSheet, setSelectedSheet] = useState('')
  const [parsed, setParsed] = useState<ParsedFile | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [batchId, setBatchId] = useState<string | null>(null)
  const [rows, setRows] = useState<ImportRow[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [history, setHistory] = useState<ImportBatch[]>([])
  const [report, setReport] = useState<{ created: number; updated: number; skipped: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { getImportHistory().then(setHistory).catch(e => setError(e.message)) }, [])

  async function chooseFile(next: File | undefined) {
    if (!next) return
    setBusy(true); setError(null); setReport(null); setBatchId(null); setWorkbook(null); setParsed(null); setFile(null)
    try {
      const content = await parseImportFile(next)
      const firstSheet = content.sheets[0]
      if (!firstSheet) throw new Error('Ce fichier ne contient aucune feuille.')
      setFile(next); setWorkbook(content); setSelectedSheet(firstSheet.name)
      if (content.sheets.length === 1) {
        const selection = selectImportSheet(content, firstSheet.name)
        setParsed(selection); setMapping(guessMapping(selection.headers)); setStep(2)
      } else setStep(1)
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Fichier illisible.') }
    finally { setBusy(false) }
  }
  function continueWithSheet() {
    if (!workbook || !selectedSheet) return
    setError(null)
    try {
      const selection = selectImportSheet(workbook, selectedSheet)
      setParsed(selection); setMapping(guessMapping(selection.headers)); setStep(2)
    } catch (e) { setError(e instanceof Error ? e.message : 'Feuille illisible.') }
  }
  async function simulate() {
    if (!file || !parsed || !workbook || busy) return
    setBusy(true); setError(null)
    try {
      const mapped = rowsToLeads(parsed, mapping)
      const sheetIndex = workbook.sheets.findIndex(item => item.name === selectedSheet)
      const hash = await sha256(file, workbook.format === 'xlsx' && sheetIndex > 0 ? selectedSheet : undefined)
      if (history.some(item => item.file_hash === hash)) throw new Error('Cette feuille figure déjà dans l’historique des imports. Modifiez-la avant un nouvel import.')
      if (!supabase) throw new Error('Connexion Supabase non configurée.')
      const { data: user } = await supabase.auth.getUser()
      if (!user.user) throw new Error('Session expirée. Reconnectez-vous.')
      const format = file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx'
      const path = `${user.user.id}/${crypto.randomUUID()}/original.${format}`
      await uploadImportFile(file, path)
      const storedMapping = workbook.format === 'xlsx' ? { ...mapping, __cortexia_sheet: selectedSheet } : mapping
      const id = await prepareImport({ name: file.name, hash, size: file.size, format, path, mapping: storedMapping, rows: mapped })
      const results = await getImportRows(id)
      const candidateIds = results.flatMap(item => item.normalized_data.candidate_ids ?? [])
      setNames(await getLeadNames(candidateIds))
      setRows(results); setBatchId(id)
      setDecisions(Object.fromEntries(results.map(item => [String(item.row_number), { action: item.action === 'create' || item.action === 'update' ? item.action : 'skip', lead_id: item.matched_lead_id ?? undefined }])))
      setStep(3)
      setHistory(await getImportHistory())
    } catch (e) { setError(e instanceof Error ? e.message : 'Simulation impossible.') }
    finally { setBusy(false) }
  }
  async function commit() {
    if (!batchId || busy) return
    setBusy(true); setError(null)
    try { setReport(await commitImport(batchId, decisions)); setStep(4); setHistory(await getImportHistory()); setRows(await getImportRows(batchId)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Import refusé.') }
    finally { setBusy(false) }
  }
  async function showHistory(batch: ImportBatch) {
    setBusy(true); setError(null)
    try {
      const previous = await getImportRows(batch.id)
      setBatchId(batch.id); setRows(previous)
      setNames(await getLeadNames(previous.flatMap(item => item.normalized_data.candidate_ids ?? [])))
      setDecisions(Object.fromEntries(previous.map(item => [String(item.row_number), { action: item.decision_action ?? (item.action === 'create' || item.action === 'update' ? item.action : 'skip'), lead_id: item.matched_lead_id ?? undefined }])))
      setReport({ created: batch.created_rows, updated: batch.updated_rows, skipped: batch.analyzed_rows - batch.created_rows - batch.updated_rows }); setStep(batch.status === 'committed' ? 4 : 3)
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Historique inaccessible.') }
    finally { setBusy(false) }
  }
  function setDecision(row: ImportRow, patch: Partial<Decision>) { setDecisions(old => ({ ...old, [row.row_number]: { ...old[row.row_number], ...patch } })) }
  const counts = rows.reduce((acc, row) => ({ ...acc, [row.action]: (acc[row.action] ?? 0) + 1 }), {} as Record<string, number>)
  const unresolved = rows.filter(row => { const d = decisions[row.row_number]; return d?.action === 'update' && !d.lead_id }).length
  return <div className="crm-page">
    <div className="crm-page-head"><div><span className="section-kicker">CRM / DONNÉES</span><h1>Importation intelligente</h1><p>Analysez un fichier, résolvez les conflits, puis validez les écritures.</p></div><Button variant="secondary" onClick={() => void downloadTemplate()}><Download size={16} /> Modèle Excel</Button></div>
    <div className="crm-steps">{['Fichier', 'Correspondance', 'Aperçu et conflits', 'Rapport'].map((label, index) => <span key={label} className={step === index + 1 ? 'active' : step > index + 1 ? 'done' : ''}><b>{index + 1}</b>{label}</span>)}</div>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    {step === 1 && <section className="crm-panel crm-import-upload"><FileSpreadsheet size={31} /><h2>Importer des prospects</h2><p>Fichier .xlsx ou .csv, 10 Mo et 500 lignes maximum par feuille. Aucune écriture CRM avant votre validation.</p><label className="crm-file-button"><Upload size={17} /> {file ? 'Changer de fichier' : 'Choisir un fichier'}<input type="file" accept=".xlsx,.csv" onChange={e => { const nextFile = e.target.files?.[0]; e.target.value = ''; void chooseFile(nextFile) }} disabled={busy} /></label>{workbook?.format === 'xlsx' && workbook.sheets.length > 1 && <div className="crm-sheet-picker"><label htmlFor="import-sheet">Feuille contenant les prospects</label><select id="import-sheet" value={selectedSheet} onChange={e => setSelectedSheet(e.target.value)}>{workbook.sheets.map(sheet => <option key={sheet.name} value={sheet.name}>{sheet.name} · {Math.max(0, sheet.rows.length - 1)} ligne(s)</option>)}</select><p>Une seule feuille est traitée à la fois. Vous pourrez importer une autre feuille ensuite.</p><Button onClick={continueWithSheet}>Utiliser cette feuille <ArrowRight size={16} /></Button></div>}</section>}
    {step === 2 && parsed && <section className="crm-panel"><div className="crm-section-head"><div><h2>Correspondance des colonnes</h2><p>{file?.name}{workbook?.format === 'xlsx' ? ` · Feuille « ${selectedSheet} »` : ''} · {parsed.rows.length} ligne(s). Vérifiez les associations proposées.</p></div></div><div className="crm-mapping">{parsed.headers.map(header => <label key={header}><strong>{header}</strong><ArrowRight size={16} /><select value={mapping[header] ?? ''} onChange={e => setMapping(old => ({ ...old, [header]: e.target.value }))}><option value="">Ignorer cette colonne</option>{importFields.map(field => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label>)}</div><div className="crm-form-actions"><Button variant="secondary" onClick={() => setStep(1)}><ArrowLeft size={16} /> Retour</Button><Button onClick={() => void simulate()} disabled={busy}>{busy ? 'Analyse en cours…' : 'Analyser les doublons'} <ArrowRight size={16} /></Button></div></section>}
    {step === 3 && <><div className="crm-import-summary">{[['Lignes', rows.length], ['Nouveaux', counts.create ?? 0], ['Mises à jour', counts.update ?? 0], ['Conflits', counts.conflict ?? 0], ['Doublons', counts.duplicate ?? 0], ['Rejets', counts.reject ?? 0]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><section className="crm-panel"><div className="crm-section-head"><div><h2>Prévisualisation avant écriture</h2><p>Choisissez explicitement le traitement des lignes ambiguës. Les lignes rejetées ou répétées sont ignorées.</p></div></div><div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Ligne</th><th>Entreprise</th><th>Téléphone</th><th>Diagnostic</th><th>Décision</th><th>Prospect à mettre à jour</th></tr></thead><tbody>{rows.map(row => { const decision = decisions[row.row_number] ?? { action: 'skip' }; const candidates = row.normalized_data.candidate_ids ?? []; const locked = row.action === 'reject' || row.action === 'duplicate'; return <tr key={row.id}><td>{row.row_number}</td><td><strong>{row.raw_data.company_name || '—'}</strong></td><td>{row.raw_data.phone || '—'}</td><td><span className={`crm-import-tag ${row.action}`}>{actionLabel[row.action]}</span>{row.error_message && <small>{row.error_message}</small>}</td><td><select aria-label={`Décision ligne ${row.row_number}`} value={decision.action} disabled={locked || busy} onChange={e => setDecision(row, { action: e.target.value as Decision['action'], lead_id: e.target.value === 'update' ? decision.lead_id : undefined })}><option value="skip">Ignorer</option>{!locked && <option value="create">Créer</option>}{!locked && candidates.length > 0 && <option value="update">Mettre à jour</option>}</select></td><td>{decision.action === 'update' ? <select aria-label={`Prospect cible ligne ${row.row_number}`} value={decision.lead_id ?? ''} onChange={e => setDecision(row, { lead_id: e.target.value })}><option value="">Choisir…</option>{candidates.map(id => <option key={id} value={id}>{names[id] ?? id.slice(0, 8)}</option>)}</select> : '—'}</td></tr> })}</tbody></table></div><div className="crm-form-actions"><Button onClick={() => void commit()} disabled={busy || unresolved > 0}>{busy ? 'Import en cours…' : 'Valider l’import'}</Button></div>{unresolved > 0 && <p className="crm-hint">{unresolved} ligne(s) nécessitent un prospect cible.</p>}</section></>}
    {step === 4 && report && <section className="crm-panel crm-report"><span className="section-kicker">IMPORT TERMINÉ</span><h2>Rapport d’intégration</h2><div className="crm-import-summary"><div><span>Créés</span><strong>{report.created}</strong></div><div><span>Mis à jour</span><strong>{report.updated}</strong></div><div><span>Ignorés</span><strong>{report.skipped}</strong></div></div><p>Les modifications validées sont enregistrées dans le CRM. Les erreurs de traitement auraient annulé l’ensemble de la validation.</p><Button asChild><Link to="/prospects">Voir les prospects <ArrowRight size={16} /></Link></Button>{workbook?.format === 'xlsx' && workbook.sheets.length > 1 && <Button variant="secondary" onClick={() => { setStep(1); setParsed(null); setRows([]); setReport(null); setError(null) }}>Choisir une autre feuille</Button>}<Button variant="secondary" onClick={() => { setStep(1); setFile(null); setWorkbook(null); setSelectedSheet(''); setParsed(null); setRows([]); setReport(null); setError(null) }}>Nouvel import</Button></section>}
    {history.length > 0 && <section className="crm-panel crm-history"><h2>Historique des imports</h2><div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Fichier</th><th>Feuille</th><th>Date</th><th>Statut</th><th>Lignes</th><th>Créés</th><th>Mis à jour</th><th /></tr></thead><tbody>{history.map(batch => <tr key={batch.id}><td><strong>{batch.file_name}</strong></td><td>{batch.column_mapping?.__cortexia_sheet || '—'}</td><td>{new Date(batch.created_at).toLocaleString('fr-TG')}</td><td>{batch.status === 'committed' ? 'Validé' : 'En attente'}</td><td>{batch.analyzed_rows}</td><td>{batch.created_rows}</td><td>{batch.updated_rows}</td><td><button onClick={() => void showHistory(batch)} disabled={busy}>Ouvrir</button></td></tr>)}</tbody></table></div></section>}
  </div>
}
