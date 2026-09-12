// Authentication module for Control API v1 + Dashboard
// Handles:
// - User registration (bootstrap first owner)
// - Password hashing with scrypt
// - Session/token management
// - Role-based access control

import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { dbRun, dbRows } from '../db.js';
import { logError, logWarn } from '../logger.js';

// Use native crypto.scrypt (available in Node.js >= 10.5)
const scrypt = promisify(crypto.scrypt);

const SCRYPT_CONFIG = {
  N: 32768,  // CPU/memory cost parameter
  r: 8,      // Block size parameter
  p: 1,      // Parallelization parameter
  maxmem: 64 * 1024 * 1024,  // 64 MB
};

// ── Password Hashing ────────────────────────────────────────────────────────────────────────

/**
 * Hashes a password using scrypt with a random salt.
 * Returns {salt, hash} as hex strings.
 * @param {string} password
 * @returns {Promise<{salt: string, hash: string}>}
 */
export async function hashPassword(password) {
  try {
    const salt = crypto.randomBytes(16);
    const hash = await scrypt(password, salt, 32, SCRYPT_CONFIG);
    return {
      salt: salt.toString('hex'),
      hash: hash.toString('hex'),
    };
  } catch (err) {
    logError(err, 'hashPassword');
    throw new Error('Password hashing failed');
  }
}

/**
 * Verifies a password against a stored hash.
 * @param {string} password - Plain text password
 * @param {string} hashHex - Stored hash (hex string)
 * @param {string} saltHex - Stored salt (hex string)
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, hashHex, saltHex) {
  try {
    const salt = Buffer.from(saltHex, 'hex');
    const storedHash = Buffer.from(hashHex, 'hex');
    const derived = await scrypt(password, salt, 32, SCRYPT_CONFIG);
    return crypto.timingSafeEqual(derived, storedHash);
  } catch (err) {
    // timingSafeEqual throws if lengths differ
    return false;
  }
}

// ── API User Management ────────────────────────────────────────────────────────────────────

/**
 * Checks if any API users exist in the database.
 * Used to determine if we're in bootstrap mode (first-time setup).
 * @returns {Promise<boolean>}
 */
export async function hasAnyApiUser() {
  try {
    const rows = await dbRows('SELECT COUNT(*) as cnt FROM api_users', []);
    return Number(rows[0]?.cnt || 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Retrieves an API user by username.
 * @param {string} username
 * @returns {Promise<{id, username, pw_hash, pw_salt, role, created_at, disabled}|null>}
 */
export async function getApiUser(username) {
  try {
    const rows = await dbRows(
      'SELECT * FROM api_users WHERE username = ? LIMIT 1',
      [String(username || '').trim().toLowerCase()]
    );
    return rows[0] || null;
  } catch (err) {
    logError(err, 'getApiUser');
    return null;
  }
}

/**
 * Retrieves an API user by ID.
 * @param {string} userId
 * @returns {Promise<{id, username, pw_hash, pw_salt, role, created_at, disabled}|null>}
 */
export async function getApiUserById(userId) {
  try {
    const rows = await dbRows(
      'SELECT * FROM api_users WHERE id = ? LIMIT 1',
      [userId]
    );
    return rows[0] || null;
  } catch (err) {
    logError(err, 'getApiUserById');
    return null;
  }
}

/**
 * Creates a new API user.
 * Used for first-time bootstrap and admin user management.
 * @param {string} username
 * @param {string} password
 * @param {string} role - 'owner'|'co_owner'|'admin'|'viewer'
 * @returns {Promise<{id, username, role}|{error: string}>}
 */
export async function createApiUser(username, password, role = 'admin') {
  const normalizedUsername = String(username || '').trim().toLowerCase();
  // Validate inputs
  if (!normalizedUsername || normalizedUsername.length < 3 || normalizedUsername.length > 32) {
    return { error: 'Username must be 3-32 characters' };
  }
  if (!password || password.length < 8) {
    return { error: 'Password must be at least 8 characters' };
  }
  if (!['owner', 'co_owner', 'admin', 'viewer'].includes(role)) {
    return { error: 'Invalid role' };
  }

  try {
    // Check if username already exists
    const existing = await getApiUser(normalizedUsername);
    if (existing) {
      return { error: 'Username already exists' };
    }

    // Hash the password
    const { salt, hash } = await hashPassword(password);

    // Generate unique user ID
    const userId = `usr_${crypto.randomBytes(12).toString('hex')}`;

    // Insert into database
    await dbRun(
      `INSERT INTO api_users (id, username, pw_hash, pw_salt, role, created_at, disabled)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
      [userId, normalizedUsername, hash, salt, role, Date.now()]
    );

    logWarn(`✏️ New API user created: ${normalizedUsername} (${role})`, 'auth');

    return {
      id: userId,
     username: normalizedUsername,
      role,
    };
  } catch (err) {
    logError(err, 'createApiUser');
    return { error: 'Failed to create user' };
  }
}

/**
 * Validates a password against a stored user.
 * @param {string} password
 * @param {string} pwHashHex
 * @param {string} pwSaltHex
 * @returns {Promise<boolean>}
 */
export async function validateApiPassword(password, pwHashHex, pwSaltHex) {
  return verifyPassword(password, pwHashHex, pwSaltHex);
}

/**
 * Disables an API user account.
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function disableApiUser(userId) {
  try {
    await dbRun('UPDATE api_users SET disabled = 1 WHERE id = ?', [userId]);
    return true;
  } catch (err) {
    logError(err, 'disableApiUser');
    return false;
  }
}

/**
 * Re-enables a disabled API user account.
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function enableApiUser(userId) {
  try {
    await dbRun('UPDATE api_users SET disabled = 0 WHERE id = ?', [userId]);
    return true;
  } catch (err) {
    logError(err, 'enableApiUser');
    return false;
  }
}

/**
 * Changes the role of an API user.
 * @param {string} userId
 * @param {string} newRole
 * @returns {Promise<boolean>}
 */
export async function changeApiUserRole(userId, newRole) {
  if (!['owner', 'co_owner', 'admin', 'viewer'].includes(newRole)) {
    return false;
  }
  try {
    await dbRun('UPDATE api_users SET role = ? WHERE id = ?', [newRole, userId]);
    return true;
  } catch (err) {
    logError(err, 'changeApiUserRole');
    return false;
  }
}

/**
 * Lists all API users (for admin panel).
 * @returns {Promise<Array>}
 */
export async function listApiUsers() {
  try {
    const rows = await dbRows(
      'SELECT id, username, role, created_at, disabled FROM api_users ORDER BY created_at DESC',
      []
    );
    return rows;
  } catch (err) {
    logError(err, 'listApiUsers');
    return [];
  }
}

// ── Bootstrap: First User Creation ────────────────────────────────────────────────────────

/**
 * Initializes the auth system with a first owner user.
 * Called during preflight checks if no users exist.
 * @param {string} ownerPassword - From ACCESS_SECRET
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function initializeAuthSystem(ownerPassword) {
  try {
    const existing = await hasAnyApiUser();
    if (existing) {
      return { success: false, message: 'Auth system already initialized' };
    }

    const result = await createApiUser('owner', ownerPassword, 'owner');
    if (result.error) {
      return { success: false, message: result.error };
    }

    return {
      success: true,
      message: 'Auth system initialized. First owner user created.',
    };
  } catch (err) {
    logError(err, 'initializeAuthSystem');
    return { success: false, message: 'Failed to initialize' };
  }
}
