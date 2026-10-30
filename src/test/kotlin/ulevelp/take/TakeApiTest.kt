package ulevelp.take

import com.zaxxer.hikari.HikariDataSource
import io.ktor.client.HttpClient
import io.ktor.client.request.*
import io.ktor.client.request.forms.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.server.testing.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runBlocking
import ulevelp.service.TakeService
import ulevelp.service.TakeUploadInput
import kotlinx.serialization.json.*
import org.jetbrains.exposed.sql.*
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import org.jetbrains.exposed.sql.transactions.transaction
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import ulevelp.db.DatabaseConfig
import ulevelp.db.DatabaseFactory
import ulevelp.db.NotionSyncTable
import ulevelp.db.ProfilesTable
import ulevelp.db.SessionsTable
import ulevelp.db.SongsTable
import ulevelp.db.StorageTrashTable
import ulevelp.db.SyncOutboxTable
import ulevelp.db.TakesTable
import ulevelp.db.UsersTable
import ulevelp.db.PostgresTestContainer
import ulevelp.support.*
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.UUID
import kotlin.test.*

class TakeApiTest {

    companion object {
        private lateinit var dataSource: HikariDataSource
        private lateinit var db: Database
        private lateinit var dbConfig: DatabaseConfig

        val uidA: UUID = UUID.fromString("00000000-0000-4000-a000-000000000001")
        val uidB: UUID = UUID.fromString("00000000-0000-4000-a000-000000000002")
        val tokenA: String get() = TestJwt.token(uidA, "userA@example.com")
        val tokenB: String get() = TestJwt.token(uidB, "userB@example.com")

        val today: LocalDate = LocalDate.now(ZoneOffset.UTC)

        @JvmStatic
        @BeforeAll
        fun setUp() {
            dbConfig = PostgresTestContainer.getConfig()
            dataSource = DatabaseFactory.createDataSource(dbConfig)
            DatabaseFactory.migrate(dataSource)
            db = DatabaseFactory.connect(dataSource)
        }

        @JvmStatic
        @AfterAll
        fun tearDown() {
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

    private lateinit var fake: FakeStorageClient

    @BeforeEach
    fun cleanDatabase() {
        fake = FakeStorageClient()
        transaction(db) {
            StorageTrashTable.deleteAll()
            SyncOutboxTable.deleteAll()
            TakesTable.deleteAll()
            SessionsTable.deleteAll()
            SongsTable.deleteAll()
            NotionSyncTable.deleteAll()
            UsersTable.deleteAll()
        }
    }

    private suspend fun ensureUser(client: HttpClient, token: String) {
        val res = client.get("/api/v1/me") {
            header(HttpHeaders.Authorization, "Bearer $token")
        }
        assertEquals(HttpStatusCode.OK, res.status)
    }

    private suspend fun createTestSong(client: HttpClient, token: String, videoId: String = "dQw4w9WgXcQ"): String {
        val res = client.post("/api/v1/songs") {
            header(HttpHeaders.Authorization, "Bearer $token")
            contentType(ContentType.Application.Json)
            setBody("""{"videoId":"$videoId","title":"T"}""")
        }
        assertEquals(HttpStatusCode.Created, res.status)
        val json = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        return json["song"]!!.jsonObject["id"]!!.jsonPrimitive.content
    }

    private suspend fun HttpClient.uploadTake(
        token: String,
        metadata: JsonObject,
        bytes: ByteArray,
        fileContentType: String = "audio/mp4"
    ): HttpResponse = post("/api/v1/takes") {
        header(HttpHeaders.Authorization, "Bearer $token")
        setBody(
            MultiPartFormDataContent(
                formData {
                    append(
                        "metadata",
                        metadata.toString(),
                        Headers.build {
                            append(HttpHeaders.ContentType, "application/json")
                        }
                    )
                    append(
                        "file",
                        bytes,
                        Headers.build {
                            append(HttpHeaders.ContentType, fileContentType)
                            append(HttpHeaders.ContentDisposition, "filename=\"take.m4a\"")
                        }
                    )
                }
            )
        )
    }

    private fun defaultMetadata(
        songId: String,
        date: LocalDate = today,
        recordedAt: String = DateTimeFormatter.ISO_INSTANT.format(OffsetDateTime.now(ZoneOffset.UTC).toInstant()),
        a: Double? = 38.0,
        b: Double? = 55.2,
        rate: Double? = 0.75,
        durationSec: Int = 18,
        mime: String = "audio/mp4"
    ): JsonObject = buildJsonObject {
        put("songId", songId)
        put("date", date.toString())
        put("recordedAt", recordedAt)
        if (a != null) put("a", a)
        if (b != null) put("b", b)
        if (rate != null) put("rate", rate)
        put("durationSec", durationSec)
        put("mime", mime)
    }

    @Test
    fun `T1 1분 미만 연습 중 녹음 - 0초 세션 자동 생성 및 합산`() = testApplication {
        configureApiTestApp(dbConfig, storageClient = fake)
        ensureUser(client, tokenA)
        val songId = createTestSong(client, tokenA)

        // 1분 미만 연습 기록 저장 (30초) -> keep=true
        val save1 = client.post("/api/v1/practice/save") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("""{"songId":"$songId","pos":10.0,"date":"$today","addSeconds":30,"addLoops":0}""")
        }
        assertEquals(HttpStatusCode.OK, save1.status)
        val save1Json = Json.parseToJsonElement(save1.bodyAsText()).jsonObject
        assertTrue(save1Json["keep"]?.jsonPrimitive?.boolean == true)

        // ① 1000바이트 업로드
        val uploadRes = client.uploadTake(tokenA, defaultMetadata(songId), ByteArray(1000))
        assertEquals(HttpStatusCode.Created, uploadRes.status)

        val uploadJson = Json.parseToJsonElement(uploadRes.bodyAsText()).jsonObject
        val takeObj = uploadJson["take"]?.jsonObject ?: fail("take 객체 누락")

        val expectedKeys = setOf(
            "id", "sessionId", "recordedAt", "a", "b", "rate",
            "durationSec", "mime", "sizeBytes", "storage", "storageKey", "memo"
        )
        assertEquals(expectedKeys, takeObj.keys, "take는 정확히 12개 필드를 가져야 합니다.")
        assertEquals("supabase", takeObj["storage"]?.jsonPrimitive?.content)
        val takeId = takeObj["id"]?.jsonPrimitive?.content ?: fail("take.id 누락")
        val expectedKey = "$uidA/$takeId.m4a"
        assertEquals(expectedKey, takeObj["storageKey"]?.jsonPrimitive?.content)
        assertEquals(1000L, takeObj["sizeBytes"]?.jsonPrimitive?.long)
        assertEquals("audio/mp4", takeObj["mime"]?.jsonPrimitive?.content)

        val takeSessionId = takeObj["sessionId"]?.jsonPrimitive?.content ?: fail("take.sessionId 누락")

        // DB 세션 검증
        val sessionRows = transaction(db) {
            SessionsTable.selectAll().where {
                (SessionsTable.userId eq uidA) and
                (SessionsTable.songId eq UUID.fromString(songId)) and
                (SessionsTable.date eq today)
            }.toList()
        }
        assertEquals(1, sessionRows.size)
        val sess = sessionRows.first()
        assertEquals(0, sess[SessionsTable.seconds])
        assertEquals(0, sess[SessionsTable.loops])
        assertEquals(0.75, sess[SessionsTable.rate]?.toDouble())
        assertEquals(38.0, sess[SessionsTable.a]?.toDouble())
        assertEquals(55.2, sess[SessionsTable.b]?.toDouble())
        assertEquals(takeSessionId, sess[SessionsTable.id].toString())

        assertEquals(1000, fake.objects[expectedKey]?.size)

        // ② 추가 연습 기록 저장 (30초) -> 합산 60초가 되어 keep=false
        val save2 = client.post("/api/v1/practice/save") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("""{"songId":"$songId","pos":20.0,"date":"$today","addSeconds":30,"addLoops":0}""")
        }
        assertEquals(HttpStatusCode.OK, save2.status)
        val save2Json = Json.parseToJsonElement(save2.bodyAsText()).jsonObject
        assertFalse(save2Json["keep"]?.jsonPrimitive?.boolean ?: true)
        assertEquals(takeSessionId, save2Json["sessionId"]?.jsonPrimitive?.content)
        assertEquals(30, save2Json["totalSeconds"]?.jsonPrimitive?.int)
    }

