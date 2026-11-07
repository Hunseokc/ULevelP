# KZ-1 구현 명세 — Google Cloud Run 배포 자동화 & 보안 응답 헤더 · 최종 공개 점검

- **작성:** D0(시니어), 2026-11-02 (문서 리뷰 반영 완료). 결정 근거는 `개발산출물/결과/D0_명세검토.md`.
- **역할:** 주니어. 이 명세 → `개발산출물/주니어_체크리스트.md` → "이 파일처럼"으로 지정한 기존 코드 순서로 판단한다. 셋 다 답이 없으면 멈추고 묻는다.
- **먼저 읽기:** `개발산출물/결과/K6-1_구글드라이브.md`("KZ-1이 쓸 값"), `.github/workflows/ci.yml`, `Dockerfile`, `src/main/kotlin/ulevelp/Main.kt`, `docs/01-project-plan.md` 3·5·7절, `docs/02-requirements.md` NFR-SEC-1~3.
- **기준 문서:** `docs/01-project-plan.md` KC-D1·KC-D3·KC-D6·KC-D7, `docs/02-requirements.md` NFR-SEC-1, `docs/03-api-spec.md` 7.3·9절.
- **묶음 D(및 전체 프로젝트)의 마지막 step이다.** 코드·자동 검증과 함께 **사람이 수행할 Cloud Run 배포·실환경 점검(M-KZ1 ~ M-KZ5)** 이 포함되어 있다. 자동 검증까지 끝내고 실환경 점검이 남았으면 `주니어_체크리스트.md` 범위·검증·기록 규칙에 따라 단계 표와 결과 파일 상태를 `진행`으로 두고 사용자에게 실환경 점검을 안내한다(실환경 점검까지 모두 확인되면 `완료` 및 `D 묶음(K5-1, K5-2, K6-1, KZ-1) 단계 완료하였습니다.`를 기록한다).

## 1. 파일 목록 (이 밖의 파일은 고치지 않는다)

| 구분 | 경로 | 하는 일 |
| --- | --- | --- |
| 수정 | `src/main/kotlin/ulevelp/Main.kt` | 모든 응답에 `X-Frame-Options: DENY` 추가 및 정적 HTML 응답에 `Content-Security-Policy: frame-ancestors 'none'` 헤더 추가 (`NFR-SEC-1` Clickjacking 차단) |
| 수정 | `src/test/kotlin/ulevelp/ChordEngineTest.kt` | API 응답 및 정적 HTML 응답의 Clickjacking 방지 보안 헤더(`X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`) 검증 테스트 추가 (6절 Z1~Z2) |
| 신규 | `.github/workflows/deploy-cloudrun.yml` | `main` 브랜치 push(GCP 변수 설정 시) 및 `workflow_dispatch`에서 Docker 이미지 빌드 → Artifact Registry push → Cloud Run 서비스(`ulevelp`) 배포 → Cloud Run Job(`analyze`) 갱신 워크플로 |
| 신규 | `scripts/deploy-cloudrun.sh` | 로컬/CI 공용 Cloud Run 서비스(`ulevelp`), Cloud Run Job(`analyze`), IAM 권한(`roles/run.developer`), Cloud Scheduler 1분 크론(`ulevelp-notion-push`) 생성·갱신 스크립트 |
| 신규 | `개발산출물/결과/KZ-1_CloudRun배포.md` | 결과 파일 (8절) |
| 수정 | `개발산출물/진행_코틀린서버.md` | 3·5·6·7절 갱신 |

## 2. 시그니처 및 구성 규격

### 2.1 `src/main/kotlin/ulevelp/Main.kt` HTTP 보안 헤더 (`NFR-SEC-1`)

`Main.kt`의 `intercept(ApplicationCallPipeline.Plugins)` 및 정적 파일 서빙 블록을 아래와 같이 보강한다:

1. 모든 응답 공통 헤더 (`intercept(ApplicationCallPipeline.Plugins)`):
   ```kotlin
   intercept(ApplicationCallPipeline.Plugins) {
       call.response.headers.append("X-Content-Type-Options", "nosniff")
       call.response.headers.append("X-Frame-Options", "DENY")
   }
   ```
