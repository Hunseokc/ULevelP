# RZ-M 점검 항목 — RZ-3(PR #45)·CORS(PR #46) 배포 후 Cloud Run 실환경 점검

- **작성일:** 2026-11-03 (`RZ-M-0`)
- **수행:** 사람(사용자). 명령은 로컬 터미널(gcloud 로그인 Owner 계정)에서 실행
- **근거:** PR #45 리뷰 코멘트(R-1~R-5), PR #46, `결과/RZ-3_React전환및보정.md`, `결과/KZ-1_CloudRun배포.md` §3.3, `결과/RZ-3-0_명세검토.md` §3-3
- **결과 파일:** `결과/RZ-M_실환경점검.md` — 항목 번호마다 실제 출력(또는 화면 관찰)과 통과/실패를 적는다

## 0. 작성 시점 운영 상태 (2026-11-03 실측, 배포 전 기준선)

| 항목 | 값 | 확인 방법 |
| --- | --- | --- |
| PR #45·#46 | 둘 다 main 머지(14:21:53Z, 14:22:06Z), main 헤드 `0520915` | `gh pr view 45/46 --json state,mergedAt` |
| 운영 이미지 | `server:e296817`(KZ-1), revision `ulevelp-00003-5g8` — **#45·#46 미반영** | `gcloud run services describe` |
| 운영 env | `ULP_UI` 없음, `ALLOWED_ORIGINS=https://hunseokc.github.io,http://localhost:3000`, `PUBLIC_APP_URL=https://hunseokc.github.io/ULevelP/` | 같음 |
| 자동 배포 | `Deploy to Cloud Run`이 `workflow_run`으로 **발동은 됨**(run `41653682464`) → job **skipped**. 저장소 Variables가 0개라 `vars.GCP_PROJECT_ID != ''`(`deploy-cloudrun.yml:26`) 거짓. WIF(`GCP_WIF_PROVIDER`·`GCP_DEPLOY_SA`)도 미구성 | `gh run list`, `gh variable list` (빈 출력) |
| `/` 화면 | `id="root"` 0개(레거시) | `curl -fsS $U/ \| grep -c 'id="root"'` |
| CORS (R-2) | 같은 출처 `Origin: $U` POST → **403**, `https://hunseokc.github.io` → 401, `evil.example.com` → 403, Origin 없음 → 401 | 아래 항목 4의 명령 |

→ PR #45 리뷰 R-2의 "운영 env 직접 조회 못 함"은 이 실측으로 확정됐다(같은 출처 403). #46 배포 후 항목 4에서 401로 바뀌어야 한다.
→ RZ-3-0 §3-3 R5("`workflow_run` 발동 확인")는 발동까지 확인됨. 실제 배포는 Variables가 없어서 안 된다.

## 공통 변수

```bash
cd ~/code/ULevelP && command git fetch -q origin && command git switch main && command git pull -q
export GCP_PROJECT_ID=ulevelp GCP_REGION=asia-northeast3
export RUNTIME_SA_EMAIL=ulevelp-runtime@ulevelp.iam.gserviceaccount.com
export CRON_SA_EMAIL=ulevelp-cron@ulevelp.iam.gserviceaccount.com
export SHA=$(command git rev-parse --short HEAD)       # 0520915 이상
export IMAGE_URI=$GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/ulevelp/server:$SHA
export U=https://ulevelp-d5ympfsmfq-du.a.run.app
```

## 점검 항목

