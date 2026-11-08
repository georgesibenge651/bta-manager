# Mise en service — BTA Manager multi-entreprises

## 1. Firebase (une seule fois)
1. Console Firebase → Authentication → activer « E-mail / mot de passe ».
2. Créer les comptes (propriétaire, puis employés) avec un e-mail **vérifié** (obligatoire pour accepter une invitation).
3. Plan Blaze requis pour les Cloud Functions.
4. `firebase deploy --only functions,firestore:rules`
   - Si la région `africa-south1` est refusée pour les fonctions : la changer dans `functions/src/index.ts`,
     `functions/src/*.ts` (`callOpts`) et `VITE_FUNCTIONS_REGION`.

## 2. Tests (GitHub → Actions → Tests, ou en local)
`npm install --legacy-peer-deps && npm --prefix functions install && npm test`
Les tests d'isolation Firestore exigent Java (émulateur).

## 3. Premier téléphone (le vôtre, avec les données existantes)
1. Sauvegardez : Paramètres → Sauvegarde & Données → exporter.
2. Écran de verrouillage : relier le compte Firebase (profil administrateur).
3. Paramètres → Entreprise & Établissements → Créer l'entreprise.
4. « Envoyer les données de cet appareil » → attendre « Migration terminée et vérifiée ».
   La synchronisation s'active seule. Les données locales ne sont jamais supprimées.

## 4. Autres téléphones / employés
- Propriétaire : « Inviter un employé » → transmettre le code.
- Employé : relier son compte Firebase, saisir le code, puis « Télécharger les données ».

## 5. Version Android
`versionCode` = 100 + numéro d'exécution GitHub : chaque APK est installable par-dessus le précédent
(même clé de signature `KEYSTORE_BASE64`).
