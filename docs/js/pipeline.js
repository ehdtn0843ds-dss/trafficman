// "어떻게 만들었나" 노선도 스테퍼와 단계별 시각화
// 데이터는 모두 pipeline-data.js(저장소 결과 파일에서 뽑은 값)에서 와요.
import { PIPELINE_DATA as D } from './pipeline-data.js';
// 손익분기 계산(breakeven.js → model.json)은 7단계를 처음 그릴 때 불러와요. 모형이 늦어도 다른 단계는 바로 보여요.
let beMod = null, beLoading = null;
function loadBreakeven() {
  if (!beLoading) beLoading = import('./breakeven.js').then(async (m) => { await m.ready; beMod = m; return m; });
  return beLoading;
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s, el = document) => el.querySelector(s);
const fmt = (v, d = 0) => v.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const shortName = (s) => s.split(' ').map((w) => (w.length > 2 ? w.replace(/(시|구|군)$/, '') : w)).join(' ');
const axisLabel = (a) => `${shortName(a.o)}→${shortName(a.d)}`;
const svgOpen = (w, h, label) => `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">`;
const linear = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
// 그림은 들어갈 자리의 실제 폭(320~560px)으로 그려서, 모바일에서도 글자가 작아지지 않게 해요.
const widthOf = (el) => Math.round(Math.min(560, Math.max(300, el.clientWidth || 560)));

/* ------------------------------------------------------------------ */
/* 1. 통근 축 532 → 20                                                   */
/* ------------------------------------------------------------------ */
function vizAxes() {
  const el = $('#viz-axes');
  if (!el) return;
  const kinds = D.axes532;
  el.innerHTML = [...kinds].map((k, i) => `<i class="${k}${i < 20 ? ' top' : ''}"></i>`).join('');
  const btn = $('#axes-toggle');
  const setCut = (on) => {
    el.classList.toggle('is-cut', on);
    if (btn) btn.textContent = on ? '532개 모두 보기' : '상위 20개만 보기';
  };
  btn?.addEventListener('click', () => setCut(!el.classList.contains('is-cut')));
  // 처음 보일 때 한 번: 532개가 모두 보였다가 20개만 남아요.
  if (reduceMotion || !('IntersectionObserver' in window)) { setCut(true); return; }
  setCut(false);
  const io = new IntersectionObserver((ents) => {
    if (ents.some((e) => e.isIntersecting)) {
      io.disconnect();
      setTimeout(() => setCut(true), 700);
    }
  }, { threshold: 0.5 });
  io.observe(el);
}

