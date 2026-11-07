# FX-2 결과 — 설정 화면 간격 · 테마 전환 하단 푸터 · Drive OAuth 클라이언트 이전

- **날짜:** 2026-11-04
- **계기:** 사용자 보고 3건(스크린샷) — ① 설정에서 Google Drive 저장소 전환 시 `액세스 차단됨: no registered origin / 401 invalid_client` ② 설정 화면 간격 들쭉날쭉 ③ 라이트/다크 전환이 설정·코드 연습실 상단에만 있고 홈에 없음
- **상태:** ②③ PR 올림 / ① `ulevelp` 프로젝트 Drive API 켬, OAuth 클라이언트 생성은 사용자 콘솔 작업 대기

## 1. Drive 연동 실패 (①)

| 항목 | 내용 |
| --- | --- |
| 원인 | `public/config.js:12` `googleClientId`(`696282514694-…`)가 `ulevelp`가 아닌 **`bookach` 프로젝트**(번호 696282514694)의 OAuth 클라이언트. 승인된 JavaScript 원본에 `https://ulevelp-d5ympfsmfq-du.a.run.app`이 없어 팝업 단계에서 거부 |
| 부가 | `bookach`에 `drive.googleapis.com`도 꺼져 있음(원본만 고쳐도 업로드 단계에서 403 예정) |
| 결정 | 사용자 결정: **`ulevelp` 프로젝트로 통합**(새 OAuth 클라이언트) |
| 한 것 | `gcloud services enable drive.googleapis.com --project ulevelp` → 활성 확인 |
| 남은 것 (사용자) | GCP 콘솔 `ulevelp` → Google Auth Platform: 브랜딩(앱 이름·지원 이메일), 대상 외부 + 테스트 사용자 `dorazibe02@gmail.com`, 클라이언트 → 웹 애플리케이션, 승인된 JavaScript 원본 `https://ulevelp-d5ympfsmfq-du.a.run.app` → 새 클라이언트 ID 전달 |
| 남은 것 (코드) | `public/config.js:12` ID 교체 PR 1개 → 머지 → Cloud Run 재배포 → 설정에서 "Google Drive 저장소 사용" 실측 |
| 범위 밖 | Supabase Google 로그인용 OAuth 클라이언트는 Supabase 대시보드에 별도(`bookach`일 가능성). 로그인은 정상이라 이번엔 그대로. 로그인 OAuth에 `drive.file`을 합치는 안은 `provider_token` 1시간 만료·갱신 없음 때문에 서버 refresh token 저장(DB·API 변경)이 필요해 보류 |

권한은 `drive.file`(앱이 만든 파일만) 하나 → 민감 권한이 아니라 심사 없이 "프로덕션 게시" 가능. 사용자별 설정은 필요 없고 동의 팝업에서 허용만 누른다.

