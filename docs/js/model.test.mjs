// 검증: node docs/js/model.test.mjs
// 보고서(report/report.html) 핵심 수치와 파이썬 결과 파일을 model.js가 재현하는지 확인한다.
// 허용오차: 인원 ±0.1명, 톤 ±2 t, 확률·분위수는 데이터 그대로(정확 일치).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as M from "./model.js";

const here = dirname(fileURLToPath(import.meta.url));
const model = JSON.parse(readFileSync(join(here, "../data/model.json"), "utf8"));
M.init(model);

let pass = 0, fail = 0;
const rows = [];
function check(name, got, want, tol) {
  const ok = tol === 0 ? got === want : Math.abs(got - want) <= tol;
  ok ? pass++ : fail++;
  rows.push(`${ok ? "PASS" : "FAIL"}  ${name}: ${typeof got === "number" ? +got.toFixed(4) : got} (기대 ${want}${tol ? ` ±${tol}` : ""})`);
}
const P = 0.1, T = 2;

// ── 1. 손익분기 N* ──
const be = (o) => M.breakeven({ r: 1, occ: 1.1, kmpl: 3.49, vehicle: "diesel", ...o });
check("N* 디젤 φ=1.0", be({ phi: 1.0 }).Nstar, 10.7, P);
check("N* 디젤 φ=0.5", be({ phi: 0.5 }).Nstar, 21.9, P);
check("N* 디젤 φ=0.25", be({ phi: 0.25 }).Nstar, 45.3, P);
check("N* 수소 φ=0.25", M.breakeven({ phi: 0.25, vehicle: "fcev", r: 1, occ: 1.1 }).Nstar, 23.3, P);

// ── 2. m*(N), φ* ──
for (const [N, want] of [[19.5, 10.89], [20, 10.9], [30, 11.07], [44, 11.3]]) check(`m*(${N})`, be({ N }).mstar, want, P);
check("φ*(44)", be({ N: 44 }).phiStar, 0.257, 0.0005);
const k = M.vehicleConstants({});
check("C0 (capture_rate.json)", k.C0, 0.79307, 1e-5);
check("C_dh", k.CDH, 0.61233, 1e-5);
check("c_pax", k.CPAX, 0.0021842, 1e-7);
check("c_car (재차 1.1)", k.CCAR, 0.132923, 1e-6);

// ── 3. 연비 아핀식 vs 파이썬 직접 재보정 표 (2.80–4.20, 0.05 간격) ──
let maxRel = 0, maxRelIn = 0;
for (const r of model.constants.diesel.table) {
  const v = M.vehicleConstants({ kmpl: r.kmpl });
  for (const key of ["C0", "CDH", "CPAX"]) {
    const e = Math.abs(v[key] / r[key] - 1);
    maxRel = Math.max(maxRel, e);
    if (r.kmpl >= 2.83 && r.kmpl <= 4.0) maxRelIn = Math.max(maxRelIn, e);
  }
}
check("디젤 연비 표 최대 상대오차(표 반올림 1e-8 수준)", maxRel, 0, 1e-5);
let fRel = 0;
for (const r of model.constants.fcev.table) {
  const v = M.vehicleConstants({ vehicle: "fcev", kmpkg: r.kmpkg });
  for (const key of ["C0", "CDH", "CPAX"]) fRel = Math.max(fRel, Math.abs(v[key] / r[key] - 1));
}
check("수소 km/kg 표 최대 상대오차", fRel, 0, 1e-5);

// ── 4. 모형 기준값 배분 (출근 50 + 퇴근 50, 245일) ──
const ours = M.annualNet({ allocation: M.baseAllocation("ours") });
check("PCTR 배분 합 t/년", ours.tYear, 1020, T);
check("PCTR 배분 하루 이용", ours.riders, 2200, P);
check("PCTR 배분 승용차 출신", ours.carShift, 1100, P);
const perAxis = Object.fromEntries(ours.items.map((x) => [x.key, x]));
for (const [key, n, t] of [["평택시→화성시", 15, 431], ["고양시→파주시", 15, 282], ["안산시→화성시", 15, 239], ["화성시→수원시 영통구", 5, 68]]) {
  check(`${key} 회수`, perAxis[key].tripsAM, n, 0);
  check(`${key} t/년`, perAxis[key].tYear, t, T);
}
const base = M.annualNet({ allocation: M.baseAllocation("base") });
check("현행 방식 t/년", base.tYear, -793, T);
check("현행 방식 하루 이용", base.riders, 1032, 0.5);   // 1,032.47 → 보고서 1,032 (반올림)
check("현행 방식 승용차 출신", base.carShift, 256, 0.2); // 255.89
check("현행 방식 대중교통 출신", base.riders - base.carShift, 777, 0.5);
check("현행 하루 운행 수", base.trips, 100, 0);
check("현행 회당 탑승(모형 보정 목표 19.5와 별개, 실제 새 회차 평균)", base.riders / 50, 20.65, 0.01);

