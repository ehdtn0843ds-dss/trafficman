"""
인구총조사 2020 (KOSIS DT_1PA2004) → 경기 시군별 통근 수단 분담률·수단별 평균 소요시간
- 통근만 사용 (통학 제외)
- 수단 묶음: 승용차 = '승용차,승합차(벤)', 대중교통 = 시내·좌석·마을버스 + 고속·시외버스 + 전철·지하철 + 기차 + 복합수단(가정: 대부분 대중교통 환승)
- 평균 소요시간: 구간 중앙값(7.5, 22.5, 37.5, 52.5, 75, 105, 135분) 가중평균
- PCTR_obs = T_transit / T_car  (주의: 수단마다 가는 목적지가 달라 편향이 있음)
- s_car_30 = 소요시간 30분 이상 통근자 중 승용차 비율 (시군 경계를 넘는 통근의 대리지표)
"""
import sys
import pandas as pd
src = sys.argv[1]; out = sys.argv[2]
df = pd.read_csv(src, encoding="cp949", dtype=str, skiprows=2)
for c in ["C행정구역별(시군구)", "C통근·통학여부별", "C소요시간별"]:
    df[c] = df[c].str.lstrip("'")
modes = ["걸어서", "자전거", "승용차,승합차(벤)", "트럭", "시내,좌석,마을버스", "통근,통학차량", "고속,시외버스",
         "전철,지하철", "기차", "택시", "기타", "복합수단", "미상"]
for m in modes + ["통근·통학 인구(12세 이상)"]:
    df[m] = pd.to_numeric(df[m], errors="coerce").fillna(0)
code = df["C행정구역별(시군구)"]
city = df[code.str.match(r"^31\d\d0$") & ~code.isin(["31003", "31004", "31005"]) & (df["C통근·통학여부별"] == "1")]
mid = {"1": 7.5, "2": 22.5, "3": 37.5, "4": 52.5, "5": 75, "6": 105, "7": 135}
TRANSIT = ["시내,좌석,마을버스", "고속,시외버스", "전철,지하철", "기차", "복합수단"]
rows = []
for (c, name), g in city.groupby(["C행정구역별(시군구)", "행정구역별(시군구)"]):
    tot = g[g["C소요시간별"] == "0"].iloc[0]
    valid = tot["통근·통학 인구(12세 이상)"] - tot["미상"]
    car, tr = tot["승용차,승합차(벤)"], tot[TRANSIT].sum()
    t = g[g["C소요시간별"] != "0"].copy(); t["mid"] = t["C소요시간별"].map(mid)
    def mean_time(cols):
        w = t[cols].sum(axis=1); return (w * t["mid"]).sum() / w.sum() if w.sum() > 0 else float("nan")
    long_ = t[t["C소요시간별"].astype(int) >= 3]
    rows.append(dict(
        code=c, 시군=name.strip(), 통근자=int(tot["통근·통학 인구(12세 이상)"]),
        s_car=car / valid, s_transit=tr / valid, s_shuttle=tot["통근,통학차량"] / valid,
        s_active=(tot["걸어서"] + tot["자전거"]) / valid,
        s_car_30=long_["승용차,승합차(벤)"].sum() / (long_[modes].sum(axis=1).sum() - long_["미상"].sum()),
        T_car=mean_time(["승용차,승합차(벤)"]), T_transit=mean_time(TRANSIT),
        T_bus=mean_time(["시내,좌석,마을버스"]), T_rail=mean_time(["전철,지하철"]), T_multi=mean_time(["복합수단"]),
    ))
r = pd.DataFrame(rows)
r["PCTR_obs"] = r["T_transit"] / r["T_car"]
r = r.sort_values("s_car", ascending=False)
r.to_csv(out, index=False, encoding="utf-8-sig")
pd.set_option("display.width", 200)
print(r[["시군", "통근자", "s_car", "s_car_30", "s_transit", "T_car", "T_transit", "PCTR_obs"]].round(3).to_string(index=False))
