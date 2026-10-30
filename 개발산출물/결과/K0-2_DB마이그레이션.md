# 결과: K0-2 — DB 마이그레이션(`V1__init.sql`) + Exposed 연결 + 도메인 무결성/암호화 단위 테스트

- **작업일:** 2026-10-30
- **브랜치:** `step/K0-2`

---

## 1. 추가된 의존성 및 구현 파일

| 구분 | 내용 |
| --- | --- |
| **Flyway** | `org.flywaydb:flyway-core:10.20.1`, `org.flywaydb:flyway-database-postgresql:10.20.1` |
| **JetBrains Exposed** | `org.jetbrains.exposed:exposed-core:0.56.0`, `exposed-jdbc:0.56.0`, `exposed-java-time:0.56.0`, `exposed-json:0.56.0` |
| **커넥션 풀 / 드라이버** | `com.zaxxer:HikariCP:6.2.1`, `org.postgresql:postgresql:42.7.4` |
| **마이그레이션 DDL** | `src/main/resources/db/migration/V1__init.sql` (`docs/04-db-design.md` 2절 표준 DDL 1:1 반영) |
| **Exposed 테이블·연결** | `src/main/kotlin/ulevelp/db/Tables.kt` (12개 테이블 객체 + `ALL_TABLES`), `src/main/kotlin/ulevelp/db/DatabaseFactory.kt` (`fromEnvOrNull`, HikariCP, Flyway `migrate`, Exposed `connect`, `dbQuery`) |
| **AES-256-GCM 및 키 검증** | `src/main/kotlin/ulevelp/security/CryptoService.kt` (32바이트 Base64 `APP_MASTER_KEY`, 12바이트 난수 IV, 128-bit GCM 태그, 끝 4자리 `hint`, 노션 토큰·DB ID·Gemini 키 정규식 검증) |
| **단위·통합 테스트** | `src/test/kotlin/ulevelp/db/PostgresTestContainer.kt`, `src/test/kotlin/ulevelp/db/DatabaseMigrationAndIntegrityTest.kt`, `src/test/kotlin/ulevelp/security/CryptoServiceTest.kt` |

---

## 2. 적용된 테이블 12개 목록 (`V1__init.sql` & `Tables.kt`)

| # | 테이블명 (`public`) | Exposed 객체 | PK / 핵심 제약조건 |
| --- | --- | --- | --- |
| 1 | `users` | `UsersTable` | `id UUID PK`, `email TEXT NOT NULL` (이메일 변경 대비 UNIQUE 미적용) |
| 2 | `profiles` | `ProfilesTable` | `id UUID PK REFERENCES users(id) ON DELETE CASCADE`, `role IN ('user', 'owner')`, `storage_provider IN ('supabase', 'drive')`, `take_quota_bytes` 기본 200MB (`209715200`) |
| 3 | `songs` | `SongsTable` | `id UUID PK`, `UNIQUE (user_id, video_id)`, **`UNIQUE (user_id, id)`** (하위 복합 FK 대상), `video_id ~ '^[A-Za-z0-9_-]{11}$'`, `CHECK (a IS NULL OR b IS NULL OR a < b)` |
| 4 | `sessions` | `SessionsTable` | `id UUID PK`, `UNIQUE (user_id, song_id, date)`, **`UNIQUE (user_id, id, song_id)`**, **`FOREIGN KEY (user_id, song_id) REFERENCES songs (user_id, id) ON DELETE CASCADE`** |
| 5 | `takes` | `TakesTable` | `id UUID PK`, `size_bytes <= 52428800` (50MB), **`FOREIGN KEY (user_id, session_id, song_id) REFERENCES sessions (user_id, id, song_id) ON DELETE CASCADE`** |
| 6 | `notes` | `NotesTable` | `id UUID PK`, `tags TEXT[]`, `analysis JSONB`, `diagrams_svg JSONB`, `difficulty IN ('입문', '중급', '고급')` |
| 7 | `analysis_jobs` | `AnalysisJobsTable` | `id UUID PK`, `cardinality(tags) > 0`, `status IN ('queued', 'running', 'done', 'failed')`, `note_id REFERENCES notes(id) ON DELETE SET NULL` |
| 8 | `integrations` | `IntegrationsTable` | `PRIMARY KEY (user_id, app_id, provider)`, `encrypted_secret BYTEA`, `octet_length(iv) = 12`, `jsonb_typeof(config) = 'object'` |
| 9 | `notion_sync` | `NotionSyncTable` | `user_id UUID PK REFERENCES users(id) ON DELETE CASCADE`, `lease_until`, `lease_owner` |
| 10 | `notion_links` | `NotionLinksTable` | `PRIMARY KEY (entity, entity_id)`, `UNIQUE (user_id, notion_page_id)` |
| 11 | `sync_outbox` | `SyncOutboxTable` | `id BIGSERIAL PK`, `op IN ('upsert', 'delete')`, 부분 인덱스 `WHERE done_at IS NULL` |
| 12 | `storage_trash` | `StorageTrashTable` | `id BIGSERIAL PK`, `storage_key TEXT NOT NULL` (사용자/곡 삭제 후에도 비동기 파일 정리를 위해 `users` FK 미설정) |

---

## 3. 테스트 실행 및 Flyway·암호화 검증 출력

