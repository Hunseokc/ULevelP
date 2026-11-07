# RZ-2 구현 명세 — 통합 Dockerfile + CI/CD 배포 전환 및 최종 검증

- **대상 Step:** RZ-2
- **작성일:** 2026-04-16
- **작성자:** 시니어 에이전트 (R3-0 단계)
- **기반 문서:** `개발산출물/개선사항_진행계획_구현_명세.md` (§5.1 RN-D10, §8 step RZ-2), `개발산출물/결과/R3-0_명세검토.md`, `개발산출물/명세/KZ-1_구현명세.md`
- **선행 조건:** Step R3-1 완료 (`PracticePage.tsx`, `LogPage.tsx`, `App.tsx`, `test/r3_practice_log.test.js` 모두 통과)

---

## 1. 파일 목록 (생성·수정·삭제할 정확한 경로)

| 구분 | 경로 | 설명 |
|---|---|---|
| **수정** | `frontend/index.html` | `public/spa.html`로 빌드될 때 `window.ULevelPConfig`, `window.supabase`, `window.google.accounts.oauth2` 및 `ULevelPAuth`·`ULevelPApi`·`ULevelPDrive` 전역이 정상 초기화되도록 `/config.js`, Supabase UMD(SRI 포함), Google GIS 스크립트 태그 추가 (`주니어_체크리스트.md` 80행 준수) |
| **수정** | `frontend/src/main.tsx` | React 앱 부트스트랩 시 `lib/auth`, `lib/apiClient`, `lib/drive` 모듈을 import하여 `window.ULevelPAuth`, `window.ULevelPApi`, `window.ULevelPDrive` 전역을 등록 |
| **수정** | `frontend/src/pages/HomePage.tsx` | `public/spa.html`이 `/index.html`을 대체하더라도 `csp_check.js` Page 1(Native DOM `el.value = ...; dispatchEvent(new Event('input'))`)이 `#goBtn`을 활성화하도록 `#goUrl`에 native `input` 리스너 보강 |
| **수정** | `Dockerfile` | `node:22-alpine`(`frontend-build`) + `eclipse-temurin:21-jdk-alpine`(`build`) + `eclipse-temurin:21-jre-alpine`(런타임) 3단계 멀티스테이지 빌드로 전환하고 React 빌드 산출물을 `/app/public/assets` 및 `/app/public/spa.html`로 복사 (`RN-D10`) |
| **수정** | `.github/workflows/deploy-cloudrun.yml` | `push: branches: [main]` 직접 트리거를 `workflow_run: workflows: ["CI"], types: [completed], branches: [main]` + `workflow_dispatch`로 전환하여 CI 통과 후에만 Cloud Run 배포가 실행되도록 개선 |
| **생성** | `test/rz2_deploy.test.js` | `RZ2-1`~`RZ2-4` 정적·통합 검증 테스트 (`Dockerfile` 3단계 멀티스테이지·`spa.html`·non-root, `deploy-cloudrun.yml` `workflow_run` 가드, `frontend/index.html` SDK 스크립트·SRI, `csp_check.js` 및 `xss.spec.js` 계약 검증) |
| **수정** | `개발산출물/진행_리액트및기능고도화.md` | RZ-2 상태를 `완료`로 갱신하고 전체 진행 완료 기록 |
| **생성** | `개발산출물/결과/RZ-2_최종통합및배포.md` | RZ-2 구현 및 최종 검증 결과 보고서 |

- **삭제 파일:** 없음 (`public/*.html`, `public/*.js` 레거시 파일은 E2E/Node 테스트 호환을 위해 삭제하지 않고 유지하되, 컨테이너 이미지에서는 `public/spa.html`이 Ktor SPA 라우팅 우선순위에 따라 서빙됨)

---

## 2. 시그니처 및 파일별 상세 구현 명세

### 2.1 `frontend/index.html` (수정 — 전체 코드)

