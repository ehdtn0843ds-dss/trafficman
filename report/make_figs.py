"""보고서용 그림 6장 (300 dpi, 폭 16 cm, Pretendard)"""
import json, re, sys
from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm
from matplotlib.lines import Line2D
from matplotlib.patches import Patch

ROOT = Path(__file__).resolve().parents[1]
P = ROOT / "pctr_commute"
RES = ROOT / "resid"
OUT = ROOT / "report/figs"; OUT.mkdir(parents=True, exist_ok=True)
FD = ROOT / "fonts"   # Pretendard OTF를 여기에 두면 사용 (없으면 기본 글꼴)
for w in ("Regular", "Medium", "SemiBold", "Bold"):
    if (FD / f"Pretendard-{w}.ttf").exists():
        fm.fontManager.addfont(str(FD / f"Pretendard-{w}.ttf"))
plt.rcParams.update({
    "font.family": "Pretendard", "font.size": 8.5, "axes.titlesize": 9.5, "axes.titleweight": "semibold",
    "axes.labelsize": 8.5, "xtick.labelsize": 7.5, "ytick.labelsize": 7.5, "legend.fontsize": 7.5,
    "axes.edgecolor": "#9aa3af", "axes.linewidth": 0.6, "xtick.color": "#4b5563", "ytick.color": "#4b5563",
    "axes.labelcolor": "#1f2937", "text.color": "#1f2937", "axes.unicode_minus": False,
    "savefig.dpi": 300, "savefig.facecolor": "white", "figure.facecolor": "white",
    "axes.spines.top": False, "axes.spines.right": False, "legend.frameon": False,
})
BLUE, ORANGE, AQUA, YELLOW = "#2a78d6", "#eb6834", "#1baf7a", "#eda100"
GRAY, LGRAY, INK2, MUTED = "#8a94a3", "#d5dae1", "#374151", "#6b7280"
VIOLET = "#7a5cc7"
CM = 1 / 2.54
W = 16 * CM
CLS = {"DRT 연계": AQUA, "출퇴근 직행": BLUE, "수요관리": ORANGE, "보류": GRAY}

ax_df = pd.read_csv(P / "result/axes_classified.csv")
alloc = json.load(open(P / "result/allocation.json", encoding="utf-8"))
sens = json.load(open(P / "result/sensitivity.json", encoding="utf-8"))
alloc_keys = set(alloc["alloc_ours"].keys())
ax_df["key"] = ax_df["o"] + "→" + ax_df["d"]
ax_df["alloc"] = ax_df["key"].map(lambda k: alloc["alloc_ours"].get(k, 0))
ax_df["seoul"] = ax_df["d"].str.startswith("서울")
short_o = lambda s: re.sub(r"시$", "", s)
def short_d(d):
    d = d.replace("서울 ", "서울 ")
    return re.sub(r"시 ", " ", re.sub(r"시$", "", d))
ax_df["name"] = ax_df["o"].map(short_o) + " → " + ax_df["d"].map(short_d)


def grid(ax, axis="y"):
    ax.grid(axis=axis, color="#e5e7eb", lw=0.5, zorder=0)
    ax.set_axisbelow(True)


def save(fig, name):
    fig.savefig(OUT / name, bbox_inches="tight", pad_inches=0.06)
    plt.close(fig)
    print("saved", name)


