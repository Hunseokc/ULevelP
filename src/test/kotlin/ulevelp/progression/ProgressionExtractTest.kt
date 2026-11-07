package ulevelp.progression

import kotlinx.serialization.json.*
import ulevelp.note.ProgressionExtract
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ProgressionExtractTest {

    @Test
    fun `E1 키 정규화 - 형식·템플릿 철자·실패`() {
        val cases = mapOf(
            "F major" to "F Major", "F Major" to "F Major", "F" to "F Major", "Fmaj" to "F Major", "f major" to "F Major",
            "Am" to "A min", "A minor" to "A min", "A min" to "A min", "a minor" to "A min", "A-" to "A min",
            "Bb" to "Bb Major", "B♭ Major" to "Bb Major", "A# Major" to "Bb Major", "C# Major" to "Db Major",
            "Db min" to "C# min", "G#m" to "G# min", "Abm" to "G# min", "F#m" to "F# min", "Gb Major" to "F# Major"
        )
        for ((raw, want) in cases) assertEquals(want, ProgressionExtract.normalizeKey(raw), raw)
        for (bad in listOf(null, "", "H", "C dorian", "Cmaj7", "minor", "C# Lydian")) {
            assertNull(ProgressionExtract.normalizeKey(bad), bad)
        }
    }

    @Test
    fun `E2 로마숫자 정규화`() {
        val cases = mapOf(
            "Imaj7" to "IM7", "IVmaj9" to "IVM9", "IΔ" to "IM7", "IΔ7" to "IM7", "iiø7" to "iim7b5", "viiø" to "viim7b5",
            "vii°7" to "viidim7", "vii°" to "viidim", "ii m7" to "iim7", "V7/ii" to "V7/ii", "V7(b9)" to "V7(b9)", "" to ""
        )
        for ((raw, want) in cases) assertEquals(want, ProgressionExtract.normalizeRoman(raw), raw)
        assertEquals(24, ProgressionExtract.normalizeRoman("I".repeat(40)).length)
    }

    @Test
    fun `E3 타임스탬프·근거`() {
        assertEquals(42, ProgressionExtract.parseTimestamp("0:42"))
        assertEquals(125, ProgressionExtract.parseTimestamp("02:05"))
        assertEquals(3723, ProgressionExtract.parseTimestamp("1:02:03"))
        for (bad in listOf(null, "", "42", "0:60", "1:60:00", "a:bc", "25:00:00")) {
            assertNull(ProgressionExtract.parseTimestamp(bad), bad)
        }
        assertEquals("화면", ProgressionExtract.evidenceOf(listOf("화면", "화면")))
        assertEquals("말함", ProgressionExtract.evidenceOf(listOf("화면", "말함")))
        assertEquals("추정", ProgressionExtract.evidenceOf(listOf("말함", "추정", "화면")))
        assertEquals("추정", ProgressionExtract.evidenceOf(emptyList()))
    }

    @Test
    fun `E4 분석 결과 → 행 - 곡·구간·코드 정리·순번 유지`() {
        val analysis = Json.parseToJsonElement(
            """{"harmony":{"progressions":[
                {"name":"빈","chords":[{"symbol":""},{"symbol":"${"C".repeat(25)}"}]},
                {"name":"후렴","song":"Just the Two of Us","artist":"Bill Withers","key":"F","instrument":"피아노",
                 "start":"1:10","end":"1:30","chords":[
                    {"symbol":" FM7 ","roman":"Imaj7","source":"화면","timestamp":"1:12","lh":["F2"],"function":"T"},
                    {"symbol":"E7","roman":"VII7","source":"이상함","timestamp":"한참"}]},
                {"name":"역전","start":"2:00","end":"1:00","chords":[{"symbol":"C","timestamp":"0:05"}]},
                {"name":"많음","chords":[${List(70) { """{"symbol":"C"}""" }.joinToString(",")}]},
                "문자열"
            ]}}"""
        ).jsonObject
        val rows = ProgressionExtract.fromAnalysis(analysis, "영상 제목", "채널", "dQw4w9WgXcQ")
        assertEquals(listOf(1, 2, 3), rows.map { it.index })

        val r = rows[0]
        assertEquals("Just the Two of Us", r.title)
        assertEquals("Bill Withers", r.artist)
        assertEquals("후렴", r.part)
        assertEquals("채널", r.channel)
        assertEquals("F Major", r.key)
        assertNull(r.instrument) // 건반·기타 아님
        assertEquals(70, r.startSec)
        assertEquals(90, r.endSec)
        assertEquals("추정", r.evidence) // 잘못된 source는 버림 → 추정
        assertEquals(
            Json.parseToJsonElement("""[{"symbol":"FM7","roman":"IM7","source":"화면","timestamp":"1:12"},{"symbol":"E7","roman":"VII7"}]"""),
            r.chords
        )
        assertEquals("https://www.youtube.com/watch?v=dQw4w9WgXcQ", r.url)

        val reversed = rows[1]
        assertEquals("영상 제목", reversed.title) // song 비면 노트 제목
        assertNull(reversed.startSec)
        assertNull(reversed.endSec)
        assertNull(reversed.key)

        assertEquals(64, rows[2].chords.size)
        assertTrue(ProgressionExtract.fromAnalysis(buildJsonObject {}, "t", "", "dQw4w9WgXcQ").isEmpty())
    }
}
