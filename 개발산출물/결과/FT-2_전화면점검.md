# 결과 FT-2: 전 화면 정렬 점검 (기록만)

- 진행 파일: `개발산출물/진행_프론트정렬규격.md`
- 입력: `결과/FT-1_공통검사기.md`, `개발산출물/프론트_정렬규격.md` v1.1 → 이번에 **v1.2** (§10)
- 파일 목록: `결과/FT-0_규격설계.md` §4 FT-2 (2026-11-05 승인)
- PR: #72 (base main) — CI 통과(2026-11-05, §7)

## 1. 바뀐 파일

| 파일 | 변경 |
| --- | --- |
| `test/e2e/layout/{chords,practice,log,notes,note,settings,privacy,progressions}.spec.js` | 새로 8개. `layoutSuite`로 상태 × 4폭 + 다크 1 |
| `test/e2e/settings-spacing.spec.js` | 삭제 → `layout/settings.spec.js` 아래로 옮김(판정 함수 그대로, 가짜 인증만 `mockApp(page, STATES.user)`). 테스트 이름 `FT settings user 1280px·390px 본문 간격 …` |
| `test/e2e/support/layout-check.js` | `layoutSuite({ known })` 알려진 실패 옵션(규격 §8-2), G5b 오탐 2종 제외(규격 §10) |
| `frontend/src/pages/ChordsPage.tsx`·`SettingsPage.tsx`·`PrivacyPage.tsx` | `data-align-group`만 추가(§4). 배치·`id`·클래스 변경 없음 |
| `개발산출물/프론트_정렬규격.md` | v1.2 (§5-2 G5b, §8-2 `known`, §10) |

- FT-0 목록에서 달라진 점: `layout-check.js` 수정이 추가됨. "기록만 하고 고치지 않는다"와 "CI 통과"를 같이 지키려면 알려진 실패를 적어 둘 자리가 필요했다(spec을 통째로 끄면 새 깨짐도 못 잡음). 함수 이름·export는 그대로이고 `cfg` 선택 필드 하나만 늘었다
- FT-0 목록의 "settings는 `spacing: { scale: [6,12,16], level: 'fail' }`로 옮김"은 **옛 판정 함수를 그대로 옮기는 것으로 바꿨다.** 공통 G8은 화면 전체(상단 메뉴 포함)를 보므로 `level: 'fail'`이면 메뉴 간격(`nav.siteNav` 등)까지 실패가 된다. 옛 검사는 `main section` 안만 봤다

## 2. 화면별 상태와 판정 결과

`fail` = 알려진 실패(known) 개수, 폭 순서 1280/1150/768/390(+다크 1280). 경고는 테스트를 깨지 않는다(§5).

| 화면 | M2에서 다시 만드는가 | 상태 | 실패(known) | 경고 G5b / G7b(768·390) / G8 |
| --- | --- | --- | --- | --- |
| chords (탭 8개 각각) | **아니오 → FT-3** | guest | **tf 탭만 40/40/40/40** (나머지 7탭 0) | §5 |
| practice (빈 화면) | 예 | guest | 0 | 1 / 10·10 / 5·5·5·4 |
| practice (`?v=`) | 예 | guest·guestLocal·userData | **userData 768·390에서 1** (나머지 0) | 1 / 10~11 / 3~4 |
| log | 예 | guest·user·userData | **guest 전 폭 1** | 0 / 10~13 / 3~7 |
| notes | 예 | guest·user·userData | 0 | 0 / 19 / 4~5 |
| note | 예 | guest·userData | 0 | 0 / 11·19 / 3~5 |
| settings | **아니오 → FT-3** | guest·user (+옛 간격 검사 2) | 0 | 0 / 13~14 / 3~4 |
| privacy | **아니오 → FT-3** | guest | 0 | 0 / 10 / 3~4 |
| progressions | 예 | guest(예시 진행)·user(빈)·userData(진행 3개, 기본 범위 2개 보임) | 0 | 0 / 10~19 / 2~10 |
| (참고) home | 예 | FT-1 그대로 | 0 | FT-1 §5 그대로 |

