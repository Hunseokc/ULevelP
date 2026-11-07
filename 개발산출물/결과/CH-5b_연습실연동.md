# CH-5b 결과 — 연습실 연동 (진행 연주 탭 · #prog? · 돌아오기 · 목록 검색·정렬)

- 날짜: 2026-11-04 (mac)
- 입력: `결과/CH-1a_프레임.md` §3, `결과/CH-1b_설계.md` §8·§9, `결과/CH-2b_엔진퀄리티.md` §2, `결과/CH-2c-2_정석폼.md` §2·§7, `결과/CH-5_CHORDS화면.md` §3
- 상태: **완료** — 로컬 §5 + Draft PR #63 CI 전부 통과(Test Node 22·24, Kotlin, E2E spa·legacy, Docker — run 41844239222, head `0a0768b`)

## 1. 만든 것

| 영역 | 내용 |
| --- | --- |
| 연습실 탭 | `CHORD_TABS`에 8번째 **`prog` "8 · 진행 연주"**(`#pane-prog`). `#prog` 또는 `#prog?c=&k=&t=&from=`로 열림(새로 열기·hashchange 둘 다). 다른 탭에 갔다가 돌아오면 같은 진행 해시로 복원(`progHash` 상태). `ulp:tab`에 `prog`도 저장 |
| 진행 받기 | `parseProgHash`(model.mts) = `playHref`의 역함수. 키는 `KEYS` 24개 표기만, `from`은 `[A-Za-z0-9_-]{1,64}`(UUID·시드 id), 코드 64개·제목 300자까지 |
| 보이싱 경로 | 표(`loadChordForms()`, 탭을 처음 열 때만 받음) + `PATH.bestPaths(…, { shapes: 'standard', formTable, loop: true, lo: 0, hi: 12 })`. 비면 `both`(간단한 폼 대체) → 그래도 비면 0~15프렛 `both` → 그래도 없으면 안내. 경로 1~3 선택 |
| 코드 칩 | 심볼(조옮김 반영) + 로마숫자(원래 키 기준 = 옮긴 키에서도 같음) + 못 읽는 코드는 잠금 "못 읽음 — 빠집니다" + 도수 중복 경고. `data-kind`=table/rule/compact, title에 "정석 폼/규칙 폼/간단한 폼(대체) · 5 생략 · 베이스 생략(재생 베이스로만)" |
| 다이어그램 | 코드마다 `ChordBoxSvg` + 프렛 문자열, 고른 코드는 `ChordNeckSvg`(지판 전체의 같은 코드톤) |
| 재생 | BPM(40~200, 기본 80)·코드당 박(1·2·4·8, 기본 4)·반복(기본 켬). 박마다 클릭, 코드 첫 박에 베이스(슬래시면 베이스음) + 코드. 탭을 떠나면 멈춤 |
| 키 옮기기 | −5~+6 반음. 근음·슬래시 베이스만 바꾸고 표기 유지(`transposeSymbol`), 철자는 옮긴 키(# 키면 #, 그 밖 b). 저장 안 함 |
| 다른 보이싱 | 고른 코드의 `chordCandidates` 상위 8개 → 눌러서 그 자리만 바꿈(경로·범위·조가 바뀌면 원래대로) |
| 기존 탭 입구 | 고른 코드가 매트릭스 Q4 9종이면 "보이싱 매트릭스에서 열기"(`mxRoot`·`mxQ`), 코드톤 지도 `ARP_Q` 5종이면 "코드톤 지도에서 열기"(`toneRoot`·`toneQ`) |
| 돌아오기 | "← 코드 진행 모음으로" = `backHref(from)` → `progressions.html?scope=all#p-<id>`, from 없으면 `progressions.html`. 진행 페이지는 `#p-`에 **시드 id도** 받아 그 행을 펼침(원래 UUID만) |
| 빈 상태 | 기본 시드 10개 링크 + "코드 직접 입력"(`splitChordInput` 규칙) → `#prog?c=…` |
| 목록 검색·정렬 | CHORDS 목록 위 `#progSearch`(곡명·아티스트·채널·키, 대소문자·공백 무시) + `#progSort`(최근 추가·곡명·키). 범위 토글 뒤에 적용, 검색 중 "N개 중 M개", 맞는 행 없음 안내 |

## 2. 파일

- 새: `frontend/src/components/chords/ProgressionPlayTab.tsx`, `test/e2e/progression-play.spec.js`
- 고침: `frontend/src/pages/ChordsPage.tsx`(탭·해시·입구)
- **§9 목록 밖(직접 결과):** `frontend/src/components/progressions/model.mts`(순수 함수 — 해시·돌아오기·조옮김·검색·정렬, node 테스트가 읽으려면 `.mts`여야 함), `frontend/src/pages/ProgressionsPage.tsx`·`.module.css`(검색·정렬 — 이번 요청에 포함, 시드 id 포커스), ★`test/ch5b_progression_play.test.js`
- **§9 목록에 있지만 안 고침:** `frontend/src/lib/progressions.ts`(`CHORD_MODES`) — §4 결정, `frontend/src/lib/musicEngine.ts` — CH-2b·2c-2의 export로 충분, `test/r2_chords.test.js` — 옛 `public/chords.html`(동결)을 검사하므로 기대값 그대로

## 3. 다음 step이 쓸 값

- **CH-6(홈 취향 카드 "연주하기")**: `playHref(p)`(model.mts) 그대로 → `chords.html#prog?…`. 비로그인 시드도 같음(`seedToDto`)
- 진행 연주 탭 공개 함수: `isProgHash`, `parseProgHash`, `backHref`, `transposeKey`, `transposeSymbol`; 목록: `searchProgressions`, `sortProgressions`, `SORT_LABEL`, 타입 `SortBy`·`ProgHash`
- e2e id: 연습실 `#pp-title #pp-chips #pp-boxes #pp-paths #pp-play #pp-semis #pp-lo #pp-hi #pp-bpm #pp-beats #pp-loop #pp-alt #pp-alts #pp-open-matrix #pp-open-tone #pp-back #pp-empty #pp-seeds #pp-input #pp-status #pp-skipped`, 목록 `#progTools #progSearch #progSort #progSearchCount #progNoMatch`

## 4. 정한 것 (설계에 없음)

| 항목 | 결정 | 이유 |
| --- | --- | --- |
| 홈 "7가지 연습 모드" | **그대로 7개**(`CHORD_MODES` 안 바꿈) | 진행 연주는 진행이 있어야 의미가 있고, 홈 입구는 CH-6 취향 카드 "연주하기"(CH-1a §1 ③). CH-1a §4 "홈 노출은 CH-5b에서 결정" |
| 대체 순서 | standard → both → 0~15 both → 안내 | CH-2c-2 §2 "범위를 넓히거나 both로". 코드별로 shapes를 섞는 API가 없어 진행 전체를 both로 |
| 기본 프렛 범위 | 0~12 | CH-2c-2 §7 제안(정석 폼은 개방현 포함). 프레임의 5~9는 compact 기준 |
| 로마숫자 | 원래 키로 계산, 조옮김해도 그대로 | 키와 코드를 같이 옮기므로 같음(단위 테스트 CH-5b-3) |
| 원본 건반 보이싱 링크 | 탭에 직접 링크 없음 — 안내 문구 + 돌아오기 → 행의 "노트" 버튼 | URL 형식(CH-1a §3-1 확정 `c·k·t·from`)에 노트 id가 없음. 링크를 넣으려면 `n=<noteId>` 파라미터 추가가 필요(메뉴얼) → 제안만 |
| 곡명 정렬 | `localeCompare('ko')` — 한글 → 영문, 제목 없는 행 마지막 | 한국어 화면 기준 |
| 키 정렬 | `KEYS` 24개 순서(C Major, C min, Db Major …), 키 없음 마지막, 같은 키는 곡명 | 반음 순으로 장·단조가 붙어 나옴 |
| 검색 대상 | 곡명·아티스트·채널·키 | 요청 "곡명·키 기준" + 아티스트·채널(분석 행은 채널이 곡 대신) |
| `ulp:tab` 초기 저장 | 새로 열 때는 저장 안 함(기존 동작 그대로), 탭을 바꿀 때 저장 | 기존 React 연습실 동작. e2e PP1이 그대로임을 확인 |
| 3화음 이동 비용 | `trans` 그대로(CH-2b §6 제안 보류) | C G Am F 등 시드·팝 진행에서 경로가 정석 폼으로 자연스럽게 나옴(§5 실측) |

## 5. 실행 결과 (로컬, mac)

```
npx tsc --noEmit -p .                          통과
npm run build                                  ✓ built — chordForms(gzip 34.6KB)·chordFormReview는 별도 청크(진행 연주 탭에서만 받음)
node --test test/ch5b_progression_play.test.js tests 17 pass 17
npm test                                       tests 366 pass 366 fail 0   (349 + 17)
ULP_UI=spa CI=1 npx playwright test            68 passed (progression-play.spec 5 포함)
ULP_UI=legacy CI=1 npx playwright test         16 passed, 52 skipped
```

- 단위 `ch5b_progression_play` 17개: 해시 왕복(쉼표·한글 제목)·시드 from·`isProgHash`(`#progress`·`#prog-x` 거절)·**잘못된 입력**(모르는 키 `k=F`, `"><script>` from, 80개 코드 → 64, 400자 제목 → 300) / 돌아오기 링크 / 조옮김(키·심볼·슬래시·`6/9`, 5개 반음 × 6코드로 퀄리티·근음·로마숫자 불변, 못 읽는 코드 그대로) / 검색·정렬 / 탭 연결·`shapes: 'standard'`·홈 7개 그대로 / **시드 10개 전부 경로 나옴**
- e2e `progression-play.spec.js` 5개:
  - PP1 **기존 7개 모드 회귀**: 탭 8개, 7개 해시로 새로 열기(그 패널만 보이고 SVG 그림), 탭 클릭 → 해시·`ulp:tab`, hashchange로 `#tf`(2-5-1 탐색 결과 보임), 해시 없이 열면 마지막 탭, 페이지 오류 0
  - PP2 **진행 → 연습실 → 돌아오기**: CHORDS(합산) 시드 행 펼침 → "▶ 연습실…" → `chords.html#prog?` 8번 탭·제목·키·칩 4·다이어그램 4·경로 1~3 → "← 코드 진행 모음으로" → `progressions.html?scope=all#p-ref-seed-2`에서 그 행 펼쳐짐·합산 범위
  - PP3 진행 연주: `H7` 잠금·"1개 빼고", C = 표 폼, +2 → D Major·`A7/C#`·vi 유지, 다른 보이싱으로 바꾸면 다이어그램 바뀜, 재생/멈춤, Bm은 매트릭스 버튼 없음, A7/C# → 매트릭스 루트 A(9)·`#matrix` → 진행 연주로 돌아오면 같은 진행, 재생 중 탭 이동하면 멈춤
  - PP4 빈 탭: 시드 10개·직접 입력 `Dm7 - G7 - Cmaj7` → `#prog?c=Dm7%2CG7%2CCmaj7` 3개, **잘못된 입력 `zzz`** → "읽을 수 있는 코드가 없어요"·재생 잠금, 시드 링크
  - PP5 목록 검색(`autumn` 1개·"10개 중 1개", `a min`, 없는 곡 안내)·정렬 키/곡명 순서 정확히·검색+정렬
- 4폭(1280·1150·768·390) 진행 연주 탭·CHORDS 목록 **가로 스크롤 0**(scratchpad 스크립트, 스크린샷 확인 — 768·390은 칩·입력이 줄바꿈, 다이어그램 줄은 가로 스크롤 상자 안)
- 실측 예: `Just the Two of Us Turnaround`(A min) 0~12 경로 1 = `1 0 2 0 1 0 | 0 2 0 1 0 1 | x 0 2 4 1 3 | x 3 3 3 5 5 | x 2 3 0 3 1`(FM9 E7b9 Am9 C13 G7/B), 경로 2개
- 서버 코드는 안 바꿔 `./gradlew test`는 돌리지 않음(CI Kotlin 잡이 확인)

## 6. 남은 것·제안

- 제안(범위 밖, 메뉴얼): URL에 `n=<noteId>`를 더해 진행 연주 탭에서 "원본 건반 보이싱 보기(노트)"로 바로 가기
