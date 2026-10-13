-- Commission versions are published, never edited. No default active commission exists.
create table public.sales_commission_policies (
  id uuid primary key default gen_random_uuid(),
  version_no integer not null unique,
  name text not null,
  effective_from date not null,
  basis text not null check (basis in ('confirmed_collected_amount','fixed_per_sale','gross_margin')),
  vesting text not null check (vesting in ('progressive','full_collection')),
  rate_bps integer check (rate_bps is null or rate_bps between 0 and 10000),
  fixed_amount_xof bigint check (fixed_amount_xof is null or fixed_amount_xof >= 0),
  offer_template_id uuid references public.offer_templates(id),
  sales_rep_id uuid references public.profiles(id),
  refund_rule text not null default 'recalculate' check (refund_rule in ('recalculate','manual_review')),
  eligibility jsonb not null default '{}'::jsonb,
  published_by uuid not null references public.profiles(id),
  published_at timestamptz not null default now(),
  check ((basis='fixed_per_sale' and fixed_amount_xof is not null and rate_bps is null) or
    (basis<>'fixed_per_sale' and rate_bps is not null and fixed_amount_xof is null))
);
create index sales_commission_policy_scope_idx on public.sales_commission_policies(effective_from,offer_template_id,sales_rep_id);

create table public.sales_commission_positions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id),
  sales_rep_id uuid not null references public.profiles(id),
  policy_id uuid not null references public.sales_commission_policies(id),
  policy_snapshot jsonb not null,
  eligible_base_xof bigint not null default 0 check (eligible_base_xof >= 0),
  acquired_xof bigint not null default 0 check (acquired_xof >= 0),
  approved_xof bigint not null default 0 check (approved_xof >= 0),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index sales_commission_positions_rep_idx on public.sales_commission_positions(sales_rep_id);

