(() => {
  const CENTER = [35.8706, 128.5941]; // 대구 중앙로역
  const ROAD_WIDTH_M = 50; // 도로 구획: 도로에서 이 거리 안의 식당을 그 도로 식당으로 본다
  const POLL_MS = 15_000;

  const voterId = loadVoterId();
  const places = new Map(); // id → place (+ votes)
  const markers = new Map(); // id → Leaflet marker
  let areas = [];
  let currentArea = null;
  let areaLayer = null;
  let filter = 'all';

  const $ = (sel) => document.querySelector(sel);
  const form = $('#search-form');
  const input = $('#search-input');
  const statusEl = $('#status');
  const listEl = $('#place-list');
  const filtersEl = $('#filters');
  const chipsEl = $('#area-chips');
  const showAllBtn = $('#show-all');

  const map = L.map('map').setView(CENTER, 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  init();

  async function init() {
    try {
      const [placeList, areaList, tallies] = await Promise.all([
        getJson('/data/places.json'),
        getJson('/data/areas.json'),
        getJson('/api/tallies'),
      ]);
      areas = areaList;
      for (const p of placeList) {
        p.votes = tallies[p.id] ?? { yes: 0, no: 0, mine: null };
        places.set(p.id, p);
        // 마커는 처음에 모두 만들고 절대 지우지 않는다. 검색은 구획 강조와 목록만 바꾼다.
        const marker = L.marker([p.lat, p.lng], { icon: pinIcon(p), title: p.name, riseOnHover: true })
          .bindPopup(() => popupContent(p.id), { minWidth: 220 })
          .addTo(map);
        markers.set(p.id, marker);
        applyZ(p);
      }
      renderAreaOptions();
      renderList();
      setStatus(`식당 <b>${places.size}곳</b>이 있어요. 구획을 검색하거나 식당을 눌러 비플페이 가능 여부를 알려 주세요.`);

      const q = new URLSearchParams(location.search).get('q');
      if (q) search(q);
    } catch (err) {
      setStatus(escapeHtml(err.message), true);
    }
    setInterval(() => document.visibilityState === 'visible' && refreshTallies(), POLL_MS);
  }

  // ── 구획 검색 ───────────────────────────────────────────

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    search(input.value);
  });

  showAllBtn.addEventListener('click', () => {
    selectArea(null);
    history.replaceState(null, '', location.pathname);
  });

  async function search(raw) {
    const q = raw.trim();
    if (!q) return;
    input.value = q;

    let area = findArea(q);
    if (!area) {
      setStatus(`"${escapeHtml(q)}"에 맞는 구획을 AI로 찾는 중이에요…`);
      form.querySelector('button').disabled = true;
      try {
        const res = await fetch('/api/ai-area', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q }),
        });
        const data = await res.json();
        area = areas.find((a) => a.name === data.area) ?? null;
      } catch {
        area = null;
      } finally {
        form.querySelector('button').disabled = false;
      }
    }

    if (!area) {
      setStatus(`"${escapeHtml(q)}"에 해당하는 구획을 찾지 못했어요. 아래 구획 중에서 골라 보세요.`, true);
      return;
    }
    history.replaceState(null, '', `?q=${encodeURIComponent(area.name)}`);
    selectArea(area);
  }

  // 이름·별칭이 정확히 같으면 우선, 아니면 서로 포함하는 것 중 가장 긴 이름
  function findArea(q) {
    const n = squash(q);
    const names = (a) => [a.name, ...(a.aliases ?? [])].map(squash);
    const exact = areas.find((a) => names(a).includes(n));
    if (exact) return exact;
    return areas
      .map((a) => ({ a, len: Math.max(...names(a).filter((x) => n.includes(x) || x.includes(n)).map((x) => x.length), 0) }))
      .filter(({ len }) => len >= 2)
      .sort((x, y) => y.len - x.len)[0]?.a ?? null;
  }

  function selectArea(area) {
    currentArea = area;
    map.closePopup();
    if (areaLayer) areaLayer.remove();
    areaLayer = null;

    if (area) {
      const style = { color: '#2563eb', weight: 3, fillColor: '#2563eb', fillOpacity: 0.12, interactive: false };
      areaLayer = area.kind === 'line'
        ? L.featureGroup([
            L.polyline(area.lines, { ...style, weight: 18, opacity: 0.25 }),
            L.polyline(area.lines, { ...style, weight: 4, opacity: 0.9 }),
          ])
        : L.polygon(area.rings, style);
      areaLayer.addTo(map);
      map.flyToBounds(areaLayer.getBounds(), { padding: [40, 40], maxZoom: 18, duration: 0.8 });
      const count = [...places.values()].filter((p) => inArea(p, area)).length;
      setStatus(`<b>${escapeHtml(area.name)}</b>${area.type ? ` (${escapeHtml(area.type)})` : ''} · 식당 <b>${count}곳</b>`);
    } else {
      map.flyTo(CENTER, 16, { duration: 0.8 });
      setStatus(`식당 <b>${places.size}곳</b>이 있어요. 구획을 검색하거나 식당을 눌러 비플페이 가능 여부를 알려 주세요.`);
      input.value = '';
    }
    showAllBtn.hidden = !area;
    for (const b of chipsEl.querySelectorAll('button')) b.classList.toggle('active', b.dataset.name === area?.name);
    renderList();
  }

  function renderAreaOptions() {
    $('#area-names').replaceChildren(...areas.map((a) => Object.assign(document.createElement('option'), { value: a.name })));
    chipsEl.replaceChildren(...areas.map((a) => {
      const b = el('button', '', a.name);
      b.type = 'button';
      b.dataset.name = a.name;
      b.addEventListener('click', () => search(a.name));
      return b;
    }));
    chipsEl.hidden = !areas.length;
  }

  // ── 구획 안에 있는지 판정 ───────────────────────────────

  function inArea(p, area) {
    if (area.kind === 'line') return area.lines.some((line) => distanceToLine([p.lat, p.lng], line) <= ROAD_WIDTH_M);
    // 바깥 고리 안에 있고 구멍(나머지 고리) 안에는 없어야 한다
    const [outer, ...holes] = area.rings;
    return pointInRing([p.lat, p.lng], outer) && !holes.some((h) => pointInRing([p.lat, p.lng], h));
  }

  function pointInRing([y, x], ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [yi, xi] = ring[i];
      const [yj, xj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // 작은 범위라 위경도를 평면(m)으로 펴서 계산해도 충분하다
  function distanceToLine([lat, lng], line) {
    const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
    const ky = 110_540;
    const px = lng * kx, py = lat * ky;
    let best = Infinity;
    for (let i = 1; i < line.length; i++) {
      const ax = line[i - 1][1] * kx, ay = line[i - 1][0] * ky;
      const bx = line[i][1] * kx, by = line[i][0] * ky;
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
    }
    return best;
  }

  // ── 상태(다수결) ────────────────────────────────────────

  function statusOf(p) {
    const { yes, no } = p.votes;
    if (yes > no) return 'yes';
    if (no > yes) return 'no';
    return 'unknown';
  }

  function pinIcon(p) {
    return L.divIcon({
      className: 'pin-wrap',
      html: `<span class="pin pin-${statusOf(p)}"></span>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
      popupAnchor: [0, -10],
    });
  }

  function applyZ(p) {
    markers.get(p.id).setZIndexOffset(statusOf(p) === 'yes' ? 1000 : 0);
  }

  function refresh(id) {
    const p = places.get(id);
    const marker = markers.get(id);
    marker.setIcon(pinIcon(p));
    applyZ(p);
    if (marker.isPopupOpen()) marker.setPopupContent(popupContent(id));
  }

  async function refreshTallies() {
    try {
      const tallies = await getJson('/api/tallies');
      for (const p of places.values()) {
        const next = tallies[p.id] ?? { yes: 0, no: 0, mine: null };
        if (next.yes === p.votes.yes && next.no === p.votes.no && next.mine === p.votes.mine) continue;
        p.votes = next;
        refresh(p.id);
      }
      renderList();
    } catch {
      // 다음 주기에 다시 시도
    }
  }

  // ── 팝업 & 투표 ─────────────────────────────────────────

  function popupContent(id) {
    const p = places.get(id);
    const root = el('div', 'popup');
    root.append(el('h3', '', p.name));
    if (p.category) root.append(el('p', 'meta', p.category));
    if (p.roadAddress || p.address) root.append(el('p', 'meta', p.roadAddress || p.address));
    if (p.phone) root.append(el('p', 'meta', p.phone));
    if (/^https?:\/\//.test(p.url)) {
      const a = el('a', 'meta', '상세 정보 보기');
      a.href = p.url;
      a.target = '_blank';
      a.rel = 'noopener';
      root.append(a);
    }

    const { yes, no, mine } = p.votes;
    const verdict = { yes: '비플페이 가능', no: '비플페이 불가능', unknown: yes + no ? '의견이 반반이에요' : '아직 정보가 없어요' }[statusOf(p)];
    root.append(el('p', 'tally', `${verdict} · 가능 ${yes} / 불가능 ${no}`));

    const actions = el('div', 'actions');
    actions.append(voteButton(id, 'yes', '비플페이 가능', mine), voteButton(id, 'no', '불가능', mine));
    root.append(actions);
    if (mine) root.append(el('p', 'hint', '선택한 버튼을 다시 누르면 취소돼요.'));
    return root;
  }

  function voteButton(id, value, label, mine) {
    const btn = el('button', `${value}${mine === value ? ' selected' : ''}`, label);
    btn.type = 'button';
    btn.addEventListener('click', () => {
      for (const b of btn.parentElement.querySelectorAll('button')) b.disabled = true;
      vote(id, mine === value ? null : value);
    });
    return btn;
  }

  async function vote(placeId, value) {
    const p = places.get(placeId);
    try {
      const res = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Voter-Id': voterId },
        body: JSON.stringify({ placeId, value }),
      });
      const data = await res.json();
      if (res.status === 429) {
        p.votes = { yes: data.yes, no: data.no, mine: data.mine };
        showNotice(data.error);
      } else if (!res.ok) {
        showNotice(data.error ?? '저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
      } else {
        p.votes = { yes: data.yes, no: data.no, mine: data.mine };
      }
    } catch {
      showNotice('네트워크 오류로 저장하지 못했어요.');
    }
    refresh(placeId);
    renderList();
  }

  // ── 목록 ────────────────────────────────────────────────

  filtersEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-filter]');
    if (!btn) return;
    filter = btn.dataset.filter;
    for (const b of filtersEl.querySelectorAll('button')) b.classList.toggle('active', b === btn);
    renderList();
  });

  function renderList() {
    const order = { yes: 0, unknown: 1, no: 2 };
    const scoped = [...places.values()]
      .filter((p) => !currentArea || inArea(p, currentArea))
      .map((p) => ({ p, s: statusOf(p) }));
    const counts = { all: scoped.length, yes: 0, no: 0, unknown: 0 };
    for (const { s } of scoped) counts[s]++;
    for (const [k, v] of Object.entries(counts)) filtersEl.querySelector(`[data-count="${k}"]`).textContent = v;

    const items = scoped
      .filter(({ s }) => filter === 'all' || s === filter)
      .sort((a, b) => order[a.s] - order[b.s] || a.p.name.localeCompare(b.p.name, 'ko'))
      .map(({ p, s }) => {
        const li = document.createElement('li');
        li.append(el('span', `pin pin-${s}`));
        const text = el('div');
        text.append(el('div', 'name', p.name), el('div', 'meta', [p.category, p.roadAddress || p.address].filter(Boolean).join(' · ')));
        li.append(text);
        li.addEventListener('click', () => {
          const m = markers.get(p.id);
          map.setView(m.getLatLng(), Math.max(map.getZoom(), 18));
          m.openPopup();
        });
        return li;
      });
    listEl.replaceChildren(...(items.length ? items : [el('li', 'empty', '해당하는 식당이 없어요.')]));
  }

  // ── 유틸 ────────────────────────────────────────────────

  async function getJson(url) {
    const res = await fetch(url, { headers: { 'X-Voter-Id': voterId }, cache: 'no-store' });
    if (!res.ok) throw new Error(`데이터를 불러오지 못했어요 (${url})`);
    return res.json();
  }

  function showNotice(message) {
    const dialog = $('#notice');
    $('#notice-text').textContent = message;
    if (!dialog.open) dialog.showModal();
  }

  function el(tag, className = '', text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function setStatus(html, isError = false) {
    statusEl.innerHTML = html;
    statusEl.classList.toggle('error', isError);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  }

  function squash(s) {
    return String(s).replace(/\s+/g, '').toLowerCase();
  }

  // 로그인 대신 브라우저마다 고유 ID를 만들어 1인 1표로 센다.
  function loadVoterId() {
    try {
      let id = localStorage.getItem('voterId');
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem('voterId', id);
      }
      return id;
    } catch {
      return crypto.randomUUID();
    }
  }
})();
