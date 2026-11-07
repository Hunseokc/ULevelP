# KZ-1 결과 — Google Cloud Run 배포 자동화 & 보안 응답 헤더 · 최종 공개 점검

- **수행일:** 2026-11-02
- **역할:** 주니어 (구현 명세 `개발산출물/명세/KZ-1_구현명세.md` 및 `개발산출물/주니어_체크리스트.md` 기준 구현·검증)
- **브랜치:** `step/KZ-1`
- **상태:** 진행 (M-KZ1~M-KZ3 실환경 확인 완료 2026-11-02, M-KZ4~M-KZ5 사람 점검 대기)

---

## 1. 만든·고친 파일 표

| 구분 | 파일 경로 | 작업 내용 |
| :--- | :--- | :--- |
| 수정 | `src/main/kotlin/ulevelp/Main.kt` | 모든 응답 공통 `X-Frame-Options: DENY` 추가 및 HTML 응답 서빙 시 `Content-Security-Policy: frame-ancestors 'none'` 보안 헤더 추가 (`NFR-SEC-1` Clickjacking 방어) |
| 수정 | `src/test/kotlin/ulevelp/ChordEngineTest.kt` | `Z1`(API 응답 `X-Frame-Options: DENY` 검증) 및 `Z2`(정적 HTML 서빙 시 `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Cache-Control: no-cache` 검증) 단위 테스트 추가 |
| 신규 | `scripts/deploy-cloudrun.sh` | Cloud Run 서비스(`ulevelp`), Cloud Run Job(`analyze`), IAM 권한(`roles/run.developer`), Cloud Scheduler 1분 크론(`ulevelp-notion-push`) 멱등 배포·갱신 셸 스크립트 작성 및 실행 권한 부여 |
| 신규 | `.github/workflows/deploy-cloudrun.yml` | `main` push 및 수동 실행 워크플로 구성 (`vars.GCP_PROJECT_ID != ''` 보호, WIF 인증, Docker 빌드/푸시, 스크립트 배포, 배포 후 `/api/health` 스모크 테스트) |
| 신규 | `개발산출물/결과/KZ-1_CloudRun배포.md` | 결과 기록 및 점검표 |
| 수정 | `개발산출물/진행_코틀린서버.md` | 3·5·6·7절 상태 갱신 |

---

## 2. 자동 검증 증적

### 2.1 백엔드 전체 테스트 (`./gradlew test --no-daemon`)

```text
ChordEngineTest > Z1 API 응답 X-Frame-Options DENY 헤더 검증() PASSED
ChordEngineTest > Z2 정적 HTML 서빙 시 Clickjacking 방지 헤더 검증() PASSED
ChordEngineTest > Ktor API 엔드포인트 및 정적 파일 서빙 검증() PASSED

BUILD SUCCESSFUL in 20s
5 actionable tasks: 4 executed, 1 up-to-date
```

### 2.2 프런트엔드 단위 & XSS 정적 검사 (`npm test`)

```text
✔ auth.js: createClient에 storageKey ulp:auth 및 flowType pkce를 고정하고 비로그인 시 상단 메뉴에 LOGIN을 표시한다 (10.693167ms)
✔ D1 비로그인: isLoggedIn()은 false, 다른 함수는 401 NOT_LOGGED_IN 거부, 서버 호출 0 (8.817541ms)
...
✔ D34 ULDrive.uploadBlob 5MB 이하 multipart / 5MB 초과 resumable 분기 및 ULEVELP_CONFIG.googleClientId 참조 (1.350791ms)
✔ D35 계정 전환(A→B) 시 ULDrive 인메모리 토큰 즉시 폐기 및 이전 실패 시 고아 파일 DELETE 정리 (NFR-SEC-3, 리뷰 4번) (0.92675ms)
✔ (a) public/: CSP meta·inline 스크립트·on*·style 속성 없음 (0.362958ms)
✔ (b) public/: 외부 스크립트는 정확한 버전 + SRI (0.066375ms)
✔ (c) public/: HTML에 끼우는 값은 esc 등 (0.027292ms)
✔ (d) public/: href·src 값은 safeUrl 등 (0.026791ms)
✔ (e) public/: eval·Function·문자열 setTimeout 없음 (0.033459ms)
✔ (f) public/: 비밀 값 모양 없음 (0.036125ms)
✔ (g) public/: 저장소 키는 ulp:/sb- 또는 옛 키 허용 목록 (0.027292ms)
✔ public/*.html 5개 이상을 실제로 읽었다 (0.091917ms)
✔ 허용 목록에 안 쓰이는 항목이 없다 (지운 코드의 허용 항목은 같이 뺀다) (0.251833ms)
✔ CSP 원문: 스크립트·스타일에 unsafe-* / 와일드카드 없음, object·base는 none (0.175791ms)
ℹ tests 72
ℹ suites 0
ℹ pass 72
ℹ fail 0
```

