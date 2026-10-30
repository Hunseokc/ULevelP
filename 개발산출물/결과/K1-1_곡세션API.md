# K1-1 결과 — 곡(`Songs`) & 플레이어 통합 저장(`POST /api/v1/practice/save`) API 구현

- **작업 일시:** 2026-10-30
- **역할:** 주니어
- **기준 명세:** [개발산출물/명세/K1-1_구현명세.md](../명세/K1-1_구현명세.md)
- **체크리스트 점검:** [개발산출물/주니어_체크리스트.md](../주니어_체크리스트.md) 전 항목 점검 완료

---

## 1. 만든·고친 파일 목록

| 구분 | 경로 | 한 줄 설명 |
| --- | --- | --- |
| 신규 | `src/main/kotlin/ulevelp/api/JsonInput.kt` | 요청 JSON 읽기 및 필수/선택 필드(`requireString`, `optString`, `requireUuid`, `requireDate`, `requireDouble`, `optDouble`, `optInt`, `optBoolean`, `requireArray`, `parsePathUuid`) 검증 헬퍼 |
| 신규 | `src/main/kotlin/ulevelp/db/OutboxRepository.kt` | 노션 실시간 동기화 활성화 시 `sync_outbox` 대기열 적재 (`upsert` 중복 방지, `delete`는 항상 삽입) |
| 신규 | `src/main/kotlin/ulevelp/service/VideoMetaClient.kt` | 유튜브 제목·채널 조회 인터페이스(`VideoMetaClient`) 및 표준 oEmbed 클라이언트 구현체(`YoutubeOEmbedClient`, 3초 타임아웃, 예외 격리) |
| 신규 | `src/main/kotlin/ulevelp/service/SongService.kt` | 곡 DTO 14필드, 곡 목록·조회·추가(oEmbed 조회 연동)·수정·삭제(하위 cascade 및 supabase 스토리지 trash 적재)·기기 기록 이관 |
| 신규 | `src/main/kotlin/ulevelp/service/PracticeService.kt` | 플레이어 저장 DTO + `saveProgress` (곡 위치 갱신 + 당일 세션 원자적 합산 + 60초 미만 신규 보류 `keep: true`) |
| 신규 | `src/main/kotlin/ulevelp/routes/SongRoutes.kt` | `/api/v1/songs*` REST 라우트 (`GET/POST`, `/by-video/{videoId}`, `/migrate-local`, `PATCH/DELETE /{songId}`) |
| 신규 | `src/main/kotlin/ulevelp/routes/PracticeRoutes.kt` | `/api/v1/practice/save` 라우트 |
| 수정 | `src/main/kotlin/ulevelp/Main.kt` | `module()` 인자 2개(`videoMetaClient`, `publicAppUrl`) 추가, 서비스 생성, 라우트 등록, `parsePublicAppUrl` 구현 |
| 수정 | `src/main/kotlin/ulevelp/routes/MeRoutes.kt` | 중복 private `parseJsonObjectBody` 삭제 → `receiveJsonObject()` 공통 헬퍼 사용으로 교체 |
| 신규 | `src/test/kotlin/ulevelp/support/ApiTestSupport.kt` | 테스트 공용: JWT EC 서명 도구(`TestJwt`), 가짜 oEmbed 클라이언트(`FakeVideoMetaClient`), 테스트 앱 구성(`configureApiTestApp`), 표준 에러 단언(`assertStandardError`) |
| 신규 | `src/test/kotlin/ulevelp/song/SongApiTest.kt` | 곡 API 통합 테스트 (S1~S12 전체 통과) |
| 신규 | `src/test/kotlin/ulevelp/song/PracticeSaveApiTest.kt` | 저장 API 통합 테스트 (P1~P10 전체 통과) |
| 신규 | `src/test/kotlin/ulevelp/song/YoutubeOEmbedClientTest.kt` | oEmbed 클라이언트 단위 테스트 (Y1~Y4 전체 통과) |
| 신규 | `개발산출물/결과/K1-1_곡세션API.md` | 작업 결과 및 실행 증적 기록 (이 파일) |
| 수정 | `개발산출물/진행_코틀린서버.md` | 3절 상태, 5절 결과 기록, 6절 문제, 7절 다음 세션 시작 지시 갱신 |

---

## 2. 완료 기준 및 테스트 실행 결과

### 2.1 `./gradlew test --no-daemon` 실행 결과 (끝 40줄)