2. HTML 응답 헤더 (`ext == "html"`일 때):
   - 브라우저 `<meta http-equiv="Content-Security-Policy">`는 W3C 표준상 `frame-ancestors` 지시어를 무시하므로, 서버가 HTML을 내려줄 때 HTTP 헤더로 `Content-Security-Policy: frame-ancestors 'none'`을 추가하여 기존 `<meta>` CSP와 교집합으로 동작하게 한다:
   ```kotlin
   if (ext == "html") {
       call.response.headers.append("Content-Security-Policy", "frame-ancestors 'none'")
   }
   ```

### 2.2 `.github/workflows/deploy-cloudrun.yml`

- **트리거:**
  - `workflow_dispatch` (수동 실행)
  - `push` (`branches: [main]`) — 단, 저장소 Variables에 `GCP_PROJECT_ID`가 설정되어 있을 때만(`if: vars.GCP_PROJECT_ID != ''`) 실행하여 GCP 설정 전에도 `main` 워크플로가 실패하지 않도록 보호한다.
- **권한:** `contents: read`, `id-token: write` (Google Cloud Workload Identity Federation 인증 지원).
- **주요 단계:**
  1. `actions/checkout@v5`
  2. `google-github-actions/auth@v2` (`workload_identity_provider: ${{ vars.GCP_WIF_PROVIDER }}`, `service_account: ${{ vars.GCP_DEPLOY_SA }}`)
  3. `google-github-actions/setup-gcloud@v2`
  4. `gcloud auth configure-docker ${{ vars.GCP_REGION || 'asia-northeast3' }}-docker.pkg.dev --quiet`
  5. `docker build -t "$IMAGE_URI" . && docker push "$IMAGE_URI"`
  6. `bash scripts/deploy-cloudrun.sh "$IMAGE_URI"` 실행
  7. 배포된 Cloud Run 서비스 URL에 대해 `curl -fsS "$SERVICE_URL/api/health"` 스모크 테스트 확인

### 2.3 `scripts/deploy-cloudrun.sh` (`CLOUD_RUN_ANALYZE_JOB_URI` 형식 및 IAM 권한 포함)

환경변수(`GCP_PROJECT_ID`, `GCP_REGION`[기본 `asia-northeast3`], `CLOUD_RUN_SERVICE`[기본 `ulevelp`], `CLOUD_RUN_JOB`[기본 `analyze`], `RUNTIME_SA_EMAIL`, `CRON_SA_EMAIL`)를 받아 아래 4가지를 멱등하게 배포·갱신하는 셸 스크립트(`set -euo pipefail`, `chmod +x`):
1. **Cloud Run Job `analyze` 생성/갱신 (`KC-D6`):**
   - 이미지: `$IMAGE_URI`, `--service-account="${RUNTIME_SA_EMAIL}"`, `--task-timeout=3600s`(60분), `--max-retries=0`, `--cpu=1`, `--memory=1Gi`, 시크릿(`DATABASE_URL`, `APP_MASTER_KEY`).
2. **런타임 서비스 계정(`RUNTIME_SA_EMAIL`)의 Job 실행 IAM 권한 부여 (`docs/03-api-spec.md` 7.3절):**
   - Cloud Run 서비스(`ulevelp`)가 Cloud Run Job(`analyze`)의 `run`(`run.jobs.runWithOverrides`) API를 호출할 수 있도록 `gcloud run jobs add-iam-policy-binding "${CLOUD_RUN_JOB}" --region="${GCP_REGION}" --member="serviceAccount:${RUNTIME_SA_EMAIL}" --role="roles/run.developer"`를 실행한다.
