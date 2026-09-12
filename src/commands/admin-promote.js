// Commands: !admin, !unadmin
// Rollen: owner only
// Funktion: Personen in gespeicherten Gruppen befoerdern/herabstufen

import { dbRows } from '../db.js';
import { getGroupMeta, botIsAdminInMeta, normalizeId, resolveLid, invalidateGroupMeta } from '../permissions.js';
import { logModerationAction } from '../permissions-new.js';
import { state } from '../state.js';
import { normalizePhoneNumber } from '../utils/phone.js';

const GROUP_LIKE = '%@g.us';
const ADMIN_ROLES = new Set(['admin', 'superadmin']);

function usage(name) {
  return `❌ Nutzung: !${name} <Nummer> [Gruppenname]\n`
    + `Beispiele: !${name} 49170123456\n`
    + `!${name} 49170123456 Meine Gruppe`;
}

function participantIds(participant) {
  const ids = new Set();
  for (const raw of [participant?.id, participant?.lid, participant?.jid, participant?.phoneNumber]) {
    const normalized = normalizeId(raw);
    if (!normalized) continue;
    ids.add(normalized);
    const resolved = resolveLid(normalized);
    if (resolved) ids.add(resolved);
  }
  return ids;
}

function findParticipant(meta, targetJid) {
  const targetIds = new Set([normalizeId(targetJid), resolveLid(targetJid)].filter(Boolean));
  return meta?.participants?.find((participant) => {
    const ids = participantIds(participant);
    for (const id of ids) {
      if (targetIds.has(id)) return true;
    }
    return false;
  }) || null;
}

function participantActionId(participant) {
  const direct = [participant?.id, participant?.jid]
    .map((raw) => normalizeId(raw))
    .find((id) => id?.endsWith('@s.whatsapp.net'));
  if (direct) return direct;

  const resolved = [participant?.id, participant?.jid, participant?.lid]
    .map((raw) => resolveLid(raw))
    .find((id) => id?.endsWith('@s.whatsapp.net'));
  return resolved || null;
}

function resolveTarget(ctx) {
  const mentioned = typeof ctx.targetUser === 'function' ? ctx.targetUser() : null;
  if (mentioned) return mentioned;

  const normalized = normalizePhoneNumber(ctx.args[0] || '');
  return normalized ? `${normalized}@s.whatsapp.net` : null;
}

function groupNameFromArgs(ctx, hasExplicitNumber) {
  if (hasExplicitNumber) return ctx.args.slice(1).join(' ').trim();
  if (typeof ctx.argTextWithoutMentions === 'function') return ctx.argTextWithoutMentions();
  return ctx.args.join(' ').trim();
}

async function loadLiveGroups(sock) {
  if (typeof sock?.groupFetchAllParticipating !== 'function') return [];
  const all = await sock.groupFetchAllParticipating();
  return Object.values(all || {})
    .map((meta) => ({
      jid: normalizeId(meta?.id),
      name: String(meta?.subject || '').trim(),
    }))
    .filter((row) => row.jid?.endsWith('@g.us'))
    .sort((a, b) => (a.name || a.jid).localeCompare(b.name || b.jid, 'de', { sensitivity: 'base' }));
}

async function loadGroups(sock, groupName) {
  const trimmed = String(groupName || '').trim();
  if (!trimmed) {
    try {
      const groups = await loadLiveGroups(sock);
      if (groups.length) return { scopeLabel: 'allen Gruppen', groups };
    } catch {}

    return {
      scopeLabel: 'allen gespeicherten Gruppen',
      groups: await dbRows(
        'SELECT jid, name FROM groups WHERE jid LIKE ? ORDER BY COALESCE(LOWER(name), LOWER(jid)), jid',
        [GROUP_LIKE]
      ),
    };
  }

  try {
    const liveGroups = await loadLiveGroups(sock);
    const matches = liveGroups.filter((row) =>
      row.jid === normalizeId(trimmed)
      || String(row.name || '').localeCompare(trimmed, 'de', { sensitivity: 'base' }) === 0
    );
    if (matches.length === 1) {
      return {
        scopeLabel: `der Gruppe *${matches[0].name || matches[0].jid}*`,
        groups: matches,
      };
    }
    if (matches.length > 1) {
      return { error: `⚠️ Mehrere aktuelle Gruppen heißen "${trimmed}" — bitte Namen im Panel eindeutiger machen.` };
    }
  } catch {}

  const directJid = await dbRows(
    'SELECT jid, name FROM groups WHERE jid = ? LIMIT 2',
    [trimmed]
  );
  if (directJid.length === 1) {
    return {
      scopeLabel: `der Gruppe *${directJid[0].name || directJid[0].jid}*`,
      groups: directJid,
    };
  }

  const groups = await dbRows(
    'SELECT jid, name FROM groups WHERE jid LIKE ? AND LOWER(COALESCE(name, \'\')) = LOWER(?) ORDER BY jid',
    [GROUP_LIKE, trimmed]
  );

  if (!groups.length) {
    return { error: `⚠️ Kein gespeicherter Gruppen-Eintrag mit dem Namen "${trimmed}" gefunden.` };
  }
  if (groups.length > 1) {
    return { error: `⚠️ Mehrere gespeicherte Gruppen-Einträge heißen "${trimmed}" — bitte Namen im Panel eindeutiger machen.` };
  }
  return {
    scopeLabel: `der Gruppe *${groups[0].name || trimmed}*`,
    groups,
  };
}

