-- Données de référence fictives uniquement pour le développement local.
insert into public.expense_policies (name, initial_budget_xof, communication_credit_xof, communication_interval_days)
values ('default-togo', 5000, 500, 3)
on conflict (name) do nothing;

insert into public.commission_policies (name, rate_bps, basis)
values ('default-collected-amount', 500, 'confirmed_collected_amount')
on conflict (name) do nothing;

insert into public.offer_templates (name, description, price_xof, benefits, included_services, exclusions, delivery_days, payment_terms)
values ('Site vitrine de base', 'Offre fictive de développement local', 49000,
  '["Présence web"]'::jsonb, '["Domaine première année", "Hébergement première année"]'::jsonb,
  '["Publicité payante"]'::jsonb, 15, 'Acompte à la commande, solde avant livraison')
on conflict do nothing;
