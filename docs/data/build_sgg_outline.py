"""축 탐색기 배경용 시군 윤곽 (docs/data/sgg_outline.json)

원본: vuski/admdongkor 행정동 경계 ver20260701 (https://github.com/vuski/admdongkor)
  curl -o HangJeongDong_ver20260701.geojson \
    https://raw.githubusercontent.com/vuski/admdongkor/master/ver20260701/HangJeongDong_ver20260701.geojson
  python3 docs/data/build_sgg_outline.py HangJeongDong_ver20260701.geojson

처리: 경기도는 시군 단위(구가 있는 시는 시 하나로), 서울은 자치구 단위로 행정동을 합치고(shapely unary_union),
Douglas-Peucker로 단순화(허용 TOL도), 1/1000도 정수로 반올림해 고리마다 첫 점 + 차분으로 저장해요.
배경 그림용이라 이웃 시군 경계가 서로 따로 단순화돼요(지도에서 1 px 안팎). 면적·거리 계산에는 쓰지 마세요.
"""
import json
import re
import sys
from pathlib import Path

from shapely.geometry import shape, Polygon, MultiPolygon
from shapely.ops import unary_union

SRC = Path(sys.argv[1])
OUT = Path(__file__).with_name("sgg_outline.json")
TOL = 0.0015        # 도 (약 150 m). 탐색기 지도는 1도 ≈ 350 px라 0.5 px 수준
MIN_AREA = 2.5e-5   # 이보다 작은 섬·조각은 버려요 (약 0.3 km²)
Q = 1000            # 1/1000도 격자

d = json.loads(SRC.read_text(encoding="utf-8"))
groups = {}
for f in d["features"]:
    p = f["properties"]
    if p["sidonm"] == "경기도":
        name = re.sub(r"^(\S+?시)\S+구$", r"\1", p["sggnm"])   # 수원시영통구 → 수원시
        key = ("경기", name)
    elif p["sidonm"] == "서울특별시":
        key = ("서울", p["sggnm"])
    else:
        continue
    groups.setdefault(key, []).append(shape(f["geometry"]))


def rings(geom):
    polys = [geom] if isinstance(geom, Polygon) else list(geom.geoms) if isinstance(geom, MultiPolygon) else []
    for pg in polys:
        if pg.area < MIN_AREA:
            continue
        yield pg.exterior          # 구멍은 배경 그림에 필요 없어요


def enc(ring):
    pts = [(round(x * Q), round(y * Q)) for x, y in ring.coords]
    out, px, py = [], None, None
    for x, y in pts:
        if px is None:
            out += [x, y]
        elif (x, y) != (px, py):
            out += [x - px, y - py]
        px, py = x, y
    return out


feats = []
for (sido, name), gs in sorted(groups.items()):
    u = unary_union(gs).buffer(0)
    s = u.simplify(TOL, preserve_topology=True)
    rs = [enc(r) for r in rings(s)]
    rs = [r for r in rs if len(r) >= 8]
    c = u.representative_point()
    feats.append({"n": name, "s": sido, "c": [round(c.x, 3), round(c.y, 3)], "r": rs})

out = {
    "source": "vuski/admdongkor 행정동 경계 ver20260701 (https://github.com/vuski/admdongkor), 시군·자치구 단위로 합쳐 단순화",
    "license": "CC BY 4.0. 본 데이터는 통계청 통계지리정보서비스(SGIS, https://sgis.kostat.go.kr)에서 공공누리 제1유형으로 개방한 행정동 경계를 가공한 것이며(가공: vuski/admdongkor, https://github.com/vuski/admdongkor), CC BY 4.0으로 배포됩니다. 이 파일은 그것을 시군 단위로 합치고 단순화했어요.",
    "encoding": "r = 고리 목록. 각 고리는 [x0, y0, dx1, dy1, ...], 단위 1/1000도(경도, 위도). 첫 점 + 차분",
    "tolerance_deg": TOL,
    "features": feats,
}
OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(OUT, OUT.stat().st_size, "bytes,", len(feats), "features")
