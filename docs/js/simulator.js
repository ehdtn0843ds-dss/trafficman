// 시뮬레이터: 같은 증편 100회(출근 50 + 퇴근 50)를 PCTR 기준 4개 축과 현행 28개 노선 비례 중 어디에 넣을까
// 계산은 전부 js/model.js가 해요.
//   · 두 방식은 각각 '모형 수요'와 '균일 가정' 중 하나로 계산해요(S.mp, S.mb).
//     모형 수요: PCTR 기준 = allocateGreedy(모형 수요), 현행 = annualNet(baseAllocation('base'), 노선별 수요 D·φ)
//       → 연비·회송·재차·차종을 바꿔도 파이썬 sensitivity.json과 같은 값(model.test.mjs 6절)
//     균일 가정: 고정 배분(15/15/15/5회, 28개 노선 비례)에 균일 N·φ → 보고서 표4와 같은 식
//     한쪽 슬라이더만 움직이면 그쪽만 균일 가정으로 바뀌고, 결과 카드에 그 사실을 표시해요.
//   · 비관 조합: 수요 보정을 다시 하는 입력이라 JS로 재계산하지 않고 저장소 결과(sensitivity_combo.json)를 보여 줘요.
//     이때는 슬라이더를 잠가요.
//   · 2만 번 흔들어 보기: montecarlo.py와 같은 식·분포를 mulberry32 난수로 계산(model.js mcSampler)
//   · 보고서 표4는 결과 섹션에 있어요. 그 칸의 링크(a[data-sim-n][data-sim-phi])를 누르면 여기서 받아
//     두 방식에 그 탑승·φ를 똑같이 주고(차량 조건은 기본값) 시뮬레이터로 스크롤해요.
import { loadModel, getModel, annualNet, allocateGreedy, baseAllocation, breakeven, SAFE_RANGES, mcSampler } from './model.js';

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
const UNIT = 'tCO₂/년';

