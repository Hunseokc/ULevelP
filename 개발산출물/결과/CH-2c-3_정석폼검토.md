# CH-2c-3 결과 — 정석 폼 사람 검토(유지보수): 애매한 것만 목록 + 판정 반영 도구

- 날짜: 2026-11-04 (mac, Node 24.16.0)
- 입력: `결과/CH-2c-2_정석폼.md` §3·§4, `진행_코드진행모음.md` §3(2026-11-04 사람 검토 원칙)
- 상태: 도구·목록 완료 — Draft PR #63 CI 전부 통과(Test Node 22·24, Kotlin, E2E spa·legacy, Docker — run 41826908101, 커밋 `f5a00df`). **실제 검토(판정 68행)는 CHORDS 1차가 끝난 뒤 언제든 — 유지보수 작업**(§5 절차)

## 1. 사용자 결정 (2026-11-04)

- 사람이 보는 것은 **근거가 닿지 않는 5% 이하만**. 근거가 있고 재현율이 기준 이상이면 검토에서 뺀다. 전수조사는 하지 않는다
- 자동 회피 범위는 **1점**
- 후보가 0개인 4종은 **compact로 대체하고 화면에 표시**하며, 검토 목록에서 뺀다
- 검토 시점은 **나중**. 이번 전체 작업이 끝난 뒤에 해도 되게, 규칙이 바뀌어도 판정이 남는 유지보수 도구로 만든다

## 2. 애매의 기준과 근거

**검토 없이 통과시키는 근거** (CH-2c-2 실측)

| 근거 | 수치 |
| --- | --- |
| R4: 규칙 폼의 음·맨 아래 음·손가락 수·프렛 폭이 전부 맞음 | 100% |
| R1: 표 폼을 규칙이 만들 수 있음 | 99.5% |
| R2: 표의 첫 폼이 규칙 상위 5개 안 | 82.9% |

"맞는 코드인가"는 보장된다. 남는 위험은 정답지(표)에 거의 없는 모양이 1등이 되는 경우뿐이다.

**애매(`flags`)** = 규칙 1등 폼이 표 폼에 3% 미만으로만 나오는 특징을 가진 경우

| 특징 | 표 폼 2879개 중 비율 |
| --- | --- |
| 끊긴 바레(`split-barre`) | 2.7% |
| 반음 부딪힘(`semitone`) | 2.0% |
| 3줄만 울림(`three-strings`) | 2.1% |
| 위 2줄 막음(`top-muted`) | 1.4% |

**자동 회피:** 1등이 이런 특징을 가지면, 1등 점수와 1점 이내이면서 특징이 없는 첫 후보를 1등으로 올린다. 점수도 1등 바로 위(+0.001)로 맞춰서 `chordCandidates`·`bestPaths`가 다시 정렬해도 순서가 유지된다. 올라간 폼에는 `avoided: true`가 붙는다.

| 회피 범위 | 표 코드 R2(1등 / 5등 안) | 표에 없는 코드 중 애매 |
| --- | --- | --- |
| 없음 | 52.8% / 82.9% | 197개 (11.9%) |
| 0.5 | 51.5% / 82.9% | 116개 (7.0%) |
| **1 (채택)** | **50.3% / 82.9%** | **68개 (4.1%)** |
| 1.5 | 49.4% / 82.9% | 36개 (2.2%) — R2 1등이 목표 50% 밑 |

**대상:** 파서가 받는 퀄리티(기본 34개에 텐션 하나 붙인 것까지, CH-2b-2와 같은 목록) 중 표에 없는 것 × 12루트 = 1656코드. 슬래시 코드는 넣지 않았다.

**버린 안 — "기본 코드 표 폼과 2줄 이하로 다른 폼 우선":** 표의 텐션 코드 344개를 하나씩 "표가 없다"고 가정하고 재 봤다(leave-one-out). R2 1등이 52.9%에서 48.0%로, 5등 안이 79.7%에서 74.1%로 오히려 떨어졌다. 실제 표 폼도 25%는 기본 폼과 3줄 이상 다르기 때문이다. 그래서 근거로 쓰지 않는다.

