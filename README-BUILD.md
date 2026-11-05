# Générer l'APK (BTA Manager)

## Option 1 – GitHub (le plus simple, rien à installer)
1. Créez un dépôt GitHub (privé) et envoyez-y tout le contenu de ce dossier.
2. Onglet **Actions → Build APK → Run workflow**.
3. Quand c'est vert, téléchargez l'artefact **bta-manager-apk** (fichier `.apk`).

Pour pouvoir **mettre à jour** l'app plus tard sans la désinstaller, gardez toujours la même clé de signature :
```
keytool -genkeypair -keystore bta.jks -alias bta -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 bta.jks        # copiez le résultat
```
puis dans GitHub → Settings → Secrets → Actions : `KEYSTORE_BASE64` (le base64), `KEYSTORE_PASSWORD`, `KEY_ALIAS` (= bta).
(Utilisez le même mot de passe pour le keystore et la clé.) Sauvegardez `bta.jks` : sans lui, pas de mise à jour possible.

## Option 2 – Sur votre PC (Node 22, JDK 21, Android Studio/SDK)
```
npm install
npm run cap:build
cd android && ./gradlew assembleRelease     # ou ouvrez le dossier android dans Android Studio
```

## Connexion
Comptes de démonstration : Georges (admin), Didier (gestion), Mylet (caisse).
PIN par défaut de la démo (premier lancement uniquement) : admin **9999**, gestion **5555**, caisse **1234**.
L'écran de connexion ne les affiche plus ; l'application **oblige à le changer à la première connexion**.