# ───────────── 그림 1: 통근 축 개략도 ─────────────
def fig1():
    import shapely.geometry as sg
    from shapely.ops import unary_union
    g = json.load(open(ROOT / "data/HangJeongDong_ver20260701.geojson"))
    sido = {}
    for f in g["features"]:
        p = f["properties"]
        if p["sidonm"] not in ("경기도", "서울특별시", "인천광역시"):
            continue
        city = re.match(r"^(.+?[시군구])", p["sggnm"]).group(1) if p["sidonm"] == "경기도" else p["sidonm"]
        sido.setdefault((p["sidonm"], city), []).append(sg.shape(f["geometry"]).buffer(0))
    pts = json.load(open(RES / "origin_points.json", encoding="utf-8"))
    orig = {}
    for k, v in pts.items():
        c = k.split("|")[0] + "시"
        orig.setdefault(c, []).append((v["med"][0], v["med"][1], v["pop"]))
    O = {c: (sum(a * w for a, b, w in L) / sum(w for *_, w in L), sum(b * w for a, b, w in L) / sum(w for *_, w in L)) for c, L in orig.items()}
    D = {"삼성디지털시티": (37.25729, 127.05209), "삼성화성캠퍼스": (37.21853, 127.06596), "정자역": (37.36644, 127.10827),
         "강남역": (37.49795, 127.02762), "반월산단": (37.31362, 126.76022), "LG디스플레이파주": (37.81067, 126.76724),
         "기아화성공장": (37.03545, 126.75796), "양재역": (37.4846, 127.0346), "여의도역": (37.52156, 126.92449),
         "시화산단": (37.34939, 126.71088), "현대차남양연구소": (37.15568, 126.82673), "시청역": (37.56548, 126.97711)}
    fig, ax = plt.subplots(figsize=(W, W * 1.05))
    for (sd, city), polys in sido.items():
        u = unary_union(polys)
        geoms = getattr(u, "geoms", [u])
        for gm in geoms:
            x, y = gm.exterior.xy
            fc = "#f3f4f6" if sd == "서울특별시" else ("#fafafa" if sd == "경기도" else "white")
            ax.fill(x, y, fc=fc, ec="#c7ccd4" if sd == "경기도" else "#dfe3e8", lw=0.35, zorder=1)
    qmax = ax_df["Q_car"].max()
    for _, r in ax_df.sort_values("Q_car").iterrows():
        o = O[r["o"]]; d = D[r["dest"]]
        col = BLUE if r["seoul"] else ORANGE
        lw = 0.6 + 5.5 * r["Q_car"] / qmax
        # 약간 휜 선
        mx, my = (o[1] + d[1]) / 2, (o[0] + d[0]) / 2
        dx, dy = d[1] - o[1], d[0] - o[0]
        cx, cy = mx - dy * 0.12, my + dx * 0.12
        t = np.linspace(0, 1, 40)
        xs = (1 - t) ** 2 * o[1] + 2 * (1 - t) * t * cx + t ** 2 * d[1]
        ys = (1 - t) ** 2 * o[0] + 2 * (1 - t) * t * cy + t ** 2 * d[0]
        if r["alloc"] > 0:
            ax.plot(xs, ys, color="white", lw=lw + 2.6, solid_capstyle="round", zorder=3)
            ax.plot(xs, ys, color="#111827", lw=lw + 1.4, solid_capstyle="round", zorder=3.1, alpha=0.85)
        ax.plot(xs, ys, color=col, lw=lw, solid_capstyle="round", alpha=0.9 if r["alloc"] else 0.55, zorder=3.2)
    coff = {"수원시": (-6, 6, "right"), "파주시": (-6, 4, "right"), "고양시": (6, -9, "left"), "화성시": (-6, -10, "right"),
            "용인시": (6, -9, "left"), "안산시": (6, -4, "left"), "시흥시": (6, -2, "left"), "오산시": (6, -9, "left"),
            "평택시": (6, -9, "left"), "성남시": (6, -9, "left"), "남양주시": (6, -2, "left")}
    for c, (la, lo) in O.items():
        ax.scatter(lo, la, s=26, c="white", ec=INK2, lw=0.9, zorder=5)
        dx, dy, ha = coff.get(c, (4, -9, "left"))
        ax.annotate(short_o(c), (lo, la), xytext=(dx, dy), textcoords="offset points", fontsize=7.5, weight="semibold", color=INK2, zorder=6, ha=ha,
                    bbox=dict(boxstyle="round,pad=0.1", fc="white", ec="none", alpha=0.8))
    lab = {"강남역": (4, 3), "여의도역": (-4, 5), "시청역": (4, 4), "양재역": (5, -6), "정자역": (5, -2),
           "삼성디지털시티": (6, 4), "삼성화성캠퍼스": (6, -6), "반월산단": (-6, -9), "시화산단": (-6, 5),
           "LG디스플레이파주": (5, 2), "기아화성공장": (-6, -9), "현대차남양연구소": (-6, -9)}
    nm = {"LG디스플레이파주": "LG디스플레이 파주", "삼성디지털시티": "삼성 디지털시티", "삼성화성캠퍼스": "삼성 화성캠퍼스",
          "기아화성공장": "기아 화성공장", "현대차남양연구소": "현대차 남양연구소"}
    for k, (la, lo) in D.items():
        ax.scatter(lo, la, s=22, marker="s", c=INK2, zorder=5)
        dx, dy = lab[k]
        ax.annotate(nm.get(k, k), (lo, la), xytext=(dx, dy), textcoords="offset points", fontsize=6.8, color=MUTED,
                    ha="right" if dx < 0 else "left", zorder=6)
    ax.set_xlim(126.62, 127.42); ax.set_ylim(36.95, 37.92)
    ax.set_aspect(1 / np.cos(np.radians(37.4)))
    ax.axis("off")
    h = [Line2D([0], [0], color=ORANGE, lw=3, label="경기 내부 축"), Line2D([0], [0], color=BLUE, lw=3, label="서울행 축"),
         Line2D([0], [0], color="#111827", lw=4.5, label="2030 증편 배분 축 (테두리)"),
         Line2D([0], [0], marker="o", color="white", mec=INK2, lw=0, ms=5, label="출발 시군 (주거지 5곳 인구가중 중심)"),
         Line2D([0], [0], marker="s", color=INK2, lw=0, ms=4, label="목적지 업무지")]
    ax.legend(handles=h, loc="upper center", bbox_to_anchor=(0.5, -0.01), ncol=2, fontsize=7, handlelength=2.2)
    ax.text(127.40, 37.905, "선 굵기 = 축별 승용차 통근자(보정)\n최대 약 3.3만 명 (화성 → 수원 영통)", ha="right", va="top", fontsize=6.8, color=MUTED)
    save(fig, "fig1_axes_map.png")


