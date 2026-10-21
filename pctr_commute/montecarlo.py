"""C. 결합 불확실성 몬테카를로 (닫힌 식, scenario_grid.t_year와 같은 식, 배분은 기준 결과로 고정)
연간 순감축 t = 2 × WORKDAYS/1000 × Σ n·km × (N·φ·c_car − C0 − N·c_pax − R_DH·C_dh)   (출근 회차 × 2 = 퇴근 대칭)
  c_car = (승용차 1회 CO₂/km) / 재차인원,  C0·c_pax·C_dh = 유니버스 디젤 km당 값(연비 kmpl로 η 재보정)
kmpl별 버스 상수는 axis_model.vehicle_constants()(breakeven.calibrate 재보정)를 41개 격자에서 미리 계산해 선형 보간.
출력: result/montecarlo.json"""
import json
import numpy as np
import axis_model as m
from improve_common import setup

SEED, NDRAW = 20261021, 20_000
S = setup()
res, lk, routes = S["res"], S["lk"], S["routes"]

# ── 배분 고정 (출근 회차, km) ────────────────────────────────
ours = {}
for k, n in res["alloc_ours"].items():
    o, d = k.split("→")
    km = float(lk[(lk.o == o) & (lk.d == d)].iloc[0].car_km) * (m.PT_KM_SCALE if k == "평택시→화성시" else 1.0)
    ours[k] = (n, km)
rkm = {b["id"]: b["km"] for b in routes}
base = {k: (n, rkm[k]) for k, n in res["alloc_base"].items() if n > 0}
L_p = sum(n * km for n, km in ours.values())      # 출근 버스-km/일
L_b = sum(n * km for n, km in base.values())

# ── kmpl 격자: 버스 km당 상수 재보정 ─────────────────────────
k0, occ0 = m.COACH_KMPL, m.CAR_OCC
KG = np.linspace(2.83, 4.0, 41)
tab = []
for k in KG:
    m.COACH_KMPL = float(k)
    v, cc = m.vehicle_constants()
    tab.append((v["출퇴근 직행"]["C0"], v["출퇴근 직행"]["CDH"], v["출퇴근 직행"]["CPAX"], cc * occ0, v["출퇴근 직행"]["eta"]))
m.COACH_KMPL = k0
m.VEH, m.CCAR_KM = m.vehicle_constants()
tab = np.array(tab)
CAR_TRIP_KM = tab[0, 3]                            # 승용차 1회 CO₂/km (재차 1인 기준), kmpl과 무관
# 보간 오차 확인: 기준 3.49
chk = dict(C0=float(np.interp(3.49, KG, tab[:, 0])) - m.VEH["출퇴근 직행"]["C0"],
           CDH=float(np.interp(3.49, KG, tab[:, 1])) - m.VEH["출퇴근 직행"]["CDH"],
           CPAX=float(np.interp(3.49, KG, tab[:, 2])) - m.VEH["출퇴근 직행"]["CPAX"])

DIST = dict(N_p=("U", 20, 44), phi_p=("U", 0.17, 0.6), N_b=("U", 15, 25), phi_b=("U", 0.15, 0.35),
            COACH_KMPL=("U", 2.83, 4.0), R_DH=("U", 0.0, 1.0), CAR_OCC=("U", 1.1, 1.4))
F = 2 * m.WORKDAYS / 1000


def t_year(L, N, phi, C0, CDH, CPAX, CC, R):
    return F * L * (N * phi * CC - C0 - N * CPAX - R * CDH)


def draw(rng, n):
    return {k: rng.uniform(lo, hi, n) for k, (_, lo, hi) in DIST.items()}


def consts(x):
    C0 = np.interp(x["COACH_KMPL"], KG, tab[:, 0]); CDH = np.interp(x["COACH_KMPL"], KG, tab[:, 1])
    CPAX = np.interp(x["COACH_KMPL"], KG, tab[:, 2]); CC = CAR_TRIP_KM / x["CAR_OCC"]
    return C0, CDH, CPAX, CC


def summarize(tp, tb, x=None):
    d = tp - tb
    pct = lambda a: {f"p{q}": round(float(np.percentile(a, q))) for q in (5, 50, 95)}
    out = dict(P_pctr_gt_0=round(float((tp > 0).mean()), 3), P_base_lt_0=round(float((tb < 0).mean()), 3),
               P_pctr_gt_base=round(float((tp > tb).mean()), 3), P_base_gt_0=round(float((tb > 0).mean()), 3),
               P_pctr_gt_base_and_pctr_gt_0=round(float(((tp > tb) & (tp > 0)).mean()), 3),
               P_both_lt_0_pctr_less_bad=round(float(((tp > tb) & (tp < 0) & (tb < 0)).mean()), 3),
               pctr_t=pct(tp), base_t=pct(tb), diff_t=pct(d),
               mean=dict(pctr=round(float(tp.mean())), base=round(float(tb.mean())), diff=round(float(d.mean()))))
    if x is not None:   # 입력별 스피어만 순위상관 (어떤 입력이 결과를 좌우하나)
        rk = lambda a: np.argsort(np.argsort(a))
        sp = lambda a, b: round(float(np.corrcoef(rk(a), rk(b))[0, 1]), 3)
        out["spearman_pctr"] = {k: sp(v, tp) for k, v in x.items() if k not in ("N_b", "phi_b")}
        out["spearman_diff"] = {k: sp(v, d) for k, v in x.items()}
    return out


