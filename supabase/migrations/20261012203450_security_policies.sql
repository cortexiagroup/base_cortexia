create or replace function private.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$ select role from public.profiles where id = (select auth.uid()) and is_active = true $$;

revoke all on function private.current_app_role() from public;
grant execute on function private.current_app_role() to authenticated;

create or replace function private.can_manage_all()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select private.current_app_role() in ('admin'::public.app_role, 'sales_manager'::public.app_role) $$;

revoke all on function private.can_manage_all() from public;
grant execute on function private.can_manage_all() to authenticated;

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.leads enable row level security;
alter table public.activities enable row level security;
alter table public.offer_templates enable row level security;
alter table public.orders enable row level security;
alter table public.payments enable row level security;
alter table public.documents enable row level security;
alter table public.expense_policies enable row level security;
alter table public.expenses enable row level security;
alter table public.commission_policies enable row level security;
alter table public.commissions enable row level security;
alter table public.production_projects enable row level security;
alter table public.audit_logs enable row level security;
alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles, public.companies, public.contacts, public.leads, public.activities,
  public.offer_templates, public.orders, public.payments, public.documents, public.expenses, public.commissions,
  public.production_projects, public.import_batches, public.import_rows to authenticated;
grant select on public.expense_policies, public.commission_policies, public.audit_logs to authenticated;
revoke all on all tables in schema public from anon;

create policy profiles_select on public.profiles for select to authenticated
  using ((select auth.uid()) = id or (select private.can_manage_all()));
create policy profiles_insert on public.profiles for insert to authenticated
  with check ((select private.current_app_role()) = 'admin' and role <> 'admin');
create policy profiles_update on public.profiles for update to authenticated
  using ((select private.can_manage_all()))
  with check ((select private.can_manage_all()));

create policy companies_select on public.companies for select to authenticated using ((select private.can_manage_all()) or created_by = (select auth.uid()) or exists (select 1 from public.leads l where l.company_id = companies.id and l.assigned_to = (select auth.uid())));
create policy companies_insert on public.companies for insert to authenticated with check (created_by = (select auth.uid()) or (select private.can_manage_all()));
create policy companies_update on public.companies for update to authenticated using ((select private.can_manage_all()) or created_by = (select auth.uid())) with check ((select private.can_manage_all()) or created_by = (select auth.uid()));

create policy contacts_select on public.contacts for select to authenticated using ((select private.can_manage_all()) or exists (select 1 from public.leads l where l.company_id = contacts.company_id and l.assigned_to = (select auth.uid())));
create policy contacts_insert on public.contacts for insert to authenticated with check ((select private.can_manage_all()) or exists (select 1 from public.leads l where l.company_id = contacts.company_id and l.assigned_to = (select auth.uid())));
create policy contacts_update on public.contacts for update to authenticated using ((select private.can_manage_all()) or exists (select 1 from public.leads l where l.company_id = contacts.company_id and l.assigned_to = (select auth.uid()))) with check ((select private.can_manage_all()) or exists (select 1 from public.leads l where l.company_id = contacts.company_id and l.assigned_to = (select auth.uid())));

create policy leads_select on public.leads for select to authenticated using ((select private.can_manage_all()) or assigned_to = (select auth.uid()) or created_by = (select auth.uid()));
create policy leads_insert on public.leads for insert to authenticated with check (created_by = (select auth.uid()) and (assigned_to = (select auth.uid()) or (select private.can_manage_all())));
create policy leads_update on public.leads for update to authenticated using ((select private.can_manage_all()) or assigned_to = (select auth.uid())) with check ((select private.can_manage_all()) or assigned_to = (select auth.uid()));

create policy activities_select on public.activities for select to authenticated using ((select private.can_manage_all()) or author_id = (select auth.uid()) or exists (select 1 from public.leads l where l.id = activities.lead_id and l.assigned_to = (select auth.uid())));
create policy activities_insert on public.activities for insert to authenticated with check (author_id = (select auth.uid()) and (select private.can_manage_all() or exists (select 1 from public.leads l where l.id = activities.lead_id and l.assigned_to = (select auth.uid()))));

create policy offers_select on public.offer_templates for select to authenticated using (true);
create policy offers_insert on public.offer_templates for insert to authenticated with check ((select private.can_manage_all()));
create policy offers_update on public.offer_templates for update to authenticated using ((select private.can_manage_all())) with check ((select private.can_manage_all()));

create policy orders_select on public.orders for select to authenticated using ((select private.can_manage_all()) or sales_rep_id = (select auth.uid()));
create policy orders_insert on public.orders for insert to authenticated with check (created_by = (select auth.uid()) and (sales_rep_id = (select auth.uid()) or (select private.can_manage_all())));
create policy orders_update on public.orders for update to authenticated using ((select private.can_manage_all()) or (sales_rep_id = (select auth.uid()) and order_status = 'draft')) with check ((select private.can_manage_all()) or sales_rep_id = (select auth.uid()));

