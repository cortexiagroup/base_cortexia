-- Financial writes are only exposed through audited, role-checked RPCs.
revoke all on function private.confirm_payment(uuid) from authenticated;

create or replace function private.finance_can_verify()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.current_app_role() = 'admin' or
    (private.current_app_role() = 'sales_manager' and exists (
      select 1 from public.finance_verifiers v where v.user_id = (select auth.uid()) and v.enabled
    ))
$$;
revoke all on function private.finance_can_verify() from public, anon, authenticated;

create or replace function public.finance_list_accounts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(false);
begin
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', a.id, 'method', a.method, 'provider_name', a.provider_name,
    'holder_name', a.holder_name, 'account_identifier', a.account_identifier,
    'client_instructions', a.client_instructions, 'cash_responsible_id', a.cash_responsible_id,
    'is_active', a.is_active,
    'internal_notes', case when private.current_app_role() = 'admin' then a.internal_notes else null end,
    'created_at', a.created_at, 'updated_at', a.updated_at)
    order by a.method, a.provider_name)
    from public.payment_accounts a
    where a.is_active or private.current_app_role() = 'admin'), '[]'::jsonb);
end $$;
revoke all on function public.finance_list_accounts() from public, anon;
grant execute on function public.finance_list_accounts() to authenticated;

create or replace function public.finance_save_account(p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_method public.payment_method;
  v_active boolean; v_provider text; v_holder text; v_identifier text;
  v_instructions text; v_responsible uuid;
begin
  if private.current_app_role() <> 'admin' then raise exception 'administrator required'; end if;
  if p_data is null or pg_catalog.jsonb_typeof(p_data) <> 'object' then raise exception 'invalid account'; end if;
  v_method := (p_data->>'method')::public.payment_method;
  v_active := coalesce((p_data->>'is_active')::boolean, false);
  v_provider := nullif(pg_catalog.btrim(p_data->>'provider_name'), '');
  v_holder := nullif(pg_catalog.btrim(p_data->>'holder_name'), '');
  v_identifier := nullif(pg_catalog.btrim(p_data->>'account_identifier'), '');
  v_instructions := nullif(pg_catalog.btrim(p_data->>'client_instructions'), '');
  v_responsible := nullif(p_data->>'cash_responsible_id', '')::uuid;
  if v_instructions is null then raise exception 'client instructions required'; end if;
  if v_method = 'cash' then
    v_identifier := null;
    if v_active and v_responsible is null then raise exception 'cash responsible required'; end if;
  elsif v_provider is null or v_holder is null or v_identifier is null then
    raise exception 'official payment details required';
  end if;
  if v_responsible is not null and not exists (select 1 from public.profiles where id = v_responsible and is_active)
    then raise exception 'active cash responsible required'; end if;
  if p_id is null then
    insert into public.payment_accounts(method, provider_name, holder_name, account_identifier,
      client_instructions, internal_notes, cash_responsible_id, is_active, created_by, updated_by)
    values(v_method, v_provider, v_holder, v_identifier, v_instructions,
      nullif(pg_catalog.btrim(p_data->>'internal_notes'), ''), v_responsible, v_active, v_actor, v_actor)
    returning id into p_id;
  else
    update public.payment_accounts set method = v_method, provider_name = v_provider,
      holder_name = v_holder, account_identifier = v_identifier, client_instructions = v_instructions,
      internal_notes = nullif(pg_catalog.btrim(p_data->>'internal_notes'), ''),
      cash_responsible_id = v_responsible, is_active = v_active, updated_by = v_actor
    where id = p_id;
    if not found then raise exception 'account not found'; end if;
  end if;
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values(v_actor, 'finance_account_saved', 'payment_accounts', p_id,
    pg_catalog.jsonb_build_object('method', v_method, 'active', v_active));
  return p_id;
end $$;
revoke all on function public.finance_save_account(uuid, jsonb) from public, anon;
grant execute on function public.finance_save_account(uuid, jsonb) to authenticated;

create or replace function public.finance_set_verifier(p_user_id uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true);
begin
  if private.current_app_role() <> 'admin' then raise exception 'administrator required'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id and role = 'sales_manager' and is_active)
    then raise exception 'active sales manager required'; end if;
  insert into public.finance_verifiers(user_id, enabled, granted_by)
  values(p_user_id, p_enabled, v_actor)
  on conflict(user_id) do update set enabled = excluded.enabled, granted_by = v_actor, granted_at = now();
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values(v_actor, 'finance_verifier_changed', 'finance_verifiers', p_user_id,
    pg_catalog.jsonb_build_object('enabled', p_enabled));
