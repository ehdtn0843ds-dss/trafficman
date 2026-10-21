"""
탄소 손익분기 탑승인원 모델 (엔진맵 없이 윌런스 선 + 공인 연비/전비 보정)

차량 종방향 동역학 (기호는 보고서 전체에서 동일하게 사용)
  F(t) = m(1+δ)·a(t) + m·g·C_rr·cosγ + m·g·sinγ   (γ: 도로 경사각) + ½·ρ·C_d·A·v(t)²
  P_w(t) = F(t)·v(t)                                   [W] 바퀴 출력

에너지 변환 (엔진맵 대체)
  내연기관(윌런스 선): P_f = P_idle + (max(P_w,0) + P_aux) / η
  전기·수소:           P_b = P_aux + P_w/η_d   (P_w > 0, 수소는 P_b를 저위발열량 120 MJ/kg으로 나눠 kg H₂)
                       P_b = P_aux + η_r·P_w   (P_w ≤ 0, 회생제동)
  η(또는 η_d)는 차종별 공인 연비·인증 전비에 맞춰 역산 → 역산값이 물리적 범위에 드는지로 검증

손익분기
  C_bus(N)  = C_0 + N·c_pax          버스 1회 운행 CO₂ (N: 탑승인원)
  C_dh      = 회송 1회 CO₂ (빈 차)
  c_car     = 승용차 통근 1인 CO₂ = 승용차 1회 CO₂ / 재차인원 o
  φ         = 버스 승객 중 원래 승용차로 통근하던 비율 (전환율)
  순감축 ΔC(N) = N·φ·c_car − C_bus(N) − r·C_dh       (r: 회송 비율, 편도 운행이면 1)
  N* = (C_0 + r·C_dh) / (φ·c_car − c_pax)

실행: python breakeven.py --out be_result
"""

import argparse
import json
from dataclasses import dataclass, replace, asdict
from pathlib import Path

import numpy as np

G, RHO, DT = 9.81, 1.2, 0.5
PAX_KG, DRIVER_KG = 70.0, 75.0

# 연료별 CO₂ (tank-to-wheel, CO₂만). 에너지법 시행규칙 순발열량(휘발유 30.1, 경유 35.3 MJ/L)
# × 국가고유 탄소배출계수(휘발유 19.731, 경유 20.090 tC/TJ) × 44/12
MJ_PER_L = {"gasoline": 30.1, "diesel": 35.3}
MJ_PER_KG_H2 = 120.0                                      # 수소 저위발열량 120 MJ/kg (33.3 kWh/kg)
H2_CO2_PER_KG = 9.2                                       # 천연가스 개질 수소 9.2 kgCO2/kgH2 (IPCC 2019 기본값, 에너지공단 EG-TIPS). 범위 0(부생)–10.3
CO2_PER_L = {"gasoline": 30.1 * 19.731 * 44 / 12 / 1000, "diesel": 35.3 * 20.090 * 44 / 12 / 1000}  # 2.18, 2.60 kg/L
GRID_KG_PER_KWH = 0.4173                                 # 2023 국가 전력배출계수(소비단), 2025-12 확정


@dataclass
class Vehicle:
    name: str
    m_empty: float          # kg
    Cd: float
    A: float                # m²
    Crr: float
    delta: float            # 회전관성 계수
    fuel: str               # gasoline / diesel / electric
    idle_L_per_h: float = 0.0
    P_aux_kW: float = 0.0
    eta: float = 0.35       # 내연: 한계효율 / 전기: 구동효율 η_d (보정으로 덮어씀)
    eta_regen: float = 0.6  # 전기만
    capacity: int = 1
    a_acc: float = 1.0      # m/s²
    a_dec: float = 1.2


