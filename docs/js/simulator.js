// 시뮬레이터: 같은 증편 100회(출근 50 + 퇴근 50)를 PCTR 기준 4개 축과 현행 28개 노선 비례 중 어디에 넣을까
// 계산은 전부 js/model.js가 해요.
//   · 모형 기준값 모드: PCTR 기준 = allocateGreedy(모형 수요), 현행 = annualNet(baseAllocation('base'), 노선별 수요 D·φ)
//     → 연비·회송·재차·차종을 바꿔도 파이썬 sensitivity.json과 같은 값(model.test.mjs 6절)
//   · 직접 정하기 모드: 두 방식 모두 고정 배분(15/15/15/5회, 28개 노선 비례)에 균일 N·φ → 보고서 표4와 같은 식
//   · 비관 조합: 수요 보정을 다시 하는 입력이라 JS로 재계산하지 않고 sensitivity.pessimistic_combo 결과를 그대로 보여 줘요
import { loadModel, getModel, annualNet, allocateGreedy, baseAllocation, breakeven, SAFE_RANGES } from './model.js';

const root = document.getElementById('simulator-root');
const MODEL_URL = new URL('../data/model.json', import.meta.url).href;
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');

const MINUS = '−';
const sgn = (v, d = 0) => {
  const r = +v.toFixed(d);
  const s = Math.abs(r).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
  return (r > 0 ? '+' : r < 0 ? MINUS : '') + s;
};
const int = (v) => Math.round(v).toLocaleString('ko-KR');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const shortCity = (s) => s.replace(/^(\S+?)(시|군)(?=\s|$)/, '$1').replace(/^(\S+?)시(\S+구)$/, '$1 $2');
const shortAxis = (key) => key.split('→').map(shortCity).join('→');

if (root) {
  loadModel(MODEL_URL).then(start).catch((e) => {
    root.querySelector('.mount-empty').textContent = '계산 모듈을 불러오지 못했어요. 페이지를 새로 고쳐 주세요.';
    console.error(e);
  });
}

