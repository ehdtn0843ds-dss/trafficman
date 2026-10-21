// 편하G 증편 탄소 모형 — 소개 페이지용 계산 모듈 (ES 모듈, 의존성 없음)
//
// 원본: pctr_commute/breakeven.py, axis_model.py, scenario_grid.py (파이썬). 상수·축·노선 데이터는 docs/data/model.json
// (docs/data/build_model_json.py가 파이썬 모델에서 직접 계산)에서 읽는다. 이 파일은 그 데이터로 닫힌 식만 계산한다.
//
// 단위
//   C0, CDH, CPAX, CCAR : kgCO₂ / km  (버스 1회 빈 차, 회송 1회, 승객 1명 추가분, 승용차 통근자 1인)
//   tripNetKg           : kgCO₂ / 출근 1회 (회송 포함)
//   annualNet.tYear     : tCO₂ / 년 (+ 감축, − 증가), 출근+퇴근 대칭 ×2, 연 245일
//
// 근사 없음 / 근사 있음
//   · 디젤 연비 kmpl → C0·CDH·CPAX : breakeven.calibrate의 η 재보정 결과가 1/kmpl에 정확히 아핀(A + B/kmpl)이라
//     계수만 옮겨 쓴다(파이썬 대비 잔차 ~1e-15). 단순 비례(∝1/kmpl)는 쓰지 않는다(그건 최대 3.4% 틀림).
//   · 수소버스 km/kg도 같은 아핀식(잔차 ~1e-15). 수소 배출계수는 선형 배율(정확).
//   · 재차인원 occ → CCAR = CCAR_occ1 / occ (정확). 회송 r은 식에 선형(정확).
//   · 차량 상수는 축 길이 25 km 기준 시나리오의 km당 값(axis_model과 동일). 축마다 다시 돌리지 않는다(모델과 같음).
//   · 수요(D, φ)는 파이썬에서 보정된 값을 고정해 쓴다. 정원·φ 상한 등 수요 보정(κ, B)을 바꾸는 입력은 여기서 재현 불가.

let M = null;

/** model.json 객체를 등록한다. */
export function init(model) {
  if (!model || !model.constants) throw new Error("model.json 형식이 아님");
  M = model;
  return M;
}

/** 브라우저: model.json을 fetch해서 등록. 같은 주소는 한 번만 받아요(히어로·시뮬레이터·탐색기가 함께 씀). */
const loading = new Map();
export function loadModel(url = "./data/model.json") {
  if (!loading.has(url)) {
    loading.set(url, (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`model.json 불러오기 실패: ${res.status}`);
      return init(await res.json());
    })());
  }
  return loading.get(url);
}

function need() {
  if (!M) throw new Error("model.js: init(model) 또는 loadModel()을 먼저 호출");
  return M;
}

export const getModel = () => need();

// ───────────────────────── 차량 상수 ─────────────────────────

/**
 * 차종·연비·재차인원에 따른 km당 CO₂ 상수.
 * @param {object} o
 * @param {"diesel"|"fcev"} [o.vehicle="diesel"]  유니버스 디젤 44석 / 유니버스 수소버스
 * @param {number} [o.kmpl=3.49]   디젤 연비 km/L (모델 근거 범위 2.83–4.0)
 * @param {number} [o.kmpkg=28.0]  수소버스 km/kg
 * @param {number} [o.h2=9.2]      수소 배출계수 kgCO₂/kgH₂ (0 부생 ~ 10.3)
 * @param {number} [o.occ=1.1]     승용차 재차인원
 * @returns {{C0:number, CDH:number, CPAX:number, CCAR:number, cap:number, vehicle:string}}
 */
export function vehicleConstants({ vehicle = "diesel", kmpl, kmpkg, h2, occ } = {}) {
  const c = need().constants;
  occ = occ ?? c.CAR_OCC;
  const CCAR = c.car.CCAR_occ1 / occ;
  if (vehicle === "fcev") {
    const f = c.fcev, a = f.affine_in_inv_kmpkg;
    const x = kmpkg ?? f.kmpkg;
    const s = (h2 ?? f.h2_co2_per_kg) / f.h2_co2_per_kg;
    return { C0: s * (a.C0.A + a.C0.B / x), CDH: s * (a.CDH.A + a.CDH.B / x), CPAX: s * (a.CPAX.A + a.CPAX.B / x),
             CCAR, cap: f.cap, vehicle };
  }
  const d = c.diesel, a = d.affine_in_inv_kmpl;
  const x = kmpl ?? d.kmpl;
  return { C0: a.C0.A + a.C0.B / x, CDH: a.CDH.A + a.CDH.B / x, CPAX: a.CPAX.A + a.CPAX.B / x, CCAR, cap: d.cap, vehicle: "diesel" };
}

