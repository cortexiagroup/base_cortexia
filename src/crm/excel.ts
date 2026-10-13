import type { Activity, FollowUp, Lead, LeadInput } from './types'

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024
export const MAX_IMPORT_ROWS = 500
export const importFields: { key: keyof LeadInput; label: string; aliases: string[] }[] = [
  { key: 'company_name', label: 'Nom de l’entreprise *', aliases: ['entreprise', 'societe', 'raison sociale', 'company', 'company name', 'nom entreprise'] },
  { key: 'industry', label: 'Secteur d’activité', aliases: ['secteur', 'industrie', 'activite'] },
  { key: 'contact_name', label: 'Nom du contact', aliases: ['contact', 'decideur', 'nom du decideur'] },
  { key: 'contact_title', label: 'Fonction', aliases: ['poste', 'fonction du contact', 'job title'] },
  { key: 'phone', label: 'Téléphone', aliases: ['telephone', 'tel', 'mobile', 'numero'] },
  { key: 'whatsapp', label: 'WhatsApp', aliases: ['whatsapp', 'numero whatsapp'] },
  { key: 'email', label: 'Email', aliases: ['email', 'e-mail', 'courriel'] },
  { key: 'city', label: 'Ville', aliases: ['ville', 'city', 'localite'] },
  { key: 'neighborhood', label: 'Quartier', aliases: ['quartier', 'neighborhood'] },
  { key: 'address', label: 'Adresse', aliases: ['adresse', 'address'] },
  { key: 'website', label: 'Site web existant', aliases: ['site web', 'website', 'url', 'site internet'] },
  { key: 'identified_need', label: 'Besoin identifié', aliases: ['besoin', 'besoin identifie', 'need'] },
  { key: 'source', label: 'Source du prospect', aliases: ['source', 'origine', 'canal'] },
  { key: 'priority', label: 'Priorité', aliases: ['priorite', 'priority'] },
  { key: 'notes', label: 'Notes', aliases: ['notes', 'commentaires', 'observation'] },
  { key: 'next_follow_up_at', label: 'Date de prochaine relance', aliases: ['relance', 'prochaine relance', 'date relance'] },
]
export type RawCell = string | number | boolean | Date | null
export interface ParsedFile { headers: string[]; rows: RawCell[][] }
export interface ParsedWorkbook { format: 'xlsx' | 'csv'; sheets: { name: string; rows: RawCell[][] }[] }

function normalizedHeader(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}
export function guessMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  const used = new Set<string>()
  for (const header of headers) {
    const normalized = normalizedHeader(header).replace(/\b(obligatoire|facultatif)\b/g, '').trim()
    const match = importFields.find(field => !used.has(field.key) && [field.label, ...field.aliases].some(alias => normalizedHeader(alias).replace(/\b(obligatoire|facultatif)\b/g, '').trim() === normalized))
    if (match) { mapping[header] = match.key; used.add(match.key) }
  }
  return mapping
}
export function protectExcelText(value: string): string {
  return /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value
}
export function rowsToLeads(parsed: ParsedFile, mapping: Record<string, string>): LeadInput[] {
  if (!Object.values(mapping).includes('company_name')) throw new Error('Associez une colonne au nom de l’entreprise.')
  const targets = Object.values(mapping).filter(Boolean)
  if (new Set(targets).size !== targets.length) throw new Error('Chaque champ Cortexia doit correspondre à une seule colonne.')
  return parsed.rows.map(row => {
    const data: Record<string, string> = {}
    for (const [index, header] of parsed.headers.entries()) {
      const field = mapping[header]
      if (!field) continue
      const value = row[index]
      data[field] = value instanceof Date ? value.toISOString() : value === null || value === undefined ? '' : String(value).trim()
    }
    if (data.priority) {
      const priority = normalizedHeader(data.priority)
      data.priority = priority === 'haute' || priority === 'high' ? 'high' : priority === 'basse' || priority === 'low' ? 'low' : 'normal'
    }
    if (data.contact_name && data.phone && !data.contact_phone) data.contact_phone = data.phone
    return data as unknown as LeadInput
  })
}

export async function parseImportFile(file: File): Promise<ParsedWorkbook> {
  const extension = file.name.toLowerCase().split('.').pop()
  if (!extension || !['xlsx', 'csv'].includes(extension)) throw new Error('Choisissez un fichier .xlsx ou .csv.')
  if (file.size < 1 || file.size > MAX_IMPORT_BYTES) throw new Error('Le fichier doit peser entre 1 octet et 10 Mo.')
  if (extension === 'xlsx') {
    const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer())
    if (signature[0] !== 0x50 || signature[1] !== 0x4b) throw new Error('Le fichier XLSX ne possède pas une structure ZIP valide.')
    const { default: readExcelFile } = await import('read-excel-file/browser')
    const sheets = await readExcelFile(file)
    return { format: 'xlsx', sheets: sheets.map(item => ({ name: item.sheet, rows: item.data as RawCell[][] })) }
  }
  const { default: Papa } = await import('papaparse')
  const parsed = Papa.parse<string[]>(await file.text(), { skipEmptyLines: 'greedy', dynamicTyping: false })
  if (parsed.errors.length) throw new Error(`CSV illisible à la ligne ${(parsed.errors[0]!.row ?? 0) + 1} : ${parsed.errors[0]!.message}`)
  return { format: 'csv', sheets: [{ name: file.name, rows: parsed.data as RawCell[][] }] }
}

