# BTA Manager — compléments d'architecture et critères de correction

## Statut de ce document

Cette archive reprend le projet multi-entreprises préparé par Claude comme **base de travail**. Le présent document ajoute les décisions fonctionnelles validées et les contrôles à implémenter avant toute mise en production. Il ne prétend pas que les fonctions décrites ci-dessous sont déjà toutes codées ou testées.

## Décisions validées

1. BTA Manager est multi-entreprises : chaque entreprise (`tenantId`) possède ses données isolées.
2. Une entreprise peut posséder plusieurs établissements (`branchId`).
3. Un employé peut être affecté à plusieurs établissements et avoir des permissions différentes dans chacun.
4. Le stock est strictement indépendant par établissement.
5. Une vente dans l'établissement A ne modifie que le stock de A.
6. Un transfert de stock entre établissements est une opération métier distincte, jamais une modification directe du stock global.
7. Les opérations sensibles sont validées côté Cloud Functions avec Admin SDK et transactions Firestore.
8. Le stockage local reste disponible hors connexion. Les opérations en attente ne sont considérées synchronisées qu'après confirmation serveur explicite.

## Modèle de stock obligatoire

Le catalogue du produit peut être partagé au niveau entreprise :

`tenants/{tenantId}/products/{productId}`

Le stock est conservé par établissement :

`tenants/{tenantId}/branches/{branchId}/stock/{productId}`

Chaque document de stock doit au minimum contenir `productId`, `quantity`, `minStock`, `updatedAt` et une version serveur. Le stock ne doit pas être déduit du document produit partagé.

### Vente

La fonction serveur de vente doit, dans une transaction atomique :

- vérifier l'identité Firebase et l'appartenance active au `tenantId` ;
- vérifier l'accès de l'utilisateur au `branchId` et la permission `sales.create` ;
- lire les produits partagés et les stocks du seul établissement ciblé ;
- recalculer les lignes, remises, total, montant payé et dette à partir des données fiables ;
- vérifier que chaque quantité vendue est positive et que le stock disponible suffit, sauf politique de stock négatif explicitement autorisée par l'entreprise et le rôle ;
- vérifier que les lignes de vente et les variations de stock correspondent exactement ;
- créer la vente, le mouvement de stock et l'éventuelle dette/paiement dans la même transaction ;
- dédupliquer à l'aide d'un `operationId` stable et unique ;
- refuser une opération rejouée avec un contenu différent sous le même identifiant.

Une vente ne doit jamais accepter une variation arbitraire envoyée séparément par le client. Le serveur doit dériver les deltas de stock des lignes de vente validées.

### Achat et autres mouvements

Les achats, retours, pertes, sorties gratuites et ajustements doivent également générer leurs mouvements de stock côté serveur, à partir d'une opération métier validée. Les deltas bruts envoyés par le client ne constituent pas une preuve suffisante.

## Transferts inter-établissements

Un transfert doit avoir un identifiant unique et un état explicite : `DRAFT`, `IN_TRANSIT`, `RECEIVED`, `CANCELLED`.

Données minimales : `transferId`, `tenantId`, `sourceBranchId`, `destinationBranchId`, lignes `{productId, quantity}`, auteur, dates, état, `operationId` et historique d'audit.

Règles :

1. Source et destination doivent appartenir au même tenant et être différentes.
2. L'utilisateur doit avoir `stock.transfer.create` ou la permission équivalente sur l'établissement source.
3. La validation du départ déduit les quantités du stock source dans une transaction atomique et crée le mouvement de sortie.
4. Tant que le transfert est `IN_TRANSIT`, le stock destination n'est pas augmenté.
5. La réception doit être confirmée par un utilisateur autorisé sur l'établissement destination. Elle crédite le stock destination et crée le mouvement d'entrée dans une transaction atomique.
6. Une réception ne peut être confirmée qu'une seule fois. Les répétitions renvoient le résultat initial sans doubler le stock.
7. Une annulation après départ doit être un mouvement compensatoire audité, jamais une suppression de l'historique.
8. Les transferts partiels, pertes en transit et écarts de réception doivent être explicitement traités avant activation en production.

## Isolation et autorisations

