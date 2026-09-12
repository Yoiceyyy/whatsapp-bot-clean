// Erweiterte Permissions-Engine für Role-Based Access Control (RBAC)
// Nutzt die bestehende permissions.js Basis und erweitert sie um:
// - Dashboard-Rollen (viewer, admin, co_owner, owner)
// - Admin-Whitelist
// - Admin-Suspensionen
// - Granulare Berechtigungen

import { dbRows, dbRun } from './db.js';
import { normalizeId, resolveLid } from './permissions.js';
import { logError } from './logger.js';

// ── Dashboard-Rollen und Berechtigungen ─────────────────────────────

export const DASHBOARD_ROLE = {
  VIEWER: 'viewer',
  ADMIN: 'admin',
  CO_OWNER: 'co_owner',
  OWNER: 'owner',
};

/**
 * Granulare Berechtigungen je Rolle.
 * Rollen erben von niedrigeren (VIEWER < ADMIN < CO_OWNER < OWNER).
 */
export const ROLE_PERMISSIONS = {
  viewer: [
    'bot.read',
    'logs.read',
    'groups.read',
    'settings.read',
    'stats.read',
    'moderation.read',
  ],
  admin: [
    'bot.read',
    'logs.read',
    'groups.read',
    'settings.read',
    'stats.read',
    'moderation.read',
    'bot.control',           // normale Bot-Befehle
    'group.modify',          // Gruppen-Einstellungen ändern
    'commands.manage',       // Befehle an/aus
    'custom.manage',         // Custom Commands
  ],
  co_owner: [
    ...['bot.read', 'logs.read', 'groups.read', 'settings.read', 'stats.read', 'moderation.read', 'bot.control', 'group.modify', 'commands.manage', 'custom.manage'],
    'moderation.delete',     // Verwarnungen/Mutes/Bans löschen
    'adminwhitelist.manage', // Admin-Whitelist ändern
    'users.manage',          // Benutzer verwalten
    'bot.relink',            // QR-Code zurücksetzen
    'punishments.reset',     // Verwarnungen zurücksetzen
    'admin.suspend',         // Admins suspendieren
  ],
  owner: ['*'], // Alle Berechtigungen
};

/**
 * Prüft, ob eine Rolle eine bestimmte Permission hat.
 * @param {string} role - Die Rolle (viewer|admin|co_owner|owner)
 * @param {string} permission - Die geforderte Permission
 * @returns {boolean}
 */
export function hasPermission(role, permission) {
  if (!role || !ROLE_PERMISSIONS[role]) return false;
  const perms = ROLE_PERMISSIONS[role];
  if (perms.includes('*')) return true;
  return perms.includes(permission);
}

/**
 * Prüft mehrere Permissions (AND-Logik).
 * @param {string} role
 * @param {string[]} permissions
 * @returns {boolean}
 */
export function hasAllPermissions(role, permissions) {
  return permissions.every((perm) => hasPermission(role, perm));
}

/**
 * Prüft mehrere Permissions (OR-Logik).
 * @param {string} role
 * @param {string[]} permissions
 * @returns {boolean}
 */
export function hasAnyPermission(role, permissions) {
  return permissions.some((perm) => hasPermission(role, perm));
}

// ── Admin-Whitelist ────────────────────────────────────────────────

/**
 * Prüft, ob eine Person auf der Admin-Whitelist steht.
 * Normalisiert die JID/Nummer automatisch gegen LID-Umgehung.
 * @param {string|string[]} userIds - JID(s) oder Telefonnummern
 * @returns {Promise<boolean>}
 */
export async function isOnAdminWhitelist(userIds) {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  if (!ids.length) return false;

  // Normalisiere alle Formen (JID, LID, Nummer) zur kanonischen PN-JID
  const normalized = ids
    .map((id) => {
      const n = normalizeId(id);
      return resolveLid(n);
    })
    .filter(Boolean);

  if (!normalized.length) return false;

  try {
    const rows = await dbRows(
      `SELECT COUNT(*) as cnt FROM admin_whitelist WHERE user_jid IN (${normalized.map(() => '?').join(',')})`,
      normalized
    );
    return Number(rows[0]?.cnt || 0) > 0;
  } catch (err) {
    logError(err, 'isOnAdminWhitelist');
    return false;
  }
}

