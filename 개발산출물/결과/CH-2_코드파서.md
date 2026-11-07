# CH-2 결과 — 코드 심볼 파서 · 로마숫자 · 키 추정 · 붙여넣기 파서

- 날짜: 2026-11-04 (win, Node 26.8.1)
- 입력: `결과/CH-1b_설계.md` §5·§9, 키 24개·로마숫자 옵션 철자 확인
- 상태: **완료** — 로컬 + Draft PR #63 CI 전부 통과(Test Node 22·24, Kotlin, E2E spa·legacy, Docker)

## 1. 바꾼 파일 (§9 목록 그대로)

| 파일 | 내용 |
| --- | --- |
| ★`frontend/src/lib/chords/symbol.mts` | `parseChord`, 정규 퀄리티·도수 상수, `splitQuality`·`chordPcs`·`pitchClass` |
| ★`frontend/src/lib/chords/roman.mts` | `KEYS`(템플릿 24개), `parseKey`·`keyName`, `toRoman`·`romanize` |
| ★`frontend/src/lib/chords/keyGuess.mts` | `guessKeys` |
| ★`frontend/src/lib/chords/pasteParse.mts` | `extractChordLines`·`findRepeats` |
| `tsconfig.json` | `"allowImportingTsExtensions": true` (`./symbol.mts` import) |
| ★`test/ch2_chord_parser.test.js` | 89개(정상 + 잘못된 입력) |

- 모듈 간 import는 `.mts` 확장자 + 타입은 `import type`(Node 타입 제거는 타입 전용 import를 지우지 못하면 실행 에러)
- 열거형(`enum`)·매개변수 프로퍼티 같은 "지울 수 없는 TS 문법"은 쓰지 않았다(Node 타입 제거 제약). CH-2b·CH-6도 같은 규칙

## 2. 다음 step이 쓸 API (export 이름·모양)

### `symbol.mts`

```ts
type ChordOk   = { raw; ok: true; root: 0..11; rootName: "Bb"; quality: "m7"; degrees: ["R","b3","5","b7"]; bass?: 0..11; bassName?: "G" }
type ChordFail = { raw; ok: false; reason: 'empty'|'no-chord'|'bad-root'|'bad-bass'|'bad-paren'|'unknown-suffix'|'conflict' }
parseChord(text): ChordOk | ChordFail
splitQuality("13b9") → { base: "13", tensions: ["b9"] }   // "maj7s11" → maj7 + [#11]
chordPcs(chord) → 피치클래스[] (베이스 포함, 중복 없음)
pitchClass("F#") → 6 | null
DEGREE_SEMITONES  // R b9 9 2 #9 b3 3 4 11 #11 b5 5 #5 b13 6 13 bb7 b7 7
TENSION_ORDER     // b9 9 #9 11 #11 b13 13
BASE_QUALITIES    // 34개 (아래)
```

- `raw`는 받은 문자열 그대로(공백 포함), `rootName`·`bassName`은 `♯/♭`만 `#/b`로 바꾼 입력 철자
- `reason` 코드는 화면(CH-5)에서 문구로 바꿔 보여 준다

### 정규 퀄리티 (`BASE_QUALITIES`, CH-2b 엔진이 받을 목록)

`maj m dim aug sus2 sus4 add9 madd9 6 m6 69 m69 maj7 maj9 maj13 maj7s11 maj7#5 m7 m9 m11 m13 mmaj7 m7b5 dim7 7 9 11 13 7sus4 9sus4 13sus4 7b5 7#5 7alt`

