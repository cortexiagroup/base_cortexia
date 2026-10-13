export type LeadStatus = 'new' | 'qualified' | 'contacted' | 'meeting' | 'demo' | 'proposal' | 'negotiation' | 'won' | 'lost' | 'unqualified' | 'archived'
export type LeadPriority = 'low' | 'normal' | 'high'
export interface Contact { id: string; company_id: string; full_name: string; job_title: string | null; phone: string | null; whatsapp: string | null; email: string | null; is_primary: boolean }
export interface Lead {
  id: string; company_id: string; company_name: string; industry: string | null; city: string | null; neighborhood: string | null;
  address: string | null; phone: string | null; normalized_phone: string | null; website: string | null; has_website: boolean | null; company_email: string | null; last_activity_at: string | null;
  assigned_to: string | null; assigned_name: string | null; created_by: string | null; source: string | null;
  identified_need: string | null; interested_offer: string | null; status: LeadStatus; priority: LeadPriority; notes: string | null;
  next_follow_up_at: string | null; created_at: string; updated_at: string; converted_at: string | null; contact: Contact | null;
}
export interface LeadInput { company_name: string; company_id?: string; industry?: string; city?: string; neighborhood?: string; address?: string; company_email?: string; phone?: string; website?: string; has_website?: boolean | null; contact_id?: string; contact_name?: string; contact_title?: string; contact_phone?: string; whatsapp?: string; email?: string; identified_need?: string; interested_offer?: string; source?: string; priority?: LeadPriority; notes?: string; next_follow_up_at?: string; assigned_to?: string }
export interface SalesProfile { id: string; full_name: string; phone: string | null; role: 'admin' | 'sales_manager' | 'sales_rep'; is_active: boolean; territory: string | null; joined_at: string | null; created_at: string }
export interface Activity { id: string; lead_id: string; author_id: string; activity_type: string; channel: string | null; interaction_status: string | null; outcome: string | null; subject: string | null; body: string | null; occurred_at: string; next_action_at: string | null; metadata: Record<string, unknown> }
export interface Appointment { id: string; lead_id: string; sales_rep_id: string; created_by: string; kind: 'meeting' | 'demo'; scheduled_at: string; status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'postponed' | 'no_show'; location_or_channel: string | null; solution_presented: string | null; outcome: string | null; objections: string | null; next_action_at: string | null; notes: string | null; completed_at: string | null }
export interface FollowUp { id: string; lead_id: string; responsible_id: string; created_by: string; due_at: string; reason: string; status: 'todo' | 'completed' | 'postponed' | 'cancelled'; notes: string | null; completed_at: string | null }
export interface Assignment { id: string; lead_id: string; old_assignee_id: string | null; new_assignee_id: string | null; actor_id: string; reason: string | null; created_at: string }
export interface ImportBatch { id: string; file_name: string; file_hash: string; column_mapping: Record<string, string>; status: string; analyzed_rows: number; created_rows: number; updated_rows: number; duplicate_rows: number; rejected_rows: number; conflict_rows: number; created_at: string; committed_at: string | null }
export interface ImportRow { id: string; batch_id: string; row_number: number; raw_data: LeadInput; normalized_data: LeadInput & { candidate_ids: string[]; hard_match: boolean }; action: 'create' | 'update' | 'duplicate' | 'reject' | 'conflict' | 'skip'; decision_action: 'create' | 'update' | 'skip' | null; matched_lead_id: string | null; error_message: string | null }
export interface PageResult<T> { rows: T[]; total: number }

export const statusLabels: Record<LeadStatus, string> = {
  new: 'Nouveau', qualified: 'Qualifié (ancien)', contacted: 'Contacté', meeting: 'Rendez-vous', demo: 'Démonstration', proposal: 'Proposition', negotiation: 'Négociation', won: 'Gagné', lost: 'Perdu', unqualified: 'Non qualifié', archived: 'Archivé',
}
export const pipelineStatuses: LeadStatus[] = ['new', 'contacted', 'meeting', 'demo', 'proposal', 'negotiation', 'won', 'lost', 'unqualified']
export const priorityLabels: Record<LeadPriority, string> = { low: 'Basse', normal: 'Normale', high: 'Haute' }
export const activityTypes = [
  { value: 'call', label: 'Appel' }, { value: 'message', label: 'Message' }, { value: 'visit', label: 'Visite terrain' },
  { value: 'meeting', label: 'Rendez-vous' }, { value: 'demo', label: 'Démonstration' }, { value: 'follow_up', label: 'Relance' }, { value: 'note', label: 'Note' },
] as const
export const outcomeLabels = ['Intéressé', 'Indisponible', 'Rendez-vous obtenu', 'Démonstration réalisée', 'Proposition demandée', 'Refus', 'À relancer'] as const
export const appointmentStatusLabels: Record<Appointment['status'], string> = { scheduled: 'Programmé', confirmed: 'Confirmé', completed: 'Réalisé', cancelled: 'Annulé', postponed: 'Reporté', no_show: 'Absent' }
export const followUpStatusLabels: Record<FollowUp['status'], string> = { todo: 'À faire', completed: 'Terminée', postponed: 'Reportée', cancelled: 'Annulée' }