### 2.3 Playwright XSS E2E 테스트 (`npm run test:e2e`)

```text
Running 12 tests using 1 worker

  ✓  1 E1 첫 화면(index.html) 곡 목록 및 노션 바로가기 (578ms)
  ✓  2 E2 플레이어(practice.html) 곡 제목 및 곡 목록 서랍 (581ms)
  ✓  3 E3 기록 화면(log.html) 기록 탭·세션 목록·녹음 URL (593ms)
  ✓  4 E4 기록 화면(log.html#songs) 곡 보관함 탭 (511ms)
  ✓  5 E5 곡 상세 화면(log.html?song=...) 타임라인 및 A/B 비교 (589ms)
  ✓  6 E6 설정 화면(settings.html) 계정 프로필 표시 (536ms)
  ✓  7 E7 대조군(검출기 작동 확인) (682ms)
  ✓  8 E8 설정 화면(settings.html) 노션 백업 ZIP 미리보기 XSS 검사 (581ms)
  ✓  9 E9 설정 화면(settings.html) 외부 연동 키 상태·점검 결과 XSS 검사 (631ms)
  ✓  10 E10 학습 노트(notes.html) 및 노트 상세(note.html) XSS 페이로드 검사 (889ms)
  ✓  11 회귀 검증: note.html 조회 지연 중 계정 전환/로그아웃 시 이전 응답 무시 (K5-2 리뷰 1번) (744ms)
  ✓  12 회귀 검증: note.html 조회 지연 중 A -> B 계정 전환 시 이전 계정(A) 응답 무시 (K5-2 2차 리뷰) (501ms)

  12 passed (7.8s)
```

### 2.4 배포 스크립트 문법 검사 (`bash -n scripts/deploy-cloudrun.sh`)

```text
bash -n scripts/deploy-cloudrun.sh
(종료 코드 0, 문법 오류 없음)
```

### 2.5 Docker 빌드 & 컨테이너 스모크 테스트 & 13개 화면 CSP 검사

