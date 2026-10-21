"""소개 페이지(docs/)용 모델 데이터 docs/data/model.json 생성

모델 코드(pctr_commute/*.py)는 고치지 않고 import만 한다. axis_model.main()은 result/ 파일을 다시 쓰므로 호출하지 않고,
main()과 같은 단계(vehicle_constants → calibrate → base_routes → calibrate_demand → 후보 축 → greedy)를 그대로 따라 한 뒤
result/allocation.json 값과 일치하는지 assert로 확인한다. 이 스크립트는 pctr_commute/result 등 원본 파일에 아무것도 쓰지 않는다.

실행: python3 docs/data/build_model_json.py   (저장소 루트 어디서든)
출력: docs/data/model.json
"""
import csv
import json
import math
import sys
from dataclasses import replace
from pathlib import Path

import numpy as np
import pandas as pd

REPO = Path(__file__).resolve().parents[2]
PC = REPO / "pctr_commute"
sys.path.insert(0, str(PC))
import axis_model as m      # noqa: E402
import breakeven as be      # noqa: E402

OUT = Path(__file__).resolve().parent / "model.json"
R = lambda x, n=4: None if x is None or (isinstance(x, float) and not math.isfinite(x)) else round(float(x), n)


def rel(p):
    return str(Path(p).resolve().relative_to(REPO))


def load_json(p):
    return json.load(open(p, encoding="utf-8"))


# ───────────────────────── 1. 차량 상수 (km당) ─────────────────────────
# axis_model.vehicle_constants(): 축 길이 25 km·피크 간선 45 km/h·가다서다 1회/km 기준 시나리오로 breakeven.py 모델을 돌려
# km당 C0(빈 차 1회), C_dh(회송 1회), c_pax(승객 1명 추가분), c_car(승용차 1인)를 얻는다. 손익분기 N*는 이 km당 값의 비라서 축 길이와 무관.
k0, occ0, r0 = m.COACH_KMPL, m.CAR_OCC, m.R_DH
m.VEH, m.CCAR_KM = m.vehicle_constants()
V = m.VEH["출퇴근 직행"]
CCAR = m.CCAR_KM                         # 재차 1.1 기준 승용차 1인 kg/km
CAR_TRIP = CCAR * occ0                   # 승용차 1회(재차 무관) kg/km

# 디젤 연비 격자: η를 공인/보고 연비에 맞춰 재보정(breakeven.calibrate). 연료량이 1/η에 선형이고 1/η가 1/kmpl에 선형이므로
# C0·C_dh·c_pax는 1/kmpl에 정확히 아핀(A + B/kmpl) → 최소제곱 계수와 잔차를 함께 기록.
KG = np.round(np.arange(2.80, 4.2001, 0.05), 2)
dtab = []
for k in KG:
    m.COACH_KMPL = float(k)
    v, cc = m.vehicle_constants()
    d = v["출퇴근 직행"]
    dtab.append(dict(kmpl=float(k), C0=d["C0"], CDH=d["CDH"], CPAX=d["CPAX"], eta=d["eta"], CCAR_occ1=cc * occ0))
m.COACH_KMPL = k0
m.VEH, m.CCAR_KM = m.vehicle_constants()
assert abs(m.CCAR_KM - CCAR) < 1e-15


def affine_fit(xs, ys):
    A = np.vstack([np.ones_like(xs), xs]).T
    c, *_ = np.linalg.lstsq(A, ys, rcond=None)
    res = ys - A @ c
    return [float(c[0]), float(c[1])], float(np.abs(res).max()), float(np.abs(res / ys).max())


u = 1 / KG
diesel_affine = {}
for key in ("C0", "CDH", "CPAX"):
    ys = np.array([r[key] for r in dtab])
    coef, abs_err, rel_err = affine_fit(u, ys)
    # 단순 비례 근사(X ∝ 3.49/kmpl, 기준점 일치) 오차: 공회전·보조 연료 몫이 η와 무관해 비례가 아니다 → 참고로 기록
    prop = V[key] * k0 / KG
    rng = (KG >= 2.83 - 1e-9) & (KG <= 4.0 + 1e-9)
    diesel_affine[key] = dict(A=coef[0], B=coef[1], max_abs_resid=abs_err, max_rel_resid=rel_err,
                              proportional_max_rel_err_2p83_4p0=float(np.abs(prop[rng] / ys[rng] - 1).max()))