/* ------------------------------------------------------------------ */
/* 2. 출발점 5곳 (평택→화성)                                              */
/* ------------------------------------------------------------------ */
function vizOrigin() {
  const el = $('#viz-origin');
  if (!el) return;
  const O = D.originPyeongtaek;
  const W = widthOf(el), narrow = W < 480, H = narrow ? 400 : 300;
  // 출발점 5곳은 실제 축척으로 확대해 그리고, 목적지는 왼쪽 끝에 두었어요(축 길이 41.2 km).
  const lat0 = 37.02, kx = Math.cos((lat0 * Math.PI) / 180) * 111.32, ky = 110.57;
  const pts = O.pts.map((p) => ({ ...p, X: p.lng * kx, Y: -p.lat * ky }));
  const minX = Math.min(...pts.map((p) => p.X)), maxX = Math.max(...pts.map((p) => p.X));
  const minY = Math.min(...pts.map((p) => p.Y)), maxY = Math.max(...pts.map((p) => p.Y));
  // 오른쪽 점의 이름표("비전1동 4.9만 명")가 판 안에 들어오게 오른쪽 여백을 넉넉히 둬요.
  const box = narrow ? { x0: 112, x1: W - 110, y0: 178, y1: H - 56 } : { x0: 286, x1: W - 160, y0: 58, y1: 222 };
  const s = Math.min((box.x1 - box.x0) / (maxX - minX), (box.y1 - box.y0) / (maxY - minY));
  const px = (X) => box.x0 + (X - minX) * s;
  const py = (Y) => box.y0 + (Y - minY) * s;
  const dx = narrow ? W - 40 : 40, dy = narrow ? 44 : 112;
  const maxPop = Math.max(...pts.map((p) => p.pop));
  const rOf = (pop) => 7 + Math.sqrt(pop / maxPop) * 11;
  const place = { 고덕동: ['end', -1, -1], 중앙동: ['start', 1, -1], 동삭동: ['start', 1, 0], 비전1동: ['start', 1, 0], 비전2동: ['end', -1, 1] };
  let wT = 0, wC = 0;
  pts.forEach((p) => { wT += p.pop * p.ttr; wC += p.pop * p.tcar; });
  const pctrW = wT / wC;
  const single = D.top20.find((a) => a.dest === O.dest)?.single;

  let g = svgOpen(W, H, `평택시 출발점 5곳과 기아 화성공장. 5곳 인구가중 PCTR ${pctrW.toFixed(2)}, 한 곳 기준 ${single}`);
  // 시 경계 느낌의 옅은 판
  const panelX = narrow ? 2 : 232, panelY = narrow ? 128 : 14;
  g += `<rect x="${panelX}" y="${panelY}" width="${W - panelX - 2}" height="${H - panelY - 4}" rx="10" fill="#EDF1F4"/>`;
  g += `<text x="${panelX + 16}" y="${H - 16}" class="axis-title">평택시 인구 상위 5개 행정동</text>`;
  pts.forEach((p) => {
    const c1 = narrow ? `${px(p.X)} ${(py(p.Y) + dy) / 2}, ${dx} ${(py(p.Y) + dy) / 2 + 30}` : `${(px(p.X) + dx) / 2 + 40} ${py(p.Y)}, ${(px(p.X) + dx) / 2} ${dy}`;
    g += `<path d="M${px(p.X)} ${py(p.Y)} C ${c1}, ${narrow ? dx : dx + 10} ${narrow ? dy + 10 : dy}" fill="none" stroke="#8C99A4" stroke-width="1.2" stroke-dasharray="3 4"/>`;
  });
  g += `<rect x="${dx - 9}" y="${dy - 9}" width="18" height="18" rx="2" class="fill-ink"/>`;
  const da = narrow ? 'end' : 'start', dlx = narrow ? dx - 16 : dx - 9, dly = narrow ? dy + 4 : dy + 30;
  g += `<text x="${dlx}" y="${dly}" text-anchor="${da}" class="data-label" style="font-size:12.5px">기아 화성공장</text><text x="${dlx}" y="${dly + 16}" text-anchor="${da}" class="axis-label">축 길이 41.2 km</text>`;
  pts.forEach((p) => {
    const r = rOf(p.pop), [anchor, hx, hy] = place[p.dong] || ['start', 1, 0];
    const tx = px(p.X) + hx * (r + 6), ty = py(p.Y) + (hy === 0 ? 4 : hy * (r + 4)) + (hy > 0 ? 6 : 0);
    g += `<circle cx="${px(p.X)}" cy="${py(p.Y)}" r="${r}" class="fill-car" fill-opacity=".9" stroke="#fff" stroke-width="2"><title>${esc(p.dong)} 인구 ${fmt(p.pop)}명, PCTR ${p.pctr}</title></circle>`;
    g += `<text x="${tx}" y="${ty}" text-anchor="${anchor}" style="font-size:12px;font-weight:700">${esc(p.dong)} ${narrow ? '' : `<tspan class="axis-label" style="font-weight:400">${fmt(p.pop / 10000, 1)}만 명</tspan>`}</text>`;
  });
  // 2 km 축척
  const sb = 2 * s;
  g += `<g transform="translate(${W - 20 - sb},${H - 20})"><line x1="0" y1="0" x2="${sb}" y2="0" class="axis-line" stroke-width="2"/><text x="${sb / 2}" y="-6" text-anchor="middle" class="axis-label">2 km</text></g>`;
  // 결과 비교
  const rx = narrow ? 4 : 31, ry = narrow ? 30 : H - 64;
  g += `<text x="${rx}" y="${ry}" class="axis-label">5곳 인구가중 PCTR</text><text x="${rx}" y="${ry + 30}" class="data-label" style="font-size:28px;font-family:var(--display)">${pctrW.toFixed(2)}</text>`;
  g += `<text x="${rx + 111}" y="${ry}" class="axis-label">구청·역 한 곳</text><text x="${rx + 111}" y="${ry + 30}" class="t-muted" style="font-size:28px;font-family:var(--display)">${single.toFixed(2)}</text>`;
  g += '</svg>';
  el.innerHTML = g;
}

/* ------------------------------------------------------------------ */
/* 3. 통행시간 쌍                                                         */
/* ------------------------------------------------------------------ */
function vizTimes() {
  const el = $('#viz-times');
  if (!el) return;
  const pts = D.originPyeongtaek.pts;
  const W = widthOf(el), L = 92, R = 70, top = 8, rowH = 50, H = top + pts.length * rowH + 28;
  const x = linear(0, 180, L, W - R - 18);
  let g = svgOpen(W, H, '평택 출발점 5곳의 승용차와 대중교통 통행시간');
  g += `<text x="${W - 2}" y="${H - 6}" text-anchor="end" class="axis-label">PCTR</text>`;
  [0, 60, 120, 180].forEach((t) => {
    g += `<line x1="${x(t)}" y1="${top}" x2="${x(t)}" y2="${H - 22}" class="grid-line"/><text x="${x(t)}" y="${H - 6}" text-anchor="middle" class="axis-label">${t}분</text>`;
  });
  pts.forEach((p, i) => {
    const y0 = top + i * rowH + 6;
    g += `<text x="${L - 10}" y="${y0 + 18}" text-anchor="end" style="font-size:12.5px;font-weight:700">${esc(p.dong)}</text>`;
    g += `<rect x="${L}" y="${y0}" width="${x(p.tcar) - L}" height="14" rx="2" class="fill-car"/><text x="${x(p.tcar) + 6}" y="${y0 + 11.5}" class="axis-label">${fmt(p.tcar)}분</text>`;
    g += `<rect x="${L}" y="${y0 + 18}" width="${x(p.ttr) - L}" height="14" rx="2" class="fill-transit"/><text x="${x(p.ttr) + 6}" y="${y0 + 29.5}" class="axis-label">${fmt(p.ttr)}분</text>`;
    g += `<text x="${W - 2}" y="${y0 + 21}" text-anchor="end" class="data-label" style="font-size:13px">×${p.pctr.toFixed(2)}</text>`;
  });
  g += '</svg>';
  el.innerHTML = g;
}

