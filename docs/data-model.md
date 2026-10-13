# Modèle de données Cortexia Base

```text
auth.users 1──1 profiles
companies 1──N contacts
companies 1──N leads 1──N activities
offer_templates (id, version) 1──N orders 1──N payments
orders 1──N documents
orders 1──1 production_projects
profiles 1──N expenses / commissions / audit_logs / import_batches
import_batches 1──N import_rows
```

Les montants sont des `bigint` en FCFA entiers. Les horodatages sont `timestamptz`. Les versions d'offres acceptées sont conservées à la fois par référence et dans `orders.offer_snapshot`, afin de préserver l'état historique même après évolution du catalogue.