```text
$ docker build -t ulevelp-server:local .
[+] Building 72.4s (18/18) FINISHED

$ docker run -d --name ulevelp-test -p 3000:3000 ulevelp-server:local
47d4ef5fb09a67df253fafb1d489479e71ae7efe09617f70e01a3501ab3648b2

=== 1. Health check ===
$ curl -fsS http://127.0.0.1:3000/api/health
{"ok":true}

=== 2. Static root headers ===
$ curl -fsSI http://127.0.0.1:3000/
HTTP/1.1 200 OK
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Vary: Origin
Cache-Control: no-cache
Content-Security-Policy: frame-ancestors 'none'
Content-Length: 4052

=== 3. CSP check across 13 screens ===
$ node 개발산출물/자료/csp_check.js
브라우저: Chrome/134.0.6998.35 | 대상: http://localhost:3000/

[OK] 옛 키 복사(theme.js) (index.html)
[OK] 첫 화면 링크 붙여넣기 (index.html)
[OK] 첫 화면 비로그인 곡 안내 (index.html)
[OK] 코드 연습실 전체 탭 (chords.html)
[OK] 플레이어 + 유튜브 (practice.html?v=jNQXAC9IVRw)
  값: {"iframe":true,"title":"Me at the zoo","hasGis":true,"hasDrive":true}
[OK] 플레이어 비로그인 기기 저장 (practice.html?v=jNQXAC9IVRw)
[OK] 학습 노트 비로그인 (notes.html)
[OK] 학습 노트 상세 비로그인 안내 (note.html)
[OK] 기록 화면 비로그인 (log.html)
  값: {"guestVisible":true,"title":"Log","hasGis":true,"hasDrive":true}
[OK] 곡 상세 화면 비로그인 (log.html?song=...)
[OK] 개인정보처리방침 (privacy.html)
[OK] 설정 + 테마 버튼 (settings.html)
  값: {"theme":"light","saved":"light","old":null,"templateHref":"https://app.notion.com/p/4097a337e26f8167aa10eb435edb676e?source=copy_link","hasKeysSec":true,"hasDrivePanel":true,"hasGis":true,"hasDrive":true}
[OK] 대조군(막혀야 함) (index.html)
  CSP 위반: [ 'connect-src https://example.com/', 'style-src-attr inline' ]

화면 13개 중 실패 0개

=== 4. Cleanup ===
ulevelp-test
```

---

## 3. 실환경 배포 가이드 및 실기기 점검표 (사람 수행)

배포 자동화 스크립트(`scripts/deploy-cloudrun.sh`) 및 워크플로(`.github/workflows/deploy-cloudrun.yml`) 구현이 완료되었습니다. 실제 Google Cloud 환경 배포 및 기기 점검을 위해 아래 순서로 진행합니다.

### 3.1 사전 준비 (GCP 콘솔/CLI 및 GitHub 설정)

#### 1. Artifact Registry Docker 저장소 생성
스크립트 실행 전, 컨테이너 이미지를 저장할 Artifact Registry 저장소를 생성합니다:
```bash
gcloud artifacts repositories create ulevelp \
  --repository-format=docker \
  --location=asia-northeast3 \
  --description="ULevelP server container repository"
```

#### 2. Secret Manager 시크릿 등록
- `DATABASE_URL`: Cloud SQL 또는 Supabase PostgreSQL 연결 문자열 (`postgresql://user:pass@host:5432/db`)
- `SUPABASE_SECRET_KEY`: Supabase 스토리지 및 관리용 서비스 롤 시크릿 키
- `APP_MASTER_KEY`: 32바이트 Base64 암호화 마스터 키

#### 3. 서비스 계정 및 IAM 권한 구성
- **배포 실행 주체 (GitHub Actions 배포 SA 또는 로컬 gcloud 로그인 계정):**
  - `roles/run.admin`: Cloud Run 서비스·Job 배포 및 `setIamPolicy`(`--allow-unauthenticated`, `roles/run.developer` 바인딩)
  - `roles/iam.serviceAccountUser`: 런타임 SA 및 크론 SA를 리소스에 연결
  - `roles/cloudscheduler.admin`: Cloud Scheduler 크론 작업 생성 및 갱신
  - `roles/artifactregistry.writer`: Artifact Registry 이미지 빌드 및 푸시
- **런타임 서비스 계정 (`RUNTIME_SA_EMAIL`):**
  - `roles/secretmanager.secretAccessor`: Secret Manager 시크릿 접근
  - `roles/run.developer`: Cloud Run Job(`analyze`) 실행 권한 (`scripts/deploy-cloudrun.sh`가 자동 바인딩)
- **크론 호출 서비스 계정 (`CRON_SA_EMAIL`):**
  - `roles/run.invoker`: Cloud Run 서비스(`/internal/cron/notion-push`) 호출 권한

