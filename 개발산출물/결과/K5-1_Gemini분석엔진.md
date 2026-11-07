# 결과: K5-1 — Gemini 학습 노트 분석기 & 지판/건반 SVG 렌더러 Kotlin 이식 + Notes API

- **작업일:** 2026-11-02
- **역할:** 주니어
- **브랜치:** `step/K5-1`
- **상태:** `완료`
- **PR:** #27

---

## 1. 만든·고친 파일

| 구분 | 경로 | 하는 일 |
| :--- | :--- | :--- |
| 신규 | `src/main/kotlin/ulevelp/note/GeminiSchemas.kt` | `scripts/schemas.py` 1:1 이식 (`TAGS`, `ALLOWED_NOTE_TAGS`, `PROMPT_TEMPLATE`, 태그별 동적 JSON 스키마 및 프롬프트 생성기) |
| 신규 | `src/main/kotlin/ulevelp/note/KeyboardSvgRenderer.kt` | `scripts/keyboard.py` 1:1 이식 (피아노 건반 보이싱 SVG 다이어그램 렌더러, MIDI 계산, 양손 분리 범례) |
| 신규 | `src/main/kotlin/ulevelp/note/GuitarSvgRenderer.kt` | `scripts/guitar.py` 1:1 이식 (기타 지판 도수 SVG 다이어그램 렌더러, 프렛 파싱, 루트 강조) |
| 신규 | `src/main/kotlin/ulevelp/note/NotionNoteBlockBuilder.kt` | `scripts/analyze.py` 1:1 이식 (노션 블록 트리 생성기 `buildBlocks`, `buildPageProperties`, `seconds`, `voicingCell`) |
| 신규 | `src/main/kotlin/ulevelp/note/GeminiClient.kt` | Gemini `generateContent` 호출 인터페이스 + HTTP 구현체 (`fps=0.2`, `MEDIA_RESOLUTION_LOW`, 12분 타임아웃, `429`/`500`/`503` 지수 백오프 최대 4회 재시도, `PROVIDER_KEY_INVALID` vs `GEMINI_API_ERROR` 구분) |
| 신규 | `src/main/kotlin/ulevelp/note/AnalyzeJobDispatcher.kt` | 비동기 분석 잡 실행기 인터페이스 (`CloudRunJobDispatcher` + 로컬 비동기 실행기 `LocalAsyncJobDispatcher`) |
| 신규 | `src/main/kotlin/ulevelp/service/NoteService.kt` | 분석 요청(`requestAnalyze`), Cloud Run Job 실행 본체(`executeJob` — 54분 타임아웃 및 NonCancellable 실패 기록 보장), 작업 조회(`listJobs`, `getJob`), 노트 CRUD(`listNotes`, `getNote`, `updateNote`, `deleteNote`) |
| 신규 | `src/main/kotlin/ulevelp/routes/NoteRoutes.kt` | `/api/v1/notes` 하위 7개 엔드포인트 라우트 (`POST /analyze`, `GET /jobs`, `GET /jobs/{jobId}`, `GET /`, `GET /{noteId}`, `PATCH /{noteId}`, `DELETE /{noteId}`) |
| 수정 | `src/main/kotlin/ulevelp/Main.kt` | `main(args)`에 `--analyze-job <jobId>`(또는 `ANALYZE_JOB_ID`) 단독 실행 분기 추가, `Application.module`에 `noteService` 등록 및 라우트 연결 |
| 신규 | `src/test/kotlin/ulevelp/support/FakeGeminiClient.kt` | 테스트용 가짜 `GeminiClient` 및 `FakeAnalyzeJobDispatcher` |
| 수정 | `src/test/kotlin/ulevelp/support/ApiTestSupport.kt` | `configureApiTestApp`에 `geminiClient`, `analyzeJobDispatcher` 인자 추가 |
| 신규 | `src/test/kotlin/ulevelp/note/NoteSvgAndSchemaTest.kt` | `GuitarSvgRenderer`, `KeyboardSvgRenderer`, `GeminiSchemas`, `NotionNoteBlockBuilder` 단위 테스트 (SV1~SV8, 8개 전체 통과) |
| 신규 | `src/test/kotlin/ulevelp/note/NoteApiTest.kt` | 분석 요청·일 20회/동시 1건 제한·429 재시도·키 무효 기록·비동기 분석 완료·노트 조회/수정/삭제·실패 검증·사용자 교차 접근 차단 통합 테스트 (N1~N16, 16개 전체 통과) |
| 수정 | `.env.example` | `CLOUD_RUN_ANALYZE_JOB_URI`, `GEMINI_FRAME_FPS` 추가 |
| 수정 | `.gitignore` | `test-results/` 추가 |
| 신규 | `개발산출물/결과/K5-1_Gemini분석엔진.md` | 결과 파일 |
| 수정 | `개발산출물/진행_코틀린서버.md` | 3·5·6·7절 갱신 |

