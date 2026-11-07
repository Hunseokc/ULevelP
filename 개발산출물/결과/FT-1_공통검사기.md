# 결과 FT-1: 공통 정렬 검사기 + 데이터 상태 장치 + 홈 이전

- 진행 파일: `개발산출물/진행_프론트정렬규격.md`
- 입력: `개발산출물/프론트_정렬규격.md` v1.0, `결과/FT-0_규격설계.md` (§3 대응표, §4 파일 목록 — 2026-11-05 승인)
- 규격 변경: v1.0 → **v1.1** (판정식 보완 3건, 규격 §10)
- PR: #71 (base main) — CI 통과(2026-11-05, §7)

## 1. 바뀐 파일

| 파일 | 변경 |
| --- | --- |
| `test/e2e/support/layout-check.js` | 새로. `checkLayout(page, options) → { fails, warns, cards }`, `layoutSuite(cfg)`, `WIDTHS`, `DEFAULT_SCALE`. 판정은 브라우저 안 함수 하나(`browserCheck`) |
| `test/e2e/support/mock-app.js` | 새로. `mockApp(page, opts)`, `STATES`(guest·guestLocal·user·userData), `FIXTURES`(longSongs·note·sessions), `DEFAULT_ME`, `LONG_TITLE` |
| `test/e2e/layout/home.spec.js` | 새로. `layoutSuite` 1회(3상태 × 4폭 + 다크 1) + CSS 정적 검사 1 = 테스트 14개 |
| `test/e2e/home-align.spec.js` | 삭제 |
| `test/e2e/xss.spec.js` | `setupMockAuthAndApi` 본문 → `mockApp(...)` 호출(이름·인자·호출부·감시 스크립트 그대로, `unknownApi: 'pass'`로 예전처럼 모르는 API는 실제 서버) |
| `frontend/src/pages/HomePage.tsx` | `data-align-group` 26곳·`data-layout-ignore` 4곳, 빈 상태 판정 `songsEmpty` 한 줄. `id`·클래스·구조 변경 없음 |
| `개발산출물/프론트_정렬규격.md` | v1.1 (§3-1 판정 조건, G1·G7a·G8 판정식, §7-2·§8 사용법, §10 바뀐 값 기록) |

## 2. 홈 배치 약속 (HomePage.tsx)

| 그룹 | 선 | 구성원 | 옛 검사 |
| --- | --- | --- | --- |
| `top1` | top,bottom@821 | `#weeklyStreakCard` `#recentSongCard` | H4 |
| `strip` | bottom@821 | `#streakChallengeBar` `#categoryRow`(로그인·비로그인 두 곳) | H4 |
| `songBody` | top | `#recentSongThumb` + 글 칸 | H2 |
| `songText` | left | 글 칸 + "이어서 구간 연습하기" 링크 | H2 |
| `songEmpty` | top | NO SONG 칸 + 글 칸 | H2 |
| `frames` | top,bottom@821 | `#betterFrame` `#vaultFrame` | H4 |
| `player` | bottom@821 (**빈 상태만**: `!activeUid \|\| songs.length === 0`) | `#modes` `#songs` | H4 |
| `btns` | height,bottom@821 | `#betterChordsBtn` `#betterPlayerBtn` | H5 |
| `chordsCol`·`playerCol` | center-x | 각 세부 섹션(`subCol`) + 그 버튼 | H5 |
| `vaultBtm` | bottom@821 | `#progRefBox` + `#betterChordsBtn` | H5 |
| `noteBody` | top | 노트 썸네일 + 글 칸 | H2 |
| `noteText` | left | 글 칸 + `#recentNoteLink` | H2 |
| `noteEmpty` | top | NO NOTE 칸 + 글 칸 | H2·H1 |
| `noteEmptyText` | left | 글 칸 + "노트 만들러 가기" 링크 | H2 |
| `prog` | top,bottom@821 | `#progRefBox` `#progArchBox` | H4 |

### 예외 목록 (`data-layout-ignore`)

