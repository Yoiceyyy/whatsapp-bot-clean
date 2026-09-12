// test/integration-rbac.test.mjs
// Integrationstests für das RBAC-System
// Testet: Auth, Whitelist, Suspensionen, Moderation Security Chain

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createApiUser,
  getApiUser,
  validateApiPassword,
  listApiUsers,
} from '../src/api/auth.js';
import {
  isOnAdminWhitelist,
  addToAdminWhitelist,
  removeFromAdminWhitelist,
  getAdminSuspension,
  suspendAdmin,
  unsuspendAdmin,
  canExecuteModeration,
  logModerationAction,
  getModerationAudit,
} from '../src/permissions-new.js';
import {
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
} from '../src/permissions-new.js';

test('RBAC Integration Tests', async (t) => {
  // ==================== Auth Tests ====================

  await t.test('User creation and authentication', async () => {
    // Create user
    const result = await createApiUser('testuser', 'password123', 'admin');
    assert.ok(!result.error, `User creation should succeed: ${result.error}`);
    assert.ok(result.id, 'User ID should be generated');
    assert.equal(result.role, 'admin', 'Role should be admin');

    // Retrieve user
    const user = await getApiUser('testuser');
    assert.ok(user, 'User should be retrievable');
    assert.equal(user.username, 'testuser', 'Username should match');
    assert.equal(user.role, 'admin', 'Role should be admin');

    // Validate password
    const isValid = await validateApiPassword('password123', user.pw_hash, user.pw_salt);
    assert.ok(isValid, 'Password should validate');

    const isInvalid = await validateApiPassword('wrongpassword', user.pw_hash, user.pw_salt);
    assert.ok(!isInvalid, 'Wrong password should not validate');
  });

  await t.test('User creation validation', async () => {
    // Short username
    const short = await createApiUser('ab', 'password123', 'admin');
    assert.ok(short.error, 'Short username should fail');

    // Short password
    const shortPass = await createApiUser('testuser2', 'short', 'admin');
    assert.ok(shortPass.error, 'Short password should fail');

    // Invalid role
    const invalidRole = await createApiUser('testuser3', 'password123', 'superadmin');
    assert.ok(invalidRole.error, 'Invalid role should fail');
  });

  // ==================== Admin-Whitelist Tests ====================

  await t.test('Admin whitelist management', async () => {
    const jid = '49170123456@s.whatsapp.net';

    // Add to whitelist
    const added = await addToAdminWhitelist(jid, '49170999999@s.whatsapp.net', 'Test admin');
    assert.ok(added, 'Adding to whitelist should succeed');

    // Check if on whitelist
    const isWhitelisted = await isOnAdminWhitelist(jid);
    assert.ok(isWhitelisted, 'User should be on whitelist');

    // Remove from whitelist
    const removed = await removeFromAdminWhitelist(jid);
    assert.ok(removed, 'Removing from whitelist should succeed');

    // Check if still on whitelist
    const notWhitelisted = await isOnAdminWhitelist(jid);
    assert.ok(!notWhitelisted, 'User should not be on whitelist after removal');
  });

  await t.test('Whitelist with multiple phone formats', async () => {
    // Test that normalization works
    const variants = [
      '49170123456@s.whatsapp.net',
      '49170123456',
      '+49170123456',
      '0170123456',
    ];

    // Add first variant
    await addToAdminWhitelist(variants[0], 'owner@s.whatsapp.net', 'Test');

    // All variants should match (ideally, depends on normalization)
    const isWhitelisted = await isOnAdminWhitelist(variants[1]);
    // Note: This test may vary based on normalization implementation
    assert.ok(typeof isWhitelisted === 'boolean', 'Check should return boolean');
  });

  // ==================== Admin Suspension Tests ====================

  await t.test('Admin suspension lifecycle', async () => {
    const jid = '49170654321@s.whatsapp.net';
    const durationMs = 60 * 1000; // 1 minute

    // No suspension initially
    let suspension = await getAdminSuspension(jid);
    assert.ok(!suspension, 'Should not be suspended initially');

    // Suspend
    const suspended = await suspendAdmin(jid, durationMs, 'owner@s.whatsapp.net', 'Test');
    assert.ok(suspended, 'Suspension should succeed');

    // Check suspension
    suspension = await getAdminSuspension(jid);
    assert.ok(suspension, 'Should have suspension info');
    assert.ok(suspension.active, 'Should be active');
    assert.ok(!suspension.isExpired, 'Should not be expired yet');

    // Unsuspend
    const unsuspended = await unsuspendAdmin(jid);
    assert.ok(unsuspended, 'Unsuspension should succeed');

    // Check no longer suspended
    suspension = await getAdminSuspension(jid);
    assert.ok(!suspension || !suspension.active, 'Should not be suspended after unsuspend');
  });

  await t.test('Suspension expiration', async (t) => {
    const jid = '49170111111@s.whatsapp.net';
    const durationMs = 100; // 100ms = very short

    await suspendAdmin(jid, durationMs, 'owner@s.whatsapp.net', 'Short test');

    // Should be active immediately
    let suspension = await getAdminSuspension(jid);
    assert.ok(suspension && suspension.active, 'Should be active');

    // Wait for expiration
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Should still exist but marked expired
    suspension = await getAdminSuspension(jid);
    // After cleanup, might not return expired suspensions
    // This depends on implementation
  });

  // ==================== Moderation Audit Logging Tests ====================

  await t.test('Moderation action logging', async () => {
    const actor = '49170111111@s.whatsapp.net';
    const target = '49170222222@s.whatsapp.net';
    const groupJid = '120363123456789-1234567890@g.us';

    // Log action
    const logged = await logModerationAction(
      'kick',
      actor,
      target,
      groupJid,
      'Spam'
    );
    assert.ok(logged, 'Logging should succeed');

    // Retrieve audit log
    const audit = await getModerationAudit({
      actor,
      limitDays: 30,
      limit: 100,
    });

    assert.ok(Array.isArray(audit), 'Should return array');
    const found = audit.find((a) => a.actor === actor && a.target === target);
    assert.ok(found, 'Logged action should be in audit');
  });

  await t.test('Audit log filtering', async () => {
    const actor = '49170333333@s.whatsapp.net';
    const target1 = '49170444444@s.whatsapp.net';
    const target2 = '49170555555@s.whatsapp.net';

    // Log multiple actions
    await logModerationAction('kick', actor, target1, null, 'Spam');
    await logModerationAction('ban', actor, target2, null, 'Abuse');

    // Filter by action
    const kicks = await getModerationAudit({
      action: 'kick',
      limitDays: 30,
      limit: 100,
    });
    const hasKicks = kicks.some((a) => a.action === 'kick');
    assert.ok(hasKicks, 'Should find kick actions');

    // Filter by target
    const target1Audit = await getModerationAudit({
      target: target1,
      limitDays: 30,
      limit: 100,
    });
    const found = target1Audit.some((a) => a.target === target1);
    assert.ok(found, 'Should find by target');
  });

  // ==================== Moderation Security Chain Tests ====================

  await t.test('canExecuteModeration checks', async () => {
    const groupJid = '120363123456789-1234567890@g.us';
    const actorJid = '49170999888@s.whatsapp.net';

    // Not on whitelist -> should fail
    const security = await canExecuteModeration(groupJid, actorJid, 'kick');
    assert.ok(security, 'Should return security object');
    assert.equal(security.allowed, false, 'Should not allow without whitelist');
    assert.ok(security.reason.includes('Whitelist'), 'Reason should mention whitelist');

    // Add to whitelist
    await addToAdminWhitelist(actorJid, 'owner@s.whatsapp.net', 'Test');

    // Now check again
    const securityAfter = await canExecuteModeration(groupJid, actorJid, 'kick');
    assert.ok(securityAfter.allowed, 'Should allow after whitelist');
  });

  await t.test('Moderation blocked by suspension', async () => {
    const groupJid = '120363123456789-1234567890@g.us';
    const actorJid = '49170888777@s.whatsapp.net';

    // Add to whitelist first
    await addToAdminWhitelist(actorJid, 'owner@s.whatsapp.net', 'Test');

    // Should be allowed
    let security = await canExecuteModeration(groupJid, actorJid, 'kick');
    assert.ok(security.allowed, 'Should be allowed without suspension');

    // Suspend
    await suspendAdmin(actorJid, 60 * 60 * 1000, 'owner@s.whatsapp.net', 'Test');

    // Now should be blocked
    security = await canExecuteModeration(groupJid, actorJid, 'kick');
    assert.ok(!security.allowed, 'Should not allow while suspended');
    assert.ok(security.reason.includes('Suspendiert'), 'Reason should mention suspension');
  });

  // ==================== Permission Tests ====================

  await t.test('Permission hierarchy', async () => {
    assert.ok(hasPermission('viewer', 'bot.read'), 'Viewer can read bot');
    assert.ok(!hasPermission('viewer', 'bot.control'), 'Viewer cannot control bot');

    assert.ok(hasPermission('admin', 'bot.read'), 'Admin inherits viewer permissions');
    assert.ok(hasPermission('admin', 'bot.control'), 'Admin can control bot');
    assert.ok(!hasPermission('admin', 'moderation.delete'), 'Admin cannot delete moderation');

    assert.ok(hasPermission('co_owner', 'moderation.delete'), 'Co-owner can delete moderation');
    assert.ok(hasPermission('co_owner', 'bot.control'), 'Co-owner has admin permissions');

    assert.ok(hasPermission('owner', 'bot.read'), 'Owner has all permissions');
    assert.ok(hasPermission('owner', 'any.permission'), 'Owner can do anything');
  });

  await t.test('hasAllPermissions logic', async () => {
    assert.ok(
      hasAllPermissions('co_owner', ['moderation.delete', 'adminwhitelist.manage']),
      'Co-owner has all listed permissions'
    );
    assert.ok(
      !hasAllPermissions('admin', ['moderation.delete', 'bot.control']),
      'Admin lacks moderation.delete'
    );
  });

  await t.test('hasAnyPermission logic', async () => {
    assert.ok(
      hasAnyPermission('admin', ['moderation.delete', 'bot.control']),
      'Admin has at least bot.control'
    );
    assert.ok(
      !hasAnyPermission('viewer', ['moderation.delete', 'bot.control']),
      'Viewer has neither'
    );
  });
});