# ---------- 주행 프로파일 ----------
def link(dist_m, v_kmh, a_acc, a_dec, dwell_s=0.0, grade=0.0):
    """정차-정차 한 구간: 가속-정속-감속(거리가 짧으면 삼각형) + 정차 대기"""
    v = v_kmh / 3.6
    d_acc, d_dec = v * v / (2 * a_acc), v * v / (2 * a_dec)
    if d_acc + d_dec > dist_m:
        v = np.sqrt(2 * dist_m * a_acc * a_dec / (a_acc + a_dec))
        d_acc, d_dec = v * v / (2 * a_acc), v * v / (2 * a_dec)
    t_acc, t_dec = v / a_acc, v / a_dec
    t_cru = (dist_m - d_acc - d_dec) / v if v > 0 else 0.0
    t = np.arange(0, t_acc + t_cru + t_dec, DT)
    vt = np.where(t < t_acc, a_acc * t,
         np.where(t < t_acc + t_cru, v, np.maximum(v - a_dec * (t - t_acc - t_cru), 0)))
    vt = np.append(vt, np.zeros(int(dwell_s / DT)))
    return vt, np.full(vt.shape, grade)


def segment(dist_km, v_kmh, n_stops, dwell_s, grade=0.0, *, veh):
    """구간을 n_stops+1 개 링크로 나눔 (n_stops: 구간 내 정차·가다서다 횟수)"""
    n = max(n_stops, 0) + 1
    vs, gs = [], []
    for i in range(n):
        dw = dwell_s if i < n - 1 else 0.0
        v, g = link(dist_km * 1000 / n, v_kmh, veh.a_acc, veh.a_dec, dw, grade)
        vs.append(v); gs.append(g)
    return np.concatenate(vs), np.concatenate(gs)


def build(segs, veh):
    parts = [segment(*s, veh=veh) for s in segs]
    return np.concatenate([p[0] for p in parts]), np.concatenate([p[1] for p in parts])


# ---------- 에너지 ----------
def energy(veh, v, grade, load_kg=0.0):
    """반환: (연료 L 또는 배터리 kWh, 주행거리 km)"""
    m = veh.m_empty + DRIVER_KG + load_kg
    a = np.gradient(v, DT)
    th = np.arctan(grade)
    F = m * (1 + veh.delta) * a + m * G * veh.Crr * np.cos(th) + m * G * np.sin(th) + 0.5 * RHO * veh.Cd * veh.A * v ** 2
    Pw = F * v
    km = v.sum() * DT / 1000
    aux = veh.P_aux_kW * 1000
    if veh.fuel in ("electric", "hydrogen"):
        Pb = aux + np.where(Pw > 0, Pw / veh.eta, Pw * veh.eta_regen)
        if veh.fuel == "hydrogen":   # η = 탱크→바퀴 효율(연료전지+구동), 회생은 배터리로 흡수
            Pb = np.maximum(Pb, 0)
            return Pb.sum() * DT / (MJ_PER_KG_H2 * 1e6), km
        return Pb.sum() * DT / 3.6e6, km
    P_idle = veh.idle_L_per_h * MJ_PER_L[veh.fuel] * 1e6 / 3600
    Pf = P_idle + (np.maximum(Pw, 0) + aux) / veh.eta
    return Pf.sum() * DT / (MJ_PER_L[veh.fuel] * 1e6), km


def co2_kg(veh, qty):
    if veh.fuel == "electric":
        return qty * GRID_KG_PER_KWH
    if veh.fuel == "hydrogen":
        return qty * H2_CO2_PER_KG
    return qty * CO2_PER_L[veh.fuel]


def calibrate(veh, segs, target_per_km, load_kg=0.0):
    """target_per_km: 내연 L/km, 전기 kWh/km 가 되도록 η 이분법 역산"""
    v, g = build(segs, veh)
    lo, hi = 0.05, 0.99
    for _ in range(60):
        mid = (lo + hi) / 2
        q, km = energy(replace(veh, eta=mid), v, g, load_kg)
        lo, hi = (mid, hi) if q / km > target_per_km else (lo, mid)
    return replace(veh, eta=(lo + hi) / 2)