#### 4. GitHub Actions 워크플로 Repository Variables (`Settings > Secrets and variables > Actions > Variables`)
- `GCP_PROJECT_ID`: GCP 프로젝트 ID (설정 시 `deploy-cloudrun.yml` 자동 활성화)
- `GCP_REGION`: 리전 (기본: `asia-northeast3`)
- `GCP_WIF_PROVIDER`: Workload Identity Provider 리소스 경로
- `GCP_DEPLOY_SA`: 배포용 서비스 계정 이메일
- `RUNTIME_SA_EMAIL`: 런타임 서비스 계정 이메일
- `CRON_SA_EMAIL`: 크론 호출 서비스 계정 이메일
- `CLOUD_RUN_SERVICE`: 서비스 이름 (기본: `ulevelp`)
- `CLOUD_RUN_JOB`: 분석 Job 이름 (기본: `analyze`)
- `SUPABASE_URL`: Supabase 프로젝트 URL
- `PUBLIC_APP_URL`: 공개 앱 URL (기본: `https://hunseokc.github.io/ULevelP/`)
- `ALLOWED_ORIGINS`: CORS 허용 오리진 목록

---

### 3.2 로컬 또는 GitHub Actions에서 배포 실행

```bash
export GCP_PROJECT_ID="<your-gcp-project-id>"
export GCP_REGION="asia-northeast3"
export RUNTIME_SA_EMAIL="ulevelp-runtime@<project>.iam.gserviceaccount.com"
export CRON_SA_EMAIL="ulevelp-cron@<project>.iam.gserviceaccount.com"
export IMAGE_URI="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/ulevelp/server:latest"

# 1. 이미지 빌드 및 푸시
# Apple Silicon(arm64)에서는 Cloud Run용 amd64로 크로스 빌드해야 한다
docker buildx build --platform linux/amd64 -t "$IMAGE_URI" --push .

# 2. 스크립트 실행 (Job deploy, IAM 바인딩, 서비스 배포, Scheduler 자동 구성)
#    서버 env와 Cloud Scheduler audience가 FINAL_CRON_AUDIENCE로 완전 일치되어 401 오류가 방지됩니다.
bash scripts/deploy-cloudrun.sh "$IMAGE_URI"
```

---

### 3.3 사람 점검 체크리스트 (M-KZ1 ~ M-KZ5)

- [x] **M-KZ1:** Secret Manager 시크릿 등록 및 `scripts/deploy-cloudrun.sh` 실행으로 Cloud Run 서비스(`ulevelp`)와 Job(`analyze`) 배포 확인 (`CLOUD_RUN_ANALYZE_JOB_URI=https://run.googleapis.com/v2/projects/<project>/locations/<region>/jobs/analyze:run`).
- [x] **M-KZ2:** Cloud Scheduler `ulevelp-notion-push`(1분 주기, OIDC 인증) 생성 및 콘솔에서 수동 1회 실행 시 `200 OK` 확인.
- [x] **M-KZ3:** 배포된 Cloud Run 서비스 URL에서 `GET /api/health` → `200 {"ok":true}` 및 정적 루트(`/`)의 `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY` 헤더 확인.

#### M-KZ1 ~ M-KZ3 실환경 결과 (2026-11-02)

| 항목 | 값 |
| --- | --- |
| 프로젝트 / 리전 | `ulevelp` / `asia-northeast3` |
| 서비스 URL | `https://ulevelp-d5ympfsmfq-du.a.run.app` (결정적 URL `https://ulevelp-175439281655.asia-northeast3.run.app`도 200) |
| 이미지 / revision | `asia-northeast3-docker.pkg.dev/ulevelp/ulevelp/server:e296817` / `ulevelp-00003-5g8` |
| 런타임 SA / 크론 SA | `ulevelp-runtime@ulevelp.iam.gserviceaccount.com` / `ulevelp-cron@ulevelp.iam.gserviceaccount.com` |
| 사전 준비 | API `run`·`artifactregistry`·`cloudscheduler`·`iam` 활성화, SA 2개 생성, 런타임 SA에 시크릿 3개 `secretAccessor`, AR 저장소 `ulevelp` 생성 (배포 주체: Owner 계정 로컬 gcloud) |