- Chaque lecture/écriture doit être bornée par `tenantId`.
- Les opérations de stock, ventes, achats, dépenses, dettes et transferts doivent aussi être bornées par `branchId`.
- Le propriétaire peut administrer tous les établissements de son tenant.
- Les autres membres ne voient que les établissements pour lesquels une affectation active et la permission de lecture correspondante existent.
- Les collections partagées (catalogue, clients, fournisseurs) doivent avoir une politique de lecture métier explicite ; l'appartenance simple au tenant ne doit pas automatiquement ouvrir toutes les données à tous les rôles si ce n'est pas voulu.
- Les écritures Firestore directes depuis le client restent interdites ; les Cloud Functions sont le point d'entrée des mutations sensibles.
- Ne jamais faire confiance à `tenantId`, `branchId`, rôle, permission, prix, total, solde ou delta transmis par le client sans vérification serveur.

## Synchronisation hors connexion et conflits

Chaque mutation locale doit être enregistrée dans une outbox persistante avec un `operationId`, type, tenant, établissement, date locale, payload et statut.

États recommandés : `PENDING`, `SENDING`, `APPLIED`, `DUPLICATE`, `REJECTED`, `CONFLICT`, `RETRY`.

- `APPLIED` et `DUPLICATE` sont acquittés par le serveur.
- `REJECTED` et `CONFLICT` doivent rester visibles à l'utilisateur et ne doivent pas être marqués comme synchronisés.
- Les erreurs réseau peuvent être réessayées avec le même `operationId`.
- Une opération rejetée ne doit pas être réessayée indéfiniment sans intervention.
- Les mises à jour de stock sont dérivées des opérations métier validées côté serveur, pas fusionnées comme de simples compteurs client.

## Tests d'acceptation obligatoires avant déploiement

### Isolation des stocks

- Vendre 5 unités dans la branche A diminue A de 5 et ne modifie pas B.
- Acheter 10 unités dans B augmente B de 10 et ne modifie pas A.
- Deux ventes concurrentes sur le dernier stock ne peuvent pas toutes deux réussir si le stock est insuffisant.
- Une vente avec produit inexistant, quantité nulle/négative, prix altéré ou total incohérent est rejetée.
- Une vente dont les stockDeltas ne correspondent pas aux lignes est rejetée ou les deltas client sont ignorés et recalculés côté serveur.

### Transferts

- Départ A vers B : A diminue, B ne change pas tant que la réception n'est pas confirmée.
- Réception B : B augmente exactement une fois.
- Répéter le même départ ou la même réception ne double jamais le mouvement.
- Un utilisateur sans accès à A ne peut pas initier le transfert ; un utilisateur sans accès à B ne peut pas le réceptionner.
- Un transfert entre deux tenants est toujours refusé.

### Multi-entreprises et synchronisation

- Un membre du tenant A ne lit ni ne modifie les données du tenant B.
- Un membre affecté à A mais pas à B ne lit ni ne modifie les données de B.
- Un rejet serveur reste visible dans l'interface et dans l'outbox.
- Une reconnexion réseau ne crée pas de doublon.
- La migration conserve quantités, seuils minimum, historiques, dettes et références locales.

## Garde-fous de déploiement

1. Ne pas ouvrir les règles Firestore avant les tests avec Firebase Emulator Suite.
2. Ne pas lancer `firebase deploy` automatiquement depuis une compilation Android.
3. Ne pas déployer les Cloud Functions sans vérifier le plan Firebase, la région, les secrets et les index.
4. Ne pas écraser le projet actif `~/bta` avec cette base avant comparaison et sauvegarde.
5. Conserver la même clé privée Android de signature et les mêmes secrets GitHub ; ne jamais les inclure dans une archive ou un commit.
6. Après chaque correction, exécuter lint, build web, tests des fonctions, tests des règles et tests d'intégration avant le build Android release.

## Point de départ technique

Le code de Claude contient déjà les modules multi-tenant, invitations, migration, synchronisation, règles Firestore et tests unitaires. Les éléments de ce document sont les exigences de durcissement à appliquer au code existant, en particulier à `functions/src/syncPlan.ts`, `functions/src/sync.ts`, `src/db/syncEngine.ts`, `src/db/migration.ts`, aux permissions et à l'interface de changement d'établissement.
