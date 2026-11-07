# R1-A1 결과 — PUBLIC_APP_URL을 Cloud Run으로 전환 (+ FX-1 운영 반영)

- **날짜:** 2026-11-04
- **근거:** `결과/R1_Pages처리결정.md` §4·§6, 진행 파일 R1-A1 행
- **RZ-M 6~8:** 아직 사용자 대기 중이지만, 사용자 지시로 R1-A1을 먼저 진행했다(env 하나라 되돌리기 쉬움)

## 1. 한 일

| 항목 | 값 |
| --- | --- |
| 이미지 | `asia-northeast3-docker.pkg.dev/ulevelp/ulevelp/server:693fc31` (main, PR #52 FX-1 포함) — digest `sha256:11c91f6027052c9144e1b2946e9e09d2bba48b35307fc74c88777a3383940946` |
| revision | `ulevelp-00004-9hc` → **`ulevelp-00005-48z`** |
| 바뀐 env | `PUBLIC_APP_URL`: `https://hunseokc.github.io/ULevelP/` → **`https://ulevelp-d5ympfsmfq-du.a.run.app/`** |
| 그대로인 env | `ULP_UI=spa`, `ALLOWED_ORIGINS=https://hunseokc.github.io`, `CRON_AUDIENCE=https://ulevelp-d5ympfsmfq-du.a.run.app`, `SUPABASE_URL`, `CRON_SA_EMAIL`, `CLOUD_RUN_ANALYZE_JOB_URI`, 시크릿 3개 |

배포 명령(Windows Git Bash에서 실행, Docker Desktop은 amd64라 `--platform` 그대로 둬도 됨):

```bash
IMAGE_URI=asia-northeast3-docker.pkg.dev/ulevelp/ulevelp/server:693fc31
docker buildx build --platform linux/amd64 -t "$IMAGE_URI" --push .
GCP_PROJECT_ID=ulevelp RUNTIME_SA_EMAIL=ulevelp-runtime@ulevelp.iam.gserviceaccount.com \
CRON_SA_EMAIL=ulevelp-cron@ulevelp.iam.gserviceaccount.com \
PUBLIC_APP_URL=https://ulevelp-d5ympfsmfq-du.a.run.app/ \
bash scripts/deploy-cloudrun.sh "$IMAGE_URI"
```

> **주의:** `deploy-cloudrun.sh`와 `deploy-cloudrun.yml`의 `PUBLIC_APP_URL` 기본값은 아직 Pages다. 다음 배포 때 `PUBLIC_APP_URL=…run.app/`를 빼먹으면 Pages로 되돌아간다.

## 2. 확인 (실측 출력, 2026-11-04 01:06~01:07Z)

```text
$ gcloud run services describe ulevelp … --format="value(status.latestReadyRevisionName,…image)"
ulevelp-00005-48z	asia-northeast3-docker.pkg.dev/ulevelp/ulevelp/server:693fc31
PUBLIC_APP_URL = https://ulevelp-d5ympfsmfq-du.a.run.app/
ULP_UI = spa
ALLOWED_ORIGINS = https://hunseokc.github.io

GET /api/health                         → {"ok":true} [200]
GET /practice.html?v=abc&t=10           → id="root" (React 화면, resumeUrl 대상 경로가 SPA에 있음)

POST /api/v1/songs (CORS, R-2 재확인)
  Origin https://ulevelp-d5ympfsmfq-du.a.run.app → 401
  Origin https://hunseokc.github.io → 401
  Origin https://evil.example.com → 403
  evil + X-Forwarded-Host 위조 → 403
```

**FX-1 운영 확인:** `ulevelp-00005-48z`, `severity>=ERROR AND timestamp>=01:05:00Z` → **0건**. 같은 시각 요청 로그는 403 두 건이 WARNING(요청 로그)으로만 남았다. 이전 revision에서는 같은 요청마다 `UnsupportedOperationException` ERROR가 2건씩 찍혔다(`결과/RZ-M_실환경점검.md` 발견 1).

```text
01:06:57.636Z WARNING 401 /api/v1/songs
01:06:57.891Z WARNING 401 /api/v1/songs
01:06:58.027Z WARNING 403 /api/v1/songs
01:06:58.268Z WARNING 403 /api/v1/songs
01:07:00.200Z INFO    200 /internal/cron/notion-push   ← 새 revision에서 크론 정상
```

## 3. 남은 확인 (사람)

- **노션 `연습 곡` 행 링크:** 노션 연결 계정으로 곡 하나를 연습(또는 수정)해 push를 일으킨 뒤, 그 행의 `이어서 연습` 링크가 `https://ulevelp-d5ympfsmfq-du.a.run.app/practice.html?v=…`인지 본다. `resumeUrl`은 응답·push 시점에 계산되므로 push 안 된 옛 행은 아직 Pages 링크다(→ R1-A2 이동 페이지가 처리)
- 앱 안에서도 확인 가능: 로그인 후 `GET /api/v1/songs` 응답의 `resumeUrl`이 run.app으로 시작

## 4. 되돌리기

```bash
gcloud run services update ulevelp --region asia-northeast3 --project ulevelp \
  --update-env-vars=PUBLIC_APP_URL=https://hunseokc.github.io/ULevelP/
```
