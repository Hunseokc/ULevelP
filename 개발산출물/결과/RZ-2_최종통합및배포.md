# 결과: RZ-2 — 통합 Dockerfile(3단계 멀티스테이지) · deploy-cloudrun.yml `workflow_run` 안전화 · 최종 검증

- **작업일:** 2026-11-03
- **역할:** 주니어
- **브랜치:** `step/RZ-2` (base `main`)
- **근거 명세서:** `개발산출물/명세/RZ-2_구현명세.md`
- **상태:** **완료** — 빌드·배포 통합 범위는 완료. §5-2 남은 2건은 RZ-3-0 검토에서 신규 step `RZ-3`으로 이관(`결과/RZ-3-0_명세검토.md`)

---

## 1. 만든·고친 파일

| 구분 | 경로 | 내용 |
| :---: | :--- | :--- |
| 수정 | `frontend/index.html` | `/config.js`, Supabase UMD `@2.118.0`(SRI는 `public/index.html`의 실제 해시 `sha384-TcHRA3…` 사용, `crossorigin="anonymous"`), Google GIS 스크립트 추가. 기존 CSP meta·폰트는 유지 |
| 수정 | `frontend/src/main.tsx` | `./lib/auth`, `./lib/apiClient`, `./lib/drive` 부트스트랩 import 추가 (기존 `migrateLegacyStorageOnce`, `{ App }` 유지) |
| 수정 | `frontend/src/pages/HomePage.tsx` | `goUrlRef` + native `input` 리스너로 `el.value = …; dispatchEvent(new Event('input'))`에도 `goUrl` 상태 동기화 |
| 수정 | `Dockerfile` | `node:22-alpine`(frontend-build) → `eclipse-temurin:21-jdk-alpine`(build) → `eclipse-temurin:21-jre-alpine`(런타임) 3단계. `dist/assets` → `/app/public/assets`, `dist/index.html` → `/app/public/spa.html` |
| 수정 | `.github/workflows/deploy-cloudrun.yml` | `push` → `workflow_run`(CI, completed, main) + `workflow_dispatch`. `if:`에 `conclusion == 'success'`, `event != 'pull_request'` 가드, `head_sha` 체크아웃·이미지 태그, `/config.js` 스모크 추가 |
| 생성 | `test/rz2_deploy.test.js` | `RZ2-1`~`RZ2-4` (명세 코드 복사 후 실제 경로에 맞게 3곳 수정 — §4) |
| 생성 | `개발산출물/결과/RZ-2_최종통합및배포.md` | 본 문서 |
| 수정 | `개발산출물/진행_리액트및기능고도화.md` | RZ-2 상태 `진행` 및 남은 일 기록 |

---

## 2. Dockerfile 3단계 구조 및 컨테이너 검증

```dockerfile
FROM node:22-alpine AS frontend-build        # npm ci → COPY tsconfig/vite.config/frontend + public/lib → npm run build
FROM eclipse-temurin:21-jdk-alpine AS build  # gradlew installDist (build/install/ulevelp-server)
FROM eclipse-temurin:21-jre-alpine           # USER app, lib + public + dist/assets + spa.html, HEALTHCHECK /api/health
```

`docker build -t ulevelp:rz2 .` → `exit=0`. 컨테이너 스모크(`docker run -p 3000:3000`):

```text
{"ok":true}                                   # /api/health
app                                           # 실행 계정 (비루트)
assets / spa.html                             # /app/public 안
/                200 text/html; charset=UTF-8
/index.html      200 text/html; charset=UTF-8
/practice.html   200 text/html; charset=UTF-8
/log.html        200 text/html; charset=UTF-8
/config.js       200 text/javascript; charset=UTF-8
/spa.html        200 text/html; charset=UTF-8
/lib/theory.js   200 text/javascript; charset=UTF-8
/assets/index-r5bqe2kH.js      200 text/javascript; charset=UTF-8
/assets/index-BbdUdOVO.css     200 text/css; charset=UTF-8
1                                             # config.js에 ULEVELP_CONFIG
Content-Security-Policy: frame-ancestors 'none'
--- 잘못된 입력
404                                           # /assets/nope.js
403                                           # /../../etc/passwd (--path-as-is)
405                                           # POST /spa.html
healthy                                       # docker HEALTHCHECK
```

컨테이너 대상 `node 개발산출물/자료/csp_check.js http://127.0.0.1:3000/` → `화면 13개 중 실패 0개` (대조군 차단 포함).

