-- A public sign-up creates only an inactive sales-rep profile. An administrator
-- must explicitly activate it; user-provided metadata never selects a role.
create or replace function private.create_pending_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  v_name := nullif(pg_catalog.btrim(pg_catalog.left(new.raw_user_meta_data->>'full_name', 120)), '');
  if v_name is null then
    v_name := coalesce(nullif(pg_catalog.split_part(new.email, '@', 1), ''), 'Nouvel utilisateur');
  end if;

  insert into public.profiles (id, full_name, role, is_active)
  values (new.id, v_name, 'sales_rep'::public.app_role, false);

  return new;
end;
$$;

revoke all on function private.create_pending_profile_for_auth_user() from public, anon, authenticated;

create trigger auth_user_create_pending_profile
after insert on auth.users
for each row execute function private.create_pending_profile_for_auth_user();

-- The client checks this before Auth sign-up so an undeployed database cannot
-- create an Auth account without its required Cortexia profile.
create function public.cortexia_signup_ready()
returns boolean
language sql
stable
set search_path = ''
as $$ select true $$;
revoke all on function public.cortexia_signup_ready() from public, anon, authenticated;
grant execute on function public.cortexia_signup_ready() to anon, authenticated;

-- An inactive Auth session must not gain Data API access through older
-- ownership-only policies. Keep profiles readable for the pending user so the
-- application can show its approval state.
do $$
declare
  v_table record;
begin
  for v_table in
    select n.nspname as schema_name, c.relname as table_name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and c.relrowsecurity and c.relname <> 'profiles'
  loop
    execute pg_catalog.format(
      'create policy active_profile_gate on %I.%I as restrictive for all to authenticated using ((select private.current_app_role()) is not null) with check ((select private.current_app_role()) is not null)',
      v_table.schema_name, v_table.table_name
    );
  end loop;
end;
$$;

create policy cortexia_storage_active_profile_gate on storage.objects
as restrictive for all to authenticated
using (bucket_id not in ('cortexia-documents', 'cortexia-imports') or (select private.current_app_role()) is not null)
with check (bucket_id not in ('cortexia-documents', 'cortexia-imports') or (select private.current_app_role()) is not null);
