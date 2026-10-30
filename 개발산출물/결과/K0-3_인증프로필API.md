# 결과: K0-3 — 인증 미들웨어(JWT 검증) + 내 프로필/계정 삭제 API(`/api/v1/me`)

- **작업일:** 2026-10-30
- **브랜치:** `step/K0-3`

---

## 1. 구현 파일 및 역할 요약

| 구분 | 경로 | 설명 |
| --- | --- | --- |
| **표준 에러 응답** | `src/main/kotlin/ulevelp/api/ApiError.kt` | `docs/03-api-spec.md` 1.2절(`NFR-SEC-10`) 6개 필드(`ok`, `source`, `status`, `code`, `message`, `retryAfter`)를 따르는 `ApiErrorResponse` 및 `ApiException` 계층(`UnauthorizedException`, `InvalidInputException`, `NotFoundException`, `ConflictException`) |
| **JWT & JWKS 검증기** | `src/main/kotlin/ulevelp/auth/SupabaseJwtVerifier.kt` | JDK 21 표준 암호화 API 기반 RFC 7517 JWKS 파서(`ES256` P-256, `RS256` 지원), 메모리 캐시 `HttpJwksProvider` 및 테스트용 `StaticJwksProvider`, 알고리즘 고정(`ES256`/`RS256` 화이트리스트), `iss`·`aud=authenticated`·`exp`·`nbf`·`sub`(UUID) 검증 |
| **인증 미들웨어** | `src/main/kotlin/ulevelp/auth/AuthPlugin.kt` | `/api/v1` 라우트 스코프 플러그인(`SupabaseAuthPlugin`). `OPTIONS` 프리플라이트 통과, Bearer 토큰 검증, 첫 요청 시 `ProfileService.ensureUserAndProfile` 호출, `call.requireAuthUser()` 컨텍스트 주입 |
| **프로필/계정 서비스** | `src/main/kotlin/ulevelp/service/ProfileService.kt` | 첫 요청 시 `users`·`profiles` `INSERT ... ON CONFLICT (id) DO NOTHING` 및 이메일 변경 갱신(`FR-AUTH-2`), `getMe`(Supabase 스토리지 녹음 용량 합산 및 `ulevelp` 연동 키 힌트 조회), `patchMe`(`role`·`takeQuotaBytes` 변조 무시 `FR-AUTH-3`, 노션 연동 활성화 시 `drive` 전환 `409 NOTION_SYNC_CONFLICT` 차단 `FR-SYNC-5`), `deleteMe`(`confirmText == "삭제합니다"` 검증, `takes(storage='supabase')` 키를 `storage_trash`에 적재 후 `integrations`·`users` Cascade 삭제 `FR-AUTH-4`), 사용자 데이터 소유권 가드(`listOwnedSongIds`, `requireOwnedSong`, `requireOwnedSession` `NFR-SEC-2`) |
| **내 프로필 라우트** | `src/main/kotlin/ulevelp/routes/MeRoutes.kt` | `GET /api/v1/me`, `PATCH /api/v1/me`, `DELETE /api/v1/me` 엔드포인트 |
| **서버 엔트리·CORS** | `src/main/kotlin/ulevelp/Main.kt` | `ALLOWED_ORIGINS` 기반 `CORS` 플러그인(정상 및 4xx/5xx 에러 응답 모두 허용 Origin에 `Access-Control-Allow-Origin` 반환), `StatusPages` 표준 에러 응답 연동, `/api/v1` 인증 라우트 등록 |
| **통합 테스트** | `src/test/kotlin/ulevelp/auth/AuthAndProfileApiTest.kt` | 로컬 생성 EC P-256(`ES256`)·RSA(`RS256`) 키쌍 기반 JWT 검증(누락·위조·만료·`iss`/`aud` 불일치·`HS256`/`none` 알고리즘 혼동 공격 401 차단), CORS 허용/차단 Origin 검증, 첫 요청 프로필 자동 생성 및 용량/키 요약 조회, `PATCH /api/v1/me` 권한/쿼터 변조 무시 및 노션 연동 중 `drive` 변경 409 거부, 사용자 A·B 교차 접근 차단(0행/404) 및 `DELETE /api/v1/me` 하위 테이블 전체 0행 Cascade 삭제·`storage_trash` 적재 검증 |

---

## 2. 테스트 실행 결과