/* ------------------------------------------------------------------ */
/* 4. 축별 PCTR                                                          */
/* ------------------------------------------------------------------ */
let thrT = 1.5;   // 4단계 슬라이더의 분류 기준 (보고서 기준 1.5)
const isCand = (a, th) => a.car >= 3000 && (a.pctr3 ?? a.pctr) >= th;
function vizPctr() {
  const el = $('#viz-pctr');
  if (!el) return;
  const th = thrT, atReport = Math.abs(th - 1.5) < 1e-9;
  const rows = [...D.top20].sort((a, b) => b.pctr - a.pctr);
  const W = widthOf(el), L = 112, R = 40, top = 24, rowH = 19;
  const yRoutes = top + rows.length * rowH + 22, H = yRoutes + 22 + 30;
  const x = linear(0, 3.2, L, W - R);
  let g = svgOpen(W, H, `승용차 통근 상위 20개 축과 현행 편하G 28개 노선의 PCTR. 기준 ${th.toFixed(2)} 이상 축 ${rows.filter((a) => isCand(a, th)).length}개, 노선 ${D.routes.filter((r) => r.pctr >= th).length}개`);
  [0, 0.5, 1, 1.5, 2, 2.5, 3].forEach((t) => {
    g += `<line x1="${x(t)}" y1="${top - 6}" x2="${x(t)}" y2="${H - 26}" class="grid-line"/><text x="${x(t)}" y="${H - 10}" text-anchor="middle" class="axis-label">${t}</text>`;
  });
  // 기준 아래 영역은 옅게 덮어서 '수요관리' 쪽임을 보여요.
  g += `<rect x="${L}" y="${top - 6}" width="${x(th) - L}" height="${H - 26 - top + 6}" fill="#EDF1F4" opacity=".55"/>`;
  g += `<line x1="${x(1)}" y1="${top - 6}" x2="${x(1)}" y2="${H - 26}" class="axis-line"/><text x="${x(1) - 4}" y="${top - 10}" text-anchor="end" class="axis-label">같은 시간</text>`;
  if (!atReport) g += `<line x1="${x(1.5)}" y1="${top - 6}" x2="${x(1.5)}" y2="${H - 26}" class="threshold" stroke-opacity=".4"/>`;
  g += `<line x1="${x(th)}" y1="${top - 6}" x2="${x(th)}" y2="${H - 26}" class="threshold"${atReport ? '' : ' style="stroke-dasharray:none;stroke-width:2"'}/><text x="${x(th) + 4}" y="${top - 10}" class="threshold-label">${atReport ? '1.5 기준' : `기준 ${th.toFixed(2)}`}</text>`;
  rows.forEach((a, i) => {
    const y = top + i * rowH + rowH / 2;
    const c = a.seoul ? 'seoul' : 'car';
    const on = isCand(a, th);
    g += `<text x="${L - 10}" y="${y + 4}" text-anchor="end" style="font-size:12px;${a.trips > 0 ? 'font-weight:700' : ''}"${on ? '' : ' class="t-muted"'}>${esc(axisLabel(a))}</text>`;
    g += `<line x1="${x(a.lo)}" y1="${y}" x2="${x(a.hi)}" y2="${y}" class="stroke-${c}" stroke-width="2" stroke-opacity="${on ? 0.45 : 0.25}"/>`;
    g += `<circle cx="${x(a.single)}" cy="${y}" r="3.6" fill="#fff" class="stroke-ink" stroke-width="1.3" stroke-opacity="${on ? 1 : 0.5}"/>`;
    g += `<circle cx="${x(a.pctr)}" cy="${y}" r="5" class="fill-${c}" fill-opacity="${on ? 1 : 0.4}"><title>${esc(axisLabel(a))} PCTR ${a.pctr} (5곳 ${a.lo}~${a.hi}, 한 곳 ${a.single})</title></circle>`;
  });
  // 현행 편하G 28개 노선
  g += `<line x1="${L - 100}" y1="${yRoutes - 14}" x2="${W - R}" y2="${yRoutes - 14}" class="grid-line"/>`;
  g += `<text x="${L - 10}" y="${yRoutes + 4}" text-anchor="end" style="font-size:12px;font-weight:700">현행 편하G 28개</text>`;
  D.routes.forEach((r, i) => {
    const y = yRoutes + (i % 2 ? 5 : -5);
    const on = r.pctr >= th;
    g += `<circle cx="${x(r.pctr)}" cy="${y}" r="4" ${on ? 'class="fill-seoul stroke-seoul"' : 'fill="#fff" class="stroke-seoul"'} stroke-width="1.6"><title>${esc(r.o)}→${esc(r.to)} PCTR ${r.pctr.toFixed(2)}${r.seoul ? ' (서울행)' : ''}</title></circle>`;
  });
  g += `<text x="${W - R}" y="${H - 10}" text-anchor="end" class="axis-title" dx="34">PCTR</text>`;
  g += '</svg>';
  el.innerHTML = g;
}

