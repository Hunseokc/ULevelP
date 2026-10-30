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

        // 5. /api/scale
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

        val scaleCircleRes = client.get("/api/scale?root=C&circle=5")
        assertEquals(HttpStatusCode.OK, scaleCircleRes.status)
        assertEquals(12, Json.parseToJsonElement(scaleCircleRes.bodyAsText()).jsonArray.size)

        assertEquals(HttpStatusCode.BadRequest, client.get("/api/scale?type=nope").status)

        // 6. /api/interpret
        assertEquals(HttpStatusCode.BadRequest, client.get("/api/interpret?frets=1,2").status)
        val interpRes = client.get("/api/interpret?frets=x,x,4,2,2,4")
        assertEquals(HttpStatusCode.OK, interpRes.status)
        assertTrue(Json.parseToJsonElement(interpRes.bodyAsText()).jsonArray.size >= 4)

        // 7. Unknown /api route -> 404
        assertEquals(HttpStatusCode.NotFound, client.get("/api/not-found").status)

        // 8. Static file serving (GET /)
        val indexRes = client.get("/")
        assertEquals(HttpStatusCode.OK, indexRes.status)
        assertTrue(indexRes.bodyAsText().contains("<!doctype html>", ignoreCase = true))
    }
}

