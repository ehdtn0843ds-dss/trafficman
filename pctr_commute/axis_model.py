"""
축 단위 로짓 보정 → 분류 → 2030 증편 100회 배분

입력
  result/axes_all.csv                국민연금 통근 축 (≥1000명)
  result100/axes_all.csv             (≥100명, 현행 편하G 노선 비교용)
  census/gyeonggi_commute_mode_2020.csv  인구총조사 시군별 승용차 분담률·관측 PCTR
  pctr/pctr_lookup.json              카카오맵 웹 조회 (승용차: 평일 08:00 출발 예측, 대중교통: 조회 시점 최단)
  result100/easygbus_match.csv       편하G 노선-축 매칭

기호 (작업 보드와 동일)
  Q_od    축 통근자 수
  PCTR_od = T_transit / T_car
  P_car(o,d) = 1 / (1 + exp(−(α_o + β·ln PCTR_od)))
  α_o     출발지 보정값: Σ_d Q_od·P_car(o,d) = s_car30(o)·Σ_d Q_od 이 되도록 맞춤
  β       PCTR 영향 계수 (시군 단위 회귀 3.20)
  φ       버스 승객 중 원래 승용차 통근자 비율
  N*      손익분기 탑승인원
"""
import json, math, sys, warnings
warnings.filterwarnings('ignore')
from pathlib import Path
import numpy as np
import pandas as pd

BETA = 3.20
# ── 근거 기반 입력값 (출처는 작업 보드 '모델에 들어간 값' 표) ──────────────────────────────
R_DH = 1.0            # 회송: 편하G는 차량 1대가 출근 1회·퇴근 1회(경기도 편성표), 낮 공백 약 10시간 → 수익 운행 1회당 공차 1회
WORKDAYS = 245        # 2026년 평일(관공서 공휴일·노동절·제헌절 제외, 한국천문연구원 월력 + 2026 공휴일 지정)
THETA = 0.10          # 기존 대중교통 이용자 전환: TRL593 운행량 탄력성 0.4 기반 노선 단위 5~15%의 중앙값
DETOUR = 1.0          # 직행 차내시간/승용차 피크: 고속도로 버스전용차로로 승용차와 같거나 빠름(0.9~1.1)
ACCESS_DIRECT = 10    # 출발~승차 시간: 수도권 알뜰교통카드 실측 평균 9.55분(대기 포함, 274 m; 한국ITS학회논문지 22(3) 2023 표5) → 10분 (7–15)
MAX_TRIPS = 15        # 축당 상한: 노선당 피크 최대 3회(편하G 편성 최대값) × 주거지 5곳
DRT_WAIT = 14.0       # 똑버스 평균 대기: 도 평균 12.3분(2023) → 수원 운행로그 14.41분(수원시정연구원 2024)·광교 15.2분(2023.5–2025.10)·도 교통국 약 15분(2026.7) → 14분 (5.6–16.5)
DRT_KM = 4.0          # DRT 연계 1회 운행 거리: 수원 광교 똑버스 평균 이동 11.2분 × 20 km/h ≈ 3.7 km, 반경 3 km
DRT_V, WALK_V = 20.0, 4.5   # DRT 운행속도(수원 광교 반경 3 km·평균 이동 11.2분), 보행속도 km/h
TARGET_RIDE = 19.5    # 편하G(프리미엄) 2022년 연 322,133건 → 회당 18~21명
TARGET_PHI = 0.25     # 좌석·예약형 통근 서비스의 승용차 출신 비율: 경기 산단 공동통근버스 17%(경기연구원 2017), 수원 똑버스 21.3%(수원시정연구원 2024), 셔클 26.2% → 0.25 (0.17–0.26)
COACH_KMPL = 3.49     # 유니버스 디젤 45석: 공인연비 미공개 → 한국교통연구원 경유 전세버스 3.49 km/L (2.83–4.0)
VAN_KMPL = 8.0        # 쏠라티: 표시연비 대상 아님 → 실사용 약 8 km/L (6–10)
COACH_CAP = 44        # 직행 정원: 편하G 허용 좌석형 최대 44인승(의왕 노선 44인승 운행), 유니버스 차체 (민감도 28 우등·41·45 유니버스 기본)
PHI_MAX = 0.5         # φ 상한: 국내 최대 사례 GTX-A 승용차 이용자 전환율 50%(국토연구원 Brief 1036, 2025) 이하로 제한 (0.4–0.6)
LOAD = 1.0            # 새 회차 최대 탑승률(정원 대비). 만석 가정이 결과를 좌우하므로 민감도 0.7
CAR_OCC = 1.1         # 승용차 통근 재차인원 (KTDB 출근·등교 1.1, 전 목적 1.4 → 민감도 1.3)
PT_KM_SCALE = 1.0     # 평택→화성 축 길이 배율(목적지 대표점 민감도: 기아 화성공장 대신 가까운 업무지면 0.7)
PLAN_TRIPS = 100      # 2030 증편: 하루 84회 → 184회(경기도, 출퇴근 합산) → 출근 50회 + 퇴근 50회
AM_TRIPS = PLAN_TRIPS // 2
KAPPA, BONUS = None, None   # 보정값: 현행 편하G 탑승 실적과 φ에 맞춰 main()에서 역산