async function loadGroupMetaMap(sock, groups) {
  const wanted = new Set(
    groups
      .map((row) => normalizeId(row?.jid))
      .filter((jid) => jid?.endsWith('@g.us'))
  );
  const metaByGroup = new Map();
  if (!wanted.size) return metaByGroup;

  if (typeof sock?.groupFetchAllParticipating === 'function') {
    try {
      const all = await sock.groupFetchAllParticipating();
      for (const meta of Object.values(all || {})) {
        const jid = normalizeId(meta?.id);
        if (!jid || !wanted.has(jid)) continue;
        metaByGroup.set(jid, meta);
      }
      return metaByGroup;
    } catch {
      metaByGroup.clear();
    }
  }

  for (const jid of wanted) {
    const meta = await getGroupMeta(jid);
    if (meta) metaByGroup.set(jid, meta);
  }
  return metaByGroup;
}

async function runGroupAdminChange(ctx, { action, commandName, actionLabel, auditAction }) {
  const sock = state.sock;
  if (!sock?.groupParticipantsUpdate) {
    return ctx.reply('⚠️ Bot ist gerade nicht bereit.');
  }

  const hasExplicitNumber = !!normalizePhoneNumber(ctx.args[0] || '');
  const targetJid = resolveTarget(ctx);
  if (!targetJid) return ctx.reply(usage(commandName));

  const num = String(targetJid).split('@')[0];
  const groupName = groupNameFromArgs(ctx, hasExplicitNumber);

  try {
    const selection = await loadGroups(sock, groupName);
    if (selection.error) return ctx.reply(selection.error);
    if (!selection.groups?.length) return ctx.reply('⚠️ Keine Gruppen gefunden');
    const metaByGroup = await loadGroupMetaMap(sock, selection.groups);

    let changed = 0;
    let failed = 0;
    let skipped = 0;

    for (const row of selection.groups) {
      try {
        const meta = metaByGroup.get(normalizeId(row.jid)) || null;
        if (!meta?.participants) {
          skipped++;
          continue;
        }

        if (!botIsAdminInMeta(meta)) {
          skipped++;
          continue;
        }

        const participant = findParticipant(meta, targetJid);
        if (!participant) {
          skipped++;
          continue;
        }

        const isAdmin = ADMIN_ROLES.has(participant.admin);
        if ((action === 'promote' && isAdmin) || (action === 'demote' && !isAdmin)) {
          skipped++;
          continue;
        }

        const actionId = participantActionId(participant);
        if (!actionId) {
          skipped++;
          continue;
        }

        await sock.groupParticipantsUpdate(row.jid, [actionId], action);
        invalidateGroupMeta(row.jid);
        changed++;
      } catch (err) {
        console.error(`Error during ${action} in group ${row.jid}:`, err);
        failed++;
      }
    }

    try {
      await logModerationAction(
        auditAction,
        ctx.sender,
        targetJid,
        null,
        `${action}:${changed},failed:${failed},skip:${skipped}${groupName ? `,group:${groupName}` : ',group:all'}`
      );
    } catch (logErr) {
      console.error('Audit log error:', logErr);
    }

    return ctx.reply(
      `✅ ${num} in ${selection.scopeLabel}: ${actionLabel} ${changed}\n`
      + `❌ Fehler: ${failed} · ↩️ Übersprungen: ${skipped}`
    );
  } catch (err) {
    console.error(`Error in ${commandName} command:`, err);
    return ctx.reply('❌ Fehler: ' + err.message);
  }
}

export default [
  {
    name: 'admin',
    desc: '👑 In allen oder einer gespeicherten Gruppe zum Admin machen (owner only)',
    usage: '!admin <Nummer> [Gruppenname]',
    ownerOnly: true,
    category: 'admin',
    async run(ctx) {
      return runGroupAdminChange(ctx, {
        action: 'promote',
        commandName: 'admin',
        actionLabel: 'befördert',
        auditAction: 'admin.promote',
      });
    },
  },
  {
    name: 'unadmin',
    desc: '🙎 Admin-Status in allen oder einer gespeicherten Gruppe entziehen (owner only)',
    usage: '!unadmin <Nummer> [Gruppenname]',
    ownerOnly: true,
    category: 'admin',
    async run(ctx) {
      return runGroupAdminChange(ctx, {
        action: 'demote',
        commandName: 'unadmin',
        actionLabel: 'degradiert',
        auditAction: 'admin.demote',
      });
    },
  },
];