**스크린샷의 "알 수 없는 서명 키(kid)입니다."**: 운영 로그상 01:51:20 `/api/v1/integrations` 401 → 01:54:18 같은 요청 200. 브라우저에 남은 옛 세션 토큰으로 인한 일시 오류로 보고 수정하지 않음. 운영 revision은 아직 `ulevelp-00005-48z`(PR #56 이후 Cloud Run 배포 `skipped`)라 설정 안내 5단계도 아직 운영 미반영.

## 2. 설정 화면 간격 (②)

**원인:** 섹션 `gap: 14px`, 패널 `gap: 10px` + `margin-top: 8px`, 래퍼 div(`#accUser`·`#notionSyncPanel`)는 간격 0, `<ol>` 기본 margin(24px), 빈 `<p class="msg">`(min-height 20px)가 간격 한 칸을 차지.

**수정 (간격 스케일 = 섹션 16 · 패널/래퍼 12 · 라벨 6):**

| 파일 | 내용 |
| --- | --- |
| `frontend/src/pages/SettingsPage.module.css` | `.setSec` gap 16, `.panel`·`.previewBox` gap 12·margin 제거, `.setSec p:empty` 숨김, `.stack`(16)·`.stackTight`(12)·`.detailsBody`·`.guide`·`.fileInput` 추가, `.row` 안 버튼 줄바꿈 허용(390px 넘침) |
| `frontend/src/pages/SettingsPage.tsx` | `#accUser` → `stack`, `#notionSyncPanel`·계정 삭제 본문 → `stackTight`, `#ntnGuide` → `guide`, 파일 입력 → `fileInput`(필 테두리 제거). id·구조 그대로 |
| `test/e2e/settings-spacing.spec.js` (신규) | 로그인 상태 1280·390px: 세로로 쌓인 형제 간격이 {6,12,16} 안이고 상자마다 일정 + 버튼이 상자 안쪽 여백 밖으로 안 나감 |
| `test/r1_settings_notes.test.js` | R1-S10 `#ntnGuide` 정규식이 className 문자열에 묶여 있던 것을 완화 |

**수정 전 실측 (같은 검사):**

```text
#account 간격 14/14/14/14
#accUser 간격 0/8/0/0
#driveStoragePanel 간격 10/10/10/10
details 계정 삭제 간격 0
#nx 간격 14/14/22/22/14
패널(데이터 내보내기·노션 백업 가져오기·Gemini) 간격 10/…
#keys 간격 14/22/22
노션 연동 패널 간격 24/24/10/10/10/10/10/10
#notionSyncPanel 간격 0/0
#links 간격 14/… · #screen 간격 14
#btnSyncEnable 상자 안쪽 여백 밖으로 19px (390px)
```

**수정 후:** `settings-spacing.spec.js` 2 passed. 버튼 줄바꿈 규칙만 빼면 `#btnSyncEnable 상자 안쪽 여백 밖으로 19px`로 실패함을 확인(검사가 실제로 잡는다).

## 3. 테마 전환 하단 푸터 (③)

| 파일 | 내용 |
| --- | --- |
| `frontend/src/components/layout/AppShell.tsx` | 토글을 상단 `nav`에서 `main` 아래 `<footer>`로 이동. `showThemeToggle` 기본값 `false` → `true`(모든 화면). 속성 이름·`#theme-light`/`#theme-dark` id 유지 |
| `frontend/src/components/layout/AppShell.module.css` | `.siteFoot` (윗선 + 16px) |
| `frontend/src/lib/security.ts` | `setTheme`이 `ulp:themechange` 이벤트(`THEME_EVENT` export 추가)를 보냄 — 설정 화면 "화면" 섹션(시스템/라이트/다크)과 푸터 토글의 눌림 표시를 맞춤. 기존 시그니처 그대로 |
| `frontend/src/pages/SettingsPage.tsx` | "화면" 섹션이 위 이벤트를 구독 |
| `test/e2e/theme-footer.spec.js` (신규) | 8개 화면 390px: 푸터에 토글 보임, `nav` 안에 없음, 푸터가 `main` 아래, 다크 클릭 시 `html[data-theme=dark]`. 설정 화면 두 컨트롤 눌림 표시 일치 |

설정 화면 "화면" 섹션은 남겼다("시스템" 선택은 여기만 있고 `개발산출물/자료/csp_check.js:59`가 `[data-theme="light"]`를 누른다).

## 4. 확인 (`.env` 무관 — compose 미사용, 로컬 빌드 + server.js)

```text
tsc --noEmit: 0
npm test: tests 140 / pass 140 / fail 0
settings-spacing + theme-footer: 11 passed
E2E legacy (node server.js): 16 passed, 24 skipped (React 전용 spec)
E2E spa (ULP_UI=spa node server.js): 40 passed
```

스크린샷 검토(1280·390): 설정 계정·연동 키 섹션 간격 균일, 홈 맨 아래 `DAILY DIARY` 줄 다음에 윗선 + 라이트/다크 토글.

## 5. 다음

- 사용자: §1 콘솔 작업 → 새 클라이언트 ID 전달
- 코드: `config.js` ID 교체 PR → 배포 → Drive 전환·업로드 실측
- `진행_프론트정렬규격.md` FT-2에서 `settings-spacing.spec.js`의 간격 판정을 공통 검사기 G8로 흡수