**검토에서 뺀 것**

| 대상 | 이유 |
| --- | --- |
| 후보 0개 4종(`7alt9`·`7alt11`·`7alt#11`·`7alt13`, 48코드) | `standard`는 []를 돌려주고 화면이 compact로 대체·표시(CH-5b). `both`면 compact 후보가 나온다 |
| 규칙이 못 만드는 표 폼 13개 | 표에 있으니 `standard`가 표 폼을 쓴다 |
| 첫 폼이 높은 자리인 표 코드 27개 | `standard`는 표 순서가 아니라 점수 순으로 쓴다 |
| CH-2c-1 검증 불일치 212폼 | CH-2c-1에서 이미 정함 |

애매 68개가 몰린 곳은 `maj9(#9)` 7 · `m9(b9)` 6처럼 서로 부딪히는 텐션 조합이다. 파서는 받지만 실제로는 거의 안 쓰는 코드들이다.

## 3. 바꾼 파일

| 파일 | 내용 |
| --- | --- |
| `frontend/src/lib/engine/chordShapes.mjs` | 정석 폼에 `flags`, 규칙 1등 자동 회피(`AVOID = 1`, `avoided`), `standardForms`가 `none` 코드는 [], 새 export `withReview(table, review)`. 검토 폼(손가락 번호 없음)은 규칙 판정 값으로 손가락 수를 셈 |
| `frontend/src/lib/musicEngine.ts` | `Voicing.flags?`·`avoided?`, `FormTable.forms[id].none?`, `SHAPES.withReview`. `loadChordForms()`가 `chordForms.json`과 `chordFormReview.json`을 함께 받아 합침 |
| ★`scripts/chord_form_review.mjs` | `--write`·`--apply`·`--check`. export `ruleOnlyChords`·`listAmbiguous`·`toCsv`·`parseCsv`·`decide`·`regenerate`·`applyDecisions` |
| ★`개발산출물/자료/정석폼_검토목록.csv` | 68행, 판정은 빈칸. UTF-8 BOM(스프레드시트용) |
| ★`frontend/src/lib/engine/chordFormReview.json` | 판정 반영 결과(지금은 `forms: {}`) |
| ★`test/ch2c3_form_review.test.js` | 10개(§6) |

- `withReview`는 승인 목록 밖의 export다. `loadChordForms`와 테스트가 같은 합치기 함수를 쓰게 하려고 추가했다
- CH-2c-2 결과의 R2 수치는 자동 회피 전 값이다. 지금 값은 50.3% / 82.9%이고, `test/ch2c2`는 50%·80% 기준 그대로 통과한다. R3도 그대로다(13개 1등, Fmaj7 5등)

## 4. CSV 형식

```
id,코드,표시,후보1,후보2,후보3,판정,메모
8:maj7b9,Abmaj7(b9),반음 부딪힘,4 0 1 1 1 3,4 0 1 2 1 3,4 0 1 0 1 3,,
```

**판정 칸**

| 값 | 뜻 |
| --- | --- |
| 빈칸 | 미검토 |
| `ok`(= `1`) · `2` · `3` | 그 번호 후보가 맞음 |
| `직접:x 3 2 0 1 0` | 직접 적은 프렛. CH-2c-1 음 검증을 통과해야 함 |
| `빼기` | 정석 폼 없음 → `standard` 후보 0개, 화면은 compact로 대체 |

- 잘못된 판정은 `--apply`·`--check`가 오류로 멈춘다: 모르는 말, 6줄이 아님, 음 검증 실패, 없는 후보 번호, id와 코드 불일치
- **재생성(`--write`):** 판정·메모는 id 기준으로 이어 붙는다.
  - 번호 판정인데 규칙이 바뀌어 그 후보가 달라졌으면 `직접:예전 프렛`으로 고정한다
  - 지금은 애매가 아니어도 판정이 있던 행은 `표시: 판정 보존`으로 남기고, 후보 칸은 비운다
