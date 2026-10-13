# Cortexia Base

Socle Supabase et Command Center React. L'interface exige un projet Supabase configuré pour afficher des données réelles.

## Architecture

- `auth.users` est la source d'identité ; `public.profiles` porte le rôle métier.
- `companies`, `contacts` et `leads` conservent l'historique commercial.
- `activities`, `offer_templates`, `orders`, `payments`, `documents`, `expenses`, `commissions` et `production_projects` modélisent le parcours opérationnel.
- `import_batches` et `import_rows` préparent les simulations/importations Excel et CSV sans écrasement aveugle.
- `audit_logs` est append-only côté API et protégé par RLS.
- Les documents et imports sont dans des buckets Storage privés.

## Application frontend

```powershell
npm ci
Copy-Item .env.example .env.local
# Renseigner VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY dans .env.local
npm run dev
```

La clé publiée dans `VITE_SUPABASE_PUBLISHABLE_KEY` doit être la clé publique du projet. La clé secrète et la clé `service_role` ne doivent jamais être placées dans un fichier `VITE_*`.

L'interface contient la connexion Supabase, les routes protégées, les KPI soumis à RLS, six zones isométriques sélectionnables, un panneau contextuel et une navigation 2D. La vue 2D est proposée par défaut sur petit écran et utilisée si WebGL n'est pas disponible.

Les modules Prospects, Commerciaux, Activités, Imports, Offres, Propositions, Commandes, Paiements, Dépenses, Commissions et Rapports sont raccordés aux données Supabase. Les parcours sont décrits dans [docs/finance.md](docs/finance.md) et [docs/field-finance.md](docs/field-finance.md). La production détaillée reste à développer. Il n'y a pas de données CRM simulées dans le frontend.

## Base locale

Prérequis : Docker Desktop et Supabase CLI 2.108+.

```powershell
supabase start
supabase db reset
supabase test db
supabase gen types typescript --local > src/types/database.ts
```

`supabase db reset` charge uniquement les données de référence fictives présentes dans `supabase/seed.sql`. Elles ne représentent pas des données opérationnelles.

## Connexion à un projet distant

1. Créer ou sélectionner le projet dans Supabase.
2. Exécuter `supabase login`, puis `supabase link --project-ref <ref>`.
3. Vérifier le schéma cible et faire une sauvegarde.
4. Exécuter `supabase db push` après revue des migrations.
5. Configurer les clés dans l'environnement d'exécution ; la clé `service_role` reste exclusivement côté serveur/Edge Function.

La connexion distante n'a pas été effectuée dans ce travail.

Le premier administrateur doit être créé après un utilisateur Supabase Auth, via une opération SQL de bootstrap contrôlée. Les rôles ne sont pas attribués automatiquement par le frontend.

## Autorisations

- `admin` : gouvernance complète et validation financière.
- `sales_manager` : supervision commerciale et importations supervisées ; validation financière uniquement après délégation explicite de l'administrateur.
- `sales_rep` : propres prospects attribués, activités correspondantes, commandes de son portefeuille et dépenses personnelles.
- La confirmation d'un paiement passe par `public.finance_confirm_payment(...)` avec contrôle de rôle et vérification externe déclarée ; l'ancien `private.confirm_payment(uuid)` n'est plus accessible au rôle `authenticated`.
- Les paiements et commissions sont protégés contre les mises à jour/suppressions directes ; les corrections utilisent des écritures traçables.

## Choix et reports

- Les taux de commission et budgets sont configurables par tables de politiques.
- La détection des doublons, le mapping interactif Excel et les exports sont implémentés dans le Prompt 3 ; voir [Documentation CRM](docs/crm.md).
- Le parcours des offres, propositions, PDF commerciaux et commandes est décrit dans [Documentation commerciale](docs/commercial.md). La fonction Edge d'émission doit encore être déployée sur le projet cible.
- Les déclarations, comptes officiels, reçus et corrections financières sont décrits dans [Documentation finance](docs/finance.md). La fonction Edge d'émission financière doit encore être déployée sur le projet cible.
- Dotations, budgets de transport décidés, dépenses, régularisations, commissions et performance sont décrits dans [Documentation du terrain](docs/field-finance.md). Les migrations correspondantes nécessitent encore un test SQL/RLS local puis le déploiement sur le projet cible.
- `src/types/domain.ts` est un sous-ensemble métier maintenu à la main. Les types Supabase exhaustifs doivent être générés dans un environnement local ou distant après application effective des migrations.

## Vérifications frontend

```powershell
npm run typecheck
npm test
npm run build
```

La scène est chargée séparément du shell applicatif. Le bundle 3D reste volumineux ; mesurer son temps de chargement sur les appareils cibles après connexion au projet.
