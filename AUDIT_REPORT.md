# Audit Cortexia Base — Prompt 7

Date : 13 octobre 2026. Audit statique du dépôt et vérifications locales. Le CLI est lié à un projet Supabase actif et a permis de lire **la liste des migrations distantes**, sans consulter ni modifier les données métier. Les états ci-dessous ne valent pas recette métier connectée.

## Inventaire et état réel

Architecture : React 19, TypeScript strict, Vite 8, Supabase JS, React Three Fiber/drei, PDF via fonctions Edge et `pdf-lib`, import/export Excel, 14 migrations SQL, tests Vitest et un fichier pgTAP. Graphify a détecté 84 fichiers pris en charge (67 de code, 8 documents, 4 PDF, 5 images) et 2 fichiers sensibles ignorés. Les routes couvrent CRM, offres, propositions, commandes, paiements, dépenses, commissions et rapports. Les routes Production et Livraison restent des espaces réservés.

| Domaine | État | Preuve et limite |
| --- | --- | --- |
| Calculs purs, mapping Excel, protections des formules, snapshots commerciaux | Opérationnel et vérifié localement | 27 tests Vitest réussis ; aucune base requise |
| Scène 3D et repli 2D | Implémenté, non vérifié sur appareils | Import différé, `frameloop="demand"`, DPR plafonné ; aucune mesure FPS/draw calls |
| CRM, recherche/pagination, activités, import/export | Implémenté, non vérifié en base | RPC, écrans et migrations présents ; tests transactionnels/RLS non exécutés |
| Offres, propositions, commandes | Implémenté, non vérifié en base | Snapshots d'offre, `proposal_id` unique et génération PDF prévus ; Edge Function non testée |
| Encaissements, reçus et corrections | Implémenté, non vérifié en base | Journal et contrôle par RPC ; aucune confirmation ou émission PDF réelle testée |
| Dotations, transports, dépenses et commissions | Partiellement fonctionnel | UI et SQL présents ; politiques avancées/rapports incomplets et aucun test SQL connecté |
| Production/Livraison, exploitation et restauration | Absents ou non vérifiés | Pages réservées ; aucun exercice de sauvegarde/restauration |

## Anomalies classées

| Gravité | Description et emplacement | Impact | Correction ou recommandation | Vérification | Statut |
| --- | --- | --- | --- | --- | --- |
| Critique | Projet Supabase lié : seulement les migrations `20261012203448`, `20261012203450`, `20261012203451` appliquées ; 11 migrations locales absentes | Frontend et base distants incompatibles ; contrôles des prompts 3–7 absents à distance | Préproduction isolée, sauvegarde puis plan d'application revu ; aucun `db push` sur le projet actif avant validation | `supabase migration list --linked` réussi le 13/10/2026 | Ouvert, bloquant |
| Critique | `profiles_update` autorisait `sales_manager` à modifier `role` (`20261012203450_security_policies.sql`) | Élévation vers `admin`, puis accès financier | Migration `20261013095021_prompt7_profile_privilege_guard.sql` : révocation UPDATE direct et RPC limitée aux champs professionnels ; frontend adapté | Analyse des grants/RLS + assertion pgTAP ajoutée ; test réel de rôle encore requis | Corrigé dans le code, non validé en base |
| Élevée | Migrations, RLS et Edge Functions non exécutées sur une base isolée | Défauts SQL ou d'autorisation non détectés | Démarrer Supabase local, rejouer migrations et scénario multi-rôles | `supabase test db` échoue à la connexion | Ouvert, bloquant |
| Élevée | Confirmation de paiement fondée sur une source et une référence déclarées par l'opérateur (`finance_confirm_payment`) | L'application ne peut pas prouver seule le crédit bancaire/marchand | Procédure de rapprochement externe obligatoire, double contrôle selon risque | Test manuel avec extrait officiel fictif et rôles de test | Ouvert, contrôle opérationnel |
| Moyenne | Import : hash unique par auteur, pas global ; conflits de même nom peuvent être créés après choix explicite, et aperçu/commit ne revalide pas tous les matches récents (`crm_prepare_import`, `crm_commit_import`) | Doublons entre auteurs/imports concurrents | Test transactionnel concurrent, puis garde dédiée si comportement confirmé | Deux imports simultanés sur base isolée | Ouvert |
| Moyenne | Deux fonctions Edge et les PDF n'ont pas été exécutés ; Deno absent | Reçu non émis ou PDF incorrect malgré build React vert | Tester rendu, stockage, reprise et droits des fonctions | Essais Edge + vérification PDF sur base isolée | Ouvert |
| Moyenne | Vue des rapports : filtres limités à commercial/période, CAC partiel ; paramétrage de politique terrain partiellement exposé | Décisions de gestion potentiellement incomplètes | Étiquetage maintenu, compléter après recette métier | Revue des écrans et SQL | Ouvert, hors correctif sécurité |
| Moyenne | `CommandScene` pèse environ 1,05 Mo minifié et aucun profil GPU n'a été mesuré | Chargement/fluide mobile inconnus | Mesurer sur appareils cibles avant optimisation supplémentaire | Profil navigateur, FPS, mémoire, draw calls | Ouvert |
| Faible | Aucun script/config ESLint ; pas de suite E2E configurée | Régressions UI moins détectables | Ajouter une configuration de lint et des tests de parcours lors de la mise en place CI | `package.json` | Ouvert |

## Contrôles métier statiques

- Offre : le devis et la commande gardent un instantané ; une commande est créée depuis une proposition acceptée, avec `proposal_id` unique. Une commande confirmée ne crédite pas le journal financier à elle seule.
- Paiement : la déclaration et la confirmation sont séparées. La confirmation verrouille commande puis paiement, écrit le journal et crée une tâche de reçu dans la même transaction. Une deuxième confirmation doit rencontrer un statut non `pending`. Une erreur Edge ultérieure laisse le paiement confirmé et la tâche en échec/reprise. Ces propriétés n'ont pas été testées en PostgreSQL.
- Dotation : une dotation normale unique de 5 000 FCFA par commercial est définie par défaut, sans transfert automatique. Les 500 FCFA/3 jours sont configurables et imputés à une source. Le transport ultérieur requiert une décision et un montant explicites. Budget, avance versée, dépense et restitution vérifiée restent distincts.
- Commission : aucune règle active n'est semée ; calcul sur le journal net confirmé, approbation et versement séparés. Les corrections peuvent réduire l'acquis sans retenue automatique. La marge brute reste indisponible faute de coûts directs fiables.
- Import : même hash/même auteur renvoie le lot existant ; les cellules vides sont coalescées dans `crm_save_lead`. Les collisions exactes téléphone/domaine sont signalées. L'absence de revalidation complète à la validation finale interdit de conclure à l'absence de doublons sous concurrence.

## Décision

**NO-GO.** Le projet lié n'a reçu que les trois premières migrations. Le défaut d'élévation de rôle figure dans celles-ci et la correction nouvelle n'y est pas appliquée ; son privilège effectif n'a toutefois pas pu être interrogé directement. Aucune recette intégrale, aucun test Edge et aucun exercice de restauration ne fournissent les preuves exigées pour une exploitation financière réelle.