rng = np.random.default_rng(SEED)
x = draw(rng, NDRAW)
C0, CDH, CPAX, CC = consts(x)
tp = t_year(L_p, x["N_p"], x["phi_p"], C0, CDH, CPAX, CC, x["R_DH"])
tb = t_year(L_b, x["N_b"], x["phi_b"], C0, CDH, CPAX, CC, x["R_DH"])
main_res = summarize(tp, tb, x)
np.savez_compressed(m.ROOT / "result/montecarlo_draws.npz", pctr_t=tp.astype("float32"), base_t=tb.astype("float32"))

# 변형 1·2: 두 방식에 같은 φ (가설 없음). 탑승 인원 분포는 그대로(새 축 만석 쪽 vs 현행 실적 쪽)
variants = {}
for name, (lo, hi) in {"equal_phi_U(0.15,0.6)": (0.15, 0.6), "equal_phi_U(0.15,0.35)": (0.15, 0.35)}.items():
    r2 = np.random.default_rng(SEED)
    y = draw(r2, NDRAW)
    phi = r2.uniform(lo, hi, NDRAW)
    c = consts(y)
    variants[name] = summarize(t_year(L_p, y["N_p"], phi, *c, y["R_DH"]), t_year(L_b, y["N_b"], phi, *c, y["R_DH"]))
    variants[name]["phi_common"] = ["U", lo, hi]
# 변형 3·4: 탑승 인원만 같게 (φ 가설만 남김). 공통 N ~ U(15,25)(현행 실적 수준) / U(20,44)(새 축 분포)
for name, (lo, hi) in {"equal_N_U(15,25)": (15, 25), "equal_N_U(20,44)": (20, 44)}.items():
    r2 = np.random.default_rng(SEED)
    y = draw(r2, NDRAW)
    Nc = r2.uniform(lo, hi, NDRAW)
    c = consts(y)
    variants[name] = summarize(t_year(L_p, Nc, y["phi_p"], *c, y["R_DH"]), t_year(L_b, Nc, y["phi_b"], *c, y["R_DH"]))
    variants[name]["N_common"] = ["U", lo, hi]
# 변형 5: 탑승 인원·φ 모두 같게 (N ~ U(15,44), φ ~ U(0.15,0.6)) → 노선 길이 차이만 남음
r3 = np.random.default_rng(SEED)
y = draw(r3, NDRAW); Nc = r3.uniform(15, 44, NDRAW); phic = r3.uniform(0.15, 0.6, NDRAW); c = consts(y)
variants["equal_N_and_phi"] = summarize(t_year(L_p, Nc, phic, *c, y["R_DH"]), t_year(L_b, Nc, phic, *c, y["R_DH"]))
variants["equal_N_and_phi"].update(N_common=["U", 15, 44], phi_common=["U", 0.15, 0.6])

# 점검: 기준 상수로 닫힌 식이 allocation.json(PCTR 배분 +1,020 t)과 scenario_grid 값을 재현하는지
V = m.VEH["출퇴근 직행"]
base_chk = dict(pctr_44_0p5=round(float(t_year(L_p, 44, 0.5, V["C0"], V["CDH"], V["CPAX"], m.CCAR_KM, m.R_DH)), 1),
                base_19p5_0p25=round(float(t_year(L_b, 19.5, 0.25, V["C0"], V["CDH"], V["CPAX"], m.CCAR_KM, m.R_DH)), 1),
                allocation_json_ours=round(res["ours"]["t_year"], 1), allocation_json_base=round(res["base"]["t_year"], 1),
                note="현행 방식 −793 t는 노선별 수요 모형(노선마다 다른 D·φ) 결과라 균일 19.5명·φ0.25 닫힌 식과 약간 다르다")

out = dict(
    method="닫힌 식(scenario_grid.t_year), 배분 고정(PCTR 4축 출근 50회 / 현행 28노선 출근 50회), 퇴근 대칭 ×2, 근무일 %d" % m.WORKDAYS,
    n_draws=NDRAW, seed=SEED,
    distributions={k: dict(dist="uniform", low=lo, high=hi) for k, (_, lo, hi) in DIST.items()},
    shared_inputs="COACH_KMPL·R_DH·CAR_OCC는 같은 시행에서 두 방식에 같은 값(공통 물리량), N·φ는 방식별 독립",
    bus_km_per_day=dict(pctr=round(L_p, 1), base=round(L_b, 1), pctr_avg_km=round(L_p / 50, 1), base_avg_km=round(L_b / 50, 1)),
    kmpl_lookup=dict(grid=[round(float(k), 4) for k in KG[::10]], C0=[round(float(v), 4) for v in tab[::10, 0]],
                     CDH=[round(float(v), 4) for v in tab[::10, 1]], CPAX=[round(float(v), 5) for v in tab[::10, 2]],
                     eta=[round(float(v), 4) for v in tab[::10, 4]], car_trip_kg_per_km_occ1=round(float(CAR_TRIP_KM), 4),
                     interp_error_at_3p49=chk),
    main=main_res, variants=variants, closed_form_check=base_chk,
)
json.dump(out, open(m.ROOT / "result/montecarlo.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=float)

if __name__ == "__main__":
    print(json.dumps({k: out[k] for k in ("bus_km_per_day", "main", "variants", "closed_form_check")}, ensure_ascii=False, indent=1))
    print("kmpl lookup", out["kmpl_lookup"])
