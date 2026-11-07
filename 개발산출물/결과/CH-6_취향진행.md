# CH-6 결과 — 취향 코드 진행 (통계 + 랜덤) · CHORDS #progTaste · 홈 위젯 교체

- 날짜: 2026-11-04 (mac)
- 입력: `결과/CH-0_범위확정.md` §1(취향 = 빈도 순위 + 랜덤), `결과/CH-1b_설계.md` §8·§9, `결과/CH-5_CHORDS화면.md` §3, `결과/CH-5b_연습실연동.md` §3(`playHref`)
- 상태: **완료** — 로컬 §4 + Draft PR #63 CI 전부 통과(Test Node 22·24, Kotlin, E2E spa·legacy, Docker — run 41850228141, head `7951364`)

## 1. 만든 것

| 영역 | 내용 |
| --- | --- |
| 통계 `stats.mts` | `tasteStats(list)` → `{ total, chordTotal, chords, romans, moves, patterns, moods, genres, keys }`(각 `Counted { label, count }[]`, 많은 순 → 같으면 처음 나온 순). 브라우저에서 매번 계산 |
| 랜덤 | `pickRandom(list, currentId, rand)` — 지금 것과 다른 진행 하나, 1개면 그것, 비면 null |
| CHORDS `#progTaste` | `TastePanel`(지금 범위 목록 — 검색은 반영 안 함): 요약 줄, **랜덤으로 꺼내보기 → 꺼낸 진행 카드 + 연주하기(`playHref`) + 다시 꺼내기**, 자주 나오는 진행 Top 5, 코드 이동 Top 5, 코드 빈도 Top 8, 키 분포 Top 5, Mood·Genre(있을 때만) |
| 홈 위젯 | "취향 코드 진행 꺼내보기" 아래 **범위 토글**(`#progScope` 레퍼런스·분석·합산). 왼쪽 `#progRefBox` = 꺼낸 진행(코드 줄·연주하기 둘 다 `playHref`, `# 랜덤으로 보여주기`), 오른쪽 `#progArchBox` = **취향 요약**(진행 수, 자주 나오는 진행 1위 — 없으면 코드 이동 1위, 많이 쓴 키, "취향 통계 보기" → `progressions.html[?scope=]#progTaste`). 헤더 링크는 "코드 진행 모음 →" |
| 데이터 | 로그인: `apiClient.progressions.list()` 한 번. **하나도 없거나 실패하면 기본 시드 10개**(출처 "기본"). 비로그인: 시드. 범위에 진행이 없으면 "OO 범위에 모은 진행이 없어요" + "진행 넣으러 가기" |
| 없앤 것 | `extractProgressionsFromNotes`(노트 화성 읽기·`ulp:progressions`·`편곡` 태그 규칙)·`pickNextIndex`(설계 §8), 홈의 노트 상세 3개 조회(`notes.get`) — 홈은 `notes.list`(최근 노트)만 |

### 1-1. 통계 규칙

- **코드 빈도**: 저장된 심볼 그대로, 등장 횟수. 로마숫자 빈도(`romans`)는 roman이 있는 칸만(화면엔 아직 안 씀 — CH-8에서 필요하면)
- **코드 이동**: 이웃 두 칸 `A → B`. 이름은 **로마숫자 우선**(키가 달라도 같은 기능끼리 묶임: C의 `IM7 → vim7`과 F의 `IM7 → vim7`이 합쳐짐), roman이 없으면 심볼. 같은 이름 반복(`vim7 → vim7`)은 뺌. 마지막 → 처음(반복)은 안 셈
- **자주 나오는 진행**: 연속 4·3코드 묶음(로마숫자 우선), 한 진행 안 중복은 1번, **2곡 이상**만. 4코드 묶음에 들어 있고 횟수가 같은 3코드 묶음은 뺌(I-V-vi-IV 하나가 3줄로 보이지 않게)
- **Mood·Genre**: 진행 수(한 진행 안 중복 1번). **키 분포**: 키 없는 진행은 뺌

## 2. 파일

- 새: `frontend/src/lib/chords/stats.mts`, `test/ch6_stats.test.js`
- 고침: `frontend/src/pages/HomePage.tsx`·`HomePage.module.css`, `frontend/src/lib/progressions.ts`(노트 추출·`pickNextIndex` 삭제, import 정리), `test/r1_home.test.js`(R1-H3 교체, R1-H6 ID)
- **§9 목록 밖(직접 결과):** ★`frontend/src/components/progressions/TastePanel.tsx`·`Progressions.module.css`(CHORDS 쪽 — 요청 "#progTaste 채우기", `components/progressions/*` 나누기는 자유 항목), `frontend/src/pages/ProgressionsPage.tsx`(stub → `<TastePanel>`), `test/e2e/progressions.spec.js`(P9~P12)
- 안 고침: `frontend/src/lib/security.ts`의 키 이름 목록 `'ulp:progressions'`(타입 목록일 뿐, 옛 화면 동결) · 옛 화면 `public/home.js`·`public/index.html`(R1-H7·H8·H9는 옛 화면 검사 그대로 통과)

