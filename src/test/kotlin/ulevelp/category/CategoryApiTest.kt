package ulevelp.category

import com.zaxxer.hikari.HikariDataSource
import io.ktor.client.HttpClient
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.server.testing.*
import kotlinx.serialization.json.*
import org.jetbrains.exposed.sql.Database
import org.jetbrains.exposed.sql.deleteAll
import org.jetbrains.exposed.sql.transactions.transaction
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import ulevelp.db.*
import ulevelp.support.*
import java.util.UUID
import kotlin.test.*

class CategoryApiTest {

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

    private suspend fun ensureUser(client: HttpClient, token: String) {
        val res = client.get("/api/v1/me") {
            header(HttpHeaders.Authorization, "Bearer $token")
        }
        assertEquals(HttpStatusCode.OK, res.status)
    }

    private suspend fun create(client: HttpClient, token: String, body: String): HttpResponse =
        client.post("/api/v1/categories") {
            header(HttpHeaders.Authorization, "Bearer $token")
            contentType(ContentType.Application.Json)
            setBody(body)
        }

    private suspend fun createId(client: HttpClient, token: String, name: String): String {
        val res = create(client, token, """{"name":"$name"}""")
        assertEquals(HttpStatusCode.Created, res.status, "create $name")
        return Json.parseToJsonElement(res.bodyAsText()).jsonObject["category"]!!.jsonObject["id"]!!.jsonPrimitive.content
    }

    private suspend fun list(client: HttpClient, token: String): JsonArray {
        val res = client.get("/api/v1/categories") {
            header(HttpHeaders.Authorization, "Bearer $token")
        }
        assertEquals(HttpStatusCode.OK, res.status)
        assertEquals("no-store", res.headers[HttpHeaders.CacheControl])
        return Json.parseToJsonElement(res.bodyAsText()).jsonObject["categories"]!!.jsonArray
    }

