# 결과: K4-1 — 외부 연동 키 관리 API(`/api/v1/integrations`) & `SETTING` 키 칸 + `ulp:keys` 캐시

- **작업일:** 2026-11-01
- **역할:** 주니어
- **브랜치:** `step/K4-1`
- **상태:** `완료`
- **PR:** #23

---

## 1. 만든·고친 파일

| 구분 | 경로 | 하는 일 |
| :--- | :--- | :--- |
| 수정 | `src/main/kotlin/ulevelp/security/CryptoService.kt` | `fromEnvOrNull(env)` 및 `normalizeNotionDatabaseId(dbId)` 헬퍼 추가 |
| 신규 | `src/main/kotlin/ulevelp/service/IntegrationCheckClient.kt` | 노션 DB 3개 속성 스키마 점검 및 Gemini 모델 유효성 점검 클라이언트 인터페이스 + HTTP 구현체 |
| 신규 | `src/main/kotlin/ulevelp/service/IntegrationService.kt` | 외부 연동 키 목록 조회, 노션/Gemini 키 AES-256-GCM 저장·수정, 연결 점검, 연결 해제 및 복호화 서비스 |
| 신규 | `src/main/kotlin/ulevelp/routes/IntegrationRoutes.kt` | `/api/v1/integrations` 하위 5개 엔드포인트 라우트 |
| 수정 | `src/main/kotlin/ulevelp/Main.kt` | `Application.module`에 `cryptoService`, `integrationCheckClient` 기본 인자 추가 및 `registerIntegrationRoutes` 등록 |
| 수정 | `src/test/kotlin/ulevelp/support/ApiTestSupport.kt` | `TestCrypto` 고정 테스트 마스터 키, `FakeIntegrationCheckClient`, `configureApiTestApp` 인자 확장 |
| 신규 | `src/test/kotlin/ulevelp/integration/IntegrationApiTest.kt` | 키 등록·마스킹·부분 수정·연결 점검·해제·교차 접근 차단 통합 테스트 (6.1절 K1~K12 전수 통과) |
| 수정 | `public/data.js` | `ULData.integrations.{list, saveNotion, saveGemini, check, remove}` 및 `ULData.getCachedKeys` 추가 |
| 수정 | `public/settings.html` | `#account`에 녹음 스토리지 사용량 막대(`#quotaBar`, `#quotaText`) 추가, `#keys` 섹션(노션 키·DB ID 3개, Gemini 키·모델 입력·저장·점검·해제 UI) 추가 |
| 수정 | `public/settings.js` | `#keys` 섹션 및 쿼터 막대 렌더링·이벤트 연결, `ulp:keys` 캐시 동기화 |
| 수정 | `public/site.css` | `#keys` 카드, 상태 배지, 쿼터 `<progress>` 스타일 추가 |
| 수정 | `test/data.test.js` | `D20`~`D23` 단위 테스트 추가 |
| 수정 | `test/e2e/xss.spec.js` | `E9` 설정 화면 외부 연동 키 상태·DB ID·오류 메시지 XSS 페이로드 검사 추가 |
| 수정 | `개발산출물/자료/csp_check.js` | 설정 화면 항목에서 `#keys` 섹션 존재 함께 확인 (`hasKeysSec: true`) |
| 신규 | `개발산출물/결과/K4-1_키등록API.md` | 결과 보고서 |
| 수정 | `개발산출물/진행_코틀린서버.md` | 3·5·6·7절 갱신 |

---

## 2. 검증 실행 결과

### 2.1 `./gradlew test --no-daemon` 실행 결과 (끝 30줄)

