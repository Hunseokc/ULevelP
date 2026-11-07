package ulevelp.session

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
import ulevelp.support.*
import java.math.BigDecimal
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.*

class SessionApiTest {

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
            SyncOutboxTable.deleteAll()
            NotionSyncTable.deleteAll()
            StorageTrashTable.deleteAll()
            TakesTable.deleteAll()
            SessionsTable.deleteAll()
            SongsTable.deleteAll()
            ProfilesTable.deleteAll()
            UsersTable.deleteAll()
        }
    }

    private suspend fun ensureUser(client: io.ktor.client.HttpClient, token: String) {
        val res = client.get("/api/v1/me") {
            header(HttpHeaders.Authorization, "Bearer $token")
        }
        assertEquals(HttpStatusCode.OK, res.status)
    }

    private fun insertSong(userId: UUID, title: String = "곡", artist: String = "아티스트", videoId: String = "dQw4w9WgXcQ"): UUID {
        val songId = UUID.randomUUID()
        transaction(db) {
            SongsTable.insert {
                it[id] = songId
                it[SongsTable.userId] = userId
                it[SongsTable.videoId] = videoId
                it[SongsTable.title] = title
                it[SongsTable.artist] = artist
            }
        }
        return songId
    }

    private fun insertSession(
        userId: UUID,
        songId: UUID,
        date: LocalDate,
        seconds: Int,
        loops: Int = 0,
        a: BigDecimal? = null,
        b: BigDecimal? = null,
        rate: BigDecimal? = null,
        memo: String = ""
    ): UUID {
        val sessionId = UUID.randomUUID()
        transaction(db) {
            SessionsTable.insert {
                it[id] = sessionId
                it[SessionsTable.userId] = userId
                it[SessionsTable.songId] = songId
                it[SessionsTable.date] = date
                it[SessionsTable.seconds] = seconds
                it[SessionsTable.loops] = loops
                it[SessionsTable.a] = a
                it[SessionsTable.b] = b
                it[SessionsTable.rate] = rate
                it[SessionsTable.memo] = memo
            }
        }
        return sessionId
    }

    private fun insertTake(
        userId: UUID,
        songId: UUID,
        sessionId: UUID,
        recordedAt: OffsetDateTime,
        durationSec: Int = 10,
        rate: BigDecimal? = null,
        a: BigDecimal? = null,
        b: BigDecimal? = null
    ): UUID {
        val takeId = UUID.randomUUID()
        transaction(db) {
            TakesTable.insert {
                it[id] = takeId
                it[TakesTable.userId] = userId
                it[TakesTable.songId] = songId
                it[TakesTable.sessionId] = sessionId
                it[TakesTable.recordedAt] = recordedAt
                it[TakesTable.durationSec] = durationSec
                it[TakesTable.mime] = "audio/mp4"
                it[TakesTable.sizeBytes] = 1024L
                it[TakesTable.storage] = "supabase"
                it[TakesTable.storageKey] = "$userId/$takeId.m4a"
                it[TakesTable.rate] = rate
                it[TakesTable.a] = a
                it[TakesTable.b] = b
            }
        }
        return takeId
    }

    @Test
    fun `L1 기본 조회(빈 기록)`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)

        val res = client.get("/api/v1/sessions") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, res.status)
        val obj = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        val summary = obj["summary"]!!.jsonObject
        assertEquals(0L, summary["thisWeekSeconds"]!!.jsonPrimitive.long)
        assertEquals(0L, summary["thisMonthSeconds"]!!.jsonPrimitive.long)
        assertEquals(0, obj["calendar"]!!.jsonArray.size)
        assertEquals(0, obj["sessions"]!!.jsonArray.size)
    }

    @Test
    fun `L2 주간·월간 집계 및 4단계 달력 level`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)

        val songId = insertSong(userA, title = "곡 1", videoId = "11111111111")
        // today = 2026-10-30(금요일, 월요일=2026-10-26)
        // ① 2026-10-30 3600초 (lv4, 이번 주·이번 달)
        insertSession(userA, songId, LocalDate.of(2026, 10, 30), 3600)
        // ② 2026-10-29 1800초 (lv3, 이번 주·이번 달)
        insertSession(userA, songId, LocalDate.of(2026, 10, 29), 1800)
        // ③ 2026-10-26 900초 (lv2, 이번 주·이번 달)
        insertSession(userA, songId, LocalDate.of(2026, 10, 26), 900)
        // ④ 2026-10-05 300초 (lv1, 이번 달·이번 주 아님)
        insertSession(userA, songId, LocalDate.of(2026, 10, 5), 300)
        // ⑤ 2026-09-30 1200초 (lv2, 지난달, 12주 안)
        insertSession(userA, songId, LocalDate.of(2026, 9, 30), 1200)
        // ⑥ 2026-10-28 0초 (0초 세션)
        insertSession(userA, songId, LocalDate.of(2026, 10, 28), 0)

        val res = client.get("/api/v1/sessions?today=2026-10-30") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, res.status)
        val obj = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        val summary = obj["summary"]!!.jsonObject
        assertEquals(6300L, summary["thisWeekSeconds"]!!.jsonPrimitive.long)
        assertEquals(6600L, summary["thisMonthSeconds"]!!.jsonPrimitive.long)

        val calendar = obj["calendar"]!!.jsonArray
        assertEquals(5, calendar.size, "0초 세션은 calendar에서 제외되어 5개여야 함")
        // 날짜 오름차순 검증
        val c0 = calendar[0].jsonObject
        assertEquals("2026-09-30", c0["date"]!!.jsonPrimitive.content)
        assertEquals(1200L, c0["totalSeconds"]!!.jsonPrimitive.long)
        assertEquals(2, c0["level"]!!.jsonPrimitive.int)

        val c1 = calendar[1].jsonObject
        assertEquals("2026-10-05", c1["date"]!!.jsonPrimitive.content)
        assertEquals(300L, c1["totalSeconds"]!!.jsonPrimitive.long)
        assertEquals(1, c1["level"]!!.jsonPrimitive.int)

        val c2 = calendar[2].jsonObject
        assertEquals("2026-10-26", c2["date"]!!.jsonPrimitive.content)
        assertEquals(900L, c2["totalSeconds"]!!.jsonPrimitive.long)
        assertEquals(2, c2["level"]!!.jsonPrimitive.int)

        val c3 = calendar[3].jsonObject
        assertEquals("2026-10-29", c3["date"]!!.jsonPrimitive.content)
        assertEquals(1800L, c3["totalSeconds"]!!.jsonPrimitive.long)
        assertEquals(3, c3["level"]!!.jsonPrimitive.int)

        val c4 = calendar[4].jsonObject
        assertEquals("2026-10-30", c4["date"]!!.jsonPrimitive.content)
        assertEquals(3600L, c4["totalSeconds"]!!.jsonPrimitive.long)
        assertEquals(4, c4["level"]!!.jsonPrimitive.int)

        val sessions = obj["sessions"]!!.jsonArray
        assertEquals(6, sessions.size)
    }

    @Test
    fun `L3 세션 상세 필드·segment·takes 정렬`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)

        val songId = insertSong(userA, title = "Autumn Leaves", artist = "Jens", videoId = "dQw4w9WgXcQ")
        val sessionId = insertSession(
            userId = userA,
            songId = songId,
            date = LocalDate.of(2026, 10, 30),
            seconds = 990,
            loops = 26,
            a = BigDecimal("38.0"),
            b = BigDecimal("55.2"),
            rate = BigDecimal("0.75"),
            memo = "좋음"
        )
        // takes 2개 (순서 반대로 넣어서 정렬 확인)
        val t2 = insertTake(userA, songId, sessionId, OffsetDateTime.of(2026, 10, 30, 10, 5, 0, 0, ZoneOffset.UTC))
        val t1 = insertTake(userA, songId, sessionId, OffsetDateTime.of(2026, 10, 30, 10, 0, 0, 0, ZoneOffset.UTC))

        val res = client.get("/api/v1/sessions?from=2026-10-30&to=2026-10-30&today=2026-10-30") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, res.status)
        val obj = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        val sessions = obj["sessions"]!!.jsonArray
        assertEquals(1, sessions.size)

        val s0 = sessions[0].jsonObject
        val expectedSessionKeys = setOf(
            "id", "songId", "songTitle", "songArtist", "videoId", "date",
            "seconds", "minutes", "loops", "a", "b", "segment", "rate", "memo", "takes"
        )
        assertEquals(expectedSessionKeys, s0.keys)
        assertEquals(sessionId.toString(), s0["id"]!!.jsonPrimitive.content)
        assertEquals(songId.toString(), s0["songId"]!!.jsonPrimitive.content)
        assertEquals("Autumn Leaves", s0["songTitle"]!!.jsonPrimitive.content)
        assertEquals("Jens", s0["songArtist"]!!.jsonPrimitive.content)
        assertEquals("dQw4w9WgXcQ", s0["videoId"]!!.jsonPrimitive.content)
        assertEquals("2026-10-30", s0["date"]!!.jsonPrimitive.content)
        assertEquals(990, s0["seconds"]!!.jsonPrimitive.int)
        assertEquals(16.5, s0["minutes"]!!.jsonPrimitive.double)
        assertEquals(26, s0["loops"]!!.jsonPrimitive.int)
        assertEquals(38.0, s0["a"]!!.jsonPrimitive.double)
        assertEquals(55.2, s0["b"]!!.jsonPrimitive.double)
        assertEquals("0:38–0:55", s0["segment"]!!.jsonPrimitive.content)
        assertEquals(0.75, s0["rate"]!!.jsonPrimitive.double)
        assertEquals("좋음", s0["memo"]!!.jsonPrimitive.content)

        val takes = s0["takes"]!!.jsonArray
        assertEquals(2, takes.size)
        val expectedTakeKeys = setOf(
            "id", "sessionId", "recordedAt", "a", "b", "rate",
            "durationSec", "mime", "sizeBytes", "storage", "storageKey", "memo"
        )
        assertEquals(expectedTakeKeys, takes[0].jsonObject.keys)
        assertEquals(t1.toString(), takes[0].jsonObject["id"]!!.jsonPrimitive.content)
        assertEquals(t2.toString(), takes[1].jsonObject["id"]!!.jsonPrimitive.content)
    }

    @Test
    fun `L4 from·to 범위 필터와 summary 독립성`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)

        val songId = insertSong(userA, title = "곡 1", videoId = "11111111111")
        insertSession(userA, songId, LocalDate.of(2026, 10, 30), 3600)
        insertSession(userA, songId, LocalDate.of(2026, 10, 29), 1800)
        insertSession(userA, songId, LocalDate.of(2026, 10, 26), 900)
        insertSession(userA, songId, LocalDate.of(2026, 10, 5), 300)
        insertSession(userA, songId, LocalDate.of(2026, 9, 30), 1200)

        val res = client.get("/api/v1/sessions?from=2026-10-29&to=2026-10-30&today=2026-10-30") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, res.status)
        val obj = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        val summary = obj["summary"]!!.jsonObject
        assertEquals(6300L, summary["thisWeekSeconds"]!!.jsonPrimitive.long)
        assertEquals(6600L, summary["thisMonthSeconds"]!!.jsonPrimitive.long)

        val calendar = obj["calendar"]!!.jsonArray
        assertEquals(2, calendar.size)
        assertEquals("2026-10-29", calendar[0].jsonObject["date"]!!.jsonPrimitive.content)
        assertEquals("2026-10-30", calendar[1].jsonObject["date"]!!.jsonPrimitive.content)

        val sessions = obj["sessions"]!!.jsonArray
        assertEquals(2, sessions.size)
        assertEquals("2026-10-30", sessions[0].jsonObject["date"]!!.jsonPrimitive.content)
        assertEquals("2026-10-29", sessions[1].jsonObject["date"]!!.jsonPrimitive.content)
    }

    @Test
    fun `L5 잘못된 쿼리 파라미터`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)

        val badQueries = listOf(
            "?from=bad",
            "?to=1999-12-31",
            "?today=2099-01-01",
            "?from=2026-10-30&to=2026-10-20",
            "?from=2025-01-01&to=2026-01-03"
        )

        for (q in badQueries) {
            val res = client.get("/api/v1/sessions$q") {
                header(HttpHeaders.Authorization, "Bearer $tokenA")
            }
            assertEquals(HttpStatusCode.BadRequest, res.status, "Query $q must return 400")
            assertStandardError(res.bodyAsText(), 400, "INVALID_INPUT")
        }
    }

    @Test
    fun `L6 세션 메모 수정 성공 + 빈 문자열`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)

        val songId = insertSong(userA, title = "곡 1", videoId = "11111111111")
        val sessionId = insertSession(userA, songId, LocalDate.of(2026, 10, 30), 1200, memo = "초기")

        // ① 공백 trim 후 저장
        val patch1 = client.patch("/api/v1/sessions/$sessionId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("memo", "  메트로놈 80bpm  ") }.toString())
        }
        assertEquals(HttpStatusCode.OK, patch1.status)
        val patch1Obj = Json.parseToJsonElement(patch1.bodyAsText()).jsonObject
        assertEquals(true, patch1Obj["ok"]?.jsonPrimitive?.boolean)

        val get1 = client.get("/api/v1/sessions?today=2026-10-30") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        val get1Obj = Json.parseToJsonElement(get1.bodyAsText()).jsonObject
        assertEquals("메트로놈 80bpm", get1Obj["sessions"]!!.jsonArray[0].jsonObject["memo"]!!.jsonPrimitive.content)

        // ② 빈 문자열로 초기화
        val patch2 = client.patch("/api/v1/sessions/$sessionId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("memo", "") }.toString())
        }
        assertEquals(HttpStatusCode.OK, patch2.status)

        val get2 = client.get("/api/v1/sessions?today=2026-10-30") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        val get2Obj = Json.parseToJsonElement(get2.bodyAsText()).jsonObject
        assertEquals("", get2Obj["sessions"]!!.jsonArray[0].jsonObject["memo"]!!.jsonPrimitive.content)
    }

    @Test
    fun `L7 세션 메모 수정 검증 오류`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)

        val songId = insertSong(userA, title = "곡 1", videoId = "11111111111")
        val sessionId = insertSession(userA, songId, LocalDate.of(2026, 10, 30), 1200)

        // ① {}
        val p1 = client.patch("/api/v1/sessions/$sessionId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("{}")
        }
        assertEquals(HttpStatusCode.BadRequest, p1.status)
        assertStandardError(p1.bodyAsText(), 400, "INVALID_INPUT")

        // ② { memo: null }
        val p2 = client.patch("/api/v1/sessions/$sessionId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("memo", JsonNull) }.toString())
        }
        assertEquals(HttpStatusCode.BadRequest, p2.status)
        assertStandardError(p2.bodyAsText(), 400, "INVALID_INPUT")

        // ③ { memo: 123 }
        val p3 = client.patch("/api/v1/sessions/$sessionId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("memo", 123) }.toString())
        }
        assertEquals(HttpStatusCode.BadRequest, p3.status)
        assertStandardError(p3.bodyAsText(), 400, "INVALID_INPUT")

        // ④ { memo: 2001자 }
        val p4 = client.patch("/api/v1/sessions/$sessionId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("memo", "가".repeat(2001)) }.toString())
        }
        assertEquals(HttpStatusCode.BadRequest, p4.status)
        assertStandardError(p4.bodyAsText(), 400, "INVALID_INPUT")

        // ⑤ /api/v1/sessions/not-a-uuid
        val p5 = client.patch("/api/v1/sessions/not-a-uuid") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("memo", "메모") }.toString())
        }
        assertEquals(HttpStatusCode.NotFound, p5.status)
        assertStandardError(p5.bodyAsText(), 404, "NOT_FOUND")
    }

    @Test
    fun `L8 A·B 교차 접근 차단`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)

        val userB = UUID.randomUUID()
        val tokenB = TestJwt.token(userB)
        ensureUser(client, tokenB)

        val songId = insertSong(userA, title = "A 곡", videoId = "aaaaaaaaaaa")
        val sessionA = insertSession(userA, songId, LocalDate.of(2026, 10, 30), 1200, memo = "A 메모")
        insertTake(userA, songId, sessionA, OffsetDateTime.now(ZoneOffset.UTC))

        // B 토큰으로 GET
        val bGet = client.get("/api/v1/sessions") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
        }
        assertEquals(HttpStatusCode.OK, bGet.status)
        val bGetObj = Json.parseToJsonElement(bGet.bodyAsText()).jsonObject
        assertEquals(0L, bGetObj["summary"]!!.jsonObject["thisWeekSeconds"]!!.jsonPrimitive.long)
        assertEquals(0, bGetObj["sessions"]!!.jsonArray.size)
        assertEquals(0, bGetObj["calendar"]!!.jsonArray.size)

        // B 토큰으로 A 세션 PATCH
        val bPatch = client.patch("/api/v1/sessions/$sessionA") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("memo", "해킹") }.toString())
        }
        assertEquals(HttpStatusCode.NotFound, bPatch.status)
        assertStandardError(bPatch.bodyAsText(), 404, "NOT_FOUND")

        // A 세션 메모가 그대로인지 확인
        val aGet = client.get("/api/v1/sessions?today=2026-10-30") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        val aGetObj = Json.parseToJsonElement(aGet.bodyAsText()).jsonObject
        assertEquals("A 메모", aGetObj["sessions"]!!.jsonArray[0].jsonObject["memo"]!!.jsonPrimitive.content)
    }

    @Test
    fun `L9 outbox 적재`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)

        // NotionSyncTable enabled = true 설정
        transaction(db) {
            NotionSyncTable.insert {
                it[userId] = userA
                it[enabled] = true
            }
        }

        val songId = insertSong(userA, title = "곡", videoId = "11111111111")
        val sessionId = insertSession(userA, songId, LocalDate.of(2026, 10, 30), 1000)

        // 연속 2회 수정
        val p1 = client.patch("/api/v1/sessions/$sessionId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("memo", "첫 수정") }.toString())
        }
        assertEquals(HttpStatusCode.OK, p1.status)

        val p2 = client.patch("/api/v1/sessions/$sessionId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("memo", "두 번째 수정") }.toString())
        }
        assertEquals(HttpStatusCode.OK, p2.status)

        transaction(db) {
            val outboxRows = SyncOutboxTable
                .selectAll()
                .where {
                    (SyncOutboxTable.userId eq userA) and
                    (SyncOutboxTable.entity eq "session") and
                    (SyncOutboxTable.entityId eq sessionId) and
                    (SyncOutboxTable.op eq "upsert")
                }
                .toList()
            assertEquals(1, outboxRows.size, "중복 방지로 1행만 존재해야 함")
        }
    }

    @Test
    fun `L10 토큰 없음`() = testApplication {
        configureApiTestApp(dbConfig)

        val gRes = client.get("/api/v1/sessions")
        assertEquals(HttpStatusCode.Unauthorized, gRes.status)
        assertStandardError(gRes.bodyAsText(), 401, "UNAUTHORIZED")

        val pRes = client.patch("/api/v1/sessions/${UUID.randomUUID()}") {
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("memo", "메모") }.toString())
        }
        assertEquals(HttpStatusCode.Unauthorized, pRes.status)
        assertStandardError(pRes.bodyAsText(), 401, "UNAUTHORIZED")
    }
}