# ───────────── 그림 2: 축별 PCTR ─────────────
def fig2():
    d = ax_df.sort_values("PCTR")
    fig, ax = plt.subplots(figsize=(W, W * 0.62))
    y = np.arange(len(d))
    for i, (_, r) in enumerate(d.iterrows()):
        col = BLUE if r["seoul"] else ORANGE
        ax.plot([r["PCTR_min"], r["PCTR_max"]], [i, i], color=col, lw=3.2, alpha=0.28, solid_capstyle="round", zorder=2)
        ax.scatter(r["PCTR_single"], i, s=16, facecolor="white", edgecolor=GRAY, lw=0.9, zorder=3)
        ax.scatter(r["PCTR"], i, s=34, color=col, edgecolor="white", lw=0.8, zorder=4)
        ax.text(max(r["PCTR_max"], r["PCTR_single"]) + 0.06, i, f"{r['PCTR']:.2f}", va="center", fontsize=6.8, color=INK2,
                bbox=dict(boxstyle="round,pad=0.08", fc="white", ec="none", alpha=0.9), zorder=5)
    ax.axvline(1.0, color=INK2, lw=0.8, zorder=1)
    ax.axvline(1.5, color=INK2, lw=0.8, ls=(0, (4, 3)), zorder=1)
    ax.text(1.0, len(d) - 0.3, "PCTR 1\n(같은 시간)", fontsize=6.5, color=MUTED, ha="center", va="bottom")
    ax.text(1.5, len(d) - 0.3, "1.5\n(분류 기준)", fontsize=6.5, color=MUTED, ha="center", va="bottom")
    ax.set_yticks(y); ax.set_yticklabels(d["name"], fontsize=7)
    ax.set_xlim(0.4, 3.25); ax.set_ylim(-0.7, len(d) + 0.9)
    ax.set_xlabel("PCTR = 대중교통 시간 ÷ 승용차 출근 피크 시간 (주거지 5곳 인구가중 평균)")
    grid(ax, "x")
    h = [Line2D([0], [0], marker="o", color=ORANGE, lw=0, ms=5, label="경기 내부 축"),
         Line2D([0], [0], marker="o", color=BLUE, lw=0, ms=5, label="서울행 축"),
         Line2D([0], [0], color=GRAY, lw=3, alpha=0.4, label="출발점 5곳 범위"),
         Line2D([0], [0], marker="o", color="white", mec=GRAY, lw=0, ms=4.5, label="이전 값 (구청·역 한 곳)")]
    ax.legend(handles=h, loc="lower right", fontsize=7)
    save(fig, "fig2_pctr_axes.png")