```text
TakeApiTest > T11 녹음 삭제 - 파일 제거 및 쿼터 반환() PASSED

TakeApiTest > T3 쿼터 사전 거부() STANDARD_OUT
    2026-11-01 19:56:43.508 [DefaultDispatcher-worker-2 @call-context#4961] INFO  io.ktor.test - No ktor.deployment.watch patterns specified, automatic reload is not active.
    2026-11-01 19:56:43.508 [DefaultDispatcher-worker-2 @coroutine#4962] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-87 - Starting...
    2026-11-01 19:56:43.512 [DefaultDispatcher-worker-2 @coroutine#4962] INFO  com.zaxxer.hikari.pool.HikariPool - HikariPool-87 - Added connection org.postgresql.jdbc.PgConnection@67d8a0f5
    2026-11-01 19:56:43.513 [DefaultDispatcher-worker-2 @coroutine#4962] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-87 - Start completed.
    2026-11-01 19:56:43.513 [DefaultDispatcher-worker-2 @call-context#4961] INFO  io.ktor.test - Application started in 0.005 seconds.
    2026-11-01 19:56:43.513 [DefaultDispatcher-worker-16 @coroutine#4963] INFO  io.ktor.test - Responding at http://localhost:80
    2026-11-01 19:56:43.513 [DefaultDispatcher-worker-16 @coroutine#4963] INFO  io.ktor.test - Responding at https://localhost:443
    2026-11-01 19:56:43.539 [DefaultDispatcher-worker-12] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-87 - Shutdown initiated...
    2026-11-01 19:56:43.539 [DefaultDispatcher-worker-12] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-87 - Shutdown completed.

TakeApiTest > T3 쿼터 사전 거부() PASSED

TakeApiTest > T7 크기 경계() STANDARD_OUT
    2026-11-01 19:56:43.543 [DefaultDispatcher-worker-12 @call-context#5013] INFO  io.ktor.test - No ktor.deployment.watch patterns specified, automatic reload is not active.
    2026-11-01 19:56:43.543 [DefaultDispatcher-worker-12 @coroutine#5014] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-88 - Starting...
    2026-11-01 19:56:43.547 [DefaultDispatcher-worker-12 @coroutine#5014] INFO  com.zaxxer.hikari.pool.HikariPool - HikariPool-88 - Added connection org.postgresql.jdbc.PgConnection@2b72660a
    2026-11-01 19:56:43.547 [DefaultDispatcher-worker-12 @coroutine#5014] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-88 - Start completed.
    2026-11-01 19:56:43.547 [DefaultDispatcher-worker-12 @call-context#5013] INFO  io.ktor.test - Application started in 0.004 seconds.
    2026-11-01 19:56:43.547 [DefaultDispatcher-worker-18 @coroutine#5015] INFO  io.ktor.test - Responding at http://localhost:80
    2026-11-01 19:56:43.547 [DefaultDispatcher-worker-18 @coroutine#5015] INFO  io.ktor.test - Responding at https://localhost:443
    2026-11-01 19:56:43.622 [DefaultDispatcher-worker-4] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-88 - Shutdown initiated...
    2026-11-01 19:56:43.622 [DefaultDispatcher-worker-4] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-88 - Shutdown completed.

TakeApiTest > T7 크기 경계() PASSED

TakeApiTest > T9 mime 파라미터 제거() STANDARD_OUT
    2026-11-01 19:56:43.629 [DefaultDispatcher-worker-16 @call-context#5069] INFO  io.ktor.test - No ktor.deployment.watch patterns specified, automatic reload is not active.
    2026-11-01 19:56:43.629 [DefaultDispatcher-worker-16 @coroutine#5070] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-89 - Starting...
    2026-11-01 19:56:43.633 [DefaultDispatcher-worker-16 @coroutine#5070] INFO  com.zaxxer.hikari.pool.HikariPool - HikariPool-89 - Added connection org.postgresql.jdbc.PgConnection@3025f9e
    2026-11-01 19:56:43.633 [DefaultDispatcher-worker-16 @coroutine#5070] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-89 - Start completed.
    2026-11-01 19:56:43.633 [DefaultDispatcher-worker-16 @call-context#5069] INFO  io.ktor.test - Application started in 0.004 seconds.
    2026-11-01 19:56:43.633 [DefaultDispatcher-worker-2 @coroutine#5071] INFO  io.ktor.test - Responding at http://localhost:80
    2026-11-01 19:56:43.633 [DefaultDispatcher-worker-2 @coroutine#5071] INFO  io.ktor.test - Responding at https://localhost:443
    2026-11-01 19:56:43.652 [DefaultDispatcher-worker-16] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-89 - Shutdown initiated...
    2026-11-01 19:56:43.652 [DefaultDispatcher-worker-16] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-89 - Shutdown completed.

TakeApiTest > T9 mime 파라미터 제거() PASSED

TakeApiTest STANDARD_OUT
    2026-11-01 19:56:43.670 [Test worker] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-70 - Shutdown initiated...
    2026-11-01 19:56:43.671 [Test worker] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-70 - Shutdown completed.

BUILD SUCCESSFUL in 15s
5 actionable tasks: 4 executed, 1 up-to-date
```

