import { getStore } from '../lib/store/index.js';
import { fail, voterOf } from '../lib/request.js';

// { [placeId]: { yes, no, mine } } — 지도가 주기적으로 불러가 다른 사람의 투표를 반영한다.
export default async function handler(req, res) {
  if (req.method !== 'GET') return fail(res, 405, 'GET만 가능합니다.');
  try {
    const store = await getStore();
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(await store.getTallies(voterOf(req)));
  } catch (err) {
    console.error(err);
    fail(res, 500, err.message);
  }
}
