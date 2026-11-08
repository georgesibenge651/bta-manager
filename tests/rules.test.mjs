// Tests d'isolation des règles Firestore. Lancer : npm run test:rules (émulateur Firestore requis).
import { test, before, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, addDoc } from 'firebase/firestore';

let env;
const A = 'tenantA', B = 'tenantB', BR1 = 'br1', BR2 = 'br2';
const ALL = ['sales.read', 'sales.create', 'stock.read', 'stock.manage', 'purchases.read', 'debts.read', 'expenses.read'];

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-bta',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const t of [A, B]) {
      await setDoc(doc(db, `tenants/${t}`), { name: t });
      await setDoc(doc(db, `tenants/${t}/products/p1`), { name: 'Riz' });
      for (const br of [BR1, BR2]) {
        await setDoc(doc(db, `tenants/${t}/branches/${br}`), { name: br, active: true });
        await setDoc(doc(db, `tenants/${t}/branches/${br}/sales/s1`), { totalUSD: 10 });
        await setDoc(doc(db, `tenants/${t}/branches/${br}/purchases/pu1`), { totalUSD: 99 });
        await setDoc(doc(db, `tenants/${t}/branches/${br}/stock/p1`), { currentStock: 4 });
      }
      await setDoc(doc(db, `tenants/${t}/invitations/i1`), { email: 'x@y.z' });
      await setDoc(doc(db, `tenants/${t}/auditLogs/l1`), { action: 'X' });
    }
    const member = (t, uid, role, active = true) => setDoc(doc(db, `tenants/${t}/members/${uid}`), { role, active });
    const access = (t, uid, br, role, permissions) =>
      setDoc(doc(db, `tenants/${t}/members/${uid}/branchAccess/${br}`), { role, permissions });
    await member(A, 'ownerA', 'OWNER');
    await member(B, 'ownerB', 'OWNER');
    await member(A, 'cashA', 'CASHIER');
    await access(A, 'cashA', BR1, 'CASHIER', ['sales.read', 'sales.create', 'stock.read']);
    await member(A, 'mgrA', 'MANAGER');
    await access(A, 'mgrA', BR1, 'MANAGER', ALL);
    await access(A, 'mgrA', BR2, 'CASHIER', ['sales.read']);
    await member(A, 'gone', 'MANAGER', false);
    await access(A, 'gone', BR1, 'MANAGER', ALL);
    await setDoc(doc(db, `userMemberships/cashA/tenants/${A}`), { role: 'CASHIER', active: true });
  });
});
after(async () => { await env.cleanup(); });

const as = (uid) => (uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore());
const br = (t, b, c, id) => `tenants/${t}/branches/${b}/${c}/${id}`;

test('non connecté : tout refusé', async () => {
  await assertFails(getDoc(doc(as(null), `tenants/${A}`)));
  await assertFails(getDoc(doc(as(null), br(A, BR1, 'sales', 's1'))));
});

test('isolation entre entreprises : A ne lit rien de B, même en changeant l\'identifiant', async () => {
  for (const path of [`tenants/${B}`, `tenants/${B}/products/p1`, br(B, BR1, 'sales', 's1'), br(B, BR1, 'stock', 'p1')]) {
    await assertFails(getDoc(doc(as('ownerA'), path)));
    await assertFails(getDoc(doc(as('cashA'), path)));
  }
  await assertFails(getDocs(collection(as('ownerA'), `tenants/${B}/products`)));
});

test('propriétaire : lit tout son entreprise', async () => {
  await assertSucceeds(getDoc(doc(as('ownerA'), br(A, BR2, 'purchases', 'pu1'))));
  await assertSucceeds(getDoc(doc(as('ownerA'), `tenants/${A}/auditLogs/l1`)));
  await assertSucceeds(getDoc(doc(as('ownerA'), `tenants/${A}/invitations/i1`)));
});

test('caissier : seulement son établissement et ses permissions', async () => {
  await assertSucceeds(getDoc(doc(as('cashA'), br(A, BR1, 'sales', 's1'))));
  await assertSucceeds(getDoc(doc(as('cashA'), br(A, BR1, 'stock', 'p1'))));
  await assertFails(getDoc(doc(as('cashA'), br(A, BR1, 'purchases', 'pu1')))); // pas la permission
  await assertFails(getDoc(doc(as('cashA'), br(A, BR2, 'sales', 's1'))));       // autre établissement
  await assertFails(getDoc(doc(as('cashA'), `tenants/${A}/auditLogs/l1`)));
  await assertFails(getDoc(doc(as('cashA'), `tenants/${A}/invitations/i1`)));
});

test('permissions différentes selon l\'établissement', async () => {
  await assertSucceeds(getDoc(doc(as('mgrA'), br(A, BR1, 'purchases', 'pu1'))));
  await assertFails(getDoc(doc(as('mgrA'), br(A, BR2, 'purchases', 'pu1'))));
  await assertSucceeds(getDoc(doc(as('mgrA'), br(A, BR2, 'sales', 's1'))));
});

test('membre désactivé : plus aucun accès', async () => {
  await assertFails(getDoc(doc(as('gone'), br(A, BR1, 'sales', 's1'))));
  await assertFails(getDoc(doc(as('gone'), `tenants/${A}/products/p1`)));
});

test('adhésions : on ne lit que les siennes', async () => {
  await assertSucceeds(getDoc(doc(as('cashA'), `tenants/${A}/members/cashA`)));
  await assertFails(getDoc(doc(as('cashA'), `tenants/${A}/members/ownerA`)));
  await assertSucceeds(getDoc(doc(as('cashA'), `userMemberships/cashA/tenants/${A}`)));
  await assertFails(getDoc(doc(as('mgrA'), `userMemberships/cashA/tenants/${A}`)));
});

test('AUCUNE écriture depuis l\'application, même pour le propriétaire', async () => {
  const o = as('ownerA');
  await assertFails(setDoc(doc(o, `tenants/${A}/products/hack`), { name: 'x' }));
  await assertFails(updateDoc(doc(o, br(A, BR1, 'stock', 'p1')), { currentStock: 9999 }));
  await assertFails(deleteDoc(doc(o, br(A, BR1, 'sales', 's1'))));
  await assertFails(addDoc(collection(o, `tenants/${A}/auditLogs`), { action: 'forged' }));
  await assertFails(setDoc(doc(o, `tenants/${A}/members/cashA`), { role: 'OWNER', active: true }));
  await assertFails(setDoc(doc(o, `tenants/${A}/members/ownerA/branchAccess/br1`), { permissions: ['members.manage'] }));
  await assertFails(setDoc(doc(as('cashA'), br(A, BR1, 'sales', 'fake')), { totalUSD: 1 }));
  await assertFails(setDoc(doc(as('cashA'), `userMemberships/cashA/tenants/${B}`), { role: 'OWNER', active: true }));
});

test('journal des opérations et demandes de création inaccessibles', async () => {
  await assertFails(getDoc(doc(as('ownerA'), br(A, BR1, 'operations', 'x'))));
  await assertFails(getDoc(doc(as('ownerA'), 'creationRequests/ownerA_x')));
});