// 그리디·비례 배분 재계산이 고정 배분과 같은가
const g = M.allocateGreedy({});
check("그리디(모형 수요) 배분 = 15/15/15/5", JSON.stringify(g.alloc), JSON.stringify(model.model_base.ours.alloc), 0);
check("그리디(모형 수요) t/년", g.result.tYear, 1020, T);
const gu = M.allocateGreedy({ N: 44, phi: 0.5 });
check("그리디(균일 44명·φ0.5) 배분", JSON.stringify(gu.alloc), JSON.stringify(model.model_base.ours.alloc), 0);
const pr = M.allocateProportional({});
check("비례 배분 = allocation.json alloc_base", JSON.stringify(pr.alloc), JSON.stringify(model.model_base.base.alloc), 0);
check("비례 배분 t/년", M.annualNet({ allocation: pr.allocation }).tYear, -793, T);

// ── 5. 시나리오 표4 (균일 N·φ, 배분 고정) ──
const oursKm = M.baseAllocation("ours", { withDemand: false });
const baseKm = M.baseAllocation("base", { withDemand: false });
for (const s of model.scenario_grid.grid) {
  check(`표4 PCTR N=${s.N} φ=${s.phi}`, M.annualNet({ allocation: oursKm, N: s.N, phi: s.phi }).tYear, s.ours_t, T);
  check(`표4 현행 N=${s.N} φ=${s.phi}`, M.annualNet({ allocation: baseKm, N: s.N, phi: s.phi }).tYear, s.base_t, T);
}
const want4 = { "20,0.25": [-563, -754], "20,0.35": [-372, -498], "20,0.5": [-86, -115], "30,0.25": [-340, -455], "30,0.35": [-54, -72],
  "30,0.5": [375, 502], "44,0.25": [-28, -38], "44,0.35": [391, 524], "44,0.5": [1020, 1367] };
for (const s of model.scenario_grid.grid) {
  const w = want4[`${s.N},${s.phi}`];
  check(`표4 보고서 값 일치 N=${s.N} φ=${s.phi}`, `${s.ours_t}/${s.base_t}`, `${w[0]}/${w[1]}`, 0);
}
const avgKm = (al) => al.reduce((s, x) => s + x.km * x.tripsAM, 0) / al.reduce((s, x) => s + x.tripsAM, 0);
check("평균 축 길이 PCTR km", avgKm(oursKm), 29.3, 0.05);
check("평균 축 길이 현행 km", avgKm(baseKm), 39.2, 0.05);

// ── 6. 민감도 재현 (모형 수요 고정, 그리디 재실행) — 수요 보정을 바꾸지 않는 입력만 ──
const sens = Object.fromEntries(model.sensitivity.oneway.map((s) => [s.param, s]));
const sensCase = { COACH_KMPL: "kmpl", R_DH: "r", CAR_OCC: "occ", MAX_TRIPS: "capPerAxis", LOAD: "load", PT_KM_SCALE: "ptKmScale" };
for (const [p, arg] of Object.entries(sensCase)) {
  sens[p].values.forEach((v, i) => {
    const o = { [arg]: v };
    check(`민감도 ${p}=${v} PCTR`, M.allocateGreedy(o).result.tYear, sens[p].ours_t[i], T);
    check(`민감도 ${p}=${v} 현행`, M.annualNet({ ...o, allocation: M.baseAllocation("base") }).tYear, sens[p].base_t[i], T);
  });
}

// ── 7. 몬테카를로 (데이터 그대로) ──
const mc = model.montecarlo.main;
check("P(PCTR>0)", mc.P_pctr_gt_0, 0.609, 0);
check("PCTR 중앙값", mc.pctr_t.p50, 124, 0);
check("PCTR p5", mc.pctr_t.p5, -471, 0);
check("PCTR p95", mc.pctr_t.p95, 973, 0);
check("P(현행<0)", mc.P_base_lt_0, 0.856, 0);
check("현행 중앙값", mc.base_t.p50, -388, 0);
check("P(PCTR 더 나음)", mc.P_pctr_gt_base, 0.873, 0);
const h = model.montecarlo.histogram;
check("히스토그램 PCTR 합 = 2만", h.pctr.reduce((a, b) => a + b, 0), 20000, 0);
check("히스토그램 현행 합 = 2만", h.base.reduce((a, b) => a + b, 0), 20000, 0);
check("히스토그램 빈 수", h.pctr.length, 60, 0);

// ── 8. φ 참고값·로짓 ──
check("φ 참고 배분 4축 평균", model.phi_reference.allocated_4.mean, 0.69, 0);
check("φ 참고 현행 28노선(운행 가중)", model.phi_reference.existing_28.w_n_cur_am, 0.33, 0);
check("φ 참고 서울행(운행 가중)", model.phi_reference.existing_seoul.w_n_cur_am, 0.272, 0);
let lgMax = 0;
for (const a of model.axes) lgMax = Math.max(lgMax, Math.abs(M.pctrToCarShare(a.PCTR, a.origin) - a.phi_proxy));
check("로짓 P_car 20축 최대 오차(PCTR·α 반올림)", lgMax, 0, 0.002);