3. **Cloud Run 서비스 `ulevelp` 배포 (`KC-D1`, `KC-D3`):**
   - **`CLOUD_RUN_ANALYZE_JOB_URI` 값 형식 고정:**
     `ANALYZE_JOB_URI="https://run.googleapis.com/v2/projects/${GCP_PROJECT_ID}/locations/${GCP_REGION}/jobs/${CLOUD_RUN_JOB}:run"`
   - 이미지: `$IMAGE_URI`, `--service-account="${RUNTIME_SA_EMAIL}"`, `--allow-unauthenticated`, `--port=3000`, `--min-instances=0`, `--max-instances=1`(`ImportPreviewStore` 인메모리 캐시 정합), `--cpu-boost`, `--timeout=300s`, 환경변수(`SUPABASE_URL`, `PUBLIC_APP_URL`, `ALLOWED_ORIGINS`, `CRON_AUDIENCE`, `CRON_SA_EMAIL`, `CLOUD_RUN_ANALYZE_JOB_URI=${ANALYZE_JOB_URI}`), 시크릿(`DATABASE_URL`, `SUPABASE_SECRET_KEY`, `APP_MASTER_KEY`).
4. **Cloud Scheduler 1분 크론 `ulevelp-notion-push` 생성/갱신 (`KC-D7`):**
   - 주기: `* * * * *` (매 1분)
   - 대상: `POST ${SERVICE_URL}/internal/cron/notion-push`
   - 인증: `--oidc-service-account-email="${CRON_SA_EMAIL}" --oidc-token-audience="${SERVICE_URL}"`

## 3. DTO 필드 표

신규 API DTO 없음 (`GET /api/health` → `200 OK` `{ "ok": true }`).

## 4. 검증·에러 표

| 대상 | 조건 | 기대 응답 / 헤더 |
| --- | --- | --- |
| `GET /api/health` | 정상 기동 | `200 OK`, `{"ok":true}`, `X-Frame-Options: DENY` |
| `GET /` (`index.html`) | 정적 HTML 요청 | `200 OK`, `Cache-Control: no-cache`, `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'` |

## 5. 처리 순서

1. `Main.kt`에 `X-Frame-Options: DENY` 및 HTML 응답 `Content-Security-Policy: frame-ancestors 'none'` 헤더를 추가한다.
2. `ChordEngineTest.kt`에 Clickjacking 방지 보안 헤더 검증 케이스(`Z1`, `Z2`)를 추가하고 `./gradlew test --no-daemon`을 실행한다.
3. `scripts/deploy-cloudrun.sh`와 `.github/workflows/deploy-cloudrun.yml`을 작성하고 `bash -n scripts/deploy-cloudrun.sh`로 문법 검사를 수행한다.
4. Docker 이미지를 로컬에서 빌드(`docker build -t ulevelp-server:local .`)하고 컨테이너를 기동해 `/api/health`, `/`, 보안 헤더, `csp_check.js`(전체 화면 + 대조군), `npm test`, `npm run test:e2e`를 모두 실행해 검증한다.
5. **실환경 배포 및 점검 (사람 — M-KZ1 ~ M-KZ5):**
   - **M-KZ1:** GCP 프로젝트에 Secret Manager 시크릿(`DATABASE_URL`, `SUPABASE_SECRET_KEY`, `APP_MASTER_KEY`) 등록, `RUNTIME_SA_EMAIL`에 `roles/run.developer` 및 `roles/secretmanager.secretAccessor` 부여 후 `scripts/deploy-cloudrun.sh`로 Cloud Run 서비스(`ulevelp`)·Cloud Run Job(`analyze`) 배포 (`CLOUD_RUN_ANALYZE_JOB_URI=https://run.googleapis.com/v2/projects/<project>/locations/<region>/jobs/analyze:run`).
   - **M-KZ2:** Cloud Scheduler `ulevelp-notion-push`(1분 주기, OIDC 인증) 생성 및 수동 1회 실행 시 `200 OK` 확인.
   - **M-KZ3:** Cloud Run 서비스 URL에서 `GET /api/health` → `200 {"ok":true}` 및 정적 루트(`/`)의 `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY` 헤더 확인.
   - **M-KZ4:** (GitHub Pages 병행 사용 시) `public/config.js`의 `apiBaseUrl`과 CSP `connect-src`에 Cloud Run 서비스 URL 반영 여부 확인, 또는 Cloud Run 단일 Origin 서빙에서 Google 로그인 → 곡 저장 → 녹음 업로드/재생 → 노션 동기화 → Gemini 학습 노트 생성 동작 확인.
   - **M-KZ5:** 아이패드 Safari(또는 모바일 뷰포트)에서 플레이어 구간 반복, 녹음, 기록 달력, 코드 연습실, 학습 노트 뷰어 점검.

