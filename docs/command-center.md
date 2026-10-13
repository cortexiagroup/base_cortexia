# Command Center

## Structure

- `src/lib/dashboard.ts` récupère les nombres visibles sous les politiques RLS. Les montants sont additionnés en `bigint` et seuls les paiements `confirmed` contribuent aux encaissements.
- `src/lib/auth.tsx` gère la session et charge le profil lié à `auth.users`.
- `src/components/CommandScene.tsx` rend six espaces isométriques. La caméra utilise `OrbitControls`, avec rotation et zoom limités et recentrage animé.
- `src/App.tsx` assemble l'enveloppe, les routes, les KPI, le panneau d'inspection et la vue 2D.
- `src/styles.css` définit les tokens visuels, les composants et les adaptations tablette/mobile.

## Interaction

La sélection est possible par clic sur la scène ou via les six boutons situés sous elle, utilisables au clavier. La sélection déplace la caméra et charge un panneau propre à l'étape. Le panneau affiche des données autorisées par Supabase ou une erreur explicite. Aucun chiffre n'est fourni lorsque la connexion échoue.

## Limites actuelles

- Sans projet Supabase connecté et profil utilisateur, seul l'écran de connexion peut être vérifié de bout en bout.
- Les pages de modules sont des préparations et ne comportent pas encore de formulaires métier.
- Les types générés automatiquement attendent l'application des migrations sur une base.
- Les performances WebGL doivent être mesurées sur du matériel représentatif ; le build vérifie seulement le chargement différé.
