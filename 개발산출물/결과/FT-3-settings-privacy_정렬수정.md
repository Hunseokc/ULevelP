# 결과 FT-3-settings·privacy: 설정·개인정보처리방침 스크린샷 검토 + 정렬 수정

- 진행 파일: `개발산출물/진행_프론트정렬규격.md`
- 입력: `결과/FT-2_전화면점검.md` §4(settings·privacy 약속)·§5(경고) · `결과/FT-3-chords_정렬수정.md` §7 · `개발산출물/프론트_정렬규격.md` v1.2
- §5-2 결정(2026-11-05): D1 = 나중에(chords 후속 A·B·C는 `인수인계_메모.md` "나중에"로 옮김), D2 = 한 세션·한 PR
- §5-3 결정(2026-11-05): D3 = X1~X5 전부, D4 = PR #73 머지 뒤 `main`에서 `fix/ft-3-settings-privacy`, X6(파일 입력 필) = 넣지 않음
- 상태: **완료** — × 5건 수정, 다시 찍은 스크린샷으로 × 칸 갱신(§2), 검증 §5, PR §6

## 1. 검사 결과 (수정 전, 현재 main과 같은 settings·privacy 코드)

```
npm run build && LAYOUT_SHOTS=1 npx playwright test test/e2e/layout/settings.spec.js test/e2e/layout/privacy.spec.js
16 passed (17.5s)
```

- 판정 실패 0(FT-2와 같음). 약속 `col`·`secs`·`keyHead` A1 실패 0
- `LAYOUT_STRICT=1` 경고(G7b 제외):

| 경고 | 화면 | 판단 |
| --- | --- | --- |
| G8 `[col]` 세로 간격 `16·30px` 들쭉날쭉·30 스케일 밖 | privacy 섹션 3곳 | **원인 확인:** 섹션은 flex `gap: 16px`인데 `ul`에 브라우저 기본 `margin: 16px 0`이 남아 설명 문단→목록이 30px, 목록 아래도 16px 더 빔 → **× X2** |
| G8 `label.checkRow` 가로 11px | settings | 체크박스와 글자 사이(`gap`+기본 여백). 눈에 걸리지 않음 — 둠 |
| G8 `div.cardHead` 가로 612px 등 | settings | Gemini 카드 제목 ↔ 상태 배지 양끝 배치(약속 `keyHead:center-y` 통과) — 의도 |
| G8 `nav.siteNav`·`span.navMain` | 둘 다 | AppShell — W-1 |
| G7b 입력 38px·체크박스 16px·링크 26·27px | settings | FT-0 결정대로 경고 |

## 2. 스크린샷 검토 (규격 §6)

본 캡처: `test-results/layout-shots/`의 settings guest·user × 1280·1150·768·390 + user 1280 다크, privacy guest × 4폭 + 다크.
추가 캡처(spec에 없는 상태, scratchpad 스크립트 — Playwright + `mockApp(STATES.user)`): settings user에서 `main details` 전부 펼침(계정 삭제·고급 설정) 1280·390, 저장 공간 막대를 40%로 바꾼 `#accQuota` 1280·390.
1150은 1280과 같은 배치(좌우 여백만 줄어듦), 768은 1280과 같은 1열에 줄바꿈만 다름 — 판정은 1280·390 대표, 다른 점만 적음.
판정 `○` 문제없음 · `△` 둠(사유) · `×` 고칠 것(§3 X번호) · `×→○` 수정 후 다시 찍어 확인.

**수정 후 다시 찍음(2026-11-05):** `LAYOUT_SHOTS=1` settings·privacy 전 상태 + scratchpad 스크립트로 settings user 펼침 1280·390, `#accQuota` 막대 0%·40% 1280·390. 390 필 높이·안내 글 길이는 같은 스크립트로 실측(§5).

