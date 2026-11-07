# 결과 FT-0: 프론트 정렬 규격 설계

- 진행 파일: `개발산출물/진행_프론트정렬규격.md`
- 산출물: `개발산출물/프론트_정렬규격.md` v1.0 (규격 본문 — 다음 step은 이 파일과 이 결과 파일만 읽고 시작)
- 입력: `test/e2e/home-align.spec.js`, `test/e2e/settings-spacing.spec.js`, `test/e2e/layout.spec.js`, `test/e2e/xss.spec.js` `setupMockAuthAndApi`, `DESIGN.md`, `frontend/src/styles/tokens.css`, `결과/H-1_홈정렬.md`
- 코드 변경 없음(문서만)

## 1. 사용자 결정 (2026-11-05)

| # | 질문 | 결정 |
| --- | --- | --- |
| 1 | 배치 약속 방식 | **마크업 속성 `data-align-group`** (spec 안 선택자 목록 아님) |
| 2 | 픽셀 비교(`toHaveScreenshot`) 1차 포함 | **넣지 않는다.** 화면 안정 뒤 CI 기준 이미지 별도 작업 |
| 3 | FT-0 브랜치 | #69 머지 뒤 main에서(`docs/ft-0-layout-spec`) |

## 2. 설계 결정 (FT-0에서 정함)

| 항목 | 결정 | 이유 |
| --- | --- | --- |
| G5 수준 | **G5a 금지 색 = 실패**(화면별 목록), **G5b 팔레트 밖 = 경고** | 실측 하드코딩 색이 `rgba(0,0,0,.35/.45)`·`#000000`(연습실 영상 바탕)·모달 배경 `rgba(29,29,31,.62)` 등 의도된 것이 있어 실패로 두면 오탐. 금지 색은 의도가 분명해 실패 |
| G5 알파 | RGB만 비교, 알파 무시 | 홈의 `color-mix(in srgb, var(--ink) 12%, transparent)` 같은 반투명 토큰을 통과시키기 위해 |
| G8 수준 | **경고**(기본). 화면별로 `level: 'fail'` 강화 가능 | CSS 실측 간격 값이 2·4·6·8·10·12·14·16·18·20·24·32·36px로 다양(8px 53곳, 6px 48곳, 12px 40곳, 10px 26곳…) → 4의 배수 스케일이면 대량 오탐. 설정 화면은 이미 6·12·16 실패 검사가 통과 중이라 그대로 강화 유지 |
| G8 스케일 | `0 2 4 6 8 10 12 14 16 20 24 28 32 40 48 56 64` | 16까지 2단위(현재 쓰는 값 대부분), 그 위는 4·8단위. 18·36은 스케일 밖 → 경고로 드러남 |
| G7 기준 | **실패 < 24px**(WCAG 2.2 2.5.8 최소), **경고 < 44px**(390·768폭만) | CSS 실측 `min-height` 40px 10곳·38·36·34·32·28px 등 → 44를 실패로 두면 대량 실패. 앱(Capacitor) 전환 대비 44는 경고로 드러내 M0·M2에서 처리 |
| G6 기준 | 24px, 화면별 `sagMax` | 홈에서 검증된 값(정상 카드 14~20px, 처짐 58~63px) |
| 카드 자동 인식 | 곡률 0 + (네 변 테두리 또는 조상과 다른 배경) + 48×32 이상, 컨트롤·미디어 태그 제외 | DESIGN.md 확정 규칙(카드 직각·컨트롤 필)을 그대로 판별 기준으로 씀. 한 변 구분선(목록 줄)은 카드 아님 |
| G1 기준 카드 | 요소마다 **가장 가까운 카드** 하나만 | 중첩 카드에서 같은 넘침이 여러 번 나오지 않게. 바깥 카드는 안쪽 카드 자체를 검사하므로 빠짐없음 |
| G2 범위 | 형제의 "보이는 범위"(자기 + 흐름 안 자손) 겹침 | H-1의 "104px 칸에 120px 박스" 같은, 칸은 안 겹치는데 내용이 옆 칸으로 넘는 경우를 잡기 위해 |
| G3 대상 | 글자를 직접 가진 요소만 + 세로 줄 수 제한 | 자식 요소 넘침은 G1·G2가 맡아 같은 문제가 두 번 나오지 않게 |
| A1 반응형 | 나란할 때만 판정(자동) + 선택 `@최소폭`(그 폭 이상에서 쌓이면 실패) | 마크업에 반응형 구간을 길게 적지 않게. 대신 2열이 1열로 무너진 버그는 `@`로 잡는다 |
| A1 오차 | 1px | H4 1px, H5 0.5px 중 큰 쪽(서브픽셀 반올림 오탐 방지) |
| 예외 | `data-layout-ignore="G3: 사유"` 하나로 통일, 사유 없으면 G0 실패, `*` 금지 | 예외 남용 방지(§6 위험) |
| 경고 처리 | annotation `layout-warn` + 첨부 `layout-warnings.txt`, `LAYOUT_STRICT=1`이면 실패 | 경고가 CI를 깨지 않으면서 FT-2 점검 때 전체 목록을 볼 수 있게 |
| 스크린샷 | `LAYOUT_SHOTS=1`이면 같은 spec이 `test-results/layout-shots/`에 저장 | 캡처 스크립트를 따로 두지 않음. `test-results/`는 이미 `.gitignore`(19행) |
| 폭·테마 | 1280·1150·768·390 × 라이트, 다크는 화면당 1개 | 홈 검사와 같음. 다크 전체는 시간 대비 효과 작음(색만 다름 — G5가 다크 1개에서 확인) |
| `layout.spec.js` | 그대로 둔다(레거시 지울 때 같이 정리) | legacy 행렬에서도 도는 유일한 가로 스크롤 검사 |
| CI | 변경 없음 | `npm run test:e2e`가 `test/e2e/` 하위 전부를 이미 돈다(Playwright 기본 testMatch가 `support/*.js`는 안 잡음) |
| 데이터 상태 키 | `guest`·`guestLocal`·`user`·`userData` | 홈 S1·S2·S3 + 로그인 빈 데이터. M1-1 뒤 티어 상태는 `me` 덮어쓰기로 M2 첫 step에서 추가(§10) |

