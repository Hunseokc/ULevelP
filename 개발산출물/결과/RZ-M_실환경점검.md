# 결과: RZ-M — Cloud Run 실환경 점검 (RZ-3·CORS 배포 후)

- **수행일:** 2026-11-03
- **근거:** `명세/RZ-M_점검항목.md`
- **배포:** main `0520915`(PR #45·#46 머지) → 이미지 `asia-northeast3-docker.pkg.dev/ulevelp/ulevelp/server:0520915`(digest `sha256:088617a5…eebc5`) → revision **`ulevelp-00004-9hc`** (이전 `ulevelp-00003-5g8`, 이미지 `e296817`)
- **상태:** 항목 1~5·9 **통과**. 항목 6·7(브라우저·아이패드)·8(롤백) **사용자 수행 대기**

## 항목별 결과

| # | 항목 | 결과 | 판정 |
| --- | --- | --- | --- |
| 1 | 배포 | main 워크트리에서 `docker buildx build --platform linux/amd64 … --push` exit 0(1분 46초) → `bash scripts/deploy-cloudrun.sh …:0520915` exit 0, `Service [ulevelp] revision [ulevelp-00004-9hc] has been deployed and is serving 100 percent of traffic.` Job `analyze`·Scheduler도 갱신 | 통과 |
| 2 | 반영 확인 | 이미지 `server:0520915`, `ULP_UI=spa`, `ALLOWED_ORIGINS=https://hunseokc.github.io`(localhost 빠짐), `PUBLIC_APP_URL=https://hunseokc.github.io/ULevelP/`(R1 결정대로 아직 그대로), `CRON_AUDIENCE=https://ulevelp-d5ympfsmfq-du.a.run.app` | 통과 |
| 3 | React 서빙·헤더 | `/api/health` → `{"ok":true}`, `/`의 `id="root"` **1**(배포 전 0), `notes.html` 헤더 `x-frame-options: DENY`·`cache-control: no-cache`·`content-security-policy: frame-ancestors 'none'`, `/unknown.html` → 404 | 통과 |
| 4 | CORS (R-2) | `POST /api/v1/songs`: 같은 출처 **401**(배포 전 403), `hunseokc.github.io` 401, `evil.example.com` 403, evil + `X-Forwarded-Host: evil.example.com` 403 | 통과 |
| 5 | 크론 | `gcloud scheduler jobs run` 14:42:52Z → `/internal/cron/notion-push` 200(`ulevelp-00004-9hc`), 이후 1분 주기 14:43:01Z 200 | 통과 |
| 6 | M-KZ4 데스크톱 전 흐름 | — | **사용자 수행 대기** |
| 6-1 | Drive 미연결 1곡 제한 | — | **사용자 수행 대기** |
| 7 | M-KZ5 아이패드 Safari | — | **사용자 수행 대기** |
| 8·8-1 | 롤백 `ULP_UI=legacy` → `spa` | 이번 세션에서 실행이 권한 거부(자동 모드 분류기)로 막힘. 운영은 `ulevelp-00004-9hc`, `id="root"` 1 그대로 확인 | **사용자 수행 대기** |
| 9 | ERROR 로그 | 점검 중 ERROR 2건. 아래 **발견 1** — 이번 배포 때문이 아니다(배포 전 revision에도 같은 예외) | 통과(기존 문제 기록) |

### 명령 출력 (항목 2~4, `rzm_check.sh`)
```
== 2 배포 반영
asia-northeast3-docker.pkg.dev/ulevelp/ulevelp/server:0520915	ulevelp-00004-9hc
  PUBLIC_APP_URL = https://hunseokc.github.io/ULevelP/
  ALLOWED_ORIGINS = https://hunseokc.github.io
  CRON_AUDIENCE = https://ulevelp-d5ympfsmfq-du.a.run.app
  ULP_UI = spa
== 3 React 서빙·보안 헤더
health: {"ok":true}
id=root: 1
x-frame-options: DENY
cache-control: no-cache
content-security-policy: frame-ancestors 'none'
unknown.html: 404
== 4 CORS POST /api/v1/songs
  Origin https://ulevelp-d5ympfsmfq-du.a.run.app → 401
  Origin https://hunseokc.github.io → 401
  Origin https://evil.example.com → 403
  evil + X-Forwarded-Host 위조 → 403
```

## 발견 1 — CORS 거부(403) 요청마다 서버 ERROR 로그
- **문제:** 다른 출처 요청을 CORS가 403으로 거부할 때마다 `java.lang.UnsupportedOperationException: Headers can no longer be set because response was already completed`가 ERROR로 찍힌다(`ApiError.kt:56` ← `Main.kt:254` StatusPages `ApiException` 핸들러)
- **근거:** 14:42:38Z evil Origin POST 403 2건과 같은 시각에 2건(`ulevelp-00004-9hc`). 배포 전 14:27:10Z 같은 실측 때도 `ulevelp-00003-5g8`에서 2건 → 기존 문제
- **원인(추정, 미검증):** CORS 플러그인이 403 응답을 보낸 뒤에도 파이프라인이 라우트까지 진행해 인증에서 `ApiException`(401)이 나고, StatusPages가 이미 끝난 응답에 `Cache-Control`을 붙이다 실패한다. 클라이언트가 받는 응답은 403으로 정상
- **영향:** 지금은 로그 잡음. 다만 "CORS 거부 뒤에도 라우트 코드가 실행된다"가 맞으면 거부된 요청의 부수 효과 여부를 확인해야 한다
- **추천:** 별도 fix step — Ktor 테스트로 "다른 출처 POST에서 라우트 본문 미실행 + ERROR 없음"을 재현한 뒤 수정(예: 응답이 이미 끝났으면 `respondApiError`를 건너뛴다). 대안: CORS 거부 뒤 파이프라인을 끝내도록 플러그인 순서·처리 확인

## 사용자 수행 방법 (6·7·8)
- **6·6-1·7:** `명세/RZ-M_점검항목.md` 표 그대로, 대상 `https://ulevelp-d5ympfsmfq-du.a.run.app`. 실패 화면·Network 오류가 있으면 원문을 붙여 주면 기록·수정한다
- **8·8-1** (터미널, bash):
```bash
gcloud run services update ulevelp --region asia-northeast3 --project ulevelp --update-env-vars ULP_UI=legacy
curl -fsS https://ulevelp-d5ympfsmfq-du.a.run.app/ | grep -c 'id="root"'     # 기대 0
curl -fsS https://ulevelp-d5ympfsmfq-du.a.run.app/ | grep -c 'src="home.js"' # 기대 1
gcloud run services update ulevelp --region asia-northeast3 --project ulevelp --update-env-vars ULP_UI=spa
curl -fsS https://ulevelp-d5ympfsmfq-du.a.run.app/ | grep -c 'id="root"'     # 기대 1
```

## 겪은 문제
- `docker buildx build --builder default` → `ERROR: use docker --context=default buildx …`. `--builder`를 빼고 해결
- zsh에서 `G="--region … --project …"; gcloud … $G`는 단어 분리가 안 돼 `unrecognized arguments`. bash 배열로 실행
- 자동 배포는 여전히 꺼져 있다(Variables 0개) → 배포는 로컬 경로만 가능. WIF 구성은 별도 step
