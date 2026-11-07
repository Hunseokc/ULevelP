package ulevelp.progression

import com.zaxxer.hikari.HikariDataSource
import io.ktor.client.HttpClient
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.server.testing.*
import kotlinx.serialization.json.*
import org.jetbrains.exposed.sql.Database
import org.jetbrains.exposed.sql.batchInsert
import org.jetbrains.exposed.sql.deleteAll
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.transactions.transaction
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import ulevelp.db.*
import ulevelp.support.*
import java.util.UUID
import kotlin.test.*

class ProgressionApiTest {

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
            if (::dataSource.isInitialized) dataSource.close()
        }

        val DTO_KEYS = setOf(
            "id", "kind", "origin", "route", "evidence", "title", "part", "artist", "album", "channel",
            "releaseDate", "key", "instrument", "chords", "moods", "genres", "tags", "url", "videoId",
            "startSec", "endSec", "memo", "noteId", "createdAt", "updatedAt"
        )
    }

    @BeforeEach
    fun cleanDatabase() {
        transaction(db) {
            StorageTrashTable.deleteAll()
            UsersTable.deleteAll()
        }
    }

    private suspend fun ensureUser(client: HttpClient, token: String) {
        val res = client.get("/api/v1/me") { header(HttpHeaders.Authorization, "Bearer $token") }
        assertEquals(HttpStatusCode.OK, res.status)
    }

    private suspend fun send(client: HttpClient, token: String?, method: HttpMethod, path: String, body: String? = null): HttpResponse =
        client.request(path) {
            this.method = method
            if (token != null) header(HttpHeaders.Authorization, "Bearer $token")
            if (body != null) {
                contentType(ContentType.Application.Json)
                setBody(body)
            }
        }

    private fun obj(res: String): JsonObject = Json.parseToJsonElement(res).jsonObject

    private suspend fun createId(client: HttpClient, token: String, body: String): String {
        val res = send(client, token, HttpMethod.Post, "/api/v1/progressions", body)
        assertEquals(HttpStatusCode.Created, res.status, res.bodyAsText())
        return obj(res.bodyAsText())["progression"]!!.jsonObject["id"]!!.jsonPrimitive.content
    }

    private suspend fun list(client: HttpClient, token: String, scope: String? = null): JsonArray {
        val res = send(client, token, HttpMethod.Get, "/api/v1/progressions" + (scope?.let { "?scope=$it" } ?: ""))
        assertEquals(HttpStatusCode.OK, res.status)
        assertEquals("no-store", res.headers[HttpHeaders.CacheControl])
        return obj(res.bodyAsText())["progressions"]!!.jsonArray
    }

    private val ref = """{"kind":"reference","title":"Just the Two of Us","artist":"Grover Washington Jr.","key":"F Major",
        "chords":[{"symbol":"FM7","roman":"IM7","source":"화면","extra":1},{"symbol":" E7 ","roman":"VII7"}],
        "moods":["nostalgia"," nostalgia ","밤"],"genres":["RnB"],"releaseDate":"1981-01-01",
        "url":"https://youtu.be/dQw4w9WgXcQ?t=42","startSec":10,"endSec":40}"""

    @Test
    fun `P1 생성·목록·필드·범위·401`() = testApplication {
        configureApiTestApp(dbConfig)
        val tokenA = TestJwt.token(UUID.randomUUID())
        ensureUser(client, tokenA)

        // 401 (토큰 없음)
        val noAuth = send(client, null, HttpMethod.Get, "/api/v1/progressions")
        assertEquals(HttpStatusCode.Unauthorized, noAuth.status)
        assertStandardError(noAuth.bodyAsText(), 401, "UNAUTHORIZED")

        assertEquals(0, list(client, tokenA).size)

        val res = send(client, tokenA, HttpMethod.Post, "/api/v1/progressions", ref)
        assertEquals(HttpStatusCode.Created, res.status)
        val p = obj(res.bodyAsText())["progression"]!!.jsonObject
        assertEquals(DTO_KEYS, p.keys)
        assertEquals("reference", p["kind"]!!.jsonPrimitive.content)
        assertEquals("manual", p["origin"]!!.jsonPrimitive.content)
        assertEquals("manual", p["route"]!!.jsonPrimitive.content)
        assertTrue(p["evidence"] is JsonNull)
        assertTrue(p["instrument"] is JsonNull)
        assertTrue(p["noteId"] is JsonNull)
        assertEquals("F Major", p["key"]!!.jsonPrimitive.content)
        assertEquals("1981-01-01", p["releaseDate"]!!.jsonPrimitive.content)
        assertEquals("dQw4w9WgXcQ", p["videoId"]!!.jsonPrimitive.content)
        assertEquals(10, p["startSec"]!!.jsonPrimitive.int)
        assertEquals(40, p["endSec"]!!.jsonPrimitive.int)
        // 모르는 키·직접 행의 source는 버리고, symbol은 공백 제거
        assertEquals(
            Json.parseToJsonElement("""[{"symbol":"FM7","roman":"IM7"},{"symbol":"E7","roman":"VII7"}]"""),
            p["chords"]
        )
        assertEquals(listOf("nostalgia", "밤"), p["moods"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertEquals("", p["memo"]!!.jsonPrimitive.content)

        // 분석(직접) 행 + 유튜브 아닌 URL → videoId 없음
        createId(client, tokenA, """{"kind":"analysis","title":"직접 분석","chords":[{"symbol":"Am"}],"url":"https://example.com/watch?v=dQw4w9WgXcQ"}""")
        val all = list(client, tokenA)
        assertEquals(2, all.size)
        assertEquals("직접 분석", all[0].jsonObject["title"]!!.jsonPrimitive.content) // 최신 먼저
        assertTrue(all[0].jsonObject["videoId"] is JsonNull)
        assertEquals("", all[0].jsonObject["chords"]!!.jsonArray[0].jsonObject["roman"]!!.jsonPrimitive.content)
        assertEquals(1, list(client, tokenA, "reference").size)
        assertEquals(1, list(client, tokenA, "analysis").size)
        assertEquals(2, list(client, tokenA, "all").size)

        val badScope = send(client, tokenA, HttpMethod.Get, "/api/v1/progressions?scope=mine")
        assertEquals(HttpStatusCode.BadRequest, badScope.status)
        assertStandardError(badScope.bodyAsText(), 400, "INVALID_INPUT")

        // 다른 사용자에게는 안 보임
        val tokenB = TestJwt.token(UUID.randomUUID())
        ensureUser(client, tokenB)
        assertEquals(0, list(client, tokenB).size)
    }

    @Test
    fun `P2 생성 잘못된 입력 400`() = testApplication {
        configureApiTestApp(dbConfig)
        val tokenA = TestJwt.token(UUID.randomUUID())
        ensureUser(client, tokenA)
        val chords = """"chords":[{"symbol":"C"}]"""
        val bad = listOf(
            """{"title":"t",$chords}""",                                        // kind 없음
            """{"kind":"song","title":"t",$chords}""",                         // kind 값
            """{"kind":"reference",$chords}""",                                // title 없음
            """{"kind":"reference","title":"   ",$chords}""",                  // title 공백
            """{"kind":"reference","title":"${"가".repeat(301)}",$chords}""", // title 301자
            """{"kind":"reference","title":"t"}""",                            // chords 없음
            """{"kind":"reference","title":"t","chords":[]}""",                // chords 0개
            """{"kind":"reference","title":"t","chords":[${List(65) { """{"symbol":"C"}""" }.joinToString(",")}]}""",
            """{"kind":"reference","title":"t","chords":["C"]}""",             // 객체 아님
            """{"kind":"reference","title":"t","chords":[{"symbol":""}]}""",
            """{"kind":"reference","title":"t","chords":[{"symbol":"${"C".repeat(25)}"}]}""",
            """{"kind":"reference","title":"t","chords":[{"symbol":"C","source":"느낌"}]}""",
            """{"kind":"reference","title":"t","chords":[{"symbol":"C","timestamp":"42초"}]}""",
            """{"kind":"reference","title":"t",$chords,"key":"F major"}""",
            """{"kind":"reference","title":"t",$chords,"key":"Am"}""",
            """{"kind":"reference","title":"t",$chords,"url":"ftp://x.com/a"}""",
            """{"kind":"reference","title":"t",$chords,"url":"javascript:alert(1)"}""",
            """{"kind":"reference","title":"t",$chords,"startSec":40,"endSec":10}""",
            """{"kind":"reference","title":"t",$chords,"startSec":-1}""",
            """{"kind":"reference","title":"t",$chords,"startSec":"10"}""",
            """{"kind":"reference","title":"t",$chords,"moods":["a,b"]}""",
            """{"kind":"reference","title":"t",$chords,"moods":[""]}""",
            """{"kind":"reference","title":"t",$chords,"tags":[${(1..11).joinToString(",") { "\"t$it\"" }}]}""",
            """{"kind":"reference","title":"t",$chords,"releaseDate":"1981/01/01"}""",
            """{"kind":"reference","title":"t",$chords,"memo":"${"m".repeat(2001)}"}""",
            """{"kind":"reference","title":"t",$chords,"part":1}""",
            """[1]""",
            """not json"""
        )
        for (b in bad) {
            val res = send(client, tokenA, HttpMethod.Post, "/api/v1/progressions", b)
            assertEquals(HttpStatusCode.BadRequest, res.status, b)
            assertStandardError(res.bodyAsText(), 400, "INVALID_INPUT")
        }
        assertEquals(0, list(client, tokenA).size)

        // 경계값은 통과: 64개 코드, 라벨 10개, 300자 제목
        createId(client, tokenA, """{"kind":"reference","title":"${"가".repeat(300)}","chords":[${List(64) { """{"symbol":"C"}""" }.joinToString(",")}],"tags":[${(1..10).joinToString(",") { "\"t$it\"" }}]}""")
    }

    @Test
    fun `P3 수정 - 보낸 필드만·병합 검사·404`() = testApplication {
        configureApiTestApp(dbConfig)
        val tokenA = TestJwt.token(UUID.randomUUID())
        val tokenB = TestJwt.token(UUID.randomUUID())
        ensureUser(client, tokenA)
        ensureUser(client, tokenB)
        val id = createId(client, tokenA, ref)

        val res = send(client, tokenA, HttpMethod.Patch, "/api/v1/progressions/$id", """{"memo":" 후렴 ","key":null,"releaseDate":null,"tags":["a"]}""")
        assertEquals(HttpStatusCode.OK, res.status)
        val p = obj(res.bodyAsText())["progression"]!!.jsonObject
        assertEquals("후렴", p["memo"]!!.jsonPrimitive.content)
        assertTrue(p["key"] is JsonNull)
        assertTrue(p["releaseDate"] is JsonNull)
        assertEquals("Just the Two of Us", p["title"]!!.jsonPrimitive.content) // 안 보낸 칸은 그대로
        assertEquals(2, p["chords"]!!.jsonArray.size)
        assertEquals("dQw4w9WgXcQ", p["videoId"]!!.jsonPrimitive.content)

        // url 바꾸면 videoId 다시 계산
        val urlRes = send(client, tokenA, HttpMethod.Patch, "/api/v1/progressions/$id", """{"url":""}""")
        assertTrue(obj(urlRes.bodyAsText())["progression"]!!.jsonObject["videoId"] is JsonNull)

        // 기존 startSec=10과 합쳐 보면 endSec=5는 역전 → 400
        for (b in listOf("""{"endSec":5}""", "{}", """{"unknown":1}""", """{"title":null}""", """{"kind":null}""", """{"chords":null}""")) {
            val bad = send(client, tokenA, HttpMethod.Patch, "/api/v1/progressions/$id", b)
            assertEquals(HttpStatusCode.BadRequest, bad.status, b)
            assertStandardError(bad.bodyAsText(), 400, "INVALID_INPUT")
        }

        // 남의 행·없는 행·잘못된 경로 → 404
        for ((token, path) in listOf(tokenB to id, tokenA to UUID.randomUUID().toString(), tokenA to "not-a-uuid")) {
            val nf = send(client, token, HttpMethod.Patch, "/api/v1/progressions/$path", """{"memo":"x"}""")
            assertEquals(HttpStatusCode.NotFound, nf.status, path)
            assertStandardError(nf.bodyAsText(), 404, "NOT_FOUND")
        }

        // 직접 행은 analysis ↔ reference 전환 가능
        val toAnalysis = send(client, tokenA, HttpMethod.Patch, "/api/v1/progressions/$id", """{"kind":"analysis"}""")
        assertEquals("analysis", obj(toAnalysis.bodyAsText())["progression"]!!.jsonObject["kind"]!!.jsonPrimitive.content)
    }

    @Test
    fun `P4 삭제·404`() = testApplication {
        configureApiTestApp(dbConfig)
        val tokenA = TestJwt.token(UUID.randomUUID())
        val tokenB = TestJwt.token(UUID.randomUUID())
        ensureUser(client, tokenA)
        ensureUser(client, tokenB)
        val id = createId(client, tokenA, ref)

        val other = send(client, tokenB, HttpMethod.Delete, "/api/v1/progressions/$id")
        assertEquals(HttpStatusCode.NotFound, other.status)
        val ok = send(client, tokenA, HttpMethod.Delete, "/api/v1/progressions/$id")
        assertEquals(HttpStatusCode.OK, ok.status)
        assertEquals("""{"ok":true}""", ok.bodyAsText())
        assertEquals(0, list(client, tokenA).size)
        val again = send(client, tokenA, HttpMethod.Delete, "/api/v1/progressions/$id")
        assertEquals(HttpStatusCode.NotFound, again.status)
        assertStandardError(again.bodyAsText(), 404, "NOT_FOUND")
    }

    @Test
    fun `P5 사용자당 3000행 한도`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)
        transaction(db) {
            ProgressionsTable.batchInsert(1..3000) { i ->
                this[ProgressionsTable.userId] = userA
                this[ProgressionsTable.kind] = "reference"
                this[ProgressionsTable.origin] = "manual"
                this[ProgressionsTable.route] = "manual"
                this[ProgressionsTable.title] = "p$i"
                this[ProgressionsTable.chords] = Json.parseToJsonElement("""[{"symbol":"C"}]""")
            }
        }
        val over = send(client, tokenA, HttpMethod.Post, "/api/v1/progressions", """{"kind":"reference","title":"t","chords":[{"symbol":"C"}]}""")
        assertEquals(HttpStatusCode.BadRequest, over.status)
        val err = assertStandardError(over.bodyAsText(), 400, "INVALID_INPUT")
        assertEquals("코드 진행은 최대 3000개까지 저장할 수 있습니다.", err["message"]!!.jsonPrimitive.content)
    }

    private fun seedNote(userId: UUID): UUID {
        val noteId = UUID.randomUUID()
        val analysis = Json.parseToJsonElement(
            """{"harmony":{"progressions":[
                {"name":"기타 2-5-1","key":"C major","instrument":"기타","chords":[
                    {"symbol":"Dm7","roman":"ii m7","source":"화면","timestamp":"0:30","frets":["x"]},
                    {"symbol":"G7","roman":"V7","source":"말함","timestamp":"0:34"},
                    {"symbol":"Cmaj7","roman":"Imaj7","source":"화면","timestamp":"0:38"}]},
                {"name":"빈 진행","key":"","chords":[{"symbol":"  "}]},
                {"name":"마이너","key":"Am","instrument":"건반","chords":[
                    {"symbol":"Bø7","roman":"iiø7","source":"화면"},{"symbol":"E7","roman":"V7"}]}
            ]}}"""
        )
        transaction(db) {
            NotesTable.insert {
                it[id] = noteId
                it[NotesTable.userId] = userId
                it[videoId] = "dQw4w9WgXcQ"
                it[title] = "재즈 화성 강의"
                it[channel] = "Jazz Ch"
                it[tags] = listOf("화성")
                it[NotesTable.analysis] = analysis
            }
        }
        return noteId
    }

    @Test
    fun `P6 노트 수집 토글 - 생성·중복 없음·수정 출처·끄기·노트 삭제`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        val tokenB = TestJwt.token(UUID.randomUUID())
        ensureUser(client, tokenA)
        ensureUser(client, tokenB)
        val noteId = seedNote(userA)
        val path = "/api/v1/notes/$noteId/collect"

        // 노트 응답에 collectProgressions(기본 false)
        val before = obj(send(client, tokenA, HttpMethod.Get, "/api/v1/notes/$noteId").bodyAsText())["note"]!!.jsonObject
        assertEquals(false, before["collectProgressions"]!!.jsonPrimitive.boolean)
        val summary = obj(send(client, tokenA, HttpMethod.Get, "/api/v1/notes").bodyAsText())["notes"]!!.jsonArray[0].jsonObject
        assertEquals(false, summary["collectProgressions"]!!.jsonPrimitive.boolean)

        val on = send(client, tokenA, HttpMethod.Put, path, """{"collect":true}""")
        assertEquals(HttpStatusCode.OK, on.status, on.bodyAsText())
        assertEquals("no-store", on.headers[HttpHeaders.CacheControl])
        val onBody = obj(on.bodyAsText())
        assertEquals(setOf("noteId", "collect", "progressions"), onBody.keys)
        assertEquals(true, onBody["collect"]!!.jsonPrimitive.boolean)
        val rows = onBody["progressions"]!!.jsonArray.map { it.jsonObject }
        assertEquals(2, rows.size) // 코드가 비는 진행은 건너뜀
        val r0 = rows[0]
        assertEquals(DTO_KEYS, r0.keys)
        assertEquals("analysis", r0["kind"]!!.jsonPrimitive.content)
        assertEquals("ai", r0["origin"]!!.jsonPrimitive.content)
        assertEquals("note", r0["route"]!!.jsonPrimitive.content)
        assertEquals("말함", r0["evidence"]!!.jsonPrimitive.content)
        assertEquals("C Major", r0["key"]!!.jsonPrimitive.content)
        assertEquals("기타", r0["instrument"]!!.jsonPrimitive.content)
        assertEquals("재즈 화성 강의", r0["title"]!!.jsonPrimitive.content)
        assertEquals("기타 2-5-1", r0["part"]!!.jsonPrimitive.content)
        assertEquals("Jazz Ch", r0["channel"]!!.jsonPrimitive.content)
        assertEquals("https://www.youtube.com/watch?v=dQw4w9WgXcQ", r0["url"]!!.jsonPrimitive.content)
        assertEquals(30, r0["startSec"]!!.jsonPrimitive.int)
        assertTrue(r0["endSec"] is JsonNull)
        assertEquals(noteId.toString(), r0["noteId"]!!.jsonPrimitive.content)
        assertEquals(
            Json.parseToJsonElement(
                """[{"symbol":"Dm7","roman":"iim7","source":"화면","timestamp":"0:30"},
                    {"symbol":"G7","roman":"V7","source":"말함","timestamp":"0:34"},
                    {"symbol":"Cmaj7","roman":"IM7","source":"화면","timestamp":"0:38"}]"""
            ),
            r0["chords"]
        )
        val r1 = rows[1]
        assertEquals("A min", r1["key"]!!.jsonPrimitive.content)
        assertEquals("추정", r1["evidence"]!!.jsonPrimitive.content) // source 없는 코드 → 추정
        assertEquals("iim7b5", r1["chords"]!!.jsonArray[0].jsonObject["roman"]!!.jsonPrimitive.content)
        assertEquals(true, obj(send(client, tokenA, HttpMethod.Get, "/api/v1/notes/$noteId").bodyAsText())["note"]!!.jsonObject["collectProgressions"]!!.jsonPrimitive.boolean)

        // 다시 켜도 중복 안 생김, 지운 순번만 다시 생김
        assertEquals(2, obj(send(client, tokenA, HttpMethod.Put, path, """{"collect":true}""").bodyAsText())["progressions"]!!.jsonArray.size)
        val id1 = r1["id"]!!.jsonPrimitive.content
        assertEquals(HttpStatusCode.OK, send(client, tokenA, HttpMethod.Delete, "/api/v1/progressions/$id1").status)
        assertEquals(1, list(client, tokenA).size)
        assertEquals(2, obj(send(client, tokenA, HttpMethod.Put, path, """{"collect":true}""").bodyAsText())["progressions"]!!.jsonArray.size)

        // 노트에서 온 행은 레퍼런스로 못 바꿈
        val id0 = r0["id"]!!.jsonPrimitive.content
        val toRef = send(client, tokenA, HttpMethod.Patch, "/api/v1/progressions/$id0", """{"kind":"reference"}""")
        assertEquals(HttpStatusCode.BadRequest, toRef.status)
        assertEquals("영상에서 온 진행은 레퍼런스로 바꿀 수 없습니다.", assertStandardError(toRef.bodyAsText(), 400, "INVALID_INPUT")["message"]!!.jsonPrimitive.content)

        // 메모만 / 같은 코드를 source 없이 보내면 AI 유지(source도 유지)
        val sameChords = """[{"symbol":"Dm7","roman":"iim7","timestamp":"0:30"},{"symbol":"G7","roman":"V7","timestamp":"0:34"},{"symbol":"Cmaj7","roman":"IM7","timestamp":"0:38"}]"""
        val memoOnly = obj(send(client, tokenA, HttpMethod.Patch, "/api/v1/progressions/$id0", """{"memo":"좋음","chords":$sameChords,"key":"C Major"}""").bodyAsText())["progression"]!!.jsonObject
        assertEquals("ai", memoOnly["origin"]!!.jsonPrimitive.content)
        assertEquals("말함", memoOnly["evidence"]!!.jsonPrimitive.content)
        assertEquals("화면", memoOnly["chords"]!!.jsonArray[0].jsonObject["source"]!!.jsonPrimitive.content)

        // 키를 바꾸면 직접으로, 근거·코드 source 비움, route·noteId는 남김
        val keyChanged = obj(send(client, tokenA, HttpMethod.Patch, "/api/v1/progressions/$id0", """{"key":"G Major"}""").bodyAsText())["progression"]!!.jsonObject
        assertEquals("manual", keyChanged["origin"]!!.jsonPrimitive.content)
        assertTrue(keyChanged["evidence"] is JsonNull)
        assertEquals("note", keyChanged["route"]!!.jsonPrimitive.content)
        assertEquals(noteId.toString(), keyChanged["noteId"]!!.jsonPrimitive.content)
        assertTrue(keyChanged["chords"]!!.jsonArray.all { "source" !in it.jsonObject })

        // 코드를 바꿔도 직접으로
        val other = list(client, tokenA).map { it.jsonObject }.first { it["part"]!!.jsonPrimitive.content == "마이너" }["id"]!!.jsonPrimitive.content
        val chordChanged = obj(send(client, tokenA, HttpMethod.Patch, "/api/v1/progressions/$other", """{"chords":[{"symbol":"Bm7b5","roman":"iim7b5"},{"symbol":"E7","roman":"V7"}]}""").bodyAsText())["progression"]!!.jsonObject
        assertEquals("manual", chordChanged["origin"]!!.jsonPrimitive.content)
        assertTrue(chordChanged["evidence"] is JsonNull)

        // 잘못된 입력·남의 노트·없는 노트
        for (b in listOf("""{"collect":"true"}""", """{"collect":1}""", "{}", """{"collect":null}""")) {
            val bad = send(client, tokenA, HttpMethod.Put, path, b)
            assertEquals(HttpStatusCode.BadRequest, bad.status, b)
            assertStandardError(bad.bodyAsText(), 400, "INVALID_INPUT")
        }
        assertEquals(HttpStatusCode.NotFound, send(client, tokenB, HttpMethod.Put, path, """{"collect":true}""").status)
        assertEquals(HttpStatusCode.NotFound, send(client, tokenA, HttpMethod.Put, "/api/v1/notes/${UUID.randomUUID()}/collect", """{"collect":true}""").status)
        assertEquals(HttpStatusCode.Unauthorized, send(client, null, HttpMethod.Put, path, """{"collect":true}""").status)

        // 끄면 그 노트에서 온 행 전부 삭제(고친 행 포함), 직접 행은 남음
        createId(client, tokenA, ref)
        val off = obj(send(client, tokenA, HttpMethod.Put, path, """{"collect":false}""").bodyAsText())
        assertEquals(false, off["collect"]!!.jsonPrimitive.boolean)
        assertEquals(0, off["progressions"]!!.jsonArray.size)
        assertEquals(1, list(client, tokenA).size)
        assertEquals(false, obj(send(client, tokenA, HttpMethod.Get, "/api/v1/notes/$noteId").bodyAsText())["note"]!!.jsonObject["collectProgressions"]!!.jsonPrimitive.boolean)

        // 다시 켜고 노트를 지우면 진행은 남고 noteId만 비워짐
        send(client, tokenA, HttpMethod.Put, path, """{"collect":true}""")
        assertEquals(HttpStatusCode.OK, send(client, tokenA, HttpMethod.Delete, "/api/v1/notes/$noteId").status)
        val after = list(client, tokenA).map { it.jsonObject }
        assertEquals(3, after.size)
        assertTrue(after.filter { it["route"]!!.jsonPrimitive.content == "note" }.all { it["noteId"] is JsonNull })
    }

    @Test
    fun `P7 화성 진행이 없는 노트 - 토글 값만 저장`() = testApplication {
        configureApiTestApp(dbConfig)
        val userA = UUID.randomUUID()
        val tokenA = TestJwt.token(userA)
        ensureUser(client, tokenA)
        val noteId = UUID.randomUUID()
        transaction(db) {
            NotesTable.insert {
                it[id] = noteId
                it[NotesTable.userId] = userA
                it[videoId] = "dQw4w9WgXcQ"
                it[title] = "리듬 노트"
                it[tags] = listOf("리듬")
                it[analysis] = buildJsonObject {}
            }
        }
        val on = obj(send(client, tokenA, HttpMethod.Put, "/api/v1/notes/$noteId/collect", """{"collect":true}""").bodyAsText())
        assertEquals(true, on["collect"]!!.jsonPrimitive.boolean)
        assertEquals(0, on["progressions"]!!.jsonArray.size)
        assertEquals(true, obj(send(client, tokenA, HttpMethod.Get, "/api/v1/notes/$noteId").bodyAsText())["note"]!!.jsonObject["collectProgressions"]!!.jsonPrimitive.boolean)
    }
}
