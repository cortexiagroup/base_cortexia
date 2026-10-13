# Audit sécurité et autorisations — 13 octobre 2026

Périmètre : revue statique des migrations, RPC, accès Storage, client React et fonctions Edge. La matrice est **déduite du code**, pas certifiée par un test RLS connecté.

## Matrice réelle déduite

| Action | Administrateur | Responsable commercial | Commercial |
| --- | --- | --- | --- |
| Consulter équipe et CRM | Tous | Tous selon `can_manage_all` | Prospects attribués, propre profil |
| Attribuer des prospects | Oui | Oui | Non |
| Gérer offres publiées | Oui | Oui selon `can_manage_all` | Lecture/proposition autorisée |
| Déclarer un paiement client | Oui | Oui | Sur sa commande accessible |
| Confirmer un encaissement | Oui | Seulement si `finance_verifiers.enabled` | Non |
| Modifier comptes de paiement | Oui | Non | Non |
| Définir budget transport | Oui | Seulement si `field_budget_permissions.enabled` | Non |
| Verser une avance / valider des dépenses | Oui | Même habilitation explicite | Non |
| Déclarer ses dépenses | Oui si bénéficiaire | Oui si bénéficiaire | Oui, propres budgets |
| Publier règle de commission, approuver/verser | Oui | Non | Non |
| Consulter commissions | Toutes | Toutes selon RLS actuelle | Les siennes |
| Modifier rôle/état d'un profil | État actif via RPC admin ; création de profil sous règles | Aucun UPDATE direct après correctif | Aucun |
| Modifier territoire/téléphone/date d'entrée d'un commercial | Via RPC dédiée | Via RPC dédiée | Non |

La politique de lecture globale des responsables commerciaux n'est pas limitée à une équipe ou à un territoire. Si l'organisation attend un périmètre strict, il faut le modéliser avant lancement, sans prétendre qu'il existe déjà.

## Défaut critique corrigé

La politique initiale `profiles_update` appliquait `private.can_manage_all()` aux anciennes **et nouvelles** lignes. Cette fonction inclut `sales_manager`. Avec le privilège SQL `UPDATE`, un responsable pouvait donc envoyer directement `role='admin'` sur son profil et obtenir les droits administrateur après relecture du profil. Le garde sur `is_active` ne contrôlait pas `role`.

La nouvelle migration révoque `UPDATE` pour `authenticated`, supprime la politique dangereuse et fournit `crm_update_sales_profile` avec quatre paramètres typés, vérification du rôle manager/admin, cible `sales_rep` et journalisation. L'interface appelle cette RPC. Aucune donnée historique n'est effacée. **La correction n'est pas validée en base** : le test direct `sales_manager`→`admin` doit être exécuté sur une instance isolée avant déploiement.

Le projet Supabase lié est actif mais sa liste de migrations distantes s'arrête à `20261012203451`, donc **la migration de correction n'y est pas présente**. La requête directe de privilèges `--linked` n'a pas répondu et a été interrompue sans résultat : l'exposition effective est déduite des migrations appliquées, non mesurée sur les grants distants. Restreindre dès maintenant l'accès au projet aux utilisateurs de confiance jusqu'à une intervention approuvée.

## Autres surfaces et limites

- Les clés `service_role` sont lues uniquement par les fonctions Edge dans le code audité ; le client Vite emploie `VITE_SUPABASE_PUBLISHABLE_KEY`. Aucun secret littéral n'a été identifié dans les fichiers inspectés. Vérifier également l'historique Git, l'hébergement et les variables du projet cible.
- Les fonctions `SECURITY DEFINER` auditables utilisent généralement `search_path = ''`, contrôlent `auth.uid()` via `crm_actor` et révoquent `PUBLIC`/`anon`. Les permissions effectives doivent être vérifiées dans `pg_proc` après migration. Une fonction Edge utilisant la clé service ne doit jamais se fier au seul identifiant fourni par le navigateur.
- Les buckets de justificatifs sont privés, avec chemins contrôlés et URL signées courtes. Les types MIME et tailles sont limités, mais la vérification antivirus/contenu réel des fichiers n'est pas démontrée. Les URL signées restent partageables pendant leur durée de validité.
- Les exports Excel passent par `protectExcelText` pour neutraliser les préfixes de formule. Les PDF et exports restent soumis à un test d'autorisation de bout en bout, avec deux comptes commerciaux distincts.
- `supabase/config.toml` contient des paramètres **locaux** de développement : inscription/confirmation email permissives, URL localhost, absence de MFA. Ne pas transposer ces valeurs à la production. Les domaines de redirection et politiques Auth doivent être vérifiés sur le projet distant.
- Les écritures financières utilisent des RPC et des références uniques, avec journal d'événements. La preuve d'un mouvement bancaire, mobile money ou espèces reste une vérification humaine externe ; un champ de référence saisi n'est pas une preuve indépendante.

Voir `TEST_REPORT.md` pour les contrôles effectués et les tests RLS restant obligatoires.
