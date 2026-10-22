# 소개 페이지 디자인 시스템

`css/site.css` 하나에 토큰과 컴포넌트가 다 있어요. 시뮬레이터와 축 탐색기는 새 CSS를 만들기보다 아래 클래스를 먼저 써 주세요. 꼭 필요하면 `css/simulator.css`처럼 따로 파일을 두고 토큰(`var(--...)`)만 써서 색과 글꼴을 맞춰 주세요.

## 토큰

| 변수 | 값 | 쓰임 |
|---|---|---|
| `--asphalt` | #1E2830 | 본문 글자, 상단 표시판, 기본 버튼·슬라이더 |
| `--panel` | #EDF1F4 | 정류장 안내판 같은 옅은 면 (`.sec--panel`) |
| `--paper` | #FFFFFF | 기본 바탕, 패널 |
| `--line` / `--line-soft` / `--line-strong` | #C6D0D8 / #DDE4E9 / #8C99A4 | 구분선 / 차트 격자 / 차트 축 |
| `--muted` | #5B6873 | 캡션, 축 라벨 |
| `--car` | #EB6834 | 승용차 출신 승객, 경기 내부 축, PCTR 기준 |
| `--transit` | #7FA3C6 | 대중교통 출신 승객, 대중교통 시간 |
| `--seoul` | #2A78D6 | 서울행 축, 현행 방식 |
| `--cut` / `--add` | #13865F / #C2362B | 순감축 / 순증가 (부호가 있는 값은 항상 이 둘) |
| `--cut-ink` | #0B6446 | 순감축을 **작은 글자**로 쓸 때 (`.pos`, `.t-cut`, `--cut-tint` 위 글자). `--cut`은 면·막대·큰 숫자에만 |
| `--focus` / `--focus-color` / `--focus-ring` | `3px solid #1B2A6E` / #1B2A6E / `0 0 0 2px #fff` | 포커스 표시. 의미 색과 겹치지 않는 진한 남색 |
| `--car-ink` `--transit-ink` `--seoul-ink` | 진한 변형 | 이 색을 **글자**로 쓸 때 (흰 바탕 4.5:1) |
| `--*-tint` | 옅은 변형 | 칸 바탕, 강조 면 |
| `--display` | Black Han Sans | h1·h2, 결과 숫자만 |
| `--body` | IBM Plex Sans KR | 나머지 전부 |
| `--fs-xs`~`--fs-2xl`, `--fs-num` | 13 / 14.5 / 17 / 20 / 26 / 28~36 / 34~56 px | 글자 크기 단계 |
| `--s1`~`--s8` | 4 / 8 / 12 / 16 / 24 / 32 / 48 / 72 px | 간격 |
| `--r-ctl` `--r-panel` `--r-pill` | 4px / 6px / 999px | 입력 상자 / 패널 / 버튼 |
| `--add-ink` | #A52A20 | 순증가를 작은 글자로 쓸 때 (시뮬레이터·탐색기도 이 값 하나만 써요) |
| `--warn-tint` `--warn-tint-2` `--warn-line` `--warn-ink` `--warn-ink-2` | #FFF1C9 / #FFF6DC / #8A6100 / #5C4100 / #4A3500 | 주의 표시(비관 조합 잠금, 섞인 계산 방식 배지) |
| `--ease-out` | cubic-bezier(.16,1,.3,1) | 주요 전환(정류장 버스, 요약 띠, 배분 이동, 막대)의 이징 |

색 의미는 페이지 전체에서 고정이에요. **PCTR 기준·경기 내부 축은 주황, 현행 방식·서울행은 파랑, 감축은 초록, 증가는 빨강, 진단의 '출퇴근 직행'(단지 정차 직행)은 검정(`--asphalt`).** 보고서 그림5·7은 이 규칙과 반대로 칠해져 있어서 본문에는 넣지 않고 바닥글 썸네일로만 링크해요.
- 6단계 진단 열의 머리 선은 수요관리만 파랑이고 DRT 연계는 중립 회색(`--line-strong`)이에요. 주황 칠은 '증편이 배분된 축' 칸에만 써요.
- 두 방식을 견주는 값(예: "PCTR이 덜 배출할 확률")은 검정이 아니라 옅은 주황 + 주황 테두리(`.hbar--cmp`)로 그려요.

