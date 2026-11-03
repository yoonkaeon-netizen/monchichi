import places from '../public/data/places.json' with { type: 'json' };
import { getStore } from '../lib/store/index.js';
import { fail, ipHashOf, voterOf } from '../lib/request.js';

const HOURLY_LIMIT = 30; // 31번째 표부터 저장하지 않는다
const RATE_LIMIT_MESSAGE = '너무 많은 입력값을 입력하셨습니다. 1시간 이후에 다시 입력해주세요.';
const placeIds = new Set(places.map((p) => p.id));

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'POST만 가능합니다.');

  const voterId = voterOf(req);
  if (!voterId) return fail(res, 400, '사용자 식별값이 없습니다. 페이지를 새로고침해 주세요.');

  const { placeId, value } = req.body ?? {};
  if (!placeIds.has(placeId)) return fail(res, 404, '알 수 없는 식당입니다.');
  if (value !== 'yes' && value !== 'no' && value !== null) return fail(res, 400, '잘못된 투표 값입니다.');

  try {
    const store = await getStore();
    const result = await store.castVote({ placeId, voterId, ipHash: ipHashOf(req), value, limit: HOURLY_LIMIT });
    if (result.status === 'rate_limited') {
      return res.status(429).json({ error: RATE_LIMIT_MESSAGE, placeId, yes: result.yes, no: result.no, mine: result.mine });
    }
    res.status(200).json({ placeId, yes: result.yes, no: result.no, mine: result.mine });
  } catch (err) {
    console.error(err);
    fail(res, 500, err.message);
  }
}
