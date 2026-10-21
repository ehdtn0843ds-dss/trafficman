// 축 탐색기: 20개 통근 축 + 현행 편하G 28개 노선
// 좌표는 model.json(출발 행정동 5곳 인구가중 대표점, 목적지 대표점, 편하G 정류장)을 단순 등장방형 투영으로 그려요.
// 지도 범위는 20개 축(출발점 5곳 포함)에 맞춰요. 현행 노선을 겹쳐 봐도 범위는 그대로이고, 범위 밖 구간은 잘라요.
// 배경 시군 경계는 data/sgg_outline.json(vuski/admdongkor 행정동 경계를 시군 단위로 합쳐 단순화, build_sgg_outline.py).
// 경계 파일을 못 받으면 경계 없이 그려요. 계산은 js/model.js의 annualNet·breakeven.
// 축 고르기: 선이 겹치는 곳이 많아서 선 하나하나에 클릭을 걸지 않고, 지도에서 누른 점과 가장 가까운 축을 골라요.
import { loadModel, getModel, annualNet, breakeven } from './model.js';

const root = document.getElementById('explorer-root');
const MODEL_URL = new URL('../data/model.json', import.meta.url).href;
const OUTLINE_URL = new URL('../data/sgg_outline.json', import.meta.url).href;
const MINUS = '−';
const sgn = (v, d = 0) => {
  const r = +v.toFixed(d);
  return (r > 0 ? '+' : r < 0 ? MINUS : '') + Math.abs(r).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
};
const int = (v) => Math.round(v).toLocaleString('ko-KR');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const city = (s) => s.replace(/^(\S+?)(시|군)(?=\s|$)/, '$1').replace(/^(\S+?)시(\S+구)$/, '$1 $2');
const axisName = (key) => key.split('→').map(city).join('→');
// 받침 있으면 '이에요', 없으면 '예요'
const eyo = (w) => { const c = w.charCodeAt(w.length - 1); return c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 ? '이에요' : '예요'; };
const TAG = { '수요관리': 'tag--demand', 'DRT 연계': 'tag--drt', '출퇴근 직행': 'tag--direct', '보류': 'tag--hold' };
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
const coarseMQ = matchMedia('(pointer: coarse)');

if (root) {
  const outline = fetch(OUTLINE_URL).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  Promise.all([loadModel(MODEL_URL), outline]).then(([, ol]) => start(ol)).catch((e) => {
    // 안내문만 보여요(콘솔 오류는 남기지 않아요)
    const el = root.querySelector('.mount-empty');
    if (el) el.textContent = '지도 데이터를 불러오지 못했어요. 페이지를 새로 고쳐 주세요.';
    void e;
  });
}