부호 표기는 한 섹션 안에서 섞지 않아요.
- **숫자만 쓸 때**(표·결과판·차트): 부호를 붙이고(+1,020 / −793) 라벨 "연간 순감축", 단위 "tCO₂/년", 같은 화면에 "+는 감축, −는 증가"를 적어요.
- **문장 안에서**: 부호 없이 말로 풀어요. "연 793 tCO₂ 증가", "연 1,020 tCO₂ 감축".

## 마운트 지점

```html
<section class="sec" id="simulator">       <!-- 흰 바탕 -->
  <div class="wrap"> ... <div class="mount" id="simulator-root" data-state="empty"> ... </div></div>
</section>
<section class="sec sec--panel" id="explorer">   <!-- 안내판 바탕 -->
  <div class="wrap"> ... <div class="mount" id="explorer-root" data-state="empty"> ... </div></div>
</section>
```

- 채울 때 `#…-root`의 내용을 바꾸고 `data-state` 속성을 지워 주세요(점선 자리표시가 사라져요). 제목(h2)과 한 줄 설명은 index.html에 있으니 안에서 다시 쓰지 않아도 돼요.
- 너비는 `.wrap` 안쪽 최대 1072px, 모바일 390px에서 좌우 16px 여백이에요. 가로 스크롤이 생기지 않게 해 주세요.
- 높이는 자유지만 데스크톱 한 화면(약 700px) 안에 핵심 결과 숫자가 보이게 해 주세요.
- `#explorer`는 `--panel` 바탕이라, 안의 카드나 지도 틀은 `.panel`(흰 바탕+선)로 띄워 주세요.

## 컴포넌트

**히어로 결론 띠** (`.strip#gist`): 제목 바로 아래에 두 방식의 확률(86% / 61%)과 모형 기준값, 가설 한 줄을 보여요. 모바일에서는 제목 → 결론 띠 → 버스 → 설명 순서(DOM 순서 그대로)예요. 61%/86%와 가설 문장은 이 띠와 `#hypothesis` 두 곳에만 써요.

**표4 칸 → 시뮬레이터**: 결과 섹션 표4의 칸은 `<a href="#simulator" data-sim-n="44" data-sim-phi="0.5">`예요. `simulator.js`가 이 속성을 읽어 그 조건(두 방식에 같은 탑승·φ)으로 맞춰요. JS가 없으면 그냥 시뮬레이터로 이동해요.

**제안 목록** (`ol.props > li > details > summary`): 한 줄 제목만 보이고 누르면 펼쳐져요. 한계는 `ul.limits`(데스크톱 3열).

**슬라이더 한 줄**
```html
<label class="ctl">
  <span class="ctl-label">회당 탑승<small>보조 설명</small></span>
  <input class="range" type="range" min="0" max="44" value="20">
  <output class="ctl-out">20명</output>
</label>
```
채워진 길이는 JS에서 `input.style.setProperty('--fill', 퍼센트 + '%')`로 넘겨요. φ처럼 승용차 출신을 다루는 값은 `.range--car`.

**예시 값 버튼**: `<div class="chips" role="group"><button class="chip" aria-pressed="true">…</button></div>`
**둘 중 하나**: `<div class="toggle" role="group"><button aria-pressed="true">출근</button><button aria-pressed="false">퇴근</button></div>`
**켜고 끄기**: `<label class="switch"><input type="checkbox"><span>회송 포함</span></label>`
**숫자·선택 상자**: `<input class="field">`, `<select class="field">`
**링크 버튼**: `.ticket`, `.ticket--solid`, 어두운 바탕에서 `.ticket--light`. 글 뒤에 화살표는 붙이지 않아요.

