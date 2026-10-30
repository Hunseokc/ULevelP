# K1-2 결과 — 녹음(`Takes`) API & 스토리지 연동

- **작업자:** 주니어
- **날짜:** 2026-10-30
- **근거 명세:** [개발산출물/명세/K1-2_구현명세.md](../명세/K1-2_구현명세.md)
- **점검 기준:** [개발산출물/주니어_체크리스트.md](../주니어_체크리스트.md)

---

## 1. 만든·고친 파일

| 구분 | 파일 경로 | 변경 내용 요약 |
| :--- | :--- | :--- |
| 신규 | `src/main/kotlin/ulevelp/storage/StorageClient.kt` | 스토리지 인터페이스(`upload`, `createSignedUrl`, `delete`) 및 `StorageException` 정의 |
| 신규 | `src/main/kotlin/ulevelp/storage/SupabaseStorageClient.kt` | Supabase Storage REST API 클라이언트(Java 11 HttpClient, `withContext(Dispatchers.IO)`, `x-upsert: false`) |
| 신규 | `src/main/kotlin/ulevelp/service/TakeService.kt` | 녹음 업로드(2단계 쿼터 검증, 트랜잭션 밖 스토리지 업로드, 0초 세션 `ensureSession`), 서명 URL, 삭제(trash 경유) |
| 신규 | `src/main/kotlin/ulevelp/service/StorageTrashService.kt` | 커밋된 `storage_trash` 즉시 정리 purge 서비스 (트랜잭션 밖 delete 및 예외 격리) |
| 신규 | `src/main/kotlin/ulevelp/routes/TakeRoutes.kt` | `POST /api/v1/takes`, `GET /api/v1/takes/{takeId}/url`, `DELETE /api/v1/takes/{takeId}` 라우트 |
| 수정 | `src/main/kotlin/ulevelp/api/JsonInput.kt` | `requireInt(name, min, max)`, `requireInstant(name)` 추가 (UTC 정규화 및 날짜 범위 검증) |
| 수정 | `src/main/kotlin/ulevelp/routes/SongRoutes.kt` | `registerSongRoutes`에 `StorageTrashService` 주입 및 곡 삭제 시 `storageTrashService.purge(ids)` 연동 |
| 수정 | `src/main/kotlin/ulevelp/Main.kt` | `module`에 `storageClient` 기본값 파라미터 추가, 미설정 경고 로그, 서비스 생성 및 `registerTakeRoutes` 등록 |
| 신규 | `src/test/kotlin/ulevelp/support/FakeStorageClient.kt` | 테스트용 인메모리 스토리지 클라이언트 (`objects`, `deleted`, `failUpload`, `failSign`, `failDelete`, `uploadDelayMs`) |
| 수정 | `src/test/kotlin/ulevelp/support/ApiTestSupport.kt` | `configureApiTestApp`에 `storageClient: StorageClient? = null` 인자 추가 |
| 신규 | `src/test/kotlin/ulevelp/take/SupabaseStorageClientTest.kt` | Supabase Storage REST 요청 규격 단위 테스트 (C1~C6) |
| 신규 | `src/test/kotlin/ulevelp/take/TakeApiTest.kt` | 녹음 API 통합 테스트 (T1~T17: 쿼터 경합, 복구 트랜잭션, 0초 세션, outbox 등) |

---

## 2. 완료 기준 검증 증적

### 2.1 `./gradlew test --no-daemon` 실행 결과 (끝 40줄)

