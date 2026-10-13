# CRM Cortexia Base — Prompt 3

## Modules livrés dans le code

- `/prospects` : liste recherchable, filtrable et paginée côté serveur ; vue Kanban ; création et édition ; fiche entreprise et contacts ; changement de statut tracé ; attribution simple ou en lot.
- `/commerciaux` : équipe, fiche individuelle, indicateurs, zone et date d'intégration ; activation/désactivation réservée à l'administrateur.
- `/activites` : journal, agenda de rendez-vous/démonstrations, relances, formulaires et exports.
- `/imports` : lecture XLSX/CSV, correspondance des colonnes, simulation serveur, décision ligne par ligne, validation transactionnelle, rapport et historique.
- Le Command Center interroge désormais les rendez-vous planifiés de la table `appointments` pour ses KPI. Les pages métier n'instancient pas la scène 3D.

Les tables, fonctions et politiques sont créées par les migrations `20261012210902_crm_operations.sql` et `20261012210915_crm_rpc_and_import.sql`. Elles dépendent des migrations fondatrices du Prompt 1. Aucune migration historique n'a été modifiée.

## Déploiement Supabase

1. Configurer un projet Supabase et lier le CLI (`supabase login`, `supabase link --project-ref …`). Ne jamais placer une clé `service_role` dans `VITE_*`.
2. Faire une sauvegarde et revoir les migrations avant `supabase db push`.
3. Créer un compte Auth et un profil administrateur via le bootstrap contrôlé du Prompt 1, puis activer les membres de l'équipe.
4. Configurer `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` dans `.env.local`.
5. Tester la matrice des rôles sur le projet cible. Aucune migration distante n'a été appliquée dans cet environnement de travail.

## Import et fusion

Le navigateur lit uniquement les formats `.xlsx` et `.csv`. Les limites sont de **10 Mo par fichier** et **500 lignes par feuille sélectionnée** ; elles sont contrôlées dans le navigateur, la fonction SQL et le bucket Storage privé. Pour un classeur Excel contenant plusieurs onglets, l'utilisateur choisit la feuille de prospects avant la correspondance des colonnes. Le modèle Excel officiel comporte un onglet Instructions. Un fichier existant peut être associé colonne par colonne aux champs CRM.

Après téléversement privé, `crm_prepare_import` normalise téléphone, domaine et email et classe chaque ligne : création, mise à jour certaine, conflit, doublon du fichier ou rejet. Un nom similaire seul ne déclenche aucune fusion automatique. Les conflits exigent une décision explicite. Les lignes rejetées et répétées ne sont pas écrites. `crm_commit_import` effectue toutes les écritures dans une seule transaction : si une ligne échoue, tout est annulé. Les cellules vides ne remplacent pas les valeurs existantes. Une mise à jour conserve l'attribution commerciale. L'empreinte du fichier, complétée par le nom de la feuille pour les onglets suivants, évite une réimportation identique par le même responsable tout en permettant d'importer d'autres feuilles du même classeur. Le rapport est conservé en base.

La détection n'est pas un rapprochement probabiliste exhaustif : une entreprise sans numéro, domaine ni email fiable peut nécessiter une revue manuelle. Les fichiers très volumineux nécessiteraient un mécanisme asynchrone et une pagination d'import, hors du seuil actuel de 500 lignes. Le fichier téléversé est privé, mais le serveur exploite les lignes JSON préparées par le client ; une vérification indépendante du contenu du fichier côté serveur serait nécessaire dans un contexte réglementaire plus strict.

## Sécurité et portée

Les fonctions `crm_save_lead`, `crm_assign_leads`, `crm_set_lead_status`, `crm_prepare_import`, `crm_commit_import` et `crm_search_leads` vérifient l'identité, le profil actif et le rôle. Les écritures directes sur prospects et imports sont révoquées pour `authenticated`. Les politiques RLS limitent l'accès commercial aux prospects qui lui sont actuellement attribués, et leurs activités, contacts, rendez-vous et relances. Les changements sont audités. Les comptes désactivés conservent leurs historiques.

La portée du responsable commercial correspond actuellement à tous les prospects de son rôle : le modèle existant ne contient pas de hiérarchie d'équipes. Si plusieurs responsables doivent être cloisonnés, ajouter une table d'équipes et étendre les politiques avant ouverture multi-équipe.

## Vérification

Localement : `npm run typecheck`, `npm test`, `npm run build` et analyse syntaxique des migrations. Les tests unitaires couvrent les associations de colonnes, les cellules vides et la protection des exports contre les formules.

À exécuter après connexion à Supabase : création/modification de prospect, refus RLS avec un second utilisateur, attribution et réattribution, journal d'activités, rendez-vous, démonstration, relance, transitions Kanban, import avec doublons et conflits, réimportation, export limité au périmètre, rafraîchissement KPI et parcours mobile. Ces tests d'intégration ne sont **pas** considérés réussis tant qu'ils n'ont pas été réellement exécutés.