# ---------- 차종: 치수·정원은 현대차 공식 제원(2026 카탈로그·가격표), 전면면적 = 전폭×전고×0.9 (버스), ×0.84 (승용) ----------
# 승용: 쏘나타 디 엣지 2.0 가솔린 17인치, 공차 1,475 kg, 4,910×1,860×1,445 mm, Cd 0.27(DN8 현대 발표)
CAR = Vehicle("쏘나타 2.0 가솔린", 1475, 0.27, 1.860 * 1.445 * 0.84, 0.010, 0.05, "gasoline",
              idle_L_per_h=0.8, P_aux_kW=0.8, capacity=5, a_acc=1.5, a_dec=1.5)
# 직행: 유니버스 디젤(엘레강스/프라임, 12.7 L 440 PS), 2,495×3,370 mm. 정원은 편하G 허용 좌석형 최대 44석
#       공차중량은 공식 미공개 → 등록증 총중량 15,140 kg − 정원 47×65 kg ≈ 12,085, 수출형 11,975 kg → 12,000 kg
COACH = Vehicle("유니버스 디젤(44석)", 12000, 0.65, 2.495 * 3.370 * 0.9, 0.0065, 0.08, "diesel",
                idle_L_per_h=2.5, P_aux_kW=6.0, capacity=44, a_acc=0.8, a_dec=1.0)
# 무공해: 유니버스 수소전기버스 광역 45인승(44+1), 2,495×3,740 mm, 연료전지 180 kW, 모터 350 kW.
#        공차중량 미공개 → 같은 연료전지 시스템의 일렉시티 FCEV 실측 12,640 kg(KSAE 2024)
FCEV = Vehicle("유니버스 수소버스(45인승)", 12640, 0.65, 2.495 * 3.740 * 0.9, 0.0065, 0.08, "hydrogen",
               P_aux_kW=6.0, eta=0.45, eta_regen=0.6, capacity=44, a_acc=0.8, a_dec=1.0)
# DRT: 쏠라티(2.5 CRDi 170 PS), 2,038×2,665 mm, 총중량 4,100 kg. 똑버스 13인승.
#      공차중량 국내 미공개 → 현대 독일 H350 Bus 기술자료 2,662 kg(운전자 75 kg 포함) − 75 = 2,587 kg
VAN = Vehicle("쏠라티 DRT(13인승)", 2587, 0.38, 2.038 * 2.665 * 0.9, 0.008, 0.06, "diesel",
              idle_L_per_h=1.2, P_aux_kW=2.0, capacity=13, a_acc=1.0, a_dec=1.2)

# 보정 기준 (target, 보정 프로파일). (dist_km, v_kmh, n_stops, dwell_s, grade)
MIXED = [(11, 40, 27, 20, 0.0), (9, 90, 0, 0, 0.0)]           # 도심 55% + 고속 45%
# 네 번째 값: 보정 시 보조전력(kW). 인증 시험은 냉난방을 끄므로 전기버스는 1.5 kW로 보정하고 운행 때 6 kW로 되돌림
CALIB = {
    "car":   (1 / 12.6, MIXED, "쏘나타 2.0 가솔린 공인 복합 12.6 km/L", None),
    # 직행(유니버스 디젤): 현대 공인연비 미공개(카탈로그·에너지공단 표시연비 DB 모두 없음) →
    #       한국교통연구원 자료의 경유 전세버스(장거리) 3.49 km/L (가스신문 2022-11-18 인용). 범위: 국내 버스 DTG 2.83 – 고속 4.0
    "coach": (1 / 3.49, [(6, 40, 6, 20, 0.0), (14, 90, 0, 0, 0.0)], "경유 전세버스 3.49 km/L (한국교통연구원, 2.83–4.0)", None),
    # 무공해(유니버스 수소버스): 현대 공식 28.0 km/kg (환경부 에너지소비율, KS R 1135 실도로 정속 약 73 km/h, 냉난방 끔)
    "fcev":  (1 / 28.0, [(42, 73, 0, 0, 0.0)], "유니버스 수소버스 공식 28.0 km/kg (정속 73 km/h, 보조 1.5 kW)", 1.5),
    # DRT(쏠라티): 국내 표시연비 대상 아님(총중량 4.1 t, 에너지공단 DB 0건). 같은 차의 현대 독일 NEDC 인증값(7.8–8.5 L/100km)은
    #       시험 부하가 가벼워 이 모형에서 η = 0.58(타당 범위 밖) → 실사용 보고값 약 8 km/L(국내 전언, H350 혼합 실주행 8.3 km/L)로 보정 (6–10)
    "van":   (1 / 8.0, MIXED, "쏠라티 실사용 약 8 km/L (6–10)", None),
}
PLAUSIBLE = {"gasoline": (0.22, 0.40), "diesel": (0.28, 0.45), "electric": (0.75, 0.95), "hydrogen": (0.35, 0.60)}


