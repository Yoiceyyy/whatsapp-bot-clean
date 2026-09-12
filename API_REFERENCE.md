# API-Referenz: Permissions System

## Imports

```javascript
// Basis-Permissions
import {
  DASHBOARD_ROLE,
  ROLE_PERMISSIONS,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
} from './permissions-new.js';

// Admin-Whitelist
import {
  isOnAdminWhitelist,
  addToAdminWhitelist,
  removeFromAdminWhitelist,
} from './permissions-new.js';

// Admin-Suspensionen
import {
  getAdminSuspension,
  suspendAdmin,
  unsuspendAdmin,
  cleanupExpiredSuspensions,
} from './permissions-new.js';

// Moderation Security Chain
import {
  canExecuteModeration,
  logModerationAction,
  getModerationAudit,
} from './permissions-new.js';

// Auth
import {
  hashPassword,
  verifyPassword,
  getApiUser,
  createApiUser,
  disableApiUser,
  enableApiUser,
  changeApiUserRole,
  listApiUsers,
} from './api/auth.js';

// Middleware
import {
  requireDashboardAuth,
  handleDashboardLogin,
  handleDashboardLogout,
} from './dashboard-auth.js';

import {
  requirePermission,
  requireAnyPermission,
  hasRoleLevel,
  getRoleLabel,
} from './api/permissions-rbac.js';
```

---

## Funktionen

### Permissions

#### `hasPermission(role: string, permission: string): boolean`

Prüft, ob eine Rolle eine bestimmte Berechtigung hat.

```javascript
if (hasPermission('admin', 'bot.control')) {
  // Admin darf Bot steuern
}
```

---

#### `hasAllPermissions(role: string, permissions: string[]): boolean`

Prüft, ob eine Rolle ALLE Berechtigungen hat (AND).

```javascript
if (hasAllPermissions('admin', ['bot.read', 'bot.control'])) {
  // Admin hat beide
}
```

---

#### `hasAnyPermission(role: string, permissions: string[]): boolean`

Prüft, ob eine Rolle MINDESTENS EINE Berechtigung hat (OR).

```javascript
if (hasAnyPermission(userRole, ['moderation.delete', 'users.manage'])) {
  // User hat mindestens eine
}
```

---

### Admin-Whitelist

#### `isOnAdminWhitelist(userIds: string | string[]): Promise<boolean>`

Prüft, ob eine Person auf der Admin-Whitelist ist. Normalisiert LID/Nummer automatisch.

```javascript
const allowed = await isOnAdminWhitelist('49170123456@s.whatsapp.net');
if (!allowed) {
  return ctx.reply('Du bist nicht auf der Admin-Whitelist');
}
```

---

#### `addToAdminWhitelist(userJid: string, addedBy: string, reason?: string): Promise<boolean>`

Fügt eine Person zur Whitelist hinzu.

```javascript
const success = await addToAdminWhitelist(
  '49170123456@s.whatsapp.net',
  ctx.sender,
  'Trusted moderator'
);
```

---

#### `removeFromAdminWhitelist(userJid: string): Promise<boolean>`

Entfernt eine Person von der Whitelist.

```javascript
await removeFromAdminWhitelist('49170123456@s.whatsapp.net');
```

---

### Admin-Suspensionen

#### `getAdminSuspension(userIds: string | string[]): Promise<{active, until, reason, isExpired} | null>`

Prüft, ob ein Admin suspendiert ist.

```javascript
const suspension = await getAdminSuspension(ctx.sender);
if (suspension && suspension.active && !suspension.isExpired) {
  return ctx.reply(`Du bist suspendiert bis ${new Date(suspension.until).toLocaleString()}`);
}
```

---

#### `suspendAdmin(userJid: string, durationMs: number, suspendedBy: string, reason?: string): Promise<boolean>`

Suspendiert einen Admin für eine bestimmte Dauer.

```javascript
const durationMs = 60 * 60 * 1000; // 1 Stunde
await suspendAdmin(
  '49170123456@s.whatsapp.net',
  durationMs,
  ctx.sender,
  'Abuse'
);
```

---

#### `unsuspendAdmin(userJid: string): Promise<boolean>`

Hebt eine Suspension auf.

```javascript
await unsuspendAdmin('49170123456@s.whatsapp.net');
```

---

#### `cleanupExpiredSuspensions(): Promise<number>`

Löscht abgelaufene Suspensionen (Auto-Cleanup).

```javascript
const cleaned = await cleanupExpiredSuspensions();
console.log(`${cleaned} abgelaufene Suspensionen gelöscht`);
```

---

### Moderation Security Chain

#### `canExecuteModeration(groupJid: string, actorIds: string | string[], action?: string): Promise<{allowed, reason}>`

Führt vollständige Sicherheitsprüfung vor Moderation durch.

```javascript
const security = await canExecuteModeration(chatJid, senderIds, 'kick');
if (!security.allowed) {
  return ctx.reply(`❌ ${security.reason}`);
}
// Aktion ausführen
```

---

#### `logModerationAction(action: string, actor: string, target: string, groupJid?: string, detail?: string): Promise<boolean>`

Protokoliiert eine Moderationsaktion.

