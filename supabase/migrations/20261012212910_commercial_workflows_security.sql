-- All public RPCs below validate auth.uid() and an active profile.
create or replace function private.commercial_lead_access(p_lead_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select private.crm_active()) and (
    (select private.can_manage_all()) or exists (
      select 1 from public.leads l where l.id = p_lead_id and l.assigned_to = (select auth.uid())
    )
  )
$$;
revoke all on function private.commercial_lead_access(uuid) from public, anon, authenticated;

create or replace function public.commercial_save_offer(p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_offer public.offer_templates%rowtype;
  v_price bigint; v_benefits jsonb; v_included jsonb; v_exclusions jsonb;
begin
  if private.current_app_role() <> 'admin' then raise exception 'administrator required'; end if;
  if p_data is null or pg_catalog.jsonb_typeof(p_data) <> 'object' then raise exception 'invalid offer'; end if;
  v_price := nullif(p_data->>'price_xof', '')::bigint;
  if v_price is null or v_price < 0 then raise exception 'price must be a non-negative whole XOF amount'; end if;
  if nullif(pg_catalog.btrim(p_data->>'name'), '') is null then raise exception 'offer name required'; end if;
  v_benefits := coalesce(p_data->'benefits', '[]'::jsonb);
  v_included := coalesce(p_data->'included_services', '[]'::jsonb);
  v_exclusions := coalesce(p_data->'exclusions', '[]'::jsonb);
  if pg_catalog.jsonb_typeof(v_benefits) <> 'array' or pg_catalog.jsonb_typeof(v_included) <> 'array'
    or pg_catalog.jsonb_typeof(v_exclusions) <> 'array' then raise exception 'offer lists must be arrays'; end if;
  if p_id is null then
    insert into public.offer_templates(name, category, description, price_xof, price_is_starting,
      benefits, included_services, exclusions, delivery_days, payment_terms, validity_days,
      is_active, status, created_by, updated_by)
    values (pg_catalog.btrim(p_data->>'name'), nullif(pg_catalog.btrim(p_data->>'category'), ''),
      nullif(pg_catalog.btrim(p_data->>'description'), ''), v_price,
      coalesce((p_data->>'price_is_starting')::boolean, false), v_benefits, v_included, v_exclusions,
      nullif(p_data->>'delivery_days', '')::integer, nullif(pg_catalog.btrim(p_data->>'payment_terms'), ''),
      nullif(p_data->>'validity_days', '')::integer, false, 'draft', v_actor, v_actor)
    returning id into p_id;
  else
    select * into v_offer from public.offer_templates where id = p_id for update;
    if v_offer.id is null or v_offer.status <> 'draft' then raise exception 'only draft versions can be edited'; end if;
    update public.offer_templates set name = pg_catalog.btrim(p_data->>'name'),
      category = nullif(pg_catalog.btrim(p_data->>'category'), ''),
      description = nullif(pg_catalog.btrim(p_data->>'description'), ''),
      price_xof = v_price, price_is_starting = coalesce((p_data->>'price_is_starting')::boolean, false),
      benefits = v_benefits, included_services = v_included, exclusions = v_exclusions,
      delivery_days = nullif(p_data->>'delivery_days', '')::integer,
      payment_terms = nullif(pg_catalog.btrim(p_data->>'payment_terms'), ''),
      validity_days = nullif(p_data->>'validity_days', '')::integer, updated_by = v_actor
    where id = p_id;
  end if;
  insert into public.audit_logs(actor_id, action, entity_table, entity_id)
  values (v_actor, 'save_offer_draft', 'offer_templates', p_id);
  return p_id;
end $$;
revoke all on function public.commercial_save_offer(uuid, jsonb) from public, anon;
grant execute on function public.commercial_save_offer(uuid, jsonb) to authenticated;

create or replace function public.commercial_clone_offer(p_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_old public.offer_templates%rowtype; v_new uuid;
begin
  if private.current_app_role() <> 'admin' then raise exception 'administrator required'; end if;
  select * into v_old from public.offer_templates where id = p_id for update;
  if v_old.id is null or v_old.status = 'draft' then raise exception 'published version required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_old.family_id::text));
  insert into public.offer_templates(family_id, version, name, category, description,
    price_xof, currency, price_is_starting, benefits, included_services, exclusions,
    delivery_days, payment_terms, validity_days, is_active, status, created_by, updated_by)
  values (v_old.family_id,
    (select pg_catalog.max(version) + 1 from public.offer_templates where family_id = v_old.family_id),
    v_old.name, v_old.category, v_old.description, v_old.price_xof, v_old.currency,
    v_old.price_is_starting, v_old.benefits, v_old.included_services, v_old.exclusions,
    v_old.delivery_days, v_old.payment_terms, v_old.validity_days,
    false, 'draft', v_actor, v_actor)
  returning id into v_new;
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values(v_actor, 'clone_offer_version', 'offer_templates', v_new,
    pg_catalog.jsonb_build_object('from', p_id));
  return v_new;
end $$;
revoke all on function public.commercial_clone_offer(uuid) from public, anon;
grant execute on function public.commercial_clone_offer(uuid) to authenticated;

create or replace function public.commercial_set_offer_status(p_id uuid, p_status public.commercial_offer_status)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_old public.offer_templates%rowtype;
begin
  if private.current_app_role() <> 'admin' then raise exception 'administrator required'; end if;
  select * into v_old from public.offer_templates where id = p_id for update;
  if v_old.id is null then raise exception 'offer not found'; end if;
  if v_old.status = p_status then return; end if;
  if not ((v_old.status = 'draft' and p_status = 'active') or
      (v_old.status = 'active' and p_status in ('suspended','archived')) or
      (v_old.status = 'suspended' and p_status in ('active','archived'))) then
    raise exception 'invalid offer transition'; end if;
  if p_status = 'active' and exists (
    select 1 from public.offer_templates where family_id = v_old.family_id
      and status = 'active' and id <> p_id
  ) then raise exception 'suspend the previous active version first'; end if;
  update public.offer_templates set status = p_status, is_active = (p_status = 'active'),
    published_at = case when p_status = 'active' then coalesce(published_at, now()) else published_at end,
    updated_by = v_actor where id = p_id;
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values(v_actor, 'offer_status', 'offer_templates', p_id,
    pg_catalog.jsonb_build_object('from', v_old.status, 'to', p_status));
end $$;
revoke all on function public.commercial_set_offer_status(uuid, public.commercial_offer_status) from public, anon;
grant execute on function public.commercial_set_offer_status(uuid, public.commercial_offer_status) to authenticated;

create or replace function public.commercial_save_proposal(p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(false); v_lead public.leads%rowtype;
  v_company public.companies%rowtype; v_contact public.contacts%rowtype;
  v_offer public.offer_templates%rowtype; v_old public.commercial_proposals%rowtype;
  v_discount bigint; v_base bigint; v_terms text; v_expiry timestamptz;
  v_snapshot jsonb; v_client jsonb; v_description text; v_plan public.commercial_payment_plan;
begin
  if p_data is null or pg_catalog.jsonb_typeof(p_data) <> 'object' then raise exception 'invalid proposal'; end if;
  select * into v_lead from public.leads where id = nullif(p_data->>'lead_id', '')::uuid;
  if v_lead.id is null or not private.commercial_lead_access(v_lead.id) then raise exception 'lead unavailable'; end if;
  select * into v_company from public.companies where id = v_lead.company_id;
  if nullif(p_data->>'contact_id', '') is not null then
    select * into v_contact from public.contacts where id = (p_data->>'contact_id')::uuid
      and company_id = v_company.id;
    if v_contact.id is null then raise exception 'contact does not belong to this company'; end if;
  end if;
  select * into v_offer from public.offer_templates where id = nullif(p_data->>'offer_id', '')::uuid;
  if v_offer.id is null or v_offer.status <> 'active' then raise exception 'active offer required'; end if;
  v_discount := coalesce(nullif(p_data->>'discount_xof', '')::bigint, 0);
  v_base := coalesce(nullif(p_data->>'quoted_price_xof', '')::bigint, v_offer.price_xof);
  if v_base < v_offer.price_xof or (not v_offer.price_is_starting and v_base <> v_offer.price_xof) then
    raise exception 'quoted price must respect the published offer'; end if;
  if v_discount < 0 or v_discount > v_base then raise exception 'invalid discount'; end if;
  v_terms := nullif(pg_catalog.btrim(p_data->>'special_terms'), '');
  v_description := nullif(pg_catalog.btrim(p_data->>'service_description'), '');
  if v_description is null then raise exception 'service description required'; end if;
  v_expiry := nullif(p_data->>'expires_at', '')::timestamptz;
  if v_expiry is null or v_expiry <= now() or v_expiry > now() + interval '365 days' then
    raise exception 'valid expiry date within 365 days required'; end if;
  v_plan := (p_data->>'payment_plan')::public.commercial_payment_plan;
  if v_plan is null then raise exception 'payment plan required'; end if;
  v_snapshot := pg_catalog.jsonb_build_object('name', v_offer.name, 'category', v_offer.category,
    'description', v_offer.description, 'price_xof', v_offer.price_xof,
    'price_is_starting', v_offer.price_is_starting, 'currency', v_offer.currency,
    'benefits', v_offer.benefits, 'included_services', v_offer.included_services,
    'exclusions', v_offer.exclusions, 'delivery_days', v_offer.delivery_days,
    'payment_terms', v_offer.payment_terms, 'version', v_offer.version);
  v_client := pg_catalog.jsonb_build_object('company_name', v_company.legal_name,
    'address', v_company.address, 'city', v_company.city,
    'email', v_company.email, 'phone', v_company.phone,
    'contact_name', v_contact.full_name, 'contact_title', v_contact.job_title,
    'contact_email', v_contact.email, 'contact_phone', v_contact.phone);
  if p_id is null then
    insert into public.commercial_proposals(proposal_number, lead_id, company_id, contact_id,
      sales_rep_id, offer_template_id, offer_version, offer_snapshot, client_snapshot,
      service_description, base_price_xof, discount_xof, amount_xof, payment_plan,
      special_terms, delivery_days, expires_at, requires_approval, created_by)
    values ('PROP-' || pg_catalog.to_char(now(), 'YYYY') || '-' ||
      pg_catalog.lpad(pg_catalog.nextval('public.proposal_number_seq'::regclass)::text, 6, '0'),
      v_lead.id, v_company.id, v_contact.id, coalesce(v_lead.assigned_to, v_actor),
      v_offer.id, v_offer.version, v_snapshot, v_client, v_description, v_base,
      v_discount, v_base - v_discount, v_plan, v_terms, v_offer.delivery_days,
      v_expiry, v_discount > 0 or v_terms is not null, v_actor)
    returning id into p_id;
  else
    select * into v_old from public.commercial_proposals where id = p_id for update;
    if v_old.id is null or v_old.status <> 'draft' or
       not private.commercial_lead_access(v_old.lead_id) then
      raise exception 'only accessible draft proposals can be edited'; end if;
    if v_old.lead_id <> v_lead.id then raise exception 'proposal lead cannot change'; end if;
    update public.commercial_proposals set contact_id = v_contact.id,
      offer_template_id = v_offer.id, offer_version = v_offer.version,
      offer_snapshot = v_snapshot, client_snapshot = v_client,
      service_description = v_description, base_price_xof = v_base,
      discount_xof = v_discount, amount_xof = v_base - v_discount,
      payment_plan = v_plan, special_terms = v_terms, delivery_days = v_offer.delivery_days,
      expires_at = v_expiry, requires_approval = v_discount > 0 or v_terms is not null
    where id = p_id;
  end if;
  insert into public.commercial_proposal_events(proposal_id, actor_id, event_type)
  values(p_id, v_actor, 'saved_draft');
  return p_id;
end $$;
revoke all on function public.commercial_save_proposal(uuid, jsonb) from public, anon;
grant execute on function public.commercial_save_proposal(uuid, jsonb) to authenticated;

create or replace function public.commercial_submit_proposal(p_id uuid)
returns public.commercial_proposal_status language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(false); v_proposal public.commercial_proposals%rowtype;
  v_status public.commercial_proposal_status;
begin
  select * into v_proposal from public.commercial_proposals where id = p_id for update;
  if v_proposal.id is null or v_proposal.status <> 'draft' or
     not private.commercial_lead_access(v_proposal.lead_id) then raise exception 'draft unavailable'; end if;
  if v_proposal.expires_at <= now() then raise exception 'proposal already expired'; end if;
  v_status := case when v_proposal.requires_approval then 'pending_approval' else 'approved' end;
  update public.commercial_proposals set status = v_status,
    approved_by = case when v_status = 'approved' then v_actor else null end,
    approved_at = case when v_status = 'approved' then now() else null end
  where id = p_id;
  insert into public.commercial_proposal_events(proposal_id, actor_id, event_type)
  values(p_id, v_actor, case when v_status = 'approved' then 'standard_terms_approved' else 'approval_requested' end);
  return v_status;
end $$;
revoke all on function public.commercial_submit_proposal(uuid) from public, anon;
grant execute on function public.commercial_submit_proposal(uuid) to authenticated;

create or replace function public.commercial_approve_proposal(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_proposal public.commercial_proposals%rowtype;
begin
  select * into v_proposal from public.commercial_proposals where id = p_id for update;
  if v_proposal.id is null or v_proposal.status <> 'pending_approval' then
    raise exception 'pending proposal required'; end if;
  if v_proposal.expires_at <= now() then raise exception 'proposal expired'; end if;
  update public.commercial_proposals set status = 'approved', approved_by = v_actor,
    approved_at = now(), approval_reason = nullif(pg_catalog.btrim(p_reason), '') where id = p_id;
  insert into public.commercial_proposal_events(proposal_id, actor_id, event_type, details)
  values(p_id, v_actor, 'exception_approved', pg_catalog.jsonb_build_object('reason', p_reason));
end $$;
revoke all on function public.commercial_approve_proposal(uuid, text) from public, anon;
grant execute on function public.commercial_approve_proposal(uuid, text) to authenticated;

create or replace function public.commercial_issue_payload(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(false); v_proposal public.commercial_proposals%rowtype;
  v_settings public.commercial_settings%rowtype; v_existing public.documents%rowtype;
begin
  select * into v_proposal from public.commercial_proposals where id = p_id;
  if v_proposal.id is null or not private.commercial_lead_access(v_proposal.lead_id) then
    raise exception 'proposal unavailable'; end if;
  if v_proposal.status not in ('approved','sent','accepted') then raise exception 'proposal is not approved'; end if;
  if v_proposal.expires_at <= now() and v_proposal.status = 'approved' then
    raise exception 'proposal expired'; end if;
  select * into v_settings from public.commercial_settings where id = true;
  select * into v_existing from public.documents where proposal_id = p_id
    and document_version = 1 and document_type = 'offer_sheet';
  return pg_catalog.jsonb_build_object('proposal', pg_catalog.to_jsonb(v_proposal),
    'settings', pg_catalog.to_jsonb(v_settings),
    'existing_document', case when v_existing.id is null then null else pg_catalog.to_jsonb(v_existing) end);
end $$;
revoke all on function public.commercial_issue_payload(uuid) from public, anon;
grant execute on function public.commercial_issue_payload(uuid) to authenticated;

create or replace function public.commercial_finalize_document(
  p_proposal_id uuid, p_storage_path text, p_sha256 text, p_actor_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_proposal public.commercial_proposals%rowtype;
  v_existing uuid; v_document uuid; v_role public.app_role;
begin
  select role into v_role from public.profiles where id = p_actor_id and is_active;
  if v_role is null then raise exception 'active document author required'; end if;
  select * into v_proposal from public.commercial_proposals where id = p_proposal_id for update;
  if v_proposal.id is null or not (v_role in ('admin','sales_manager') or
    exists (select 1 from public.leads where id = v_proposal.lead_id and assigned_to = p_actor_id)) then
    raise exception 'proposal unavailable'; end if;
  if v_proposal.status not in ('approved','sent','accepted') then raise exception 'approval required'; end if;
  select id into v_existing from public.documents where proposal_id = p_proposal_id
    and document_version = 1 and document_type = 'offer_sheet';
  if v_existing is not null then return v_existing; end if;
  if p_storage_path <> 'proposals/' || p_proposal_id::text || '/v1.pdf' or
     p_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'invalid official document path or hash'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'cortexia-documents'
    and name = p_storage_path and metadata->>'mimetype' = 'application/pdf') then
    raise exception 'official PDF not uploaded'; end if;
  insert into public.documents(document_type, proposal_id, offer_template_id,
    storage_path, document_number, document_version, content_hash, created_by, metadata)
  values ('offer_sheet', p_proposal_id, v_proposal.offer_template_id,
    p_storage_path, v_proposal.proposal_number || '-V1', 1, p_sha256, p_actor_id,
    pg_catalog.jsonb_build_object('offer_version', v_proposal.offer_version,
      'amount_xof', v_proposal.amount_xof, 'issued_from_snapshot', true))
  returning id into v_document;
  insert into public.commercial_proposal_events(proposal_id, actor_id, event_type, details)
  values(p_proposal_id, p_actor_id, 'pdf_issued', pg_catalog.jsonb_build_object('document_id', v_document));
  return v_document;
end $$;
revoke all on function public.commercial_finalize_document(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.commercial_finalize_document(uuid, text, text, uuid) to service_role;

create or replace function public.commercial_send_proposal(p_id uuid, p_channel text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(false); v_proposal public.commercial_proposals%rowtype;
begin
  select * into v_proposal from public.commercial_proposals where id = p_id for update;
  if v_proposal.id is null or not private.commercial_lead_access(v_proposal.lead_id) then
    raise exception 'proposal unavailable'; end if;
  if v_proposal.status <> 'approved' or v_proposal.expires_at <= now() then
    raise exception 'approved, unexpired proposal required'; end if;
  if not exists (select 1 from public.documents where proposal_id = p_id
    and document_type = 'offer_sheet' and document_status = 'issued') then
    raise exception 'issue the PDF before recording dispatch'; end if;
  if p_channel not in ('email','whatsapp','in_person','other') then raise exception 'dispatch channel required'; end if;
  update public.commercial_proposals set status = 'sent', sent_at = now(),
    sent_by = v_actor, sent_channel = p_channel where id = p_id;
  insert into public.commercial_proposal_events(proposal_id, actor_id, event_type, details)
  values(p_id, v_actor, 'dispatch_recorded', pg_catalog.jsonb_build_object('channel', p_channel));
end $$;
revoke all on function public.commercial_send_proposal(uuid, text) from public, anon;
grant execute on function public.commercial_send_proposal(uuid, text) to authenticated;

create or replace function public.commercial_record_acceptance(
  p_id uuid, p_channel text, p_reference text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(false); v_proposal public.commercial_proposals%rowtype;
begin
  select * into v_proposal from public.commercial_proposals where id = p_id for update;
  if v_proposal.id is null or not private.commercial_lead_access(v_proposal.lead_id) then
    raise exception 'proposal unavailable'; end if;
  if v_proposal.status <> 'sent' or v_proposal.expires_at <= now() then
    raise exception 'sent, unexpired proposal required'; end if;
  if p_channel not in ('email','whatsapp','signed_document','in_person','other') then
    raise exception 'acceptance channel required'; end if;
  update public.commercial_proposals set status = 'accepted', accepted_at = now(),
    acceptance_recorded_by = v_actor, acceptance_channel = p_channel,
    acceptance_reference = nullif(pg_catalog.btrim(p_reference), ''),
    acceptance_verified = false where id = p_id;
  insert into public.commercial_proposal_events(proposal_id, actor_id, event_type, details)
  values(p_id, v_actor, 'acceptance_declared',
    pg_catalog.jsonb_build_object('channel', p_channel, 'reference', p_reference));
end $$;
revoke all on function public.commercial_record_acceptance(uuid, text, text) from public, anon;
grant execute on function public.commercial_record_acceptance(uuid, text, text) to authenticated;

create or replace function public.commercial_verify_acceptance(p_id uuid, p_reference text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_proposal public.commercial_proposals%rowtype;
begin
  select * into v_proposal from public.commercial_proposals where id = p_id for update;
  if v_proposal.id is null or v_proposal.status <> 'accepted' then raise exception 'declared acceptance required'; end if;
  if nullif(pg_catalog.btrim(p_reference), '') is null then raise exception 'verification reference required'; end if;
  if v_proposal.acceptance_verified then return; end if;
  update public.commercial_proposals set acceptance_verified = true,
    acceptance_verified_by = v_actor, acceptance_verified_at = now(),
    acceptance_reference = pg_catalog.btrim(p_reference) where id = p_id;
  insert into public.commercial_proposal_events(proposal_id, actor_id, event_type, details)
  values(p_id, v_actor, 'acceptance_verified', pg_catalog.jsonb_build_object('reference', p_reference));
end $$;
revoke all on function public.commercial_verify_acceptance(uuid, text) from public, anon;
grant execute on function public.commercial_verify_acceptance(uuid, text) to authenticated;

create or replace function public.commercial_close_proposal(
  p_id uuid, p_status public.commercial_proposal_status, p_reason text
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(false); v_proposal public.commercial_proposals%rowtype;
begin
  select * into v_proposal from public.commercial_proposals where id = p_id for update;
  if v_proposal.id is null or not private.commercial_lead_access(v_proposal.lead_id) then
    raise exception 'proposal unavailable'; end if;
  if p_status not in ('rejected','expired','cancelled') or
     v_proposal.status in ('accepted','rejected','expired','cancelled') then
    raise exception 'invalid closure'; end if;
  if p_status = 'expired' and v_proposal.expires_at > now() then
    raise exception 'proposal is not expired'; end if;
  if nullif(pg_catalog.btrim(p_reason), '') is null then raise exception 'closure reason required'; end if;
  update public.commercial_proposals set status = p_status where id = p_id;
  insert into public.commercial_proposal_events(proposal_id, actor_id, event_type, details)
  values(p_id, v_actor, 'closed', pg_catalog.jsonb_build_object('to', p_status, 'reason', p_reason));
end $$;
revoke all on function public.commercial_close_proposal(uuid, public.commercial_proposal_status, text) from public, anon;
grant execute on function public.commercial_close_proposal(uuid, public.commercial_proposal_status, text) to authenticated;

create or replace function public.commercial_create_order(p_proposal_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(false); v_proposal public.commercial_proposals%rowtype;
  v_order uuid; v_deposit bigint; v_snapshot jsonb;
begin
  select * into v_proposal from public.commercial_proposals where id = p_proposal_id for update;
  if v_proposal.id is null or not private.commercial_lead_access(v_proposal.lead_id) then
    raise exception 'proposal unavailable'; end if;
  if v_proposal.status <> 'accepted' or not v_proposal.acceptance_verified then
    raise exception 'verified acceptance required'; end if;
  if not exists (select 1 from public.documents where proposal_id = p_proposal_id
    and document_type = 'offer_sheet' and document_status = 'issued') then
    raise exception 'official proposal document required'; end if;
  select id into v_order from public.orders where proposal_id = p_proposal_id;
  if v_order is not null then return v_order; end if;
  v_snapshot := v_proposal.offer_snapshot || pg_catalog.jsonb_build_object(
    'proposal_number', v_proposal.proposal_number,
    'service_description', v_proposal.service_description,
    'client', v_proposal.client_snapshot,
    'base_price_xof', v_proposal.base_price_xof,
    'discount_xof', v_proposal.discount_xof,
    'amount_xof', v_proposal.amount_xof,
    'special_terms', v_proposal.special_terms,
    'delivery_days', v_proposal.delivery_days,
    'payment_plan', v_proposal.payment_plan,
    'acceptance_reference', v_proposal.acceptance_reference,
    'accepted_at', v_proposal.accepted_at,
    'acceptance_verified_by', v_proposal.acceptance_verified_by);
  insert into public.orders(order_number, company_id, lead_id, sales_rep_id,
    offer_template_id, offer_version, offer_snapshot, amount_xof, contractual_terms,
    order_status, created_by, proposal_id, payment_plan, payment_terms_snapshot)
  values ('CMD-' || pg_catalog.to_char(now(), 'YYYY') || '-' ||
      pg_catalog.lpad(pg_catalog.nextval('public.commercial_order_number_seq'::regclass)::text, 6, '0'),
    v_proposal.company_id, v_proposal.lead_id, v_proposal.sales_rep_id,
    v_proposal.offer_template_id, v_proposal.offer_version, v_snapshot,
    v_proposal.amount_xof, v_proposal.special_terms, 'draft', v_actor,
    v_proposal.id, v_proposal.payment_plan,
    pg_catalog.jsonb_build_object('plan', v_proposal.payment_plan,
      'offer_terms', v_proposal.offer_snapshot->>'payment_terms',
      'special_terms', v_proposal.special_terms))
  returning id into v_order;
  v_deposit := case when v_proposal.payment_plan = 'full_upfront' then v_proposal.amount_xof
    else v_proposal.amount_xof / 2 end;
  insert into public.order_installments(order_id, installment_number, trigger_event,
    percentage_bps, amount_xof, terms)
  values(v_order, 1, 'at_order',
    case when v_proposal.payment_plan = 'full_upfront' then 10000 else 5000 end,
    v_deposit, 'Exigible à la commande selon les conditions acceptées');
  if v_proposal.payment_plan = 'half_on_delivery' then
    insert into public.order_installments(order_id, installment_number, trigger_event,
      percentage_bps, amount_xof, terms)
    values(v_order, 2, 'at_delivery', 5000, v_proposal.amount_xof - v_deposit,
      'Exigible à l’étape contractuelle de livraison acceptée');
  end if;
  insert into public.commercial_order_events(order_id, actor_id, event_type, details)
  values(v_order, v_actor, 'created_from_verified_proposal',
    pg_catalog.jsonb_build_object('proposal_id', p_proposal_id,
      'amount_xof', v_proposal.amount_xof, 'plan', v_proposal.payment_plan));
  return v_order;
end $$;
revoke all on function public.commercial_create_order(uuid) from public, anon;
grant execute on function public.commercial_create_order(uuid) to authenticated;

create or replace function public.commercial_set_order_status(p_id uuid, p_status public.order_status)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_id for update;
  if v_order.id is null or v_order.proposal_id is null then raise exception 'commercial order unavailable'; end if;
  if v_order.order_status = p_status then return; end if;
  if not ((v_order.order_status = 'draft' and p_status in ('confirmed','cancelled')) or
    (v_order.order_status = 'confirmed' and p_status in ('in_progress','cancelled')) or
    (v_order.order_status = 'in_progress' and p_status in ('completed','cancelled'))) then
    raise exception 'invalid order transition'; end if;
  update public.orders set order_status = p_status,
    confirmed_at = case when p_status = 'confirmed' then now() else confirmed_at end
  where id = p_id;
  insert into public.commercial_order_events(order_id, actor_id, event_type, details)
  values(p_id, v_actor, 'status_changed',
    pg_catalog.jsonb_build_object('from', v_order.order_status, 'to', p_status));
end $$;
revoke all on function public.commercial_set_order_status(uuid, public.order_status) from public, anon;
grant execute on function public.commercial_set_order_status(uuid, public.order_status) to authenticated;

create or replace function public.commercial_guard_offer_terms()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status <> 'draft' and
     (old.family_id, old.version, old.name, old.category, old.description,
      old.price_xof, old.currency, old.price_is_starting, old.benefits,
      old.included_services, old.exclusions, old.delivery_days,
      old.payment_terms, old.validity_days, old.valid_from, old.valid_until)
     is distinct from
     (new.family_id, new.version, new.name, new.category, new.description,
      new.price_xof, new.currency, new.price_is_starting, new.benefits,
      new.included_services, new.exclusions, new.delivery_days,
      new.payment_terms, new.validity_days, new.valid_from, new.valid_until) then
    raise exception 'published offer terms are immutable; create a new version';
  end if;
  return new;
end $$;
create trigger offer_templates_guard_terms before update on public.offer_templates
for each row execute function public.commercial_guard_offer_terms();

-- A proposal/document/order snapshot is changed only by the vetted RPCs above.
revoke insert, update, delete on public.commercial_proposals,
  public.commercial_proposal_events, public.order_installments,
  public.commercial_order_events from authenticated;
