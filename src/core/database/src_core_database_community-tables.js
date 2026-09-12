import { getDb } from './client.js';

const cache = {
  warningsTable: null,
  bansTable: null,
};

async function tableExists(name) {
  const db = getDb();
  try {
    const res = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      args: [name],
    });
    return Array.isArray(res.rows) && res.rows.length > 0;
  } catch {
    return false;
  }
}

export async function getWarningsTable() {
  if (cache.warningsTable) return cache.warningsTable;
  cache.warningsTable = (await tableExists('community_warnings')) ? 'community_warnings' : 'warnings';
  return cache.warningsTable;
}

export async function getBansTable() {
  if (cache.bansTable) return cache.bansTable;
  cache.bansTable = (await tableExists('community_bans')) ? 'community_bans' : 'bans';
  return cache.bansTable;
}

export function resetCommunityTableCache() {
  cache.warningsTable = null;
  cache.bansTable = null;
}