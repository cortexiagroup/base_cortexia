-- Prompt 4: a published row is a version, never a mutable price list entry.
alter type public.order_status add value if not exists 'in_progress';

create type public.commercial_offer_status as enum ('draft', 'active', 'suspended', 'archived');
create type public.commercial_proposal_status as enum
  ('draft', 'pending_approval', 'approved', 'sent', 'accepted', 'rejected', 'expired', 'cancelled');
create type public.commercial_payment_plan as enum ('full_upfront', 'half_on_delivery');

alter table public.offer_templates
  add column family_id uuid not null default gen_random_uuid(),
  add column category text,
  add column currency text not null default 'XOF' check (currency = 'XOF'),
  add column price_is_starting boolean not null default false,
  add column validity_days integer check (validity_days is null or validity_days between 1 and 365),
  add column status public.commercial_offer_status not null default 'draft',
  add column updated_by uuid references public.profiles(id),
  add column updated_at timestamptz not null default now(),
  add column published_at timestamptz;
update public.offer_templates set status = case when is_active then 'active'::public.commercial_offer_status else 'suspended'::public.commercial_offer_status end,
  published_at = case when is_active then created_at else null end;
alter table public.offer_templates add constraint offer_family_version_unique unique (family_id, version);
create index offer_templates_catalog_idx on public.offer_templates(status, category, name);
create index offer_templates_family_idx on public.offer_templates(family_id, version desc);
create trigger offer_templates_set_updated_at before update on public.offer_templates
for each row execute function public.set_updated_at();

