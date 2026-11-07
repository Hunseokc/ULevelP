# CH-2c-2 결과 — 정석 코드 폼: 표 + 규칙 → 진행 후보 연결

- 날짜: 2026-11-04 (mac, Node 24.16.0)
- 입력: `결과/CH-2c-1_폼데이터.md` §3·§8, `결과/CH-2b_엔진퀄리티.md` §2·§3
- 상태: **완료** — 로컬(§6) + Draft PR #63 CI 전부 통과(Test Node 22·24, Kotlin, E2E spa·legacy, Docker — run 41821666622, 커밋 `f8c0617`). R3 Fmaj7 예외(§4)는 **사용자가 받음(2026-11-04)**

## 1. 사용자 결정 (2026-11-04)

- `chordCandidates`·`bestPaths`의 기본은 **`shapes: 'compact'`**(기존 결과 그대로). 진행 연주 탭(CH-5b) **코드가** `shapes: 'standard'`를 넘긴다. 사용자 설정 항목이 아님
- 표 JSON은 엔진이 import하지 않고 **인자로 받음**(`opts.formTable`). 화면은 `loadChordForms()`(dynamic import)로 불러옴
  - 이유: 엔진 `.mjs`가 JSON을 정적 import하려면 Node 22 `with { type: 'json' }`와 Vite 5 호환을 따로 맞춰야 하고, 첫 화면 번들이 35KB(gzip) 늘어남. 인자로 받으면 테스트는 `fs`로 읽고, 화면은 진행 연주 탭에 들어갈 때만 받는다
- 새 export와 옵션 이름은 아래 §2 그대로, 재현율 목표값은 제안한 값 그대로 승인

## 2. 바꾼 파일 / API

| 파일 | 내용 |
| --- | --- |
| ★`frontend/src/lib/engine/chordShapes.mjs` | `formId`, `tableForms`, `ruleForms`, `standardForms` |
| `frontend/src/lib/engine/progressionPath.mjs` | opts `shapes`(`'compact'`\|`'standard'`\|`'both'`)·`formTable`. 후보 캐시 키에 `quality` 추가. `bestPaths`는 원래 opts를 넘김(정석 폼 `lo` 기본 0 유지) |
| `frontend/src/lib/musicEngine.ts` | 타입 `FormTable`·`FormTableForm`·`ShapeOptions`, `PathChord.quality?`, `PathOptions.shapes?`·`formTable?`, `Voicing.kind?`·`fingers?`·`barres?`·`src?`·`fix?`. export `SHAPES`, `loadChordForms()` |
| ★`test/ch2c2_standard_forms.test.js` | 21개(§5) |

- `voicing.mjs`(`genVoicings`·연습실), `chordForms.json`, `build_chord_forms.mjs`, `symbol.mts`는 안 바꿈

```ts
SHAPES.formId(chord) → string | null              // `${root}:${quality}` (+ `/${bass}`), quality 없으면 null
SHAPES.tableForms(chord, table, opts?) → Voicing[]  // 범위 안 표 폼, 점수 순. 표·id 없으면 []
SHAPES.ruleForms(chord, opts?) → Voicing[]          // 규칙(§3) 전부, 점수 순. 잘못된 입력 → []
SHAPES.standardForms(chord, table, opts?)           // 범위 안 표 폼이 있으면 표만, 없으면 규칙
  opts(ShapeOptions) = { lo=0, hi=12, minStrings=3, maxSpan=4, maxFingers=4, maxInnerMute=1 }
  Voicing = genVoicings 결과 모양 + kind 'table'|'rule' · fingers · barres(절대 프렛) · omit · (표) src · fix
PATH.chordCandidates(chord, { shapes, formTable, lo, hi, topK, ... })
PATH.bestPaths(chords, { shapes, formTable, lo, hi, loop, paths, ... })
  shapes: compact(기본) = genVoicingsByDegrees 그대로(kind 없음)
        · standard = standardForms만(lo 기본 0, compact의 lo 기본 1과 다름)
        · both = 둘 다, 같은 프렛은 한 번(compact 우선), kind로 구분, 점수 순
loadChordForms(): Promise<FormTable>  // 한 번만 받아 옴(Promise 캐시)
```

- **CH-5b 사용 예:** `const table = await loadChordForms(); PATH.bestPaths(chords.map(parseChord), { shapes: 'standard', formTable: table, loop: true })`. `parseChord` 결과에 `quality`가 있어야 표를 찾는다
- `standard`에서 `[]`가 나오면, 범위가 좁아 정석 폼이 없는 코드가 있다는 뜻이다(예: Dm9를 5~9프렛). CH-5b는 범위를 넓히거나 `both`로 다시 부르거나, 그 코드만 "대체"로 표시한다

## 3. 규칙 (`ruleForms`)