# ───────────── 그림 3: 분류 매트릭스 ─────────────
def fig3():
    fig, ax = plt.subplots(figsize=(W, W * 0.6))
    ax.set_xscale("log")
    ax.axvspan(1.5, 3.4, ymin=0, ymax=1, color=AQUA, alpha=0.06, zorder=0)
    ax.axvline(1.5, color=INK2, lw=0.8, ls=(0, (4, 3)))
    ax.axhline(3000, color=INK2, lw=0.8, ls=(0, (4, 3)))
    for cls, col in CLS.items():
        s = ax_df[ax_df["class"] == cls]
        ax.scatter(s["PCTR"], s["Q_car"], s=42, color=col, edgecolor="white", lw=0.9, zorder=4, label=f"{cls} ({len(s)})")
    a = ax_df[ax_df["alloc"] > 0]
    ax.scatter(a["PCTR"], a["Q_car"], s=120, facecolor="none", edgecolor="#111827", lw=1.0, zorder=5)
    off = {"화성→수원 영통": (-10, 2, "right"), "수원→화성": (-10, 2, "right"), "고양→파주": (-10, 3, "right"),
           "평택→화성": (0, -16, "center"), "시흥→안산 단원": (-10, 3, "right"), "안산→시흥": (-10, 4, "right"),
           "안산→화성": (-9, -13, "right")}
    for _, r in a.iterrows():
        k = r["name"].replace(" → ", "→")
        dx, dy, ha = off.get(k, (8, 3, "left"))
        ax.annotate(f"{r['name']}  출근 {int(r['alloc'])}회", (r["PCTR"], r["Q_car"]), xytext=(dx, dy), textcoords="offset points",
                    fontsize=6.8, ha=ha, color=INK2, zorder=6,
                    bbox=dict(boxstyle="round,pad=0.12", fc="white", ec="none", alpha=0.85))
    ax.text(3.3, 23000, "버스 투입 후보\n(PCTR ≥ 1.5)", ha="right", va="center", fontsize=7, color=INK2, weight="semibold")
    ax.text(0.47, 34500, "수요관리\n(PCTR < 1.5)", ha="left", va="top", fontsize=7, color=INK2, weight="semibold")
    ax.text(0.47, 3300, "보류 (승용차 통근자 < 3,000명)", ha="left", va="bottom", fontsize=6.6, color=MUTED)
    ax.set_xlim(0.45, 3.4); ax.set_ylim(0, 36000)
    ax.set_xticks([0.5, 0.7, 1, 1.5, 2, 3]); ax.set_xticklabels(["0.5", "0.7", "1", "1.5", "2", "3"])
    ax.minorticks_off()
    ax.set_yticks(range(0, 36000, 10000))
    ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"{v/10000:.0f}만" if v else "0"))
    ax.set_xlabel("축별 PCTR (로그 눈금)"); ax.set_ylabel("축별 승용차 통근자 (명, 보정)")
    grid(ax, "y")
    h, l = ax.get_legend_handles_labels()
    h.append(Line2D([0], [0], marker="o", color="white", mec="#111827", lw=0, ms=8)); l.append("증편 배분 축")
    ax.legend(h, l, loc="upper center", ncol=5, bbox_to_anchor=(0.5, 1.13), fontsize=7, handletextpad=0.3, columnspacing=1.0)
    save(fig, "fig3_matrix.png")