function consts(o) {
  const v = vehicleConstants(o);
  return { ...v, r: o.r ?? need().constants.R_DH };
}

// ───────────────────────── 손익분기 ─────────────────────────

/**
 * 탄소 손익분기 (breakeven.py: N* = (C0 + r·C_dh)/(φ·c_car − c_pax), km당 상수라 축 길이와 무관)
 * @param {object} o  {N, phi, kmpl, kmpkg, h2, r, occ, vehicle}
 * @returns {{Nstar:number, mstar:number|null, phiStar:number|null, netKgPerKm:number|null, consts:object}}
 *   Nstar      : 손익분기 탑승인원(명). φ·c_car ≤ c_pax면 Infinity
 *   mstar      : 회당 필요한 승용차 출신 승객 m*(N) = (C0 + r·C_dh + N·c_pax)/c_car (명). N 없으면 null
 *   phiStar    : 필요 전환율 φ*(N) = m*(N)/N (−). N 없으면 null
 *   netKgPerKm : 운행 1회(회송 포함) 순감축 kg/버스-km = N·φ·c_car − C0 − N·c_pax − r·C_dh. N·φ 없으면 null
 */
export function breakeven(o = {}) {
  const k = consts(o);
  const { N, phi } = o;
  const den = phi == null ? NaN : phi * k.CCAR - k.CPAX;
  const Nstar = phi == null ? null : den > 0 ? (k.C0 + k.r * k.CDH) / den : Infinity;
  const mstar = N == null ? null : (k.C0 + k.r * k.CDH + N * k.CPAX) / k.CCAR;
  const phiStar = N == null || N <= 0 ? null : mstar / N;
  const netKgPerKm = N == null || phi == null ? null : N * phi * k.CCAR - k.C0 - N * k.CPAX - k.r * k.CDH;
  return { Nstar, mstar, phiStar, netKgPerKm, consts: k };
}

/** 출근 1회(회송 포함) 순감축 kg. o = {N, phi, km, kmpl, r, occ, vehicle, ...} */
export function tripNetKg(o) {
  return o.km * breakeven(o).netKgPerKm;
}

// ───────────────────────── 하루·연간 ─────────────────────────

// axis_model.daily_saving: n회(한 방향) 운행의 하루 순감축 kg. 회당 탑승 = min(정원×탑승률, D/n) 또는 고정 N
function dailySaving(n, it, k, capLoad) {
  if (n <= 0) return 0;
  const riders = it.D != null ? Math.min(capLoad, it.D / n) : Math.min(capLoad, it.N);
  const km = it.km;
  return n * (riders * it.phi * k.CCAR * km - (k.C0 * km + riders * k.CPAX * km) - k.r * k.CDH * km);
}

/**
 * 연간 순감축 (scenario_grid.t_year / axis_model.evaluate). 출근 회차 × 2(퇴근 대칭), 연 WORKDAYS(245)일.
 * @param {object} o
 * @param {Array<{km:number, tripsAM:number, N?:number, phi?:number, D?:number, key?:string}>} o.allocation
 *        항목별 N·phi가 없으면 공통 o.N·o.phi. D(하루 한 방향 수요)가 있으면 회당 탑승 = min(정원×load, D/회차) — 모형 기준값 재현용
 * @param {number} [o.N] 회당 탑승(명), [o.phi] 승용차 출신 비율, [o.load=1] 정원 대비 최대 탑승률, 그 외 vehicleConstants 입력과 r
 * @returns {{tYear:number, kgDay:number, trips:number, riders:number, carShift:number, items:Array}}
 *   tYear t/년, kgDay kg/일(왕복), trips 하루 운행 수(왕복), riders 하루 이용자(명, 출근 기준), carShift 그중 승용차 출신(명)
 */
