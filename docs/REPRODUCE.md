# 재현 가이드 (개발자용)

보고서 수치를 처음부터 다시 계산하는 방법과 폴더 구조, 측정 세부를 정리한 문서다. 평가용 요약은 [README](../README.md)에 있다.

## 방법 개요

| 단계 | 내용 | 코드 |
|---|---|---|
| ① 통근 축 | 국민연금 직장·거주지 OD(2025-12)에서 시군 경계를 넘는 1,000명 이상 축 532개 추출, 승용차 통근자 상위 20개 축 선정 | `pctr_commute/build_commute_axes.py`, `census_mode.py` |
| ② PCTR | 시군별 주민등록 인구 상위 5개 행정동의 주거 대표점(OSM 주거 건물을 면적×층수로 가중한 메도이드: 가중 거리 합이 최소인 실제 건물, 층수 미표기 시 아파트 15층 등 가정) → 목적지까지 승용차(평일 08:00 출발 예측)·대중교통 시간, 인구가중 평균 | `resid/aggregate.py`, `apimeasure/build_inputs.py` |
| ③ 수단 선택 | 인구총조사 2020 31개 시군: logit(승용차 분담률) = α + β·ln PCTR, 통근자 가중 회귀로 β = 3.20 | `pctr_commute/fit_beta.py`, `axis_model.py` |
| ④ 진단 | 보류 / 수요관리(PCTR < 1.5) / DRT 연계(도보 ≥ 20분 또는 30%) / 출퇴근 직행 | `axis_model.py` |
| ⑤ 탄소 손익분기 | 도로 부하식 + 윌런스 선 연료 모델, N* = (C₀ + r·C_dh)/(φ·c_car − c_pax) | `pctr_commute/breakeven.py` |
| ⑥ 증편 배분 | 수요 D = κ·Q·[(P_old − P_new)⁺ + θ(1 − P_old)], 현행 편하G 실적으로 κ·B 보정, 출근 50회 그리디 배분, 민감도 15개 입력(일변량, β 포함) + 비관 조합 1개 + 2만 회 몬테카를로 | `axis_model.py`, `sensitivity.py` |

차량은 현대자동차 공식 제원(2026 카탈로그·가격표)을 기준으로 했다: 유니버스 디젤 44석(직행, 편하G 허용 좌석형 최대), 유니버스 수소전기버스 45인승(무공해 대안), 쏠라티 13인승(DRT, 똑버스 운영 사양), 쏘나타 2.0(승용차). 현대는 유니버스 디젤과 쏠라티의 공인연비·공차중량을 공개하지 않아 국내 실측·보고값으로 대신했다(보고서 표1, `sources/` 참고).

## 재현

```bash
pip install pandas numpy scipy matplotlib      # 그림 글꼴: fonts/ (Pretendard, SIL OFL 1.1)
cd pctr_commute
python3 fit_beta.py        # β = 3.204 재현
python3 breakeven.py --out be_result4   # 차량 보정 효율·손익분기 표
python3 axis_model.py      # 진단·배분 → result/allocation.json, result/axes_classified.csv
python3 sensitivity.py     # 민감도 → result/sensitivity.json, 비관 조합 → result/sensitivity_combo.json
python3 scenario_grid.py   # 회당 탑승 × φ 시나리오 → result/scenario_grid.json (보고서 표4)
python3 phi_proxy.py       # 비례 추출 φ(현재 승용차 분담) 비교 → result/phi_proxy*.{json,csv}
python3 capture_rate.py    # 기준(회당 승용차 출신 11명)을 넘는 데 필요한 전환율 → result/capture_rate.json
python3 montecarlo.py      # 탑승·φ·연비·회송·재차인원 동시 변화 2만 회 → result/montecarlo.json
cd ../report
python3 make_figs.py       # 그림 1~7 (그림1은 vuski/admdongkor의 HangJeongDong_ver20260701.geojson을 data/에 두어야 하며, 없으면 건너뜀)
npm i playwright && npx playwright install chromium
node make_pdf.js "$PWD/report.html" "$PWD/out.pdf"   # 수식은 report/mathjax(MathJax 3 tex-svg), 글꼴은 report/fonts 사용
```

- `resid/od_results.json`: 출발점 55곳 × 목적지 조합과 현행 노선의 통행시간(승용차: 카카오모빌리티 미래 운행 정보 길찾기 API, 대중교통: 카카오맵 길찾기 웹 화면 조회 값). `resid/aggregate.py`가 이를 인구가중 PCTR로 집계한다.
- 새로 측정하려면: ① `KAKAO_REST_KEY=<키> python3 apimeasure/measure_car_kakao.py` 로 `car_api.json` 생성(평일 08:00 출발 예측), ② 카카오맵 등으로 같은 127쌍의 대중교통 시간을 조회해 `{"key","tt","walk","xfer","trkm"}` JSON을 한 폴더에 저장, ③ `apimeasure/run_all.sh <그 폴더>`. 입력 형식은 `apimeasure/build_inputs.py` 머리말에 있다. **API 키와 API 원본 응답은 저장소에 넣지 않았다.** `od_results.json`의 `now`는 따로 재지 않아 `peak`와 같은 값이다.
- 대중교통 시간은 시각표·첨두 혼잡을 반영하지 않는 시간대 무관 대표값이다(카카오맵 PC웹에 출발시각 설정 없음, 낮·밤 조회값 동일).
- `apimeasure/remeasure/` (`summarize.py`로 인구가중 요약): 카카오맵 웹 출근시간(10/27 08:00 출발) 예측으로 잰 대체 목적지 20쌍과 교차확인 3쌍(승용차 08:00 예측은 API와 1분 이내 일치).
- 대중교통 시간 검증: ODsay API 29쌍과 비교, 상관계수 0.78, 소요시간 비율 중앙값 1.02 (`apimeasure/odsay_validation.json`).

## 폴더

```
pctr_commute/   모델 코드, 인구총조사 정리본(census/), 결과(result/), 손익분기 결과(be_result4/)
resid/          행정동 대표점, 통행시간 측정값, 인구가중 집계
apimeasure/     측정 대상 좌표(jobs.txt, coords.json), 입력 생성·전체 실행 스크립트
report/         보고서 HTML·PDF, 그림 스크립트, 그림, PDF용 글꼴(fonts/)·MathJax
fonts/          그림용 Pretendard TTF (SIL OFL 1.1)
data/           국민연금 직장·거주지 이동 데이터(2025-12), KOSIS DT_1PA2004(2020)
sources/        입력값 근거 조사 기록(차량 제원, 수요·운영 파라미터)
```


## 소개 페이지 (docs/)

GitHub Pages용 정적 페이지다. 빌드 과정 없이 docs/를 그대로 서빙한다.

- `docs/data/build_model_json.py`: 모델 결과를 `docs/data/model.json`으로 내보낸다(axis_model·breakeven을 import, 기준 배분이 allocation.json과 같은지 assert).
- `docs/data/build_sgg_outline.py`: vuski/admdongkor 행정동 경계(ver20260701)를 시군·자치구 단위로 합치고 단순화해 `docs/data/sgg_outline.json`을 만든다(shapely 필요).
- `docs/js/model.js`: 손익분기·연간 순감축·배분·몬테카를로를 브라우저에서 계산하는 모듈. `node docs/js/model.test.mjs`로 보고서 수치 재현을 검증한다.
- 로컬 미리보기: `python3 -m http.server -d docs` 후 http://localhost:8000 (ES 모듈이라 file://로는 동작하지 않는다).
