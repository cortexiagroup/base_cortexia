import { supabase } from '../lib/supabase'
import type { Activity, Appointment, Assignment, Contact, FollowUp, ImportBatch, ImportRow, Lead, LeadInput, LeadPriority, LeadStatus, PageResult, SalesProfile } from './types'

function db() { if (!supabase) throw new Error('Connexion Supabase non configurée.'); return supabase }
function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  if (result.data === null) throw new Error('Aucune réponse Supabase.')
  return result.data
}
export function crmChanged() { window.dispatchEvent(new Event('cortexia:crm-changed')) }
async function actorId(): Promise<string> {
  const { data, error } = await db().auth.getUser()
  if (error || !data.user) throw new Error('Session expirée. Reconnectez-vous.')
  return data.user.id
}

export interface LeadFilters { search?: string; status?: LeadStatus | ''; assignee?: string; priority?: LeadPriority | ''; unassigned?: boolean; sort?: 'recent' | 'oldest' | 'name' | 'follow_up'; page?: number; pageSize?: number }
export async function searchLeads(filters: LeadFilters = {}): Promise<PageResult<Lead>> {
  return unwrap((await db().rpc('crm_search_leads', {
    p_search: filters.search?.trim() || null, p_status: filters.status || null,
    p_assignee: filters.assignee === '__none' ? null : filters.assignee || null, p_priority: filters.priority || null,
    p_unassigned: Boolean(filters.unassigned), p_sort: filters.sort ?? 'recent',
    p_page: filters.page ?? 1, p_page_size: filters.pageSize ?? 20,
  })) as { data: PageResult<Lead> | null; error: { message: string } | null })
}
export async function saveLead(id: string | null, input: LeadInput): Promise<string> {
  const saved = unwrap((await db().rpc('crm_save_lead', { p_id: id, p_data: input })) as { data: string | null; error: { message: string } | null })
  crmChanged(); return saved
}
export async function setLeadStatus(id: string, status: LeadStatus, reason?: string): Promise<void> {
  const { error } = await db().rpc('crm_set_lead_status', { p_lead_id: id, p_status: status, p_reason: reason || null })
  if (error) throw new Error(error.message)
  crmChanged()
}
export async function assignLeads(ids: string[], assignee: string | null, reason?: string): Promise<number> {
  const changed = unwrap((await db().rpc('crm_assign_leads', { p_lead_ids: ids, p_assignee: assignee, p_reason: reason || null })) as { data: number | null; error: { message: string } | null })
  crmChanged(); return changed
}
export async function getLead(id: string): Promise<Lead> {
  const { data, error } = await db().from('leads').select('*').eq('id', id).single()
  if (error || !data) throw new Error('Prospect introuvable ou inaccessible.')
  const [companyResult, contactResult, assignedResult] = await Promise.all([
    db().from('companies').select('*').eq('id', data.company_id).single(),
    db().from('contacts').select('*').eq('company_id', data.company_id).order('is_primary', { ascending: false }).limit(1),
    data.assigned_to ? db().from('profiles').select('full_name').eq('id', data.assigned_to).single() : Promise.resolve({ data: null, error: null }),
  ])
  if (companyResult.error || !companyResult.data) throw new Error('Entreprise inaccessible.')
  const company = companyResult.data as Record<string, string | null>
  const assigned = assignedResult.data as { full_name: string } | null
  return { ...data, company_name: company.legal_name, industry: company.industry, city: company.city,
    neighborhood: company.neighborhood, address: company.address, phone: company.phone,
    normalized_phone: company.normalized_phone, website: company.website, has_website: company.has_website === null ? null : Boolean(company.has_website),
    company_email: company.email, assigned_name: assigned?.full_name ?? null, contact: (contactResult.data?.[0] ?? null) as Contact | null } as Lead
}
export async function getContacts(companyId: string): Promise<Contact[]> {
  const { data, error } = await db().from('contacts').select('id,company_id,full_name,job_title,phone,whatsapp,email,is_primary').eq('company_id', companyId).order('is_primary', { ascending: false })
  if (error) throw new Error(error.message)
  return data as Contact[]
}
export async function addContact(companyId: string, input: Pick<Contact, 'full_name'> & Partial<Contact>): Promise<void> {
  const { error } = await db().from('contacts').insert({ company_id: companyId, full_name: input.full_name,
    job_title: input.job_title || null, phone: input.phone || null, whatsapp: input.whatsapp || null,
    email: input.email?.trim().toLowerCase() || null, is_primary: Boolean(input.is_primary) })
  if (error) throw new Error(error.message)
  crmChanged()
}
export async function getActivities(leadId?: string, limit = 60): Promise<Activity[]> {
  let query = db().from('activities').select('*').order('occurred_at', { ascending: false }).limit(limit)
  if (leadId) query = query.eq('lead_id', leadId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data as Activity[]
}
export async function getLeadNames(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {}
  const { data: leads, error } = await db().from('leads').select('id,company_id').in('id', [...new Set(ids)])
  if (error) throw new Error(error.message)
  const companyIds = [...new Set((leads ?? []).map(item => item.company_id))]
  if (!companyIds.length) return {}
  const { data: companies, error: companyError } = await db().from('companies').select('id,legal_name').in('id', companyIds)
  if (companyError) throw new Error(companyError.message)
  const names = Object.fromEntries((companies ?? []).map(company => [company.id, company.legal_name]))
  return Object.fromEntries((leads ?? []).map(lead => [lead.id, names[lead.company_id] ?? 'Prospect']))
}
export async function addActivity(input: { lead_id: string; activity_type: string; channel?: string; interaction_status?: string; outcome?: string; subject?: string; body?: string; occurred_at?: string; next_action_at?: string }): Promise<void> {
  const { error } = await db().from('activities').insert({ ...input, author_id: await actorId(), occurred_at: input.occurred_at || new Date().toISOString(), channel: input.channel || null, interaction_status: input.interaction_status || null, outcome: input.outcome || null, next_action_at: input.next_action_at || null })
  if (error) throw new Error(error.message)
  crmChanged()
}
export async function getAppointments(leadId?: string, after?: string): Promise<Appointment[]> {
  let query = db().from('appointments').select('*').order('scheduled_at', { ascending: true }).limit(200)
  if (leadId) query = query.eq('lead_id', leadId)
  if (after) query = query.gte('scheduled_at', after)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data as Appointment[]
}
export async function saveAppointment(input: Partial<Appointment> & Pick<Appointment, 'lead_id' | 'kind' | 'scheduled_at' | 'sales_rep_id'>): Promise<void> {
  const actor = await actorId()
  const payload = { lead_id: input.lead_id, kind: input.kind, scheduled_at: input.scheduled_at, sales_rep_id: input.sales_rep_id,
    status: input.status ?? 'scheduled', location_or_channel: input.location_or_channel ?? null,
    solution_presented: input.kind === 'demo' ? input.solution_presented ?? null : null,
    objections: input.kind === 'demo' ? input.objections ?? null : null, outcome: input.outcome ?? null,
    next_action_at: input.next_action_at ?? null, notes: input.notes ?? null,
    completed_at: input.status === 'completed' ? new Date().toISOString() : null }
  const result = input.id ? await db().from('appointments').update(payload).eq('id', input.id).select('id').single()
    : await db().from('appointments').insert({ ...payload, created_by: actor }).select('id').single()
  if (result.error) throw new Error(result.error.message)
  crmChanged()
}
export async function getFollowUps(leadId?: string): Promise<FollowUp[]> {
  let query = db().from('follow_ups').select('*').order('due_at', { ascending: true }).limit(200)
  if (leadId) query = query.eq('lead_id', leadId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data as FollowUp[]
}
export async function saveFollowUp(input: Partial<FollowUp> & Pick<FollowUp, 'lead_id' | 'responsible_id' | 'due_at' | 'reason'>): Promise<void> {
  const payload = { lead_id: input.lead_id, responsible_id: input.responsible_id, due_at: input.due_at, reason: input.reason,
    status: input.status ?? 'todo', notes: input.notes ?? null,
    completed_at: input.status === 'completed' ? new Date().toISOString() : null }
  const result = input.id ? await db().from('follow_ups').update(payload).eq('id', input.id).select('id').single()
    : await db().from('follow_ups').insert({ ...payload, created_by: await actorId() }).select('id').single()
  if (result.error) throw new Error(result.error.message)
  crmChanged()
}
export async function getAssignments(leadId: string): Promise<Assignment[]> {
  const { data, error } = await db().from('lead_assignments').select('*').eq('lead_id', leadId).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data as Assignment[]
}
export async function getSalesProfiles(): Promise<SalesProfile[]> {
  const { data, error } = await db().from('profiles').select('id,full_name,phone,role,is_active,territory,joined_at,created_at').order('full_name')
  if (error) throw new Error(error.message)
  return data as SalesProfile[]
}
export async function setSalesActive(id: string, active: boolean): Promise<void> {
  const { error } = await db().rpc('crm_set_sales_active', { p_user_id: id, p_active: active })
  if (error) throw new Error(error.message)
  crmChanged()
}
export async function updateSalesProfile(id: string, fields: { territory: string | null; joined_at: string | null; phone: string | null }): Promise<void> {
  const { error } = await db().rpc('crm_update_sales_profile', { p_user_id: id,
    p_territory: fields.territory, p_joined_at: fields.joined_at, p_phone: fields.phone })
  if (error) throw new Error(error.message)
  crmChanged()
}
export async function getImportHistory(): Promise<ImportBatch[]> {
  const { data, error } = await db().from('import_batches').select('id,file_name,file_hash,column_mapping,status,analyzed_rows,created_rows,updated_rows,duplicate_rows,rejected_rows,conflict_rows,created_at,committed_at').order('created_at', { ascending: false }).limit(30)
  if (error) throw new Error(error.message)
  return data as ImportBatch[]
}
export async function getImportRows(batchId: string): Promise<ImportRow[]> {
  const { data, error } = await db().from('import_rows').select('*').eq('batch_id', batchId).order('row_number').limit(500)
  if (error) throw new Error(error.message)
  return data as ImportRow[]
}
export async function prepareImport(args: { name: string; hash: string; size: number; format: string; path: string; mapping: Record<string, string>; rows: LeadInput[] }): Promise<string> {
  const { data, error } = await db().rpc('crm_prepare_import', { p_file_name: args.name, p_file_hash: args.hash,
    p_file_size_bytes: args.size, p_file_format: args.format, p_storage_path: args.path,
    p_mapping: args.mapping, p_rows: args.rows })
  if (error) throw new Error(error.message)
  return data as string
}
export async function commitImport(batchId: string, decisions: Record<string, { action: 'create' | 'update' | 'skip'; lead_id?: string }>): Promise<{ created: number; updated: number; skipped: number }> {
  const { data, error } = await db().rpc('crm_commit_import', { p_batch_id: batchId, p_decisions: decisions })
  if (error) throw new Error(error.message)
  crmChanged()
  return data as { created: number; updated: number; skipped: number }
}
export async function uploadImportFile(file: File, path: string): Promise<void> {
  const contentType = file.name.toLowerCase().endsWith('.csv') ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  const { error } = await db().storage.from('cortexia-imports').upload(path, file, { upsert: false, contentType })
  if (error) throw new Error(error.message)
}
