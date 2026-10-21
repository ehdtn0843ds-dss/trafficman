"""출발 시군의 인구 상위 5개 행정동(주거 건물 가중 대표점) → 목적지 통행시간을 인구 가중 평균해 축별 PCTR 계산"""
import json, csv
from pathlib import Path
R = Path(__file__).parent
top = json.load(open(R / "top5_dongs.json", encoding="utf-8"))
pts = json.load(open(R / "origin_points.json", encoding="utf-8"))      # "수원|광교1동": {med:[lat,lng], n, napt}
od = json.load(open(R / "od_results.json", encoding="utf-8"))          # "수원|광교1동|강남역": {...}
axes = json.load(open(R / "axes_dest.json", encoding="utf-8"))
old = {(r["o"], r["d"]): r for r in json.load(open(R.parent / "pctr_commute/pctr/pctr_lookup_single_point.json", encoding="utf-8"))}
pop = {(t["city"], t["dong"]): t["pop"] for t in top}
rows, detail = [], []
for a in axes:
    c = a["o"][:-1]
    recs = []
    for t in [t for t in top if t["city"] == a["o"]]:
        k = f"{c}|{t['dong']}|{a['dest']}"
        r = od.get(k)
        if not r or r.get("cerr") or r.get("terr") or not r.get("peak") or not r.get("tt"):
            detail.append(dict(idx=a["idx"], key=k, status="missing")); continue
        w = t["pop"]
        recs.append((w, r))
        detail.append(dict(idx=a["idx"], o=a["o"], d=a["d"], dong=t["dong"], pop=w, lat=pts[f"{c}|{t['dong']}"]["med"][0],
                           lng=pts[f"{c}|{t['dong']}"]["med"][1], dest=a["dest"], T_car=r["peak"], T_car_now=r["now"], car_km=r["km"],
                           T_transit=r["tt"], walk=r["walk"], xfer=r["xfer"], tr_km=r["trkm"], PCTR=round(r["tt"] / r["peak"], 3)))
    W = sum(w for w, _ in recs)
    m = lambda f: sum(w * r[f] for w, r in recs) / W
    T_car, T_tr = m("peak"), m("tt")
    p_each = [r["tt"] / r["peak"] for _, r in recs]
    o_ = old[(a["o"], a["d"])]
    rows.append(dict(idx=a["idx"], o=a["o"], d=a["d"], dest=a["dest"], n_pts=len(recs),
                     T_car=round(T_car, 1), T_car_now=round(m("now"), 1), car_km=round(m("km"), 1), T_transit=round(T_tr, 1),
                     walk=round(m("walk"), 1), xfer=round(m("xfer"), 2), tr_km=(round(m("trkm"), 1) if all(r.get("trkm") is not None for _, r in recs) else None), PCTR=round(T_tr / T_car, 3),
                     PCTR_min=round(min(p_each), 2), PCTR_max=round(max(p_each), 2),
                     PCTR_old=o_["PCTR"], on_old=o_.get("on", ""), est=False))
json.dump(rows, open(R / "pctr_lookup_resid.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
with open(R / "od_detail.csv", "w", encoding="utf-8-sig", newline="") as f:
    keys = ["idx", "o", "d", "dong", "pop", "lat", "lng", "dest", "T_car", "T_car_now", "car_km", "T_transit", "walk", "xfer", "tr_km", "PCTR"]
    w = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore"); w.writeheader()
    for d in detail:
        if "dong" in d: w.writerow(d)
miss = [d["key"] for d in detail if d.get("status") == "missing"]
print("missing:", miss)
for r in rows:
    print(f'{r["idx"]:>2} {r["o"]}→{r["d"]:<10} n={r["n_pts"]} 대중 {r["T_transit"]:>5} 승용 {r["T_car"]:>5} 도보 {r["walk"]:>4} PCTR {r["PCTR"]:.2f} (구 {r["PCTR_old"]:.2f}) 범위 {r["PCTR_min"]}~{r["PCTR_max"]}')
