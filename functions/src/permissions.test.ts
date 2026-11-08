import test from "node:test";
import assert from "node:assert/strict";
import {canGrantRole, resolvePermissions, ROLE_DEFAULTS, Permission} from "./permissions";

const set = (p: Permission[]) => new Set(p);

test("hiérarchie des rôles", () => {
  assert.equal(canGrantRole("OWNER", "ADMIN"), true);
  assert.equal(canGrantRole("ADMIN", "ADMIN"), false);
  assert.equal(canGrantRole("ADMIN", "OWNER"), false);
  assert.equal(canGrantRole("MANAGER", "CASHIER"), true);
  assert.equal(canGrantRole("CASHIER", "CASHIER"), false);
});

test("anti-escalade : on n'accorde pas ce qu'on n'a pas", () => {
  const granter = set(["sales.read", "members.manage"]);
  const r = resolvePermissions("MANAGER", ["sales.read", "stock.manage", "reports.read"], granter);
  assert.deepEqual(r, ["sales.read"]);
});

test("plafond du rôle : un caissier n'obtient jamais stock.manage", () => {
  const r = resolvePermissions("CASHIER", ["sales.create", "stock.manage"], set(ROLE_DEFAULTS.OWNER));
  assert.deepEqual(r, ["sales.create"]);
});

test("members.manage réservé au rôle ADMIN", () => {
  const owner = set(ROLE_DEFAULTS.OWNER);
  assert.ok(!resolvePermissions("MANAGER", ["members.manage"], owner).includes("members.manage"));
  assert.ok(resolvePermissions("ADMIN", undefined, owner).includes("members.manage"));
});
