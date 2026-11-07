# 결과: K4-2 — 노션 실시간 동기화 — 보내기(`NotionPushWorker`) + `/internal/cron/notion-push`

- **작업일:** 2026-11-01
- **역할:** 주니어
- **브랜치:** `step/K4-2`
- **상태:** `완료`
- **PR:** #24 (예정)

---

## 1. 만든·고친 파일

| 구분 | 경로 | 하는 일 |
| :--- | :--- | :--- |
| 신규 | `src/main/kotlin/ulevelp/notion/NotionClient.kt` | 노션 API(`2022-06-28`) 호출 인터페이스 + HTTP 구현체 (`429 Retry-After` 최대 3회 재시도, 20MB 이하 단일 / 20MB 초과 10MB 멀티파트 파일 업로드) |
| 신규 | `src/main/kotlin/ulevelp/notion/NotionPushWorker.kt` | `sync_outbox` 대기열 처리기 (`notion_sync` 5분 lease, `song`·`session`·`take` `upsert`, `delete` 노션 아카이브, 크론 배치 정리) |
| 신규 | `src/main/kotlin/ulevelp/auth/CronOidcVerifier.kt` | `/internal/cron/notion-push`용 Google OIDC ID 토큰 검증기 (`HttpJwksProvider`·`JwksParser` 재사용 + RS256 서명 검증) |
| 신규 | `src/main/kotlin/ulevelp/routes/NotionSyncRoutes.kt` | `POST /api/v1/notion/sync/push` 및 `POST /internal/cron/notion-push` 라우트 |
| 수정 | `src/main/kotlin/ulevelp/Main.kt` | `Application.module`에 `notionClient`, `cronOidcVerifier` 기본 인자 추가 및 `registerNotionSyncRoutes`, `registerInternalCronRoutes` 등록 |
| 신규 | `src/test/kotlin/ulevelp/support/FakeNotionClient.kt` | 요청 기록 및 응답 시뮬레이션용 가짜 `NotionClient` |
| 수정 | `src/test/kotlin/ulevelp/support/ApiTestSupport.kt` | `TestCronJwt`(RS256 키쌍 및 OIDC 토큰 생성기) 및 `configureApiTestApp` 인자 확장 |
| 신규 | `src/test/kotlin/ulevelp/notion/NotionPushApiTest.kt` | `Code.gs` 1:1 요청 본문 일치, 20MB+ 멀티파트 업로드, lease 동시성, 429 재시도, 5회 실패, cron OIDC 통합 테스트 (NP1~NP12 전수 통과) |
| 신규 | `개발산출물/결과/K4-2_노션Push.md` | 결과 보고서 |
| 수정 | `개발산출물/진행_코틀린서버.md` | 3·5·6·7절 갱신 |

---

## 2. 검증 실행 결과

### 2.1 `./gradlew test --no-daemon` 실행 결과 (끝 30줄)