ROOT = Path(__file__).parent
_eg = ROOT / "pctr/easygbus_lookup.json"
EG_LOOK = {r["노선번호"]: r for r in json.load(open(_eg, encoding="utf-8"))} if _eg.exists() else {}


def vehicle_constants(d_km=25.0, drt_km=4.0):
    """breakeven.py 차량 모델에서 km당 CO₂ 상수 계산 (코치 직행, 승합 DRT, 승용차)"""
    import breakeven as be
    from dataclasses import replace as rp
    cal = {}
    for key, veh in [("car", be.CAR), ("coach", be.COACH), ("van", be.VAN)]:
        tgt, segs, _, aux = be.CALIB[key]
        if key == "coach" and COACH_KMPL: tgt = 1 / COACH_KMPL
        if key == "van" and VAN_KMPL: tgt = 1 / VAN_KMPL
        cv = be.calibrate(rp(veh, P_aux_kW=aux) if aux is not None else veh, segs, tgt)
        cal[key] = rp(cv, P_aux_kW=veh.P_aux_kW, capacity=COACH_CAP if key == "coach" else cv.capacity)
    out = {}
    for cls, key, mode, km in [("출퇴근 직행", "coach", "direct", d_km), ("DRT 연계", "van", "drt", drt_km)]:
        r = be.breakeven(cal[key], cal["car"], km, 45.0, 1.0, 1.0, R_DH, CAR_OCC, mode)
        out[cls] = dict(C0=r["C0"] / km, CDH=r["C_dh"] / km, CPAX=r["c_pax"] / km, CAP=cal[key].capacity, eta=cal[key].eta)
    rc = be.breakeven(cal["coach"], cal["car"], d_km, 45.0, 1.0, 1.0, R_DH, CAR_OCC, "direct")
    return out, rc["c_car"] / d_km


VEH, CCAR_KM = None, None


def logistic(x):
    return 1 / (1 + math.exp(-x))


def solve_alpha(q, lnp, target):
    lo, hi = -20.0, 20.0
    for _ in range(80):
        a = (lo + hi) / 2
        v = sum(qi * logistic(a + BETA * li) for qi, li in zip(q, lnp))
        lo, hi = (a, hi) if v < target else (lo, a)
    return (lo + hi) / 2


def calibrate(axes, census, lookup):
    """축별 P_car 계산. 조회한 축은 조회 PCTR, 나머지는 같은 출발지 조회값 평균(없으면 인구총조사 관측 PCTR)."""
    s30 = census.set_index("시군")["s_car_30"]; pobs = census.set_index("시군")["PCTR_obs"]
    lk = {(r["o"], r["d"]): r for r in lookup}
    axes = axes.copy()
    axes["d_label"] = np.where(axes["d_sido"] == "서울특별시", "서울 " + axes["d_sgg"], axes["d_sgg"])
    axes["PCTR"] = [lk[(o, d)]["PCTR"] if (o, d) in lk else np.nan for o, d in zip(axes["o_name"], axes["d_label"])]
    axes["looked"] = axes["PCTR"].notna()
    mean_lk = axes[axes.looked].groupby("o_name")["PCTR"].mean()
    axes["PCTR_used"] = axes["PCTR"].fillna(axes["o_name"].map(mean_lk)).fillna(axes["o_name"].map(pobs))
    alpha = {}
    for o, g in axes.groupby("o_name"):
        if o not in s30:
            continue
        alpha[o] = solve_alpha(g["Q_od"].tolist(), np.log(g["PCTR_used"]).tolist(), s30[o] * g["Q_od"].sum())
    axes["alpha"] = axes["o_name"].map(alpha)
    axes["P_car"] = [logistic(a + BETA * math.log(p)) for a, p in zip(axes["alpha"], axes["PCTR_used"])]
    axes["Q_car"] = axes["Q_od"] * axes["P_car"]
    return axes, alpha