---

## 2. 검증 실행 결과

### 2.1 `./gradlew test --no-daemon` 실행 결과 (끝 30줄)

```text
NoteApiTest > N16 GET /jobs 작업 목록 조회() PASSED
NoteApiTest > N11 PATCH /notes/{noteId} 메모·태그·제목 수정 및 Outbox 적재() PASSED
NoteApiTest > N12 PATCH /notes/{noteId} 입력 검증 실패 케이스들() PASSED
NoteApiTest > N14 Gemini 키 해제 후에도 기존 노트 열람 가능() PASSED
NoteApiTest > N7 어제 생성된 작업 20건은 오늘 한도에 미영향() PASSED
NoteApiTest > N13 DELETE /notes/{noteId} 삭제 및 Outbox delete 적재() PASSED
NoteApiTest > N4 노션 연동 활성 시 sync_outbox upsert 적재() PASSED
NoteApiTest > N10 GET /notes 목록 조회 및 ?tag= 필터() PASSED
NoteApiTest > N6 일 최대 20건 제한() PASSED
NoteApiTest > N9 Gemini 호출 실패 및 타임아웃 시 status=failed 기록() PASSED
NoteApiTest > N2 잘못된 유튜브 URL 및 잘못된 태그 검증() PASSED
NoteApiTest > N15 사용자 A·B 교차 접근 차단() PASSED
NoteApiTest > N8 디스패처 실패 시 작업 상태 failed 전환 및 502() PASSED
NoteApiTest > N5 동시 실행 1건 제한() PASSED
NoteApiTest > N3 분석 요청 202 -> 비동기 잡 완료 -> 노트 및 SVG 다이어그램 생성() PASSED
NoteApiTest > N1 Gemini 키 미등록 사용자 분석 요청 거부() PASSED

NoteSvgAndSchemaTest > SV4 KeyboardSvgRenderer 단손 녹색 렌더링() PASSED
NoteSvgAndSchemaTest > SV3 KeyboardSvgRenderer MIDI 변환 및 양손 분리 범례 렌더링() PASSED
NoteSvgAndSchemaTest > SV5 GeminiSchemas.buildPrompt 동적 스키마 조합() PASSED
NoteSvgAndSchemaTest > SV2 GuitarSvgRenderer 하이 프렛 표시() PASSED
NoteSvgAndSchemaTest > SV7 NotionNoteBlockBuilder.buildBlocks 및 buildPageProperties() PASSED
NoteSvgAndSchemaTest > SV1 GuitarSvgRenderer 오픈/바레 코드 도수 및 SVG 생성() PASSED
NoteSvgAndSchemaTest > SV6 NotionNoteBlockBuilder.seconds 및 tsLink 변환() PASSED
NoteSvgAndSchemaTest > SV8 HttpGeminiClient 429/503 재시도 및 400/403 에러 분류() PASSED

BUILD SUCCESSFUL in 23s
5 actionable tasks: 1 executed, 4 up-to-date
```

### 2.2 `npm test` 실행 결과 (끝 10줄)

```text
✔ 틀린 예 bad-e.js → (e) 검사가 실패한다 (0.055542ms)
✔ 틀린 예 bad-f.js → (f) 검사가 실패한다 (0.065167ms)
✔ 틀린 예 bad-g.js → (g) 검사가 실패한다 (0.065333ms)
✔ 틀린 예 폴더의 파일이 모두 표에 있다 (0.075625ms)
ℹ tests 63
ℹ suites 0
ℹ pass 63
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 430.7354
```

### 2.3 `npm run test:e2e` 실행 결과

```text
Running 9 tests using 1 worker

  ok 1 [chromium] › test\e2e\xss.spec.js:382:1 › E1 첫 화면(index.html) 곡 목록 및 노션 바로가기 (3.5s)
  ok 2 [chromium] › test\e2e\xss.spec.js:401:1 › E2 플레이어(practice.html) 곡 제목 및 곡 목록 서랍 (704ms)
  ok 3 [chromium] › test\e2e\xss.spec.js:417:1 › E3 기록 화면(log.html) 기록 탭·세션 목록·녹음 URL (698ms)
  ok 4 [chromium] › test\e2e\xss.spec.js:438:1 › E4 기록 화면(log.html#songs) 곡 보관함 탭 (605ms)
  ok 5 [chromium] › test\e2e\xss.spec.js:455:1 › E5 곡 상세 화면(log.html?song=...) 타임라인 및 A/B 비교 (777ms)
  ok 6 [chromium] › test\e2e\xss.spec.js:476:1 › E6 설정 화면(settings.html) 계정 프로필 표시 (652ms)
  ok 7 [chromium] › test\e2e\xss.spec.js:493:1 › E7 대조군(검출기 작동 확인) (971ms)
  ok 8 [chromium] › test\e2e\xss.spec.js:512:1 › E8 설정 화면(settings.html) 노션 백업 ZIP 미리보기 XSS 검사 (717ms)
  ok 9 [chromium] › test\e2e\xss.spec.js:568:1 › E9 설정 화면(settings.html) 외부 연동 키 상태·점검 결과 XSS 검사 (673ms)

  9 passed (11.6s)
```