- **반영 결과:** 승인한 폼은 `kind: 'table'`, `src: 'review <코드>'`로 `standard` 후보에 들어간다(표 폼과 같은 취급)

## 5. 유지보수 절차 (검토할 때)

```bash
# 1) (규칙을 바꿨다면) 목록 다시 만들기 — 판정은 남는다
node scripts/chord_form_review.mjs --write
# 2) 개발산출물/자료/정석폼_검토목록.csv의 판정 칸을 채운다(일부만 해도 됨)
# 3) 반영
node scripts/chord_form_review.mjs --apply
# 4) 확인
node scripts/chord_form_review.mjs --check && npm test
# 5) 브랜치 → PR (base main)
```

- CSV와 JSON이 어긋나면 `npm test`(CH-2c-3-2)가 실패한다. 판정을 적고 `--apply`를 잊어도 테스트가 잡는다
- 규칙(`chordShapes.mjs` 가중치·`AVOID`)을 바꿨는데 `--write`를 안 해도 CH-2c-3-2가 실패한다
- 애매 비율이 5%를 넘게 바뀌면 CH-2c-3-1이 실패한다. 그때는 판정을 늘리지 말고 규칙부터 다시 본다

## 6. 테스트 · 실행 결과 (로컬)

**테스트 10개** (`test/ch2c3_form_review.test.js`)
- CH-2c-3-1: 애매 ≤ 5%(68/1656) / 후보 0개는 7alt + 텐션 4종 48코드, `standard` []·`both`는 compact / 자동 회피(특징 없음, 점수 차 1 이내, `chordCandidates` 정렬 뒤에도 1등)
- CH-2c-3-2: CSV = 지금 규칙으로 다시 만든 목록, JSON = 판정 반영 결과
- CH-2c-3-3: 판정 6종, 잘못된 판정 6종, CSV 왕복(쉼표·따옴표·줄바꿈), 머리줄 오류
- CH-2c-3-4: 승인 폼은 표 폼으로 1등, 빼기는 0개(`both`는 compact), `withReview` 안전성
- CH-2c-3-5: 재생성 때 판정 보존(번호 → 직접 고정, 빠진 행 보존, 빈 행 제거)

**변이 확인:** `AVOID = 0`으로 바꾸면 애매 11.4%가 되고 3개가 실패한다. 원복 후 통과.

```
node scripts/chord_form_review.mjs --write   → write: 애매 68/1656 (4.1%) · 행 68 · 후보 0개 48(compact 대체)
node scripts/chord_form_review.mjs --apply   → apply: 폼 0 · 빼기 0 · 미검토 68
node scripts/chord_form_review.mjs --check   → check: same (애매 68/1656, 판정 0)
node --test test/ch2c3_form_review.test.js   → tests 10, pass 10, fail 0
npm test                                     → tests 329, pass 329, fail 0   (319 + 10)
npx tsc --noEmit -p .                        → 통과
ULP_UI=spa CI=1 npx playwright test         → 52 passed
npm run build                                → ✓ built (첫 화면 번들에 표·검토 JSON 없음)
```

## 7. 다음 step에 넘길 것

- CH-5b: 진행 연주 탭은 `loadChordForms()` 결과를 `formTable`로 넘긴다. 칩에 다음을 표시한다
  - `kind: 'rule'`이면서 `flags`가 있는 폼(검토 목록 대상): "검토 전"
  - `standard` 후보 0개(후보 0개 4종이나 `빼기` 판정): compact로 대체했다는 표시
- 제안(범위 밖): 파서가 `maj7(9)`를 `maj9`와 다른 퀄리티(`maj79`)로 내서, 표에 있는 코드인데 규칙만 쓰는 경우가 생긴다. 정규화를 CH-5 파서 정리 때 볼지
