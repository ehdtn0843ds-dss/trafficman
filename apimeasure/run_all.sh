#!/bin/bash
# 재측정 후 전체 갱신: 입력 생성 → 인구가중 집계 → 모델 → 민감도 → 그림
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python3 "$ROOT/apimeasure/build_inputs.py" "$1"
cd "$ROOT/resid" && python3 aggregate.py > aggregate_log.txt && tail -21 aggregate_log.txt
ROOT="$ROOT" python3 - <<'PY'
import json, os
R=os.environ["ROOT"]
rows=json.load(open(R+"/resid/pctr_lookup_resid.json",encoding="utf-8"))
out=[dict(idx=r["idx"],o=r["o"],d=r["d"],dest=r["dest"],T_car=r["T_car"],T_car_now=r["T_car_now"],car_km=r["car_km"],T_transit=r["T_transit"],
  walk=r["walk"],xfer=r["xfer"],tr_km=r["tr_km"],PCTR=r["PCTR"],PCTR_min=r["PCTR_min"],PCTR_max=r["PCTR_max"],n_pts=r["n_pts"],est=False,PCTR_single=r["PCTR_old"]) for r in rows]
json.dump(out,open(R+"/pctr_commute/pctr/pctr_lookup.json","w",encoding="utf-8"),ensure_ascii=False,indent=1)
PY
cd "$ROOT/pctr_commute" && python3 axis_model.py | tail -14 && python3 sensitivity.py | tail -3
cd "$ROOT/report" && python3 make_figs.py
