-- Controlled write API. SECURITY DEFINER functions use an empty search_path and explicit role checks.
create or replace function private.field_can_manage()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.current_app_role() = 'admin' or
    (private.current_app_role() = 'sales_manager' and exists (
      select 1 from public.field_budget_permissions p
      where p.user_id = (select auth.uid()) and p.enabled))
$$;
revoke all on function private.field_can_manage() from public,anon,authenticated;

create or replace function public.field_publish_policy(p_data jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_id uuid; v_version integer;
begin
  if private.current_app_role() <> 'admin' then raise exception 'administrator required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(61220601);
  select coalesce(max(version_no),0)+1 into v_version from public.field_policy_versions;
  if (p_data->>'effective_from')::date <= (select max(effective_from) from public.field_policy_versions)
    then raise exception 'new policy must start after prior version'; end if;
  if p_data ? 'allowed_categories' and (jsonb_array_length(p_data->'allowed_categories')=0 or
    exists(select 1 from jsonb_array_elements_text(p_data->'allowed_categories') as c(value)
      where c.value not in ('communication','transport','other'))) then
    raise exception 'invalid allowed categories'; end if;
  if p_data ? 'receipt_required_categories' and exists
    (select 1 from jsonb_array_elements_text(p_data->'receipt_required_categories') as c(value)
      where c.value not in ('communication','transport','other')) then
    raise exception 'invalid receipt categories'; end if;
  insert into public.field_policy_versions(version_no,effective_from,startup_amount_xof,
    communication_amount_xof,communication_interval_days,allowed_categories,
    receipt_required_categories,period_cap_xof,reimbursement_rules,approval_rules,created_by)
  values(v_version,(p_data->>'effective_from')::date,(p_data->>'startup_amount_xof')::bigint,
    (p_data->>'communication_amount_xof')::bigint,(p_data->>'communication_interval_days')::integer,
    case when p_data ? 'allowed_categories' then array(select jsonb_array_elements_text(p_data->'allowed_categories'))
      else array['communication','transport','other'] end,
    case when p_data ? 'receipt_required_categories' then array(select jsonb_array_elements_text(p_data->'receipt_required_categories'))
      else array['transport','other'] end,
    nullif(p_data->>'period_cap_xof','')::bigint,
    coalesce(p_data->'reimbursement_rules','{}'::jsonb),
    coalesce(p_data->'approval_rules','{}'::jsonb),v_actor) returning id into v_id;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('policy',v_id,'published',v_actor,pg_catalog.jsonb_build_object('version',v_version));
  return v_id;
end $$;
revoke all on function public.field_publish_policy(jsonb) from public,anon;
grant execute on function public.field_publish_policy(jsonb) to authenticated;

create or replace function public.field_set_budget_permission(p_user_id uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true);
begin
  if private.current_app_role() <> 'admin' then raise exception 'administrator required'; end if;
  if not exists(select 1 from public.profiles where id=p_user_id and role='sales_manager' and is_active)
    then raise exception 'active sales manager required'; end if;
  insert into public.field_budget_permissions(user_id,enabled,granted_by)
  values(p_user_id,p_enabled,v_actor)
  on conflict(user_id) do update set enabled=excluded.enabled,granted_by=v_actor,granted_at=now();
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('permission',p_user_id,'changed',v_actor,pg_catalog.jsonb_build_object('enabled',p_enabled));
end $$;
revoke all on function public.field_set_budget_permission(uuid,boolean) from public,anon;
grant execute on function public.field_set_budget_permission(uuid,boolean) to authenticated;

create or replace function public.field_create_budget(p_rep uuid,p_kind text,p_amount bigint,
  p_start date,p_end date,p_purpose text,p_zone text default null,p_exception_of uuid default null,
  p_exception_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_policy public.field_policy_versions%rowtype;
  v_id uuid; v_amount bigint;
begin
  if not private.field_can_manage() then raise exception 'budget authority required'; end if;
  if p_rep=v_actor or not exists(select 1 from public.profiles where id=p_rep and role='sales_rep' and is_active)
    then raise exception 'active commercial other than approver required'; end if;
  if p_kind not in ('startup','transport','other') or p_start is null or p_end<p_start or
    nullif(btrim(p_purpose),'') is null then raise exception 'invalid budget'; end if;
  if p_kind='transport' and nullif(btrim(p_zone),'') is null then
    raise exception 'prospecting zone required for transport'; end if;
  select * into v_policy from public.field_policy_versions where effective_from<=p_start
    order by effective_from desc limit 1;
  if v_policy.id is null then raise exception 'applicable policy unavailable'; end if;
  if p_kind='startup' then
    if private.current_app_role()<>'admin' then raise exception 'startup authority restricted to administrator'; end if;
    if p_exception_of is not null and (nullif(btrim(p_exception_reason),'') is null or
      not exists(select 1 from public.field_budgets where id=p_exception_of and sales_rep_id=p_rep and kind='startup'))
      then raise exception 'documented startup exception required'; end if;
    v_amount:=coalesce(p_amount,v_policy.startup_amount_xof);
  else
    if p_exception_of is not null then raise exception 'exception only for startup'; end if;
    v_amount:=p_amount;
  end if;
  if v_amount is null or v_amount<=0 then raise exception 'explicit positive amount required'; end if;
  insert into public.field_budgets(sales_rep_id,kind,policy_id,period_start,period_end,
    authorized_xof,purpose,prospecting_zone,allowed_categories,exception_of,exception_reason,authorized_by)
  values(p_rep,p_kind,v_policy.id,p_start,p_end,v_amount,btrim(p_purpose),nullif(btrim(p_zone),''),
    v_policy.allowed_categories,p_exception_of,nullif(btrim(p_exception_reason),''),v_actor)
  returning id into v_id;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('budget',v_id,'authorized',v_actor,pg_catalog.jsonb_build_object('kind',p_kind,'amount_xof',v_amount));
  return v_id;
end $$;
revoke all on function public.field_create_budget(uuid,text,bigint,date,date,text,text,uuid,text) from public,anon;
grant execute on function public.field_create_budget(uuid,text,bigint,date,date,text,text,uuid,text) to authenticated;

create or replace function public.field_request_advance(p_budget uuid,p_amount bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(false); v_budget public.field_budgets%rowtype; v_id uuid;
begin
  select * into v_budget from public.field_budgets where id=p_budget for update;
  if v_budget.id is null or v_budget.status not in ('approved','active') or
    not (v_budget.sales_rep_id=v_actor or private.field_can_manage()) then raise exception 'budget unavailable'; end if;
  if p_amount is null or p_amount<=0 or p_amount>v_budget.authorized_xof then raise exception 'invalid advance amount'; end if;
  insert into public.field_advances(budget_id,sales_rep_id,requested_xof,requested_by)
    values(p_budget,v_budget.sales_rep_id,p_amount,v_actor) returning id into v_id;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('advance',v_id,'requested',v_actor,pg_catalog.jsonb_build_object('amount_xof',p_amount));
  return v_id;
end $$;
revoke all on function public.field_request_advance(uuid,bigint) from public,anon;
grant execute on function public.field_request_advance(uuid,bigint) to authenticated;

create or replace function public.field_approve_advance(p_id uuid,p_approve boolean,p_amount bigint default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_advance public.field_advances%rowtype;
  v_budget public.field_budgets%rowtype; v_amount bigint;
begin
  if not private.field_can_manage() then raise exception 'budget authority required'; end if;
  select * into v_advance from public.field_advances where id=p_id for update;
  if v_advance.id is null or v_advance.status<>'requested' or v_advance.sales_rep_id=v_actor
    then raise exception 'request unavailable'; end if;
  select * into v_budget from public.field_budgets where id=v_advance.budget_id;
  v_amount:=coalesce(p_amount,v_advance.requested_xof);
  if p_approve and (v_amount<=0 or v_amount>v_advance.requested_xof or v_amount>v_budget.authorized_xof)
    then raise exception 'approved amount exceeds budget'; end if;
  update public.field_advances set status=case when p_approve then 'approved' else 'rejected' end,
    approved_xof=case when p_approve then v_amount else null end,approved_by=v_actor,approved_at=now()
    where id=p_id;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('advance',p_id,case when p_approve then 'approved' else 'rejected' end,v_actor,
      pg_catalog.jsonb_build_object('amount_xof',case when p_approve then v_amount else null end));
end $$;
revoke all on function public.field_approve_advance(uuid,boolean,bigint) from public,anon;
grant execute on function public.field_approve_advance(uuid,boolean,bigint) to authenticated;

create or replace function public.field_attach_proof(p_kind text,p_id uuid,p_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(false); v_owner uuid;
begin
  if p_path not like 'field/'||v_actor::text||'/%' or not exists
    (select 1 from storage.objects where bucket_id='cortexia-field-proofs' and name=p_path)
    then raise exception 'private proof uploaded by actor required'; end if;
  if p_kind='advance' then
    if not private.field_can_manage() then raise exception 'budget authority required'; end if;
    update public.field_advances set handover_proof_path=p_path where id=p_id and status='approved';
  elsif p_kind='expense' then
    update public.field_expenses set proof_path=p_path where id=p_id and sales_rep_id=v_actor
      and status in ('submitted','needs_info');
  elsif p_kind='restitution' then
    select a.sales_rep_id into v_owner from public.field_restitutions r
      join public.field_advances a on a.id=r.advance_id where r.id=p_id;
    if v_owner<>v_actor and not private.field_can_manage() then raise exception 'owner required'; end if;
    update public.field_restitutions set proof_path=p_path where id=p_id and status='declared';
  else raise exception 'invalid proof relation'; end if;
  if not found then raise exception 'record not attachable'; end if;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values(p_kind,p_id,'proof_attached',v_actor,pg_catalog.jsonb_build_object('path',p_path));
end $$;
revoke all on function public.field_attach_proof(text,uuid,text) from public,anon;
grant execute on function public.field_attach_proof(text,uuid,text) to authenticated;

create or replace function public.field_disburse_advance(p_id uuid,p_amount bigint,p_method text,p_reference text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_advance public.field_advances%rowtype;
  v_budget_id uuid;
begin
  if not private.field_can_manage() then raise exception 'budget authority required'; end if;
  select budget_id into v_budget_id from public.field_advances where id=p_id;
  if v_budget_id is null then raise exception 'advance not found'; end if;
  perform 1 from public.field_budgets where id=v_budget_id for update;
  select * into v_advance from public.field_advances where id=p_id for update;
  if v_advance.id is null or v_advance.status<>'approved' or v_advance.sales_rep_id=v_actor or
    v_advance.handover_proof_path is null then raise exception 'approved advance and handover proof required'; end if;
  if p_amount is null or p_amount<=0 or p_amount>v_advance.approved_xof or
    nullif(btrim(p_method),'') is null or nullif(btrim(p_reference),'') is null
    then raise exception 'verified transfer details required'; end if;
  update public.field_advances set status='disbursed',disbursed_xof=p_amount,disbursed_by=v_actor,
    disbursed_at=now(),transfer_method=btrim(p_method),transfer_reference=btrim(p_reference)
    where id=p_id;
  update public.field_budgets set status='active' where id=v_advance.budget_id and status='approved';
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('advance',p_id,'disbursed',v_actor,pg_catalog.jsonb_build_object('amount_xof',p_amount,'reference',p_reference));
end $$;
revoke all on function public.field_disburse_advance(uuid,bigint,text,text) from public,anon;
grant execute on function public.field_disburse_advance(uuid,bigint,text,text) to authenticated;

create or replace function public.field_submit_expense(p_budget uuid,p_category text,p_source text,
  p_amount bigint,p_incurred_at timestamptz,p_description text,p_advance uuid default null,
  p_period_start date default null,p_period_end date default null,p_zone text default null,
  p_transport_mode text default null,p_phone text default null,p_reference text default null,
  p_lead uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(false); v_budget public.field_budgets%rowtype;
  v_advance public.field_advances%rowtype; v_policy public.field_policy_versions%rowtype; v_id uuid;
begin
  select * into v_budget from public.field_budgets where id=p_budget;
  if v_budget.id is null or v_budget.sales_rep_id<>v_actor or v_budget.status not in ('approved','active')
    then raise exception 'own authorized budget required'; end if;
  select * into v_policy from public.field_policy_versions where id=v_budget.policy_id;
  if p_category not in ('communication','transport','other') or
    p_category <> all(v_budget.allowed_categories) or p_amount is null or p_amount<=0 or
    p_incurred_at is null or p_incurred_at>now()+interval '1 day' or
    p_incurred_at::date not between v_budget.period_start and v_budget.period_end or
    nullif(btrim(p_description),'') is null then raise exception 'invalid expense'; end if;
  if p_source='advance' then
    select * into v_advance from public.field_advances where id=p_advance;
    if v_advance.id is null or v_advance.budget_id<>p_budget or v_advance.status<>'disbursed'
      then raise exception 'disbursed advance required'; end if;
  elsif p_source not in ('personal','company') or p_advance is not null then
    raise exception 'invalid funding source';
  end if;
  if p_category='communication' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text,61220603));
    if p_period_start is null or p_period_end is null or
      p_period_end<>p_period_start+v_policy.communication_interval_days-1 or
      p_incurred_at::date not between p_period_start and p_period_end or
      p_amount>v_policy.communication_amount_xof then
      raise exception 'communication period or amount exceeds policy'; end if;
    if exists(select 1 from public.field_expenses e where e.sales_rep_id=v_actor and
      e.category='communication' and e.status<>'rejected' and
      e.period_start<=p_period_end and e.period_end>=p_period_start) then
      raise exception 'communication period already covered'; end if;
  end if;
  if p_category='transport' and (nullif(btrim(p_zone),'') is null or
    nullif(btrim(p_transport_mode),'') is null) then raise exception 'transport zone and mode required'; end if;
  if p_lead is not null and not exists(select 1 from public.leads where id=p_lead and assigned_to=v_actor)
    then raise exception 'prospect unavailable'; end if;
  insert into public.field_expenses(sales_rep_id,budget_id,advance_id,category,funding_source,
    amount_xof,incurred_at,period_start,period_end,description,prospecting_zone,
    transport_mode,beneficiary_phone,payment_reference,lead_id,submitted_by)
  values(v_actor,p_budget,p_advance,p_category,p_source,p_amount,p_incurred_at,
    p_period_start,p_period_end,btrim(p_description),nullif(btrim(p_zone),''),
    nullif(btrim(p_transport_mode),''),nullif(btrim(p_phone),''),nullif(btrim(p_reference),''),p_lead,v_actor)
  returning id into v_id;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('expense',v_id,'submitted',v_actor,pg_catalog.jsonb_build_object('amount_xof',p_amount,'source',p_source));
  return v_id;
end $$;
revoke all on function public.field_submit_expense(uuid,text,text,bigint,timestamptz,text,uuid,date,date,text,text,text,text,uuid) from public,anon;
grant execute on function public.field_submit_expense(uuid,text,text,bigint,timestamptz,text,uuid,date,date,text,text,text,text,uuid) to authenticated;

create or replace function public.field_review_expense(p_id uuid,p_action text,p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_expense public.field_expenses%rowtype;
  v_budget public.field_budgets%rowtype; v_policy public.field_policy_versions%rowtype;
  v_advance public.field_advances%rowtype; v_total bigint; v_returned bigint;
begin
  if not private.field_can_manage() then raise exception 'budget authority required'; end if;
  select budget_id into v_expense.budget_id from public.field_expenses where id=p_id;
  if v_expense.budget_id is null then raise exception 'expense unavailable'; end if;
  select * into v_budget from public.field_budgets where id=v_expense.budget_id for update;
  select * into v_expense from public.field_expenses where id=p_id for update;
  if v_expense.status not in ('submitted','needs_info') or v_expense.sales_rep_id=v_actor or
    p_action not in ('approve','reject','request_info') then raise exception 'review unavailable'; end if;
  if p_action<>'approve' and nullif(btrim(p_reason),'') is null then raise exception 'reason required'; end if;
  if p_action='approve' then
    select * into v_policy from public.field_policy_versions where id=v_budget.policy_id;
    if v_expense.category=any(v_policy.receipt_required_categories) and v_expense.proof_path is null
      then raise exception 'supporting document required'; end if;
    select coalesce(sum(amount_xof),0) into v_total from public.field_expenses
      where budget_id=v_budget.id and status in ('approved','regularized');
    if v_total+v_expense.amount_xof>v_budget.authorized_xof then raise exception 'budget exceeded'; end if;
    if v_policy.period_cap_xof is not null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        v_expense.sales_rep_id::text||pg_catalog.to_char(v_expense.incurred_at,'YYYY-MM'),61220604));
      select coalesce(sum(amount_xof),0) into v_total from public.field_expenses
        where sales_rep_id=v_expense.sales_rep_id and status in ('approved','regularized')
          and pg_catalog.date_trunc('month',incurred_at)=pg_catalog.date_trunc('month',v_expense.incurred_at);
      if v_total+v_expense.amount_xof>v_policy.period_cap_xof then
        raise exception 'monthly policy cap exceeded'; end if;
    end if;
    if v_expense.funding_source='advance' then
      select * into v_advance from public.field_advances where id=v_expense.advance_id for update;
      if v_advance.status<>'disbursed' then raise exception 'advance not open'; end if;
      select coalesce(sum(amount_xof),0) into v_total from public.field_expenses
        where advance_id=v_advance.id and status in ('approved','regularized');
      select coalesce(sum(amount_xof),0) into v_returned from public.field_restitutions
        where advance_id=v_advance.id and status='verified';
      if v_total+v_returned+v_expense.amount_xof>v_advance.disbursed_xof
        then raise exception 'advance balance exceeded'; end if;
    end if;
  end if;
  update public.field_expenses set status=case p_action when 'approve' then 'approved'
    when 'reject' then 'rejected' else 'needs_info' end,
    reimbursement_status=case when p_action='approve' and funding_source='personal' then 'due'
      else reimbursement_status end,
    approved_by=case when p_action='approve' then v_actor else approved_by end,
    approved_at=case when p_action='approve' then now() else approved_at end
    where id=p_id;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('expense',p_id,p_action,v_actor,pg_catalog.jsonb_build_object('reason',p_reason));
end $$;
revoke all on function public.field_review_expense(uuid,text,text) from public,anon;
grant execute on function public.field_review_expense(uuid,text,text) to authenticated;

create or replace function public.field_pay_reimbursement(p_id uuid,p_reference text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_expense public.field_expenses%rowtype;
begin
  if not private.field_can_manage() then raise exception 'budget authority required'; end if;
  select * into v_expense from public.field_expenses where id=p_id for update;
  if v_expense.id is null or v_expense.sales_rep_id=v_actor or v_expense.status<>'approved' or
    v_expense.funding_source<>'personal' or v_expense.reimbursement_status<>'due' or
    nullif(btrim(p_reference),'') is null then raise exception 'approved personal expense required'; end if;
  update public.field_expenses set reimbursement_status='paid',reimbursement_reference=btrim(p_reference),
    reimbursed_at=now() where id=p_id;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('expense',p_id,'reimbursed',v_actor,pg_catalog.jsonb_build_object('reference',p_reference));
end $$;
revoke all on function public.field_pay_reimbursement(uuid,text) from public,anon;
grant execute on function public.field_pay_reimbursement(uuid,text) to authenticated;

create or replace function public.field_declare_restitution(p_advance uuid,p_amount bigint,p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(false); v_advance public.field_advances%rowtype; v_id uuid;
begin
  select * into v_advance from public.field_advances where id=p_advance;
  if v_advance.id is null or v_advance.status<>'disbursed' or
    not (v_actor=v_advance.sales_rep_id or private.field_can_manage()) or
    p_amount is null or p_amount<=0 then raise exception 'open advance required'; end if;
  insert into public.field_restitutions(advance_id,amount_xof,declared_by,reason)
    values(p_advance,p_amount,v_actor,nullif(btrim(p_reason),'')) returning id into v_id;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('restitution',v_id,'declared',v_actor,pg_catalog.jsonb_build_object('amount_xof',p_amount));
  return v_id;
end $$;
revoke all on function public.field_declare_restitution(uuid,bigint,text) from public,anon;
grant execute on function public.field_declare_restitution(uuid,bigint,text) to authenticated;

create or replace function public.field_verify_restitution(p_id uuid,p_reference text,p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_advance public.field_advances%rowtype;
  v_return public.field_restitutions%rowtype; v_spent bigint; v_returned bigint;
begin
  if not private.field_can_manage() then raise exception 'budget authority required'; end if;
  select advance_id into v_return.advance_id from public.field_restitutions where id=p_id;
  if v_return.advance_id is null then raise exception 'restitution unavailable'; end if;
  select * into v_advance from public.field_advances where id=v_return.advance_id for update;
  select * into v_return from public.field_restitutions where id=p_id for update;
  if v_return.status<>'declared' or v_actor=v_advance.sales_rep_id then raise exception 'pending return required'; end if;
  if p_accept then
    if v_return.proof_path is null or nullif(btrim(p_reference),'') is null
      then raise exception 'verified receipt and proof required'; end if;
    select coalesce(sum(amount_xof),0) into v_spent from public.field_expenses
      where advance_id=v_advance.id and status in ('approved','regularized');
    select coalesce(sum(amount_xof),0) into v_returned from public.field_restitutions
      where advance_id=v_advance.id and status='verified';
    if v_returned+v_return.amount_xof>v_advance.disbursed_xof-v_spent
      then raise exception 'return exceeds unspent advance'; end if;
  end if;
  update public.field_restitutions set status=case when p_accept then 'verified' else 'rejected' end,
    verified_by=v_actor,verified_at=now(),received_reference=case when p_accept then btrim(p_reference) else null end
    where id=p_id;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('restitution',p_id,case when p_accept then 'verified' else 'rejected' end,v_actor,
      pg_catalog.jsonb_build_object('reference',p_reference));
end $$;
revoke all on function public.field_verify_restitution(uuid,text,boolean) from public,anon;
grant execute on function public.field_verify_restitution(uuid,text,boolean) to authenticated;

create or replace function public.field_close_advance(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_advance public.field_advances%rowtype;
  v_spent bigint; v_returned bigint; v_budget_id uuid;
begin
  if not private.field_can_manage() then raise exception 'budget authority required'; end if;
  select budget_id into v_budget_id from public.field_advances where id=p_id;
  if v_budget_id is null then raise exception 'advance not found'; end if;
  perform 1 from public.field_budgets where id=v_budget_id for update;
  select * into v_advance from public.field_advances where id=p_id for update;
  if v_advance.id is null or v_advance.status<>'disbursed' then raise exception 'open advance required'; end if;
  select coalesce(sum(amount_xof),0) into v_spent from public.field_expenses
    where advance_id=p_id and status in ('approved','regularized');
  select coalesce(sum(amount_xof),0) into v_returned from public.field_restitutions
    where advance_id=p_id and status='verified';
  if exists(select 1 from public.field_expenses where advance_id=p_id and status in ('submitted','needs_info')) or
    exists(select 1 from public.field_restitutions where advance_id=p_id and status='declared')
    then raise exception 'pending expense or return must be resolved'; end if;
  if v_spent+v_returned<>v_advance.disbursed_xof then raise exception 'advance requires full reconciliation'; end if;
  update public.field_advances set status='closed',closed_by=v_actor,closed_at=now() where id=p_id;
  update public.field_budgets set status='closed' where id=v_advance.budget_id;
  insert into public.field_finance_events(entity_kind,entity_id,event_type,actor_id,details)
    values('advance',p_id,'closed',v_actor,pg_catalog.jsonb_build_object('spent',v_spent,'returned',v_returned));
end $$;
revoke all on function public.field_close_advance(uuid) from public,anon;
grant execute on function public.field_close_advance(uuid) to authenticated;
