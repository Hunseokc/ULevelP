package ulevelp

import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.server.testing.*
import kotlinx.serialization.json.*
import ulevelp.chord.ChordTheory as CT
import ulevelp.chord.VoicingEngine as GE
import kotlin.test.*

class ChordEngineTest {
    @Test
    fun `Cmaj7 Drop 2 기본형은 1-2-3-4번줄에서 x x 10 12 12 12`() {
        val st = CT.dropStructure("d2").getValue(0)
        val p = CT.placeOn(st, listOf(2, 3, 4, 5), 0, "maj7").first { it.ok }
        assertEquals(listOf(10, 12, 12, 12), p.frets)
    }

    @Test
    fun `같은 자리에서 maj7 에서 7 은 7도 줄만 1프렛 내려간다`() {
        val st = CT.dropStructure("d2").getValue(0)
        val m = CT.mutation("maj7", "7", st, listOf(2, 3, 4, 5))
        assertEquals(1, m.size)
        assertEquals(-1, m[0].delta)
        assertEquals("b7", m[0].to)
    }

    @Test
    fun `2-note-per-string 은 줄마다 정확히 두 음`() {
        val ns = CT.arpeggio2nps(0, 0, 3)
        assertEquals(12, ns.size)
        for (s in 0 until 6) {
            assertEquals(2, ns.count { it.s == s })
        }
        for (i in 1 until ns.size) {
            assertTrue(ns[i].pitch > ns[i - 1].pitch)
        }
    }

    @Test
    fun `F# A C# G# 배열은 Dmaj7(#11), Ebm7(b5), Ab7sus4(b9) 로 해석된다`() {
        val notes = listOf(2 to 4, 3 to 2, 4 to 2, 5 to 4).map { (s, f) ->
            CT.NoteInput(s, f, CT.OPEN[s] + f)
        }
        val names = CT.interpret(notes).map { it.name }
        assertTrue(names.contains("Dmaj7(#11)"))
        assertTrue(names.any { it.startsWith("Ebm7(b5") })
        assertTrue(names.contains("Ab7sus4(b9)"))
    }

    @Test
    fun `5도권 F9 탑 G 는 Bb13, Eb7(3도) 로 이어지고 Ab 칸은 불가`() {
        val st = CT.circleSteps(5, 2)
        assertEquals(listOf("9", "13", "3"), st.take(3).map { it.deg })
        assertNull(st[3].q)
    }

    @Test
    fun `도미넌트 텐션 코드는 그 텐션이 실제로 들어간 폼만 나온다`() {
        val vs = GE.genVoicings(0, "7b9", GE.VoicingOpts(lo = 1, hi = 12))
        assertTrue(vs.isNotEmpty())
        assertTrue(vs.all { v -> v.notes.any { it.deg == "b9" } })
    }

    @Test
    fun `스케일 음이름 도수마다 글자를 하나씩 쓴다`() {
        fun names(r: Int, s: String) = CT.scaleInfo(r, s).notes.joinToString(" ") { it.name }
        assertEquals("C D E G A", names(0, "pentMaj"))
        assertEquals("D E F G A Bb C#", names(2, "harmMinor"))
        assertEquals("Gb Ab Bb Cb Db Eb F", names(6, "major"))
        assertEquals("B C# D# E# F# G# A#", names(11, "lydian"))
    }

    @Test
    fun `5도권 순환 메이저 스케일은 키마다 한 음만 바뀐다`() {
        val ks = CT.scaleCircle(0, "major", 1)
        assertEquals(listOf("C", "G", "D", "A"), ks.take(4).map { it.rootName })
        assertEquals(listOf("F"), ks[1].removed)
        assertEquals(listOf("F#"), ks[1].added)
        ks.forEach { assertEquals(1, it.added.size) }
        assertEquals(listOf("C", "F", "Bb"), CT.scaleCircle(0, "major", -1).take(3).map { it.rootName })
    }