### 3.1 `./gradlew test --rerun-tasks --no-daemon` 출력
```text
DatabaseMigrationAndIntegrityTest STANDARD_OUT
    2026-10-30 11:16:50.973 [Test worker] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-1 - Starting...
    2026-10-30 11:16:51.012 [Test worker] INFO  com.zaxxer.hikari.pool.HikariPool - HikariPool-1 - Added connection org.postgresql.jdbc.PgConnection@3676ac27
    2026-10-30 11:16:51.014 [Test worker] INFO  com.zaxxer.hikari.HikariDataSource - HikariPool-1 - Start completed.
    2026-10-30 11:16:51.369 [Test worker] INFO  org.flywaydb.core.FlywayExecutor - Database: jdbc:postgresql://127.0.0.1:32769/ulevelp_test (PostgreSQL 16.15)
    2026-10-30 11:16:51.416 [Test worker] INFO  o.f.c.i.s.JdbcTableSchemaHistory - Schema history table "public"."flyway_schema_history" does not exist yet
    2026-10-30 11:16:51.419 [Test worker] INFO  o.f.core.internal.command.DbValidate - Successfully validated 1 migration (execution time 00:00.020s)
    2026-10-30 11:16:51.439 [Test worker] INFO  o.f.c.i.s.JdbcTableSchemaHistory - Creating Schema History table "public"."flyway_schema_history" ...
    2026-10-30 11:16:51.520 [Test worker] INFO  o.f.core.internal.command.DbMigrate - Current version of schema "public": << Empty Schema >>
    2026-10-30 11:16:51.553 [Test worker] INFO  o.f.core.internal.command.DbMigrate - Migrating schema "public" to version "1 - init"
    2026-10-30 11:16:51.839 [Test worker] INFO  o.f.core.internal.command.DbMigrate - Successfully applied 1 migration to schema "public", now at version v1 (execution time 00:00.261s)
    [Flyway] success=true, migrationsExecuted=1, targetSchemaVersion=1

DatabaseMigrationAndIntegrityTest > check constraints on songs and cascade delete vs storage_trash retention work as designed() PASSED

DatabaseMigrationAndIntegrityTest > Flyway V1__init migration applies cleanly and creates all 12 tables() STANDARD_OUT
    [Flyway] Created tables (12): analysis_jobs, integrations, notes, notion_links, notion_sync, profiles, sessions, songs, storage_trash, sync_outbox, takes, users

DatabaseMigrationAndIntegrityTest > Flyway V1__init migration applies cleanly and creates all 12 tables() PASSED
DatabaseMigrationAndIntegrityTest > integrations table stores AES-256-GCM encrypted payload via Exposed and enforces 12-byte IV constraint() PASSED
DatabaseMigrationAndIntegrityTest > composite foreign keys block sessions and takes from referencing another user's song or mismatched song() PASSED

CryptoServiceTest > AES-256-GCM encrypt and decrypt round-trip preserves plaintext and extracts 4-char hint() PASSED
CryptoServiceTest > encrypting identical plaintext twice generates distinct random 12-byte IVs and ciphertexts() PASSED
CryptoServiceTest > decrypting with different master key fails authentication() PASSED
CryptoServiceTest > tampered ciphertext or auth tag is rejected with AEADBadTagException() PASSED
CryptoServiceTest > provider key regex validation accepts valid Notion and Gemini keys and rejects malformed keys() PASSED
CryptoServiceTest > master key validation rejects non-32-byte or malformed Base64 keys() PASSED

BUILD SUCCESSFUL in 17s
5 actionable tasks: 5 executed
```

### 3.2 `npm test` (프런트엔드 계산 및 X1 보안 정적 검사)
```text
ℹ tests 32
ℹ suites 0
ℹ pass 32
ℹ fail 0
ℹ duration_ms 208.6358
```

---

## 4. 다음 단계(`K0-3`) 전달 사항

- **DB 초기화 및 트랜잭션 유틸:** `ulevelp.db.DatabaseFactory`의 `init(config)` 및 `dbQuery(db) { ... }`가 준비되어 있으며, `Application.module(publicDir, dbConfig)`에 `dbConfig`를 주입해 테스트용 PostgreSQL(`PostgresTestContainer.getConfig()`)과 연결할 수 있습니다.
- **테이블 정의:** `ulevelp.db.UsersTable`, `ProfilesTable`, `SongsTable`, `SessionsTable`, `TakesTable`, `IntegrationsTable`, `StorageTrashTable` 등 12개 Exposed 테이블이 `src/main/kotlin/ulevelp/db/Tables.kt`에 정의되어 있습니다.
- **`K0-3` 구현 대상:**
  - Supabase access token 검증 미들웨어(JWKS·`iss`·`aud=authenticated`, 테스트는 로컬 생성 키쌍으로 서명한 토큰 사용)
  - 인증된 첫 요청 시 `users`·`profiles` 자동 생성(Upsert)
  - 표준 에러 응답(`{ ok: false, source, status, code, message }`) 및 `ALLOWED_ORIGINS` CORS 플러그인
  - `GET /api/v1/me`, `PATCH /api/v1/me`(`role`·`takeQuotaBytes` 변조 무시), `DELETE /api/v1/me`(`storage_trash` 기록 + DB Cascade 삭제) 및 사용자 A·B 교차 접근 차단 통합 테스트
