"""시나리오 표: 회당 탑승 인원 × 승용차 출신 비율 φ 를 직접 정했을 때 연간 순감축(t CO₂)
수요 모형 대신 두 값을 가정으로 두고, PCTR 기준 배분(축·회차 고정)과 현행 방식 배분을 같은 조건으로 비교한다.
손익분기 '회당 승용차 출신 승객' m* = (C0 + r·C_dh) / c_car + N·c_pax / c_car  (km당 상수, 축 길이와 무관)"""
import json
import axis_model as m

res = m.main(verbose=False)
V, CC = m.VEH["출퇴근 직행"], m.CCAR_KM
cap = {}
orig = m.greedy
def g(c, t):
    cap["c"] = c; return orig(c, t)
m.greedy = g; m.main(verbose=False); m.greedy = orig
ours = {k: (n, cap["c"][k]["km"]) for k, n in res["alloc_ours"].items()}
eg = {b["id"]: b for b in m.base_routes(*m.calibrate(__import__("pandas").read_csv(m.ROOT / "result100/axes_all.csv"),
                                                    __import__("pandas").read_csv(m.ROOT / "census/gyeonggi_commute_mode_2020.csv"),
                                                    json.load(open(m.ROOT / "pctr/pctr_lookup.json", encoding="utf-8"))),
                                         __import__("pandas").read_csv(m.ROOT / "easygbus_routes.csv"))}
base = {k: (n, eg[k]["km"]) for k, n in res["alloc_base"].items() if n > 0}

def t_year(alloc, N, phi):
    kg = sum(n * km * (N * phi * CC - V["C0"] - N * V["CPAX"] - m.R_DH * V["CDH"]) for n, km in alloc.values())
    return round(2 * kg * m.WORKDAYS / 1000)          # 퇴근 대칭 ×2

mstar = lambda N: round((V["C0"] + m.R_DH * V["CDH"] + N * V["CPAX"]) / CC, 1)
grid = []
for N in (20, 30, 44):
    for phi in (0.25, 0.35, 0.5):
        grid.append(dict(N=N, phi=phi, car_riders=round(N * phi, 1), ours_t=t_year(ours, N, phi), base_t=t_year(base, N, phi)))
out = dict(mstar_44=mstar(44), mstar_20=mstar(20), ours_km=round(sum(n * km for n, km in ours.values()) / sum(n for n, _ in ours.values()), 1),
           base_km=round(sum(n * km for n, km in base.values()) / sum(n for n, _ in base.values()), 1), grid=grid,
           model_base=dict(ours=(44, 0.5), base=(19.5, 0.25)))
json.dump(out, open(m.ROOT / "result/scenario_grid.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(json.dumps(out, ensure_ascii=False, indent=1))