### 2.2 `npm test` 실행 결과 (끝 10줄)

```text
✔ 틀린 예 bad-e.js → (e) 검사가 실패한다 (0.047583ms)
✔ 틀린 예 bad-f.js → (f) 검사가 실패한다 (0.053583ms)
✔ 틀린 예 bad-g.js → (g) 검사가 실패한다 (0.054917ms)
✔ 틀린 예 폴더의 파일이 모두 표에 있다 (0.066042ms)
ℹ tests 60
ℹ suites 0
ℹ pass 60
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 178.073125
```

### 2.3 `npm run test:e2e` 실행 결과 (전체)

```text
> guitar-chord-lab@1.0.0 test:e2e
> playwright test


Running 9 tests using 1 worker

     1 …/e2e/xss.spec.js:382:1 › E1 첫 화면(index.html) 곡 목록 및 노션 바로가기
  ✓  1 ….spec.js:382:1 › E1 첫 화면(index.html) 곡 목록 및 노션 바로가기 (626ms)     2 …e/xss.spec.js:401:1 › E2 플레이어(practice.html) 곡 제목 및 곡 목록 서랍
  ✓  2 …ec.js:401:1 › E2 플레이어(practice.html) 곡 제목 및 곡 목록 서랍 (567ms)     3 …2e/xss.spec.js:417:1 › E3 기록 화면(log.html) 기록 탭·세션 목록·녹음 URL
  ✓  3 …pec.js:417:1 › E3 기록 화면(log.html) 기록 탭·세션 목록·녹음 URL (549ms)     4 …› test/e2e/xss.spec.js:438:1 › E4 기록 화면(log.html#songs) 곡 보관함 탭
  ✓  4 …2e/xss.spec.js:438:1 › E4 기록 화면(log.html#songs) 곡 보관함 탭 (498ms)     5 ….spec.js:455:1 › E5 곡 상세 화면(log.html?song=...) 타임라인 및 A/B 비교
  ✓  5 …:455:1 › E5 곡 상세 화면(log.html?song=...) 타임라인 및 A/B 비교 (538ms)     6 …est/e2e/xss.spec.js:476:1 › E6 설정 화면(settings.html) 계정 프로필 표시
  ✓  6 …xss.spec.js:476:1 › E6 설정 화면(settings.html) 계정 프로필 표시 (479ms)     7 [chromium] › test/e2e/xss.spec.js:493:1 › E7 대조군(검출기 작동 확인)
  ✓  7 …mium] › test/e2e/xss.spec.js:493:1 › E7 대조군(검출기 작동 확인) (718ms)     8 …c.js:512:1 › E8 설정 화면(settings.html) 노션 백업 ZIP 미리보기 XSS 검사
  ✓  8 …:1 › E8 설정 화면(settings.html) 노션 백업 ZIP 미리보기 XSS 검사 (681ms)     9 …568:1 › E9 설정 화면(settings.html) 외부 연동 키 상태·점검 결과 XSS 검사
  ✓  9 …E9 설정 화면(settings.html) 외부 연동 키 상태·점검 결과 XSS 검사 (547ms)
  9 passed (5.7s)
```

### 2.4 `node 개발산출물/자료/csp_check.js` 실행 결과

