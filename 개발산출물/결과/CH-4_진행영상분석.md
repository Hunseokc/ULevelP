# CH-4 결과 — 코드 진행 영상 분석 (`POST /progressions/analyze` · 진행 전용 프롬프트 · 자동 수집)

- 날짜: 2026-11-04 (mac)
- 입력: `결과/CH-1b_설계.md` §3-5·§4·§9, `결과/CH-3_진행API.md` §2
- 상태: **완료** — `./gradlew test` 219개 통과(216 + 새 3), 로컬 DB curl(401·412·400) 확인, **Draft PR #63 CI 전부 통과**(Test Node 22·24, Kotlin JDK 21, E2E spa·legacy, Docker build & smoke — run 41833656984, 커밋 `c5d4330`)
- 원격 DB: **건드리지 않음**(로컬 postgres 컨테이너 `ulp-ch4-pg`에 V3 적용 → 확인 뒤 삭제)
- 실제 영상 확인: **못 함** — 로컬에서 키를 저장할 때 서버가 Google에 키를 확인한다(`PROVIDER_KEY_INVALID`). 진짜 Gemini 키가 있어야 한다. 202 → 실행 → 노트 + 진행 행 경로는 테스트 n17·n18(가짜 Gemini)이 확인. 실제 영상은 CH-5 화면이 생긴 뒤 또는 CH-8 통합 때 본다(§5)

## 1. 바꾼 파일 (§9 목록 + Main.kt)

| 파일 | 내용 |
| --- | --- |
| `src/main/kotlin/ulevelp/note/GeminiSchemas.kt` | `buildProgressionPrompt(memo): Pair<JsonObject, String>`, `PROGRESSION_TAGS = ["화성"]`, `PROGRESSION_GUIDE`(설계 §4-2 문구 그대로). 화성 스키마는 **복사본만** 고침(`progressionHarmonySchema`). `buildPrompt`는 템플릿 채우기를 `fillTemplate`로 뺐을 뿐 출력 같음 |
| `src/main/kotlin/ulevelp/service/NoteService.kt` | `AnalysisJobDto.kind`(두 번째 필드, 기본 `note`), 상수 `JOB_KIND_NOTE`·`JOB_KIND_PROGRESSION`·`JOB_KINDS`, `requestAnalyze(…, kind = JOB_KIND_NOTE)`, `executeJob`이 `kind`로 프롬프트 분기 + 트랜잭션 2에서 `collect_progressions = isProgression` + `fromAnalysis` → `insertFromNote(…, "video", rows)` |
| `src/main/kotlin/ulevelp/routes/ProgressionRoutes.kt` | `POST /progressions/analyze`(`url` 필수 ≤500, `memo` ≤2000). `registerProgressionRoutes`에 `noteService`·`analyzeJobDispatcher` 인자 추가 |
| `src/main/kotlin/ulevelp/Main.kt` | 위 인자 전달 한 줄 — **§9 CH-4 목록 밖**(라우트 인자가 늘어 생기는 연결, 동작 변화 없음) |
| `src/test/kotlin/ulevelp/note/NoteSvgAndSchemaTest.kt` | sv5b: 확장 스키마 필드 순서·required, 코드 객체·concepts는 기존과 같음, 일반 화성 스키마 회귀, 프롬프트 [코드 진행] → [화성] 순서·메모 |
| `src/test/kotlin/ulevelp/note/NoteApiTest.kt` | n17: 202 → job `kind=progression`·tags `[화성]` → 실행(진행 프롬프트·확장 스키마로 호출) → 노트 `collectProgressions=true`·다이어그램 2개 → 진행 행 1개(코드 0개 진행은 버림, 필드 값 전부), reference 범위·다른 사용자엔 없음. n18: 401·412·400(URL·url 없음), 노트 분석과 동시 제한 합산 429, 진행 0개 → 노트만·done, 일반 노트 작업 `kind=note`·수집 꺼짐·행 없음(회귀). setUp에 `ProgressionsTable.deleteAll()` |
| `docs/03-api-spec.md` | 8.2 `AnalysisJobDto` 10필드·`kind`, 8.5에 `/progressions/analyze` |

- `FakeGeminiClient.kt`는 안 바꿈(기존 `handler`로 프롬프트·스키마를 받아 확인)

## 2. 다음 step이 쓸 값 (CH-5 화면)