function start(OL) {
  const M = getModel();
  const C = M.constants;
  const AX = M.axes.slice().sort((a, b) => a.id - b.id);
  const RT = M.routes;
  // 기본 회차: 보고서 배분 축은 배분 회차, 버스 후보 축은 5회, 수요관리(버스 후보 아님) 축은 0회
  const tries = new Map(AX.map((a) => [a.id, a.alloc_am || (a.bus_candidate && a.model_D_day != null ? 5 : 0)]));
  let sel = AX.find((a) => a.key === '평택시→화성시') ?? AX[0];
  let view = 'map';
  const f1 = (v) => v.toFixed(1);

  // ───────── 투영 (범위는 20개 축 기준, 고정) ─────────
  const pts = [];
  AX.forEach((a) => { pts.push([a.origin_lon, a.origin_lat], [a.dest_lon, a.dest_lat]); a.origin_points.forEach((p) => pts.push([p.lon, p.lat])); });
  const lonMin = Math.min(...pts.map((p) => p[0])), lonMax = Math.max(...pts.map((p) => p[0]));
  const latMin = Math.min(...pts.map((p) => p[1])), latMax = Math.max(...pts.map((p) => p[1]));
  const kx = Math.cos(((latMin + latMax) / 2) * Math.PI / 180);
  const PADL = 46, PADR = 34, PADT = 30, PADB = 40;
  // W(viewBox 너비)는 지도가 실제로 그려지는 너비에 맞춰요. 그래야 글자·선 굵기가 화면에서 거의 그대로예요.
  let W = 0, H = 0, s = 1, pxPerKm = 1;
  const P = (lon, lat) => [PADL + (lon - lonMin) * kx * s, PADT + (latMax - lat) * s];
  function layout(w) {
    // 남북으로 긴 범위라 너비 480 위로는 키우지 않아요(지도 높이가 한 화면 안에 들어오게)
    W = Math.round(Math.max(300, Math.min(480, w)));
    s = (W - PADL - PADR) / ((lonMax - lonMin) * kx);
    H = Math.round((latMax - latMin) * s + PADT + PADB);
    pxPerKm = s / 111.2;
  }

  const qMax = Math.max(...AX.map((a) => a.Q_car));
  const width = (a) => 2 + 9 * Math.sqrt(a.Q_car / qMax);
  const geom = (a) => {
    const [x0, y0] = P(a.origin_lon, a.origin_lat), [x1, y1] = P(a.dest_lon, a.dest_lat);
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
    // 거의 같은 길로 겹치는 두 쌍은 한쪽을 반대로 휘어 떨어뜨려요
    const k = (BEND_FLIP.has(a.key) ? -0.13 : 0.13) * L;
    const cx = (x0 + x1) / 2 - (dy / L) * k, cy = (y0 + y1) / 2 + (dx / L) * k;
    // 가까운 축을 찾을 때 쓰는 점(2차 베지어를 촘촘히)
    const smp = [];
    for (let i = 0; i <= 48; i++) {
      const t = i / 48, u = 1 - t;
      smp.push([u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1]);
    }
    return { d: `M${f1(x0)} ${f1(y0)}Q${f1(cx)} ${f1(cy)} ${f1(x1)} ${f1(y1)}`, x0, y0, x1, y1, smp,
             mx: 0.25 * x0 + 0.5 * cx + 0.25 * x1, my: 0.25 * y0 + 0.5 * cy + 0.25 * y1 };
  };
  let G = new Map();
  const BEND_FLIP = new Set(['용인시→서울 서초구', '파주시→서울 영등포구']);

  // 시군 이름(출발 시군). 겹치는 곳만 왼쪽으로
  const LEFT = new Set(['화성시', '수원시', '안산시', '시흥시', '고양시', '파주시']);
  const originSet = new Set(AX.map((a) => a.origin));
  const order = AX.slice().sort((a, b) => (a.alloc_am > 0) - (b.alloc_am > 0) || b.Q_car - a.Q_car);
  const axisLabel = (a) => `${axisName(a.key)}, ${a.seoul ? '서울행' : '경기 내부'}, PCTR ${a.PCTR.toFixed(2)}, ${a.diag}${a.alloc_am ? `, 증편 출근 ${a.alloc_am}회 배분` : ''}`;
  const seoulDest = AX.filter((a) => a.seoul);
  const seoulLL = [seoulDest.reduce((t, a) => t + a.dest_lon, 0) / seoulDest.length, seoulDest.reduce((t, a) => t + a.dest_lat, 0) / seoulDest.length];

  // 배경: 경기 시군·서울 자치구 경계 (1/1000도 정수, 첫 점 + 차분)
  const ringPath = (r) => {
    let x = r[0], y = r[1];
    const pt = () => { const [a, b] = P(x / 1000, y / 1000); return `${f1(a)} ${f1(b)}`; };
    let d = 'M' + pt();
    for (let i = 2; i < r.length; i += 2) { x += r[i]; y += r[i + 1]; d += 'L' + pt(); }
    return d + 'Z';
  };

  function mapSvg() {
    G = new Map(AX.map((a) => [a.id, geom(a)]));
    const origins = new Map();
    AX.forEach((a) => { if (!origins.has(a.origin)) origins.set(a.origin, P(a.origin_lon, a.origin_lat)); });
    const [sx0, sy0] = P(...seoulLL);
    const inView = ([x, y], m = 14) => x > m && x < W - m && y > m && y < H - 28;
    const base = OL ? `
    <g class="ex-base" aria-hidden="true">
      ${OL.features.map((f) => `<path class="sgg ${f.s === '서울' ? 's' : 'g'}" d="${f.r.map(ringPath).join('')}"/>`).join('')}
      ${OL.features.filter((f) => f.s === '경기' && !originSet.has(f.n)).map((f) => ({ f, p: P(f.c[0], f.c[1]) }))
        .filter(({ p }) => inView(p) && [...origins.values()].every(([x, y]) => Math.hypot(p[0] - x, p[1] - y) > 34))
        .map(({ f, p }) => `<text class="sgg-name" x="${f1(p[0])}" y="${f1(p[1] + 4)}" text-anchor="middle">${esc(city(f.n))}</text>`).join('')}
    </g>` : '';
    return `
  <svg viewBox="0 0 ${W} ${H}" role="group" aria-label="20개 통근 축 지도. 화살표 키로 축을 옮겨 다니며 고를 수 있어요" id="ex-svg">
    <defs><clipPath id="ex-clip"><rect x="0" y="0" width="${W}" height="${H}"/></clipPath></defs>
    <g clip-path="url(#ex-clip)">
    ${base}
    ${OL ? '' : `<circle class="seoul-zone" cx="${f1(sx0)}" cy="${f1(sy0 - 4)}" r="${f1(13 * pxPerKm)}"/>`}
    <text class="seoul-label" x="${f1(sx0)}" y="${f1(sy0 - 13 * pxPerKm - 8)}" text-anchor="middle" aria-hidden="true">서울</text>
    <g class="ex-routes" id="ex-routes" aria-hidden="true"${document.getElementById('ex-routes-on')?.checked ? '' : ' hidden'}>
      ${RT.map((r) => { const [a, b] = P(r.origin_lon, r.origin_lat), [c, d] = P(r.dest_lon, r.dest_lat);
        return `<line class="rt" x1="${f1(a)}" y1="${f1(b)}" x2="${f1(c)}" y2="${f1(d)}"/><circle class="rt-o" cx="${f1(a)}" cy="${f1(b)}" r="3"/>`; }).join('')}
    </g>
    <g id="ex-axes">
      ${order.map((a) => { const g = G.get(a.id); return `
      <g class="ex-axis ${a.seoul ? 's' : 'g'}${a.alloc_am ? ' is-alloc' : ''}" data-id="${a.id}" role="button" tabindex="-1" aria-pressed="false" aria-label="${esc(axisLabel(a))}">
        <path class="ln" d="${g.d}" stroke-width="${f1(width(a))}"/></g>`; }).join('')}
    </g>
    <path class="ex-hov" id="ex-hov" d="" pointer-events="none"/>
    <g id="ex-sel" pointer-events="none"></g>
    <path class="ex-focus" id="ex-focus" d="" pointer-events="none"/>
    <g pointer-events="none" aria-hidden="true">
      ${AX.map((a) => { const [x, y] = P(a.dest_lon, a.dest_lat); return `<rect class="ex-pt-d" x="${f1(x - 3.5)}" y="${f1(y - 3.5)}" width="7" height="7" rx="1"/>`; }).join('')}
      ${[...origins].map(([, [x, y]]) => `<circle class="ex-pt-o" cx="${f1(x)}" cy="${f1(y)}" r="4.5"/>`).join('')}
      ${[...origins].map(([n, [x, y]]) => `<text class="city" x="${f1(x + (LEFT.has(n) ? -8 : 8))}" y="${f1(y + 4)}" text-anchor="${LEFT.has(n) ? 'end' : 'start'}">${esc(city(n))}</text>`).join('')}
      ${AX.filter((a) => a.alloc_am).map((a) => { const g = G.get(a.id); return `<g class="ex-badge"><rect x="${f1(g.mx - 17)}" y="${f1(g.my - 9)}" width="34" height="18" rx="9"/><text x="${f1(g.mx)}" y="${f1(g.my + 4)}">${a.alloc_am}회</text></g>`; }).join('')}
      <g id="ex-sel-top"></g>
      <line class="scalebar" x1="${PADL}" y1="${H - 14}" x2="${f1(PADL + 10 * pxPerKm)}" y2="${H - 14}"/>
      <line class="scalebar" x1="${PADL}" y1="${H - 18}" x2="${PADL}" y2="${H - 10}"/><line class="scalebar" x1="${f1(PADL + 10 * pxPerKm)}" y1="${H - 18}" x2="${f1(PADL + 10 * pxPerKm)}" y2="${H - 10}"/>
      <text class="scale-t" x="${f1(PADL + 10 * pxPerKm + 6)}" y="${H - 10}">10 km</text>
      <g class="north" transform="translate(${W - 16} 18)"><path d="M0 -9L5.5 5L0 2L-5.5 5Z"/><text x="0" y="19" text-anchor="middle">북</text></g>
    </g>
    </g>
  </svg>`;
  }

  const listRows = AX.map((a) => `
    <tr data-id="${a.id}">
      <th scope="row"><button type="button" class="ex-pick" data-id="${a.id}" style="--c:var(${a.seoul ? '--seoul' : '--car'})" aria-pressed="false"><i aria-hidden="true"></i>${esc(axisName(a.key))}</button></th>
      <td class="num">${a.PCTR.toFixed(2)}</td>
      <td class="num">${Math.round(a.T_car)} / ${Math.round(a.T_transit)}분</td>
      <td><span class="tag ${TAG[a.diag] ?? 'tag--hold'}">${esc(a.diag)}</span></td>
      <td class="num">${int(a.Q_car)}명</td>
      <td class="num">${a.alloc_am ? `${a.alloc_am}회<br><span class="pos">${sgn(tryNet(a, a.alloc_am).t)}</span>` : '—'}</td>
    </tr>`).join('');

  // 축 칩(좁은 화면): 배분된 축부터
  const chipOrder = AX.slice().sort((a, b) => (b.alloc_am > 0) - (a.alloc_am > 0) || b.Q_car - a.Q_car);
  const axisChips = `
    <div class="ex-chips" role="group" aria-label="축 목록에서 고르기">
      ${chipOrder.map((a) => `<button type="button" class="ex-chip" data-id="${a.id}" aria-pressed="false" style="--c:var(${a.seoul ? '--seoul' : '--car'})"><i aria-hidden="true"></i>${esc(axisName(a.key))}${a.alloc_am ? ` <b>${a.alloc_am}회</b>` : ''}</button>`).join('')}
    </div>`;

  // 내 통근길 찾기: 출발 시군(경기 31개, 경계 파일이 없으면 축·노선 출발지) → 그 시군에서 출발하는 분석 축의 목적지
  const ko = (a, b) => a.localeCompare(b, 'ko');
  const FROMS = (OL ? OL.features.filter((f) => f.s === '경기').map((f) => f.n)
                    : [...new Set([...AX.map((a) => a.origin), ...RT.map((r) => r.origin)])]).sort(ko);
  const DESTS = [...new Set(AX.map((a) => a.dest_sgg))].sort(ko);
  const axesFrom = (n) => AX.filter((a) => a.origin === n);
  const fromPt = (n) => {
    const a = AX.find((x) => x.origin === n);
    if (a) return [a.origin_lon, a.origin_lat];
    const f = OL && OL.features.find((x) => x.n === n);
    if (f) return f.c;
    const r = RT.find((x) => x.origin === n);
    return r ? [r.origin_lon, r.origin_lat] : null;
  };
  const toPt = (n) => { const a = AX.find((x) => x.dest_sgg === n); return [a.dest_lon, a.dest_lat]; };
  const km = (p, q) => Math.hypot((p[0] - q[0]) * kx, p[1] - q[1]) * 111.2;
  const NEAR_KM = 20;   // 출발·목적지 거리 합이 이 안일 때만 '가까운 축'을 권해요
  const OTHER = '__other';
  const finder = `
    <div class="panel ex-find" role="group" aria-labelledby="ex-find-title">
      <h3 id="ex-find-title">내 통근길 찾기</h3>
      <div class="ex-find-row">
        <label class="ex-field"><span>출발 시군</span>
          <select class="field" id="ex-from"><option value="">고르세요</option>${FROMS.map((n) => {
            const k = axesFrom(n).length;
            return `<option value="${esc(n)}">${esc(n)}${k ? ` (분석 축 ${k}개)` : ''}</option>`;
          }).join('')}</select></label>
        <span class="ex-find-arrow" aria-hidden="true">→</span>
        <label class="ex-field"><span>목적지 <small id="ex-to-sub">출발 시군을 먼저 골라 주세요</small></span>
          <select class="field" id="ex-to" disabled><option value="">고르세요</option></select></label>
      </div>
      <div class="ex-find-out" id="ex-find-out" aria-live="polite"><p>출발 시군을 고르면 그곳에서 출발하는 분석 축의 목적지가 나와요.</p></div>
    </div>`;

  root.removeAttribute('data-state');
  root.innerHTML = `
  <div class="ex" id="ex">
    <div class="ex-bar">
      <div class="toggle" role="group" aria-label="보기 방식">
        <button type="button" data-view="map" aria-pressed="true">지도로 보기</button>
        <button type="button" data-view="list" aria-pressed="false">목록으로 보기</button>
      </div>
      <label class="switch"><input type="checkbox" id="ex-routes-on"><span>현행 편하G 28개 노선 겹쳐 보기</span></label>
    </div>
    ${finder}
    <div class="ex-grid">
      <div class="ex-left">
        <div class="panel ex-view ex-map" id="ex-map">
          <ul class="key">
            <li><span class="sw sw--car"></span>경기 내부 축</li><li><span class="sw sw--seoul"></span>서울행 축</li>
            <li><span class="sw sw--pill"></span>증편 배분 출근 회차</li><li><span class="sw sw--ring"></span>출발 시군</li><li><span class="sw" style="background:var(--asphalt)"></span>목적지</li>
            <li id="ex-key-rt" hidden><span class="sw sw--thin"></span>현행 편하G 노선</li>
          </ul>
          <div class="ex-svgbox" id="ex-svgbox"><div class="ex-tip" id="ex-tip" hidden></div></div>
          <div class="ex-strip" id="ex-strip"></div>
          ${axisChips}
          <p class="ex-hint" id="ex-map-hint">선 굵기는 승용차 통근자 수예요. 축 가까이를 누르면 가장 가까운 축을 골라요. 지도를 고른 뒤 화살표 키로 옮겨 다닐 수도 있어요. 고른 축은 출발 행정동 5곳(작은 원)도 보여요.</p>
          <p class="ex-hint" id="ex-rt-hint" hidden>지도 범위는 20개 축에 맞췄어요. 가평에서 출발하는 노선(P7001)은 지도 오른쪽 밖에서 들어와요.</p>
          ${OL ? `<p class="ex-attr">배경 경계: 통계청 SGIS 행정동 경계(공공누리 제1유형)를 <a href="https://github.com/vuski/admdongkor">vuski/admdongkor</a>가 가공한 자료(CC BY 4.0)를 시군 단위로 합치고 단순화했어요. 경기 시군과 서울 자치구만 그렸어요.</p>` : ''}
        </div>
        <div class="panel ex-view ex-list" id="ex-list" hidden>
          <div class="tablewrap"><table class="data">
            <caption>PCTR은 대중교통 시간 ÷ 승용차 시간(출발점 5곳 인구가중). 증편 배분은 출근 회차와 연 순감축(tCO₂/년)이에요. 이름을 누르면 자세히 나와요.</caption>
            <thead><tr><th scope="col">축</th><th scope="col" class="num">PCTR</th><th scope="col" class="num">승용차/대중교통</th><th scope="col">진단</th><th scope="col" class="num">승용차 통근</th><th scope="col" class="num">증편 배분</th></tr></thead>
            <tbody>${listRows}</tbody>
          </table></div>
        </div>
      </div>
      <div class="panel ex-detail" id="ex-detail" aria-labelledby="ex-d-title" tabindex="-1"></div>
    </div>
    <p class="sr-only" aria-live="polite" id="ex-live"></p>
  </div>`;

  const $ = (q) => root.querySelector(q);
  const mapEl = $('#ex-map'), box = $('#ex-svgbox'), tip = $('#ex-tip');
  let svgEl = null, axisEls = [];
  const byId = new Map(AX.map((a) => [a.id, a]));
  const navOrder = AX.map((a) => a.id);
  let liveTimer = 0, refreshFinder = () => {};
  const say = (t, delay = 500) => { clearTimeout(liveTimer); liveTimer = setTimeout(() => { $('#ex-live').textContent = t; }, delay); };

  function drawSel() {
    if (!svgEl) return;
    const g = G.get(sel.id), a = sel;
    const w = width(a);
    const [dx, dy] = P(a.dest_lon, a.dest_lat);
    const [ox, oy] = P(a.origin_lon, a.origin_lat);
    svgEl.querySelector('#ex-sel').innerHTML = `<path class="ex-sel-case" d="${g.d}" stroke-width="${f1(w + 4)}"/><path class="ex-sel-line ${a.seoul ? 's' : 'g'}" d="${g.d}" stroke-width="${f1(w)}"/>`;
    const five = a.origin_points.map((p) => { const [x, y] = P(p.lon, p.lat); return `<line class="ex-five-ln" x1="${f1(ox)}" y1="${f1(oy)}" x2="${f1(x)}" y2="${f1(y)}"/><circle class="ex-pt-five" cx="${f1(x)}" cy="${f1(y)}" r="3"/>`; }).join('');
    svgEl.querySelector('#ex-sel-top').innerHTML = five + `<rect class="ex-pt-d" x="${f1(dx - 4.5)}" y="${f1(dy - 4.5)}" width="9" height="9" rx="1"/>` +
      `<text class="ex-destlabel" x="${f1(dx)}" y="${f1(dy + (dy > H - 60 ? -10 : 20))}" text-anchor="${dx < 70 ? 'start' : dx > W - 70 ? 'end' : 'middle'}">${esc(a.dest)}</text>`;
    mapEl.classList.add('has-sel');
    axisEls.forEach((el) => {
      const on = +el.dataset.id === sel.id;
      el.classList.toggle('is-sel', on);
      el.setAttribute('aria-pressed', String(on));
      el.setAttribute('tabindex', on ? '0' : '-1');
    });
  }
  function syncPicks() {
    root.querySelectorAll('.ex-list tbody tr').forEach((tr) => tr.classList.toggle('is-sel', +tr.dataset.id === sel.id));
    root.querySelectorAll('.ex-pick, .ex-chip').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.id === sel.id)));
  }

  // 시나리오: 이 축에 n회 넣으면
  function tryNet(a, n) {
    const cand = a.bus_candidate && a.model_D_day != null;
    const alloc = [{ key: a.key, km: cand ? a.model_km : a.car_km, tripsAM: n, ...(cand ? { D: a.model_D_day, phi: a.model_phi } : {}) }];
    const r = annualNet(cand ? { allocation: alloc } : { allocation: alloc, N: C.TARGET_RIDE, phi: C.TARGET_PHI });
    const perN = n ? r.riders / n : (cand ? Math.min(C.COACH_CAP, a.model_D_day) : C.TARGET_RIDE);
    const phi = cand ? a.model_phi : C.TARGET_PHI;
    return { cand, t: r.tYear, riders: r.riders, carShift: r.carShift, perN, phi, mstar: breakeven({ N: perN }).mstar };
  }
  const assume = (r) => (r.cand ? `모형 수요 가정: 회당 ${f1(r.perN)}명·φ ${r.phi.toFixed(2)}` : `현행 편하G 수준 가정: 회당 ${f1(r.perN)}명·φ ${r.phi.toFixed(2)}`);

  function renderTry() {
    const a = sel, n = tries.get(a.id);
    const r = tryNet(a, n);
    const inp = $('#ex-try-n');
    inp.value = n;
    inp.style.setProperty('--fill', (n / 15) * 100 + '%');
    $('#ex-try-n-out').textContent = `${n}회`;
    const v = $('#ex-try-t');
    v.textContent = n ? sgn(r.t) : '0';
    v.dataset.value = String(Math.round(r.t * 10) / 10);
    const ro = $('#ex-try-ro');
    ro.classList.toggle('is-cut', n > 0 && r.t >= 0.5);
    ro.classList.toggle('is-add', n > 0 && r.t <= -0.5);
    const m = r.perN * r.phi;
    $('#ex-try-meta').innerHTML = n
      ? `회당 ${f1(r.perN)}명 탑승, 승용차 출신 <b class="${m >= r.mstar ? 'pos' : 'neg'}">${f1(m)}명</b> (본전 ${f1(r.mstar)}명) · 하루 승용차 출신 ${int(r.carShift)}명`
      : '운행이 없으면 변화도 없어요.';
    const rep = $('#ex-try-rep');
    if (rep) rep.textContent = n === a.alloc_am ? '보고서 배분과 같아요' : `보고서 배분 ${a.alloc_am}회와 달라요`;
    renderStrip(r, n);
    return r;
  }

  // 좁은 화면: 지도 바로 아래 한 줄 요약
  function renderStrip(r, n) {
    const a = sel;
    $('#ex-strip').innerHTML = `
      <span class="ex-strip-name" style="--c:var(${a.seoul ? '--seoul' : '--car'})"><i aria-hidden="true"></i>${esc(axisName(a.key))}</span>
      <span>PCTR <b>${a.PCTR.toFixed(2)}</b></span>
      <span class="tag ${TAG[a.diag] ?? 'tag--hold'}">${esc(a.diag)}</span>
      <span>${a.alloc_am ? `배분 ${a.alloc_am}회` : '배분 없음'}</span>
      <span>출근 ${n}회 <b class="${n && r.t >= 0.5 ? 'pos' : n && r.t <= -0.5 ? 'neg' : ''}">${n ? sgn(r.t) : '0'}</b> tCO₂/년</span>
      <button type="button" class="chip ex-strip-go" id="ex-strip-go">자세히</button>`;
    $('#ex-strip-go').addEventListener('click', () => {
      const d = $('#ex-detail');
      d.scrollIntoView({ behavior: reduceMQ.matches ? 'auto' : 'smooth', block: 'start' });
      d.focus({ preventScroll: true });
    });
  }

  function renderDetail() {
    const a = sel;
    const lo = 0.4, hi = 3.2, X = (v) => ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * 100 + '%';
    const tMax = 160, TW = (v) => (v / tMax) * 82 + '%';
    const share = Math.round((a.Q_car / a.Q_od) * 100);
    const cand = a.bus_candidate && a.model_D_day != null;
    const times = [
      ['승용차', a.T_car, 'var(--car)'],
      ['대중교통', a.T_transit, 'var(--transit)'],
      ...(a.T_new_bus != null ? [['단지 정차 직행', a.T_new_bus, 'var(--asphalt)']] : []),
    ];
    const ratio = a.PCTR >= 1 ? `대중교통으로 가면 승용차보다 ${a.PCTR.toFixed(2)}배 걸려요` : `대중교통이 승용차보다 빨라요(시간 비 ${a.PCTR.toFixed(2)})`;
    $('#ex-detail').innerHTML = `
      <div>
        <h3 id="ex-d-title">${esc(axisName(a.key))}</h3>
        <p class="ex-dest">목적지 ${esc(a.dest)} (${esc(a.dest_sgg)}) · 승용차 거리 ${a.car_km} km</p>
        <div class="ex-tags">
          <span class="tag ${a.seoul ? 'tag--s' : 'tag--g'}">${a.seoul ? '서울행' : '경기 내부'}</span>
          <span class="tag ${TAG[a.diag] ?? 'tag--hold'}">진단: ${esc(a.diag)}</span>
          ${a.service && a.service !== a.diag ? `<span class="tag tag--hold">권장: 단지 정차 ${esc(a.service)}</span>` : ''}
          ${a.alloc_am ? `<span class="tag tag--alloc">증편 출근 ${a.alloc_am}회 배분</span>` : ''}
        </div>
      </div>
      <div class="ex-sec">
        <h4>PCTR (대중교통 시간 ÷ 승용차 시간)</h4>
        <div class="ex-pctr"><span class="big" style="color:var(${a.seoul ? '--seoul-ink' : '--car-ink'})">${a.PCTR.toFixed(2)}</span>
          <p>${ratio}. 출발점 ${a.n_pts}곳 범위 ${a.PCTR_min.toFixed(2)}~${a.PCTR_max.toFixed(2)}.</p></div>
        <div class="ex-range" style="--c:var(${a.seoul ? '--seoul' : '--car'})" role="img" aria-label="출발점 ${a.n_pts}곳 PCTR ${a.PCTR_min}에서 ${a.PCTR_max}, 인구가중 ${a.PCTR.toFixed(2)}. 1.5 미만은 수요관리">
          <i class="trk"></i><i class="band" style="--a:${X(a.PCTR_min)};--b:${X(a.PCTR_max)}"></i>
          <i class="th" style="--v:${X(1)}"><span>1 같음</span></i><i class="th" style="--v:${X(1.5)}"><span>1.5 직행 기준</span></i>
          <i class="dot" style="--v:${X(a.PCTR)}"></i>
          <span class="tk" style="left:${X(0.5)}">0.5</span><span class="tk" style="left:${X(2)}">2</span><span class="tk" style="left:${X(2.5)}">2.5</span><span class="tk" style="left:${X(3)}">3</span>
        </div>
      </div>
      <div class="ex-sec">
        <h4>출근 문전 시간 (출발점 ${a.n_pts}곳 인구가중, 분)</h4>
        <ul class="ex-times">${times.map(([n, v, c]) => `<li><span>${n}</span><span class="tb" style="--w:${TW(v)};--c:${c}"><i></i><span>${Math.round(v)}분</span></span></li>`).join('')}</ul>
        ${a.T_new_bus != null ? `<p class="ex-hint">대중교통 ${Math.round(a.T_transit)}분 → 단지 정차 직행 ${Math.round(a.T_new_bus)}분.</p>` : ''}
      </div>
      <dl class="ex-facts ex-sec">
        <div><dt>승용차 통근자 (전체 ${int(a.Q_od)}명의 ${share}%)</dt><dd>${int(a.Q_car)}<small>명</small></dd></div>
        <div><dt>평균 도보 (대중교통 경로)</dt><dd>${Math.round(a.walk)}<small>분</small></dd></div>
        <div><dt>평균 환승</dt><dd>${a.xfer.toFixed(1)}<small>회</small></dd></div>
        <div><dt>φ 참고값 (현재 승용차 분담률, 상한 쪽)</dt><dd>${a.phi_proxy.toFixed(2)}</dd></div>
        ${cand ? `<div><dt>모형 φ (상한 0.5로 자름)</dt><dd>${a.model_phi.toFixed(2)}</dd></div>` : ''}
      </dl>
      <div class="ex-try">
        <label class="ctl"><span class="ctl-label">이 축에 출근 n회 넣어 보기<small>퇴근도 같은 횟수${a.alloc_am ? ` · 처음 값은 보고서 배분 ${a.alloc_am}회` : ''}</small></span>
          <input class="range" type="range" id="ex-try-n" min="0" max="15" step="1">
          <output class="ctl-out" id="ex-try-n-out" for="ex-try-n"></output></label>
        <div class="ex-try-out">
          <div class="readout" id="ex-try-ro"><span class="readout-label">연간 순감축</span>
            <span class="readout-value"><span id="ex-try-t" data-testid="axis-t">0</span><span class="readout-unit">tCO₂/년</span></span></div>
          ${a.alloc_am ? '<span class="ex-try-rep" id="ex-try-rep"></span>' : ''}
        </div>
        <p id="ex-try-meta"></p>
        <p>${cand
          ? '<b>모형 수요</b>로 계산해요: 이 축의 하루 수요를 회차로 나눈 만큼 타되 정원 44석까지, φ는 모형값.'
          : `<b>모형 수요가 없는 축</b>(버스 처방 후보 아님)이라 현행 편하G 수준인 회당 ${C.TARGET_RIDE}명·φ ${C.TARGET_PHI}로 가정했어요. 진단이 수요관리라 처음 값은 0회예요.`}
          차량은 보고서 기본값(디젤 ${C.COACH_KMPL} km/L, 회송 ${C.R_DH}회, 승용차 재차 ${C.CAR_OCC}명, 연 ${C.WORKDAYS}일)이에요.</p>
      </div>`;
    $('#ex-try-n').addEventListener('input', (e) => {
      tries.set(sel.id, +e.target.value);
      const r = renderTry();
      refreshFinder();
      say(`출근 ${tries.get(sel.id)}회, 연간 ${sgn(r.t)} 톤`, 800);
    });
    renderTry();
  }

  function select(id, { announce = true } = {}) {
    sel = byId.get(id);
    drawSel();
    syncPicks();
    renderDetail();
    if (announce) say(`${axisName(sel.key)} 선택. PCTR ${sel.PCTR.toFixed(2)}, ${sel.diag}${sel.alloc_am ? `, 증편 ${sel.alloc_am}회` : ''}.`, 300);
  }

  // ───────── 가장 가까운 축 ─────────
  // 누른 점에서 각 축 중심선까지 거리 − 선 굵기 절반. 화면 px로 따져 문턱(마우스 14px, 터치 22px) 안에서 가장 가까운 축.
  function nearest(clientX, clientY, touch) {
    const m = svgEl.getScreenCTM();
    if (!m) return null;
    const pt = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    const scale = Math.hypot(m.a, m.b) || 1;
    let best = null;
    for (const a of AX) {
      const smp = G.get(a.id).smp;
      let dmin = Infinity;
      for (let i = 0; i < smp.length - 1; i++) {
        const [x0, y0] = smp[i], [x1, y1] = smp[i + 1];
        const vx = x1 - x0, vy = y1 - y0, L2 = vx * vx + vy * vy || 1;
        const t = Math.max(0, Math.min(1, ((pt.x - x0) * vx + (pt.y - y0) * vy) / L2));
        const d = Math.hypot(pt.x - (x0 + t * vx), pt.y - (y0 + t * vy));
        if (d < dmin) dmin = d;
      }
      const eff = Math.max(0, dmin - width(a) / 2) * scale;
      // 같은 거리면 지금 고른 축을 유지하지 않고, 중심선에 더 가까운 축
      if (!best || eff < best.eff - 0.01 || (Math.abs(eff - best.eff) <= 0.01 && dmin < best.dmin)) best = { a, eff, dmin };
    }
    return best && best.eff <= (touch ? 22 : 14) ? best.a : null;
  }

  function showHover(a, clientX, clientY) {
    const hov = svgEl.querySelector('#ex-hov');
    if (!a) {
      hov.setAttribute('d', '');
      tip.hidden = true;
      svgEl.classList.remove('is-hot');
      return;
    }
    const g = G.get(a.id);
    hov.setAttribute('d', g.d);
    hov.setAttribute('stroke-width', f1(width(a) + 3));
    hov.setAttribute('class', `ex-hov ${a.seoul ? 's' : 'g'}`);
    svgEl.classList.add('is-hot');
    tip.innerHTML = `<b>${esc(axisName(a.key))}</b> · PCTR ${a.PCTR.toFixed(2)} · ${esc(a.diag)}${a.alloc_am ? ` · ${a.alloc_am}회` : ''}`;
    tip.hidden = false;
    const r = box.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    const tw = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(r.width - tw, x - tw / 2)) + 'px';
    tip.style.top = Math.max(0, y - 40) + 'px';
  }

  let pointer = false;
  function bindMap() {
    svgEl = box.querySelector('#ex-svg');
    axisEls = [...svgEl.querySelectorAll('.ex-axis')];
    axisEls.forEach((el) => {
      el.addEventListener('focus', () => {
        mapEl.classList.toggle('kbd', !pointer);
        svgEl.querySelector('#ex-focus').setAttribute('d', G.get(+el.dataset.id).d);
        pointer = false;
      });
      el.addEventListener('blur', () => mapEl.classList.remove('kbd'));
      el.addEventListener('keydown', (e) => {
        const i = navOrder.indexOf(+el.dataset.id);
        let j = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % navOrder.length;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + navOrder.length) % navOrder.length;
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = navOrder.length - 1;
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(+el.dataset.id); return; }
        if (j == null) return;
        e.preventDefault();
        select(navOrder[j]);
        axisEls.find((x) => +x.dataset.id === navOrder[j]).focus();
      });
    });
    let downType = 'mouse';
    svgEl.addEventListener('pointerdown', (e) => { pointer = true; downType = e.pointerType; });
    svgEl.addEventListener('click', (e) => {
      const a = nearest(e.clientX, e.clientY, downType === 'touch' || downType === 'pen' || coarseMQ.matches);
      if (!a) return;
      showHover(null);
      select(a.id);
      const el = axisEls.find((x) => +x.dataset.id === a.id);
      el.focus({ preventScroll: true });
      mapEl.classList.remove('kbd');
    });
    svgEl.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      showHover(nearest(e.clientX, e.clientY, false), e.clientX, e.clientY);
    });
    svgEl.addEventListener('pointerleave', () => showHover(null));
  }

  function buildMap() {
    const w = box.clientWidth;
    if (!w) return false;
    layout(w);
    tip.hidden = true;
    box.querySelector('#ex-svg')?.remove();
    box.insertAdjacentHTML('afterbegin', mapSvg());
    bindMap();
    drawSel();
    return true;
  }

  // ───────── 이벤트 ─────────
  root.querySelectorAll('.ex-pick, .ex-chip').forEach((b) => b.addEventListener('click', () => select(+b.dataset.id)));
  root.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    view = b.dataset.view;
    root.querySelectorAll('[data-view]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.view === view)));
    $('#ex-map').hidden = view !== 'map';
    $('#ex-list').hidden = view !== 'list';
    $('#ex').classList.toggle('is-list', view === 'list');
    if (view === 'map' && Math.abs(Math.min(480, box.clientWidth) - W) > 24) buildMap();
  }));
  $('#ex-routes-on').addEventListener('change', (e) => {
    svgEl?.querySelector('#ex-routes')?.toggleAttribute('hidden', !e.target.checked);
    $('#ex-key-rt').hidden = !e.target.checked;
    $('#ex-rt-hint').hidden = !e.target.checked;
    say(e.target.checked ? '현행 편하G 28개 노선을 점선으로 겹쳐 보여요.' : '현행 노선을 숨겼어요.', 200);
  });

  // ───────── 내 통근길 찾기 ─────────
  const fromSel = $('#ex-from'), toSel = $('#ex-to'), findOut = $('#ex-find-out'), toSub = $('#ex-to-sub');
  let found = null;
  function findText(a) {
    const n = tries.get(a.id);
    const r = tryNet(a, n);
    const tt = `대중교통 ${Math.round(a.T_transit)}분 ÷ 승용차 ${Math.round(a.T_car)}분, PCTR ${a.PCTR.toFixed(2)}${a.PCTR < 1 ? '(대중교통이 더 빨라요)' : ''}`;
    const add = n ? `출근 ${n}회를 넣으면 ${sgn(r.t)} tCO₂/년이에요(${assume(r)})` : '출근 0회면 변화가 없어요';
    return `<b>${esc(axisName(a.key))}</b>: ${tt}. 진단은 ‘${esc(a.diag)}’, ${add}.`;
  }
  function fillDests() {
    const from = fromSel.value;
    found = null;
    if (!from) {
      toSel.innerHTML = '<option value="">고르세요</option>';
      toSel.disabled = true;
      toSub.textContent = '출발 시군을 먼저 골라 주세요';
      return;
    }
    const own = axesFrom(from);
    toSel.disabled = false;
    if (own.length) {
      toSub.textContent = `${from}에서 출발하는 분석 축`;
      toSel.innerHTML = '<option value="">고르세요</option>'
        + own.map((a) => `<option value="${esc(a.dest_sgg)}">${esc(a.dest_sgg)}</option>`).join('')
        + `<option value="${OTHER}">그 밖의 목적지</option>`;
      if (own.length === 1) toSel.value = own[0].dest_sgg;
    } else {
      toSub.textContent = '분석한 20개 축의 목적지';
      toSel.innerHTML = '<option value="">고르세요</option>' + DESTS.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    }
  }
  function updateFinder() {
    const from = fromSel.value, to = toSel.value;
    found = null;
    mapEl.classList.remove('has-find');
    if (!from) { findOut.innerHTML = '<p>출발 시군을 고르면 그곳에서 출발하는 분석 축의 목적지가 나와요.</p>'; return; }
    const own = axesFrom(from);
    const noAxis = `분석 범위(승용차 통근 상위 20개 축)에 ${esc(from)}에서 출발하는 축이 없어요.`;
    if (!to) {
      findOut.innerHTML = own.length
        ? `<p>${esc(from)}에서 출발하는 분석 축은 ${own.length}개예요. 목적지를 골라 주세요.</p>`
        : `<p>${noAxis} 목적지를 고르면 출발지·목적지가 모두 가까운 축이 있는지 찾아 볼게요.</p>`;
      return;
    }
    if (to === OTHER) {
      findOut.innerHTML = `<p>${esc(from)}에서 출발하는 분석 축은 아래 ${own.length}개뿐이에요. 다른 목적지로 가는 통근은 상위 20개 축에 들지 않았어요.</p>`
        + `<div class="chips">${own.map((a) => `<button type="button" class="chip ex-find-pick" data-id="${a.id}">${esc(axisName(a.key))}</button>`).join('')}</div>`;
      findOut.querySelectorAll('.ex-find-pick').forEach((b) => b.addEventListener('click', () => {
        select(+b.dataset.id);
        found = byId.get(+b.dataset.id);
        findOut.querySelector('p').innerHTML = findText(found);
      }));
      return;
    }
    const hit = AX.find((a) => a.origin === from && a.dest_sgg === to);
    if (hit) {
      found = hit;
      if (sel.id !== hit.id) select(hit.id, { announce: false });
      mapEl.classList.add('has-find');
      findOut.innerHTML = `<p>${findText(hit)}</p><p class="ex-find-sub">지도와 상세에서 이 축을 골라 뒀어요. 상세의 슬라이더로 회차를 바꾸면 이 문장도 바뀌어요.</p>`;
      return;
    }
    // 출발지에 분석 축이 없을 때만 여기로 와요
    const p = fromPt(from), q = toPt(to);
    let best = null;
    if (p) for (const a of AX) {
      const dO = km(p, [a.origin_lon, a.origin_lat]), dD = km(q, [a.dest_lon, a.dest_lat]);
      if (!best || dO + dD < best.dO + best.dD) best = { a, dO, dD };
    }
    const same = to === from || to.startsWith(from + ' ');
    const head = `<p>${same ? '같은 시군 안 통근은 분석에 넣지 않았어요. ' : ''}${noAxis}</p>`;
    if (best && best.dO + best.dD <= NEAR_KM) {
      const o = Math.round(best.dO), d = Math.round(best.dD);
      const why = o < 1 ? `목적지가 약 ${d} km 떨어져 있어요` : d < 1 ? `목적지는 같고 출발지 대표점이 약 ${o} km 떨어져 있어요` : `출발지 대표점이 약 ${o} km, 목적지가 약 ${d} km 떨어져 있어요`;
      findOut.innerHTML = head + `<p>비슷한 통근길로는 <b>${esc(axisName(best.a.key))}</b>${eyo(axisName(best.a.key))}(${why}).</p>`
        + `<button type="button" class="chip" id="ex-find-near" data-id="${best.a.id}">그 축 보기</button>`;
      const nb = $('#ex-find-near');
      nb.addEventListener('click', () => {
        select(best.a.id);
        findOut.insertAdjacentHTML('beforeend', `<p class="ex-find-sub">${findText(best.a)}</p>`);
        nb.remove();
      });
    } else {
      findOut.innerHTML = head + `<p class="ex-find-sub">출발지와 목적지가 함께 ${NEAR_KM} km 안에 드는 비슷한 축도 없어요.</p>`;
    }
  }
  fromSel.addEventListener('change', () => { fillDests(); updateFinder(); });
  toSel.addEventListener('change', updateFinder);
  refreshFinder = () => { if (found && found.id === sel.id) findOut.querySelector('p').innerHTML = findText(found); };

  // 지도는 실제 너비로 그려요. 너비가 꽤 바뀌면 다시 그려요
  buildMap();
  if ('ResizeObserver' in window) {
    let t = 0;
    new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => { if (view === 'map' && box.clientWidth && Math.abs(Math.min(480, box.clientWidth) - W) > 24) buildMap(); }, 150);
    }).observe(box);
  }
  select(sel.id, { announce: false });
}