function thrControl() {
  const inp = $('#thr'), out = $('#thrOut'), res = $('#thr-out'), reset = $('#thr-reset');
  if (!inp) return;
  const setFill = () => inp.style.setProperty('--fill', ((+inp.value - +inp.min) / (+inp.max - +inp.min)) * 100 + '%');
  const update = () => {
    thrT = Math.round(+inp.value * 100) / 100;
    out.textContent = thrT.toFixed(2);
    setFill();
    const candA = D.top20.filter((a) => isCand(a, thrT));
    const cand = candA.length, candSeoul = candA.filter((a) => a.seoul).length;
    const routes = D.routes.filter((r) => r.pctr >= thrT).length;
    res.innerHTML = `20개 축 중 버스 후보 <b>${cand}개</b>(서울행 ${candSeoul}개), 수요관리 <b>${20 - cand}개</b>예요. 현행 편하G 28개 노선 중 기준을 넘는 노선은 <b>${routes}개</b>예요.`;
    if (reset) reset.hidden = Math.abs(thrT - 1.5) < 1e-9;
    drawnAt['step-4'] = null;
    drawPanel($('#step-4'));
  };
  inp.addEventListener('input', update);
  reset?.addEventListener('click', () => { inp.value = '1.5'; update(); inp.focus(); });
  setFill();
}

/* ------------------------------------------------------------------ */
/* 5. 31개 시군 로짓                                                      */
/* ------------------------------------------------------------------ */
function vizLogit() {
  const el = $('#viz-logit');
  if (!el) return;
  const C = D.census31; // [시군, PCTR, s_car, 통근자]
  const alpha = -1.048, beta = 3.204;
  const W = widthOf(el), H = 330, L = 52, R = 18, T = 16, B = 44;
  const x = linear(1.1, 2.0, L, W - R);
  const y = linear(0.3, 0.8, H - B, T);
  const maxW = Math.max(...C.map((c) => c[3]));
  let g = svgOpen(W, H, '경기 31개 시군의 PCTR과 승용차 통근 분담률, 로짓 적합 β 3.20');
  [1.2, 1.4, 1.6, 1.8, 2.0].forEach((t) => { g += `<line x1="${x(t)}" y1="${T}" x2="${x(t)}" y2="${H - B}" class="grid-line"/><text x="${x(t)}" y="${H - B + 18}" text-anchor="middle" class="axis-label">${t.toFixed(1)}</text>`; });
  [0.3, 0.4, 0.5, 0.6, 0.7, 0.8].forEach((t) => { g += `<line x1="${L}" y1="${y(t)}" x2="${W - R}" y2="${y(t)}" class="grid-line"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end" class="axis-label">${Math.round(t * 100)}%</text>`; });
  g += `<text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle" class="axis-title">시군 관측 PCTR</text>`;
  g += `<text transform="translate(14 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle" class="axis-title">승용차 통근 분담률</text>`;
  // 관측 범위 음영
  g += `<rect x="${x(1.19)}" y="${T}" width="${x(1.91) - x(1.19)}" height="${H - B - T}" fill="#EDF1F4" opacity=".6"/>`;
  C.slice().sort((a, b) => b[3] - a[3]).forEach((c) => {
    const r = 2.5 + Math.sqrt(c[3] / maxW) * 9;
    g += `<circle cx="${x(c[1])}" cy="${y(c[2])}" r="${r}" class="fill-transit" fill-opacity=".55" stroke="#3D6790" stroke-width="1"><title>${esc(c[0])}: PCTR ${c[1].toFixed(2)}, 승용차 ${Math.round(c[2] * 100)}%, 통근자 ${fmt(c[3])}명</title></circle>`;
  });
  let d = '';
  for (let v = 1.1; v <= 2.0001; v += 0.02) {
    const s = 1 / (1 + Math.exp(-(alpha + beta * Math.log(v))));
    d += (d ? 'L' : 'M') + x(v).toFixed(1) + ' ' + y(Math.min(0.8, Math.max(0.3, s))).toFixed(1);
  }
  g += `<path d="${d}" fill="none" class="stroke-ink" stroke-width="2.5"/>`;
  g += `<text x="${x(1.92)}" y="${y(0.75) - 8}" text-anchor="end" class="data-label" style="font-size:13px">β = 3.20</text>`;
  g += '</svg>';
  el.innerHTML = g;
}

