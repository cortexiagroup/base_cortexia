# Parcours commercial — Prompt 4

## Déploiement

Appliquer les migrations dans l’ordre, après sauvegarde et revue du projet cible. Déployer ensuite l’Edge Function `issue-proposal` avec la vérification JWT activée. Elle utilise les variables serveur `SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` fournies par Supabase ; seule la clé publique va dans le frontend. Ne jamais placer la clé `service_role` dans une variable `VITE_*`.

```powershell
supabase db push
supabase functions deploy issue-proposal
```

Ce dépôt n’a pas été lié à un projet distant dans ce travail ; aucune migration ni fonction n’a été appliquée en production. Pour tester localement, démarrer Docker Desktop, exécuter `supabase start` puis `supabase db reset` et `supabase functions serve issue-proposal`. Vérifier les rôles et les politiques RLS avec des comptes Auth distincts avant ouverture aux utilisateurs.

## Catalogue et propositions

La migration ajoute un catalogue versionné. Une version publiée est immuable ; l’administrateur la suspend, la clone en brouillon, modifie la nouvelle version puis l’active. L’entrée « Site web personnalisé — à partir de 49 000 FCFA » est un **brouillon de référence** : compléter les prestations, exclusions, délai et conditions avant publication. Aucune offre supplémentaire n’est inventée.

La proposition est créée depuis un prospect accessible. Elle conserve des instantanés de l’offre et du client, ainsi qu’un prix entier en FCFA. Une remise ou une condition particulière déclenche une validation `admin` ou `sales_manager`. Les étapes sont : brouillon → soumission → approbation → PDF officiel → envoi manuel consigné → acceptation déclarée → acceptation vérifiée → commande. Le document n’est pas envoyé automatiquement. Le canal et la référence d’acceptation sont enregistrés ; une déclaration ne suffit pas à créer la commande.

L’aperçu PDF est marqué « non émis ». Le PDF officiel est généré côté Edge depuis l’instantané approuvé, sauvegardé sans écrasement dans le bucket privé `cortexia-documents`, puis enregistré en base avec son empreinte SHA-256. La lecture passe par un lien signé de courte durée et par RLS. Si un fichier existe au chemin officiel mais ne correspond plus au contenu à émettre, l’opération échoue et demande une vérification : elle n’écrase pas le fichier. Les coordonnées de l’entreprise se configurent dans le catalogue ; le logo peut être référencé par `commercial_settings.logo_storage_path` après dépôt contrôlé dans le bucket privé (pas d’upload de logo dans cette interface).

## Commandes, échéancier et périmètre

Une commande est idempotente par proposition acceptée et vérifiée. Elle garde prix, version d’offre, conditions et plan de paiement. Deux plans sont disponibles : 100 % à la commande, ou 50 % à la commande et 50 % à l’étape contractuelle de livraison. Pour un montant impair, le solde reçoit le franc restant. Les lignes d’échéancier sont des **sommes attendues**, pas des paiements. Le montant « confirmé » affiché sur la commande provient uniquement des lignes `payments` au statut `confirmed`. Ce module ne crée ni facture, ni paiement, ni reçu, ni commission. Le suivi de production montre le statut réel d’un éventuel projet lié ; il ne présume jamais une livraison.

Le Command Center affiche des comptes réels d’offres, propositions et commandes accessibles, et distingue les échéances contractuelles des encaissements confirmés. Les listes de propositions et commandes sont actuellement plafonnées aux 200 enregistrements les plus récents avant filtre client ; une pagination serveur reste nécessaire pour un volume supérieur.

## Vérifications

`npm run typecheck`, `npm test` et `npm run build` couvrent le frontend et le rendu PDF. Les tests PDF vérifient le format A4, la pagination et la reproductibilité. Le fichier `output/pdf/cortexia-proposition-controle.pdf` est un échantillon **synthétique de contrôle**, sans client réel ni statut d’émission. Les migrations ont été analysées syntaxiquement, mais les tests SQL/RLS et l’appel Edge de bout en bout requièrent un Supabase local actif ou un projet distant explicitement autorisé.
