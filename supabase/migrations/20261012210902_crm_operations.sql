-- Prompt 3 extends the existing schema without changing historical migrations.
alter type public.lead_status add value if not exists 'negotiation';
alter type public.lead_status add value if not exists 'unqualified';

alter table public.profiles add column territory text;
alter table public.profiles add column joined_at date;
alter table public.companies add column neighborhood text;
alter table public.companies add column has_website boolean;
alter table public.contacts add column whatsapp text;
alter table public.leads add column priority text not null default 'normal'
  check (priority in ('low', 'normal', 'high'));
alter table public.leads add column interested_offer text;
alter table public.leads add column source_import_row_id uuid unique references public.import_rows(id);
alter table public.activities add column channel text
  check (channel is null or channel in ('phone', 'whatsapp', 'email', 'in_person', 'video', 'other'));
alter table public.activities add column outcome text;
alter table public.activities add column interaction_status text
  check (interaction_status is null or interaction_status in ('attempted', 'completed', 'no_answer', 'cancelled'));
alter table public.activities add column next_action_at timestamptz;
alter table public.import_batches add column storage_path text unique;
alter table public.import_batches add constraint import_file_size_limit check (file_size_bytes <= 10485760) not valid;
alter table public.import_rows add column decision_action text
  check (decision_action is null or decision_action in ('create', 'update', 'skip'));

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id),
  sales_rep_id uuid not null references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  kind text not null check (kind in ('meeting', 'demo')),
  scheduled_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'confirmed', 'completed', 'cancelled', 'postponed', 'no_show')),
  location_or_channel text,
  solution_presented text,
  outcome text,
  objections text,
  next_action_at timestamptz,
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'demo' or (solution_presented is null and objections is null))
);

create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id),
  responsible_id uuid not null references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  due_at timestamptz not null,
  reason text not null,
  status text not null default 'todo'
    check (status in ('todo', 'completed', 'postponed', 'cancelled')),
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lead_assignments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id),
  old_assignee_id uuid references public.profiles(id),
  new_assignee_id uuid references public.profiles(id),
  actor_id uuid not null references public.profiles(id),
  reason text,
  created_at timestamptz not null default now(),
  check (old_assignee_id is distinct from new_assignee_id)
);

create index appointments_rep_schedule_idx on public.appointments (sales_rep_id, scheduled_at);
create index appointments_lead_idx on public.appointments (lead_id, scheduled_at desc);
create index follow_ups_rep_due_idx on public.follow_ups (responsible_id, status, due_at);
create index follow_ups_lead_idx on public.follow_ups (lead_id, due_at desc);
create index lead_assignments_lead_date_idx on public.lead_assignments (lead_id, created_at desc);
create index companies_name_search_idx on public.companies (lower(legal_name));
create index contacts_email_search_idx on public.contacts (lower(email));
drop index if exists public.contacts_company_normalized_phone_unique;
create index contacts_company_normalized_phone_idx on public.contacts (company_id, normalized_phone);
create index leads_priority_status_idx on public.leads (priority, status);

create trigger appointments_set_updated_at before update on public.appointments
  for each row execute function public.set_updated_at();
create trigger follow_ups_set_updated_at before update on public.follow_ups
  for each row execute function public.set_updated_at();

alter table public.appointments enable row level security;
alter table public.follow_ups enable row level security;
alter table public.lead_assignments enable row level security;
grant select, insert, update on public.appointments, public.follow_ups to authenticated;
grant select on public.lead_assignments to authenticated;
revoke all on public.appointments, public.follow_ups, public.lead_assignments from anon;

create or replace function private.crm_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and is_active)
$$;
revoke all on function private.crm_active() from public, anon;
grant execute on function private.crm_active() to authenticated;