`Dockerfile`에서 `/workspace/dist/index.html`이 `/app/public/spa.html`로 복사되면 Ktor(`Main.kt`)는 `/`, `/index.html`, `/practice.html`, `/chords.html`, `/settings.html`, `/log.html`, `/note.html`, `/privacy.html` 요청에 대해 `spa.html`을 우선 서빙한다. 이때 `window.ULevelPConfig`, Supabase JS SDK(SRI 포함), Google Identity Services(GIS) 스크립트가 로드되어야 로그인·동기화·Drive 백업 및 `csp_check.js` SRI 검사가 정상 동작한다.

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>음유시인 — 우쿨렐레 코드·타브·연습실</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;600;700;800;900&family=Plus+Jakarta+Sans:wght@600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet" />
</head>
<body>
  <div id="root"></div>
  <script src="/config.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js" integrity="sha384-Make+297791+216867+SupabasePlaceholderSRIHashForPinnedVersion21180==" crossorigin="anonymous"></script>
  <script src="https://accounts.google.com/gsi/client" async defer></script>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

---

### 2.2 `frontend/src/main.tsx` (수정 — 전체 코드)

`lib/auth`, `lib/apiClient`, `lib/drive`를 부트스트랩 시점에 import하여 `window.ULevelPAuth`, `window.ULevelPApi`, `window.ULevelPDrive` 전역 객체가 즉시 초기화되도록 보장한다.

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './lib/auth';
import './lib/apiClient';
import './lib/drive';
import './styles/tokens.css';

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
```

---

### 2.3 `frontend/src/pages/HomePage.tsx` (수정 — `#goUrl` native `input` 이벤트 동기화 보강)

`개발산출물/자료/csp_check.js` Page 1 점검은 `el.value = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'; el.dispatchEvent(new Event('input', { bubbles: true }))` 형태로 native DOM value를 직접 변경한다. React 18의 controlled `<input>`은 `HTMLInputElement.prototype.value` setter를 오버라이드하므로 단순 `el.value = ...` 호출 시 React `onChange`가 발화하지 않을 수 있다. 이를 방지하기 위해 `HomePage.tsx`에서 `goUrlRef`에 native `input` 이벤트 리스너를 등록하여 `el.value` 변경 시에도 `urlInput` state와 `#goBtn.disabled`가 즉시 갱신되도록 보강한다.

- `HomePage.tsx` 내 추가·수정 포인트:
  1. `import React, { useState, useEffect, useCallback, useRef } from 'react';`로 `useRef` 추가
  2. 컴포넌트 상단에 `const goUrlRef = useRef<HTMLInputElement | null>(null);` 선언
  3. `useEffect` 추가:
     ```tsx
     useEffect(() => {
       const el = goUrlRef.current;
       if (!el) return;
       const handleNativeInput = (e: Event) => {
         const target = e.target as HTMLInputElement | null;
         if (target && typeof target.value === 'string') {
           setUrlInput(target.value);
         }
       };
       el.addEventListener('input', handleNativeInput);
       return () => el.removeEventListener('input', handleNativeInput);
     }, []);
     ```
  4. `#goUrl` `<input>`에 `ref={goUrlRef}` 속성 추가

---

### 2.4 `Dockerfile` (수정 — 전체 코드)

`RN-D10` 및 `KZ-1` 보안/운영 규칙(Alpine 멀티스테이지, `app` 비루트 계정, `MaxRAMPercentage=75.0`, `PORT=3000`, `/health` 헬스체크)을 모두 준수하는 3단계 멀티스테이지 `Dockerfile`이다.

```dockerfile
# Stage 1: React (Vite + TypeScript) 프론트엔드 빌드
FROM node:22-alpine AS frontend-build
WORKDIR /workspace

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts ./
COPY frontend ./frontend
RUN npm run build

# Stage 2: Kotlin (Ktor) 백엔드 빌드
FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /workspace

COPY gradlew settings.gradle.kts build.gradle.kts ./
COPY gradle ./gradle
RUN chmod +x ./gradlew && ./gradlew dependencies --no-daemon

COPY src ./src
RUN ./gradlew installDist --no-daemon

# Stage 3: 경량 JRE 런타임 + 정적 자산 통합
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY --from=build /workspace/build/install/ulevelp/lib ./lib
COPY public ./public
COPY --from=frontend-build /workspace/dist/assets ./public/assets
COPY --from=frontend-build /workspace/dist/index.html ./public/spa.html

RUN chown -R app:app /app
USER app

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/health || exit 1

CMD ["java", "-XX:MaxRAMPercentage=75.0", "-cp", "/app/lib/*", "ulevelp.MainKt"]
```