- 이 기본형 뒤에 텐션을 `b9 9 #9 11 #11 b13 13` 순으로 붙인 이름도 나온다(`7b9b13`, `13b9`, `7#5#9`, `9#11` …). 엔진은 이름이 아니라 **`degrees`로 보이싱**(설계 §6-2)
- 이름은 조합으로 만든다(표 조회 아님): 접두(`''`/`m`/`maj`/`mmaj`) + 숫자(`7`/`9`/`11`/`13`) + `sus4|sus2` + `alt|b5|#5` + 텐션. 그래서 `mmaj9`·`m9b5`·`7sus2` 같은 드문 조합도 받는다
- 도수 규칙(엔진 `CH`와 같음): 머리 숫자 9·11·13은 **맨 위 확장음 하나만** 넣는다(`m11` = R b3 5 b7 11, `13` = R 3 5 b7 13). 괄호로 적은 텐션은 그대로 추가(`C7(9,13)` → 이름 `13`, 도수에 9·13 둘 다)
- **엔진 `DEG`에 없는 도수**(CH-2b가 추가): `2`(sus2의 2 — `add2`는 9로 읽음), `#5`(aug·7#5·maj7#5·alt), `bb7`(dim7). 나머지는 엔진 이름 그대로

### `roman.mts`

```ts
KEYS                       // 'C Major','C min','Db Major','C# min', … 'B min' (키 24개 순서·철자)
parseKey('F Major') → { tonic: 5, minor: false } | null   // 형식은 정확히 "<음> Major" / "<음> min"
keyName(1, false) → 'Db Major'
toRoman(chord | text, key) → 'V7(b9)' | ''               // 못 읽는 코드·키면 ''
romanize(chords, key) → string[]
```

### `keyGuess.mts`

```ts
guessKeys(chords: (ParsedChord | string)[]) → [{ key: 'F Major', score: 6.5 }, …]  // 최대 3개, 못 읽는 코드는 건너뜀, 읽을 코드 없으면 []
```

### `pasteParse.mts`

```ts
extractChordLines(text) → [{ line: 1부터, section?: 'Chorus', symbols: ['Am','F'], repeat: 4 }]
findRepeats(symbols, section?) → [{ chords, repeats, start, section? }]   // 반복 후보 상위 3개 + 마지막에 "전체 순서 그대로"(repeats 1)
```

- `symbols`는 **입력 표기 그대로**(저장도 표기 그대로 — 설계 §8)
- 섹션별 후보 만들기(CH-5 화면 몫): 줄을 `section`으로 묶고 `repeat`만큼 펼친 뒤 섹션마다 `findRepeats(symbols, section)`. 테스트 CH-2-7 "섹션별"이 이 순서의 예

## 3. 설계에서 정한 것 / 설계에 없어 정한 것

| 항목 | 결정 | 이유 |
| --- | --- | --- |
| `C11`(도미넌트 11) | **받는다**: 이름 `11`, 도수 R 5 b7 9 11(3도 생략) | 표에 없지만 R&B 악보에 흔해서, 못 읽으면 붙여넣기 줄 전체가 떨어짐. 3도 생략은 관례 |
| `C5`(파워코드)·`C2`·`add11` | 받지 않음(`unknown-suffix`) | 설계 표 밖. 필요하면 CH-2b 전에 추가 |
| 소문자 근음(`am`) | 받지 않음(`bad-root`) | 가사 단어 오인 방지(붙여넣기) |
| 7도 없는 코드의 텐션 | 9만 `add9`로(`C(9)` = Cadd9), 나머지는 `conflict`(`C(#11)`) | |
| 로마숫자 `madd9`·`m6` | `iimadd9`·`iim6` (bare `m`만 접미사 없음) | 템플릿 `iim7`처럼 7화음류는 m을 남기는 규칙과 맞춤 |
| `mmaj7` 로마숫자 | `imM7` | `maj`→`M` 규칙 |
| 슬래시 베이스 6반음 | `#IV`(예 `D/F#` @C → `II/#IV`) | 베이스는 대문자 고정이라 마이너 판정이 없음 |
| 키 이름 형식 | `toRoman`·`parseKey`는 정확히 `F Major`/`A min`만 | 느슨한 형식(`F major`·`Am`) 정규화는 서버(CH-3) 몫 — 설계 §5-3 |
| 키 추정 I·i 판정 | 근음 = 으뜸음 + (메이저 키: b3 없음 / 마이너 키: b3 있음). `V7` = 5도 근음 + 3·b7 | 설계 §5-4를 코드로 옮긴 정의 |
| 키 추정 동점 | `KEYS` 순서 | 결과가 매번 같게 |
| 붙여넣기 섹션 이름 | `[아무거나]`(코드가 아니면) 또는 알려진 단어(Intro·Verse·Pre-Chorus·Chorus·Bridge·Interlude·Solo·Hook·Outro … + 한국어 인트로·벌스·후렴·브릿지·간주 …) + 번호 + `:` | "Bridge over troubled water" 같은 가사는 콜론 없고 뒤가 코드가 아니라 머리로 안 봄 |
| `findRepeats` 합치기 | 같은 묶음·회전 → 먼저 나온 쪽(시작 위치·표기), 반복 수와 순위 점수는 그 묶음들 중 최댓값 | 설계 "먼저 나온 쪽" + 같은 후렴이 뒤에서 더 많이 반복될 때 반복 수가 작게 보이지 않게 |
| 더 짧은 묶음의 반복(`C G C G`) · 한 코드 반복(`C C`) | 후보에서 뺀다 | 4코드 ×2 = 2코드 ×4 중복 방지 |
| 같은 코드 다른 표기 | `FM7`·`Fmaj7`은 같은 코드로 반복 판정 | 근음·정규 퀄리티·베이스 비교 |

## 4. 키 추정 실측 점수 (설계 §5-4 테스트 기준)

```
C Am F G             C Major 6    · G Major 5.17 · A min 4
Am Dm E7 Am          A min 8.5    · C Major 3.75 · D min 3.5
FM7 E7 Am7 Gm7 C7    F Major 6.5  · C Major 5.75 · A min 5.5     ← A min·F Major 둘 다 3개 안
C                    C Major 4.5  · D min 1      · E min 1
```

- **설계와 다른 점 하나**: 설계는 "코드 1개(`C`) → 점수 차가 작음"이라 했지만, 규칙대로면 첫 코드 +2·마지막 코드 +1.5가 같은 코드에 겹쳐 C Major 4.5 vs 1로 차가 크다. 화면은 어차피 "키 추정 → 확인"이라 1등을 기본 선택하고 사용자가 고르므로 규칙은 그대로 뒀다. 코드가 적을 때 확신을 낮추려면(예: 코드 1개면 보너스 안 줌) CH-5 전에 정하면 된다

## 5. 실행 결과 (로컬, Node 26.8.1)

```
node --test test/ch2_chord_parser.test.js  → tests 89, pass 89, fail 0
npx tsc --noEmit -p .                      → 통과 (lib/chords/*.mts 4개 검사 대상에 포함 확인: --listFilesOnly)
npm run build                              → ✓ built
npm test                                   → tests 247, pass 247, fail 0
```

- 변이 확인: `roman.mts`의 6반음 규칙(`#IV`/`bV`)을 뒤집으면 CH-2-4의 "6반음"·"슬래시" 2개 실패 → 원복 후 89개 통과
- 테스트 묶음: CH-2-1 별칭 → 정규 퀄리티(설계 표 전부 + 도수 + `BASE_QUALITIES` 34개), CH-2-2 근음·베이스, CH-2-3 잘못된 입력 19개 + `splitQuality`, CH-2-4 로마숫자, CH-2-5 키 추정, CH-2-6 `extractChordLines`, CH-2-7 `findRepeats`

## 6. 다음 step(CH-2b)에 넘길 것

- 퀄리티 목록 = §2 `BASE_QUALITIES` + 텐션 조합. 엔진은 `parseChord(...).degrees`를 `genVoicingsByDegrees(root, degrees, opts)`에 넘긴다
- 엔진 `DEG`에 추가할 도수: `2`, `#5`, `bb7` (반음은 `DEGREE_SEMITONES` 값과 같게: 2→2, #5→8, bb7→9). 분류(`cls`)는 CH-2b에서 정한다(예 `2`·`4`는 `'3'` 자리, `#5`는 `'5'`, `bb7`은 `'7'`)
- 도수 6개 이상인 코드(예 `C13b9` = R 3 5 b7 b9 13 → 6개, `C7alt` = 6개): 설계 §6-2 생략 순서 `5 → R → 9`
