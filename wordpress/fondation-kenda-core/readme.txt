Fondation Kenda Core 0.5.33
Extension additive du contrat REST BTA Manager.

Ajouts de cette version :
- Vérification de permissions effectives par affectation d'agence pour les routes métier, les transferts entre deux agences, les opérations de synchronisation et les lectures branchées.
- Nouveau GET /tenants/{tenant_id}/branches/{branch_id}/permissions/me.
- Synchronisation idempotente pour créations et mises à jour de catégories, produits, clients et fournisseurs; stock initial produit atomique.
- Le catalogue, les ventes, achats, dettes, dépenses, caisses, transferts, pré-enregistrements et rapports filtrent les listes par branch_id lorsqu'ils sont branchés.
- Les ventes renvoient l'ID de dette client créée dans la même transaction.
- Le plugin conserve la séparation des tables noyau (bta_ sans préfixe WordPress) et tables commerciales (préfixe WordPress + bta_).

Le plugin ne supprime ni ne renomme de table. Aucun SQL n'a été exécuté sur la production. L'installation WordPress peut exécuter dbDelta lors de l'activation/mise à niveau; sauvegarder et valider sur une copie avant mise en service.

Limites connues : l'ensemble des workflows BTA (réservations client, avances, livraisons, dommages/pertes, sorties gratuites, dettes fournisseurs, réglages et CRUD complets) n'est pas encore couvert par ce contrat. Les remboursements et la caisse des paiements fournisseurs doivent encore être alignés avec les agrégats BTA.

Correctifs 0.5.33 : contexte tenant et IDs parents des sous-requêtes sync, UUID dans les accusés persistés et rejoués, validation de la branche réelle des actions liées à un parent. Aucun changement de schéma.