# 기준 3.49에서 아핀식 = vehicle_constants() 직접값 확인
for key in ("C0", "CDH", "CPAX"):
    a = diesel_affine[key]
    assert abs(a["A"] + a["B"] / k0 - V[key]) < 1e-12, key


# 수소버스(FCEV): breakeven.py main()과 같은 보정(인증 조건 보조 1.5 kW로 η 역산 → 운행 6 kW), 같은 25 km 기준 시나리오
def fcev_constants(kmpkg, d_km=25.0):
    tgt, segs, _, aux = be.CALIB["fcev"]
    cv = be.calibrate(replace(be.FCEV, P_aux_kW=aux), segs, 1 / kmpkg)
    cv = replace(cv, P_aux_kW=be.FCEV.P_aux_kW)
    car_tgt, car_segs, _, _ = be.CALIB["car"]
    car = be.calibrate(be.CAR, car_segs, car_tgt)
    r = be.breakeven(cv, car, d_km, 45.0, 1.0, 1.0, 1.0, occ0, "direct")
    return dict(kmpkg=float(kmpkg), C0=r["C0"] / d_km, CDH=r["C_dh"] / d_km, CPAX=r["c_pax"] / d_km, eta=cv.eta,
                CCAR=r["c_car"] / d_km)


FG = np.arange(20.0, 36.01, 1.0)
ftab = [fcev_constants(k) for k in FG]
F0 = fcev_constants(28.0)
assert abs(F0["CCAR"] - CCAR) < 1e-12          # 승용차 상수는 디젤 쪽과 같은 모델
fcev_affine = {}
for key in ("C0", "CDH", "CPAX"):
    ys = np.array([r[key] for r in ftab])
    coef, abs_err, rel_err = affine_fit(1 / FG, ys)
    fcev_affine[key] = dict(A=coef[0], B=coef[1], max_abs_resid=abs_err, max_rel_resid=rel_err)

nstar = lambda c0, cdh, cpax, cc, phi, r=1.0: (c0 + r * cdh) / (phi * cc - cpax) if phi * cc > cpax else math.inf
chk = dict(diesel_phi1=nstar(V["C0"], V["CDH"], V["CPAX"], CCAR, 1.0), diesel_phi05=nstar(V["C0"], V["CDH"], V["CPAX"], CCAR, 0.5),
           diesel_phi025=nstar(V["C0"], V["CDH"], V["CPAX"], CCAR, 0.25), fcev_phi025=nstar(F0["C0"], F0["CDH"], F0["CPAX"], CCAR, 0.25))
assert abs(chk["diesel_phi1"] - 10.7) < 0.1 and abs(chk["diesel_phi05"] - 21.9) < 0.1
assert abs(chk["diesel_phi025"] - 45.3) < 0.1 and abs(chk["fcev_phi025"] - 23.3) < 0.1

# ───────────────────────── 2. 수요 보정·배분 (axis_model.main()과 같은 단계) ─────────────────────────
census = pd.read_csv(PC / "census/gyeonggi_commute_mode_2020.csv")
lookup = load_json(PC / "pctr/pctr_lookup.json")
eg = pd.read_csv(PC / "easygbus_routes.csv")
cal, alpha = m.calibrate(pd.read_csv(PC / "result100/axes_all.csv"), census, lookup)
routes = m.base_routes(cal, alpha, eg)
m.KAPPA, m.BONUS = m.calibrate_demand(routes)
alloc_json = load_json(PC / "result/allocation.json")
assert abs(m.KAPPA - alloc_json["calib"]["KAPPA"]) < 1e-12 and abs(m.BONUS - alloc_json["calib"]["BONUS"]) < 1e-9