/**
 * Fügt eine Person zur Admin-Whitelist hinzu.
 * @param {string} userJid - Normalisierte JID
 * @param {string} addedBy - JID des Admins, der hinzufügt
 * @param {string} reason - Grund der Aufnahme
 * @returns {Promise<boolean>}
 */
export async function addToAdminWhitelist(userJid, addedBy, reason = '') {
  const normalized = resolveLid(normalizeId(userJid));
  if (!normalized) return false;

  try {
    await dbRun(
      `INSERT INTO admin_whitelist (user_jid, added_by, added_at, reason)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_jid) DO UPDATE SET added_by = excluded.added_by, added_at = excluded.added_at`,
      [normalized, addedBy, Date.now(), reason]
    );
    return true;
  } catch (err) {
    logError(err, 'addToAdminWhitelist');
    return false;
  }
}

/**
 * Entfernt eine Person von der Admin-Whitelist.
 * @param {string} userJid
 * @returns {Promise<boolean>}
 */
export async function removeFromAdminWhitelist(userJid) {
  const normalized = resolveLid(normalizeId(userJid));
  if (!normalized) return false;

  try {
    await dbRun(
      `DELETE FROM admin_whitelist WHERE user_jid = ?`,
      [normalized]
    );
    return true;
  } catch (err) {
    logError(err, 'removeFromAdminWhitelist');
    return false;
  }
}

// ── Admin-Suspensionen ─────────────────────────────────────────────

/**
 * Prüft, ob ein Admin suspendiert ist.
 * @param {string|string[]} userIds
 * @returns {Promise<{active: boolean, until: number, reason: string} | null>}
 */
export async function getAdminSuspension(userIds) {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  if (!ids.length) return null;

  const normalized = ids
    .map((id) => {
      const n = normalizeId(id);
      return resolveLid(n);
    })
    .filter(Boolean);

  if (!normalized.length) return null;

  try {
    const rows = await dbRows(
      `SELECT user_jid, until, reason, active FROM admin_suspensions
       WHERE user_jid IN (${normalized.map(() => '?').join(',')}) AND active = 1`,
      normalized
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      active: Number(r.active) === 1,
      until: Number(r.until),
      reason: r.reason,
      isExpired: Number(r.until) < Date.now(),
    };
  } catch (err) {
    logError(err, 'getAdminSuspension');
    return null;
  }
}

/**
 * Suspendiert einen Admin für eine bestimmte Zeit.
 * @param {string} userJid - Normalisierte JID
 * @param {number} durationMs - Dauer in Millisekunden
 * @param {string} suspendedBy - JID des suspendierenden Admins
 * @param {string} reason - Grund der Suspendierung
 * @returns {Promise<boolean>}
 */
export async function suspendAdmin(userJid, durationMs, suspendedBy, reason = '') {
  const normalized = resolveLid(normalizeId(userJid));
  if (!normalized || durationMs <= 0) return false;

  try {
    await dbRun(
      `INSERT INTO admin_suspensions (user_jid, suspended_by, suspended_at, until, reason, active)
       VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT(user_jid) DO UPDATE SET suspended_by = excluded.suspended_by,
         suspended_at = excluded.suspended_at, until = excluded.until,
         reason = excluded.reason, active = 1`,
      [normalized, suspendedBy, Date.now(), Date.now() + durationMs, reason]
    );
    return true;
  } catch (err) {
    logError(err, 'suspendAdmin');
    return false;
  }
}

/**
 * Hebt die Suspendierung eines Admins auf.
 * @param {string} userJid
 * @returns {Promise<boolean>}
 */
export async function unsuspendAdmin(userJid) {
  const normalized = resolveLid(normalizeId(userJid));
  if (!normalized) return false;

  try {
    await dbRun(
      `UPDATE admin_suspensions SET active = 0 WHERE user_jid = ?`,
      [normalized]
    );
    return true;
  } catch (err) {
    logError(err, 'unsuspendAdmin');
    return false;
  }
}

/**
 * Bereinigt abgelaufene Suspensionen (automatic cleanup).
 * @returns {Promise<number>} Anzahl gelöschter Einträge
 */
export async function cleanupExpiredSuspensions() {
  try {
    const result = await dbRun(
      `UPDATE admin_suspensions SET active = 0 WHERE until < ? AND active = 1`,
      [Date.now()]
    );
    return result?.changes || 0;
  } catch (err) {
    logError(err, 'cleanupExpiredSuspensions');
    return 0;
  }
}

