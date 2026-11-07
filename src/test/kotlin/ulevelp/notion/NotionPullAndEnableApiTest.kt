package ulevelp.notion

import com.zaxxer.hikari.HikariDataSource
import io.ktor.client.HttpClient
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.server.testing.*
import kotlinx.serialization.json.*
import org.jetbrains.exposed.sql.Database
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.deleteAll
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.transactions.transaction
import org.jetbrains.exposed.sql.update
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import ulevelp.db.*
import ulevelp.support.*
import java.math.BigDecimal
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.UUID
import kotlin.test.*

class NotionPullAndEnableApiTest {

    companion object {
        private lateinit var dataSource: HikariDataSource
        private lateinit var db: Database
        private lateinit var dbConfig: DatabaseConfig

        @JvmStatic
        @BeforeAll
        fun setUpAll() {
            dbConfig = PostgresTestContainer.getConfig()
            dataSource = DatabaseFactory.createDataSource(dbConfig)
            DatabaseFactory.migrate(dataSource)
            db = DatabaseFactory.connect(dataSource)
        }

        @JvmStatic
        @AfterAll
        fun tearDownAll() {
            if (::dataSource.isInitialized) {
                runCatching {
                    dataSource.connection.use { conn ->
                        conn.createStatement().use { stmt ->
                            stmt.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
                        }
                        conn.commit()
                    }
                }
                dataSource.close()
            }
        }
    }

    private val userA = UUID.fromString("00000000-0000-4000-8000-000000000001")
    private val userB = UUID.fromString("00000000-0000-4000-8000-000000000002")
    private lateinit var tokenA: String
    private lateinit var tokenB: String

    private val fakeNotionClient = FakeNotionClient()
    private val fakeStorageClient = FakeStorageClient()

    private val testSongsDb = "959cbe517e224419b48ca3313895a427"
    private val testSessionsDb = "6260633380b34d28989af90ddfbb4e67"
    private val testNotesDb = "11111111222233334444555566667777"
    private val testNotionToken = "secret_1234567890abcdef1234567890abcdef"

    @BeforeEach
    fun setUp() {
        tokenA = TestJwt.token(sub = userA, email = "userA@example.com")
        tokenB = TestJwt.token(sub = userB, email = "userB@example.com")
        fakeNotionClient.clear()
        fakeStorageClient.objects.clear()

        transaction(db) {
            SyncOutboxTable.deleteAll()
            NotionLinksTable.deleteAll()
            NotionSyncTable.deleteAll()
            IntegrationsTable.deleteAll()
            StorageTrashTable.deleteAll()
            TakesTable.deleteAll()
            SessionsTable.deleteAll()
            SongsTable.deleteAll()
            ProfilesTable.deleteAll()
            UsersTable.deleteAll()

            UsersTable.insert {
                it[id] = userA
                it[email] = "userA@example.com"
            }
            ProfilesTable.insert {
                it[id] = userA
                it[displayName] = "User A"
                it[takeQuotaBytes] = 209_715_200L
                it[storageProvider] = "supabase"
            }

            UsersTable.insert {
                it[id] = userB
                it[email] = "userB@example.com"
            }
            ProfilesTable.insert {
                it[id] = userB
                it[displayName] = "User B"
                it[takeQuotaBytes] = 209_715_200L
                it[storageProvider] = "supabase"
            }
        }
    }

    private suspend fun registerNotionKey(client: HttpClient, token: String = tokenA) {
        val body = buildJsonObject {
            put("appId", "ulevelp")
            put("token", testNotionToken)
            put("songsDb", testSongsDb)
            put("sessionsDb", testSessionsDb)
            put("notesDb", testNotesDb)
        }.toString()

        val res = client.put("/api/v1/integrations/notion") {
            header(HttpHeaders.Authorization, "Bearer $token")
            header(HttpHeaders.ContentType, "application/json")
            setBody(body)
        }
        assertEquals(HttpStatusCode.OK, res.status)
    }

