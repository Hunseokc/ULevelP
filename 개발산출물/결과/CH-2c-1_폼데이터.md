# CH-2c-1 결과 — 정석 코드 폼 데이터 (chords-db → `chordForms.json`)

- 날짜: 2026-11-04 (mac, Node 24.16.0)
- 입력: `진행_코드진행모음.md` §3(2026-11-04 정석 폼·데이터원), `결과/CH-2b_엔진퀄리티.md`, `결과/CH-2_코드파서.md` §2
- 상태: **완료** — 로컬(§5) + Draft PR #63 CI 전부 통과(Test Node 22·24, Kotlin, E2E spa·legacy, Docker — run 41814681626, 커밋 `a389a9e`)

## 1. 데이터원 결정 — ① 공개 JSON 코드 DB 채택 (②·③ 안 씀)

| 항목 | 확인 |
| --- | --- |
| 실존 | `github.com/tombatossals/chords-db` (591★, archived 아님, 마지막 push 2026-05-09). 고정 커밋 `df06fa7b425cf5fd29485ff6591236b3557e3fac`(2025-10-14) |
| 라이선스 | **MIT** (c) 2016 David Rubert — 저작권·허가 문구를 사본에 포함해야 함 → `frontend/src/lib/engine/chordForms.LICENSE.txt` |
| 약관·robots | GitHub 공개 저장소 파일 1개를 1회 내려받음(`raw.githubusercontent.com` 200). 크롤링 아님 → ②의 약관·robots 확인 대상 아님 |
| 형식 | `lib/guitar.json`: 표준 튜닝, 키 12 × suffix 86 = 828 코드, 폼 3283개. 폼 = `frets`(6번→1번 줄, `-1` 막음, `baseFret` 기준 상대 프렛) · `fingers` · `barres` · `baseFret` · `midi` |
| 맞는지 | F 바레 `1 3 3 2 1 1`, 오픈 C `x 3 2 0 1 0` 등 정석 폼이 그대로 있음. 이 앱 형식(절대 프렛)으로 바꾸기만 하면 됨 |

## 2. 바꾼 파일 (사용자 확인 경로)

| 파일 | 내용 |
| --- | --- |
| ★`개발산출물/자료/chords-db_guitar.json` | 원본 고정본(위 커밋의 `lib/guitar.json` 그대로, 378KB) |
| ★`scripts/build_chord_forms.mjs` | 원본 → 정규화·검증 → JSON. `--check`는 저장본과 같은지만 확인. export `build`·`checkForm`·`allowedExtra`·`allowedOmit` |
| ★`frontend/src/lib/engine/chordForms.json` | 정석 폼 표(286KB, gzip 35KB) |
| ★`frontend/src/lib/engine/chordForms.LICENSE.txt` | 출처 + MIT 고지 |
| ★`test/ch2c1_chord_forms.test.js` | 25개(§5) |

다시 만들기: `node scripts/build_chord_forms.mjs` (원본·규칙이 같으면 바이트 단위로 같음 — 테스트 CH-2c-1-1)

## 3. `chordForms.json` 형식 (CH-2c-2가 읽는 모양)

```jsonc
{
  "source": { "name": "chords-db", "url": "...", "file": "lib/guitar.json", "commit": "df06fa7…", "license": "MIT …" },
  "tuning": [40, 45, 50, 55, 59, 64],          // midi, 6번 줄 → 1번 줄
  "forms": {
    "5:maj": {                                  // id = `${root}:${quality}` (+ `/${bass}`), root·bass = 0..11, quality = parseChord().quality
      "name": "F",                              // 표시 이름(근음 철자 C Db D Eb E F F# G Ab A Bb B)
      "forms": [                                // 원본 순서(대체로 낮은 자리 → 높은 자리, 첫 폼 = 오픈/1포지션)
        { "frets": [1,3,3,2,1,1],               // 절대 프렛, -1 막음, 0 개방
          "fingers": [1,3,4,2,1,1],             // 0 = 안 누름/막음
          "barres": [1],                        // 절대 프렛
          "src": "F major #1",                  // 원본 key suffix #순번
          "omit": ["5"],                        // (있을 때만) 빠진 도수
          "add": ["9"],                         // (있을 때만) 허용한 아래 텐션
          "fix": "mute-low" }                   // (있을 때만) 아래 줄을 막아 고친 폼
      ]
    },
    "0:maj/4": { "name": "C/E", "forms": [ ... ] }
  }
}
```

- 조회: `const c = parseChord(text); FORMS.forms[`${c.root}:${c.quality}${c.bass != null ? '/' + c.bass : ''}`]` — 이름 철자가 아니라 피치클래스로 찾으므로 `C#`·`Db` 구분 없음
- 같은 코드의 같은 프렛은 한 번만(예 `sus`와 `sus4`가 같은 id로 합쳐짐)
- 화면 번들 크기: 엔진이 import하면 JS +35KB(gzip). 늦게 불러올지(dynamic import)는 CH-2c-2에서 결정

## 4. 정규화·검증 규칙