cls_df = pd.read_csv(PC / "result/axes_classified.csv")
cands, cand_info = {}, {}
for _, r in cls_df.iterrows():
    if r["class"] not in ("DRT 연계", "출퇴근 직행"):
        continue
    k = f"{r.o}→{r.d}"
    opts = {}
    for c in (["DRT 연계", "출퇴근 직행"] if r["class"] == "DRT 연계" else ["출퇴근 직행"]):
        rr = dict(r); rr["class"] = c
        D, phi, T_new = m.service_demand(rr, alpha[r["o"]])
        km = r["car_km"] * (m.PT_KM_SCALE if k == "평택시→화성시" else 1.0)
        opts[c] = dict(D=D * m.N_ROUTE_SLOTS, phi=phi, km=km, cls=c, bus_km=m.DRT_KM if c == "DRT 연계" else km, n0=0, T_new=T_new)
    best = max(opts, key=lambda c: m.daily_saving(m.MAX_TRIPS, opts[c]))
    cands[k] = opts[best]
    cand_info[k] = dict(service=best, drt_phi=opts.get("DRT 연계", {}).get("phi"))
ours = m.greedy(cands, m.AM_TRIPS)
alloc_ours = {k: v for k, v in ours.items() if v > 0}
assert alloc_ours == alloc_json["alloc_ours"], (alloc_ours, alloc_json["alloc_ours"])
ev_ours = m.evaluate(ours, cands)
assert abs(ev_ours["t_year"] - alloc_json["ours"]["t_year"]) < 1e-6

base_c, w = {}, {}
for b in routes:
    D, phi, _ = m.service_demand(b["rr"], b["alpha"])
    base_c[b["id"]] = dict(D=D, phi=phi, km=b["km"], cls="출퇴근 직행", bus_km=b["km"], n0=0, k=b["k"])
    w[b["id"]] = b["n_cur"]
alloc_base = alloc_json["alloc_base"]
ev_base = m.evaluate(alloc_base, base_c)
assert abs(ev_base["t_year"] - alloc_json["base"]["t_year"]) < 1e-6
axis_t = {k: 2 * m.daily_saving(n, cands[k]) * m.WORKDAYS / 1000 for k, n in alloc_ours.items()}

# ───────────────────────── 3. 축 20개 ─────────────────────────
coords = load_json(REPO / "apimeasure/coords.json")
od_detail = pd.read_csv(REPO / "resid/od_detail.csv")
phi_proxy = load_json(PC / "result/phi_proxy.json")
alpha_o = {k: float(v) for k, v in alpha.items()}
axes = []
for _, r in cls_df.iterrows():
    k = f"{r.o}→{r.d}"
    pts = od_detail[od_detail.idx == r.idx]
    W = pts["pop"].sum()
    o_lat = float((pts.lat * pts["pop"]).sum() / W) if len(pts) else None
    o_lon = float((pts.lng * pts["pop"]).sum() / W) if len(pts) else None
    dll = coords["dest"].get(r.dest)
    c = cands.get(k)
    axes.append(dict(
        id=int(r.idx), key=k, origin=r.o, dest_sgg=r.d, dest=r.dest, seoul=str(r.d).startswith("서울"),
        car_km=R(r.car_km, 1), T_car=R(r.T_car, 1), T_transit=R(r.T_transit, 1), walk=R(r.walk, 1), xfer=R(r.xfer, 2),
        PCTR=R(r.PCTR, 3), PCTR_min=R(r.PCTR_min, 2), PCTR_max=R(r.PCTR_max, 2), n_pts=int(r.n_pts),
        diag=r["class"], Q_od=int(r.Q_od), Q_car=round(float(r.Q_car)), alpha_o=R(alpha_o[r.o], 4),
        phi_proxy=R(r.P_car, 3),          # 비례 추출 φ 참고값 = 축의 현재 승용차 분담 P_car(o,d)
        bus_candidate=k in cands,
        service=cand_info[k]["service"] if k in cands else None,
        model_D_day=R(c["D"], 6) if c else None,        # 출근 1방향 하루 수요(노선 5개분, 모형)
        model_phi=R(c["phi"], 6) if c else None,        # 모형 φ (PHI_MAX 0.5로 잘림)
        model_km=R(c["km"], 2) if c else None,          # 배분에 쓰인 운행 거리(= 승용차 거리 × PT_KM_SCALE)
        T_new_bus=R(c["T_new"], 1) if c else None,      # 신규 직행 문전 시간 = DETOUR·T_car + ACCESS(10분)
        alloc_am=int(alloc_ours.get(k, 0)),
        alloc_t_year=R(axis_t[k], 1) if k in axis_t else 0.0,
        origin_lat=R(o_lat, 5), origin_lon=R(o_lon, 5),
        origin_points=[dict(dong=p.dong, pop=int(p.pop), lat=float(p.lat), lon=float(p.lng)) for p in pts.itertuples()],
        dest_lat=dll[0] if dll else None, dest_lon=dll[1] if dll else None,
    ))