create table public.sales_commission_payouts (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.sales_commission_positions(id),
  amount_xof bigint not null check (amount_xof > 0),
  paid_at timestamptz not null,
  method text not null,
  external_reference text not null unique,
  proof_path text unique,
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index sales_commission_payouts_position_idx on public.sales_commission_payouts(position_id);

alter table public.sales_commission_policies enable row level security;
alter table public.sales_commission_positions enable row level security;
alter table public.sales_commission_payouts enable row level security;
revoke all on public.sales_commission_policies,public.sales_commission_positions,public.sales_commission_payouts from anon,authenticated;
grant select on public.sales_commission_policies,public.sales_commission_positions,public.sales_commission_payouts to authenticated;
create policy sales_commission_policy_select on public.sales_commission_policies for select to authenticated
using (private.current_app_role() is not null);
create policy sales_commission_position_select on public.sales_commission_positions for select to authenticated
using (private.current_app_role() in ('admin','sales_manager') or sales_rep_id=(select auth.uid()));
create policy sales_commission_payout_select on public.sales_commission_payouts for select to authenticated
using (exists(select 1 from public.sales_commission_positions p where p.id=position_id));

create or replace function public.sales_publish_commission_policy(p_data jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_id uuid; v_version integer;
begin
  if private.current_app_role()<>'admin' then raise exception 'administrator required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(61220602);
  select coalesce(max(version_no),0)+1 into v_version from public.sales_commission_policies;
  if p_data->>'basis' not in ('confirmed_collected_amount','fixed_per_sale','gross_margin') or
    p_data->>'vesting' not in ('progressive','full_collection') or
    (p_data->>'effective_from')::date is null or nullif(btrim(p_data->>'name'),'') is null or
    (p_data->>'basis'='fixed_per_sale' and p_data->>'vesting'<>'full_collection')
    then raise exception 'invalid policy'; end if;
  insert into public.sales_commission_policies(version_no,name,effective_from,basis,vesting,rate_bps,
    fixed_amount_xof,offer_template_id,sales_rep_id,refund_rule,eligibility,published_by)
  values(v_version,btrim(p_data->>'name'),(p_data->>'effective_from')::date,p_data->>'basis',
    p_data->>'vesting',nullif(p_data->>'rate_bps','')::integer,
    nullif(p_data->>'fixed_amount_xof','')::bigint,
    nullif(p_data->>'offer_template_id','')::uuid,nullif(p_data->>'sales_rep_id','')::uuid,
    coalesce(p_data->>'refund_rule','recalculate'),coalesce(p_data->'eligibility','{}'::jsonb),v_actor)
  returning id into v_id;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('commission_policy',v_id,'published',v_actor,pg_catalog.jsonb_build_object('version',v_version));
  return v_id;
end $$;
revoke all on function public.sales_publish_commission_policy(jsonb) from public,anon;
grant execute on function public.sales_publish_commission_policy(jsonb) to authenticated;

create or replace function public.sales_recalculate_commission(p_order uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_order public.orders%rowtype;
  v_policy public.sales_commission_policies%rowtype; v_position public.sales_commission_positions%rowtype;
  v_net bigint; v_basis bigint; v_amount bigint; v_id uuid;
begin
  if private.current_app_role()<>'admin' then raise exception 'administrator required'; end if;
  select * into v_order from public.orders where id=p_order for update;
  if v_order.id is null or v_order.order_status not in ('confirmed','in_progress','completed')
    then raise exception 'confirmed order required'; end if;
  select * into v_position from public.sales_commission_positions where order_id=p_order for update;
  if v_position.id is null then
    select * into v_policy from public.sales_commission_policies
    where effective_from<=v_order.ordered_at::date and
      (offer_template_id is null or offer_template_id=v_order.offer_template_id) and
      (sales_rep_id is null or sales_rep_id=v_order.sales_rep_id)
    order by effective_from desc,
      (case when sales_rep_id is not null then 1 else 0 end)+
      (case when offer_template_id is not null then 1 else 0 end) desc,version_no desc limit 1;
    if v_policy.id is null then raise exception 'no configured commission policy'; end if;
  else
    select * into v_policy from public.sales_commission_policies where id=v_position.policy_id;
  end if;
  if v_policy.basis='gross_margin' then raise exception 'Données insuffisantes : coûts directs et revenu reconnu requis'; end if;
  select coalesce(sum(amount_xof),0)::bigint into v_net from public.financial_ledger where order_id=p_order;
  v_net:=greatest(v_net,0);
  v_basis:=case when v_policy.vesting='full_collection' and v_net<v_order.amount_xof then 0
    else least(v_net,v_order.amount_xof) end;
  if v_policy.basis='fixed_per_sale' then
    v_amount:=case when v_net>=v_order.amount_xof then v_policy.fixed_amount_xof else 0 end;
  else
    -- Round half up in integer FCFA. Recalculate cumulatively to avoid per-installment drift.
    v_amount:=pg_catalog.floor((v_basis::numeric*v_policy.rate_bps+5000)/10000)::bigint;
  end if;
  if v_position.id is null then
    insert into public.sales_commission_positions(order_id,sales_rep_id,policy_id,policy_snapshot,
      eligible_base_xof,acquired_xof)
    values(p_order,v_order.sales_rep_id,v_policy.id,pg_catalog.to_jsonb(v_policy),v_basis,v_amount)
    returning id into v_id;
  else
    v_id:=v_position.id;
    if v_position.eligible_base_xof<>v_basis or v_position.acquired_xof<>v_amount then
      update public.sales_commission_positions set eligible_base_xof=v_basis,acquired_xof=v_amount,
        calculated_at=now() where id=v_id;
    end if;
  end if;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('commission',v_id,'recalculated',v_actor,pg_catalog.jsonb_build_object(
      'net_collected_xof',v_net,'base_xof',v_basis,'acquired_xof',v_amount));
  return v_id;
end $$;
revoke all on function public.sales_recalculate_commission(uuid) from public,anon;
grant execute on function public.sales_recalculate_commission(uuid) to authenticated;

create or replace function public.sales_approve_commission(p_position uuid,p_amount bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_position public.sales_commission_positions%rowtype;
  v_paid bigint;
begin
  if private.current_app_role()<>'admin' then raise exception 'administrator required'; end if;
  select * into v_position from public.sales_commission_positions where id=p_position for update;
  if v_position.id is null or v_position.sales_rep_id=v_actor or p_amount is null or
    p_amount<0 or p_amount>v_position.acquired_xof then raise exception 'eligible commission required'; end if;
  select coalesce(sum(amount_xof),0) into v_paid from public.sales_commission_payouts where position_id=p_position;
  if p_amount<v_paid then raise exception 'approval cannot fall below already paid'; end if;
  update public.sales_commission_positions set approved_xof=p_amount,approved_by=v_actor,
    approved_at=now() where id=p_position;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('commission',p_position,'approved',v_actor,pg_catalog.jsonb_build_object('amount_xof',p_amount));
end $$;
revoke all on function public.sales_approve_commission(uuid,bigint) from public,anon;
grant execute on function public.sales_approve_commission(uuid,bigint) to authenticated;

create or replace function public.sales_record_commission_payout(p_position uuid,p_amount bigint,
  p_paid_at timestamptz,p_method text,p_reference text,p_proof text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_position public.sales_commission_positions%rowtype;
  v_paid bigint; v_id uuid;
begin
  if private.current_app_role()<>'admin' then raise exception 'administrator required'; end if;
  select * into v_position from public.sales_commission_positions where id=p_position for update;
  if v_position.id is null or v_position.sales_rep_id=v_actor or p_amount is null or p_amount<=0 or
    p_paid_at is null or p_paid_at>now()+interval '1 day' or nullif(btrim(p_method),'') is null or
    nullif(btrim(p_reference),'') is null then raise exception 'verified payout details required'; end if;
  select coalesce(sum(amount_xof),0) into v_paid from public.sales_commission_payouts where position_id=p_position;
  if p_amount>least(v_position.approved_xof,v_position.acquired_xof)-v_paid then
    raise exception 'payout exceeds currently payable commission'; end if;
  if p_proof is not null and (p_proof not like 'field/'||v_actor::text||'/%' or
    not exists(select 1 from storage.objects where bucket_id='cortexia-field-proofs' and name=p_proof))
    then raise exception 'private payout proof required'; end if;
  insert into public.sales_commission_payouts(position_id,amount_xof,paid_at,method,external_reference,
    proof_path,recorded_by)
  values(p_position,p_amount,p_paid_at,btrim(p_method),btrim(p_reference),p_proof,v_actor)
  returning id into v_id;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('commission_payout',v_id,'recorded',v_actor,
      pg_catalog.jsonb_build_object('amount_xof',p_amount,'reference',p_reference));
  return v_id;
end $$;
revoke all on function public.sales_record_commission_payout(uuid,bigint,timestamptz,text,text,text) from public,anon;
grant execute on function public.sales_record_commission_payout(uuid,bigint,timestamptz,text,text,text) to authenticated;

-- Existing positions follow verified collections/corrections; this never creates a policy or pays a commission.
create or replace function private.sales_refresh_position_on_ledger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_position public.sales_commission_positions%rowtype;
  v_policy public.sales_commission_policies%rowtype; v_order public.orders%rowtype;
  v_net bigint; v_basis bigint; v_amount bigint;
begin
  select * into v_position from public.sales_commission_positions where order_id=new.order_id for update;
  if v_position.id is null then return new; end if;
  select * into v_policy from public.sales_commission_policies where id=v_position.policy_id;
  if v_policy.basis='gross_margin' then return new; end if;
  select * into v_order from public.orders where id=new.order_id;
  select greatest(coalesce(sum(amount_xof),0),0)::bigint into v_net from public.financial_ledger
    where order_id=new.order_id;
  v_basis:=case when v_policy.vesting='full_collection' and v_net<v_order.amount_xof then 0
    else least(v_net,v_order.amount_xof) end;
  v_amount:=case when v_policy.basis='fixed_per_sale' then
    case when v_net>=v_order.amount_xof then v_policy.fixed_amount_xof else 0 end
    else pg_catalog.floor((v_basis::numeric*v_policy.rate_bps+5000)/10000)::bigint end;
  if v_position.eligible_base_xof<>v_basis or v_position.acquired_xof<>v_amount then
    update public.sales_commission_positions set eligible_base_xof=v_basis,acquired_xof=v_amount,
      calculated_at=now() where id=v_position.id;
    insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
      values('commission',v_position.id,'ledger_recalculated',new.recorded_by,
        pg_catalog.jsonb_build_object('ledger_entry_id',new.id,'acquired_xof',v_amount));
  end if;
  return new;
end $$;
create trigger sales_commission_ledger_refresh after insert on public.financial_ledger
for each row execute function private.sales_refresh_position_on_ledger();

create or replace function private.field_prevent_history_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'published policy and financial event history are immutable';
end $$;
create trigger field_policy_immutable before update or delete on public.field_policy_versions
for each row execute function private.field_prevent_history_change();
create trigger commission_policy_immutable before update or delete on public.sales_commission_policies
for each row execute function private.field_prevent_history_change();
create trigger field_events_immutable before update or delete on public.field_finance_events
for each row execute function private.field_prevent_history_change();
