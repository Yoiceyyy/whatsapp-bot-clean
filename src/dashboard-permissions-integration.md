// Integration of role-based permissions into existing dashboard.js
// Replaces old auth system with new API user + permission middleware
// Add these imports to dashboard.js:

import { requireDashboardAuth, handleDashboardLogin, handleDashboardLogout, optionalDashboardAuth } from './dashboard-auth.js';
import { requirePermission, requireAnyPermission } from './api/permissions-rbac.js';
import { canExecuteModeration, logModerationAction, getModerationAudit, isOnAdminWhitelist, addToAdminWhitelist, removeFromAdminWhitelist, suspendAdmin, unsuspendAdmin } from './permissions-new.js';

// Replace old login handler (lines 247-268):
app.post('/login', (req, res) => {
  return handleDashboardLogin(req, res);
});

// Replace old logout handler (lines 270-275):
app.post('/logout', requireDashboardAuth, (req, res) => {
  return handleDashboardLogout(req, res);
});

// OLD PATTERN (lines 158-164):
// function requireAuth(req, res, next) {
//   if (readSession(req)) return next();
//   if ((req.originalUrl || req.path).startsWith('/api/')) {
//     return res.status(401).json({ error: 'nicht angemeldet' });
//   }
//   return res.redirect('/login');
// }

// NEW PATTERN:
// Use middleware directly on routes:
// app.get('/api/moderation', requireDashboardAuth, requirePermission('moderation.read'), async (req, res) => {
//   ...
// });

// EXAMPLE INTEGRATION for existing endpoints:

// OLD (dashboard.js line 358-366):
// api.get('/groups', async (req, res) => {
//   try {
//     const groups = await listGroups();
//     res.json({ groups });
//   } catch (err) { ... }
// });

// NEW with permissions:
// api.get('/groups',
//   requirePermission('groups.read'),
//   async (req, res) => {
//     try {
//       const groups = await listGroups();
//       res.json({ groups });
//     } catch (err) { ... }
//   }
// );

// Add to dashboard.js after other API endpoints:

export function setupPermissionedEndpoints(api) {
  // ── Admin Whitelist Management (Co-Owner+) ──────────────────────────

  api.get('/admin/whitelist',
    requirePermission('adminwhitelist.manage'),
    async (req, res) => {
      try {
        const rows = await dbRows(
          'SELECT user_jid, added_by, added_at, reason FROM admin_whitelist ORDER BY added_at DESC LIMIT 100',
          []
        );
        const ids = await resolveIdentities(rows.map((r) => r.user_jid));
        res.json({
          whitelist: rows.map((r) => ({
            ...r,
            user: ids.get(String(r.user_jid)) || null,
          })),
        });
      } catch (err) {
        logError(err, 'panel.whitelist');
        res.status(500).json({ error: 'Failed to load whitelist' });
      }
    }
  );

  api.post('/admin/whitelist/add',
    requirePermission('adminwhitelist.manage'),
    async (req, res) => {
      const { userJid, reason } = req.body || {};
      if (!userJid) return res.status(400).json({ error: 'User JID required' });

      try {
        const added = await addToAdminWhitelist(userJid, req.user.userId, reason || '');
        if (!added) return res.status(400).json({ error: 'Invalid user JID' });

        await logModerationAction('whitelist.add', req.user.userId, userJid, null, reason);
        res.json({ ok: true });
      } catch (err) {
        logError(err, 'panel.whitelist.add');
        res.status(500).json({ error: 'Failed to add to whitelist' });
      }
    }
  );

  api.post('/admin/whitelist/remove',
    requirePermission('adminwhitelist.manage'),
    async (req, res) => {
      const { userJid } = req.body || {};
      if (!userJid) return res.status(400).json({ error: 'User JID required' });

      try {
        const removed = await removeFromAdminWhitelist(userJid);
        if (!removed) return res.status(400).json({ error: 'Invalid user JID' });

        await logModerationAction('whitelist.remove', req.user.userId, userJid, null, '');
        res.json({ ok: true });
      } catch (err) {
        logError(err, 'panel.whitelist.remove');
        res.status(500).json({ error: 'Failed to remove from whitelist' });
      }
    }
  );

  // ── Admin Suspensions (Co-Owner+) ──────────────────────────────────

  api.get('/admin/suspensions',
    requirePermission('admin.suspend'),
    async (req, res) => {
      try {
        const rows = await dbRows(
          'SELECT user_jid, suspended_by, suspended_at, until, reason, active FROM admin_suspensions WHERE active = 1 ORDER BY until DESC LIMIT 50',
          []
        );
        const ids = await resolveIdentities(rows.map((r) => r.user_jid));
        res.json({
          suspensions: rows.map((r) => ({
            ...r,
            user: ids.get(String(r.user_jid)) || null,
            isExpired: Number(r.until) < Date.now(),
          })),
        });
      } catch (err) {
        logError(err, 'panel.suspensions');
        res.status(500).json({ error: 'Failed to load suspensions' });
      }
    }
  );

  api.post('/admin/suspensions/create',
    requirePermission('admin.suspend'),
    async (req, res) => {
      const { userJid, durationMinutes, reason } = req.body || {};
      if (!userJid || !durationMinutes || durationMinutes <= 0) {
        return res.status(400).json({ error: 'User JID and valid duration required' });
      }

      try {
        const durationMs = durationMinutes * 60_000;
        const suspended = await suspendAdmin(userJid, durationMs, req.user.userId, reason || '');
        if (!suspended) return res.status(400).json({ error: 'Invalid user JID' });

        await logModerationAction('admin.suspend', req.user.userId, userJid, null, `${durationMinutes} min: ${reason}`);
        res.json({ ok: true });
      } catch (err) {
        logError(err, 'panel.suspend.create');
        res.status(500).json({ error: 'Failed to suspend admin' });
      }
    }
  );

  api.post('/admin/suspensions/revoke',
    requirePermission('admin.suspend'),
    async (req, res) => {
      const { userJid } = req.body || {};
      if (!userJid) return res.status(400).json({ error: 'User JID required' });

      try {
        const revoked = await unsuspendAdmin(userJid);
        if (!revoked) return res.status(400).json({ error: 'Invalid user JID' });

        await logModerationAction('admin.unsuspend', req.user.userId, userJid, null, '');
        res.json({ ok: true });
      } catch (err) {
        logError(err, 'panel.suspend.revoke');
        res.status(500).json({ error: 'Failed to revoke suspension' });
      }
    }
  );

  // ── Moderation Audit Log (Admin+) ──────────────────────────────────

  api.get('/admin/audit',
    requirePermission('moderation.read'),
    async (req, res) => {
      try {
        const actor = req.query.actor;
        const target = req.query.target;
        const groupJid = req.query.groupJid;
        const action = req.query.action;
        const limitDays = Math.min(365, parseInt(req.query.limitDays || 30, 10));

        const audit = await getModerationAudit({
          actor: actor || undefined,
          target: target || undefined,
          groupJid: groupJid || undefined,
          action: action || undefined,
          limitDays,
          limit: 200,
        });

        // Resolve identities for display
        const allIds = [
          ...audit.map((a) => a.actor),
          ...audit.map((a) => a.target),
        ].filter(Boolean);
        const ids = await resolveIdentities(allIds);

        res.json({
          audit: audit.map((a) => ({
            ...a,
            actorUser: ids.get(String(a.actor)) || null,
            targetUser: ids.get(String(a.target)) || null,
          })),
        });
      } catch (err) {
        logError(err, 'panel.audit');
        res.status(500).json({ error: 'Failed to load audit log' });
      }
    }
  );

  // ── API User Management (Owner only) ─────────────────────────────────────

  api.get('/users/list',
    requirePermission('users.manage'),
    async (req, res) => {
      try {
        const users = await listApiUsers();
        res.json({ users });
      } catch (err) {
        logError(err, 'panel.users.list');
        res.status(500).json({ error: 'Failed to load users' });
      }
    }
  );

  api.post('/users/create',
    requirePermission('users.manage'),
    async (req, res) => {
      const { username, password, role } = req.body || {};
      if (!username || !password || !role) {
        return res.status(400).json({ error: 'Username, password, and role required' });
      }

      try {
        const result = await createApiUser(username, password, role);
        if (result.error) {
          return res.status(400).json({ error: result.error });
        }
        await logModerationAction('user.create', req.user.userId, result.id, null, role);
        res.json({ ok: true, user: result });
      } catch (err) {
        logError(err, 'panel.users.create');
        res.status(500).json({ error: 'Failed to create user' });
      }
    }
  );

  api.post('/users/:userId/role',
    requirePermission('users.manage'),
    async (req, res) => {
      const { role } = req.body || {};
      if (!role) return res.status(400).json({ error: 'Role required' });

      try {
        const changed = await changeApiUserRole(req.params.userId, role);
        if (!changed) return res.status(400).json({ error: 'Invalid user or role' });

        await logModerationAction('user.role_change', req.user.userId, req.params.userId, null, role);
        res.json({ ok: true });
      } catch (err) {
        logError(err, 'panel.users.role');
        res.status(500).json({ error: 'Failed to change role' });
      }
    }
  );

  api.post('/users/:userId/disable',
    requirePermission('users.manage'),
    async (req, res) => {
      try {
        const disabled = await disableApiUser(req.params.userId);
        if (!disabled) return res.status(400).json({ error: 'Invalid user' });

        await logModerationAction('user.disable', req.user.userId, req.params.userId, null, '');
        res.json({ ok: true });
      } catch (err) {
        logError(err, 'panel.users.disable');
        res.status(500).json({ error: 'Failed to disable user' });
      }
    }
  );

  api.post('/users/:userId/enable',
    requirePermission('users.manage'),
    async (req, res) => {
      try {
        const enabled = await enableApiUser(req.params.userId);
        if (!enabled) return res.status(400).json({ error: 'Invalid user' });

        await logModerationAction('user.enable', req.user.userId, req.params.userId, null, '');
        res.json({ ok: true });
      } catch (err) {
        logError(err, 'panel.users.enable');
        res.status(500).json({ error: 'Failed to enable user' });
      }
    }
  );
}