def classify(r, qcar_min=3000):
    if r["Q_car"] < qcar_min:
        return "보류"
    if r["PCTR"] < 1.5:
        return "수요관리"
    walk_share = r["walk"] / r["T_transit"]
    if r["walk"] >= 20 or walk_share >= 0.30:
        return "DRT 연계"
    return "출퇴근 직행"


def service_demand(r, alpha, kappa=None, bonus=None):
    """새 노선 1개가 생겼을 때 하루 한 방향 수요 D와 승용차 전환 비율 φ.
    직행: 문전 시간 T_new = DETOUR·T_car + ACCESS, 좌석·무환승 효용을 시간으로 환산한 BONUS(분)만큼 유리
    DRT 연계: 출발지 쪽 도보(전체 도보의 절반)를 DRT 대기+탑승으로 바꾼 대중교통 시간"""
    kappa = KAPPA if kappa is None else kappa
    bonus = BONUS if bonus is None else bonus
    T_car, T_tr = r["T_car"], r["T_transit"]
    if r["class"] == "DRT 연계":
        w0 = r["walk"] / 2
        T_new = T_tr - w0 + DRT_WAIT + w0 * WALK_V / DRT_V
        T_eff = T_new
    else:
        T_new = DETOUR * T_car + ACCESS_DIRECT
        T_eff = T_new - bonus
    p_old = logistic(alpha + BETA * math.log(r["PCTR_used"]))
    p_new = logistic(alpha + BETA * math.log(max(T_eff / T_car, 0.3)))
    from_car = kappa * r["Q_od"] * max(p_old - p_new, 0)
    from_tr = kappa * r["Q_od"] * (1 - p_old) * THETA
    D = from_car + from_tr
    phi = min(from_car / D, PHI_MAX) if D > 0 else 0
    return D, phi, T_new


def daily_saving(n, c):
    """하루 n회(한 방향) 운행 시 순감축량 kg/일. 승용차는 축 전체 거리, 버스는 운행 거리만큼."""
    if n <= 0:
        return 0.0
    v = VEH[c["cls"]]
    riders = min(v["CAP"] * LOAD, c["D"] / n)
    bus_km = c["bus_km"]
    return n * (riders * c["phi"] * CCAR_KM * c["km"] - (v["C0"] * bus_km + riders * v["CPAX"] * bus_km) - R_DH * v["CDH"] * bus_km)


def nstar(phi, cls, car_km, bus_km):
    v = VEH[cls]
    den = phi * CCAR_KM * car_km - v["CPAX"] * bus_km
    return (v["C0"] + R_DH * v["CDH"]) * bus_km / den if den > 0 else math.inf


def greedy(cands, total=100):
    n = {k: 0 for k in cands}
    for _ in range(total):
        best, gain = None, 0.0
        for k, c in cands.items():
            if n[k] >= MAX_TRIPS:
                continue
            g = daily_saving(n[k] + 1, c) - daily_saving(n[k], c)
            if g > gain:
                best, gain = k, g
        if best is None:
            break
        n[best] += 1
    return n


def evaluate(alloc, cands):
    """증분 평가: 기존 운행 n0회에 alloc회를 더했을 때 늘어나는 감축량·탑승·전환"""
    n0 = lambda k: cands[k].get("n0", 0)
    kg = sum(daily_saving(n0(k) + alloc[k], cands[k]) - daily_saving(n0(k), cands[k]) for k in alloc)
    cap = lambda k: VEH[cands[k]["cls"]]["CAP"] * LOAD
    rid = lambda k, n: min(cands[k]["D"], n * cap(k))
    riders = sum(rid(k, n0(k) + alloc[k]) - rid(k, n0(k)) for k in alloc)
    car_shift = sum((rid(k, n0(k) + alloc[k]) - rid(k, n0(k))) * cands[k]["phi"] for k in alloc)
    # 퇴근은 같은 사람이 같은 축을 거꾸로 타는 대칭 운행 → 운행 수·CO₂는 2배, 이용자 수(사람)는 출근 기준
    return dict(trips=2 * sum(alloc.values()), riders=riders, car_shift=car_shift, kg_day=2 * kg, t_year=2 * kg * WORKDAYS / 1000)


