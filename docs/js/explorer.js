// 축 탐색기: 20개 통근 축 + 현행 편하G 28개 노선
// 좌표는 model.json(출발 행정동 5곳 인구가중 대표점, 목적지 대표점, 편하G 정류장)을 단순 등장방형 투영으로 그려요.
// 경기도 윤곽은 저장소에 없어서 그리지 않아요. 계산은 js/model.js의 annualNet·breakeven.
import { loadModel, getModel, annualNet, breakeven } from './model.js';

const root = document.getElementById('explorer-root');
const MODEL_URL = new URL('../data/model.json', import.meta.url).href;
const MINUS = '−';
const sgn = (v, d = 0) => {
  const r = +v.toFixed(d);
  return (r > 0 ? '+' : r < 0 ? MINUS : '') + Math.abs(r).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
};
const int = (v) => Math.round(v).toLocaleString('ko-KR');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const city = (s) => s.replace(/^(\S+?)(시|군)(?=\s|$)/, '$1').replace(/^(\S+?)시(\S+구)$/, '$1 $2');
const axisName = (key) => key.split('→').map(city).join('→');
const TAG = { '수요관리': 'tag--demand', 'DRT 연계': 'tag--drt', '출퇴근 직행': 'tag--direct', '보류': 'tag--hold' };

if (root) {
  loadModel(MODEL_URL).then(start).catch((e) => {
    root.querySelector('.mount-empty').textContent = '지도 데이터를 불러오지 못했어요. 페이지를 새로 고쳐 주세요.';
    console.error(e);
  });
}

