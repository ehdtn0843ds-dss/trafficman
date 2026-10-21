// 히어로: 44석 좌석 배치도
// 회당 탑승 N과 승용차 출신 비율 φ를 바꾸면 좌석이 채워지고,
// 본전에 필요한 승용차 출신 자리(점선)와 비교해 감축/증가를 알려 줘요.
import { breakeven, AXIS_KM } from './breakeven.js';

const plan = document.getElementById('seats');
const nIn = document.getElementById('n');
const phiIn = document.getElementById('phi');
const nOut = document.getElementById('nOut');
const phiOut = document.getElementById('phiOut');
const verdict = document.getElementById('verdict');
const dest = document.getElementById('bus-dest');
const chips = [...document.querySelectorAll('#bus .chip')];

if (plan && nIn && phiIn) {
  // 2+2 배열 11열. 격자 1·2행이 위쪽 두 줄, 4·5행이 아래쪽 두 줄, 12열은 운전석과 문.
  const rows = [1, 2, 4, 5];
  const windowFirst = { 1: 0, 5: 1, 2: 2, 4: 3 };
  const seats = [];
  for (const r of rows) {
    for (let c = 1; c <= 11; c++) {
      const el = document.createElement('div');
      el.className = 'seat';
      el.style.gridRow = r;
      el.style.gridColumn = c;
      plan.appendChild(el);
      seats.push({ el, r, c });
    }
  }
  // 앞(오른쪽)부터, 같은 줄에서는 창가부터 채워요.
  seats.sort((a, b) => (b.c - a.c) || (windowFirst[a.r] - windowFirst[b.r]));
  const order = seats.map((s) => s.el);

  const fmt1 = (v) => v.toFixed(1);
  const setFill = (input) => {
    const p = ((+input.value - +input.min) / (+input.max - +input.min)) * 100;
    input.style.setProperty('--fill', p + '%');
  };

  function render() {
    const N = +nIn.value;
    const P = +phiIn.value;
    const m = N * P;                       // 기대 승용차 출신 승객 (소수)
    const { mStar, netKg } = breakeven(N, P);
    const full = Math.floor(m + 1e-9);
    const part = m - full;
    const need = Math.ceil(mStar - 1e-9);

    order.forEach((el, i) => {
      let cls = 'seat';
      if (i < full) cls += ' is-car';
      else if (i === full && part > 0.001 && i < N) cls += ' is-part';
      else if (i < N) cls += ' is-transit';
      if (i < need) cls += ' is-need';
      el.className = cls;
      if (cls.includes('is-part')) el.style.setProperty('--p', Math.round(part * 100) + '%');
      else el.style.removeProperty('--p');
    });

    nOut.textContent = N + '명';
    phiOut.textContent = P.toFixed(2);
    setFill(nIn); setFill(phiIn);
    plan.setAttribute('aria-label', `44석 중 ${N}석 탑승, 그중 승용차 출신 ${fmt1(m)}명. 본전에 필요한 승용차 출신은 ${fmt1(mStar)}명.`);

    const ok = N > 0 && m >= mStar;
    let head;
    if (N === 0) head = '아직 아무도 타지 않았어요';
    else if (ok) head = `승용차 출신 ${fmt1(m)}명, 탄소를 줄여요`;
    else head = `승용차 출신 ${fmt1(m)}명, 아직 탄소가 늘어요`;

    const v = Math.min(100, (m / 44) * 100);
    const t = Math.min(100, (mStar / 44) * 100);
    verdict.className = 'bus-verdict ' + (ok ? 'is-cut' : 'is-add');
    verdict.innerHTML =
      `<strong class="verdict-head">${head}</strong>` +
      `<div class="meter${ok ? ' is-cut' : ''}" style="--v:${v}%;--t:${t}%" aria-hidden="true"><i></i><b></b></div>` +
      `<p class="verdict-text">이 탑승 인원에서 본전은 승용차 출신 <b>${fmt1(mStar)}명</b>이에요.` +
      (N > 0 ? ` ${AXIS_KM} km 축 기준 출근 1회(회송 포함)마다 약 ${Math.abs(netKg).toFixed(0)} kg CO₂가 ${netKg >= 0 ? '줄어요' : '늘어요'}.` : '') +
      `<small>보고서와 같은 모형이에요. 유니버스 디젤 3.49 km/L, 회송 1회, 승용차 재차 1.1명.</small></p>`;

    let matched = null;
    chips.forEach((b) => {
      const on = +b.dataset.n === N && Math.abs(+b.dataset.phi - P) < 1e-9;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) matched = b;
    });
    if (dest) dest.textContent = matched ? matched.dataset.dest : '직접 고른 값';
  }

  nIn.addEventListener('input', render);
  phiIn.addEventListener('input', render);
  chips.forEach((b) => b.addEventListener('click', () => {
    nIn.value = b.dataset.n;
    phiIn.value = b.dataset.phi;
    render();
  }));
  render();
}