# ───────────────────────── 4. 현행 편하G 28개 노선 ─────────────────────────
rt_csv = pd.read_csv(PC / "result/phi_proxy_routes.csv").set_index("id")
stops = coords["stops"]
dkey = {}
for o, rid, ost, dst, dsgg in coords["routes"]:
    dkey[dst] = f"{dsgg}|{dst}"
missing_coords = []
route_rows = []
for b in routes:
    e = eg[eg.노선번호 == b["id"]].iloc[0]
    p = rt_csv.loc[b["id"]]
    ok = f"{e.시군}|{e.출발}"
    dk = dkey.get(e.도착) or next((s for s in stops if s.endswith("|" + e.도착)), None)
    oll, dll = stops.get(ok), stops.get(dk) if dk else None
    if oll is None or dll is None:
        missing_coords.append(b["id"])
    c = base_c[b["id"]]
    n = alloc_base.get(b["id"], 0)
    route_rows.append(dict(
        id=b["id"], origin=e.시군, origin_stop=e.출발, dest_stop=e.도착, dest_sido=e.도착_시도, dest_sgg=e.도착_시군구,
        seoul=bool(p.seoul), km=R(b["km"], 1), T_car=R(p.T_car, 1), T_transit=R(p.T_transit, 1),
        PCTR=R(p.PCTR_route, 3), n_cur_am=int(b["n_cur"]), alloc_base_am=int(n),
        phi_proxy=R(p.phi_proxy_route, 3), alpha_o=R(b["alpha"], 4),
        model_D_day=R(c["D"], 6), model_phi=R(c["phi"], 6),
        alloc_t_year=R(2 * m.daily_saving(n, c) * m.WORKDAYS / 1000, 1),
        origin_lat=oll[0] if oll else None, origin_lon=oll[1] if oll else None,
        dest_lat=dll[0] if dll else None, dest_lon=dll[1] if dll else None,
    ))

# ───────────────────────── 5. 시나리오·몬테카를로·민감도 ─────────────────────────
scen = load_json(PC / "result/scenario_grid.json")
mc = load_json(PC / "result/montecarlo.json")
draws = np.load(PC / "result/montecarlo_draws.npz")
tp, tb = draws["pctr_t"].astype(float), draws["base_t"].astype(float)
NB = 60
lo, hi = float(min(tp.min(), tb.min())), float(max(tp.max(), tb.max()))
lo, hi = math.floor(lo / 50) * 50, math.ceil(hi / 50) * 50          # 두 방식 공통 구간(겹쳐 그리기용)
edges = np.linspace(lo, hi, NB + 1)
hist = dict(bins=NB, edges=[round(float(x), 2) for x in edges],
            pctr=[int(x) for x in np.histogram(tp, edges)[0]], base=[int(x) for x in np.histogram(tb, edges)[0]],
            diff_edges=None, n=int(len(tp)))
d = tp - tb
de = np.linspace(math.floor(d.min() / 50) * 50, math.ceil(d.max() / 50) * 50, NB + 1)
hist["diff_edges"] = [round(float(x), 2) for x in de]
hist["diff"] = [int(x) for x in np.histogram(d, de)[0]]
pct = lambda a: {f"p{q}": round(float(np.percentile(a, q)), 1) for q in (5, 10, 25, 50, 75, 90, 95)}
mc_out = dict(method=mc["method"], n_draws=mc["n_draws"], seed=mc["seed"], distributions=mc["distributions"],
              shared_inputs=mc["shared_inputs"], bus_km_per_day=mc["bus_km_per_day"], main=mc["main"],
              percentiles_from_draws=dict(pctr=pct(tp), base=pct(tb), diff=pct(d)),
              closed_form_check=mc["closed_form_check"], histogram=hist)

