# Prompt 5 — Encaissements et reçus

## État

Le module sépare l'échéancier contractuel, la déclaration d'un client, la vérification manuelle sur le canal officiel et l'écriture d'encaissement. Une preuve déposée et une référence déclarée ne sont jamais un encaissement. Le Command Center, le solde de commande et les tableaux financiers lisent `financial_ledger`, y compris les corrections et remboursements signés négativement.

Le présent dépôt **n'est pas connecté à un projet Supabase distant**. Aucune migration ni fonction de cette livraison n'a été déployée, et aucun paiement réel n'a été enregistré ou vérifié ici.

## Déploiement

1. Sauvegarder la base cible et faire relire les migrations `20261012215952_finance_accounts_ledger_documents.sql` et `20261012220048_finance_secure_workflows.sql`.
2. Démarrer Docker Desktop pour les essais locaux : `supabase start`, `supabase db reset`, `supabase test db`. Les tests RLS doivent employer des utilisateurs Auth distincts (admin, manager délégué, manager non délégué, commercial et invité).
3. Après liaison explicite au projet cible, appliquer `supabase db push`, puis déployer `supabase functions deploy issue-finance-document`.
4. Vérifier que les secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` sont disponibles **uniquement côté Edge Function**. Ne jamais mettre la clé service dans `VITE_*`, les fichiers publics ou le navigateur.
5. Enregistrer les comptes officiels sous « Comptes officiels », configurer le préfixe de reçus et déléguer nominativement la vérification, si nécessaire. Tester un flux fictif complet avant ouverture.

## Contrôles et limites

- Les comptes bancaires et Mobile Money sont configurés par l'administrateur. Le compte espèces exige un responsable de caisse actif. Les coordonnées figurent dans la fiche d'instructions figée à sa création et dans le texte WhatsApp copiable ; aucun message n'est envoyé automatiquement.
- Le commercial peut déclarer un paiement sur sa commande ; seul l'administrateur ou un manager explicitement délégué peut le confirmer, après contrôle externe et saisie de la référence officielle. Le contrôle est manuel : aucune API bancaire ou Mobile Money n'est branchée.
- Le reçu est une requête documentaire durable et unique par paiement confirmé. Son numéro et son instantané sont créés dans la transaction de confirmation. La fonction Edge génère le PDF, l'enregistre en Storage privé sans écrasement, puis finalise le document. Une erreur laisse la confirmation intacte et le dossier indique « Réessayer ». **Il n'existe pas encore de worker autonome** : les requêtes en attente demandent une relance par l'utilisateur autorisé ou un futur planificateur.
- Les justificatifs sont stockés dans un bucket privé avec contrôle d'accès et URL signée de courte durée. Les exports suivent les lignes accessibles par RLS. Vérifier la politique de conservation des données, la sauvegarde, l'identité du bénéficiaire et les mentions légales avant exploitation réelle.
- Les corrections et remboursements requièrent demande, approbation et exécution administrative avec une source et une référence externes ; ils ajoutent une écriture compensatrice sans modifier le journal historique. Aucun remboursement externe n'est déclenché par le logiciel.
- Un reçu n'est pas une facture fiscale. Le PDF ne calcule ni taxe, ni signature, ni statut réglementaire.

## Vérifications réalisées dans ce dépôt

`npm run typecheck`, `npm test`, `npm run build`, parsing statique des migrations et rendu A4 des deux PDF de contrôle. La validation SQL/RLS en base, le déploiement Edge, les URL signées et le parcours bout en bout nécessitent Docker ou un projet Supabase lié ; ils ne sont pas attestés par les tests locaux.
