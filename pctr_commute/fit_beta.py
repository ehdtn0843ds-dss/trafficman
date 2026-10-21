"""β 추정: 경기 31개 시군의 관측 PCTR과 승용차 통근 분담률(인구총조사 2020)
logit(s_car) = α + β·ln(PCTR_obs) 를 시군 통근자 수로 가중한 최소제곱으로 적합 → α ≈ −1.05, β ≈ 3.20"""
import numpy as np, pandas as pd
from pathlib import Path
c = pd.read_csv(Path(__file__).parent / "census/gyeonggi_commute_mode_2020.csv")
x, y, w = np.log(c["PCTR_obs"]), c["s_car"], c["통근자"]
A = np.vstack([np.ones_like(x), x]).T
W = np.diag(w)
alpha, beta = np.linalg.solve(A.T @ W @ A, A.T @ W @ np.log(y / (1 - y)))
r = np.corrcoef(c["PCTR_obs"], y)[0, 1]
print(f"alpha = {alpha:.3f}, beta = {beta:.3f}, r(PCTR, s_car) = {r:.2f}, n = {len(c)}")
