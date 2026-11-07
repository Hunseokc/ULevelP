package ulevelp.db

import com.zaxxer.hikari.HikariDataSource
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.jetbrains.exposed.exceptions.ExposedSQLException
import org.jetbrains.exposed.sql.Database
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import org.jetbrains.exposed.sql.deleteAll
import org.jetbrains.exposed.sql.deleteWhere
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.transactions.transaction
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import ulevelp.security.CryptoService
import java.math.BigDecimal
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.Base64
import java.util.UUID
import javax.crypto.AEADBadTagException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class DatabaseMigrationAndIntegrityTest {

    companion object {
        private lateinit var dataSource: HikariDataSource
        private lateinit var db: Database
        private var migrationsExecutedCount: Int = 0
        private var targetSchemaVersion: String? = null

        val EXPECTED_TABLES = listOf(
            "users",
            "profiles",
            "songs",
            "sessions",
            "takes",
            "notes",
            "analysis_jobs",
            "integrations",
            "notion_sync",
            "notion_links",
            "sync_outbox",
            "storage_trash",
            "categories",
            "song_categories",
            "progressions"
        )

        @JvmStatic
        @BeforeAll
        fun setUpDatabase() {
            val config = PostgresTestContainer.getConfig()
            dataSource = DatabaseFactory.createDataSource(config)
            val migrateResult = DatabaseFactory.migrate(dataSource)
            migrationsExecutedCount = migrateResult.migrationsExecuted
            targetSchemaVersion = migrateResult.targetSchemaVersion
            println(
                "[Flyway] success=${migrateResult.success}, " +
                    "migrationsExecuted=${migrateResult.migrationsExecuted}, " +
                    "targetSchemaVersion=${migrateResult.targetSchemaVersion}"
            )
            db = DatabaseFactory.connect(dataSource)
        }

        @JvmStatic
        @AfterAll
        fun tearDownDatabase() {
            if (::dataSource.isInitialized) {
                dataSource.close()
            }
        }
    }

    @BeforeEach
    fun cleanTables() {
        transaction(db) {
            StorageTrashTable.deleteAll()
            UsersTable.deleteAll()
        }
    }

    @Test
    fun `Flyway V1__init to V4__analysis_job_options migrations apply cleanly and create all 15 tables`() {
        assertEquals("4", targetSchemaVersion, "Flyway target schema version should be 4")
        assertTrue(migrationsExecutedCount >= 4, "V1__init.sql ~ V4__analysis_job_options.sql migrations must have executed")
        assertEquals(15, ALL_TABLES.size, "Exposed ALL_TABLES should contain 15 tables")

        val actualTables = mutableListOf<String>()
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """
                SELECT table_name
                  FROM information_schema.tables
                 WHERE table_schema = 'public'
                   AND table_type = 'BASE TABLE'
                   AND table_name <> 'flyway_schema_history'
                 ORDER BY table_name
                """.trimIndent()
            ).use { ps ->
                ps.executeQuery().use { rs ->
                    while (rs.next()) {
                        actualTables.add(rs.getString("table_name"))
                    }
                }
            }
        }

        println("[Flyway] Created tables (${actualTables.size}): ${actualTables.joinToString(", ")}")
        assertEquals(EXPECTED_TABLES.sorted(), actualTables, "All 15 domain tables must exist in PostgreSQL")

        // Verify Exposed table definitions query cleanly against migrated schema
        transaction(db) {
            for (table in ALL_TABLES) {
                assertEquals(0L, table.selectAll().count(), "Table ${table.tableName} should be empty initially")
            }
        }
    }

    @Test
    fun `composite foreign keys block sessions and takes from referencing another user's song or mismatched song`() {
        val userA = UUID.randomUUID()
        val userB = UUID.randomUUID()
        val songA1 = UUID.randomUUID()
        val songA2 = UUID.randomUUID()
        val songB1 = UUID.randomUUID()
        val sessionA1 = UUID.randomUUID()
        val today = LocalDate.of(2026, 10, 30)
        val now = OffsetDateTime.now(ZoneOffset.UTC)

        transaction(db) {
            UsersTable.insert {
                it[id] = userA
                it[email] = "userA@example.com"
            }
            UsersTable.insert {
                it[id] = userB
                it[email] = "userB@example.com"
            }

            SongsTable.insert {
                it[id] = songA1
                it[userId] = userA
                it[title] = "User A Song 1"
                it[videoId] = "dQw4w9WgXcQ"
            }
            SongsTable.insert {
                it[id] = songA2
                it[userId] = userA
                it[title] = "User A Song 2"
                it[videoId] = "3JZ_D3ELwOQ"
            }
            SongsTable.insert {
                it[id] = songB1
                it[userId] = userB
                it[title] = "User B Song 1"
                it[videoId] = "9bZkp7q19f0"
            }

            // 1. 정상 케이스: 사용자 A가 자신의 곡(songA1)에 대해 세션 및 녹음 생성
            SessionsTable.insert {
                it[id] = sessionA1
                it[userId] = userA
                it[songId] = songA1
                it[date] = today
                it[seconds] = 180
                it[loops] = 5
            }

            TakesTable.insert {
                it[userId] = userA
                it[sessionId] = sessionA1
                it[songId] = songA1
                it[recordedAt] = now
                it[durationSec] = 30
                it[mime] = "audio/webm"
                it[sizeBytes] = 120_000L
                it[storage] = "supabase"
                it[storageKey] = "$userA/take-valid.webm"
            }
        }

        // 2. 교차 사용자 세션 거부: 사용자 B가 사용자 A의 곡(songA1)을 가리키는 세션 INSERT 시도 -> 복합 FK (user_id, song_id) 위반 (23503)
        val crossUserSessionEx = assertFailsWith<ExposedSQLException> {
            transaction(db) {
                SessionsTable.insert {
                    it[userId] = userB
                    it[songId] = songA1
                    it[date] = today
                    it[seconds] = 120
                }
            }
        }
        assertEquals("23503", crossUserSessionEx.sqlState, "Cross-user session INSERT must fail with FK violation 23503")

        // 3. 교차 사용자 녹음 거부: 사용자 B가 사용자 A의 세션/곡을 가리키는 녹음 INSERT 시도 -> 복합 FK (user_id, session_id, song_id) 위반 (23503)
        val crossUserTakeEx = assertFailsWith<ExposedSQLException> {
            transaction(db) {
                TakesTable.insert {
                    it[userId] = userB
                    it[sessionId] = sessionA1
                    it[songId] = songA1
                    it[recordedAt] = now
                    it[durationSec] = 15
                    it[mime] = "audio/webm"
                    it[sizeBytes] = 50_000L
                    it[storage] = "supabase"
                    it[storageKey] = "$userB/take-cross-user.webm"
                }
            }
        }
        assertEquals("23503", crossUserTakeEx.sqlState, "Cross-user take INSERT must fail with FK violation 23503")

        // 4. 같은 사용자 내 다른 곡 불일치 녹음 거부: 사용자 A의 세션(songA1 소속)에 다른 곡(songA2)을 지정해 녹음 INSERT 시도 -> 복합 FK 위반 (23503)
        val mismatchedSongTakeEx = assertFailsWith<ExposedSQLException> {
            transaction(db) {
                TakesTable.insert {
                    it[userId] = userA
                    it[sessionId] = sessionA1
                    it[songId] = songA2
                    it[recordedAt] = now
                    it[durationSec] = 15
                    it[mime] = "audio/webm"
                    it[sizeBytes] = 50_000L
                    it[storage] = "supabase"
                    it[storageKey] = "$userA/take-mismatched-song.webm"
                }
            }
        }
        assertEquals("23503", mismatchedSongTakeEx.sqlState, "Take with mismatched (session_id, song_id) must fail with FK violation 23503")
    }

    @Test
    fun `integrations table stores AES-256-GCM encrypted payload via Exposed and enforces 12-byte IV constraint`() {
        val masterKey = Base64.getEncoder().encodeToString(ByteArray(32) { (it + 7).toByte() })
        val crypto = CryptoService.fromBase64Key(masterKey)
        val userId = UUID.randomUUID()
        val otherUserId = UUID.randomUUID()
        val rawNotionToken = "ntn_9876543210abcdefghijABCDEFGHIJ1234"
        val payload = crypto.encryptProviderKey(userId, "notion", rawNotionToken, appId = "ulevelp")

        transaction(db) {
            UsersTable.insert {
                it[id] = userId
                it[email] = "crypto@example.com"
            }

            IntegrationsTable.insert {
                it[IntegrationsTable.userId] = userId
                it[appId] = "ulevelp"
                it[provider] = "notion"
                it[encryptedSecret] = payload.encryptedSecret
                it[iv] = payload.iv
                it[keyVersion] = payload.keyVersion
                it[hint] = payload.hint
                it[config] = buildJsonObject {
                    put("songsDbId", "a1b2c3d4e5f60718293a4b5c6d7e8f90")
                }
            }

            val row = IntegrationsTable.selectAll()
                .where { IntegrationsTable.userId eq userId }
                .single()

            val decrypted = crypto.decryptProviderKey(
                userId = row[IntegrationsTable.userId],
                provider = row[IntegrationsTable.provider],
                encryptedSecret = row[IntegrationsTable.encryptedSecret],
                iv = row[IntegrationsTable.iv],
                appId = row[IntegrationsTable.appId]
            )
            assertEquals(rawNotionToken, decrypted)
            assertEquals("1234", row[IntegrationsTable.hint])

            // 다른 사용자의 userId로 복호화 시도 시 AAD 불일치로 거부됨
            assertFailsWith<AEADBadTagException> {
                crypto.decryptProviderKey(
                    userId = otherUserId,
                    provider = row[IntegrationsTable.provider],
                    encryptedSecret = row[IntegrationsTable.encryptedSecret],
                    iv = row[IntegrationsTable.iv],
                    appId = row[IntegrationsTable.appId]
                )
            }
        }

        // 12바이트가 아닌 IV 저장 시 DB CHECK (octet_length(iv) = 12) 제약조건에 의해 거부됨 (23514)
        val badIvEx = assertFailsWith<ExposedSQLException> {
            transaction(db) {
                IntegrationsTable.insert {
                    it[IntegrationsTable.userId] = userId
                    it[appId] = "ulevelp"
                    it[provider] = "gemini"
                    it[encryptedSecret] = payload.encryptedSecret
                    it[iv] = ByteArray(8)
                    it[keyVersion] = 1
                    it[hint] = "abcd"
                    it[config] = buildJsonObject {}
                }
            }
        }
        assertEquals("23514", badIvEx.sqlState, "IV length != 12 must fail with CHECK constraint violation 23514")
    }

    @Test
    fun `check constraints on songs and cascade delete vs storage_trash retention work as designed`() {
        val userId = UUID.randomUUID()

        transaction(db) {
            UsersTable.insert {
                it[id] = userId
                it[email] = "cascade@example.com"
            }
            ProfilesTable.insert {
                it[id] = userId
                it[displayName] = "Cascade Tester"
            }
            StorageTrashTable.insert {
                it[storageKey] = "$userId/orphan-take.webm"
            }
        }

        // a >= b 구간 역전 시 CHECK (a IS NULL OR b IS NULL OR a < b) 거부 (23514)
        val invalidLoopRangeEx = assertFailsWith<ExposedSQLException> {
            transaction(db) {
                SongsTable.insert {
                    it[SongsTable.userId] = userId
                    it[title] = "Invalid A/B Loop"
                    it[videoId] = "dQw4w9WgXcQ"
                    it[a] = BigDecimal("30.0")
                    it[b] = BigDecimal("15.0")
                }
            }
        }
        assertEquals("23514", invalidLoopRangeEx.sqlState)

        // 사용자 삭제 시 profiles는 CASCADE 삭제되지만 storage_trash는 유지되어야 함
        transaction(db) {
            UsersTable.deleteWhere { id eq userId }
            assertEquals(0L, ProfilesTable.selectAll().where { ProfilesTable.id eq userId }.count())
            assertEquals(1L, StorageTrashTable.selectAll().count())
        }
    }

    @Test
    fun `categories block duplicate names and song_categories block cross-user links`() {
        val userA = UUID.randomUUID()
        val userB = UUID.randomUUID()
        val songA = UUID.randomUUID()
        val categoryA = UUID.randomUUID()
        val categoryB = UUID.randomUUID()

        transaction(db) {
            UsersTable.insert { it[id] = userA; it[email] = "catA@example.com" }
            UsersTable.insert { it[id] = userB; it[email] = "catB@example.com" }
            SongsTable.insert {
                it[id] = songA
                it[userId] = userA
                it[title] = "User A Song"
                it[videoId] = "dQw4w9WgXcQ"
            }
            CategoriesTable.insert { it[id] = categoryA; it[userId] = userA; it[name] = "Jazz" }
            CategoriesTable.insert { it[id] = categoryB; it[userId] = userB; it[name] = "Jazz" }
            // 정상: 내 곡 + 내 분류
            SongCategoriesTable.insert {
                it[userId] = userA
                it[songId] = songA
                it[categoryId] = categoryA
            }
        }

        // 같은 사용자 안에서 대소문자만 다른 이름은 고유 인덱스 위반 (23505)
        val dupNameEx = assertFailsWith<ExposedSQLException> {
            transaction(db) {
                CategoriesTable.insert { it[userId] = userA; it[name] = "JAZZ" }
            }
        }
        assertEquals("23505", dupNameEx.sqlState)

        // 공백뿐인 이름은 CHECK 위반 (23514)
        val blankNameEx = assertFailsWith<ExposedSQLException> {
            transaction(db) {
                CategoriesTable.insert { it[userId] = userA; it[name] = "   " }
            }
        }
        assertEquals("23514", blankNameEx.sqlState)

        // 내 곡에 남의 분류 연결은 복합 FK (user_id, category_id) 위반 (23503)
        val crossUserEx = assertFailsWith<ExposedSQLException> {
            transaction(db) {
                SongCategoriesTable.insert {
                    it[userId] = userA
                    it[songId] = songA
                    it[categoryId] = categoryB
                }
            }
        }
        assertEquals("23503", crossUserEx.sqlState)

        // 분류 삭제 시 연결만 CASCADE로 지워지고 곡은 남는다
        transaction(db) {
            CategoriesTable.deleteWhere { id eq categoryA }
            assertEquals(0L, SongCategoriesTable.selectAll().count())
            assertEquals(1L, SongsTable.selectAll().where { SongsTable.id eq songA }.count())
        }
    }

    @Test
    fun `progressions checks, note SET NULL, unique note index and no progression entity in outbox`() {
        val userId = UUID.randomUUID()
        val noteId = UUID.randomUUID()
        val chords = kotlinx.serialization.json.Json.parseToJsonElement("""[{"symbol":"C"}]""")

        transaction(db) {
            UsersTable.insert { it[id] = userId; it[email] = "prog@example.com" }
            NotesTable.insert {
                it[id] = noteId
                it[NotesTable.userId] = userId
                it[videoId] = "dQw4w9WgXcQ"
                it[title] = "노트"
                it[tags] = listOf("화성")
                it[analysis] = buildJsonObject {}
            }
            ProgressionsTable.insert {
                it[ProgressionsTable.userId] = userId
                it[kind] = "analysis"
                it[origin] = "ai"
                it[route] = "note"
                it[evidence] = "화면"
                it[title] = "노트 진행"
                it[ProgressionsTable.chords] = chords
                it[ProgressionsTable.noteId] = noteId
                it[noteProgIndex] = 0
            }
            // 새 칼럼 기본값
            assertEquals(false, NotesTable.selectAll().where { NotesTable.id eq noteId }.single()[NotesTable.collectProgressions])
        }

        fun insertBad(block: org.jetbrains.exposed.sql.statements.InsertStatement<Number>.() -> Unit): String =
            assertFailsWith<ExposedSQLException> {
                transaction(db) {
                    ProgressionsTable.insert {
                        it[ProgressionsTable.userId] = userId
                        it[kind] = "reference"
                        it[origin] = "manual"
                        it[route] = "manual"
                        it[title] = "t"
                        it[ProgressionsTable.chords] = chords
                        it.block()
                    }
                }
            }.sqlState

        // 레퍼런스는 직접 입력만, 근거는 AI 행만, 키 형식, 빈 코드 배열, 구간 역전 → CHECK (23514)
        assertEquals("23514", insertBad { this[ProgressionsTable.route] = "note" })
        assertEquals("23514", insertBad { this[ProgressionsTable.evidence] = "화면" })
        assertEquals("23514", insertBad { this[ProgressionsTable.key] = "F major" })
        assertEquals("23514", insertBad { this[ProgressionsTable.chords] = kotlinx.serialization.json.JsonArray(emptyList()) })
        assertEquals("23514", insertBad { this[ProgressionsTable.startSec] = 30; this[ProgressionsTable.endSec] = 10 })
        assertEquals("23514", insertBad { this[ProgressionsTable.title] = "  " })
        // 같은 노트 같은 순번 두 번 → 23505
        assertEquals("23505", insertBad {
            this[ProgressionsTable.kind] = "analysis"
            this[ProgressionsTable.route] = "note"
            this[ProgressionsTable.noteId] = noteId
            this[ProgressionsTable.noteProgIndex] = 0
        })

        transaction(db) {
            // analysis_jobs.kind 기본 note
            AnalysisJobsTable.insert {
                it[AnalysisJobsTable.userId] = userId
                it[url] = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
                it[tags] = listOf("화성")
            }
            assertEquals("note", AnalysisJobsTable.selectAll().single()[AnalysisJobsTable.kind])

            // 노트 삭제 → 진행은 남고 note_id만 NULL
            NotesTable.deleteWhere { id eq noteId }
            val row = ProgressionsTable.selectAll().single()
            assertEquals(null, row[ProgressionsTable.noteId])
        }
        // 노션 연동은 동결(계획/앱_명세.md §5) — 코드 진행은 노션 대상이 아니다
        for (bad in listOf("progression", "chord")) {
            val badEntity = assertFailsWith<ExposedSQLException> {
                transaction(db) {
                    SyncOutboxTable.insert {
                        it[SyncOutboxTable.userId] = userId
                        it[entity] = bad
                        it[entityId] = UUID.randomUUID()
                        it[op] = "upsert"
                    }
                }
            }
            assertEquals("23514", badEntity.sqlState)
        }

        // 사용자 삭제 → CASCADE
        transaction(db) {
            UsersTable.deleteWhere { id eq userId }
            assertEquals(0L, ProgressionsTable.selectAll().count())
        }
    }
}