/* ------------------------------------------------------------------ */
/* 6. 원인 진단                                                          */
/* ------------------------------------------------------------------ */
function vizDiag() {
  const el = $('#viz-diag');
  if (!el) return;
  const bins = [
    // 머리 선 색: 수요관리는 서울행(파랑), 나머지는 중립. 주황은 '증편이 배분된 축' 칸에만 써요.
    { key: '수요관리', c: 'var(--seoul)', rule: 'PCTR 1.5 미만. 대중교통이 이미 경쟁력 있어요.' },
    { key: 'DRT 연계', c: 'var(--line-strong)', rule: '도보가 문제예요. 단지 안 정차 직행을 권해요.' },
    { key: '출퇴근 직행', c: 'var(--asphalt)', rule: '차 안 시간과 환승이 문제예요.' },
  ];
  el.innerHTML = bins.map((b) => {
    const items = D.top20.filter((a) => a.cls === b.key).sort((p, q) => q.car - p.car);
    return `<div class="bin" style="--c:${b.c}"><h4>${b.key} ${items.length}개</h4><p>${b.rule}</p><ul>` +
      items.map((a) => `<li class="${a.trips ? 'is-alloc' : ''}${a.gbus ? ' is-gbus' : ''}">${a.trips ? `<span>${esc(axisLabel(a))}</span><em><span class="sr-only">증편 </span>${a.trips}회<span class="sr-only"> 배분</span></em>` : esc(axisLabel(a))}${a.gbus ? ' <span class="sr-only">(현재 편하G 운행)</span>' : ''}</li>`).join('') +
      '</ul></div>';
  }).join('');
}

/* ------------------------------------------------------------------ */
/* 7. 손익분기 곡선                                                       */
/* ------------------------------------------------------------------ */
function vizBreakeven() {
  const el = $('#viz-breakeven');
  if (!el) return;
  if (!beMod) {
    el.innerHTML = '<p class="viz-wait">계산 모형을 불러오는 중이에요.</p>';
    loadBreakeven().then(() => { drawnAt['step-7'] = null; drawPanel($('#step-7')); })
      .catch(() => { el.innerHTML = '<p class="viz-wait is-error">계산 모형(model.json)을 불러오지 못해 곡선을 그리지 못했어요. 새로고침해 보세요. 기준값은 φ 1.0에서 10.7명, φ 0.5에서 21.9명, φ 0.25에서 45.3명이에요.</p>'; });
    return;
  }
  const breakeven = beMod.breakeven;
  const W = widthOf(el), H = 340, L = 50, R = 20, T = 16, B = 46;
  const x = linear(0.15, 1.0, L, W - R);
  const y = linear(0, 60, H - B, T);
  const nStar = (phi) => breakeven(0, phi).nStar;
  let curve = '', phi0 = 0.15;
  while (nStar(phi0) > 60) phi0 += 0.002;
  for (let p = phi0; p <= 1.0001; p += 0.01) curve += (curve ? 'L' : 'M') + x(p).toFixed(1) + ' ' + y(nStar(p)).toFixed(1);
  let g = svgOpen(W, H, '승용차 출신 비율 φ에 따른 손익분기 탑승 인원 곡선');
  // 감축/증가 영역
  g += `<path d="${curve}L${x(1)} ${y(60)}L${x(phi0)} ${y(60)}Z" fill="#E3F3EC"/>`;
  g += `<path d="${curve}L${x(1)} ${y(0)}L${x(0.15)} ${y(0)}L${x(0.15)} ${y(60)}L${x(phi0)} ${y(60)}Z" fill="#FBE7E4"/>`;
  [0.25, 0.5, 0.75, 1.0].forEach((t) => { g += `<line x1="${x(t)}" y1="${T}" x2="${x(t)}" y2="${H - B}" class="grid-line" stroke="#fff"/><text x="${x(t)}" y="${H - B + 18}" text-anchor="middle" class="axis-label">${t}</text>`; });
  [0, 10, 20, 30, 40, 50, 60].forEach((t) => { g += `<text x="${L - 8}" y="${y(t) + 4}" text-anchor="end" class="axis-label">${t}</text>`; });
  g += `<line x1="${L}" y1="${y(0)}" x2="${W - R}" y2="${y(0)}" class="axis-line"/>`;
  g += `<line x1="${L}" y1="${y(44)}" x2="${W - R}" y2="${y(44)}" class="threshold"/><text x="${W - R - 4}" y="${y(44) - 6}" text-anchor="end" class="threshold-label">정원 44석</text>`;
  g += `<path d="${curve}" fill="none" class="stroke-ink" stroke-width="2.5"/>`;
  g += `<text x="${x(0.8)}" y="${y(34)}" text-anchor="middle" class="data-label t-cut">탄소를 줄여요</text>`;
  g += `<text x="${x(0.72)}" y="${y(4)}" text-anchor="middle" class="data-label t-add">탄소가 늘어요</text>`;
  if (W >= 480) g += `<text x="${x(0.66)}" y="${y(nStar(0.66)) + 22}" text-anchor="middle" class="axis-label">본전 곡선: 탑승 × φ ≈ 11명</text>`;
  // 기준점
  [[1.0, '10.7명', 'end', -6], [0.5, '21.9명', 'start', 8], [0.25, '45.3명', 'start', 8]].forEach(([p, lab, an, ox]) => {
    g += `<circle cx="${x(p)}" cy="${y(nStar(p))}" r="4" class="fill-ink"/><text x="${x(p) + ox}" y="${y(nStar(p)) - 8}" text-anchor="${an}" style="font-size:12px;font-weight:700">${lab}</text>`;
  });
  // 현행 수준과 모형값
  g += `<circle cx="${x(0.25)}" cy="${y(19.5)}" r="6" class="fill-seoul" stroke="#fff" stroke-width="2"/><text x="${x(0.25) + (W >= 480 ? 10 : -6)}" y="${y(19.5) + (W >= 480 ? 4 : 22)}" style="font-size:12px">${W >= 480 ? '현행 편하G 수준 (19.5명, 0.25)' : '현행 수준 (19.5명)'}</text>`;
  g += `<circle cx="${x(0.5)}" cy="${y(44)}" r="6" class="fill-car" stroke="#fff" stroke-width="2"/><text x="${x(0.5) + 10}" y="${y(44) + 16}" style="font-size:12px">${W >= 480 ? '산단 축 모형값 (44명, 0.5)' : '산단 축 모형값'}</text>`;
  g += `<text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle" class="axis-title">승용차 출신 비율 φ</text>`;
  g += `<text transform="translate(14 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle" class="axis-title">회당 탑승 인원</text>`;
  g += '</svg>';
  el.innerHTML = g;
}