if (root) {
  loadModel(MODEL_URL).then(start).catch((e) => {
    // 안내문만 보여요(콘솔 오류는 남기지 않아요)
    const el = root.querySelector('.mount-empty');
    if (el) el.textContent = '계산 모듈을 불러오지 못했어요. 페이지를 새로 고쳐 주세요.';
    void e;
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
  const PESS = M.sensitivity.pessimistic_combo;
  const nAxesBase = M.routes.length;
  // 비관 조합 입력(sensitivity_combo.json)
  const PESS_LBL = { PHI_MAX: ['φ 상한', ''], LOAD: ['최대 탑승률', ''], CAR_OCC: ['승용차 재차', '명'], PT_KM_SCALE: ['평택→화성 거리', '배'] };
  const pessChips = Object.entries(PESS.inputs).map(([k, v]) => `${(PESS_LBL[k] || [k])[0]} ${v}${(PESS_LBL[k] || [, ''])[1]}`);

  const PRESETS = [
    { id: 'base', group: 'report', label: '보고서 기준값', mp: 'model', mb: 'model', common: false, Np: 44, phip: 0.5, Nb: 19.5, phib: 0.25, ...PHYS0,
      note: `<b>보고서 기준값</b>이에요(보고서 본문의 +1,020 / −793 ${UNIT}). PCTR 축은 모형 수요(회당 44명·φ 0.5), 현행 노선은 노선마다 다른 모형 수요로 계산해요.` },
    { id: 'same', group: 'report', label: '표4처럼 같은 조건', mp: 'direct', mb: 'direct', common: true, Np: 44, phip: 0.5, Nb: 44, phib: 0.5, ...PHYS0,
      note: '<b>보고서 표4</b>의 균일 가정이에요. 두 방식에 똑같이 회당 44명·φ 0.5를 줬어요.' },
    { id: 'uni', group: 'page', label: '현행 전 노선 균일 19.5명', mp: 'model', mb: 'direct', common: false, Np: 44, phip: 0.5, Nb: 19.5, phib: 0.25, ...PHYS0,
      note: `<b>보고서에 없는, 이 페이지에서 계산한 값</b>이에요. 현행 28개 노선 모두에 회당 19.5명·φ 0.25를 똑같이 줬어요. 노선마다 수요가 다른 보고서 기준값(−793)과 달리 −768 ${UNIT}가 나와요. PCTR 쪽은 모형 수요 그대로예요.` },
    { id: 'fcev', group: 'page', label: '수소버스 전환', mp: 'model', mb: 'model', common: false, Np: 44, phip: 0.5, Nb: 19.5, phib: 0.25, ...PHYS0, vehicle: 'fcev',
      note: '<b>보고서에 없는, 이 페이지에서 계산한 값</b>이에요. 차량을 유니버스 수소전기버스(승객 44석, 28.0 km/kg, 개질 수소 9.2 kgCO₂/kg)로 바꾸고 모형 수요로 다시 계산했어요. 보고서는 수소버스의 본전(φ 0.25에서 23.3명)까지만 다뤄요. 수소 배출계수를 0(부생수소)까지 내려 볼 수 있어요.' },
    { id: 'pess', group: 'page', label: '비관 조합', snap: true, mp: 'model', mb: 'model', common: false, Np: 44, phip: 0.5, Nb: 19.5, phib: 0.25, ...PHYS0, occ: 1.3,
      note: '<b>보고서에 없는 값</b>이에요. 저장소의 민감도 스크립트 결과(pctr_commute/result/sensitivity_combo.json)를 그대로 옮겼어요. 아래 네 입력을 한꺼번에 넣은 조합이에요. 수요 보정을 다시 해야 해서 이 페이지에서는 계산하지 못하고, 그래서 슬라이더를 잠갔어요.' },
  ];
  const GROUPS = [['report', '보고서 값'], ['page', '보고서에 없는 계산']];

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
  const BAR_SPAN = 2500;   // 결과판 막대 눈금 고정 (tCO₂/년)

  const ctl = (id, label, sub, cls = '') => `
    <label class="ctl sim-ctl" data-ctl="${id}"><span class="ctl-label">${label}${sub ? `<small>${sub}</small>` : ''}</span>
      <input class="range ${cls}" type="range" id="sim-${id}" min="${RANGES[id].min}" max="${RANGES[id].max}" step="${RANGES[id].step}">
      <output class="ctl-out" id="sim-${id}-out" for="sim-${id}"></output></label>`;

  // 2만 번 흔들어 보기: 보고서 히스토그램 칸(-1,400~+1,700, 60칸)을 그대로 써요
  const MC = M.montecarlo, H = MC.histogram, EDGES = H.edges, NB = H.bins;
  const X0 = EDGES[0], X1 = EDGES[NB], BW = (X1 - X0) / NB;
  const XP = (v) => ((v - X0) / (X1 - X0)) * 100;
  const repDen = { pctr: H.pctr.map((c) => c / H.n), base: H.base.map((c) => c / H.n) };
  const yMax = Math.max(...repDen.pctr, ...repDen.base) * 1.12;
  const stepPath = (den) => {
    let d = `M0 100`;
    den.forEach((v, i) => { const y = 100 - (v / yMax) * 100; d += `L${(i / NB) * 100} ${y.toFixed(2)}L${((i + 1) / NB) * 100} ${y.toFixed(2)}`; });
    return d + 'L100 100';
  };
  const pct = (v) => (v * 100).toFixed(1) + '%';
  const MCSTATS = [
    { id: 'p', label: 'PCTR 기준이 탄소를 줄일 확률', rep: MC.main.P_pctr_gt_0, key: 'P_pctr_gt_0', cls: 'pctr' },
    { id: 'b', label: '현행 방식이 탄소를 늘릴 확률', rep: MC.main.P_base_lt_0, key: 'P_base_lt_0', cls: 'base' },
    { id: 'd', label: 'PCTR 기준이 덜 배출할 확률', rep: MC.main.P_pctr_gt_base, key: 'P_pctr_gt_base', cls: 'diff' },
  ];
  const histBlock = (who, name, den) => `
    <div class="mc-h mc-h--${who}">
      <span class="mc-h-name">${name}</span>
      <div class="mc-plot" style="--z0:${XP(0).toFixed(2)}%">
        <div class="mc-bars" id="mc-bars-${who}">${'<i></i>'.repeat(NB)}</div>
        <svg class="mc-rep" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${stepPath(den)}"/></svg>
        <i class="mc-zero" style="left:${XP(0)}%"></i>
      </div>
    </div>`;

  root.removeAttribute('data-state');
  root.innerHTML = `
  <div class="sim">
    <div class="sim-top">
      <div class="sim-top-row">
        <div class="sim-presets">
          ${GROUPS.map(([g, name]) => `
          <div class="sim-pgroup sim-pgroup--${g}">
            <span class="sim-pgroup-name" id="sim-pg-${g}">${name}</span>
            <div class="chips" role="group" aria-labelledby="sim-pg-${g}">
              ${PRESETS.filter((p) => p.group === g).map((p) => `<button class="chip" type="button" data-preset="${p.id}" aria-pressed="false">${p.label}</button>`).join('')}
            </div>
          </div>`).join('')}
        </div>
        <div class="sim-mode"><span id="sim-mode-label">탑승·φ</span>
          <div class="toggle" role="group" aria-labelledby="sim-mode-label">
            <button type="button" data-mode="model" aria-pressed="true">모형 수요</button>
            <button type="button" data-mode="direct" aria-pressed="false">균일 가정</button>
          </div>
          <span class="sim-mode-mix" id="sim-mode-mix" hidden></span>
        </div>
      </div>
      <p class="sim-preset-note" id="sim-note"></p>
    </div>

    <div class="sim-main">
      <div class="panel sim-board" id="sim-board" tabindex="-1">
        <div class="sim-scores">
          <div class="readout sim-score sim-score--pctr" id="sim-o">
            <span class="sim-who">PCTR 기준 <small>경기 내부 4개 축에 집중</small></span>
            <span class="readout-label">연간 순감축 <span class="sim-basis" id="sim-o-basis"></span></span>
            <span class="readout-value"><span class="v" data-testid="pctr-t">0</span><span class="readout-unit">${UNIT}</span></span>
            <span class="readout-note" id="sim-o-note"></span>
          </div>
          <div class="readout sim-score sim-score--base" id="sim-b">
            <span class="sim-who">현행 방식 <small>28개 노선에 비례 배분</small></span>
            <span class="readout-label">연간 순감축 <span class="sim-basis" id="sim-b-basis"></span></span>
            <span class="readout-value"><span class="v" data-testid="base-t">0</span><span class="readout-unit">${UNIT}</span></span>
            <span class="readout-note" id="sim-b-note"></span>
          </div>
        </div>
        <div class="dv" aria-hidden="true">
          <div class="dv-row dv-row--pctr"><span class="dv-name">PCTR 기준</span><div class="dv-track"><i class="dv-bar" id="sim-dv-o"></i></div></div>
          <div class="dv-row dv-row--base"><span class="dv-name">현행 방식</span><div class="dv-track"><i class="dv-bar" id="sim-dv-b"></i></div></div>
          <div class="dv-scale"><span></span><span><span class="t-add">${MINUS}${int(BAR_SPAN)} 늘어요</span><span>0</span><span class="t-cut">+${int(BAR_SPAN)} 줄어요</span></span></div>
        </div>
        <div class="sim-verdict">
          <strong class="verdict-head" id="sim-head"></strong>
          <p class="verdict-text" id="sim-why"></p>
          <div class="sim-combo" id="sim-combo" hidden>
            <span class="sim-combo-name">한꺼번에 바꾼 입력</span>
            <ul class="sim-combo-list">${pessChips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
          </div>
        </div>
      </div>

      <div class="panel sim-ctls" id="sim-ctls">
        <div class="sim-lock" id="sim-lock" hidden>
          <p>비관 조합은 저장소 계산 결과를 그대로 옮긴 값이라 슬라이더를 잠갔어요. 여기서 슬라이더를 움직이면 φ 상한·탑승률·거리 배율이 빠진 다른 계산이 돼요.</p>
          <button class="ticket ticket--solid" type="button" id="sim-unlock">보고서 기준값으로 돌아가 조절하기</button>
        </div>
        <div class="sim-group" role="group" aria-labelledby="sim-g1">
          <div class="sim-group-head"><h3 id="sim-g1">탑승과 승용차 출신 비율</h3>
            <label class="switch"><input type="checkbox" id="sim-common"><span>두 방식에 같은 값</span></label></div>
          <p class="sim-hint" id="sim-hint-n"></p>
          <p class="sim-who-line sim-who-line--pctr" id="sim-wl-p"><i></i><span>PCTR 기준</span></p>
          ${ctl('Np', '회당 탑승', '출근 1회 평균, 명')}
          ${ctl('phip', '승용차 출신 φ', '원래 승용차 통근자 비율', 'range--car')}
          <p class="sim-who-line sim-who-line--base" id="sim-wl-b"><i></i><span>현행 방식</span></p>
          ${ctl('Nb', '회당 탑승', '출근 1회 평균, 명')}
          ${ctl('phib', '승용차 출신 φ', '원래 승용차 통근자 비율', 'range--car')}
        </div>
        <div class="sim-group" role="group" aria-labelledby="sim-g2">
          <div class="sim-group-head"><h3 id="sim-g2">차량과 운행 <span class="sim-sub">두 방식 공통</span></h3>
            <div class="toggle" role="group" aria-label="차종">
              <button type="button" data-veh="diesel" aria-pressed="true">디젤 44석</button>
              <button type="button" data-veh="fcev" aria-pressed="false">수소전기 44석</button>
            </div></div>
          <p class="sim-hint" id="sim-veh-hint"></p>
          ${ctl('kmpl', '디젤 연비', 'km/L, 근거 2.83~4.0')}
          ${ctl('kmpkg', '수소 연비', 'km/kg, 공식 28.0')}
          ${ctl('h2', '수소 배출계수', 'kgCO₂/kgH₂, 부생 0~개질 9.2')}
          ${ctl('r', '빈 차 회송', '운행 1회당 회송 비율')}
          ${ctl('occ', '승용차 재차', '승용차 1대에 탄 평균 인원')}
        </div>
        <button class="ticket sim-reset" type="button" id="sim-reset">보고서 기준값으로 되돌리기</button>
      </div>

      <div class="panel sim-aux" id="sim-aux">
        <div>
          <h3>하루 승용차에서 옮겨 오는 사람 <span class="sim-sub">출근 기준 실인원</span></h3>
          <div class="sim-pair">
            <div class="readout is-pctr"><span class="readout-label">PCTR 기준</span><span class="readout-value" id="sim-shift-o">0</span><span class="readout-note" id="sim-ride-o"></span></div>
            <div class="readout is-base"><span class="readout-label">현행 방식</span><span class="readout-value" id="sim-shift-b">0</span><span class="readout-note" id="sim-ride-b"></span></div>
          </div>
        </div>
        <div>
          <h3>회당 승용차 출신 승객과 본전 <span class="sim-sub">세로선이 본전(이만큼 타야 탄소가 줄기 시작해요)</span></h3>
          <div class="sim-pair">
            <div class="sim-m" id="sim-m-o"></div>
            <div class="sim-m" id="sim-m-b"></div>
          </div>
        </div>
        <details class="sim-fold sim-fold--in">
          <summary><span class="sim-fold-t">어디서 줄고 어디서 늘었나</span> <span class="sim-sub">축·노선별, ${UNIT}</span></summary>
          <div id="sim-contrib"></div>
        </details>
      </div>
    </div>

    <details class="panel sim-fold">
      <summary><span class="sim-fold-t">슬라이더로 못 바꾸는 입력 10개</span> <span class="sim-sub">보고서 일변량 민감도, ${UNIT}</span></summary>
      <div class="sim-fold-body">
        <ul class="key"><li><span class="sw sw--car"></span>PCTR 기준 범위</li><li><span class="sw sw--seoul"></span>현행 방식 범위</li><li><span class="sw sw--line"></span>기준값</li></ul>
        <ul class="tor" id="sim-tor"></ul>
        <div class="tor-scale" aria-hidden="true"><span></span><span id="sim-tor-scale"></span></div>
        <p class="chart-cap">정원·φ 상한·β처럼 수요 보정을 다시 해야 하는 입력은 여기서 계산하지 않고 보고서 결과(sensitivity.json)를 그대로 옮겼어요. 막대는 각 입력을 근거 범위 끝까지 바꿨을 때 결과가 움직인 폭이에요. 도보 접근 시간과 DRT 대기 시간은 두 결과를 바꾸지 않았어요.</p>
      </div>
    </details>

    <div class="caveat sim-limit"><p>보고서 기준값은 모형이 정한 수요(PCTR 축 만석·φ 0.5)에 기대요. 편하G 이용자의 이전 수단 설문이 없어 실제 φ는 개통 전 주민 설문으로 확인해야 해요. 아래에서 탑승·φ를 넓은 범위에서 한꺼번에 흔들어 볼 수 있어요.</p></div>

    <div class="panel sim-mc" id="sim-mc">
      <div class="mc-top">
        <div>
          <h3>2만 번 흔들어 보기 <span class="sim-sub">보고서 몬테카를로와 같은 식·같은 범위</span></h3>
          <p class="mc-lede">탑승·φ·연비·회송·재차를 범위 안에서 2만 번 뽑아, 결론이 얼마나 자주 유지되는지 봐요.</p>
        </div>
        <div class="mc-actions">
          <button class="ticket ticket--solid" type="button" id="mc-run" aria-expanded="false" aria-controls="mc-body">2만 번 흔들어 보기</button>
          <button class="ticket" type="button" id="mc-again" hidden>다른 시드로 다시</button>
        </div>
      </div>
      <div class="mc-open" id="mc-body" hidden>
        <p class="mc-ranges">탑승(PCTR 축 20~44명, 현행 15~40명), φ(0.17~0.6, 0.15~0.35), 디젤 연비(2.83~4.0 km/L), 회송(0~1), 재차(1.1~1.4명)를 고르게 뽑아요. 위 슬라이더 값과는 따로 계산해요.</p>
        <div class="mc-body">
          <div class="mc-stats">
            ${MCSTATS.map((s) => `
            <div class="mc-stat mc-stat--${s.cls}">
              <span class="mc-stat-label">${s.label}</span>
              <span class="mc-stat-row"><b class="mc-stat-v" id="mc-v-${s.id}" data-testid="mc-${s.id}">—</b>
                <span class="mc-stat-rep">(보고서 ${Math.round(s.rep * 100)}%)</span></span>
            </div>`).join('')}
            <div class="mc-progress" aria-hidden="true"><i id="mc-prog"></i></div>
            <p class="mc-count" id="mc-count"></p>
          </div>
          <figure class="mc-fig">
            <ul class="key"><li><span class="sw sw--car"></span>PCTR 기준</li><li><span class="sw sw--seoul"></span>현행 방식</li><li><span class="sw sw--line"></span>보고서 분포</li></ul>
            <div class="mc-hists" role="img" id="mc-hists" aria-label="연간 순감축 분포. 계산 전이에요">
              ${histBlock('pctr', 'PCTR 기준', repDen.pctr)}
              ${histBlock('base', '현행 방식', repDen.base)}
              <div class="mc-axis"><span></span><span class="mc-ticks">${[-1000, -500, 0, 500, 1000, 1500].map((t) => `<em style="left:${XP(t)}%">${sgn(t)}</em>`).join('')}</span></div>
              <div class="mc-axis mc-axis--lab"><span></span><span><span class="t-add">← 늘어요</span><span>${UNIT}</span><span class="t-cut">줄어요 →</span></span></div>
            </div>
          </figure>
        </div>
        <p class="chart-cap" id="mc-cap">보고서는 파이썬 난수로, 이 페이지는 브라우저 난수(mulberry32)로 뽑아서 확률이 1%p 안쪽에서 달라질 수 있어요. 분포를 읽는 방법은 <a href="#hypothesis">가설 점검</a>에 있어요.</p>
      </div>
      <p class="sr-only" aria-live="polite" id="mc-live"></p>
    </div>
    <p class="sr-only" aria-live="polite" id="sim-live"></p>
  </div>
  <div class="sim-dock" id="sim-dock" aria-hidden="true">
    <span><small>PCTR</small> <b class="d-p" id="sim-dock-o"></b></span>
    <span class="d-sep">·</span>
    <span><small>현행</small> <b class="d-b" id="sim-dock-b"></b></span>
    <small class="d-unit">${UNIT}</small>
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
  const modeMix = $('#sim-mode-mix');
  const dock = $('#sim-dock'), dockO = $('#sim-dock-o'), dockB = $('#sim-dock-b');

  // ───────── 상태 ─────────
  // S.mp / S.mb: 'model'(모형 수요) | 'direct'(균일 가정). S.snap: 비관 조합 스냅샷.
  // S.flipP / S.flipB: 사용자가 건드려서 모형 수요 → 균일 가정으로 바뀐 시각(카드 배지용)
  function applyPreset(id) {
    const p = PRESETS.find((x) => x.id === id);
    Object.assign(S, { snap: !!p.snap, mp: p.mp, mb: p.mb, common: p.common, Np: p.Np, phip: p.phip, Nb: p.Nb, phib: p.phib,
      vehicle: p.vehicle, kmpl: p.kmpl, kmpkg: p.kmpkg, h2: p.h2, r: p.r, occ: p.occ, preset: id, flipP: 0, flipB: 0 });
  }
  // 지금 상태가 어떤 예시와 같으면 그 칩을 켜요(예: 기본값에서 수소전기 토글 = '수소버스 전환')
  const sig = (x) => {
    const nB = x.common ? x.Np : x.Nb, pB = x.common ? x.phip : x.phib;
    return [x.mp, x.mb,
      x.mp === 'direct' ? `${+x.Np}/${+x.phip}` : '-',
      x.mb === 'direct' ? `${+nB}/${+pB}` : '-',
      x.vehicle, x.vehicle === 'fcev' ? `${+x.kmpkg}/${+x.h2}` : `${+x.kmpl}`, +x.r, +x.occ].join('|');
  };
  const matchPreset = () => { const k = sig(S); return PRESETS.find((p) => !p.snap && sig(p) === k)?.id ?? null; };
  const phys = () => (S.vehicle === 'fcev'
    ? { vehicle: 'fcev', kmpkg: S.kmpkg, h2: S.h2, r: S.r, occ: S.occ }
    : { vehicle: 'diesel', kmpl: S.kmpl, r: S.r, occ: S.occ });
  const nb = () => (S.common ? S.Np : S.Nb);
  const pb = () => (S.common ? S.phip : S.phib);
  const toDirect = (side) => {
    if (side === 'p' && S.mp === 'model') { S.mp = 'direct'; S.flipP = performance.now(); }
    if (side === 'b' && S.mb === 'model') { S.mb = 'direct'; S.flipB = performance.now(); }
  };

  function compute() {
    const P = phys();
    if (S.snap) {
      return { snap: true, o: { tYear: PESS.ours_t, items: [], riders: 0, carShift: 0, trips: 0 },
               b: { tYear: PESS.base_t, items: null, riders: null, carShift: null, trips: 100 } };
    }
    const o = S.mp === 'model' ? allocateGreedy(P).result : annualNet({ ...P, allocation: OURS_KM, N: S.Np, phi: S.phip });
    const b = S.mb === 'model' ? annualNet({ ...P, allocation: BASE_D }) : annualNet({ ...P, allocation: BASE_KM, N: nb(), phi: pb() });
    return { o, b };
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

  // 결과 카드의 계산 근거 표시. 방금 균일 가정으로 바뀐 쪽은 잠깐 강조해요
  const FLAG_MS = 6000;
  let flagTimer = 0;
  function basis(el, side) {
    const mode = side === 'p' ? S.mp : S.mb;
    const flip = side === 'p' ? S.flipP : S.flipB;
    const fresh = mode === 'direct' && flip && performance.now() - flip < FLAG_MS;
    let txt;
    if (S.snap) txt = '저장소 계산 결과';
    else if (mode === 'model') txt = side === 'p' ? '모형 수요' : '노선별 모형 수요';
    else if (fresh) txt = '균일 가정으로 바뀌었어요';
    else txt = side === 'p' ? `균일 ${+S.Np.toFixed(1)}명×${S.phip.toFixed(2)}` : `균일 ${+nb().toFixed(1)}명×${pb().toFixed(2)}`;
    el.textContent = txt;
    el.className = 'sim-basis' + (mode === 'direct' && !S.snap ? ' is-uniform' : '') + (fresh ? ' is-flag' : '');
    el.title = mode === 'direct' && !S.snap ? '모든 축(노선)에 같은 탑승과 φ를 준 계산이에요' : '';
    return fresh;
  }

  // ───────── 그리기 ─────────
  let liveTimer = 0, first = true;
  function render() {
    const res = compute();
    const { o, b } = res;
    const ot = o.tYear, bt = b.tYear;

    // 입력 반영
    for (const k of Object.keys(RANGES)) {
      inp[k].value = S[k];
      out[k].textContent = OUT[k](S[k]);
      setFill(inp[k]);
      inp[k].disabled = !!S.snap;
    }
    if (S.common) { inp.Nb.value = S.Np; inp.phib.value = S.phip; }
    row.Nb.hidden = row.phib.hidden = S.common;
    $('#sim-wl-b').hidden = S.common;
    $('#sim-wl-p span').textContent = S.common ? '두 방식 공통' : 'PCTR 기준';
    $('#sim-wl-p').className = 'sim-who-line ' + (S.common ? '' : 'sim-who-line--pctr');
    const pModel = S.snap || S.mp === 'model', bModel = S.snap || S.mb === 'model';
    row.Np.classList.toggle('is-model', pModel); row.phip.classList.toggle('is-model', pModel);
    row.Nb.classList.toggle('is-model', bModel); row.phib.classList.toggle('is-model', bModel);
    if (bModel) { out.Nb.textContent = '노선별'; out.phib.textContent = '노선별'; }
    common.checked = S.common;
    common.disabled = !!S.snap;
    row.kmpl.hidden = S.vehicle === 'fcev';
    row.kmpkg.hidden = row.h2.hidden = S.vehicle !== 'fcev';
    $('#sim-veh-hint').hidden = S.vehicle !== 'fcev';
    $('#sim-veh-hint').textContent = '유니버스 수소전기버스는 45인승(운전석 포함)이라 승객 정원 44석으로 계산해요.';
    $('#sim-lock').hidden = !S.snap;
    $('#sim-ctls').classList.toggle('is-locked', !!S.snap);
    if (!S.snap) S.preset = matchPreset();
    chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.preset === S.preset)));
    const allModel = !S.snap && S.mp === 'model' && S.mb === 'model';
    const allDirect = !S.snap && S.mp === 'direct' && S.mb === 'direct';
    modeBtns.forEach((m) => {
      m.setAttribute('aria-pressed', String(m.dataset.mode === 'model' ? (allModel || !!S.snap) : allDirect));
      m.disabled = !!S.snap;
    });
    const mixed = !S.snap && !allModel && !allDirect;
    modeMix.hidden = !mixed;
    modeMix.textContent = mixed ? `섞여 있어요: PCTR ${S.mp === 'model' ? '모형 수요' : '균일'} · 현행 ${S.mb === 'model' ? '모형 수요' : '균일'}` : '';
    vehBtns.forEach((v) => { v.setAttribute('aria-pressed', String(v.dataset.veh === S.vehicle)); v.disabled = !!S.snap; });
    const preset = PRESETS.find((p) => p.id === S.preset);
    const sideTxt = (m) => (m === 'model' ? '모형 수요' : '직접 정한 균일 가정');
    $('#sim-note').innerHTML = preset ? preset.note
      : S.mp === 'direct' && S.mb === 'direct'
        ? (S.common ? '두 방식에 <b>같은 탑승·φ</b>를 직접 줬어요. 배분은 보고서와 같게 고정했어요(PCTR 4개 축 15/15/15/5회, 현행 28개 노선 비례).'
                    : '두 방식의 탑승·φ를 <b>따로 직접</b> 정했어요. 배분은 보고서와 같게 고정했어요(PCTR 4개 축 15/15/15/5회, 현행 28개 노선 비례).')
        : S.mp === 'model' && S.mb === 'model'
          ? '<b>모형 수요</b>로 계산하고 있어요. 차량 조건을 바꾸면 PCTR 기준은 회차 배분까지 다시 계산해요.'
          : `PCTR 기준은 <b>${sideTxt(S.mp)}</b>, 현행 방식은 <b>${sideTxt(S.mb)}</b>으로 계산하고 있어요. 건드리지 않은 쪽은 모형 수요를 그대로 써요.`;
    $('#sim-hint-n').innerHTML = S.snap ? '비관 조합은 보고서 밖 계산 결과라 탑승·φ를 바꿀 수 없어요.'
      : (S.mp === 'model' || S.mb === 'model')
        ? '모형 수요를 쓰는 쪽은 축·노선마다 모형이 정한 탑승과 φ를 써요. 한쪽 슬라이더를 움직이면 <b>그쪽만</b> 모든 축(노선)에 같은 값을 주는 균일 가정으로 바뀌어요.'
        : '모든 축(노선)에 같은 탑승과 φ를 준 균일 가정이에요.';

    // 결과판
    const oEl = $('#sim-o'), bEl = $('#sim-b');
    oEl.classList.toggle('is-cut', ot >= 0.5); oEl.classList.toggle('is-add', ot <= -0.5);
    bEl.classList.toggle('is-cut', bt >= 0.5); bEl.classList.toggle('is-add', bt <= -0.5);
    tween($('#sim-o .v'), ot, (v) => sgn(v));
    tween($('#sim-b .v'), bt, (v) => sgn(v));
    const fo = basis($('#sim-o-basis'), 'p'), fb = basis($('#sim-b-basis'), 'b');
    clearTimeout(flagTimer);
    if (fo || fb) flagTimer = setTimeout(() => { basis($('#sim-o-basis'), 'p'); basis($('#sim-b-basis'), 'b'); }, FLAG_MS + 50);
    const word = (t) => (t >= 0.5 ? '줄어요' : t <= -0.5 ? '늘어요' : '변화 없어요');
    $('#sim-o-note').textContent = res.snap ? '어느 축도 본전을 넘지 못해 버스를 넣지 않아요' : `${o.trips}회 운행 · 탄소가 ${word(ot)}`;
    $('#sim-b-note').textContent = res.snap ? `100회 운행 · 탄소가 ${word(bt)}` : `${b.trips}회 운행 · 탄소가 ${word(bt)}`;

    const bar = (el, t) => {
      const w = (Math.min(Math.abs(t), BAR_SPAN) / BAR_SPAN) * 50;
      el.style.setProperty('--w', w + '%');
      el.style.setProperty('--x', (t >= 0 ? 50 : 50 - w) + '%');
      el.classList.toggle('is-add', t < 0);
      el.classList.toggle('is-over', Math.abs(t) > BAR_SPAN);
    };
    bar($('#sim-dv-o'), ot); bar($('#sim-dv-b'), bt);

    // 판정
    const d = ot - bt, ad = int(Math.abs(d));
    let head, cls;
    if (res.snap) { head = `PCTR 기준은 버스를 넣지 않고(0), 현행 방식은 ${int(-bt)} ${UNIT} 늘려요`; cls = 'is-even'; }
    else if (Math.abs(d) < 5) { head = '두 방식의 결과가 거의 같아요'; cls = 'is-even'; }
    else if (d > 0) {
      if (ot >= 0.5 && bt <= -0.5) head = `PCTR 기준은 줄이고 현행 방식은 늘려요. 차이는 ${ad} ${UNIT}예요`;
      else if (ot < 0.5) head = `두 방식 모두 탄소가 늘지만, PCTR 기준이 ${ad} ${UNIT} 덜 늘어요`;
      else head = `이 조건에서는 PCTR 기준이 ${ad} ${UNIT} 더 줄여요`;
      cls = ot >= 0.5 ? 'is-cut' : 'is-add';
    } else {
      if (bt < 0.5) head = `두 방식 모두 탄소가 늘고, 현행 방식이 ${ad} ${UNIT} 덜 늘어요`;
      else head = `이 조건에서는 현행 방식이 ${ad} ${UNIT} 더 줄여요`;
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
    const zeroBus = S.vehicle === 'fcev' && S.h2 < 0.05;   // 수소 생산 배출 0 → 본전 0
    let why;
    if (res.snap) why = '비관 조합에서는 PCTR 축도 회당 승용차 출신이 본전에 못 미쳐 그리디 배분이 한 회차도 고르지 않았어요. 현행 방식은 배분 규칙상 그대로 100회를 넣어요.';
    else if (zeroBus) why = `수소 생산 배출을 0으로 두면(부생수소 등 생산 배출 0 가정) 버스 쪽 배출이 없어서, 승용차 출신이 한 명만 타도 탄소가 줄어요.${po && pbb ? ` 회당 승용차 출신은 PCTR 기준 ${x1(po.m)}명, 현행 방식 ${x1(pbb.m)}명이에요.` : ''}`;
    else if (S.mp === 'direct' && S.mb === 'direct' && S.common) why = '탑승과 φ가 같으면 축 길이 차이만 남아요. 현행 노선이 평균 39.2 km로 PCTR 축(29.3 km)보다 길어서 절댓값이 더 커요. PCTR 기준이 유리하다는 결론은 고PCTR 축에 승용차 출신이 더 많이 탄다는 가설에 달려 있어요.';
    else if (po && pbb) {
      const lead = (x) => (x.m >= x.mstar ? '본전을 넘어요' : '본전에 못 미쳐요');
      why = `회당 승용차 출신이 PCTR 기준 ${x1(po.m)}명(본전 ${x1(po.mstar)}명)으로 ${lead(po)}. 현행 방식은 ${x1(pbb.m)}명(본전 ${x1(pbb.mstar)}명)으로 ${lead(pbb)}.`;
    } else if (pbb) why = `PCTR 기준은 넣을 만한 축이 없어 한 회차도 배분하지 않았어요. 현행 방식은 회당 승용차 출신 ${x1(pbb.m)}명으로 본전 ${x1(pbb.mstar)}명${pbb.m >= pbb.mstar ? '을 넘어요' : '에 못 미쳐요'}.`;
    else why = '';
    $('#sim-why').textContent = why;
    $('#sim-combo').hidden = !res.snap;
    $('#sim-aux').hidden = !!res.snap;

    // 하루 승용차 전환
    const shift = (el, note, r, p, side) => {
      if (r.carShift == null) { el.textContent = '—'; el._v = undefined; note.textContent = '저장소 결과에 하루 인원이 없어요'; return; }
      tween(el, r.carShift, (v) => int(v) + '명');
      const mode = side === 'p' ? S.mp : S.mb;
      const asm = mode === 'model' ? (side === 'p' ? '모형 수요(만석·φ 0.5) 가정' : '노선별 모형 수요 가정') : '균일 가정';
      note.textContent = `하루 이용 ${int(r.riders)}명 중` + (p ? ` · 회당 ${x1(p.N)}명` : '') + ` · ${asm}`;
    };
    shift($('#sim-shift-o'), $('#sim-ride-o'), o, po, 'p');
    shift($('#sim-shift-b'), $('#sim-ride-b'), b, pbb, 'b');

    const meter = (el, p, who) => {
      if (!p) { el.innerHTML = `<b>${who}</b><br>${res.snap ? '저장소 결과에 회당 값이 없어요' : '운행이 없어요'}`; return; }
      const ok = p.m >= p.mstar;
      const bep = p.mstar < 0.05 ? '본전 0명(버스 배출 0)' : `본전 ${x1(p.mstar)}명`;
      el.innerHTML = `<b>${who}</b> 회당 <b class="${ok ? 'pos' : 'neg'}">${x1(p.m)}명</b> / ${bep}
        <div class="meter${ok ? ' is-cut' : ''}" style="--v:${Math.min(100, (p.m / 44) * 100)}%;--t:${Math.min(100, (p.mstar / 44) * 100)}%" aria-hidden="true"><i></i><b></b></div>
        <div class="meter-scale" aria-hidden="true"><span>0</span><span>44석</span></div>`;
    };
    meter($('#sim-m-o'), po, 'PCTR 기준');
    meter($('#sim-m-b'), pbb, '현행 방식');

    renderContrib(res);

    dockO.textContent = sgn(ot);
    dockB.textContent = sgn(bt);

    if (!first) {
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => {
        const flag = [fo && 'PCTR 기준', fb && '현행 방식'].filter(Boolean);
        $('#sim-live').textContent = `PCTR 기준 ${sgn(ot)} 톤, 현행 방식 ${sgn(bt)} 톤. ${head}.` + (flag.length ? ` ${flag.join('과 ')}은 균일 가정으로 바뀌었어요.` : '');
      }, 900);
    }
    first = false;
  }
  const x1 = (v) => v.toFixed(1);

  function renderContrib(res) {
    const box = $('#sim-contrib');
    if (res.snap) { box.innerHTML = '<p class="contrib-empty">비관 조합은 저장소 결과에 합계만 있어서 축별로 나누지 않았어요.</p>'; return; }
    const oItems = res.o.items.slice().sort((a, b) => b.tYear - a.tYear)
      .map((x) => ({ name: shortAxis(x.key), sub: `출근 ${x.tripsAM}회`, t: x.tYear }));
    const bAll = res.b.items.slice().sort((a, b) => Math.abs(b.tYear) - Math.abs(a.tYear));
    const top = 5;
    const bItems = bAll.slice(0, top).map((x) => {
      const r = ROUTE[x.key];
      return { name: `${shortCity(r.origin)}→${shortCity(r.dest_sgg)}`, sub: `${x.key}번`, t: x.tYear };
    });
    const rest = bAll.slice(top);
    if (rest.length) bItems.push({ name: `나머지 ${rest.length}개 노선`, sub: '', t: rest.reduce((s, x) => s + x.tYear, 0) });
    const mx = Math.max(100, ...oItems.map((x) => Math.abs(x.t)), ...bItems.map((x) => Math.abs(x.t)));
    const li = (x) => {
      const w = (Math.abs(x.t) / mx) * 50;
      return `<li><span class="c-name">${esc(x.name)}${x.sub ? ` <small>${esc(x.sub)}</small>` : ''}</span>
        <span class="c-track" aria-hidden="true"><i class="${x.t < 0 ? 'is-add' : ''}" style="--x:${x.t >= 0 ? 50 : 50 - w}%;--w:${w}%"></i></span>
        <b class="${x.t >= 0.5 ? 'pos' : x.t <= -0.5 ? 'neg' : ''}">${sgn(x.t)}</b></li>`;
    };
    box.innerHTML =
      `<p class="contrib-head contrib-head--pctr"><i></i>PCTR 기준 · 배분된 축과 출근 회차</p>` +
      (oItems.length ? `<ul class="contrib">${oItems.map(li).join('')}</ul>` : '<p class="contrib-empty">배분된 축이 없어요.</p>') +
      `<p class="contrib-head contrib-head--base"><i></i>현행 방식 · 영향이 큰 노선 ${Math.min(top, bAll.length)}개와 나머지 (${nAxesBase}개 노선)</p>` +
      `<ul class="contrib">${bItems.map(li).join('')}</ul>`;
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
      if (S.snap) return;
      const v = +inp[k].value;
      leavePreset();
      if (k === 'Np' || k === 'phip') {
        toDirect('p');
        S[k] = v;
        if (S.common) { toDirect('b'); S.Nb = S.Np; S.phib = S.phip; }
      } else if (k === 'Nb' || k === 'phib') {
        toDirect('b');
        S[k] = v;
      } else {
        S[k] = v;
      }
      render();
    });
  }
  common.addEventListener('change', () => {
    if (S.snap) return;
    leavePreset();
    S.common = common.checked;
    if (S.common) { toDirect('p'); toDirect('b'); S.Nb = S.Np; S.phib = S.phip; }
    render();
  });
  chips.forEach((c) => c.addEventListener('click', () => { applyPreset(c.dataset.preset); render(); }));
  modeBtns.forEach((m) => m.addEventListener('click', () => {
    if (S.snap) return;
    const want = m.dataset.mode;
    if (want === 'model') {
      if (S.mp === 'model' && S.mb === 'model') return;
      Object.assign(S, { mp: 'model', mb: 'model', common: false, flipP: 0, flipB: 0 });
      leavePreset();
    } else {
      if (S.mp === 'direct' && S.mb === 'direct') return;
      toDirect('p'); toDirect('b'); leavePreset();
    }
    render();
  }));
  vehBtns.forEach((v) => v.addEventListener('click', () => {
    if (S.snap || S.vehicle === v.dataset.veh) return;
    S.vehicle = v.dataset.veh; leavePreset();
    render();
  }));
  // 결과 섹션 표4 칸의 링크: 두 방식 공통 N·φ, 차량 조건은 기본값으로 맞추고 시뮬레이터로 가요
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[data-sim-n][data-sim-phi]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const n = +a.dataset.simN, phi = +a.dataset.simPhi;
    if (!(n >= R.N.min && n <= R.N.max && phi >= R.phi.min && phi <= R.phi.max)) return;
    e.preventDefault();
    Object.assign(S, { ...PHYS0, snap: false, mp: 'direct', mb: 'direct', common: true, Np: n, phip: phi,
      Nb: n, phib: phi, preset: null, flipP: 0, flipB: 0 });
    render();
    $('#sim-note').innerHTML = `보고서 표4의 칸(회당 ${n}명·φ ${phi})을 <b>두 방식에 똑같이</b> 줬어요. 차량 조건은 보고서 기본값으로 맞췄어요.`;
    const sec = document.getElementById('simulator') || root;
    sec.scrollIntoView({ behavior: reduceMQ.matches ? 'auto' : 'smooth', block: 'start' });
    $('#sim-board').focus({ preventScroll: true });
    if (history.replaceState) history.replaceState(null, '', '#simulator');
  });
  $('#sim-reset').addEventListener('click', () => { applyPreset('base'); render(); });
  $('#sim-unlock').addEventListener('click', () => {
    applyPreset('base'); render();
    inp.Np.focus({ preventScroll: true });
  });

  // 결과판이 화면 밖으로 나가면 아래에 요약을 띄워요. 탐색기 구역이 보이기 시작하면 바로 숨겨요
  document.body.appendChild(dock);
  // 결과판을 위로 지나친 뒤(결과판 아래쪽이 헤더 밑으로 들어간 뒤), 시뮬레이터 안에 있을 때만 보여요
  const nextSec = document.getElementById('explorer');
  const headH = () => Math.round(document.querySelector('.sign')?.getBoundingClientRect().height || 52);
  let boardPassed = false, simVisible = false, nextVisible = false;
  const syncDock = () => dock.classList.toggle('is-on', boardPassed && simVisible && !nextVisible);
  if ('IntersectionObserver' in window) {
    const rm = `-${headH()}px 0px 0px 0px`;
    new IntersectionObserver(([e]) => {
      boardPassed = !e.isIntersecting && e.boundingClientRect.bottom <= headH() + 1;
      syncDock();
    }, { rootMargin: rm }).observe($('#sim-board'));
    new IntersectionObserver(([e]) => { simVisible = e.isIntersecting; syncDock(); }, { rootMargin: rm }).observe(root);
    if (nextSec) new IntersectionObserver(([e]) => { nextVisible = e.isIntersecting; syncDock(); }).observe(nextSec);
  }
  dock.querySelector('#sim-dock-go').addEventListener('click', () => {
    $('#sim-board').scrollIntoView({ behavior: reduceMQ.matches ? 'auto' : 'smooth', block: 'center' });
  });

  // ───────── 2만 번 흔들어 보기 ─────────
  (function monteCarlo() {
    const runBtn = $('#mc-run'), againBtn = $('#mc-again');
    const bars = { pctr: [...root.querySelectorAll('#mc-bars-pctr i')], base: [...root.querySelectorAll('#mc-bars-base i')] };
    const N = MC.n_draws, PER_FRAME = 320;
    let raf = 0, seed = MC.seed, runs = 0;
    const body = $('#mc-body');

    function draw(st) {
      const n = st.n || 1;
      for (const who of ['pctr', 'base']) {
        const cnt = st.h[who];
        bars[who].forEach((el, i) => { el.style.height = Math.min(100, (cnt[i] / n / yMax) * 100) + '%'; });
      }
      for (const s of MCSTATS) {
        const v = st.n ? st[s.key] / st.n : null;
        $(`#mc-v-${s.id}`).textContent = v == null ? '—' : pct(v);
      }
      $('#mc-prog').style.width = (st.n / N) * 100 + '%';
      $('#mc-count').textContent = `${int(st.n)} / ${int(N)}회 · 시드 ${seed}`;
    }
    function finish(st) {
      runBtn.disabled = false; againBtn.hidden = false; againBtn.disabled = false;
      runBtn.textContent = '같은 시드로 다시';
      const v = (k) => pct(st[k] / st.n);
      $('#mc-hists').setAttribute('aria-label', `연간 순감축 분포 2만 회. PCTR 기준 순감축 확률 ${v('P_pctr_gt_0')}, 현행 방식 순증가 확률 ${v('P_base_lt_0')}. 보고서 분포와 거의 겹쳐요.`);
      $('#mc-live').textContent = `2만 번 계산을 마쳤어요. PCTR 기준이 줄일 확률 ${v('P_pctr_gt_0')}(보고서 61%), 현행 방식이 늘릴 확률 ${v('P_base_lt_0')}(보고서 86%), PCTR 기준이 덜 배출할 확률 ${v('P_pctr_gt_base')}(보고서 87%).`;
    }
    function run(newSeed) {
      cancelAnimationFrame(raf);
      seed = newSeed;
      runs++;
      const sm = mcSampler({ seed });
      const st = { n: 0, P_pctr_gt_0: 0, P_base_lt_0: 0, P_pctr_gt_base: 0, h: { pctr: new Array(NB).fill(0), base: new Array(NB).fill(0) } };
      const bin = (v) => { const i = Math.floor((v - X0) / BW); return i >= 0 && i < NB ? i : -1; };
      const step = (k) => {
        for (let j = 0; j < k && st.n < N; j++) {
          const { tp, tb } = sm.next();
          st.n++;
          if (tp > 0) st.P_pctr_gt_0++;
          if (tb < 0) st.P_base_lt_0++;
          if (tp > tb) st.P_pctr_gt_base++;
          const a = bin(tp), b = bin(tb);
          if (a >= 0) st.h.pctr[a]++;
          if (b >= 0) st.h.base[b]++;
        }
      };
      runBtn.disabled = true; againBtn.disabled = true;
      body.hidden = false; runBtn.setAttribute('aria-expanded', 'true');
      $('#sim-mc').classList.add('is-open');
      $('#mc-live').textContent = '2만 번 계산을 시작했어요.';
      if (reduceMQ.matches) { step(N); draw(st); finish(st); return; }
      const frame = () => {
        step(PER_FRAME);
        draw(st);
        if (st.n < N) raf = requestAnimationFrame(frame); else finish(st);
      };
      raf = requestAnimationFrame(frame);
    }
    runBtn.addEventListener('click', () => run(seed));
    againBtn.addEventListener('click', () => run((MC.seed + runs * 7919) >>> 0));
    draw({ n: 0, h: { pctr: new Array(NB).fill(0), base: new Array(NB).fill(0) } });
  })();

  applyPreset('base');
  render();
}