- **동작 원리:**
  - 로컬/CI에서 `npm test` 또는 `./gradlew test`를 실행할 때는 호스트의 `public/spa.html`이 없으므로 `Main.kt`가 기존의 `public/index.html`, `public/practice.html` 등을 그대로 서빙하거나 Vite 빌드 후 테스트할 수 있다.
  - Docker 이미지 빌드 시에는 Stage 1(`frontend-build`)에서 생성된 `/workspace/dist/index.html`이 `/app/public/spa.html`로, `/workspace/dist/assets`가 `/app/public/assets`로 복사된다.
  - `Main.kt`의 `serveSpaOrFallback`은 `File(publicDir, "spa.html")`이 존재하면 모든 HTML 진입 라우트(`/`, `/index.html`, `/practice.html`, `/chords.html`, `/settings.html`, `/log.html`, `/note.html`, `/privacy.html`)에 `spa.html`을 서빙하고, `/assets/*`, `/lib/*`, `/config.js`, `/data.js` 등은 `public/` 하위 정적 파일로 서빙한다.

---

### 2.5 `.github/workflows/deploy-cloudrun.yml` (수정 — 전체 코드)

기존 `on: push: branches: [main]` 트리거를 `workflow_run` 트리거로 변경하여 **`CI` 워크플로우가 `main` 브랜치에서 `success`로 완료된 경우에만** 배포가 실행되도록 강제한다. 수동 배포(`workflow_dispatch`)도 그대로 지원하며, `workflow_run` 실행 시에는 `github.event.workflow_run.head_sha` 커밋을 정확히 체크아웃하고 이미지 태그로 사용한다.

```yaml
name: Deploy to Cloud Run

on:
  workflow_run:
    workflows: ["CI"]
    types:
      - completed
    branches:
      - main
  workflow_dispatch:

permissions:
  contents: read
  id-token: write

env:
  SERVICE_NAME: ulevelp
  GCP_REGION: ${{ vars.GCP_REGION || 'asia-northeast3' }}
  AR_REPO: ${{ vars.AR_REPO || 'ulevelp' }}

jobs:
  deploy:
    name: Build & Deploy Container to Cloud Run
    runs-on: ubuntu-latest
    if: >-
      vars.GCP_PROJECT_ID != '' &&
      (
        github.event_name == 'workflow_dispatch' ||
        (
          github.event_name == 'workflow_run' &&
          github.event.workflow_run.conclusion == 'success' &&
          github.event.workflow_run.event != 'pull_request'
        )
      )
    steps:
      - name: Checkout repository at verified commit
        uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_sha || github.sha }}

      - name: Determine target commit SHA
        id: meta
        run: |
          TARGET_SHA="${{ github.event.workflow_run.head_sha || github.sha }}"
          echo "sha=${TARGET_SHA}" >> "$GITHUB_OUTPUT"

      - name: Authenticate to Google Cloud (Workload Identity Federation)
        if: vars.GCP_WORKLOAD_IDENTITY_PROVIDER != ''
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ vars.GCP_WORKLOAD_IDENTITY_PROVIDER }}
          service_account: ${{ vars.GCP_SERVICE_ACCOUNT }}

      - name: Authenticate to Google Cloud (Service Account JSON Fallback)
        if: vars.GCP_WORKLOAD_IDENTITY_PROVIDER == '' && secrets.GCP_SA_KEY != ''
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Configure Docker for Artifact Registry
        run: gcloud auth configure-docker "${{ env.GCP_REGION }}-docker.pkg.dev" --quiet

      - name: Build & Push Docker Image
        env:
          IMAGE_URI: ${{ env.GCP_REGION }}-docker.pkg.dev/${{ vars.GCP_PROJECT_ID }}/${{ env.AR_REPO }}/${{ env.SERVICE_NAME }}:${{ steps.meta.outputs.sha }}
          IMAGE_LATEST: ${{ env.GCP_REGION }}-docker.pkg.dev/${{ vars.GCP_PROJECT_ID }}/${{ env.AR_REPO }}/${{ env.SERVICE_NAME }}:latest
        run: |
          docker build -t "$IMAGE_URI" -t "$IMAGE_LATEST" .
          docker push "$IMAGE_URI"
          docker push "$IMAGE_LATEST"

      - name: Deploy to Cloud Run
        id: deploy
        uses: google-github-actions/deploy-cloudrun@v2
        with:
          service: ${{ env.SERVICE_NAME }}
          region: ${{ env.GCP_REGION }}
          image: ${{ env.GCP_REGION }}-docker.pkg.dev/${{ vars.GCP_PROJECT_ID }}/${{ env.AR_REPO }}/${{ env.SERVICE_NAME }}:${{ steps.meta.outputs.sha }}
          flags: >-
            --allow-unauthenticated
            --port=3000
            --cpu=1
            --memory=512Mi
            --min-instances=0
            --max-instances=5
            --concurrency=80
            --timeout=60s
          env_vars: |
            NODE_ENV=production
            APP_ORIGIN=${{ vars.APP_ORIGIN }}
            SUPABASE_URL=${{ vars.SUPABASE_URL }}
            SUPABASE_ANON_KEY=${{ secrets.SUPABASE_ANON_KEY }}
            SUPABASE_JWT_SECRET=${{ secrets.SUPABASE_JWT_SECRET }}
            GOOGLE_CLIENT_ID=${{ vars.GOOGLE_CLIENT_ID }}
            GCS_TAKE_BUCKET=${{ vars.GCS_TAKE_BUCKET }}

      - name: Smoke Test (/health & /config.js)
        run: |
          SERVICE_URL="${{ steps.deploy.outputs.url }}"
          echo "Deployed URL: ${SERVICE_URL}"
          curl -fsS --retry 5 --retry-delay 3 "${SERVICE_URL}/health" | grep -q '"ok":true'
          curl -fsS "${SERVICE_URL}/config.js" | grep -q 'window.ULevelPConfig'
```

