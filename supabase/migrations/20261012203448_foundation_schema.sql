create extension if not exists pgcrypto;

create schema if not exists private;

create type public.app_role as enum ('admin', 'sales_manager', 'sales_rep');
create type public.lead_status as enum ('new', 'qualified', 'contacted', 'meeting', 'demo', 'proposal', 'won', 'lost', 'archived');
create type public.activity_type as enum ('call', 'message', 'meeting', 'visit', 'demo', 'follow_up', 'note', 'status_change');
create type public.order_status as enum ('draft', 'confirmed', 'cancelled', 'completed');
create type public.payment_method as enum ('merchant_account', 'bank_transfer', 'cash');
create type public.payment_status as enum ('pending', 'confirmed', 'rejected', 'refunded', 'corrected');
create type public.document_type as enum ('receipt', 'offer_sheet', 'order_confirmation', 'expense_proof');
create type public.expense_type as enum ('advance', 'communication', 'transport', 'other', 'regularization');
create type public.expense_status as enum ('submitted', 'approved', 'rejected', 'paid', 'regularized');
create type public.production_status as enum ('not_started', 'in_progress', 'blocked', 'ready_for_delivery', 'delivered', 'cancelled');
create type public.import_status as enum ('draft', 'simulated', 'committed', 'cancelled', 'failed');
create type public.import_row_action as enum ('create', 'update', 'duplicate', 'reject', 'conflict', 'skip');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  role public.app_role not null default 'sales_rep',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  industry text,
  address text,
  city text,
  country_code text not null default 'TG' check (char_length(country_code) = 2),
  email text,
  phone text,
  normalized_phone text,
  website text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  full_name text not null,
  job_title text,
  email text,
  phone text,
  normalized_phone text,
  is_primary boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  source text,
  assigned_to uuid references public.profiles(id),
  identified_need text,
  status public.lead_status not null default 'new',
  notes text,
  next_follow_up_at timestamptz,
  converted_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  activity_type public.activity_type not null,
  occurred_at timestamptz not null default now(),
  subject text,
  body text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.offer_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price_xof bigint not null check (price_xof >= 0),
  benefits jsonb not null default '[]'::jsonb,
  included_services jsonb not null default '[]'::jsonb,
  exclusions jsonb not null default '[]'::jsonb,
  delivery_days integer check (delivery_days is null or delivery_days >= 0),
  payment_terms text,
  version integer not null default 1 check (version > 0),
  valid_from date not null default current_date,
  valid_until date,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (id, version),
  check (valid_until is null or valid_until >= valid_from)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  company_id uuid not null references public.companies(id),
  lead_id uuid references public.leads(id),
  sales_rep_id uuid not null references public.profiles(id),
  offer_template_id uuid,
  offer_version integer,
  offer_snapshot jsonb not null,
  amount_xof bigint not null check (amount_xof >= 0),
  ordered_at timestamptz not null default now(),
  confirmed_at timestamptz,
  contractual_terms text,
  order_status public.order_status not null default 'draft',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (offer_template_id, offer_version) references public.offer_templates(id, version),
  check ((order_status = 'confirmed' and confirmed_at is not null) or order_status <> 'confirmed')
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  amount_xof bigint not null check (amount_xof > 0),
  method public.payment_method not null,
  transaction_reference text,
  paid_at timestamptz not null default now(),
  status public.payment_status not null default 'pending',
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  correction_of uuid references public.payments(id),
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check ((status = 'confirmed' and verified_by is not null and verified_at is not null) or status <> 'confirmed')
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  document_type public.document_type not null,
  payment_id uuid references public.payments(id),
  order_id uuid references public.orders(id),
  offer_template_id uuid references public.offer_templates(id),
  storage_path text not null unique,
  document_number text unique,
  content_hash text,
  issued_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (document_type <> 'receipt' or (payment_id is not null and document_number is not null))
);

create table public.expense_policies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  initial_budget_xof bigint not null default 5000 check (initial_budget_xof >= 0),
  communication_credit_xof bigint not null default 500 check (communication_credit_xof >= 0),
  communication_interval_days integer not null default 3 check (communication_interval_days > 0),
  effective_from date not null default current_date,
  effective_until date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (effective_until is null or effective_until >= effective_from)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  claimant_id uuid not null references public.profiles(id),
  expense_type public.expense_type not null,
  amount_xof bigint not null check (amount_xof > 0),
  incurred_at timestamptz not null default now(),
  description text not null,
  document_id uuid references public.documents(id),
  status public.expense_status not null default 'submitted',
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.commission_policies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  rate_bps integer not null check (rate_bps between 0 and 10000),
  basis text not null default 'confirmed_collected_amount',
  effective_from date not null default current_date,
  effective_until date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (effective_until is null or effective_until >= effective_from)
);

