"""improve_A–D 공통: axis_model 기준 실행 결과와 보정값(α_o, 축 P_car, 현행 편하G 노선 입력)을 한 번에 불러온다.
axis_model.main()을 그대로 한 번 실행하므로 result/allocation.json 등은 기준값 그대로 다시 쓰인다(결정적)."""
import json
import math
import numpy as np
import pandas as pd
import axis_model as m


def setup():
    res = m.main(verbose=False)                      # VEH, CCAR_KM, KAPPA, BONUS 전역값 설정
    census = pd.read_csv(m.ROOT / "census/gyeonggi_commute_mode_2020.csv")
    lookup = json.load(open(m.ROOT / "pctr/pctr_lookup.json", encoding="utf-8"))
    cal, alpha = m.calibrate(pd.read_csv(m.ROOT / "result100/axes_all.csv"), census, lookup)
    eg = pd.read_csv(m.ROOT / "easygbus_routes.csv")
    routes = m.base_routes(cal, alpha, eg)
    lk = pd.DataFrame(lookup).merge(cal[["o_name", "d_label", "Q_od", "Q_car", "P_car", "PCTR_used", "easygbus"]],
                                    left_on=["o", "d"], right_on=["o_name", "d_label"], how="left")
    lk["class"] = lk.apply(m.classify, axis=1)
    return dict(res=res, census=census, cal=cal, alpha=alpha, eg=eg, routes=routes, lk=lk)


def p_car(alpha, pctr):
    return m.logistic(alpha + m.BETA * math.log(pctr))


def corridor_row(cal, o, dsgg):
    """base_routes와 같은 규칙으로 노선의 (출발 시군, 도착 시군구) 축 행을 찾음"""
    hit = cal[(cal["o_name"] == o) & (cal["d_sgg"].str.replace(" ", "") == dsgg.replace(" ", ""))]
    return hit.iloc[0] if len(hit) else None


def stats(x, w=None):
    x = np.asarray(x, float)
    out = dict(n=int(len(x)), mean=round(float(x.mean()), 3), median=round(float(np.median(x)), 3),
               min=round(float(x.min()), 3), max=round(float(x.max()), 3))
    if w is not None:
        out["weighted_mean"] = round(float(np.average(x, weights=np.asarray(w, float))), 3)
    return out