/* ------------------------------------------------------------------ */
/* 8. 증편 배분                                                          */
/* ------------------------------------------------------------------ */
function vizAlloc() {
  const el = $('#viz-alloc');
  if (!el) return;
  // 출근 50회 칸 50개를 한 번 만들고, 토글할 때 같은 칸을 새 자리로 옮겨요(FLIP).
  const ours = D.top20.filter((a) => a.trips > 0).sort((a, b) => b.trips - a.trips);
  const seoulR = D.routes.filter((r) => r.seoul), ggR = D.routes.filter((r) => !r.seoul);
  const sum = (rs) => rs.reduce((s, r) => s + r.am, 0);
  const cells = Array.from({ length: 50 }, () => { const i = document.createElement('i'); i.className = 'alloc-cell'; return i; });
  const READ = {
    base: { cls: 'is-add', v: '−793', note: '모형 기준값 · +는 감축, −는 증가',
      sr: `현행 방식: 출근 50회를 서울행 ${seoulR.length}개 노선에 ${sum(seoulR)}회, 경기 내부 ${ggR.length}개 노선에 ${sum(ggR)}회씩 1~2회로 나눠요. 연간 순감축 −793 tCO₂/년이에요(−는 증가).` },
    ours: { cls: 'is-cut', v: '+1,020', note: '모형 기준값 · +는 감축, −는 증가',
      sr: `PCTR 기준: 출근 50회를 ${ours.map((a) => `${axisLabel(a)} ${a.trips}회`).join(', ')}로 4개 축에 모아요. 연간 순감축 +1,020 tCO₂/년이에요(+는 감축).` },
  };
  el.innerHTML =
    `<div class="alloc-head"><div class="toggle" role="group" aria-label="배분 방식">` +
    `<button type="button" data-mode="base" aria-pressed="true">현행 방식</button><button type="button" data-mode="ours" aria-pressed="false">PCTR 기준</button></div>` +
    `<div class="readout" id="alloc-ro"><span class="readout-label">연간 순감축</span>` +
    `<span class="readout-value"><span class="v"></span><span class="readout-unit">tCO₂/년</span></span><span class="readout-note"></span></div></div>` +
    `<div class="alloc-field" aria-hidden="true"></div><p class="sr-only" aria-live="polite" id="alloc-sr"></p>` +
    `<ul class="key"><li><span class="sw sw--seoul"></span>현행 서울행 노선</li><li><span class="sw sw--seoul-light"></span>현행 경기 내부 노선</li><li><span class="sw sw--car"></span>PCTR 기준 산단 축</li></ul>`;
  const field = $('.alloc-field', el), ro = $('#alloc-ro', el), sr = $('#alloc-sr', el);
  const btns = [...el.querySelectorAll('.toggle button')];

  const section = (title, sub, groups) => {
    const s = document.createElement('div');
    s.className = 'alloc-sec';
    s.innerHTML = `<h4>${title}<small>${sub}</small></h4><div class="alloc-groups"></div>`;
    const gw = $('.alloc-groups', s);
    groups.forEach(({ n, label }) => {
      const gEl = document.createElement('div');
      gEl.className = 'alloc-group';
      gEl.innerHTML = `<div class="alloc-cells"></div>${label ? `<span>${esc(label)}</span>` : ''}`;
      gw.appendChild(gEl);
      gEl._n = n;
    });
    return s;
  };
  // mode별 칸 배치와 색
  function build(mode) {
    let secs, colorOf;
    if (mode === 'base') {
      secs = [section(`서울행 ${seoulR.length}개 노선`, `${sum(seoulR)}회`, seoulR.map((r) => ({ n: r.am }))),
              section(`경기 내부 ${ggR.length}개 노선`, `${sum(ggR)}회`, ggR.map((r) => ({ n: r.am })))];
      colorOf = (i) => (i < sum(seoulR) ? 'alloc-cell' : 'alloc-cell c-gg');
    } else {
      secs = [section('경기 내부 산단 4개 축', '50회, 축당 최대 15회', ours.map((a) => ({ n: a.trips, label: `${axisLabel(a)} ${a.trips}회` })))];
      colorOf = () => 'alloc-cell c-ours';
    }
    let k = 0;
    secs.forEach((s) => s.querySelectorAll('.alloc-group').forEach((gEl) => {
      const box = $('.alloc-cells', gEl);
      for (let j = 0; j < gEl._n; j++) box.appendChild(cells[k++]);
    }));
    field.replaceChildren(...secs);
    return colorOf;
  }
  let mode = null;
  function setMode(next, animate) {
    if (next === mode) return;
    mode = next;
    const first = animate ? cells.map((c) => c.getBoundingClientRect()) : null;
    const colorOf = build(next);
    if (first) {
      cells.forEach((c, i) => {
        const l = c.getBoundingClientRect();
        c.style.transition = 'none';
        c.style.transform = `translate(${first[i].left - l.left}px,${first[i].top - l.top}px)`;
      });
      void field.offsetWidth;
      cells.forEach((c, i) => {
        const d = i * 9;
        c.style.transition = `transform .6s cubic-bezier(.3,.7,.2,1) ${d}ms, background-color .45s ease ${d}ms, border-color .45s ease ${d}ms`;
        c.style.transform = '';
        c.className = colorOf(i);
      });
    } else cells.forEach((c, i) => { c.style.transition = ''; c.style.transform = ''; c.className = colorOf(i); });
    const R = READ[next];
    ro.className = `readout ${R.cls}`;
    $('.v', ro).textContent = R.v;
    $('.readout-note', ro).textContent = R.note;
    sr.textContent = R.sr;
    btns.forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === next ? 'true' : 'false'));
  }
  btns.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode, !reduceMotion)));
  setMode('base', false);
  sr.textContent = '';   // 처음엔 읽지 않고, 토글할 때만 알려요
}