export function selectImportSheet(workbook: ParsedWorkbook, sheetName: string): ParsedFile {
  const sheet = workbook.sheets.find(item => item.name === sheetName)
  if (!sheet) throw new Error('Feuille introuvable dans ce fichier.')
  const rows = sheet.rows
  if (rows.length < 2) throw new Error('Le fichier doit contenir une ligne d’en-tête et au moins un prospect.')
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw new Error(`Un import contient au maximum ${MAX_IMPORT_ROWS} prospects.`)
  const headers = rows[0].map(cell => String(cell ?? '').trim())
  if (headers.some(header => !header) || new Set(headers).size !== headers.length) throw new Error('Les en-têtes doivent être renseignés et uniques.')
  return { headers, rows: rows.slice(1) }
}

export async function sha256(file: Blob, sheetName?: string): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const suffix = sheetName ? new TextEncoder().encode(`\u0000cortexia-sheet:${sheetName}`) : new Uint8Array(0)
  const input = new Uint8Array(bytes.length + suffix.length)
  input.set(bytes)
  input.set(suffix, bytes.length)
  const hash = await crypto.subtle.digest('SHA-256', input)
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function writeSheets(sheets: { sheet: string; data: (string | number | Date | null)[][] }[], fileName: string) {
  const { default: writeExcelFile } = await import('write-excel-file/browser')
  await writeExcelFile(sheets).toFile(fileName)
}
export async function downloadTemplate() {
  const headers = importFields.map(field => field.label)
  await writeSheets([
    { sheet: 'Prospects', data: [headers] },
    { sheet: 'Instructions', data: [
      ['Cortexia Base : modèle de prospection'],
      ['Seul le nom de l’entreprise (*) est obligatoire. Une ligne représente un prospect.'],
      ['Renseignez un numéro avec son indicatif international si nécessaire. Les numéros togolais à 8 chiffres reçoivent +228.'],
      ['N’ajoutez aucune donnée réelle dans un modèle destiné à être partagé.'],
      ['L’import affiche toujours un aperçu et demande une validation avant l’écriture.'],
    ] },
  ], 'modele-prospects-cortexia.xlsx')
}
export async function exportLeads(leads: Lead[]) {
  const headers = ['Entreprise', 'Secteur', 'Contact', 'Fonction', 'Téléphone', 'WhatsApp', 'Email', 'Ville', 'Quartier', 'Adresse', 'Site web', 'Besoin', 'Offre envisagée', 'Commercial', 'Statut', 'Priorité', 'Source', 'Créé le', 'Prochaine relance', 'Notes']
  const safe = (value: string | null | undefined) => protectExcelText(value ?? '')
  const rows = leads.map(lead => [safe(lead.company_name), safe(lead.industry), safe(lead.contact?.full_name), safe(lead.contact?.job_title), safe(lead.contact?.phone || lead.phone), safe(lead.contact?.whatsapp), safe(lead.contact?.email || lead.company_email), safe(lead.city), safe(lead.neighborhood), safe(lead.address), safe(lead.website), safe(lead.identified_need), safe(lead.interested_offer), safe(lead.assigned_name), lead.status, lead.priority, safe(lead.source), new Date(lead.created_at), lead.next_follow_up_at ? new Date(lead.next_follow_up_at) : null, safe(lead.notes)])
  await writeSheets([{ sheet: 'Prospects', data: [headers, ...rows] }], `prospects-cortexia-${new Date().toISOString().slice(0, 10)}.xlsx`)
}
export async function exportActivities(activities: Activity[]) {
  const rows = activities.map(item => [item.lead_id, item.activity_type, protectExcelText(item.channel ?? ''), protectExcelText(item.outcome ?? ''), protectExcelText(item.body ?? ''), new Date(item.occurred_at)])
  await writeSheets([{ sheet: 'Activités', data: [['Prospect ID', 'Type', 'Canal', 'Résultat', 'Note', 'Date'], ...rows] }], 'activites-cortexia.xlsx')
}
export async function exportFollowUps(followUps: FollowUp[]) {
  const rows = followUps.map(item => [item.lead_id, item.status, protectExcelText(item.reason), protectExcelText(item.notes ?? ''), new Date(item.due_at)])
  await writeSheets([{ sheet: 'Relances', data: [['Prospect ID', 'Statut', 'Motif', 'Note', 'Échéance'], ...rows] }], 'relances-cortexia.xlsx')
}