| 항목 | 규칙 | 근거 |
| --- | --- | --- |
| 줄 | 6줄마다 "막음 또는 lo~hi 안의 구성음 프렛" 전부 탐색. 울리는 줄 ≥ 3, 가운데 막는 줄 ≤ 1 | 표에서 가운데 막는 줄이 2개인 폼은 12개(0.4%)뿐 |
| 같은 음 | 같은 음 이름 중복·옥타브 중복 허용 | 정석 폼의 기본(F 바레는 F 3번) |
| 개방현 | `lo: 0`일 때만 | CH-2c-1 §8 |
| 맨 아래 | 첫 울리는 줄 = 근음 또는 슬래시 베이스 | 표 검증과 같음 |
| 음 | 구성음(+ 슬래시 베이스)만. 빠져도 되는 도수는 5도뿐(11·13 코드는 9도도) | 표 검증과 같음. 11·13 코드의 아래 텐션(`add`)은 표 폼에만 있음 |
| 프렛 폭 | 누르는 프렛 최고 − 최저 + 1 ≤ 4 | 표 검증과 같음 |
| 손가락 ≤ 4 | 누르는 줄마다 1개에서 바레로 줄인다. ① 가장 낮은 누름 프렛을 2줄 이상이 쓰고, 그 사이에 개방현이 없으면 검지 바레 1개(사이의 막은 줄은 허용) ② 그래도 4개를 넘으면 같은 프렛에 이어진 줄을 손가락 1개로(`x 3 2 3 3 3`의 3프렛) | ①만 두면 C9 `x 3 2 3 3 3` 같은 표 폼 75개를 못 만들었음 |
| 점수 | 음 이름마다 도수 점수 한 번(genVoicings 표: 3·7도 3, 확장음 1.2, 근음 1, 5도 0.7) + 울리는 줄 1.2 − 최저 누름 프렛 0.6 − 손가락 0.2 − 가운데 막음 2 − 폭 0.6 − 높은 자리(누르는 프렛 5 이상)와 섞인 개방현 1 − 반음 부딪힘 1 − 위 줄 막음 1 + 아래 줄 막음 0.3 − 끊긴 바레(최저 프렛을 개방현 사이로 따로 누름) 0.5×손가락 − 바레 1 | 가중치는 R2·R3으로 맞춤(§4) |

- 표 폼도 같은 점수 함수를 쓴다. 그래서 `bestPaths`에서 표 폼과 규칙 폼, 또는 `both`의 compact를 같은 식으로 비교한다. `both`의 compact 점수는 genVoicings 식이라 척도가 비슷하지만 같지는 않다
- 끊긴 바레의 예: F `1 0 3 2 1 1`. 표에도 Cadd9 `x 3 0 0 3 0` 같은 정상 폼이 78개 있어서 막지 않고 감점한다

## 4. 재현율 (기준 · 실측)

분모 = 표 폼 2879개 − `add` 폼 167개 = **2712개**. 규칙 생성 범위는 0~15프렛(표 최고 프렛)이다.

| 기준 | 목표 | 실측 |
| --- | --- | --- |
| R1 허용률(표 폼이 규칙 생성 전체에 들어 있음) | ≥ 95% | **99.5%** (2699/2712) |
| R2 첫 폼 순위(코드마다 표 첫 폼, 718코드) | 상위 5개 ≥ 80%, 상위 1개 ≥ 50% | **82.9% / 52.8%** |
| R3 핵심 정석 폼 14개(규칙만, 0~12) | 상위 3개 100% | **13/14 1등**, Fmaj7 `x x 3 2 1 0`만 5등 ← 예외(사용자 승인) |
| R4 규칙 폼 정확도 | 100% CH-2c-1 검증 통과 | **100%**(756코드 × 0~15프렛, 5만 폼 이상) · 코드당 중앙값 88 · 최대 1519 |

