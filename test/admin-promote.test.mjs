import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
process.env.OWNER_NUMBERS = '491700000000';
process.env.DATABASE_URL = 'file:' + join(here, '..', '.test-admin-promote.db');
process.env.DATABASE_KEY = 'unused';

const { initDb, dbRun } = await import('../src/db.js');
const { state } = await import('../src/state.js');
const { invalidateGroupMeta, getGroupMeta } = await import('../src/permissions.js');
const { default: adminPromoteCommands } = await import('../src/commands/admin-promote.js');

const TARGET = '49170123456@s.whatsapp.net';
const BOT = '491700000000@s.whatsapp.net';
const GROUP_A = '100@g.us';
const GROUP_B = '101@g.us';
const GROUP_C = '102@g.us';
const GROUP_D = '103@g.us';
const GROUP_E = '104@g.us';

const cmd = (name) => adminPromoteCommands.find((c) => c.name === name);

function makeCtx(args) {
  const replies = [];
  return {
    args,
    sender: BOT,
    reply: (text) => {
      replies.push(text);
      return Promise.resolve();
    },
    replies,
  };
}

function meta(id, participants) {
  return { id, subject: `Group ${id}`, participants };
}

before(async () => { await initDb(); });

beforeEach(async () => {
  for (const table of ['groups', 'audit_log']) {
    await dbRun(`DELETE FROM ${table}`, []).catch(() => {});
  }
  for (const gid of [GROUP_A, GROUP_B, GROUP_C, GROUP_D, GROUP_E]) invalidateGroupMeta(gid);

  state.botJidPn = BOT;
  state.botJidLid = null;
});

test('!admin nutzt alle gespeicherten Gruppen und überspringt nicht passende sicher', async () => {
  const updates = [];
  const metas = new Map([
    [GROUP_A, meta(GROUP_A, [{ id: BOT, admin: 'admin' }, { id: TARGET, admin: null }])],
    [GROUP_B, meta(GROUP_B, [{ id: BOT, admin: 'admin' }, { id: '49179999999@s.whatsapp.net', admin: null }])],
    [GROUP_C, meta(GROUP_C, [{ id: BOT, admin: 'admin' }, { id: TARGET, admin: 'admin' }])],
    [GROUP_D, meta(GROUP_D, [{ id: BOT, admin: null }, { id: TARGET, admin: null }])],
    [GROUP_E, null],
  ]);

  await dbRun('INSERT INTO groups (jid, name, member_count, bot_is_admin, updated_at) VALUES (?, ?, ?, ?, ?)', [GROUP_A, 'Alpha', 2, 1, Date.now()]);
  await dbRun('INSERT INTO groups (jid, name, member_count, bot_is_admin, updated_at) VALUES (?, ?, ?, ?, ?)', [GROUP_B, 'Beta', 2, 1, Date.now()]);
  await dbRun('INSERT INTO groups (jid, name, member_count, bot_is_admin, updated_at) VALUES (?, ?, ?, ?, ?)', [GROUP_C, 'Gamma', 2, 1, Date.now()]);
  await dbRun('INSERT INTO groups (jid, name, member_count, bot_is_admin, updated_at) VALUES (?, ?, ?, ?, ?)', [GROUP_D, 'Delta', 2, 0, Date.now()]);
  await dbRun('INSERT INTO groups (jid, name, member_count, bot_is_admin, updated_at) VALUES (?, ?, ?, ?, ?)', [GROUP_E, 'Epsilon', 2, 1, Date.now()]);

  state.sock = {
    groupMetadata: async (groupJid) => metas.get(groupJid) || null,
    groupParticipantsUpdate: async (groupJid, participants, action) => {
      updates.push({ groupJid, participants, action });
    },
  };

  const ctx = makeCtx(['49170123456']);
  await cmd('admin').run(ctx);

  assert.deepEqual(updates, [{ groupJid: GROUP_A, participants: [TARGET], action: 'promote' }]);
  assert.match(ctx.replies[0], /allen gespeicherten Gruppen/);
  assert.match(ctx.replies[0], /befördert 1/);
  assert.match(ctx.replies[0], /Übersprungen: 4/);
});

