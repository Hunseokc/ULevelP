# 결과: RZ-3 — Cloud Run React 전환(SPA 서빙·롤백 스위치) · Vite CJS 변환 · E2E 2모드 · 레이아웃 보정

- **작업일:** 2026-11-03
- **역할:** 주니어
- **근거:** `명세/RZ-3_구현명세.md`, `결과/RZ-3-0_명세검토.md`
- **브랜치:** `step/RZ-3` (base `main`, PR #44 머지 후 `origin/main`에서 생성)

---

## 1. 바꾼 파일

| 구분 | 경로 | 내용 |
| --- | --- | --- |
| 수정 | `src/main/kotlin/ulevelp/Main.kt` | `module()` 끝에 `uiMode: String = System.getenv("ULP_UI").orEmpty()`, `SPA_ENTRY_PAGES` 8개, `spaEnabled`, `servedPath` 매핑 |
| 수정 | `src/test/kotlin/ulevelp/ChordEngineTest.kt` | `Z4`~`Z6` 추가 (명세 2.2 그대로) |
| 수정 | `server.js` | `DIST_DIR`·`SPA_PAGES`·`SPA_MODE`, `serveStatic` root 선택, 시작 시 `UI mode:` 로그 |
| 수정 | `vite.config.ts` | `build.commonjsOptions.include: [/node_modules/, /public[\\/]lib[\\/]/]` |
| 수정 | `.github/workflows/ci.yml` | `e2e-security` matrix `ui: [legacy, spa]`(spa만 `npm run build`), Docker job `SPA entry served (React)`·`Rollback switch (ULP_UI=legacy)`, Cleanup에 `app-legacy` |
| 수정 | `.github/workflows/deploy-cloudrun.yml` | `ALLOWED_ORIGINS` 기본값 localhost 제거, `ULP_UI: ${{ vars.ULP_UI \|\| 'spa' }}` |
| 수정 | `scripts/deploy-cloudrun.sh` | 머리 주석, `ALLOWED_ORIGINS` 기본값 localhost 제거, `ULP_UI="${ULP_UI:-spa}"`, `--set-env-vars`에 `ULP_UI` |
| 생성 | `test/e2e/layout.spec.js` | 390/768/1280px × 8화면 가로 스크롤 0건 (명세 2.7 그대로) |
| 수정 | `public/site.css` | `#btnOpenGeminiModal` 줄바꿈 허용 |
| 수정 | `frontend/src/pages/SettingsPage.module.css`·`SettingsPage.tsx` | `.geminiGuideBtn` + 버튼 className, `document.title` |
| 수정 | `frontend/src/pages/{ChordsPage,NotesPage,NoteDetailPage,PrivacyPage}.tsx` | 컴포넌트 첫 줄 `useEffect`로 `document.title` (Privacy는 `useEffect` import 추가) |
| 생성 | `test/rz3_spa.test.js` | `RZ3-1`~`RZ3-4` (명세 2.10 그대로) |

## 2. 실행 결과

### 2-1. 레이아웃 E2E — 수정 전 실패 확인 (P1 CSS 적용 전)
```
== legacy
  ✘  1 [chromium] › test/e2e/layout.spec.js:17:3 › L1 390px 전 화면 가로 스크롤 0건 (5.2s)
    +   "/settings.html +76px",
  1 failed
  14 passed (23.7s)
== spa
  ✘  1 [chromium] › test/e2e/layout.spec.js:17:3 › L1 390px 전 화면 가로 스크롤 0건 (5.3s)
    +   "/settings.html +64px",
  1 failed
  14 passed (24.7s)
```
명세 2.7의 예상값(+76px / +64px)과 같다. 768·1280px는 수정 전에도 통과.

### 2-2. E2E 두 모드 — 수정 후 (xss 12 + layout 3)
```
npx playwright test               → legacy 0   15 passed (23.6s)
ULP_UI=spa npx playwright test    → spa 0      15 passed (25.0s)
```

### 2-3. csp_check 3곳 (`node 개발산출물/자료/csp_check.js <URL>`)
| 대상 | 결과 | 코드 연습실 `svgs` | 비고 |
| --- | --- | --- | --- |
| `node server.js` (legacy) | 화면 13개 중 실패 0개 | 131 | |
| `ULP_UI=spa node server.js` | 화면 13개 중 실패 0개 | 50 | `note.html?id` title `학습 노트 상세 · ULeveLP` (P2 반영 확인) |
| Docker `ulevelp:rz3` (SPA) | 화면 13개 중 실패 0개 | 50 | |

- legacy·React의 `svgs` 수 차이(131 vs 50)는 두 화면이 같은 탭에 그리는 다이어그램 수가 원래 다르기 때문. 명세 기준(≥50, 크래시 없음) 충족. Vite CJS 수정 전에는 React 코드 연습실이 `reading 'g6'`로 크래시했다(RZ-3-0 §2-2)

### 2-4. Docker 2모드 (`docker build -t ulevelp:rz3 .` → EXIT 0)
```
== spa (docker run -p 3000:3000 ulevelp:rz3)
{"ok":true}
1                                  ← / 응답의 id="root" 개수
/assets/index-DOHAHI8w.js
asset 200
HTTP/1.1 200 OK                    ← HEAD /notes.html
Cache-Control: no-cache
Content-Security-Policy: frame-ancestors 'none'
unknown 404                        ← /unknown.html
traversal 403                      ← /../../etc/passwd (--path-as-is)
== legacy (docker run -e ULP_UI=legacy -p 3001:3000 ulevelp:rz3)
0                                  ← id="root" 없음 = 레거시 HTML
<title>ULeveLP</title>
```

### 2-5. 단위 테스트·빌드
```
./gradlew test --no-daemon   → BUILD SUCCESSFUL, tests 193 fail 0
  Z4 spa_html이 있으면 HTML 진입 경로에 spa_html을 서빙한다() ok
  Z5 ULP_UI=legacy면 spa_html이 있어도 레거시 HTML을 서빙한다() ok
  Z6 spa_html이 없으면 레거시 HTML을 서빙한다() ok
npm test                     → tests 132, pass 132, fail 0 (RZ3-1 ~ RZ3-4 ✔)
npm run build                → ✓ built (dist/assets/index-DOHAHI8w.js 418.71 kB)
bash -n scripts/deploy-cloudrun.sh, ci.yml·deploy-cloudrun.yml YAML 파싱 → OK
```
- 수정 전 `npm test`에서 `RZ3-3`이 deploy-cloudrun.yml 미수정으로 실패하는 것도 확인(배포 파일 수정 후 통과)

## 3. 롤백 절차 (Cloud Run React → 레거시)
- 즉시: `gcloud run services update ulevelp --region asia-northeast3 --update-env-vars ULP_UI=legacy`
- 다음 배포에도 유지: 저장소 Variables에 `ULP_UI=legacy` 설정

## 4. 명세와 달라진 점
- 없음. 코드 블록(Z4~Z6, layout.spec.js, rz3_spa.test.js)은 명세에서 그대로 옮겼다
- `server.listen` 콜백은 한 줄 화살표 함수였어서, 로그 두 줄을 넣으려고 블록 `{ }`으로 바꿨다(동작 같음)
- `ci.yml` Cleanup은 `docker rm -f app-legacy || true`를 추가하면서 `run: |` 여러 줄로 바꿨다

## 5. 남은 문제·관찰
- 실제 CI에서 E2E spa job·Docker 롤백 단계가 도는지는 PR CI로 확인(아래 PR 항목)
- `.env`에 `COMPOSE_FILE`·`COMPOSE_PATH_SEPARATOR` 줄이 없다. 이번 step은 compose를 쓰지 않고 `docker build`/`docker run`으로 직접 검증해서 영향 없음
- 운영 반영(배포 발동·`ULP_UI=legacy` 실측)은 `RZ-M`(사람)에서 확인
