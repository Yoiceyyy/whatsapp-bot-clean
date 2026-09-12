# RBAC System - Complete Deployment & Testing Guide

## 🎯 Quick Start (5 Minutes)

### Für Codespace-Deployment:

```bash
# 1. Code pullsen
git fetch origin
git checkout feature/role-permissions-system

# 2. Abhängigkeiten
npm ci

# 3. Tests
npm test

# 4. Bot starten
npm start

# 5. Panel öffnen
# http://localhost:3000/login
# Login: owner / <ACCESS_SECRET>
```

---

## 📋 Pre-Deployment Checklist

### Code-Integration

- [ ] `feature/role-permissions-system` branch existiert
- [ ] Alle Dateien vorhanden:
  ```bash
  ls -la src/permissions-new.js
  ls -la src/dashboard-auth.js
  ls -la src/api/auth.js
  ls -la src/commands/admin-*.js
  ls -la public/panel/*.html
  ```

- [ ] dashboard.js wurde angepasst:
  ```bash
  grep -c "requireDashboardAuth" src/dashboard.js
  # Sollte > 0 sein
  ```

- [ ] Commands wurden registriert:
  ```bash
  grep -c "admin-whitelist\|admin-suspend" src/router.js
  # Sollte > 0 sein
  ```

### Database

- [ ] Datenbank-Backup erstellt:
  ```bash
  cp database.db database.db.backup-$(date +%Y%m%d_%H%M%S)
  ```

- [ ] Neue Tabellen werden automatisch erstellt beim Start

### Testing

- [ ] Unit-Tests grün:
  ```bash
  npm test 2>&1 | tail -20
  ```

- [ ] Keine Fehler beim Start:
  ```bash
  npm start 2>&1 | grep -i error | head -20
  ```

---

## 🧪 Testing Scenarios

### Test 1: Bootstrap Login

```bash
# Terminal:
npm start

# Browser:
http://localhost:3000/login

# Input:
- Username: owner
- Password: <ACCESS_SECRET>

# Expected:
✅ Redirect zu /panel
✅ Owner-Benutzer erstellt in DB
✅ Cookie gesetzt
```

### Test 2: Panel Navigation

```bash
# Browser: http://localhost:3000/panel

# Checks:
✅ Benutzer-Info angezeigt (owner)
✅ Role-Badge: "🔴 Owner"
✅ 5 Tabs sichtbar
✅ Stats laden (0 initial)
```

### Test 3: Whitelist Management

```bash
# Panel → Admin-Whitelist Tab

# Test hinzufügen:
1. Input: 49170123456
2. Click: Hinzufügen
3. Expected: ✅ Erfolgs-Meldung
4. Expected: Tabelle aktualisiert
5. Expected: DB-Eintrag vorhanden:
   sqlite3 database.db "SELECT * FROM admin_whitelist;"

# Test entfernen:
1. Click: Entfernen
2. Expected: ✅ Erfolgs-Meldung
3. Expected: Aus Tabelle weg
```

### Test 4: Suspension Management

```bash
# Panel → Suspensionen Tab

# Test suspendieren:
1. Input: 49170123456
2. Input: 60 (Minutes)
3. Input: Test (Grund)
4. Click: Suspendieren
5. Expected: ✅ Erfolgs-Meldung
6. Expected: Countdown "59h 59m"
7. Expected: DB-Eintrag:
   sqlite3 database.db "SELECT * FROM admin_suspensions WHERE active = 1;"

# Test aufheben:
1. Click: Aufheben
2. Expected: ✅ Erfolgs-Meldung
3. Expected: Aus Tabelle weg
```

### Test 5: Audit-Log

```bash
# Panel → Audit-Log Tab

# Test filtern:
1. Input actor: 49170123456
2. Click: Filtern
3. Expected: Nur Aktionen von diesem Actor

# Test Aktionen sehen:
✅ Action-Badges mit Farben
✅ Datum/Zeit richtig
✅ Actor/Target angezeigt
✅ Detail-Text vorhanden
```

### Test 6: User Management

```bash
# Panel → Benutzer Tab

# Test erstellen:
1. Username: alice
2. Password: SecurePassword123
3. Role: admin
4. Click: Erstellen
5. Expected: ✅ Erfolgs-Meldung
6. Expected: In Tabelle angezeigt
7. Expected: DB-Eintrag:
   sqlite3 database.db "SELECT * FROM api_users WHERE username = 'alice';"

# Test Rolle ändern:
1. Select: co_owner
2. Expected: ✅ Erfolgs-Meldung
3. Expected: Badge aktualisiert

# Test Benutzer sperren:
1. Click: Sperren
2. Expected: Badge wechselt zu "🔒 Gesperrt"
3. Expected: disabled = 1 in DB
```

### Test 7: WhatsApp Commands

```bash
# In einer Test-Gruppe mit dem Bot

# Test: !adminwhitelist
!adminwhitelist 49170123456
→ Expected: "✅ Admin hinzugefügt"
→ Prüfung: Panel aktualisiert (50+ hat Eintrag)
→ Prüfung: DB: SELECT * FROM admin_whitelist;

# Test: !suspend
!suspend 49170123456 60 Test
→ Expected: "🔒 Admin suspendiert"
→ Prüfung: Panel zeigt Suspension mit Countdown
→ Prüfung: DB: SELECT * FROM admin_suspensions WHERE active = 1;

# Test: !admin
!admin 49170123456
→ Expected: "✅ In X Gruppen zum Admin gemacht"
→ Prüfung: Benutzer ist Admin in allen Gruppen
→ Prüfung: Audit-Log hat Eintrag
```

