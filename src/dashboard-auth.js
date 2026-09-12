// Dashboard authentication and authorization
// Replaces the old ACCESS_SECRET-only system with API user authentication

import crypto from 'node:crypto';
import { getApiUser, validateApiPassword, hasAnyApiUser, initializeAuthSystem } from './api/auth.js';
import { logWarn, logError } from './logger.js';
import { ACCESS_SECRET } from './config.js';

// ── Session Management ──────────────────────────────────────────────────────────────────────

const sessions = new Map(); // token → {userId, username, role, expiresAt}
const loginFails = new Map(); // ip → {count, lockedUntil}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const LOGIN_LOCK_MINUTES = 15;
const MAX_LOGIN_FAILS = 5;
const SESSION_COOKIE = 'sid';

/**
 * Creates a new session token and stores it.
 * @param {string} userId
 * @param {string} username
 * @param {string} role
 * @returns {string} Session token
 */
function issueSession(userId, username, role) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    userId,
    username,
    role,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });

  // Keep sessions map bounded
  if (sessions.size > 1000) {
    const firstKey = sessions.keys().next().value;
    sessions.delete(firstKey);
  }

  return token;
}

/**
 * Validates a session token.
 * @param {string} token
 * @returns {{userId, username, role}|null}
 */
function validateSession(token) {
  const session = sessions.get(token);
  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }

  return {
    userId: session.userId,
    username: session.username,
    role: session.role,
  };
}

/**
 * Revokes a session token.
 * @param {string} token
 */
function revokeSession(token) {
  sessions.delete(token);
}

/**
 * Extracts token from cookie header.
 * @param {string} cookieHeader
 * @returns {string|null}
 */
function extractSessionToken(cookieHeader) {
  if (!cookieHeader) return null;
  const m = /(?:^|;\s*)(?:sid|dashboard_sid)=([a-f0-9]{64})/.exec(cookieHeader);
  return m ? m[1] : null;
}

/**
 * Normalizes IP address for rate limiting.
 * IPv6 /56 prefix to prevent subnet abuse.
 * @param {string} ip
 * @returns {string}
 */
function normalizeIp(ip) {
  if (!ip) return '?';
  // IPv4-mapped IPv6
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  // IPv6: take /56 prefix
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return parts.slice(0, 4).join(':') + '::/56';
  }
  return ip;
}

/**
 * Checks if IP is rate-limited for login attempts.
 * @param {string} ip
 * @returns {boolean}
 */
function isRateLimited(ip) {
  const entry = loginFails.get(ip);
  if (!entry) return false;
  if (Date.now() < entry.lockedUntil) return true;
  // Lock expired, clean up
  loginFails.delete(ip);
  return false;
}

/**
 * Records a failed login attempt.
 * @param {string} ip
 * @returns {{lockedUntil: number} | null}
 */
function recordLoginFail(ip) {
  let entry = loginFails.get(ip) || { count: 0, lockedUntil: 0 };
  entry.count++;

  if (entry.count >= MAX_LOGIN_FAILS) {
    entry.count = 0;
    entry.lockedUntil = Date.now() + LOGIN_LOCK_MINUTES * 60_000;
  }

  loginFails.set(ip, entry);
  if (loginFails.size > 500) {
    const firstKey = loginFails.keys().next().value;
    loginFails.delete(firstKey);
  }

  return entry.lockedUntil > Date.now() ? entry : null;
}

/**
 * Clears failed login attempts for an IP.
 * @param {string} ip
 */
function clearLoginFails(ip) {
  loginFails.delete(ip);
}

// ── Express Middleware ──────────────────────────────────────────────────────────────────────

/**
 * Middleware: Require authentication for a route.
 * Checks session token and attaches user to req.user.
 */
export function requireDashboardAuth(req, res, next) {
  const token = extractSessionToken(req.headers.cookie);
  if (!token) {
    if ((req.originalUrl || req.path).startsWith('/api/')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.redirect('/login');
  }

  const session = validateSession(token);
  if (!session) {
    if ((req.originalUrl || req.path).startsWith('/api/')) {
      return res.status(401).json({ error: 'Session expired' });
    }
    return res.redirect('/login');
  }

  // Attach user to request
  req.user = session;
  next();
}

/**
 * Middleware: Optional authentication.
 * Attaches user if authenticated, continues if not.
 */
export function optionalDashboardAuth(req, res, next) {
  const token = extractSessionToken(req.headers.cookie);
  if (token) {
    const session = validateSession(token);
    if (session) {
      req.user = session;
    }
  }
  next();
}

// ── Login/Logout Handlers ──────────────────────────────────────────────────────────────────

/**
 * Handles login request.
 * Returns session token if successful.
 */
export async function handleDashboardLogin(req, res) {
  const rawUsername = String(req.body?.username || '').trim();
  const username = rawUsername.toLowerCase();
  const password = String(req.body?.password || '');
  const ip = normalizeIp(req.ip || req.socket.remoteAddress || '?');

  // Rate limiting
  if (isRateLimited(ip)) {
    const entry = loginFails.get(ip);
    const remainMins = Math.ceil((entry.lockedUntil - Date.now()) / 60_000);
    return res.status(429).json({
      error: `Too many attempts. Locked for ${remainMins} minutes.`,
    });
  }

  // Bootstrap mode: first login with ACCESS_SECRET
  const hasUsers = await hasAnyApiUser();
  if (!hasUsers) {
    const bootstrapName = username || 'owner';
    if (bootstrapName === 'owner' && password === ACCESS_SECRET) {
      // Initialize auth system
      const init = await initializeAuthSystem(ACCESS_SECRET);
      if (!init.success) {
        logError(new Error(init.message), 'dashboard.bootstrapLogin');
        return res.status(500).json({ error: 'Bootstrap failed' });
      }

      clearLoginFails(ip);
      const token = issueSession('usr_owner', 'owner', 'owner');
      res.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=${token}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Path=/; HttpOnly; Secure; SameSite=Strict`
      );
      return res.json({ ok: true });
    }
    // Reject if not matching bootstrap credentials
    recordLoginFail(ip);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Normal mode: authenticate against api_users
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = await getApiUser(username);
  if (!user) {
    recordLoginFail(ip);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (user.disabled) {
    logWarn(`🚫 Login attempt with disabled user: ${username}`, 'dashboard-auth');
    recordLoginFail(ip);
    return res.status(401).json({ error: 'Account disabled' });
  }

  if (user.role === 'viewer') {
    recordLoginFail(ip);
    return res.status(403).json({ error: 'Viewer accounts cannot access the dashboard' });
  }

  // Verify password
  const isValid = await validateApiPassword(password, user.pw_hash, user.pw_salt);
  if (!isValid) {
    recordLoginFail(ip);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Success
  clearLoginFails(ip);
  const token = issueSession(user.id, user.username, user.role);
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Path=/; HttpOnly; Secure; SameSite=Strict`
  );

  logWarn(`✅ Dashboard login: ${username} (${user.role})`, 'dashboard-auth');
  res.json({ ok: true, role: user.role });
}

/**
 * Handles logout request.
 */
export function handleDashboardLogout(req, res) {
  const token = extractSessionToken(req.headers.cookie);
  if (token) {
    revokeSession(token);
  }
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`);
  res.json({ ok: true });
}

// ── Exports for testing/debugging ──────────────────────────────────────────────────────────

export { extractSessionToken, validateSession, revokeSession, isRateLimited };
