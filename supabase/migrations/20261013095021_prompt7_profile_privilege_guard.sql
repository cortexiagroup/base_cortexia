-- Prompt 7: managers must not be able to turn themselves into administrators.
-- Keep profile maintenance through a narrowly scoped, audited operation.
revoke update on public.profiles from authenticated;
drop policy if exists profiles_update on public.profiles;

create or replace function public.crm_update_sales_profile(
  p_user_id uuid, p_territory text, p_joined_at date, p_phone text
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.crm_actor(true);
begin
  if p_user_id is null or not exists (
    select 1 from public.profiles where id = p_user_id and role = 'sales_rep'
  ) then raise exception 'commercial profile required'; end if;
  if pg_catalog.length(p_territory) > 255 or pg_catalog.length(p_phone) > 100 or
    p_joined_at > current_date + interval '1 year' then
    raise exception 'invalid professional profile fields'; end if;
  update public.profiles set
    territory = nullif(pg_catalog.btrim(p_territory), ''),
    joined_at = p_joined_at,
    phone = nullif(pg_catalog.btrim(p_phone), '')
  where id = p_user_id;
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values (v_actor, 'sales_profile_updated', 'profiles', p_user_id,
    pg_catalog.jsonb_build_object('territory', p_territory, 'joined_at', p_joined_at));
end $$;
revoke all on function public.crm_update_sales_profile(uuid,text,date,text) from public,anon;
grant execute on function public.crm_update_sales_profile(uuid,text,date,text) to authenticated;