```text
SongApiTest > S5 by-video() PASSED

SongApiTest STANDARD_OUT
    2026-10-30 15:15:59.714 [Test worker] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-19 - Shutdown initiated...
    2026-10-30 15:15:59.715 [Test worker] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-19 - Shutdown completed.

YoutubeOEmbedClientTest > Y2 404 - 비 200 상태 코드는 null 반환() STANDARD_OUT
    2026-10-30 15:15:59.725 [DefaultDispatcher-worker-1] WARN  ulevelp.service.YoutubeOEmbedClient - oEmbed 조회 실패 videoId=dQw4w9WgXcQ: HTTP status 404

YoutubeOEmbedClientTest > Y2 404 - 비 200 상태 코드는 null 반환() PASSED

YoutubeOEmbedClientTest > Y1 성공 - oEmbed 정상 응답 파싱 및 쿼리 파라미터 확인() PASSED

YoutubeOEmbedClientTest > Y4 시간 초과 - 타임아웃 발생 시 null 반환() STANDARD_OUT
    2026-10-30 15:16:00.244 [DefaultDispatcher-worker-1] WARN  ulevelp.service.YoutubeOEmbedClient - oEmbed 조회 실패 videoId=dQw4w9WgXcQ: request timed out
    java.net.http.HttpTimeoutException: request timed out
    	at java.net.http/jdk.internal.net.http.HttpClientImpl.send(HttpClientImpl.java:953)
    	at java.net.http/jdk.internal.net.http.HttpClientFacade.send(HttpClientFacade.java:133)
    	at ulevelp.service.YoutubeOEmbedClient$fetch$2.invokeSuspend(VideoMetaClient.kt:43)
    	at kotlin.coroutines.jvm.internal.BaseContinuationImpl.resumeWith(ContinuationImpl.kt:34)
    	at kotlinx.coroutines.DispatchedTask.run(DispatchedTask.kt:100)
    	at kotlinx.coroutines.internal.LimitedDispatcher$Worker.run(LimitedDispatcher.kt:124)
    	at kotlinx.coroutines.scheduling.TaskImpl.run(Tasks.kt:89)
    	at kotlinx.coroutines.scheduling.CoroutineScheduler.runSafely(CoroutineScheduler.kt:586)
    	at kotlinx.coroutines.scheduling.CoroutineScheduler$Worker.executeTask(CoroutineScheduler.kt:798)
    	at kotlinx.coroutines.scheduling.CoroutineScheduler$Worker.runWorker(CoroutineScheduler.kt:717)
    	at kotlinx.coroutines.scheduling.CoroutineScheduler$Worker.run(CoroutineScheduler.kt:704)

YoutubeOEmbedClientTest > Y4 시간 초과 - 타임아웃 발생 시 null 반환() PASSED

YoutubeOEmbedClientTest > Y3 깨진 JSON - 파싱 오류 시 null 반환() STANDARD_OUT
    2026-10-30 15:16:01.253 [DefaultDispatcher-worker-1] WARN  ulevelp.service.YoutubeOEmbedClient - oEmbed 조회 실패 videoId=dQw4w9WgXcQ: Unexpected JSON token at offset 5: Expected EOF after parsing, but had j instead at path: $
    JSON input: not json
    kotlinx.serialization.json.JsonDecodingException: Unexpected JSON token at offset 5: Expected EOF after parsing, but had j instead at path: $
    JSON input: not json
    	at kotlinx.serialization.json.internal.JsonExceptionsKt.decodingExceptionOf(JsonExceptions.kt:48)
    	at kotlinx.serialization.json.internal.AbstractJsonLexer.fail(AbstractJsonLexer.kt:583)
    	at kotlinx.serialization.json.internal.AbstractJsonLexer.fail$default(AbstractJsonLexer.kt:582)
    	at kotlinx.serialization.json.internal.AbstractJsonLexer.expectEof(AbstractJsonLexer.kt:194)
    	at kotlinx.serialization.json.Json.decodeFromString(Json.kt:150)
    	at kotlinx.serialization.json.Json.parseToJsonElement(Json.kt:179)
    	at ulevelp.service.YoutubeOEmbedClient$fetch$2.invokeSuspend(VideoMetaClient.kt:49)
    	at kotlin.coroutines.jvm.internal.BaseContinuationImpl.resumeWith(ContinuationImpl.kt:34)
    	at kotlinx.coroutines.DispatchedTask.run(DispatchedTask.kt:100)
    	at kotlinx.coroutines.internal.LimitedDispatcher$Worker.run(LimitedDispatcher.kt:124)
    	at kotlinx.coroutines.scheduling.TaskImpl.run(Tasks.kt:89)
    	at kotlinx.coroutines.scheduling.CoroutineScheduler.runSafely(CoroutineScheduler.kt:586)
    	at kotlinx.coroutines.scheduling.CoroutineScheduler$Worker.executeTask(CoroutineScheduler.kt:798)
    	at kotlinx.coroutines.scheduling.CoroutineScheduler$Worker.runWorker(CoroutineScheduler.kt:717)
    	at kotlinx.coroutines.scheduling.CoroutineScheduler$Worker.run(CoroutineScheduler.kt:704)

YoutubeOEmbedClientTest > Y3 깨진 JSON - 파싱 오류 시 null 반환() PASSED

BUILD SUCCESSFUL in 17s
5 actionable tasks: 1 executed, 4 up-to-date
```

