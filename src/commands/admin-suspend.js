// src/commands/admin-suspend.js
// Befehle: !suspend, !unsuspend
// Rollen: co_owner+
// Funktion: Admins temporär sperren/entsperren

import { normalizePhoneNumber } from '../utils/phone.js';
import { 
  suspendAdmin, 
  unsuspendAdmin, 
  getAdminSuspension,
  logModerationAction 
} from '../permissions-new.js';

function resolveTargetJid(ctx) {
  const mentioned = typeof ctx.targetUser === 'function' ? ctx.targetUser() : null;
  if (mentioned) return mentioned;
  const normalized = normalizePhoneNumber(ctx.args[0] || '');
  return normalized ? `${normalized}@s.whatsapp.net` : null;
}

function resolveDurationAndReason(ctx, usedExplicitNumber) {
  if (usedExplicitNumber) {
    return {
      durationStr: ctx.args[1],
      reason: ctx.args.slice(2).join(' ') || 'Keine Angabe',
    };
  }
  return {
    durationStr: ctx.args[0],
    reason: ctx.args.slice(1).join(' ') || 'Keine Angabe',
  };
}

export default [
  {
    name: 'suspend',
    desc: '🔒 Admin temporär suspendieren (co_owner+)',
    usage: '!suspend <Nummer> <Minuten> [Grund]',
    coOwnerOnly: true,
    category: 'admin',

    async run(ctx) {
      const usedExplicitNumber = !!normalizePhoneNumber(ctx.args[0] || '');
      const jid = resolveTargetJid(ctx);
      const { durationStr, reason } = resolveDurationAndReason(ctx, usedExplicitNumber);

      if (!jid || !durationStr) {
        return ctx.reply(
          '❌ Nutzung: !suspend <Nummer> <Minuten> [Grund]\n'
          + 'Beispiel: !suspend 49170123456 60 Spam'
        );
      }

      // Dauer parsen
      const minutes = parseInt(durationStr, 10);
      if (isNaN(minutes) || minutes <= 0 || minutes > 10_080) {
        // 10.080 = 7 Tage in Minuten (Max Limit)
        return ctx.reply('❌ Dauer muss zwischen 1 und 10.080 Minuten liegen');
      }

      const durationMs = minutes * 60_000;
      const num = String(jid).split('@')[0];

      try {
        // Prüfen, ob bereits suspendiert
        const existing = await getAdminSuspension(jid);
        if (existing && existing.active && !existing.isExpired) {
          const until = new Date(existing.until).toLocaleString('de-DE');
          return ctx.reply(
            `⚠️ Diese Nummer ist bereits suspendiert bis ${until}\n`
            + `Grund: ${existing.reason}`
          );
        }

        // Suspendieren
        const suspended = await suspendAdmin(jid, durationMs, ctx.sender, reason);
        if (!suspended) {
          return ctx.reply('❌ Fehler beim Suspendieren');
        }

        // Audit-Log
        await logModerationAction('admin.suspend', ctx.sender, jid, ctx.chatJid, `${minutes}min: ${reason}`);

        const until = new Date(Date.now() + durationMs).toLocaleString('de-DE');
        ctx.reply(
          `🔒 ${num} wurde suspendiert\n`
          + `Bis: ${until}\n`
          + `Grund: ${reason}`
        );
      } catch (err) {
        console.error('Error in suspend:', err);
        ctx.reply('❌ Fehler beim Suspendieren');
      }
    },
  },

  {
    name: 'unsuspend',
    desc: '🔓 Suspendierung aufheben (co_owner+)',
    usage: '!unsuspend <Nummer>',
    coOwnerOnly: true,
    category: 'admin',

    async run(ctx) {
      const jid = resolveTargetJid(ctx);
      if (!jid) {
        return ctx.reply(
          '❌ Nutzung: !unsuspend <Nummer>\n'
          + 'Beispiel: !unsuspend 49170123456'
        );
      }
      const num = String(jid).split('@')[0];

      try {
        // Prüfen, ob suspendiert
        const suspension = await getAdminSuspension(jid);
        if (!suspension || !suspension.active) {
          return ctx.reply('⚠️ Diese Nummer ist nicht suspendiert');
        }

        // Suspendierung aufheben
        const unsuspended = await unsuspendAdmin(jid);
        if (!unsuspended) {
          return ctx.reply('❌ Fehler beim Aufheben der Suspendierung');
        }

        // Audit-Log
        await logModerationAction('admin.unsuspend', ctx.sender, jid, ctx.chatJid, '');

        ctx.reply(
          `🔓 ${num} wurde entsperrt\n`
          + `Sie können wieder Moderationsaktionen durchführen.`
        );
      } catch (err) {
        console.error('Error in unsuspend:', err);
        ctx.reply('❌ Fehler beim Aufheben der Suspendierung');
      }
    },
  },
];
