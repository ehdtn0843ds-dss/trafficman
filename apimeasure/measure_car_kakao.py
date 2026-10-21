"""승용차 출근 피크 통행시간 측정: 카카오모빌리티 미래 운행 정보 길찾기 API
사용: KAKAO_REST_KEY=<발급 키> python measure_car_kakao.py [출발시각 YYYYMMDDHHMM, 기본 202610270800]
입력 jobs.txt: "key,출발 위도,출발 경도,도착 위도,도착 경도" 를 ';'로 이어 붙인 한 줄
출력 car_api.json: {"source": ..., "car": {key: {"T_car": 분, "car_km": km}}}
키는 환경변수로만 받으며 파일에 저장하지 않는다."""
import json, os, sys, time, urllib.request, urllib.parse
from pathlib import Path

A = Path(__file__).resolve().parent
KEY = os.environ["KAKAO_REST_KEY"]
DEP = sys.argv[1] if len(sys.argv) > 1 else "202610270800"
URL = "https://apis-navi.kakaomobility.com/v1/future/directions"

jobs = [j.split(",") for j in open(A / "jobs.txt", encoding="utf-8").read().strip().split(";") if j]
car = {}
for key, olat, olng, dlat, dlng in jobs:
    q = urllib.parse.urlencode({"origin": f"{olng},{olat}", "destination": f"{dlng},{dlat}", "departure_time": DEP, "summary": "true"})
    req = urllib.request.Request(f"{URL}?{q}", headers={"Authorization": f"KakaoAK {KEY}"})
    s = json.load(urllib.request.urlopen(req, timeout=20))["routes"][0]["summary"]
    car[key] = {"T_car": round(s["duration"] / 60, 1), "car_km": round(s["distance"] / 1000, 1)}
    time.sleep(0.2)
json.dump({"source": f"카카오모빌리티 미래 운행 정보 길찾기 API, 출발 {DEP}", "car": car},
          open(A / "car_api.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(len(car), "쌍 저장")
