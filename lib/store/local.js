// Supabase를 연결하기 전 로컬에서 테스트할 때 쓰는 파일 DB.
// supabase/schema.sql 의 cast_vote / get_tallies 와 같은 규칙으로 동작한다.

import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export function createLocalStore() {
  mkdirSync(new URL('../../.local/', import.meta.url), { recursive: true });
  const db = new DatabaseSync(fileURLToPath(new URL('../../.local/beepay.db', import.meta.url)));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS votes (
      place_id TEXT NOT NULL, voter_id TEXT NOT NULL,
      value TEXT NOT NULL CHECK (value IN ('yes', 'no')), updated_at INTEGER NOT NULL,
      PRIMARY KEY (place_id, voter_id)
    );
    CREATE TABLE IF NOT EXISTS vote_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL,
      place_id TEXT NOT NULL, voter_id TEXT NOT NULL, ip_hash TEXT NOT NULL,
      value TEXT, accepted INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);

  const recentCount = db.prepare('SELECT COUNT(*) AS n FROM vote_logs WHERE ip_hash = ? AND accepted = 1 AND created_at > ?');
  const insertLog = db.prepare('INSERT INTO vote_logs (created_at, place_id, voter_id, ip_hash, value, accepted) VALUES (?, ?, ?, ?, ?, ?)');
  const upsertVote = db.prepare(`
    INSERT INTO votes (place_id, voter_id, value, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(place_id, voter_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const deleteVote = db.prepare('DELETE FROM votes WHERE place_id = ? AND voter_id = ?');
  const tallySql = `
    SELECT place_id, SUM(value = 'yes') AS yes, SUM(value = 'no') AS no,
           MAX(CASE WHEN voter_id = ? THEN value END) AS mine
    FROM votes`;
  const tallyOne = db.prepare(`${tallySql} WHERE place_id = ?`);
  const tallyAll = db.prepare(`${tallySql} GROUP BY place_id`);
  const getCache = db.prepare('SELECT value FROM ai_cache WHERE key = ?');
  const putCache = db.prepare('INSERT INTO ai_cache (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

  return {
    async castVote({ placeId, voterId, ipHash, value, limit }) {
      const now = Date.now();
      let status = 'ok';
      db.exec('BEGIN IMMEDIATE');
      try {
        if (recentCount.get(ipHash, now - 60 * 60 * 1000).n >= limit) {
          status = 'rate_limited';
          insertLog.run(now, placeId, voterId, ipHash, value, 0);
        } else {
          if (value) upsertVote.run(placeId, voterId, value, now);
          else deleteVote.run(placeId, voterId);
          insertLog.run(now, placeId, voterId, ipHash, value, 1);
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      const row = tallyOne.get(voterId, placeId);
      return { status, yes: row.yes ?? 0, no: row.no ?? 0, mine: row.mine ?? null };
    },

    async getTallies(voterId) {
      return Object.fromEntries(tallyAll.all(voterId ?? '').map((r) => [r.place_id, { yes: r.yes, no: r.no, mine: r.mine }]));
    },

    async getCache(key) {
      const row = getCache.get(key);
      return row ? JSON.parse(row.value) : null;
    },

    async setCache(key, value) {
      putCache.run(key, JSON.stringify(value));
    },
  };
}
