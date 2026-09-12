// Phase 5: Integration der neuen Auth + Permissions in dashboard.js
// Diese Datei zeigt die konkreten Änderungen, die in dashboard.js vorzunehmen sind.

// ==================== IMPORTS HINZUFÜGEN (oben in dashboard.js) ====================

// NEUE IMPORTS:
import { requireDashboardAuth, handleDashboardLogin, handleDashboardLogout } from './dashboard-auth.js';
import { requirePermission, requireAnyPermission } from './api/permissions-rbac.js';
import { 
  canExecuteModeration, 
  logModerationAction, 
  getModerationAudit,
  isOnAdminWhitelist,
  addToAdminWhitelist,
  removeFromAdminWhitelist,
  suspendAdmin,
  unsuspendAdmin,
} from './permissions-new.js';
import { 
  createApiUser, 
  listApiUsers, 
  changeApiUserRole, 
  disableApiUser, 
  enableApiUser 
} from './api/auth.js';

// ==================== OLD AUTH REMOVAL (Zeilen 104-164) ====================

// ENTFERNEN:
// - const sessions = new Map(); // Zeile 106
// - const loginFails = new Map(); // Zeile 107
// - const sha256 = (...) // Zeile 109
// - function passwordOk(...) // Zeilen 111-115
// - function clientIp(...) // Zeilen 117-134
// - function issueSession(...) // Zeilen 136-144
// - function readSession(...) // Zeilen 146-156
// - function requireAuth(...) // Zeilen 158-164

// ERSETZEN DURCH:
// (Alle sind jetzt in dashboard-auth.js)

// ==================== LOGIN ROUTE ÄNDERN (Zeile 242-268) ====================

// OLD:
// app.get('/login', (req, res) => {
//   if (readSession(req)) return res.redirect('/');
//   sendAsset(req, res, 'login', 'no-store');
// });
// 
// app.post('/login', loginLimiter, (req, res) => {
//   const ip = clientIp(req);
//   const entry = loginFails.get(ip) || { count: 0, lockedUntil: 0 };
//   if (entry.lockedUntil > Date.now()) {
//     const mins = Math.ceil((entry.lockedUntil - Date.now()) / 60_000);
//     return res.status(429).json({ error: `...` });
//   }
//   const pw = String(req.body?.password || '');
//   if (pw && passwordOk(pw)) {
//     loginFails.delete(ip);
//     issueSession(res);
//     return res.json({ ok: true });
//   }
//   ...
// });

// NEW:
app.get('/login', (req, res) => {
  const token = extractSessionToken(req.headers.cookie);
  if (token && validateSession(token)) return res.redirect('/');
  sendAsset(req, res, 'login', 'no-store');
});

app.post('/login', async (req, res) => {
  return handleDashboardLogin(req, res);
});

// ==================== LOGOUT ROUTE ÄNDERN (Zeile 270-275) ====================

// OLD:
// app.post('/logout', requireAuth, (req, res) => {
//   const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
//   if (m) sessions.delete(m[1]);
//   res.setHeader('Set-Cookie', 'sid=; Max-Age=0; ...');
//   res.json({ ok: true });
// });

// NEW:
app.post('/logout', requireDashboardAuth, (req, res) => {
  return handleDashboardLogout(req, res);
});

// ==================== API ROUTER AUTHENTICATION (Zeile 285-286) ====================

// OLD:
// const api = asyncSafe(express.Router());
// app.use('/api', requireAuth, api);

// NEW:
const api = asyncSafe(express.Router());
app.use('/api', requireDashboardAuth, api);

// ==================== PANEL-ROUTES (Zeile 278-282) ====================
// Bleiben gleich, sind ja hinter requireDashboardAuth

// ==================== BEISPIEL: PERMISSIONS AUF EXISTIERENDEN ENDPUNKTEN ====================

// ALTER CODE (Zeile 358-366):
// api.get('/groups', async (req, res) => {
//   try {
//     const groups = await listGroups();
//     res.json({ groups });
//   } catch (err) {
//     logError(err, 'panel.groups');
//     res.status(500).json({ error: 'Gruppen konnten nicht geladen werden.' });
//   }
// });

// NEUER CODE:
api.get('/groups',
  requirePermission('groups.read'),
  async (req, res) => {
    try {
      const groups = await listGroups();
      res.json({ groups });
    } catch (err) {
      logError(err, 'panel.groups');
      res.status(500).json({ error: 'Gruppen konnten nicht geladen werden.' });
    }
  }
);

// ==================== NEUE ADMIN-ENDPUNKTE (nach anderen API-Routen) ====================

// Admin-Whitelist Management (co_owner+)
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

// Admin-Suspensions (co_owner+)
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

// Moderation Audit Log (admin+)
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

// API-Benutzerverwaltung (owner only)
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

// ==================== ANDERE BESTEHENDE ENDPUNKTE ====================
// Einfach `requirePermission()` vor dem async hinzufügen:

// Beispiel: /api/commands
api.get('/commands',
  requirePermission('commands.manage'),
  (req, res) => {
    // ...
  }
);

// Beispiel: /api/groups/:jid/settings
api.post('/groups/:jid/settings',
  requirePermission('group.modify'),
  async (req, res) => {
    // ...
  }
);

// Beispiel: /api/groups/:jid/send
api.post('/groups/:jid/send',
  requirePermission('bot.control'),
  async (req, res) => {
    // ...
  }
);
