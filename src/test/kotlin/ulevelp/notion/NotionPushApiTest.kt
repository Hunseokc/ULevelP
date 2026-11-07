package ulevelp.notion

import com.sun.net.httpserver.HttpServer
import com.zaxxer.hikari.HikariDataSource
import io.ktor.client.HttpClient
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.server.testing.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.jetbrains.exposed.sql.Database
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
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
import ulevelp.api.ApiException
import ulevelp.db.*
import ulevelp.support.*
import java.io.OutputStream
import java.math.BigDecimal
import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.*

class NotionPushApiTest {

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
            AnalysisJobsTable.deleteAll()
            NotesTable.deleteAll()
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
            }

            UsersTable.insert {
                it[id] = userB
                it[email] = "userB@example.com"
            }
            ProfilesTable.insert {
                it[id] = userB
                it[displayName] = "User B"
            }
        }
    }

    private fun registerNotionKeyForUserA(client: HttpClient) = runBlocking {
        val body = buildJsonObject {
            put("token", testNotionToken)
            put("songsDb", testSongsDb)
            put("sessionsDb", testSessionsDb)
            put("notesDb", testNotesDb)
        }.toString()

        val res = client.put("/api/v1/integrations/notion") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            header(HttpHeaders.ContentType, "application/json")
            setBody(body)
        }
        assertEquals(HttpStatusCode.OK, res.status)

        // 연동 활성화
        transaction(db) {
            val exists = NotionSyncTable.selectAll().where { NotionSyncTable.userId eq userA }.count() > 0
            if (exists) {
                NotionSyncTable.update({ NotionSyncTable.userId eq userA }) {
                    it[enabled] = true
                }
            } else {
                NotionSyncTable.insert {
                    it[userId] = userA
                    it[enabled] = true
                }
            }
        }
    }

    @Test
    fun `NP1 곡 신규 생성 Push (Code gs 본문 일치)`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        registerNotionKeyForUserA(client)

        val songId = UUID.randomUUID()
        transaction(db) {
            SongsTable.insert {
                it[id] = songId
                it[userId] = userA
                it[title] = "Autumn Leaves"
                it[artist] = "Eva Cassidy"
                it[status] = "practicing"
                it[videoId] = "dQw4w9WgXcQ"
                it[pos] = BigDecimal("42.5")
                it[a] = BigDecimal("38.0")
                it[b] = BigDecimal("55.2")
                it[rate] = BigDecimal("0.75")
                it[lastDate] = LocalDate.parse("2026-10-30")
                it[memo] = "메모"
            }
            SyncOutboxTable.insert {
                it[userId] = userA
                it[entity] = "song"
                it[entityId] = songId
                it[op] = "upsert"
            }
        }

        val res = client.post("/api/v1/notion/sync/push") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, res.status)
        val resJson = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        assertEquals(true, resJson["ok"]?.jsonPrimitive?.boolean)
        assertEquals(1, resJson["processed"]?.jsonPrimitive?.int)
        assertEquals(0, resJson["failed"]?.jsonPrimitive?.int)

        assertEquals(1, fakeNotionClient.createPageCalls.size)
        val createCall = fakeNotionClient.createPageCalls[0]
        assertEquals(testNotionToken, createCall.token)

        val body = createCall.body
        val parentDb = body["parent"]?.jsonObject?.get("database_id")?.jsonPrimitive?.content
        assertEquals(testSongsDb, parentDb)

        val emoji = body["icon"]?.jsonObject?.get("emoji")?.jsonPrimitive?.content
        assertEquals("🎵", emoji)

        val props = body["properties"]?.jsonObject
        assertNotNull(props)
        assertEquals(11, props.keys.size)

        // 1. 곡명
        val title = props["곡명"]?.jsonObject?.get("title")?.jsonArray?.get(0)?.jsonObject
            ?.get("text")?.jsonObject?.get("content")?.jsonPrimitive?.content
        assertEquals("Autumn Leaves", title)

        // 2. 아티스트
        val artist = props["아티스트"]?.jsonObject?.get("rich_text")?.jsonArray?.get(0)?.jsonObject
            ?.get("text")?.jsonObject?.get("content")?.jsonPrimitive?.content
        assertEquals("Eva Cassidy", artist)

        // 3. 상태
        val status = props["상태"]?.jsonObject?.get("select")?.jsonObject?.get("name")?.jsonPrimitive?.content
        assertEquals("연습 중", status)

        // 4. 유튜브 링크
        val link = props["유튜브 링크"]?.jsonObject?.get("url")?.jsonPrimitive?.content
        assertEquals("https://www.youtube.com/watch?v=dQw4w9WgXcQ", link)

        // 5. 이어서 연습
        val resume = props["이어서 연습"]?.jsonObject?.get("url")?.jsonPrimitive?.content
        assertNotNull(resume)
        assertTrue(resume.contains("practice.html?v=dQw4w9WgXcQ"))

        // 6. 마지막 위치(초)
        assertEquals(42.5, props["마지막 위치(초)"]?.jsonObject?.get("number")?.jsonPrimitive?.double)

        // 7. 구간 시작(초)
        assertEquals(38.0, props["구간 시작(초)"]?.jsonObject?.get("number")?.jsonPrimitive?.double)

        // 8. 구간 끝(초)
        assertEquals(55.2, props["구간 끝(초)"]?.jsonObject?.get("number")?.jsonPrimitive?.double)

        // 9. 속도
        assertEquals(0.75, props["속도"]?.jsonObject?.get("number")?.jsonPrimitive?.double)

        // 10. 마지막 연습일
        val lastDateStr = props["마지막 연습일"]?.jsonObject?.get("date")?.jsonObject?.get("start")?.jsonPrimitive?.content
        assertEquals("2026-10-30", lastDateStr)

        // 11. 메모
        val memo = props["메모"]?.jsonObject?.get("rich_text")?.jsonArray?.get(0)?.jsonObject
            ?.get("text")?.jsonObject?.get("content")?.jsonPrimitive?.content
        assertEquals("메모", memo)

        // DB 확인: notion_links & sync_outbox
        transaction(db) {
            val linkRow = NotionLinksTable.selectAll()
                .where { (NotionLinksTable.entity eq "song") and (NotionLinksTable.entityId eq songId) }
                .singleOrNull()
            assertNotNull(linkRow)
            assertEquals(userA, linkRow[NotionLinksTable.userId])

            val outboxRow = SyncOutboxTable.selectAll()
                .where { SyncOutboxTable.entityId eq songId }
                .singleOrNull()
            assertNotNull(outboxRow)
            assertNotNull(outboxRow[SyncOutboxTable.doneAt])
        }
    }

    @Test
    fun `NP2 곡 수정 Push (PATCH pages id)`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        registerNotionKeyForUserA(client)

        val songId = UUID.randomUUID()
        transaction(db) {
            SongsTable.insert {
                it[id] = songId
                it[userId] = userA
                it[title] = "Autumn Leaves"
                it[artist] = "Eva Cassidy"
                it[status] = "practicing"
                it[videoId] = "dQw4w9WgXcQ"
                it[pos] = BigDecimal("42.5")
                it[a] = BigDecimal("38.0")
                it[b] = BigDecimal("55.2")
                it[rate] = BigDecimal("0.75")
                it[lastDate] = LocalDate.parse("2026-10-30")
                it[memo] = "메모"
            }
            SyncOutboxTable.insert {
                it[userId] = userA
                it[entity] = "song"
                it[entityId] = songId
                it[op] = "upsert"
            }
        }

        // 1차 Push (NP1)
        client.post("/api/v1/notion/sync/push") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(1, fakeNotionClient.createPageCalls.size)

        val songNotionPageId = transaction(db) {
            NotionLinksTable.selectAll()
                .where { (NotionLinksTable.entity eq "song") and (NotionLinksTable.entityId eq songId) }
                .single()[NotionLinksTable.notionPageId]
        }

        // 곡 수정 + 새 Outbox 적재
        transaction(db) {
            SongsTable.update({ SongsTable.id eq songId }) {
                it[status] = "paused"
                it[memo] = "수정됨"
            }
            SyncOutboxTable.insert {
                it[userId] = userA
                it[entity] = "song"
                it[entityId] = songId
                it[op] = "upsert"
            }
        }

        // 2차 Push
        val res = client.post("/api/v1/notion/sync/push") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, res.status)

        // 새 페이지 생성이 아닌 updatePage가 호출되었는지 확인
        assertEquals(1, fakeNotionClient.createPageCalls.size)
        assertEquals(1, fakeNotionClient.updatePageCalls.size)

        val updateCall = fakeNotionClient.updatePageCalls[0]
        assertEquals(songNotionPageId, updateCall.pageId)
        val patchedProps = updateCall.body["properties"]?.jsonObject
        assertNotNull(patchedProps)
        assertEquals("보류", patchedProps["상태"]?.jsonObject?.get("select")?.jsonObject?.get("name")?.jsonPrimitive?.content)
        assertEquals("수정됨", patchedProps["메모"]?.jsonObject?.get("rich_text")?.jsonArray?.get(0)?.jsonObject
            ?.get("text")?.jsonObject?.get("content")?.jsonPrimitive?.content)
    }

    @Test
    fun `NP3 세션 생성 및 수정 Push (부모 곡 링크 자동 보장 포함)`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        registerNotionKeyForUserA(client)

        val songId = UUID.randomUUID()
        val sessionId = UUID.randomUUID()

        transaction(db) {
            SongsTable.insert {
                it[id] = songId
                it[userId] = userA
                it[title] = "Autumn Leaves"
                it[artist] = "Eva Cassidy"
                it[status] = "practicing"
                it[videoId] = "dQw4w9WgXcQ"
            }
            SessionsTable.insert {
                it[id] = sessionId
                it[userId] = userA
                it[this.songId] = songId
                it[date] = LocalDate.parse("2026-10-30")
                it[seconds] = 990 // 16.5 분
                it[loops] = 26
                it[rate] = BigDecimal("0.75")
                it[a] = BigDecimal("38.0")
                it[b] = BigDecimal("55.2")
            }
            // outbox에 session만 있음 (곡 notion_links 없음)
            SyncOutboxTable.insert {
                it[userId] = userA
                it[entity] = "session"
                it[entityId] = sessionId
                it[op] = "upsert"
            }
        }

        val res = client.post("/api/v1/notion/sync/push") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, res.status)

        // 곡 페이지 생성 -> 세션 페이지 생성 (총 2회 createPage)
        assertEquals(2, fakeNotionClient.createPageCalls.size)
        val songCreate = fakeNotionClient.createPageCalls[0]
        val sessionCreate = fakeNotionClient.createPageCalls[1]

        assertEquals(testSongsDb, songCreate.body["parent"]?.jsonObject?.get("database_id")?.jsonPrimitive?.content)
        assertEquals(testSessionsDb, sessionCreate.body["parent"]?.jsonObject?.get("database_id")?.jsonPrimitive?.content)

        val sProps = sessionCreate.body["properties"]?.jsonObject
        assertNotNull(sProps)

        // 기록 (title)
        val sessionTitle = sProps["기록"]?.jsonObject?.get("title")?.jsonArray?.get(0)?.jsonObject
            ?.get("text")?.jsonObject?.get("content")?.jsonPrimitive?.content
        assertEquals("2026-10-30 Autumn Leaves", sessionTitle)

        // 곡 (relation)
        val songRelId = sProps["곡"]?.jsonObject?.get("relation")?.jsonArray?.get(0)?.jsonObject
            ?.get("id")?.jsonPrimitive?.content
        val songNotionId = transaction(db) {
            NotionLinksTable.selectAll()
                .where { (NotionLinksTable.entity eq "song") and (NotionLinksTable.entityId eq songId) }
                .single()[NotionLinksTable.notionPageId]
        }
        assertEquals(songNotionId, songRelId)

        // 연습 시간(분)
        assertEquals(16.5, sProps["연습 시간(분)"]?.jsonObject?.get("number")?.jsonPrimitive?.double)

        // 구간
        val seg = sProps["구간"]?.jsonObject?.get("rich_text")?.jsonArray?.get(0)?.jsonObject
            ?.get("text")?.jsonObject?.get("content")?.jsonPrimitive?.content
        assertEquals("0:38–0:55", seg)
    }

    @Test
    fun `NP4 녹음(take) 단일 파트 업로드 및 블록·속성 첨부`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        registerNotionKeyForUserA(client)

        val songId = UUID.randomUUID()
        val sessionId = UUID.randomUUID()
        val takeId = UUID.randomUUID()
        val storageKey = "takes/$userA/$takeId.m4a"

        fakeStorageClient.upload(storageKey, ByteArray(1024 * 1024) { 1 }, "audio/mp4")

        transaction(db) {
            SongsTable.insert {
                it[id] = songId
                it[userId] = userA
                it[title] = "Autumn Leaves"
                it[videoId] = "dQw4w9WgXcQ"
            }
            SessionsTable.insert {
                it[id] = sessionId
                it[userId] = userA
                it[this.songId] = songId
                it[date] = LocalDate.parse("2026-10-30")
                it[seconds] = 990
            }
            TakesTable.insert {
                it[id] = takeId
                it[userId] = userA
                it[this.sessionId] = sessionId
                it[this.songId] = songId
                // 2026-10-30T05:22:10Z -> 서울 시각 14:22
                it[recordedAt] = OffsetDateTime.parse("2026-10-30T05:22:10Z")
                it[a] = BigDecimal("38.0")
                it[b] = BigDecimal("55.2")
                it[rate] = BigDecimal("0.75")
                it[durationSec] = 18
                it[mime] = "audio/mp4"
                it[sizeBytes] = 1024 * 1024
                it[storage] = "supabase"
                it[this.storageKey] = storageKey
            }
            SyncOutboxTable.insert {
                it[userId] = userA
                it[entity] = "take"
                it[entityId] = takeId
                it[op] = "upsert"
            }
        }

        val res = client.post("/api/v1/notion/sync/push") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, res.status)

        // 1. 단일 파트 uploadFile 호출 확인
        assertEquals(1, fakeNotionClient.uploadFileCalls.size)
        val uploadCall = fakeNotionClient.uploadFileCalls[0]
        assertEquals("2026-10-30 1422 Autumn Leaves.m4a", uploadCall.filename)
        assertEquals("audio/mp4", uploadCall.mime)

        // 2. appendBlockChildren 호출 확인 (캡션 + audio 블록)
        assertEquals(1, fakeNotionClient.appendBlockChildrenCalls.size)
        val appendCall = fakeNotionClient.appendBlockChildrenCalls[0]
        val children = appendCall.children
        assertEquals(2, children.size)

        val paragraphContent = children[0].jsonObject["paragraph"]?.jsonObject
            ?.get("rich_text")?.jsonArray?.get(0)?.jsonObject
            ?.get("text")?.jsonObject?.get("content")?.jsonPrimitive?.content
        assertEquals("🎙 14:22 · 0:38–0:55 · 0.75× · 0:18", paragraphContent)

        val audioBlock = children[1].jsonObject["audio"]?.jsonObject
        assertEquals("file_upload", audioBlock?.get("type")?.jsonPrimitive?.content)

        // 3. 세션 페이지 녹음 파일 속성에 추가 확인
        assertTrue(fakeNotionClient.retrievePageCalls.isNotEmpty())
        assertTrue(fakeNotionClient.updatePageCalls.any {
            it.body["properties"]?.jsonObject?.containsKey("녹음") == true
        })

        // 4. notion_links 확인
        transaction(db) {
            val linkRow = NotionLinksTable.selectAll()
                .where { (NotionLinksTable.entity eq "take") and (NotionLinksTable.entityId eq takeId) }
                .singleOrNull()
            assertNotNull(linkRow)
            assertTrue(linkRow[NotionLinksTable.notionPageId].isNotBlank())
            assertTrue(linkRow[NotionLinksTable.notionExtra]?.isNotBlank() == true)
        }
    }

    @Test
    fun `NP5 20MB 초과 녹음 멀티파트 분할 업로드 (HttpNotionClient)`() {
        val server = HttpServer.create(InetSocketAddress(0), 0)
        val fileUploadsReceived = AtomicInteger(0)
        val sendCallsReceived = AtomicInteger(0)
        val completeReceived = AtomicInteger(0)
        val sendPartNumbers = mutableListOf<String>()
        val sendBodySizes = mutableListOf<Int>()

        server.createContext("/file_uploads") { exchange ->
            val path = exchange.requestURI.path
            val method = exchange.requestMethod
            val bodyText = String(exchange.requestBody.readAllBytes(), StandardCharsets.UTF_8)

            when {
                path == "/file_uploads" && method == "POST" -> {
                    fileUploadsReceived.incrementAndGet()
                    val reqJson = Json.parseToJsonElement(bodyText).jsonObject
                    assertEquals("multi_part", reqJson["mode"]?.jsonPrimitive?.content)
                    assertEquals(3, reqJson["number_of_parts"]?.jsonPrimitive?.int)

                    val resp = """{"id": "fu-test-multipart"}"""
                    exchange.responseHeaders.set("Content-Type", "application/json")
                    exchange.sendResponseHeaders(200, resp.toByteArray().size.toLong())
                    exchange.responseBody.use { it.write(resp.toByteArray()) }
                }
                path.endsWith("/send") && method == "POST" -> {
                    sendCallsReceived.incrementAndGet()
                    val rawBody = bodyText // multipart string
                    val partNumRegex = Regex("""name="part_number"\r\n\r\n(\d+)""")
                    val partMatch = partNumRegex.find(rawBody)
                    if (partMatch != null) {
                        sendPartNumbers.add(partMatch.groupValues[1])
                    }
                    sendBodySizes.add(rawBody.length)

                    val resp = """{"ok": true}"""
                    exchange.responseHeaders.set("Content-Type", "application/json")
                    exchange.sendResponseHeaders(200, resp.toByteArray().size.toLong())
                    exchange.responseBody.use { it.write(resp.toByteArray()) }
                }
                path.endsWith("/complete") && method == "POST" -> {
                    completeReceived.incrementAndGet()
                    val resp = """{"id": "fu-test-multipart"}"""
                    exchange.responseHeaders.set("Content-Type", "application/json")
                    exchange.sendResponseHeaders(200, resp.toByteArray().size.toLong())
                    exchange.responseBody.use { it.write(resp.toByteArray()) }
                }
                else -> {
                    exchange.sendResponseHeaders(404, 0)
                    exchange.close()
                }
            }
        }
        server.start()

        try {
            val port = server.address.port
            val client = HttpNotionClient(baseUrl = "http://localhost:$port")
            val bytes25Mb = ByteArray(25 * 1024 * 1024) { (it % 127).toByte() }

            val returnedId = runBlocking {
                client.uploadFile("test-token", "big.m4a", "audio/mp4", bytes25Mb)
            }

            assertEquals("fu-test-multipart", returnedId)
            assertEquals(1, fileUploadsReceived.get())
            assertEquals(3, sendCallsReceived.get())
            assertEquals(1, completeReceived.get())
            assertEquals(listOf("1", "2", "3"), sendPartNumbers)
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun `NP6 곡·세션·녹음 삭제(delete) 시 노션 아카이브 및 notion_links 정리`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        registerNotionKeyForUserA(client)

        val songId = UUID.randomUUID()
        val sessionId = UUID.randomUUID()
        val takeId = UUID.randomUUID()

        val songPageId = "page-song-123"
        val sessionPageId = "page-session-456"
        val audioBlockId = "block-audio-789"
        val captionBlockId = "block-caption-012"

        transaction(db) {
            NotionLinksTable.insert {
                it[entity] = "song"
                it[entityId] = songId
                it[userId] = userA
                it[notionPageId] = songPageId
            }
            NotionLinksTable.insert {
                it[entity] = "session"
                it[entityId] = sessionId
                it[userId] = userA
                it[notionPageId] = sessionPageId
            }
            NotionLinksTable.insert {
                it[entity] = "take"
                it[entityId] = takeId
                it[userId] = userA
                it[notionPageId] = audioBlockId
                it[notionExtra] = captionBlockId
            }

            // delete outbox 적재
            SyncOutboxTable.insert {
                it[userId] = userA
                it[entity] = "take"
                it[entityId] = takeId
                it[op] = "delete"
            }
            SyncOutboxTable.insert {
                it[userId] = userA
                it[entity] = "session"
                it[entityId] = sessionId
                it[op] = "delete"
            }
            SyncOutboxTable.insert {
                it[userId] = userA
                it[entity] = "song"
                it[entityId] = songId
                it[op] = "delete"
            }
        }

        val res = client.post("/api/v1/notion/sync/push") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, res.status)

        // 녹음 삭제 -> archiveBlock 2회 호출 (audio block, caption block)
        val archivedBlockIds = fakeNotionClient.archiveBlockCalls.map { it.blockId }
        assertTrue(archivedBlockIds.contains(audioBlockId))
        assertTrue(archivedBlockIds.contains(captionBlockId))

        // 곡·세션 삭제 -> updatePage 호출 with archived=true
        val archivedPages = fakeNotionClient.updatePageCalls.filter {
            it.body["archived"]?.jsonPrimitive?.booleanOrNull == true
        }.map { it.pageId }
        assertTrue(archivedPages.contains(songPageId))
        assertTrue(archivedPages.contains(sessionPageId))

        // notion_links 0행 확인
        transaction(db) {
            val count = NotionLinksTable.selectAll().count()
            assertEquals(0L, count)
        }
    }

    @Test
    fun `NP7 Lease 동시 실행 방지`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        registerNotionKeyForUserA(client)

        val songId = UUID.randomUUID()
        transaction(db) {
            SongsTable.insert {
                it[id] = songId
                it[userId] = userA
                it[title] = "Autumn Leaves"
                it[videoId] = "dQw4w9WgXcQ"
            }
            SyncOutboxTable.insert {
                it[userId] = userA
                it[entity] = "song"
                it[entityId] = songId
                it[op] = "upsert"
            }
            // 다른 워커가 3분 뒤까지 lease 점유 중
            NotionSyncTable.update({ NotionSyncTable.userId eq userA }) {
                it[leaseUntil] = OffsetDateTime.now(ZoneOffset.UTC).plusMinutes(3)
                it[leaseOwner] = "other-worker"
            }
        }

        val res1 = client.post("/api/v1/notion/sync/push") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, res1.status)
        val json1 = Json.parseToJsonElement(res1.bodyAsText()).jsonObject
        assertEquals(0, json1["processed"]?.jsonPrimitive?.int)
        assertEquals(0, json1["failed"]?.jsonPrimitive?.int)
        assertEquals(0, fakeNotionClient.createPageCalls.size) // 호출 차단됨

        // 만료된 lease (1분 전)로 변경 후 다시 시도
        transaction(db) {
            NotionSyncTable.update({ NotionSyncTable.userId eq userA }) {
                it[leaseUntil] = OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(1)
                it[leaseOwner] = "other-worker"
            }
        }

        val res2 = client.post("/api/v1/notion/sync/push") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, res2.status)
        val json2 = Json.parseToJsonElement(res2.bodyAsText()).jsonObject
        assertEquals(1, json2["processed"]?.jsonPrimitive?.int)
        assertEquals(1, fakeNotionClient.createPageCalls.size) // 정상 실행됨
    }

    @Test
    fun `NP8 노션 429 Retry-After 자동 재시도`() {
        val server = HttpServer.create(InetSocketAddress(0), 0)
        val callCount = AtomicInteger(0)

        server.createContext("/pages/p1") { exchange ->
            val count = callCount.incrementAndGet()
            if (count == 1) {
                exchange.responseHeaders.set("Retry-After", "1")
                val err = """{"code": "rate_limited", "message": "Rate limited"}"""
                exchange.sendResponseHeaders(429, err.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(err.toByteArray()) }
            } else {
                val ok = """{"id": "p1", "properties": {}}"""
                exchange.responseHeaders.set("Content-Type", "application/json")
                exchange.sendResponseHeaders(200, ok.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(ok.toByteArray()) }
            }
        }
        server.start()

        try {
            val port = server.address.port
            val client = HttpNotionClient(baseUrl = "http://localhost:$port")

            val res = runBlocking {
                client.retrievePage("test-token", "p1")
            }

            assertEquals("p1", res["id"]?.jsonPrimitive?.content)
            assertEquals(2, callCount.get())
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun `NP9 5회 실패 시 재시도 중단`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        registerNotionKeyForUserA(client)

        val songId = UUID.randomUUID()
        transaction(db) {
            SongsTable.insert {
                it[id] = songId
                it[userId] = userA
                it[title] = "Autumn Leaves"
                it[videoId] = "dQw4w9WgXcQ"
            }
            SyncOutboxTable.insert {
                it[userId] = userA
                it[entity] = "song"
                it[entityId] = songId
                it[op] = "upsert"
            }
        }

        // 항상 실패하게 핸들러 등록
        fakeNotionClient.createPageHandler = { _, _ ->
            throw NotionApiException(500, "internal_error", "Notion 500 error")
        }

        // 1~5회 호출: attempts 증가
        for (i in 1..5) {
            val res = client.post("/api/v1/notion/sync/push") {
                header(HttpHeaders.Authorization, "Bearer $tokenA")
            }
            assertEquals(HttpStatusCode.OK, res.status)
            val json = Json.parseToJsonElement(res.bodyAsText()).jsonObject
            assertEquals(0, json["processed"]?.jsonPrimitive?.int)
            assertEquals(1, json["failed"]?.jsonPrimitive?.int)

            val attempts = transaction(db) {
                SyncOutboxTable.selectAll()
                    .where { SyncOutboxTable.entityId eq songId }
                    .single()[SyncOutboxTable.attempts]
            }
            assertEquals(i, attempts)
        }

        fakeNotionClient.createPageCalls.clear()

        // 6회차 호출: attempts >= 5 이므로 쿼리에서 제외되어 노션 API 호출 안 함
        val res6 = client.post("/api/v1/notion/sync/push") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, res6.status)
        val json6 = Json.parseToJsonElement(res6.bodyAsText()).jsonObject
        assertEquals(0, json6["processed"]?.jsonPrimitive?.int)
        assertEquals(0, json6["failed"]?.jsonPrimitive?.int)
        assertEquals(0, fakeNotionClient.createPageCalls.size)
    }

    @Test
    fun `NP10 internal cron notion-push OIDC 검증`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        // 1. 토큰 없음
        val resNoAuth = client.post("/internal/cron/notion-push")
        assertEquals(HttpStatusCode.Unauthorized, resNoAuth.status)
        assertStandardError(resNoAuth.bodyAsText(), 401, "UNAUTHORIZED")

        // 2. 잘못된 aud
        val wrongAudToken = TestCronJwt.token(aud = "https://wrong-audience.com")
        val resWrongAud = client.post("/internal/cron/notion-push") {
            header(HttpHeaders.Authorization, "Bearer $wrongAudToken")
        }
        assertEquals(HttpStatusCode.Unauthorized, resWrongAud.status)
        assertStandardError(resWrongAud.bodyAsText(), 401, "UNAUTHORIZED")

        // 3. 잘못된 email
        val wrongEmailToken = TestCronJwt.token(email = "attacker@evil.com")
        val resWrongEmail = client.post("/internal/cron/notion-push") {
            header(HttpHeaders.Authorization, "Bearer $wrongEmailToken")
        }
        assertEquals(HttpStatusCode.Unauthorized, resWrongEmail.status)
        assertStandardError(resWrongEmail.bodyAsText(), 401, "UNAUTHORIZED")

        // 4. 만료된 토큰
        val expiredToken = TestCronJwt.token(exp = TestCronJwt.FIXED_NOW.epochSecond - 10)
        val resExpired = client.post("/internal/cron/notion-push") {
            header(HttpHeaders.Authorization, "Bearer $expiredToken")
        }
        assertEquals(HttpStatusCode.Unauthorized, resExpired.status)
        assertStandardError(resExpired.bodyAsText(), 401, "UNAUTHORIZED")

        // 5. 정상 OIDC 토큰
        val validToken = TestCronJwt.token()
        val resValid = client.post("/internal/cron/notion-push") {
            header(HttpHeaders.Authorization, "Bearer $validToken")
        }
        assertEquals(HttpStatusCode.OK, resValid.status)
        val json = Json.parseToJsonElement(resValid.bodyAsText()).jsonObject
        assertEquals(true, json["ok"]?.jsonPrimitive?.boolean)
    }

    @Test
    fun `NP11 internal cron notion-push 통합 배치 및 사용자 예외 격리`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        registerNotionKeyForUserA(client)

        val songA = UUID.randomUUID()
        val songB = UUID.randomUUID()
        val trashKey = "takes/old-take-deleted.m4a"
        val oldJobId = UUID.randomUUID()
        val recentJobId = UUID.randomUUID()

        fakeStorageClient.upload(trashKey, ByteArray(100), "audio/mp4")

        transaction(db) {
            // 사용자 B: 키 미등록이지만 enabled=true 및 outbox 존재
            NotionSyncTable.insert {
                it[userId] = userB
                it[enabled] = true
            }
            SongsTable.insert {
                it[id] = songB
                it[userId] = userB
                it[title] = "Song B"
                it[videoId] = "11111111111"
            }
            SyncOutboxTable.insert {
                it[userId] = userB
                it[entity] = "song"
                it[entityId] = songB
                it[op] = "upsert"
            }

            // 사용자 A: 정상 키 등록, outbox 존재
            SongsTable.insert {
                it[id] = songA
                it[userId] = userA
                it[title] = "Song A"
                it[videoId] = "22222222222"
            }
            SyncOutboxTable.insert {
                it[userId] = userA
                it[entity] = "song"
                it[entityId] = songA
                it[op] = "upsert"
            }

            // storage_trash 항목 1건
            StorageTrashTable.insert {
                it[storageKey] = trashKey
                it[attempts] = 0
            }

            // analysis_jobs: 75분 전 시작된 작업 + 10분 전 시작된 작업
            val nowUtc = OffsetDateTime.now(ZoneOffset.UTC)
            AnalysisJobsTable.insert {
                it[id] = oldJobId
                it[userId] = userA
                it[url] = "https://youtube.com/watch?v=old"
                it[tags] = listOf("화성")
                it[status] = "running"
                it[startedAt] = nowUtc.minusMinutes(75)
            }
            AnalysisJobsTable.insert {
                it[id] = recentJobId
                it[userId] = userA
                it[url] = "https://youtube.com/watch?v=recent"
                it[tags] = listOf("리듬")
                it[status] = "running"
                it[startedAt] = nowUtc.minusMinutes(10)
            }
        }

        val validToken = TestCronJwt.token()
        val res = client.post("/internal/cron/notion-push") {
            header(HttpHeaders.Authorization, "Bearer $validToken")
        }
        assertEquals(HttpStatusCode.OK, res.status)

        val json = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        assertEquals(true, json["ok"]?.jsonPrimitive?.boolean)
        assertEquals(1, json["pushedUsers"]?.jsonPrimitive?.int)
        assertEquals(1, json["processedOutbox"]?.jsonPrimitive?.int)
        assertEquals(1, json["purgedTrash"]?.jsonPrimitive?.int)
        assertEquals(1, json["timedOutJobs"]?.jsonPrimitive?.int)

        // FakeStorageClient에서 파일 삭제 확인
        assertFalse(fakeStorageClient.objects.containsKey(trashKey))

        // analysis_jobs 상태 확인
        transaction(db) {
            val oldJob = AnalysisJobsTable.selectAll()
                .where { AnalysisJobsTable.id eq oldJobId }
                .single()
            assertEquals("failed", oldJob[AnalysisJobsTable.status])
            assertEquals("timeout", oldJob[AnalysisJobsTable.error])
            assertNotNull(oldJob[AnalysisJobsTable.finishedAt])

            val recentJob = AnalysisJobsTable.selectAll()
                .where { AnalysisJobsTable.id eq recentJobId }
                .single()
            assertEquals("running", recentJob[AnalysisJobsTable.status])
            assertNull(recentJob[AnalysisJobsTable.error])
        }
    }

    @Test
    fun `NP12 키 미등록 사용자 push 거부`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        // 사용자 B는 노션 키 미등록
        val res = client.post("/api/v1/notion/sync/push") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
        }
        assertEquals(HttpStatusCode.PreconditionFailed, res.status)
        val err = assertStandardError(res.bodyAsText(), 412, "NO_KEY")
        assertEquals("등록된 키가 없습니다. 먼저 키를 저장해 주세요.", err["message"]?.jsonPrimitive?.content)
    }

    @Test
    fun `NP13 delete 실패 시 500 일시 오류는 notion_links 유지 및 attempts 증가, 404는 성공 간주`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        registerNotionKeyForUserA(client)

        val songId = UUID.randomUUID()
        val songPageId = "page-song-err"

        transaction(db) {
            NotionLinksTable.insert {
                it[entity] = "song"
                it[entityId] = songId
                it[userId] = userA
                it[notionPageId] = songPageId
            }
            SyncOutboxTable.insert {
                it[userId] = userA
                it[entity] = "song"
                it[entityId] = songId
                it[op] = "delete"
            }
        }

        // 1. 500 일시 오류 발생 시
        fakeNotionClient.updatePageHandler = { _, _, _ ->
            throw NotionApiException(500, "internal_server_error", "노션 서버 일시 장애")
        }

        val res1 = client.post("/api/v1/notion/sync/push") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, res1.status)
        val json1 = Json.parseToJsonElement(res1.bodyAsText()).jsonObject
        assertEquals(0, json1["processed"]?.jsonPrimitive?.int)
        assertEquals(1, json1["failed"]?.jsonPrimitive?.int)

        // notion_links 보존 확인 및 outbox attempts=1, done_at is null 확인
        transaction(db) {
            val linkCount = NotionLinksTable.selectAll()
                .where { (NotionLinksTable.entity eq "song") and (NotionLinksTable.entityId eq songId) }
                .count()
            assertEquals(1L, linkCount)

            val outboxRow = SyncOutboxTable.selectAll()
                .where { (SyncOutboxTable.userId eq userA) and (SyncOutboxTable.entityId eq songId) }
                .single()
            assertEquals(1, outboxRow[SyncOutboxTable.attempts])
            assertNull(outboxRow[SyncOutboxTable.doneAt])
            assertNotNull(outboxRow[SyncOutboxTable.lastError])
        }

        // 2. 404 오류 발생 시 (노션에서 이미 삭제됨)
        fakeNotionClient.updatePageHandler = { _, _, _ ->
            throw NotionApiException(404, "object_not_found", "페이지를 찾을 수 없음")
        }

        val res2 = client.post("/api/v1/notion/sync/push") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, res2.status)
        val json2 = Json.parseToJsonElement(res2.bodyAsText()).jsonObject
        assertEquals(1, json2["processed"]?.jsonPrimitive?.int)
        assertEquals(0, json2["failed"]?.jsonPrimitive?.int)

        // notion_links 삭제 및 outbox done_at 기록 확인
        transaction(db) {
            val linkCount = NotionLinksTable.selectAll()
                .where { (NotionLinksTable.entity eq "song") and (NotionLinksTable.entityId eq songId) }
                .count()
            assertEquals(0L, linkCount)

            val outboxRow = SyncOutboxTable.selectAll()
                .where { (SyncOutboxTable.userId eq userA) and (SyncOutboxTable.entityId eq songId) }
                .single()
            assertNotNull(outboxRow[SyncOutboxTable.doneAt])
        }
    }

    @Test
    fun `NP14 take upsert 멱등성 검증 - 동일 take outbox 2건 시 uploadFile 1회만 호출`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        registerNotionKeyForUserA(client)

        val songId = UUID.randomUUID()
        val sessionId = UUID.randomUUID()
        val takeId = UUID.randomUUID()
        val storageKey = "takes/$userA/$takeId.m4a"
        val fakeAudioBytes = "sample-audio-bytes".toByteArray()
        fakeStorageClient.upload(storageKey, fakeAudioBytes, "audio/mp4")

        transaction(db) {
            SongsTable.insert {
                it[id] = songId
                it[userId] = userA
                it[title] = "Autumn Leaves"
                it[videoId] = "dQw4w9WgXcQ"
            }
            SessionsTable.insert {
                it[id] = sessionId
                it[userId] = userA
                it[this.songId] = songId
                it[date] = LocalDate.of(2026, 11, 1)
                it[seconds] = 300
                it[loops] = 5
            }
            TakesTable.insert {
                it[id] = takeId
                it[userId] = userA
                it[this.sessionId] = sessionId
                it[this.songId] = songId
                it[this.storageKey] = storageKey
                it[mime] = "audio/mp4"
                it[recordedAt] = OffsetDateTime.ofInstant(Instant.ofEpochMilli(1730467320000L), ZoneOffset.UTC)
                it[durationSec] = 18
                it[sizeBytes] = fakeAudioBytes.size.toLong()
                it[storage] = "supabase"
            }

            // 동일 take에 대해 2건의 upsert outbox 적재
            SyncOutboxTable.insert {
                it[userId] = userA
                it[entity] = "take"
                it[entityId] = takeId
                it[op] = "upsert"
            }
            SyncOutboxTable.insert {
                it[userId] = userA
                it[entity] = "take"
                it[entityId] = takeId
                it[op] = "upsert"
            }
        }

        val res = client.post("/api/v1/notion/sync/push") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, res.status)
        val json = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        assertEquals(2, json["processed"]?.jsonPrimitive?.int)
        assertEquals(0, json["failed"]?.jsonPrimitive?.int)

        // uploadFile이 1회만 호출되었는지 검증 (중복 호출 없음)
        assertEquals(1, fakeNotionClient.uploadFileCalls.size)

        // 두 outbox 항목 모두 doneAt 기록 확인
        transaction(db) {
            val uncompleted = SyncOutboxTable.selectAll()
                .where { (SyncOutboxTable.userId eq userA) and (SyncOutboxTable.doneAt.isNull()) }
                .count()
            assertEquals(0L, uncompleted)

            val links = NotionLinksTable.selectAll()
                .where { (NotionLinksTable.entity eq "take") and (NotionLinksTable.entityId eq takeId) }
                .count()
            assertEquals(1L, links)
        }
    }

    @Test
    fun `NP15 학습 노트(note) 신규 노션 발행 (SVG 업로드 + 100블록 초과 분할 PATCH)`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        registerNotionKeyForUserA(client)

        val noteId = UUID.randomUUID()
        val svgContent = """<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40"/></svg>"""

        val momentsArray = buildJsonArray {
            for (i in 1..110) {
                addJsonObject {
                    put("timestamp", "0:${i.toString().padStart(2, '0')}")
                    put("point", "포인트 $i")
                }
            }
        }
        val analysisJson = buildJsonObject {
            putJsonObject("summary") {
                put("headline", "한 줄 요약")
                putJsonArray("key_points") { add(JsonPrimitive("포인트1")) }
            }
            put("moments", momentsArray)
            putJsonArray("key_concepts") { add(JsonPrimitive("키워드1")) }
            put("difficulty", "중급")
        }

        transaction(db) {
            NotesTable.insert {
                it[id] = noteId
                it[userId] = userA
                it[videoId] = "dQw4w9WgXcQ"
                it[title] = "테스트 노트 영상"
                it[channel] = "테스트 채널"
                it[tags] = listOf("화성")
                it[memo] = "메모 내용"
                it[headline] = "한 줄 요약"
                it[points] = listOf("포인트1")
                it[keywords] = listOf("키워드1")
                it[difficulty] = "중급"
                it[analysis] = analysisJson
                it[diagramsSvg] = buildJsonArray { add(JsonPrimitive(svgContent)) }
                it[model] = "gemini-2.5-flash"
            }
            SyncOutboxTable.insert {
                it[userId] = userA
                it[entity] = "note"
                it[entityId] = noteId
                it[op] = "upsert"
            }
        }

        val res = client.post("/api/v1/notion/sync/push") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, res.status)
        val json = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        assertEquals(1, json["processed"]?.jsonPrimitive?.int)
        assertEquals(0, json["failed"]?.jsonPrimitive?.int)

        // 1. uploadFile이 "voicing_1.svg" (image/svg+xml)로 1회 호출
        assertEquals(1, fakeNotionClient.uploadFileCalls.size)
        val uploadCall = fakeNotionClient.uploadFileCalls[0]
        assertEquals("voicing_1.svg", uploadCall.filename)
        assertEquals("image/svg+xml", uploadCall.mime)

        // 2. createPageCalls에 parent.database_id == notesDb, 8개 속성, children.size == 100 전달
        assertEquals(1, fakeNotionClient.createPageCalls.size)
        val createCall = fakeNotionClient.createPageCalls[0]
        assertEquals(testNotesDb, createCall.body["parent"]?.jsonObject?.get("database_id")?.jsonPrimitive?.content)
        val props = createCall.body["properties"]?.jsonObject
        assertNotNull(props)
        assertEquals(8, props.size)
        assertTrue(props.containsKey("제목"))
        assertTrue(props.containsKey("URL"))
        assertTrue(props.containsKey("태그"))
        assertTrue(props.containsKey("채널"))
        assertTrue(props.containsKey("요약"))
        assertTrue(props.containsKey("키워드"))
        assertTrue(props.containsKey("난이도"))
        assertTrue(props.containsKey("메모"))
        val children = createCall.body["children"]?.jsonArray
        assertNotNull(children)
        assertEquals(100, children.size)

        // 3. appendBlockChildrenCalls에 나머지 블록 전달
        assertTrue(fakeNotionClient.appendBlockChildrenCalls.isNotEmpty())
        val totalAppended = fakeNotionClient.appendBlockChildrenCalls.sumOf { it.children.size }
        assertTrue(totalAppended > 0)

        // 4. notion_links에 ("note", noteId) 저장
        transaction(db) {
            val link = NotionLinksTable.selectAll()
                .where { (NotionLinksTable.entity eq "note") and (NotionLinksTable.entityId eq noteId) }
                .singleOrNull()
            assertNotNull(link)
            assertEquals(userA, link[NotionLinksTable.userId])
            assertNotNull(link[NotionLinksTable.notionPageId])
        }
    }

    @Test
    fun `NP16 학습 노트(note) 수정 시 기존 노션 페이지 속성 updatePage 호출`() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            notionClient = fakeNotionClient,
            storageClient = fakeStorageClient
        )

        registerNotionKeyForUserA(client)

        val noteId = UUID.randomUUID()
        val existingPageId = "page-note-existing-123"
        transaction(db) {
            NotesTable.insert {
                it[id] = noteId
                it[userId] = userA
                it[videoId] = "dQw4w9WgXcQ"
                it[title] = "수정된 노트 제목"
                it[channel] = "채널"
                it[tags] = listOf("화성", "TAB")
                it[memo] = "수정된 메모"
                it[headline] = "새 요약"
                it[points] = listOf("p1")
                it[keywords] = listOf("k1")
                it[difficulty] = "입문"
                it[analysis] = buildJsonObject {
                    putJsonObject("summary") { put("headline", "새 요약") }
                }
                it[diagramsSvg] = JsonArray(emptyList())
                it[model] = "gemini-2.5-flash"
            }
            NotionLinksTable.insert {
                it[entity] = "note"
                it[entityId] = noteId
                it[userId] = userA
                it[notionPageId] = existingPageId
            }
            SyncOutboxTable.insert {
                it[userId] = userA
                it[entity] = "note"
                it[entityId] = noteId
                it[op] = "upsert"
            }
        }

        val res = client.post("/api/v1/notion/sync/push") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, res.status)
        val json = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        assertEquals(1, json["processed"]?.jsonPrimitive?.int)
        assertEquals(0, json["failed"]?.jsonPrimitive?.int)

        // createPage는 호출되지 않고 updatePage가 기존 existingPageId로 호출되었는지 검증
        assertEquals(0, fakeNotionClient.createPageCalls.size)
        val updateCall = fakeNotionClient.updatePageCalls.singleOrNull { it.pageId == existingPageId }
        assertNotNull(updateCall)
        val props = updateCall.body["properties"]?.jsonObject
        assertNotNull(props)
        assertEquals("수정된 노트 제목", props["제목"]?.jsonObject?.get("title")?.jsonArray?.get(0)?.jsonObject?.get("text")?.jsonObject?.get("content")?.jsonPrimitive?.content)
    }
}
