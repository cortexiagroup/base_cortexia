create or replace function private.crm_actor(p_manager_only boolean default false)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_role public.app_role;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select role into v_role from public.profiles where id = v_actor and is_active;
  if v_role is null then raise exception 'active profile required'; end if;
  if p_manager_only and v_role not in ('admin', 'sales_manager') then
    raise exception 'manager permission required';
  end if;
  return v_actor;
end $$;
revoke all on function private.crm_actor(boolean) from public, anon, authenticated;

create or replace function public.crm_save_lead(p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.crm_actor(false);
  v_role public.app_role := private.current_app_role();
  v_lead public.leads%rowtype;
  v_company uuid;
  v_contact uuid;
  v_name text := nullif(pg_catalog.btrim(p_data->>'company_name'), '');
  v_phone text := public.normalize_togo_phone(p_data->>'phone');
  v_assignee uuid;
begin
  if p_data is null or pg_catalog.jsonb_typeof(p_data) <> 'object' then raise exception 'invalid lead data'; end if;
  if p_id is null then
    if v_name is null then raise exception 'company name required'; end if;
    v_assignee := coalesce(nullif(p_data->>'assigned_to', '')::uuid, v_actor);
    if v_assignee <> v_actor and v_role not in ('admin', 'sales_manager') then
      raise exception 'assignment permission required';
    end if;
    if not exists (select 1 from public.profiles where id = v_assignee and is_active and role = 'sales_rep')
      and v_assignee <> v_actor then raise exception 'active sales rep required'; end if;
    if v_phone is not null and nullif(p_data->>'company_id', '') is null and
      exists (select 1 from public.companies where normalized_phone = v_phone) then
      raise exception 'an enterprise with this phone already exists; review the match';
    end if;
    if nullif(p_data->>'company_id', '') is not null then
      v_company := (p_data->>'company_id')::uuid;
      if v_role not in ('admin', 'sales_manager') or not exists (select 1 from public.companies where id = v_company) then
        raise exception 'existing company unavailable';
      end if;
    else
      insert into public.companies
        (legal_name, industry, city, neighborhood, address, email, phone, website, has_website, created_by)
      values (v_name, nullif(pg_catalog.btrim(p_data->>'industry'), ''),
        nullif(pg_catalog.btrim(p_data->>'city'), ''),
        nullif(pg_catalog.btrim(p_data->>'neighborhood'), ''),
        nullif(pg_catalog.btrim(p_data->>'address'), ''),
        nullif(pg_catalog.lower(pg_catalog.btrim(p_data->>'company_email')), ''),
        nullif(pg_catalog.btrim(p_data->>'phone'), ''),
        case when p_data->>'has_website' = 'false' then null else nullif(pg_catalog.btrim(p_data->>'website'), '') end,
        case when p_data ? 'has_website' then (p_data->>'has_website')::boolean
             when nullif(pg_catalog.btrim(p_data->>'website'), '') is not null then true else null end,
        v_actor)
      returning id into v_company;
    end if;
    insert into public.leads
      (company_id, assigned_to, created_by, source, identified_need, interested_offer,
       priority, notes, next_follow_up_at)
    values (v_company, v_assignee, v_actor,
      nullif(pg_catalog.btrim(p_data->>'source'), ''),
      nullif(pg_catalog.btrim(p_data->>'identified_need'), ''),
      nullif(pg_catalog.btrim(p_data->>'interested_offer'), ''),
      coalesce(nullif(p_data->>'priority', ''), 'normal'),
      nullif(pg_catalog.btrim(p_data->>'notes'), ''),
      nullif(p_data->>'next_follow_up_at', '')::timestamptz)
    returning * into v_lead;
  else
    select * into v_lead from public.leads where id = p_id for update;
    if v_lead.id is null then raise exception 'lead not found'; end if;
    if v_role not in ('admin', 'sales_manager') and v_lead.assigned_to <> v_actor then
      raise exception 'lead is outside your scope';
    end if;
    v_company := v_lead.company_id;
    update public.companies set
      legal_name = coalesce(v_name, legal_name),
      industry = coalesce(nullif(pg_catalog.btrim(p_data->>'industry'), ''), industry),
      city = coalesce(nullif(pg_catalog.btrim(p_data->>'city'), ''), city),
      neighborhood = coalesce(nullif(pg_catalog.btrim(p_data->>'neighborhood'), ''), neighborhood),
      address = coalesce(nullif(pg_catalog.btrim(p_data->>'address'), ''), address),
      email = coalesce(nullif(pg_catalog.lower(pg_catalog.btrim(p_data->>'company_email')), ''), email),
      phone = coalesce(nullif(pg_catalog.btrim(p_data->>'phone'), ''), phone),
      website = case when p_data->>'has_website' = 'false' then null
                     else coalesce(nullif(pg_catalog.btrim(p_data->>'website'), ''), website) end,
      has_website = coalesce(case when p_data ? 'has_website' then (p_data->>'has_website')::boolean
                             when nullif(pg_catalog.btrim(p_data->>'website'), '') is not null then true else null end, has_website)
    where id = v_company;
    update public.leads set
      source = coalesce(nullif(pg_catalog.btrim(p_data->>'source'), ''), source),
      identified_need = coalesce(nullif(pg_catalog.btrim(p_data->>'identified_need'), ''), identified_need),
      interested_offer = coalesce(nullif(pg_catalog.btrim(p_data->>'interested_offer'), ''), interested_offer),
      priority = coalesce(nullif(p_data->>'priority', ''), priority),
      notes = coalesce(nullif(pg_catalog.btrim(p_data->>'notes'), ''), notes),
      next_follow_up_at = coalesce(nullif(p_data->>'next_follow_up_at', '')::timestamptz, next_follow_up_at)
    where id = p_id;
  end if;

  if nullif(pg_catalog.btrim(p_data->>'contact_name'), '') is not null then
    v_contact := nullif(p_data->>'contact_id', '')::uuid;
    if v_contact is not null then
      if not exists (select 1 from public.contacts where id = v_contact and company_id = v_company) then
        raise exception 'contact does not belong to this company';
      end if;
      update public.contacts set
        full_name = coalesce(nullif(pg_catalog.btrim(p_data->>'contact_name'), ''), full_name),
        job_title = coalesce(nullif(pg_catalog.btrim(p_data->>'contact_title'), ''), job_title),
        phone = coalesce(nullif(pg_catalog.btrim(p_data->>'contact_phone'), ''), phone),
        whatsapp = coalesce(nullif(pg_catalog.btrim(p_data->>'whatsapp'), ''), whatsapp),
        email = coalesce(nullif(pg_catalog.lower(pg_catalog.btrim(p_data->>'email')), ''), email)
      where id = v_contact;
    else
      select id into v_contact from public.contacts
      where company_id = v_company and pg_catalog.lower(full_name) = pg_catalog.lower(pg_catalog.btrim(p_data->>'contact_name'))
        and (nullif(p_data->>'email', '') is null or pg_catalog.lower(email) = pg_catalog.lower(p_data->>'email'))
      limit 1;
      if v_contact is null then
        insert into public.contacts
          (company_id, full_name, job_title, phone, whatsapp, email, is_primary)
        values (v_company, pg_catalog.btrim(p_data->>'contact_name'),
          nullif(pg_catalog.btrim(p_data->>'contact_title'), ''),
          nullif(pg_catalog.btrim(p_data->>'contact_phone'), ''),
          nullif(pg_catalog.btrim(p_data->>'whatsapp'), ''),
          nullif(pg_catalog.lower(pg_catalog.btrim(p_data->>'email')), ''),
          not exists (select 1 from public.contacts where company_id = v_company));
      end if;
    end if;
  end if;
  return v_lead.id;
end $$;
revoke all on function public.crm_save_lead(uuid, jsonb) from public, anon;
grant execute on function public.crm_save_lead(uuid, jsonb) to authenticated;

create or replace function public.crm_assign_leads(p_lead_ids uuid[], p_assignee uuid, p_reason text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true); v_lead public.leads%rowtype; v_count integer := 0;
begin
  if p_lead_ids is null or pg_catalog.array_length(p_lead_ids, 1) is null
    or pg_catalog.array_length(p_lead_ids, 1) > 100 then raise exception 'select 1 to 100 leads'; end if;
  if p_assignee is not null and not exists (
    select 1 from public.profiles where id = p_assignee and is_active and role = 'sales_rep'
  ) then raise exception 'active sales rep required'; end if;
  for v_lead in select * from public.leads where id = any(p_lead_ids) order by id for update loop
    if v_lead.assigned_to is distinct from p_assignee then
      update public.leads set assigned_to = p_assignee where id = v_lead.id;
      insert into public.lead_assignments (lead_id, old_assignee_id, new_assignee_id, actor_id, reason)
      values (v_lead.id, v_lead.assigned_to, p_assignee, v_actor, nullif(pg_catalog.btrim(p_reason), ''));
      v_count := v_count + 1;
    end if;
  end loop;
  if (select pg_catalog.count(distinct x) from pg_catalog.unnest(p_lead_ids) as x) <>
     (select pg_catalog.count(*) from public.leads where id = any(p_lead_ids)) then
    raise exception 'one or more leads were not found';
  end if;
  return v_count;
end $$;
revoke all on function public.crm_assign_leads(uuid[], uuid, text) from public, anon;
grant execute on function public.crm_assign_leads(uuid[], uuid, text) to authenticated;

create or replace function public.crm_set_lead_status(p_lead_id uuid, p_status public.lead_status, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(false); v_role public.app_role := private.current_app_role();
  v_lead public.leads%rowtype;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if v_lead.id is null then raise exception 'lead not found'; end if;
  if v_role not in ('admin', 'sales_manager') and v_lead.assigned_to <> v_actor then
    raise exception 'lead is outside your scope';
  end if;
  if v_lead.status = p_status then return; end if;
  if p_status = 'archived' or (v_lead.status in ('won','lost','unqualified','archived') and v_role not in ('admin','sales_manager')) then
    raise exception 'this transition requires management review';
  end if;
  if not (
    (v_lead.status in ('new','qualified') and p_status in ('contacted','meeting','unqualified','lost')) or
    (v_lead.status = 'contacted' and p_status in ('meeting','demo','proposal','unqualified','lost')) or
    (v_lead.status = 'meeting' and p_status in ('contacted','demo','proposal','lost')) or
    (v_lead.status = 'demo' and p_status in ('proposal','negotiation','lost')) or
    (v_lead.status = 'proposal' and p_status in ('negotiation','won','lost')) or
    (v_lead.status = 'negotiation' and p_status in ('proposal','won','lost')) or
    (v_role in ('admin','sales_manager') and v_lead.status in ('won','lost','unqualified','archived') and p_status = 'contacted')
  ) then raise exception 'invalid pipeline transition'; end if;
  update public.leads set status = p_status,
    converted_at = case when p_status = 'won' then now() else converted_at end
  where id = p_lead_id;
  insert into public.activities (lead_id, author_id, activity_type, occurred_at, subject, body, metadata)
  values (p_lead_id, v_actor, 'status_change', now(), 'Changement de statut',
    nullif(pg_catalog.btrim(p_reason), ''),
    pg_catalog.jsonb_build_object('from', v_lead.status, 'to', p_status));
end $$;
revoke all on function public.crm_set_lead_status(uuid, public.lead_status, text) from public, anon;
grant execute on function public.crm_set_lead_status(uuid, public.lead_status, text) to authenticated;

create or replace function public.crm_set_sales_active(p_user_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true);
begin
  if private.current_app_role() <> 'admin' then raise exception 'admin permission required'; end if;
  if p_user_id = v_actor and not p_active then raise exception 'cannot deactivate yourself'; end if;
  update public.profiles set is_active = p_active where id = p_user_id and role = 'sales_rep';
  if not found then raise exception 'sales rep not found'; end if;
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values (v_actor, 'set_active', 'profiles', p_user_id,
    pg_catalog.jsonb_build_object('is_active', p_active));
end $$;
revoke all on function public.crm_set_sales_active(uuid, boolean) from public, anon;
grant execute on function public.crm_set_sales_active(uuid, boolean) to authenticated;

create or replace function public.crm_domain(p_website text)
returns text language sql immutable set search_path = '' as $$
  select nullif(pg_catalog.lower(pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(pg_catalog.btrim(p_website), '^https?://(www[.])?', '', 'i'),
    '/.*$', '')), '')
$$;
revoke all on function public.crm_domain(text) from public, anon;
grant execute on function public.crm_domain(text) to authenticated;

create or replace function public.crm_prepare_import(
  p_file_name text, p_file_hash text, p_file_size_bytes bigint,
  p_file_format text, p_storage_path text, p_mapping jsonb, p_rows jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.crm_actor(true);
  v_batch uuid;
  v_item jsonb;
  v_data jsonb;
  v_name text;
  v_phone text;
  v_domain text;
  v_email text;
  v_candidates uuid[];
  v_action public.import_row_action;
  v_index integer := 0;
  v_duplicate boolean;
  v_hard_match boolean;
begin
  if p_file_name is null or p_file_hash is null or p_file_size_bytes is null or
     p_file_format is null or p_storage_path is null or p_mapping is null or p_rows is null or
     p_file_size_bytes < 1 or p_file_size_bytes > 10485760 or
     pg_catalog.lower(p_file_format) not in ('xlsx', 'csv') or
     pg_catalog.lower(p_file_name) not like '%.' || pg_catalog.lower(p_file_format) or
     p_file_hash !~ '^[a-fA-F0-9]{64}$' or
     pg_catalog.jsonb_typeof(p_rows) <> 'array' or
     pg_catalog.jsonb_array_length(p_rows) < 1 or
     pg_catalog.jsonb_array_length(p_rows) > 500 or
     pg_catalog.jsonb_typeof(p_mapping) <> 'object' then
    raise exception 'invalid import file, mapping or row count';
  end if;
  if not exists (select 1 from storage.objects
    where bucket_id = 'cortexia-imports' and name = p_storage_path
      and owner_id = v_actor::text) then
    raise exception 'private import file not found';
  end if;
  select id into v_batch from public.import_batches
    where uploaded_by = v_actor and file_hash = pg_catalog.lower(p_file_hash);
  if v_batch is not null then return v_batch; end if;

  insert into public.import_batches
    (uploaded_by, file_name, file_hash, file_size_bytes, file_format,
     storage_path, column_mapping, status, simulated_at, analyzed_rows)
  values (v_actor, pg_catalog.left(p_file_name, 255), pg_catalog.lower(p_file_hash),
    p_file_size_bytes, pg_catalog.lower(p_file_format), p_storage_path,
    p_mapping, 'simulated', now(), pg_catalog.jsonb_array_length(p_rows))
  returning id into v_batch;

  for v_item in select value from pg_catalog.jsonb_array_elements(p_rows) loop
    v_index := v_index + 1;
    if pg_catalog.jsonb_typeof(v_item) <> 'object' then raise exception 'invalid row data'; end if;
    v_name := nullif(pg_catalog.btrim(v_item->>'company_name'), '');
    v_phone := public.normalize_togo_phone(v_item->>'phone');
    v_domain := public.crm_domain(v_item->>'website');
    v_email := nullif(pg_catalog.lower(pg_catalog.btrim(v_item->>'email')), '');
    v_duplicate := exists (
      select 1 from public.import_rows r where r.batch_id = v_batch and (
        (v_phone is not null and r.normalized_data->>'normalized_phone' = v_phone) or
        (v_domain is not null and r.normalized_data->>'normalized_domain' = v_domain) or
        (v_email is not null and r.normalized_data->>'normalized_email' = v_email and
          pg_catalog.lower(r.normalized_data->>'company_name') = pg_catalog.lower(v_name))
      )
    );
    select pg_catalog.array_agg(distinct l.id) into v_candidates
    from public.leads l join public.companies c on c.id = l.company_id
    where (v_phone is not null and c.normalized_phone = v_phone)
       or (v_domain is not null and public.crm_domain(c.website) = v_domain)
       or (v_email is not null and pg_catalog.lower(c.legal_name) = pg_catalog.lower(v_name)
           and (pg_catalog.lower(c.email) = v_email or exists (
             select 1 from public.contacts ct where ct.company_id = c.id and pg_catalog.lower(ct.email) = v_email
           )));
    v_hard_match := coalesce(pg_catalog.array_length(v_candidates, 1), 0) > 0;
    if not v_hard_match and v_name is not null then
      select pg_catalog.array_agg(l.id) into v_candidates
      from public.leads l join public.companies c on c.id = l.company_id
      where pg_catalog.lower(pg_catalog.btrim(c.legal_name)) = pg_catalog.lower(v_name);
    end if;
    v_action := case
      when v_name is null then 'reject'
      when v_duplicate then 'duplicate'
      when not v_hard_match and coalesce(pg_catalog.array_length(v_candidates, 1), 0) > 0 then 'conflict'
      when coalesce(pg_catalog.array_length(v_candidates, 1), 0) > 1 then 'conflict'
      when v_hard_match then 'update'
      else 'create' end;
    v_data := v_item || pg_catalog.jsonb_build_object(
      'company_name', v_name, 'normalized_phone', v_phone,
      'normalized_domain', v_domain, 'normalized_email', v_email,
      'candidate_ids', coalesce(pg_catalog.to_jsonb(v_candidates), '[]'::jsonb),
      'hard_match', v_hard_match);
    insert into public.import_rows
      (batch_id, row_number, raw_data, normalized_data, action, matched_lead_id, error_message)
    values (v_batch, v_index, v_item, v_data, v_action,
      case when pg_catalog.array_length(v_candidates, 1) = 1 then v_candidates[1] else null end,
      case when v_action = 'reject' then 'Nom de l’entreprise manquant' else null end);
  end loop;
  update public.import_batches b set
    duplicate_rows = (select pg_catalog.count(*) from public.import_rows where batch_id = v_batch and action = 'duplicate'),
    rejected_rows = (select pg_catalog.count(*) from public.import_rows where batch_id = v_batch and action = 'reject'),
    conflict_rows = (select pg_catalog.count(*) from public.import_rows where batch_id = v_batch and action = 'conflict')
  where b.id = v_batch;
  return v_batch;
end $$;
revoke all on function public.crm_prepare_import(text, text, bigint, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.crm_prepare_import(text, text, bigint, text, text, jsonb, jsonb) to authenticated;

create or replace function public.crm_commit_import(p_batch_id uuid, p_decisions jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.crm_actor(true);
  v_batch public.import_batches%rowtype;
  v_row public.import_rows%rowtype;
  v_choice jsonb;
  v_action text;
  v_target uuid;
  v_created integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_lead uuid;
begin
  if p_decisions is null or pg_catalog.jsonb_typeof(p_decisions) <> 'object' then
    raise exception 'decisions must be an object';
  end if;
  select * into v_batch from public.import_batches
  where id = p_batch_id and uploaded_by = v_actor for update;
  if v_batch.id is null then raise exception 'import not found'; end if;
  if v_batch.status = 'committed' then
    return pg_catalog.jsonb_build_object('created', v_batch.created_rows,
      'updated', v_batch.updated_rows, 'skipped', v_batch.analyzed_rows - v_batch.created_rows - v_batch.updated_rows);
  end if;
  if v_batch.status <> 'simulated' then raise exception 'import is not ready'; end if;
  for v_row in select * from public.import_rows where batch_id = p_batch_id order by row_number for update loop
    v_choice := p_decisions -> v_row.row_number::text;
    v_action := coalesce(v_choice->>'action', 'skip');
    if v_action not in ('create', 'update', 'skip') then raise exception 'invalid import decision'; end if;
    if v_row.action = 'reject' or v_row.action = 'duplicate' then v_action := 'skip'; end if;
    if v_action = 'update' then
      v_target := coalesce(nullif(v_choice->>'lead_id', '')::uuid, v_row.matched_lead_id);
      if v_target is null or not (v_row.normalized_data->'candidate_ids' ? v_target::text) then
        raise exception 'update target is not a reviewed candidate';
      end if;
      v_lead := public.crm_save_lead(v_target, v_row.normalized_data);
      v_updated := v_updated + 1;
    elsif v_action = 'create' then
      if v_row.normalized_data->>'hard_match' = 'true' then
        raise exception 'cannot create a duplicate with a reliable match';
      end if;
      v_lead := public.crm_save_lead(null, v_row.normalized_data - 'assigned_to' - 'company_id');
      update public.leads set source_import_row_id = v_row.id where id = v_lead;
      perform public.crm_assign_leads(array[v_lead], null, 'Import Excel');
      v_created := v_created + 1;
    else
      v_skipped := v_skipped + 1;
      v_lead := null;
    end if;
    update public.import_rows set decision_action = v_action,
      matched_lead_id = coalesce(v_lead, matched_lead_id),
      reviewed_by = v_actor, reviewed_at = now()
    where id = v_row.id;
  end loop;
  update public.import_batches set status = 'committed', committed_at = now(),
    created_rows = v_created, updated_rows = v_updated,
    duplicate_rows = v_batch.duplicate_rows,
    rejected_rows = v_batch.rejected_rows
  where id = p_batch_id;
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values (v_actor, 'commit_import', 'import_batches', p_batch_id,
    pg_catalog.jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped));
  return pg_catalog.jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped);
end $$;
revoke all on function public.crm_commit_import(uuid, jsonb) from public, anon;
grant execute on function public.crm_commit_import(uuid, jsonb) to authenticated;

create or replace function public.crm_search_leads(
  p_search text default null, p_status public.lead_status default null,
  p_assignee uuid default null, p_priority text default null,
  p_unassigned boolean default false, p_sort text default 'recent',
  p_page integer default 1, p_page_size integer default 20
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.crm_actor(false);
  v_manager boolean := private.current_app_role() in ('admin', 'sales_manager');
  v_result jsonb;
begin
  if p_page < 1 or p_page_size < 1 or p_page_size > 100 or p_sort not in ('recent','oldest','name','follow_up') then
    raise exception 'invalid pagination or sorting';
  end if;
  with scoped as materialized (
    select l.id, l.company_id, l.assigned_to, l.created_by, l.source,
      l.identified_need, l.interested_offer, l.status, l.priority, l.notes,
      l.next_follow_up_at, l.created_at, l.updated_at, l.converted_at,
      c.legal_name as company_name, c.industry, c.city, c.neighborhood,
      c.address, c.phone, c.normalized_phone, c.website, c.has_website, c.email as company_email,
      (select max(a.occurred_at) from public.activities a where a.lead_id = l.id) as last_activity_at,
      p.full_name as assigned_name,
      (select pg_catalog.to_jsonb(ct) from public.contacts ct
        where ct.company_id = c.id order by ct.is_primary desc, ct.created_at limit 1) as contact
    from public.leads l
    join public.companies c on c.id = l.company_id
    left join public.profiles p on p.id = l.assigned_to
    where (v_manager or l.assigned_to = v_actor)
      and (p_status is null or l.status = p_status)
      and (p_assignee is null or l.assigned_to = p_assignee)
      and (p_priority is null or l.priority = p_priority)
      and (not p_unassigned or l.assigned_to is null)
      and (nullif(pg_catalog.btrim(p_search), '') is null or
        c.legal_name ilike '%' || pg_catalog.btrim(p_search) || '%' or
        c.normalized_phone ilike '%' || pg_catalog.btrim(p_search) || '%' or
        exists (select 1 from public.contacts ct where ct.company_id = c.id and
          (ct.full_name ilike '%' || pg_catalog.btrim(p_search) || '%' or
           ct.email ilike '%' || pg_catalog.btrim(p_search) || '%')))
  )
  select pg_catalog.jsonb_build_object(
    'total', (select pg_catalog.count(*) from scoped),
    'rows', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(page_rows)) from (
      select * from scoped
      order by
        case when p_sort = 'name' then pg_catalog.lower(company_name) end asc nulls last,
        case when p_sort = 'oldest' then created_at end asc nulls last,
        case when p_sort = 'follow_up' then next_follow_up_at end asc nulls last,
        case when p_sort = 'recent' then created_at end desc nulls last,
        id desc
      limit p_page_size offset (p_page - 1) * p_page_size
    ) page_rows), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.crm_search_leads(text, public.lead_status, uuid, text, boolean, text, integer, integer) from public, anon;
grant execute on function public.crm_search_leads(text, public.lead_status, uuid, text, boolean, text, integer, integer) to authenticated;

create or replace function public.crm_sync_follow_up_date()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.leads l set next_follow_up_at = (
    select min(f.due_at) from public.follow_ups f
    where f.lead_id = new.lead_id and f.status = 'todo'
  ) where l.id = new.lead_id;
  if tg_op = 'UPDATE' and old.lead_id <> new.lead_id then
    update public.leads l set next_follow_up_at = (
      select min(f.due_at) from public.follow_ups f
      where f.lead_id = old.lead_id and f.status = 'todo'
    ) where l.id = old.lead_id;
  end if;
  return new;
end $$;
revoke all on function public.crm_sync_follow_up_date() from public, anon, authenticated;
create trigger follow_ups_sync_date after insert or update on public.follow_ups
for each row execute function public.crm_sync_follow_up_date();