N_ROUTE_SLOTS = 5     # 축마다 주거지 5곳 → 노선(또는 DRT 구역) 최대 5개


def base_routes(cal, alpha, eg):
    """현행 편하G 노선별 입력 (실측 정류장 간 시간)"""
    cal_idx = cal.set_index(["o_name", "d_sgg"])
    out = []
    for r in eg.itertuples(index=False):
        dsgg = r.도착_시군구
        key = next(((o, d) for (o, d) in cal_idx.index if o == r.시군 and d.replace(" ", "") == dsgg.replace(" ", "")), None)
        g = EG_LOOK.get(r.노선번호)
        if key is None or g is None:
            continue
        a = cal_idx.loc[key]
        if isinstance(a, pd.DataFrame):
            a = a.iloc[0]
        out.append(dict(id=r.노선번호, k=f"{r.시군}→{dsgg}", o=r.시군, alpha=alpha[r.시군], n_cur=int(r.편도운행회),
                        rr={"class": "출퇴근 직행", "T_car": g["T_car"], "T_transit": g["T_transit"], "walk": g["walk"],
                            "Q_od": a["Q_od"], "PCTR_used": g["T_transit"] / g["T_car"]}, km=g["car_km"]))
    return out


def base_stats(routes, kappa, bonus):
    cap = VEH["출퇴근 직행"]["CAP"]
    rid = car = trips = 0.0
    for b in routes:
        D, phi, _ = service_demand(b["rr"], b["alpha"], kappa, bonus)
        x = min(D, cap * b["n_cur"])
        rid += x; car += x * phi; trips += b["n_cur"]
    return rid / trips, (car / rid if rid else 0.0)


def calibrate_demand(routes):
    """φ는 κ와 무관 → BONUS로 φ를 맞추고, 그다음 κ로 회당 탑승을 맞춤"""
    lo, hi = -30.0, 60.0
    for _ in range(60):
        mid = (lo + hi) / 2
        _, ph = base_stats(routes, 0.1, mid)
        lo, hi = (mid, hi) if ph < TARGET_PHI else (lo, mid)
    bonus = (lo + hi) / 2
    lo, hi = 1e-4, 1.0
    for _ in range(60):
        mid = (lo + hi) / 2
        rd, _ = base_stats(routes, mid, bonus)
        lo, hi = (mid, hi) if rd < TARGET_RIDE else (lo, mid)
    return (lo + hi) / 2, bonus


