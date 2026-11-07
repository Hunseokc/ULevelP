# CH-2b 결과 — 보이싱 엔진 퀄리티 추가 + 진행 보이싱 경로 DP

- 날짜: 2026-11-04 (win, Node 26.8.1)
- 입력: `결과/CH-1a_프레임.md` §5-1, `결과/CH-1b_설계.md` §6-2·§9, `결과/CH-E_엔진이전.md` §5, `결과/CH-2_코드파서.md` §2·§6
- 상태: **완료** — 로컬(§5) + Draft PR #63 CI 전부 통과(Test Node 22·24, Kotlin, E2E spa·legacy, Docker — run 41795425494, 커밋 `c1a97b1`)

## 1. 바꾼 파일 (§9 목록 그대로 + 예고된 테스트 수정 1개)

| 파일 | 내용 |
| --- | --- |
| `frontend/src/lib/engine/voicing.mjs` | `DEG`에 `2`·`#5`·`bb7` 추가, `genVoicingsByDegrees` 추가, 기존 `genVoicings` 본문을 공용 `build()`로 옮김(결과 불변), `trans` export |
| ★`frontend/src/lib/engine/progressionPath.mjs` | `chordCandidates`, `bestPaths` (named export) |
| `frontend/src/lib/musicEngine.ts` | 타입(`Voicing`·`VoicingNote`·`VoicingOptions`·`DegreeVoicingOptions`·`PathChord`·`PathOptions`·`VoicingPath`), `GE.genVoicingsByDegrees`·`GE.trans` 타입, 새 `PATH = { chordCandidates, bestPaths }` |
| ★`test/ch2b_engine_quality.test.js` | 27개 (§4) |
| `test/che_engine_port.test.js` | CH-E §5 예고대로: CH-E-1 voicing 줄 비교 삭제(theory만 남김), CH-E-2 voicing은 "옛 키 ⊂ 새 키, 옛 상수 값 같음(DEG는 기존 항목만 비교)". CH-E-3·4(옛 `public/lib` = 새 엔진, 같은 입력 → 같은 출력)는 그대로 통과 = **기존 엔진 결과 회귀 없음** |

- `public/lib/*.js`는 손대지 않음(동결). `test/engine.test.js`·`r2_chords.test.js`는 동결 사본을 읽으므로 실제 회귀 확인은 CH-E-3·4가 맡는다
- `musicEngine.ts`의 `GE.chordTones`는 엔진이 export하지 않아 원래부터 `undefined`(이번 범위 밖, 손대지 않음)

## 2. 다음 step(CH-5b)이 쓸 API

### `voicing.mjs` (`GE`)

```ts
GE.genVoicingsByDegrees(root: 0..11, degrees: string[], opts?) → Voicing[]   // 정렬 안 됨(genVoicings와 같음) — 쓰는 쪽이 score 내림차순 정렬
  opts = genVoicings 옵션(lo hi maxSpan minNotes maxNotes maxGap needGuide allowedPcs outsideMax top)
       + bass?: 0..11   // 슬래시 베이스 — 맨 아래 음을 이 음으로
       + name?: string  // 결과 v.name (기본 근음 이름 'C'). 진행에선 입력 표기(raw)를 넣는다
       + must?: string[]// 꼭 들어갈 도수 (기본: 확장음 + b5·#5)
  Voicing = genVoicings 결과 모양 + q: null, degrees(받은 그대로), omit(생략한 도수, 예 ['5'])
  잘못된 입력(모르는 도수·빈 목록·배열 아님) → []
GE.trans(a, b) → number   // 이웃 보이싱 이동 비용(기존 함수 그대로 export)
```

- 사용: `const c = parseChord('G7/B'); GE.genVoicingsByDegrees(c.root, c.degrees, { bass: c.bass, name: c.raw })`
- `v.notes[i].cls`: `'root'|'3'|'5'|'7'|'ext'|'bass'` (`bass` = 코드톤이 아닌 슬래시 베이스, 맨 아래에만)

### `progressionPath.mjs` (`PATH`)

```ts
PATH.chordCandidates(chord: {root, degrees, bass?, raw?}, opts?) → { voicings: Voicing[] /* 점수 순 상위 topK */, bassDropped: boolean }
PATH.bestPaths(chords: PathChord[], opts?) → [{ total, cost, voicings: Voicing[] /* 코드 순서 */ }]  // 최대 paths개, total 내림차순
  opts = 보이싱 옵션 + topK(기본 30) + paths(기본 3) + loop(기본 false — 마지막 → 첫 코드 이동도 비용에)
  빈 진행 · 후보 0개인 코드가 하나라도 있으면 []
```