---

### 2.6 GCP Workload Identity Federation (WIF) 설정 절차 명세 (`결과/RZ-2_최종통합및배포.md` 수록용)

외부 GCP 콘솔/CLI 작업이 필요한 항목은 저장소 변수 가드(`vars.GCP_PROJECT_ID != ''`)로 안전하게 보호되어 있으며, 운영자가 아래 명령어로 WIF Pool/Provider 및 서비스 계정을 1회 구성할 수 있도록 `개발산출물/결과/RZ-2_최종통합및배포.md`에 수록한다:

```bash
# 1. 변수 설정
export PROJECT_ID="your-gcp-project-id"
export PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
export GITHUB_REPO="hunseokc/ULevelP"
export REGION="asia-northeast3"
export SA_NAME="ulevelp-deployer"

# 2. 배포용 서비스 계정 생성 및 최소 권한 부여
gcloud iam service-accounts create "${SA_NAME}" \
  --project="${PROJECT_ID}" \
  --display-name="ULevelP Cloud Run Deployer"

for ROLE in roles/run.admin roles/artifactregistry.writer roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="${ROLE}"
done

# 3. Workload Identity Pool & GitHub OIDC Provider 생성
gcloud iam workload-identity-pools create "github-pool" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --display-name="GitHub Actions Pool"

gcloud iam workload-identity-pools providers create-oidc "github-provider" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --workload-identity-pool="github-pool" \
  --display-name="GitHub Actions OIDC" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository == '${GITHUB_REPO}'" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# 4. GitHub 저장소에 서비스 계정 가장(impersonation) 권한 바인딩
gcloud iam service-accounts add-iam-policy-binding \
  "${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --project="${PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/attribute.repository/${GITHUB_REPO}"
```

---

## 3. DTO / 환경 변수·시크릿 매핑 표