- **실행 수:** layout 128개 = 새 114(chords 33·practice 17·log 13·notes 13·note 9·privacy 5·settings 11(옛 간격 검사 2 포함)·progressions 13) + 홈 14. `128 passed` 133초(§6)
- **배치 약속 A1 실패 0**(chords·settings·privacy에 새로 쓴 약속 모두 통과, "구성원 1개" 경고 0)

## 3. 실패 목록 (known으로 기록, 고칠 곳)

| # | 화면·상태·폭 | 실패 문구(대표) | 원인 | 오탐? | 고칠 step |
| --- | --- | --- | --- | --- | --- |
| F1 | chords-tf guest, 전 폭 | `G1 figure.cell "…Dm7…" 밖으로 svg.cb "…" 넘침 (왼쪽 +4px, 오른쪽 +4px)` × 24칸 | 2-5-1 탐색 결과 줄 `.boxrowTight`(flex, `nowrap`, gap 6px)에 칸 3개. 칸(`.cell`, padding 8px)보다 코드 다이어그램 svg가 넓어 좌우로 넘친다. 넘침: 1280·1150 2~5px, 768 4~6px, **390 7~10px** | 아님 — 스크린샷에서 `6fr` 글자·오른쪽 끝 점(R·7·b3)이 칸 테두리를 넘어 옆 칸에 붙음(그림 원리: `§2 그리드 칸보다 넓은 고정폭 자식`) | **FT-3-chords** |
| F2 | chords-tf guest, 전 폭 | `G2 div.boxrowTight "…" 안 figure.cell … ↔ figure.cell … 4px 겹침` × 16쌍 | F1 넘침 때문에 이웃 칸과 보이는 범위가 겹침(F1이 고쳐지면 같이 사라짐). 1280 1~4px, **390 11~13px** | 아님(F1과 같은 원인) | FT-3-chords |
| F3 | log guest, 전 폭 | `G6 #logGuest 제목 아래 28px 빔 (기준 24)` | 비로그인 안내 패널 `.panel`(flex column, `gap: 14px`) 안 `<p>`에 브라우저 기본 여백 14px가 더해져 문장과 버튼 사이가 28px. 처짐(남는 높이)이 아니라 **간격 이중 적용** | 규칙 이름("제목 아래 빔")과 증상이 다르지만 실제 문제라 오탐 아님. 판정식은 그대로 | M2(연습 기록 화면) |
| F4 | practice userData, 768·390 | `G3 #songTitle 말줄임·넘침 (744>499)` · 390은 `(744>121)` | 곡 제목 `.ppTitle b`는 `nowrap + ellipsis` — **의도한 말줄임**인데 `data-layout-ignore` 표기만 없음 | 표기 누락(규칙 오탐 아님). 단 390px에서 제목 칸이 121px뿐인 것은 스크린샷 검토 후보 | M2(연습 화면)에서 `data-layout-ignore="G3: …"` 표기 |

- 오탐으로 판정해 규칙을 고친 것: G5b 2종(§5), 실패 수에는 영향 없음
- 확인했지만 문제 아님: 설정 화면 상단 오른쪽 "TE" — 로그인 사용자 이니셜(`auth.computeInitial`), 잘린 글자가 아님

## 4. 배치 약속 (FT-3 대상 화면만, 마크업 `data-align-group`)

| 화면 | 그룹 | 선 | 구성원 |
| --- | --- | --- | --- |
| chords | `head` | center-y | 제목 `h1 코드 연습실` + `플레이어로 돌아가기 →` 링크 |
| chords | `tabs` | top,height | 탭 버튼 8개(`#tab-*`). 390·768에서 여러 줄이면 쌓인 쌍은 건너뜀(`@` 없음) |
| settings | `col` | left | 제목 블록(`headerBlock`) + 섹션 5개(`#account`·`#nx`·`#keys`·`#screen`·`#advanced`) |
| settings | `secs` | right | 섹션 5개 |
| settings | `keyHead` | center-y | Gemini 카드 제목 `h3` + 상태 배지 `#geminiKeyStatus` |
| privacy | `col`·`secs` | left / right | settings와 같음(같은 CSS 모듈), 섹션 4개 |