**결과 숫자**
```html
<div class="readouts">
  <div class="readout is-cut">
    <span class="readout-label">연간 순감축</span>
    <span class="readout-value">+1,020<span class="readout-unit">tCO₂/년</span></span>
    <span class="readout-note">모형 기준값</span>
  </div>
</div>
```
`is-cut` / `is-add`로 부호 색, 작은 크기는 `.readout--sm`. 판정 문장은 `.verdict-head` + `.verdict-text`(히어로와 같은 모양). `.verdict-head`는 문장이라 본문 서체(IBM Plex Sans KR 700, 20px)로 써요. 디스플레이 서체는 h1·h2·결과 숫자만이에요.

**기준선 막대**: `<div class="meter" style="--v:23%;--t:25%"><i></i><b></b></div>` (`--v` 값, `--t` 기준선, 통과하면 `.is-cut`).

**차트(SVG)**: `<figure class="chart"><ul class="key">…</ul><svg viewBox="0 0 560 320" role="img" aria-label="…">…</svg><figcaption class="chart-cap">…</figcaption></figure>`
- 선: `.axis-line`, `.grid-line`, 기준선 `.threshold` + `.threshold-label`
- 글자: `.axis-label`(눈금), `.axis-title`(축 이름), `.data-label`(값), 색 글자 `.t-cut` `.t-add` `.t-muted`
- 채우기·선 색: `.fill-car|transit|seoul|cut|add|muted|ink`, `.stroke-…`
- 범례: `.key > li > .sw.sw--car` (`sw--line` 점선, `sw--ring` 빈 원)
- viewBox 너비 560을 기준으로 그리면 파이프라인 그림과 글자 크기가 맞아요.

**진단 태그**: `.tag.tag--demand`(수요관리) `.tag--drt`(DRT 연계) `.tag--direct`(출퇴근 직행) `.tag--hold`(보류)
**표**: `.tablewrap > table.data`, 숫자 칸 `td.num`, 부호 `.pos` / `.neg`. 칸 색 표는 `table.heat` + `td.c-cut|c-add`.

## 원칙

- 모션은 사용자가 움직였을 때만 써요. 스스로 움직이는 건 히어로 탑승 연출(처음 한 번, 약 1초), 파이프라인 1단계(532→20), 정류장 버스뿐이에요. 8단계 배분 이동(FLIP)과 4단계 기준선은 사용자가 조작할 때만 움직여요. `prefers-reduced-motion`이면 전부 멈춰요. 움직이는 막대는 가능하면 폭 대신 `transform`(scaleX·scaleY)으로 바꾸고, `will-change`는 움직이는 동안에만 JS로 붙여요.
- 강조 상자는 왼쪽 굵은 선 대신 위쪽 3px 선(히어로 `.strip`과 같은 문법)으로 그려요(`.caveat`, `.mc-stat`).
- 포커스는 `outline:var(--focus); outline-offset:2px; box-shadow:var(--focus-ring)`(남색 3px + 흰 2px 띠)로 항상 보여요. 전역 `:focus-visible`에 이미 걸려 있으니, 따로 정할 때도 이 변수만 써 주세요(주황 `--car`를 포커스에 쓰지 않아요). 커스텀 컨트롤도 키보드로 다 조작되게 해 주세요.
- 용어 풀이: `<span class="term-wrap"><button type="button" class="term" aria-describedby="tip-x">φ</button><span class="term-tip" role="tooltip" id="tip-x">…</span></span>`. 누르기·포커스·마우스 올리기로 열리고 Esc로 닫혀요(`js/hero.js`). 글자는 12px 미만으로 쓰지 않아요.
- 문구는 해요체, 숫자는 저장소 결과 파일에 있는 것만 써요. 계산값은 `js/model.js`에서 받아요.
- 손익분기 계산은 `js/breakeven.js` 한 곳에서 `model.js`를 감싸요. top-level await가 없고 `ready`(약속)를 내보내요. 히어로 좌석·532 격자·스테퍼는 HTML/CSS로 먼저 그려 두고, 모형이 늦거나 실패하면 안내 문구를 보여요.
