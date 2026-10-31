package ulevelp.song

import com.zaxxer.hikari.HikariDataSource
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.server.testing.*
import kotlinx.serialization.json.*
import org.jetbrains.exposed.sql.Database
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.deleteAll
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.transactions.transaction
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import ulevelp.db.*
import ulevelp.service.VideoMeta
import ulevelp.support.*
import java.math.BigDecimal
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.*

class SongApiTest {

    companion object {
        private lateinit var dataSource: HikariDataSource
        private lateinit var db: Database
        private lateinit var dbConfig: DatabaseConfig

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

    @BeforeEach
    fun cleanDatabase() {
        transaction(db) {
            StorageTrashTable.deleteAll()
            UsersTable.deleteAll()
        }
    }

    private suspend fun ensureUser(client: io.ktor.client.HttpClient, token: String) {
        val res = client.get("/api/v1/me") {
            header(HttpHeaders.Authorization, "Bearer $token")
        }
        assertEquals(HttpStatusCode.OK, res.status)
    }

    @Test
    fun `S1 새 곡 201, 같은 videoId 재요청 200`() = testApplication {
        val fakeMeta = FakeVideoMetaClient()
        configureApiTestApp(dbConfig, fakeMeta)

        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)

        // 1. 새 곡 등록 -> 201 Created
        val postRes = client.post("/api/v1/songs") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("videoId", "dQw4w9WgXcQ")
                    put("title", "Autumn Leaves")
                    put("artist", "Jens")
                    put("rate", 0.75)
                }.toString()
            )
        }
        assertEquals(HttpStatusCode.Created, postRes.status)
        val postJson = Json.parseToJsonElement(postRes.bodyAsText()).jsonObject
        val songObj = postJson["song"]!!.jsonObject

        val expectedKeys = setOf(
            "id", "title", "artist", "status", "statusCode", "videoId",
            "pos", "a", "b", "rate", "lastDate", "memo", "totalSeconds", "resumeUrl"
        )
        assertEquals(expectedKeys, songObj.keys)

        val songId = songObj["id"]?.jsonPrimitive?.content
        assertNotNull(songId)
        assertEquals("Autumn Leaves", songObj["title"]?.jsonPrimitive?.content)
        assertEquals("Jens", songObj["artist"]?.jsonPrimitive?.content)
        assertEquals("연습 중", songObj["status"]?.jsonPrimitive?.content)
        assertEquals("practicing", songObj["statusCode"]?.jsonPrimitive?.content)
        assertEquals(0.75, songObj["rate"]?.jsonPrimitive?.double)
        assertTrue(songObj["pos"] is JsonNull)
        assertTrue(songObj["a"] is JsonNull)
        assertTrue(songObj["b"] is JsonNull)
        assertTrue(songObj["lastDate"] is JsonNull)
        assertEquals("", songObj["memo"]?.jsonPrimitive?.content)
        assertEquals(0L, songObj["totalSeconds"]?.jsonPrimitive?.long)
        assertEquals("https://hunseokc.github.io/ULevelP/practice.html?v=dQw4w9WgXcQ&r=0.75", songObj["resumeUrl"]?.jsonPrimitive?.content)

        // 2. 같은 videoId로 다른 제목 재요청 -> 200 OK (기존 곡 반환, 변경 없음, oEmbed 안 부름)
        val rePostRes = client.post("/api/v1/songs") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("videoId", "dQw4w9WgXcQ")
                    put("title", "다른 제목")
                }.toString()
            )
        }
        assertEquals(HttpStatusCode.OK, rePostRes.status)
        val reSongObj = Json.parseToJsonElement(rePostRes.bodyAsText()).jsonObject["song"]!!.jsonObject
        assertEquals(songId, reSongObj["id"]?.jsonPrimitive?.content)
        assertEquals("Autumn Leaves", reSongObj["title"]?.jsonPrimitive?.content)
        assertTrue(fakeMeta.calls.isEmpty(), "Existing song check must not invoke oEmbed")
    }

    @Test
    fun `S2 제목 비면 oEmbed, 실패면 (제목 없음)`() = testApplication {
        val fakeMeta = FakeVideoMetaClient(VideoMeta("Fake Title", "Fake Channel"))
        configureApiTestApp(dbConfig, fakeMeta)

        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)

        // 1. title 비어서 oEmbed 조회
        val res1 = client.post("/api/v1/songs") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("videoId", "aaaaaaaaaaa")
                    put("title", "")
                }.toString()
            )
        }
        assertEquals(HttpStatusCode.Created, res1.status)
        val song1 = Json.parseToJsonElement(res1.bodyAsText()).jsonObject["song"]!!.jsonObject
        assertEquals("Fake Title", song1["title"]?.jsonPrimitive?.content)
        assertEquals("Fake Channel", song1["artist"]?.jsonPrimitive?.content)
        assertEquals(listOf("aaaaaaaaaaa"), fakeMeta.calls)

        // 2. oEmbed 실패 시 (제목 없음)
        fakeMeta.meta = null
        val res2 = client.post("/api/v1/songs") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("videoId", "bbbbbbbbbbb")
                }.toString()
            )
        }
        assertEquals(HttpStatusCode.Created, res2.status)
        val song2 = Json.parseToJsonElement(res2.bodyAsText()).jsonObject["song"]!!.jsonObject
        assertEquals("(제목 없음)", song2["title"]?.jsonPrimitive?.content)
        assertEquals("", song2["artist"]?.jsonPrimitive?.content)
    }

    @Test
    fun `S3 POST 잘못된 입력`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)

        val badBodies = listOf(
            """{"videoId":"short"}""",
            """{}""",
            """{"videoId":"dQw4w9WgXcQ","rate":3.0}""",
            """{"videoId":"dQw4w9WgXcQ","rate":"1"}""",
            """{"videoId":"dQw4w9WgXcQ","title":"${"가".repeat(301)}"}""",
            """[]""",
            ""
        )

        for (body in badBodies) {
            val res = client.post("/api/v1/songs") {
                header(HttpHeaders.Authorization, "Bearer $tokenA")
                contentType(ContentType.Application.Json)
                setBody(body)
            }
            assertEquals(HttpStatusCode.BadRequest, res.status, "Failed for body: $body")
            assertStandardError(res.bodyAsText(), 400, "INVALID_INPUT")
        }

        transaction(db) {
            assertEquals(0L, SongsTable.selectAll().count())
        }
    }

    @Test
    fun `S4 목록 정렬·상태 필터·합계`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)

        val s1 = UUID.randomUUID()
        val s2 = UUID.randomUUID()
        val s3 = UUID.randomUUID()
        val s4 = UUID.randomUUID()
        val s5 = UUID.randomUUID()
        val s6 = UUID.randomUUID()

        transaction(db) {
            SongsTable.insert {
                it[id] = s1
                it[userId] = userA
                it[title] = "S1"
                it[videoId] = "11111111111"
                it[status] = "practicing"
                it[lastDate] = LocalDate.of(2026, 10, 1)
            }
            SongsTable.insert {
                it[id] = s2
                it[userId] = userA
                it[title] = "S2"
                it[videoId] = "22222222222"
                it[status] = "practicing"
                it[lastDate] = LocalDate.of(2026, 10, 20)
            }
            SongsTable.insert {
                it[id] = s3
                it[userId] = userA
                it[title] = "S3"
                it[videoId] = "33333333333"
                it[status] = "practicing"
                it[lastDate] = null
                it[updatedAt] = OffsetDateTime.parse("2026-10-29T10:00:00Z")
            }
            SongsTable.insert {
                it[id] = s6
                it[userId] = userA
                it[title] = "S6"
                it[videoId] = "66666666666"
                it[status] = "practicing"
                it[lastDate] = null
                it[updatedAt] = OffsetDateTime.parse("2026-10-30T10:00:00Z")
            }
            SongsTable.insert {
                it[id] = s4
                it[userId] = userA
                it[title] = "S4"
                it[videoId] = "44444444444"
                it[status] = "paused"
                it[lastDate] = LocalDate.of(2026, 10, 29)
            }
            SongsTable.insert {
                it[id] = s5
                it[userId] = userA
                it[title] = "S5"
                it[videoId] = "55555555555"
                it[status] = "done"
                it[lastDate] = LocalDate.of(2026, 10, 30)
            }

            // s1에 세션 2행 (600초, 300초 -> 900초)
            SessionsTable.insert {
                it[id] = UUID.randomUUID()
                it[userId] = userA
                it[songId] = s1
                it[date] = LocalDate.of(2026, 10, 1)
                it[seconds] = 600
            }
            SessionsTable.insert {
                it[id] = UUID.randomUUID()
                it[userId] = userA
                it[songId] = s1
                it[date] = LocalDate.of(2026, 10, 2)
                it[seconds] = 300
            }
        }

        // 1. GET /songs 전체 조회 정렬 검증
        val listRes = client.get("/api/v1/songs") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, listRes.status)
        val songs = Json.parseToJsonElement(listRes.bodyAsText()).jsonObject["songs"]!!.jsonArray
        val ids = songs.map { it.jsonObject["id"]?.jsonPrimitive?.content }
        assertEquals(listOf(s2, s1, s6, s3, s4, s5).map { it.toString() }, ids)

        val s1Dto = songs.first { it.jsonObject["id"]?.jsonPrimitive?.content == s1.toString() }.jsonObject
        assertEquals(900L, s1Dto["totalSeconds"]?.jsonPrimitive?.long)
        val s2Dto = songs.first { it.jsonObject["id"]?.jsonPrimitive?.content == s2.toString() }.jsonObject
        assertEquals(0L, s2Dto["totalSeconds"]?.jsonPrimitive?.long)

        // 2. ?status=보류
        val pausedKrRes = client.get("/api/v1/songs?status=보류") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, pausedKrRes.status)
        val pausedKrSongs = Json.parseToJsonElement(pausedKrRes.bodyAsText()).jsonObject["songs"]!!.jsonArray
        assertEquals(listOf(s4.toString()), pausedKrSongs.map { it.jsonObject["id"]?.jsonPrimitive?.content })

        // 3. ?status=paused
        val pausedEnRes = client.get("/api/v1/songs?status=paused") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, pausedEnRes.status)
        val pausedEnSongs = Json.parseToJsonElement(pausedEnRes.bodyAsText()).jsonObject["songs"]!!.jsonArray
        assertEquals(listOf(s4.toString()), pausedEnSongs.map { it.jsonObject["id"]?.jsonPrimitive?.content })

        // 4. ?status=foo -> 400 INVALID_INPUT
        val invalidStatusRes = client.get("/api/v1/songs?status=foo") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.BadRequest, invalidStatusRes.status)
        assertStandardError(invalidStatusRes.bodyAsText(), 400, "INVALID_INPUT")
    }

    @Test
    fun `S5 by-video`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)

        val songId = UUID.randomUUID()
        transaction(db) {
            SongsTable.insert {
                it[id] = songId
                it[userId] = userA
                it[title] = "Song A"
                it[videoId] = "dQw4w9WgXcQ"
            }
        }

        // 1. 존재하는 곡 -> 200
        val okRes = client.get("/api/v1/songs/by-video/dQw4w9WgXcQ") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, okRes.status)
        val okJson = Json.parseToJsonElement(okRes.bodyAsText()).jsonObject
        assertEquals("dQw4w9WgXcQ", okJson["song"]?.jsonObject?.get("videoId")?.jsonPrimitive?.content)

        // 2. 없는 곡 -> 200 {"song":null}
        val notFoundRes = client.get("/api/v1/songs/by-video/zzzzzzzzzzz") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, notFoundRes.status)
        val notFoundJson = Json.parseToJsonElement(notFoundRes.bodyAsText()).jsonObject
        assertTrue(notFoundJson["song"] is JsonNull)

        // 3. 비정상 videoId -> 400 INVALID_INPUT
        val badRes = client.get("/api/v1/songs/by-video/abc") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.BadRequest, badRes.status)
        assertStandardError(badRes.bodyAsText(), 400, "INVALID_INPUT")
    }

    @Test
    fun `S6 PATCH`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)

        val songId = UUID.randomUUID()
        transaction(db) {
            SongsTable.insert {
                it[id] = songId
                it[userId] = userA
                it[title] = "Initial Title"
                it[videoId] = "dQw4w9WgXcQ"
                it[memo] = "Initial Memo"
            }
        }

        // 1. status: "보류", memo: "다음 달"
        val patch1 = client.patch("/api/v1/songs/$songId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("""{"status":"보류","memo":"다음 달"}""")
        }
        assertEquals(HttpStatusCode.OK, patch1.status)
        val s1 = Json.parseToJsonElement(patch1.bodyAsText()).jsonObject["song"]!!.jsonObject
        assertEquals("보류", s1["status"]?.jsonPrimitive?.content)
        assertEquals("paused", s1["statusCode"]?.jsonPrimitive?.content)
        assertEquals("다음 달", s1["memo"]?.jsonPrimitive?.content)

        // 2. status: "done"
        val patch2 = client.patch("/api/v1/songs/$songId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("""{"status":"done"}""")
        }
        assertEquals(HttpStatusCode.OK, patch2.status)
        val s2 = Json.parseToJsonElement(patch2.bodyAsText()).jsonObject["song"]!!.jsonObject
        assertEquals("완료", s2["status"]?.jsonPrimitive?.content)
        assertEquals("done", s2["statusCode"]?.jsonPrimitive?.content)

        // 3. title: "새 제목"
        val patch3 = client.patch("/api/v1/songs/$songId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("""{"title":"새 제목"}""")
        }
        assertEquals(HttpStatusCode.OK, patch3.status)
        val s3 = Json.parseToJsonElement(patch3.bodyAsText()).jsonObject["song"]!!.jsonObject
        assertEquals("새 제목", s3["title"]?.jsonPrimitive?.content)
        assertEquals("다음 달", s3["memo"]?.jsonPrimitive?.content)

        // 4. 빈 객체 {} -> 400
        val patch4 = client.patch("/api/v1/songs/$songId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("{}")
        }
        assertEquals(HttpStatusCode.BadRequest, patch4.status)
        assertStandardError(patch4.bodyAsText(), 400, "INVALID_INPUT")

        // 5. title: "  " -> 400
        val patch5 = client.patch("/api/v1/songs/$songId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("""{"title":"  "}""")
        }
        assertEquals(HttpStatusCode.BadRequest, patch5.status)
        assertStandardError(patch5.bodyAsText(), 400, "INVALID_INPUT")

        // 6. status: "x" -> 400
        val patch6 = client.patch("/api/v1/songs/$songId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("""{"status":"x"}""")
        }
        assertEquals(HttpStatusCode.BadRequest, patch6.status)
        assertStandardError(patch6.bodyAsText(), 400, "INVALID_INPUT")

        // 7. memo > 2000 -> 400
        val patch7 = client.patch("/api/v1/songs/$songId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("""{"memo":"${"가".repeat(2001)}"}""")
        }
        assertEquals(HttpStatusCode.BadRequest, patch7.status)
        assertStandardError(patch7.bodyAsText(), 400, "INVALID_INPUT")

        // 8. UUID가 아닌 경로 -> 404
        val patch8 = client.patch("/api/v1/songs/not-a-uuid") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("""{"title":"새 제목"}""")
        }
        assertEquals(HttpStatusCode.NotFound, patch8.status)
        assertStandardError(patch8.bodyAsText(), 404, "NOT_FOUND")
    }

    @Test
    fun `S7 DELETE 하위 삭제 + supabase 녹음만 trash`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)

        val songId = UUID.randomUUID()
        val sessionId = UUID.randomUUID()
        val now = OffsetDateTime.now(ZoneOffset.UTC)

        transaction(db) {
            SongsTable.insert {
                it[id] = songId
                it[userId] = userA
                it[title] = "Song to delete"
                it[videoId] = "dQw4w9WgXcQ"
            }
            SessionsTable.insert {
                it[id] = sessionId
                it[userId] = userA
                it[SessionsTable.songId] = songId
                it[date] = LocalDate.of(2026, 10, 30)
                it[seconds] = 100
            }
            TakesTable.insert {
                it[userId] = userA
                it[TakesTable.sessionId] = sessionId
                it[TakesTable.songId] = songId
                it[recordedAt] = now
                it[durationSec] = 10
                it[mime] = "audio/mp4"
                it[sizeBytes] = 1000L
                it[storage] = "supabase"
                it[storageKey] = "$userA/t1.m4a"
            }
            TakesTable.insert {
                it[userId] = userA
                it[TakesTable.sessionId] = sessionId
                it[TakesTable.songId] = songId
                it[recordedAt] = now
                it[durationSec] = 20
                it[mime] = "audio/mp4"
                it[sizeBytes] = 2000L
                it[storage] = "drive"
                it[storageKey] = "driveFileId"
            }
        }

        val deleteRes = client.delete("/api/v1/songs/$songId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, deleteRes.status)
        val delJson = Json.parseToJsonElement(deleteRes.bodyAsText()).jsonObject
        assertEquals(true, delJson["ok"]?.jsonPrimitive?.boolean)

        transaction(db) {
            assertEquals(0L, SongsTable.selectAll().where { SongsTable.id eq songId }.count())
            assertEquals(0L, SessionsTable.selectAll().where { SessionsTable.songId eq songId }.count())
            assertEquals(0L, TakesTable.selectAll().where { TakesTable.songId eq songId }.count())
            val trashKeys = StorageTrashTable.selectAll().map { it[StorageTrashTable.storageKey] }
            assertEquals(listOf("$userA/t1.m4a"), trashKeys)
        }

        val byVideoRes = client.get("/api/v1/songs/by-video/dQw4w9WgXcQ") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        val byVideoJson = Json.parseToJsonElement(byVideoRes.bodyAsText()).jsonObject
        assertTrue(byVideoJson["song"] is JsonNull)
    }

    @Test
    fun `S8 A·B 교차 차단`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val userB = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        val tokenB = TestJwt.token(userB)
        ensureUser(client, tokenA)
        ensureUser(client, tokenB)

        val songA = UUID.randomUUID()
        transaction(db) {
            SongsTable.insert {
                it[id] = songA
                it[userId] = userA
                it[title] = "Song A"
                it[videoId] = "dQw4w9WgXcQ"
            }
        }

        // B 토큰으로:
        // 1. GET /songs -> songs = []
        val bListRes = client.get("/api/v1/songs") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
        }
        val bSongs = Json.parseToJsonElement(bListRes.bodyAsText()).jsonObject["songs"]!!.jsonArray
        assertEquals(0, bSongs.size)

        // 2. by-video dQw4w9WgXcQ -> song: null
        val bByVideoRes = client.get("/api/v1/songs/by-video/dQw4w9WgXcQ") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
        }
        val bByVideo = Json.parseToJsonElement(bByVideoRes.bodyAsText()).jsonObject["song"]
        assertTrue(bByVideo is JsonNull)

        // 3. PATCH /songs/{songA} -> 404 NOT_FOUND
        val bPatchRes = client.patch("/api/v1/songs/$songA") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
            contentType(ContentType.Application.Json)
            setBody("""{"title":"Hacked"}""")
        }
        assertEquals(HttpStatusCode.NotFound, bPatchRes.status)
        assertStandardError(bPatchRes.bodyAsText(), 404, "NOT_FOUND")

        // 4. DELETE /songs/{songA} -> 404 NOT_FOUND
        val bDelRes = client.delete("/api/v1/songs/$songA") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
        }
        assertEquals(HttpStatusCode.NotFound, bDelRes.status)
        assertStandardError(bDelRes.bodyAsText(), 404, "NOT_FOUND")

        transaction(db) {
            val aSong = SongsTable.selectAll().where { SongsTable.id eq songA }.single()
            assertEquals("Song A", aSong[SongsTable.title])
        }

        // 5. POST /songs {videoId:"dQw4w9WgXcQ"} -> B의 새 곡 201 생성 (A와 분리)
        val bPostRes = client.post("/api/v1/songs") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
            contentType(ContentType.Application.Json)
            setBody("""{"videoId":"dQw4w9WgXcQ","title":"B's Song"}""")
        }
        assertEquals(HttpStatusCode.Created, bPostRes.status)
        val bSongObj = Json.parseToJsonElement(bPostRes.bodyAsText()).jsonObject["song"]!!.jsonObject
        assertNotEquals(songA.toString(), bSongObj["id"]?.jsonPrimitive?.content)
    }

    @Test
    fun `S9 migrate-local`() = testApplication {
        val fakeMeta = FakeVideoMetaClient(VideoMeta("Fake Title", "Fake Channel"))
        configureApiTestApp(dbConfig, fakeMeta)

        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)

        val songA = UUID.randomUUID()
        transaction(db) {
            SongsTable.insert {
                it[id] = songA
                it[userId] = userA
                it[title] = "원래 제목"
                it[videoId] = "dQw4w9WgXcQ"
            }
        }

        val requestBody = buildJsonObject {
            putJsonArray("items") {
                addJsonObject {
                    put("videoId", "dQw4w9WgXcQ")
                    put("pos", 99)
                }
                addJsonObject {
                    put("videoId", "aaaaaaaaaaa")
                    put("pos", 12.44)
                    put("a", 10)
                    put("b", 25)
                    put("rate", 0.75)
                    put("date", "2026-10-28")
                }
                addJsonObject {
                    put("videoId", "aaaaaaaaaaa")
                }
                addJsonObject {
                    put("videoId", "bad")
                }
                add("문자열")
                addJsonObject {
                    put("videoId", "bbbbbbbbbbb")
                    put("a", 30)
                    put("b", 20)
                    put("rate", 9)
                }
            }
            put("markMigrated", true)
        }.toString()

        val res = client.post("/api/v1/songs/migrate-local") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody(requestBody)
        }
        assertEquals(HttpStatusCode.OK, res.status)
        val resJson = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        assertEquals(2, resJson["created"]?.jsonPrimitive?.int)
        assertEquals(4, resJson["skipped"]?.jsonPrimitive?.int)
        val migratedLocalAt = resJson["migratedLocalAt"]?.jsonPrimitive?.content
        assertNotNull(migratedLocalAt)

        transaction(db) {
            // aaaaaaaaaaa
            val rowA = SongsTable.selectAll().where { (SongsTable.userId eq userA) and (SongsTable.videoId eq "aaaaaaaaaaa") }.single()
            assertEquals(BigDecimal("12.4"), rowA[SongsTable.pos])
            assertEquals(BigDecimal("10.0"), rowA[SongsTable.a])
            assertEquals(BigDecimal("25.0"), rowA[SongsTable.b])
            assertEquals(BigDecimal("0.75"), rowA[SongsTable.rate])
            assertEquals(LocalDate.of(2026, 10, 28), rowA[SongsTable.lastDate])
            assertEquals("Fake Title", rowA[SongsTable.title])

            // bbbbbbbbbbb
            val rowB = SongsTable.selectAll().where { (SongsTable.userId eq userA) and (SongsTable.videoId eq "bbbbbbbbbbb") }.single()
            assertNull(rowB[SongsTable.a])
            assertNull(rowB[SongsTable.b])
            assertEquals(BigDecimal("1.00"), rowB[SongsTable.rate])

            // dQw4w9WgXcQ
            val rowOrig = SongsTable.selectAll().where { SongsTable.id eq songA }.single()
            assertEquals("원래 제목", rowOrig[SongsTable.title])
            assertNull(rowOrig[SongsTable.pos])
        }

        // GET /me 확인
        val meRes = client.get("/api/v1/me") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        val meJson = Json.parseToJsonElement(meRes.bodyAsText()).jsonObject
        assertEquals(migratedLocalAt, meJson["migratedLocalAt"]?.jsonPrimitive?.content)

        assertEquals(setOf("aaaaaaaaaaa", "bbbbbbbbbbb"), fakeMeta.calls.toSet())
    }

    @Test
    fun `S10 migrate-local 경계`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)

        // 1. items 101개 -> 400
        val over100Res = client.post("/api/v1/songs/migrate-local") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject {
                putJsonArray("items") {
                    repeat(101) { addJsonObject { put("videoId", "dQw4w9WgXcQ") } }
                }
            }.toString())
        }
        assertEquals(HttpStatusCode.BadRequest, over100Res.status)
        assertStandardError(over100Res.bodyAsText(), 400, "INVALID_INPUT")

        // 2. items 없음 -> 400
        val noItemsRes = client.post("/api/v1/songs/migrate-local") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("""{"markMigrated":true}""")
        }
        assertEquals(HttpStatusCode.BadRequest, noItemsRes.status)
        assertStandardError(noItemsRes.bodyAsText(), 400, "INVALID_INPUT")

        // 3. items 빈 배열, markMigrated=false -> 200
        val emptyRes = client.post("/api/v1/songs/migrate-local") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("""{"items":[],"markMigrated":false}""")
        }
        assertEquals(HttpStatusCode.OK, emptyRes.status)
        val emptyJson = Json.parseToJsonElement(emptyRes.bodyAsText()).jsonObject
        assertEquals(0, emptyJson["created"]?.jsonPrimitive?.int)
        assertEquals(0, emptyJson["skipped"]?.jsonPrimitive?.int)
        assertTrue(emptyJson["migratedLocalAt"] is JsonNull)
    }

    @Test
    fun `S11 outbox 적재`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)

        // 1. 노션 연동 없이 POST /songs -> outbox 0행
        val postRes = client.post("/api/v1/songs") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("""{"videoId":"dQw4w9WgXcQ","title":"Song A"}""")
        }
        assertEquals(HttpStatusCode.Created, postRes.status)
        val songId = Json.parseToJsonElement(postRes.bodyAsText()).jsonObject["song"]!!.jsonObject["id"]!!.jsonPrimitive.content
        val songUuid = UUID.fromString(songId)

        transaction(db) {
            assertEquals(0L, SyncOutboxTable.selectAll().count())
        }

        // 2. NotionSyncTable에 (userA, enabled=true) INSERT 후 PATCH 2번 -> outbox 1행 (중복 방지)
        transaction(db) {
            NotionSyncTable.insert {
                it[userId] = userA
                it[enabled] = true
            }
        }

        client.patch("/api/v1/songs/$songId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("""{"status":"보류"}""")
        }
        client.patch("/api/v1/songs/$songId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("""{"memo":"메모"}""")
        }

        transaction(db) {
            val outboxRows = SyncOutboxTable.selectAll().toList()
            assertEquals(1, outboxRows.size)
            assertEquals("song", outboxRows[0][SyncOutboxTable.entity])
            assertEquals("upsert", outboxRows[0][SyncOutboxTable.op])
            assertEquals(songUuid, outboxRows[0][SyncOutboxTable.entityId])
        }

        // 3. DELETE -> 추가로 op="delete" 1행 -> 총 2행
        client.delete("/api/v1/songs/$songId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }

        transaction(db) {
            val outboxRows = SyncOutboxTable.selectAll().toList()
            assertEquals(2, outboxRows.size)
            assertEquals("delete", outboxRows[1][SyncOutboxTable.op])
        }
    }

    @Test
    fun `S12 토큰 없음`() = testApplication {
        configureApiTestApp(dbConfig)

        val getRes = client.get("/api/v1/songs")
        assertEquals(HttpStatusCode.Unauthorized, getRes.status)
        assertStandardError(getRes.bodyAsText(), 401, "UNAUTHORIZED")

        val postRes = client.post("/api/v1/songs") {
            contentType(ContentType.Application.Json)
            setBody("""{"videoId":"dQw4w9WgXcQ"}""")
        }
        assertEquals(HttpStatusCode.Unauthorized, postRes.status)
        assertStandardError(postRes.bodyAsText(), 401, "UNAUTHORIZED")
    }

    @Test
    fun `S13 곡 상세 조회(세션·녹음 정렬 및 필드)`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)

        val postRes = client.post("/api/v1/songs") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("""{"videoId":"dQw4w9WgXcQ","title":"Song X","artist":"Artist X"}""")
        }
        assertEquals(HttpStatusCode.Created, postRes.status)
        val songId = Json.parseToJsonElement(postRes.bodyAsText()).jsonObject["song"]!!.jsonObject["id"]!!.jsonPrimitive.content
        val songUuid = UUID.fromString(songId)

        val session1Id = UUID.randomUUID()
        val session2Id = UUID.randomUUID()

        transaction(db) {
            SessionsTable.insert {
                it[SessionsTable.id] = session1Id
                it[SessionsTable.userId] = userA
                it[SessionsTable.songId] = songUuid
                it[SessionsTable.date] = LocalDate.of(2026, 10, 28)
                it[SessionsTable.seconds] = 600
                it[SessionsTable.loops] = 10
                it[SessionsTable.a] = BigDecimal("10.0")
                it[SessionsTable.b] = BigDecimal("25.0")
                it[SessionsTable.rate] = BigDecimal("1.00")
                it[SessionsTable.memo] = ""
            }
            SessionsTable.insert {
                it[SessionsTable.id] = session2Id
                it[SessionsTable.userId] = userA
                it[SessionsTable.songId] = songUuid
                it[SessionsTable.date] = LocalDate.of(2026, 10, 30)
                it[SessionsTable.seconds] = 960
                it[SessionsTable.loops] = 24
                it[SessionsTable.a] = BigDecimal("38.0")
                it[SessionsTable.b] = BigDecimal("55.2")
                it[SessionsTable.rate] = BigDecimal("0.75")
                it[SessionsTable.memo] = "좋음"
            }
            TakesTable.insert {
                it[TakesTable.id] = UUID.randomUUID()
                it[TakesTable.userId] = userA
                it[TakesTable.songId] = songUuid
                it[TakesTable.sessionId] = session1Id
                it[TakesTable.recordedAt] = OffsetDateTime.parse("2026-10-28T10:00:00Z")
                it[TakesTable.a] = BigDecimal("10.0")
                it[TakesTable.b] = BigDecimal("25.0")
                it[TakesTable.rate] = BigDecimal("1.00")
                it[TakesTable.durationSec] = 15
                it[TakesTable.mime] = "audio/mp4"
                it[TakesTable.sizeBytes] = 100000L
                it[TakesTable.storage] = "supabase"
                it[TakesTable.storageKey] = "$userA/take1.m4a"
                it[TakesTable.memo] = ""
            }
            TakesTable.insert {
                it[TakesTable.id] = UUID.randomUUID()
                it[TakesTable.userId] = userA
                it[TakesTable.songId] = songUuid
                it[TakesTable.sessionId] = session2Id
                it[TakesTable.recordedAt] = OffsetDateTime.parse("2026-10-30T14:22:10Z")
                it[TakesTable.a] = BigDecimal("38.0")
                it[TakesTable.b] = BigDecimal("55.2")
                it[TakesTable.rate] = BigDecimal("0.75")
                it[TakesTable.durationSec] = 18
                it[TakesTable.mime] = "audio/mp4"
                it[TakesTable.sizeBytes] = 284120L
                it[TakesTable.storage] = "supabase"
                it[TakesTable.storageKey] = "$userA/take2.m4a"
                it[TakesTable.memo] = ""
            }
        }

        val getRes = client.get("/api/v1/songs/$songId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, getRes.status)
        assertEquals("no-store", getRes.headers[HttpHeaders.CacheControl])

        val json = Json.parseToJsonElement(getRes.bodyAsText()).jsonObject
        val songObj = json["song"]!!.jsonObject
        assertEquals(1560L, songObj["totalSeconds"]!!.jsonPrimitive.long)
        assertEquals(14, songObj.keys.size)

        val sessionsArr = json["sessions"]!!.jsonArray
        assertEquals(2, sessionsArr.size)
        val s0 = sessionsArr[0].jsonObject
        assertEquals("2026-10-30", s0["date"]!!.jsonPrimitive.content)
        assertEquals(16.0, s0["minutes"]!!.jsonPrimitive.double)
        assertEquals("0:38\u20130:55", s0["segment"]!!.jsonPrimitive.content)
        assertEquals(24, s0["loops"]!!.jsonPrimitive.int)
        assertEquals(0.75, s0["rate"]!!.jsonPrimitive.double)
        assertEquals("좋음", s0["memo"]!!.jsonPrimitive.content)
        assertEquals(10, s0.keys.size)

        val s1 = sessionsArr[1].jsonObject
        assertEquals("2026-10-28", s1["date"]!!.jsonPrimitive.content)
        assertEquals(10, s1.keys.size)

        val takesArr = json["takes"]!!.jsonArray
        assertEquals(2, takesArr.size)
        val t0 = takesArr[0].jsonObject
        assertEquals("2026-10-30T14:22:10Z", t0["recordedAt"]!!.jsonPrimitive.content)
        assertEquals(12, t0.keys.size)

        val t1 = takesArr[1].jsonObject
        assertEquals("2026-10-28T10:00:00Z", t1["recordedAt"]!!.jsonPrimitive.content)
        assertEquals(12, t1.keys.size)
    }

    @Test
    fun `S14 곡 상세 빈 하위 목록`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)

        val postRes = client.post("/api/v1/songs") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("""{"videoId":"11111111111","title":"Song Y"}""")
        }
        assertEquals(HttpStatusCode.Created, postRes.status)
        val songId = Json.parseToJsonElement(postRes.bodyAsText()).jsonObject["song"]!!.jsonObject["id"]!!.jsonPrimitive.content

        val getRes = client.get("/api/v1/songs/$songId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, getRes.status)
        val json = Json.parseToJsonElement(getRes.bodyAsText()).jsonObject
        val songObj = json["song"]!!.jsonObject
        assertEquals(0L, songObj["totalSeconds"]!!.jsonPrimitive.long)
        assertEquals(0, json["sessions"]!!.jsonArray.size)
        assertEquals(0, json["takes"]!!.jsonArray.size)
    }

    @Test
    fun `S15 곡 상세 404(없는 곡·남의 곡·비 UUID)`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        val userB = UUID.randomUUID()
        val tokenB = TestJwt.token(userB)
        ensureUser(client, tokenA)
        ensureUser(client, tokenB)

        val postRes = client.post("/api/v1/songs") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("""{"videoId":"dQw4w9WgXcQ","title":"Song X"}""")
        }
        assertEquals(HttpStatusCode.Created, postRes.status)
        val songId = Json.parseToJsonElement(postRes.bodyAsText()).jsonObject["song"]!!.jsonObject["id"]!!.jsonPrimitive.content

        // 1. 남의 곡(B 토큰으로 A의 곡 X 요청)
        val resB = client.get("/api/v1/songs/$songId") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
        }
        assertEquals(HttpStatusCode.NotFound, resB.status)
        assertStandardError(resB.bodyAsText(), 404, "NOT_FOUND")

        // 2. A 토큰으로 없는 UUID
        val missingUuid = UUID.randomUUID()
        val resMissing = client.get("/api/v1/songs/$missingUuid") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.NotFound, resMissing.status)
        assertStandardError(resMissing.bodyAsText(), 404, "NOT_FOUND")

        // 3. 비 UUID
        val resInvalid = client.get("/api/v1/songs/not-a-uuid") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.NotFound, resInvalid.status)
        assertStandardError(resInvalid.bodyAsText(), 404, "NOT_FOUND")
    }
}
