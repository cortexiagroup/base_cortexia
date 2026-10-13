-- Prompt 5: financial declarations, verified ledger and durable document requests.
alter type public.payment_status add value if not exists 'cancelled';
alter type public.document_type add value if not exists 'payment_instruction';

create table public.payment_accounts (
  id uuid primary key default gen_random_uuid(),
  method public.payment_method not null,
  provider_name text,
  holder_name text,
  account_identifier text,
  client_instructions text not null,
  internal_notes text,
  cash_responsible_id uuid references public.profiles(id),
  is_active boolean not null default false,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (method <> 'cash' or account_identifier is null),
  check (method <> 'cash' or not is_active or cash_responsible_id is not null),
  check (method = 'cash' or (provider_name is not null and holder_name is not null and account_identifier is not null))
);
create index payment_accounts_active_idx on public.payment_accounts(method, is_active);
create trigger payment_accounts_set_updated_at before update on public.payment_accounts
for each row execute function public.set_updated_at();

create table public.finance_verifiers (
  user_id uuid primary key references public.profiles(id),
  enabled boolean not null default true,
  granted_by uuid not null references public.profiles(id),
  granted_at timestamptz not null default now()
);

alter table public.payments
  add column payment_account_id uuid references public.payment_accounts(id),
  add column installment_id uuid references public.order_installments(id),
  add column declared_at timestamptz not null default now(),
  add column review_state text not null default 'awaiting'
    check (review_state in ('declared','awaiting','needs_info','resolved')),
  add column proof_path text unique,
  add column verification_source text,
  add column verification_reference text,
  add column verification_note text,
  add column cash_received_by uuid references public.profiles(id),
  add column cash_handed_over_at timestamptz;
create index payments_order_status_created_idx on public.payments(order_id, status, created_at desc);
create index payments_account_status_idx on public.payments(payment_account_id, status);
create index payments_pending_idx on public.payments(created_at desc) where status = 'pending';
create unique index payments_confirmed_reference_idx on public.payments(method, payment_account_id, lower(btrim(transaction_reference)))
  where status = 'confirmed' and transaction_reference is not null and payment_account_id is not null;
create unique index payments_verified_reference_idx on public.payments(method, payment_account_id, lower(btrim(verification_reference)))
  where status = 'confirmed' and verification_reference is not null and payment_account_id is not null;

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  actor_id uuid not null references public.profiles(id),
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index payment_events_payment_idx on public.payment_events(payment_id, created_at desc);

create table public.financial_adjustments (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  order_id uuid not null references public.orders(id),
  kind text not null check (kind in ('correction','refund')),
  amount_xof bigint not null check (amount_xof > 0),
  status text not null default 'requested' check (status in ('requested','approved','executed','rejected')),
  reason text not null,
  verification_source text,
  external_reference text,
  requested_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  executed_by uuid references public.profiles(id),
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  executed_at timestamptz
);
create index financial_adjustments_payment_idx on public.financial_adjustments(payment_id, requested_at desc);
create index financial_adjustments_order_idx on public.financial_adjustments(order_id, status);

create table public.financial_ledger (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id),
  payment_id uuid references public.payments(id),
  adjustment_id uuid references public.financial_adjustments(id),
  entry_kind text not null check (entry_kind in ('collection','correction','refund')),
  amount_xof bigint not null check (amount_xof <> 0),
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now(),
  check ((entry_kind = 'collection' and payment_id is not null and adjustment_id is null and amount_xof > 0)
    or (entry_kind in ('correction','refund') and payment_id is null and adjustment_id is not null and amount_xof < 0))
);
create unique index financial_ledger_payment_once_idx on public.financial_ledger(payment_id) where payment_id is not null;
create unique index financial_ledger_adjustment_once_idx on public.financial_ledger(adjustment_id) where adjustment_id is not null;
create index financial_ledger_order_idx on public.financial_ledger(order_id, recorded_at);