| 위치 | 규칙 | 사유 |
| --- | --- | --- |
| `#recentSongTitle` | G3 | 최근 곡 제목은 한 줄 말줄임(카드 높이 고정) |
| `#songs li .itemTitle` | G3 | 곡 목록 제목은 한 줄 말줄임(목록 줄 높이 고정) |
| `#recentNoteTitle` | G3 | 최근 노트 제목은 한 줄 말줄임(카드 높이 고정) |
| `#recentNoteHeadline` | G3 | 최근 노트 요약은 한 줄 말줄임(카드 높이 고정) |

옛 H3는 말줄임을 정해진 요소(`#progRefTitle` 등)에서만 봤다. G3는 글자를 가진 요소 전부를 보므로 의도한 말줄임 4곳을 예외로 표시했다(약속 없이 돌렸을 때 실패는 이 4곳뿐 — 오탐 0).

## 3. 카드 자동 인식 확인 (FT-0 §3 첫 줄)

`checkLayout(...).cards` 실측(현재 코드, userData·guest 1280):

| 옛 H1 카드 id | 자동 인식 | 비고 |
| --- | --- | --- |
| `#weeklyStreakCard` `#recentSongCard` | ○ | 네 변 테두리 |
| `#recentNoteBody` `#recentNoteEmpty` | ○ | 〃 |
| `#progRefBox` `#progArchBox` | ○ | 〃 |
| `#betterFrame` `#vaultFrame` | × → 바깥 `div.splitFrames`가 카드 | 한 변 구분선(`.frame + .frame` border-left)뿐이고 배경이 부모와 같다. 규칙대로 카드 아님. 두 프레임 밖으로 넘치는 것은 `.splitFrames` 기준 G1이, 한 프레임에서 옆 프레임으로 넘치는 것은 형제 G2(보이는 범위 겹침)가 잡는다 → **인식 규칙은 바꾸지 않음** |
| `#recentNoteCard`(옛 H2 처짐 대상) | × | 테두리·배경 없는 섹션. G6 대상 밖. 높이가 내용 높이라(`flex: 1` 아님) 처짐이 생길 구조가 아님. 안쪽 `#recentNoteBody`·`#recentNoteEmpty`는 카드 |

그 밖에 인식된 카드: `div.streakCell` 7개, `#categoryHint`, `div.recentPlaceholder`(NO SONG·NO NOTE), `li.noteItem`(빈 상태 안내 칸). 모두 실제 테두리·다른 배경이 있는 상자라 오탐 아님.

## 4. 완료 기준 확인 ① — PR #50 직전 코드(`1d218cc^`)에서 같은 항목으로 실패