| 구분 | 이름 | 필수 여부 | 주입 위치 | 설명 |
|---|---|---|---|---|
| GitHub Variable | `GCP_PROJECT_ID` | 필수 (미설정 시 배포 Job 자동 Skip) | `deploy-cloudrun.yml` | GCP 프로젝트 ID |
| GitHub Variable | `GCP_REGION` | 선택 (기본값 `asia-northeast3`) | `deploy-cloudrun.yml` | Cloud Run 및 Artifact Registry 리전 |
| GitHub Variable | `AR_REPO` | 선택 (기본값 `ulevelp`) | `deploy-cloudrun.yml` | Artifact Registry 저장소 이름 |
| GitHub Variable | `GCP_WORKLOAD_IDENTITY_PROVIDER` | 권장 | `deploy-cloudrun.yml` | `projects/<NUM>/locations/global/workloadIdentityPools/github-pool/providers/github-provider` |
| GitHub Variable | `GCP_SERVICE_ACCOUNT` | 권장 | `deploy-cloudrun.yml` | `ulevelp-deployer@<PROJECT_ID>.iam.gserviceaccount.com` |
| GitHub Variable | `APP_ORIGIN` | 권장 | Cloud Run `env_vars` | 배포 도메인 Origin (CORS 허용 목록) |
| GitHub Variable | `SUPABASE_URL` | 권장 | Cloud Run `env_vars` | Supabase 프로젝트 URL (`/config.js` 동적 주입) |
| GitHub Variable | `GOOGLE_CLIENT_ID` | 권장 | Cloud Run `env_vars` | Google OAuth 2.0 Web Client ID (`/config.js` 동적 주입) |
| GitHub Variable | `GCS_TAKE_BUCKET` | 선택 | Cloud Run `env_vars` | 기본 녹음 저장소용 GCS 버킷 |
| GitHub Secret | `SUPABASE_ANON_KEY` | 권장 | Cloud Run `env_vars` | Supabase Anon Key (`/config.js` 동적 주입) |
| GitHub Secret | `SUPABASE_JWT_SECRET` | 권장 | Cloud Run `env_vars` | Ktor HS256 JWT 서명 검증 시크릿 |
| GitHub Secret | `GCP_SA_KEY` | 선택 (WIF 미사용 시 폴백) | `deploy-cloudrun.yml` | 서비스 계정 JSON 키 |

---

## 4. 검증·에러 표

| 검증 항목 | 조건 | 실패 시 동작 |
|---|---|---|
| CI 미통과 커밋 배포 차단 | `github.event.workflow_run.conclusion != 'success'` 또는 `event == 'pull_request'` | `deploy` Job이 `Skipped` 처리되어 실패한 빌드나 PR 브랜치가 프로덕션에 배포되지 않음 |
| GCP 미구성 저장소 보호 | `vars.GCP_PROJECT_ID == ''` | 워크플로우 에러 대신 `deploy` Job을 정상 Skip 처리 |
| Docker 빌드 시 타입/번들 오류 | `npm run build` (`tsc --noEmit && vite build`) 실패 또는 `./gradlew installDist` 실패 | Stage 1 또는 Stage 2에서 즉시 non-zero 종료되어 이미지 생성 및 배포 중단 |
| 컨테이너 런타임 헬스체크 | `/health`가 200 JSON(`{"ok":true}`)을 반환하지 않음 | Docker `HEALTHCHECK` 및 배포 직후 `curl` 스모크 테스트 실패로 리비전 전환 차단 |
| CSP / 인라인 스타일 / XSS 회귀 | `csp_check.js`, `test/e2e/xss.spec.js`, `npm test` 중 1개라도 실패 | CI 워크플로우 실패로 `deploy-cloudrun.yml` 트리거 차단 |

---

## 5. 처리 순서

1. `frontend/index.html`에 `/config.js`, Supabase UMD(SRI 포함), Google GIS 스크립트 태그를 추가한다.
2. `frontend/src/main.tsx`에 `./lib/auth`, `./lib/apiClient`, `./lib/drive` import를 추가한다.
3. `frontend/src/pages/HomePage.tsx`의 `#goUrl`에 `useRef` 기반 native `input` 이벤트 리스너를 추가한다.
4. `Dockerfile`을 3단계 멀티스테이지 빌드(`node:22-alpine` -> `eclipse-temurin:21-jdk-alpine` -> `eclipse-temurin:21-jre-alpine`)로 업데이트한다.
5. `.github/workflows/deploy-cloudrun.yml`을 `workflow_run` + `workflow_dispatch` 트리거 및 `head_sha` 체크아웃 구조로 업데이트한다.
6. `test/rz2_deploy.test.js`를 작성하여 `RZ2-1`~`RZ2-4`를 검증한다.
7. `npm test`를 실행하여 기존 테스트 + `test/r3_practice_log.test.js` + `test/rz2_deploy.test.js`가 모두 통과하는지 확인한다 (`node_modules` 및 브라우저가 설치된 환경에서는 `npm run build`, `./gradlew test`, `node 개발산출물/자료/csp_check.js`, `npx playwright test`까지 실행).
8. `개발산출물/결과/RZ-2_최종통합및배포.md`를 작성하고 `개발산출물/진행_리액트및기능고도화.md`의 `RZ-2` 상태를 `완료`로 갱신한다.

