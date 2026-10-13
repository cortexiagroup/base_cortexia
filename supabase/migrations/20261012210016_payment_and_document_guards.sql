-- Closing direct client write paths discovered while connecting the Command Center.
create or replace function public.guard_payment_insert()
returns trigger language plpgsql as $$
begin
  if current_user not in ('postgres', 'supabase_admin') and
     (new.status <> 'pending' or new.verified_by is not null or new.verified_at is not null or new.correction_of is not null) then
    raise exception 'payment confirmation and corrections require an authorized server operation';
  end if;
  return new;
end $$;
create trigger payments_guard_insert before insert on public.payments
for each row execute function public.guard_payment_insert();

create or replace function public.guard_order_update()
returns trigger language plpgsql as $$
begin
  if current_user not in ('postgres', 'supabase_admin') and old.order_status <> 'draft' and
    (old.company_id, old.sales_rep_id, old.offer_template_id, old.offer_version, old.offer_snapshot, old.amount_xof, old.contractual_terms)
    is distinct from
    (new.company_id, new.sales_rep_id, new.offer_template_id, new.offer_version, new.offer_snapshot, new.amount_xof, new.contractual_terms) then
    raise exception 'confirmed order terms are immutable';
  end if;
  return new;
end $$;
create trigger orders_guard_update before update on public.orders
for each row execute function public.guard_order_update();

create or replace function public.guard_receipt_insert()
returns trigger language plpgsql as $$
begin
  if new.document_type = 'receipt' and not exists (
    select 1 from public.payments p where p.id = new.payment_id and p.status = 'confirmed'
  ) then
    raise exception 'a receipt requires a confirmed payment';
  end if;
  return new;
end $$;
create trigger documents_guard_receipt before insert on public.documents
for each row execute function public.guard_receipt_insert();

drop policy if exists storage_documents_update on storage.objects;
drop policy if exists storage_documents_select on storage.objects;
create policy storage_documents_select on storage.objects for select to authenticated
using (bucket_id = 'cortexia-documents' and (
  (select private.can_manage_all()) or owner_id = (select auth.uid()::text) or
  exists (select 1 from public.documents d where d.storage_path = name)
));