| 화면·상태 | Q1 강한 버튼 | Q2 여백 | Q3 기준선 | Q4 위계 | Q5 빈 상태 | Q6 390 순서·768 | Q7 유채색 | Q8 필·곡률·글자 | Q9 다크 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| settings guest | △ ① | ○ | ○ | △ ② | ○ (로그인 필 하나로 안내) | ○ | ○ (개인정보 링크 파랑 작은 면적) | ×→○ X4·X5 (390) | — |
| settings user | △ ① | ○ | ○ | △ ② | **×→○ X1** 0MB면 옅은 트랙(`--surface2`)만 | ○ (연결 확인·해제 390에서 둘째 줄 — 자연스러움) | **×→○ X1** 40%에서 잉크색 값 | ×→○ X4·X5 (390 가이드 필 48px 한 줄, 안내 글 끝까지 보임) | ×→○ X1 (다크 0MB 어두운 트랙), 그 밖 ○ |
| settings user 펼침 | △ ① (노션 키 저장·연동 켜기 추가) | ○ | ○ | ○ | ○ | ○ | ○ | ×→○ X4·X5 (390 연동 켜기 48px 한 줄·ntn 안내 끝까지), △ ③ | — |
| privacy guest | ○ (버튼 없음) | **×→○ X2** 설명→목록 16px(섹션 gap만), 섹션 아래 빔 없음 | ○ | △ ②, **×→○ X3** 제목 ID 삭제 | — (정적 문서) | △ 4번 제목 390 `…권\n리` 두 줄 — ID는 빠졌지만 아래 전역 `word-break` 항목과 같은 원인이라 둠 | ○ | ○ | ○ |

사유·관찰:
- ① 설정은 독립 섹션의 나열이라 섹션마다 주 행동 필이 하나씩 있다(Drive 저장소 사용·Gemini 키 저장·테마 선택 칸, 펼치면 노션 키 저장·연동 켜기). 한 섹션 안에서는 하나 — 둠
- ② 제목 글꼴(`--font-display`)이 라틴·숫자에만 적용돼 `BYOK`·`1.`·`제3자`의 `3`이 한글과 다른 굵은 글꼴로 섞임. 전역 제목 글꼴 결정(DESIGN.md)이라 이 step 범위 밖
- ③ 고급 설정 "노션 백업 ZIP 파일" 파일 입력이 브라우저 기본 `Choose File` 네모 버튼. 옛 화면도 같았고(옛 CSS에도 스타일 없음) 접힌 고급 설정 안이라 둠. 원하면 `::file-selector-button`을 필로 — 후보
- 390 한글 줄바꿈이 낱말 중간(`연\n습`, `영\n구`)에서 끊김 — 전역 `word-break` 결정이라 둠(전 화면 공통, 바꾸면 L1-2 다국어와 같이 보는 게 맞음)
- 상단 오른쪽 계정 표시가 `TE`(표시 이름 앞 글자)·390 메뉴 세 줄 — AppShell, W-1

## 3. × 목록 (2026-11-05 전부 수정)

- X4 실제 문구는 처방(안)보다 짧게 갔다: `🔑 무료 API 키 발급 가이드 (1분)`은 390에서 293px가 필요해 칸(270px)을 넘어 여전히 두 줄(74.7px) → `(1분)`을 빼 `🔑 무료 API 키 발급 가이드`(250px, 48px 한 줄). "1분"은 바로 위 설명 문단("아래 1분 가이드로…")에 이미 있다