// ── 9. 데이터 완결성 ──
check("축 개수", model.axes.length, 20, 0);
check("노선 개수", model.routes.length, 28, 0);
check("축 좌표 누락", model.axes.filter((a) => a.origin_lat == null || a.dest_lat == null).length, 0, 0);
check("노선 좌표 누락", model.routes.filter((r) => r.origin_lat == null || r.dest_lat == null).length, 0, 0);
const pt = model.axes.find((a) => a.key === "평택시→화성시");
check("평택→화성 대중교통 분", Math.round(pt.T_transit), 151, 0);
check("평택→화성 신규 버스 분", Math.round(pt.T_new_bus), 69, 0);

// ── 10. 몬테카를로 JS 이식 (montecarlo.py와 같은 식·분포, 난수만 mulberry32) ──
const mcs = M.mcSetup();
check("MC 출근 버스-km/일 PCTR", mcs.Lp, model.montecarlo.bus_km_per_day.pctr, 0.05);
check("MC 출근 버스-km/일 현행", mcs.Lb, model.montecarlo.bus_km_per_day.base, 0.05);
const kb = M.vehicleConstants({});
const cf = model.montecarlo.closed_form_check;
check("MC 닫힌 식 44명·φ0.5 = 파이썬", M.mcTYear(mcs.Lp, 44, 0.5, kb, 1), cf.pctr_44_0p5, 0.1);
check("MC 닫힌 식 현행 19.5명·φ0.25 = 파이썬", M.mcTYear(mcs.Lb, 19.5, 0.25, kb, 1), cf.base_19p5_0p25, 0.1);
check("MC 분포 = 파이썬 DIST", JSON.stringify(Object.fromEntries(Object.entries(mcs.dist).map(([k, v]) => [k, [v.low, v.high]]))),
  JSON.stringify({ N_p: [20, 44], phi_p: [0.17, 0.6], N_b: [15, 40], phi_b: [0.15, 0.35], COACH_KMPL: [2.83, 4], R_DH: [0, 1], CAR_OCC: [1.1, 1.4] }), 0);
const r1 = M.mcRun({ n: 20000, seed: 20261021 }), r1b = M.mcRun({ n: 20000, seed: 20261021 });
check("MC 같은 시드 재현", r1.P_pctr_gt_0 === r1b.P_pctr_gt_0 && r1.tp[19999] === r1b.tp[19999] ? 1 : 0, 1, 0);
const mcSeeds = [20261021, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const mcRows = [];
for (const seed of mcSeeds) {
  const r = M.mcRun({ n: 20000, seed });
  check(`MC 시드 ${seed} P(PCTR>0) vs 파이썬 0.609 (±2%p)`, r.P_pctr_gt_0, mc.P_pctr_gt_0, 0.02);
  check(`MC 시드 ${seed} P(현행<0) vs 파이썬 0.856 (±2%p)`, r.P_base_lt_0, mc.P_base_lt_0, 0.02);
  check(`MC 시드 ${seed} P(PCTR>현행) vs 파이썬 0.873 (±2%p)`, r.P_pctr_gt_base, mc.P_pctr_gt_base, 0.02);
  check(`MC 시드 ${seed} PCTR 중앙값 vs 파이썬 124 (±30 t)`, r.pctr_t.p50, mc.pctr_t.p50, 30);
  check(`MC 시드 ${seed} 현행 중앙값 vs 파이썬 −388 (±30 t)`, r.base_t.p50, mc.base_t.p50, 30);
  check(`MC 시드 ${seed} PCTR p5/p95 (±40 t)`, Math.max(Math.abs(r.pctr_t.p5 - mc.pctr_t.p5), Math.abs(r.pctr_t.p95 - mc.pctr_t.p95)), 0, 40);
  mcRows.push(`  시드 ${seed}: P(PCTR>0) ${(r.P_pctr_gt_0 * 100).toFixed(1)}%  P(현행<0) ${(r.P_base_lt_0 * 100).toFixed(1)}%  P(PCTR>현행) ${(r.P_pctr_gt_base * 100).toFixed(1)}%  중앙값 ${r.pctr_t.p50.toFixed(0)} / ${r.base_t.p50.toFixed(0)}`);
}

console.log(rows.join("\n"));
console.log("\n몬테카를로 JS(mulberry32) vs 파이썬(시드 20261021): 61.0% / 85.6% / 87.3%, 중앙값 124 / −388\n" + mcRows.join("\n"));
console.log(`\n${pass} 통과 / ${fail} 실패`);
console.log(`디젤 연비 아핀식 최대 상대오차: 전체 ${maxRel.toExponential(2)}, 2.83–4.0 ${maxRelIn.toExponential(2)} / 수소 ${fRel.toExponential(2)}`);
process.exit(fail ? 1 : 0);