- practice·log·notes·note·progressions는 마크업을 안 바꿨다(§10 PM 결정: M2가 다시 만든다). 공통 G 규칙만 돈다
- chords는 탭 패널 안(폼 그리드·다이어그램 줄)의 약속을 쓰지 않았다. FT-3-chords에서 F1을 고칠 때 `.boxrowTight` 칸 높이·윗선 약속을 함께 쓰는 것을 권한다

## 5. 경고 요약 (테스트를 깨지 않음, `LAYOUT_STRICT=1`로 전체)

### G5b 팔레트 밖 색 (v1.2 조정 후)

| 화면 | 대상 | 색 | 판단 |
| --- | --- | --- | --- |
| chords-circle | `button.step`(5도권 진행 단계 버튼 12개) 배경·테두리, 안의 `b`·`span` 글자 | `rgb(240,240,240)`·`rgb(0,0,0)` | **브라우저 기본 버튼 스타일이 그대로 나옴** — 토큰 미적용. FT-3-chords 후보 |
| chords-ds | 더블 스탑 칸의 `b`·`span`·`small` 글자 | `rgb(0,0,0)` | 토큰이 아닌 검정 글자. 어디서 오는지(기본 스타일 상속 등)는 확인 안 함 — FT-3-chords에서 확인 |
| chords-scale | `#sc-zoom`·`#sc-pos`(범위 입력) 배경 | 라이트 `rgb(255,255,255)` · 다크 `rgb(18,18,18)` | 범위 입력 기본 배경. 눈에 띄는지 FT-3 스크린샷 검토에서 판단 |
| practice | `#videoBox` 배경 | `rgb(0,0,0)` | 영상 틀 검정 — 의도로 보임. M2에서 토큰(`--video-bg` 등) 또는 `data-layout-ignore="G5b: …"` |

- v1.2에서 뺀 오탐: svg `line.nut·fret·str·fl·st`의 `fill` 검정(chords 5개 탭), 체크박스 `color`(`#chkExportAudio`·`#noteCollectToggle`·chords `#sc-rootonly`·`#tone-auto`·`#a-pent`·`#a-var`·`#cc-hint`·`#cc-topsnd`·`#cc-skip`)

### G7b 터치 높이 44px 미만 (768·390만)

공통: 상단 메뉴 `a.navItem` 38px — 모든 화면(W-1 하단 탭 바로 넘김). 화면별 많이 나온 것(390px):

| 화면 | 대상 | 높이 |
| --- | --- | --- |
| chords | 입력·선택(`#sc-*`·`#tone-*` 등) 38·40px, 체크박스 16px, `button.chip` 29·43px, `label` 19px, `button.step` 21·36px, 헤더 링크 `[head]` 34px | 탭마다 33~50건 |
| notes | `button.filterBtn` 32px | 19건 |
| progressions | 입력 38·40px, `button.tastePickBtn` 23px | 10~19건 |
| settings | 입력 38px, 체크박스 16px, 링크 26·27px | 13~14건 |
| note | `button.tagBtn` 40px | 19건 |

### G8 간격 스케일

| 공통 | `nav.siteNav` 가로 간격 스케일 밖, `span.navMain` 메뉴 간격 들쭉날쭉 — 모든 화면(AppShell, W-1로 넘김) |
| --- | --- |
| chords | `div.headRow`(제목·링크 사이) 가로 간격 스케일 밖, `div.ccTop`(5도권 탭 위 줄) |
| settings | `label.checkRow`·`div.cardHead` 가로 간격 스케일 밖 |
| privacy | 제목 블록 `[col]` 세로 간격 스케일 밖·들쭉날쭉 |
| log | `div.logContainer`·`#pane-log`·`#daySection` 세로, `#logHeader` 들쭉날쭉, `div.headRow` 가로 |
| notes | `#form` 세로, `main.mainNarrow`·`div.noteCard` 들쭉날쭉 |
| note | `#noteHeader` 세로·들쭉날쭉, `label.collectLabel` 가로 |
| practice | `section.ppCtl` 세로, `#emptyState` 세로·들쭉날쭉, `div.ppLab` 가로 |
| progressions | `button.rowToggle` 들쭉날쭉(진행 줄마다), `section.listCol` 세로, `#progTaste` 세로, `div.header` 가로 |

