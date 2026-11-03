import areas from '../public/data/areas.json' with { type: 'json' };
import { getStore } from '../lib/store/index.js';
import { fail } from '../lib/request.js';

// "중앙로역 앞", "동성로 쪽"처럼 이름이 정확히 맞지 않는 입력을 Gemini로 구획 하나에 연결한다.
// 같은 입력은 저장해 두고 다시 쓰므로 무료 한도를 아낄 수 있다.

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const areaNames = areas.map((a) => a.name);

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'POST만 가능합니다.');

  const q = String(req.body?.q ?? '').trim().slice(0, 50);
  if (!q) return fail(res, 400, '검색어를 입력해 주세요.');

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return res.status(200).json({ area: null, reason: 'AI 검색이 설정되지 않았어요.' });

  try {
    const store = await getStore();
    const cacheKey = `area:${q.replace(/\s+/g, ' ')}`;
    const cached = await store.getCache(cacheKey);
    if (cached) return res.status(200).json(cached);

    const area = await askGemini(apiKey, q);
    const result = { area: areaNames.includes(area) ? area : null };
    await store.setCache(cacheKey, result);
    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    fail(res, 502, 'AI 검색에 실패했어요. 잠시 후 다시 시도해 주세요.');
  }
}

async function askGemini(apiKey, q) {
  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
  const prompt = [
    '대구광역시 중구 중앙로역 부근 지도 서비스입니다.',
    `사용자 입력: "${q}"`,
    `아래 구획 목록 중 사용자가 가리키는 곳을 정확히 하나 골라 그 이름을 그대로 돌려주세요. 맞는 곳이 없으면 null.`,
    `구획 목록: ${JSON.stringify(areas.map((a) => ({ name: a.name, type: a.type, aliases: a.aliases })))}`,
  ].join('\n');

  const res = await fetch(`${API}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: { type: 'OBJECT', properties: { area: { type: 'STRING', nullable: true } } },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Gemini 오류 (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  return JSON.parse(text).area ?? null;
}
