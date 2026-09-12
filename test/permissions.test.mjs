// Test suite for role-based permissions system
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPermission, hasAllPermissions, hasAnyPermission, ROLE_PERMISSIONS } from './permissions-new.js';
import { hasRoleLevel, getRoleLabel } from './api/permissions-rbac.js';

test('Permission system', async (t) => {
  await t.test('hasPermission checks individual permissions', () => {
    // Viewer permissions
    assert.ok(hasPermission('viewer', 'bot.read'));
    assert.ok(hasPermission('viewer', 'logs.read'));
    assert.ok(!hasPermission('viewer', 'bot.control'));

    // Admin inherits viewer permissions + adds bot.control
    assert.ok(hasPermission('admin', 'bot.read'));
    assert.ok(hasPermission('admin', 'bot.control'));
    assert.ok(!hasPermission('admin', 'moderation.delete'));

    // Co-Owner has moderation.delete
    assert.ok(hasPermission('co_owner', 'moderation.delete'));
    assert.ok(hasPermission('co_owner', 'adminwhitelist.manage'));

    // Owner has everything
    assert.ok(hasPermission('owner', '*'));
    assert.ok(hasPermission('owner', 'any.permission'));
  });

  await t.test('hasAllPermissions checks AND logic', () => {
    // Admin has both
    assert.ok(hasAllPermissions('admin', ['bot.read', 'bot.control']));
    // Admin lacks moderation.delete
    assert.ok(!hasAllPermissions('admin', ['bot.control', 'moderation.delete']));
    // Co-owner has both
    assert.ok(hasAllPermissions('co_owner', ['moderation.delete', 'adminwhitelist.manage']));
  });

  await t.test('hasAnyPermission checks OR logic', () => {
    // Admin has at least bot.read
    assert.ok(hasAnyPermission('admin', ['moderation.delete', 'bot.read']));
    // Admin lacks both
    assert.ok(!hasAnyPermission('admin', ['moderation.delete', 'users.manage']));
  });

  await t.test('Role hierarchy with hasRoleLevel', () => {
    // viewer < admin < co_owner < owner
    assert.ok(hasRoleLevel('admin', 'viewer'));
    assert.ok(hasRoleLevel('co_owner', 'admin'));
    assert.ok(hasRoleLevel('owner', 'co_owner'));
    // But not the other way
    assert.ok(!hasRoleLevel('viewer', 'admin'));
    assert.ok(!hasRoleLevel('admin', 'co_owner'));
  });

  await t.test('getRoleLabel returns correct labels', () => {
    assert.ok(getRoleLabel('viewer').includes('Betrachter'));
    assert.ok(getRoleLabel('admin').includes('Admin'));
    assert.ok(getRoleLabel('co_owner').includes('Co-Owner'));
    assert.ok(getRoleLabel('owner').includes('Owner'));
  });

  await t.test('Role permissions structure is complete', () => {
    const validRoles = ['viewer', 'admin', 'co_owner', 'owner'];
    for (const role of validRoles) {
      assert.ok(ROLE_PERMISSIONS[role], `Missing permissions for role: ${role}`);
      assert.ok(Array.isArray(ROLE_PERMISSIONS[role]), `Permissions for ${role} must be an array`);
    }
  });

  await t.test('Admin permissions include all viewer permissions', () => {
    const viewerPerms = ROLE_PERMISSIONS.viewer;
    const adminPerms = ROLE_PERMISSIONS.admin;
    for (const perm of viewerPerms) {
      assert.ok(adminPerms.includes(perm), `Admin missing viewer permission: ${perm}`);
    }
  });

  await t.test('Co-owner permissions include all admin permissions', () => {
    const adminPerms = ROLE_PERMISSIONS.admin;
    const coOwnerPerms = ROLE_PERMISSIONS.co_owner;
    for (const perm of adminPerms) {
      assert.ok(coOwnerPerms.includes(perm), `Co-owner missing admin permission: ${perm}`);
    }
  });
});
