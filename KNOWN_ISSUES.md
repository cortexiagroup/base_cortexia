# Anomalies et limites restantes

| Priorité | Point | Condition de résolution |
| --- | --- | --- |
| Bloquant | Projet Supabase lié actif avec seulement 3 migrations appliquées sur 14 | Préproduction isolée, revue des écarts et déploiement autorisé après tests |
| Bloquant | Migration de protection des profils et autres migrations non appliquées/testées sur base isolée | `supabase test db` + essais multi-rôles directs réussis |
| Bloquant | Rapprochement réel des encaissements non démontré | Procédure externe, responsables et preuves définis/testés |
| Élevée | Reçus/propositions Edge non exécutés ; Deno absent localement | Test PDF et Storage en préproduction, y compris reprise après erreur |
| Moyenne | Import simultané ou par auteurs distincts peut créer des doublons en cas de décision `create` sur conflit de nom ou d'état devenu obsolète | Reproduction concurrente et garde transactionnelle revue |
| Moyenne | Rôle responsable commercial lit globalement les données de l'équipe, sans territoire formalisé | Valider le périmètre métier puis adapter RLS si nécessaire |
| Moyenne | Tableau terrain et politique : certains paramètres avancés ne sont pas éditables dans l'UI ; rapports limités | Spécifier et tester sans mélanger avance et dépense |
| Moyenne | Aucune mesure FPS, mémoire GPU, draw calls ou tests mobiles réels | Profil sur appareils représentatifs |
| Moyenne | Pas de restauration testée ni de surveillance d'incidents configurée | Exercice documenté et alertes en préproduction |
| Faible | Pas de config ESLint ni d'E2E automatisé | Mise en place CI avec vérifications non simulées |

Ne supprimer aucune donnée réelle pour « réparer » ces points. Les observations statiques sont à confirmer sur une copie isolée lorsque l'accès sera disponible.