    @Test
    fun `지판 위 스케일 6현 0~12프렛 C 메이저 펜타는 줄마다 5~6개`() {
        val ns = CT.scaleOnBoard(0, "pentMaj", CT.TUNING_BY.getValue("g6").open, 0, 12)
        for (s in 0 until 6) {
            val c = ns.count { it.s == s }
            assertTrue(c in 5..6)
        }
        assertTrue(ns.filter { it.isRoot }.all { CT.pc(it.pitch) == 0 })
    }

    @Test
    fun `CAGED 5블럭 C Major 1번 A Shape 시퀀스 및 관계장조 기준 줄당 최대 3음 검증`() {
        val b6 = CT.TUNING_BY.getValue("b6")
        assertEquals(listOf(23, 28, 33, 38, 43, 48), b6.open)
        assertEquals(20, b6.frets)

        val blocks = CT.scaleBlocks(0, "major", CT.TUNING_BY.getValue("g6").open, 22)
        assertEquals(5, blocks.size)
        val b1 = blocks[0]
        assertEquals(1, b1.blockId)
        assertEquals("A", b1.shape)
        assertEquals(2, b1.lo)
        assertEquals(6, b1.hi)
        assertEquals(16, b1.notes.size)

        val lowestRoot = b1.notes.first { it.isLowestRoot }
        assertEquals(1, lowestRoot.s)
        assertEquals(3, lowestRoot.f)
        assertEquals(48, lowestRoot.pitch)
        assertEquals("C", lowestRoot.name)

        val seq = CT.scaleBlockSeq(b1.notes)
        assertEquals(31, seq.size)
        assertEquals(Triple(1, 3, "C"), Triple(seq[0].s, seq[0].f, seq[0].name))
        assertEquals(Triple(5, 5, "A"), Triple(seq[12].s, seq[12].f, seq[12].name))
        assertEquals(Triple(0, 3, "G"), Triple(seq[27].s, seq[27].f, seq[27].name))
        assertEquals(Triple(1, 3, "C"), Triple(seq[30].s, seq[30].f, seq[30].name))

        // 12종 스케일(harmMinor, melMinor 제외) × 12키 × 5종 튜닝 × 5블럭 전수: 모든 줄 2~3음(최대 3음)
        val cagedScales = CT.SCALES.filter { it.id != "harmMinor" && it.id != "melMinor" }
        assertEquals(12, cagedScales.size)
        for (sc in cagedScales) {
            for (rootPc in 0 until 12) {
                for (tuning in CT.TUNINGS) {
                    val blks = CT.scaleBlocks(rootPc, sc.id, tuning.open, tuning.frets)
                    assertEquals(5, blks.size)
                    for (blk in blks) {
                        for (s in tuning.open.indices) {
                            val count = blk.notes.count { it.s == s }
                            assertTrue(
                                count in 2..3,
                                "${sc.id} root=$rootPc tuning=${tuning.id} block=#${blk.blockId} s=$s count=$count"
                            )
                        }
                        for (i in 1 until blk.notes.size) {
                            assertTrue(blk.notes[i].pitch > blk.notes[i - 1].pitch)
                        }
                    }
                }
            }
        }

        // A 마이너 펜타토닉 #3 (E Shape): 7~10프렛, 12음
        val aPentMin3 = CT.scaleBlocks(9, "pentMin", CT.TUNING_BY.getValue("g6").open, 22)[2]
        assertEquals(7, aPentMin3.lo)
        assertEquals(10, aPentMin3.hi)
        assertEquals(12, aPentMin3.notes.size)

        // A 블루스 #2 (G Shape): 5번줄 5f(4)·6f(b5)·7f(5)
        val aBlues2 = CT.scaleBlocks(9, "blues", CT.TUNING_BY.getValue("g6").open, 22)[1]
        val str5 = aBlues2.notes.filter { it.s == 1 }.map { it.f to it.deg }
        assertEquals(listOf(5 to "4", 6 to "b5", 7 to "5"), str5)
    }

