"""A. φ 참고값(비례 추출 φ): 버스 승객이 그 축의 현재 통근 수단 구성 그대로 뽑힌다면 φ = P_car(o,d)
P_car(o,d) = 1 / (1 + exp(−(α_o + β·ln PCTR_od)))  (axis_model 보정값 α_o, β 그대로)

대상
  · 버스 처방 후보 9축 (분류 'DRT 연계' 또는 '출퇴근 직행'), 그중 PCTR 기준 배분에 들어간 4축
  · 현행 편하G 28개 노선: 노선 실측 정류장 간 T_car·T_transit로 만든 노선 PCTR과, 같은 출발 시군→도착 시군구 축(corridor)의 PCTR 둘 다
주의: 프록시다. 좌석·예약형 버스는 보통 기존 대중교통 이용자를 더 많이 끌어오므로(경기 산단 공동통근버스 조사 φ 17%)
      실제 φ는 이 값보다 낮을 가능성이 크다. 여기서 보는 것은 '고PCTR 축일수록 φ가 높다'는 가설의 방향과 크기.
출력: result/phi_proxy.json, result/phi_proxy_axes.csv, result/phi_proxy_routes.csv"""
import json
import pandas as pd
import axis_model as m
from improve_common import setup, p_car, corridor_row, stats

S = setup()
res, cal, alpha, lk, census, eg = S["res"], S["cal"], S["alpha"], S["lk"], S["census"], S["eg"]
s30 = census.set_index("시군")["s_car_30"]; pobs = census.set_index("시군")["PCTR_obs"]
alloc = res["alloc_ours"]

# ── 버스 후보 9축 ─────────────────────────────────────────────
ax_rows = []
for _, r in lk[lk["class"].isin(["DRT 연계", "출퇴근 직행"])].iterrows():
    k = f"{r.o}→{r.d}"
    pc = p_car(alpha[r.o], r.PCTR_used)
    assert abs(pc - r.P_car) < 1e-9
    ax_rows.append(dict(axis=k, o=r.o, d=r.d, diag=r["class"], alloc_trips_am=alloc.get(k, 0), allocated=k in alloc,
                        Q_od=int(r.Q_od), Q_car=round(r.Q_car), T_car=r.T_car, T_transit=r.T_transit, car_km=r.car_km,
                        PCTR=round(r.PCTR, 3), alpha_o=round(alpha[r.o], 3), phi_proxy=round(pc, 3),
                        s_car_30_origin=round(s30[r.o], 3), PCTR_obs_origin=round(pobs[r.o], 3),
                        phi_model=res["service"][k][f"phi_{res['service'][k]['service']}"]))
ax = pd.DataFrame(ax_rows).sort_values(["allocated", "phi_proxy"], ascending=[False, False])
ax.to_csv(m.ROOT / "result/phi_proxy_axes.csv", index=False, encoding="utf-8-sig")

# ── 현행 편하G 28개 노선 ─────────────────────────────────────
sido = eg.set_index("노선번호")["도착_시도"]
rt_rows = []
for b in S["routes"]:
    rr = b["rr"]
    c = corridor_row(cal, b["o"], b["k"].split("→")[1])
    D, phi_model, _ = m.service_demand(rr, b["alpha"])
    rt_rows.append(dict(id=b["id"], route=b["k"], o=b["o"], seoul=sido[b["id"]] == "서울특별시", n_cur_am=b["n_cur"],
                        alloc_base_am=res["alloc_base"].get(b["id"], 0), km=b["km"], T_car=rr["T_car"], T_transit=rr["T_transit"],
                        PCTR_route=round(rr["PCTR_used"], 3), alpha_o=round(b["alpha"], 3),
                        phi_proxy_route=round(p_car(b["alpha"], rr["PCTR_used"]), 3),
                        PCTR_corridor=round(c["PCTR_used"], 3), PCTR_corridor_src="조회" if c["looked"] else "출발지 평균/인구총조사",
                        phi_proxy_corridor=round(c["P_car"], 3), Q_od=int(c["Q_od"]), Q_car_corridor=round(c["Q_car"]),
                        s_car_30_origin=round(s30[b["o"]], 3), phi_model=round(phi_model, 3)))
rt = pd.DataFrame(rt_rows)
rt.to_csv(m.ROOT / "result/phi_proxy_routes.csv", index=False, encoding="utf-8-sig")

A4, C9 = ax[ax.allocated], ax
seoul, nonseoul = rt[rt.seoul], rt[~rt.seoul]
# 같은 조회 방식(대표점 5곳)으로 PCTR을 잰 나머지 11축(수요관리 분류, 대부분 서울행) → 노선 PCTR과 측정 방식이 같은 비교군
dm = lk[lk["class"] == "수요관리"]
dm_tab = [dict(axis=f"{r.o}→{r.d}", PCTR=round(r.PCTR, 3), phi_proxy=round(r.P_car, 3)) for _, r in dm.iterrows()]


