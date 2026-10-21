# 버스를 어디에 넣어야 승용차가 줄어드는가

**대중교통·승용차 통행시간비(PCTR)와 탄소 손익분기로 만든 경기도 출퇴근 버스 배치 기준**

숲과나눔 × 한겨레 「AI와 함께하는 교통문제 해결을 위한 데이터 분석 공모전」 출품작 · 팀 **버스타G** (박동수·이광호)

- 분석보고서: [`report/버스타G_분석보고서.pdf`](report/버스타G_분석보고서.pdf)

## 한 줄 요약

경기도가 2030년까지 늘리는 편하G버스 100회(출근 50 + 퇴근 50)를 **PCTR이 높은 경기 내부 산업단지 축**에 배치하면, 입력 14개를 하나씩 범위 끝으로 바꿔도 지금처럼 기존 노선에 비례해 늘리는 방식보다 늘 연 770 t 이상 덜 배출한다. 절대 감축은 새 승객 중 승용차 출신 비율 φ가 손익분기 0.26(44석 만석)을 넘을 때 생긴다: φ 0.5면 연 약 1,020 t 감축, 0.26이면 약 0, 비관 조합에서는 증편 보류(0 t). 현행 방식은 연 약 790 t(205~1,101 t) 증가.

## 방법 개요

| 단계 | 내용 | 코드 |
|---|---|---|
| ① 통근 축 | 국민연금 직장·거주지 OD(2025-12)에서 시군 경계를 넘는 1,000명 이상 축 532개 추출, 승용차 통근자 상위 20개 축 선정 | `pctr_commute/build_commute_axes.py`, `census_mode.py` |
| ② PCTR | 시군별 주민등록 인구 상위 5개 행정동의 주거 대표점(OSM 주거 건물을 면적×층수로 가중한 메도이드: 가중 거리 합이 최소인 실제 건물, 층수 미표기 시 아파트 15층 등 가정) → 목적지까지 승용차(평일 08:00 출발 예측)·대중교통 시간, 인구가중 평균 | `resid/aggregate.py`, `apimeasure/build_inputs.py` |
| ③ 수단 선택 | 인구총조사 2020 31개 시군: logit(승용차 분담률) = α + β·ln PCTR, 통근자 가중 회귀로 β = 3.20 | `pctr_commute/fit_beta.py`, `axis_model.py` |
| ④ 진단 | 보류 / 수요관리(PCTR < 1.5) / DRT 연계(도보 ≥ 20분 또는 30%) / 출퇴근 직행 | `axis_model.py` |
| ⑤ 탄소 손익분기 | 도로 부하식 + 윌런스 선 연료 모델, N* = (C₀ + r·C_dh)/(φ·c_car − c_pax) | `pctr_commute/breakeven.py` |
| ⑥ 증편 배분 | 수요 D = κ·Q·[(P_old − P_new)⁺ + θ(1 − P_old)], 현행 편하G 실적으로 κ·B 보정, 출근 50회 그리디 배분, 민감도 14개 입력(일변량) + 비관 조합 1개 | `axis_model.py`, `sensitivity.py` |

차량은 현대자동차 공식 제원(2026 카탈로그·가격표)을 기준으로 했다: 유니버스 디젤 44석(직행, 편하G 허용 좌석형 최대), 유니버스 수소전기버스 45인승(무공해 대안), 쏠라티 13인승(DRT, 똑버스 운영 사양), 쏘나타 2.0(승용차). 현대는 유니버스 디젤과 쏠라티의 공인연비·공차중량을 공개하지 않아 국내 실측·보고값으로 대신했다(보고서 표1, `sources/` 참고).

## 재현

```bash
pip install pandas numpy scipy matplotlib      # 그림 글꼴: fonts/ (Pretendard, SIL OFL 1.1)
cd pctr_commute
python3 fit_beta.py        # β = 3.204 재현
python3 breakeven.py --out be_result4   # 차량 보정 효율·손익분기 표
python3 axis_model.py      # 진단·배분 → result/allocation.json, result/axes_classified.csv
python3 sensitivity.py     # 민감도 → result/sensitivity.json, 비관 조합 → result/sensitivity_combo.json
cd ../report
python3 make_figs.py       # 그림 1~6 (그림1은 vuski/admdongkor의 HangJeongDong_ver20260701.geojson을 data/에 두어야 하며, 없으면 건너뜀)
npm i playwright && npx playwright install chromium
node make_pdf.js "$PWD/report.html" "$PWD/out.pdf"   # 수식은 report/mathjax(MathJax 3 tex-svg), 글꼴은 report/fonts 사용
```

- `resid/od_results.json`: 출발점 55곳 × 목적지 조합과 현행 노선의 통행시간(승용차: 카카오모빌리티 미래 운행 정보 길찾기 API, 대중교통: 카카오맵 길찾기 웹 화면 조회 값). `resid/aggregate.py`가 이를 인구가중 PCTR로 집계한다.
- 새로 측정하려면: ① `KAKAO_REST_KEY=<키> python3 apimeasure/measure_car_kakao.py` 로 `car_api.json` 생성(평일 08:00 출발 예측), ② 카카오맵 등으로 같은 127쌍의 대중교통 시간을 조회해 `{"key","tt","walk","xfer","trkm"}` JSON을 한 폴더에 저장, ③ `apimeasure/run_all.sh <그 폴더>`. 입력 형식은 `apimeasure/build_inputs.py` 머리말에 있다. **API 키와 API 원본 응답은 저장소에 넣지 않았다.** `od_results.json`의 `now`는 따로 재지 않아 `peak`와 같은 값이다.
- 대중교통 시간은 시각표·첨두 혼잡을 반영하지 않는 시간대 무관 대표값이다(낮·밤 조회값 동일).
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

## 데이터 출처

| 데이터 | 제공기관 | 출처 |
|---|---|---|
| 직장 거주지 이동 데이터 (2025-12) | 국민연금공단 | https://www.data.go.kr/data/15167424/fileData.do |
| 소요시간별·이용교통수단별 통근통학인구 (2020) | 통계청 | KOSIS DT_1PA2004 |
| 행정동별 주민등록 인구 (2026-09) | 행정안전부 | https://jumin.mois.go.kr/ |
| 행정동 경계 (2026-07) | vuski/admdongkor | https://github.com/vuski/admdongkor |
| 주거 건물 | OpenStreetMap | Overpass API |
| 편하G버스 노선·편성 | 경기도 | https://www.gg.go.kr/cont/easy_gbus/ |
| 승용차 통행시간 | 카카오모빌리티 | 미래 운행 정보 길찾기 API |
| 대중교통 통행시간 | 카카오 | 카카오맵 길찾기 (웹) |
| 대중교통 검증 | ODsay | ODsay LAB API |
| 차량 제원·공인연비 | 현대자동차, 한국에너지공단 | hyundai.com, min24.energy.or.kr |

입력값별 근거 문헌은 보고서 참고문헌과 `sources/`에 있다.

## AI 활용

Anthropic Claude(Claude 앱 에이전트 작업)로 선행 조사, 전처리·모델·민감도 코드 작성, 카카오맵 웹 조회 자동화, 근거 문헌 조사, 시각화와 보고서 초안을 진행했다. 문제의식, 대상지 선정 아이디어, 분석 방향과 결과 검토는 팀이 맡았다.