    @Test
    fun `더블 스탑 3도 6도 4도 계산 검증`() {
        val thirds = CT.doubleStops(CT.DoubleStopOpts(rootPc = 0, scaleId = "major", interval = "3rd", pair = listOf(3, 4)))
        assertTrue(thirds.size >= 10)
        val cE = thirds.first { it.notes[0].f == 5 && it.notes[1].f == 5 }
        assertEquals("C+E", cE.label)
        assertTrue(cE.isRootPair)

        val sixths = CT.doubleStops(CT.DoubleStopOpts(rootPc = 0, scaleId = "major", interval = "6th", pair = listOf(2, 4)))
        assertTrue(sixths.size >= 10)
        assertTrue(sixths.all { it.span <= 3 })

        val fourths = CT.doubleStops(CT.DoubleStopOpts(rootPc = 0, scaleId = "pentMin", interval = "4th", pair = listOf(3, 4)))
        assertTrue(fourths.size >= 5)
    }

    @Test
    fun `Ktor API 엔드포인트 및 정적 파일 서빙 검증`() = testApplication {
        application {
            module(dbConfig = null, authConfig = null)
        }

        // 1. /api/health
        val healthRes = client.get("/api/health")
        assertEquals(HttpStatusCode.OK, healthRes.status)
        assertEquals("nosniff", healthRes.headers["X-Content-Type-Options"])
        val healthJson = Json.parseToJsonElement(healthRes.bodyAsText()).jsonObject
        assertEquals(true, healthJson["ok"]?.jsonPrimitive?.boolean)

        // 2. /api/voicings
        val voicingsRes = client.get("/api/voicings?root=G&quality=13")
        assertEquals(HttpStatusCode.OK, voicingsRes.status)
        val voicingsJson = Json.parseToJsonElement(voicingsRes.bodyAsText()).jsonObject
        assertEquals("G13", voicingsJson["chord"]?.jsonPrimitive?.content)

        // 3. /api/matrix & /api/circle
        val matrixRes = client.get("/api/matrix?root=C&drop=d2&inv=0")
        assertEquals(HttpStatusCode.OK, matrixRes.status)
        val matrixJson = Json.parseToJsonElement(matrixRes.bodyAsText()).jsonArray
        assertEquals(9, matrixJson[0].jsonObject["qualities"]?.jsonArray?.size)

        val circleRes = client.get("/api/circle?root=F&top=2")
        assertEquals(HttpStatusCode.OK, circleRes.status)
        val circleJson = Json.parseToJsonElement(circleRes.bodyAsText()).jsonArray
        assertEquals(12, circleJson.size)

        // 4. /api/two-five-one & /api/top-note
        val tfoRes = client.get("/api/two-five-one?key=C&lo=5&hi=8&pent=A&pentType=min&outside=2")
        assertEquals(HttpStatusCode.OK, tfoRes.status)
        val tfoJson = Json.parseToJsonElement(tfoRes.bodyAsText()).jsonArray
        assertEquals(1, tfoJson.size)
        assertEquals("C", tfoJson[0].jsonObject["key"]?.jsonPrimitive?.content)

        val topRes = client.get("/api/top-note?string=1&fret=8&span=3&notes=4")
        assertEquals(HttpStatusCode.OK, topRes.status)
        val topJson = Json.parseToJsonElement(topRes.bodyAsText()).jsonObject
        assertEquals("C", topJson["top"]?.jsonPrimitive?.content)

        // 5. /api/scale (기본, 5도권, CAGED block, 화성·가락단음계 block=400 차단)
        val scaleRes = client.get("/api/scale?root=A&type=pentMin&tuning=b4&lo=5&hi=8")
        assertEquals(HttpStatusCode.OK, scaleRes.status)
        val scaleJson = Json.parseToJsonElement(scaleRes.bodyAsText()).jsonObject
        assertEquals("A Pentatonic Minor", scaleJson["name"]?.jsonPrimitive?.content)
        val positions = scaleJson["positions"]!!.jsonArray
        assertTrue(positions.all {
            val obj = it.jsonObject
            val fret = obj["fret"]!!.jsonPrimitive.int
            val str = obj["string"]!!.jsonPrimitive.int
            fret in 5..8 && str in 1..4
        })

        val scaleBlockRes = client.get("/api/scale?root=C&type=major&tuning=g6&block=1")
        assertEquals(HttpStatusCode.OK, scaleBlockRes.status)
        val scaleBlockJson = Json.parseToJsonElement(scaleBlockRes.bodyAsText()).jsonObject
        assertEquals("A", scaleBlockJson["block"]?.jsonObject?.get("shape")?.jsonPrimitive?.content)
        assertEquals(16, scaleBlockJson["positions"]?.jsonArray?.size)
        assertEquals(31, scaleBlockJson["sequence"]?.jsonArray?.size)

        assertEquals(HttpStatusCode.OK, client.get("/api/scale?root=A&type=harmMinor").status)
        assertEquals(HttpStatusCode.BadRequest, client.get("/api/scale?root=C&type=harmMinor&block=1").status)
        assertEquals(HttpStatusCode.BadRequest, client.get("/api/scale?root=A&type=melMinor&block=2").status)
        assertEquals(HttpStatusCode.BadRequest, client.get("/api/scale?root=C&type=major&block=6").status)

        val scaleCircleRes = client.get("/api/scale?root=C&circle=5")
        assertEquals(HttpStatusCode.OK, scaleCircleRes.status)
        assertEquals(12, Json.parseToJsonElement(scaleCircleRes.bodyAsText()).jsonArray.size)

        val badScaleRes = client.get("/api/scale?type=nope")
        assertEquals(HttpStatusCode.BadRequest, badScaleRes.status)
        assertTrue(Json.parseToJsonElement(badScaleRes.bodyAsText()).jsonObject["error"]?.jsonPrimitive?.content?.isNotBlank() == true)

        // 5-2. /api/double-stops
        val dsRes = client.get("/api/double-stops?root=C&type=major&interval=3rd&pair=2-3")
        assertEquals(HttpStatusCode.OK, dsRes.status)
        val dsJson = Json.parseToJsonElement(dsRes.bodyAsText()).jsonObject
        assertEquals("C Major (Ionian)", dsJson["name"]?.jsonPrimitive?.content)
        assertEquals("2-3", dsJson["strings"]?.jsonPrimitive?.content)
        assertTrue((dsJson["count"]?.jsonPrimitive?.int ?: 0) >= 10)
        assertEquals(HttpStatusCode.BadRequest, client.get("/api/double-stops?interval=2nd").status)

        // 6. /api/interpret
        assertEquals(HttpStatusCode.BadRequest, client.get("/api/interpret?frets=1,2").status)
        val interpRes = client.get("/api/interpret?frets=x,x,4,2,2,4")
        assertEquals(HttpStatusCode.OK, interpRes.status)
        assertTrue(Json.parseToJsonElement(interpRes.bodyAsText()).jsonArray.size >= 4)

        // 7. Unknown /api route -> 404
        val notFoundRes = client.get("/api/not-found")
        assertEquals(HttpStatusCode.NotFound, notFoundRes.status)
        val notFoundJson = Json.parseToJsonElement(notFoundRes.bodyAsText()).jsonObject
        assertEquals("없는 API입니다", notFoundJson["error"]?.jsonPrimitive?.content)
        assertEquals(9, notFoundJson["apis"]?.jsonArray?.size)

        // 8. Static file serving (GET /)
        val indexRes = client.get("/")
        assertEquals(HttpStatusCode.OK, indexRes.status)
        assertTrue(indexRes.bodyAsText().contains("<!doctype html>", ignoreCase = true))
    }