    private fun buildNotionSongPage(
        pageId: String,
        videoId: String,
        title: String,
        artist: String = "Test Artist",
        status: String = "연습 중",
        memo: String = "",
        lastDate: String? = null
    ): JsonObject = buildJsonObject {
        put("id", pageId)
        putJsonObject("properties") {
            putJsonObject("곡명") {
                putJsonArray("title") {
                    addJsonObject {
                        put("type", "text")
                        putJsonObject("text") { put("content", title) }
                        put("plain_text", title)
                    }
                }
            }
            putJsonObject("아티스트") {
                putJsonArray("rich_text") {
                    addJsonObject {
                        put("type", "text")
                        putJsonObject("text") { put("content", artist) }
                        put("plain_text", artist)
                    }
                }
            }
            putJsonObject("상태") {
                putJsonObject("select") { put("name", status) }
            }
            putJsonObject("유튜브 링크") {
                put("url", "https://www.youtube.com/watch?v=$videoId")
            }
            putJsonObject("속도") {
                put("number", 1.0)
            }
            if (lastDate != null) {
                putJsonObject("마지막 연습일") {
                    putJsonObject("date") { put("start", lastDate) }
                }
            }
            if (memo.isNotEmpty()) {
                putJsonObject("메모") {
                    putJsonArray("rich_text") {
                        addJsonObject {
                            put("type", "text")
                            putJsonObject("text") { put("content", memo) }
                            put("plain_text", memo)
                        }
                    }
                }
            }
        }
    }

    private fun buildNotionSessionPage(
        pageId: String,
        songNotionPageId: String,
        date: String,
        minutes: Double,
        loops: Int = 0,
        rate: Double = 1.0,
        segment: String = "",
        memo: String = "",
        files: List<Pair<String, String>> = emptyList()
    ): JsonObject = buildJsonObject {
        put("id", pageId)
        putJsonObject("properties") {
            putJsonObject("기록") {
                putJsonArray("title") {
                    addJsonObject {
                        put("type", "text")
                        putJsonObject("text") { put("content", "$date Session") }
                        put("plain_text", "$date Session")
                    }
                }
            }
            putJsonObject("곡") {
                putJsonArray("relation") {
                    addJsonObject { put("id", songNotionPageId) }
                }
            }
            putJsonObject("날짜") {
                putJsonObject("date") { put("start", date) }
            }
            putJsonObject("연습 시간(분)") {
                put("number", minutes)
            }
            putJsonObject("반복 횟수") {
                put("number", loops)
            }
            putJsonObject("속도") {
                put("number", rate)
            }
            if (segment.isNotEmpty()) {
                putJsonObject("구간") {
                    putJsonArray("rich_text") {
                        addJsonObject {
                            put("type", "text")
                            putJsonObject("text") { put("content", segment) }
                            put("plain_text", segment)
                        }
                    }
                }
            }
            if (memo.isNotEmpty()) {
                putJsonObject("메모") {
                    putJsonArray("rich_text") {
                        addJsonObject {
                            put("type", "text")
                            putJsonObject("text") { put("content", memo) }
                            put("plain_text", memo)
                        }
                    }
                }
            }
            putJsonObject("녹음") {
                putJsonArray("files") {
                    files.forEach { (name, url) ->
                        addJsonObject {
                            put("name", name)
                            put("type", "file")
                            putJsonObject("file") { put("url", url) }
                        }
                    }
                }
            }
        }
    }

