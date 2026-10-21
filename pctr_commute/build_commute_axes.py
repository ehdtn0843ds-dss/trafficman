"""
국민연금 직장-거주지 이동 데이터 → 통근 축(OD) 추출

입력: 국민연금공단_직장 거주지 이동 데이터 CSV (data.go.kr/data/15167424)
출력 (--out 폴더):
  axes_all.csv        최소 통근자 수 이상인 모든 통근 축
  axes_top.csv        상위 N개 축 + 편하G버스 운행 여부
  lookup_template.csv 상위 N개 축의 통행시간 수기 조회 양식 (PCTR 계산용)
  easygbus_match.csv  편하G버스 노선별로 대응 축의 순위·통근자 수
  summary.txt         요약

사용 예:
  python build_commute_axes.py --input 국민연금_직장거주지.csv --out result
  python build_commute_axes.py --input data.csv --origin-sido 경기도 --min-commuters 1000 --top 50

기호:
  Q_od  : 축(o→d)의 통근자 수 (국민연금 가입자 기준)
  Q_o   : 출발 지역 o 거주 가입자 전체 (같은 지역 내 근무 포함)
  s_od  : Q_od / Q_o  (출발 지역 통근자 중 이 축의 비중)
"""

import argparse
import re
import sys
from pathlib import Path

import pandas as pd

REQUIRED = {
    "month": "기준년월",
    "res_code": "거주지주소코드",
    "res_sido": "거주시도명",
    "res_sgg": "거주시군구명",
    "work_code": "직장주소코드",
    "work_sido": "직장시도명",
    "work_sgg": "직장시군구명",
    "age": "연령대",
    "sex": "성별",
    "n": "가입자수",
}


def read_csv_any(path: Path) -> pd.DataFrame:
    last_err = None
    for enc in ("utf-8-sig", "cp949", "euc-kr", "utf-8"):
        try:
            return pd.read_csv(path, encoding=enc, dtype=str)
        except (UnicodeDecodeError, UnicodeError) as e:
            last_err = e
    raise RuntimeError(f"인코딩을 판별하지 못했어: {last_err}")


def resolve_columns(df: pd.DataFrame) -> dict:
    cols = {c.strip(): c for c in df.columns}
    out = {}
    missing = []
    for key, name in REQUIRED.items():
        if name in cols:
            out[key] = cols[name]
        else:
            # 공백/표기 차이 대비: 부분 일치
            cand = [c for c in cols if name.replace(" ", "") in c.replace(" ", "")]
            if cand:
                out[key] = cols[cand[0]]
            elif key in ("age", "sex"):
                out[key] = None  # 없어도 진행 가능
            else:
                missing.append(name)
    if missing:
        raise KeyError(f"필수 컬럼이 없어: {missing}\n실제 컬럼: {list(df.columns)}")
    return out


def norm(s: str) -> str:
    return re.sub(r"\s+", "", str(s)) if pd.notna(s) else ""


CITY_GU = re.compile(r"^(.+?시)\s*(.+구)$")


def city_of(sgg_name: str) -> str:
    """'수원시 장안구' / '수원시장안구' → '수원시', 그 외는 그대로"""
    n = str(sgg_name).strip()
    m = CITY_GU.match(n)
    return m.group(1) if m else n