## 3. 정한 것 (설계에 없음)

| 항목 | 결정 | 이유 |
| --- | --- | --- |
| 홈 카드 2개 | 왼쪽 = 꺼낸 진행, 오른쪽 = 취향 요약(옛 REFERENCE·ARCHIVE 두 카드 대신) | 범위 토글이 레퍼런스/분석을 고르므로 두 카드가 같은 일을 할 필요가 없음. home-align H4(두 카드 높이)·H5(VAULT 아랫선) 배치는 그대로 |
| 홈 ID | `progRefBox·progRefKey·progRefChords·progRefTitle·btnRandRef·progArchBox·progArchKey·progArchChords·progArchTitle` 유지, `btnRandArch` → `progTasteLink`, 새 `progScope·progRefPlay` | home-align이 보는 ID 유지. `btnRandArch`는 옛 화면(`public/index.html`)에만 남김(R1-H6에서 분리 검사) |
| 로그인 + 진행 0개 | 기본 시드로 채움(출처 "기본") | 홈 위젯이 비지 않게. CHORDS 페이지는 기존처럼 로그인 시 빈 목록 |
| 홈 범위 기본값 | 레퍼런스, 저장 안 함 | CHORDS 페이지 기본과 같음 |
| CHORDS 통계 대상 | 범위로 거른 목록(검색·정렬 무시) | 검색은 목록 찾기용, 취향은 범위 전체 |
| 랜덤 가중치 | 없음(균등) | CH-0 "빈도 순위 + 랜덤" — 둘을 따로 보여 줌 |

## 4. 실행 결과 (로컬, mac)

```
npx tsc --noEmit -p .                          통과(출력 없음)
npm run build                                  ✓ built in 630ms
node --test test/ch6_stats.test.js test/r1_home.test.js   tests 16 pass 16
npm test                                       tests 374 pass 374 fail 0   (366 + ch6_stats 8, R1-H3는 내용만 교체)
ULP_UI=spa npx playwright test                 72 passed (progressions.spec P9~P12 4개 추가, home-align 포함)
ULP_UI=legacy CI=1 npx playwright test         16 passed, 56 skipped
```

- 단위 `ch6_stats`: 코드·로마숫자·키·Mood(한 진행 안 중복 1번)·Genre 빈도 / 코드 이동 로마숫자 우선·심볼 대체·반복 제외 / 자주 나오는 진행(한 곡 안 반복 1번, 4코드에 포함된 같은 횟수 3코드 제외, 2곡 미만 제외) / **잘못된 입력**(null 행·chords 없는 행·빈 심볼·null 칸) / `pickRandom`(다른 것만·모든 후보·1개·빈 목록·rand 범위 밖) / 시드 10개 통계·`playHref` / 페이지 연결
- e2e P9 비로그인 CHORDS(시드 요약 "레퍼런스 · 진행 5개 · 코드 20개", 꺼내기 → 연주하기 `from=ref-seed-N`, 다시 꺼내면 바뀜, 합산 10개) · P10 로그인(I - V - vi - IV × 2, I → V, Mood·Genre, 분석 범위 안내) · P11 홈 비로그인(연주하기·코드 줄 링크, 랜덤, 분석 토글 → `arch-seed-1`, 통계 링크 `?scope=analysis#progTaste`) · P12 홈 로그인(서버 진행, 출처 직접, 요약 "자주 나오는 진행 · 2번", 빈 범위 안내, **노트 상세 GET 0건**)
- 4폭: P8(1280·1150·768·390, 취향 패널 포함) 가로 스크롤 0, home-align 4폭 H1~H6 통과
- 서버 코드 안 바꿈 → `./gradlew test` 안 돌림(CI Kotlin 잡)

## 5. 다음 step이 쓸 값

- **CH-8(통합)**: 홈·CHORDS e2e id — 홈 `#progScope [data-scope] #progRefBox #progRefChords #progRefPlay #btnRandRef #progArchChords #progArchTitle #progTasteLink`, CHORDS `#tasteSummary #tastePick #tasteRand #tastePlay #tastePickTitle #tastePickChords #tastePatterns #tasteMoves #tasteChords #tasteKeys #tasteMoods #tasteGenres`

## 6. 제안(범위 밖)

- 통계 줄(자주 나오는 진행·코드 이동)을 누르면 그 묶음이 들어 있는 진행만 목록에 거르기