방법: `git worktree add <scratchpad>/old 1d218cc^` → 그 트리 `HomePage.tsx`에 같은 속성을 임시로 붙임(옛 코드에 없는 `#categoryRow`·BETTER 버튼 2개는 건너뜀 — G-1(PR #50 뒤)에서 생김) → `node_modules` 연결(`mklink /J`) → `npx vite build` → `ULP_UI=spa node server.js` → 새 `home.spec.js` 실행 → worktree 삭제. **결과: 홈 정렬 13개 전부 실패**, CSS 정적 검사 1개는 통과(지금 저장소 파일을 읽으므로 대조 대상 아님).

| `결과/H-1_홈정렬.md` 수정 전 실측 | 새 규칙 실패 문구(실측) | 일치 |
| --- | --- | --- |
| `#recentSongCard` 제목 아래 S1 63px · S2/S3 58px | `G6 #recentSongCard 제목 아래 63px 빔` (guest) · `58px` (guestLocal·userData, 1280·1150·다크) | ○ |
| 윗선 `#recentSongEmpty` 15px(768 24px) | `A1 songEmpty 윗선 차이 15px` (1280·1150) · `24px` (768) · `6px` (390, H-1엔 없던 폭) | ○ |
| 윗선 `#recentNoteEmpty` 11px | `A1 noteEmpty 윗선 차이 11px` (전 폭) | ○ |
| 윗선 `#recentNoteBody` -6px | `A1 noteBody 윗선 차이 -6px` (전 폭) | ○ |
| 윗선 `#recentSongBody` -2px(390 -12px) | `A1 songBody 윗선 차이 -2px` · `-12px` (390) | ○ |
| `#recentNoteEmpty` 썸네일·글 칸 겹침 4px | `G2 #recentNoteEmpty 안 [noteEmpty] ↔ [noteEmpty] 4px 겹침` (guest·guestLocal 전 폭) | ○ |
| 노트 링크가 글 왼쪽선에서 264~480px | `A1 noteText 왼쪽선 차이 304·303·480px`(userData 1280·1150·768) · `A1 noteEmptyText 264·265·441px` (guest) · 390은 63·102px | ○ |
| `#progRefTitle` 말줄임 238 > 219px | `G3 #progRefTitle 말줄임·넘침 (238>219)` (2열 폭 1280·1150) | ○ |
| `#modes`·`#songs` 아랫선(빈 상태) -217px | `A1 player 아랫선 차이 -217px` (guest·guestLocal 1280·1150) | ○ |
| 파란색 13곳(기록 보기·(바로가기)·이어서 구간 연습하기·노션 연결·PLAYER 안내 2개·전체 노트·노트 만들러 가기·확인하기·보이싱 탐색·nlPractice·nlNotes·PRIVACY), 다크 동일 | `G5a … 금지 색 --link` 13곳 모두(`#recentSongGo`·`[songText]`·`[noteEmptyText]`·`#recentNoteLink`·`#nlPractice`·`#nlNotes` 등), 다크 1280에서도 같은 목록 | ○ |
| H4 상단 카드·코드 진행 카드·BETTER/VAULT 통과(차이 0) | `top1`·`prog`·`frames` 실패 없음 | ○ |

- 새로 나온 실패: **없음**(위 표 밖 문구 0). 390px의 songEmpty 6px·링크 63·102px는 같은 증상을 H-1이 재지 않은 폭에서 잰 것
- 경고: 옛 트리에 없는 그룹(`strip`·`chordsCol`·`playerCol`·`vaultBtm`)이 `A1 … 보이는 구성원 1개` 경고 — 예상대로

### PR #50 이후 생긴 약속은 변형 주입으로 확인

옛 코드에 없는 그룹은 현재 화면에 CSS를 주입해(확인 스크립트만 `bypassCSP`) 잡히는지 봤다. 모두 잡힘:

| 주입 | 나온 실패 |
| --- | --- |
| `#betterPlayerBtn{min-height:50px}` | `A1 btns 높이 차이 8px` |
| `#categoryRow{margin-bottom:6px}` + `#streakChallengeBar{margin-top:3px}` | `A1 strip 아랫선 차이 2px` |
| `#modes li:last-child{display:none}` (guest) | `A1 player 아랫선 차이 -8px` |
| `#progRefBox{margin-bottom:5px}` | `A1 vaultBtm 아랫선 차이 -5px`, `A1 prog 아랫선 차이 5px` |
| `.subColAction{justify-content:flex-start}` | `A1 chordsCol·playerCol 가로 중심 차이 -54px` |
| `.recentPlaceholder{width:160px}` | `G2 #recentSongEmpty … 26px 겹침`, `G2 #recentNoteEmpty … 10px 겹침` |
| 상단 위젯 줄 `grid-template-columns:1fr` (1280) | `A1 top1 1280px에서 나란해야 하는데 쌓임`, `A1 strip …쌓임` |
| `#recentSongCard` 테두리를 `--link` 색, 제목 `width:40px; nowrap; overflow:hidden` | `G5a #recentSongCard 금지 색 --link (border)`, `G3 h2.widgetTitle "WEEKLY STREAK" 말줄임·넘침 (131>40)` |

- `.widgetCard{justify-content:space-between}` 주입은 G6가 안 나왔다. 지금 카드는 분류 줄이 `margin-top: auto`로 남는 높이를 먼저 받아 실제로 처지지 않기 때문(규격 §2 처방 그대로) — 정상

## 5. 완료 기준 확인 ② — 현재 코드에서 통과, xss도 공용 장치로 통과

```
npm run build                                            ✓ built (tsc --noEmit 포함)
npx playwright test test/e2e/layout/home.spec.js         14 passed (18.1s)
npx playwright test            (ULP_UI=spa 서버)          77 passed (1.8m)   ← xss.spec.js E1~E10·회귀 2개 포함
npx playwright test            (legacy, 기본 서버)         16 passed, 61 skipped (57.1s)
npm test                                                 tests 394 / pass 392 / fail 2
```

- `npm test` 2건(CH-2c-1-1·CH-2c-3-2)은 이번 변경과 무관: 변경을 stash한 상태에서도 같은 2건 실패. 이 PC `core.autocrlf=true`로 JSON·CSV 작업본이 CRLF라 생기는 기존 함정(`인수인계_메모.md` §5). CI(Linux)는 영향 없음
- 레거시 skip 61 = 홈 layout 13 + 기존 React 전용 검사

### 현재 코드 경고 (테스트를 깨지 않음, FT-2 점검 참고)

| 상태 × 폭 | G7b(390·768만) | G8 |
| --- | --- | --- |
| guest 1280/1150/768/390 | —/—/35/34 | 19/19/17/15 |
| guestLocal | —/—/39/38 | 20/20/19/17 |
| userData (+다크 1280) | —/—/42/41 | 20/20/19/17 (다크 20) |

- G7b 대부분은 상단 메뉴(`a.navItem` 38px)·12px 글자 링크(19px)·코드 진행 범위 버튼(28px) — 앱 전환(M0·M2) 때 처리할 목록
- G5b(팔레트 밖 색) 경고 **0건** — 홈은 토큰 색만 쓴다
- 보는 법: `npx playwright test test/e2e/layout/home.spec.js --reporter=line`의 첨부 `layout-warnings.txt`, 또는 `LAYOUT_STRICT=1`로 실패처럼 전체 목록

## 6. 구현 메모 (다음 step이 알아야 할 것)

- **화면 spec 쓰는 법:** `layout/home.spec.js` 20줄이 본보기. 규격 §8. 상태는 `STATES` 키 문자열, 화면 전용은 `{ name, mock }`. 화면 전용 응답은 `mock: { routes: [[match, handler]] }`
- **`mockApp`은 준 API만 응답**: 표준 상태 `user`·`userData`는 `songs`·`notes`·`sessions`를 준다. 다른 API(진행 모음 `progressions`, `categories`, `integrations` 등)는 `{}` 200 → 화면이 빈 응답을 견디지 못하면 그 화면 spec에서 `routes`로 준다
- **대상 표기:** `#id` → `[그룹이름]`(첫 그룹) → `태그.모듈클래스 "글자 16자"`. Vite 빌드 클래스 `_recentBody_1sojf_391`에서 `recentBody`만 뽑는다
- **CSS 모듈 클래스는 해시가 붙는다:** 확인 스크립트에서 CSS를 주입할 땐 `[class*="_subColAction_"]` 식으로
- **판정 시간:** 홈 1회 약 1초. 홈 14개 18초 → 8개 화면 × 상태 2~3 × 4폭이면 대략 +1.5~2분(FT-2에서 실측)
- **글꼴:** Google Fonts는 막지 않는다(실제 글꼴로 판정). 한 번 `page.goto` load가 30초를 넘긴 적이 있음(§8 겪은 문제)
- **PLAYER 곡 제목 폭:** userData 1280에서 곡 목록 제목 칸이 87px(제목 605px). 말줄임은 의도라 예외지만 너무 좁다 — FT-2 스크린샷 검토(Q2·Q3) 후보. 홈은 M2에서 다시 만드는 화면이라 FT-3에서는 고치지 않음

## 7. PR·CI

| PR | 브랜치 | CI |
| --- | --- | --- |
| #71 | `test/ft-1-layout-checker` → `main` | **통과** — E2E spa 2m15s·legacy 1m35s, Node 22·24, Kotlin, Docker 스모크 (run 41968175140) |

## 8. 겪은 문제

- worktree 첫 실행에서 `FT home guest 390px`가 `page.goto` load 대기 30초 초과. 단독 실행·전체 재실행에서는 재현 안 됨 → 외부 글꼴 요청 지연으로 판단(외부 요청을 막지 않는 유일한 것). 반복되면 `mockApp`에서 글꼴을 막고 대체 글꼴 기준으로 바꾸는 것을 검토(측정값이 운영과 달라지는 대가)
- 확인 스크립트의 `page.addStyleTag`가 CSP(`style-src`)에 막힘 → 확인용 컨텍스트만 `bypassCSP: true`. 검사기 본체는 CSSOM(`el.style.color = …`)만 써서 CSP 영향 없음
- Python 스크립트를 bash heredoc으로 넘기다 따옴표 충돌 → 파일로 써서 실행
