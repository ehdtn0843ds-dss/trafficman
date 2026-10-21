"""브라우저에서 받은 조회 결과 텍스트(od_raw_*.txt)를 od_results.json으로 합친다.
형식: '시군|동|목적지 km now peak tt walk xfer trkm ok cerr terr' 를 ' / '로 구분"""
import json, glob
from pathlib import Path
R = Path(__file__).parent
od = {}
for fn in sorted(glob.glob(str(R / "od_raw_*.txt"))):
    for item in open(fn, encoding="utf-8").read().strip().split(" / "):
        p = item.strip().split(" ")
        if len(p) < 9:
            continue
        k = p[0]
        num = lambda s: (float(s) if s not in ("", "undefined", "null") else None)
        km, now, peak, tt, walk, xfer, trkm = (num(x) for x in p[1:8])
        rec = dict(km=km, now=now, peak=peak, tt=tt, walk=walk, xfer=xfer, trkm=trkm, ok=p[8] == "1")
        if all(v is not None for v in (km, peak, tt)) and rec["ok"]:
            od[k] = rec
        elif k not in od:
            od[k] = dict(rec, cerr="incomplete")
json.dump(od, open(R / "od_results.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
bad = [k for k, v in od.items() if v.get("cerr")]
print(len(od), "pairs,", len(bad), "incomplete:", bad)