    @Test
    fun `T2 기존 세션에 붙고 세션 값 유지`() = testApplication {
        configureApiTestApp(dbConfig, storageClient = fake)
        ensureUser(client, tokenA)
        val songId = createTestSong(client, tokenA)

        // 먼저 세션 생성 (60초, rate 1.0)
        val saveRes = client.post("/api/v1/practice/save") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("""{"songId":"$songId","pos":10.0,"date":"$today","addSeconds":60,"addLoops":1,"rate":1.0}""")
        }
        assertEquals(HttpStatusCode.OK, saveRes.status)
        val existingSessionId = Json.parseToJsonElement(saveRes.bodyAsText()).jsonObject["sessionId"]!!.jsonPrimitive.content

        // 녹음 업로드 (rate: 0.5)
        val uploadRes = client.uploadTake(tokenA, defaultMetadata(songId, rate = 0.5), ByteArray(1000))
        assertEquals(HttpStatusCode.Created, uploadRes.status)
        val takeObj = Json.parseToJsonElement(uploadRes.bodyAsText()).jsonObject["take"]!!.jsonObject

        assertEquals(existingSessionId, takeObj["sessionId"]?.jsonPrimitive?.content)
        assertEquals(0.5, takeObj["rate"]?.jsonPrimitive?.double)

