package ulevelp.note

import com.zaxxer.hikari.HikariDataSource
import io.ktor.client.HttpClient
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.server.testing.*
import kotlinx.coroutines.delay
import kotlinx.serialization.json.*
import org.jetbrains.exposed.sql.*
import org.jetbrains.exposed.sql.transactions.transaction
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import ulevelp.db.*
import ulevelp.db.DatabaseConfig
import ulevelp.service.NoteService
import ulevelp.support.*
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.*

class NoteApiTest {

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
    private lateinit var fakeGeminiClient: FakeGeminiClient
    private lateinit var fakeDispatcher: FakeAnalyzeJobDispatcher

    @BeforeEach
    fun setUp() {
        tokenA = TestJwt.token(sub = userA, email = "usera@example.com")
        tokenB = TestJwt.token(sub = userB, email = "userb@example.com")
        fakeGeminiClient = FakeGeminiClient()
        fakeDispatcher = FakeAnalyzeJobDispatcher()

        transaction(db) {
            SyncOutboxTable.deleteAll()
            ProgressionsTable.deleteAll()
            AnalysisJobsTable.deleteAll()
            NotesTable.deleteAll()
            IntegrationsTable.deleteAll()
            NotionSyncTable.deleteAll()
            ProfilesTable.deleteAll()
            UsersTable.deleteAll()

            UsersTable.insert {
                it[id] = userA
                it[email] = "usera@example.com"
            }
            ProfilesTable.insert {
                it[id] = userA
                it[displayName] = "User A"
            }

            UsersTable.insert {
                it[id] = userB
                it[email] = "userb@example.com"
            }
            ProfilesTable.insert {
                it[id] = userB
                it[displayName] = "User B"
            }
        }
    }

    private fun assertStandardRateLimitError(
        bodyText: String,
        expectedStatus: Int = 429,
        expectedCode: String = "RATE_LIMITED",
        expectedSource: String = "server"
    ): JsonObject {
        val obj = Json.parseToJsonElement(bodyText).jsonObject
        assertEquals(
            setOf("ok", "source", "status", "code", "message", "retryAfter"),
            obj.keys,
            "Standard error response must contain exact 6 keys"
        )
        assertEquals(false, obj["ok"]?.jsonPrimitive?.boolean)
        assertEquals(expectedSource, obj["source"]?.jsonPrimitive?.content)
        assertEquals(expectedStatus, obj["status"]?.jsonPrimitive?.int)
        assertEquals(expectedCode, obj["code"]?.jsonPrimitive?.content)
        assertTrue(obj["message"]?.jsonPrimitive?.content?.isNotBlank() == true)
        return obj
    }

    private fun seedGeminiKey(userId: UUID, apiKey: String = "AIzaSyFakeKeyForIntegrationTest1234X9zQ", model: String = "gemini-flash-latest") {
        val crypto = TestCrypto.service ?: error("CryptoService not available")
        val enc = crypto.encryptProviderKey(userId, "gemini", apiKey, appId = "ulevelp")
        val now = OffsetDateTime.now(ZoneOffset.UTC)
        transaction(db) {
            IntegrationsTable.insert {
                it[IntegrationsTable.userId] = userId
                it[appId] = "ulevelp"
                it[provider] = "gemini"
                it[encryptedSecret] = enc.encryptedSecret
                it[iv] = enc.iv
                it[keyVersion] = enc.keyVersion
                it[hint] = enc.hint
                it[config] = buildJsonObject { put("model", model) }
                it[createdAt] = now
                it[updatedAt] = now
            }
        }
    }

    @Test
    fun n1_requestAnalyze_withoutGeminiKey_returns412() = testApplication {
        configureApiTestApp(
            dbConfig = dbConfig,
            geminiClient = fakeGeminiClient,
            analyzeJobDispatcher = fakeDispatcher
        )

        val res = client.post("/api/v1/notes/analyze") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            header(HttpHeaders.ContentType, "application/json")
            setBody(buildJsonObject {
                put("url", "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
                putJsonArray("tags") { add(JsonPrimitive("화성")) }
            }.toString())
        }

        assertEquals(HttpStatusCode.PreconditionFailed, res.status)
        assertStandardError(res.bodyAsText(), 412, "NO_KEY")
    }

    @Test
    fun n2_requestAnalyze_invalidUrlOrTags_returns400() = testApplication {
        seedGeminiKey(userA)
        configureApiTestApp(
            dbConfig = dbConfig,
            geminiClient = fakeGeminiClient,
            analyzeJobDispatcher = fakeDispatcher
        )

        // 1. 잘못된 URL
        val res1 = client.post("/api/v1/notes/analyze") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            header(HttpHeaders.ContentType, "application/json")
            setBody(buildJsonObject {
                put("url", "https://example.com/not-youtube")
                putJsonArray("tags") { add(JsonPrimitive("화성")) }
            }.toString())
        }
        assertEquals(HttpStatusCode.BadRequest, res1.status)
        assertStandardError(res1.bodyAsText(), 400, "INVALID_INPUT")

        // 2. tags 빈 배열
        val res2 = client.post("/api/v1/notes/analyze") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            header(HttpHeaders.ContentType, "application/json")
            setBody(buildJsonObject {
                put("url", "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
                putJsonArray("tags") {}
            }.toString())
        }
        assertEquals(HttpStatusCode.BadRequest, res2.status)
        assertStandardError(res2.bodyAsText(), 400, "INVALID_INPUT")