create policy payments_select on public.payments for select to authenticated using ((select private.can_manage_all()) or exists (select 1 from public.orders o where o.id = payments.order_id and o.sales_rep_id = (select auth.uid())));
create policy payments_insert on public.payments for insert to authenticated with check (created_by = (select auth.uid()) and exists (select 1 from public.orders o where o.id = payments.order_id and ((select private.can_manage_all()) or o.sales_rep_id = (select auth.uid()))));

create policy documents_select on public.documents for select to authenticated using ((select private.can_manage_all()) or created_by = (select auth.uid()) or exists (select 1 from public.orders o where o.id = documents.order_id and o.sales_rep_id = (select auth.uid())));
create policy documents_insert on public.documents for insert to authenticated with check (created_by = (select auth.uid()) and (select private.can_manage_all() or exists (select 1 from public.orders o where o.id = documents.order_id and o.sales_rep_id = (select auth.uid()))));

create policy expense_policies_select on public.expense_policies for select to authenticated using (true);
create policy expenses_select on public.expenses for select to authenticated using ((select private.can_manage_all()) or claimant_id = (select auth.uid()));
create policy expenses_insert on public.expenses for insert to authenticated with check (claimant_id = (select auth.uid()));
create policy expenses_update on public.expenses for update to authenticated using ((select private.can_manage_all()) or (claimant_id = (select auth.uid()) and status = 'submitted')) with check ((select private.can_manage_all()) or claimant_id = (select auth.uid()));

create policy commission_policies_select on public.commission_policies for select to authenticated using (true);
create policy commissions_select on public.commissions for select to authenticated using ((select private.can_manage_all()) or sales_rep_id = (select auth.uid()));
create policy commissions_insert on public.commissions for insert to authenticated with check ((select private.can_manage_all()));
create policy production_select on public.production_projects for select to authenticated using ((select private.can_manage_all()) or responsible_id = (select auth.uid()) or exists (select 1 from public.orders o where o.id = production_projects.order_id and o.sales_rep_id = (select auth.uid())));
create policy production_update on public.production_projects for update to authenticated using ((select private.can_manage_all()) or responsible_id = (select auth.uid())) with check ((select private.can_manage_all()) or responsible_id = (select auth.uid()));

create policy audit_select on public.audit_logs for select to authenticated using ((select private.can_manage_all()));
create policy import_batches_select on public.import_batches for select to authenticated using ((select private.can_manage_all()) or uploaded_by = (select auth.uid()));
create policy import_batches_insert on public.import_batches for insert to authenticated with check (uploaded_by = (select auth.uid()));
create policy import_batches_update on public.import_batches for update to authenticated using ((select private.can_manage_all()) or uploaded_by = (select auth.uid())) with check ((select private.can_manage_all()) or uploaded_by = (select auth.uid()));
create policy import_rows_select on public.import_rows for select to authenticated using (exists (select 1 from public.import_batches b where b.id = import_rows.batch_id and ((select private.can_manage_all()) or b.uploaded_by = (select auth.uid()))));
create policy import_rows_insert on public.import_rows for insert to authenticated with check (exists (select 1 from public.import_batches b where b.id = import_rows.batch_id and b.uploaded_by = (select auth.uid())));
create policy import_rows_update on public.import_rows for update to authenticated using (exists (select 1 from public.import_batches b where b.id = import_rows.batch_id and ((select private.can_manage_all()) or b.uploaded_by = (select auth.uid())))) with check (exists (select 1 from public.import_batches b where b.id = import_rows.batch_id and ((select private.can_manage_all()) or b.uploaded_by = (select auth.uid()))));

create or replace function private.confirm_payment(p_payment_id uuid)
returns public.payments
language plpgsql
security definer
set search_path = public, private
as $$
declare v_payment public.payments;
begin
  if private.current_app_role() not in ('admin'::public.app_role, 'sales_manager'::public.app_role) then
    raise exception 'only admin or sales manager may confirm payments';
  end if;
  update public.payments set status = 'confirmed', verified_by = auth.uid(), verified_at = now()
  where id = p_payment_id and status = 'pending'
  returning * into v_payment;
  if v_payment.id is null then raise exception 'payment not found or not pending'; end if;
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values (auth.uid(), 'confirm', 'payments', p_payment_id, jsonb_build_object('status', 'confirmed'));
  return v_payment;
end $$;
revoke all on function private.confirm_payment(uuid) from public;
grant execute on function private.confirm_payment(uuid) to authenticated;

create or replace function private.set_profile_role(p_user_id uuid, p_role public.app_role)
returns public.profiles
language plpgsql
security definer
set search_path = public, private
as $$
declare v_profile public.profiles;
begin
  if private.current_app_role() <> 'admin'::public.app_role then
    raise exception 'only an admin may change application roles';
  end if;
  update public.profiles set role = p_role where id = p_user_id returning * into v_profile;
  if v_profile.id is null then raise exception 'profile not found'; end if;
  insert into public.audit_logs(actor_id, action, entity_table, entity_id, changes)
  values (auth.uid(), 'role_change', 'profiles', p_user_id, jsonb_build_object('new_role', p_role));
  return v_profile;
end $$;
revoke all on function private.set_profile_role(uuid, public.app_role) from public;
grant execute on function private.set_profile_role(uuid, public.app_role) to authenticated;
