# 버스를 어디에 넣어야 승용차가 줄어드는가

**대중교통·승용차 통행시간비(PCTR)와 탄소 손익분기로 만든 경기도 출퇴근 버스 배치 기준**

숲과나눔 × 한겨레 「AI와 함께하는 교통문제 해결을 위한 데이터 분석 공모전」 출품작 · 팀 **버스타G** (박동수·이광호)

- 분석보고서: [`report/버스타G_분석보고서.pdf`](report/버스타G_분석보고서.pdf)

## 한 줄 요약

경기도가 2030년까지 늘리는 편하G버스 100회(출근 50 + 퇴근 50)를 **PCTR이 높은 경기 내부 산업단지 축**에 배치하면 연 약 1,020 tCO₂가 줄어든다. 지금처럼 기존 노선에 비례해 늘리면 오히려 연 약 790 t이 늘어난다. 입력값 11개를 근거 범위 끝까지 바꿔도 두 결과의 범위는 겹치지 않았다.

## 방법 개요

| 단계 | 내용 | 코드 |
|---|---|---|
| ① 통근 축 | 국민연금 직장·거주지 OD(2025-12)에서 시군 경계를 넘는 1,000명 이상 축 532개 추출, 승용차 통근자 상위 20개 축 선정 | `pctr_commute/build_commute_axes.py`, `census_mode.py` |
| ② PCTR | 시군별 주민등록 인구 상위 5개 행정동의 주거 대표점(OSM 건물 면적×층수 가중) → 목적지까지 승용차(평일 08:00 출발 예측)·대중교통 시간, 인구가중 평균 | `resid/aggregate.py`, `apimeasure/build_inputs.py` |
| ③ 수단 선택 | 인구총조사 2020 31개 시군: logit(승용차 분담률) = α + β·ln PCTR, 통근자 가중 회귀로 β = 3.20 | `pctr_commute/fit_beta.py`, `axis_model.py` |
| ④ 진단 | 보류 / 수요관리(PCTR < 1.5) / DRT 연계(도보 ≥ 20분 또는 30%) / 출퇴근 직행 | `axis_model.py` |
| ⑤ 탄소 손익분기 | 도로 부하식 + 윌런스 선 연료 모델, N* = (C₀ + r·C_dh)/(φ·c_car − c_pax) | `pctr_commute/breakeven.py` |
| ⑥ 증편 배분 | 수요 D = κ·Q·[(P_old − P_new)⁺ + θ(1 − P_old)], 현행 편하G 실적으로 κ·B 보정, 출근 50회 그리디 배분, 민감도 11개 입력 | `axis_model.py`, `sensitivity.py` |

차량은 현대자동차 공식 제원(2026 카탈로그·가격표)을 기준으로 했다: 유니버스 디젤 44석(직행), 유니버스 수소전기버스 45인승(무공해 대안), 쏠라티 13인승(DRT, 똑버스 운영 사양), 쏘나타 2.0(승용차). 현대는 유니버스 디젤과 쏠라티의 공인연비·공차중량을 공개하지 않아 국내 실측·보고값으로 대신했다(보고서 표1, `sources/` 참고).

## 재현

```bash
pip install pandas numpy scipy matplotlib
cd pctr_commute
python3 fit_beta.py        # β = 3.204 재현
python3 breakeven.py --out be_result4   # 차량 보정 효율·손익분기 표
python3 axis_model.py      # 진단·배분 → result/allocation.json, result/axes_classified.csv
python3 sensitivity.py     # 민감도 → result/sensitivity.json
cd ../report
python3 make_figs.py       # 그림 1~6 (그림1은 행정동 경계 geojson을 data/에 두어야 함)
node make_pdf.js "$PWD/report.html" "$PWD/out.pdf"   # Playwright 필요
```

- `resid/od_results.json`: 출발점 55곳 × 목적지 조합과 현행 노선의 통행시간(승용차: 카카오모빌리티 미래 운행 정보 길찾기 API, 대중교통: 카카오맵 길찾기 웹 화면 조회 값). `resid/aggregate.py`가 이를 인구가중 PCTR로 집계한다.
- 새로 측정하려면 `apimeasure/jobs.txt`(127쌍 좌표)로 각자 발급한 키를 써서 조회한 뒤 `apimeasure/run_all.sh <대중교통 결과 폴더>`를 실행한다. **API 키와 API 원본 응답은 저장소에 넣지 않았다.**
- 대중교통 시간 검증: ODsay API 29쌍과 비교, 상관계수 0.78, 소요시간 비율 중앙값 1.02 (`apimeasure/odsay_validation.json`).

## 폴더

```
pctr_commute/   모델 코드, 인구총조사 정리본(census/), 결과(result/), 손익분기 결과(be_result4/)
resid/          행정동 대표점, 통행시간 측정값, 인구가중 집계
apimeasure/     측정 대상 좌표(jobs.txt, coords.json), 입력 생성·전체 실행 스크립트
report/         보고서 HTML·PDF, 그림 스크립트, 그림
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