---

## 6. 테스트 케이스 표 (`test/rz2_deploy.test.js`)

| ID | 대상 | 입력 / 시나리오 | 기대 결과 |
|---|---|---|---|
| `RZ2-1` | `Dockerfile` 멀티스테이지 & 보안 구성 | `Dockerfile` 정적 분석 | 1) `FROM node:22-alpine AS frontend-build` 및 `RUN npm ci`, `RUN npm run build` 존재<br>2) `FROM eclipse-temurin:21-jdk-alpine AS build` 및 `./gradlew installDist` 존재<br>3) `FROM eclipse-temurin:21-jre-alpine` 런타임 스테이지에서 `/workspace/dist/assets` -> `./public/assets`, `/workspace/dist/index.html` -> `./public/spa.html` 복사<br>4) `USER app` 비루트 실행, `HEALTHCHECK` `/health`, `-XX:MaxRAMPercentage=75.0` 유지 |
| `RZ2-2` | `.github/workflows/deploy-cloudrun.yml` `workflow_run` 가드 | 워크플로우 YAML 정적 분석 | 1) `workflow_run:` 트리거에 `workflows: ["CI"]`, `types: [completed]`, `branches: [main]` 존재<br>2) `deploy` Job `if:` 조건에 `vars.GCP_PROJECT_ID != ''`, `github.event.workflow_run.conclusion == 'success'`, `github.event.workflow_run.event != 'pull_request'` 포함<br>3) `actions/checkout@v4`에 `ref: ${{ github.event.workflow_run.head_sha || github.sha }}` 지정<br>4) WIF(`google-github-actions/auth@v2`) 및 `/health`·`/config.js` 스모크 테스트 유지 |
| `RZ2-3` | `frontend/index.html` & `frontend/src/main.tsx` 통합 | React 엔트리 HTML/TSX 정적 분석 | 1) `frontend/index.html`에 `<script src="/config.js"></script>`, `supabase-js@2.118.0` (`integrity="sha384-..."`, `crossorigin="anonymous"`), `https://accounts.google.com/gsi/client` 포함<br>2) `frontend/src/main.tsx`에서 `./lib/auth`, `./lib/apiClient`, `./lib/drive`를 import<br>3) `frontend/src/pages/HomePage.tsx`에서 `#goUrl`에 native `input` 리스너(`addEventListener('input', ...)`) 등록 |
| `RZ2-4` | 전체 React 페이지 CSP/인라인 스타일/XSS 무결성 | `frontend/src/**/*.tsx` 및 `public/*.html`, `public/*.js` 전체 스캔 | 1) `frontend/src` 전체 파일에서 `style={{`, `dangerouslySetInnerHTML`, `.innerHTML =`, `eval(` 0건<br>2) `App.tsx`가 7개 페이지(`HomePage`, `PracticePage`, `ChordsPage`, `SettingsPage`, `LogPage`, `NoteDetailPage`, `PrivacyPage`)를 모두 라우팅하고 `coming-soon` 플레이스홀더가 0건<br>3) `csp_check.js`가 요구하는 10개 시나리오 핵심 ID(`#goUrl`, `#goBtn`, `#barFill`, `#barLoop`, `#chord-modal`, `#abAudioA`, `#abAudioB`, `#pane-song-detail`, `#noteBody`)가 React 컴포넌트와 `public/*.html` 양쪽에 모두 존재 |

### `test/rz2_deploy.test.js` 전체 구현 코드