### Test 8: Permission Checks

```bash
# Neue Benutzer mit unterschiedlichen Rollen erstellen:

# viewer User:
Username: viewer_user
Password: ViewerPass123
Role: viewer

# Login und testen:
http://localhost:3000/login
viewer_user / ViewerPass123

# Expected:
✅ Panel lädt
✅ Nur Übersicht Tab sichtbar
✅ Andere Tabs disabled
✅ Click auf disabled → Alert

# admin User:
Username: admin_user
Password: AdminPass123
Role: admin

# Expected:
✅ Audit-Log Tab sichtbar
✅ Whitelist/Suspensions disabled

# co_owner User:
Username: coowner_user
Password: CoownerPass123
Role: co_owner

# Expected:
✅ Alle Tabs AUSSER Users sichtbar
```

---

## 🐛 Debugging

### Problem: Panel lädt nicht

```bash
# 1. Logs prüfen
npm start 2>&1 | grep -E "error|ERROR|Error"

# 2. API testen
curl -v http://localhost:3000/api/status
# Sollte 401 oder 200 sein (kein 500)

# 3. Cookie prüfen
# Browser DevTools → Application → Cookies
# Sollte "sid" Cookie vorhanden sein

# 4. Redirect prüfen
curl -L -v http://localhost:3000/panel 2>&1 | grep -E "Location|200|302"
```

### Problem: Tabs sind alle disabled

```bash
# 1. User-Rolle prüfen
sqlite3 database.db "SELECT username, role FROM api_users;"

# 2. API-Response prüfen
# Browser Console:
fetch('/api/status').then(r => r.json()).then(d => console.log(d))

# 3. Rolle manuell setzen
sqlite3 database.db "UPDATE api_users SET role = 'owner' WHERE username = 'owner';"
```

### Problem: Whitelist funktioniert nicht

```bash
# 1. Endpoint testen
curl -H "Cookie: sid=..." http://localhost:3000/api/admin/whitelist

# 2. Datenbank-Tabelle prüfen
sqlite3 database.db ".schema admin_whitelist"

# 3. Berechtigungen prüfen
# User muss co_owner oder owner sein
sqlite3 database.db "SELECT role FROM api_users WHERE username = 'owner';"

# 4. Logs prüfen
npm start 2>&1 | grep -i "whitelist"
```

### Problem: Commands funktionieren nicht

```bash
# 1. Command-Datei vorhanden?
ls -la src/commands/admin-*.js

# 2. Command registriert?
grep -n "admin-whitelist" src/router.js

# 3. Befehl ausprobieren
# In Bot-Gruppe:
!adminwhitelist
# Sollte Hilfe-Text zeigen

# 4. Logs prüfen
npm start 2>&1 | grep -i "adminwhitelist"
```

---

## 📊 Performance Baseline

Nach erfolgreichem Deployment sollten diese Werte erfüllt sein:

```
Login-Zeit:              < 500ms
Panel-Load:              < 1s
Whitelist-Add:           < 200ms
Suspension-Create:       < 200ms
Audit-Log Query:         < 500ms
User-List:               < 300ms

Database Size:           +15-20 MB (für neue Tabellen)
Memory Usage:            +20-50 MB (Runtime)
```

---

## 🔄 Rollback (Falls Probleme)

```bash
# 1. Zu alter Version zurück
git checkout main
npm ci

# 2. Bot neu starten
npm start

# 3. Datenbank zurückstellen (optional)
cp database.db.backup-YYYYMMDD_HHMMSS database.db

# Neue Tabellen können gelöscht werden (aber nicht nötig):
# sqlite3 database.db "DROP TABLE admin_whitelist, admin_suspensions, moderation_audit;"
```

---

## ✅ Post-Deployment Tasks

```bash
# 1. Monitoring starten
npm start > bot.log 2>&1 &
tail -f bot.log

# 2. Erste Admin-Benutzer erstellen
# Panel → Benutzer → alice (admin)

# 3. Erste Whitelist-Einträge hinzufügen
# Panel → Whitelist → Telefonnummern hinzufügen

# 4. Audit-Log überwachen
# Panel → Audit-Log → Sollte erste Einträge haben

# 5. Regelmäßige Backups
crontab -e
# Hinzufügen:
# 0 2 * * * cp ~/bot/database.db ~/backups/database.db.$(date +\%Y\%m\%d)
```

---

## 📞 Hilfe & Support

| Problem | Lösung |
|---------|--------|
| Panel lädt nicht | Logs prüfen, /api/status testen |
| Tabs sind disabled | User-Rolle prüfen, DB-Update |
| Commands funktionieren nicht | Registrierung prüfen, Logs |
| Whitelist funktioniert nicht | API-Test, Berechtigungen |
| Performance-Probleme | Database-Indizes prüfen, Logs |

---

## 🎉 Success Criteria

✅ Panel öffnet und zeigt Übersicht  
✅ Login mit Bootstrap-Benutzer funktioniert  
✅ Alle Tabs basieren auf Berechtigungen  
✅ Whitelist funktioniert End-to-End  
✅ Suspensionen funktioniert mit Countdown  
✅ Audit-Log protokolliert alle Aktionen  
✅ API-User können erstellt und verwaltet werden  
✅ WhatsApp Commands funktionieren  
✅ Keine Fehler in Logs  
✅ Performance ist ok  

**READY FOR PRODUCTION! 🚀**
