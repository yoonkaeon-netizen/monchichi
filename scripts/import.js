// aside.com에서 받은 파일을 지도용 데이터로 바꾼다.
//
//   npm run import-data -- <식당 파일> <구획 파일>
//   예) npm run import-data -- aside/restaurants.csv aside/areas.json
//
// 식당 파일: CSV 또는 JSON(배열). 열 이름은 한글/영문 아무거나(아래 COLUMNS 참고).
//            위도·경도가 없으면 주소로 좌표를 찾는다(OpenStreetMap Nominatim, 1초에 1건).
// 구획 파일: GeoJSON(FeatureCollection) 또는 JSON 배열 [{ name, type, aliases, polygon: [[위도,경도], ...] }].
//            도로처럼 선(LineString)으로 된 구획도 된다.
// 결과: public/data/places.json, public/data/areas.json

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';

const COLUMNS = {
  id: ['id', 'placeid', 'naverid', 'place_id', '플레이스id', '네이버장소id', '장소id', '아이디'],
  name: ['name', 'title', 'place_name', '이름', '상호', '상호명', '식당명', '가게명'],
  category: ['category', 'type', '업종', '카테고리', '분류'],
  address: ['address', 'jibunaddress', 'address_name', '주소', '지번주소', '지번'],
  roadAddress: ['roadaddress', 'road_address', 'road_address_name', '도로명주소', '도로명'],
  phone: ['phone', 'tel', 'telephone', '전화', '전화번호', '연락처'],
  url: ['url', 'link', 'place_url', '링크', '네이버링크', '주소링크'],
  lat: ['lat', 'latitude', 'y', '위도'],
  lng: ['lng', 'lon', 'long', 'longitude', 'x', '경도'],
};

const OUT_DIR = new URL('../public/data/', import.meta.url);
const GEOCODE_CACHE = new URL('../.local/geocode-cache.json', import.meta.url);