## 6. 테스트 케이스 (`src/test/kotlin/ulevelp/ChordEngineTest.kt` 추가 `Z1`~`Z2`)

*(기존 `ChordEngineTest.kt`에 이미 있는 `X-Content-Type-Options: nosniff` 검증과 중복하지 않고, 이 step에서 새로 추가한 Clickjacking 차단 헤더를 검증한다.)*

| 이름 | 요청 | 기대 |
| --- | --- | --- |
| Z1 API 응답 `X-Frame-Options: DENY` 헤더 검증 | `GET /api/health` | `200 OK`, 헤더 `X-Frame-Options == "DENY"` (`Content-Security-Policy` 헤더는 비 HTML이므로 미포함) |
| Z2 정적 HTML 서빙 시 Clickjacking 방지 헤더 검증 (`NFR-SEC-1`) | `GET /` 및 `GET /index.html` | `200 OK`, 헤더 `Content-Security-Policy == "frame-ancestors 'none'"`, `X-Frame-Options == "DENY"`, `Cache-Control == "no-cache"` |

## 7. 체크리스트 (자동 검증 + 실환경 확인)

- [ ] 백엔드 전체 테스트 통과 — `./gradlew test --no-daemon` → `BUILD SUCCESSFUL` (`Z1`·`Z2` 포함 전 테스트 통과)
- [ ] 프런트엔드 단위·보안 정적 테스트 통과 — `npm test` → `ℹ fail 0`
- [ ] Playwright XSS E2E 테스트 통과 — `npm run test:e2e` → `10 passed`
- [ ] 배포 스크립트 문법 검사 통과 — `bash -n scripts/deploy-cloudrun.sh` → 종료 코드 `0`
- [ ] Docker 멀티스테이지 빌드 및 컨테이너 스모크 테스트 통과 — `docker build -t ulevelp-server:local .` 후 컨테이너 기동 시 `curl -fsSI http://127.0.0.1:3000/`에 `Content-Security-Policy: frame-ancestors 'none'` 및 `X-Frame-Options: DENY` 포함, `curl -fsS http://127.0.0.1:3000/api/health` → `{"ok":true}`
- [ ] CSP 및 전체 화면 헤드리스 브라우저 검사 통과 — `node 개발산출물/자료/csp_check.js` → `실패 0개`
- [ ] 파일 목록 일치 — `git status --short`가 1절 표의 파일만
- [ ] 주니어 체크리스트 전 항목으로 diff 점검 — PR 본문에 "주니어 체크리스트 점검 완료"
- [ ] **(사람)** M-KZ1 ~ M-KZ5 Cloud Run 프로덕션 배포 및 실기기 최종 점검 완료

## 8. 결과 파일 `개발산출물/결과/KZ-1_CloudRun배포.md`에 적을 것

1. 만든·고친 파일 표.
2. `./gradlew test --no-daemon`, `npm test`, `npm run test:e2e`, `docker build` & `curl -fsSI`, `csp_check.js` 실행 출력.
3. Cloud Run 배포 명령 안내 및 M-KZ1 ~ M-KZ5 점검표.
4. 명세와 달라진 점(없으면 "없음"), 겪은 문제.

## 9. 금지 사항

- `ci.yml`에 GCP 시크릿이 없을 때 PR CI를 실패시키는 무조건부 배포 작업을 넣지 않는다(배포는 별도 `.github/workflows/deploy-cloudrun.yml`로 분리하고 `vars.GCP_PROJECT_ID != ''` 조건을 건다).
- 사람이 수행해야 하는 M-KZ1 ~ M-KZ5 실환경 배포 확인이 끝나기 전에 임의로 M-KZ1 ~ M-KZ5를 `[x]`로 거짓 표시하지 않는다(`주니어_체크리스트.md` 범위·검증·기록 1번 규칙).
