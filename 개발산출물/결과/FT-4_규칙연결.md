# FT-4 결과 — 규칙 연결·CI 포함 확인·필 한 줄 검사

- **날짜:** 2026-11-05 (win) · 브랜치 `docs/ft-4-rules` · PR #75 (CI 통과 — spa 195 passed·legacy 16 passed·179 skipped, run 41985771790)
- **입력:** `개발산출물/프론트_정렬규격.md` v1.2 → **v1.3**
- **진행 파일:** `완료/진행_프론트정렬규격.md` (이 step이 마지막 — PR에서 `완료/`로 옮김)

## 1. 바꾼 것

| 파일 | 바꾼 것 |
| --- | --- |
| `CLAUDE.md` | "작업 방식"에 한 줄: 화면을 만들거나 배치·문구를 바꾸면 `개발산출물/프론트_정렬규격.md` 순서(배치 약속 → spec 실패 확인 → 구현 → `test/e2e/layout/<화면>.spec.js` 통과 → 4개 폭 스크린샷 검토) |
| `개발산출물/주니어_체크리스트.md` | UI·상태 관리 마지막 항목을 규격 §1 순서로 갱신: `layoutSuite`·`STATES`·`data-layout-ignore`(의도)·`known`(아직 안 고침), §6 Q1~Q9 스크린샷 검토 표, FT-3에서 나온 원인 2개 추가(옛 CSS 이식 누락·`:global` 선택자 실수 / 390 긴 필 문구) |
| `test/e2e/layout/settings.spec.js` | `collectWrappedPills` + 테스트 6개(guest·user × 390·768·1280, 접힌 `details` 전부 펼침) |
| `개발산출물/프론트_정렬규격.md` | v1.3: §2 원인 행(390 긴 필 문구), §8 필 한 줄 검사 설명, §8-1 CI 포함 확인 결과·문서만 PR은 E2E 건너뜀, §10 기록 |

## 2. 필 글자 한 줄 검사

- **판정:** `main button, main a.pillBtn, main a.ghostBtn` 중 보이고 글자가 있는 것마다, 지금 높이 > `white-space: nowrap`으로 바꿨을 때 높이 + 1px 이면 실패 `#id "문구" 두 줄(높이 Hpx > 한 줄 hpx, 폭 Wpx)`. 글자 크기·패딩·이모지·`min-height`와 무관하게 같은 식
- **현재 코드:** 6 passed
- **헛돌지 않는지 확인:** `SettingsPage.tsx` 문구를 FT-3 이전 것으로 잠깐 되돌려 빌드·실행(확인 뒤 `git checkout`으로 복원, 다시 빌드) — 390에서만 2건 실패, 768·1280 통과

```
#btnOpenGeminiModal "🔑 무료 API 키 발급 가이드 (1분)" 두 줄(높이 75px > 한 줄 48px, 폭 270px)
#btnSyncEnable "연동 켜기 (기존 노션 데이터 이관)" 두 줄(높이 55px > 한 줄 48px, 폭 270px)
2 failed / 4 passed
```

  FT-3-settings에서 손으로 잰 값(74.7px, 칸 270px)과 같다
- 다른 화면에는 아직 넣지 않았다(요청 범위: settings). 공통 G 규칙으로 올릴지는 M2·L1-2(긴 영어·일본어 문구)에서 다른 화면 오탐을 보고 정한다 — 규격 §8

## 3. CI E2E에 `test/e2e/layout/` 포함 확인

| 확인 | 결과 |
| --- | --- |
| `playwright.config.js` | `testDir: './test/e2e'` → `layout/` 포함. `ci.yml` `e2e-security`가 `npm run test:e2e`(= `playwright test`)를 `ULP_UI` legacy·spa 행렬로 실행 |
| 로컬 목록 | `npx playwright test --list` 전체 189(이번 변경 전), `--list test/e2e/layout/` 128 |
| PR #74 CI(run 41982289732) | spa `189 passed (2.9m)`, legacy `16 passed`·`173 skipped`(layout은 `#root` 없어 skip) → 189 중 128이 layout |
| 주의 1 | `layoutSuite`가 만든 테스트는 위치가 `support\layout-check.js`로 찍혀 CI 로그를 `layout/`로 grep하면 0줄. 개수는 `--list`로 본다 |
| 주의 2 | `ci.yml` `changes` 작업: 문서(`*.md`·`docs/`·`개발산출물/`)만 바꾼 PR은 E2E를 건너뜀. 이번 PR은 spec을 바꿔 E2E가 돈다 |

이번 변경 뒤 로컬 전체 E2E: `npm run test:e2e` (spa 서버, win) **195 passed (3.7m)** = 기존 189 + 필 한 줄 6

## 4. 다음

- FT 묶음 끝. 남은 자잘한 일은 `인수인계_메모.md` "나중에"로 옮겼다(chords 후속 A·B·C, 필 한 줄 검사 공통화 검토)
- M2·M0-2·L1-2 step은 규격 §1 순서와 해당 화면 layout spec 통과를 완료 기준으로 쓴다(진행 파일 §10)