export function annualNet(o) {
  const c = need().constants;
  const k = consts(o);
  const capLoad = k.cap * (o.load ?? c.LOAD);
  let kg = 0, trips = 0, riders = 0, carShift = 0;
  const items = o.allocation.map((a) => {
    const it = { km: a.km, D: a.D, N: a.N ?? o.N, phi: a.phi ?? o.phi };
    const n = a.tripsAM;
    const s = dailySaving(n, it, k, capLoad);
    const rid = it.D != null ? Math.min(it.D, n * capLoad) : n * Math.min(capLoad, it.N);
    kg += s; trips += n; riders += rid; carShift += rid * it.phi;
    return { key: a.key, km: a.km, tripsAM: n, tYear: (2 * s * c.WORKDAYS) / 1000, riders: rid, carShift: rid * it.phi };
  });
  return { tYear: (2 * kg * c.WORKDAYS) / 1000, kgDay: 2 * kg, trips: 2 * trips, riders, carShift, items };
}

// ───────────────────────── 배분 ─────────────────────────

/** 버스 처방 후보 축(9개) — 모형 수요 D(노선 5개분)·φ 포함 */
export function candidateAxes() {
  return need().axes.filter((a) => a.bus_candidate);
}

/**
 * 출근 회차 그리디 배분 (axis_model.greedy 이식: 매 회차마다 순감축 증분이 가장 큰 축에 1회, 증분 > 0일 때만, 축당 상한).
 * 두 가지 모드
 *   · N·phi를 주지 않으면 "모형 수요" 모드: 각 축의 모형 D·φ(파이썬 보정값 고정)로 계산 → 기준값 15/15/15/5회 정확히 재현.
 *     연비·회송·재차·탑승률(load)·축당 상한·평택→화성 거리 배율을 바꿔도 파이썬 sensitivity.json과 같은 결과.
 *   · N·phi를 주면 "균일 가정" 모드: 모든 축 회당 N명·φ 동일 → 사실상 축 길이 순 배분.
 *     순감축이 음수면 그리디는 아무 축도 고르지 않는다(alloc 빈 객체). 고정 배분을 평가하려면 annualNet에 기준 배분을 넣을 것.
 * @param {object} o {axes?, totalAM=50, capPerAxis=15, N?, phi?, load?, ptKmScale=1, kmpl, r, occ, vehicle, ...}
 * @returns {{alloc:Object<string,number>, allocation:Array, result:object, mode:"model"|"uniform"}}
 */
export function allocateGreedy(o = {}) {
  const c = need().constants;
  const axes = o.axes ?? candidateAxes();
  const totalAM = o.totalAM ?? c.AM_TRIPS;
  const capPer = o.capPerAxis ?? c.MAX_TRIPS;
  const uniform = o.N != null && o.phi != null;
  const k = consts(o);
  const capLoad = k.cap * (o.load ?? c.LOAD);
  const scale = o.ptKmScale ?? c.PT_KM_SCALE;
  const items = axes.map((a) => ({
    key: a.key,
    km: a.car_km * (a.key === "평택시→화성시" ? scale : 1),
    ...(uniform ? { N: o.N, phi: o.phi } : { D: a.model_D_day, phi: a.model_phi }),
  }));
  const n = items.map(() => 0);
  for (let t = 0; t < totalAM; t++) {
    let best = -1, gain = 0;
    items.forEach((it, i) => {
      if (n[i] >= capPer) return;
      const g = dailySaving(n[i] + 1, it, k, capLoad) - dailySaving(n[i], it, k, capLoad);
      if (g > gain) { best = i; gain = g; }
    });
    if (best < 0) break;
    n[best] += 1;
  }
  const allocation = items.map((it, i) => ({ ...it, tripsAM: n[i] })).filter((x) => x.tripsAM > 0);
  const alloc = Object.fromEntries(allocation.map((x) => [x.key, x.tripsAM]));
  return { alloc, allocation, result: annualNet({ ...o, allocation }), mode: uniform ? "uniform" : "model" };
}

/**
 * 현행 방식 배분: 28개 노선에 현재 출근 운행 회수 비율로 totalAM회(최대잔여법, axis_model.main과 같은 규칙).
 * 반환 allocation 항목에는 노선 모형 수요 D·φ가 들어 있어 annualNet에 그대로 넣으면 기준값(−793 t)이 재현된다.
 * 균일 가정으로 평가하려면 항목의 D·phi를 빼고 annualNet({allocation, N, phi})로.
 */