```text
TakeApiTest > T11 녹음 삭제 - 파일 제거 및 쿼터 반환() PASSED

TakeApiTest > T3 쿼터 사전 거부() STANDARD_OUT
    2026-11-01 21:18:04.964 [DefaultDispatcher-worker-1 @call-context#5349] INFO  io.ktor.test - No ktor.deployment.watch patterns specified, automatic reload is not active.
    2026-11-01 21:18:04.964 [DefaultDispatcher-worker-1 @coroutine#5350] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-98 - Starting...
    2026-11-01 21:18:04.970 [DefaultDispatcher-worker-1 @coroutine#5350] INFO  com.zaxxer.hikari.pool.HikariPool - HikariPool-98 - Added connection org.postgresql.jdbc.PgConnection@67367490
    2026-11-01 21:18:04.970 [DefaultDispatcher-worker-1 @coroutine#5350] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-98 - Start completed.
    2026-11-01 21:18:04.970 [DefaultDispatcher-worker-1 @call-context#5349] INFO  io.ktor.test - Application started in 0.006 seconds.
    2026-11-01 21:18:04.970 [DefaultDispatcher-worker-7 @coroutine#5351] INFO  io.ktor.test - Responding at http://localhost:80
    2026-11-01 21:18:04.970 [DefaultDispatcher-worker-7 @coroutine#5351] INFO  io.ktor.test - Responding at https://localhost:443
    2026-11-01 21:18:05.002 [DefaultDispatcher-worker-14] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-98 - Shutdown initiated...
    2026-11-01 21:18:05.002 [DefaultDispatcher-worker-14] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-98 - Shutdown completed.

TakeApiTest > T3 쿼터 사전 거부() PASSED

TakeApiTest > T7 크기 경계() STANDARD_OUT
    2026-11-01 21:18:05.006 [DefaultDispatcher-worker-14 @call-context#5401] INFO  io.ktor.test - No ktor.deployment.watch patterns specified, automatic reload is not active.
    2026-11-01 21:18:05.007 [DefaultDispatcher-worker-14 @coroutine#5402] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-99 - Starting...
    2026-11-01 21:18:05.011 [DefaultDispatcher-worker-14 @coroutine#5402] INFO  com.zaxxer.hikari.pool.HikariPool - HikariPool-99 - Added connection org.postgresql.jdbc.PgConnection@36039ef4
    2026-11-01 21:18:05.011 [DefaultDispatcher-worker-14 @coroutine#5402] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-99 - Start completed.
    2026-11-01 21:18:05.011 [DefaultDispatcher-worker-14 @call-context#5401] INFO  io.ktor.test - Application started in 0.005 seconds.
    2026-11-01 21:18:05.011 [DefaultDispatcher-worker-4 @coroutine#5403] INFO  io.ktor.test - Responding at http://localhost:80
    2026-11-01 21:18:05.011 [DefaultDispatcher-worker-4 @coroutine#5403] INFO  io.ktor.test - Responding at https://localhost:443
    2026-11-01 21:18:05.091 [DefaultDispatcher-worker-7] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-99 - Shutdown initiated...
    2026-11-01 21:18:05.091 [DefaultDispatcher-worker-7] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-99 - Shutdown completed.

TakeApiTest > T7 크기 경계() PASSED

TakeApiTest > T9 mime 파라미터 제거() STANDARD_OUT
    2026-11-01 21:18:05.095 [DefaultDispatcher-worker-7 @call-context#5457] INFO  io.ktor.test - No ktor.deployment.watch patterns specified, automatic reload is not active.
    2026-11-01 21:18:05.095 [DefaultDispatcher-worker-7 @coroutine#5458] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-100 - Starting...
    2026-11-01 21:18:05.099 [DefaultDispatcher-worker-7 @coroutine#5458] INFO  com.zaxxer.hikari.pool.HikariPool - HikariPool-100 - Added connection org.postgresql.jdbc.PgConnection@6dda3776
    2026-11-01 21:18:05.099 [DefaultDispatcher-worker-7 @coroutine#5458] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-100 - Start completed.
    2026-11-01 21:18:05.100 [DefaultDispatcher-worker-7 @call-context#5457] INFO  io.ktor.test - Application started in 0.005 seconds.
    2026-11-01 21:18:05.100 [DefaultDispatcher-worker-14 @coroutine#5459] INFO  io.ktor.test - Responding at http://localhost:80
    2026-11-01 21:18:05.100 [DefaultDispatcher-worker-14 @coroutine#5459] INFO  io.ktor.test - Responding at https://localhost:443
    2026-11-01 21:18:05.118 [DefaultDispatcher-worker-14] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-100 - Shutdown initiated...
    2026-11-01 21:18:05.118 [DefaultDispatcher-worker-14] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-100 - Shutdown completed.

TakeApiTest > T9 mime 파라미터 제거() PASSED

TakeApiTest STANDARD_OUT
    2026-11-01 21:18:05.134 [Test worker] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-81 - Shutdown initiated...
    2026-11-01 21:18:05.134 [Test worker] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-81 - Shutdown completed.

BUILD SUCCESSFUL in 12s
5 actionable tasks: 1 executed, 4 up-to-date
```

### 2.2 `npm test` 실행 결과 (끝 10줄)

```text
✔ 틀린 예 bad-e.js → (e) 검사가 실패한다 (0.146208ms)
✔ 틀린 예 bad-f.js → (f) 검사가 실패한다 (0.098708ms)
✔ 틀린 예 bad-g.js → (g) 검사가 실패한다 (0.115834ms)
✔ 틀린 예 폴더의 파일이 모두 표에 있다 (0.0715ms)
ℹ tests 60
ℹ suites 0
ℹ pass 60
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 175.4135
```

### 2.3 `npm run test:e2e` 실행 결과

