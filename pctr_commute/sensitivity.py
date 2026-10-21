"""axis_model 근거값 민감도: 하나씩 범위 끝값으로 바꿔 PCTR 기준 배분 vs 현행 방식 감축량 비교 (매번 수요 재보정)"""
import json
import axis_model as m

BASE = dict(THETA=m.THETA, TARGET_PHI=m.TARGET_PHI, TARGET_RIDE=m.TARGET_RIDE, R_DH=m.R_DH, MAX_TRIPS=m.MAX_TRIPS,
            DRT_WAIT=m.DRT_WAIT, COACH_KMPL=m.COACH_KMPL, COACH_CAP=m.COACH_CAP, VAN_KMPL=m.VAN_KMPL, PHI_MAX=m.PHI_MAX, DETOUR=m.DETOUR,
            ACCESS_DIRECT=m.ACCESS_DIRECT)
GRID = {
    "THETA": [0.05, 0.10, 0.15],
    "TARGET_PHI": [0.17, 0.25, 0.26],
    "TARGET_RIDE": [18.0, 19.5, 21.0],
    "R_DH": [0.5, 1.0],
    "MAX_TRIPS": [9, 15, 20],
    "DRT_WAIT": [5.6, 14.0, 16.5],
    "COACH_KMPL": [2.83, 3.49, 4.0],
    "COACH_CAP": [28, 41, 44, 45],
    "PHI_MAX": [0.4, 0.5, 0.6],
    "DETOUR": [0.85, 1.0, 1.15],
    "ACCESS_DIRECT": [7, 10, 15],
}


def run(**kw):
    for k, v in {**BASE, **kw}.items():
        setattr(m, k, v)
    return m.main(verbose=False)


rows = []
for p, vals in GRID.items():
    for v in vals:
        r = run(**{p: v})
        rows.append(dict(param=p, value=v, ours_t=round(r["ours"]["t_year"], 1), base_t=round(r["base"]["t_year"], 1),
                         ours_shift=round(r["ours"]["car_shift"]), base_shift=round(r["base"]["car_shift"]),
                         kappa=round(r["calib"]["KAPPA"], 3), bonus=round(r["calib"]["BONUS"], 1), axes=list(r["alloc_ours"].keys())))
        x = rows[-1]
        print(f"{p:13s} {v:>5} | 우리 {x['ours_t']:>7} t · 전환 {x['ours_shift']:>5} | 현행 {x['base_t']:>7} t · 전환 {x['base_shift']:>4} | κ {x['kappa']} 가산 {x['bonus']}분 | {len(x['axes'])}축")
json.dump(rows, open(m.ROOT / "result/sensitivity.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
run()
