"""카카오모빌리티 API 승용차 시간 + 카카오맵 웹 조회 대중교통 시간 → resid/od_results.json(주거지 100쌍), pctr_commute/pctr/easygbus_lookup.json(현행 27+1노선)
사용: python build_inputs.py <대중교통 조회 JSON 폴더>
입력 형식
  apimeasure/car_api.json : {"source": "...", "car": {"<key>": {"T_car": 분, "car_km": km}, ...}}   (measure_car_kakao.py가 생성)
  <폴더>/*.json            : {"key": "<key>", "tt": 총 소요(분), "walk": 도보(분), "xfer": 환승 횟수, "trkm": 경로 거리(km)}
  key = jobs.txt의 첫 칸 (주거지 쌍 "시|동|목적지", 현행 노선 "P####")
od_results.json의 now는 별도로 재지 않아 peak(08:00 예측)와 같은 값을 넣었다."""
import json, sys, glob, os, csv
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
A = ROOT / "apimeasure"; RES = ROOT / "resid"; PC = ROOT / "pctr_commute"
car = json.load(open(A / "car_api.json", encoding="utf-8"))["car"]
man = {}
for f in glob.glob(os.path.join(sys.argv[1], "*.json")):
    d = json.load(open(f, encoding="utf-8")); d = d.get("data", d)
    if d.get("tt") is not None and d.get("walk") is not None and d.get("xfer") is not None:
        man[d["key"]] = d
miss = [k for k in car if k not in man]
print("대중교통 조회", len(man), "/", len(car), "누락", miss[:10])
od = {}
for k, c in car.items():
    if "|" not in k or k not in man: continue
    m = man[k]
    od[k] = dict(km=c["car_km"], now=c["T_car"], peak=c["T_car"], tt=float(m["tt"]), walk=float(m["walk"]), xfer=float(m["xfer"]), trkm=m.get("trkm"), ok=True)
json.dump(od, open(RES / "od_results.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
eg = {r["노선번호"]: r for r in csv.DictReader(open(PC / "easygbus_routes.csv", encoding="utf-8"))}
out = []
for rid, e in eg.items():
    src = "P9601" if rid == "P9602" else rid
    if src not in car or src not in man: continue
    c, m = car[src], man[src]
    out.append(dict(노선번호=rid, 시군=e["시군"], 출발=e["출발"], 도착=e["도착"], T_car=c["T_car"], T_car_now=c["T_car"], car_km=c["car_km"],
                    T_transit=float(m["tt"]), walk=float(m["walk"]), xfer=float(m["xfer"]), tr_km=m.get("trkm"), PCTR=round(float(m["tt"]) / c["T_car"], 3)))
json.dump(out, open(PC / "pctr/easygbus_lookup.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("주거지 쌍", len(od), "현행 노선", len(out))
# ODsay 교차검증
# odsay_api.json: {"transit": {key: {"ride": 총 소요(분), ...}}} — ODsay 응답 요약이라 저장소에는 없음(있을 때만 검증)
ods = json.load(open(A / "odsay_api.json", encoding="utf-8"))["transit"] if (A / "odsay_api.json").exists() else {}
import numpy as np
pairs = [(ods[k]["ride"], float(man[k]["tt"])) for k in ods if k in man]
if pairs:
    a = np.array(pairs); r = np.corrcoef(a[:, 0], a[:, 1])[0, 1]
    v = dict(n=len(a), corr=round(float(r), 3), median_ratio=round(float(np.median(a[:, 0] / a[:, 1])), 3))
    json.dump(v, open(A / "odsay_validation.json", "w"), indent=1); print("ODsay 검증", v)