# ───────────── 그림 4: 손익분기 ─────────────
def fig4():
    sys.path.insert(0, str(P))
    import axis_model as m
    m.main(verbose=False)
    import breakeven as be
    from dataclasses import replace as rp
    cal = {}
    for key, veh in [("car", be.CAR), ("coach", be.COACH), ("fcev", be.FCEV)]:
        tgt, segs, _, aux = be.CALIB[key]
        if key == "coach":
            tgt = 1 / m.COACH_KMPL
        cv = be.calibrate(rp(veh, P_aux_kW=aux) if aux is not None else veh, segs, tgt)
        cal[key] = rp(cv, P_aux_kW=veh.P_aux_kW)
    CAP = m.COACH_CAP
    res = {r: be.breakeven(cal["coach"], cal["car"], 25.0, 45.0, 1.0, 1.0, r, 1.1, "direct") for r in (1.0, 0.5)}
    rf = be.breakeven(cal["fcev"], cal["car"], 25.0, 45.0, 1.0, 1.0, 1.0, 1.1, "direct")
    N = np.linspace(0, CAP, 200)
    fig, ax = plt.subplots(figsize=(W, W * 0.52))
    ax.axhline(0, color=INK2, lw=0.8)
    for phi, col in ((m.PHI_MAX, AQUA), (0.25, ORANGE)):
        for r, ls in ((1.0, "-"), (0.5, (0, (4, 3)))):
            b = res[r]
            f = N * phi * b["c_car"] - (b["C0"] + N * b["c_pax"]) - r * b["C_dh"]
            ax.plot(N, f, color=col, lw=1.8, ls=ls, zorder=3)
            den = phi * b["c_car"] - b["c_pax"]
            ns = (b["C0"] + r * b["C_dh"]) / den
            if ns <= CAP:
                ax.scatter(ns, 0, s=30, color=col, edgecolor="white", lw=0.9, zorder=4)
                ax.annotate(f"N* {ns:.1f}명", (ns, 0), xytext=(0, 7 if r == 1.0 else -12), textcoords="offset points",
                            ha="center", fontsize=6.8, color=INK2, bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.9), zorder=6)
            else:
                ax.annotate(f"N* {ns:.1f}명 > 정원", (CAP, f[-1]), xytext=(-3, -10 if r == 1.0 else 5), textcoords="offset points",
                            ha="right", fontsize=6.8, color=INK2, bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.9), zorder=6)
    ff = N * 0.25 * rf["c_car"] - (rf["C0"] + N * rf["c_pax"]) - rf["C_dh"]
    ax.plot(N, ff, color=VIOLET, lw=1.5, ls=(0, (1, 1.5)), zorder=3)
    nsf = (rf["C0"] + rf["C_dh"]) / (0.25 * rf["c_car"] - rf["c_pax"])
    if nsf <= CAP:
        ax.scatter(nsf, 0, s=24, color=VIOLET, edgecolor="white", lw=0.9, zorder=4)
        ax.annotate(f"수소 N* {nsf:.1f}명", (nsf, 0), xytext=(0, -12), textcoords="offset points", ha="center", fontsize=6.6, color=INK2, bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.9), zorder=6)
    ax.axvline(CAP, color=GRAY, lw=0.6)
    ax.text(CAP - 0.4, ax.get_ylim()[1] * 0.92, f"정원 {CAP}석", ha="right", fontsize=6.8, color=MUTED)
    ax.axvline(19.5, color=GRAY, lw=0.6, ls=(0, (1, 2)))
    ax.text(19.7, ax.get_ylim()[0] * 0.9, "편하G 회당\n19.5명(가정)", fontsize=6.6, color=MUTED, va="bottom")
    ax.set_xlim(0, CAP + 1.5)
    ax.set_xlabel("버스 1회 탑승인원 N (명)"); ax.set_ylabel("1회 운행 순감축량 (kg CO₂)")
    grid(ax, "y")
    h = [Line2D([0], [0], color=AQUA, lw=2, label=f"디젤 φ {m.PHI_MAX:g} (상한)"),
         Line2D([0], [0], color=ORANGE, lw=2, label="디젤 φ 0.25 (현행 노선 보정)"),
         Line2D([0], [0], color=VIOLET, lw=1.5, ls=(0, (1, 1.5)), label="수소버스 φ 0.25, r 1.0"),
         Line2D([0], [0], color=INK2, lw=1.5, label="회송 r 1.0 (기준)"),
         Line2D([0], [0], color=INK2, lw=1.5, ls=(0, (4, 3)), label="회송 r 0.5")]
    ax.legend(handles=h, loc="upper left", fontsize=7)
    save(fig, "fig4_breakeven.png")