// ── Moderation Security Chain ──────────────────────────────────────

/**
 * Zentrale Sicherheitsprüfung für Moderationsaktionen.
 * Prüft nacheinander:
 * 1. Ist der Actor WhatsApp-Admin der Gruppe?
 * 2. Ist der Actor auf der Admin-Whitelist?
 * 3. Ist der Actor suspendiert?
 * 4. (Zukünftig) Hat der Actor Permission für den spezifischen Befehl?
 *
 * @param {string} groupJid
 * @param {string|string[]} actorIds - JID(s) des Moderators
 * @param {string} action - Name der Aktion (z.B. 'kick', 'ban', 'warn')
 * @returns {Promise<{allowed: boolean, reason: string}>}
 */
export async function canExecuteModeration(groupJid, actorIds, action = 'generic') {
  // Diese Funktion wird später mit isUserAdmin aus permissions.js integriert
  // Für jetzt: Whitelist + Suspension prüfen

  const ids = Array.isArray(actorIds) ? actorIds : [actorIds];
  if (!ids.length) return { allowed: false, reason: 'Keine Actor-ID' };

  // 1. Whitelist-Prüfung
  const whitelisted = await isOnAdminWhitelist(ids);
  if (!whitelisted) {
    return { allowed: false, reason: 'Nicht auf Admin-Whitelist' };
  }

  // 2. Suspensions-Prüfung
  const suspension = await getAdminSuspension(ids);
  if (suspension && suspension.active && !suspension.isExpired) {
    const until = new Date(suspension.until).toLocaleString('de-DE');
    return { allowed: false, reason: `Suspendiert bis ${until}: ${suspension.reason}` };
  }

  // 3. (Zukünftig) Permission für Action prüfen
  // z.B. some actions might require co_owner role

  return { allowed: true };
}

// ── Audit-Logging ─────────────────────────────────────────────────

/**
 * Protokolliert eine Moderationsaktion.
 * @param {string} action - Art der Aktion (kick, ban, warn, etc.)
 * @param {string} actor - JID des Moderators
 * @param {string} target - JID des Ziels
 * @param {string} groupJid - Gruppen-JID (null für globale Aktionen)
 * @param {string} detail - Detail-JSON (max 500 Zeichen)
 * @returns {Promise<boolean>}
 */
export async function logModerationAction(action, actor, target, groupJid, detail = '') {
  try {
    // Sensible Daten nie loggen: Tokens, Passwörter, Keys
    const safeDetail = detail.slice(0, 500);
    await dbRun(
      `INSERT INTO moderation_audit (action, actor, target, group_jid, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [action, actor, target, groupJid, safeDetail, Date.now()]
    );
    return true;
  } catch (err) {
    logError(err, 'logModerationAction');
    return false;
  }
}

/**
 * Ruft die Moderationshistorie ab.
 * @param {Object} opts - Filter-Optionen
 * @param {string} opts.actor - Nach Moderator filtern
 * @param {string} opts.target - Nach Ziel filtern
 * @param {string} opts.groupJid - Nach Gruppe filtern
 * @param {string} opts.action - Nach Aktion filtern
 * @param {number} opts.limitDays - Nur letzte N Tage (default 30)
 * @param {number} opts.limit - Max Einträge (default 100)
 * @returns {Promise<Array>}
 */
export async function getModerationAudit(opts = {}) {
  const limitDays = Math.min(365, Math.max(1, opts.limitDays || 30));
  const limit = Math.min(500, Math.max(1, opts.limit || 100));
  const since = Date.now() - limitDays * 86_400_000;

  let sql = `SELECT * FROM moderation_audit WHERE created_at > ?`;
  const params = [since];

  if (opts.actor) {
    sql += ` AND actor = ?`;
    params.push(opts.actor);
  }
  if (opts.target) {
    sql += ` AND target = ?`;
    params.push(opts.target);
  }
  if (opts.groupJid) {
    sql += ` AND group_jid = ?`;
    params.push(opts.groupJid);
  }
  if (opts.action) {
    sql += ` AND action = ?`;
    params.push(opts.action);
  }

  sql += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  try {
    return await dbRows(sql, params);
  } catch (err) {
    logError(err, 'getModerationAudit');
    return [];
  }
}
