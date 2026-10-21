"""카카오맵 웹 재측정(f_results.json) → 축별 인구가중 요약(f_summary.json). 인구는 resid/top5_dongs.json (시+동으로 매칭)"""
import json
from pathlib import Path
R = Path(__file__).resolve().parent
ROOT = R.parent if (R.parent / "resid").exists() else R.parents[1]
f = json.load(open(R / "f_results.json", encoding="utf-8"))
top = json.load(open(ROOT / "resid/top5_dongs.json", encoding="utf-8"))
pop = {(t["city"].rstrip("시군"), t["dong"]): t["pop"] for t in top}
P = lambda o: pop[tuple(o.split(" ", 1))]
out = {}
for r in f:
    out.setdefault(f'{r["group"]}|{r["origin"].split()[0]}|{r["dest"]}', []).append(r)
summ = {}
for k, rs in out.items():
    W = sum(P(r["origin"]) for r in rs); m = lambda fld: sum(P(r["origin"]) * r[fld] for r in rs) / W
    summ[k] = dict(n=len(rs), T_car=round(m("car_min"), 1), T_tr=round(m("tr_min"), 1), PCTR=round(m("tr_min") / m("car_min"), 2),
                   car_km=round(m("car_km"), 1), walk=round(m("tr_walk"), 1),
                   PCTR_range=[round(min(r["tr_min"] / r["car_min"] for r in rs), 2), round(max(r["tr_min"] / r["car_min"] for r in rs), 2)])
json.dump(summ, open(R / "f_summary.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
for k, v in summ.items(): print(k, v)