## 6. E2E 소요 시간 (실측)

| 범위 | 테스트 | 시간 |
| --- | --- | --- |
| `test/e2e/layout/` 전체 | 128 | 133초(2.2분). FT-1 홈만 14개 18초 → **+115초** |
| 테스트 1개 | — | 0.8~1.0초(판정 포함) |

- 진행 파일 §6 예상(+1~2분)과 맞음
- **간헐 타임아웃:** 한 번의 전체 실행에서 `page.goto` load 30초 초과 2건(`home guest 768`·`practice-empty guest 1280`). 다른 세 번의 전체 실행·그 2개 단독 재실행·같은 화면 30회 반복(느린 요청 2초 초과 0건)에서는 재현 안 됨. FT-1 §8과 같은 증상(1회). 원인 미확정 — 외부 글꼴 요청 의심은 유지. CI(`retries: 0`)에서 나오면 `mockApp`에서 Google Fonts 차단 또는 CI만 `retries: 1` 검토(§8)

## 7. 검증·PR·CI

```
npm run build                                       ✓ built (tsc --noEmit 포함)
npx playwright test test/e2e/layout/                128 passed (2.2m)
LAYOUT_STRICT=1 … -g "log guest 1280px$"            1 failed — G6 #logGuest (known도 STRICT에선 실패로 나옴 확인)
known 넣기 전 같은 실행                               10 failed — F1~F4가 그대로 실패(known 밖 실패는 테스트를 깬다는 대조)
```

전체 E2E·단위 테스트(win 로컬):

```
npx playwright test            (ULP_UI=spa 서버)   187 passed, 2 failed (4.6m)
  ├ FT chords-scale guest 1280px 다크   page.goto load 30초 초과   → 단독 재실행 1 passed
  └ L1 768px 전 화면 가로 스크롤 0건     (기존 layout.spec.js) 페이지 로드 중 30초 초과 → 재실행 9 passed
npm test                                       tests 394 / pass 392 / fail 2  (변경 stash 상태에서도 같은 2건 — win CRLF 기존 함정)
```

- E2E 2건은 둘 다 페이지 로드 지연(§6 간헐 타임아웃). 이번 변경 전부터 있던 `layout.spec.js`에서도 나와 **이 PC 네트워크(외부 글꼴) 문제**로 판단을 좁혔다. 검사 판정 실패는 0

| PR | 브랜치 | CI |
| --- | --- | --- |
| #72 | `test/ft-2-all-pages` → `main` | **통과** — E2E spa 3m49s·legacy 2m49s, Node 22·24, Kotlin, Docker 스모크 (run 41972493290). CI에서는 페이지 로드 타임아웃 없음 |

## 8. 다음 step이 알아야 할 것

- **FT-3 대상(chords·settings·privacy) 실패는 chords-tf 하나뿐**(F1·F2, 원인 하나). settings·privacy는 실패 0 → FT-3에서는 스크린샷 검토(4폭) + 경고 중 손볼 것(chords G5b 기본 버튼 색, chords·settings G8) 판단이 주 작업
- FT-3-chords가 F1을 고치면 `chords.spec.js`의 `KNOWN.tf`를 지운다(규격 §8-2)
- M2 각 step의 입력: §3 F3(log)·F4(practice), §5 화면별 경고 표. M2 화면은 배치 약속을 그 step에서 처음 쓴다
- 진행 모음 userData는 진행 줄이 접힌 상태만 본다(펼친 줄은 `progressions.spec.js` 기능 검사가 다룸). 펼친 상태 배치는 M2에서 상태 추가
- 결과 원본은 남기지 않았다(세션 임시 폴더). 다시 보려면 `npx playwright test test/e2e/layout/ --reporter=json`의 annotation(`layout-warn`·`layout-known`)