```text
TakeApiTest > T3 쿼터 사전 거부() STANDARD_OUT
    2026-10-30 15:54:31.961 [DefaultDispatcher-worker-19 @call-context#1795] INFO  io.ktor.test - No ktor.deployment.watch patterns specified, automatic reload is not active.
    2026-10-30 15:54:31.961 [DefaultDispatcher-worker-19 @coroutine#1796] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-47 - Starting...
    2026-10-30 15:54:32.000 [DefaultDispatcher-worker-19 @coroutine#1796] INFO  com.zaxxer.hikari.pool.HikariPool - HikariPool-47 - Added connection org.postgresql.jdbc.PgConnection@6ae64587
    2026-10-30 15:54:32.000 [DefaultDispatcher-worker-19 @coroutine#1796] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-47 - Start completed.
    2026-10-30 15:54:32.002 [DefaultDispatcher-worker-19 @call-context#1795] INFO  io.ktor.test - Application started in 0.041 seconds.
    2026-10-30 15:54:32.002 [DefaultDispatcher-worker-7 @coroutine#1797] INFO  io.ktor.test - Responding at http://localhost:80
    2026-10-30 15:54:32.002 [DefaultDispatcher-worker-7 @coroutine#1797] INFO  io.ktor.test - Responding at https://localhost:443
    2026-10-30 15:54:32.156 [DefaultDispatcher-worker-36] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-47 - Shutdown initiated...
    2026-10-30 15:54:32.162 [DefaultDispatcher-worker-36] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-47 - Shutdown completed.

TakeApiTest > T3 쿼터 사전 거부() PASSED

TakeApiTest > T7 크기 경계() STANDARD_OUT
    2026-10-30 15:54:32.180 [DefaultDispatcher-worker-36 @call-context#1847] INFO  io.ktor.test - No ktor.deployment.watch patterns specified, automatic reload is not active.
    2026-10-30 15:54:32.181 [DefaultDispatcher-worker-36 @coroutine#1848] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-48 - Starting...
    2026-10-30 15:54:32.198 [DefaultDispatcher-worker-36 @coroutine#1848] INFO  com.zaxxer.hikari.pool.HikariPool - HikariPool-48 - Added connection org.postgresql.jdbc.PgConnection@637df5a
    2026-10-30 15:54:32.199 [DefaultDispatcher-worker-36 @coroutine#1848] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-48 - Start completed.
    2026-10-30 15:54:32.201 [DefaultDispatcher-worker-36 @call-context#1847] INFO  io.ktor.test - Application started in 0.022 seconds.
    2026-10-30 15:54:32.201 [DefaultDispatcher-worker-23 @coroutine#1849] INFO  io.ktor.test - Responding at http://localhost:80
    2026-10-30 15:54:32.201 [DefaultDispatcher-worker-23 @coroutine#1849] INFO  io.ktor.test - Responding at https://localhost:443
    2026-10-30 15:54:33.197 [DefaultDispatcher-worker-26] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-48 - Shutdown initiated...
    2026-10-30 15:54:33.200 [DefaultDispatcher-worker-26] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-48 - Shutdown completed.

TakeApiTest > T7 크기 경계() PASSED

TakeApiTest > T9 mime 파라미터 제거() STANDARD_OUT
    2026-10-30 15:54:33.218 [DefaultDispatcher-worker-25 @call-context#1903] INFO  io.ktor.test - No ktor.deployment.watch patterns specified, automatic reload is not active.
    2026-10-30 15:54:33.219 [DefaultDispatcher-worker-25 @coroutine#1904] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-49 - Starting...
    2026-10-30 15:54:33.244 [DefaultDispatcher-worker-25 @coroutine#1904] INFO  com.zaxxer.hikari.pool.HikariPool - HikariPool-49 - Added connection org.postgresql.jdbc.PgConnection@64a648ce
    2026-10-30 15:54:33.245 [DefaultDispatcher-worker-25 @coroutine#1904] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-49 - Start completed.
    2026-10-30 15:54:33.246 [DefaultDispatcher-worker-25 @call-context#1903] INFO  io.ktor.test - Application started in 0.028 seconds.
    2026-10-30 15:54:33.246 [DefaultDispatcher-worker-23 @coroutine#1905] INFO  io.ktor.test - Responding at http://localhost:80
    2026-10-30 15:54:33.246 [DefaultDispatcher-worker-23 @coroutine#1905] INFO  io.ktor.test - Responding at https://localhost:443
    2026-10-30 15:54:33.371 [DefaultDispatcher-worker-7] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-49 - Shutdown initiated...
    2026-10-30 15:54:33.420 [DefaultDispatcher-worker-7] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-49 - Shutdown completed.

TakeApiTest > T9 mime 파라미터 제거() PASSED

TakeApiTest STANDARD_OUT
    2026-10-30 15:54:33.558 [Test worker] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-32 - Shutdown initiated...
    2026-10-30 15:54:33.562 [Test worker] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-32 - Shutdown completed.

BUILD SUCCESSFUL in 24s
5 actionable tasks: 1 executed, 4 up-to-date
```

### 2.2 `npm test` 실행 결과 (끝 6줄)

```text
ℹ tests 37
ℹ suites 0
ℹ pass 37
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 262.9802
```

### 2.3 저장소 미설정 기동 및 미인증 curl 검증

- **`./gradlew run` 기동 로그:**
  ```text
  2026-10-30 15:53:26.402 [main] WARN  io.ktor.server.Application - DB 설정(DATABASE_URL / REMOTE_DB_HOST)이 없어 데이터베이스 초기화를 건너뜁니다.
  2026-10-30 15:53:26.402 [main] WARN  io.ktor.server.Application - 인증 설정(SUPABASE_URL)이 없어 JWT 검증기가 비활성화됩니다.
  2026-10-30 15:53:26.403 [main] WARN  io.ktor.server.Application - 녹음 저장소 설정(SUPABASE_URL / SUPABASE_SECRET_KEY)이 없어 녹음 업로드가 비활성화됩니다.
  2026-10-30 15:53:26.574 [main] INFO  io.ktor.server.Application - Application started in 0.659 seconds.
  2026-10-30 15:53:26.763 [DefaultDispatcher-worker-1] INFO  io.ktor.server.Application - Responding at http://127.0.0.1:3000
  ```
- **`curl -s -o NUL -w "%{http_code}\n" -X POST http://localhost:3000/api/v1/takes`:**
  ```text
  401
  ```

### 2.4 코드 정적 점검 결과