end $$;
revoke all on function public.finance_set_verifier(uuid, boolean) from public, anon;
grant execute on function public.finance_set_verifier(uuid, boolean) to authenticated;

create or replace function public.finance_set_receipt_prefix(p_prefix text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_prefix text := upper(pg_catalog.btrim(p_prefix));
begin
  if private.current_app_role() <> 'admin' then raise exception 'administrator required'; end if;
  if v_prefix !~ '^[A-Z0-9-]{3,20}$' then raise exception 'invalid receipt prefix'; end if;
  update public.finance_settings set receipt_prefix = v_prefix, updated_by = v_actor where id = true;
  insert into public.audit_logs(actor_id, action, entity_table, changes)
  values(v_actor, 'receipt_prefix_changed', 'finance_settings', pg_catalog.jsonb_build_object('prefix', v_prefix));
end $$;
revoke all on function public.finance_set_receipt_prefix(text) from public, anon;
grant execute on function public.finance_set_receipt_prefix(text) to authenticated;

create or replace function public.finance_declare_payment(
  p_order_id uuid, p_account_id uuid, p_amount_xof bigint, p_reference text,
  p_paid_at timestamptz, p_installment_id uuid default null, p_notes text default null,
  p_cash_received_by uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(false); v_order public.orders%rowtype;
  v_account public.payment_accounts%rowtype; v_id uuid; v_reference text;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null or v_order.order_status = 'cancelled' or
    not (private.current_app_role() in ('admin','sales_manager') or
      (v_order.sales_rep_id = v_actor and private.commercial_lead_access(v_order.lead_id))) then
    raise exception 'order unavailable'; end if;
  select * into v_account from public.payment_accounts where id = p_account_id and is_active;
  if v_account.id is null then raise exception 'active official payment account required'; end if;
  if p_amount_xof is null or p_amount_xof <= 0 or p_amount_xof > v_order.amount_xof then
    raise exception 'invalid declared amount'; end if;
  if p_paid_at is null or p_paid_at > now() + interval '1 day' then
    raise exception 'invalid declared payment date'; end if;
  if p_installment_id is not null and not exists (
    select 1 from public.order_installments where id = p_installment_id and order_id = p_order_id
  ) then raise exception 'installment does not belong to order'; end if;
  v_reference := nullif(pg_catalog.btrim(p_reference), '');
  if v_account.method <> 'cash' and v_reference is null then raise exception 'transaction reference required'; end if;
  if v_account.method = 'cash' and (
    p_cash_received_by is null or p_cash_received_by <> v_account.cash_responsible_id
  ) then raise exception 'authorized cash receiver required'; end if;
  if v_reference is not null and exists (select 1 from public.payments
    where payment_account_id = p_account_id and method = v_account.method
      and pg_catalog.lower(pg_catalog.btrim(transaction_reference)) = pg_catalog.lower(v_reference)
      and status in ('pending','confirmed')) then raise exception 'reference already declared'; end if;
  insert into public.payments(order_id, amount_xof, method, transaction_reference, paid_at,
    status, notes, created_by, payment_account_id, installment_id, declared_at, review_state,
    cash_received_by)
  values(p_order_id, p_amount_xof, v_account.method, v_reference, p_paid_at,
    'pending', nullif(pg_catalog.btrim(p_notes), ''), v_actor, p_account_id,
    p_installment_id, now(), 'declared', p_cash_received_by)
  returning id into v_id;
  insert into public.payment_events(payment_id, actor_id, event_type, details)
  values(v_id, v_actor, 'declared', pg_catalog.jsonb_build_object('amount_xof', p_amount_xof,
    'method', v_account.method, 'account_id', p_account_id));
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values(v_actor, 'payment_declared', 'payments', v_id,
    pg_catalog.jsonb_build_object('amount_xof', p_amount_xof, 'order_id', p_order_id));
  return v_id;
end $$;
revoke all on function public.finance_declare_payment(uuid, uuid, bigint, text, timestamptz, uuid, text, uuid) from public, anon;
grant execute on function public.finance_declare_payment(uuid, uuid, bigint, text, timestamptz, uuid, text, uuid) to authenticated;

create or replace function public.finance_attach_proof(p_payment_id uuid, p_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(false); v_payment public.payments%rowtype;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if v_payment.id is null or v_payment.status <> 'pending' or
    not (v_payment.created_by = v_actor or private.current_app_role() = 'admin') then
    raise exception 'pending declaration unavailable'; end if;
  if p_path not like 'payments/' || p_payment_id::text || '/%' or
    not exists (select 1 from storage.objects where bucket_id = 'cortexia-payment-proofs' and name = p_path)
    then raise exception 'private proof object required'; end if;
  update public.payments set proof_path = p_path where id = p_payment_id;
  insert into public.payment_events(payment_id, actor_id, event_type)
  values(p_payment_id, v_actor, 'proof_attached');
end $$;
revoke all on function public.finance_attach_proof(uuid, text) from public, anon;
grant execute on function public.finance_attach_proof(uuid, text) to authenticated;

create or replace function public.finance_review_payment(p_payment_id uuid, p_action text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_payment public.payments%rowtype;
begin
  if not private.finance_can_verify() then raise exception 'financial verifier required'; end if;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if v_payment.id is null or v_payment.status <> 'pending' then raise exception 'pending declaration required'; end if;
  if p_action not in ('request_info','reject','cancel') or nullif(pg_catalog.btrim(p_reason), '') is null
    then raise exception 'action and reason required'; end if;
  update public.payments set status = case when p_action = 'reject' then 'rejected'::public.payment_status
    when p_action = 'cancel' then 'cancelled'::public.payment_status else status end,
    review_state = case when p_action = 'request_info' then 'needs_info' else 'resolved' end,
    verification_note = pg_catalog.btrim(p_reason)
  where id = p_payment_id;
  insert into public.payment_events(payment_id, actor_id, event_type, details)
  values(p_payment_id, v_actor, p_action, pg_catalog.jsonb_build_object('reason', p_reason));
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values(v_actor, 'payment_' || p_action, 'payments', p_payment_id,
    pg_catalog.jsonb_build_object('reason', p_reason));
end $$;
revoke all on function public.finance_review_payment(uuid, text, text) from public, anon;
grant execute on function public.finance_review_payment(uuid, text, text) to authenticated;

create or replace function public.finance_confirm_payment(
  p_payment_id uuid, p_source text, p_verified_reference text,
  p_note text default null, p_cash_handed_over_at timestamptz default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_payment public.payments%rowtype;
  v_order public.orders%rowtype; v_account public.payment_accounts%rowtype;
  v_total bigint; v_job uuid; v_number text; v_prefix text; v_settings public.commercial_settings%rowtype;
begin
  if not private.finance_can_verify() then raise exception 'financial verifier required'; end if;
  -- All confirmations and adjustments lock the order first, then the payment.
  select order_id into v_payment.order_id from public.payments where id = p_payment_id;
  if v_payment.order_id is null then raise exception 'payment not found'; end if;
  select * into v_order from public.orders where id = v_payment.order_id for update;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if v_payment.status <> 'pending' or v_order.order_status = 'cancelled' then
    raise exception 'pending payment on active order required'; end if;
  select * into v_account from public.payment_accounts where id = v_payment.payment_account_id;
  if v_account.id is null or v_account.method <> v_payment.method then raise exception 'official account missing'; end if;
  if nullif(pg_catalog.btrim(p_verified_reference), '') is null then raise exception 'official reference required'; end if;
  if p_source is null or (v_payment.method = 'merchant_account' and p_source <> 'merchant_portal') or
     (v_payment.method = 'bank_transfer' and p_source <> 'bank_statement') or
     (v_payment.method = 'cash' and p_source <> 'cash_register') then
    raise exception 'verification source does not match payment method'; end if;
  if v_payment.method = 'cash' and (v_payment.cash_received_by is null or
      p_cash_handed_over_at is null or p_cash_handed_over_at > now()) then
    raise exception 'cash handover and register check required'; end if;
  if exists (select 1 from public.payments p where p.id <> p_payment_id and
    p.status = 'confirmed' and p.method = v_payment.method and
    p.payment_account_id = v_payment.payment_account_id and
    pg_catalog.lower(pg_catalog.btrim(p.verification_reference)) = pg_catalog.lower(pg_catalog.btrim(p_verified_reference)))
    then raise exception 'official reference already confirmed'; end if;
  select coalesce(pg_catalog.sum(amount_xof), 0)::bigint into v_total from public.financial_ledger
    where order_id = v_order.id;
  if v_total + v_payment.amount_xof > v_order.amount_xof then
    raise exception 'confirmed amount would exceed contract'; end if;
  update public.payments set status = 'confirmed', review_state = 'resolved',
    verified_by = v_actor, verified_at = now(), verification_source = p_source,
    verification_reference = pg_catalog.btrim(p_verified_reference),
    verification_note = nullif(pg_catalog.btrim(p_note), ''),
    cash_handed_over_at = p_cash_handed_over_at where id = p_payment_id
  returning * into v_payment;
  insert into public.financial_ledger(order_id, payment_id, entry_kind, amount_xof, recorded_by)
  values(v_order.id, p_payment_id, 'collection', v_payment.amount_xof, v_actor);
  select * into v_settings from public.commercial_settings where id = true;
  select receipt_prefix into v_prefix from public.finance_settings where id = true;
  v_number := v_prefix || '-' || pg_catalog.to_char(now(), 'YYYY') || '-' ||
    pg_catalog.lpad(pg_catalog.nextval('public.finance_receipt_number_seq'::regclass)::text, 6, '0');
  insert into public.finance_document_jobs(kind, payment_id, order_id, document_number, snapshot, created_by)
  values('receipt', p_payment_id, v_order.id, v_number,
    pg_catalog.jsonb_build_object('payment', pg_catalog.to_jsonb(v_payment),
      'order', pg_catalog.to_jsonb(v_order), 'company', pg_catalog.to_jsonb(v_settings),
      'account', pg_catalog.jsonb_build_object('method', v_account.method,
        'provider_name', v_account.provider_name, 'holder_name', v_account.holder_name),
      'collected_after_xof', v_total + v_payment.amount_xof,
      'balance_after_xof', v_order.amount_xof - v_total - v_payment.amount_xof),
    v_actor) returning id into v_job;
  insert into public.payment_events(payment_id, actor_id, event_type, details)
  values(p_payment_id, v_actor, 'confirmed', pg_catalog.jsonb_build_object(
    'source', p_source, 'reference', p_verified_reference, 'receipt_job_id', v_job));
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values(v_actor, 'payment_confirmed', 'payments', p_payment_id,
    pg_catalog.jsonb_build_object('amount_xof', v_payment.amount_xof, 'order_id', v_order.id));
  return v_job;
end $$;
revoke all on function public.finance_confirm_payment(uuid, text, text, text, timestamptz) from public, anon;
grant execute on function public.finance_confirm_payment(uuid, text, text, text, timestamptz) to authenticated;

create or replace function public.finance_request_instructions(p_order_id uuid, p_installment_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(false); v_order public.orders%rowtype;
  v_installment public.order_installments%rowtype; v_amount bigint;
  v_accounts jsonb; v_settings public.commercial_settings%rowtype; v_job uuid; v_number text;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null or v_order.order_status = 'cancelled' or
    not (private.current_app_role() in ('admin','sales_manager') or
      (v_order.sales_rep_id = v_actor and private.commercial_lead_access(v_order.lead_id))) then
    raise exception 'order unavailable'; end if;
  if p_installment_id is not null then
    select * into v_installment from public.order_installments where id = p_installment_id and order_id = p_order_id;
    if v_installment.id is null then raise exception 'installment unavailable'; end if;
    v_amount := v_installment.amount_xof;
  else
    v_amount := v_order.amount_xof;
  end if;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('method', a.method,
    'provider_name', a.provider_name, 'holder_name', a.holder_name,
    'account_identifier', a.account_identifier, 'client_instructions', a.client_instructions)
    order by a.method, a.provider_name) into v_accounts
  from public.payment_accounts a where a.is_active;
  if v_accounts is null then raise exception 'configure an official active account first'; end if;
  select * into v_settings from public.commercial_settings where id = true;
  v_number := 'CTX-PAY-' || pg_catalog.to_char(now(), 'YYYY') || '-' ||
    pg_catalog.lpad(pg_catalog.nextval('public.finance_instruction_number_seq'::regclass)::text, 6, '0');
  insert into public.finance_document_jobs(kind, order_id, installment_id, document_number,
    snapshot, created_by)
  values('instructions', p_order_id, p_installment_id, v_number,
    pg_catalog.jsonb_build_object('order', pg_catalog.to_jsonb(v_order),
      'installment', case when v_installment.id is null then null else pg_catalog.to_jsonb(v_installment) end,
      'amount_due_xof', v_amount, 'accounts', v_accounts, 'company', pg_catalog.to_jsonb(v_settings),
      'prepared_at', now()), v_actor)
  returning id into v_job;
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values(v_actor, 'payment_instructions_requested', 'finance_document_jobs', v_job,
    pg_catalog.jsonb_build_object('order_id', p_order_id, 'amount_due_xof', v_amount));
  return v_job;
end $$;
revoke all on function public.finance_request_instructions(uuid, uuid) from public, anon;
grant execute on function public.finance_request_instructions(uuid, uuid) to authenticated;

create or replace function public.finance_job_payload(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(false); v_job public.finance_document_jobs%rowtype;
  v_order public.orders%rowtype;
begin
  select * into v_job from public.finance_document_jobs where id = p_id;
  if v_job.id is null then raise exception 'document request unavailable'; end if;
  select * into v_order from public.orders where id = v_job.order_id;
  if not (private.current_app_role() in ('admin','sales_manager') or
    (v_order.sales_rep_id = v_actor and private.commercial_lead_access(v_order.lead_id))) then
    raise exception 'document request unavailable'; end if;
  return pg_catalog.jsonb_build_object('id', v_job.id, 'kind', v_job.kind,
    'status', v_job.status, 'document_number', v_job.document_number,
    'document_id', v_job.document_id, 'snapshot', v_job.snapshot,
    'created_at', v_job.created_at);
end $$;
revoke all on function public.finance_job_payload(uuid) from public, anon;
grant execute on function public.finance_job_payload(uuid) to authenticated;

create or replace function public.finance_claim_document_job(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job public.finance_document_jobs%rowtype;
begin
  select * into v_job from public.finance_document_jobs where id = p_id for update;
  if v_job.id is null then raise exception 'document request unavailable'; end if;
  if v_job.status = 'completed' then
    return pg_catalog.jsonb_build_object('status', 'completed', 'document_id', v_job.document_id);
  end if;
  if v_job.status = 'processing' and v_job.last_attempt_at > now() - interval '5 minutes' then
    raise exception 'document generation already in progress'; end if;
  update public.finance_document_jobs set status = 'processing', attempts = attempts + 1,
    last_error = null, last_attempt_at = now() where id = p_id;
  return pg_catalog.jsonb_build_object('status', 'processing', 'kind', v_job.kind,
    'document_number', v_job.document_number, 'snapshot', v_job.snapshot);
end $$;
revoke all on function public.finance_claim_document_job(uuid) from public, anon, authenticated;
grant execute on function public.finance_claim_document_job(uuid) to service_role;

create or replace function public.finance_fail_document_job(p_id uuid, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.finance_document_jobs set status = 'failed',
    last_error = pg_catalog.left(p_error, 500), last_attempt_at = now()
  where id = p_id and status <> 'completed';
end $$;
revoke all on function public.finance_fail_document_job(uuid, text) from public, anon, authenticated;
grant execute on function public.finance_fail_document_job(uuid, text) to service_role;

create or replace function public.finance_finalize_document_job(p_id uuid, p_path text, p_sha256 text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_job public.finance_document_jobs%rowtype; v_document uuid;
  v_type public.document_type;
begin
  select * into v_job from public.finance_document_jobs where id = p_id for update;
  if v_job.id is null then raise exception 'document request unavailable'; end if;
  if v_job.status = 'completed' then return v_job.document_id; end if;
  if v_job.status <> 'processing' then raise exception 'document request not claimed'; end if;
  if p_path <> 'finance/' || v_job.kind || '/' || p_id::text || '.pdf' or
    p_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'invalid immutable document path or hash'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'cortexia-documents'
    and name = p_path and metadata->>'mimetype' = 'application/pdf') then
    raise exception 'private PDF not uploaded'; end if;
  if v_job.kind = 'receipt' then
    if not exists (select 1 from public.payments where id = v_job.payment_id and status = 'confirmed')
      then raise exception 'confirmed payment required for receipt'; end if;
    v_type := 'receipt';
  else
    v_type := 'payment_instruction';
  end if;
  insert into public.documents(document_type, payment_id, order_id, storage_path,
    document_number, content_hash, created_by, metadata)
  values(v_type, v_job.payment_id, v_job.order_id, p_path, v_job.document_number,
    p_sha256, v_job.created_by, pg_catalog.jsonb_build_object('job_id', p_id,
      'snapshot', v_job.snapshot, 'kind', v_job.kind))
  returning id into v_document;
  update public.finance_document_jobs set status = 'completed', document_id = v_document,
    storage_path = p_path, content_hash = p_sha256, completed_at = now(), last_error = null
  where id = p_id;
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values(v_job.created_by, 'finance_document_issued', 'documents', v_document,
    pg_catalog.jsonb_build_object('job_id', p_id, 'kind', v_job.kind));
  return v_document;
end $$;
revoke all on function public.finance_finalize_document_job(uuid, text, text) from public, anon, authenticated;
grant execute on function public.finance_finalize_document_job(uuid, text, text) to service_role;

create or replace function public.finance_request_adjustment(
  p_payment_id uuid, p_kind text, p_amount_xof bigint, p_reason text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_payment public.payments%rowtype; v_id uuid;
begin
  if private.current_app_role() <> 'admin' then raise exception 'administrator required'; end if;
  select * into v_payment from public.payments where id = p_payment_id;
  if v_payment.id is null or v_payment.status <> 'confirmed' then raise exception 'confirmed payment required'; end if;
  if p_kind not in ('correction','refund') or p_amount_xof is null or
    p_amount_xof <= 0 or p_amount_xof > v_payment.amount_xof or
    nullif(pg_catalog.btrim(p_reason), '') is null then raise exception 'invalid adjustment'; end if;
  insert into public.financial_adjustments(payment_id, order_id, kind, amount_xof, reason, requested_by)
  values(p_payment_id, v_payment.order_id, p_kind, p_amount_xof, pg_catalog.btrim(p_reason), v_actor)
  returning id into v_id;
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values(v_actor, 'adjustment_requested', 'financial_adjustments', v_id,
    pg_catalog.jsonb_build_object('kind', p_kind, 'amount_xof', p_amount_xof));
  return v_id;
end $$;
revoke all on function public.finance_request_adjustment(uuid, text, bigint, text) from public, anon;
grant execute on function public.finance_request_adjustment(uuid, text, bigint, text) to authenticated;

create or replace function public.finance_approve_adjustment(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_adjustment public.financial_adjustments%rowtype;
begin
  if private.current_app_role() <> 'admin' then raise exception 'administrator required'; end if;
  select * into v_adjustment from public.financial_adjustments where id = p_id for update;
  if v_adjustment.id is null or v_adjustment.status <> 'requested' then raise exception 'requested adjustment required'; end if;
  update public.financial_adjustments set status = case when p_approve then 'approved' else 'rejected' end,
    approved_by = v_actor, approved_at = now() where id = p_id;
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values(v_actor, 'adjustment_reviewed', 'financial_adjustments', p_id,
    pg_catalog.jsonb_build_object('approved', p_approve));
end $$;
revoke all on function public.finance_approve_adjustment(uuid, boolean) from public, anon;
grant execute on function public.finance_approve_adjustment(uuid, boolean) to authenticated;

create or replace function public.finance_execute_adjustment(
  p_id uuid, p_source text, p_external_reference text
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_adjustment public.financial_adjustments%rowtype;
  v_order public.orders%rowtype; v_payment public.payments%rowtype; v_prior bigint; v_total bigint;
begin
  if private.current_app_role() <> 'admin' then raise exception 'administrator required'; end if;
  select order_id into v_adjustment.order_id from public.financial_adjustments where id = p_id;
  if v_adjustment.order_id is null then raise exception 'adjustment unavailable'; end if;
  select * into v_order from public.orders where id = v_adjustment.order_id for update;
  select * into v_adjustment from public.financial_adjustments where id = p_id for update;
  if v_adjustment.status <> 'approved' or nullif(pg_catalog.btrim(p_source), '') is null or
    nullif(pg_catalog.btrim(p_external_reference), '') is null then
    raise exception 'approved adjustment with external verification required'; end if;
  select * into v_payment from public.payments where id = v_adjustment.payment_id for update;
  select coalesce(pg_catalog.sum(amount_xof), 0)::bigint into v_prior from public.financial_ledger
    where adjustment_id in (select id from public.financial_adjustments where payment_id = v_payment.id);
  if v_payment.status <> 'confirmed' or v_payment.amount_xof + v_prior < v_adjustment.amount_xof then
    raise exception 'adjustment exceeds net payment'; end if;
  select coalesce(pg_catalog.sum(amount_xof), 0)::bigint into v_total from public.financial_ledger
    where order_id = v_order.id;
  if v_total < v_adjustment.amount_xof then raise exception 'adjustment exceeds collected balance'; end if;
  update public.financial_adjustments set status = 'executed',
    verification_source = pg_catalog.btrim(p_source),
    external_reference = pg_catalog.btrim(p_external_reference),
    executed_by = v_actor, executed_at = now() where id = p_id;
  insert into public.financial_ledger(order_id, adjustment_id, entry_kind, amount_xof, recorded_by)
  values(v_order.id, p_id, v_adjustment.kind, -v_adjustment.amount_xof, v_actor);
  insert into public.payment_events(payment_id, actor_id, event_type, details)
  values(v_payment.id, v_actor, v_adjustment.kind || '_executed',
    pg_catalog.jsonb_build_object('adjustment_id', p_id, 'amount_xof', v_adjustment.amount_xof));
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values(v_actor, 'adjustment_executed', 'financial_adjustments', p_id,
    pg_catalog.jsonb_build_object('source', p_source, 'reference', p_external_reference));
end $$;
revoke all on function public.finance_execute_adjustment(uuid, text, text) from public, anon;
grant execute on function public.finance_execute_adjustment(uuid, text, text) to authenticated;

create or replace function public.finance_guard_ledger()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'financial ledger entries are immutable';
end $$;
create trigger financial_ledger_no_update before update or delete on public.financial_ledger
for each row execute function public.finance_guard_ledger();