# ───────────── 그림 5: 배분 비교 + 민감도 ─────────────
def fig5():
    o, b = alloc["ours"], alloc["base"]
    fig = plt.figure(figsize=(W, W * 0.62))
    gs = fig.add_gridspec(1, 2, width_ratios=[1, 1.55], wspace=0.42)
    a1 = fig.add_subplot(gs[0])
    vals = [o["t_year"], b["t_year"]]
    bars = a1.bar([0, 1], vals, color=[BLUE, ORANGE], width=0.55, zorder=3)
    a1.axhline(0, color=INK2, lw=0.8)
    for x, v, s in zip([0, 1], vals, [o["car_shift"], b["car_shift"]]):
        a1.text(x, v + (40 if v > 0 else -40), f"{v:+,.0f} t", ha="center", va="bottom" if v > 0 else "top", fontsize=8, weight="semibold")
        a1.text(x, (-80 if v > 0 else 80), f"승용차 전환\n하루 {s:,.0f}명", ha="center", va="top" if v > 0 else "bottom", fontsize=6.8, color=MUTED)
    a1.set_xticks([0, 1]); a1.set_xticklabels(["PCTR 기준\n배분", "현행 방식\n배분"])
    a1.set_ylabel("연간 순감축 (t CO₂, +는 감축)")
    lo_, hi_ = min(vals + [0]), max(vals + [0])
    a1.set_ylim(lo_ - 350, hi_ + 300)
    a1.set_title("(a) 2030 증편 100회\n(출근 50 + 퇴근 50)", loc="left", pad=20, fontsize=8)
    grid(a1, "y")
    a2 = fig.add_subplot(gs[1])
    NAME = {"THETA": "θ 대중교통 이동 비율", "TARGET_PHI": "현행 노선 φ 보정값", "TARGET_RIDE": "현행 회당 탑승 보정값",
            "R_DH": "r 회송 비율", "MAX_TRIPS": "축당 상한 (회)", "DRT_WAIT": "DRT 대기 (분)", "COACH_KMPL": "디젤버스 연비 (km/L)", "COACH_CAP": "직행 정원 (석)",
            "PHI_MAX": "φ 상한", "DETOUR": "직행 차내시간 비율", "ACCESS_DIRECT": "정류장 접근 (분)"}
    df = pd.DataFrame(sens)
    XL = (min(df.base_t.min(), df.ours_t.min()) - 150, max(df.ours_t.max(), df.base_t.max()) + 150)
    keys = list(NAME)
    for i, k in enumerate(keys):
        g = df[df.param == k]
        y = len(keys) - 1 - i
        for col, f, dy in ((BLUE, "ours_t", 0.16), (ORANGE, "base_t", -0.16)):
            a2.plot([g[f].min(), g[f].max()], [y + dy, y + dy], color=col, lw=4, solid_capstyle="round", alpha=0.85, zorder=3)
        a2.scatter([o["t_year"], b["t_year"]], [y + 0.16, y - 0.16], s=10, color=INK2, zorder=4)
        vals = g["value"].tolist()
        a2.text(XL[0] - 40, y, f"{NAME[k]}\n{min(vals):g}~{max(vals):g}", ha="right", va="center", fontsize=6.4, color=INK2)
    a2.axvline(0, color=INK2, lw=0.8)
    a2.set_xlim(*XL); a2.set_yticks([])
    a2.spines["left"].set_visible(False)
    a2.set_xlabel("연간 순감축 (t CO₂)")
    a2.set_title("(b) 가정값을 하나씩 범위 끝으로 바꿨을 때", loc="left", pad=20)
    grid(a2, "x")
    h = [Line2D([0], [0], color=BLUE, lw=4, label="PCTR 기준"), Line2D([0], [0], color=ORANGE, lw=4, label="현행 방식"),
         Line2D([0], [0], marker="o", color=INK2, lw=0, ms=3, label="기준값")]
    a2.legend(handles=h, loc="lower center", bbox_to_anchor=(0.5, 1.0), ncol=3, fontsize=6.8, handlelength=1.6)
    save(fig, "fig5_allocation.png")