test('!admin nutzt bei verfügbarem Gruppen-Snapshot keinen Einzelabruf pro Gruppe', async () => {
  const updates = [];
  let metadataCalls = 0;

  await dbRun('INSERT INTO groups (jid, name, member_count, bot_is_admin, updated_at) VALUES (?, ?, ?, ?, ?)', [GROUP_A, 'Alpha', 2, 1, Date.now()]);
  await dbRun('INSERT INTO groups (jid, name, member_count, bot_is_admin, updated_at) VALUES (?, ?, ?, ?, ?)', [GROUP_B, 'Beta', 2, 1, Date.now()]);

  state.sock = {
    groupMetadata: async () => {
      metadataCalls++;
      throw new Error('should not be called when group snapshot is available');
    },
    groupFetchAllParticipating: async () => ({
      [GROUP_A]: meta(GROUP_A, [{ id: BOT, admin: 'admin' }, { id: TARGET, admin: null }]),
    }),
    groupParticipantsUpdate: async (groupJid, participants, action) => {
      updates.push({ groupJid, participants, action });
    },
  };

  const ctx = makeCtx(['49170123456']);
  await cmd('admin').run(ctx);

  assert.equal(metadataCalls, 0);
  assert.deepEqual(updates, [{ groupJid: GROUP_A, participants: [TARGET], action: 'promote' }]);
  assert.match(ctx.replies[0], /Übersprungen: 0/);
});

test('!admin fällt bei Snapshot-Fehler auf Einzelabrufe zurück', async () => {
  const updates = [];
  let metadataCalls = 0;

  await dbRun('INSERT INTO groups (jid, name, member_count, bot_is_admin, updated_at) VALUES (?, ?, ?, ?, ?)', [GROUP_A, 'Alpha', 2, 1, Date.now()]);

  state.sock = {
    groupMetadata: async (groupJid) => {
      metadataCalls++;
      return meta(groupJid, [{ id: BOT, admin: 'admin' }, { id: TARGET, admin: null }]);
    },
    groupFetchAllParticipating: async () => {
      throw new Error('snapshot down');
    },
    groupParticipantsUpdate: async (groupJid, participants, action) => {
      updates.push({ groupJid, participants, action });
    },
  };

  const ctx = makeCtx(['49170123456']);
  await cmd('admin').run(ctx);

  assert.equal(metadataCalls, 1);
  assert.deepEqual(updates, [{ groupJid: GROUP_A, participants: [TARGET], action: 'promote' }]);
});

test('!admin mit Gruppenname trifft exakt case-insensitive nur die benannte Gruppe', async () => {
  const updates = [];
  const metas = new Map([
    [GROUP_A, meta(GROUP_A, [{ id: BOT, admin: 'admin' }, { id: TARGET, admin: null }])],
    [GROUP_B, meta(GROUP_B, [{ id: BOT, admin: 'admin' }, { id: TARGET, admin: null }])],
  ]);

  await dbRun('INSERT INTO groups (jid, name, member_count, bot_is_admin, updated_at) VALUES (?, ?, ?, ?, ?)', [GROUP_A, 'Team Eins', 2, 1, Date.now()]);
  await dbRun('INSERT INTO groups (jid, name, member_count, bot_is_admin, updated_at) VALUES (?, ?, ?, ?, ?)', [GROUP_B, 'Andere Gruppe', 2, 1, Date.now()]);

  state.sock = {
    groupMetadata: async (groupJid) => metas.get(groupJid) || null,
    groupParticipantsUpdate: async (groupJid, participants, action) => {
      updates.push({ groupJid, participants, action });
    },
  };

  const ctx = makeCtx(['49170123456', 'team', 'eins']);
  await cmd('admin').run(ctx);

  assert.deepEqual(updates, [{ groupJid: GROUP_A, participants: [TARGET], action: 'promote' }]);
  assert.match(ctx.replies[0], /Gruppe \*Team Eins\*/);
  assert.doesNotMatch(ctx.replies[0], /allen gespeicherten Gruppen/);
});