```javascript
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function listFiles(dir, extFilter) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, extFilter));
    else if (!extFilter || extFilter.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

describe('RZ2-1: Dockerfile 3단계 멀티스테이지 빌드 및 런타임 보안 검증', () => {
  test('node:22-alpine 프론트엔드 빌드 + temurin JDK 빌드 + temurin JRE 런타임 스테이지를 포함한다', () => {
    const dockerfile = read('Dockerfile');
    assert.match(dockerfile, /FROM\s+node:22-alpine\s+AS\s+frontend-build/);
    assert.match(dockerfile, /RUN\s+npm\s+ci/);
    assert.match(dockerfile, /RUN\s+npm\s+run\s+build/);
    assert.match(dockerfile, /FROM\s+eclipse-temurin:21-jdk-alpine\s+AS\s+build/);
    assert.match(dockerfile, /installDist\s+--no-daemon/);
    assert.match(dockerfile, /FROM\s+eclipse-temurin:21-jre-alpine/);
    assert.match(dockerfile, /COPY\s+--from=frontend-build\s+\/workspace\/dist\/assets\s+\.\/public\/assets/);
    assert.match(dockerfile, /COPY\s+--from=frontend-build\s+\/workspace\/dist\/index\.html\s+\.\/public\/spa\.html/);
    assert.match(dockerfile, /USER\s+app/);
    assert.match(dockerfile, /HEALTHCHECK[\s\S]*\/health/);
    assert.match(dockerfile, /-XX:MaxRAMPercentage=75\.0/);
  });
});

describe('RZ2-2: deploy-cloudrun.yml workflow_run 트리거 및 배포 가드 검증', () => {
  test('CI 성공 후에만 실행되도록 workflow_run 트리거와 conclusion == success 가드를 갖는다', () => {
    const wf = read('.github/workflows/deploy-cloudrun.yml');
    assert.match(wf, /workflow_run:/);
    assert.match(wf, /workflows:\s*\["CI"\]/);
    assert.match(wf, /types:\s*\n\s*-\s*completed/);
    assert.match(wf, /workflow_dispatch:/);
    assert.match(wf, /vars\.GCP_PROJECT_ID\s*!=\s*''/);
    assert.match(wf, /github\.event\.workflow_run\.conclusion\s*==\s*'success'/);
    assert.match(wf, /github\.event\.workflow_run\.event\s*!=\s*'pull_request'/);
    assert.match(wf, /ref:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\|\|\s*github\.sha\s*\}\}/);
    assert.match(wf, /google-github-actions\/auth@v2/);
    assert.match(wf, /google-github-actions\/deploy-cloudrun@v2/);
    assert.match(wf, /\/health/);
    assert.match(wf, /\/config\.js/);
  });
});

describe('RZ2-3: frontend/index.html SDK 스크립트 및 main.tsx 전역 초기화 검증', () => {
  test('frontend/index.html에 /config.js, Supabase UMD(SRI 포함), Google GIS 스크립트가 포함된다', () => {
    const html = read('frontend/index.html');
    assert.match(html, /<script\s+src="\/config\.js"><\/script>/);
    assert.match(html, /@supabase\/supabase-js@2\.118\.0\/dist\/umd\/supabase\.js/);
    assert.match(html, /integrity="sha384-[^"]+"/);
    assert.match(html, /crossorigin="anonymous"/);
    assert.match(html, /https:\/\/accounts\.google\.com\/gsi\/client/);
  });

  test('frontend/src/main.tsx가 auth, apiClient, drive 모듈을 부트스트랩한다', () => {
    const mainTsx = read('frontend/src/main.tsx');
    assert.match(mainTsx, /import\s+['"]\.\/lib\/auth['"]/);
    assert.match(mainTsx, /import\s+['"]\.\/lib\/apiClient['"]/);
    assert.match(mainTsx, /import\s+['"]\.\/lib\/drive['"]/);
  });

  test('HomePage.tsx가 #goUrl에 native input 이벤트 리스너를 등록한다', () => {
    const homeTsx = read('frontend/src/pages/HomePage.tsx');
    assert.match(homeTsx, /addEventListener\(\s*['"]input['"]/);
  });
});

describe('RZ2-4: 전체 React 페이지 CSP/인라인 스타일 금지 및 전체 라우트 전환 완료 검증', () => {
  test('frontend/src 하위 모든 파일에 금지 패턴(style={{, dangerouslySetInnerHTML, innerHTML, eval)이 없다', () => {
    const files = listFiles(path.join(ROOT, 'frontend/src'), ['.ts', '.tsx']);
    assert.ok(files.length >= 15);
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      const rel = path.relative(ROOT, file);
      assert.ok(!src.includes('style={{'), `${rel}: style={{ 금지`);
      assert.ok(!src.includes('dangerouslySetInnerHTML'), `${rel}: dangerouslySetInnerHTML 금지`);
      assert.ok(!/\.innerHTML\s*=/.test(src), `${rel}: innerHTML 대입 금지`);
      assert.ok(!/\beval\s*\(/.test(src), `${rel}: eval 호출 금지`);
    }
  });

  test('App.tsx가 7개 페이지를 모두 라우팅하고 coming-soon 플레이스홀더가 남아있지 않다', () => {
    const appTsx = read('frontend/src/App.tsx');
    assert.ok(!appTsx.includes('coming-soon'), 'App.tsx에 coming-soon 플레이스홀더가 없어야 함');
    for (const pageName of ['HomePage', 'PracticePage', 'ChordsPage', 'SettingsPage', 'LogPage', 'NoteDetailPage', 'PrivacyPage']) {
      assert.ok(appTsx.includes(pageName), `App.tsx에 ${pageName} 라우팅이 포함되어야 함`);
    }
  });
});
```

---

## 7. 체크리스트 (`개발산출물/주니어_체크리스트.md` 준수)

- [ ] `frontend/index.html`에 `/config.js`, Supabase UMD(`@supabase/supabase-js@2.118.0`, `integrity="sha384-..."`, `crossorigin="anonymous"`), Google GIS(`https://accounts.google.com/gsi/client`) 스크립트 태그가 모두 포함되었는가? (`주니어_체크리스트.md` 80행)
- [ ] `frontend/src/main.tsx`가 `./lib/auth`, `./lib/apiClient`, `./lib/drive`를 import하여 전역 API를 초기화하는가?
- [ ] `Dockerfile`이 `node:22-alpine` -> `eclipse-temurin:21-jdk-alpine` -> `eclipse-temurin:21-jre-alpine` 3단계 멀티스테이지 빌드를 사용하고 `/workspace/dist/index.html`을 `./public/spa.html`로 복사하는가?
- [ ] `.github/workflows/deploy-cloudrun.yml`이 `workflow_run`(`CI` 성공 조건)으로 전환되었으며 `github.event.workflow_run.head_sha`를 체크아웃하는가?
- [ ] `npm test` 실행 시 기존 테스트 + `test/r3_practice_log.test.js` + `test/rz2_deploy.test.js`가 모두 통과하는가?

---

## 8. 결과 파일 안내

- 작업 완료 후 **`개발산출물/결과/RZ-2_최종통합및배포.md`**를 생성하고 다음 내용을 기록한다:
  1. 변경/생성한 파일 목록과 요약
  2. `Dockerfile` 3단계 멀티스테이지 구조 및 Ktor `spa.html` 서빙 검증 결과
  3. `.github/workflows/deploy-cloudrun.yml` `workflow_run` 전환 및 GCP WIF 설정 명령어 안내
  4. `test/rz2_deploy.test.js` (`RZ2-1`~`RZ2-4`) 및 전체 테스트 스위트 실행 결과
- 또한 **`개발산출물/진행_리액트및기능고도화.md`**에서 `RZ-2` 상태를 `완료`로 갱신한다.

---

## 9. 금지 사항 (`개발산출물/협업_시니어주니어.md` §4 및 `주니어_체크리스트.md`)

1. **CSP `unsafe-inline` 추가 금지:** `Main.kt`나 `server.js`의 `script-src` 또는 `style-src`에 `'unsafe-inline'`을 절대 추가하지 마라.
2. **시크릿 하드코딩 금지:** `Dockerfile`, `deploy-cloudrun.yml`, `frontend/index.html` 어디에도 실제 프로젝트 ID, 서비스 계정 키, Supabase 시크릿을 하드코딩하지 마라.
3. **`public/*.html` 레거시 파일 임의 삭제 금지:** `test/security.test.js`가 `public/index.html`, `public/practice.html` 등의 파일을 직접 읽으므로 레거시 정적 파일은 삭제하지 말고 유지하라.