create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  sales_rep_id uuid not null references public.profiles(id),
  order_id uuid not null references public.orders(id),
  policy_id uuid not null references public.commission_policies(id),
  calculation_basis_xof bigint not null check (calculation_basis_xof >= 0),
  rate_bps integer not null check (rate_bps between 0 and 10000),
  amount_xof bigint not null check (amount_xof >= 0),
  validated_by uuid references public.profiles(id),
  validated_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (sales_rep_id, order_id)
);

create table public.production_projects (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id),
  responsible_id uuid references public.profiles(id),
  status public.production_status not null default 'not_started',
  planned_start_at timestamptz,
  planned_delivery_at timestamptz,
  actual_start_at timestamptz,
  actual_delivery_at timestamptz,
  stages jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_table text not null,
  entity_id uuid,
  changes jsonb not null default '{}'::jsonb,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid not null references public.profiles(id),
  file_name text not null,
  file_hash text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  file_format text not null check (lower(file_format) in ('xlsx', 'csv')),
  column_mapping jsonb not null default '{}'::jsonb,
  status public.import_status not null default 'draft',
  simulated_at timestamptz,
  committed_at timestamptz,
  analyzed_rows integer not null default 0 check (analyzed_rows >= 0),
  created_rows integer not null default 0 check (created_rows >= 0),
  updated_rows integer not null default 0 check (updated_rows >= 0),
  duplicate_rows integer not null default 0 check (duplicate_rows >= 0),
  rejected_rows integer not null default 0 check (rejected_rows >= 0),
  conflict_rows integer not null default 0 check (conflict_rows >= 0),
  created_at timestamptz not null default now(),
  unique (uploaded_by, file_hash)
);

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  row_number integer not null check (row_number > 0),
  raw_data jsonb not null,
  normalized_data jsonb not null default '{}'::jsonb,
  action public.import_row_action,
  matched_lead_id uuid references public.leads(id),
  error_message text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  unique (batch_id, row_number)
);

create index leads_assigned_status_idx on public.leads (assigned_to, status);
create index activities_lead_occurred_idx on public.activities (lead_id, occurred_at desc);
create index orders_company_status_idx on public.orders (company_id, order_status);
create index payments_order_status_idx on public.payments (order_id, status);
create index expenses_claimant_status_idx on public.expenses (claimant_id, status);
create index audit_logs_entity_idx on public.audit_logs (entity_table, entity_id, created_at desc);
create index import_rows_batch_action_idx on public.import_rows (batch_id, action);
create unique index companies_normalized_phone_unique on public.companies (normalized_phone) where normalized_phone is not null;
create unique index contacts_company_normalized_phone_unique on public.contacts (company_id, normalized_phone) where normalized_phone is not null;

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger companies_set_updated_at before update on public.companies for each row execute function public.set_updated_at();
create trigger contacts_set_updated_at before update on public.contacts for each row execute function public.set_updated_at();
create trigger leads_set_updated_at before update on public.leads for each row execute function public.set_updated_at();
create trigger orders_set_updated_at before update on public.orders for each row execute function public.set_updated_at();
create trigger production_projects_set_updated_at before update on public.production_projects for each row execute function public.set_updated_at();

create or replace function public.prevent_profile_role_change() returns trigger language plpgsql as $$
begin
  if old.role is distinct from new.role and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'role changes must use an authorized server-side operation';
  end if;
  return new;
end $$;
create trigger profiles_no_self_role_change before update on public.profiles for each row execute function public.prevent_profile_role_change();

create or replace function public.prevent_financial_mutation() returns trigger language plpgsql as $$
begin
  if current_user not in ('postgres', 'supabase_admin') then
    raise exception 'financial records are append-only; use correction or reversal entries';
  end if;
  return coalesce(new, old);
end $$;
create trigger payments_no_update before update or delete on public.payments for each row execute function public.prevent_financial_mutation();
create trigger commissions_no_delete before delete on public.commissions for each row execute function public.prevent_financial_mutation();