## 3. 홈 검사(H1~H6) → 새 규칙 대응표 (FT-1 확인 기준)

| 기존 | 새 규칙 | FT-1에서 할 일 |
| --- | --- | --- |
| H1 카드 넘침(카드 8개 id 목록) | G1(카드 자동 인식) | 8개 id(`#weeklyStreakCard #recentSongCard #recentNoteBody #recentNoteEmpty #progRefBox #progArchBox #betterFrame #vaultFrame`)가 자동 인식되는지 확인. 안 되면 인식 규칙을 고치고 결과 파일에 기록 |
| H1 썸네일·글 칸 겹침 | G2 | — |
| H2 썸네일·글 윗선 | A1 `top` 그룹(`#recentSongBody`·`#recentSongEmpty`·`#recentNoteBody`·`#recentNoteEmpty` 각각) | `HomePage.tsx`에 속성 |
| H2 링크가 글 왼쪽선 | A1 `left` 그룹(글 칸 + 그 안 링크) | 〃 |
| H2 제목 아래 처짐 | G6 | `#weeklyStreakCard #recentSongCard #recentNoteCard`가 카드로 인식되는지 확인 |
| H3 말줄임 | G3 | — |
| H4 높이 맞춤 4쌍 + 빈 상태 1쌍 | A1 `top,bottom@821`(3쌍), `bottom@821`(`#streakChallengeBar`·`#categoryRow`), 빈 상태만 `#modes`·`#songs` `bottom@821` | 〃 (빈 상태 조건부) |
| H5 BETTER 버튼 높이·바닥선·섹션 가운데, VAULT 아랫선 | A1 `height,bottom@821`(두 버튼), `center-x`(버튼 + 세부 섹션, 각각), `bottom@821`(`#progRefBox` + 버튼) | 〃 |
| H6 파란색 0건(라이트·다크) | G5a `forbidColors: ['--link']` + 다크 1개 | — |
| H6 모듈 CSS에 `var(--link|--accent-text)` 없음 | `home.spec.js` 아래 일반 test로 그대로 | — |