sens = load_json(PC / "result/sensitivity.json")
base_vals = dict(THETA=m.THETA, TARGET_PHI=m.TARGET_PHI, TARGET_RIDE=m.TARGET_RIDE, R_DH=m.R_DH, MAX_TRIPS=m.MAX_TRIPS,
                 DRT_WAIT=m.DRT_WAIT, COACH_KMPL=m.COACH_KMPL, COACH_CAP=m.COACH_CAP, PHI_MAX=m.PHI_MAX, DETOUR=m.DETOUR,
                 ACCESS_DIRECT=m.ACCESS_DIRECT, LOAD=m.LOAD, CAR_OCC=m.CAR_OCC, PT_KM_SCALE=m.PT_KM_SCALE, BETA=m.BETA)
sens_out = []
for p in dict.fromkeys(x["param"] for x in sens):
    rows = [x for x in sens if x["param"] == p]
    sens_out.append(dict(param=p, base_value=base_vals.get(p), values=[x["value"] for x in rows],
                         ours_t=[x["ours_t"] for x in rows], base_t=[x["base_t"] for x in rows],
                         ours_min=min(x["ours_t"] for x in rows), ours_max=max(x["ours_t"] for x in rows),
                         base_min=min(x["base_t"] for x in rows), base_max=max(x["base_t"] for x in rows),
                         axes_changed=any(set(x["axes"]) != set(alloc_ours) for x in rows)))
combo = load_json(PC / "result/sensitivity_combo.json")

cap_rate = load_json(PC / "result/capture_rate.json")