```text
> guitar-chord-lab@1.0.0 test:e2e
> playwright test


Running 9 tests using 1 worker

     1 …/e2e/xss.spec.js:382:1 › E1 첫 화면(index.html) 곡 목록 및 노션 바로가기
  ✓  1 ….spec.js:382:1 › E1 첫 화면(index.html) 곡 목록 및 노션 바로가기 (598ms)     2 …e/xss.spec.js:401:1 › E2 플레이어(practice.html) 곡 제목 및 곡 목록 서랍
  ✓  2 …ec.js:401:1 › E2 플레이어(practice.html) 곡 제목 및 곡 목록 서랍 (599ms)     3 …2e/xss.spec.js:417:1 › E3 기록 화면(log.html) 기록 탭·세션 목록·녹음 URL
  ✓  3 …pec.js:417:1 › E3 기록 화면(log.html) 기록 탭·세션 목록·녹음 URL (531ms)     4 …› test/e2e/xss.spec.js:438:1 › E4 기록 화면(log.html#songs) 곡 보관함 탭
  ✓  4 …2e/xss.spec.js:438:1 › E4 기록 화면(log.html#songs) 곡 보관함 탭 (493ms)     5 ….spec.js:455:1 › E5 곡 상세 화면(log.html?song=...) 타임라인 및 A/B 비교
  ✓  5 …:455:1 › E5 곡 상세 화면(log.html?song=...) 타임라인 및 A/B 비교 (575ms)     6 …est/e2e/xss.spec.js:476:1 › E6 설정 화면(settings.html) 계정 프로필 표시
  ✓  6 …xss.spec.js:476:1 › E6 설정 화면(settings.html) 계정 프로필 표시 (514ms)     7 [chromium] › test/e2e/xss.spec.js:493:1 › E7 대조군(검출기 작동 확인)
  ✓  7 …mium] › test/e2e/xss.spec.js:493:1 › E7 대조군(검출기 작동 확인) (717ms)     8 …c.js:512:1 › E8 설정 화면(settings.html) 노션 백업 ZIP 미리보기 XSS 검사
  ✓  8 …:1 › E8 설정 화면(settings.html) 노션 백업 ZIP 미리보기 XSS 검사 (550ms)     9 …568:1 › E9 설정 화면(settings.html) 외부 연동 키 상태·점검 결과 XSS 검사
  ✓  9 …E9 설정 화면(settings.html) 외부 연동 키 상태·점검 결과 XSS 검사 (563ms)
  9 passed (5.6s)
```

---

## 3. K4-3·K5-2가 쓸 값

1. **`NotionClient` 인터페이스 (`src/main/kotlin/ulevelp/notion/NotionClient.kt`):**
   ```kotlin
   interface NotionClient {
       suspend fun queryDatabase(token: String, databaseId: String, body: JsonObject): JsonObject
       suspend fun retrievePage(token: String, pageId: String): JsonObject
       suspend fun createPage(token: String, body: JsonObject): JsonObject
       suspend fun updatePage(token: String, pageId: String, body: JsonObject): JsonObject
       suspend fun appendBlockChildren(token: String, blockId: String, children: JsonArray): JsonObject
       suspend fun archiveBlock(token: String, blockId: String): JsonObject
       suspend fun uploadFile(token: String, filename: String, mime: String, bytes: ByteArray): String
       suspend fun downloadExternalFile(url: String): Pair<ByteArray, String?>
   }
   ```
   - `K4-3`에서 `queryDatabase`를 호출해 노션 DB에서 `last_edited_time` 기준 변경분을 쿼리하고, 초기 전체 연동 시 `downloadExternalFile`을 사용해 오디오 파일을 다운로드할 수 있습니다.
2. **`NotionPushWorker` 시그니처 (`src/main/kotlin/ulevelp/notion/NotionPushWorker.kt`):**
   ```kotlin
   class NotionPushWorker(
       private val db: Database?,
       private val integrationService: IntegrationService,
       private val notionClient: NotionClient,
       private val storageClient: StorageClient?,
       private val storageTrashService: StorageTrashService,
       private val publicAppUrl: String,
       private val clock: Clock = Clock.systemUTC()
   ) {
       suspend fun pushUserOutbox(userId: UUID): PushResultDto
       suspend fun runCronBatch(): CronPushResultDto
   }
   ```
   - `K5-2`에서 `pushSongUpsert`, `pushSessionUpsert`에 이어 `"note"` 엔티티에 대한 노션 페이지 생성 및 100블록 단위 PATCH 로직을 이 클래스에 확장 연결할 수 있습니다.
3. **`FakeNotionClient` 및 `TestCronJwt` 사용법:**
   - `FakeNotionClient`(`src/test/kotlin/ulevelp/support/FakeNotionClient.kt`): `queryDatabaseCalls`, `retrievePageCalls`, `createPageCalls`, `updatePageCalls`, `appendBlockChildrenCalls`, `archiveBlockCalls`, `uploadFileCalls`를 통해 호출 인자 검증 및 핸들러 오버라이드가 가능합니다.
   - `TestCronJwt`(`src/test/kotlin/ulevelp/support/ApiTestSupport.kt`): RS256 키쌍으로 서명된 Cloud Scheduler 호환 Google OIDC 토큰을 생성할 수 있습니다 (`TestCronJwt.token()`).