def city_code(code: str) -> str:
    """구가 있는 시의 구 코드(예: 41111) → 시 코드(41110). 구 없는 시군·서울 자치구는 그대로."""
    c = str(code).strip()
    return c[:4] + "0" if len(c) == 5 else c


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", default="result")
    ap.add_argument("--origin-sido", default="경기도", help="출발 시도 필터 (전체는 ALL)")
    ap.add_argument("--min-commuters", type=int, default=1000)
    ap.add_argument("--top", type=int, default=50)
    ap.add_argument("--month", default=None, help="기준년월 지정 (기본: 최신)")
    ap.add_argument("--origin-level", choices=["city", "sgg"], default="city",
                    help="city: 출발지를 시 단위로 묶음(수원시 4개 구 → 수원시)")
    ap.add_argument("--key", choices=["name", "code"], default="name",
                    help="지역 식별 기준 (실제 파일은 코드-이름 불일치가 있어 name 권장)")
    ap.add_argument("--easygbus", default=str(Path(__file__).with_name("easygbus_routes.csv")))
    a = ap.parse_args()

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    raw = read_csv_any(Path(a.input))
    c = resolve_columns(raw)
    df = pd.DataFrame({k: raw[v] for k, v in c.items() if v is not None})
    df["n"] = pd.to_numeric(df["n"].str.replace(",", "", regex=False), errors="coerce").fillna(0)

    months = sorted(df["month"].dropna().unique())
    month = a.month or months[-1]
    df = df[df["month"] == month].copy()

    # 출발지 단위
    if a.origin_level == "city":
        df["o_code"] = df["res_code"].map(city_code)
        df["o_name"] = df["res_sgg"].map(city_of)
    else:
        df["o_code"] = df["res_code"].str.strip()
        df["o_name"] = df["res_sgg"].str.strip()
    df["o_sido"] = df["res_sido"].str.strip()

    # 도착지는 시군구(구 단위 유지: 서울 자치구, 성남 분당/수정 구분이 중요)
    df["d_code"] = df["work_code"].str.strip()
    df["d_sgg"] = df["work_sgg"].str.strip()
    df["d_sido"] = df["work_sido"].str.strip()
    df["d_city_code"] = df["d_code"].map(city_code)

    # 키 기준: 실제 파일에서 주소코드와 시군구명이 어긋나는 행이 약 2% 있음
    # (예: 41113 코드에 '화성시', 41285 코드에 '파주시'). 동일지역여부는 코드 기준으로 매겨져 있음.
    # 기본은 이름 기준으로 묶고, --key code 로 코드 기준 비교 가능.
    if a.key == "name":
        df["o_code"] = df["o_sido"] + "|" + df["o_name"]
        df["d_code"] = df["d_sido"] + "|" + df["d_sgg"]
        df["d_city_code"] = df["d_sido"] + "|" + (df["d_sgg"].map(city_of) if a.origin_level == "city" else df["d_sgg"])

    if a.origin_sido != "ALL":
        df = df[df["o_sido"] == a.origin_sido]

    # 출발 지역 전체 가입자 (같은 지역 근무 포함) → 비중 분모
    Q_o = df.groupby(["o_code", "o_name"], as_index=False)["n"].sum().rename(columns={"n": "Q_o"})

    # 같은 지역 내 통근 제외 (출발을 시 단위로 묶었으면 같은 시 안의 다른 구도 제외)
    same = (df["d_city_code"] == df["o_code"]) if a.origin_level == "city" else (df["d_code"] == df["o_code"])
    inter = df[~same]

    axes = (inter.groupby(["o_sido", "o_code", "o_name", "d_sido", "d_code", "d_sgg"], as_index=False)["n"]
            .sum().rename(columns={"n": "Q_od"}))
    axes = axes.merge(Q_o, on=["o_code", "o_name"], how="left")
    axes["s_od"] = axes["Q_od"] / axes["Q_o"]

    # 연령 구성 (있으면): 50세 이상 비중 — 대안 수단 수요 특성 참고용
    if "age" in inter.columns:
        age_num = pd.to_numeric(inter["age"].str.extract(r"^(\d+)")[0], errors="coerce")
        inter = inter.assign(age50=(age_num >= 55).astype(int) * inter["n"])  # 코드 55 = 50-54세 이상
        a50 = inter.groupby(["o_code", "d_code"], as_index=False)["age50"].sum()
        axes = axes.merge(a50, on=["o_code", "d_code"], how="left")
        axes["share_50plus"] = axes["age50"] / axes["Q_od"]
        axes = axes.drop(columns="age50")

    axes = axes[axes["Q_od"] >= a.min_commuters].sort_values("Q_od", ascending=False).reset_index(drop=True)
    axes.insert(0, "rank", axes.index + 1)

    # 편하G버스 매칭: 출발 시군 일치 + 도착 시군구 일치
    eg_path = Path(a.easygbus)
    if eg_path.exists():
        eg = pd.read_csv(eg_path, dtype=str)
        eg["o_key"] = eg["시군"].map(norm)
        # 도착은 시도+시군구로 매칭 (서울 중구 vs 인천 중구 구분)
        eg["d_key"] = eg["도착_시도"].map(norm) + "|" + eg["도착_시군구"].map(norm)
        axes["o_key"] = axes["o_name"].map(lambda x: norm(city_of(x)))
        axes["d_key"] = axes["d_sido"].map(norm) + "|" + axes["d_sgg"].map(norm)
        keys = set(zip(eg["o_key"], eg["d_key"]))
        axes["easygbus"] = [(o, d) in keys for o, d in zip(axes["o_key"], axes["d_key"])]
        m = eg.merge(axes[["o_key", "d_key", "rank", "Q_od"]], on=["o_key", "d_key"], how="left")
        m[["시군", "노선번호", "출발", "도착", "도착_시군구", "편도운행회", "rank", "Q_od"]].to_csv(
            out / "easygbus_match.csv", index=False, encoding="utf-8-sig")
        axes = axes.drop(columns=["o_key", "d_key"])
    else:
        axes["easygbus"] = False
        m = None

    axes.to_csv(out / "axes_all.csv", index=False, encoding="utf-8-sig")
    top = axes.head(a.top)
    top.to_csv(out / "axes_top.csv", index=False, encoding="utf-8-sig")

    # PCTR 수기 조회 양식: T_transit = 도보 + 대기 + 차내 + 환승
    tpl = top[["rank", "o_name", "d_sgg", "Q_od"]].copy()
    for col in ["출발_대표지점", "도착_대표지점", "조회일시", "출발시각",
                "T_car_분", "T_transit_분", "도보_분", "대기_분", "차내_분", "환승_분", "환승횟수", "조회자", "비고"]:
        tpl[col] = ""
    tpl.to_csv(out / "lookup_template.csv", index=False, encoding="utf-8-sig")

    lines = [
        f"기준년월: {month} (파일 내 기준년월: {', '.join(map(str, months))})",
        f"출발 시도: {a.origin_sido}, 출발 단위: {a.origin_level}, 최소 통근자 수: {a.min_commuters}",
        f"출발 지역 수: {Q_o.shape[0]}, 출발 지역 가입자 합: {int(Q_o['Q_o'].sum()):,}",
        f"지역 간 통근 축 수(≥{a.min_commuters}명): {len(axes)}, 해당 통근자 합: {int(axes['Q_od'].sum()):,}",
        f"상위 {a.top}개 축 통근자 합: {int(top['Q_od'].sum()):,}",
        f"상위 {a.top}개 축 중 편하G버스 운행 축: {int(top['easygbus'].sum())}개",
    ]
    if m is not None:
        hit = m["rank"].notna().sum()
        lines.append(f"편하G버스 노선 {len(m)}개 중 축 목록(≥{a.min_commuters}명)에 대응되는 노선: {hit}개")
    lines.append("")
    lines.append("상위 10개 축:")
    for _, r in top.head(10).iterrows():
        flag = " [편하G]" if r["easygbus"] else ""
        lines.append(f"  {r['rank']:>3}. {r['o_name']} → {r['d_sido']} {r['d_sgg']}: {int(r['Q_od']):,}명 "
                     f"(출발지 통근자의 {r['s_od']*100:.1f}%){flag}")
    (out / "summary.txt").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    sys.exit(main())