# ───────────── 그림 6: 인구총조사 PCTR vs 승용차 분담률 ─────────────
def fig6():
    c = pd.read_csv(P / "census/gyeonggi_commute_mode_2020.csv")
    c["시군"] = c["시군"].str.strip()
    x, y = c["PCTR_obs"], c["s_car"]
    r = np.corrcoef(x, y)[0, 1]
    fig, ax = plt.subplots(figsize=(W, W * 0.55))
    xx = np.linspace(1.08, 2.02, 100)
    ax.plot(xx, 1 / (1 + np.exp(-(-1.05 + 3.20 * np.log(xx)))), color=INK2, lw=1.4, ls=(0, (4, 3)), zorder=2)
    ax.scatter(x, y, s=34, color=BLUE, edgecolor="white", lw=0.9, zorder=3)
    named = {"광명시", "성남시", "여주시", "연천군", "화성시", "수원시", "가평군", "부천시", "안성시", "평택시", "고양시"}
    for _, rr in c.iterrows():
        if rr["시군"] in named:
            dx, dy = {"수원시": (5, 6), "고양시": (5, -9)}.get(rr["시군"], (5, 2))
            ax.annotate(re.sub(r"[시군]$", "", rr["시군"]), (rr["PCTR_obs"], rr["s_car"]), xytext=(dx, dy), textcoords="offset points", fontsize=6.6, color=INK2)
    ax.yaxis.set_major_formatter(matplotlib.ticker.PercentFormatter(1.0, decimals=0))
    ax.set_xlabel("관측 PCTR (대중교통 ÷ 승용차 평균 출근시간, 2020)")
    ax.set_ylabel("승용차 통근 분담률")
    ax.text(0.02, 0.96, f"경기 31개 시군, r = {r:.2f}\n로짓 적합: logit(s) = −1.05 + 3.20·ln(PCTR)", transform=ax.transAxes,
            va="top", fontsize=7, color=INK2)
    grid(ax, "both")
    save(fig, "fig6_census_logit.png")


if __name__ == "__main__":
    which = sys.argv[1:] or ["1", "2", "3", "4", "5", "6"]
    for w in which:
        globals()[f"fig{w}"]()
