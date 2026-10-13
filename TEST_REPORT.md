# Résultats des vérifications — 13 octobre 2026

| Vérification | Résultat réel | Portée |
| --- | --- | --- |
| `npm run typecheck` | Réussi | TypeScript frontend/Vite uniquement |
| `npm test` | 5 fichiers, 27 tests réussis | Fonctions pures CRM, Excel, commercial, finance, terrain ; pas de transaction Supabase |
| `npm run build` | Réussi, avertissement bundles > 500 Ko | Compilation frontend ; scène 3D ≈ 1,05 Mo minifié |
| Analyse syntaxique `pglast` | 14 migrations et `supabase/tests/database.sql` parsés | Syntaxe SQL seulement ; pas d'exécution ni validation PL/pgSQL/RLS |
| `supabase test db` | Échec : `LegacyDbConnectError`, connexion PostgreSQL locale impossible | 31 assertions pgTAP **non exécutées** |
| `supabase migration list --linked` | Réussi : 3 migrations distantes, 11 migrations locales non appliquées | Métadonnées du projet actif uniquement ; aucun changement distant |
| `supabase db query --linked` (lecture des privilèges) | Aucune réponse après attente, commande interrompue | Privilèges réels distants non mesurés ; aucune écriture envoyée |
| `npm audit --json` | 0 vulnérabilité signalée (219 dépendances répertoriées) | Dépend de la base d'avis disponible au moment du test ; pas une garantie de sécurité |
| ESLint | Non exécutable comme suite du projet | Aucun script ni configuration ESLint dans `package.json`; `npx` a proposé un téléchargement, interrompu |
| Deno / fonctions Edge | Non exécuté | `deno` absent |
| E2E métier, deux rôles, paiements partiels, reçus, import concurrent | Non exécutés | Instance Supabase isolée, utilisateurs et Storage indisponibles |
| Performance 3D, mobile/tablette/desktop, WebGL | Non mesurées | Aucun appareil/navigateur profilé |
| Sauvegarde et restauration | Non testées | Aucun projet/base cible autorisé et accessible |

## Assertions ajoutées

Le plan pgTAP passe de 29 à 31 assertions. Les nouvelles vérifications portent sur l'absence de privilège `UPDATE` direct de `authenticated` sur `profiles` et l'existence de la RPC professionnelle. Elles ne sont **pas** une preuve de résistance à l'escalade tant que `supabase test db` et les essais multi-rôles n'ont pas abouti.

## Recette de régression requise sur base isolée

1. Appliquer toutes les migrations et exécuter `supabase test db`, puis les advisors Supabase.
2. Créer des comptes fictifs admin, manager habilité/non habilité et deux commerciaux. Tenter l'UPDATE direct de `profiles.role` par chacun ; vérifier les refus et les champs autorisés par RPC.
3. Rejouer le même fichier importé deux fois, puis deux imports concurrents avec mêmes téléphone, domaine et nom ambigu ; contrôler lignes et historique.
4. Vérifier commande 49 000 FCFA, deux déclarations de 24 500 FCFA, absence de KPI avant confirmation, confirmations exclusives, deux tâches et deux reçus distincts, reprise sur échec PDF.
5. Vérifier dotation unique 5 000 FCFA, 500 + 2 000 + 1 000 FCFA justifiés, restitution vérifiée 1 500 FCFA, puis budget transport ultérieur seulement sur décision explicite.
6. Publier volontairement la règle fictive de commission à 10 %, contrôler partiel/total, correction client et absence de double versement.
7. Tester les accès Storage, les exports et les PDF en interrogeant directement l'API avec les deux comptes commerciaux.

Aucun encaissement ni versement réel ne doit être utilisé pour cette recette.