/* ------------------------------------------------------------------ */
/* 9. 몬테카를로 분포                                                     */
/* ------------------------------------------------------------------ */
function vizMC() {
  const el = $('#viz-mc');
  if (!el) return;
  const { edges, pctr, base } = D.mc;
  const W = widthOf(el), H = 330, L = 20, R = 20, mid = 160, hMax = 112;
  const x = linear(edges[0], edges[edges.length - 1], L, W - R);
  const peak = Math.max(...pctr, ...base);
  const h = (v) => (v / peak) * hMax;
  let g = svgOpen(W, H, '2만 회 몬테카를로 연간 순감축 분포. 위는 PCTR 기준, 아래는 현행 방식');
  g += `<rect x="${x(0)}" y="${mid - hMax - 8}" width="${W - R - x(0)}" height="${2 * hMax + 16}" fill="#E3F3EC" opacity=".6"/>`;
  pctr.forEach((v, i) => { if (v) g += `<rect x="${x(edges[i]) + 0.5}" y="${mid - h(v)}" width="${x(edges[i + 1]) - x(edges[i]) - 1}" height="${h(v)}" class="fill-car"/>`; });
  base.forEach((v, i) => { if (v) g += `<rect x="${x(edges[i]) + 0.5}" y="${mid}" width="${x(edges[i + 1]) - x(edges[i]) - 1}" height="${h(v)}" class="fill-seoul"/>`; });
  g += `<line x1="${L}" y1="${mid}" x2="${W - R}" y2="${mid}" class="axis-line"/>`;
  g += `<line x1="${x(0)}" y1="${mid - hMax - 8}" x2="${x(0)}" y2="${mid + hMax + 8}" class="stroke-ink" stroke-width="1.5"/>`;
  g += `<line x1="${x(124)}" y1="${mid - hMax - 8}" x2="${x(124)}" y2="${mid}" stroke="#fff" stroke-width="1.5" stroke-dasharray="4 3"/>`;
  g += `<line x1="${x(-388)}" y1="${mid}" x2="${x(-388)}" y2="${mid + hMax + 8}" stroke="#fff" stroke-width="1.5" stroke-dasharray="4 3"/>`;
  g += `<text x="${x(0) + 8}" y="${mid - hMax - 18}" class="data-label t-cut" style="font-size:13px">감축 쪽 →</text>`;
  g += `<text x="${L}" y="${mid - 10}" class="data-label" style="font-size:12.5px">PCTR 기준</text>`;
  g += `<text x="${x(0) - 8}" y="${mid - hMax - 18}" text-anchor="end" class="axis-label">0 t</text>`;
  g += `<text x="${x(0) - 8}" y="${mid + hMax + 26}" text-anchor="end" class="data-label t-add" style="font-size:13px">← 증가 쪽</text>`;
  g += `<text x="${L}" y="${mid + 20}" class="data-label" style="font-size:12.5px">현행 방식</text>`;
  (W >= 480 ? [-1500, -1000, -500, 500, 1000, 1500] : [-1000, 1000]).forEach((t) => { g += `<text x="${x(t)}" y="${H - 6}" text-anchor="middle" class="axis-label">${t > 0 ? '+' : ''}${fmt(t)}</text>`; });
  g += `<text x="${W - R}" y="${mid + hMax + 26}" text-anchor="end" class="axis-title">연간 순감축 (tCO₂/년)</text>`;
  g += '</svg>';
  el.innerHTML = g;
}