| # | 증상 | 원인 | 처방(안) | 파일 |
| --- | --- | --- | --- | --- |
| X1 | 녹음 저장 공간 막대가 0MB에서 꽉 찬 회색, 사용량이 있으면 기본 초록으로 참(다크도 같음) | `appearance: none`만 옮기고 옛 `public/site.css:221-223`의 `::-webkit-progress-bar`·`::-webkit-progress-value`·`::-moz-progress-bar`가 SPA로 안 옮겨짐 → Chromium 기본 회색 트랙·초록 값. **chords와 같은 "옛 CSS 이식 누락" 패턴** | `.quotaBar::-webkit-progress-bar { background: var(--surface2) }`, `::-webkit-progress-value`·`::-moz-progress-bar { background: var(--ink) }` 3줄 이식 | `SettingsPage.module.css` |
| X2 | privacy 섹션 설명 문단→목록 30px(제목→문단 16px), 목록 아래 16px 더 빔. G8 `[col] 16·30px` 경고의 원인 | `ul` 브라우저 기본 `margin: 16px 0`. 옛 CSS는 `.set-sec ol`만 정리하고 `ul`은 없었음 | `.setSec > ul { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 4px }` (옛 `.set-sec ol` 규칙과 같은 값, 직계 `ul`만 — 설정의 `previewList` 등 안쪽 목록은 영향 없음) | `SettingsPage.module.css` |
| X3 | privacy 4번 제목 끝 `(FR-AUTH-4)` — 내부 요구사항 ID가 사용자에게 보임. 390에서 제목이 두 줄로 늘어나는 원인 | 문구 | 제목에서 ` (FR-AUTH-4)` 삭제 | `PrivacyPage.tsx` |
| X4 | 390에서 필 버튼 글자가 두 줄 — `🔑 1분 만에 무료 API 키 발급받기 (가이드 열기)`, `연동 켜기 (기존 노션 데이터 이관)`(어두운 필). 두 줄 필은 둥근 덩어리처럼 보임 | 문구 길이(16px 굵은 글자, 390 안쪽 폭 약 270px) | 문구 줄이기: `🔑 무료 API 키 발급 가이드 (1분)`, `연동 켜기 (노션 데이터 이관)`. 고친 뒤 390에서 한 줄인지 스크린샷으로 확인 | `SettingsPage.tsx` |
| X5 | 390에서 키 입력 안내 글이 잘림 — `AIza... (수정 시 비워두면 기존 키`(끝 "유지)"가 안 보여 뜻이 바뀜), 노션 토큰도 같음 | placeholder 길이 | `AIza… (비워두면 기존 키 유지)`, `ntn_… (비워두면 기존 키 유지)` | `SettingsPage.tsx` |

- 테스트 영향: 위 문구·`quotaBar`를 찾는 테스트 없음(`grep` 확인 — `test/e2e`·`frontend/src`). 선택자·id는 안 바뀜
- 바뀌는 파일 3개: `frontend/src/pages/SettingsPage.module.css`, `frontend/src/pages/SettingsPage.tsx`, `frontend/src/pages/PrivacyPage.tsx` (+ 이 결과 파일·진행 파일)

## 4. 한 순서

1. PR #73 머지 확인(2026-11-05 06:33 UTC) → `main`에서 `fix/ft-3-settings-privacy`
2. X1~X5 수정 → `npm run build` → settings·privacy layout spec(일반·`LAYOUT_STRICT=1`) → `LAYOUT_SHOTS=1` + 펼침·막대 캡처 → X4 390 두 줄 남아 문구 한 번 더 줄임 → 다시 빌드·검사·캡처
3. 전체 `npx playwright test`·`npm test` → 커밋·PR(base main)·CI

## 5. 검증 (수정 후)

```
npm run build && LAYOUT_SHOTS=1 npx playwright test test/e2e/layout/settings.spec.js test/e2e/layout/privacy.spec.js
16 passed (16.4s)

LAYOUT_STRICT=1 npx playwright test test/e2e/layout/settings.spec.js test/e2e/layout/privacy.spec.js
privacy: G8 [col] 경고 사라짐. 남은 경고는 nav.siteNav·span.navMain(AppShell, W-1)뿐
settings: §1 표와 같은 경고(checkRow 11px·cardHead·G7b) — 모두 "둠"

npx playwright test            → 189 passed (3.5m)
npm test                       → 394 중 392 pass, 2 fail — CH-2c 정석폼 JSON CRLF 비교(win 기존 함정, 진행 파일 §8, 변경 전과 같음·CI 무관)
```

390 실측(scratchpad `measure.js` — Playwright + `mockApp(STATES.user)`, `main details` 펼침):

| 대상 | 수정 전 | 수정 후 |
| --- | --- | --- |
| Gemini 가이드 필 | 두 줄 | `🔑 무료 API 키 발급 가이드` 250px·높이 48px (칸 270px) |
| 연동 켜기 필 | 두 줄 | `연동 켜기 (노션 데이터 이관)` 254px·48px |
| Gemini·노션 키 안내 글 | 잘림 | 글자 폭 + 안쪽 여백 ≤ 입력 칸 268px (둘 다 들어감) |
| 저장 공간 막대 | 0MB 꽉 찬 회색, 값 기본 초록 | 0%: `--surface2` 트랙만, 40%: `--ink` 값 (라이트·다크) |

## 6. PR

- PR #74 `fix/ft-3-settings-privacy` → `main` — CI 통과(Node 22·24, Kotlin, Docker smoke, E2E spa·legacy 전부 pass, run 41982289732)