1. **스토리지 HTTP 호출은 트랜잭션 밖에서 실행:**
   - `src/main/kotlin/ulevelp/service/TakeService.kt:177` (`client.upload(key, input.bytes, input.mime)`): 140~169줄의 쿼터 사전 검사 `dbQuery` 완료 후, 190~268줄의 DB 레코드 생성 `dbQuery` 시작 전인 트랜잭션 바깥에서 실행됨을 확인함.
   - `src/main/kotlin/ulevelp/service/TakeService.kt:274` (`client.delete(key)`): 트랜잭션 B 예외 발생 시 catch 블록에서 실행됨.
   - `src/main/kotlin/ulevelp/service/TakeService.kt:320` (`client.createSignedUrl(...)`): 306~311줄의 DB 조회 `dbQuery` 바깥에서 실행됨.
2. **비밀 값 하드코딩 없음:**
   - `git grep "sb_secret_" src/main` → 일치 없음(종료 코드 1).
3. **raw SQL 없음:**
   - `git grep "exec(" src/main/kotlin` → 일치 없음(종료 코드 1).
4. **파일 목록 일치:**
   - `git status --short`가 명세 1절 표 파일에만 정확히 일치함.

---

## 3. K1-3(프런트엔드 플레이어 연동)이 쓸 값

### 3.1 `POST /api/v1/takes` 요청 규격
- **요청 Content-Type:** `multipart/form-data`
- **파트 구성:**
  1. `name="metadata"`: `application/json` 문자열
     ```json
     {
       "songId": "550e8400-e29b-41d4-a716-446655440000",
       "date": "2026-10-30",
       "recordedAt": "2026-10-30T14:22:10.512Z",
       "a": 38.0,
       "b": 55.2,
       "rate": 0.75,
       "durationSec": 18,
       "mime": "audio/webm;codecs=opus"
     }
     ```
  2. `name="file"`: 오디오 바이너리 바이트 (`filename="take.webm"`, 최대 50MB)

### 3.2 응답 성공 예시 (`201 Created`)
```json
{
  "ok": true,
  "take": {
    "id": "t1000000-0000-4000-8000-000000000001",
    "sessionId": "s1000000-0000-4000-8000-000000000001",
    "recordedAt": "2026-10-30T14:22:10Z",
    "a": 38.0,
    "b": 55.2,
    "rate": 0.75,
    "durationSec": 18,
    "mime": "audio/webm",
    "sizeBytes": 284120,
    "storage": "supabase",
    "storageKey": "00000000-0000-4000-a000-000000000001/t1000000-0000-4000-8000-000000000001.weba",
    "memo": ""
  }
}
```

### 3.3 에러 코드 및 메시지 목록
| status | code | message |
| :---: | :--- | :--- |
| `413` | `TAKE_TOO_LARGE` | `녹음 파일은 50MB 이하만 올릴 수 있습니다.` |
| `413` | `TAKE_QUOTA_EXCEEDED` | `녹음 저장 한도(${quotaMb}MB)를 넘습니다. 오래된 녹음을 지운 뒤 다시 올려 주세요.` |
| `502` | `STORAGE_ERROR` | `녹음 파일을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.` (URL 조회 실패 시: `재생 주소를 만들지 못했습니다.`) |
| `503` | `STORAGE_UNAVAILABLE` | `녹음 저장소가 설정되어 있지 않습니다.` |

---

## 4. 사람이 할 일 (K1-3 실환경 확인 전)

1. **Supabase Storage 버킷 생성:**
   - Supabase 관리자 대시보드 → **Storage** → `New bucket`
   - 버킷 이름: **`takes`**
   - 설정: **Private bucket** (공개 URL 차단, 서명된 URL로만 열람 가능)
   - 파일 크기 제한(File size limit): **50MB**
2. **서버 환경변수 추가 (`.env` 또는 Cloud Run 환경변수):**
   - `SUPABASE_URL`: Supabase 프로젝트 URL (예: `https://<ref>.supabase.co`)
   - `SUPABASE_SECRET_KEY`: Supabase `service_role` 비밀 키 (스토리지 객체 업로드/서명/삭제 권한용)

---

## 5. 명세와 달라진 점

- **없음:** 명세 1절~7절의 클래스/메서드 시그니처, DTO 필드 12개, 트랜잭션 경계, 예외 응답 형식 규격을 100% 준수하여 구현하였습니다.

---

## 6. 겪은 문제와 해결

1. **Gradle 테스트 캐시 NoClassDefFoundError:**
   - `FakeStorageClient.kt` 추가 후 첫 컴파일 실패 이후 증분 컴파일 상태에서 내부 코루틴 클래스가 누락되는 현상이 발생했습니다.
   - `./gradlew cleanTest test --no-daemon`을 실행하여 빌드 캐시를 초기화하고 클린 테스트를 통과시켰습니다.
2. **Exposed deprecated `slice` API:**
   - Exposed 0.56.0에서 `TakesTable.slice(sumExpr).where { ... }` 형태가 deprecated 및 컴파일 오류를 유발했습니다.
   - `TakesTable.select(sumExpr).where { ... }` 형태로 대체하여 안전하게 쿼터 사용량을 집계하도록 해결했습니다.