### 2.1 `./gradlew test --rerun-tasks --no-daemon` 출력
```text
DatabaseMigrationAndIntegrityTest > check constraints on songs and cascade delete vs storage_trash retention work as designed() PASSED
DatabaseMigrationAndIntegrityTest > Flyway V1__init migration applies cleanly and creates all 12 tables() PASSED
DatabaseMigrationAndIntegrityTest > integrations table stores AES-256-GCM encrypted payload via Exposed and enforces 12-byte IV constraint() PASSED
DatabaseMigrationAndIntegrityTest > composite foreign keys block sessions and takes from referencing another user's song or mismatched song() PASSED

ChordEngineTest > 같은 자리에서 maj7 에서 7 은 7도 줄만 1프렛 내려간다() PASSED
ChordEngineTest > 2-note-per-string 은 줄마다 정확히 두 음() PASSED
ChordEngineTest > 5도권 순환 메이저 스케일은 키마다 한 음만 바뀐다() PASSED
ChordEngineTest > 도미넌트 텐션 코드는 그 텐션이 실제로 들어간 폼만 나온다() PASSED
ChordEngineTest > F# A C# G# 배열은 Dmaj7(#11), Ebm7(b5), Ab7sus4(b9) 로 해석된다() PASSED
ChordEngineTest > Cmaj7 Drop 2 기본형은 1-2-3-4번줄에서 x x 10 12 12 12() PASSED
ChordEngineTest > 5도권 F9 탑 G 는 Bb13, Eb7(3도) 로 이어지고 Ab 칸은 불가() PASSED
ChordEngineTest > 지판 위 스케일 6현 0~12프렛 C 메이저 펜타는 줄마다 5~6개() PASSED
ChordEngineTest > Ktor API 엔드포인트 및 정적 파일 서빙 검증() PASSED
ChordEngineTest > 스케일 음이름 도수마다 글자를 하나씩 쓴다() PASSED

AuthAndProfileApiTest > first authenticated request creates users and profiles and calculates takeUsedBytes and key summaries() PASSED
AuthAndProfileApiTest > PATCH me updates allowed fields, ignores role and takeQuotaBytes tampering, and blocks drive when notion sync is enabled() PASSED
AuthAndProfileApiTest > missing token, forged signature, expired token, wrong iss or aud, and alg confusion all return 401 UNAUTHORIZED() PASSED
AuthAndProfileApiTest > user B cannot access or mutate user A data (0 rows and 404 NotFound) and DELETE me cascades all child tables while queuing storage_trash() PASSED
AuthAndProfileApiTest > CORS plugin returns Access-Control-Allow-Origin only for ALLOWED_ORIGINS on both 200 and 4xx responses() PASSED

CryptoServiceTest > AES-256-GCM encrypt and decrypt round-trip preserves plaintext and extracts 4-char hint() PASSED
CryptoServiceTest > encrypting identical plaintext twice generates distinct random 12-byte IVs and ciphertexts() PASSED
CryptoServiceTest > decrypting with different master key fails authentication() PASSED
CryptoServiceTest > AAD binds ciphertext to userId, appId, and provider preventing row transplant() PASSED
CryptoServiceTest > tampered ciphertext or auth tag is rejected with AEADBadTagException() PASSED
CryptoServiceTest > provider key regex validation accepts valid Notion and Gemini keys and rejects malformed keys() PASSED
CryptoServiceTest > master key validation rejects non-32-byte or malformed Base64 keys() PASSED

BUILD SUCCESSFUL in 16s
5 actionable tasks: 5 executed
```

### 2.2 `npm test` (프런트엔드 계산 및 X1 보안 정적 검사)
```text
ℹ tests 32
ℹ suites 0
ℹ pass 32
ℹ fail 0
ℹ duration_ms 286.4915
```

---

## 3. 다음 단계(`K0-4` 및 `K1-1`) 전달 사항

- **환경변수 (`K0-4` / 배포 시):**
  - `SUPABASE_URL`: `https://<project-ref>.supabase.co` (서버가 자동으로 `iss = $SUPABASE_URL/auth/v1` 및 `JWKS = $SUPABASE_URL/auth/v1/.well-known/jwks.json`을 구성함)
  - `ALLOWED_ORIGINS`: 기본값 `https://hunseokc.github.io,http://localhost:3000` (콤마 구분)
- **인증 컨텍스트 및 소유권 가드 (`K1-1` 이후 라우트에서 사용):**
  - `/api/v1` 하위 라우트에서는 `call.requireAuthUser()`로 검증된 `AuthenticatedUser(id, email, displayNameHint)`를 즉시 가져올 수 있습니다.
  - 단건 곡/세션 접근 시 `ProfileService.requireOwnedSong(userId, songId)` 및 `requireOwnedSession(userId, sessionId)`를 사용하면 타 사용자 리소스 접근 시 표준 `404 NOT_FOUND`가 반환됩니다.