-- A former owner must not keep seeing a reassigned lead merely because they created it.
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated
using ((select private.crm_active()) and ((select private.can_manage_all()) or assigned_to = (select auth.uid())));
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select to authenticated
using ((select private.crm_active()) and ((select private.can_manage_all()) or exists (
  select 1 from public.leads l where l.company_id = companies.id and l.assigned_to = (select auth.uid())
)));
drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies for update to authenticated
using ((select private.crm_active()) and ((select private.can_manage_all()) or exists (
  select 1 from public.leads l where l.company_id = companies.id and l.assigned_to = (select auth.uid())
)))
with check ((select private.crm_active()) and ((select private.can_manage_all()) or exists (
  select 1 from public.leads l where l.company_id = companies.id and l.assigned_to = (select auth.uid())
)));

revoke insert on public.companies from authenticated;
drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts for select to authenticated
using ((select private.crm_active()) and ((select private.can_manage_all()) or exists (
  select 1 from public.leads l where l.company_id = contacts.company_id and l.assigned_to = (select auth.uid())
)));
drop policy if exists contacts_insert on public.contacts;
create policy contacts_insert on public.contacts for insert to authenticated
with check ((select private.crm_active()) and ((select private.can_manage_all()) or exists (
  select 1 from public.leads l where l.company_id = contacts.company_id and l.assigned_to = (select auth.uid())
)));
drop policy if exists contacts_update on public.contacts;
create policy contacts_update on public.contacts for update to authenticated
using ((select private.crm_active()) and ((select private.can_manage_all()) or exists (
  select 1 from public.leads l where l.company_id = contacts.company_id and l.assigned_to = (select auth.uid())
)))
with check ((select private.crm_active()) and ((select private.can_manage_all()) or exists (
  select 1 from public.leads l where l.company_id = contacts.company_id and l.assigned_to = (select auth.uid())
)));

create policy appointments_select on public.appointments for select to authenticated
using ((select private.crm_active()) and ((select private.can_manage_all()) or (sales_rep_id = (select auth.uid()) and exists (
  select 1 from public.leads l where l.id = lead_id and l.assigned_to = (select auth.uid())
))));
create policy appointments_insert on public.appointments for insert to authenticated
with check ((select private.crm_active()) and created_by = (select auth.uid()) and
  ((select private.can_manage_all()) or (sales_rep_id = (select auth.uid()) and exists (
    select 1 from public.leads l where l.id = lead_id and l.assigned_to = (select auth.uid())
  ))));
create policy appointments_update on public.appointments for update to authenticated
using ((select private.crm_active()) and ((select private.can_manage_all()) or sales_rep_id = (select auth.uid())))
with check ((select private.crm_active()) and ((select private.can_manage_all()) or (sales_rep_id = (select auth.uid()) and exists (
  select 1 from public.leads l where l.id = lead_id and l.assigned_to = (select auth.uid())
))));

create policy follow_ups_select on public.follow_ups for select to authenticated
using ((select private.crm_active()) and ((select private.can_manage_all()) or (responsible_id = (select auth.uid()) and exists (
  select 1 from public.leads l where l.id = lead_id and l.assigned_to = (select auth.uid())
))));
create policy follow_ups_insert on public.follow_ups for insert to authenticated
with check ((select private.crm_active()) and created_by = (select auth.uid()) and
  ((select private.can_manage_all()) or (responsible_id = (select auth.uid()) and exists (
    select 1 from public.leads l where l.id = lead_id and l.assigned_to = (select auth.uid())
  ))));
create policy follow_ups_update on public.follow_ups for update to authenticated
using ((select private.crm_active()) and ((select private.can_manage_all()) or responsible_id = (select auth.uid())))
with check ((select private.crm_active()) and ((select private.can_manage_all()) or (responsible_id = (select auth.uid()) and exists (
  select 1 from public.leads l where l.id = lead_id and l.assigned_to = (select auth.uid())
))));

drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities for select to authenticated
using ((select private.crm_active()) and ((select private.can_manage_all()) or exists (
  select 1 from public.leads l where l.id = activities.lead_id and l.assigned_to = (select auth.uid())
)));
drop policy if exists activities_insert on public.activities;
create policy activities_insert on public.activities for insert to authenticated
with check ((select private.crm_active()) and author_id = (select auth.uid()) and
  ((select private.can_manage_all()) or exists (
    select 1 from public.leads l where l.id = activities.lead_id and l.assigned_to = (select auth.uid())
  )));

create policy lead_assignments_select on public.lead_assignments for select to authenticated
using ((select private.crm_active()) and ((select private.can_manage_all()) or exists (
  select 1 from public.leads l where l.id = lead_id and l.assigned_to = (select auth.uid())
)));

-- Sensitive transitions go through authenticated, auditable RPCs below.
create or replace function public.crm_guard_lead_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user not in ('postgres', 'supabase_admin') and
    (old.assigned_to is distinct from new.assigned_to or old.status is distinct from new.status) then
    raise exception 'use the CRM assignment or status operation';
  end if;
  return new;
end $$;
create trigger leads_guard_sensitive before update on public.leads
for each row execute function public.crm_guard_lead_update();

create or replace function public.crm_guard_lead_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user not in ('postgres', 'supabase_admin') and new.status <> 'new' then
    raise exception 'new leads must start in the new stage';
  end if;
  return new;
end $$;
create trigger leads_guard_insert before insert on public.leads
for each row execute function public.crm_guard_lead_insert();

create or replace function public.crm_guard_activity_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user not in ('postgres', 'supabase_admin') and new.activity_type = 'status_change' then
    raise exception 'status history is written by the transition operation';
  end if;
  return new;
end $$;
create trigger activities_guard_status_history before insert on public.activities
for each row execute function public.crm_guard_activity_insert();

create or replace function public.crm_guard_profile_active() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user not in ('postgres', 'supabase_admin') and old.is_active is distinct from new.is_active then
    raise exception 'use the admin activation operation';
  end if;
  return new;
end $$;
create trigger profiles_guard_active before update on public.profiles
for each row execute function public.crm_guard_profile_active();

create or replace function public.crm_audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs (actor_id, action, entity_table, entity_id, changes)
  values (auth.uid(), lower(tg_op), tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    case when tg_op = 'INSERT' then pg_catalog.jsonb_build_object('new', pg_catalog.to_jsonb(new))
         when tg_op = 'UPDATE' then pg_catalog.jsonb_build_object('old', pg_catalog.to_jsonb(old), 'new', pg_catalog.to_jsonb(new))
         else pg_catalog.jsonb_build_object('old', pg_catalog.to_jsonb(old)) end);
  return coalesce(new, old);
end $$;
revoke all on function public.crm_audit_row() from public, anon, authenticated;
create trigger crm_audit_leads after insert or update on public.leads
for each row execute function public.crm_audit_row();
create trigger crm_audit_companies after insert or update on public.companies
for each row execute function public.crm_audit_row();
create trigger crm_audit_contacts after insert or update on public.contacts
for each row execute function public.crm_audit_row();
create trigger crm_audit_activities after insert on public.activities
for each row execute function public.crm_audit_row();
create trigger crm_audit_appointments after insert or update on public.appointments
for each row execute function public.crm_audit_row();
create trigger crm_audit_follow_ups after insert or update on public.follow_ups
for each row execute function public.crm_audit_row();

-- Import rows and final status cannot be forged through the Data API.
revoke insert, update, delete on public.import_rows from authenticated;
revoke insert, update, delete on public.import_batches from authenticated;
revoke insert, update, delete on public.leads from authenticated;

update storage.buckets set file_size_limit = 10485760 where id = 'cortexia-imports';
drop policy if exists storage_imports_insert on storage.objects;
create policy storage_imports_insert on storage.objects for insert to authenticated
with check (bucket_id = 'cortexia-imports' and owner_id = (select auth.uid()::text)
  and (select private.can_manage_all()));
drop policy if exists storage_imports_update on storage.objects;