export function allocateProportional({ routes, totalAM } = {}) {
  const c = need().constants;
  routes = routes ?? need().routes;
  totalAM = totalAM ?? c.AM_TRIPS;
  const tot = routes.reduce((s, r) => s + r.n_cur_am, 0);
  const raw = routes.map((r) => (totalAM * r.n_cur_am) / tot);
  const n = raw.map(Math.floor);
  let left = totalAM - n.reduce((s, x) => s + x, 0);
  // 파이썬 sorted(key=-(소수부))는 안정 정렬 → 같은 소수부면 원래 순서
  const order = raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (left-- <= 0) break; n[i] += 1; }
  const allocation = routes.map((r, i) => ({ key: r.id, km: r.km, tripsAM: n[i], D: r.model_D_day, phi: r.model_phi }))
    .filter((x) => x.tripsAM > 0);
  return { alloc: Object.fromEntries(allocation.map((x) => [x.key, x.tripsAM])), allocation };
}

/**
 * model.json의 고정 기준 배분(파이썬 결과)을 annualNet 입력 형태로.
 * @param {"ours"|"base"} which  ours = PCTR 기준 4축, base = 현행 28노선
 * @param {{withDemand?:boolean}} [opt]  true(기본)면 모형 D·φ 포함(기준값 재현), false면 km·회차만(균일 가정 평가용)
 */
export function baseAllocation(which = "ours", { withDemand = true } = {}) {
  const md = need();
  const alloc = md.model_base[which].alloc;
  const src = which === "ours" ? md.axes.map((a) => ({ key: a.key, km: a.model_km ?? a.car_km, D: a.model_D_day, phi: a.model_phi }))
                               : md.routes.map((r) => ({ key: r.id, km: r.km, D: r.model_D_day, phi: r.model_phi }));
  return src.filter((x) => alloc[x.key] > 0).map((x) => (withDemand ? { ...x, tripsAM: alloc[x.key] }
                                                                     : { key: x.key, km: x.km, tripsAM: alloc[x.key] }));
}

// ───────────────────────── 설명용 ─────────────────────────

/**
 * PCTR → 승용차 통근 분담률 (axis_model 로짓): P_car = 1 / (1 + exp(−(α_o + β·ln PCTR)))
 * @param {number} pctr  대중교통 시간 / 승용차 시간
 * @param {number|string} alpha  출발지 보정값 α_o (숫자) 또는 시군 이름(model.json constants.alpha_o에서 찾음)
 * @param {number} [beta=3.20]
 */
export function pctrToCarShare(pctr, alpha, beta) {
  const c = need().constants;
  const a = typeof alpha === "string" ? c.alpha_o[alpha] : alpha;
  if (a == null) throw new Error(`α_o 없음: ${alpha}`);
  return 1 / (1 + Math.exp(-(a + (beta ?? c.BETA) * Math.log(pctr))));
}

/** 시뮬레이터 슬라이더 권장 범위 (모델 근거 범위 기준) */
export const SAFE_RANGES = {
  N:      { min: 10, max: 44, step: 1, note: "정원 44석 초과 불가(annualNet은 정원×load로 자름)" },
  phi:    { min: 0.1, max: 0.6, step: 0.01, note: "근거 0.17–0.26(현행 좌석형), 상한 0.5–0.6(GTX-A 50%)" },
  kmpl:   { min: 2.83, max: 4.0, step: 0.01, note: "디젤 연비 근거 범위. 3.0 미만은 보정 η가 타당 범위(0.28) 아래" },
  kmpkg:  { min: 22, max: 34, step: 0.5, note: "수소버스 공식 28.0 km/kg 주변(표 20–36 계산됨)" },
  h2:     { min: 0, max: 10.3, step: 0.1, note: "부생수소 0 ~ 개질 9.2 ~ 10.3" },
  r:      { min: 0, max: 1, step: 0.05, note: "회송 비율(편하G 편성상 1)" },
  occ:    { min: 1.0, max: 1.5, step: 0.05, note: "출근 1.1, 전 목적 1.4" },
  load:   { min: 0.6, max: 1.0, step: 0.05, note: "모형 수요 모드의 최대 탑승률" },
  capPerAxis: { min: 5, max: 20, step: 1, note: "축당 출근 회차 상한(기준 15)" },
  ptKmScale:  { min: 0.7, max: 1.0, step: 0.05, note: "평택→화성 목적지 거리 배율(민감도 0.7)" },
};
