// Role-Based Access Control (RBAC) middleware and utilities
// Bridges permissions-new.js (granular permissions) and dashboard.js (middleware)

import { DASHBOARD_ROLE, hasPermission } from '../permissions-new.js';
import { logWarn } from '../logger.js';

// ── Permission Middleware ──────────────────────────────────────────────────────────────────

/**
 * Express middleware: Check if user has a required permission.
 * Responds with 403 if permission is denied.
 * @param {...string} requiredPermissions - Permissions required (AND logic)
 * @returns {Function} Express middleware
 */
export function requirePermission(...requiredPermissions) {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const userRole = req.user.role;
    const granted = requiredPermissions.every((perm) => hasPermission(userRole, perm));

    if (!granted) {
      logWarn(
        `⚠️ Permission denied: ${req.user.username} (${userRole}) tried to access ${req.method} ${req.path}`,
        'rbac'
      );
      return res.status(403).json({
        error: 'Permission denied',
        required: requiredPermissions,
      });
    }

    next();
  };
}

/**
 * Express middleware: Check if user has ANY of the required permissions.
 * Responds with 403 if none are granted.
 * @param {...string} requiredPermissions - Permissions (OR logic)
 * @returns {Function} Express middleware
 */
export function requireAnyPermission(...requiredPermissions) {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const userRole = req.user.role;
    const granted = requiredPermissions.some((perm) => hasPermission(userRole, perm));

    if (!granted) {
      logWarn(
        `⚠️ Permission denied (any): ${req.user.username} (${userRole}) tried to access ${req.method} ${req.path}`,
        'rbac'
      );
      return res.status(403).json({
        error: 'Permission denied',
        any_of: requiredPermissions,
      });
    }

    next();
  };
}

/**
 * Middleware to attach user to request if authenticated.
 * Call before requirePermission middleware.
 * @returns {Function} Express middleware
 */
export function attachUser(req, res, next) {
  // req.user should already be set by dashboard auth
  // This is just a safety check/standardization
  if (req.user) {
    return next();
  }
  res.status(401).json({ error: 'Not authenticated' });
}

// ── Role Hierarchy Helpers ────────────────────────────────────────────────────────────────

/**
 * Checks if a user's role is at or above a minimum required role.
 * Hierarchy: viewer < admin < co_owner < owner
 * @param {string} userRole
 * @param {string} minimumRole
 * @returns {boolean}
 */
export function hasRoleLevel(userRole, minimumRole) {
  const hierarchy = {
    viewer: 1,
    admin: 2,
    co_owner: 3,
    owner: 4,
  };

  const userLevel = hierarchy[userRole] || 0;
  const minLevel = hierarchy[minimumRole] || 999;

  return userLevel >= minLevel;
}

/**
 * Gets the display label for a role.
 * @param {string} role
 * @returns {string}
 */
export function getRoleLabel(role) {
  const labels = {
    viewer: '👁️ Betrachter',
    admin: '👮 Admin',
    co_owner: '🌐 Co-Owner',
    owner: '👑 Owner',
  };
  return labels[role] || role;
}

// ── Audit Logging for Permission Checks ────────────────────────────────────────────────────

/**
 * Log a permission check (for security audits).
 * @param {string} username
 * @param {string} action - e.g. 'api.kick', 'panel.wipe'
 * @param {boolean} allowed
 * @param {string} reason - Why it was allowed/denied
 */
export function auditPermissionCheck(username, action, allowed, reason = '') {
  const status = allowed ? '✅' : '❌';
  const msg = `${status} [${username}] ${action} - ${reason || (allowed ? 'allowed' : 'denied')}`;
  // Integrate with central audit system later
}
