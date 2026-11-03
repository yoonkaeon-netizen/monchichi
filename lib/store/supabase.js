import { createClient } from '@supabase/supabase-js';

export function createSupabaseStore(url, serviceKey) {
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  return {
    async castVote({ placeId, voterId, ipHash, value, limit }) {
      const { data, error } = await db.rpc('cast_vote', {
        p_place_id: placeId,
        p_voter_id: voterId,
        p_ip_hash: ipHash,
        p_value: value,
        p_limit: limit,
      });
      if (error) throw new Error(`투표 저장 실패: ${error.message}`);
      const row = data[0];
      return { status: row.status, yes: row.yes_count, no: row.no_count, mine: row.mine };
    },

    async getTallies(voterId) {
      const { data, error } = await db.rpc('get_tallies', { p_voter_id: voterId ?? '' });
      if (error) throw new Error(`투표 현황 조회 실패: ${error.message}`);
      return Object.fromEntries(data.map((r) => [r.place_id, { yes: r.yes_count, no: r.no_count, mine: r.mine }]));
    },

    async getCache(key) {
      const { data } = await db.from('ai_cache').select('value').eq('key', key).maybeSingle();
      return data?.value ?? null;
    },

    async setCache(key, value) {
      await db.from('ai_cache').upsert({ key, value });
    },
  };
}