/* ------------------------------------------------------------------ */
/* 스테퍼                                                               */
/* ------------------------------------------------------------------ */
function stepper() {
  const nav = $('#route-nav');
  if (!nav) return;
  const tabs = [...nav.querySelectorAll('[role=tab]')];
  const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')));
  const done = $('#route-done'), bus = $('#route-bus'), track = $('.route-track', nav);
  const prev = $('#step-prev'), next = $('#step-next');
  let cur = 0;

  const placeBus = () => {
    const tr = track.getBoundingClientRect();
    const dot = tabs[cur].querySelector('.stop-dot').getBoundingClientRect();
    const cx = dot.left + dot.width / 2 - tr.left;
    bus.style.setProperty('--bx', cx + 'px');
    done.style.width = Math.max(0, cx) + 'px';
  };

  function select(i, { focus = false, scroll = false } = {}) {
    cur = Math.max(0, Math.min(tabs.length - 1, i));
    tabs.forEach((t, k) => {
      const on = k === cur;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      t.classList.toggle('is-done', k < cur);
      panels[k].hidden = !on;
    });
    prev.disabled = cur === 0;
    next.textContent = cur === tabs.length - 1 ? '직접 계산해 보기' : '다음 단계';
    placeBus();
    drawPanel(panels[cur]);
    if (focus) tabs[cur].focus();
    if (scroll) {
      const top = nav.getBoundingClientRect().top;
      const signH = document.querySelector('.sign')?.offsetHeight || 0;
      if (top < signH) window.scrollBy({ top: top - signH - 12, behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  }

  tabs.forEach((t, k) => {
    t.addEventListener('click', () => select(k));
    t.addEventListener('keydown', (e) => {
      const map = { ArrowRight: cur + 1, ArrowLeft: cur - 1, Home: 0, End: tabs.length - 1 };
      if (e.key in map) { e.preventDefault(); select(map[e.key], { focus: true }); }
    });
  });
  prev.addEventListener('click', () => select(cur - 1, { scroll: true }));
  next.addEventListener('click', () => {
    if (cur === tabs.length - 1) {
      document.getElementById('simulator')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
      return;
    }
    select(cur + 1, { scroll: true });
  });
  let rz;
  window.addEventListener('beforeprint', () => panels.forEach(p => { p.hidden = false; try { drawPanel(p); } catch (e) {} }));
  window.addEventListener('resize', () => { placeBus(); clearTimeout(rz); rz = setTimeout(() => drawPanel(panels[cur]), 150); });
  document.fonts?.ready.then(placeBus);
  select(0);
}

// HTML로 그리는 그림은 한 번만, SVG 그림은 보일 때 그 폭에 맞춰 그려요.
vizAxes(); vizDiag(); vizAlloc(); thrControl();
const SVG_VIZ = { 'step-2': [vizOrigin, '#viz-origin'], 'step-3': [vizTimes, '#viz-times'], 'step-4': [vizPctr, '#viz-pctr'],
  'step-5': [vizLogit, '#viz-logit'], 'step-7': [vizBreakeven, '#viz-breakeven'], 'step-9': [vizMC, '#viz-mc'] };
const drawnAt = {};
function drawPanel(panel) {
  const v = panel && SVG_VIZ[panel.id];
  if (!v || panel.hidden) return;
  const el = $(v[1]);
  const w = widthOf(el);
  if (drawnAt[panel.id] === w) return;
  drawnAt[panel.id] = w;
  v[0]();
}
stepper();
// JS가 없을 때처럼 모든 단계가 펼쳐진 인쇄 등에서도 그림이 비지 않게, 숨은 단계는 처음 열 때 그려요.