    @Test
    fun `Z1 API 응답 X-Frame-Options DENY 헤더 검증`() = testApplication {
        application {
            module(dbConfig = null, authConfig = null)
        }
        val res = client.get("/api/health")
        assertEquals(HttpStatusCode.OK, res.status)
        assertEquals("DENY", res.headers["X-Frame-Options"])
        assertNull(res.headers["Content-Security-Policy"])
    }

    @Test
    fun `Z2 정적 HTML 서빙 시 Clickjacking 방지 헤더 검증`() = testApplication {
        application {
            module(dbConfig = null, authConfig = null)
        }
        for (path in listOf("/", "/index.html")) {
            val res = client.get(path)
            assertEquals(HttpStatusCode.OK, res.status)
            assertEquals("frame-ancestors 'none'", res.headers["Content-Security-Policy"])
            assertEquals("DENY", res.headers["X-Frame-Options"])
            assertEquals("no-cache", res.headers["Cache-Control"])
        }
    }

    @Test
    fun `Z3 정적 HTML HEAD 응답 Content-Length 단일 헤더 검증`() = testApplication {
        application {
            module(dbConfig = null, authConfig = null)
        }
        val getRes = client.get("/")
        val headRes = client.head("/")
        assertEquals(HttpStatusCode.OK, headRes.status)
        assertEquals(listOf(getRes.bodyAsBytes().size.toString()), headRes.headers.getAll(HttpHeaders.ContentLength))
        assertEquals("frame-ancestors 'none'", headRes.headers["Content-Security-Policy"])
        assertTrue(headRes.bodyAsBytes().isEmpty())
    }