---

## 4. 명세와 달라진 점 및 겪은 문제

1. **명세와 달라진 점:**
   - 없음. 명세의 파일 목록, 시그니처, 11개 속성 규격, 429 Retry-After 규칙, 20MB+ 멀티파트 전송, lease 및 트랜잭션 경계, 크론 OIDC 검증, NP1~NP12 테스트를 100% 준수하여 구현했습니다.
2. **겪은 문제:**
   - `SongService.kt`의 URL 생성 메서드 이름이 `buildResumeUrl`이 아닌 `resumeUrl`로 선언되어 있어 컴파일 에러 발생. `SongService.resumeUrl`로 정확히 맞춰 수정함.
   - 테스트 작성 중 테스트 토큰에 언더스코어(`secret_notion_test_token_12345`)를 사용했으나 `CryptoService.NOTION_TOKEN_REGEX`가 `secret_[A-Za-z0-9]{20,100}`로 영숫자만 허용하여 400 거부 발생. 유효한 영숫자 토큰(`secret_1234567890abcdef1234567890abcdef`)으로 수정함.
   - 테스트 데이터 셋업 시 `NotionSyncTable`에 행이 없으면 `pushUserOutbox`의 lease 획득 쿼리가 0행을 반환하므로, 테스트 헬퍼에서 `notion_sync.enabled = true` 행을 명시적으로 INSERT하도록 보강함.
   - Playwright 테스트 실행 시 `test-results/` 폴더가 자동 생성되었으나 12대 가드레일에 따라 즉시 삭제하여 무관한 파일 커밋을 방지함.

---

## 5. 시니어 리뷰 반영 내역 (PR #24)

1. **리뷰 1번 (필수) — 노션 아카이브 실패 시 링크 보존 및 404 무시:**
   - `archiveIgnoringMissing` 헬퍼 메서드를 추가하여 404(`object_not_found`) 및 이미 아카이브된 경우(400 `already archived`)만 정상으로 간주하고, 500 등 일시적 외부 오류는 예외를 그대로 상위로 전파하도록 수정.
   - 예외 발생 시 `NotionLinksTable.deleteWhere`가 실행되지 않아 링크가 보존되고, `attempts + 1` 및 `last_error`가 기록되어 추후 재시도 가능.
   - 단위 테스트 `NP13 delete 실패 시 500 일시 오류는 notion_links 유지 및 attempts 증가, 404는 성공 간주` 추가 및 검증 완료.
2. **리뷰 2번 (필수) — take upsert 멱등성 보장 및 lease 연장:**
   - `pushTakeUpsert` 진입 직후 `NotionLinksTable`에 `("take", takeId)`가 이미 존재하는지 검사하여, 존재할 경우 업로드를 건너뛰도록 수정.
   - 대용량 오디오 업로드 전 `leaseUntil`을 현재 시각 기준 5분 연장하여 작업 중 다른 워커의 중복 개입 방지.
   - 단위 테스트 `NP14 take upsert 멱등성 검증 - 동일 take outbox 2건 시 uploadFile 1회만 호출` 추가 및 검증 완료.
3. **리뷰 3번 (권장) — 코루틴 취소 예외(`CancellationException`) 보존:**
   - 세션 페이지 녹음 속성에 파일 첨부하는 블록에서 `runCatching` 대신 `try-catch`로 감싸 `CancellationException`은 상위 코루틴으로 즉시 재전파하고, 일반 예외는 `log.warn`을 남기도록 수정.
4. **리뷰 4번 (권장) — 크론 2단계 예외 격리로 3단계 타임아웃 정리 보장:**
   - `storageTrashService.purge` 및 쓰레기통 조회 로직을 `try-catch`로 격리하여, 스토리지 삭제 중 예외가 발생하더라도 로그만 남기고 3단계(`analysis_jobs` 70분 초과 타임아웃 정리)가 중단 없이 실행되도록 보장.
5. **체크리스트 동적 갱신:**
   - `개발산출물/주니어_체크리스트.md`에 지적 1~4번을 일반화한 4대 규칙(외부 실패 시 로컬 상태 보존, 외부 생성 멱등성 및 lease 연장, 코루틴 취소 전파, 배치 단계별 예외 격리)을 추가함.