- `PathChord`는 CH-2 `parseChord` 결과(ChordOk)를 그대로 넘기면 된다(`raw`가 결과 이름이 됨)
- **CH-5b 화면이 할 일**: `bestPaths`가 `[]`면 코드마다 `chordCandidates(c).voicings.length`로 어느 코드가 문제인지 찾아 "대체" 표시(CH-1a §5-1의 남는 예외) / 범위(`lo`·`hi`)를 넓혀 다시 시도. `bassDropped`면 칩에 "베이스 생략"(가능하면 재생 베이스로만 연주), `omit`이 있으면 "5 생략"
- 프렛 범위 5~9(프레임 기본값)는 `{ lo: 5, hi: 9 }`

## 3. 규칙 (설계 §6-2 + 설계에 없어 정한 것)

| 항목 | 규칙 | 이유 |
| --- | --- | --- |
| 기존 `genVoicings` | `CH[q]` 도수 + must = 확장음으로 공용 `build()` 호출. 옛 "마지막 도수가 확장음이면 그 음 필수" = "확장음(CH엔 최대 1개) 필수"라 같은 결과 | 설계 "genVoicings는 이 함수를 부르는 형태, 결과 불변". CH-2b-8이 모든 CH × 12루트로 같은 보이싱·점수 확인 |
| 새 도수 분류 | `2` → `'3'`(sus2의 3도 자리), `#5` → `'5'`, `bb7` → `'7'`(dim7 가이드톤) | CH-2 §6 제안 그대로. 점수표도 기존 분류 점수를 그대로 받음 |
| 가이드톤 요구 | 3도·7도 자리가 다 있는 코드는 `needGuide` 그대로. 한쪽만 있는 코드(3화음·sus·add9·도미넌트 11)는 `min(needGuide, 있는 자리 수)` | 3화음은 7도가 없어 `needGuide 2`로는 0개. 기존 CH는 전부 두 자리가 있어 영향 없음 |
| 꼭 들어갈 음(must) | 기본 = 확장음 + `b5`·`#5`. 개수 = `max(1, min(must 수, maxNotes - 가이드톤 수 - 베이스 자리))` | `C7#5`가 `C7` 폼으로 나오면 안 됨. 7alt처럼 변화음이 3개면 4음 안에 다 못 넣어 2개 이상으로 |
| `m7b5` 차이 | 도수 경로(`Cm7b5` 파싱 결과)는 b5 필수, 옛 `genVoicings(r,'m7b5')`는 b5 없는 폼도 그대로 | 옛 결과 불변 + 진행 연주에서는 m7b5 소리가 나야 함. 같게 하려면 `must: []` |
| 생략(6도수 이상) | `5 → R → 9(다른 확장음이 남을 때만)` 순으로 **5개가 될 때까지**. 슬래시 베이스 음은 안 뺀다. 결과 `omit` | 설계 §6-2. 예: `C13b9` → `['5']`, `C7alt` → `['R']`, `C13b9/G` → `['R']`, R 3 #5 b7 9 #11 13 → `['R','9']` |
| 같은 음 도수 | 앞쪽 도수만 남긴다(`m7#9`의 b3·#9 → b3, `7b5#11` → b5, `7#5b13` → #5) | 같은 음이 표에서 뒤 도수로 덮여 가이드톤이 사라져 보이싱 0개가 났음(6종). 파서가 이 조합을 `conflict`로 막을지는 제안만(§6) |
| 슬래시 베이스 | `bass` 음이 맨 아래(첫 줄 음). 코드톤이 아니면 표에 `cls 'bass'`(점수 1, 도수 이름 `BASS_DEG`: `C/D` → `'2'`)로 넣고 맨 아래에만 허용. 가이드톤·must가 아닌 베이스는 한 자리를 차지한다고 보고 must 개수를 줄임 | CH-1a §5-1 "지판 최저음 조건(가능하면)". 마지막 규칙이 없으면 `C13b9/G`가 0개 |
| 베이스 불가 | `chordCandidates`가 베이스 없이 다시 만들고 `bassDropped: true` | "가능하면". 예: `G7/B`를 10~12프렛으로 |
| 경로 점수 | `total = Σ보이싱 점수 − Σtrans` (search251과 같은 식), `cost = Σtrans` (loop면 끝→처음 포함) | 설계 "search251을 길이 N으로" |
| DP | 시작 보이싱마다 Viterbi(최적 경로 1개) → total 순 상위 `paths`개. 시작이 서로 다르므로 경로가 겹치지 않고, loop 비용도 시작이 정해져 있어 정확 | 상위 3개가 "같은 경로의 끝 코드만 바꾼 것"이 되지 않게(search251이 가운데 코드로 중복을 거른 것과 같은 의도). 비용 O(K·N·K²) |
| 같은 코드 반복 | 후보는 `(root, degrees, bass, raw)`로 캐시 | `C G Am F C G F C`처럼 반복이 흔함 |

## 4. 테스트 (`test/ch2b_engine_quality.test.js`, 27개)

- CH-2b-1 `DEG`: 파서 `DEGREE_SEMITONES` 19개가 전부 같은 반음 수로 있음(2·#5·bb7 값)
- CH-2b-2 파서가 내는 정규 퀄리티(BASE_QUALITIES + 7화음류 × 텐션, 100개 이상) × 12루트 **전부 보이싱 1개 이상**, 모든 음이 코드톤, 3~4음 / BASE_QUALITIES 34개 이름·도수 싣기
- CH-2b-3 3화음(C·Am·Cdim·Caug 세 음 정확히), sus2·sus4, add9(3·9 필수), C11(3도 없음·9·11), dim7(bb7 가이드톤)
- CH-2b-4 변화 5도 필수(C7#5·C7b5·Cm7b5) + 옛 m7b5 결과 불변
- CH-2b-5 생략: C13b9·C7alt·7도수 2종·5도수 이하 생략 없음·슬래시 베이스 보존·같은 음 도수
- CH-2b-6 슬래시: G7/B(코드톤 베이스), C/D(코드톤 아닌 베이스는 맨 아래에만)
- CH-2b-7 잘못된 입력 4종 → `[]`
- CH-2b-8 모든 CH × 12루트: `genVoicingsByDegrees(CH[q], must=확장음)` = `genVoicings(q)` (같은 생성 함수)
- CH-2b-9 `trans` 값 = 식 그대로
- CH-2b-10 `bestPaths`: FM7 Dm9 Gm7 C7(5~9프렛) 3개·내림차순·total 재계산·범위·시작 다름 / **완전 탐색과 같은 최적값**(3코드 × 8후보, loop 꺼짐·켜짐) / **2-5-1은 `search251`과 같은 최적 경로(frets·total)** / loop 비용 / 코드 1개 / bassDropped / 잘못된 입력 4종 / 16코드 1초 안
- 변이 확인: 생략 순서를 `R → 5`로 바꾸면 2개 실패, DP 이웃 선택을 "첫 후보만"으로 바꾸면 5개 실패 → 원복 후 27개 통과

### 실측 예 (기본 옵션, 점수 1등)

```
C        x x x 9 8 8   [3 5 R]          Caug   x x x 5 5 4  [R 3 #5]
C7alt    x x 6 6 5 6   [#5 b9 3 b7]     omit R
C13b9    x x 7 6 5 6   [13 b9 3 b7]     omit 5
G7/B     x x 9 10 8 10 [3 b7 R 5]       C/D    x 5 5 5 5 x  [2 5 R 3]
FM7 Dm9 Gm7 C7 (5~9프렛) 1등: total 29.15 cost 5.88
  x 8 7 x 5 8 | x 7 x 7 6 8 | x x 5 7 6 6 | x x 5 5 5 6
```

## 5. 실행 결과 (로컬, Node 26.8.1)

```
node --test test/ch2b_engine_quality.test.js test/che_engine_port.test.js → tests 44, pass 44, fail 0
npm test                                   → tests 273, pass 273, fail 0   (247 + 27 − CH-E-1 voicing 1)
npx tsc --noEmit -p .                      → 통과
npm run build                              → ✓ built in 1.06s
ULP_UI=spa CI=1 npx playwright test        → 52 passed (54.7s) — 연습실(genVoicings·search251·topNoteDominants 쓰는 화면) 회귀 없음
```

## 6. 다음 step에 넘길 것 / 제안

- CH-5b: §2 API 사용법. 진행 연주 탭 기본 옵션 제안 `{ lo: 5, hi: 9, loop: true }`(반복 재생이므로)
- 3화음 `trans`: 7도가 없어 7→3 항이 늘 +3(상수)이라 순위는 탑노트·평균 프렛으로만 갈린다. 팝 3화음 진행에서 연결이 어색하면 CH-5b에서 "공통음·가장 가까운 음 이동" 비용을 더하는 안을 검토(지금은 설계대로 `trans`만)
- 제안(범위 밖, 한 줄): 파서가 같은 음 도수 조합(`m7#9`·`7b5#11`·`7#5b13`·`maj7#5b13`·`m7b5#9`·`m7b5#11`)을 `conflict`로 막을지 — 지금은 엔진이 앞 도수만 남겨 연주는 됨