| 규칙 | 내용 | 결정 |
| --- | --- | --- |
| 이름 | `key + suffix`를 CH-2 `parseChord`에 넣음. 바꾸는 것만: `major→''` `minor→m` `sus→sus`(=sus4) `aug7→7#5` `aug9→9#5`, 나머지(슬래시 포함)는 그대로 | 표에 없는 이름은 파서가 판정 |
| 파서 미지원 | `sus2sus4`(conflict) · `alt`(conflict — chords-db의 alt는 7alt가 아니라 `R 3 b5` 3화음) · `5`·`add11`(unknown-suffix) → **47개 이름 163폼 제외**(목록 §6) | CH-2 결정(`C5`·`add11` 안 받음) 그대로 |
| 원본 일치 | 절대 프렛 → midi가 원본 `midi`와 같아야 함 | 불일치 0개 |
| 울리는 음 | 구성음(`chordPcs`, 베이스 포함) 안에 있어야 함. 단 11·13 코드의 아래 텐션(11: 9, 도미넌트 11: 9·3도, 13: 9·11)은 허용하고 `add`로 남김 | **사용자 결정 2026-11-04**(파서는 "맨 위 확장음 하나만"이라 원본과 어긋난 폼 약 180개). `add` 폼 167개 |
| 생략 | 5도만 허용(+ 11·13 코드의 9). 3도·7도·변화 5도·맨 위 확장음이 빠지면 불일치 | 이 step에서 정함 — "표는 틀릴 일이 없게". 이 규칙이 없으면 `Cm9/Bb` 같은 b3 없는 폼이 들어옴 |
| 맨 아래 | 가장 낮은 음 = 베이스(슬래시) 또는 근음. 아니면 그 음이 나올 때까지 아래 줄을 막고(3음 이상 남고 다른 검증도 통과할 때만) `fix: 'mute-low'`, 막은 줄의 `fingers`는 0, 한 줄만 남은 바레는 지움 | **사용자 결정 2026-11-04**. 예 B `2 2 4 4 4 2`(6번 줄 F#) → `x 2 4 4 4 2`. 고친 폼 273개 |
| 프렛 폭 | 누르는 프렛(0 제외) 최고−최저+1 ≤ 4 (`fretsOnChord`) | 불일치 0개 |

## 5. 결과 수치

```
원본 828 코드 · 3283 폼
 ├ 파서 미지원      47 이름 · 163 폼
 ├ 검증 불일치     212 폼 (bottom 127 · omit 105 · extra 24 — 한 폼에 여러 개 가능)
 └ 표에 넣음      2879 폼 · 756 id   (mute-low 273 · add 167 · omit 5 362 · omit 9 19 · omit 5,9 20)
```

- 불일치가 몰린 곳: `m9/<b7>` 슬래시(12키 × 4 = 48폼, 전부 b3 없음 — 원본 표기 문제), `11`(3도 아닌 음), `madd9`(E 4폼 전부)
- 실행

```
node scripts/build_chord_forms.mjs --check       → check: same
node --test test/ch2c1_chord_forms.test.js       → tests 25, pass 25, fail 0
npm test                                         → tests 298, pass 298, fail 0   (273 + 25)
npx tsc --noEmit -p .                            → 통과
npm run build                                    → ✓ built
```

- 테스트: CH-2c-1-1 원본 → JSON 재현 + 수치 / CH-2c-1-2 저장된 2879폼을 스크립트와 따로 다시 검증 / CH-2c-1-3 정석 폼 14개(F 바레·오픈 C G D A E Am Em Dm·Bm·C7·G7·Am7·Fmaj7) + 오픈 7개는 첫 폼 + B 바레 mute-low / CH-2c-1-4 잘못된 입력(C에 F 폼·Cm에 C 폼·폭 6·midi 불일치·상대 프렛 계산·허용 텐션)
- 변이 확인: 생략 허용에 `b3`를 넣으면 3개 실패 → 원복 후 25개 통과

### 정석 폼 실측 (표의 폼, `*` = mute-low)

```
C   x 3 2 0 1 0 | x 3 5 5 5 3 | x x x 5 5 8* | 8 10 10 9 8 8
G   3 2 0 0 0 3 | 3 5 5 4 3 3 | x x 5 7 8 7 | x 10 9 7 8 7*
D   x x 0 2 3 2 | x 5 4 2 3 2 | x 5 7 7 7 5 | 10 12 12 11 10 10
Am  x 0 2 2 1 0 | x 0 2 5 5 5 | 5 7 7 5 5 5 | x 0 7 9 10 8
Em  0 2 2 0 0 0 | 0 2 2 4 5 3 | x 7 9 9 8 7 | 12 10 9 9 x x
F   1 3 3 2 1 1 | x x 3 2 1 1 | x x 3 5 6 5 | x 8 7 5 6 5 | x 8 10 10 10 8
Dm  x x 0 2 3 1 | x 5 7 7 6 5* | 10 12 12 10 10 10
C7  x 3 2 3 1 0 | x 3 5 3 5 3 | x x x 5 5 6* | 8 10 8 9 8 8
```

## 6. 퀄리티 × 루트 커버리지 (폼 수, `·` = 없음)

| 퀄리티 | C | Db | D | Eb | E | F | F# | G | Ab | A | Bb | B | 합 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 11 | 4 | · | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 44 |
| 13 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 48 |
| 6 | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 46 |
| 69 | 4 | 4 | 4 | 3 | 3 | 3 | 3 | 4 | 3 | 4 | 4 | 4 | 43 |
| 7 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 48 |
| 7#5 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 48 |
| 7#9 | 4 | 3 | 3 | 3 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 44 |
| 7b5 | 3 | 3 | 3 | 2 | 3 | 3 | 3 | 4 | 3 | 3 | 4 | 4 | 38 |
| 7b9 | 4 | 3 | 3 | 4 | 4 | 4 | 4 | 4 | 2 | 4 | 4 | 4 | 44 |
| 7sus4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 48 |
| 9 | 3 | 4 | 3 | 4 | 3 | 3 | 3 | 4 | 4 | 4 | 4 | 4 | 43 |
| 9#11 | 2 | 1 | 2 | 2 | 2 | 2 | 2 | 2 | 1 | 2 | 3 | 1 | 22 |
| 9#5 | 3 | 4 | 3 | 3 | 4 | 3 | 4 | 3 | 2 | 4 | 3 | 2 | 38 |
| 9b5 | 4 | 3 | 4 | 4 | 4 | 4 | 3 | 3 | 4 | 4 | 4 | 4 | 45 |
| add9 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 47 |
| aug | 4 | 2 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 44 |
| dim | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 47 |
| dim7 | 3 | 3 | 4 | 3 | 4 | 4 | 4 | 4 | 3 | 4 | 3 | 3 | 42 |
| m | 4 | 4 | 3 | 3 | 4 | 4 | 3 | 4 | 3 | 4 | 4 | 3 | 43 |
| m11 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 47 |
| m6 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 47 |
| m69 | 4 | 4 | 3 | 2 | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 2 | 36 |
| m7 | 5 | 5 | 5 | 5 | 7 | 6 | 6 | 5 | 5 | 6 | 4 | 5 | 64 |
| m7b5 | 3 | 3 | 4 | 3 | 3 | 4 | 3 | 4 | 3 | 4 | 3 | 4 | 41 |
| m9 | 3 | 2 | 3 | 2 | 4 | 4 | 3 | 3 | 3 | 3 | 3 | 2 | 35 |
| madd9 | 4 | 4 | 4 | 3 | · | 4 | 4 | 3 | 4 | 4 | 3 | 3 | 40 |
| maj | 4 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | 4 | 4 | 4 | 4 | 49 |
| maj11 | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 3 | 4 | 3 | 4 | 4 | 45 |
| maj13 | 4 | 4 | 4 | 3 | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 46 |
| maj7 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 48 |
| maj7#5 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 4 | 4 | 3 | 4 | 45 |
| maj7b5 | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 47 |
| maj7sus2 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 48 |
| maj9 | 3 | 4 | 3 | 2 | 2 | 2 | 4 | 3 | 3 | 4 | 4 | 3 | 37 |
| mmaj11 | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 47 |
| mmaj7 | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 46 |
| mmaj7b5 | 4 | 4 | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 4 | 4 | 4 | 41 |
| mmaj9 | 4 | 4 | 2 | 3 | 4 | 4 | 4 | 3 | 3 | 4 | 3 | 4 | 42 |
| sus2 | 4 | 4 | 2 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 46 |
| sus4 | 6 | 6 | 6 | 5 | 7 | 5 | 6 | 6 | 6 | 7 | 6 | 7 | 73 |
| slash | 93 | 90 | 91 | 90 | 91 | 90 | 92 | 90 | 90 | 90 | 90 | 90 | 1087 |

- slash 행 = 슬래시 코드 합(장·단 3화음 × 다른 11개 베이스가 대부분 + `m9/<b3>` 일부 + `C7/G`). 이름별 폼 수:

```
C7/G 3  Cm/Db 4  Cm/D 4  Cm/Eb 4  Cm/E 4  Cm/F 4  Cm/F# 4  Cm/G 4  Cm/Ab 4  Cm/A 4  Cm/Bb 4  Cm/B 4  Cm9/Eb 2  C/Db 4  C/D 4  C/Eb 4  C/E 4  C/F 4  C/F# 4  C/G 
4  C/Ab 4  C/A 4  C/Bb 4  C/B 4  Dbm/C 4  Dbm/D 4  Dbm/Eb 4  Dbm/E 4  Dbm/F 4  Dbm/F# 4  Dbm/G 4  Dbm/Ab 4  Dbm/A 4  Dbm/Bb 4  Dbm/B 4  Dbm9/E 2  Db/C 4  Db/D 
4  Db/Eb 4  Db/E 4  Db/F 4  Db/F# 4  Db/G 4  Db/Ab 4  Db/A 4  Db/Bb 4  Db/B 4  Dm/C 4  Dm/Db 4  Dm/Eb 4  Dm/E 4  Dm/F 4  Dm/F# 4  Dm/G 4  Dm/Ab 4  Dm/A 4  
Dm/Bb 4  Dm/B 4  Dm9/F 3  D/C 4  D/Db 4  D/Eb 4  D/E 4  D/F 4  D/F# 4  D/G 4  D/Ab 4  D/A 4  D/Bb 4  D/B 4  Ebm/C 4  Ebm/Db 4  Ebm/D 4  Ebm/E 4  Ebm/F 4  
Ebm/F# 4  Ebm/G 4  Ebm/Ab 4  Ebm/A 4  Ebm/Bb 4  Ebm/B 4  Ebm9/F# 2  Eb/C 4  Eb/Db 4  Eb/D 4  Eb/E 4  Eb/F 4  Eb/F# 4  Eb/G 4  Eb/Ab 4  Eb/A 4  Eb/Bb 4  Eb/B 4  
Em/C 4  Em/Db 4  Em/D 4  Em/Eb 4  Em/F 4  Em/F# 4  Em/G 4  Em/Ab 4  Em/A 4  Em/Bb 4  Em/B 4  Em9/G 3  E/C 4  E/Db 4  E/D 4  E/Eb 4  E/F 4  E/F# 4  E/G 4  E/Ab 
4  E/A 4  E/Bb 4  E/B 4  Fm/C 4  Fm/Db 4  Fm/D 4  Fm/Eb 4  Fm/E 4  Fm/F# 4  Fm/G 4  Fm/Ab 4  Fm/A 4  Fm/Bb 4  Fm/B 4  Fm9/Ab 2  F/C 4  F/Db 4  F/D 4  F/Eb 4  
F/E 4  F/F# 4  F/G 4  F/Ab 4  F/A 4  F/Bb 4  F/B 4  F#m/C 4  F#m/Db 4  F#m/D 4  F#m/Eb 4  F#m/E 4  F#m/F 4  F#m/G 4  F#m/Ab 4  F#m/A 4  F#m/Bb 4  F#m/B 4  
F#m9/E 2  F#m9/A 2  F#/C 4  F#/Db 4  F#/D 4  F#/Eb 4  F#/E 4  F#/F 4  F#/G 4  F#/Ab 4  F#/A 4  F#/Bb 4  F#/B 4  Gm/C 4  Gm/Db 4  Gm/D 4  Gm/Eb 4  Gm/E 4  Gm/F 
4  Gm/F# 4  Gm/Ab 4  Gm/A 4  Gm/Bb 4  Gm/B 4  Gm9/Bb 2  G/C 4  G/Db 4  G/D 4  G/Eb 4  G/E 4  G/F 4  G/F# 4  G/Ab 4  G/A 4  G/Bb 4  G/B 4  Abm/C 4  Abm/Db 4  
Abm/D 4  Abm/Eb 4  Abm/E 4  Abm/F 4  Abm/F# 4  Abm/G 4  Abm/A 4  Abm/Bb 4  Abm/B 4  Abm9/B 2  Ab/C 4  Ab/Db 4  Ab/D 4  Ab/Eb 4  Ab/E 4  Ab/F 4  Ab/F# 4  Ab/G 4 
 Ab/A 4  Ab/Bb 4  Ab/B 4  Am/C 4  Am/Db 4  Am/D 4  Am/Eb 4  Am/E 4  Am/F 4  Am/F# 4  Am/G 4  Am/Ab 4  Am/Bb 4  Am/B 4  Am9/C 2  A/C 4  A/Db 4  A/D 4  A/Eb 4  
A/E 4  A/F 4  A/F# 4  A/G 4  A/Ab 4  A/Bb 4  A/B 4  Bbm/C 4  Bbm/Db 4  Bbm/D 4  Bbm/Eb 4  Bbm/E 4  Bbm/F 4  Bbm/F# 4  Bbm/G 4  Bbm/Ab 4  Bbm/A 4  Bbm/B 4  
Bbm9/Db 2  Bb/C 4  Bb/Db 4  Bb/D 4  Bb/Eb 4  Bb/E 4  Bb/F 4  Bb/F# 4  Bb/G 4  Bb/Ab 4  Bb/A 4  Bb/B 4  Bm/C 4  Bm/Db 4  Bm/D 4  Bm/Eb 4  Bm/E 4  Bm/F 4  Bm/F# 
4  Bm/G 4  Bm/Ab 4  Bm/A 4  Bm/Bb 4  Bm9/D 2  B/C 4  B/Db 4  B/D 4  B/Eb 4  B/E 4  B/F 4  B/F# 4  B/G 4  B/Ab 4  B/A 4  B/Bb 4
```

- 없는 칸: `Db11`(4폼 전부 불일치), `Emadd9`(4폼 전부 불일치). 파서가 받지만 표에 없는 퀄리티(예 `m13`·`9sus4`·`13sus4`·`7alt`·`maj7#11`·`7b9b13` 같은 텐션 조합)는 CH-2c-2 규칙이 만든다

## 7. 불일치 목록 (212폼 — 표에서 뺐고 버리지 않고 남김)

형식: `파서 이름  원본 key suffix #순번  절대 프렛  문제`

```
  Cdim7     C dim7 #1        x x 1 2 1 2        bottom:Eb
  C7b5      C 7b5 #1         x x 2 3 1 2        bottom:E
  C9        C 9 #1           0 3 2 0 3 0        bottom:E omit:b7
  C9        C 9 #4           8 10 8 7 8 10      omit:3
  C9#5      C aug9 #3        6 5 6 5 5 6        bottom:Bb
  C9#11     C 9#11 #2        x 3 4 3 5 3        omit:9
  C9#11     C 9#11 #4        x x 10 11 11 12    omit:9
  Cmaj9     C maj9 #3        0 5 5 5 5 7        bottom:E
  Cm7b5     C m7b5 #2        x x 4 5 4 6        bottom:F#
  Cm9       C m9 #3          x 6 8 7 8 8        bottom:Eb
  Cm9/Bb    C m9/Bb #1       6 3 5 3 3 3        omit:b3
  Cm9/Bb    C m9/Bb #2       6 3 5 5 3 3        omit:b3
  Cm9/Bb    C m9/Bb #3       x 13 10 12 11 10   omit:b3
  Cm9/Bb    C m9/Bb #4       6 3 5 3 3 x        omit:b3
  C#dim7    C# dim7 #1       x x 2 3 2 3        bottom:E
  C#aug     C# aug #1        x 4 4 4 2 2        extra:F#,B omit:3,#5
  C#aug     C# aug #2        4 4 6 4 7 4        extra:Ab,B,F# bottom:Ab omit:3,#5
  C#7b5     C# 7b5 #4        x x 12 13 13 14    extra:D,Ab,C,F# bottom:D omit:R,3,b5,b7
  C#7b9     C# 7b9 #4        x x 9 10 9 10      bottom:B omit:R
  C#7#9     C# 7#9 #3        x 8 9 9 9 9        bottom:F
  C#11      C# 11 #1         x 4 3 0 0 4        extra:G omit:11
  C#11      C# 11 #2         x 4 5 4 6 4        extra:G omit:11
  C#11      C# 11 #3         9 8 9 8 8 9        extra:G omit:11
  C#11      C# 11 #4         9 10 9 10 9 9      extra:G omit:11
  C#9#11    C# 9#11 #1       x 3 2 0 0 3        extra:C,E bottom:C omit:R,3,9
  C#9#11    C# 9#11 #2       x 4 5 4 6 4        omit:9
  C#9#11    C# 9#11 #4       9 10 9 10 9 9      omit:9
  C#m7b5    C# m7b5 #2       x x 5 6 5 7        bottom:G
  C#m9      C# m9 #2         x 6 6 6 5 7        bottom:Eb
  C#m9      C# m9 #3         x 7 9 8 9 9        bottom:E
  C#m9/B    C# m9/B #1       7 4 6 4 4 4        omit:b3
  C#m9/B    C# m9/B #2       7 4 6 6 4 4        omit:b3
  C#m9/B    C# m9/B #3       x 14 11 13 12 11   omit:b3
  C#m9/B    C# m9/B #4       7 4 6 4 4 x        omit:b3
  Dm        D minor #3       x 8 7 7 6 x        bottom:F
  Dsus2     D sus2 #2        x x 2 2 3 5        bottom:E
  Dsus2     D sus2 #4        x 7 7 7 10 10      bottom:E
  D6        D 6 #4           7 9 7 7 10 7       bottom:B
  D7b5      D 7b5 #2         x x 4 5 3 4        bottom:F#
  D9        D 9 #2           x 7 0 7 7 8        bottom:E
  D9#5      D aug9 #2        x 7 0 5 7 6        bottom:E
  D7b9      D 7b9 #3         x 6 0 5 7 5        bottom:Eb
  D7#9      D 7#9 #3         x 8 7 7 7 8        bottom:F
  D9#11     D 9#11 #1        x x 0 1 1 2        omit:9
  D9#11     D 9#11 #3        x 9 0 7 9 8        bottom:F# omit:9
  Dmaj9     D maj9 #2        x 5 4 6 4 x        extra:Eb omit:9
  Dmaj11    D maj11 #3       x 9 0 7 8 9        bottom:F#
  Dm9       D m9 #1          1 0 0 2 1 0        bottom:F
  Dm69      D m69 #3         x 7 0 7 6 7        bottom:E
  Dmmaj7    D mmaj7 #2       x 5 3 2 2 0        extra:E
  Dmmaj9    D mmaj9 #2       x 7 0 6 6 5        bottom:E
  Dmmaj9    D mmaj9 #3       x 8 0 9 10 9       bottom:F
  Dmmaj11   D mmaj11 #3      5 5 5 7 7 5        extra:F# bottom:A omit:b3,7
  Dm9/C     D m9/C #1        x 3 0 2 1 0        omit:b3
  Dm9/C     D m9/C #2        x 3 0 2 3 0        omit:b3
  Dm9/C     D m9/C #3        8 5 7 5 5 5        omit:b3
  Dm9/C     D m9/C #4        8 5 7 7 5 5        omit:b3
  Ebm       Eb minor #2      x x 4 3 4 2        bottom:F#
  Ebdim7    Eb dim7 #3       x x 7 8 7 8        bottom:A
  Ebsus4    Eb sus4 #3       x x 8 8 9 x        bottom:Bb
  Ebaug     Eb aug #1        x x 5 4 4 3        bottom:G
  Eb69      Eb 69 #2         x 3 3 3 4 3        bottom:C
  Eb7b5     Eb 7b5 #2        x x 5 6 4 5        bottom:G
  Eb7b5     Eb 7b5 #3        x 6 7 6 8 6        extra:Bb
  Eb9#5     Eb aug9 #1       3 4 3 4 4 3        bottom:G
  Eb7#9     Eb 7#9 #3        x 9 8 8 8 9        bottom:F#
  Eb9#11    Eb 9#11 #1       x x 1 2 2 3        omit:9
  Eb9#11    Eb 9#11 #3       x 6 7 6 8 x        omit:9
  Ebmaj7b5  Eb maj7b5 #2     x 6 7 7 8 6        extra:Bb
  Ebmaj9    Eb maj9 #3       x 8 8 8 8 10       bottom:F
  Ebmaj9    Eb maj9 #4       x x 12 12 11 13    bottom:D omit:R
  Ebmaj13   Eb maj13 #1      x 3 1 0 3 x        bottom:C
  Ebm7b5    Eb m7b5 #3       x x 7 8 7 9        bottom:A
  Ebm9      Eb m9 #2         x x 8 10 7 9       bottom:Bb omit:R
  Ebm9      Eb m9 #3         x 9 11 10 11 11    bottom:F#
  Ebm69     Eb m69 #1        2 x 1 3 1 1        bottom:F#
  Ebm69     Eb m69 #3        11 9 10 10 9 9     extra:Ab,Db
  Ebmmaj9   Eb mmaj9 #2      6 9 8 7 6 6        bottom:Bb omit:R
  Ebmadd9   Eb madd9 #1      x x 4 3 4 1        bottom:F#
  Ebm9/C#   Eb m9/C# #1      x 4 1 3 2 1        omit:b3
  Ebm9/C#   Eb m9/C# #2      9 6 8 6 6 6        omit:b3
  Ebm9/C#   Eb m9/C# #3      9 6 8 8 6 6        omit:b3
  Ebm9/C#   Eb m9/C# #4      9 6 8 6 6 x        omit:b3
  E69       E 69 #3          x 9 9 9 9 9        bottom:F#
  E7b5      E 7b5 #3         x x 6 7 5 6        bottom:Ab
  E9        E 9 #2           4 x 2 4 3 2        bottom:Ab
  E9#11     E 9#11 #1        0 1 0 1 0 0        omit:9
  E9#11     E 9#11 #2        0 5 0 3 5 4        omit:9
  Emaj9     E maj9 #2        4 2 2 4 4 2        bottom:Ab
  Emaj9     E maj9 #4        x x 9 11 9 11      bottom:B omit:R
  Em7b5     E m7b5 #3        x x 8 9 8 10       bottom:Bb
  Em69      E m69 #2         3 x 2 4 2 2        bottom:G
  Emadd9    E madd9 #1       x x 3 1 1 3        extra:F,Ab,C bottom:F omit:R,9
  Emadd9    E madd9 #2       x 8 6 5 8 x        extra:F,Ab,C bottom:F omit:R,9
  Emadd9    E madd9 #3       x 8 6 0 6 8        extra:F,Ab,C bottom:F omit:R,9
  Emadd9    E madd9 #4       x 8 10 0 9 8       extra:F,C,Ab bottom:F omit:R,9
  Em9/D     E m9/D #1        x 5 2 4 3 2        omit:b3
  Em9/D     E m9/D #2        10 7 9 7 7 7       omit:b3
  Em9/D     E m9/D #3        10 7 9 9 7 7       omit:b3
  Em9/D     E m9/D #4        10 7 9 7 7 x       omit:b3
  Fsus4     F sus4 #4        x x 10 10 11 x     bottom:C
  F69       F 69 #3          x 5 5 5 6 5        bottom:D
  F7b5      F 7b5 #3         x x 7 8 6 7        bottom:A
  F9        F 9 #4           x 10 10 10 10 11   bottom:G
  F9#5      F aug9 #2        5 6 5 6 6 5        bottom:A
  F7#9      F 7#9 #4         x 11 10 10 10 11   bottom:Ab
  F9#11     F 9#11 #2        x x 3 4 4 5        omit:9
  F9#11     F 9#11 #4        x 8 9 8 10 8       omit:9
  Fmaj9     F maj9 #2        x x 2 2 1 3        bottom:E omit:R
  Fmaj9     F maj9 #4        x x 10 12 10 12    bottom:C omit:R
  Fm69      F m69 #2         4 x 3 5 3 3        bottom:Ab
  Fm9/Eb    F m9/Eb #1       x 6 3 5 4 3        omit:b3
  Fm9/Eb    F m9/Eb #2       11 8 10 8 8 8      omit:b3
  Fm9/Eb    F m9/Eb #3       11 8 10 10 8 8     omit:b3
  Fm9/Eb    F m9/Eb #4       11 8 10 8 8 x      omit:b3
  F#m       F# minor #3      x x 7 6 7 5        bottom:A
  F#69      F# 69 #3         x 6 6 6 7 6        bottom:Eb
  F#7b5     F# 7b5 #3        x 7 8 9 7 8        bottom:E
  F#9       F# 9 #4          x 11 11 11 11 12   bottom:Ab
  F#9b5     F# 9b5 #3        x 3 4 3 5 4        bottom:C
  F#9#11    F# 9#11 #2       x x 4 5 5 6        omit:9
  F#9#11    F# 9#11 #4       x 9 10 9 11 9      omit:9
  F#maj7#5  F# maj7#5 #4     x x 12 11 11 13    bottom:D
  F#maj13   F# maj13 #2      x 6 4 4 6 6        bottom:Eb
  F#m7b5    F# m7b5 #4       x x 10 11 10 12    bottom:C
  F#m9      F# m9 #4         x x 11 13 10 12    bottom:Db omit:R
  F#m69     F# m69 #3        5 4 4 6 4 4        bottom:A
  F#m9/E    F# m9/E #3       x 7 4 6 5 4        omit:b3
  F#m9/E    F# m9/E #4       12 9 11 9 9 9      omit:b3
  G9b5      G 9b5 #4         x 12 11 0 0 13     bottom:A
  G9#5      G aug9 #4        x 12 13 0 12 13    bottom:A
  G9#11     G 9#11 #2        x x 5 6 6 7        omit:9
  G9#11     G 9#11 #4        x 10 11 10 12 10   omit:9
  Gmaj7#5   G maj7#5 #1      x x 1 0 0 2        bottom:Eb
  Gmaj9     G maj9 #3        x x 4 4 3 5        bottom:F# omit:R
  Gmaj11    G maj11 #3       x x 9 0 7 8        bottom:B
  Gm9       G m9 #3          x x 7 0 6 6        bottom:A
  Gm69      G m69 #3         6 5 5 7 5 5        bottom:Bb
  Gm11      G m11 #3         x x 5 5 7 7        extra:F#,B omit:b3,b7
  Gmmaj9    G mmaj9 #3       x x 7 0 7 6        bottom:A
  Gadd9     G add9 #2        x x 3 2 1 4        extra:F,C,Ab bottom:F omit:R,3
  Gmadd9    G madd9 #3       x x 7 0 8 6        bottom:A
  Gm9/F     G m9/F #1        x 8 5 7 6 5        omit:b3
  Gm9/F     G m9/F #2        13 10 12 10 10 10  omit:b3
  Gm9/F     G m9/F #3        13 10 12 12 10 10  omit:b3
  Gm9/F     G m9/F #4        13 10 12 10 10 x   omit:b3
  Abm       Ab minor #3      x x 9 8 9 7        bottom:B
  Abdim7    Ab dim7 #1       x x 0 1 0 1        bottom:D
  Ab69      Ab 69 #1         x 1 1 1 1 1        bottom:Bb
  Ab7b5     Ab 7b5 #3        x 9 10 11 9 10     bottom:F#
  Ab9#5     Ab aug9 #1       2 1 2 1 1 2        bottom:F#
  Ab9#5     Ab aug9 #3       x x 4 5 5 6        bottom:F# omit:R
  Ab7b9     Ab 7b9 #1        x 0 1 1 1 2        bottom:A
  Ab7b9     Ab 7b9 #2        x x 4 5 4 5        bottom:F# omit:R
  Ab9#11    Ab 9#11 #1       4 x 4 5 3 x        omit:9
  Ab9#11    Ab 9#11 #2       x x 6 7 7 8        omit:9
  Ab9#11    Ab 9#11 #4       x 11 12 11 13 11   omit:9
  Abmaj9    Ab maj9 #1       x 1 1 1 1 3        bottom:Bb
  Abm7b5    Ab m7b5 #1       x x 0 1 0 2        bottom:D
  Abm9      Ab m9 #3         7 9 8 8 9 7        bottom:B
  Abm69     Ab m69 #3        7 6 6 8 6 6        bottom:B
  Abmmaj7   Ab mmaj7 #1      x 2 1 1 4 3        bottom:B
  Abmmaj9   Ab mmaj9 #3      6 6 6 8 8 7        bottom:Bb
  Abm9/F#   Ab m9/F# #1      x 9 6 8 7 6        omit:b3
  Abm9/F#   Ab m9/F# #2      14 11 13 11 11 11  omit:b3
  Abm9/F#   Ab m9/F# #3      14 11 13 13 11 11  omit:b3
  Abm9/F#   Ab m9/F# #4      14 11 13 11 11 x   omit:b3
  Adim      A dim #2         5 3 x 4 3 x        extra:B,D omit:b5
  A7b5      A 7b5 #4         x 10 11 12 10 11   bottom:G
  A9#11     A 9#11 #1        x 0 1 0 2 0        omit:9
  A9#11     A 9#11 #3        x x 7 8 8 9        omit:9
  Amaj11    A maj11 #4       10 0 9 9 9 9       bottom:D
  Am9       A m9 #3          8 0 9 0 8 0        bottom:C
  Am69      A m69 #3         8 0 7 9 7 7        bottom:C
  Am9/G     A m9/G #1        3 0 2 0 0 0        omit:b3
  Am9/G     A m9/G #2        3 0 2 0 0 3        omit:b3
  Am9/G     A m9/G #3        3 0 2 2 0 0        omit:b3
  Am9/G     A m9/G #4        3 0 2 4 0 0        omit:b3
  Bbdim7    Bb dim7 #2       x x 2 3 2 3        bottom:E
  Bb6       Bb 6 #4          x 13 11 11 10 x    extra:Db,F#,A omit:3,6
  Bb9#5     Bb aug9 #2       4 3 4 3 3 4        bottom:Ab
  Bb9#11    Bb 9#11 #3       x x 8 9 9 10       omit:9
  Bbmaj7#5  Bb maj7#5 #2     x x 4 3 3 5        bottom:F#
  Bbm6      Bb m6 #2         x 4 5 3 6 x        bottom:Db
  Bbm7      Bb m7 #1         5 x 5 5 5 x        extra:A,G,C,E bottom:A omit:R,b3,b7
  Bbm7b5    Bb m7b5 #2       x x 2 3 2 4        bottom:E
  Bbm9      Bb m9 #1         x x 3 5 2 4        bottom:F omit:R
  Bbm69     Bb m69 #3        9 x 8 10 8 8       bottom:Db
  Bbmmaj9   Bb mmaj9 #4      8 8 8 10 10 9      bottom:C
  Bbmadd9   Bb madd9 #1      x 4 3 3 1 x        bottom:Db
  Bbm9/Ab   Bb m9/Ab #1      4 1 3 1 1 1        omit:b3
  Bbm9/Ab   Bb m9/Ab #2      4 1 3 3 1 1        omit:b3
  Bbm9/Ab   Bb m9/Ab #3      x 11 8 10 9 8      omit:b3
  Bbm9/Ab   Bb m9/Ab #4      4 1 3 1 1 x        omit:b3
  Bm        B minor #4       x x 12 11 12 10    bottom:D
  Bdim7     B dim7 #2        x x 3 4 3 4        bottom:F
  Baug      B aug #4         x 14 13 12 12 0    extra:E
  B9#5      B aug9 #2        5 4 5 4 4 5        bottom:A
  B9#5      B aug9 #4        11 12 11 12 12 11  bottom:Eb
  B9#11     B 9#11 #2        x 2 3 2 4 2        omit:9
  B9#11     B 9#11 #3        7 x 7 8 6 x        omit:9
  B9#11     B 9#11 #4        x x 9 10 10 11     omit:9
  Bmaj9     B maj9 #2        x x 4 6 4 6        bottom:F# omit:R
  Bm9       B m9 #2          x 4 4 4 3 5        bottom:Db
  Bm9       B m9 #4          10 12 11 11 12 10  bottom:D
  Bm69      B m69 #2         x 5 6 6 7 7        bottom:D
  Bm69      B m69 #4         10 x 9 11 9 9      bottom:D
  Bmadd9    B madd9 #1       x 5 4 4 2 x        bottom:D
  Bm9/A     B m9/A #1        5 2 4 2 2 2        omit:b3
  Bm9/A     B m9/A #2        5 2 4 4 2 2        omit:b3
  Bm9/A     B m9/A #3        x 12 9 11 10 9     omit:b3
  Bm9/A     B m9/A #4        5 2 4 2 2 x        omit:b3
```

### 파서 미지원 이름 (47개 · 163폼)

- `sus2sus4` 11 · `alt` 12 · `5` 12 · `add11` 12 (키별 1개씩, sus2sus4는 1키 없음)

## 8. 다음 step(CH-2c-2)에 넘길 것

- 표 조회: §3 id로 찾고, 없으면 규칙 생성. 표 폼의 `frets`는 엔진 보이싱과 같은 6줄 배열(6번 → 1번)이라 `notes`로 바꿀 때 `tuning` + 도수 판정(`DEGREE_SEMITONES`)을 쓰면 된다
- 재현율 기준 후보: 규칙이 각 id의 **첫 폼(오픈/1포지션)**을 상위 N개 안에 내는 비율. `fix`·`add` 폼은 재현율 분모에서 빼거나 따로 셀지 정할 것
- 프렛 범위(`lo`·`hi`)가 주어지면 표 폼도 그 범위로 거른다(오픈 폼은 `lo: 0`일 때만)
- 번들 크기 35KB(gzip) — 진행 연주 탭에서만 쓰면 dynamic import 고려