def axis_profiles(d_km, v_trunk, cong_per_km, mode):
    """통근 축 하나의 주행 시나리오.
    d_km: 축 길이, v_trunk: 출근 피크 간선 속도, cong_per_km: 간선의 가다서다 횟수/km"""
    trunk = max(d_km - 5, 1)
    nc = int(round(cong_per_km * trunk))
    if mode == "direct":   # 출발 생활권 3 km 4정류장 → 간선 → 도착 2 km 2정류장
        return [(3, 40, 4, 30, 0), (trunk, v_trunk, nc, 5, 0), (2, 35, 2, 30, 0)]
    if mode == "drt":      # 생활권 내 1 km마다 승하차
        return [(d_km, 35, int(d_km), 25, 0)]
    if mode == "car":      # 도심 신호 1 km마다 1회 정지
        return [(3, 45, 3, 25, 0), (trunk, v_trunk, nc, 5, 0), (2, 40, 2, 25, 0)]
    if mode == "deadhead":  # 역방향 회송: 비첨두, 무정차
        return [(d_km, 70, 2, 0, 0)]
    raise ValueError(mode)


def breakeven(bus, car, d_km, v_trunk, cong, phi, r, occ, bus_mode="direct"):
    vb, gb = build(axis_profiles(d_km, v_trunk, cong, bus_mode), bus)
    q0, _ = energy(bus, vb, gb, 0)
    qf, _ = energy(bus, vb, gb, bus.capacity * PAX_KG)
    C0, c_pax = co2_kg(bus, q0), (co2_kg(bus, qf) - co2_kg(bus, q0)) / bus.capacity
    vd, gd = build(axis_profiles(d_km, v_trunk, cong, "deadhead"), bus)
    C_dh = co2_kg(bus, energy(bus, vd, gd, 0)[0])
    vc, gc = build(axis_profiles(d_km, v_trunk, cong, "car"), car)
    C_car_trip = co2_kg(car, energy(car, vc, gc, 0)[0])
    c_car = C_car_trip / occ
    denom = phi * c_car - c_pax
    N_star = (C0 + r * C_dh) / denom if denom > 0 else np.inf
    return dict(C0=C0, c_pax=c_pax, C_dh=C_dh, C_car_trip=C_car_trip, c_car=c_car, N_star=N_star)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="be_result")
    ap.add_argument("--d", type=float, default=25.0, help="기준 축 길이 km")
    ap.add_argument("--v-trunk", type=float, default=45.0, help="출근 피크 간선 속도 km/h")
    ap.add_argument("--cong", type=float, default=1.0, help="간선 가다서다 횟수/km")
    ap.add_argument("--occ", type=float, default=1.1, help="승용차 재차인원")
    a = ap.parse_args()
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)

    # 1) 보정
    cal = {}
    for key, veh in [("car", CAR), ("coach", COACH), ("fcev", FCEV), ("van", VAN)]:
        tgt, segs, src, aux_cal = CALIB[key]
        cv = calibrate(replace(veh, P_aux_kW=aux_cal) if aux_cal is not None else veh, segs, tgt)
        cv = replace(cv, P_aux_kW=veh.P_aux_kW)
        lo, hi = PLAUSIBLE[cv.fuel]
        cal[key] = cv
        print(f"[보정] {cv.name:<16} η = {cv.eta:.3f}  (타당 범위 {lo}–{hi}: {'OK' if lo <= cv.eta <= hi else '범위 밖'})  기준: {src}")

    # 2) 기준 시나리오 손익분기
    rows = []
    for bus_key, mode in [("coach", "direct"), ("fcev", "direct"), ("van", "drt")]:
        for r in (1.0, 0.5, 0.0):
            for phi in (1.0, 0.7, 0.5, 0.3):
                res = breakeven(cal[bus_key], cal["car"], a.d, a.v_trunk, a.cong, phi, r, a.occ, mode)
                rows.append(dict(bus=cal[bus_key].name, mode=mode, r=r, phi=phi, capacity=cal[bus_key].capacity,
                                 **{k: round(float(v), 3) for k, v in res.items()}))
    import csv
    with open(out / "breakeven_table.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)

    print(f"\n[기준 축] 길이 {a.d} km, 피크 간선 {a.v_trunk} km/h, 가다서다 {a.cong}회/km, 재차인원 {a.occ}")
    print(f"{'차종':<18}{'회송r':>6}{'전환율φ':>8}{'N*':>8}{'정원':>6}")
    for x in rows:
        ns = "불가" if not np.isfinite(x["N_star"]) else f"{x['N_star']:.1f}"
        flag = "  ← 정원 초과" if np.isfinite(x["N_star"]) and x["N_star"] > x["capacity"] else ""
        print(f"{x['bus']:<18}{x['r']:>6.1f}{x['phi']:>8.1f}{ns:>8}{x['capacity']:>6}{flag}")

    # 3) 그림: 운행 1회 순감축량 ΔC(N)
    import matplotlib; matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import koreanize_matplotlib  # noqa: F401
    base = breakeven(cal["coach"], cal["car"], a.d, a.v_trunk, a.cong, 1.0, 1.0, a.occ)
    N = np.arange(0, cal["coach"].capacity + 1)
    fig, ax = plt.subplots(figsize=(7.2, 4.4), dpi=150)
    for phi, ls in [(1.0, "-"), (0.7, "--"), (0.5, "-."), (0.3, ":")]:
        dC = N * phi * base["c_car"] - (base["C0"] + N * base["c_pax"]) - 1.0 * base["C_dh"]
        ax.plot(N, dC, ls, color="#c8372d", lw=1.8, label=f"φ = {phi}")
    ax.axhline(0, color="#16202e", lw=0.8)
    ax.set_xlabel("버스 1회 탑승인원 N (명)"); ax.set_ylabel("운행 1회 순감축량 ΔC (kg CO₂)")
    ax.set_title(f"{cal['coach'].name}, 회송 포함(r=1), 축 길이 {a.d:.0f} km", fontsize=10)
    ax.grid(alpha=0.25); ax.legend(title="승용차 전환율", fontsize=8, title_fontsize=8, frameon=False)
    fig.tight_layout(); fig.savefig(out / "breakeven_curve.png"); plt.close(fig)

    # 4) 민감도: N* vs 축 길이 × 전환율 (디젤 직행, 회송 포함)
    ds = np.arange(10, 61, 5); phis = np.linspace(0.2, 1.0, 9)
    grid = np.array([[breakeven(cal["coach"], cal["car"], d, a.v_trunk, a.cong, p, 1.0, a.occ)["N_star"] for d in ds] for p in phis])
    np.savetxt(out / "nstar_grid.csv", grid, delimiter=",", fmt="%.2f",
               header="rows=phi " + " ".join(f"{p:.1f}" for p in phis) + " | cols=d_km " + " ".join(str(d) for d in ds))
    json.dump({k: asdict(v) for k, v in cal.items()}, open(out / "calibrated_vehicles.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print("\n[민감도] N* (디젤 직행, 회송 포함): 행=φ, 열=축 길이 km")
    print("φ\\d  " + "".join(f"{d:>6}" for d in ds))
    for p, row in zip(phis, grid):
        print(f"{p:4.1f} " + "".join(f"{x:6.1f}" if np.isfinite(x) else "   불가" for x in row))


if __name__ == "__main__":
    main()