def beta_sweep(betas=(2.37, 3.20, 3.31)):
    """β만 바꿔 α_o를 다시 맞추고 비례 추출 φ 평균을 다시 계산 (파일 출력 없음)"""
    b0, out = m.BETA, []
    census_, lookup_ = census, json.load(open(m.ROOT / "pctr/pctr_lookup.json", encoding="utf-8"))
    axes100 = pd.read_csv(m.ROOT / "result100/axes_all.csv")
    for b in betas:
        m.BETA = b
        cal_b, al_b = m.calibrate(axes100, census_, lookup_)
        pc = lambda o, p: p_car(al_b[o], p)
        a4 = [pc(r.o, r.PCTR) for _, r in A4.iterrows()]
        c9 = [pc(r.o, r.PCTR) for _, r in C9.iterrows()]
        er = [pc(r.o, r.PCTR_route) for _, r in rt.iterrows()]
        es = [pc(r.o, r.PCTR_route) for _, r in seoul.iterrows()]
        out.append(dict(BETA=b, allocated_4_w=round(sum(x * w for x, w in zip(a4, A4.alloc_trips_am)) / A4.alloc_trips_am.sum(), 3),
                        allocated_4_mean=round(sum(a4) / 4, 3), candidates_9_mean=round(sum(c9) / len(c9), 3),
                        existing_28_route_mean=round(sum(er) / len(er), 3),
                        existing_28_route_w_alloc=round(sum(x * w for x, w in zip(er, rt.alloc_base_am)) / rt.alloc_base_am.sum(), 3),
                        existing_seoul_route_mean=round(sum(es) / len(es), 3)))
    m.BETA = b0
    return out


def grp(d, col, wcols):
    return {**stats(d[col]), **{f"w_{w}": round(float((d[col] * d[w]).sum() / d[w].sum()), 3) for w in wcols if d[w].sum() > 0}}


out = dict(
    note=("비례 추출 φ = 축의 현재 승용차 통근 분담률 P_car(o,d) (axis_model 로짓, β=%.2f, α_o는 출발 시군 30분+ 통근 승용차 분담률 s_car_30에 맞춤). "
          "버스는 보통 대중교통 이용자를 비례 이상으로 끌어오므로(경기 산단 공동통근버스 φ 17%%, 수원 똑버스 21.3%%, 셔클 26.2%%) 실제 φ의 상한 쪽 참고값이다. "
          "모델 φ(phi_model)는 직행 후보 축에서 PHI_MAX=0.5로 잘린 값." % m.BETA),
    allocated_4=dict(phi_proxy=grp(A4, "phi_proxy", ["alloc_trips_am"]), s_car_30_origin=stats(A4["s_car_30_origin"]),
                     PCTR=stats(A4["PCTR"]), phi_model=stats(A4["phi_model"])),
    candidates_9=dict(phi_proxy=stats(C9["phi_proxy"]), s_car_30_origin=stats(C9["s_car_30_origin"]), PCTR=stats(C9["PCTR"])),
    existing_28=dict(phi_proxy_route=grp(rt, "phi_proxy_route", ["n_cur_am", "alloc_base_am"]),
                     phi_proxy_corridor=grp(rt, "phi_proxy_corridor", ["n_cur_am", "alloc_base_am"]),
                     s_car_30_origin=stats(rt["s_car_30_origin"]), PCTR_route=stats(rt["PCTR_route"]),
                     PCTR_corridor=stats(rt["PCTR_corridor"]), phi_model=stats(rt["phi_model"])),
    existing_seoul=dict(n=int(len(seoul)), phi_proxy_route=grp(seoul, "phi_proxy_route", ["n_cur_am", "alloc_base_am"]),
                        phi_proxy_corridor=grp(seoul, "phi_proxy_corridor", ["n_cur_am", "alloc_base_am"]),
                        PCTR_route=stats(seoul["PCTR_route"])),
    existing_nonseoul=dict(n=int(len(nonseoul)), phi_proxy_route=grp(nonseoul, "phi_proxy_route", ["n_cur_am", "alloc_base_am"]),
                           phi_proxy_corridor=grp(nonseoul, "phi_proxy_corridor", ["n_cur_am", "alloc_base_am"]),
                           PCTR_route=stats(nonseoul["PCTR_route"])),
    lookup_demand_mgmt_11=dict(phi_proxy=stats(dm["P_car"]), PCTR=stats(dm["PCTR"]), axes=dm_tab,
                               note="같은 카카오맵 대표점 조회로 PCTR을 잰 비버스 처방 축(PCTR<1.5). 노선 PCTR과 같은 방향의 교차 확인용"),
    corridor_caveat=("현행 노선의 축(corridor) PCTR은 28개 중 1개(용인→서울 강남구)만 조회값이고 27개는 같은 출발지 조회축 평균"
                     "(경기 내 고PCTR 축 위주라 과대) 또는 인구총조사 시군 관측 PCTR로 채운 값이라 비교에 쓰지 않는다. 노선 PCTR(정류장 간 실측)을 기준으로 본다."),
    beta_sweep=beta_sweep(),
    axes=ax.to_dict("records"), routes=rt.to_dict("records"),
    params=dict(BETA=m.BETA, alpha_o={k: round(v, 3) for k, v in alpha.items()}),
)
json.dump(out, open(m.ROOT / "result/phi_proxy.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=float)

if __name__ == "__main__":
    pd.set_option("display.width", 250)
    print(ax[["axis", "diag", "alloc_trips_am", "Q_od", "Q_car", "PCTR", "alpha_o", "phi_proxy", "s_car_30_origin", "phi_model"]].to_string(index=False))
    print(rt[["id", "route", "seoul", "n_cur_am", "alloc_base_am", "PCTR_route", "phi_proxy_route", "PCTR_corridor", "phi_proxy_corridor", "s_car_30_origin", "phi_model"]].to_string(index=False))
    print(json.dumps({k: out[k] for k in ("allocated_4", "candidates_9", "existing_28", "existing_seoul", "existing_nonseoul")}, ensure_ascii=False, indent=1))