**FT-1 완료 확인 방법:** `git worktree add <임시경로> 1d218cc^`(PR #50 첫 커밋 `1d218cc`의 부모 = 홈 수정 전) → 그 트리의 `HomePage.tsx`에 같은 `data-align-group` 속성만 임시로 붙임(커밋 안 함) → 빌드·서버 → 새 `home.spec.js` 실행 → `결과/H-1_홈정렬.md` "수정 전 실행 결과" 표의 항목(처짐 58~63px, 윗선 2~24px, 겹침 4px, 링크 264~480px, 말줄임 238>219, 빈 상태 아랫선 -217px, 파란색 13곳)이 같은 규칙으로 나오는지 표로 대조 → 현재 코드에서 통과. 새로 나온 실패(카드 자동 인식이 더 넓어서)는 오탐인지 실제 문제인지 판정해 기록

## 4. 바꿀 파일 목록 (승인 요청 — CLAUDE.md "파일 3개 이상")

### FT-1 (공통 검사기 + 데이터 상태 장치 + 홈 이전)

| 파일 | 변경 | 이유 |
| --- | --- | --- |
| `test/e2e/support/layout-check.js` | 새로 | G0~G8·A1 판정(`checkLayout`), `layoutSuite`(상태 × 폭 테스트 생성, 경고·스크린샷 처리) |
| `test/e2e/support/mock-app.js` | 새로 | `mockApp`·`FIXTURES`(§7). `home-align`·`settings-spacing`·`xss`에 3벌 중복된 모킹을 한 곳으로 |
| `test/e2e/layout/home.spec.js` | 새로 | 홈 검사 이전(§3 대응표) + CSS 정적 검사 |
| `test/e2e/home-align.spec.js` | 삭제 | `layout/home.spec.js`로 옮김 |
| `test/e2e/xss.spec.js` | 수정 | `setupMockAuthAndApi` 본문을 `mockApp` 호출로(함수 이름·인자·호출부 그대로) |
| `frontend/src/pages/HomePage.tsx` | 수정 | `data-align-group` 속성만 추가(약 20곳). `id`·클래스·구조 변경 없음 |
| `개발산출물/결과/FT-1_공통검사기.md`, 진행 파일 | 새로·수정 | 결과·상태 |

### FT-2 (전 화면 점검 — 기록만)

| 파일 | 변경 | 이유 |
| --- | --- | --- |
| `test/e2e/layout/{chords,practice,log,notes,note,settings,privacy,progressions}.spec.js` | 새로 8개 | 화면별 상태·대기 조건 |
| `test/e2e/settings-spacing.spec.js` | 삭제 | `layout/settings.spec.js`로 옮김(`spacing: { scale: [6,12,16], level: 'fail' }` + 고급 설정 펼침 검사 유지) |
| `frontend/src/pages/ChordsPage.tsx`·`SettingsPage.tsx`·`PrivacyPage.tsx` (+ 필요하면 `components/chords/*`) | 수정 | **FT-3 대상(M2가 다시 만들지 않는 화면)만** `data-align-group` 추가. 배치는 안 고친다 |
| practice·log·notes·note·progressions 화면 코드 | **변경 없음** | M2에서 다시 만든다. 공통 G 규칙만 돌려 실패 목록을 M2 입력으로 넘긴다(약속은 M2 step에서 씀) |
| `개발산출물/결과/FT-2_전화면점검.md` | 새로 | 화면 × 상태 × 폭 실패·경고 목록, 오탐 처리, "M2에서 다시 만드는 화면" 칸, E2E 소요 시간 실측 |

### FT-4 (규칙 연결)

| 파일 | 변경 |
| --- | --- |
| `CLAUDE.md` | 작업 방식 절에 한 줄: "화면을 만들거나 배치를 바꾸면 `개발산출물/프론트_정렬규격.md` §1 순서를 따른다" (메뉴얼 파일이라 그 step에서 문구 확인) |
| `개발산출물/주니어_체크리스트.md` | 62행 정렬 항목을 규격 문서 참조로 교체(항목 나열 대신 §1 순서·§4 예외 규칙) |
| `.github/workflows/ci.yml` | 변경 없음 예상(확인만) |
| `개발산출물/결과/FT-4_규칙연결.md` | 새로 |

### 범위 밖 (제안만)

- `home-category`·`player-category`·`progressions.spec.js`에도 같은 가짜 인증 코드가 복사되어 있다(supabase 스텁 6벌). FT-1에서는 xss·홈만 옮기고 나머지는 "나중에" 후보
- 운영 마크업에 `data-align-group`·`data-layout-ignore`가 그대로 나간다(수 KB 이하). 빌드에서 지우는 것은 필요해지면 검토

## 5. 다음 step(FT-1)이 알아야 할 것

- PR #50 첫 커밋: `1d218cc` (`fix(home): 카드 처짐·썸네일 겹침·말줄임·빈 상태 높이 정렬 수정 및 홈 파란색 제거`) → 수정 전 코드는 `1d218cc^`
- 홈 2열 구간: `HomePage.module.css` `@media (max-width: 820px)` → `@821`
- 반응형 구간 실측(페이지·레이아웃 CSS): `max-width` 640·820·960, `min-width` 640·1024
- `checkVisibility` 옵션은 Chromium 기준(CI·로컬 모두 chromium 단일 프로젝트)
- Chromium은 `color-mix()` 계산값을 `color(srgb r g b / a)`(0~1 실수)로 돌려준다 → G5 파서에서 변환 필요
  - 실측(2026-11-05, Playwright Chromium 134.0.6998.35): `color-mix(in srgb, #1d1d1f 12%, transparent)` → `color(srgb 0.113725 0.113725 0.121569 / 0.12)`, `typeof el.checkVisibility === 'function'`
- 권장 effort: 높음(판정 함수 설계·오탐 조정)
