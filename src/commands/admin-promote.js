// src/commands/admin-promote.js
// Commands: !admin, !unadmin
// Rollen: owner only
// Funktion: Personen in ALLEN verwalteten Gruppen zum Admin machen

import { normalizePhoneNumber } from '../utils/phone.js';
import { logModerationAction } from '../permissions-new.js';

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
        // Alle verwalteten Gruppen abrufen (nutze ctx.db oder ctx.database)
        const groups = await (ctx.db?.all?.(
          'SELECT jid FROM group_settings WHERE enabled = 1',
          []
        ) || Promise.resolve([]));

        if (!groups || !groups.length) {
          return ctx.reply('⚠️ Keine verwalteten Gruppen gefunden');
        }

        let promoted = 0;
        let failed = 0;
        let skipped = 0;

        // In jeder Gruppe versuchen
        for (const row of groups) {
          try {
            // Nutze ctx.getGroupMeta oder ctx.sock.groupMetadata
            let meta;
            if (ctx.getGroupMeta) {
              meta = await ctx.getGroupMeta(row.jid);
            } else if (ctx.sock?.groupMetadata) {
              meta = await ctx.sock.groupMetadata(row.jid);
            }

            if (!meta) {
              skipped++;
              continue;
            }

            // Prüfen ob Bot Admin ist
            const botJid = ctx.botJid || (await ctx.sock?.getBotJid?.());
            const botIsAdmin = meta.participants?.some(
              (p) => p.id === botJid && (p.admin === 'admin' || p.admin === 'superadmin')
            );

            if (!botIsAdmin) {
              skipped++;
              continue;
            }

            // Prüfen ob Nutzer bereits Admin ist
            const isAdmin = meta.participants?.some(
              (p) => p.id === jid && (p.admin === 'admin' || p.admin === 'superadmin')
            );

            if (isAdmin) {
              skipped++;
              continue;
            }

            // Zum Admin machen
            if (ctx.sock?.groupParticipantsUpdate) {
              await ctx.sock.groupParticipantsUpdate(row.jid, [jid], 'promote');
              promoted++;
            } else {
              failed++;
            }
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
        ctx.reply('❌ Fehler beim Durchführen der Aktion: ' + err.message);
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
        // Alle verwalteten Gruppen abrufen
        const groups = await (ctx.db?.all?.(
          'SELECT jid FROM group_settings WHERE enabled = 1',
          []
        ) || Promise.resolve([]));

        if (!groups || !groups.length) {
          return ctx.reply('⚠️ Keine verwalteten Gruppen gefunden');
        }

        let demoted = 0;
        let failed = 0;
        let skipped = 0;

        // In jeder Gruppe versuchen
        for (const row of groups) {
          try {
            // Nutze ctx.getGroupMeta oder ctx.sock.groupMetadata
            let meta;
            if (ctx.getGroupMeta) {
              meta = await ctx.getGroupMeta(row.jid);
            } else if (ctx.sock?.groupMetadata) {
              meta = await ctx.sock.groupMetadata(row.jid);
            }

            if (!meta) {
              skipped++;
              continue;
            }

            // Prüfen ob Bot Admin ist
            const botJid = ctx.botJid || (await ctx.sock?.getBotJid?.());
            const botIsAdmin = meta.participants?.some(
              (p) => p.id === botJid && (p.admin === 'admin' || p.admin === 'superadmin')
            );

            if (!botIsAdmin) {
              skipped++;
              continue;
            }

            // Prüfen ob Nutzer Admin ist
            const isAdmin = meta.participants?.some(
              (p) => p.id === jid && (p.admin === 'admin' || p.admin === 'superadmin')
            );

            if (!isAdmin) {
              skipped++;
              continue;
            }

            // Admin-Status entziehen
            if (ctx.sock?.groupParticipantsUpdate) {
              await ctx.sock.groupParticipantsUpdate(row.jid, [jid], 'demote');
              demoted++;
            } else {
              failed++;
            }
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
        ctx.reply('❌ Fehler beim Durchführen der Aktion: ' + err.message);
      }
    },
  },
];
