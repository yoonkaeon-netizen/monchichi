// 로컬 실행용 서버: public/ 정적 파일과 api/*.js 를 Vercel과 같은 방식으로 띄운다.
// 배포(Vercel)에서는 쓰이지 않는다.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  try {
    return body ? JSON.parse(body) : undefined;
  } catch {
    return undefined;
  }
}

// Vercel 함수가 쓰는 res.status().json() 을 흉내 낸다.
function withHelpers(res) {
  res.status = (code) => ((res.statusCode = code), res);
  res.json = (body) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };
  return res;
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    const api = url.pathname.match(/^\/api\/([a-z-]+)$/);
    if (api) {
      const { default: handler } = await import(`./api/${api[1]}.js`);
      req.query = Object.fromEntries(url.searchParams);
      req.body = await readJson(req);
      return await handler(req, withHelpers(res));
    }

    const file = normalize(join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(PUBLIC_DIR)) throw Object.assign(new Error(), { code: 'ENOENT' });
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ERR_MODULE_NOT_FOUND') {
      res.writeHead(404).end('not found');
    } else {
      console.error(err);
      res.writeHead(500).end('server error');
    }
  }
}).listen(PORT, () => {
  const db = process.env.SUPABASE_URL ? 'Supabase' : '로컬 파일 DB(.local/)';
  console.log(`비플페이 지도: http://localhost:${PORT}  (저장소: ${db}, AI: ${process.env.GEMINI_API_KEY ? '켜짐' : '꺼짐'})`);
});