# ───────────────────────── 6. 조립 ─────────────────────────
model = dict(
    meta=dict(
        generated_by=rel(__file__), note="모든 수치는 pctr_commute 모델 코드·결과 파일에서 계산/복사. 수치의 정본은 report/report.html.",
        units=dict(C0="kgCO2/버스-km (빈 차 1회)", CDH="kgCO2/버스-km (회송 1회)", CPAX="kgCO2/버스-km/승객",
                   CCAR="kgCO2/승용차 통근자 1인-km", t_year="tCO2/년(+는 감축, −는 증가)", km="km", T="분"),
        sources=dict(
            constants="pctr_commute/axis_model.py vehicle_constants() → breakeven.py (25 km 기준 시나리오)",
            constants_check="pctr_commute/result/capture_rate.json constants",
            fcev="pctr_commute/breakeven.py FCEV·CALIB['fcev'] (be_result4/breakeven_table.csv와 같은 계산)",
            axes="pctr_commute/result/axes_classified.csv (+ phi_proxy.json alpha_o, allocation.json alloc_ours)",
            axes_demand="axis_model.service_demand(), 후보 축 수요 = 노선 5개분(N_ROUTE_SLOTS)",
            origin_coords="resid/od_detail.csv (출발 행정동 5곳 주거 대표점, 인구가중 평균)",
            dest_coords="apimeasure/coords.json dest",
            routes="pctr_commute/easygbus_routes.csv, pctr/easygbus_lookup.json, result/phi_proxy_routes.csv, allocation.json alloc_base",
            route_coords="apimeasure/coords.json stops/routes",
            scenario_grid="pctr_commute/result/scenario_grid.json",
            montecarlo="pctr_commute/result/montecarlo.json, montecarlo_draws.npz",
            sensitivity="pctr_commute/result/sensitivity.json, sensitivity_combo.json",
            phi_proxy="pctr_commute/result/phi_proxy.json",
            capture_rate="pctr_commute/result/capture_rate.json",
            allocation="pctr_commute/result/allocation.json"),
        missing=dict(route_coords=missing_coords),
    ),
    constants=dict(
        WORKDAYS=m.WORKDAYS, AM_TRIPS=m.AM_TRIPS, MAX_TRIPS=m.MAX_TRIPS, R_DH=r0, CAR_OCC=occ0, BETA=m.BETA,
        COACH_KMPL=k0, COACH_CAP=m.COACH_CAP, LOAD=m.LOAD, PHI_MAX=m.PHI_MAX, DETOUR=m.DETOUR, ACCESS_DIRECT=m.ACCESS_DIRECT,
        PT_KM_SCALE=m.PT_KM_SCALE, N_ROUTE_SLOTS=m.N_ROUTE_SLOTS, KAPPA=m.KAPPA, BONUS=m.BONUS,
        TARGET_RIDE=m.TARGET_RIDE, TARGET_PHI=m.TARGET_PHI, ref_axis_km=25.0,
        car=dict(name=be.CAR.name, CCAR_occ1=CAR_TRIP, CCAR=CCAR, formula="CCAR(occ) = CCAR_occ1 / occ (재차인원으로 나누기만, 정확)"),
        diesel=dict(name=be.COACH.name, cap=m.COACH_CAP, kmpl=k0, C0=V["C0"], CDH=V["CDH"], CPAX=V["CPAX"], eta=V["eta"],
                    kmpl_range_source=[2.83, 4.0], affine_in_inv_kmpl=diesel_affine,
                    formula="X(kmpl) = A + B/kmpl (X = C0, CDH, CPAX). breakeven.calibrate가 η를 재보정한 결과와 기계 정밀도로 일치",
                    table=[{k: R(v, 8) for k, v in r.items()} for r in dtab]),
        fcev=dict(name=be.FCEV.name, cap=be.FCEV.capacity, kmpkg=28.0, h2_co2_per_kg=be.H2_CO2_PER_KG, C0=F0["C0"], CDH=F0["CDH"],
                  CPAX=F0["CPAX"], eta=F0["eta"], affine_in_inv_kmpkg=fcev_affine,
                  formula="X(kmpkg) ≈ A + B/kmpkg; 수소 배출계수 h2(kgCO2/kgH2)를 바꾸면 X × h2/9.2 (정확)",
                  table=[{k: R(v, 8) for k, v in r.items() if k != "CCAR"} for r in ftab]),
        breakeven_check={k: R(v, 4) for k, v in chk.items()},
        mstar=cap_rate["mstar"], phi_needed=cap_rate["phi_needed"],
        alpha_o={k: R(v, 4) for k, v in alpha_o.items()},
    ),
    model_base=dict(
        ours=dict(alloc=alloc_ours, trips=ev_ours["trips"], riders=R(ev_ours["riders"], 2), car_shift=R(ev_ours["car_shift"], 2),
                  t_year=R(ev_ours["t_year"], 2), N=44, phi=0.5),
        base=dict(alloc=alloc_base, trips=ev_base["trips"], riders=R(ev_base["riders"], 2), car_shift=R(ev_base["car_shift"], 2),
                  transit_shift=R(ev_base["riders"] - ev_base["car_shift"], 2), t_year=R(ev_base["t_year"], 2), N=19.5, phi=0.25),
        note="ours: 후보 9축 수요(D, φ) 모형에서 출근 50회 그리디(축당 15회 상한) / base: 현행 28개 노선에 현재 출근 운행 비율로 50회(최대잔여법). 퇴근 대칭 ×2, 245일",
    ),
    axes=axes,
    routes=route_rows,
    scenario_grid=scen,
    montecarlo=mc_out,
    sensitivity=dict(oneway=sens_out, pessimistic_combo=combo),
    phi_reference=dict(allocated_4=phi_proxy["allocated_4"]["phi_proxy"], existing_28=phi_proxy["existing_28"]["phi_proxy_route"],
                       existing_seoul=phi_proxy["existing_seoul"]["phi_proxy_route"],
                       existing_nonseoul=phi_proxy["existing_nonseoul"]["phi_proxy_route"], note=phi_proxy["note"]),
)
json.dump(model, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=float)
print("wrote", rel(OUT), f"{OUT.stat().st_size/1024:.0f} KB")
print("N* check", model["constants"]["breakeven_check"])
print("ours", model["model_base"]["ours"]); print("base", model["model_base"]["base"])
print("axis t", {k: round(v, 1) for k, v in axis_t.items()})
print("diesel affine", {k: (v["A"], v["B"], v["max_rel_resid"], v["proportional_max_rel_err_2p83_4p0"]) for k, v in diesel_affine.items()})
print("fcev affine", {k: (v["A"], v["B"], v["max_rel_resid"]) for k, v in fcev_affine.items()})
print("missing route coords", missing_coords)
