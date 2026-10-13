# Prompt 6 — Financement terrain, commissions et performance

## Règles de financement

- La politique initiale contient une **dotation de démarrage unique de 5 000 FCFA** par commercial et une référence de **500 FCFA de communication tous les trois jours**. Aucun versement, recharge ou transport n'est créé par cette politique seule.
- Une dotation normale a un index unique par commercial. Une seconde dotation exige une exception liée à la première, motivée et créée par un administrateur.
- Le gestionnaire habilité décide chaque budget de transport ultérieur : bénéficiaire, montant explicite, dates, motif, zone, auteur et date de décision. Aucune cadence ni valeur de transport automatique n'existe.
- Le budget autorisé, la demande d'avance, son approbation et sa remise effective sont des états distincts. La remise exige une preuve privée, un moyen et une référence. Elle n'est consignée qu'une fois.
- Une recharge ou un trajet financé par l'avance est une utilisation de celle-ci, pas un second transfert. Les frais personnels approuvés deviennent remboursables ; leur approbation ne signifie pas paiement. Les frais payés directement par Cortexia restent distincts.
- Une restitution déclarée n'est déduite du solde qu'après vérification sur un canal réel avec preuve et référence. L'avance ne peut être clôturée que si dépenses approuvées et restitutions vérifiées couvrent exactement le montant remis, sans dossier en attente.

## Droits et stockage

`sales_manager` représente le responsable commercial, mais seul un manager inscrit dans `field_budget_permissions` avec `enabled = true` peut décider et valider les fonds de terrain. L'administrateur accorde ce droit nominativement. Le commercial voit ses propres données et déclare ses dépenses ; il ne peut ni créer son budget ni s'approuver lui-même. Les nouvelles tables sont RLS, accessibles en écriture uniquement par RPC vérifiant le rôle et l'état. Les tables historiques `expenses` et `commissions` restent lisibles mais ne peuvent plus recevoir d'écritures directes du client.

Les preuves sont dans le bucket privé `cortexia-field-proofs` (PDF, JPEG ou PNG, 5 Mo maximum). Les URL signées expirent après 60 secondes. La clé service n'est jamais utilisée dans le navigateur.

## Commissions

Il n'existe **aucune politique de commission active par défaut**. L'administrateur publie une version avec base, taux ou montant fixe, prise d'effet, acquisition progressive ou après encaissement complet, et périmètre éventuel. Pour une base sur encaissements, seule la somme nette du `financial_ledger` entre dans le calcul. Arrondi déterministe au FCFA le plus proche sur la base cumulée : `floor((base × taux_en_points_de_base + 5000) / 10000)`.

La position conserve la politique choisie lors de son premier calcul. Les nouvelles écritures du journal client la recalculent, y compris après correction ou remboursement. Une position acquise est distincte de la somme approuvée, payable et effectivement versée. Les versements ont une référence externe unique et ne dépassent pas la somme actuellement approuvée et acquise. Si une correction client rend le cumul versé supérieur à l'acquis, l'écart est signalé pour examen humain ; aucune retenue automatique n'est faite.

La base « marge brute » peut être consignée, mais le calcul est refusé tant que coûts directs fiables et règle de reconnaissance du revenu ne sont pas disponibles. Le module ne produit donc pas de marge fictive.

## Indicateurs

Le tableau « Dépenses » sépare dotation réellement versée, communication justifiée, transport autorisé, transport financé, dépenses approuvées et avance à régulariser. La bande du Command Center réservée à l'administrateur montre des totaux réels sans ajouter de carte à la scène 3D.

Le rapport commercial distingue prospects, activités, rendez-vous, propositions, commandes, encaissements et dépenses. Son **CAC partiel** est `(dépenses de terrain approuvées + commissions effectivement versées durant la période) / nombre d'entreprises avec commande confirmée durant cette période` par commercial ; salaires et frais non attribués sont exclus. Ce n'est pas un CAC complet. Les commissions « acquises » affichées par période correspondent au cumul actuel des positions recalculées dans celle-ci, pas à une charge comptable périodique. Si le dénominateur est nul, « Données insuffisantes » apparaît. L'encaissement n'est jamais appelé revenu comptable, et aucune marge ou bénéfice n'est affiché sans coûts directs fiables.

## Déploiement et vérification

Le dépôt n'est relié à aucun projet Supabase distant. Docker Desktop ne répond pas sur cette machine. Les migrations et RLS **n'ont pas été exécutés en base**, les essais de parcours financiers et l'interface connectée restent donc à valider avec de vrais comptes de test sur une base isolée.

Après sauvegarde et revue : `supabase start`, `supabase db reset`, `supabase test db`, puis tests multi-rôles avec données fictives. Avant déploiement distant, examiner les migrations `20261013091308_field_finance_schema.sql`, `20261013091309_field_finance_workflows.sql` et `20261013091311_commission_workflows.sql`. Ensuite seulement, lier explicitement la cible et appliquer `supabase db push`.

Le scénario local pur de 5 000 FCFA / 3 500 FCFA justifiés / 1 500 FCFA à restituer est testé en TypeScript. Cela ne remplace pas un test SQL/RLS exécuté.