- **요청:** `POST /api/v1/progressions/analyze` `{ url, memo? }` → 202 `{ jobId, status: "queued" }`. 에러는 노트 분석과 같은 코드(`400 INVALID_INPUT`·`412 NO_KEY`·`429 RATE_LIMITED`(`retryAfter`)·`502 JOB_DISPATCH_ERROR`)
- **폴링:** `GET /api/v1/notes/jobs/{jobId}` → `AnalysisJobDto { id, kind, url, tags, status, error, noteId, createdAt, startedAt, finishedAt }`. `status` `queued|running|done|failed`. 실패 시 `error`가 `PROVIDER_KEY_INVALID: …`면 키 캐시 무효화(노트 화면과 같음)
- **완료 후:** `GET /api/v1/progressions?scope=analysis`에서 `noteId == job.noteId`인 행 수로 "N개 수집 · 노트 보기" / 0개면 "진행을 찾지 못했습니다 · 노트 보기"(설계 §3-5)
- **노트 목록·작업 목록:** 진행 작업도 `/notes/jobs`에 섞여 나온다(`kind`로 구분). 노트 화면 작업 목록에서 숨길지·표시할지는 CH-5에서 정함(지금 프론트는 `kind`를 모름 — 필드 추가라 깨지지 않음)
- 결과 노트는 일반 노트와 같다(태그 `화성`, `collectProgressions = true`). 사용자가 노트 상세에서 토글을 끄면 진행 행이 지워진다(CH-3 토글 그대로)

## 3. 설계에 없어 정한 것

| 항목 | 결정 | 이유 |
| --- | --- | --- |
| 확장 스키마 만드는 방법 | 기존 화성 스키마 JSON을 복사해 진행 객체 `properties`만 바꿈(`name`·`song`·`artist`·`key`·`instrument`·`start`·`end`·`chords`, 전부 required) | 설계 "기존 화성 스키마는 바꾸지 않는다" + 코드 객체를 한 곳에서만 관리(노트 다이어그램 렌더러 재사용) |
| `name` 설명 | "진행 이름·구간 (예: 인트로 진행, 후렴, 2-5-1 변형)" | 설계 §4-1 표 문구 |
| 태그별 지시 순서 | `[코드 진행]` 지시 → `[화성]` 기존 지시 | 설계 §4-2 블록 순서 |
| `requestAnalyze` kind 검사 | 모르는 값은 `require` 실패(서버 내부 오류) | 클라이언트 입력이 아니라 라우트가 상수로 넘김 |
| 다이어그램 SVG | 진행 작업도 기존처럼 진행마다 만듦(코드 0개 진행은 빈 문자열) | 노트 상세가 일반 노트와 같게 보이도록 |
| outbox | 노트 upsert는 기존대로 적재, 진행 행은 **적재 안 함** | CH-7에서 넣음(설계 §3-4) |

## 4. 실행 결과 (로컬, mac)

```
./gradlew test --tests 'ulevelp.note.*' --tests 'ulevelp.progression.*' --rerun-tasks
  NoteApiTest > n17_progressionAnalyze_createsNoteAndCollectedRows() PASSED
  NoteApiTest > n18_progressionAnalyze_noProgressions_validation_andSharedLimit() PASSED
  NoteSvgAndSchemaTest > sv5_geminiSchemas_buildPrompt_dynamicComposition() PASSED
  NoteSvgAndSchemaTest > sv5b_geminiSchemas_buildProgressionPrompt_extendsHarmonyOnly() PASSED
  BUILD SUCCESSFUL
./gradlew test --rerun-tasks → BUILD SUCCESSFUL, tests 219 failed 0 skipped 0
```

- 변이 확인: 트랜잭션 2의 `if (isProgression)`(진행 행 생성)을 `if (false && isProgression)`로 바꾸면 n17 실패(`expected: <1> but was: <0>`) → 원복

### 로컬 DB curl (서버 PORT=3099, DB `127.0.0.1:55432` 컨테이너 `ulp-ch4-pg`)

```
Flyway: Successfully applied 3 migrations to schema "public", now at version v3
$ POST /progressions/analyze (토큰 없음)  → 401 UNAUTHORIZED "Authorization 헤더가 누락되었습니다."
$ POST … (Gemini 키 없음)                 → 412 NO_KEY "등록된 키가 없습니다. 먼저 키를 저장해 주세요."  (Cache-Control: no-store)
$ PUT /integrations/gemini (가짜 키)       → 400 PROVIDER_KEY_INVALID (source gemini) — 저장 때 Google 확인 → 이후 202 경로는 로컬 불가
$ POST … url=https://example.com/x        → 400 INVALID_INPUT "올바른 유튜브 영상 주소가 아닙니다."
$ POST … {memo만}                         → 400 INVALID_INPUT "url 값이 필요합니다."
```

- curl 스크립트: 세션 scratchpad의 `ch4_curl.sh`(사라짐) — 방법은 `결과/CH-3_진행API.md` §5와 같고 컨테이너 이름만 `ulp-ch4-pg`. zsh에서 함수 안 `local path=`는 `PATH`를 덮어쓴다(curl not found) → bash 스크립트로 돌림

## 5. 남은 확인

- **실제 영상 1개**: Gemini 키가 있는 환경(운영 배포 뒤 CH-8, 또는 로컬에 사용자가 키를 넣어 줄 때)에서 코드 진행 영상 하나로 행이 생기는지, 코드 심볼이 화면 표기 그대로인지 확인. 로컬에서 하려면: 위 방법으로 서버를 띄우고 `PUT /integrations/gemini`에 진짜 키 → `POST /progressions/analyze` → `/notes/jobs/{id}` 폴링 → `/progressions?scope=analysis`