const [placesFile, areasFile] = process.argv.slice(2);
if (!placesFile && !areasFile) {
  console.error('사용법: npm run import-data -- <식당 파일> [구획 파일]');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
if (placesFile) await importPlaces(placesFile);
if (areasFile) importAreas(areasFile);

// ── 식당 ──────────────────────────────────────────────────

async function importPlaces(file) {
  const rows = readRows(file);
  const cache = existsSync(GEOCODE_CACHE) ? JSON.parse(readFileSync(GEOCODE_CACHE, 'utf8')) : {};
  const places = [];
  const seen = new Set();
  let geocoded = 0;
  const skipped = [];
  const approx = [];

  for (const row of rows) {
    const p = Object.fromEntries(Object.entries(COLUMNS).map(([key, names]) => [key, pick(row, names)]));
    if (!p.name) continue;

    let lat = toNumber(p.lat);
    let lng = toNumber(p.lng);
    if (lat != null && lng != null && lat > 100) [lat, lng] = [lng, lat];
    if (lat == null || lng == null) {
      const query = p.roadAddress || p.address;
      // "… 동성로2길 12-32 1층 카페" 처럼 뒤에 붙은 층·상호는 엉뚱한 곳을 잡게 하므로 건물번호까지만 쓴다.
      // 그래도 없으면 도로명(골목)만으로 찾아 대략적인 위치에 둔다.
      const short = query?.match(/^.*?(?:로|길)\s*\d+(?:-\d+)?/)?.[0];
      const street = query?.match(/^.*?(?:로|길)(?=\s*\d)/)?.[0];
      let hit = null;
      for (const q of new Set([short ?? query, street].filter(Boolean))) {
        hit = await geocode(q, cache);
        if (hit) {
          if (q === street) approx.push(p.name);
          break;
        }
      }
      if (hit) {
        [lat, lng] = hit;
        geocoded++;
      }
    }
    if (lat == null || lng == null) {
      skipped.push(p.name);
      continue;
    }

    const id = p.id ? `naver:${p.id}` : `p_${createHash('sha1').update(`${p.name}|${p.roadAddress || p.address}`).digest('hex').slice(0, 12)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    places.push({
      id,
      name: p.name,
      category: p.category ?? '',
      address: p.address ?? '',
      roadAddress: p.roadAddress ?? '',
      phone: p.phone ?? '',
      url: p.url ?? '',
      lat: round(lat),
      lng: round(lng),
    });
  }

  // 같은 좌표에 겹친 곳은 마커를 누를 수 있게 둥글게 조금씩(약 10m) 벌려 놓는다.
  const groups = Map.groupBy(places, (p) => `${p.lat},${p.lng}`);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.forEach((p, i) => {
      const angle = (2 * Math.PI * i) / group.length;
      p.lat = round(p.lat + 0.00009 * Math.sin(angle));
      p.lng = round(p.lng + 0.00011 * Math.cos(angle));
    });
  }

  mkdirSync(new URL('../.local/', import.meta.url), { recursive: true });
  writeFileSync(GEOCODE_CACHE, JSON.stringify(cache, null, 2));
  writeFileSync(new URL('places.json', OUT_DIR), JSON.stringify(places, null, 2));
  console.log(`식당 ${places.length}곳 저장 (주소로 좌표 찾음: ${geocoded}곳)`);
  if (approx.length) console.warn(`번지를 못 찾아 도로 위치로 둔 식당 ${approx.length}곳: ${approx.join(', ')}`);
  if (skipped.length) console.warn(`좌표를 못 찾아 빠진 식당 ${skipped.length}곳: ${skipped.join(', ')}`);
}

async function geocode(address, cache) {
  if (address in cache) return cache[address];
  await new Promise((r) => setTimeout(r, 1100)); // Nominatim 이용 규칙: 1초에 1건
  const url = new URL('https://nominatim.openstreetmap.org/search');
  // 대구 시내로 범위를 묶는다. 안 묶으면 같은 도로명이 있는 다른 도시로 잡히기도 한다.
  url.search = new URLSearchParams({ q: address, format: 'json', limit: '1', countrycodes: 'kr', viewbox: '128.35,36.05,128.80,35.70', bounded: '1' });
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'beepay-map-import/0.2' } });
    const [hit] = res.ok ? await res.json() : [];
    cache[address] = hit ? [+hit.lat, +hit.lon] : null;
  } catch {
    return null; // 네트워크 오류는 캐시하지 않고 다음 실행 때 다시 시도
  }
  return cache[address];
}

// ── 구획 ──────────────────────────────────────────────────

function importAreas(file) {
  const data = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const items = data.type === 'FeatureCollection'
    ? data.features.map((f) => ({ ...f.properties, geometry: f.geometry }))
    : Array.isArray(data) ? data : [data];

  const areas = items.map((item) => {
    const name = pick(item, ['name', '이름', '구획', '구획명', 'title']);
    const type = pick(item, ['type', '종류', '구분']) ?? '';
    const aliasValue = pick(item, ['aliases', '별칭', '다른이름']);
    const aliases = Array.isArray(aliasValue) ? aliasValue : aliasValue ? String(aliasValue).split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [];
    const shape = toShape(item);
    if (!name || !shape) throw new Error(`구획 데이터를 읽을 수 없어요: ${JSON.stringify(item).slice(0, 120)}`);
    return { name, type, aliases, ...shape };
  });

  writeFileSync(new URL('areas.json', OUT_DIR), JSON.stringify(areas, null, 2));
  console.log(`구획 ${areas.length}개 저장: ${areas.map((a) => a.name).join(', ')}`);
}

// 결과 형태: { kind: 'polygon', rings: [[[lat,lng],...]] } 또는 { kind: 'line', lines: [[[lat,lng],...]] }
function toShape(item) {
  const g = item.geometry;
  if (g) {
    const flip = (ring) => ring.map(([lng, lat]) => [round(lat), round(lng)]); // GeoJSON은 [경도, 위도]
    if (g.type === 'Polygon') return { kind: 'polygon', rings: g.coordinates.map(flip) };
    if (g.type === 'MultiPolygon') return { kind: 'polygon', rings: g.coordinates.flatMap((poly) => poly.map(flip)) };
    if (g.type === 'LineString') return { kind: 'line', lines: [flip(g.coordinates)] };
    if (g.type === 'MultiLineString') return { kind: 'line', lines: g.coordinates.map(flip) };
    return null;
  }
  const polygon = pick(item, ['polygon', 'coordinates', 'path', 'points', '폴리곤', '좌표']);
  const line = pick(item, ['line', 'polyline', '선']);
  const points = polygon ?? line;
  if (!Array.isArray(points) || points.length < 2) return null;
  const ring = points.map((pt) => {
    let [a, b] = Array.isArray(pt) ? pt : [pt.lat ?? pt.y ?? pt['위도'], pt.lng ?? pt.lon ?? pt.x ?? pt['경도']];
    a = +a;
    b = +b;
    return a > 100 ? [round(b), round(a)] : [round(a), round(b)]; // 위도는 100보다 작다
  });
  return polygon ? { kind: 'polygon', rings: [ring] } : { kind: 'line', lines: [ring] };
}

// ── 공통 ──────────────────────────────────────────────────

function readRows(file) {
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (extname(file).toLowerCase() === '.json') {
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : data.items ?? data.places ?? data.data ?? [];
  }
  const [header, ...lines] = parseCsv(text);
  return lines.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i]])));
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows.map((r) => r.map((v) => v.trim()));
}

// 열 이름을 대소문자·공백 무시하고 찾는다.
function pick(obj, names) {
  for (const [key, value] of Object.entries(obj)) {
    const k = key.toLowerCase().replace(/[\s_-]/g, '');
    if (names.some((n) => n.replace(/[\s_-]/g, '') === k) && value !== '' && value != null) return value;
  }
  return undefined;
}

function toNumber(v) {
  const n = Number(v);
  return v === undefined || v === '' || Number.isNaN(n) ? null : n;
}

function round(n) {
  return Math.round(n * 1e7) / 1e7;
}
