-- Prompt 6: separate authority, cash movement and justified consumption.
-- Legacy foundation tables remain readable for history, but cannot bypass the new audited workflows.
revoke insert,update,delete on public.expenses,public.commissions from authenticated;
drop policy if exists expenses_insert on public.expenses;
drop policy if exists expenses_update on public.expenses;
drop policy if exists commissions_insert on public.commissions;

create table public.field_policy_versions (
  id uuid primary key default gen_random_uuid(),
  version_no integer not null unique,
  effective_from date not null unique,
  startup_amount_xof bigint not null check (startup_amount_xof > 0),
  communication_amount_xof bigint not null check (communication_amount_xof > 0),
  communication_interval_days integer not null check (communication_interval_days > 0),
  allowed_categories text[] not null default array['communication','transport','other'],
  receipt_required_categories text[] not null default array['transport','other'],
  period_cap_xof bigint check (period_cap_xof is null or period_cap_xof > 0),
  reimbursement_rules jsonb not null default '{}'::jsonb,
  approval_rules jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
insert into public.field_policy_versions(version_no,effective_from,startup_amount_xof,
  communication_amount_xof,communication_interval_days)
values(1,current_date,5000,500,3);

create table public.field_budget_permissions (
  user_id uuid primary key references public.profiles(id),
  enabled boolean not null default false,
  granted_by uuid not null references public.profiles(id),
  granted_at timestamptz not null default now()
);

create table public.field_budgets (
  id uuid primary key default gen_random_uuid(),
  sales_rep_id uuid not null references public.profiles(id),
  kind text not null check (kind in ('startup','transport','other')),
  policy_id uuid not null references public.field_policy_versions(id),
  period_start date not null,
  period_end date not null,
  authorized_xof bigint not null check (authorized_xof > 0),
  purpose text not null,
  prospecting_zone text,
  allowed_categories text[] not null,
  status text not null default 'approved' check (status in ('draft','approved','active','closed','cancelled')),
  exception_of uuid references public.field_budgets(id),
  exception_reason text,
  authorized_by uuid not null references public.profiles(id),
  authorized_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (period_end >= period_start),
  check ((exception_of is null and exception_reason is null) or
    (exception_of is not null and nullif(btrim(exception_reason),'') is not null))
);
create unique index field_startup_once_idx on public.field_budgets(sales_rep_id)
  where kind = 'startup' and exception_of is null;
create index field_budgets_rep_period_idx on public.field_budgets(sales_rep_id,period_start,period_end);
create index field_budgets_status_idx on public.field_budgets(status,kind);

create table public.field_advances (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null unique references public.field_budgets(id),
  sales_rep_id uuid not null references public.profiles(id),
  requested_xof bigint not null check (requested_xof > 0),
  approved_xof bigint check (approved_xof is null or approved_xof > 0),
  disbursed_xof bigint check (disbursed_xof is null or disbursed_xof > 0),
  status text not null default 'requested' check (status in ('requested','approved','disbursed','rejected','cancelled','closed')),
  requested_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  disbursed_by uuid references public.profiles(id),
  disbursed_at timestamptz,
  transfer_method text,
  transfer_reference text,
  handover_proof_path text unique,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  check (disbursed_xof is null or (approved_xof is not null and disbursed_xof <= approved_xof)),
  check (status not in ('disbursed','closed') or
    (disbursed_xof is not null and disbursed_at is not null and disbursed_by is not null and
     handover_proof_path is not null and transfer_reference is not null))
);
create index field_advances_rep_status_idx on public.field_advances(sales_rep_id,status);
create unique index field_advance_transfer_reference_idx on public.field_advances(transfer_method,lower(btrim(transfer_reference)))
  where transfer_reference is not null and status in ('disbursed','closed');

create table public.field_expenses (
  id uuid primary key default gen_random_uuid(),
  sales_rep_id uuid not null references public.profiles(id),
  budget_id uuid references public.field_budgets(id),
  advance_id uuid references public.field_advances(id),
  category text not null check (category in ('communication','transport','other')),
  funding_source text not null check (funding_source in ('advance','personal','company')),
  amount_xof bigint not null check (amount_xof > 0),
  incurred_at timestamptz not null,
  period_start date,
  period_end date,
  description text not null,
  prospecting_zone text,
  transport_mode text,
  beneficiary_phone text,
  payment_reference text,
  lead_id uuid references public.leads(id),
  proof_path text unique,
  status text not null default 'submitted' check (status in ('submitted','needs_info','approved','rejected','regularized')),
  reimbursement_status text not null default 'not_applicable'
    check (reimbursement_status in ('not_applicable','due','paid')),
  reimbursement_reference text,
  reimbursed_at timestamptz,
  submitted_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  exception_reason text,
  created_at timestamptz not null default now(),
  check ((funding_source = 'advance' and advance_id is not null) or
    (funding_source <> 'advance' and advance_id is null)),
  check ((period_start is null and period_end is null) or
    (period_start is not null and period_end is not null and period_end >= period_start)),
  check ((reimbursement_status = 'paid' and funding_source = 'personal' and
    reimbursement_reference is not null and reimbursed_at is not null) or reimbursement_status <> 'paid')
);
create index field_expenses_rep_date_idx on public.field_expenses(sales_rep_id,incurred_at desc);
create index field_expenses_budget_status_idx on public.field_expenses(budget_id,status);
create index field_expenses_advance_status_idx on public.field_expenses(advance_id,status);
create unique index field_reimbursement_reference_idx on public.field_expenses(lower(btrim(reimbursement_reference)))
  where reimbursement_reference is not null and reimbursement_status='paid';
create unique index field_communication_period_once_idx on public.field_expenses(sales_rep_id,period_start,period_end)
  where category = 'communication' and status <> 'rejected';

create table public.field_restitutions (
  id uuid primary key default gen_random_uuid(),
  advance_id uuid not null references public.field_advances(id),
  amount_xof bigint not null check (amount_xof > 0),
  declared_by uuid not null references public.profiles(id),
  declared_at timestamptz not null default now(),
  status text not null default 'declared' check (status in ('declared','verified','rejected')),
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  received_reference text,
  proof_path text unique,
  reason text,
  check (status <> 'verified' or (verified_by is not null and verified_at is not null and
    received_reference is not null and proof_path is not null))
);
create index field_restitutions_advance_idx on public.field_restitutions(advance_id,status);
create unique index field_restitution_reference_idx on public.field_restitutions(lower(btrim(received_reference)))
  where received_reference is not null and status='verified';

create table public.field_finance_events (
  id bigint generated always as identity primary key,
  entity_kind text not null check (entity_kind in ('policy','permission','budget','advance','expense','restitution','commission_policy','commission','commission_payout')),
  entity_id uuid not null,
  event_type text not null,
  actor_id uuid not null references public.profiles(id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index field_finance_events_entity_idx on public.field_finance_events(entity_kind,entity_id,created_at desc);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('cortexia-field-proofs','cortexia-field-proofs',false,5242880,
  array['application/pdf','image/jpeg','image/png']::text[])
on conflict(id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.field_policy_versions enable row level security;
alter table public.field_budget_permissions enable row level security;
alter table public.field_budgets enable row level security;
alter table public.field_advances enable row level security;
alter table public.field_expenses enable row level security;
alter table public.field_restitutions enable row level security;
alter table public.field_finance_events enable row level security;
revoke all on public.field_policy_versions,public.field_budget_permissions,public.field_budgets,
  public.field_advances,public.field_expenses,public.field_restitutions,public.field_finance_events from anon,authenticated;
grant select on public.field_policy_versions,public.field_budget_permissions,public.field_budgets,
  public.field_advances,public.field_expenses,public.field_restitutions,public.field_finance_events to authenticated;

create policy field_policy_select on public.field_policy_versions for select to authenticated
using (private.current_app_role() is not null);
create policy field_permission_select on public.field_budget_permissions for select to authenticated
using (private.current_app_role() = 'admin' or user_id = (select auth.uid()));
create policy field_budget_select on public.field_budgets for select to authenticated
using (private.current_app_role() in ('admin','sales_manager') or sales_rep_id = (select auth.uid()));
create policy field_advance_select on public.field_advances for select to authenticated
using (private.current_app_role() in ('admin','sales_manager') or sales_rep_id = (select auth.uid()));
create policy field_expense_select on public.field_expenses for select to authenticated
using (private.current_app_role() in ('admin','sales_manager') or sales_rep_id = (select auth.uid()));
create policy field_restitution_select on public.field_restitutions for select to authenticated
using (exists (select 1 from public.field_advances a where a.id = advance_id));
create policy field_event_select on public.field_finance_events for select to authenticated
using (private.current_app_role() in ('admin','sales_manager') or
  exists(select 1 from public.field_budgets b where b.id = entity_id and b.sales_rep_id = (select auth.uid())) or
  exists(select 1 from public.field_advances a where a.id = entity_id and a.sales_rep_id = (select auth.uid())) or
  exists(select 1 from public.field_expenses e where e.id = entity_id and e.sales_rep_id = (select auth.uid())));

create policy field_proof_insert on storage.objects for insert to authenticated
with check (bucket_id = 'cortexia-field-proofs' and name like 'field/' || (select auth.uid())::text || '/%');
create policy field_proof_select on storage.objects for select to authenticated
using (bucket_id = 'cortexia-field-proofs' and (
  private.current_app_role() = 'admin' or
  (private.current_app_role() = 'sales_manager' and exists
    (select 1 from public.field_budget_permissions p where p.user_id=(select auth.uid()) and p.enabled)) or
  name like 'field/' || (select auth.uid())::text || '/%'
));