test('!admin meldet mehrdeutige gespeicherte Gruppennamen klar zurück', async () => {
  await dbRun('INSERT INTO groups (jid, name, member_count, bot_is_admin, updated_at) VALUES (?, ?, ?, ?, ?)', [GROUP_A, 'Fans', 2, 1, Date.now()]);
  await dbRun('INSERT INTO groups (jid, name, member_count, bot_is_admin, updated_at) VALUES (?, ?, ?, ?, ?)', [GROUP_B, 'fans', 2, 1, Date.now()]);

  state.sock = {
    groupMetadata: async () => null,
    groupParticipantsUpdate: async () => {
      throw new Error('should not update');
    },
  };

  const ctx = makeCtx(['49170123456', 'FANS']);
  await cmd('admin').run(ctx);

  assert.match(ctx.replies[0], /Mehrere gespeicherte Gruppen/);
});

test('!admin nutzt bei LID-Teilnehmern die aufgelöste PN-JID für das Update', async () => {
  const updates = [];
  const metas = new Map([
    [GROUP_A, meta(GROUP_A, [
      { id: BOT, admin: 'admin' },
      { id: '49170123456@lid', lid: '49170123456@lid', phoneNumber: TARGET, admin: null },
    ])],
  ]);

  await dbRun('INSERT INTO groups (jid, name, member_count, bot_is_admin, updated_at) VALUES (?, ?, ?, ?, ?)', [GROUP_A, 'LID Gruppe', 2, 1, Date.now()]);

  state.sock = {
    groupMetadata: async (groupJid) => metas.get(groupJid) || null,
    groupParticipantsUpdate: async (groupJid, participants, action) => {
      updates.push({ groupJid, participants, action });
    },
  };

  const ctx = makeCtx(['49170123456']);
  await cmd('admin').run(ctx);

  assert.deepEqual(updates, [{ groupJid: GROUP_A, participants: [TARGET], action: 'promote' }]);
});

test('!admin kann einen gespeicherten Gruppen-Eintrag ohne Namen per JID gezielt ansprechen', async () => {
  const updates = [];
  const metas = new Map([
    [GROUP_A, meta(GROUP_A, [{ id: BOT, admin: 'admin' }, { id: TARGET, admin: null }])],
    [GROUP_B, meta(GROUP_B, [{ id: BOT, admin: 'admin' }, { id: TARGET, admin: null }])],
  ]);

  await dbRun('INSERT INTO groups (jid, name, member_count, bot_is_admin, updated_at) VALUES (?, ?, ?, ?, ?)', [GROUP_A, '', 2, 1, Date.now()]);
  await dbRun('INSERT INTO groups (jid, name, member_count, bot_is_admin, updated_at) VALUES (?, ?, ?, ?, ?)', [GROUP_B, GROUP_A, 2, 1, Date.now()]);

  state.sock = {
    groupMetadata: async (groupJid) => metas.get(groupJid) || null,
    groupParticipantsUpdate: async (groupJid, participants, action) => {
      updates.push({ groupJid, participants, action });
    },
  };

  const ctx = makeCtx(['49170123456', GROUP_A]);
  await cmd('admin').run(ctx);

  assert.deepEqual(updates, [{ groupJid: GROUP_A, participants: [TARGET], action: 'promote' }]);
});

test('!admin überspringt LID-only Teilnehmer ohne auflösbare PN-JID', async () => {
  const updates = [];
  const metas = new Map([
    [GROUP_A, meta(GROUP_A, [
      { id: BOT, admin: 'admin' },
      { id: 'mystery@lid', lid: 'mystery@lid', admin: null },
    ])],
  ]);

  await dbRun('INSERT INTO groups (jid, name, member_count, bot_is_admin, updated_at) VALUES (?, ?, ?, ?, ?)', [GROUP_A, 'Nur LID', 2, 1, Date.now()]);

  state.sock = {
    groupMetadata: async (groupJid) => metas.get(groupJid) || null,
    groupParticipantsUpdate: async (groupJid, participants, action) => {
      updates.push({ groupJid, participants, action });
    },
  };

  const ctx = makeCtx(['49170123456']);
  await cmd('admin').run(ctx);

  assert.deepEqual(updates, []);
  assert.match(ctx.replies[0], /Übersprungen: 1/);
});