React 번들 동작 확인(Playwright, HTML 라우트 요청을 컨테이너의 `/spa.html` 응답·헤더로 대체):

```text
/index.html                    {"kids":1,"csp":[],"h":"ULeveLP","goPickVisible":true} errors: none
/practice.html?v=dQw4w9WgXcQ   {"kids":1,"csp":[],...} errors: YouTube 임베드 광고·통계(doubleclick 등) 연결 거부 2건 — 앱 무관
/chords.html                   {"kids":0,"csp":[],"h":""} errors: TypeError: Cannot read properties of undefined (reading 'g6')   ← §5-2
/log.html                      {"kids":1,"csp":[],"h":"Log"} errors: none
/settings.html                 {"kids":1,"csp":[],"h":"Setting"} errors: none
/notes.html                    {"kids":1,"csp":[],"h":"Notes"} errors: none
/privacy.html                  {"kids":1,"csp":[],"h":"Privacy"} errors: none
```

`goPickVisible: true` — HomePage native `input` 보강이 동작한다.

---

## 3. deploy-cloudrun.yml `workflow_run` 전환 및 WIF

- 배포는 `CI` 워크플로가 `main`에서 `success`로 끝난 경우(또는 수동 `workflow_dispatch`)에만 돈다. PR 이벤트로 끝난 CI, 실패 CI, `GCP_PROJECT_ID` 미설정 저장소는 Job이 Skip된다.
- 체크아웃·이미지 태그는 `github.event.workflow_run.head_sha || github.sha` — CI가 검증한 그 커밋을 배포한다.
- 배포 본체는 기존(KZ-1에서 실환경 검증된) `scripts/deploy-cloudrun.sh`와 변수(`GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`, `RUNTIME_SA_EMAIL`, `CRON_SA_EMAIL` …)를 그대로 쓴다. WIF Pool/Provider·SA 권한 구성은 `scripts/deploy-cloudrun.sh` 머리 주석과 `개발산출물/결과/KZ-1_*` 기록이 기준이며 이번 step에서 바뀐 것이 없다.
- 참고: `workflow_run`은 기본 브랜치에 있는 워크플로 파일로만 동작하므로, 이 PR이 머지된 뒤 첫 main CI부터 적용된다.

---

## 4. 테스트 실행 결과

```text
$ npm run build
../dist/index.html                   1.70 kB │ gzip:   0.83 kB
../dist/assets/index-BbdUdOVO.css   51.72 kB │ gzip:   9.34 kB
../dist/assets/index-r5bqe2kH.js   418.50 kB │ gzip: 136.07 kB
✓ built in 556ms

$ npm test
ℹ tests 126
ℹ pass 126
ℹ fail 0

$ node --test test/rz2_deploy.test.js
✔ RZ2-1: Dockerfile 3단계 멀티스테이지 빌드 및 런타임 보안 검증
✔ RZ2-2: deploy-cloudrun.yml workflow_run 트리거 및 배포 가드 검증
✔ RZ2-3: frontend/index.html SDK 스크립트 및 main.tsx 전역 초기화 검증
✔ RZ2-4: 전체 React 페이지 CSP/인라인 스타일 금지 및 전체 라우트 전환 완료 검증

$ ./gradlew test --no-daemon
BUILD SUCCESSFUL in 36s

$ npm run test:e2e
  12 passed (8.3s)
```

`test/rz2_deploy.test.js`를 명세 코드에서 바꾼 곳:
1. RZ2-1 `HEALTHCHECK` 경로 `/health` → `/api/health` (실제 헬스 경로)
2. RZ2-2 `google-github-actions/deploy-cloudrun@v2` → `scripts/deploy-cloudrun.sh`, `/health` → `/api/health`
3. RZ2-4 `dangerouslySetInnerHTML` 검사를 `includes` → 속성 사용(`/\bdangerouslySetInnerHTML\s*=/`)으로. `SanitizedSvg.tsx`의 `Omit<…, 'dangerouslySetInnerHTML'>`(사용을 막는 타입 선언)이 걸렸기 때문. `test/r1_settings_notes.test.js`와 같은 방식

---

## 5. 명세와 달라진 점 / 발견한 문제

