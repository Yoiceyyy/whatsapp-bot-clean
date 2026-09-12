// src/commands/admin-whitelist.js
// Befehle: !adminwhitelist, !adminunwhitelist
// Rollen: co_owner+
// Funktion: Admin-Nummern zur Whitelist hinzufügen/entfernen

import { normalizePhoneNumber } from '../utils/phone.js';
import { addToAdminWhitelist, removeFromAdminWhitelist, isOnAdminWhitelist } from '../permissions-new.js';
import { logModerationAction } from '../permissions-new.js';

function resolveTargetJid(ctx) {
  const mentioned = typeof ctx.targetUser === 'function' ? ctx.targetUser() : null;
  if (mentioned) return mentioned;
  const normalized = normalizePhoneNumber(ctx.args[0] || '');
  return normalized ? `${normalized}@s.whatsapp.net` : null;
}

export default [
  {
    name: 'adminwhitelist',
    desc: '👮 Admin zur Whitelist hinzufügen (co_owner+)',
    usage: '!adminwhitelist <Nummer>',
    coOwnerOnly: true,
    category: 'admin',

    async run(ctx) {
      const jid = resolveTargetJid(ctx);
      if (!jid) {
        return ctx.reply(
          '❌ Nutzung: !adminwhitelist <Nummer>\n'
          + 'Beispiel: !adminwhitelist 49170123456'
        );
      }
      const num = String(jid).split('@')[0];

      try {
        // Prüfen, ob bereits auf Whitelist
        const alreadyWhitelisted = await isOnAdminWhitelist(jid);
        if (alreadyWhitelisted) {
          return ctx.reply('⚠️ Diese Nummer ist bereits auf der Admin-Whitelist');
        }

        // Hinzufügen
        const added = await addToAdminWhitelist(jid, ctx.sender, 'manual');
        if (!added) {
          return ctx.reply('❌ Fehler beim Hinzufügen zur Whitelist');
        }

        // Audit-Log
        await logModerationAction('admin.whitelist.add', ctx.sender, jid, ctx.chatJid, num);

        ctx.reply(
          `✅ ${num} wurde zur Admin-Whitelist hinzugefügt\n`
          + `Sie kann nun Moderationsaktionen durchführen.`
        );
      } catch (err) {
        console.error('Error in adminwhitelist:', err);
        ctx.reply('❌ Fehler beim Hinzufügen zur Whitelist');
      }
    },
  },

  {
    name: 'adminunwhitelist',
    desc: '👮 Admin von Whitelist entfernen (co_owner+)',
    usage: '!adminunwhitelist <Nummer>',
    coOwnerOnly: true,
    category: 'admin',

    async run(ctx) {
      const jid = resolveTargetJid(ctx);
      if (!jid) {
        return ctx.reply(
          '❌ Nutzung: !adminunwhitelist <Nummer>\n'
          + 'Beispiel: !adminunwhitelist 49170123456'
        );
      }
      const num = String(jid).split('@')[0];

      try {
        // Prüfen, ob auf Whitelist
        const isWhitelisted = await isOnAdminWhitelist(jid);
        if (!isWhitelisted) {
          return ctx.reply('⚠️ Diese Nummer ist nicht auf der Admin-Whitelist');
        }

        // Entfernen
        const removed = await removeFromAdminWhitelist(jid);
        if (!removed) {
          return ctx.reply('❌ Fehler beim Entfernen von der Whitelist');
        }

        // Audit-Log
        await logModerationAction('admin.whitelist.remove', ctx.sender, jid, ctx.chatJid, num);

        ctx.reply(
          `✅ ${num} wurde von der Admin-Whitelist entfernt\n`
          + `Sie kann nun keine Moderationsaktionen mehr durchführen.`
        );
      } catch (err) {
        console.error('Error in adminunwhitelist:', err);
        ctx.reply('❌ Fehler beim Entfernen von der Whitelist');
      }
    },
  },
];