```javascript
await logModerationAction(
  'kick',
  ctx.sender,
  targetJid,
  ctx.chatJid,
  'Spam'
);
```

---

#### `getModerationAudit(opts?: {actor, target, groupJid, action, limitDays, limit}): Promise<Array>`

Ruft Audit-Log-Einträge ab.

```javascript
const audit = await getModerationAudit({
  actor: ctx.sender,
  limitDays: 30,
  limit: 100,
});
```

---

### Auth

#### `hashPassword(password: string): Promise<{salt, hash}>`

Hasht ein Passwort mit Scrypt.

```javascript
const { salt, hash } = await hashPassword('myPassword');
// Speichern: salt, hash
```

---

#### `verifyPassword(password: string, hashHex: string, saltHex: string): Promise<boolean>`

Verifiziert ein Passwort gegen einen Hash.

```javascript
const isValid = await verifyPassword(password, storedHash, storedSalt);
```

---

#### `createApiUser(username: string, password: string, role?: string): Promise<{id, username, role} | {error}>`

Erstellt einen neuen API-Benutzer.

```javascript
const result = await createApiUser('alice', 'securePass123', 'admin');
if (result.error) {
  console.error(result.error);
} else {
  console.log(`User created: ${result.id}`);
}
```

---

#### `getApiUser(username: string): Promise<{id, username, pw_hash, pw_salt, role, created_at, disabled} | null>`

Ruft einen API-Benutzer ab.

```javascript
const user = await getApiUser('alice');
if (user && !user.disabled) {
  // User found and active
}
```

---

#### `listApiUsers(): Promise<Array>`

Listet alle API-Benutzer auf.

```javascript
const users = await listApiUsers();
for (const user of users) {
  console.log(`${user.username} (${user.role})`);
}
```

---

#### `disableApiUser(userId: string): Promise<boolean>`

Deaktiviert einen Benutzer.

```javascript
await disableApiUser(userId);
```

---

#### `enableApiUser(userId: string): Promise<boolean>`

Aktiviert einen Benutzer wieder.

```javascript
await enableApiUser(userId);
```

---

#### `changeApiUserRole(userId: string, newRole: string): Promise<boolean>`

Ändert die Rolle eines Benutzers.

```javascript
await changeApiUserRole(userId, 'co_owner');
```

---

### Middleware

#### `requireDashboardAuth(req, res, next)`

Express-Middleware: Erfordert Dashboard-Authentifizierung.

```javascript
app.get('/api/status', requireDashboardAuth, (req, res) => {
  // req.user = {userId, username, role}
});
```

---

#### `requirePermission(...permissions)(req, res, next)`

Express-Middleware: Prüft Berechtigungen (AND).

```javascript
api.post('/admin/wipe',
  requirePermission('bot.control', 'users.manage'),
  async (req, res) => {
    // Nur Owner oder Co-Owner mit beiden Berechtigungen
  }
);
```

---

#### `requireAnyPermission(...permissions)(req, res, next)`

Express-Middleware: Prüft Berechtigungen (OR).

```javascript
api.get('/logs',
  requireAnyPermission('logs.read', 'moderation.read'),
  async (req, res) => {
    // Nur Admin oder höher mit mindestens einer Berechtigung
  }
);
```

---

#### `hasRoleLevel(userRole: string, minimumRole: string): boolean`

Prüft, ob eine Rolle auf oder über einer Minimale-Hierarchie-Stufe ist.

```javascript
if (hasRoleLevel(req.user.role, 'co_owner')) {
  // User ist Co-Owner oder Owner
}
```

---

#### `getRoleLabel(role: string): string`

Gibt das Display-Label für eine Rolle zurück.

```javascript
console.log(getRoleLabel('co_owner')); // "🌐 Co-Owner"
```

---

## Konstanten

### `DASHBOARD_ROLE`

```javascript
{
  VIEWER: 'viewer',
  ADMIN: 'admin',
  CO_OWNER: 'co_owner',
  OWNER: 'owner',
}
```

---

### `ROLE_PERMISSIONS`

```javascript
{
  viewer: ['bot.read', 'logs.read', 'groups.read', 'settings.read', 'stats.read', 'moderation.read'],
  admin: [...viewer, 'bot.control', 'group.modify', 'commands.manage', 'custom.manage'],
  co_owner: [...admin, 'moderation.delete', 'adminwhitelist.manage', 'users.manage', 'bot.relink', 'punishments.reset', 'admin.suspend'],
  owner: ['*'],
}
```

---

## Error Handling

Alle async-Funktionen geben Fehler über Exceptions oder `{error: string}` zurück:

```javascript
try {
  const result = await createApiUser('test', 'pass', 'admin');
  if (result.error) {
    console.error('Validation Error:', result.error);
  } else {
    console.log('Success:', result.id);
  }
} catch (err) {
  console.error('Database Error:', err.message);
}
```

---

## Rate Limits

- **Login**: 5 Versuche pro 15 Minuten (IP)
- **Permission Checks**: Keine Rate Limit (lokal)
- **Moderation Audit**: 200 Einträge max pro Abfrage
- **Whitelist Lookups**: LRU-Cache (in-memory)

---
