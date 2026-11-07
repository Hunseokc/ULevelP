# CH-8 결과 — 통합 확인 + PR #63 Draft 해제

- 날짜: 2026-11-05 (mac)
- 입력: `진행_코드진행모음.md` §2·§3, 결과 파일 CH-0~CH-7c(특히 `CH-4_진행영상분석.md` §5, `CH-7_노션폐기.md`)
- 상태: **완료** — §3 실제 영상은 2026-11-05 운영에서 확인(`결과/GA-3_실영상확인.md`) — 로컬 전체 테스트·e2e 통과, PR #63 Draft 해제, CI 통과(§2-1)
- 코드 변경 없음(문서만)

## 1. 로컬 실행 결과 (mac, head `a873c67`, origin/main `c269ad2` 이미 반영 — 충돌 없음 `MERGEABLE`)

```
npm test                        tests 383 · pass 383 · fail 0
npm run build                   exit 0
./gradlew test --rerun-tasks    BUILD SUCCESSFUL — 219 tests, 0 fail, 0 skipped (NotionPushApiTest NP8 이번엔 통과)
ULP_UI=spa    npx playwright test   74 passed (1.2m)
ULP_UI=legacy npx playwright test   16 passed, 58 skipped (43.6s)
```

## 2. PR #63

- Draft 해제(`gh pr ready 63`), base `main`, CI: §2-1에 기록

### 2-1. CI

- PR #63 CI 전부 통과 — Node 22·24·Kotlin·E2E spa·legacy·Docker, run 41859435516, head `ce226ec`

## 3. 실제 영상 1개 분석 — 2026-11-05 운영에서 확인(닫힘)

- 배포 `ulevelp-00009-mcq`(Flyway v4)에서 `youtu.be/oWQZopUx0fA` 보통·빠름·구간 분석 성공 → `결과/GA-3_실영상확인.md`
- 아래는 당시(머지 전) 기록

- 이유: 이 PC `.env`에 Gemini 키가 없다(`SUPABASE_SECRET_KEY`·`APP_MASTER_KEY`만). 가짜 키는 저장 때 Google 확인으로 거절(CH-4 §4). 운영 DB에 저장된 키를 쓰려면 원격 DB에 서버를 붙여야 하는데, 그러면 머지(배포) 전에 운영 DB에 V3가 적용된다 → 하지 않음
- 경로 자체(202 → 실행 → 노트 + 진행 행)는 테스트 n17·n18(가짜 Gemini)이 확인
- **머지(배포) 뒤 운영에서 확인**: CHORDS → 입력 "코드 진행 영상" → 유튜브 주소 → 완료 표시 "N개 수집 · 노트 보기" → 범위 "분석"에 행, 코드 심볼이 영상 표기 그대로인지. 배포 때 Flyway가 V3를 적용하는지(로그 `now at version v3`)도 함께 본다
- 로컬에서 미리 하려면: `결과/CH-3_진행API.md` §5 방법으로 로컬 postgres + 서버 → `PUT /api/v1/integrations/gemini`(진짜 키) → `POST /api/v1/progressions/analyze` → `/api/v1/notes/jobs/{id}` 폴링 → `/api/v1/progressions?scope=analysis`

## 4. 다음 할 일

- 사용자: PR #63 머지(= 운영 배포, V3 적용) → §3 실제 영상 확인
- 유지보수: 정석 폼 사람 검토(진행 파일 §7)
- 2차: 별도 진행 파일(공개 레퍼런스 등, 진행 파일 §2 끝)