function start() {
  const M = getModel();
  const C = M.constants;
  const AX = M.axes.slice().sort((a, b) => a.id - b.id);
  const RT = M.routes;
  const tries = new Map(AX.map((a) => [a.id, a.alloc_am || 5]));
  let sel = AX.find((a) => a.key === '평택시→화성시') ?? AX[0];
  let view = 'map';

  // ───────── 투영 ─────────
  const pts = [];
  AX.forEach((a) => { pts.push([a.origin_lon, a.origin_lat], [a.dest_lon, a.dest_lat]); a.origin_points.forEach((p) => pts.push([p.lon, p.lat])); });
  RT.forEach((r) => pts.push([r.origin_lon, r.origin_lat], [r.dest_lon, r.dest_lat]));
  const lonMin = Math.min(...pts.map((p) => p[0])), lonMax = Math.max(...pts.map((p) => p[0]));
  const latMin = Math.min(...pts.map((p) => p[1])), latMax = Math.max(...pts.map((p) => p[1]));
  const kx = Math.cos(((latMin + latMax) / 2) * Math.PI / 180);
  const W = 440, PAD = 26;
  const s = (W - 2 * PAD) / ((lonMax - lonMin) * kx);
  const H = Math.round((latMax - latMin) * s + 2 * PAD + 14);
  const P = (lon, lat) => [PAD + (lon - lonMin) * kx * s, PAD + (latMax - lat) * s];
  const pxPerKm = s / 111.2;
  const f1 = (v) => v.toFixed(1);

  const qMax = Math.max(...AX.map((a) => a.Q_car));
  const width = (a) => 2 + 9 * Math.sqrt(a.Q_car / qMax);
  const geom = (a) => {
    const [x0, y0] = P(a.origin_lon, a.origin_lat), [x1, y1] = P(a.dest_lon, a.dest_lat);
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
    const k = 0.13 * L;
    const cx = (x0 + x1) / 2 - (dy / L) * k, cy = (y0 + y1) / 2 + (dx / L) * k;
    return { d: `M${f1(x0)} ${f1(y0)}Q${f1(cx)} ${f1(cy)} ${f1(x1)} ${f1(y1)}`, x0, y0, x1, y1,
             mx: 0.25 * x0 + 0.5 * cx + 0.25 * x1, my: 0.25 * y0 + 0.5 * cy + 0.25 * y1 };
  };
  const G = new Map(AX.map((a) => [a.id, geom(a)]));

  // 시군 이름(출발 시군). 겹치는 곳만 왼쪽으로
  const LEFT = new Set(['화성시', '수원시', '안산시', '시흥시', '고양시', '파주시']);
  const origins = new Map();
  AX.forEach((a) => { if (!origins.has(a.origin)) origins.set(a.origin, P(a.origin_lon, a.origin_lat)); });
  const seoulDest = AX.filter((a) => a.seoul);
  const [sx0, sy0] = P(seoulDest.reduce((t, a) => t + a.dest_lon, 0) / seoulDest.length, seoulDest.reduce((t, a) => t + a.dest_lat, 0) / seoulDest.length);

  const order = AX.slice().sort((a, b) => (a.alloc_am > 0) - (b.alloc_am > 0) || b.Q_car - a.Q_car);
  const axisLabel = (a) => `${axisName(a.key)}, ${a.seoul ? '서울행' : '경기 내부'}, PCTR ${a.PCTR.toFixed(2)}, ${a.diag}${a.alloc_am ? `, 증편 출근 ${a.alloc_am}회 배분` : ''}`;

  const svg = `
  <svg viewBox="0 0 ${W} ${H}" role="group" aria-label="20개 통근 축 지도. 화살표 키로 축을 옮겨 다니며 고를 수 있어요" id="ex-svg">
    <circle class="seoul-zone" cx="${f1(sx0)}" cy="${f1(sy0 - 4)}" r="${f1(13 * pxPerKm)}"/>
    <text class="seoul-label" x="${f1(sx0)}" y="${f1(sy0 - 13 * pxPerKm - 8)}" text-anchor="middle">서울</text>
    <g class="ex-routes" id="ex-routes" hidden>
      ${RT.map((r) => { const [a, b] = P(r.origin_lon, r.origin_lat), [c, d] = P(r.dest_lon, r.dest_lat);
        return `<line class="rt" x1="${f1(a)}" y1="${f1(b)}" x2="${f1(c)}" y2="${f1(d)}"><title>${esc(r.id)} ${esc(r.origin_stop)}→${esc(r.dest_stop)}</title></line><circle class="rt-o" cx="${f1(a)}" cy="${f1(b)}" r="3"/>`; }).join('')}
    </g>
    <g id="ex-axes">
      ${order.map((a) => { const g = G.get(a.id); return `
      <g class="ex-axis ${a.seoul ? 's' : 'g'}${a.alloc_am ? ' is-alloc' : ''}" data-id="${a.id}" role="button" tabindex="-1" aria-pressed="false" aria-label="${esc(axisLabel(a))}">
        <path class="ln" d="${g.d}" stroke-width="${f1(width(a))}"/><path class="hit" d="${g.d}"/></g>`; }).join('')}
    </g>
    <g id="ex-sel" pointer-events="none"></g>
    <path class="ex-focus" id="ex-focus" d="" pointer-events="none"/>
    <g pointer-events="none">
      ${AX.map((a) => { const [x, y] = P(a.dest_lon, a.dest_lat); return `<rect class="ex-pt-d" x="${f1(x - 3.5)}" y="${f1(y - 3.5)}" width="7" height="7" rx="1"/>`; }).join('')}
      ${[...origins].map(([, [x, y]]) => `<circle class="ex-pt-o" cx="${f1(x)}" cy="${f1(y)}" r="4.5"/>`).join('')}
      ${[...origins].map(([n, [x, y]]) => `<text class="city" x="${f1(x + (LEFT.has(n) ? -8 : 8))}" y="${f1(y + 4)}" text-anchor="${LEFT.has(n) ? 'end' : 'start'}">${esc(city(n))}</text>`).join('')}
      ${AX.filter((a) => a.alloc_am).map((a) => { const g = G.get(a.id); return `<g class="ex-badge"><rect x="${f1(g.mx - 17)}" y="${f1(g.my - 9)}" width="34" height="18" rx="9"/><text x="${f1(g.mx)}" y="${f1(g.my + 4)}">${a.alloc_am}회</text></g>`; }).join('')}
      <g id="ex-sel-top"></g>
      <line class="scalebar" x1="${PAD}" y1="${H - 14}" x2="${f1(PAD + 10 * pxPerKm)}" y2="${H - 14}"/>
      <line class="scalebar" x1="${PAD}" y1="${H - 18}" x2="${PAD}" y2="${H - 10}"/><line class="scalebar" x1="${f1(PAD + 10 * pxPerKm)}" y1="${H - 18}" x2="${f1(PAD + 10 * pxPerKm)}" y2="${H - 10}"/>
      <text class="scale-t" x="${f1(PAD + 10 * pxPerKm + 6)}" y="${H - 10}">10 km</text>
    </g>
  </svg>`;

  const listRows = AX.map((a) => `
    <tr data-id="${a.id}">
      <th scope="row"><button type="button" class="ex-pick" data-id="${a.id}" style="--c:var(${a.seoul ? '--seoul' : '--car'})" aria-pressed="false"><i aria-hidden="true"></i>${esc(axisName(a.key))}</button></th>
      <td class="num">${a.PCTR.toFixed(2)}</td>
      <td class="num">${Math.round(a.T_car)} / ${Math.round(a.T_transit)}분</td>
      <td><span class="tag ${TAG[a.diag] ?? 'tag--hold'}">${esc(a.diag)}</span></td>
      <td class="num">${int(a.Q_car)}명</td>
      <td class="num">${a.alloc_am ? `${a.alloc_am}회<br><span class="pos">${sgn(a.alloc_t_year)} t</span>` : '—'}</td>
    </tr>`).join('');

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
    <div class="ex-grid">
      <div>
        <div class="panel ex-view ex-map" id="ex-map">
          <ul class="key">
            <li><span class="sw sw--car"></span>경기 내부 축</li><li><span class="sw sw--seoul"></span>서울행 축</li>
            <li><span class="sw sw--pill"></span>증편 배분 출근 회차</li><li><span class="sw sw--ring"></span>출발 시군</li><li><span class="sw" style="background:var(--asphalt)"></span>목적지</li>
            <li id="ex-key-rt" hidden><span class="sw sw--thin"></span>현행 편하G 노선</li>
          </ul>
          ${svg}
          <p class="ex-hint">선 굵기는 승용차 통근자 수예요. 축을 누르거나, 지도를 고른 뒤 화살표 키로 옮겨 다닐 수 있어요. 고른 축은 출발 행정동 5곳(작은 원)도 보여요.</p>
        </div>
        <div class="panel ex-view ex-list" id="ex-list" hidden>
          <div class="tablewrap"><table class="data">
            <thead><tr><th scope="col">축</th><th scope="col" class="num">PCTR</th><th scope="col" class="num">승용차/대중교통</th><th scope="col">진단</th><th scope="col" class="num">승용차 통근</th><th scope="col" class="num">증편 배분</th></tr></thead>
            <tbody>${listRows}</tbody>
            <caption>PCTR은 대중교통 시간 ÷ 승용차 시간(출발점 5곳 인구가중). 증편 배분은 출근 회차와 연 순감축(tCO₂/년)이에요. 이름을 누르면 자세히 나와요.</caption>
          </table></div>
        </div>
      </div>
      <div class="panel ex-detail" id="ex-detail" aria-labelledby="ex-d-title"></div>
    </div>
    <p class="sr-only" aria-live="polite" id="ex-live"></p>
  </div>`;

  const $ = (q) => root.querySelector(q);
  const mapEl = $('#ex-map'), svgEl = $('#ex-svg');
  const axisEls = [...root.querySelectorAll('.ex-axis')];
  const byId = new Map(AX.map((a) => [a.id, a]));
  const navOrder = AX.map((a) => a.id);
  let liveTimer = 0;
  const say = (t, delay = 500) => { clearTimeout(liveTimer); liveTimer = setTimeout(() => { $('#ex-live').textContent = t; }, delay); };

  function drawSel() {
    const g = G.get(sel.id), a = sel;
    const w = width(a);
    const [dx, dy] = P(a.dest_lon, a.dest_lat);
    const [ox, oy] = P(a.origin_lon, a.origin_lat);
    $('#ex-sel').innerHTML = `<path class="ex-sel-case" d="${g.d}" stroke-width="${f1(w + 4)}"/><path class="ex-sel-line ${a.seoul ? 's' : 'g'}" d="${g.d}" stroke-width="${f1(w)}"/>`;
    const five = a.origin_points.map((p) => { const [x, y] = P(p.lon, p.lat); return `<line class="ex-five-ln" x1="${f1(ox)}" y1="${f1(oy)}" x2="${f1(x)}" y2="${f1(y)}"/><circle class="ex-pt-five" cx="${f1(x)}" cy="${f1(y)}" r="3"><title>${esc(p.dong)}</title></circle>`; }).join('');
        $('#ex-sel-top').innerHTML = five + `<rect class="ex-pt-d" x="${f1(dx - 4.5)}" y="${f1(dy - 4.5)}" width="9" height="9" rx="1"/>` +
      `<text class="ex-destlabel" x="${f1(dx)}" y="${f1(dy + (dy > H - 60 ? -10 : 20))}" text-anchor="${dx < 60 ? 'start' : dx > W - 60 ? 'end' : 'middle'}">${esc(a.dest)}</text>`;
    mapEl.classList.add('has-sel');
    axisEls.forEach((el) => {
      const on = +el.dataset.id === sel.id;
      el.classList.toggle('is-sel', on);
      el.setAttribute('aria-pressed', String(on));
      el.setAttribute('tabindex', on ? '0' : '-1');
    });
    root.querySelectorAll('.ex-list tbody tr').forEach((tr) => tr.classList.toggle('is-sel', +tr.dataset.id === sel.id));
    root.querySelectorAll('.ex-pick').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.id === sel.id)));
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
    return r;
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
    const ratio = a.PCTR >= 1 ? `대중교통이 승용차보다 ${a.PCTR.toFixed(1)}배 걸려요` : `대중교통이 승용차보다 빨라요(${a.PCTR.toFixed(2)}배)`;
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
        ${a.alloc_am ? `<div><dt>보고서 배분 출근 ${a.alloc_am}회의 연 순감축</dt><dd class="pos">${sgn(a.alloc_t_year)}<small>tCO₂/년</small></dd></div>` : ''}
        ${cand ? `<div><dt>모형 φ (상한 0.5로 자름)</dt><dd>${a.model_phi.toFixed(2)}</dd></div>` : ''}
      </dl>
      <div class="ex-try">
        <label class="ctl"><span class="ctl-label">이 축에 출근 n회 넣어 보기<small>퇴근도 같은 횟수</small></span>
          <input class="range" type="range" id="ex-try-n" min="0" max="15" step="1">
          <output class="ctl-out" id="ex-try-n-out" for="ex-try-n"></output></label>
        <div class="ex-try-out">
          <div class="readout" id="ex-try-ro"><span class="readout-label">연간 순감축</span>
            <span class="readout-value"><span id="ex-try-t" data-testid="axis-t">0</span><span class="readout-unit">tCO₂/년</span></span></div>
        </div>
        <p id="ex-try-meta"></p>
        <p>${cand
          ? '<b>모형 수요</b>로 계산해요: 이 축의 하루 수요를 회차로 나눈 만큼 타되 정원 44석까지, φ는 모형값. 디젤 3.49 km/L, 회송 1회, 재차 1.1명, 연 245일.'
          : `<b>모형 수요가 없는 축</b>(버스 처방 후보 아님)이라 현행 편하G 수준인 회당 ${C.TARGET_RIDE}명·φ ${C.TARGET_PHI}로 똑같이 가정했어요. 디젤 3.49 km/L, 회송 1회, 재차 1.1명, 연 245일.`}</p>
      </div>`;
    $('#ex-try-n').addEventListener('input', (e) => {
      tries.set(sel.id, +e.target.value);
      const r = renderTry();
      say(`출근 ${tries.get(sel.id)}회, 연간 ${sgn(r.t)} 톤`, 800);
    });
    renderTry();
  }

  function select(id, { announce = true } = {}) {
    sel = byId.get(id);
    drawSel();
    renderDetail();
    if (announce) say(`${axisName(sel.key)} 선택. PCTR ${sel.PCTR.toFixed(2)}, ${sel.diag}${sel.alloc_am ? `, 증편 ${sel.alloc_am}회` : ''}.`, 300);
  }

  // ───────── 이벤트 ─────────
  let pointer = false;
  axisEls.forEach((el) => {
    el.addEventListener('pointerdown', () => { pointer = true; });
    el.addEventListener('click', () => { select(+el.dataset.id); });
    el.addEventListener('focus', () => {
      mapEl.classList.toggle('kbd', !pointer);
      $('#ex-focus').setAttribute('d', G.get(+el.dataset.id).d);
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
      const next = axisEls.find((x) => +x.dataset.id === navOrder[j]);
      next.focus();
    });
  });
  root.querySelectorAll('.ex-pick').forEach((b) => b.addEventListener('click', () => select(+b.dataset.id)));
  root.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    view = b.dataset.view;
    root.querySelectorAll('[data-view]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.view === view)));
    $('#ex-map').hidden = view !== 'map';
    $('#ex-list').hidden = view !== 'list';
    $('#ex').classList.toggle('is-list', view === 'list');
  }));
  $('#ex-routes-on').addEventListener('change', (e) => {
    $('#ex-routes').toggleAttribute('hidden', !e.target.checked);
    $('#ex-key-rt').hidden = !e.target.checked;
    say(e.target.checked ? '현행 편하G 28개 노선을 점선으로 겹쳐 보여요.' : '현행 노선을 숨겼어요.', 200);
  });

  select(sel.id, { announce: false });
}