- **CH-2c-3 뒤:** 규칙 1등 자동 회피(1점)가 들어가 R2가 50.3% / 82.9%로 바뀜(R1·R3·R4 그대로) — `결과/CH-2c-3_정석폼검토.md` §2
- R1 범주별(맞음/전체): 일반 1165/1170 · 일반+5도 생략 206/207 · mute-low 178/178 · mute-low+생략 70/70 · 슬래시 1079/1086 · 슬래시+생략 1/1
- R1에서 못 만든 13개: 가운데 2줄 막음 12개(`D/F# 2 x x 2 3 2` 등 3화음/베이스 형태 10개 + `Dbmaj11`·`Gm7b5`) + `Bbmmaj9 6 4 x 5 6 5`(손가락 5개)
- R2 변천: 1차 점수식 3.6%/20.6% → 자리·줄 수 52.8%/82.9%. 무작위 격자 탐색으로 가중치를 맞췄다. 같은 표로 맞추고 같은 표로 쟀으므로, 표 밖 코드의 순위 품질은 이 수치보다 낮을 수 있다
- R2가 막힌 이유: chords-db 첫 폼이 항상 가장 쉬운 폼은 아님. `Cm7 8 x 8 8 8 x`·`Dm7 10 x 10 10 10 x`처럼 첫 폼이 높은 자리인 코드가 27개다. 규칙 1등이 표의 어느 폼이든 하나와 같은 비율은 50.8%
- **R3 예외 — Fmaj7:** 규칙 1~3등이 6줄 바레 `1 3 2 2 1 0`·`1 3 2 2 1 1`·`1 3 3 2 1 0`(전부 맞는 Fmaj7)이고 `x x 3 2 1 0`은 5등이다. 바레 감점을 1.5로 올려도 4등에 그치고, R2가 떨어진다. **실제 사용에는 영향이 없다:** Fmaj7은 표에 있어 `standard`가 표 폼을 쓰고, 표 안에서는 `1 3 2 2 1 1` 다음 2등이다. 테스트는 "13개 상위 3개, Fmaj7 상위 5개"로 적어 둠. **2026-11-04 사용자: 예외로 받음**
- 변이 확인: 3도 생략 허용 → R4 등 2개 실패. 끊긴 바레 감점 0 → R2·R3 2개 실패. 원복 후 21개 통과

### 실측 예

```
standard + 표, C G Am F (0~12) 1등: x 3 2 0 1 0 | 3 2 0 0 0 3 | x 0 2 2 1 0 | 1 3 3 2 1 1   (전부 table)
standard 표 없음(규칙만)    1등: x 3 2 0 1 3 | 3 2 0 0 0 3 | x 0 2 2 1 0 | 1 3 3 2 1 1   (2등이 표와 같은 경로)
standard + 표, 5~9프렛     1등: x x x 5 5 8 | x x 5 7 8 7 | 5 7 7 5 5 5 | x 8 7 5 6 5
Dm9 G13 Cmaj7#11 C7alt     1등: x 5 3 5 5 5 (table) | 3 0 2 0 0 1 (table) | x 3 4 0 0 0 (rule) | 8 6 6 6 5 6 (rule)
both FM7 Dm9 Gm7 C7 5~9    1등: CH-2b compact 경로와 같음(재즈 코드는 compact 점수가 높음)
G7/B 10~12프렛 standard    → bassDropped, x 10 12 10 12 10 (G7 표)
표에 없는 퀄리티 1등(규칙): Cmaj7#11 x 3 4 4 0 0 · Cm13 x 3 5 3 4 5 · C7alt 8 6 6 6 5 6 · C9sus4 x 3 3 3 3 3
속도: 756코드 규칙 생성 213ms, 16코드 standard bestPaths(loop) 2ms
```

## 5. 테스트 (`test/ch2c2_standard_forms.test.js`, 21개)

- CH-2c-2-1 R1·R2(수치는 diagnostic으로 출력) / -2 R3 14개 + 손가락·바레 판정(F 4손가락 [1], A 바레 [2], C9 두 번째 바레) / -3 R4 전수 검증 + 표에 없는 퀄리티 5종
- CH-2c-2-4 표 조회: 표 폼만·점수 순, 범위(오픈은 lo 0만, 범위 안 표 폼 없으면 규칙), 슬래시·mute-low, add 폼
- CH-2c-2-5 진행: standard 1등 정석 폼(표 있음/없음), C G Am F 경로, 표+규칙 섞인 경로, 범위가 좁으면 [](both면 경로 나옴), both 중복 없음, **compact 기본 결과 불변**(옵션 없음 = compact + formTable, kind 없음), bassDropped, 16코드 1초 안
- CH-2c-2-6 잘못된 입력: 모르는 shapes, 모르는 도수·빈 도수·lo>hi·lo<0·근음 없음·null, 표 없음·quality 없음

## 6. 실행 결과 (로컬)

```
node --test test/ch2c2_standard_forms.test.js   → tests 21, pass 21, fail 0
npm test                                         → tests 319, pass 319, fail 0   (298 + 21)
npx tsc --noEmit -p .                            → 통과
ULP_UI=spa CI=1 npx playwright test             → 52 passed (48.6s) — 연습실 회귀 없음
npm run build                                    → ✓ built — 첫 화면 번들에 표·규칙 없음(아직 화면이 SHAPES·loadChordForms를 부르지 않아 tree-shaking). 별도 청크는 CH-5b에서 처음 부를 때 생김
```

## 7. 다음 step에 넘길 것

- CH-5b: §2 사용 예. 진행 연주 탭 기본 `{ shapes: 'standard', formTable, loop: true }`(lo 0~12)를 제안. 칩에 `kind`(표/규칙), `barres`(바레), `omit`, `bassDropped` 표시
- 3화음 `trans`(CH-2b §6)는 정석 폼에도 같음 — 7도가 없으면 +3 상수
- 제안(범위 밖): 규칙 가중치를 표 밖 코드(m13·7alt 등)로 따로 검수하는 사람 확인 목록