        // 세션 테이블 확인: seconds=60, rate=1.00 그대로 유지
        val sessionRow = transaction(db) {
            SessionsTable.selectAll().where { SessionsTable.id eq UUID.fromString(existingSessionId) }.single()
        }
        assertEquals(60, sessionRow[SessionsTable.seconds])
        assertEquals(1.00, sessionRow[SessionsTable.rate]?.toDouble())
    }

    @Test
    fun `T3 쿼터 사전 거부`() = testApplication {
        configureApiTestApp(dbConfig, storageClient = fake)
        ensureUser(client, tokenA)
        val songId = createTestSong(client, tokenA)

        // 쿼터 1500으로 설정
        transaction(db) {
            ProfilesTable.update({ ProfilesTable.id eq uidA }) {
                it[takeQuotaBytes] = 1500L
            }
        }

        // ① 1000바이트 업로드 -> 성공
        val res1 = client.uploadTake(tokenA, defaultMetadata(songId), ByteArray(1000))
        assertEquals(HttpStatusCode.Created, res1.status)

        // ② 600바이트 업로드 -> 413 거부 (1000 + 600 = 1600 > 1500)
        val res2 = client.uploadTake(tokenA, defaultMetadata(songId), ByteArray(600))
        assertEquals(HttpStatusCode.PayloadTooLarge, res2.status)
        assertStandardError(res2.bodyAsText(), 413, "TAKE_QUOTA_EXCEEDED")

        // ②는 fake storage에 업로드되지 않음
        assertEquals(1, fake.objects.size)

        // GET /me 호출하여 사용량 1000 확인
        val meRes = client.get("/api/v1/me") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        val meJson = Json.parseToJsonElement(meRes.bodyAsText()).jsonObject
        assertEquals(1000L, meJson["takeUsedBytes"]?.jsonPrimitive?.long)
    }

    @Test
    fun `T4 동시 업로드 쿼터 경합`() = testApplication {
        configureApiTestApp(dbConfig, storageClient = fake)
        ensureUser(client, tokenA)
        val songId = createTestSong(client, tokenA)

        transaction(db) {
            ProfilesTable.update({ ProfilesTable.id eq uidA }) {
                it[takeQuotaBytes] = 1000L
            }
        }
        fake.uploadDelayMs = 300L

        // 600바이트 2건 동시 업로드
        val (res1, res2) = coroutineScope {
            val d1 = async { client.uploadTake(tokenA, defaultMetadata(songId), ByteArray(600)) }
            val d2 = async { client.uploadTake(tokenA, defaultMetadata(songId), ByteArray(600)) }
            Pair(d1.await(), d2.await())
        }

        val statuses = listOf(res1.status.value, res2.status.value).sorted()
        assertEquals(listOf(201, 413), statuses)

        val takeCount = transaction(db) { TakesTable.selectAll().count() }
        assertEquals(1, takeCount)

        assertEquals(1, fake.objects.size)
        assertEquals(1, fake.deleted.size)

        val savedKey = transaction(db) { TakesTable.selectAll().single()[TakesTable.storageKey] }
        val deletedKey = fake.deleted.first()
        assertNotEquals(savedKey, deletedKey, "삭제된 파일 키는 성공한 녹음의 키가 아니어야 합니다.")
        assertTrue(fake.objects.containsKey(savedKey), "성공한 녹음의 파일은 스토리지에 남아있어야 합니다.")
        assertFalse(fake.objects.containsKey(deletedKey), "정리된 실패 파일은 스토리지에서 삭제되어야 합니다.")

        val trashCount = transaction(db) { StorageTrashTable.selectAll().count() }
        assertEquals(0, trashCount)
    }

    @Test
    fun `T5 정리 삭제도 실패하면 trash`() = testApplication {
        configureApiTestApp(dbConfig, storageClient = fake)
        ensureUser(client, tokenA)
        val songId = createTestSong(client, tokenA)

        transaction(db) {
            ProfilesTable.update({ ProfilesTable.id eq uidA }) {
                it[takeQuotaBytes] = 1000L
            }
        }
        fake.uploadDelayMs = 300L
        fake.failDelete = true

        val (res1, res2) = coroutineScope {
            val d1 = async { client.uploadTake(tokenA, defaultMetadata(songId), ByteArray(600)) }
            val d2 = async { client.uploadTake(tokenA, defaultMetadata(songId), ByteArray(600)) }
            Pair(d1.await(), d2.await())
        }

        val statuses = listOf(res1.status.value, res2.status.value).sorted()
        assertEquals(listOf(201, 413), statuses)

        val takeCount = transaction(db) { TakesTable.selectAll().count() }
        assertEquals(1, takeCount)

        val trashRows = transaction(db) { StorageTrashTable.selectAll().toList() }
        assertEquals(1, trashRows.size)

        val savedKey = transaction(db) { TakesTable.selectAll().single()[TakesTable.storageKey] }
        val trashKey = trashRows.first()[StorageTrashTable.storageKey]
        assertNotEquals(savedKey, trashKey, "trash에 들어간 키는 성공한 녹음의 키가 아니어야 합니다.")
        assertTrue(fake.objects.containsKey(trashKey), "삭제 실패한 파일은 스토리지에 그대로 남아있어야 합니다.")
        assertTrue(fake.objects.containsKey(savedKey), "성공한 녹음의 파일도 스토리지에 남아있어야 합니다.")

        // 삭제 실패로 인해 fake storage에는 2건 모두 남아있음
        assertEquals(2, fake.objects.size)
    }

    @Test
    fun `T6 업로드 실패 502`() = testApplication {
        configureApiTestApp(dbConfig, storageClient = fake)
        ensureUser(client, tokenA)
        val songId = createTestSong(client, tokenA)

        fake.failUpload = true

        val res = client.uploadTake(tokenA, defaultMetadata(songId), ByteArray(1000))
        assertEquals(HttpStatusCode.BadGateway, res.status)
        assertStandardError(res.bodyAsText(), 502, "STORAGE_ERROR")

        val takesCount = transaction(db) { TakesTable.selectAll().count() }
        val sessionsCount = transaction(db) { SessionsTable.selectAll().count() }
        assertEquals(0, takesCount)
        assertEquals(0, sessionsCount)
    }

    @Test
    fun `T7 크기 경계`() = testApplication {
        configureApiTestApp(dbConfig, storageClient = fake)
        ensureUser(client, tokenA)
        val songId = createTestSong(client, tokenA)

        // ① 52,428,801바이트 (50MB 초과)
        val res1 = client.uploadTake(tokenA, defaultMetadata(songId), ByteArray(52_428_801))
        assertEquals(HttpStatusCode.PayloadTooLarge, res1.status)
        assertStandardError(res1.bodyAsText(), 413, "TAKE_TOO_LARGE")

        // ② 0바이트
        val res2 = client.uploadTake(tokenA, defaultMetadata(songId), ByteArray(0))
        assertEquals(HttpStatusCode.BadRequest, res2.status)
        assertStandardError(res2.bodyAsText(), 400, "INVALID_INPUT")

        // ③ 52,428,800바이트 (정확히 50MB) -> 성공
        val res3 = client.uploadTake(tokenA, defaultMetadata(songId), ByteArray(52_428_800))
        assertEquals(HttpStatusCode.Created, res3.status)
    }

    @Test
    fun `T8 metadata 검증`() = testApplication {
        configureApiTestApp(dbConfig, storageClient = fake)
        ensureUser(client, tokenA)
        val songId = createTestSong(client, tokenA)

        val dummyBytes = ByteArray(100)

        // 1) metadata 파트 없음
        val res1 = client.post("/api/v1/takes") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            setBody(
                MultiPartFormDataContent(
                    formData {
                        append("file", dummyBytes, Headers.build {
                            append(HttpHeaders.ContentType, "audio/mp4")
                            append(HttpHeaders.ContentDisposition, "filename=\"take.m4a\"")
                        })
                    }
                )
            )
        }
        assertEquals(HttpStatusCode.BadRequest, res1.status)
        assertStandardError(res1.bodyAsText(), 400, "INVALID_INPUT")

        // 2) file 파트 없음
        val res2 = client.post("/api/v1/takes") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            setBody(
                MultiPartFormDataContent(
                    formData {
                        append("metadata", defaultMetadata(songId).toString(), Headers.build {
                            append(HttpHeaders.ContentType, "application/json")
                        })
                    }
                )
            )
        }
        assertEquals(HttpStatusCode.BadRequest, res2.status)
        assertStandardError(res2.bodyAsText(), 400, "INVALID_INPUT")

        // 3) Content-Type: application/json 본문 {}
        val res3 = client.post("/api/v1/takes") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("{}")
        }
        assertEquals(HttpStatusCode.BadRequest, res3.status)
        assertStandardError(res3.bodyAsText(), 400, "INVALID_INPUT")

        // 4) metadata "[1]"
        val res4 = client.post("/api/v1/takes") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            setBody(
                MultiPartFormDataContent(
                    formData {
                        append("metadata", "[1]", Headers.build {
                            append(HttpHeaders.ContentType, "application/json")
                        })
                        append("file", dummyBytes, Headers.build {
                            append(HttpHeaders.ContentType, "audio/mp4")
                            append(HttpHeaders.ContentDisposition, "filename=\"take.m4a\"")
                        })
                    }
                )
            )
        }
        assertEquals(HttpStatusCode.BadRequest, res4.status)
        assertStandardError(res4.bodyAsText(), 400, "INVALID_INPUT")

        // 5) mime: "audio/flac"
        val res5 = client.uploadTake(tokenA, defaultMetadata(songId, mime = "audio/flac"), dummyBytes)
        assertEquals(HttpStatusCode.BadRequest, res5.status)
        assertStandardError(res5.bodyAsText(), 400, "INVALID_INPUT")

        // 6) durationSec: 3601
        val res6 = client.uploadTake(tokenA, defaultMetadata(songId, durationSec = 3601), dummyBytes)
        assertEquals(HttpStatusCode.BadRequest, res6.status)
        assertStandardError(res6.bodyAsText(), 400, "INVALID_INPUT")

        // 7) durationSec 없음
        val metaNoDuration = buildJsonObject {
            defaultMetadata(songId).forEach { (k, v) ->
                if (k != "durationSec") put(k, v)
            }
        }
        val res7 = client.uploadTake(tokenA, metaNoDuration, dummyBytes)
        assertEquals(HttpStatusCode.BadRequest, res7.status)
        assertStandardError(res7.bodyAsText(), 400, "INVALID_INPUT")

        // 8) a: 50, b: 40 (a >= b)
        val res8 = client.uploadTake(tokenA, defaultMetadata(songId, a = 50.0, b = 40.0), dummyBytes)
        assertEquals(HttpStatusCode.BadRequest, res8.status)
        assertStandardError(res8.bodyAsText(), 400, "INVALID_INPUT")

        // 9) date: "2026-13-01"
        val metaBadDate = buildJsonObject {
            defaultMetadata(songId).forEach { (k, v) ->
                if (k != "date") put(k, v) else put(k, "2026-13-01")
            }
        }
        val res9 = client.uploadTake(tokenA, metaBadDate, dummyBytes)
        assertEquals(HttpStatusCode.BadRequest, res9.status)
        assertStandardError(res9.bodyAsText(), 400, "INVALID_INPUT")

        // 10) recordedAt: "yesterday"
        val metaBadInstant = buildJsonObject {
            defaultMetadata(songId).forEach { (k, v) ->
                if (k != "recordedAt") put(k, v) else put(k, "yesterday")
            }
        }
        val res10 = client.uploadTake(tokenA, metaBadInstant, dummyBytes)
        assertEquals(HttpStatusCode.BadRequest, res10.status)
        assertStandardError(res10.bodyAsText(), 400, "INVALID_INPUT")

        // 11) songId: "x"
        val metaBadSongId = buildJsonObject {
            defaultMetadata(songId).forEach { (k, v) ->
                if (k != "songId") put(k, v) else put(k, "x")
            }
        }
        val res11 = client.uploadTake(tokenA, metaBadSongId, dummyBytes)
        assertEquals(HttpStatusCode.BadRequest, res11.status)
        assertStandardError(res11.bodyAsText(), 400, "INVALID_INPUT")

        assertTrue(fake.objects.isEmpty(), "실패 요청에 의해 스토리지에 객체가 생성되지 않아야 합니다.")
    }

    @Test
    fun `T9 mime 파라미터 제거`() = testApplication {
        configureApiTestApp(dbConfig, storageClient = fake)
        ensureUser(client, tokenA)
        val songId = createTestSong(client, tokenA)

        val res = client.uploadTake(tokenA, defaultMetadata(songId, mime = "audio/webm;codecs=opus"), ByteArray(500))
        assertEquals(HttpStatusCode.Created, res.status)

        val takeObj = Json.parseToJsonElement(res.bodyAsText()).jsonObject["take"]!!.jsonObject
        assertEquals("audio/webm", takeObj["mime"]?.jsonPrimitive?.content)
        val storageKey = takeObj["storageKey"]?.jsonPrimitive?.content ?: fail("storageKey 누락")
        assertTrue(storageKey.endsWith(".weba"), "확장자는 .weba여야 합니다: $storageKey")
    }

    @Test
    fun `T10 재생 URL`() = testApplication {
        configureApiTestApp(dbConfig, storageClient = fake)
        ensureUser(client, tokenA)
        val songId = createTestSong(client, tokenA)

        val uploadRes = client.uploadTake(tokenA, defaultMetadata(songId), ByteArray(500))
        val takeId = Json.parseToJsonElement(uploadRes.bodyAsText()).jsonObject["take"]!!.jsonObject["id"]!!.jsonPrimitive.content

        // drive 녹음 1건 DB 직접 삽입
        val driveTakeId = UUID.randomUUID()
        transaction(db) {
            val sessId = SessionsTable.select(SessionsTable.id)
                .where { (SessionsTable.userId eq uidA) and (SessionsTable.songId eq UUID.fromString(songId)) }
                .first()[SessionsTable.id]
            TakesTable.insert {
                it[id] = driveTakeId
                it[userId] = uidA
                it[sessionId] = sessId
                it[TakesTable.songId] = UUID.fromString(songId)
                it[recordedAt] = OffsetDateTime.now(ZoneOffset.UTC)
                it[durationSec] = 10
                it[mime] = "audio/mp4"
                it[sizeBytes] = 500L
                it[storage] = "drive"
                it[storageKey] = "driveId"
                it[memo] = ""
            }
        }

        // ① 정상 서명 URL 생성
        val res1 = client.get("/api/v1/takes/$takeId/url") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, res1.status)
        val json1 = Json.parseToJsonElement(res1.bodyAsText()).jsonObject
        assertEquals("https://fake.storage/$uidA/$takeId.m4a?exp=3600", json1["url"]?.jsonPrimitive?.content)
        assertEquals(3600, json1["expiresIn"]?.jsonPrimitive?.int)

        // ② Drive 녹음 URL 요청 -> 400 INVALID_INPUT
        val res2 = client.get("/api/v1/takes/$driveTakeId/url") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.BadRequest, res2.status)
        assertStandardError(res2.bodyAsText(), 400, "INVALID_INPUT")

        // ③ sign 실패 시 502 STORAGE_ERROR
        fake.failSign = true
        val res3 = client.get("/api/v1/takes/$takeId/url") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.BadGateway, res3.status)
        assertStandardError(res3.bodyAsText(), 502, "STORAGE_ERROR")
    }

    @Test
    fun `T11 녹음 삭제 - 파일 제거 및 쿼터 반환`() = testApplication {
        configureApiTestApp(dbConfig, storageClient = fake)
        ensureUser(client, tokenA)
        val songId = createTestSong(client, tokenA)

        val uploadRes = client.uploadTake(tokenA, defaultMetadata(songId), ByteArray(1000))
        val takeId = Json.parseToJsonElement(uploadRes.bodyAsText()).jsonObject["take"]!!.jsonObject["id"]!!.jsonPrimitive.content

        val delRes = client.delete("/api/v1/takes/$takeId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, delRes.status)

        val takesCount = transaction(db) { TakesTable.selectAll().count() }
        assertEquals(0, takesCount)
        assertTrue(fake.objects.isEmpty())

        val trashCount = transaction(db) { StorageTrashTable.selectAll().count() }
        assertEquals(0, trashCount)

        val meRes = client.get("/api/v1/me") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        val meJson = Json.parseToJsonElement(meRes.bodyAsText()).jsonObject
        assertEquals(0L, meJson["takeUsedBytes"]?.jsonPrimitive?.long)

        val sessionsCount = transaction(db) { SessionsTable.selectAll().count() }
        assertEquals(1, sessionsCount, "세션은 삭제되지 않고 유지되어야 합니다.")
    }

    @Test
    fun `T12 삭제 시 파일 삭제 실패 - trash 남음`() = testApplication {
        configureApiTestApp(dbConfig, storageClient = fake)
        ensureUser(client, tokenA)
        val songId = createTestSong(client, tokenA)

        val uploadRes = client.uploadTake(tokenA, defaultMetadata(songId), ByteArray(1000))
        val takeId = Json.parseToJsonElement(uploadRes.bodyAsText()).jsonObject["take"]!!.jsonObject["id"]!!.jsonPrimitive.content

        fake.failDelete = true

        val delRes = client.delete("/api/v1/takes/$takeId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, delRes.status)

        val takesCount = transaction(db) { TakesTable.selectAll().count() }
        assertEquals(0, takesCount)

        val trashRows = transaction(db) { StorageTrashTable.selectAll().toList() }
        assertEquals(1, trashRows.size)
        assertEquals(1, trashRows.first()[StorageTrashTable.attempts])
        assertNotNull(trashRows.first()[StorageTrashTable.lastError])
    }

    @Test
    fun `T13 곡 삭제 시 녹음 파일도 바로 지움`() = testApplication {
        configureApiTestApp(dbConfig, storageClient = fake)
        ensureUser(client, tokenA)
        val songId = createTestSong(client, tokenA)

        client.uploadTake(tokenA, defaultMetadata(songId), ByteArray(1000))
        client.uploadTake(tokenA, defaultMetadata(songId), ByteArray(2000))
        assertEquals(2, fake.objects.size)

        val delRes = client.delete("/api/v1/songs/$songId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, delRes.status)

        assertTrue(fake.objects.isEmpty(), "곡 삭제 시 녹음 파일이 모두 삭제되어야 합니다.")
        val trashCount = transaction(db) { StorageTrashTable.selectAll().count() }
        assertEquals(0, trashCount)
    }

    @Test
    fun `T14 A B 교차 차단`() = testApplication {
        configureApiTestApp(dbConfig, storageClient = fake)
        ensureUser(client, tokenA)
        ensureUser(client, tokenB)
        val songIdA = createTestSong(client, tokenA)

        val uploadRes = client.uploadTake(tokenA, defaultMetadata(songIdA), ByteArray(1000))
        val takeIdA = Json.parseToJsonElement(uploadRes.bodyAsText()).jsonObject["take"]!!.jsonObject["id"]!!.jsonPrimitive.content

        // B 토큰으로 A의 곡에 녹음 업로드 시도 -> 404 NOT_FOUND
        val bUpload = client.uploadTake(tokenB, defaultMetadata(songIdA), ByteArray(500))
        assertEquals(HttpStatusCode.NotFound, bUpload.status)
        assertStandardError(bUpload.bodyAsText(), 404, "NOT_FOUND")
        assertEquals(1, fake.objects.size)

        // B 토큰으로 A의 녹음 URL 조회 시도 -> 404 NOT_FOUND
        val bUrl = client.get("/api/v1/takes/$takeIdA/url") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
        }
        assertEquals(HttpStatusCode.NotFound, bUrl.status)
        assertStandardError(bUrl.bodyAsText(), 404, "NOT_FOUND")

        // B 토큰으로 A의 녹음 삭제 시도 -> 404 NOT_FOUND
        val bDel = client.delete("/api/v1/takes/$takeIdA") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
        }
        assertEquals(HttpStatusCode.NotFound, bDel.status)
        assertStandardError(bDel.bodyAsText(), 404, "NOT_FOUND")

        val takesCount = transaction(db) { TakesTable.selectAll().count() }
        assertEquals(1, takesCount, "A의 녹음 행은 그대로 보존되어야 합니다.")
    }

    @Test
    fun `T15 저장소 미설정 503`() = testApplication {
        configureApiTestApp(dbConfig, storageClient = null)
        ensureUser(client, tokenA)
        val songId = createTestSong(client, tokenA)

        val takeId = UUID.randomUUID()
        transaction(db) {
            val sessId = UUID.randomUUID()
            SessionsTable.insert {
                it[id] = sessId
                it[userId] = uidA
                it[TakesTable.songId] = UUID.fromString(songId)
                it[date] = today
                it[seconds] = 60
                it[loops] = 1
            }
            TakesTable.insert {
                it[id] = takeId
                it[userId] = uidA
                it[sessionId] = sessId
                it[TakesTable.songId] = UUID.fromString(songId)
                it[recordedAt] = OffsetDateTime.now(ZoneOffset.UTC)
                it[durationSec] = 10
                it[mime] = "audio/mp4"
                it[sizeBytes] = 1000L
                it[storage] = "supabase"
                it[storageKey] = "$uidA/t1.m4a"
                it[memo] = ""
            }
        }

        // ① 업로드 -> 503
        val res1 = client.uploadTake(tokenA, defaultMetadata(songId), ByteArray(500))
        assertEquals(HttpStatusCode.ServiceUnavailable, res1.status)
        assertStandardError(res1.bodyAsText(), 503, "STORAGE_UNAVAILABLE")

        // ② URL -> 503
        val res2 = client.get("/api/v1/takes/$takeId/url") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.ServiceUnavailable, res2.status)
        assertStandardError(res2.bodyAsText(), 503, "STORAGE_UNAVAILABLE")

        // ③ DELETE -> 200, storage_trash 1행 적재
        val res3 = client.delete("/api/v1/takes/$takeId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, res3.status)
        val trashCount = transaction(db) { StorageTrashTable.selectAll().count() }
        assertEquals(1, trashCount)
    }

    @Test
    fun `T16 outbox 연동`() = testApplication {
        configureApiTestApp(dbConfig, storageClient = fake)
        ensureUser(client, tokenA)
        val songId = createTestSong(client, tokenA)

        transaction(db) {
            NotionSyncTable.insert {
                it[userId] = uidA
                it[enabled] = true
            }
        }

        // ① 세션 없는 날 업로드 1건
        val pastDate = today.minusDays(5)
        val uploadRes = client.uploadTake(tokenA, defaultMetadata(songId, date = pastDate), ByteArray(1000))
        assertEquals(HttpStatusCode.Created, uploadRes.status)
        val takeId = Json.parseToJsonElement(uploadRes.bodyAsText()).jsonObject["take"]!!.jsonObject["id"]!!.jsonPrimitive.content

        // ② 녹음 삭제
        val delRes = client.delete("/api/v1/takes/$takeId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, delRes.status)

        // sync_outbox 확인 (id 순)
        val outboxRows = transaction(db) {
            SyncOutboxTable.selectAll().orderBy(SyncOutboxTable.id to SortOrder.ASC).toList()
        }
        // 곡 생성 시의 outbox 1건 제외하고, 세션 없는 날 업로드로 생성된 (session, upsert), (take, upsert), 그리고 삭제의 (take, delete) 확인
        val takeAndSessionOps = outboxRows.filter { it[SyncOutboxTable.entity] in setOf("session", "take") }
        assertEquals(3, takeAndSessionOps.size)
        assertEquals("session" to "upsert", takeAndSessionOps[0][SyncOutboxTable.entity] to takeAndSessionOps[0][SyncOutboxTable.op])
        assertEquals("take" to "upsert", takeAndSessionOps[1][SyncOutboxTable.entity] to takeAndSessionOps[1][SyncOutboxTable.op])
        assertEquals("take" to "delete", takeAndSessionOps[2][SyncOutboxTable.entity] to takeAndSessionOps[2][SyncOutboxTable.op])
    }

    @Test
    fun `T17 토큰 없음 401`() = testApplication {
        configureApiTestApp(dbConfig, storageClient = fake)

        val res1 = client.uploadTake("", defaultMetadata(UUID.randomUUID().toString()), ByteArray(100))
        assertEquals(HttpStatusCode.Unauthorized, res1.status)
        assertStandardError(res1.bodyAsText(), 401, "UNAUTHORIZED")

        val res2 = client.get("/api/v1/takes/${UUID.randomUUID()}/url")
        assertEquals(HttpStatusCode.Unauthorized, res2.status)
        assertStandardError(res2.bodyAsText(), 401, "UNAUTHORIZED")

        val res3 = client.delete("/api/v1/takes/${UUID.randomUUID()}")
        assertEquals(HttpStatusCode.Unauthorized, res3.status)
        assertStandardError(res3.bodyAsText(), 401, "UNAUTHORIZED")
    }

    @Test
    fun `T18 코루틴 취소 시에도 NonCancellable로 스토리지 파일 정리`() = runBlocking {
        val takeService = TakeService(db, fake)
        val songUuid = UUID.randomUUID()
        transaction(db) {
            UsersTable.insert {
                it[id] = uidA
                it[email] = "cancel@example.com"
            }
            ProfilesTable.insert {
                it[id] = uidA
                it[takeQuotaBytes] = 200 * 1024 * 1024L
            }
            SongsTable.insert {
                it[id] = songUuid
                it[userId] = uidA
                it[videoId] = "dQw4w9WgXcQ"
                it[title] = "Cancel Test"
                it[artist] = "Artist"
            }
        }

        val input = TakeUploadInput(
            songId = songUuid,
            date = today,
            recordedAt = OffsetDateTime.now(ZoneOffset.UTC),
            a = null,
            b = null,
            rate = null,
            durationSec = 10,
            mime = "audio/mp4",
            bytes = ByteArray(500)
        )

        var uploadedKey: String? = null
        var job: Job? = null
        fake.onUploadSuccess = { key ->
            uploadedKey = key
            job?.cancel(CancellationException("Client disconnected"))
        }

        val deferred = async {
            takeService.upload(uidA, input)
        }
        job = deferred

        assertFailsWith<CancellationException> {
            deferred.await()
        }

        assertNotNull(uploadedKey)
        // 코루틴이 취소되었어도 NonCancellable 안에서 fake.delete(key)가 실행되어 정리되었음을 검증
        assertEquals(listOf(uploadedKey), fake.deleted.toList())
        assertFalse(fake.objects.containsKey(uploadedKey))

        // DB takes는 트랜잭션 롤백으로 0건이어야 함
        val takesCount = transaction(db) { TakesTable.selectAll().count() }
        assertEquals(0, takesCount)
    }

    @Test
    fun `T19 커밋 완료 후 취소 발생 시 이미 커밋된 녹음의 스토리지 파일 보존 검증`() = runBlocking {
        val takeService = TakeService(db, fake)
        val songUuid = UUID.randomUUID()
        transaction(db) {
            UsersTable.insert {
                it[id] = uidA
                it[email] = "commit-cancel@example.com"
            }
            ProfilesTable.insert {
                it[id] = uidA
                it[takeQuotaBytes] = 200 * 1024 * 1024L
            }
            SongsTable.insert {
                it[id] = songUuid
                it[userId] = uidA
                it[videoId] = "dQw4w9WgXcQ"
                it[title] = "Commit Cancel Test"
                it[artist] = "Artist"
            }
        }

        val input = TakeUploadInput(
            songId = songUuid,
            date = today,
            recordedAt = OffsetDateTime.now(ZoneOffset.UTC),
            a = null,
            b = null,
            rate = null,
            durationSec = 10,
            mime = "audio/mp4",
            bytes = ByteArray(500)
        )

        var uploadedKey: String? = null
        var job: Job? = null
        fake.onUploadSuccess = { key ->
            uploadedKey = key
            // 트랜잭션 B가 DB에 먼저 커밋된 후 취소가 발생한 상황 시뮬레이션:
            // DB에 동일 key를 가진 take 행을 사전 등록
            val preSessionId = UUID.randomUUID()
            transaction(db) {
                SessionsTable.insert {
                    it[id] = preSessionId
                    it[userId] = uidA
                    it[songId] = songUuid
                    it[date] = today
                    it[seconds] = 0
                    it[loops] = 0
                }
                TakesTable.insert {
                    it[id] = UUID.randomUUID()
                    it[userId] = uidA
                    it[sessionId] = preSessionId
                    it[songId] = songUuid
                    it[recordedAt] = OffsetDateTime.now(ZoneOffset.UTC)
                    it[durationSec] = 10
                    it[mime] = "audio/mp4"
                    it[sizeBytes] = 500L
                    it[storage] = "supabase"
                    it[storageKey] = key
                    it[memo] = ""
                }
            }
            job?.cancel(CancellationException("Disconnected right after commit"))
        }

        val deferred = async {
            takeService.upload(uidA, input)
        }
        job = deferred

        assertFailsWith<CancellationException> {
            deferred.await()
        }

        assertNotNull(uploadedKey)
        // DB에 이미 커밋된 행이 있으므로 fake.delete가 호출되지 않고 파일이 보존되어야 함
        assertTrue(fake.deleted.isEmpty(), "이미 커밋된 녹음 파일은 delete되지 않아야 합니다.")
        assertTrue(fake.objects.containsKey(uploadedKey), "스토리지에 파일이 보존되어 있어야 합니다.")

        // storage_trash에도 등록되지 않아야 함
        val trashCount = transaction(db) { StorageTrashTable.selectAll().count() }
        assertEquals(0, trashCount, "storage_trash에 들어가지 않아야 합니다.")
    }

    @Test
    fun `T20 브라우저 FormData Blob 형태의 metadata 수신 (FileItem 파싱)`() = testApplication {
        configureApiTestApp(dbConfig, storageClient = fake)
        ensureUser(client, tokenA)
        val songId = createTestSong(client, tokenA)
        val uploadRes = client.post("/api/v1/takes") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            setBody(
                MultiPartFormDataContent(
                    formData {
                        append(
                            "metadata",
                            defaultMetadata(songId).toString().toByteArray(Charsets.UTF_8),
                            Headers.build {
                                append(HttpHeaders.ContentType, "application/json")
                                append(HttpHeaders.ContentDisposition, "filename=\"blob\"")
                            }
                        )
                        append(
                            "file",
                            ByteArray(1000),
                            Headers.build {
                                append(HttpHeaders.ContentType, "audio/mp4")
                                append(HttpHeaders.ContentDisposition, "filename=\"take.m4a\"")
                            }
                        )
                    }
                )
            )
        }
        assertEquals(HttpStatusCode.Created, uploadRes.status)
        val json = Json.parseToJsonElement(uploadRes.bodyAsText()).jsonObject
        assertTrue(json["ok"]!!.jsonPrimitive.boolean)
        assertNotNull(json["take"]!!.jsonObject["id"]?.jsonPrimitive?.content)
    }
}