### 5-1. 명세의 사실 오류를 실제 코드에 맞춤
| 명세 | 실제 | 처리 |
| --- | --- | --- |
| `build/install/ulevelp/lib` | `build/install/ulevelp-server/lib` | 실제 경로 사용 (명세대로면 Docker 빌드 실패) |
| 헬스 `/health` | `/api/health` (`ChordRoutes.kt`) | 실제 경로 사용 (명세대로면 HEALTHCHECK·스모크 실패) |
| deploy를 `deploy-cloudrun@v2` + 새 변수 체계로 전면 교체 | KZ-1에서 실환경 검증된 `scripts/deploy-cloudrun.sh`(Service+Job+Scheduler) | 스크립트·변수 유지, 트리거·가드·`head_sha`만 명세대로 변경 (전면 교체 시 Job/Scheduler 배포 누락·변수 불일치) |
| `window.ULevelPConfig` | `window.ULEVELP_CONFIG` (`public/config.js`) | 스모크 grep을 실제 이름으로 |
| Supabase SRI 자리표시자 해시 | `public/index.html`의 실제 해시 | 실제 해시 사용 (자리표시자면 SDK 로드 차단) |
| `frontend/index.html` 전체 교체(CSP meta 없음, 다른 폰트) | 기존 CSP meta 존재 | 기존 파일에 스크립트 3줄만 추가 (CSP 유지, RN-D9) |
| Stage 1에 `frontend`만 복사 | `musicEngine.ts`가 `public/lib/theory.js`·`voicing.js` import | `COPY public/lib ./public/lib` 추가 (없으면 `Could not resolve "../../../public/lib/theory.js"`로 빌드 실패) |
| `main.tsx` import로 `window.ULevelPAuth/Api/Drive` 등록 | 세 모듈은 실제 이름 `window.ULAuth`(`auth.ts:356`)·`window.ULData`(`apiClient.ts:950`)·`window.ULDrive`(`drive.ts:410`)로 이미 등록한다(명세의 이름이 틀림). ※ 처음엔 "등록 안 함"으로 잘못 적었다가 RZ-3-0 검토에서 정정 | import만 추가 (import 시점에 위 전역이 등록된다) |
| Dockerfile `chown -R`, `NODE_ENV`, `gradlew dependencies` | 기존 Dockerfile엔 없음, Ktor는 `NODE_ENV` 미사용 | 기존 ENV·CRLF 처리(`sed`) 유지, 불필요 줄 생략 |

### 5-2. 남은 문제 (시니어 판단 필요 — RZ-2를 `진행`으로 둔 이유)
1. **`Main.kt`에 `serveSpaOrFallback`(spa.html 우선 서빙)이 없다.** 명세 §2.4는 이미 있다고 전제했지만 실제 Ktor 정적 라우트는 요청 경로 파일을 그대로 서빙한다. 그래서 이미지에 `spa.html`·`assets`는 들어가지만 `/`, `/index.html` 등은 여전히 레거시 `public/*.html`을 서빙한다(위 스모크에서 `/`에 `id="root"` 0건). 운영 화면을 React로 바꾸는 결정이고 `Main.kt`가 명세 파일 목록 밖이라 손대지 않았다.
2. **React 코드 연습실(`ChordsPage`)이 프로덕션 빌드에서 크래시한다** (`reading 'g6'`). `public/lib/theory.js`·`voicing.js`는 `if (typeof module !== 'undefined') module.exports = …` 형태인데, Vite(Rollup) 빌드는 `node_modules` 밖 파일에 CommonJS 변환을 하지 않아 import가 빈 객체가 된다. `vite.config.ts`의 `build`에 `commonjsOptions: { include: [/node_modules/, /public[\\/]lib[\\/]/] }` 한 줄을 넣으면 같은 검사에서 `/chords.html {"kids":1,"h":"코드 연습실"} errors: none`이 되는 것을 임시로 확인했다(명세 밖이라 되돌림, 커밋 안 함). R2-1 테스트가 정적 검사만이라 놓친 문제다.

---

## 6. 체크리스트

- [x] `frontend/index.html`에 `/config.js`, Supabase UMD(SRI, `crossorigin="anonymous"`), GIS 스크립트 포함
- [x] `frontend/src/main.tsx`가 `./lib/auth`, `./lib/apiClient`, `./lib/drive` import
- [x] `Dockerfile` 3단계 멀티스테이지, `dist/index.html` → `./public/spa.html`
- [x] `deploy-cloudrun.yml` `workflow_run`(CI 성공 조건) 전환, `head_sha` 체크아웃
- [x] `npm test` 기존 + `r3_practice_log` + `rz2_deploy` 전부 통과 (126/126)
- [x] React 화면 운영 연결 및 ChordsPage 빌드 크래시 — §5-2, RZ-3으로 이관(RZ-3-0 결정)
