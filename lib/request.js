import { createHmac } from 'node:crypto';

const VOTER_ID = /^[A-Za-z0-9-]{8,64}$/;

// 로그인 대신 브라우저마다 만든 고유 ID
export function voterOf(req) {
  const id = req.headers['x-voter-id'];
  return typeof id === 'string' && VOTER_ID.test(id) ? id : null;
}

// IP는 그대로 저장하지 않고 비밀값(IP_HASH_SALT)으로 해시한 값만 남긴다.
export function ipHashOf(req) {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  const ip = forwarded || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
  return createHmac('sha256', process.env.IP_HASH_SALT || 'beepay-map').update(String(ip)).digest('hex').slice(0, 32);
}

export function fail(res, status, message) {
  res.status(status).json({ error: message });
}