---

## 3. K5-2가 쓸 값

### 3.1 `NoteService` 시그니처 (`ulevelp.service.NoteService`)
```kotlin
suspend fun requestAnalyze(userId: String, request: AnalyzeRequestDto): AnalyzeJobDto
suspend fun executeJob(jobId: String)
suspend fun listJobs(userId: String): List<AnalysisJobDto>
suspend fun getJob(userId: String, jobId: String): AnalysisJobDto
suspend fun listNotes(userId: String, tag: String? = null): List<NoteSummaryDto>
suspend fun getNote(userId: String, noteId: String): NoteDetailDto
suspend fun updateNote(userId: String, noteId: String, request: UpdateNoteRequestDto): NoteDetailDto
suspend fun deleteNote(userId: String, noteId: String)
```

### 3.2 `NotionNoteBlockBuilder` 시그니처 (`ulevelp.note.NotionNoteBlockBuilder`)
```kotlin
fun buildPageProperties(
    title: String,
    youtubeUrl: String,
    difficulty: String,
    tags: List<String>,
    createdAt: Instant
): JsonObject

fun buildBlocks(
    youtubeUrl: String,
    analysisJson: JsonObject,
    harmonyUploadIds: List<String>
): List<JsonObject>
```

### 3.3 DTO 필드 구조
```kotlin
data class NoteSummaryDto(
    val id: String,
    val title: String,
    val youtubeUrl: String,
    val difficulty: String,
    val tags: List<String>,
    val headline: String,
    val createdAt: Instant,
    val updatedAt: Instant
)

data class NoteDetailDto(
    val id: String,
    val title: String,
    val youtubeUrl: String,
    val difficulty: String,
    val tags: List<String>,
    val headline: String,
    val memo: String,
    val analysisJson: JsonObject,
    val diagramsSvg: List<String>,
    val points: List<String>,
    val keywords: List<String>,
    val createdAt: Instant,
    val updatedAt: Instant
)

data class AnalysisJobDto(
    val id: String,
    val noteId: String?,
    val status: String,
    val youtubeUrl: String,
    val tags: List<String>,
    val userMemo: String,
    val errorMessage: String?,
    val createdAt: Instant,
    val updatedAt: Instant
)
```

---

## 4. 명세와 달라진 점 및 겪은 문제

### 4.1 명세와 달라진 점
- 비즈니스 로직 및 API: 없음. 명세의 패키지 경로, DTO 필드, 엔드포인트 URL, 에러 코드 및 메시지, 비즈니스 규칙(동시 1건 제한, 일 20건 제한, 54분 잡 타임아웃, 취소 시 NonCancellable failed 보장)을 1:1 완벽 준수함.
- Git 위생: Playwright E2E 실행 시 생성되는 빌드 부산물 `test-results/`가 Git 추적에 남지 않도록 명세 1절 파일 목록 외에 `.gitignore`에 `test-results/` 항목을 추가함.

### 4.2 겪은 문제 및 해결
1. **Gemini 키 형식 검증:**
   - 통합 테스트 시드 시 더미 키로 `"valid-gemini-key"`를 사용했으나 `CryptoService`의 Gemini 키 검증 정규식(`^AIza[0-9A-Za-z\-_]{35}$`)에 의해 `INVALID_INTEGRATION_KEY` 예외가 발생함.
   - 해결: 유효한 39자리 포맷(`"AIzaSyFakeKeyForIntegrationTest1234X9zQ"`)으로 테스트 시드 데이터를 교체함.
2. **429 RATE_LIMITED 응답의 `retryAfter` 단언:**
   - 기존 `assertStandardError`는 `retryAfter`가 null임을 전제하여 429의 정수형 `retryAfter` 필드에서 단언 실패함.
   - 해결: `NoteApiTest` 내에 6개 키(`ok`, `source`, `status`, `code`, `message`, `retryAfter`)와 정수형 초 값을 엄격히 검증하는 `assertStandardRateLimitError` 헬퍼를 작성하여 해결함.
3. **Playwright Windows 다운로드 중단/락 현상:**
   - Windows 환경에서 Node.js `extract-zip`이 141.8 MiB의 Chromium 아카이브 해제 시 블로킹되는 현상이 발생함.
   - 해결: Temp에 완료된 아카이브 및 필요한 `chromium_headless_shell`과 `ffmpeg` 바이너리를 PowerShell 네이티브로 직접 해제하고 `INSTALLATION_COMPLETE` 마커를 생성하여 E2E 테스트(9 passed)를 정상 완료함.