test('!unadmin nutzt dieselbe Gruppen-Auswahl und demotet nur bestehende Admins', async () => {
  const updates = [];
  const metas = new Map([
    [GROUP_A, meta(GROUP_A, [{ id: BOT, admin: 'admin' }, { id: TARGET, admin: 'superadmin' }])],
    [GROUP_B, meta(GROUP_B, [{ id: BOT, admin: 'admin' }, { id: TARGET, admin: null }])],
  ]);

  await dbRun('INSERT INTO groups (jid, name, member_count, bot_is_admin, updated_at) VALUES (?, ?, ?, ?, ?)', [GROUP_A, 'Admins', 2, 1, Date.now()]);
  await dbRun('INSERT INTO groups (jid, name, member_count, bot_is_admin, updated_at) VALUES (?, ?, ?, ?, ?)', [GROUP_B, 'Mitglieder', 2, 1, Date.now()]);

  state.sock = {
    groupMetadata: async (groupJid) => metas.get(groupJid) || null,
    groupParticipantsUpdate: async (groupJid, participants, action) => {
      updates.push({ groupJid, participants, action });
    },
  };

  const ctx = makeCtx(['49170123456']);
  await cmd('unadmin').run(ctx);

  assert.deepEqual(updates, [{ groupJid: GROUP_A, participants: [TARGET], action: 'demote' }]);
  assert.match(ctx.replies[0], /degradiert 1/);
  assert.match(ctx.replies[0], /Übersprungen: 1/);
});

test('!admin unterstützt @-Mentions als Ziel und nutzt alle aktuellen Gruppen', async () => {
  const updates = [];
  state.sock = {
    groupFetchAllParticipating: async () => ({
      [GROUP_A]: meta(GROUP_A, [{ id: BOT, admin: 'admin' }, { id: TARGET, admin: null }]),
      [GROUP_B]: meta(GROUP_B, [{ id: BOT, admin: 'admin' }, { id: TARGET, admin: null }]),
    }),
    groupParticipantsUpdate: async (groupJid, participants, action) => {
      updates.push({ groupJid, participants, action });
    },
  };

  const ctx = {
    ...makeCtx([]),
    targetUser: () => TARGET,
    argTextWithoutMentions: () => '',
  };
  await cmd('admin').run(ctx);

  assert.deepEqual(updates, [
    { groupJid: GROUP_A, participants: [TARGET], action: 'promote' },
    { groupJid: GROUP_B, participants: [TARGET], action: 'promote' },
  ]);
  assert.match(ctx.replies[0], /allen Gruppen/);
});

test('!admin invalidiert nach erfolgreichem Promote den Gruppen-Cache', async () => {
  await dbRun('INSERT INTO groups (jid, name, member_count, bot_is_admin, updated_at) VALUES (?, ?, ?, ?, ?)', [GROUP_A, 'Alpha', 2, 1, Date.now()]);
  let metadataCalls = 0;

  state.sock = {
    groupMetadata: async () => {
      metadataCalls++;
      return meta(GROUP_A, [{ id: BOT, admin: 'admin' }, { id: TARGET, admin: null }]);
    },
    groupParticipantsUpdate: async () => {},
  };

  await getGroupMeta(GROUP_A, true);
  const cached = await getGroupMeta(GROUP_A);
  assert.ok(cached, 'cache should be warm before promote');
  assert.equal(metadataCalls, 1);

  const ctx = makeCtx(['49170123456', 'Alpha']);
  await cmd('admin').run(ctx);

  await getGroupMeta(GROUP_A);
  assert.equal(metadataCalls, 2);
});

test('Usage dokumentiert beide Modi', () => {
  assert.equal(cmd('admin').usage, '!admin <Nummer> [Gruppenname]');
  assert.equal(cmd('unadmin').usage, '!unadmin <Nummer> [Gruppenname]');
});