    @Test
    fun `PL1 초기 상태 조회 (status)`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        val res = client.get("/api/v1/notion/sync/status") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }

        assertEquals(HttpStatusCode.OK, res.status)
        val json = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        assertFalse(json["enabled"]!!.jsonPrimitive.boolean)
        assertEquals(0, json["pending"]!!.jsonPrimitive.int)
        assertEquals(0, json["failed"]!!.jsonPrimitive.int)
        assertEquals(JsonNull, json["lastPushAt"])
        assertEquals(JsonNull, json["lastPullAt"])
        assertEquals(JsonNull, json["lastError"])
    }

    @Test
    fun `PL2 초기 전체 연동(enable) — 곡·세션·녹음 이관 및 로컬 전용 곡 Outbox 적재`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        // A에 노션 키 등록
        registerNotionKey(client, tokenA)

        // 로컬 전용 곡 L1 생성
        val l1Id = UUID.randomUUID()
        transaction(db) {
            SongsTable.insert {
                it[id] = l1Id
                it[userId] = userA
                it[title] = "Local Only Song L1"
                it[artist] = "Local Artist"
                it[status] = "practicing"
                it[videoId] = "dQw4w9WgXc1"
                it[rate] = BigDecimal("1.00")
            }
        }

        // FakeNotionClient에 N1, S1, 녹음 파일 1개 설정
        val n1PageId = "page-song-n1"
        val s1PageId = "page-session-s1"
        val n1 = buildNotionSongPage(
            pageId = n1PageId,
            videoId = "dQw4w9WgXcQ",
            title = "Autumn Leaves",
            lastDate = "2026-10-30"
        )
        val s1 = buildNotionSessionPage(
            pageId = s1PageId,
            songNotionPageId = n1PageId,
            date = "2026-10-30",
            minutes = 15.0,
            files = listOf("2026-10-30 1422 Autumn Leaves.m4a" to "https://notion.so/audio1.m4a")
        )

        fakeNotionClient.queryDatabaseHandler = { _, databaseId, _ ->
            if (databaseId == testSongsDb) {
                buildJsonObject {
                    putJsonArray("results") { add(n1) }
                    put("has_more", false)
                }
            } else if (databaseId == testSessionsDb) {
                buildJsonObject {
                    putJsonArray("results") { add(s1) }
                    put("has_more", false)
                }
            } else {
                buildJsonObject {
                    putJsonArray("results") {}
                    put("has_more", false)
                }
            }
        }

        fakeNotionClient.downloadExternalFileHandler = { url ->
            Pair(ByteArray(1000) { 0x42 }, "audio/mp4")
        }

        val res = client.post("/api/v1/notion/sync/enable") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }

        assertEquals(HttpStatusCode.OK, res.status)
        val json = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        assertTrue(json["ok"]!!.jsonPrimitive.boolean)
        assertEquals(1, json["importedSongs"]!!.jsonPrimitive.int)
        assertEquals(1, json["importedSessions"]!!.jsonPrimitive.int)
        assertEquals(1, json["importedTakes"]!!.jsonPrimitive.int)
        assertEquals(0, json["skippedTakesByQuota"]!!.jsonPrimitive.int)

        // DB 검증
        transaction(db) {
            val songs = SongsTable.selectAll().where { SongsTable.userId eq userA }.toList()
            assertEquals(2, songs.size) // L1 and N1

            val n1Song = songs.single { it[SongsTable.videoId] == "dQw4w9WgXcQ" }
            assertEquals("Autumn Leaves", n1Song[SongsTable.title])

            val sessions = SessionsTable.selectAll().where { SessionsTable.userId eq userA }.toList()
            assertEquals(1, sessions.size)
            val session = sessions.single()
            assertEquals(900, session[SessionsTable.seconds]) // 15분 -> 900초

            val takes = TakesTable.selectAll().where { TakesTable.userId eq userA }.toList()
            assertEquals(1, takes.size)
            val take = takes.single()
            assertEquals("2026-10-30T05:22:00Z", DateTimeFormatter.ISO_INSTANT.format(take[TakesTable.recordedAt].toInstant()))
            assertEquals(0, take[TakesTable.durationSec])
            assertEquals("audio/mp4", take[TakesTable.mime])
            assertEquals(1000L, take[TakesTable.sizeBytes])

            // FakeStorageClient 업로드 확인
            assertEquals(1, fakeStorageClient.objects.size)

            // sync_outbox에는 로컬 전용 곡 L1만 적재되고 N1, S1, take는 적재되지 않음
            val outbox = SyncOutboxTable.selectAll().where { SyncOutboxTable.userId eq userA }.toList()
            assertEquals(1, outbox.size)
            assertEquals("song", outbox.single()[SyncOutboxTable.entity])
            assertEquals(l1Id, outbox.single()[SyncOutboxTable.entityId])
            assertEquals("upsert", outbox.single()[SyncOutboxTable.op])
        }
    }

    @Test
    fun `PL3 초기 전체 연동 2회 연속 실행 시 재다운로드 0회 및 중복 0건 (멱등성)`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        registerNotionKey(client, tokenA)

        val l1Id = UUID.randomUUID()
        transaction(db) {
            SongsTable.insert {
                it[id] = l1Id
                it[userId] = userA
                it[title] = "Local Song L1"
                it[videoId] = "dQw4w9WgXc1"
                it[rate] = BigDecimal("1.00")
            }
        }

        val n1PageId = "page-song-n1"
        val s1PageId = "page-session-s1"
        val n1 = buildNotionSongPage(pageId = n1PageId, videoId = "dQw4w9WgXcQ", title = "Autumn Leaves")
        val s1 = buildNotionSessionPage(
            pageId = s1PageId,
            songNotionPageId = n1PageId,
            date = "2026-10-30",
            minutes = 15.0,
            files = listOf("2026-10-30 1422 Autumn Leaves.m4a" to "https://notion.so/audio1.m4a")
        )

        fakeNotionClient.queryDatabaseHandler = { _, databaseId, _ ->
            if (databaseId == testSongsDb) {
                buildJsonObject {
                    putJsonArray("results") { add(n1) }
                    put("has_more", false)
                }
            } else {
                buildJsonObject {
                    putJsonArray("results") { add(s1) }
                    put("has_more", false)
                }
            }
        }
        fakeNotionClient.downloadExternalFileHandler = { url ->
            Pair(ByteArray(1000) { 0x42 }, "audio/mp4")
        }

        // 1회차 호출
        val res1 = client.post("/api/v1/notion/sync/enable") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, res1.status)
        val initialDownloadCalls = fakeNotionClient.downloadExternalFileCalls.size
        assertEquals(1, initialDownloadCalls)

        // 2회차 연속 호출
        val res2 = client.post("/api/v1/notion/sync/enable") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, res2.status)
        val json2 = Json.parseToJsonElement(res2.bodyAsText()).jsonObject
        assertEquals(0, json2["importedTakes"]!!.jsonPrimitive.int)

        // 재다운로드 0건 확인
        assertEquals(initialDownloadCalls, fakeNotionClient.downloadExternalFileCalls.size)

        // DB 중복 0건 확인
        transaction(db) {
            val songCount = SongsTable.selectAll().where { SongsTable.userId eq userA }.count()
            val sessionCount = SessionsTable.selectAll().where { SessionsTable.userId eq userA }.count()
            val takeCount = TakesTable.selectAll().where { TakesTable.userId eq userA }.count()

            assertEquals(2L, songCount)
            assertEquals(1L, sessionCount)
            assertEquals(1L, takeCount)

            val session = SessionsTable.selectAll().where { SessionsTable.userId eq userA }.single()
            assertEquals(900, session[SessionsTable.seconds])
        }
    }

    @Test
    fun `PL4 초기 전체 연동 시 200MB 녹음 쿼터 초과분 건너뜀 (FR-SYNC-4)`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        registerNotionKey(client, tokenA)

        // A의 쿼터를 500바이트로 설정
        transaction(db) {
            ProfilesTable.update({ ProfilesTable.id eq userA }) {
                it[takeQuotaBytes] = 500L
            }
        }

        val n1PageId = "page-song-n1"
        val s1PageId = "page-session-s1"
        val n1 = buildNotionSongPage(pageId = n1PageId, videoId = "dQw4w9WgXcQ", title = "Autumn Leaves")
        val s1 = buildNotionSessionPage(
            pageId = s1PageId,
            songNotionPageId = n1PageId,
            date = "2026-10-30",
            minutes = 15.0,
            files = listOf("2026-10-30 1422 Autumn Leaves.m4a" to "https://notion.so/audio1.m4a")
        )

        fakeNotionClient.queryDatabaseHandler = { _, databaseId, _ ->
            if (databaseId == testSongsDb) {
                buildJsonObject {
                    putJsonArray("results") { add(n1) }
                    put("has_more", false)
                }
            } else {
                buildJsonObject {
                    putJsonArray("results") { add(s1) }
                    put("has_more", false)
                }
            }
        }
        fakeNotionClient.downloadExternalFileHandler = { url ->
            Pair(ByteArray(1000) { 0x42 }, "audio/mp4") // 1000B > 500B
        }

        val res = client.post("/api/v1/notion/sync/enable") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }

        assertEquals(HttpStatusCode.OK, res.status)
        val json = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        assertEquals(1, json["importedSongs"]!!.jsonPrimitive.int)
        assertEquals(1, json["importedSessions"]!!.jsonPrimitive.int)
        assertEquals(0, json["importedTakes"]!!.jsonPrimitive.int)
        assertEquals(1, json["skippedTakesByQuota"]!!.jsonPrimitive.int)

        transaction(db) {
            val takesCount = TakesTable.selectAll().where { TakesTable.userId eq userA }.count()
            assertEquals(0L, takesCount)
        }
    }

    @Test
    fun `PL5 Google Drive 저장소 사용 중 enable 409 거부 (FR-SYNC-5)`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        registerNotionKey(client, tokenA)

        // storage_provider = drive
        transaction(db) {
            ProfilesTable.update({ ProfilesTable.id eq userA }) {
                it[storageProvider] = "drive"
            }
        }

        val res = client.post("/api/v1/notion/sync/enable") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }

        assertEquals(HttpStatusCode.Conflict, res.status)
        assertStandardError(res.bodyAsText(), 409, "NOTION_SYNC_CONFLICT")
    }

    @Test
    fun `PL6 노션에서 곡 상태·메모 및 세션 메모 수정 후 증분 pull 반영 + sync_outbox 0건 (FR-SYNC-2)`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        registerNotionKey(client, tokenA)

        val n1PageId = "page-song-n1"
        val s1PageId = "page-session-s1"
        val n1 = buildNotionSongPage(pageId = n1PageId, videoId = "dQw4w9WgXcQ", title = "Autumn Leaves")
        val s1 = buildNotionSessionPage(
            pageId = s1PageId,
            songNotionPageId = n1PageId,
            date = "2026-10-30",
            minutes = 15.0
        )

        fakeNotionClient.queryDatabaseHandler = { _, databaseId, _ ->
            if (databaseId == testSongsDb) {
                buildJsonObject {
                    putJsonArray("results") { add(n1) }
                    put("has_more", false)
                }
            } else {
                buildJsonObject {
                    putJsonArray("results") { add(s1) }
                    put("has_more", false)
                }
            }
        }

        // PL2 enable 수행
        val enableRes = client.post("/api/v1/notion/sync/enable") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, enableRes.status)

        // 10분 전으로 last_pull_at 설정, sync_outbox 비움 (DB 저장 정밀도 고려하여 SECONDS 단위 절삭)
        val now = OffsetDateTime.now(ZoneOffset.UTC).truncatedTo(ChronoUnit.SECONDS)
        val tenMinutesAgo = now.minusMinutes(10)
        transaction(db) {
            SyncOutboxTable.deleteAll()
            NotionSyncTable.update({ NotionSyncTable.userId eq userA }) {
                it[lastPullAt] = tenMinutesAgo
            }
        }

        // FakeNotionClient에서 N1 상태="완료", 곡 메모="노션에서 수정", S1 세션 메모="세션 노션 메모" 반환
        val n1Updated = buildNotionSongPage(
            pageId = n1PageId,
            videoId = "dQw4w9WgXcQ",
            title = "Autumn Leaves",
            status = "완료",
            memo = "노션에서 수정"
        )
        val s1Updated = buildNotionSessionPage(
            pageId = s1PageId,
            songNotionPageId = n1PageId,
            date = "2026-10-30",
            minutes = 15.0,
            memo = "세션 노션 메모"
        )

        var songFilterChecked = false
        var sessionFilterChecked = false

        fakeNotionClient.queryDatabaseHandler = { _, databaseId, body ->
            val after = body["filter"]?.jsonObject?.get("last_edited_time")?.jsonObject?.get("after")?.jsonPrimitive?.contentOrNull
            val expectedAfter = DateTimeFormatter.ISO_INSTANT.format(tenMinutesAgo.minusMinutes(2).toInstant())
            assertEquals(Instant.parse(expectedAfter), Instant.parse(after!!))

            if (databaseId == testSongsDb) {
                songFilterChecked = true
                buildJsonObject {
                    putJsonArray("results") { add(n1Updated) }
                    put("has_more", false)
                }
            } else {
                sessionFilterChecked = true
                buildJsonObject {
                    putJsonArray("results") { add(s1Updated) }
                    put("has_more", false)
                }
            }
        }

        val pullRes = client.post("/api/v1/notion/sync/pull") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }

        assertEquals(HttpStatusCode.OK, pullRes.status)
        val pullJson = Json.parseToJsonElement(pullRes.bodyAsText()).jsonObject
        assertEquals(1, pullJson["updatedSongs"]!!.jsonPrimitive.int)
        assertEquals(1, pullJson["updatedSessions"]!!.jsonPrimitive.int)
        assertTrue(songFilterChecked)
        assertTrue(sessionFilterChecked)

        // DB 반영 확인
        transaction(db) {
            val song = SongsTable.selectAll().where { (SongsTable.userId eq userA) and (SongsTable.videoId eq "dQw4w9WgXcQ") }.single()
            assertEquals("done", song[SongsTable.status])
            assertEquals("노션에서 수정", song[SongsTable.memo])

            val session = SessionsTable.selectAll().where { SessionsTable.userId eq userA }.single()
            assertEquals("세션 노션 메모", session[SessionsTable.memo])

            // sync_outbox 행 수가 정확히 0건 (무한 루프 방지)
            val outboxCount = SyncOutboxTable.selectAll().where { SyncOutboxTable.userId eq userA }.count()
            assertEquals(0L, outboxCount)
        }
    }

    @Test
    fun `PL7 로컬 미처리 Outbox가 있는 곡은 pull에서 덮어쓰지 않음 (로컬 우선) + 신규 클리퍼 곡 추가`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        registerNotionKey(client, tokenA)

        val n1PageId = "page-song-n1"
        val n1 = buildNotionSongPage(pageId = n1PageId, videoId = "dQw4w9WgXcQ", title = "Autumn Leaves")

        fakeNotionClient.queryDatabaseHandler = { _, databaseId, _ ->
            if (databaseId == testSongsDb) {
                buildJsonObject {
                    putJsonArray("results") { add(n1) }
                    put("has_more", false)
                }
            } else {
                buildJsonObject {
                    putJsonArray("results") {}
                    put("has_more", false)
                }
            }
        }

        client.post("/api/v1/notion/sync/enable") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }

        val n1SongId = transaction(db) {
            SongsTable.selectAll().where { (SongsTable.userId eq userA) and (SongsTable.videoId eq "dQw4w9WgXcQ") }.single()[SongsTable.id]
        }

        // 로컬에서 PATCH /songs/{N1} 수정하여 sync_outbox에 미처리 upsert 생성
        val patchRes = client.patch("/api/v1/songs/$n1SongId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            header(HttpHeaders.ContentType, "application/json")
            setBody(buildJsonObject { put("memo", "로컬 최신 메모") }.toString())
        }
        assertEquals(HttpStatusCode.OK, patchRes.status)

        // 10분 전으로 설정
        transaction(db) {
            NotionSyncTable.update({ NotionSyncTable.userId eq userA }) {
                it[lastPullAt] = OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(10)
            }
        }

        // FakeNotionClient에 N1(memo="노션 옛 메모")과 신규 곡 N2("9bZkp7q19f0", "New Clip Song") 반환
        val n1Old = buildNotionSongPage(pageId = n1PageId, videoId = "dQw4w9WgXcQ", title = "Autumn Leaves", memo = "노션 옛 메모")
        val n2New = buildNotionSongPage(pageId = "page-song-n2", videoId = "9bZkp7q19f0", title = "New Clip Song")

        fakeNotionClient.queryDatabaseHandler = { _, databaseId, _ ->
            if (databaseId == testSongsDb) {
                buildJsonObject {
                    putJsonArray("results") {
                        add(n1Old)
                        add(n2New)
                    }
                    put("has_more", false)
                }
            } else {
                buildJsonObject {
                    putJsonArray("results") {}
                    put("has_more", false)
                }
            }
        }

        val pullRes = client.post("/api/v1/notion/sync/pull") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }

        assertEquals(HttpStatusCode.OK, pullRes.status)
        val pullJson = Json.parseToJsonElement(pullRes.bodyAsText()).jsonObject
        assertEquals(1, pullJson["updatedSongs"]!!.jsonPrimitive.int) // N2만 반영, N1은 건너뜀

        // N1 메모는 "로컬 최신 메모"로 보존, N2는 새로 추가됨
        transaction(db) {
            val n1Song = SongsTable.selectAll().where { (SongsTable.userId eq userA) and (SongsTable.videoId eq "dQw4w9WgXcQ") }.single()
            assertEquals("로컬 최신 메모", n1Song[SongsTable.memo])

            val n2Song = SongsTable.selectAll().where { (SongsTable.userId eq userA) and (SongsTable.videoId eq "9bZkp7q19f0") }.single()
            assertEquals("New Clip Song", n2Song[SongsTable.title])
        }
    }

    @Test
    fun `PL8 증분 pull 5분 쿨다운 제한 (429 RATE_LIMITED)`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        registerNotionKey(client, tokenA)

        // enabled = true, lastPullAt = now - 100초 (쿨다운 300초 미만)
        transaction(db) {
            NotionSyncTable.insert {
                it[userId] = userA
                it[enabled] = true
                it[lastPullAt] = OffsetDateTime.now(ZoneOffset.UTC).minusSeconds(100)
            }
        }

        val res = client.post("/api/v1/notion/sync/pull") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }

        assertEquals(HttpStatusCode.TooManyRequests, res.status)
        val json = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        assertEquals(false, json["ok"]?.jsonPrimitive?.boolean)
        assertEquals("server", json["source"]?.jsonPrimitive?.content)
        assertEquals(429, json["status"]?.jsonPrimitive?.int)
        assertEquals("RATE_LIMITED", json["code"]?.jsonPrimitive?.content)
        val retryAfter = json["retryAfter"]?.jsonPrimitive?.intOrNull
        assertNotNull(retryAfter, "retryAfter가 null이 아니어야 함")
        assertTrue(retryAfter in 1..300, "retryAfter는 1..300 사이여야 함: $retryAfter")
    }

    @Test
    fun `PL9 연동 끄기(disable) 및 꺼진 상태에서 pull 거부`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        registerNotionKey(client, tokenA)

        transaction(db) {
            NotionSyncTable.insert {
                it[userId] = userA
                it[enabled] = true
            }
        }

        // ① POST /disable
        val disRes = client.post("/api/v1/notion/sync/disable") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, disRes.status)
        val disJson = Json.parseToJsonElement(disRes.bodyAsText()).jsonObject
        assertTrue(disJson["ok"]!!.jsonPrimitive.boolean)

        // ② GET /status
        val stRes = client.get("/api/v1/notion/sync/status") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, stRes.status)
        val stJson = Json.parseToJsonElement(stRes.bodyAsText()).jsonObject
        assertFalse(stJson["enabled"]!!.jsonPrimitive.boolean)

        // ③ POST /pull (연동 꺼진 상태에서 거부 400 INVALID_INPUT)
        val pullRes = client.post("/api/v1/notion/sync/pull") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.BadRequest, pullRes.status)
        assertStandardError(pullRes.bodyAsText(), 400, "INVALID_INPUT")
    }

    @Test
    fun `PL10 키 미등록 사용자 enable·pull 거부`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        // User B has no Notion key registered
        val enableRes = client.post("/api/v1/notion/sync/enable") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
        }
        assertEquals(HttpStatusCode.PreconditionFailed, enableRes.status)
        assertStandardError(enableRes.bodyAsText(), 412, "NO_KEY")

        val pullRes = client.post("/api/v1/notion/sync/pull") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
        }
        assertEquals(HttpStatusCode.PreconditionFailed, pullRes.status)
        assertStandardError(pullRes.bodyAsText(), 412, "NO_KEY")
    }

    @Test
    fun `리뷰 1번 enable 시 external 녹음은 다운로드하지 않고 건너뜀 (SSRF 방지)`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        registerNotionKey(client, tokenA)

        val n1PageId = "page-song-ext"
        val s1PageId = "page-session-ext"
        val n1 = buildNotionSongPage(pageId = n1PageId, videoId = "dQw4w9WgXcQ", title = "SSRF Test")
        // external URL로 구성된 세션 페이지
        val s1 = buildJsonObject {
            put("id", s1PageId)
            putJsonObject("properties") {
                putJsonObject("기록") {
                    putJsonArray("title") {
                        addJsonObject {
                            put("type", "text")
                            putJsonObject("text") { put("content", "2026-10-30 Session") }
                            put("plain_text", "2026-10-30 Session")
                        }
                    }
                }
                putJsonObject("곡") {
                    putJsonArray("relation") {
                        addJsonObject { put("id", n1PageId) }
                    }
                }
                putJsonObject("날짜") {
                    putJsonObject("date") { put("start", "2026-10-30") }
                }
                putJsonObject("연습 시간(분)") { put("number", 10.0) }
                putJsonObject("녹음") {
                    putJsonArray("files") {
                        addJsonObject {
                            put("name", "2026-10-30_12-00-00.m4a")
                            put("type", "external")
                            putJsonObject("external") { put("url", "http://169.254.169.254/latest/meta-data/") }
                        }
                    }
                }
            }
        }

        fakeNotionClient.queryDatabaseHandler = { _, databaseId, _ ->
            if (databaseId == testSongsDb) {
                buildJsonObject {
                    putJsonArray("results") { add(n1) }
                    put("has_more", false)
                }
            } else {
                buildJsonObject {
                    putJsonArray("results") { add(s1) }
                    put("has_more", false)
                }
            }
        }

        val res = client.post("/api/v1/notion/sync/enable") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, res.status)
        val json = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        assertEquals(0, json["importedTakes"]?.jsonPrimitive?.int)
        assertEquals(0, fakeNotionClient.downloadExternalFileCalls.size)

        transaction(db) {
            assertEquals(0, TakesTable.selectAll().where { TakesTable.userId eq userA }.count())
        }
    }

    @Test
    fun `리뷰 2번 enable 시 녹음 파일 중 1개가 다운로드 실패(403)해도 전체 enable 성공 및 나머지 반영`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        registerNotionKey(client, tokenA)

        val n1PageId = "page-song-err"
        val s1PageId = "page-session-err"
        val n1 = buildNotionSongPage(pageId = n1PageId, videoId = "dQw4w9WgXcQ", title = "Error Isolation")
        val s1 = buildNotionSessionPage(
            pageId = s1PageId,
            songNotionPageId = n1PageId,
            date = "2026-10-30",
            minutes = 20.0,
            files = listOf(
                Pair("2026-10-30_10-00-00.m4a", "https://notion.so/signed/fail.m4a"),
                Pair("2026-10-30_10-10-00.m4a", "https://notion.so/signed/success.m4a")
            )
        )

        fakeNotionClient.downloadExternalFileHandler = { url ->
            if (url.contains("fail")) {
                throw ulevelp.notion.NotionApiException(403, "forbidden", "Forbidden")
            } else {
                Pair(ByteArray(1024) { 1 }, "audio/mp4")
            }
        }

        fakeNotionClient.queryDatabaseHandler = { _, databaseId, _ ->
            if (databaseId == testSongsDb) {
                buildJsonObject {
                    putJsonArray("results") { add(n1) }
                    put("has_more", false)
                }
            } else {
                buildJsonObject {
                    putJsonArray("results") { add(s1) }
                    put("has_more", false)
                }
            }
        }

        val res = client.post("/api/v1/notion/sync/enable") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, res.status)
        val json = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        assertEquals(1, json["importedTakes"]?.jsonPrimitive?.int)
        assertTrue(json["ok"]?.jsonPrimitive?.boolean == true)

        transaction(db) {
            val syncRow = NotionSyncTable.selectAll().where { NotionSyncTable.userId eq userA }.single()
            assertTrue(syncRow[NotionSyncTable.enabled])
            assertEquals(1, TakesTable.selectAll().where { TakesTable.userId eq userA }.count())
        }
    }

    @Test
    fun `리뷰 3번 로컬에서 삭제된 곡을 가리키는 노션 세션이 있어도 pull이 200 반환 및 FK 위반 방지`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        registerNotionKey(client, tokenA)

        val n1PageId = "page-song-del"
        val s1PageId = "page-session-del"
        val n1 = buildNotionSongPage(pageId = n1PageId, videoId = "dQw4w9WgXcQ", title = "To Delete")
        val s1 = buildNotionSessionPage(
            pageId = s1PageId,
            songNotionPageId = n1PageId,
            date = "2026-10-30",
            minutes = 15.0
        )

        fakeNotionClient.queryDatabaseHandler = { _, databaseId, _ ->
            if (databaseId == testSongsDb) {
                buildJsonObject {
                    putJsonArray("results") { add(n1) }
                    put("has_more", false)
                }
            } else {
                buildJsonObject {
                    putJsonArray("results") { add(s1) }
                    put("has_more", false)
                }
            }
        }

        // 1. enable 호출로 N1 곡 및 S1 세션 이관 완료
        val enableRes = client.post("/api/v1/notion/sync/enable") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, enableRes.status)

        val songId = transaction(db) {
            SongsTable.selectAll().where {
                (SongsTable.userId eq userA) and (SongsTable.videoId eq "dQw4w9WgXcQ")
            }.single()[SongsTable.id]
        }

        // 2. DELETE /songs/{songId} 호출하여 로컬에서 곡 삭제 및 outbox에 delete 대기 적재
        val deleteRes = client.delete("/api/v1/songs/$songId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, deleteRes.status)

        // 3. lastPullAt을 10분 전으로 설정
        val now = OffsetDateTime.now(ZoneOffset.UTC).truncatedTo(ChronoUnit.SECONDS)
        val tenMinutesAgo = now.minusMinutes(10)
        transaction(db) {
            NotionSyncTable.update({ NotionSyncTable.userId eq userA }) {
                it[lastPullAt] = tenMinutesAgo
            }
        }

        // 4. 노션에서 삭제된 N1을 가리키는 새로운 세션 S2 페이지 반환 시뮬레이션
        val s2PageId = "page-session-s2-orphan"
        val s2 = buildNotionSessionPage(
            pageId = s2PageId,
            songNotionPageId = n1PageId,
            date = "2026-10-31",
            minutes = 25.0
        )

        fakeNotionClient.queryDatabaseHandler = { _, databaseId, _ ->
            if (databaseId == testSongsDb) {
                buildJsonObject {
                    putJsonArray("results") {}
                    put("has_more", false)
                }
            } else {
                buildJsonObject {
                    putJsonArray("results") { add(s2) }
                    put("has_more", false)
                }
            }
        }

        // 5. pull 호출 시 FK 제약조건 위반이나 NoSuchElementException 없이 200 반환 및 updatedSessions=0 검증
        val pullRes = client.post("/api/v1/notion/sync/pull") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, pullRes.status)
        val pullJson = Json.parseToJsonElement(pullRes.bodyAsText()).jsonObject
        assertEquals(0, pullJson["updatedSessions"]?.jsonPrimitive?.int)
    }
}