| # | 항목 | 명령 / 동작 | 기대값 |
| --- | --- | --- | --- |
| **1** | 배포 (KZ-1과 같은 로컬 경로) | `docker buildx build --platform linux/amd64 -t "$IMAGE_URI" --push .` → `bash scripts/deploy-cloudrun.sh "$IMAGE_URI"` | 둘 다 exit 0, 마지막에 `Service [ulevelp] revision [ulevelp-0000N-…] has been deployed and is serving 100 percent of traffic.` (Apple Silicon은 `--platform linux/amd64` 필수, `KZ-1` §4-3) |
| **2** | 배포 반영 확인 | `gcloud run services describe ulevelp --region $GCP_REGION --format='value(spec.template.spec.containers[0].image)'` / 같은 명령 `--format=yaml(spec.template.spec.containers[0].env)` | 이미지 태그 = `$SHA`. env에 `ULP_UI=spa`, `ALLOWED_ORIGINS=https://hunseokc.github.io`(localhost 없음 — `deploy-cloudrun.sh` 기본값) |
| **3** | React 서빙·보안 헤더 (M-KZ3 재확인) | `curl -fsS $U/api/health` / `curl -fsS $U/ \| grep -c 'id="root"'` / `curl -fsSI $U/notes.html \| grep -iE "frame-ancestors\|x-frame\|cache-control"` / `curl -s -o /dev/null -w '%{http_code}\n' $U/unknown.html` | `{"ok":true}` / `1` / `frame-ancestors 'none'`·`DENY`·`no-cache` / `404` |
| **4** | 같은 출처 쓰기 CORS (R-2 → PR #46) | `for o in $U https://hunseokc.github.io https://evil.example.com; do curl -s -o /dev/null -w "$o %{http_code}\n" -X POST -H "Origin: $o" -H 'Content-Type: application/json' -d '{}' $U/api/v1/songs; done` | `$U 401`(배포 전 403), `github.io 401`, `evil 403`. 잘못된 입력 확인: `-H 'X-Forwarded-Host: evil.example.com'`를 붙인 evil 요청도 `403` |
| **5** | 크론 (M-KZ2 재확인) | `gcloud scheduler jobs run ulevelp-notion-push --location $GCP_REGION` 후 `gcloud logging read 'resource.type="cloud_run_revision" AND httpRequest.requestUrl:"/internal/cron/notion-push"' --limit 3 --format='value(timestamp,httpRequest.status)'` | 최신 줄 `200`. 401이면 `CRON_AUDIENCE` 불일치(`KZ-1` §4-1) |
| **6** | **M-KZ4** 데스크톱 브라우저 전 흐름 (`$U`에서) | ① 상단 `LOGIN` → Google 로그인 → 원래 화면 복귀 ② 첫 화면에 유튜브 링크 붙여넣기 → 곡 추가 ③ 플레이어에서 구간 A/B·속도 바꾸고 30초 이상 재생 ④ 녹음 1개 저장 → 기록 화면 곡 상세에서 재생 ⑤ 설정 → 노션 연결 테스트 → 1분 뒤 노션 `연습 곡` 행 생성/갱신 ⑥ 설정 → Gemini 키 저장(온보딩 모달) → 학습 노트 생성 → `notes.html`에 표시 | 각 단계 오류 토스트 없음. DevTools Network에 `/api/v1/*` 403·5xx 없음, Console에 CSP 위반 없음. ⑤의 노션 `이어서 연습` 링크 주소를 결과에 적는다(지금 설정이면 `https://hunseokc.github.io/ULevelP/practice.html?...` → `결과/R1_Pages처리결정.md` 근거) |
| **6-1** | Drive 미연결 1곡 제한 (RN-D3) | 드라이브 미연결 계정에서 두 번째 곡 녹음 저장 시도 | 교체 모달(`replaceOldSongTakes`)이 뜨고, 교체하면 앞 곡 서버 녹음이 사라진다 |
| **7** | **M-KZ5** 아이패드 Safari (또는 모바일 실기기) | `$U`에서 플레이어 구간 반복, 녹음, 기록 달력(12주), 코드 연습실 7개 탭(베이스 칩·CAGED·더블 스탑 소리), 학습 노트 뷰어. 세로·가로 각각 | 가로 스크롤 없음(390px는 `layout.spec.js`로 자동 검사됨), 버튼 잘림 없음, 소리 남. 화면별 스크린샷 1장씩 결과 파일에 첨부 경로 기록 |
| **8** | 롤백 스위치 1회 (`ULP_UI=legacy`) | `gcloud run services update ulevelp --region $GCP_REGION --update-env-vars ULP_UI=legacy` → `curl -fsS $U/ \| grep -c 'id="root"'` / `curl -fsS $U/ \| grep -c 'src="home.js"'` | revision 새로 생김, `0` / `1`(레거시). 브라우저 새로고침 시 레거시 화면 |
| **8-1** | 롤백 해제 | `gcloud run services update ulevelp --region $GCP_REGION --update-env-vars ULP_UI=spa` → 같은 `grep -c 'id="root"'` | `1`. **해제를 빼먹지 않는다**(다음 배포는 스크립트가 `spa`로 덮지만 그 전까지 레거시) |
| **9** | 로그 이상 없음 | `gcloud logging read 'resource.type="cloud_run_revision" AND severity>=ERROR' --freshness=2h --limit 20 --format='value(timestamp,textPayload)'` | 점검 중 생긴 ERROR 0건(있으면 원문 그대로 결과 파일에) |

## 실패 시

- 문제 한 줄 → 원인 → 추천 해결 1개 형식으로 결과 파일에 적고, 코드 수정이 필요하면 별도 fix 브랜치·PR(base main)
- 화면이 깨지면 먼저 항목 8로 롤백해 서비스를 살리고, 원인은 `ULP_UI=spa node server.js`(`npm run build` 후)로 로컬 재현한다(RN-D12)

## 이번 범위 밖 (RZ-M 뒤 별도 step 후보)

- 자동 배포 활성화: WIF 풀·프로바이더·배포 SA 생성 + 저장소 Variables(`GCP_PROJECT_ID`·`GCP_WIF_PROVIDER`·`GCP_DEPLOY_SA`·`RUNTIME_SA_EMAIL`·`CRON_SA_EMAIL`) 등록. 그 전까지는 항목 1의 로컬 배포가 유일한 경로
- PR #45 리뷰 R-3(spa E2E `#root` 단언)·R-4(배포 스모크 `id="root"`)·R-5(Ktor 시작 로그에 UI 모드)
- `Main.kt:70` 코드 기본값 `DEFAULT_ALLOWED_ORIGINS`에 아직 `http://localhost:3000`이 남아 있다(RZ-3 P3은 배포 파일만 고침). 운영은 env로 덮어써서 영향 없음
- Pages 처리 → `결과/R1_Pages처리결정.md`