    private fun spaPublicDir(withSpa: Boolean): java.io.File {
        val dir = kotlin.io.path.createTempDirectory("ulp-public").toFile()
        java.io.File(dir, "index.html").writeText("LEGACY-INDEX")
        java.io.File(dir, "practice.html").writeText("LEGACY-PRACTICE")
        java.io.File(dir, "lib").mkdirs()
        java.io.File(dir, "lib/theory.js").writeText("// theory")
        if (withSpa) java.io.File(dir, "spa.html").writeText("<div id=\"root\"></div>")
        return dir
    }

    @Test
    fun `Z4 spa_html이 있으면 HTML 진입 경로에 spa_html을 서빙한다`() = testApplication {
        application { module(publicDir = spaPublicDir(true), dbConfig = null, authConfig = null, uiMode = "") }
        for (path in listOf("/", "/index.html", "/practice.html", "/notes.html", "/note.html?id=x")) {
            val res = client.get(path)
            assertEquals(HttpStatusCode.OK, res.status, path)
            assertTrue(res.bodyAsText().contains("id=\"root\""), path)
            assertEquals("frame-ancestors 'none'", res.headers["Content-Security-Policy"], path)
            assertEquals("no-cache", res.headers["Cache-Control"], path)
        }
        val head = client.head("/practice.html")
        assertEquals(listOf("<div id=\"root\"></div>".length.toString()), head.headers.getAll(HttpHeaders.ContentLength))
        assertEquals("// theory", client.get("/lib/theory.js").bodyAsText())
        assertEquals(HttpStatusCode.NotFound, client.get("/unknown.html").status)
    }

    @Test
    fun `Z5 ULP_UI=legacy면 spa_html이 있어도 레거시 HTML을 서빙한다`() = testApplication {
        application { module(publicDir = spaPublicDir(true), dbConfig = null, authConfig = null, uiMode = "legacy") }
        assertEquals("LEGACY-INDEX", client.get("/").bodyAsText())
        assertEquals("LEGACY-PRACTICE", client.get("/practice.html").bodyAsText())
    }

    @Test
    fun `Z6 spa_html이 없으면 레거시 HTML을 서빙한다`() = testApplication {
        application { module(publicDir = spaPublicDir(false), dbConfig = null, authConfig = null, uiMode = "") }
        assertEquals("LEGACY-INDEX", client.get("/").bodyAsText())
        assertEquals(HttpStatusCode.NotFound, client.get("/notes.html").status)
    }
}