function start() {
  const M = getModel();
  const C = M.constants;
  const PHYS0 = { vehicle: 'diesel', kmpl: C.diesel.kmpl, kmpkg: C.fcev.kmpkg, h2: C.fcev.h2_co2_per_kg, r: C.R_DH, occ: C.CAR_OCC };
  const OURS_KM = baseAllocation('ours', { withDemand: false });
  const BASE_KM = baseAllocation('base', { withDemand: false });
  const BASE_D = baseAllocation('base');
  const ROUTE = Object.fromEntries(M.routes.map((r) => [r.id, r]));
  const GRID = M.scenario_grid.grid;
  const PESS = M.sensitivity.pessimistic_combo;
  const NS = [...new Set(GRID.map((g) => g.N))];
  const PS = [...new Set(GRID.map((g) => g.phi))];
  const nAxesBase = M.routes.length;

  const PRESETS = [
    { id: 'base', label: '보고서 기준값', mode: 'model', common: false, Np: 44, phip: 0.5, Nb: 19.5, phib: 0.25, ...PHYS0,
      note: '축·노선마다 모형이 정한 수요를 넣은 <b>보고서 기준값</b>이에요. PCTR 축은 회당 44명·φ 0.5, 현행 노선은 노선마다 수요가 달라요(평균 회당 20.6명·φ 0.25).' },
    { id: 'same', label: '표4처럼 같은 조건', mode: 'direct', common: true, Np: 44, phip: 0.5, Nb: 44, phib: 0.5, ...PHYS0,
      note: '두 방식에 <b>똑같이 회당 44명·φ 0.5</b>를 줬어요(보고서 표4의 균일 가정). 탑승과 φ가 같으면 노선이 긴 현행 방식(평균 39.2 km, PCTR 축 29.3 km)이 더 크게 나와요.' },
    { id: 'y2022', label: '2022년 수준 현행', mode: 'direct', common: false, Np: 44, phip: 0.5, Nb: 19.5, phib: 0.25, ...PHYS0,
      note: '현행 방식에 <b>2022년 실적 수준(회당 19.5명, φ 0.25)</b>을 모든 노선에 똑같이 줬어요. 노선별 수요를 넣은 기준값(−793 t)과 달리 균일하게 주면 −768 t로 조금 달라요.' },
    { id: 'pess', label: '비관 조합', mode: 'snapshot', common: false, Np: 44, phip: 0.5, Nb: 19.5, phib: 0.25, ...PHYS0, occ: 1.3,
      note: '<b>φ 상한 0.26, 탑승률 0.7, 재차 1.3명, 평택→화성 거리 0.7배</b>를 한꺼번에 넣은 보고서 민감도 결과예요. 수요 보정을 다시 해야 하는 조합이라 여기서 계산하지 않고 결과를 그대로 옮겼어요. 슬라이더를 움직이면 모형 기준값 계산으로 돌아가요.' },
    { id: 'fcev', label: '수소버스 전환', mode: 'model', common: false, Np: 44, phip: 0.5, Nb: 19.5, phib: 0.25, ...PHYS0, vehicle: 'fcev',
      note: '차량을 <b>유니버스 수소전기버스</b>(28.0 km/kg, 개질 수소 9.2 kgCO₂/kg)로 바꾼 모형 기준값이에요. 수소 배출계수를 0(부생수소)까지 내려 볼 수 있어요.' },
  ];

  const S = {};
  const R = SAFE_RANGES;
  const RANGES = {
    Np: { ...R.N, step: 0.5 }, phip: R.phi, Nb: { ...R.N, step: 0.5 }, phib: R.phi,
    kmpl: R.kmpl, kmpkg: R.kmpkg, h2: R.h2, r: R.r, occ: R.occ,
  };
  const OUT = {
    Np: (v) => `${+v.toFixed(1)}명`, Nb: (v) => `${+v.toFixed(1)}명`, phip: (v) => v.toFixed(2), phib: (v) => v.toFixed(2),
    kmpl: (v) => `${v.toFixed(2)}`, kmpkg: (v) => `${v.toFixed(1)}`, h2: (v) => v.toFixed(1), r: (v) => v.toFixed(2), occ: (v) => `${v.toFixed(2)}명`,
  };

  const ctl = (id, label, sub, cls = '') => `
    <label class="ctl sim-ctl" data-ctl="${id}"><span class="ctl-label">${label}${sub ? `<small>${sub}</small>` : ''}</span>
      <input class="range ${cls}" type="range" id="sim-${id}" min="${RANGES[id].min}" max="${RANGES[id].max}" step="${RANGES[id].step}">
      <output class="ctl-out" id="sim-${id}-out" for="sim-${id}"></output></label>`;

  root.removeAttribute('data-state');
  root.innerHTML = `
  <div class="sim">
    <div class="sim-top">
      <div class="sim-top-row">
        <div class="chips" role="group" aria-label="예시 조건">
          ${PRESETS.map((p) => `<button class="chip" type="button" data-preset="${p.id}" aria-pressed="false">${p.label}</button>`).join('')}
        </div>
        <div class="sim-mode"><span id="sim-mode-label">계산</span>
          <div class="toggle" role="group" aria-labelledby="sim-mode-label">
            <button type="button" data-mode="model" aria-pressed="true">모형 기준값</button>
            <button type="button" data-mode="direct" aria-pressed="false">직접 정하기</button>
          </div>
        </div>
      </div>
      <p class="sim-preset-note" id="sim-note"></p>
    </div>

    <div class="panel sim-board" id="sim-board">
      <div class="sim-scores">
        <div class="readout sim-score sim-score--pctr" id="sim-o">
          <span class="sim-who">PCTR 기준 <small>경기 내부 4개 축에 집중</small></span>
          <span class="readout-label">연간 순감축</span>
          <span class="readout-value"><span class="v" data-testid="pctr-t">0</span><span class="readout-unit">tCO₂/년</span></span>
          <span class="readout-note" id="sim-o-note"></span>
        </div>
        <div class="readout sim-score sim-score--base" id="sim-b">
          <span class="sim-who">현행 방식 <small>28개 노선에 비례 배분</small></span>
          <span class="readout-label">연간 순감축</span>
          <span class="readout-value"><span class="v" data-testid="base-t">0</span><span class="readout-unit">tCO₂/년</span></span>
          <span class="readout-note" id="sim-b-note"></span>
        </div>
      </div>
      <div class="dv" aria-hidden="true">
        <div class="dv-row dv-row--pctr"><span class="dv-name">PCTR 기준</span><div class="dv-track"><i class="dv-bar" id="sim-dv-o"></i></div></div>
        <div class="dv-row dv-row--base"><span class="dv-name">현행 방식</span><div class="dv-track"><i class="dv-bar" id="sim-dv-b"></i></div></div>
        <div class="dv-scale"><span></span><span id="sim-dv-scale"></span></div>
      </div>
      <div class="sim-verdict">
        <strong class="verdict-head" id="sim-head"></strong>
        <p class="verdict-text" id="sim-why"></p>
      </div>
    </div>

    <div class="sim-main">
      <div class="panel sim-ctls">
        <div class="sim-group" role="group" aria-labelledby="sim-g1">
          <div class="sim-group-head"><h3 id="sim-g1">탑승과 승용차 출신 비율</h3>
            <label class="switch"><input type="checkbox" id="sim-common"><span>두 방식에 같은 값</span></label></div>
          <p class="sim-hint" id="sim-hint-n"></p>
          <p class="sim-who-line sim-who-line--pctr" id="sim-wl-p"><i></i><span>PCTR 기준</span></p>
          ${ctl('Np', '회당 탑승', '출근 1회 평균, 명')}
          ${ctl('phip', '승용차 출신 φ', '승객 중 원래 승용차 통근자', 'range--car')}
          <p class="sim-who-line sim-who-line--base" id="sim-wl-b"><i></i><span>현행 방식</span></p>
          ${ctl('Nb', '회당 탑승', '출근 1회 평균, 명')}
          ${ctl('phib', '승용차 출신 φ', '승객 중 원래 승용차 통근자', 'range--car')}
        </div>
        <div class="sim-group" role="group" aria-labelledby="sim-g2">
          <div class="sim-group-head"><h3 id="sim-g2">차량과 운행 <span class="sim-sub">두 방식 공통</span></h3>
            <div class="toggle" role="group" aria-label="차종">
              <button type="button" data-veh="diesel" aria-pressed="true">디젤 44석</button>
              <button type="button" data-veh="fcev" aria-pressed="false">수소전기 45인승</button>
            </div></div>
          ${ctl('kmpl', '디젤 연비', 'km/L, 근거 2.83~4.0')}
          ${ctl('kmpkg', '수소 연비', 'km/kg, 공식 28.0')}
          ${ctl('h2', '수소 배출계수', 'kgCO₂/kgH₂, 부생 0~개질 9.2')}
          ${ctl('r', '빈 차 회송', '운행 1회당 회송 비율')}
          ${ctl('occ', '승용차 재차', '대당 탑승, 출근 1.1')}
        </div>
        <button class="ticket sim-reset" type="button" id="sim-reset">보고서 기준값으로 되돌리기</button>
      </div>

      <div class="panel sim-aux">
        <div>
          <h3>하루 승용차에서 옮겨 오는 사람 <span class="sim-sub">출근 기준 실인원</span></h3>
          <div class="sim-pair">
            <div class="readout is-pctr"><span class="readout-label">PCTR 기준</span><span class="readout-value" id="sim-shift-o">0</span><span class="readout-note" id="sim-ride-o"></span></div>
            <div class="readout is-base"><span class="readout-label">현행 방식</span><span class="readout-value" id="sim-shift-b">0</span><span class="readout-note" id="sim-ride-b"></span></div>
          </div>
        </div>
        <div>
          <h3>회당 승용차 출신 승객과 본전 <span class="sim-sub">세로선이 본전 m*</span></h3>
          <div class="sim-pair">
            <div class="sim-m" id="sim-m-o"></div>
            <div class="sim-m" id="sim-m-b"></div>
          </div>
        </div>
        <div>
          <h3>어디서 줄고 어디서 늘었나 <span class="sim-sub">tCO₂/년</span></h3>
          <div id="sim-contrib"></div>
        </div>
      </div>
    </div>

    <div class="sim-more">
      <div class="panel">
        <h3>표4 칸으로 바로 가기 <span class="sim-sub">회당 탑승 × φ, tCO₂/년</span></h3>
        <ul class="key"><li><span class="sw" style="background:var(--car);border-radius:50%"></span>PCTR 기준</li><li><span class="sw" style="background:var(--seoul);border-radius:50%"></span>같은 조건의 현행 방식</li><li><span class="sw sw--cut"></span>감축</li><li><span class="sw sw--add"></span>증가</li></ul>
        <div class="hm" id="sim-hm" role="group" aria-label="보고서 표4. 칸을 누르면 그 탑승과 φ로 맞춰요">
          <span class="hm-h" aria-hidden="true"></span>
          ${PS.map((p, ci) => `<span class="hm-h" style="grid-row:1;grid-column:${ci + 2}" aria-hidden="true">φ ${p}</span>`).join('')}
          ${NS.map((n, ri) => `<span class="hm-h hm-h--row" style="grid-row:${ri + 2};grid-column:1" aria-hidden="true">${n}명</span>` + PS.map((p, ci) => {
            const g = GRID.find((x) => x.N === n && x.phi === p);
            return `<button type="button" class="hm-cell" style="grid-row:${ri + 2};grid-column:${ci + 2}" data-n="${n}" data-phi="${p}" aria-label="회당 ${n}명, φ ${p}: PCTR 기준 ${sgn(g.ours_t)} 톤, 현행 방식 ${sgn(g.base_t)} 톤">
              <span class="hm-p ${g.ours_t >= 0 ? 'is-cut' : 'is-add'}"><i></i>${sgn(g.ours_t)}</span>
              <span class="hm-b ${g.base_t >= 0 ? 'is-cut' : 'is-add'}"><i></i>${sgn(g.base_t)}</span></button>`;
          }).join('')).join('')}
          <div class="hm-plot" aria-hidden="true"><i class="hm-dot hm-dot--pctr" id="sim-dot-o"></i><i class="hm-dot hm-dot--base" id="sim-dot-b"></i></div>
        </div>
        <p class="chart-cap" id="sim-hm-cap">점은 지금 고른 탑승·φ의 위치예요. 칸을 누르면 두 방식에 그 값을 똑같이 주고 차량 조건은 보고서 기본값(디젤 3.49 km/L, 회송 1, 재차 1.1명)으로 맞춰요.</p>
      </div>
      <div class="panel">
        <h3>슬라이더로 못 바꾸는 입력 <span class="sim-sub">보고서 일변량 민감도, tCO₂/년</span></h3>
        <ul class="key"><li><span class="sw sw--car"></span>PCTR 기준 범위</li><li><span class="sw sw--seoul"></span>현행 방식 범위</li><li><span class="sw sw--line"></span>기준값</li></ul>
        <ul class="tor" id="sim-tor"></ul>
        <div class="tor-scale" aria-hidden="true"><span></span><span id="sim-tor-scale"></span></div>
        <p class="chart-cap">정원·φ 상한·β처럼 수요 보정을 다시 해야 하는 입력은 여기서 계산하지 않고 보고서 결과(sensitivity.json)를 그대로 옮겼어요. 막대는 각 입력을 근거 범위 끝까지 바꿨을 때 결과가 움직인 폭이에요. 도보 접근 시간과 DRT 대기 시간은 두 결과를 바꾸지 않았어요.</p>
      </div>
    </div>

    <div class="caveat sim-limit"><p>이 숫자는 <b>“대중교통이 느린 축일수록 승용차 출신 승객이 많고 더 많이 탄다”</b>는 가설과, 모형이 정한 수요(PCTR 축 만석·φ 0.5)에 기대요. 편하G 이용자의 이전 수단 설문이 없어 실제 φ는 개통 전 주민 설문으로 확인해야 해요.</p></div>
    <p class="sr-only" aria-live="polite" id="sim-live"></p>
  </div>
  <div class="sim-dock" id="sim-dock" aria-hidden="true">
    <span><small>PCTR </small><b class="d-p" id="sim-dock-o"></b></span>
    <span><small>현행 </small><b class="d-b" id="sim-dock-b"></b></span>
    <small>tCO₂/년</small>
    <button type="button" tabindex="-1" id="sim-dock-go">결과판</button>
  </div>`;

  const $ = (s) => root.querySelector(s);
  const inp = {}, out = {}, row = {};
  for (const k of Object.keys(RANGES)) {
    inp[k] = $(`#sim-${k}`); out[k] = $(`#sim-${k}-out`); row[k] = root.querySelector(`[data-ctl="${k}"]`);
  }
  const chips = [...root.querySelectorAll('[data-preset]')];
  const modeBtns = [...root.querySelectorAll('[data-mode]')];
  const vehBtns = [...root.querySelectorAll('[data-veh]')];
  const common = $('#sim-common');
  const cells = [...root.querySelectorAll('.hm-cell')];
  const dock = $('#sim-dock'), dockO = $('#sim-dock-o'), dockB = $('#sim-dock-b');

  // ───────── 상태 ─────────
  function applyPreset(id) {
    const p = PRESETS.find((x) => x.id === id);
    Object.assign(S, { mode: p.mode, common: p.common, Np: p.Np, phip: p.phip, Nb: p.Nb, phib: p.phib,
      vehicle: p.vehicle, kmpl: p.kmpl, kmpkg: p.kmpkg, h2: p.h2, r: p.r, occ: p.occ, preset: id });
  }
  const phys = () => (S.vehicle === 'fcev'
    ? { vehicle: 'fcev', kmpkg: S.kmpkg, h2: S.h2, r: S.r, occ: S.occ }
    : { vehicle: 'diesel', kmpl: S.kmpl, r: S.r, occ: S.occ });
  const nb = () => (S.common ? S.Np : S.Nb);
  const pb = () => (S.common ? S.phip : S.phib);

  function compute() {
    const P = phys();
    if (S.mode === 'snapshot') {
      return { snap: true, o: { tYear: PESS.ours_t, items: [], riders: 0, carShift: 0, trips: 0 },
               b: { tYear: PESS.base_t, items: null, riders: null, carShift: null, trips: 100 } };
    }
    if (S.mode === 'model') {
      const g = allocateGreedy(P);
      return { o: g.result, b: annualNet({ ...P, allocation: BASE_D }) };
    }
    return { o: annualNet({ ...P, allocation: OURS_KM, N: S.Np, phi: S.phip }),
             b: annualNet({ ...P, allocation: BASE_KM, N: nb(), phi: pb() }) };
  }

  // ───────── 숫자 움직임 ─────────
  function tween(el, to, fmt) {
    const from = el._v ?? to;
    el._v = to;
    el.dataset.value = String(Math.round(to * 10) / 10);
    cancelAnimationFrame(el._raf);
    if (reduceMQ.matches || from === to) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), D = 300;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / D), e = 1 - (1 - p) ** 3;
      el.textContent = fmt(p < 1 ? from + (to - from) * e : to);
      if (p < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  }

  const setFill = (input) => input.style.setProperty('--fill', ((+input.value - +input.min) / (+input.max - +input.min)) * 100 + '%');

  // ───────── 그리기 ─────────
  let liveTimer = 0, first = true;
  function render() {
    const res = compute();
    const { o, b } = res;
    const ot = o.tYear, bt = b.tYear;

    // 입력 반영
    const modelish = S.mode !== 'direct';
    for (const k of Object.keys(RANGES)) {
      inp[k].value = S[k];
      out[k].textContent = OUT[k](S[k]);
      setFill(inp[k]);
    }
    if (S.common) { inp.Nb.value = S.Np; inp.phib.value = S.phip; }
    row.Nb.hidden = row.phib.hidden = S.common;
    $('#sim-wl-b').hidden = S.common;
    $('#sim-wl-p span').textContent = S.common ? '두 방식 공통' : 'PCTR 기준';
    $('#sim-wl-p').className = 'sim-who-line ' + (S.common ? '' : 'sim-who-line--pctr');
    for (const k of ['Np', 'phip', 'Nb', 'phib']) row[k].classList.toggle('is-model', modelish);
    if (modelish) { out.Nb.textContent = '노선별'; out.phib.textContent = '노선별'; }
    common.checked = S.common;
    row.kmpl.hidden = S.vehicle === 'fcev';
    row.kmpkg.hidden = row.h2.hidden = S.vehicle !== 'fcev';
    chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.preset === S.preset)));
    modeBtns.forEach((m) => m.setAttribute('aria-pressed', String(m.dataset.mode === (S.mode === 'direct' ? 'direct' : 'model'))));
    vehBtns.forEach((v) => v.setAttribute('aria-pressed', String(v.dataset.veh === S.vehicle)));
    const preset = PRESETS.find((p) => p.id === S.preset);
    $('#sim-note').innerHTML = preset ? preset.note
      : S.mode === 'direct'
        ? (S.common ? '두 방식에 <b>같은 탑승·φ</b>를 직접 줬어요. 배분은 보고서와 같게 고정했어요(PCTR 4개 축 15/15/15/5회, 현행 28개 노선 비례).'
                    : '두 방식의 탑승·φ를 <b>따로 직접</b> 정했어요. 배분은 보고서와 같게 고정했어요(PCTR 4개 축 15/15/15/5회, 현행 28개 노선 비례).')
        : '<b>모형 수요</b>로 계산하고 있어요. 차량 조건을 바꾸면 PCTR 기준은 회차 배분까지 다시 계산해요.';
    $('#sim-hint-n').innerHTML = modelish
      ? '지금은 축·노선마다 모형이 정한 탑승과 φ를 써요. 슬라이더를 움직이면 <b>직접 정하기</b>로 바뀌어요.'
      : '모든 축(노선)에 같은 탑승과 φ를 준 균일 가정이에요.';

    // 결과판
    const oEl = $('#sim-o'), bEl = $('#sim-b');
    oEl.classList.toggle('is-cut', ot >= 0.5); oEl.classList.toggle('is-add', ot <= -0.5);
    bEl.classList.toggle('is-cut', bt >= 0.5); bEl.classList.toggle('is-add', bt <= -0.5);
    tween($('#sim-o .v'), ot, (v) => sgn(v));
    tween($('#sim-b .v'), bt, (v) => sgn(v));
    const word = (t) => (t >= 0.5 ? '줄어요' : t <= -0.5 ? '늘어요' : '변화 없어요');
    $('#sim-o-note').textContent = res.snap ? '어느 축도 본전을 넘지 못해 버스를 넣지 않아요'
      : `${o.trips}회 운행 · 탄소가 ${word(ot)}` + (S.mode === 'model' ? ' · 모형 수요' : ` · 균일 ${+S.Np.toFixed(1)}명×${S.phip.toFixed(2)}`);
    $('#sim-b-note').textContent = res.snap ? `100회 운행 · 탄소가 ${word(bt)} · 보고서 결과`
      : `${b.trips}회 운행 · 탄소가 ${word(bt)}` + (S.mode === 'model' ? ' · 노선별 수요' : ` · 균일 ${+nb().toFixed(1)}명×${pb().toFixed(2)}`);

    const span = Math.max(1500, Math.ceil(Math.max(Math.abs(ot), Math.abs(bt)) / 500) * 500);
    const bar = (el, t) => {
      const w = (Math.abs(t) / span) * 50;
      el.style.setProperty('--w', w + '%');
      el.style.setProperty('--x', (t >= 0 ? 50 : 50 - w) + '%');
      el.classList.toggle('is-add', t < 0);
    };
    bar($('#sim-dv-o'), ot); bar($('#sim-dv-b'), bt);
    $('#sim-dv-scale').innerHTML = `<span class="t-add">${MINUS}${int(span)} 늘어요</span><span>0</span><span class="t-cut">+${int(span)} 줄어요</span>`;

    // 판정
    const d = ot - bt, ad = int(Math.abs(d));
    let head, cls;
    if (res.snap) { head = `PCTR 기준은 버스를 넣지 않고(0 t), 현행 방식은 연 ${int(-bt)} t 늘려요`; cls = 'is-even'; }
    else if (Math.abs(d) < 5) { head = '두 방식의 결과가 거의 같아요'; cls = 'is-even'; }
    else if (d > 0) {
      if (ot >= 0.5 && bt <= -0.5) head = `PCTR 기준은 줄이고 현행 방식은 늘려요. 차이는 연 ${ad} t예요`;
      else if (ot < 0.5) head = `두 방식 모두 탄소가 늘지만, PCTR 기준이 연 ${ad} t 덜 늘어요`;
      else head = `이 조건에서는 PCTR 기준이 연 ${ad} t 더 줄여요`;
      cls = ot >= 0.5 ? 'is-cut' : 'is-add';
    } else {
      if (bt < 0.5) head = `두 방식 모두 탄소가 늘고, 현행 방식이 연 ${ad} t 덜 늘어요`;
      else head = `이 조건에서는 현행 방식이 연 ${ad} t 더 줄여요`;
      cls = bt >= 0.5 ? 'is-even' : 'is-add';
    }
    const h = $('#sim-head');
    h.textContent = head;
    h.className = 'verdict-head ' + cls;

    // 회당 승용차 출신 vs 본전
    const P = phys();
    const per = (r, trips) => {
      const am = trips / 2;
      if (!am || r.riders == null) return null;
      const N = r.riders / am, phi = r.carShift / r.riders;
      return { N, phi, m: N * phi, mstar: breakeven({ ...P, N }).mstar };
    };
    const po = res.snap ? null : per(o, o.trips);
    const pbb = res.snap ? null : per(b, b.trips);
    let why;
    if (res.snap) why = '비관 조합에서는 PCTR 축도 회당 승용차 출신이 본전에 못 미쳐 그리디 배분이 한 회차도 고르지 않았어요. 현행 방식은 배분 규칙상 그대로 100회를 넣어요.';
    else if (S.mode === 'model' && S.preset === 'base') why = '현행 방식 −793 t는 노선마다 다른 모형 수요를 넣은 값이에요. 같은 19.5명·φ 0.25를 모든 노선에 똑같이 주면 −768 t예요(‘2022년 수준 현행’).';
    else if (S.mode === 'direct' && S.common) why = '탑승과 φ가 같으면 축 길이 차이만 남아요. 현행 노선이 평균 39.2 km로 PCTR 축(29.3 km)보다 길어서 절댓값이 더 커요. PCTR 기준이 유리하다는 결론은 고PCTR 축에 승용차 출신이 더 많이 탄다는 가설에 달려 있어요.';
    else if (po && pbb) {
      const lead = (x) => (x.m >= x.mstar ? '본전을 넘어요' : '본전에 못 미쳐요');
      why = `회당 승용차 출신이 PCTR 기준 ${x1(po.m)}명(본전 ${x1(po.mstar)}명)으로 ${lead(po)}. 현행 방식은 ${x1(pbb.m)}명(본전 ${x1(pbb.mstar)}명)으로 ${lead(pbb)}.`;
    } else if (pbb) why = `PCTR 기준은 넣을 만한 축이 없어 한 회차도 배분하지 않았어요. 현행 방식은 회당 승용차 출신 ${x1(pbb.m)}명으로 본전 ${x1(pbb.mstar)}명${pbb.m >= pbb.mstar ? '을 넘어요' : '에 못 미쳐요'}.`;
    else why = '';
    $('#sim-why').textContent = why;

    // 하루 승용차 전환
    const shift = (el, note, r, p) => {
      if (r.carShift == null) { el.textContent = '—'; el._v = undefined; note.textContent = '보고서에 하루 인원이 없어요'; return; }
      tween(el, r.carShift, (v) => int(v) + '명');
      note.textContent = `하루 이용 ${int(r.riders)}명 중` + (p ? ` · 회당 ${x1(p.N)}명` : '');
    };
    shift($('#sim-shift-o'), $('#sim-ride-o'), o, po);
    shift($('#sim-shift-b'), $('#sim-ride-b'), b, pbb);

    const meter = (el, p, who) => {
      if (!p) { el.innerHTML = `<b>${who}</b><br>${res.snap ? '보고서 결과만 있어요' : '운행이 없어요'}`; return; }
      const ok = p.m >= p.mstar;
      el.innerHTML = `<b>${who}</b> 회당 <b class="${ok ? 'pos' : 'neg'}">${x1(p.m)}명</b> / 본전 ${x1(p.mstar)}명
        <div class="meter${ok ? ' is-cut' : ''}" style="--v:${Math.min(100, (p.m / 44) * 100)}%;--t:${Math.min(100, (p.mstar / 44) * 100)}%" aria-hidden="true"><i></i><b></b></div>
        <div class="meter-scale" aria-hidden="true"><span>0</span><span>44석</span></div>`;
    };
    meter($('#sim-m-o'), po, 'PCTR 기준');
    meter($('#sim-m-b'), pbb, '현행 방식');

    renderContrib(res);
    renderHeat();

    dockO.textContent = sgn(ot);
    dockB.textContent = sgn(bt);

    if (!first) {
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => {
        $('#sim-live').textContent = `PCTR 기준 ${sgn(ot)} 톤, 현행 방식 ${sgn(bt)} 톤. ${head}.`;
      }, 900);
    }
    first = false;
  }
  const x1 = (v) => v.toFixed(1);

  function renderContrib(res) {
    const box = $('#sim-contrib');
    if (res.snap) { box.innerHTML = '<p class="contrib-empty">비관 조합은 보고서 합계만 있어서 축별로 나누지 않았어요.</p>'; return; }
    const oItems = res.o.items.slice().sort((a, b) => b.tYear - a.tYear)
      .map((x) => ({ name: shortAxis(x.key), sub: `${x.tripsAM}회`, t: x.tYear }));
    const bAll = res.b.items.slice().sort((a, b) => Math.abs(b.tYear) - Math.abs(a.tYear));
    const top = 5;
    const bItems = bAll.slice(0, top).map((x) => {
      const r = ROUTE[x.key];
      return { name: `${shortCity(r.origin)}→${shortCity(r.dest_sgg)}`, sub: x.key, t: x.tYear };
    });
    const rest = bAll.slice(top);
    if (rest.length) bItems.push({ name: `나머지 ${rest.length}개 노선`, sub: '', t: rest.reduce((s, x) => s + x.tYear, 0) });
    const mx = Math.max(100, ...oItems.map((x) => Math.abs(x.t)), ...bItems.map((x) => Math.abs(x.t)));
    const li = (x) => {
      const w = (Math.abs(x.t) / mx) * 50;
      return `<li><span class="c-name" title="${esc(x.name)} ${esc(x.sub)}">${esc(x.name)} <small>${esc(x.sub)}</small></span>
        <span class="c-track" aria-hidden="true"><i class="${x.t < 0 ? 'is-add' : ''}" style="--x:${x.t >= 0 ? 50 : 50 - w}%;--w:${w}%"></i></span>
        <b class="${x.t >= 0.5 ? 'pos' : x.t <= -0.5 ? 'neg' : ''}">${sgn(x.t)}</b></li>`;
    };
    box.innerHTML =
      `<p class="contrib-head contrib-head--pctr"><i></i>PCTR 기준 · 배분된 축과 출근 회차</p>` +
      (oItems.length ? `<ul class="contrib">${oItems.map(li).join('')}</ul>` : '<p class="contrib-empty">배분된 축이 없어요.</p>') +
      `<p class="contrib-head contrib-head--base"><i></i>현행 방식 · 영향이 큰 노선 ${Math.min(top, bAll.length)}개와 나머지 (${nAxesBase}개 노선)</p>` +
      `<ul class="contrib">${bItems.map(li).join('')}</ul>`;
  }

  // 표4 위치: 칸 가운데(1/6, 1/2, 5/6)를 표 값에 맞추고 그 사이는 직선으로 이어요
  const CENT = [1 / 6, 1 / 2, 5 / 6];
  const pos = (v, xs) => {
    const i = v <= xs[1] ? 0 : 1;
    const f = CENT[i] + ((v - xs[i]) / (xs[i + 1] - xs[i])) * (CENT[i + 1] - CENT[i]);
    return Math.max(0.03, Math.min(0.97, f)) * 100 + '%';
  };
  function renderHeat() {
    const hm = $('#sim-hm');
    const dO = $('#sim-dot-o'), dB = $('#sim-dot-b');
    dO.style.setProperty('--x', pos(S.phip, PS)); dO.style.setProperty('--y', pos(S.Np, NS));
    dB.style.setProperty('--x', pos(pb(), PS)); dB.style.setProperty('--y', pos(nb(), NS));
    hm.classList.toggle('is-same', Math.abs(S.Np - nb()) < 1e-9 && Math.abs(S.phip - pb()) < 1e-9);
    hm.classList.toggle('is-model', S.mode === 'model');
    hm.classList.toggle('is-off', S.mode === 'snapshot');
    const defaults = S.vehicle === 'diesel' && S.kmpl === PHYS0.kmpl && S.r === PHYS0.r && S.occ === PHYS0.occ;
    cells.forEach((c) => {
      const on = S.mode === 'direct' && defaults && +c.dataset.n === S.Np && +c.dataset.phi === S.phip && +c.dataset.n === nb() && +c.dataset.phi === pb();
      c.classList.toggle('is-on', on);
      c.setAttribute('aria-pressed', String(on));
    });
    $('#sim-hm-cap').textContent = S.mode === 'model'
      ? '옅은 점은 모형 기준값의 대략 위치예요(현행 방식은 노선마다 달라요). 칸을 누르면 두 방식에 그 탑승·φ를 똑같이 주고 차량 조건은 보고서 기본값(디젤 3.49 km/L, 회송 1, 재차 1.1명)으로 맞춰요.'
      : '점은 지금 고른 탑승·φ의 위치예요. 칸을 누르면 두 방식에 그 탑승·φ를 똑같이 주고 차량 조건은 보고서 기본값(디젤 3.49 km/L, 회송 1, 재차 1.1명)으로 맞춰요.';
  }

  // 토네이도(범위 막대): 슬라이더에 없는 입력만
  const TOR = {
    PHI_MAX: ['φ 상한', '축 φ를 자르는 값'], COACH_CAP: ['버스 정원', '석'], LOAD: ['최대 탑승률', '정원 대비'],
    MAX_TRIPS: ['축당 회차 상한', '출근 회'], PT_KM_SCALE: ['평택→화성 거리', '목적지 대표점 배율'],
    TARGET_PHI: ['현행 φ 보정 목표', ''], TARGET_RIDE: ['현행 탑승 보정 목표', '명'], BETA: ['β (PCTR 민감도)', ''],
    THETA: ['대중교통 이용자 전환', '노선 단위'], DETOUR: ['직행 차내시간 배율', ''],
  };
  (function renderTornado() {
    const rows = M.sensitivity.oneway.filter((s) => TOR[s.param]);
    rows.sort((a, b) => (b.ours_max - b.ours_min) + (b.base_max - b.base_min) - (a.ours_max - a.ours_min) - (a.base_max - a.base_min));
    const lo = -1200, hi = 1600, X = (v) => ((v - lo) / (hi - lo)) * 100;
    const oRef = M.model_base.ours.t_year, bRef = M.model_base.base.t_year;
    const range = (s) => { const v = s.values; return `${v[0]}~${v[v.length - 1]}${TOR[s.param][1] === '석' || TOR[s.param][1] === '명' ? TOR[s.param][1] : ''}`; };
    const span = (a, b) => (Math.abs(b - a) < 1 ? `${sgn(a)} 그대로` : `${sgn(a)}~${sgn(b)}`);
    const barH = (min, max, cls) => {
      const flat = max - min < 1;
      return `<i class="bar bar--${cls}${flat ? ' is-flat' : ''}" style="--x:${X(min)}%;--w:${X(max) - X(min)}%"></i>`;
    };
    $('#sim-tor').innerHTML = rows.map((s) => `
      <li><span class="tor-name"><b>${TOR[s.param][0]}</b><small>${range(s)} · PCTR ${span(s.ours_min, s.ours_max)} · 현행 ${span(s.base_min, s.base_max)}</small></span>
        <span class="tor-track" role="img" aria-label="${TOR[s.param][0]} ${range(s)}: PCTR 기준 ${sgn(s.ours_min)}~${sgn(s.ours_max)} 톤, 현행 방식 ${sgn(s.base_min)}~${sgn(s.base_max)} 톤">
          <i class="z" style="--z:${X(0)}%"></i><i class="ref ref--pctr" style="--x:${X(oRef)}%"></i><i class="ref ref--base" style="--x:${X(bRef)}%"></i>
          ${barH(s.ours_min, s.ours_max, 'pctr')}${barH(s.base_min, s.base_max, 'base')}</span></li>`).join('');
    $('#sim-tor-scale').innerHTML = [-1000, -500, 0, 500, 1000, 1500].map((t) => `<em style="left:${X(t)}%">${sgn(t)}</em>`).join('');
  })();

  // ───────── 이벤트 ─────────
  const leavePreset = () => { S.preset = null; };
  for (const k of Object.keys(RANGES)) {
    inp[k].addEventListener('input', () => {
      const v = +inp[k].value;
      leavePreset();
      if (k === 'Np' || k === 'phip' || k === 'Nb' || k === 'phib') {
        if (S.mode !== 'direct') S.mode = 'direct';
        S[k] = v;
        if (S.common && (k === 'Np' || k === 'phip')) { S.Nb = S.Np; S.phib = S.phip; }
      } else {
        if (S.mode === 'snapshot') S.mode = 'model';
        S[k] = v;
      }
      render();
    });
  }
  common.addEventListener('change', () => {
    leavePreset();
    S.common = common.checked;
    if (S.common) { S.Nb = S.Np; S.phib = S.phip; }
    S.mode = 'direct';
    render();
  });
  chips.forEach((c) => c.addEventListener('click', () => { applyPreset(c.dataset.preset); render(); }));
  modeBtns.forEach((m) => m.addEventListener('click', () => {
    const want = m.dataset.mode;
    if (want === 'model' && S.mode !== 'model') { S.mode = 'model'; S.common = false; leavePreset(); }
    else if (want === 'direct' && S.mode !== 'direct') { S.mode = 'direct'; leavePreset(); }
    else return;
    if (S.mode === 'model' && S.vehicle === 'diesel' && S.kmpl === PHYS0.kmpl && S.r === PHYS0.r && S.occ === PHYS0.occ) S.preset = 'base';
    render();
  }));
  vehBtns.forEach((v) => v.addEventListener('click', () => {
    if (S.vehicle === v.dataset.veh) return;
    S.vehicle = v.dataset.veh; leavePreset();
    if (S.mode === 'snapshot') S.mode = 'model';
    render();
  }));
  cells.forEach((c) => c.addEventListener('click', () => {
    Object.assign(S, { ...PHYS0, mode: 'direct', common: true, Np: +c.dataset.n, phip: +c.dataset.phi, Nb: +c.dataset.n, phib: +c.dataset.phi, preset: null });
    if (S.Np === 44 && S.phip === 0.5) S.preset = 'same';
    render();
  }));
  $('#sim-reset').addEventListener('click', () => { applyPreset('base'); render(); });

  // 결과판이 화면 밖으로 나가면 아래에 요약을 띄워요
  document.body.appendChild(dock);
  let boardVisible = true, simVisible = false;
  const syncDock = () => dock.classList.toggle('is-on', !boardVisible && simVisible);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => { boardVisible = e.isIntersecting; syncDock(); }).observe($('#sim-board'));
    new IntersectionObserver(([e]) => { simVisible = e.isIntersecting; syncDock(); }, { rootMargin: '0px 0px -45% 0px' }).observe(root);
  }
  dock.querySelector('#sim-dock-go').addEventListener('click', () => {
    $('#sim-board').scrollIntoView({ behavior: reduceMQ.matches ? 'auto' : 'smooth', block: 'center' });
  });

  applyPreset('base');
  render();
}