    @Test
    fun `C1 생성·목록·필드`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)

        // 빈 상태로 시작
        assertEquals(0, list(client, tokenA).size)

        val res = create(client, tokenA, """{"name":"  Jazz  "}""")
        assertEquals(HttpStatusCode.Created, res.status)
        val cat = Json.parseToJsonElement(res.bodyAsText()).jsonObject["category"]!!.jsonObject
        assertEquals(setOf("id", "name", "sortOrder", "onHome", "songCount"), cat.keys)
        assertEquals("Jazz", cat["name"]!!.jsonPrimitive.content)
        assertEquals(0, cat["sortOrder"]!!.jsonPrimitive.int)
        assertEquals(true, cat["onHome"]!!.jsonPrimitive.boolean)
        assertEquals(0, cat["songCount"]!!.jsonPrimitive.int)

        createId(client, tokenA, "연습곡")
        val names = list(client, tokenA).map { it.jsonObject["name"]!!.jsonPrimitive.content }
        assertEquals(listOf("Jazz", "연습곡"), names)
        assertEquals(1, list(client, tokenA)[1].jsonObject["sortOrder"]!!.jsonPrimitive.int)
    }

    @Test
    fun `C2 생성 잘못된 입력·중복·한도`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        val userB = UUID.randomUUID()
        val tokenB = TestJwt.token(userB)
        ensureUser(client, tokenA)
        ensureUser(client, tokenB)

        createId(client, tokenA, "Jazz")

        // 대소문자만 다른 이름 -> 409
        val dup = create(client, tokenA, """{"name":"jazz"}""")
        assertEquals(HttpStatusCode.Conflict, dup.status)
        assertStandardError(dup.bodyAsText(), 409, "CONFLICT")

        // 다른 사용자는 같은 이름 가능
        createId(client, tokenB, "Jazz")

        // 빈 이름·공백·21자·없음·숫자 -> 400
        for (bad in listOf("""{"name":""}""", """{"name":"   "}""", """{"name":"${"가".repeat(21)}"}""", "{}", """{"name":1}""")) {
            val res = create(client, tokenA, bad)
            assertEquals(HttpStatusCode.BadRequest, res.status, bad)
            assertStandardError(res.bodyAsText(), 400, "INVALID_INPUT")
        }
        // 20자는 허용
        createId(client, tokenA, "가".repeat(20))

        // 50개까지, 51번째 400
        for (i in 3..50) createId(client, tokenA, "c$i")
        assertEquals(50, list(client, tokenA).size)
        val over = create(client, tokenA, """{"name":"c51"}""")
        assertEquals(HttpStatusCode.BadRequest, over.status)
        assertStandardError(over.bodyAsText(), 400, "INVALID_INPUT")
    }

    @Test
    fun `C3 PATCH 이름·홈 표시, 남의 분류 404`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        val userB = UUID.randomUUID()
        val tokenB = TestJwt.token(userB)
        ensureUser(client, tokenA)
        ensureUser(client, tokenB)

        val jazz = createId(client, tokenA, "Jazz")
        createId(client, tokenA, "Pop")

        suspend fun patch(token: String, id: String, body: String) = client.patch("/api/v1/categories/$id") {
            header(HttpHeaders.Authorization, "Bearer $token")
            contentType(ContentType.Application.Json)
            setBody(body)
        }

        val p1 = patch(tokenA, jazz, """{"name":"재즈","onHome":false}""")
        assertEquals(HttpStatusCode.OK, p1.status)
        val c1 = Json.parseToJsonElement(p1.bodyAsText()).jsonObject["category"]!!.jsonObject
        assertEquals("재즈", c1["name"]!!.jsonPrimitive.content)
        assertEquals(false, c1["onHome"]!!.jsonPrimitive.boolean)

        // 자기 이름 대소문자만 바꾸기는 허용, 다른 분류 이름은 409
        assertEquals(HttpStatusCode.OK, patch(tokenA, jazz, """{"name":"재즈"}""").status)
        val dup = patch(tokenA, jazz, """{"name":"POP"}""")
        assertEquals(HttpStatusCode.Conflict, dup.status)
        assertStandardError(dup.bodyAsText(), 409, "CONFLICT")

        // 빈 본문·빈 이름·onHome 문자열 -> 400
        for (bad in listOf("{}", """{"name":""}""", """{"onHome":"no"}""")) {
            val res = patch(tokenA, jazz, bad)
            assertEquals(HttpStatusCode.BadRequest, res.status, bad)
            assertStandardError(res.bodyAsText(), 400, "INVALID_INPUT")
        }

        // 남의 분류·없는 id·비 UUID -> 404
        for (id in listOf(jazz, UUID.randomUUID().toString())) {
            val res = patch(tokenB, id, """{"onHome":true}""")
            assertEquals(HttpStatusCode.NotFound, res.status)
            assertStandardError(res.bodyAsText(), 404, "NOT_FOUND")
        }
        val badPath = patch(tokenA, "not-a-uuid", """{"onHome":true}""")
        assertEquals(HttpStatusCode.NotFound, badPath.status)
    }

    @Test
    fun `C4 순서 변경`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        val userB = UUID.randomUUID()
        val tokenB = TestJwt.token(userB)
        ensureUser(client, tokenA)
        ensureUser(client, tokenB)

        val a = createId(client, tokenA, "A")
        val b = createId(client, tokenA, "B")
        val c = createId(client, tokenA, "C")
        val other = createId(client, tokenB, "X")

        suspend fun reorder(body: String) = client.put("/api/v1/categories/order") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody(body)
        }

        val ok = reorder("""{"ids":["$c","$a","$b"]}""")
        assertEquals(HttpStatusCode.OK, ok.status)
        val ids = Json.parseToJsonElement(ok.bodyAsText()).jsonObject["categories"]!!.jsonArray
            .map { it.jsonObject["id"]!!.jsonPrimitive.content }
        assertEquals(listOf(c, a, b), ids)
        assertEquals(listOf(c, a, b), list(client, tokenA).map { it.jsonObject["id"]!!.jsonPrimitive.content })

        // 누락·중복·남의 id·형식 오류 -> 400, 순서 유지
        for (bad in listOf(
            """{"ids":["$c","$a"]}""",
            """{"ids":["$c","$a","$a"]}""",
            """{"ids":["$c","$a","$other"]}""",
            """{"ids":["x","y","z"]}""",
            "{}"
        )) {
            val res = reorder(bad)
            assertEquals(HttpStatusCode.BadRequest, res.status, bad)
            assertStandardError(res.bodyAsText(), 400, "INVALID_INPUT")
        }
        assertEquals(listOf(c, a, b), list(client, tokenA).map { it.jsonObject["id"]!!.jsonPrimitive.content })
    }

    @Test
    fun `C5 삭제하면 곡 연결만 빠지고 곡은 남는다`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        val userB = UUID.randomUUID()
        val tokenB = TestJwt.token(userB)
        ensureUser(client, tokenA)
        ensureUser(client, tokenB)

        val jazz = createId(client, tokenA, "Jazz")
        val pop = createId(client, tokenA, "Pop")
        val songRes = client.post("/api/v1/songs") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("""{"videoId":"dQw4w9WgXcQ","title":"Song"}""")
        }
        val songId = Json.parseToJsonElement(songRes.bodyAsText()).jsonObject["song"]!!.jsonObject["id"]!!.jsonPrimitive.content
        client.patch("/api/v1/songs/$songId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("""{"categoryIds":["$jazz","$pop"]}""")
        }
        assertEquals(1, list(client, tokenA)[0].jsonObject["songCount"]!!.jsonPrimitive.int)

        // 남의 분류 삭제 -> 404
        val delB = client.delete("/api/v1/categories/$jazz") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
        }
        assertEquals(HttpStatusCode.NotFound, delB.status)
        assertStandardError(delB.bodyAsText(), 404, "NOT_FOUND")

        val del = client.delete("/api/v1/categories/$jazz") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, del.status)
        assertEquals(true, Json.parseToJsonElement(del.bodyAsText()).jsonObject["ok"]!!.jsonPrimitive.boolean)

        val detail = client.get("/api/v1/songs/$songId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, detail.status)
        val cats = Json.parseToJsonElement(detail.bodyAsText()).jsonObject["song"]!!.jsonObject["categoryIds"]!!.jsonArray
        assertEquals(listOf(pop), cats.map { it.jsonPrimitive.content })

        // 다시 지우면 404
        val again = client.delete("/api/v1/categories/$jazz") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.NotFound, again.status)
    }

    @Test
    fun `C6 토큰 없음 401`() = testApplication {
        configureApiTestApp(dbConfig)
        val res = client.get("/api/v1/categories")
        assertEquals(HttpStatusCode.Unauthorized, res.status)
        assertStandardError(res.bodyAsText(), 401, "UNAUTHORIZED")
    }
}