```
# M-KZ1: bash scripts/deploy-cloudrun.sh .../server:e296817 → exit=0
Service [ulevelp] revision [ulevelp-00003-5g8] has been deployed and is serving 100 percent of traffic.
# M-KZ2: gcloud scheduler jobs run ulevelp-notion-push → 서비스 요청 로그
2026-11-02T12:43:42.406170Z	200	Google-Cloud-Scheduler
# 잘못된 입력(토큰 없음): POST /internal/cron/notion-push → HTTP 401 UNAUTHORIZED
# M-KZ3
GET /api/health → {"ok":true} HTTP 200
HEAD / → HTTP/2 200, x-frame-options: DENY, content-security-policy: frame-ancestors 'none', content-length: 4052
```
- [ ] **M-KZ4:** Cloud Run 서비스(또는 GitHub Pages)에서 Google 로그인 → 곡 저장 → 녹음 업로드/재생 → 노션 동기화 → Gemini 학습 노트 생성 정상 동작 확인.
- [ ] **M-KZ5:** 아이패드 Safari(또는 모바일 실기기)에서 플레이어 구간 반복, 녹음, 기록 달력, 코드 연습실, 학습 노트 뷰어 UI 깨짐 없이 정상 동작 확인.

---

## 4. 명세와 달라진 점 및 겪은 문제 (PR #31 리뷰 1~5번 반영)

- **명세와 달라진 점 (리뷰 피드백 반영):**
  1. **CRON_AUDIENCE 단일화 (리뷰 1번, 필수):** 서버 env(`CRON_AUDIENCE`)와 Cloud Scheduler의 `--oidc-token-audience`를 `FINAL_CRON_AUDIENCE` 단일 변수로 일치시켜, 커스텀 도메인이나 서비스 URL 지정 시 401 인증 불일치가 발생하지 않도록 개선함.
  2. **배포 주체 권한 및 사전 리소스 명시 (리뷰 2번, 필수):** 배포 SA에 필요한 `roles/run.admin`, `roles/iam.serviceAccountUser`, `roles/cloudscheduler.admin`, `roles/artifactregistry.writer` 권한 및 Artifact Registry 저장소 생성 명령, Repository Variables 목록을 문서화함.
  3. **첫 배포 2-Revision 생성 방지 (리뷰 3번, 권장):** 기존 URL이 없을 때만 배포 후 URL을 획득하여 1회 갱신하고, 재배포 시에는 기존 URL을 즉시 주입하여 불필요한 revision 재생성을 억제함.
  4. **Job 생성/갱신 명령 통합 (리뷰 4번, 권장):** `gcloud run jobs deploy` 명령을 적용하여 describe/create/update 조건 분기를 멱등한 단일 명령으로 간소화함.
  5. **배포 워크플로 보안 헤더 검증 추가 (리뷰 5번, 권장):** `.github/workflows/deploy-cloudrun.yml`의 스모크 테스트 단계에 `curl -fsSI "$SERVICE_URL/" | grep -i "frame-ancestors 'none'"`을 추가하여 Clickjacking 방어 헤더 자동 검증을 강화함.
- **겪은 문제 및 해결 (실환경 배포 중):**
  1. `gcloud run deploy --set-env-vars`가 `ALLOWED_ORIGINS`의 쉼표 때문에 `Bad syntax for dict arg`로 실패 → 구분자를 `^|^`로 변경(`@`는 SA 이메일과 겹쳐 불가). 커밋 `77c8af6`.
  2. Cloud Run에서 `HEAD /`가 502 → HEAD 분기가 `Content-Length`를 직접 붙인 뒤 빈 `respond`를 해 `Content-Length: 4052`, `0`이 중복으로 나감(로컬 curl은 허용, Google 프런트엔드는 거부). `OutgoingContent.NoContent`로 한 번만 내보내도록 수정하고 `ChordEngineTest` Z3 추가(수정 전 `expected: <[4052]> but was: <[4052, 0]>`로 실패 확인). 커밋 `e296817`.
  3. Apple Silicon에서 빌드한 이미지는 arm64라 Cloud Run에서 못 돈다 → `docker buildx build --platform linux/amd64` 사용.