create table public.finance_settings (
  id boolean primary key default true check (id),
  receipt_prefix text not null default 'CTX-REC' check (receipt_prefix ~ '^[A-Z0-9-]{3,20}$'),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.finance_settings(id) values(true);
create trigger finance_settings_set_updated_at before update on public.finance_settings
for each row execute function public.set_updated_at();
create sequence public.finance_receipt_number_seq;
create sequence public.finance_instruction_number_seq;

create table public.finance_document_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('receipt','instructions')),
  payment_id uuid references public.payments(id),
  order_id uuid not null references public.orders(id),
  installment_id uuid references public.order_installments(id),
  document_number text not null unique,
  snapshot jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','failed','completed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  last_attempt_at timestamptz,
  storage_path text unique,
  content_hash text,
  document_id uuid unique references public.documents(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((kind = 'receipt' and payment_id is not null) or
    (kind = 'instructions' and payment_id is null)),
  check (status <> 'completed' or (document_id is not null and storage_path is not null and content_hash is not null))
);
create unique index finance_receipt_job_once_idx on public.finance_document_jobs(payment_id) where kind = 'receipt';
create index finance_document_jobs_pending_idx on public.finance_document_jobs(status, created_at) where status in ('pending','failed');
create index finance_document_jobs_order_idx on public.finance_document_jobs(order_id, created_at desc);

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('cortexia-payment-proofs', 'cortexia-payment-proofs', false, 5242880,
  array['image/jpeg','image/png','application/pdf']::text[])
on conflict(id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.payment_accounts enable row level security;
alter table public.finance_verifiers enable row level security;
alter table public.payment_events enable row level security;
alter table public.financial_adjustments enable row level security;
alter table public.financial_ledger enable row level security;
alter table public.finance_settings enable row level security;
alter table public.finance_document_jobs enable row level security;

grant select on public.payment_accounts, public.finance_verifiers, public.payment_events,
  public.financial_adjustments, public.financial_ledger, public.finance_settings,
  public.finance_document_jobs to authenticated;
revoke all on public.payment_accounts, public.finance_verifiers, public.payment_events,
  public.financial_adjustments, public.financial_ledger, public.finance_settings,
  public.finance_document_jobs from anon;
revoke insert, update, delete on public.payments from authenticated;
drop policy if exists payments_insert on public.payments;

create policy payment_accounts_admin_select on public.payment_accounts for select to authenticated
using ((select private.current_app_role()) = 'admin');
create policy finance_verifiers_admin_select on public.finance_verifiers for select to authenticated
using ((select private.current_app_role()) = 'admin' or user_id = (select auth.uid()));
create policy payment_events_select on public.payment_events for select to authenticated
using (exists (select 1 from public.payments p where p.id = payment_id));
create policy financial_adjustments_select on public.financial_adjustments for select to authenticated
using (exists (select 1 from public.orders o where o.id = order_id));
create policy financial_ledger_select on public.financial_ledger for select to authenticated
using (exists (select 1 from public.orders o where o.id = order_id));
create policy finance_settings_admin_select on public.finance_settings for select to authenticated
using ((select private.current_app_role()) = 'admin');
create policy finance_document_jobs_select on public.finance_document_jobs for select to authenticated
using (exists (select 1 from public.orders o where o.id = order_id));

create policy payment_proofs_insert on storage.objects for insert to authenticated
with check (bucket_id = 'cortexia-payment-proofs' and exists (
  select 1 from public.payments p where name like 'payments/' || p.id::text || '/%'
    and p.created_by = (select auth.uid()) and p.status = 'pending'
));
create policy payment_proofs_select on storage.objects for select to authenticated
using (bucket_id = 'cortexia-payment-proofs' and exists (
  select 1 from public.payments p where p.proof_path = name
));

-- Preserve previously confirmed entries when upgrading an existing installation.
insert into public.financial_ledger(order_id, payment_id, entry_kind, amount_xof, recorded_by, recorded_at)
select order_id, id, 'collection', amount_xof, verified_by, verified_at
from public.payments where status = 'confirmed' and verified_by is not null and verified_at is not null;