```text
브라우저: Chrome/134.0.6998.35 | 대상: http://localhost:3000/

[OK] 옛 키 복사(theme.js) (index.html)
  CSP 위반: 없음 | 콘솔 Refused: 없음 | 오류: 없음 | __xss: false
  값: {"theme":"dark","copied":"dark","tab":"matrix","lead":"2","oldKept":"dark","flag":"1","practiceLinkHidden":true,"notesLink":"https://www.notion.so/x","cur":"chords.html#matrix"}

[OK] 첫 화면 링크 붙여넣기 (index.html)
  CSP 위반: 없음 | 콘솔 Refused: 없음 | 오류: 없음 | __xss: false
  값: {"thumb":"https://i.ytimg.com/vi/jNQXAC9IVRw/mqdefault.jpg","play":"practice.html?v=jNQXAC9IVRw"}

[OK] 첫 화면 비로그인 곡 안내 (index.html)
  CSP 위반: 없음 | 콘솔 Refused: 없음 | 오류: 없음 | __xss: false
  값: {"songs":"로그인하면 내 연습 곡이 여기 보여요"}

[OK] 코드 연습실 전체 탭 (chords.html)
  CSP 위반: 없음 | 콘솔 Refused: 없음 | 오류: 없음 | __xss: false
  값: {"svgs":130,"strokeAttr":true,"styleAttr":0}

[OK] 플레이어 + 유튜브 (practice.html?v=jNQXAC9IVRw)
  CSP 위반: 없음 | 콘솔 Refused: 없음 | 오류: 없음 | __xss: false
  값: {"iframe":true,"title":"Me at the zoo"}

[OK] 플레이어 비로그인 기기 저장 (practice.html?v=jNQXAC9IVRw)
  CSP 위반: 없음 | 콘솔 Refused: 없음 | 오류: 없음 | __xss: false
  값: {"local":"{\"videoId\":\"jNQXAC9IVRw\",\"pos\":0,\"a\":null,\"b\":null,\"rate\":1,\"date\":\"2026-11-01\"}","old":null,"sync":"이 기기에 저장됨 · 로그인하면 계정에 저장돼요"}

[OK] 학습 노트 + GitHub API(connect-src) (notes.html?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DjNQXAC9IVRw)
  CSP 위반: 없음 | 콘솔 Refused: 없음 | 오류: 없음 | __xss: false
  값: {"preview":"https://i.ytimg.com/vi/jNQXAC9IVRw/mqdefault.jpg","runs":"토큰이 잘못됐거나 만료됐어요. (401 Bad credentials)"}

[OK] 기록 화면 비로그인 (log.html) (log.html)
  CSP 위반: 없음 | 콘솔 Refused: 없음 | 오류: 없음 | __xss: false
  값: {"guestVisible":true,"title":"Log"}

[OK] 곡 상세 화면 비로그인 (log.html?song=...) (log.html?song=00000000-0000-0000-0000-000000000001)
  CSP 위반: 없음 | 콘솔 Refused: 없음 | 오류: 없음 | __xss: false
  값: {"guestVisible":true,"detailHidden":true}

[OK] 개인정보처리방침 (privacy.html) (privacy.html)
  CSP 위반: 없음 | 콘솔 Refused: 없음 | 오류: 없음 | __xss: false
  값: {"title":"Privacy","h1":"1. 수집하는 개인정보 항목"}

[OK] 설정 + 테마 버튼 (settings.html)
  CSP 위반: 없음 | 콘솔 Refused: 없음 | 오류: 없음 | __xss: false
  값: {"theme":"light","saved":"light","old":null,"templateHref":"https://app.notion.com/p/4097a337e26f8167aa10eb435edb676e?source=copy_link","hasKeysSec":true}

[OK] 대조군(막혀야 함) (index.html)
  CSP 위반: [ 'connect-src https://example.com/', 'style-src-attr inline' ] | 콘솔 Refused: [
  `Refused to connect to 'https://example.com/' because it violates the following Content Security Policy directive: "connect-src 'self' https://vefrfhafmiiivpgjhqiu.supabase.co https://script.google.com`,
  "Fetch API cannot load https://example.com/. Refused to connect because it violates the document's Content Security Policy.",
  `Refused to apply inline style because it violates the following Content Security Policy directive: "style-src 'self' https://fonts.googleapis.com". Either the 'unsafe-inline' keyword, a hash ('sha256-`
] | 오류: 없음 | __xss: false

