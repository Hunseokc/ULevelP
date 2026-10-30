package ulevelp.song

import com.zaxxer.hikari.HikariDataSource
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.server.testing.*
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.json.*
import org.jetbrains.exposed.sql.Database
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
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
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.*

class PracticeSaveApiTest {

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

    private suspend fun createTestSong(client: io.ktor.client.HttpClient, token: String): String {
        val res = client.post("/api/v1/songs") {
            header(HttpHeaders.Authorization, "Bearer $token")
            contentType(ContentType.Application.Json)
            setBody("""{"videoId":"dQw4w9WgXcQ","title":"T"}""")
        }
        assertEquals(HttpStatusCode.Created, res.status)
        val songObj = Json.parseToJsonElement(res.bodyAsText()).jsonObject["song"]!!.jsonObject
        return songObj["id"]!!.jsonPrimitive.content
    }

    @Test
    fun `P1 60초 미만 신규는 keep`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)
        val songX = createTestSong(client, tokenA)
        val today = LocalDate.now(ZoneOffset.UTC)

        val res = client.post("/api/v1/practice/save") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("songId", songX)
                    put("pos", 45.0)
                    put("a", 38.0)
                    put("b", 55.2)
                    put("rate", 0.75)
                    put("date", today.toString())
                    put("addSeconds", 30)
                    put("addLoops", 2)
                }.toString()
            )
        }
        assertEquals(HttpStatusCode.OK, res.status)
        val json = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        assertEquals(true, json["ok"]?.jsonPrimitive?.boolean)
        assertEquals(true, json["keep"]?.jsonPrimitive?.boolean)
        assertTrue(json["sessionId"] is JsonNull)
        assertTrue(json["totalSeconds"] is JsonNull)
        assertTrue(json["minutes"] is JsonNull)
        assertEquals(30, json["pendingSeconds"]?.jsonPrimitive?.int)

        transaction(db) {
            assertEquals(0L, SessionsTable.selectAll().count())
            val songRow = SongsTable.selectAll().where { SongsTable.id eq UUID.fromString(songX) }.single()
            assertEquals(BigDecimal("45.0"), songRow[SongsTable.pos])
            assertEquals(BigDecimal("38.0"), songRow[SongsTable.a])
            assertEquals(BigDecimal("55.2"), songRow[SongsTable.b])
            assertEquals(BigDecimal("0.75"), songRow[SongsTable.rate])
            assertEquals(today, songRow[SongsTable.lastDate])
        }
    }

    @Test
    fun `P2 60초 이상 생성, 뒤의 60초 미만도 합산`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)
        val songX = createTestSong(client, tokenA)
        val today = LocalDate.now(ZoneOffset.UTC)

        // 1. 60초 추가 -> 세션 생성
        val res1 = client.post("/api/v1/practice/save") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("songId", songX)
                    put("pos", 45.0)
                    put("date", today.toString())
                    put("addSeconds", 60)
                    put("addLoops", 1)
                }.toString()
            )
        }
        assertEquals(HttpStatusCode.OK, res1.status)
        val json1 = Json.parseToJsonElement(res1.bodyAsText()).jsonObject
        assertEquals(false, json1["keep"]?.jsonPrimitive?.boolean)
        val sessionId1 = json1["sessionId"]?.jsonPrimitive?.content
        assertNotNull(sessionId1)
        assertEquals(60, json1["totalSeconds"]?.jsonPrimitive?.int)
        assertEquals(1.0, json1["minutes"]?.jsonPrimitive?.double)
        assertTrue(json1["pendingSeconds"] is JsonNull)

        // 2. 30초 추가 -> 당일 세션에 합산 (90초, 1.5분)
        val res2 = client.post("/api/v1/practice/save") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("songId", songX)
                    put("pos", 45.0)
                    put("date", today.toString())
                    put("addSeconds", 30)
                    put("addLoops", 2)
                }.toString()
            )
        }
        assertEquals(HttpStatusCode.OK, res2.status)
        val json2 = Json.parseToJsonElement(res2.bodyAsText()).jsonObject
        assertEquals(false, json2["keep"]?.jsonPrimitive?.boolean)
        assertEquals(sessionId1, json2["sessionId"]?.jsonPrimitive?.content)
        assertEquals(90, json2["totalSeconds"]?.jsonPrimitive?.int)
        assertEquals(1.5, json2["minutes"]?.jsonPrimitive?.double)

        transaction(db) {
            val sessions = SessionsTable.selectAll().toList()
            assertEquals(1, sessions.size)
            assertEquals(90, sessions[0][SessionsTable.seconds])
            assertEquals(3, sessions[0][SessionsTable.loops])
        }
    }

    @Test
    fun `P3 추가 0이면 곡만 갱신`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)
        val songX = createTestSong(client, tokenA)
        val today = LocalDate.now(ZoneOffset.UTC)

        val res = client.post("/api/v1/practice/save") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("songId", songX)
                    put("pos", 12.0)
                    put("date", today.toString())
                    put("addSeconds", 0)
                    put("addLoops", 0)
                }.toString()
            )
        }
        assertEquals(HttpStatusCode.OK, res.status)
        val json = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        assertEquals(true, json["ok"]?.jsonPrimitive?.boolean)
        assertEquals(false, json["keep"]?.jsonPrimitive?.boolean)
        assertTrue(json["sessionId"] is JsonNull)
        assertTrue(json["totalSeconds"] is JsonNull)
        assertTrue(json["minutes"] is JsonNull)
        assertTrue(json["pendingSeconds"] is JsonNull)

        transaction(db) {
            assertEquals(0L, SessionsTable.selectAll().count())
            val songRow = SongsTable.selectAll().where { SongsTable.id eq UUID.fromString(songX) }.single()
            assertEquals(BigDecimal("12.0"), songRow[SongsTable.pos])
        }
    }

    @Test
    fun `P4 lastDate는 뒤로 가지 않음`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)
        val songX = createTestSong(client, tokenA)
        val today = LocalDate.now(ZoneOffset.UTC)

        // 1. today 저장
        client.post("/api/v1/practice/save") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("songId", songX)
                    put("pos", 10.0)
                    put("date", today.toString())
                    put("addSeconds", 60)
                }.toString()
            )
        }

        // 2. today - 3일 저장
        client.post("/api/v1/practice/save") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("songId", songX)
                    put("pos", 20.0)
                    put("date", today.minusDays(3).toString())
                    put("addSeconds", 60)
                }.toString()
            )
        }

        transaction(db) {
            val songRow = SongsTable.selectAll().where { SongsTable.id eq UUID.fromString(songX) }.single()
            assertEquals(today, songRow[SongsTable.lastDate], "lastDate must not move backwards")
            assertEquals(2L, SessionsTable.selectAll().where { SessionsTable.songId eq UUID.fromString(songX) }.count())
        }
    }

    @Test
    fun `P5 동시 저장 10건`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)
        val songX = createTestSong(client, tokenA)
        val today = LocalDate.now(ZoneOffset.UTC)

        val responses = coroutineScope {
            (1..10).map {
                async {
                    client.post("/api/v1/practice/save") {
                        header(HttpHeaders.Authorization, "Bearer $tokenA")
                        contentType(ContentType.Application.Json)
                        setBody(
                            buildJsonObject {
                                put("songId", songX)
                                put("pos", 45.0)
                                put("date", today.toString())
                                put("addSeconds", 60)
                                put("addLoops", 1)
                            }.toString()
                        )
                    }
                }
            }.awaitAll()
        }

        for (res in responses) {
            assertEquals(HttpStatusCode.OK, res.status)
        }

        transaction(db) {
            val sessions = SessionsTable.selectAll().where { SessionsTable.songId eq UUID.fromString(songX) }.toList()
            assertEquals(1, sessions.size)
            assertEquals(600, sessions[0][SessionsTable.seconds])
            assertEquals(10, sessions[0][SessionsTable.loops])
        }
    }

    @Test
    fun `P6 rate 생략 시 유지, a·b 생략 시 지움`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)
        val songX = createTestSong(client, tokenA)
        val today = LocalDate.now(ZoneOffset.UTC)

        // 1. rate: 0.75, a: 10.0, b: 20.0
        client.post("/api/v1/practice/save") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("songId", songX)
                    put("pos", 30.0)
                    put("a", 10.0)
                    put("b", 20.0)
                    put("rate", 0.75)
                    put("date", today.toString())
                    put("addSeconds", 60)
                }.toString()
            )
        }

        // 2. rate, a, b 생략 (a, b null 전달)
        client.post("/api/v1/practice/save") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("songId", songX)
                    put("pos", 50.0)
                    put("date", today.toString())
                    put("addSeconds", 10)
                }.toString()
            )
        }

        transaction(db) {
            val songRow = SongsTable.selectAll().where { SongsTable.id eq UUID.fromString(songX) }.single()
            assertEquals(BigDecimal("0.75"), songRow[SongsTable.rate])
            assertNull(songRow[SongsTable.a])
            assertNull(songRow[SongsTable.b])

            val sessionRow = SessionsTable.selectAll().where { SessionsTable.songId eq UUID.fromString(songX) }.single()
            assertEquals(BigDecimal("0.75"), sessionRow[SessionsTable.rate])
            assertNull(sessionRow[SessionsTable.a])
            assertNull(sessionRow[SessionsTable.b])
            assertEquals(70, sessionRow[SessionsTable.seconds])
        }
    }

    @Test
    fun `P7 잘못된 입력`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)
        val songX = createTestSong(client, tokenA)
        val today = LocalDate.now(ZoneOffset.UTC)

        val baseBody = mutableMapOf<String, Any>(
            "songId" to songX,
            "pos" to 45.0,
            "date" to today.toString(),
            "addSeconds" to 60
        )

        fun copyWith(block: MutableMap<String, Any>.() -> Unit): String {
            val map = HashMap(baseBody)
            map.block()
            return buildJsonObject {
                for ((k, v) in map) {
                    when (v) {
                        is String -> put(k, v)
                        is Int -> put(k, v)
                        is Long -> put(k, v)
                        is Double -> put(k, v)
                        is Float -> put(k, v)
                        is Number -> put(k, v.toDouble())
                        is Boolean -> put(k, v)
                    }
                }
            }.toString()
        }

        val badCases = listOf(
            // songId 없음
            buildJsonObject { put("pos", 45.0); put("date", today.toString()) }.toString() to "songId 값이 필요합니다.",
            // songId "x"
            copyWith { put("songId", "x") } to "songId 형식이 올바르지 않습니다.",
            // pos 없음
            buildJsonObject { put("songId", songX); put("date", today.toString()) }.toString() to "pos 값이 필요합니다.",
            // pos -1
            copyWith { put("pos", -1.0) } to "pos은(는) 0.0~86400.0 범위여야 합니다.",
            // pos 86401
            copyWith { put("pos", 86401.0) } to "pos은(는) 0.0~86400.0 범위여야 합니다.",
            // pos 문자열 "45"
            """{"songId":"$songX","pos":"45","date":"$today"}""" to "pos 형식이 올바르지 않습니다.",
            // a >= b
            copyWith { put("a", 50.0); put("b", 40.0) } to "a는 b보다 작아야 합니다.",
            // rate 0.1
            copyWith { put("rate", 0.1) } to "rate은(는) 0.25~2.0 범위여야 합니다.",
            // date "2026/10/30"
            copyWith { put("date", "2026/10/30") } to "date 형식이 올바르지 않습니다.",
            // date today + 2일
            copyWith { put("date", today.plusDays(2).toString()) } to "date은(는) 2000-01-01부터 내일(UTC)까지만 쓸 수 있습니다.",
            // date "1999-12-31"
            copyWith { put("date", "1999-12-31") } to "date은(는) 2000-01-01부터 내일(UTC)까지만 쓸 수 있습니다.",
            // addSeconds -1
            copyWith { put("addSeconds", -1) } to "addSeconds은(는) 0~21600 범위여야 합니다.",
            // addSeconds 21601
            copyWith { put("addSeconds", 21601) } to "addSeconds은(는) 0~21600 범위여야 합니다.",
            // addSeconds 30.5
            """{"songId":"$songX","pos":45.0,"date":"$today","addSeconds":30.5}""" to "addSeconds 형식이 올바르지 않습니다.",
            // addLoops 100001
            copyWith { put("addLoops", 100001) } to "addLoops은(는) 0~100000 범위여야 합니다."
        )

        for ((body, expectedMsg) in badCases) {
            val res = client.post("/api/v1/practice/save") {
                header(HttpHeaders.Authorization, "Bearer $tokenA")
                contentType(ContentType.Application.Json)
                setBody(body)
            }
            assertEquals(HttpStatusCode.BadRequest, res.status, "Failed for body: $body")
            val errObj = assertStandardError(res.bodyAsText(), 400, "INVALID_INPUT")
            assertEquals(expectedMsg, errObj["message"]?.jsonPrimitive?.content, "Error message mismatch for body: $body")
        }

        transaction(db) {
            val songRow = SongsTable.selectAll().where { SongsTable.id eq UUID.fromString(songX) }.single()
            assertNull(songRow[SongsTable.pos])
        }
    }

    @Test
    fun `P8 남의 곡·없는 곡`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val userB = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        val tokenB = TestJwt.token(userB)
        ensureUser(client, tokenA)
        ensureUser(client, tokenB)
        val songX = createTestSong(client, tokenA)
        val today = LocalDate.now(ZoneOffset.UTC)

        // 1. B 토큰으로 songId: X -> 404 NOT_FOUND
        val resB = client.post("/api/v1/practice/save") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("songId", songX)
                    put("pos", 45.0)
                    put("date", today.toString())
                }.toString()
            )
        }
        assertEquals(HttpStatusCode.NotFound, resB.status)
        assertStandardError(resB.bodyAsText(), 404, "NOT_FOUND")

        // 2. A 토큰으로 없는 곡 -> 404 NOT_FOUND
        val resA = client.post("/api/v1/practice/save") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("songId", UUID.randomUUID().toString())
                    put("pos", 45.0)
                    put("date", today.toString())
                }.toString()
            )
        }
        assertEquals(HttpStatusCode.NotFound, resA.status)
        assertStandardError(resA.bodyAsText(), 404, "NOT_FOUND")

        transaction(db) {
            val songRow = SongsTable.selectAll().where { SongsTable.id eq UUID.fromString(songX) }.single()
            assertNull(songRow[SongsTable.pos])
            assertEquals(0L, SessionsTable.selectAll().count())
        }
    }

    @Test
    fun `P9 outbox`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)
        val songX = createTestSong(client, tokenA)
        val today = LocalDate.now(ZoneOffset.UTC)

        transaction(db) {
            NotionSyncTable.insert {
                it[userId] = userA
                it[enabled] = true
            }
        }

        // addSeconds: 60을 2번 호출
        repeat(2) {
            val res = client.post("/api/v1/practice/save") {
                header(HttpHeaders.Authorization, "Bearer $tokenA")
                contentType(ContentType.Application.Json)
                setBody(
                    buildJsonObject {
                        put("songId", songX)
                        put("pos", 45.0)
                        put("date", today.toString())
                        put("addSeconds", 60)
                    }.toString()
                )
            }
            assertEquals(HttpStatusCode.OK, res.status)
        }

        transaction(db) {
            val outboxRows = SyncOutboxTable.selectAll().toList()
            assertEquals(2, outboxRows.size)
            val entities = outboxRows.map { it[SyncOutboxTable.entity] to it[SyncOutboxTable.op] }.toSet()
            assertEquals(setOf("song" to "upsert", "session" to "upsert"), entities)
        }
    }

    @Test
    fun `P10 토큰 없음`() = testApplication {
        configureApiTestApp(dbConfig)

        val res = client.post("/api/v1/practice/save") {
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("songId", UUID.randomUUID().toString())
                    put("pos", 45.0)
                    put("date", "2026-10-30")
                }.toString()
            )
        }
        assertEquals(HttpStatusCode.Unauthorized, res.status)
        assertStandardError(res.bodyAsText(), 401, "UNAUTHORIZED")
    }
}