def main(verbose=True):
    global VEH, CCAR_KM, KAPPA, BONUS
    VEH, CCAR_KM = vehicle_constants()
    axes100 = pd.read_csv(ROOT / "result100/axes_all.csv")
    census = pd.read_csv(ROOT / "census/gyeonggi_commute_mode_2020.csv")
    lookup = json.load(open(ROOT / "pctr/pctr_lookup.json", encoding="utf-8"))
    eg = pd.read_csv(ROOT / "easygbus_routes.csv")

    cal, alpha = calibrate(axes100, census, lookup)
    cal.to_csv(ROOT / "result/axes_calibrated.csv", index=False, encoding="utf-8-sig")

    routes = base_routes(cal, alpha, eg)
    KAPPA, BONUS = calibrate_demand(routes)
    ride_chk, phi_chk = base_stats(routes, KAPPA, BONUS)

    lk = pd.DataFrame(lookup)
    lk = lk.merge(cal[["o_name", "d_label", "Q_od", "Q_car", "P_car", "PCTR_used", "easygbus"]],
                  left_on=["o", "d"], right_on=["o_name", "d_label"], how="left")
    lk["class"] = lk.apply(classify, axis=1)
    rows = []
    for _, r in lk.iterrows():
        D, phi, T_new = service_demand(r, alpha[r["o"]])
        cls = r["class"] if r["class"] in VEH else "출퇴근 직행"
        bus_km = DRT_KM if cls == "DRT 연계" else r["car_km"]
        rows.append(dict(D=D, phi=phi, T_new=T_new, Nstar=nstar(phi, cls, r["car_km"], bus_km)))
    lk = pd.concat([lk, pd.DataFrame(rows)], axis=1)
    lk.to_csv(ROOT / "result/axes_classified.csv", index=False, encoding="utf-8-sig")

    # PCTR 기준 배분: 버스 처방 축, 축마다 노선 최대 5개(주거지 5곳) → 수요 5배, 상한 15회
    cands, svc = {}, {}
    for _, r in lk.iterrows():
        cls = r["class"]
        if cls not in ("DRT 연계", "출퇴근 직행"):
            continue
        k = f"{r.o}→{r.d}"
        opts = {}
        for c in (["DRT 연계", "출퇴근 직행"] if cls == "DRT 연계" else ["출퇴근 직행"]):
            rr = dict(r); rr["class"] = c
            D, phi, T_new = service_demand(rr, alpha[r["o"]])
            km = r["car_km"] * (PT_KM_SCALE if k == "평택시→화성시" else 1.0)
            opts[c] = dict(D=D * N_ROUTE_SLOTS, phi=phi, km=km, cls=c, bus_km=DRT_KM if c == "DRT 연계" else km, n0=0, T_new=T_new)
        best = max(opts, key=lambda c: daily_saving(MAX_TRIPS, opts[c]))
        cands[k] = opts[best]
        w0 = r["walk"] / 2
        svc[k] = dict(diag=cls, service=best, wait_star=round(w0 * (1 - WALK_V / DRT_V), 1) if cls == "DRT 연계" else None,
                      **{f"save15_{c}": round(daily_saving(MAX_TRIPS, o) * WORKDAYS / 1000, 1) for c, o in opts.items()},
                      **{f"phi_{c}": round(o["phi"], 3) for c, o in opts.items()})
    ours = greedy(cands, AM_TRIPS)

    # 현행 방식: 기존 노선 유형에 현재 출근 운행 비율대로 50회를 새 회차로 추가(n0=0).
    # 새 회차도 현행 노선과 같은 수요(보정된 κ·B, 회당 약 20명)를 얻는다고 가정
    base_c, w = {}, {}
    for b in routes:
        D, phi, _ = service_demand(b["rr"], b["alpha"])
        base_c[b["id"]] = dict(D=D, phi=phi, km=b["km"], cls="출퇴근 직행", bus_km=b["km"], n0=0, k=b["k"])
        w[b["id"]] = b["n_cur"]
    tot = sum(w.values())
    raw = {k: AM_TRIPS * v / tot for k, v in w.items()}
    base = {k: int(v) for k, v in raw.items()}
    for k in sorted(raw, key=lambda k: -(raw[k] - int(raw[k])))[: AM_TRIPS - sum(base.values())]:
        base[k] += 1

    res = dict(ours=evaluate(ours, cands), base=evaluate(base, base_c),
               alloc_ours={k: v for k, v in sorted(ours.items(), key=lambda x: -x[1]) if v > 0},
               alloc_base=base, service=svc,
               calib=dict(KAPPA=KAPPA, BONUS=BONUS, ride_check=ride_chk, phi_check=phi_chk, n_routes=len(routes)),
               veh={k: {kk: round(vv, 4) for kk, vv in v.items()} for k, v in VEH.items()}, CCAR_KM=CCAR_KM,
               params=dict(THETA=THETA, ACCESS=ACCESS_DIRECT, DETOUR=DETOUR, R=R_DH, BETA=BETA, DRT_KM=DRT_KM,
                           MAX_TRIPS=MAX_TRIPS, DRT_WAIT=DRT_WAIT, WORKDAYS=WORKDAYS, TARGET_RIDE=TARGET_RIDE,
                           TARGET_PHI=TARGET_PHI, PLAN_TRIPS=PLAN_TRIPS, LOAD=LOAD, CAR_OCC=CAR_OCC, PT_KM_SCALE=PT_KM_SCALE, COACH_KMPL=COACH_KMPL, COACH_CAP=COACH_CAP, VAN_KMPL=VAN_KMPL, PHI_MAX=PHI_MAX))
    json.dump(res, open(ROOT / "result/allocation.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2, default=float)
    if verbose:
        pd.set_option("display.width", 220)
        print(lk[["o", "d", "Q_od", "Q_car", "PCTR", "walk", "class", "T_new", "D", "phi", "Nstar"]].round(2).to_string(index=False))
        print("보정:", res["calib"]); print("차량:", res["veh"], "c_car/km", round(CCAR_KM, 4))
        print(json.dumps({k: res[k] for k in ("ours", "base")}, ensure_ascii=False, default=float, indent=1))
        print("우리 배분:", res["alloc_ours"])
        for k, v in svc.items(): print("  ", k, v)
    return res


if __name__ == "__main__":
    main()
