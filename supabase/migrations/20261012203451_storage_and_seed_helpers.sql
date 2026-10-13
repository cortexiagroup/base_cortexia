insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('cortexia-documents', 'cortexia-documents', false, 10485760, array['application/pdf']::text[]),
  ('cortexia-imports', 'cortexia-imports', false, 52428800, array['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy storage_documents_select on storage.objects for select to authenticated
using (bucket_id = 'cortexia-documents' and ((select private.can_manage_all()) or owner_id = (select auth.uid()::text)));
create policy storage_documents_insert on storage.objects for insert to authenticated
with check (bucket_id = 'cortexia-documents' and owner_id = (select auth.uid()::text));
create policy storage_documents_update on storage.objects for update to authenticated
using (bucket_id = 'cortexia-documents' and owner_id = (select auth.uid()::text))
with check (bucket_id = 'cortexia-documents' and owner_id = (select auth.uid()::text));

create policy storage_imports_select on storage.objects for select to authenticated
using (bucket_id = 'cortexia-imports' and ((select private.can_manage_all()) or owner_id = (select auth.uid()::text)));
create policy storage_imports_insert on storage.objects for insert to authenticated
with check (bucket_id = 'cortexia-imports' and owner_id = (select auth.uid()::text));
create policy storage_imports_update on storage.objects for update to authenticated
using (bucket_id = 'cortexia-imports' and owner_id = (select auth.uid()::text))
with check (bucket_id = 'cortexia-imports' and owner_id = (select auth.uid()::text));

revoke all on storage.objects from anon;

create or replace function public.normalize_togo_phone(p_phone text)
returns text language sql immutable as $$
  select case
    when p_phone is null or btrim(p_phone) = '' then null
    when regexp_replace(p_phone, '[^0-9+]', '', 'g') like '+228%' then regexp_replace(p_phone, '[^0-9+]', '', 'g')
    when regexp_replace(p_phone, '[^0-9]', '', 'g') like '228%' then '+' || regexp_replace(p_phone, '[^0-9]', '', 'g')
    when length(regexp_replace(p_phone, '[^0-9]', '', 'g')) = 8 then '+228' || regexp_replace(p_phone, '[^0-9]', '', 'g')
    else regexp_replace(p_phone, '[^0-9+]', '', 'g')
  end
$$;

create or replace function public.set_normalized_phone() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'companies' then new.normalized_phone = public.normalize_togo_phone(new.phone); end if;
  if tg_table_name = 'contacts' then new.normalized_phone = public.normalize_togo_phone(new.phone); end if;
  return new;
end $$;
create trigger companies_normalize_phone before insert or update of phone on public.companies for each row execute function public.set_normalized_phone();
create trigger contacts_normalize_phone before insert or update of phone on public.contacts for each row execute function public.set_normalized_phone();

alter table public.audit_logs force row level security;