### 2.2 `npm test` 실행 결과 (끝 6줄)

```text
✔ 틀린 예 bad-f.js → (f) 검사가 실패한다 (1.2735ms)
✔ 틀린 예 bad-g.js → (g) 검사가 실패한다 (0.4089ms)
✔ 틀린 예 폴더의 파일이 모두 표에 있다 (0.2278ms)
ℹ tests 37
ℹ suites 0
ℹ pass 37
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 264.0589
```

### 2.3 라우트 등록 및 인증 검증 (curl 3개)

서버를 `./gradlew run`으로 로컬 기동 후 호출한 실제 응답 코드:
```text
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:3000/api/v1/songs
-> 401
curl.exe -s -X POST -o NUL -w "%{http_code}`n" http://localhost:3000/api/v1/practice/save
-> 401
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:3000/api/v1/nope
-> 404
```

### 2.4 코드 정적 점검 결과

- `raw SQL 없음`: `git grep "exec(" src/main/kotlin` -> 매칭 없음(종료 코드 1)
- `SONG_NOT_FOUND 없음`: `git grep "SONG_NOT_FOUND" src` -> 매칭 없음(종료 코드 1)
- `oEmbed는 트랜잭션 밖`: `SongService.kt` 180번째 줄(`val meta = videoMetaClient.fetch(input.videoId)`) 및 327번째 줄(`val meta = videoMetaClient.fetch(item.videoId)`) 모두 `DatabaseFactory.dbQuery` 블록 바깥에서 비동기 I/O로 실행됨을 직접 확인함.

---

## 3. K1-2(녹음 API & 스토리지 연동)가 쓸 값

1. **`OutboxRepository.enqueueIfSyncEnabled(userId: UUID, entity: String, entityId: UUID, op: String)`:**
   - 노션 동기화(`notion_sync.enabled = true`) 상태일 때만 `sync_outbox`에 적재합니다.
   - K1-2에서 녹음이 추가/삭제될 때 `entity = "take"`, `op = "upsert"` 또는 `"delete"`로 호출합니다. (반드시 트랜잭션 안에서 호출)
2. **`SongService.delete(userId: UUID, songId: UUID): List<Long>`:**
   - 곡 삭제 시 종속된 `takes` 중 `storage = 'supabase'`인 레코드의 키를 `storage_trash` 테이블에 INSERT하고 그 `id` 목록을 반환합니다.
   - K1-2에서 즉시 스토리지 파일 삭제 작업 시 이 반환된 `storage_trash.id` 목록을 활용할 수 있습니다.
3. **`TestJwt` & `configureApiTestApp`:**
   - `src/test/kotlin/ulevelp/support/ApiTestSupport.kt`에 배치되어 있습니다.
   - `TestJwt.token(userId)`로 유효한 Supabase JWT(ES256)를 쉽게 생성할 수 있습니다.
   - `configureApiTestApp(dbConfig)`을 통해 테스트 환경 모듈을 일관되게 주입할 수 있습니다.
4. **`requireDate(name)` 유효 범위:**
   - `2000-01-01`부터 UTC 기준 `내일(LocalDate.now(ZoneOffset.UTC).plusDays(1))`까지 허용됩니다.

---

## 4. 명세와 달라진 점

1. `normalizeStatus`가 `"연습중"`(띄어쓰기 없음)도 허용 (사용자 편의 입력 허용).
2. 세션 INSERT 시 `rate`가 null일 때 컬럼 할당 생략 (DB nullable 컬럼 및 default 없음).
3. `Main.kt` import는 와일드카드(`ulevelp.routes.*`) 대신 개별 import로 유지.

---

## 5. 겪은 문제와 해결

1. **Kotlin 문자열 템플릿 한글 식별자 해석 이슈:**
   - `JsonInput.kt`에서 `"$name은(는) ..."` 형태로 작성했을 때 Kotlin 컴파일러가 `name은`을 식별자로 파싱하여 `Unresolved reference 'name은'` 오류가 발생했습니다.
   - `${name}은(는) ...`와 같이 중괄호(`${name}`)를 명시하여 변수명을 정확히 격리함으로써 정상 컴파일되도록 해결했습니다.
2. **PowerShell 구문 주의:**
   - Windows PowerShell 환경에서는 `&&` 대신 세미콜론(`;`)을 사용해야 하며, curl 명령 시 기본 별칭 충돌을 피하기 위해 `curl.exe`를 사용했습니다.

