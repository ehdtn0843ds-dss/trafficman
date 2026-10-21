"""B. 필요 포착률: 손익분기를 넘기려면 축의 승용차 통근자 중 몇 명을 버스로 옮겨야 하나
m*(N) = (C0 + R_DH·C_dh + N·c_pax) / c_car   (km당 상수 → 축 길이와 무관, axis_model VEH·CCAR_KM)
하루 필요 승용차 출신 승객 = 출근 회차 × m*  (퇴근은 같은 사람이 되돌아오므로 사람 수는 출근 기준)
포착률 = 필요 인원 / Q_car(축 승용차 통근자), / Q_od(축 통근자)
Q_od는 국민연금 사업장 가입자 기준(공무원·자영업 등 제외)이라 실제 통근자보다 작다 → 포착률은 위쪽(보수적) 값.
출력: result/capture_rate.json"""
import json
import pandas as pd
import axis_model as m
from improve_common import setup, p_car, corridor_row

S = setup()
res, cal, alpha, lk = S["res"], S["cal"], S["alpha"], S["lk"]
V, CC = m.VEH["출퇴근 직행"], m.CCAR_KM
mstar = lambda N: (V["C0"] + m.R_DH * V["CDH"] + N * V["CPAX"]) / CC
NS = (44, 30)

rows = []
for k, n in res["alloc_ours"].items():
    o, d = k.split("→")
    r = lk[(lk.o == o) & (lk.d == d)].iloc[0]
    x = dict(axis=k, trips_am=n, Q_od=int(r.Q_od), Q_car=round(r.Q_car), phi_proxy=round(r.P_car, 3))
    for N in NS:
        need = n * mstar(N)
        x.update({f"mstar_{N}": round(mstar(N), 2), f"phi_needed_{N}": round(mstar(N) / N, 3), f"need_car_riders_{N}": round(need, 1),
                  f"share_of_Qcar_{N}_pct": round(100 * need / r.Q_car, 2), f"share_of_Qod_{N}_pct": round(100 * need / r.Q_od, 2),
                  f"riders_total_{N}": n * N, f"riders_share_of_Qod_{N}_pct": round(100 * n * N / r.Q_od, 2)})
    rows.append(x)
ours = pd.DataFrame(rows)
qcar4, qod4, trips4 = ours.Q_car.sum(), ours.Q_od.sum(), ours.trips_am.sum()
ours_tot = dict(trips_am=int(trips4), Q_od=int(qod4), Q_car=int(qcar4))
for N in NS:
    need = trips4 * mstar(N)
    ours_tot.update({f"need_car_riders_{N}": round(need, 1), f"share_of_Qcar_{N}_pct": round(100 * need / qcar4, 2),
                     f"share_of_Qod_{N}_pct": round(100 * need / qod4, 2)})

# 현행 방식: 28개 노선에 50회를 현재 운행 비율로 → 각 노선이 m*를 넘기려면
NB = (19.5, 30, 44)
brow = []
for b in S["routes"]:
    n = res["alloc_base"].get(b["id"], 0)
    c = corridor_row(cal, b["o"], b["k"].split("→")[1])
    brow.append(dict(id=b["id"], route=b["k"], corridor=(b["o"], c["d_sgg"]), trips_am=n, Q_od=int(c["Q_od"]),
                     Q_car_corridor=float(c["Q_car"]), Q_car_routePCTR=float(c["Q_od"] * p_car(b["alpha"], b["rr"]["PCTR_used"]))))
base = pd.DataFrame(brow)
uniq = base.drop_duplicates("corridor")          # 같은 축을 여러 노선이 공유(예: 양주→서초 2개) → 수요는 한 번만 셈
trips_b = int(base.trips_am.sum())
base_tot = dict(trips_am=trips_b, n_routes=len(base), n_corridors=len(uniq), Q_od=int(uniq.Q_od.sum()),
                Q_car_corridor=round(uniq.Q_car_corridor.sum()), Q_car_routePCTR=round(uniq.Q_car_routePCTR.sum()))
for N in NB:
    need = trips_b * mstar(N)
    base_tot.update({f"mstar_{N}": round(mstar(N), 2), f"phi_needed_{N}": round(mstar(N) / N, 3), f"need_car_riders_{N}": round(need, 1),
                     f"share_of_Qcar_corridor_{N}_pct": round(100 * need / uniq.Q_car_corridor.sum(), 2),
                     f"share_of_Qcar_routePCTR_{N}_pct": round(100 * need / uniq.Q_car_routePCTR.sum(), 2),
                     f"share_of_Qod_{N}_pct": round(100 * need / uniq.Q_od.sum(), 2)})
# 노선별(축 단위로 합산): 가장 빡빡한 축
by_cor = base.groupby("corridor").agg(trips_am=("trips_am", "sum"), Q_od=("Q_od", "first"), Q_car_corridor=("Q_car_corridor", "first"),
                                      Q_car_routePCTR=("Q_car_routePCTR", "mean"), routes=("id", lambda s: ",".join(s))).reset_index()
by_cor["need_car_riders_19.5"] = by_cor.trips_am * mstar(19.5)
by_cor["share_of_Qcar_routePCTR_19.5_pct"] = 100 * by_cor["need_car_riders_19.5"] / by_cor.Q_car_routePCTR
by_cor["share_of_Qod_19.5_pct"] = 100 * by_cor["need_car_riders_19.5"] / by_cor.Q_od
by_cor["corridor"] = by_cor.corridor.map(lambda t: f"{t[0]}→{t[1]}")
by_cor = by_cor.sort_values("share_of_Qod_19.5_pct", ascending=False).round(2)

out = dict(
    formula="m*(N) = (C0 + R_DH·C_dh + N·c_pax)/c_car, km당 상수(축 길이 무관). 필요 승용차 출신 승객/일 = 출근 회차 × m*. 퇴근은 같은 사람이라 사람 수는 출근 기준.",
    constants=dict(C0=V["C0"], CDH=V["CDH"], CPAX=V["CPAX"], CCAR_KM=CC, R_DH=m.R_DH, CAR_OCC=m.CAR_OCC, COACH_KMPL=m.COACH_KMPL),
    mstar={str(N): round(mstar(N), 2) for N in (19.5, 20, 30, 44)},
    phi_needed={str(N): round(mstar(N) / N, 3) for N in (19.5, 20, 30, 44)},
    pctr_arm=dict(axes=ours.to_dict("records"), total=ours_tot),
    base_arm=dict(total=base_tot, by_corridor=by_cor.to_dict("records")),
    caveats=["Q_od는 국민연금 사업장 가입자 기준이라 실제 통근자보다 작다 → 포착률은 보수적(큰) 값",
             "현행 노선 Q_car_corridor는 축 PCTR이 대부분 대체값(출발지 평균/인구총조사)인 P_car로 계산 → Q_car_routePCTR(노선 실측 PCTR로 P_car)를 함께 제시",
             "포착률이 작다는 것은 '수요 풀은 충분하다'는 뜻일 뿐, 그만큼이 실제로 버스로 옮길지는 φ·탑승 가정의 문제"],
)
json.dump(out, open(m.ROOT / "result/capture_rate.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=float)

if __name__ == "__main__":
    pd.set_option("display.width", 250)
    print("m*:", out["mstar"], "필요 φ:", out["phi_needed"])
    print(ours.to_string(index=False)); print("4축 합계", ours_tot)
    print("현행 합계", base_tot)
    print(by_cor.head(8).to_string(index=False))
