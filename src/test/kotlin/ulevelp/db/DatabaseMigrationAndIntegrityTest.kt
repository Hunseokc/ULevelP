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
            "storage_trash"
        )

        @JvmStatic
        @BeforeAll
        fun setUpDatabase() {
            val config = PostgresTestContainer.getConfig()
            dataSource = DatabaseFactory.createDataSource(config)
            val migrateResult = DatabaseFactory.migrate(dataSource)
            migrationsExecutedCount = migrateResult.migrationsExecuted
            targetSchemaVersion = migrateResult.targetSchemaVersion ?: migrateResult.initialSchemaVersion
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
    fun `Flyway V1__init migration applies cleanly and creates all 12 tables`() {
        assertEquals("1", targetSchemaVersion, "Flyway target schema version should be 1")
        assertTrue(migrationsExecutedCount >= 1 || targetSchemaVersion == "1", "At least V1__init.sql migration must have executed")
        assertEquals(12, ALL_TABLES.size, "Exposed ALL_TABLES should contain 12 tables")

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
        assertEquals(EXPECTED_TABLES.sorted(), actualTables, "All 12 domain tables must exist in PostgreSQL")

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
}

