# Rapport d'audit – BTA Manager

## Failles de sécurité (corrigées)
1. **Le PIN n'était jamais demandé** : l'écran PIN existait mais n'était branché nulle part. → Écran de verrouillage au lancement + verrouillage automatique après inactivité (réglage « déconnexion auto »).
2. **Changement d'utilisateur sans mot de passe** (n'importe qui devenait Administrateur d'un clic). → Il faut maintenant le PIN du compte cible.
3. **PIN par défaut affichés à l'écran** (9999 / 5555 / 1234) et **porte dérobée** (compte sans PIN = 1234/9999/0000 acceptés). → Indices supprimés, porte dérobée supprimée, changement de PIN obligatoire à la première connexion, PIN triviaux refusés.
4. **Force brute sur le PIN** (SHA-256 simple, essais illimités). → Hash salé à 5 000 tours, blocage après 5 erreurs (30 s, doublé à chaque série).
5. **Permissions seulement visuelles** : un caissier pouvait changer le taux de change, supprimer des produits, etc. → Contrôles de rôle dans la couche de données (admin / gestionnaire / caissier).
6. **Sauvegarde JSON** : contenait les hash de PIN et pouvait écraser les comptes (injection d'un admin). → Export sans PIN, import limité aux données commerciales, validé, réservé à l'admin.
7. **Serveur** : le ZIP « code source » exposait aussi le fichier `.env` (clés), CORS ouvert à tous, aucune authentification, données non validées. → ZIP désactivé en production et sans secrets, CORS restreint, clé API optionnelle, validation et limites.
8. **Android** : `allowBackup=true` (données copiables via adb), FileProvider exposant tout le stockage externe, build release non signé. → Corrigés ; signature par variables d'environnement.
9. Écrans développeur (export ZIP/Kotlin/APK, cadre « téléphone ») visibles dans l'app livrée. → Masqués hors mode développement.

## Bugs fonctionnels (corrigés)
- **Synchronisation factice** : dans l'APK, `/api/...` n'existe pas (page HTML renvoyée) ; les ventes faites « en ligne » étaient marquées SYNCED sans jamais être envoyées. → Mode local clair si aucun serveur (`VITE_API_BASE_URL` vide) ; sinon file d'attente réelle, délai d'attente, confirmation par enregistrement.
- **Vente à crédit sans client** : la dette disparaissait. → Refusée.
- **Stock négatif silencieux** (la caisse forçait `allowNegativeStock: true`). → Confirmation explicite.
- Aucune validation : quantités ≤ 0 / NaN, prix négatifs, remise > total, doublons de lignes. → Validés.
- **Mouvement de stock manuel non enregistré** (modifiait l'objet en mémoire sans sauvegarder). → Méthode dédiée atomique.
- Création d'utilisateur : le PIN saisi était ignoré ; « Changer PIN » ne faisait rien (prop non branchée). → Corrigé.
- Produit/client/fournisseur modifié inexistant → plantage ; SKU / code-barres en double. → Gérés.
- Arrondis flottants sur les montants → arrondi au centime.
- Persistance : 3 copies réécrites à chaque action (lourd) et une copie ancienne pouvait écraser la récente. → Écriture groupée + horodatage, sauvegarde à la mise en arrière-plan.
- Export CSV/JSON impossible dans l'APK (téléchargement blob) et CSV vulnérable aux formules Excel. → Partage Android natif, cellules protégées.
- WhatsApp : numéros locaux (0xx…) mal formés. → Normalisés en +243.
- Bénéfice brut du tableau de bord incohérent avec les rapports. → Aligné.

## Limites connues (non modifiées)
- Le « scanner » de codes-barres est une simulation (saisie manuelle/liste), pas une vraie caméra.
- `window.print()` ne fonctionne pas dans une WebView Android ; utiliser « Partager / WhatsApp / Copier ».
- Les photos produits viennent d'Unsplash (réseau requis) ; polices Google (repli sur police système hors ligne).
- Sécurité côté appareil : un téléphone rooté peut lire le stockage local ; la protection est celle du PIN + chiffrement du téléphone.
