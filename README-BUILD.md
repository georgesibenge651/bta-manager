# Build Android — CHIEF ALPHONS COMPANY LTD

## Option 1 – GitHub (le plus simple, rien à installer)
1. Envoyez les changements sur la branche `feature/bta-anonymous-manager`.
2. L'action **CHIEF ALPHONS COMPANY LTD - Android Release** lance les tests et construit un APK et un Android App Bundle signé.
3. Pour Google Play, téléchargez l'artefact **chief-alphons-tracking-playstore-aab** (fichier `.aab`). L'APK **chief-alphons-tracking-release-apk** sert aux essais directs.

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