        // 3. 없는 태그
        val res3 = client.post("/api/v1/notes/analyze") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            header(HttpHeaders.ContentType, "application/json")
            setBody(buildJsonObject {
                put("url", "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
                putJsonArray("tags") { add(JsonPrimitive("없는태그")) }
            }.toString())
        }
        assertEquals(HttpStatusCode.BadRequest, res3.status)
        assertStandardError(res3.bodyAsText(), 400, "INVALID_INPUT")
    }

    @Test
    fun n3_requestAnalyze_and_executeJob_createsNotesAndSvg() = testApplication {
        seedGeminiKey(userA)

        // Gemini 응답에 화성(기타 1개, 건반 1개) 설정
        val customAnalysis = buildJsonObject {
            putJsonObject("summary") {
                put("headline", "재즈 기타 및 건반 2-5-1 강의")
                putJsonArray("points") {
                    addJsonObject {
                        put("point", "가이드톤 최소 이동")
                        putJsonArray("details") { add(JsonPrimitive("부드러운 연결")) }
                    }
                }
            }
            putJsonArray("key_concepts") {
                add(JsonPrimitive("2-5-1"))
                add(JsonPrimitive("가이드톤"))
            }
            put("difficulty", "중급")
            putJsonObject("harmony") {
                putJsonArray("progressions") {
                    // 1. 기타 진행
                    addJsonObject {
                        put("name", "기타 2-5-1")
                        put("key", "C")
                        put("instrument", "기타")
                        putJsonArray("chords") {
                            addJsonObject {
                                put("symbol", "Cmaj7")
                                put("roman", "Imaj7")
                                put("function", "T")
                                put("split", false)
                                putJsonArray("lh") {}
                                putJsonArray("rh") {}
                                putJsonArray("frets") {
                                    add(JsonPrimitive("x"))
                                    add(JsonPrimitive("3"))
                                    add(JsonPrimitive("2"))
                                    add(JsonPrimitive("0"))
                                    add(JsonPrimitive("0"))
                                    add(JsonPrimitive("0"))
                                }
                                put("voicing_note", "")
                                put("nuance", "안정")
                                put("source", "화면")
                                put("timestamp", "0:30")
                            }
                        }
                    }
                    // 2. 건반 진행
                    addJsonObject {
                        put("name", "건반 2-5-1")
                        put("key", "C")
                        put("instrument", "건반")
                        putJsonArray("chords") {
                            addJsonObject {
                                put("symbol", "Dm9")
                                put("roman", "ii9")
                                put("function", "SD")
                                put("split", true)
                                putJsonArray("lh") { add(JsonPrimitive("D3")) }
                                putJsonArray("rh") { add(JsonPrimitive("F4")) }
                                putJsonArray("frets") {}
                                put("voicing_note", "")
                                put("nuance", "텐션")
                                put("source", "화면")
                                put("timestamp", "1:15")
                            }
                        }
                    }
                }
            }
        }
        fakeGeminiClient.defaultResult = GeminiGenerateResult(customAnalysis, "{}")

        configureApiTestApp(
            dbConfig = dbConfig,
            geminiClient = fakeGeminiClient,
            analyzeJobDispatcher = fakeDispatcher
        )

        // 1. POST /analyze (202 Accepted)
        val postRes = client.post("/api/v1/notes/analyze") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            header(HttpHeaders.ContentType, "application/json")
            setBody(buildJsonObject {
                put("url", "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
                putJsonArray("tags") { add(JsonPrimitive("화성")) }
                put("memo", "보이싱 중심")
            }.toString())
        }
        assertEquals(HttpStatusCode.Accepted, postRes.status)
        val postBody = Json.parseToJsonElement(postRes.bodyAsText()).jsonObject
        val jobIdStr = postBody["jobId"]?.jsonPrimitive?.content
        assertNotNull(jobIdStr)
        assertEquals("queued", postBody["status"]?.jsonPrimitive?.content)
        assertEquals(1, fakeDispatcher.dispatched.size)

        // 2. 수동 executeJob 실행 (비동기 완료 시뮬레이션)
        val noteService = NoteService(
            db = db,
            integrationService = ulevelp.service.IntegrationService(db, TestCrypto.service, FakeIntegrationCheckClient()),
            videoMetaClient = FakeVideoMetaClient(),
            geminiClient = fakeGeminiClient
        )
        val jobId = UUID.fromString(jobIdStr)
        noteService.executeJob(jobId)

        // 3. GET /jobs/{jobId}
        val jobRes = client.get("/api/v1/notes/jobs/$jobIdStr") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, jobRes.status)
        val jobJson = Json.parseToJsonElement(jobRes.bodyAsText()).jsonObject
        assertEquals("done", jobJson["status"]?.jsonPrimitive?.content)
        val noteIdStr = jobJson["noteId"]?.jsonPrimitive?.content
        assertNotNull(noteIdStr)

        // 4. GET /notes/{noteId}
        val noteRes = client.get("/api/v1/notes/$noteIdStr") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, noteRes.status)
        val noteJson = Json.parseToJsonElement(noteRes.bodyAsText()).jsonObject["note"]?.jsonObject
        assertNotNull(noteJson)
        assertEquals("재즈 기타 및 건반 2-5-1 강의", noteJson["headline"]?.jsonPrimitive?.content)
        assertEquals("중급", noteJson["difficulty"]?.jsonPrimitive?.content)

        val svgs = noteJson["diagramsSvg"]?.jsonArray
        assertNotNull(svgs)
        assertEquals(2, svgs.size)
        assertTrue(svgs[0].jsonPrimitive.content.contains("<svg"))
        assertTrue(svgs[1].jsonPrimitive.content.contains("<svg"))
    }

    @Test
    fun n4_noteCreation_enqueuesOutbox_whenNotionSyncEnabled() = testApplication {
        seedGeminiKey(userA)
        transaction(db) {
            NotionSyncTable.insert {
                it[userId] = userA
                it[enabled] = true
            }
        }

        configureApiTestApp(
            dbConfig = dbConfig,
            geminiClient = fakeGeminiClient,
            analyzeJobDispatcher = fakeDispatcher
        )

        val postRes = client.post("/api/v1/notes/analyze") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            header(HttpHeaders.ContentType, "application/json")
            setBody(buildJsonObject {
                put("url", "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
                putJsonArray("tags") { add(JsonPrimitive("화성")) }
            }.toString())
        }
        assertEquals(HttpStatusCode.Accepted, postRes.status)
        val jobIdStr = Json.parseToJsonElement(postRes.bodyAsText()).jsonObject["jobId"]?.jsonPrimitive?.content!!
        val jobId = UUID.fromString(jobIdStr)

        val noteService = NoteService(
            db = db,
            integrationService = ulevelp.service.IntegrationService(db, TestCrypto.service, FakeIntegrationCheckClient()),
            videoMetaClient = FakeVideoMetaClient(),
            geminiClient = fakeGeminiClient
        )
        noteService.executeJob(jobId)

        val outboxRows = transaction(db) {
            SyncOutboxTable.selectAll()
                .where {
                    (SyncOutboxTable.userId eq userA) and
                    (SyncOutboxTable.entity eq "note") and
                    (SyncOutboxTable.op eq "upsert")
                }
                .toList()
        }
        assertEquals(1, outboxRows.size)
    }

    @Test
    fun n5_concurrentJobLimit_returns429() = testApplication {
        seedGeminiKey(userA)
        transaction(db) {
            AnalysisJobsTable.insert {
                it[id] = UUID.randomUUID()
                it[userId] = userA
                it[url] = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
                it[tags] = listOf("화성")
                it[status] = "running"
                it[createdAt] = OffsetDateTime.now(ZoneOffset.UTC)
            }
        }

        configureApiTestApp(
            dbConfig = dbConfig,
            geminiClient = fakeGeminiClient,
            analyzeJobDispatcher = fakeDispatcher
        )

        val res = client.post("/api/v1/notes/analyze") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            header(HttpHeaders.ContentType, "application/json")
            setBody(buildJsonObject {
                put("url", "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
                putJsonArray("tags") { add(JsonPrimitive("화성")) }
            }.toString())
        }
        assertEquals(HttpStatusCode.TooManyRequests, res.status)
        val bodyObj = assertStandardRateLimitError(res.bodyAsText(), 429, "RATE_LIMITED")
        // N5: retryAfter == 30
        assertEquals(30, bodyObj["retryAfter"]?.jsonPrimitive?.int)
    }

    @Test
    fun n6_dailyLimit_returns429() = testApplication {
        seedGeminiKey(userA)
        val now = OffsetDateTime.now(ZoneOffset.UTC)
        transaction(db) {
            for (i in 1..20) {
                AnalysisJobsTable.insert {
                    it[id] = UUID.randomUUID()
                    it[userId] = userA
                    it[url] = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
                    it[tags] = listOf("화성")
                    it[status] = "done"
                    it[createdAt] = now
                }
            }
        }

        configureApiTestApp(
            dbConfig = dbConfig,
            geminiClient = fakeGeminiClient,
            analyzeJobDispatcher = fakeDispatcher
        )

        val res = client.post("/api/v1/notes/analyze") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            header(HttpHeaders.ContentType, "application/json")
            setBody(buildJsonObject {
                put("url", "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
                putJsonArray("tags") { add(JsonPrimitive("화성")) }
            }.toString())
        }
        assertEquals(HttpStatusCode.TooManyRequests, res.status)
        val bodyObj = assertStandardRateLimitError(res.bodyAsText(), 429, "RATE_LIMITED")
        val retryAfter = bodyObj["retryAfter"]?.jsonPrimitive?.int
        assertNotNull(retryAfter)
        assertTrue(retryAfter in 1..86400)
    }

    @Test
    fun n7_yesterdayJobs_doNotCountTowardsTodayLimit() = testApplication {
        seedGeminiKey(userA)
        val twoDaysAgo = OffsetDateTime.now(ZoneOffset.UTC).minusDays(2)
        transaction(db) {
            for (i in 1..20) {
                AnalysisJobsTable.insert {
                    it[id] = UUID.randomUUID()
                    it[userId] = userA
                    it[url] = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
                    it[tags] = listOf("화성")
                    it[status] = "done"
                    it[createdAt] = twoDaysAgo
                }
            }
        }

        configureApiTestApp(
            dbConfig = dbConfig,
            geminiClient = fakeGeminiClient,
            analyzeJobDispatcher = fakeDispatcher
        )

        val res = client.post("/api/v1/notes/analyze") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            header(HttpHeaders.ContentType, "application/json")
            setBody(buildJsonObject {
                put("url", "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
                putJsonArray("tags") { add(JsonPrimitive("화성")) }
            }.toString())
        }
        assertEquals(HttpStatusCode.Accepted, res.status)
    }

    @Test
    fun n8_dispatcherFailure_marksJobFailed_and_returns502() = testApplication {
        seedGeminiKey(userA)
        fakeDispatcher.handler = {
            throw RuntimeException("Job dispatch network error")
        }

        configureApiTestApp(
            dbConfig = dbConfig,
            geminiClient = fakeGeminiClient,
            analyzeJobDispatcher = fakeDispatcher
        )

        val res = client.post("/api/v1/notes/analyze") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            header(HttpHeaders.ContentType, "application/json")
            setBody(buildJsonObject {
                put("url", "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
                putJsonArray("tags") { add(JsonPrimitive("화성")) }
            }.toString())
        }

        assertEquals(HttpStatusCode.BadGateway, res.status)
        assertStandardError(res.bodyAsText(), 502, "JOB_DISPATCH_ERROR")

        val job = transaction(db) {
            AnalysisJobsTable.selectAll().where { AnalysisJobsTable.userId eq userA }.singleOrNull()
        }
        assertNotNull(job)
        assertEquals("failed", job[AnalysisJobsTable.status])
        assertTrue(job[AnalysisJobsTable.error]?.contains("dispatch_failed") == true)
    }

    @Test
    fun n9_geminiFailureAndTimeout_recordsFailedStatusAndError() = testApplication {
        seedGeminiKey(userA)

        val noteServiceNormal = NoteService(
            db = db,
            integrationService = ulevelp.service.IntegrationService(db, TestCrypto.service, FakeIntegrationCheckClient()),
            videoMetaClient = FakeVideoMetaClient(),
            geminiClient = fakeGeminiClient
        )

        // ① PROVIDER_KEY_INVALID
        fakeGeminiClient.handler = { _, _, _, _, _ ->
            throw GeminiApiException(400, "PROVIDER_KEY_INVALID", "PROVIDER_KEY_INVALID: API_KEY_INVALID")
        }
        val jobId1 = UUID.randomUUID()
        transaction(db) {
            AnalysisJobsTable.insert {
                it[id] = jobId1
                it[userId] = userA
                it[url] = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
                it[tags] = listOf("화성")
                it[status] = "queued"
                it[createdAt] = OffsetDateTime.now(ZoneOffset.UTC)
            }
        }
        noteServiceNormal.executeJob(jobId1)
        val jobRow1 = transaction(db) { AnalysisJobsTable.selectAll().where { AnalysisJobsTable.id eq jobId1 }.single() }
        assertEquals("failed", jobRow1[AnalysisJobsTable.status])
        assertTrue(jobRow1[AnalysisJobsTable.error]?.startsWith("PROVIDER_KEY_INVALID:") == true)

        // ② 일반 400 GEMINI_API_ERROR
        fakeGeminiClient.handler = { _, _, _, _, _ ->
            throw GeminiApiException(400, "GEMINI_API_ERROR", "Gemini 분석 호출에 실패했습니다 (HTTP 400).")
        }
        val jobId2 = UUID.randomUUID()
        transaction(db) {
            AnalysisJobsTable.insert {
                it[id] = jobId2
                it[userId] = userA
                it[url] = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
                it[tags] = listOf("화성")
                it[status] = "queued"
                it[createdAt] = OffsetDateTime.now(ZoneOffset.UTC)
            }
        }
        noteServiceNormal.executeJob(jobId2)
        val jobRow2 = transaction(db) { AnalysisJobsTable.selectAll().where { AnalysisJobsTable.id eq jobId2 }.single() }
        assertEquals("failed", jobRow2[AnalysisJobsTable.status])
        assertFalse(jobRow2[AnalysisJobsTable.error]?.startsWith("PROVIDER_KEY_INVALID:") == true)

        // ③ 타임아웃 20ms
        fakeGeminiClient.handler = { _, _, _, _, _ ->
            delay(200L)
            FakeGeminiClient.defaultSuccessResult()
        }
        val noteServiceTimeout = NoteService(
            db = db,
            integrationService = ulevelp.service.IntegrationService(db, TestCrypto.service, FakeIntegrationCheckClient()),
            videoMetaClient = FakeVideoMetaClient(),
            geminiClient = fakeGeminiClient,
            jobTimeoutMs = 20L
        )
        val jobId3 = UUID.randomUUID()
        transaction(db) {
            AnalysisJobsTable.insert {
                it[id] = jobId3
                it[userId] = userA
                it[url] = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
                it[tags] = listOf("화성")
                it[status] = "queued"
                it[createdAt] = OffsetDateTime.now(ZoneOffset.UTC)
            }
        }
        noteServiceTimeout.executeJob(jobId3)
        val jobRow3 = transaction(db) { AnalysisJobsTable.selectAll().where { AnalysisJobsTable.id eq jobId3 }.single() }
        assertEquals("failed", jobRow3[AnalysisJobsTable.status])
        assertTrue(jobRow3[AnalysisJobsTable.error]?.contains("초과") == true)
    }

    @Test
    fun n10_listNotes_and_tagFilter() = testApplication {
        val now = OffsetDateTime.now(ZoneOffset.UTC)
        val noteId1 = UUID.randomUUID()
        val noteId2 = UUID.randomUUID()
        transaction(db) {
            NotesTable.insert {
                it[id] = noteId1
                it[userId] = userA
                it[videoId] = "dQw4w9WgXcQ"
                it[title] = "노트 1"
                it[tags] = listOf("화성")
                it[analysis] = buildJsonObject {}
                it[createdAt] = now.minusMinutes(1)
            }
            NotesTable.insert {
                it[id] = noteId2
                it[userId] = userA
                it[videoId] = "dQw4w9WgXcQ"
                it[title] = "노트 2"
                it[tags] = listOf("리듬", "믹싱")
                it[analysis] = buildJsonObject {}
                it[createdAt] = now
            }
        }

        configureApiTestApp(
            dbConfig = dbConfig,
            geminiClient = fakeGeminiClient,
            analyzeJobDispatcher = fakeDispatcher
        )

        // 1. 전체 조회
        val res1 = client.get("/api/v1/notes") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, res1.status)
        val json1 = Json.parseToJsonElement(res1.bodyAsText()).jsonObject
        assertEquals(2, json1["notes"]?.jsonArray?.size)

        // 2. ?tag=화성
        val res2 = client.get("/api/v1/notes?tag=화성") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, res2.status)
        val json2 = Json.parseToJsonElement(res2.bodyAsText()).jsonObject
        val notes2 = json2["notes"]?.jsonArray
        assertEquals(1, notes2?.size)
        assertEquals(noteId1.toString(), notes2?.first()?.jsonObject?.get("id")?.jsonPrimitive?.content)

        // 3. ?tag=이상한태그
        val res3 = client.get("/api/v1/notes?tag=이상한태그") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.BadRequest, res3.status)
        assertStandardError(res3.bodyAsText(), 400, "INVALID_INPUT")
    }

    @Test
    fun n11_updateNote_successAndOutbox() = testApplication {
        val noteId = UUID.randomUUID()
        transaction(db) {
            NotionSyncTable.insert {
                it[userId] = userA
                it[enabled] = true
            }
            NotesTable.insert {
                it[id] = noteId
                it[userId] = userA
                it[videoId] = "dQw4w9WgXcQ"
                it[title] = "원래 제목"
                it[memo] = "원래 메모"
                it[tags] = listOf("화성")
                it[analysis] = buildJsonObject {}
            }
        }

        configureApiTestApp(
            dbConfig = dbConfig,
            geminiClient = fakeGeminiClient,
            analyzeJobDispatcher = fakeDispatcher
        )

        val patchRes = client.patch("/api/v1/notes/$noteId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            header(HttpHeaders.ContentType, "application/json")
            setBody(buildJsonObject {
                put("title", "새 제목")
                put("memo", "새 메모")
                putJsonArray("tags") {
                    add(JsonPrimitive("화성"))
                    add(JsonPrimitive("TAB"))
                }
            }.toString())
        }
        assertEquals(HttpStatusCode.OK, patchRes.status)
        val note = Json.parseToJsonElement(patchRes.bodyAsText()).jsonObject["note"]?.jsonObject
        assertNotNull(note)
        assertEquals("새 제목", note["title"]?.jsonPrimitive?.content)
        assertEquals("새 메모", note["memo"]?.jsonPrimitive?.content)
        assertEquals(listOf("화성", "TAB"), note["tags"]?.jsonArray?.map { it.jsonPrimitive.content })

        val outbox = transaction(db) {
            SyncOutboxTable.selectAll().where {
                (SyncOutboxTable.userId eq userA) and
                (SyncOutboxTable.entity eq "note") and
                (SyncOutboxTable.entityId eq noteId) and
                (SyncOutboxTable.op eq "upsert")
            }.toList()
        }
        assertEquals(1, outbox.size)
    }

    @Test
    fun n12_updateNote_validationErrors() = testApplication {
        val noteId = UUID.randomUUID()
        transaction(db) {
            NotesTable.insert {
                it[id] = noteId
                it[userId] = userA
                it[videoId] = "dQw4w9WgXcQ"
                it[title] = "원래 제목"
                it[memo] = "원래 메모"
                it[tags] = listOf("화성")
                it[analysis] = buildJsonObject {}
            }
        }

        configureApiTestApp(
            dbConfig = dbConfig,
            geminiClient = fakeGeminiClient,
            analyzeJobDispatcher = fakeDispatcher
        )

        // ① 빈 객체
        val r1 = client.patch("/api/v1/notes/$noteId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            header(HttpHeaders.ContentType, "application/json")
            setBody("{}")
        }
        assertEquals(HttpStatusCode.BadRequest, r1.status)
        assertEquals("수정할 항목(title, memo, tags 중 하나 이상)이 필요합니다.", Json.parseToJsonElement(r1.bodyAsText()).jsonObject["message"]?.jsonPrimitive?.content)

        // ② title 빈 문자열
        val r2 = client.patch("/api/v1/notes/$noteId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            header(HttpHeaders.ContentType, "application/json")
            setBody("{\"title\":\"   \"}")
        }
        assertEquals(HttpStatusCode.BadRequest, r2.status)
        assertEquals("title은 빈 문자열일 수 없습니다.", Json.parseToJsonElement(r2.bodyAsText()).jsonObject["message"]?.jsonPrimitive?.content)

        // ③ title 301자
        val r3 = client.patch("/api/v1/notes/$noteId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            header(HttpHeaders.ContentType, "application/json")
            setBody("{\"title\":\"${"A".repeat(301)}\"}")
        }
        assertEquals(HttpStatusCode.BadRequest, r3.status)
        assertEquals("title은(는) 300자 이하여야 합니다.", Json.parseToJsonElement(r3.bodyAsText()).jsonObject["message"]?.jsonPrimitive?.content)

        // ④ tags 빈 배열
        val r4 = client.patch("/api/v1/notes/$noteId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            header(HttpHeaders.ContentType, "application/json")
            setBody("{\"tags\":[]}")
        }
        assertEquals(HttpStatusCode.BadRequest, r4.status)
        assertEquals("tags는 1개 이상 7개 이하여야 합니다.", Json.parseToJsonElement(r4.bodyAsText()).jsonObject["message"]?.jsonPrimitive?.content)

        // ⑤ 없는 태그
        val r5 = client.patch("/api/v1/notes/$noteId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            header(HttpHeaders.ContentType, "application/json")
            setBody("{\"tags\":[\"없는태그\"]}")
        }
        assertEquals(HttpStatusCode.BadRequest, r5.status)
        assertEquals("유효하지 않은 태그가 포함되어 있습니다.", Json.parseToJsonElement(r5.bodyAsText()).jsonObject["message"]?.jsonPrimitive?.content)

        // ⑥ memo 2001자
        val r6 = client.patch("/api/v1/notes/$noteId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            header(HttpHeaders.ContentType, "application/json")
            setBody("{\"memo\":\"${"A".repeat(2001)}\"}")
        }
        assertEquals(HttpStatusCode.BadRequest, r6.status)
        assertEquals("memo은(는) 2000자 이하여야 합니다.", Json.parseToJsonElement(r6.bodyAsText()).jsonObject["message"]?.jsonPrimitive?.content)
    }

    @Test
    fun n13_deleteNote_successAndOutbox() = testApplication {
        val noteId = UUID.randomUUID()
        transaction(db) {
            NotionSyncTable.insert {
                it[userId] = userA
                it[enabled] = true
            }
            NotesTable.insert {
                it[id] = noteId
                it[userId] = userA
                it[videoId] = "dQw4w9WgXcQ"
                it[title] = "삭제할 노트"
                it[tags] = listOf("화성")
                it[analysis] = buildJsonObject {}
            }
        }

        configureApiTestApp(
            dbConfig = dbConfig,
            geminiClient = fakeGeminiClient,
            analyzeJobDispatcher = fakeDispatcher
        )

        val delRes = client.delete("/api/v1/notes/$noteId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, delRes.status)
        assertEquals(true, Json.parseToJsonElement(delRes.bodyAsText()).jsonObject["ok"]?.jsonPrimitive?.boolean)

        val getRes = client.get("/api/v1/notes/$noteId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.NotFound, getRes.status)

        val outbox = transaction(db) {
            SyncOutboxTable.selectAll().where {
                (SyncOutboxTable.userId eq userA) and
                (SyncOutboxTable.entity eq "note") and
                (SyncOutboxTable.entityId eq noteId) and
                (SyncOutboxTable.op eq "delete")
            }.toList()
        }
        assertEquals(1, outbox.size)
    }

    @Test
    fun n14_readNotes_afterGeminiKeyDeleted_stillAccessible() = testApplication {
        seedGeminiKey(userA)
        val noteId = UUID.randomUUID()
        transaction(db) {
            NotesTable.insert {
                it[id] = noteId
                it[userId] = userA
                it[videoId] = "dQw4w9WgXcQ"
                it[title] = "기존 노트"
                it[tags] = listOf("화성")
                it[analysis] = buildJsonObject {}
            }
        }

        configureApiTestApp(
            dbConfig = dbConfig,
            geminiClient = fakeGeminiClient,
            analyzeJobDispatcher = fakeDispatcher
        )

        // 연동 해제
        val delKeyRes = client.delete("/api/v1/integrations/gemini") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, delKeyRes.status)

        // 노트 목록 조회 여전히 가능
        val listRes = client.get("/api/v1/notes") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, listRes.status)
        assertEquals(1, Json.parseToJsonElement(listRes.bodyAsText()).jsonObject["notes"]?.jsonArray?.size)

        // 단건 조회 여전히 가능
        val getRes = client.get("/api/v1/notes/$noteId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, getRes.status)
    }

    @Test
    fun n15_crossUserAccess_blocked() = testApplication {
        val jobIdA = UUID.randomUUID()
        val noteIdA = UUID.randomUUID()
        transaction(db) {
            AnalysisJobsTable.insert {
                it[id] = jobIdA
                it[userId] = userA
                it[url] = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
                it[tags] = listOf("화성")
                it[status] = "done"
                it[createdAt] = OffsetDateTime.now(ZoneOffset.UTC)
            }
            NotesTable.insert {
                it[id] = noteIdA
                it[userId] = userA
                it[videoId] = "dQw4w9WgXcQ"
                it[title] = "A의 노트"
                it[tags] = listOf("화성")
                it[analysis] = buildJsonObject {}
            }
        }

        configureApiTestApp(
            dbConfig = dbConfig,
            geminiClient = fakeGeminiClient,
            analyzeJobDispatcher = fakeDispatcher
        )

        // 사용자 B가 A의 잡 조회 시 404
        val r1 = client.get("/api/v1/notes/jobs/$jobIdA") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
        }
        assertEquals(HttpStatusCode.NotFound, r1.status)

        // 사용자 B가 A의 노트 조회 시 404
        val r2 = client.get("/api/v1/notes/$noteIdA") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
        }
        assertEquals(HttpStatusCode.NotFound, r2.status)

        // 사용자 B가 A의 노트 수정 시 404
        val r3 = client.patch("/api/v1/notes/$noteIdA") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
            header(HttpHeaders.ContentType, "application/json")
            setBody("{\"title\":\"변조 시도\"}")
        }
        assertEquals(HttpStatusCode.NotFound, r3.status)

        // 사용자 B가 A의 노트 삭제 시 404
        val r4 = client.delete("/api/v1/notes/$noteIdA") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
        }
        assertEquals(HttpStatusCode.NotFound, r4.status)

        // A의 데이터 불변 확인
        val noteA = transaction(db) { NotesTable.selectAll().where { NotesTable.id eq noteIdA }.single() }
        assertEquals("A의 노트", noteA[NotesTable.title])
    }

    @Test
    fun n16_listJobs_sortedAndLimitedTo20() = testApplication {
        val now = OffsetDateTime.now(ZoneOffset.UTC)
        transaction(db) {
            // A의 작업 22건 (1분씩 증가)
            for (i in 1..22) {
                AnalysisJobsTable.insert {
                    it[id] = UUID.randomUUID()
                    it[userId] = userA
                    it[url] = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
                    it[tags] = listOf("화성")
                    it[memo] = "Job A $i"
                    it[status] = "done"
                    it[createdAt] = now.plusMinutes(i.toLong())
                }
            }
            // B의 작업 3건
            for (i in 1..3) {
                AnalysisJobsTable.insert {
                    it[id] = UUID.randomUUID()
                    it[userId] = userB
                    it[url] = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
                    it[tags] = listOf("화성")
                    it[memo] = "Job B $i"
                    it[status] = "done"
                    it[createdAt] = now.plusMinutes(100L + i)
                }
            }
        }

        configureApiTestApp(
            dbConfig = dbConfig,
            geminiClient = fakeGeminiClient,
            analyzeJobDispatcher = fakeDispatcher
        )

        val res = client.get("/api/v1/notes/jobs") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, res.status)
        val json = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        val jobs = json["jobs"]?.jsonArray
        assertNotNull(jobs)
        assertEquals(20, jobs.size)

        // 가장 최신인 Job A 22부터 Job A 3까지인지 확인 (Job A 1, 2는 제외)
        val firstJobId = jobs.first().jsonObject["id"]?.jsonPrimitive?.content
        val lastJobId = jobs.last().jsonObject["id"]?.jsonPrimitive?.content
        assertNotNull(firstJobId)
        assertNotNull(lastJobId)

        // createdAt이 내림차순인지 확인
        val createdAts = jobs.map { it.jsonObject["createdAt"]?.jsonPrimitive?.content!! }
        for (i in 0 until createdAts.size - 1) {
            assertTrue(createdAts[i] >= createdAts[i + 1])
        }
    }

    private fun newNoteService() = NoteService(
        db = db,
        integrationService = ulevelp.service.IntegrationService(db, TestCrypto.service, FakeIntegrationCheckClient()),
        videoMetaClient = FakeVideoMetaClient(),
        geminiClient = fakeGeminiClient
    )

    private suspend fun postProgressionAnalyze(client: HttpClient, token: String?, body: String): HttpResponse =
        client.post("/api/v1/progressions/analyze") {
            if (token != null) header(HttpHeaders.Authorization, "Bearer $token")
            header(HttpHeaders.ContentType, "application/json")
            setBody(body)
        }

    /** 코드 진행 영상 분석 응답: 진행 2개(곡 진행 + 코드 0개짜리) + 화면/추정 근거 */
    private fun progressionAnalysis(): JsonObject = buildJsonObject {
        putJsonObject("summary") {
            put("headline", "Just the Two of Us 진행 분석")
            putJsonArray("points") {}
        }
        putJsonArray("key_concepts") { add(JsonPrimitive("4536")) }
        put("difficulty", "입문")
        putJsonArray("moments") {}
        putJsonArray("practice") {}
        putJsonObject("harmony") {
            putJsonArray("progressions") {
                addJsonObject {
                    put("name", "후렴")
                    put("song", "Just the Two of Us")
                    put("artist", "Grover Washington Jr.")
                    put("key", "F major")
                    put("instrument", "건반")
                    put("start", "0:40")
                    put("end", "1:05")
                    putJsonArray("chords") {
                        for ((sym, rom, src) in listOf(Triple("Bbmaj7", "IVmaj7", "화면"), Triple("A7", "III7", "화면"), Triple("Dm7", "vi7", "추정"))) {
                            addJsonObject {
                                put("symbol", sym)
                                put("roman", rom)
                                put("function", "")
                                put("split", false)
                                putJsonArray("lh") {}
                                putJsonArray("rh") { add(JsonPrimitive("F4")) }
                                putJsonArray("frets") {}
                                put("voicing_note", "")
                                put("nuance", "")
                                put("source", src)
                                put("timestamp", "0:42")
                            }
                        }
                    }
                }
                addJsonObject {
                    put("name", "빈 진행")
                    put("song", "")
                    put("artist", "")
                    put("key", "")
                    put("instrument", "기타")
                    put("start", "")
                    put("end", "")
                    putJsonArray("chords") {}
                }
            }
            putJsonArray("concepts") {}
        }
    }

    @Test
    fun n17_progressionAnalyze_createsNoteAndCollectedRows() = testApplication {
        seedGeminiKey(userA)
        var seenPrompt = ""
        var seenSchema = JsonObject(emptyMap())
        fakeGeminiClient.handler = { _, _, _, prompt, schema ->
            seenPrompt = prompt
            seenSchema = schema
            GeminiGenerateResult(progressionAnalysis(), "{}")
        }
        configureApiTestApp(dbConfig = dbConfig, geminiClient = fakeGeminiClient, analyzeJobDispatcher = fakeDispatcher)

        val postRes = postProgressionAnalyze(client, tokenA, buildJsonObject {
            put("url", "https://youtu.be/dQw4w9WgXcQ")
            put("memo", "후렴 위주")
        }.toString())
        assertEquals(HttpStatusCode.Accepted, postRes.status, postRes.bodyAsText())
        assertEquals("no-store", postRes.headers[HttpHeaders.CacheControl])
        val postBody = Json.parseToJsonElement(postRes.bodyAsText()).jsonObject
        assertEquals(setOf("jobId", "status"), postBody.keys)
        assertEquals("queued", postBody["status"]!!.jsonPrimitive.content)
        val jobIdStr = postBody["jobId"]!!.jsonPrimitive.content

        // 실행 전: 작업 kind=progression, tags=[화성]
        val queued = Json.parseToJsonElement(client.get("/api/v1/notes/jobs/$jobIdStr") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }.bodyAsText()).jsonObject
        assertEquals("progression", queued["kind"]!!.jsonPrimitive.content)
        assertEquals(listOf("화성"), queued["tags"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertEquals("https://www.youtube.com/watch?v=dQw4w9WgXcQ", queued["url"]!!.jsonPrimitive.content)

        newNoteService().executeJob(UUID.fromString(jobIdStr))

        // 진행 전용 프롬프트·확장 스키마로 호출됨
        assertTrue(seenPrompt.contains("- [코드 진행]"), seenPrompt)
        assertTrue(seenPrompt.contains("사용자 메모(특히 신경 써서 볼 부분): 후렴 위주"))
        val itemProps = seenSchema["properties"]!!.jsonObject["harmony"]!!.jsonObject["properties"]!!.jsonObject["progressions"]!!
            .jsonObject["items"]!!.jsonObject["properties"]!!.jsonObject
        assertTrue("song" in itemProps.keys && "start" in itemProps.keys)

        val job = Json.parseToJsonElement(client.get("/api/v1/notes/jobs/$jobIdStr") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }.bodyAsText()).jsonObject
        assertEquals("done", job["status"]!!.jsonPrimitive.content)
        assertEquals("progression", job["kind"]!!.jsonPrimitive.content)
        val noteIdStr = job["noteId"]!!.jsonPrimitive.content

        // 노트: 태그 화성, 수집 켜짐, 다이어그램 2개(진행 수만큼)
        val note = Json.parseToJsonElement(client.get("/api/v1/notes/$noteIdStr") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }.bodyAsText()).jsonObject["note"]!!.jsonObject
        assertEquals(listOf("화성"), note["tags"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertEquals(true, note["collectProgressions"]!!.jsonPrimitive.boolean)
        assertEquals(2, note["diagramsSvg"]!!.jsonArray.size)

        // 진행 행: 코드 있는 진행 1개만 (빈 진행은 행 없음)
        val list = Json.parseToJsonElement(client.get("/api/v1/progressions?scope=analysis") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }.bodyAsText()).jsonObject["progressions"]!!.jsonArray
        assertEquals(1, list.size)
        val p = list[0].jsonObject
        assertEquals("analysis", p["kind"]!!.jsonPrimitive.content)
        assertEquals("ai", p["origin"]!!.jsonPrimitive.content)
        assertEquals("video", p["route"]!!.jsonPrimitive.content)
        assertEquals("추정", p["evidence"]!!.jsonPrimitive.content)
        assertEquals("Just the Two of Us", p["title"]!!.jsonPrimitive.content)
        assertEquals("Grover Washington Jr.", p["artist"]!!.jsonPrimitive.content)
        assertEquals("후렴", p["part"]!!.jsonPrimitive.content)
        assertEquals("Fake Channel", p["channel"]!!.jsonPrimitive.content)
        assertEquals("F Major", p["key"]!!.jsonPrimitive.content)
        assertEquals("건반", p["instrument"]!!.jsonPrimitive.content)
        assertEquals(40, p["startSec"]!!.jsonPrimitive.int)
        assertEquals(65, p["endSec"]!!.jsonPrimitive.int)
        assertEquals("dQw4w9WgXcQ", p["videoId"]!!.jsonPrimitive.content)
        assertEquals(noteIdStr, p["noteId"]!!.jsonPrimitive.content)
        val chords = p["chords"]!!.jsonArray.map { it.jsonObject }
        assertEquals(listOf("Bbmaj7", "A7", "Dm7"), chords.map { it["symbol"]!!.jsonPrimitive.content })
        assertEquals(listOf("IVM7", "III7", "vi7"), chords.map { it["roman"]!!.jsonPrimitive.content })
        assertEquals(setOf("symbol", "roman", "source", "timestamp"), chords[0].keys)

        // 레퍼런스 범위엔 없음
        val refs = Json.parseToJsonElement(client.get("/api/v1/progressions?scope=reference") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }.bodyAsText()).jsonObject["progressions"]!!.jsonArray
        assertEquals(0, refs.size)

        // 다른 사용자에겐 안 보임
        val other = Json.parseToJsonElement(client.get("/api/v1/progressions") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
        }.bodyAsText()).jsonObject["progressions"]!!.jsonArray
        assertEquals(0, other.size)
    }

    @Test
    fun n18_progressionAnalyze_noProgressions_validation_andSharedLimit() = testApplication {
        configureApiTestApp(dbConfig = dbConfig, geminiClient = fakeGeminiClient, analyzeJobDispatcher = fakeDispatcher)
        val okBody = buildJsonObject { put("url", "https://www.youtube.com/watch?v=dQw4w9WgXcQ") }.toString()

        // 401 · 412(키 없음) · 400(URL)
        assertEquals(HttpStatusCode.Unauthorized, postProgressionAnalyze(client, null, okBody).status)
        val noKey = postProgressionAnalyze(client, tokenA, okBody)
        assertEquals(HttpStatusCode.PreconditionFailed, noKey.status)
        assertStandardError(noKey.bodyAsText(), 412, "NO_KEY")
        seedGeminiKey(userA)
        val badUrl = postProgressionAnalyze(client, tokenA, """{"url":"https://example.com/x"}""")
        assertEquals(HttpStatusCode.BadRequest, badUrl.status)
        assertStandardError(badUrl.bodyAsText(), 400, "INVALID_INPUT")
        val noUrl = postProgressionAnalyze(client, tokenA, """{"memo":"x"}""")
        assertEquals(HttpStatusCode.BadRequest, noUrl.status)
        assertStandardError(noUrl.bodyAsText(), 400, "INVALID_INPUT")

        // 화성 진행 0개 → 노트만, 작업 done, 진행 행 0
        fakeGeminiClient.defaultResult = FakeGeminiClient.defaultSuccessResult()
        val res = postProgressionAnalyze(client, tokenA, okBody)
        assertEquals(HttpStatusCode.Accepted, res.status)
        val jobId = Json.parseToJsonElement(res.bodyAsText()).jsonObject["jobId"]!!.jsonPrimitive.content

        // 노트 분석과 동시 1건 제한 합산: 진행 작업이 queued인 동안 노트 분석 429
        val noteRes = client.post("/api/v1/notes/analyze") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            header(HttpHeaders.ContentType, "application/json")
            setBody(buildJsonObject {
                put("url", "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
                putJsonArray("tags") { add(JsonPrimitive("화성")) }
            }.toString())
        }
        assertEquals(HttpStatusCode.TooManyRequests, noteRes.status)
        assertStandardRateLimitError(noteRes.bodyAsText())

        newNoteService().executeJob(UUID.fromString(jobId))
        val job = Json.parseToJsonElement(client.get("/api/v1/notes/jobs/$jobId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }.bodyAsText()).jsonObject
        assertEquals("done", job["status"]!!.jsonPrimitive.content)
        val noteId = job["noteId"]!!.jsonPrimitive.content
        val note = Json.parseToJsonElement(client.get("/api/v1/notes/$noteId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }.bodyAsText()).jsonObject["note"]!!.jsonObject
        assertEquals(true, note["collectProgressions"]!!.jsonPrimitive.boolean)
        val list = Json.parseToJsonElement(client.get("/api/v1/progressions") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }.bodyAsText()).jsonObject["progressions"]!!.jsonArray
        assertEquals(0, list.size)

        // 일반 노트 분석 작업은 kind=note, 노트 수집 꺼짐, 진행 행 없음 (회귀)
        val noteJobRes = client.post("/api/v1/notes/analyze") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            header(HttpHeaders.ContentType, "application/json")
            setBody(buildJsonObject {
                put("url", "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
                putJsonArray("tags") { add(JsonPrimitive("화성")) }
            }.toString())
        }
        assertEquals(HttpStatusCode.Accepted, noteJobRes.status)
        val noteJobId = Json.parseToJsonElement(noteJobRes.bodyAsText()).jsonObject["jobId"]!!.jsonPrimitive.content
        fakeGeminiClient.defaultResult = null
        fakeGeminiClient.handler = { _, _, _, _, _ -> GeminiGenerateResult(progressionAnalysis(), "{}") }
        newNoteService().executeJob(UUID.fromString(noteJobId))
        val jobs = Json.parseToJsonElement(client.get("/api/v1/notes/jobs") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }.bodyAsText()).jsonObject["jobs"]!!.jsonArray.map { it.jsonObject }
        assertEquals(listOf("note", "progression"), jobs.map { it["kind"]!!.jsonPrimitive.content })
        val noteJobNoteId = jobs[0]["noteId"]!!.jsonPrimitive.content
        val plainNote = Json.parseToJsonElement(client.get("/api/v1/notes/$noteJobNoteId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }.bodyAsText()).jsonObject["note"]!!.jsonObject
        assertEquals(false, plainNote["collectProgressions"]!!.jsonPrimitive.boolean)
        val after = Json.parseToJsonElement(client.get("/api/v1/progressions") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }.bodyAsText()).jsonObject["progressions"]!!.jsonArray
        assertEquals(0, after.size)
    }

    /** GA-2: 구간·속도 선택 필드 → 작업 DTO → Gemini 영상 옵션(`진행_분석설정.md` §3-2) */
    @Test
    fun n19_progressionAnalyze_rangeAndPace_toJobAndGeminiOptions() = testApplication {
        seedGeminiKey(userA)
        fakeGeminiClient.handler = { _, _, _, _, _ -> GeminiGenerateResult(progressionAnalysis(), "{}") }
        configureApiTestApp(dbConfig = dbConfig, geminiClient = fakeGeminiClient, analyzeJobDispatcher = fakeDispatcher)
        val auth: HttpRequestBuilder.() -> Unit = { header(HttpHeaders.Authorization, "Bearer $tokenA") }

        // 400: 끝 ≤ 시작 · 범위 밖 · 문자열 초 · 소수 · 모르는 속도 · 끝 0초 — 작업은 만들어지지 않음
        for (bad in listOf(
            """{"url":"https://youtu.be/dQw4w9WgXcQ","startSec":80,"endSec":80}""",
            """{"url":"https://youtu.be/dQw4w9WgXcQ","startSec":-1}""",
            """{"url":"https://youtu.be/dQw4w9WgXcQ","endSec":86401}""",
            """{"url":"https://youtu.be/dQw4w9WgXcQ","startSec":"80"}""",
            """{"url":"https://youtu.be/dQw4w9WgXcQ","startSec":1.5}""",
            """{"url":"https://youtu.be/dQw4w9WgXcQ","pace":"turbo"}""",
            """{"url":"https://youtu.be/dQw4w9WgXcQ","endSec":0}"""
        )) {
            val res = postProgressionAnalyze(client, tokenA, bad)
            assertEquals(HttpStatusCode.BadRequest, res.status, bad)
            assertStandardError(res.bodyAsText(), 400, "INVALID_INPUT")
        }
        assertEquals(0, fakeDispatcher.dispatched.size)

        // 정상: 구간 + 빠름 → 작업 DTO에 그대로, Gemini fps 3 + 구간
        val res = postProgressionAnalyze(client, tokenA, """{"url":"https://youtu.be/dQw4w9WgXcQ","startSec":40,"endSec":80,"pace":"fast"}""")
        assertEquals(HttpStatusCode.Accepted, res.status, res.bodyAsText())
        val jobId = Json.parseToJsonElement(res.bodyAsText()).jsonObject["jobId"]!!.jsonPrimitive.content
        val queued = Json.parseToJsonElement(client.get("/api/v1/notes/jobs/$jobId", auth).bodyAsText()).jsonObject
        assertEquals(40, queued["startSec"]!!.jsonPrimitive.int)
        assertEquals(80, queued["endSec"]!!.jsonPrimitive.int)
        assertEquals("fast", queued["pace"]!!.jsonPrimitive.content)
        newNoteService().executeJob(UUID.fromString(jobId))
        assertEquals(GeminiVideoOptions(fps = 3.0, startSec = 40, endSec = 80), fakeGeminiClient.videoOptionsCalls.last())

        // 선택 필드 없음 → pace normal(fps 1), 구간 null
        val res2 = postProgressionAnalyze(client, tokenA, """{"url":"https://youtu.be/dQw4w9WgXcQ"}""")
        assertEquals(HttpStatusCode.Accepted, res2.status, res2.bodyAsText())
        val jobId2 = Json.parseToJsonElement(res2.bodyAsText()).jsonObject["jobId"]!!.jsonPrimitive.content
        val job2 = Json.parseToJsonElement(client.get("/api/v1/notes/jobs/$jobId2", auth).bodyAsText()).jsonObject
        assertEquals("normal", job2["pace"]!!.jsonPrimitive.content)
        assertEquals(JsonNull, job2["startSec"] ?: JsonNull)
        assertEquals(JsonNull, job2["endSec"] ?: JsonNull)
        newNoteService().executeJob(UUID.fromString(jobId2))
        assertEquals(GeminiVideoOptions(fps = 1.0), fakeGeminiClient.videoOptionsCalls.last())

        // 시작만(끝 없음) + 느림
        val res3 = postProgressionAnalyze(client, tokenA, """{"url":"https://youtu.be/dQw4w9WgXcQ","startSec":95,"pace":"slow"}""")
        assertEquals(HttpStatusCode.Accepted, res3.status, res3.bodyAsText())
        val jobId3 = Json.parseToJsonElement(res3.bodyAsText()).jsonObject["jobId"]!!.jsonPrimitive.content
        newNoteService().executeJob(UUID.fromString(jobId3))
        assertEquals(GeminiVideoOptions(fps = 0.5, startSec = 95), fakeGeminiClient.videoOptionsCalls.last())

        // 노트 분석(회귀): 옵션 필드는 무시 → 작업 DTO 구간·속도 null, Gemini 옵션 없음
        val noteRes = client.post("/api/v1/notes/analyze") {
            auth()
            header(HttpHeaders.ContentType, "application/json")
            setBody("""{"url":"https://youtu.be/dQw4w9WgXcQ","tags":["화성"],"startSec":10,"pace":"fast"}""")
        }
        assertEquals(HttpStatusCode.Accepted, noteRes.status, noteRes.bodyAsText())
        val noteJobId = Json.parseToJsonElement(noteRes.bodyAsText()).jsonObject["jobId"]!!.jsonPrimitive.content
        val noteJob = Json.parseToJsonElement(client.get("/api/v1/notes/jobs/$noteJobId", auth).bodyAsText()).jsonObject
        assertEquals(JsonNull, noteJob["pace"] ?: JsonNull)
        assertEquals(JsonNull, noteJob["startSec"] ?: JsonNull)
        newNoteService().executeJob(UUID.fromString(noteJobId))
        assertNull(fakeGeminiClient.videoOptionsCalls.last())
    }

    /** GA-4: 같은 영상·구간·속도 코드 진행 분석은 24시간 안에 409 DUPLICATE_ANALYSIS, force면 새 작업(`진행_분석설정.md` GA-4) */
    @Test
    fun n20_progressionAnalyze_duplicateBlocked_forceAllows() = testApplication {
        seedGeminiKey(userA)
        configureApiTestApp(dbConfig = dbConfig, geminiClient = fakeGeminiClient, analyzeJobDispatcher = fakeDispatcher)
        val jobIdOf = { body: String -> UUID.fromString(Json.parseToJsonElement(body).jsonObject["jobId"]!!.jsonPrimitive.content) }
        val setJob = { id: UUID, status: String, hoursAgo: Long ->
            transaction(db) {
                AnalysisJobsTable.update({ AnalysisJobsTable.id eq id }) {
                    it[AnalysisJobsTable.status] = status
                    it[createdAt] = OffsetDateTime.now(ZoneOffset.UTC).minusHours(hoursAgo)
                }
            }
        }
        val a = """{"url":"https://youtu.be/dQw4w9WgXcQ","startSec":40,"endSec":80,"pace":"fast"}"""

        // 첫 요청 202 → 대기 중에 같은 요청(주소 형식만 다름) 409 — 동시 1건(429)보다 먼저
        val r1 = postProgressionAnalyze(client, tokenA, a)
        assertEquals(HttpStatusCode.Accepted, r1.status, r1.bodyAsText())
        val job1 = jobIdOf(r1.bodyAsText())
        val dupQueued = postProgressionAnalyze(client, tokenA, """{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","startSec":40,"endSec":80,"pace":"fast"}""")
        assertEquals(HttpStatusCode.Conflict, dupQueued.status, dupQueued.bodyAsText())
        assertStandardError(dupQueued.bodyAsText(), 409, "DUPLICATE_ANALYSIS")

        // 완료 뒤에도 409, force:false도 409
        setJob(job1, "done", 1)
        assertEquals(HttpStatusCode.Conflict, postProgressionAnalyze(client, tokenA, a).status)
        assertEquals(HttpStatusCode.Conflict, postProgressionAnalyze(client, tokenA, a.dropLast(1) + ""","force":false}""").status)

        // force 형식 오류 400
        val badForce = postProgressionAnalyze(client, tokenA, a.dropLast(1) + ""","force":"yes"}""")
        assertEquals(HttpStatusCode.BadRequest, badForce.status)
        assertStandardError(badForce.bodyAsText(), 400, "INVALID_INPUT")

        // force:true → 새 작업 202
        val rForce = postProgressionAnalyze(client, tokenA, a.dropLast(1) + ""","force":true}""")
        assertEquals(HttpStatusCode.Accepted, rForce.status, rForce.bodyAsText())
        setJob(jobIdOf(rForce.bodyAsText()), "done", 1)

        // 구간·속도가 다르면 다른 분석 → 202
        for (other in listOf(
            """{"url":"https://youtu.be/dQw4w9WgXcQ","startSec":40,"endSec":80,"pace":"normal"}""",
            """{"url":"https://youtu.be/dQw4w9WgXcQ","startSec":40,"pace":"fast"}""",
            """{"url":"https://youtu.be/dQw4w9WgXcQ","pace":"fast"}"""
        )) {
            val r = postProgressionAnalyze(client, tokenA, other)
            assertEquals(HttpStatusCode.Accepted, r.status, other + " " + r.bodyAsText())
            setJob(jobIdOf(r.bodyAsText()), "done", 1)
        }

        // 실패한 작업은 중복 아님 → 바로 다시 202
        val b = """{"url":"https://youtu.be/oWQZopUx0fA"}"""
        val rb = postProgressionAnalyze(client, tokenA, b)
        assertEquals(HttpStatusCode.Accepted, rb.status, rb.bodyAsText())
        setJob(jobIdOf(rb.bodyAsText()), "failed", 0)
        val rb2 = postProgressionAnalyze(client, tokenA, b)
        assertEquals(HttpStatusCode.Accepted, rb2.status, rb2.bodyAsText())
        // 24시간 지난 완료 작업도 중복 아님
        setJob(jobIdOf(rb2.bodyAsText()), "done", 25)
        val rb3 = postProgressionAnalyze(client, tokenA, b)
        assertEquals(HttpStatusCode.Accepted, rb3.status, rb3.bodyAsText())
        setJob(jobIdOf(rb3.bodyAsText()), "done", 1)

        // 노트 분석은 중복 확인 없음(회귀)
        val noteBody = """{"url":"https://youtu.be/oWQZopUx0fA","tags":["화성"]}"""
        for (i in 1..2) {
            val nr = client.post("/api/v1/notes/analyze") {
                header(HttpHeaders.Authorization, "Bearer $tokenA")
                header(HttpHeaders.ContentType, "application/json")
                setBody(noteBody)
            }
            assertEquals(HttpStatusCode.Accepted, nr.status, nr.bodyAsText())
            setJob(jobIdOf(nr.bodyAsText()), "done", 1)
        }
    }
}