화면 12개 중 실패 0개
```

---

## 3. K4-2·K4-3가 쓸 값

1. **`IntegrationService.requireDecryptedNotion` 및 `requireDecryptedGemini` 시그니처:**
   - 클래스: `ulevelp.service.IntegrationService`
   - 메서드:
     ```kotlin
     internal suspend fun requireDecryptedNotion(userId: UUID, appId: String = "ulevelp"): DecryptedNotionIntegration
     internal suspend fun requireDecryptedGemini(userId: UUID, appId: String = "ulevelp"): DecryptedGeminiIntegration
     ```
   - 반환 모델:
     ```kotlin
     data class DecryptedNotionIntegration(
         val token: String,
         val songsDb: String,
         val sessionsDb: String,
         val notesDb: String?
     )

     data class DecryptedGeminiIntegration(
         val apiKey: String,
         val model: String
     )
     ```
   - 동작: 등록된 키가 없거나 키가 손상된 경우 `412 PreconditionFailed`(`code = "NO_KEY"`) 예외를 던지며, 마스터 키 미설정 시 `503 ServiceUnavailable`(`code = "CRYPTO_UNAVAILABLE"`) 예외를 던집니다.
2. **`TestCrypto` 테스트 마스터 키 객체:**
   - 위치: `src/test/kotlin/ulevelp/support/ApiTestSupport.kt`
   - 정의:
     ```kotlin
     object TestCrypto {
         val keyBytes = ByteArray(32) { (it + 1).toByte() }
         val service = CryptoService(keyBytes)
     }
     ```
   - `FakeIntegrationCheckClient`와 함께 `configureApiTestApp`에 기본 주입되어 단위·통합 테스트에서 별도 마스터 키 환경 변수 없이 동작합니다.

---

## 4. 명세와 달라진 점 및 겪은 문제

1. **명세와 달라진 점 (시니어 리뷰 1~4번 반영):**
   - **리뷰 1번 (loadKeys 중복 호출 억제):** `public/settings.js`의 `loadKeys(nextUid)`를 `auth.onChange`의 `if (!nextUid || nextUid !== activeUid)` 블록 안으로 옮겨 uid가 바뀔 때 1회만 호출되도록 수정하였습니다. 이를 통해 키 저장/해제 시 타 카드의 미저장 입력(노션 DB ID 등)이 초기화되지 않도록 보호하고, E2E `E9` 테스트에 페이지 로드 시 `/api/v1/integrations` 1회 호출 단언(`expect(integrationsListCalls).toBe(1)`)을 추가하였습니다.
   - **리뷰 2번 (상태 변경 시 이전 목록 조회 응답 무효화):** `public/settings.js`의 6개 키 조작 버튼 핸들러에서 요청 발송 직전 `keysReqSeq++`를 호출하여, 목록 조회가 진행 중인 상태에서 저장/해제/점검을 수행했을 때 늦게 도착한 이전 조회의 응답이 방금 갱신된 카드 상태를 덮어쓰지 못하도록 무효화하였습니다.
   - **리뷰 3번 (loadKeys 실패 사용자 피드백):** `public/settings.js`의 `loadKeys`의 빈 `catch`를 제거하고, `say('ntnKeyMsg', msg, 'err')` 및 `say('gemKeyMsg', msg, 'err')`로 에러 메시지를 표시하도록 개선하였습니다.
   - **리뷰 4번 (서비스 레이어 중복 복호화 로직 일원화):** `IntegrationService.kt`의 `checkNotion` 및 `checkGemini`에서 중복 작성되어 있던 조회·412·복호화 로직을 제거하고, 내부 공통 함수인 `requireDecryptedNotion` 및 `requireDecryptedGemini`를 직접 호출하여 단일 진실 공급원(Single Source of Truth)을 유지하도록 단순화하였습니다.
   - *(5~7번은 시니어 안내에 따라 K4-2 단계로 이월)*
2. **겪은 문제:**
   - `IntegrationRoutes.kt` 작성 시 `call.parameters["provider"]`가 nullable(`String?`)이어서 `delete(userId, appId, provider)` 호출 시 컴파일 오류가 발생하였음. `if (provider == null || provider !in VALID_PROVIDERS) throw NotFoundException("지원하지 않는 연동 공급자입니다.")` 가드를 명시하여 스마트 캐스트를 통해 해결함.
   - `test/data.test.js`의 `D23` 단위 테스트에서 Node 22+ vm 샌드박스 객체 프로토타입 불일치로 `assert.deepEqual` 실패가 발생하였음 (`과거 겪은 문제 153번 패턴`). 반환 객체를 `{ ...cached }` 형태로 얕은 복사하여 비교하도록 수정하여 통과함.
   - Playwright 실행 시 `test-results/` 임시 폴더가 생성되었으나, 무관한 파일 커밋 방지(12대 가드레일)를 준수하여 삭제함.