create table public.commercial_settings (
  id boolean primary key default true check (id),
  company_name text not null default 'Cortexia',
  professional_email text,
  professional_phone text,
  postal_address text,
  legal_mentions text,
  logo_storage_path text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.commercial_settings(id, company_name) values (true, 'Cortexia');
create trigger commercial_settings_set_updated_at before update on public.commercial_settings
for each row execute function public.set_updated_at();

create sequence public.proposal_number_seq;
create sequence public.commercial_order_number_seq;

create table public.commercial_proposals (
  id uuid primary key default gen_random_uuid(),
  proposal_number text not null unique,
  lead_id uuid not null references public.leads(id),
  company_id uuid not null references public.companies(id),
  contact_id uuid references public.contacts(id),
  sales_rep_id uuid not null references public.profiles(id),
  offer_template_id uuid not null references public.offer_templates(id),
  offer_version integer not null,
  offer_snapshot jsonb not null,
  client_snapshot jsonb not null,
  service_description text not null,
  base_price_xof bigint not null check (base_price_xof >= 0),
  discount_xof bigint not null default 0 check (discount_xof >= 0),
  amount_xof bigint not null check (amount_xof >= 0),
  payment_plan public.commercial_payment_plan not null,
  special_terms text,
  delivery_days integer check (delivery_days is null or delivery_days >= 0),
  expires_at timestamptz not null,
  status public.commercial_proposal_status not null default 'draft',
  requires_approval boolean not null default false,
  approval_reason text,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  sent_by uuid references public.profiles(id),
  sent_at timestamptz,
  sent_channel text,
  acceptance_recorded_by uuid references public.profiles(id),
  accepted_at timestamptz,
  acceptance_channel text,
  acceptance_reference text,
  acceptance_verified boolean not null default false,
  acceptance_verified_by uuid references public.profiles(id),
  acceptance_verified_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (offer_template_id, offer_version) references public.offer_templates(id, version),
  check (amount_xof = base_price_xof - discount_xof),
  check (discount_xof <= base_price_xof),
  check (not acceptance_verified or (acceptance_verified_by is not null and acceptance_verified_at is not null and accepted_at is not null))
);
create index commercial_proposals_lead_idx on public.commercial_proposals(lead_id, created_at desc);
create index commercial_proposals_rep_status_idx on public.commercial_proposals(sales_rep_id, status, created_at desc);
create index commercial_proposals_offer_idx on public.commercial_proposals(offer_template_id);
create trigger commercial_proposals_set_updated_at before update on public.commercial_proposals
for each row execute function public.set_updated_at();

create table public.commercial_proposal_events (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.commercial_proposals(id),
  actor_id uuid not null references public.profiles(id),
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index commercial_proposal_events_idx on public.commercial_proposal_events(proposal_id, created_at desc);

alter table public.documents
  add column proposal_id uuid references public.commercial_proposals(id),
  add column document_version integer check (document_version is null or document_version > 0),
  add column document_status text not null default 'issued' check (document_status in ('issued', 'superseded', 'void'));
create unique index documents_proposal_version_idx on public.documents(proposal_id, document_version)
  where proposal_id is not null;
create index documents_proposal_idx on public.documents(proposal_id, issued_at desc);

alter table public.orders
  add column proposal_id uuid unique references public.commercial_proposals(id),
  add column payment_plan public.commercial_payment_plan,
  add column payment_terms_snapshot jsonb,
  add column production_status_note text;
create index orders_lead_idx on public.orders(lead_id, ordered_at desc);
create index orders_rep_status_idx on public.orders(sales_rep_id, order_status, ordered_at desc);

create table public.order_installments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  installment_number integer not null check (installment_number between 1 and 2),
  trigger_event text not null check (trigger_event in ('at_order', 'at_delivery')),
  percentage_bps integer not null check (percentage_bps between 1 and 10000),
  amount_xof bigint not null check (amount_xof >= 0),
  due_at timestamptz,
  terms text,
  created_at timestamptz not null default now(),
  unique(order_id, installment_number)
);
create index order_installments_order_idx on public.order_installments(order_id);

create table public.commercial_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  actor_id uuid not null references public.profiles(id),
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index commercial_order_events_idx on public.commercial_order_events(order_id, created_at desc);

alter table public.commercial_settings enable row level security;
alter table public.commercial_proposals enable row level security;
alter table public.commercial_proposal_events enable row level security;
alter table public.order_installments enable row level security;
alter table public.commercial_order_events enable row level security;
grant select on public.commercial_settings, public.commercial_proposals,
  public.commercial_proposal_events, public.order_installments, public.commercial_order_events to authenticated;
grant update on public.commercial_settings to authenticated;
revoke all on public.commercial_settings, public.commercial_proposals,
  public.commercial_proposal_events, public.order_installments, public.commercial_order_events from anon;

drop policy if exists offers_select on public.offer_templates;
create policy offers_select on public.offer_templates for select to authenticated
using ((select private.crm_active()) and (status = 'active' or (select private.can_manage_all())));
revoke insert, update, delete on public.offer_templates from authenticated;

create policy commercial_settings_select on public.commercial_settings for select to authenticated
using ((select private.crm_active()));
create policy commercial_settings_update on public.commercial_settings for update to authenticated
using ((select private.current_app_role()) = 'admin')
with check ((select private.current_app_role()) = 'admin');

create policy commercial_proposals_select on public.commercial_proposals for select to authenticated
using ((select private.crm_active()) and ((select private.can_manage_all()) or
  (sales_rep_id = (select auth.uid()) and exists (
    select 1 from public.leads l where l.id = lead_id and l.assigned_to = (select auth.uid())
  ))));
create policy commercial_proposal_events_select on public.commercial_proposal_events for select to authenticated
using (exists (select 1 from public.commercial_proposals p where p.id = proposal_id));
create policy order_installments_select on public.order_installments for select to authenticated
using (exists (select 1 from public.orders o where o.id = order_id));
create policy commercial_order_events_select on public.commercial_order_events for select to authenticated
using (exists (select 1 from public.orders o where o.id = order_id));

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select to authenticated
using ((select private.crm_active()) and ((select private.can_manage_all()) or
  (sales_rep_id = (select auth.uid()) and exists (
    select 1 from public.leads l where l.id = orders.lead_id and l.assigned_to = (select auth.uid())
  ))));
revoke insert, update, delete on public.orders from authenticated;

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select to authenticated
using ((select private.crm_active()) and ((select private.can_manage_all()) or
  (proposal_id is not null and exists (
    select 1 from public.commercial_proposals p where p.id = proposal_id
  )) or (order_id is not null and exists (
    select 1 from public.orders o where o.id = order_id
  ))));
revoke insert, update, delete on public.documents from authenticated;
drop policy if exists storage_documents_insert on storage.objects;
drop policy if exists storage_documents_select on storage.objects;
create policy storage_documents_select on storage.objects for select to authenticated
using (bucket_id = 'cortexia-documents' and exists (
  select 1 from public.documents d where d.storage_path = name
));

-- No invoice, collection, or receipt is created by these commercial structures.
insert into public.offer_templates
  (name, category, description, price_xof, price_is_starting, status, is_active,
   benefits, included_services, exclusions, payment_terms)
values ('Site web personnalisé', 'Sites web',
  'Création de site web personnalisé pour PME. Conditions à compléter puis publier par un administrateur.',
  49000, true, 'draft', false, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, null);
