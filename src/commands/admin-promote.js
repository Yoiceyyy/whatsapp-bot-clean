// src/commands/admin-promote.js
// Commands: !admin, !unadmin
// Rollen: owner only
// Funktion: Personen in ALLEN verwalteten Gruppen zum Admin machen

import { normalizePhoneNumber } from '../utils/phone.js';
import { logModerationAction } from '../permissions-new.js';
import { getGroupMeta } from '../permissions.js';
import { dbRows } from '../db.js';

export default [
  {
    name: 'admin',
    desc: '👑 In allen Gruppen zum Admin machen (owner only)',
    usage: '!admin <Nummer>',
    ownerOnly: true,
    category: 'admin',

    async run(ctx) {
      const num = ctx.args[0];
      if (!num) {
        return ctx.reply(
          '❌ Nutzung: !admin <Nummer>\n'
          + 'Beispiel: !admin 49170123456'
        );
      }

      // Telefonnummer normalisieren
      const normalized = normalizePhoneNumber(num);
      if (!normalized) {
        return ctx.reply('❌ Ungültige Telefonnummer');
      }

      const jid = `${normalized}@s.whatsapp.net`;

      try {
        // Alle Gruppen abrufen (nicht nur enabled = 1!)
        const groups = await dbRows(
          'SELECT jid FROM groups WHERE jid LIKE "%@g.us"',
          []
        );

        if (!groups || !groups.length) {
          return ctx.reply('⚠️ Keine Gruppen gefunden');
        }

        let promoted = 0;
        let failed = 0;
        let skipped = 0;

        // In jeder Gruppe versuchen
        for (const row of groups) {
          try {
            // Nutze getGroupMeta aus permissions.js
            const meta = await getGroupMeta(row.jid);
            if (!meta || !meta.participants) {
              skipped++;
              continue;
            }

            // Prüfen ob Bot Admin ist
            const botJid = ctx.socket?.user?.id || ctx.botJid;
            const botIsAdmin = meta.participants.some(
              (p) => p.id === botJid && (p.admin === 'admin' || p.admin === 'superadmin')
            );

            if (!botIsAdmin) {
              skipped++;
              continue;
            }

            // Prüfen ob Nutzer bereits Admin ist
            const isAdmin = meta.participants.some(
              (p) => p.id === jid && (p.admin === 'admin' || p.admin === 'superadmin')
            );

            if (isAdmin) {
              skipped++;
              continue;
            }

            // Prüfen ob Nutzer überhaupt in der Gruppe ist
            const userInGroup = meta.participants.some((p) => p.id === jid);
            if (!userInGroup) {
              skipped++;
              continue;
            }

            // Zum Admin machen
            await ctx.socket.groupParticipantsUpdate(row.jid, [jid], 'promote');
            promoted++;
          } catch (err) {
            console.error(`Error promoting in group ${row.jid}:`, err);
            failed++;
          }
        }

        // Audit-Log
        try {
          await logModerationAction(
            'admin.promote',
            ctx.sender,
            jid,
            null,
            `promote:${promoted},failed:${failed},skip:${skipped}`
          );
        } catch (logErr) {
          console.error('Audit log error:', logErr);
        }

        ctx.reply(
          `✅ ${num} wurde in ${promoted} Gruppen zum Admin gemacht\n`
          + `❌ Fehler: ${failed}\n`
          + `↩️ Übersprungen: ${skipped}`
        );
      } catch (err) {
        console.error('Error in admin command:', err);
        ctx.reply('❌ Fehler: ' + err.message);
      }
    },
  },

  {
    name: 'unadmin',
    desc: '🙎 Admin-Status in allen Gruppen entziehen (owner only)',
    usage: '!unadmin <Nummer>',
    ownerOnly: true,
    category: 'admin',

    async run(ctx) {
      const num = ctx.args[0];
      if (!num) {
        return ctx.reply(
          '❌ Nutzung: !unadmin <Nummer>\n'
          + 'Beispiel: !unadmin 49170123456'
        );
      }

      const normalized = normalizePhoneNumber(num);
      if (!normalized) {
        return ctx.reply('❌ Ungültige Telefonnummer');
      }

      const jid = `${normalized}@s.whatsapp.net`;

      try {
        // Alle Gruppen abrufen
        const groups = await dbRows(
          'SELECT jid FROM groups WHERE jid LIKE "%@g.us"',
          []
        );

        if (!groups || !groups.length) {
          return ctx.reply('⚠️ Keine Gruppen gefunden');
        }

        let demoted = 0;
        let failed = 0;
        let skipped = 0;

        // In jeder Gruppe versuchen
        for (const row of groups) {
          try {
            const meta = await getGroupMeta(row.jid);
            if (!meta || !meta.participants) {
              skipped++;
              continue;
            }

            // Prüfen ob Bot Admin ist
            const botJid = ctx.socket?.user?.id || ctx.botJid;
            const botIsAdmin = meta.participants.some(
              (p) => p.id === botJid && (p.admin === 'admin' || p.admin === 'superadmin')
            );

            if (!botIsAdmin) {
              skipped++;
              continue;
            }

            // Prüfen ob Nutzer Admin ist
            const isAdmin = meta.participants.some(
              (p) => p.id === jid && (p.admin === 'admin' || p.admin === 'superadmin')
            );

            if (!isAdmin) {
              skipped++;
              continue;
            }

            // Admin-Status entziehen
            await ctx.socket.groupParticipantsUpdate(row.jid, [jid], 'demote');
            demoted++;
          } catch (err) {
            console.error(`Error demoting in group ${row.jid}:`, err);
            failed++;
          }
        }

        // Audit-Log
        try {
          await logModerationAction(
            'admin.demote',
            ctx.sender,
            jid,
            null,
            `demote:${demoted},failed:${failed},skip:${skipped}`
          );
        } catch (logErr) {
          console.error('Audit log error:', logErr);
        }

        ctx.reply(
          `✅ ${num} wurde in ${demoted} Gruppen degradiert\n`
          + `❌ Fehler: ${failed}\n`
          + `↩️ Übersprungen: ${skipped}`
        );
      } catch (err) {
        console.error('Error in unadmin command:', err);
        ctx.reply('❌ Fehler: ' + err.message);
      }
    },
  },
];
