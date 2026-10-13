# Préparation à une future production — NO-GO actuel

Ce document est une procédure de préparation, **pas** une autorisation de déploiement. Aucune modification DNS, migration distante ou transaction réelle n'a été effectuée.

Le CLI est lié à un projet Cortexia actif. Sa liste de migrations indique seulement les trois premières versions appliquées ; les onze autres existent uniquement dans le dépôt. Ne pas interpréter « projet actif » comme « application opérationnelle ».

## Prérequis et configuration

- Projet Supabase cible identifié, propriétaire autorisé, région et version PostgreSQL confirmées ; environnement de préproduction séparé et peuplé uniquement de données fictives.
- URL HTTPS définitive et domaine de redirection Auth autorisés. Configurer SMTP, vérification email, politique de mots de passe, MFA administrateur et invitations contrôlées. Ne pas reprendre les valeurs locales de `supabase/config.toml`.
- Frontend : uniquement `VITE_SUPABASE_URL` et une clé **publishable**. Clé `service_role` et secrets exclusivement dans les fonctions Edge/gestionnaire de secrets. Contrôler `dist/` et l'historique Git avant publication.
- Buckets privés, limites de taille/MIME, règles RLS et fonctions Edge déployées et testées. Créer le premier admin par procédure SQL contrôlée après création Auth ; jamais par choix de rôle côté navigateur.
- Paramétrer les comptes officiels, responsables de vérification, numérotation, politique terrain et politique de commission selon décision explicite. Ne pas considérer les montants de référence comme des décaissements.

## Séquence de déploiement recommandée

1. Geler la version du code, inventorier les migrations et obtenir une sauvegarde PostgreSQL **et Storage** vérifiée. Préparer un environnement isolé correspondant à la version distante.
2. Faire passer TypeScript, tests, build, tests SQL/RLS multi-rôles, Edge/PDF, scénario E2E fictif, revue des dépendances et vérification des secrets. Bloquer le lancement sur tout échec critique.
3. Examiner `supabase migration list`, les différences de schéma et les advisors ; relire spécialement `20261013095021_prompt7_profile_privilege_guard.sql`. Faire approuver la fenêtre d'intervention.
4. Appliquer d'abord en préproduction, effectuer la recette de `TEST_REPORT.md`, puis seulement proposer le passage en production avec validation humaine explicite. Ne pas lancer `supabase db push` distant automatiquement.
5. Après application, vérifier grants/RLS réels, trois rôles, tâches PDF, lecture Storage, rapprochement financier, journaux d'audit et accès depuis téléphone. Surveiller les erreurs des fonctions Edge et du navigateur.

## Sauvegarde, restauration et rollback

- Documenter RPO/RTO et la rétention selon le plan Supabase choisi. Tester une restauration complète sur **un autre projet** : schéma, données, utilisateurs nécessaires, objets Storage privés, liens documentaires et séquences de numérotation. Une sauvegarde non restaurée ne prouve rien.
- Les migrations SQL sont additives ; ne pas supprimer une colonne/table ou réécrire l'historique pour revenir en arrière. En cas d'échec, arrêter les nouvelles écritures, conserver journaux et sauvegarde, puis préparer une migration compensatoire revue. Le retour arrière du frontend peut être immédiat, mais ne rétablit pas automatiquement un schéma antérieur.
- Pour un incident financier, isoler les comptes affectés, préserver les écritures et justificatifs, rapprocher avec relevés externes, corriger via opérations traçables après approbation ; jamais par modification silencieuse du journal.

## Surveillance et incidents

- Journaliser erreurs Edge, tâches PDF échouées, échecs RLS, exceptions SQL, latence, saturation Storage et doublons de références. Définir responsables, alertes et procédure de triage.
- Examiner les accès et habilitations à intervalles réguliers ; révoquer les sessions d'un compte compromis et vérifier les opérations depuis son dernier accès fiable.
- Limiter les données personnelles dans les logs, définir durée de conservation, accès autorisés et procédure d'export/suppression applicable. Réviser les obligations locales avec un conseil compétent avant exploitation.

## Points bloquants avant décision GO

- Base isolée indisponible : migrations, `supabase test db`, tests RLS et concurrence non exécutés.
- Projet lié en retard de 11 migrations, dont la correction d'élévation de rôle ; aucune application distante sans sauvegarde, revue et autorisation explicite.
- Aucune recette intégrale CRM → commande → paiements → reçus → dépenses → commissions.
- Fonctions Edge, qualité PDF et reprise d'échec non testées.
- Sauvegarde/restauration, Auth de production, DNS, domaines, clés et supervision non validés.
- Périmètre du rôle responsable commercial et contrôle externe des encaissements à confirmer.

Décision actuelle : **NO-GO**. Réévaluer uniquement après preuves écrites des contrôles ci-dessus.
