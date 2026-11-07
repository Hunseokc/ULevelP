package ulevelp.note

import kotlinx.serialization.json.*

/**
 * 노트 분석 결과(`analysis.harmony.progressions[]`) → 진행 행 (`개발산출물/결과/CH-1b_설계.md` §4-3·§5-3).
 * 코드 파서·로마숫자 계산은 프론트(TS) 몫이고, 서버는 AI 값을 가볍게 정규화만 한다.
 * 노트 토글(route='note', CH-3)과 코드 진행 영상 분석(route='video', CH-4)이 같이 쓴다.
 */
object ProgressionExtract {
    const val MAX_CHORDS = 64
    const val MAX_SYMBOL = 24
    const val MAX_ROMAN = 24
    val SOURCES = listOf("화면", "말함", "추정")
    val INSTRUMENTS = setOf("건반", "기타")

    /** 노트에서 뽑은 진행 하나. `index` = 노트 안 진행 순번(`note_prog_index`, 원본 배열 기준) */
    data class Row(
        val index: Int,
        val title: String,
        val part: String,
        val artist: String,
        val channel: String,
        val key: String?,
        val instrument: String?,
        val chords: JsonArray,
        val evidence: String,
        val url: String,
        val videoId: String,
        val startSec: Int?,
        val endSec: Int?
    )

    // 노션 템플릿 Scale 옵션 철자 (프론트 roman.mts KEYS와 같음)
    private val MAJOR_SPELL = listOf("C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
    private val MINOR_SPELL = listOf("C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B")
    private val LETTER_PC = mapOf('C' to 0, 'D' to 2, 'E' to 4, 'F' to 5, 'G' to 7, 'A' to 9, 'B' to 11)
    private val KEY_RE = Regex("""^([A-Ga-g])([#b]?)\s*(.*)$""")
    private val MAJOR_WORDS = setOf("", "major", "maj", "M", "ma")
    private val MINOR_WORDS = setOf("min", "minor", "m", "-", "mi")
    private val TIMESTAMP_RE = Regex("""^(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)$""")

    /**
     * 키 정규화: `F major`/`F Major`/`F`/`Fmaj` → `F Major`, `Am`/`A minor`/`a minor` → `A min`.
     * 으뜸음 철자는 노션 Scale 옵션(템플릿 24개)으로 맞춘다(`C# Major` → `Db Major`). 못 읽으면 null
     */
    fun normalizeKey(raw: String?): String? {
        val text = raw?.replace('♯', '#')?.replace('♭', 'b')?.trim().orEmpty()
        val m = KEY_RE.matchEntire(text) ?: return null
        val letter = m.groupValues[1][0].uppercaseChar()
        val accidental = m.groupValues[2]
        val word = m.groupValues[3].trim()
        val minor = when {
            word in MAJOR_WORDS || word.lowercase() == "major" -> false
            word in MINOR_WORDS || word.lowercase() in setOf("min", "minor") -> true
            else -> return null
        }
        val pc = (LETTER_PC.getValue(letter) + when (accidental) { "#" -> 1; "b" -> -1; else -> 0 } + 12) % 12
        val tonic = if (minor) MINOR_SPELL[pc] else MAJOR_SPELL[pc]
        return if (minor) "$tonic min" else "$tonic Major"
    }

    /** 로마숫자 정규화: 공백 제거, `maj7→M7`·`maj9→M9`·`Δ→M7`·`ø→m7b5`·`°7→dim7`·`°→dim`. 세컨더리(`V7/ii`)는 그대로 */
    fun normalizeRoman(raw: String?): String {
        var s = raw.orEmpty().replace(Regex("\\s+"), "")
        s = s.replace("maj7", "M7").replace("maj9", "M9")
            .replace("Δ7", "M7").replace("∆7", "M7").replace("Δ", "M7").replace("∆", "M7")
            .replace("ø7", "m7b5").replace("ø", "m7b5")
            .replace("°7", "dim7").replace("°", "dim")
        return s.take(MAX_ROMAN)
    }

    /** `mm:ss`·`h:mm:ss` → 초. 못 읽으면 null */
    fun parseTimestamp(raw: String?): Int? {
        val m = TIMESTAMP_RE.matchEntire(raw?.trim().orEmpty()) ?: return null
        val h = m.groupValues[1].takeIf { it.isNotEmpty() }?.toInt() ?: 0
        val mm = m.groupValues[2].toInt()
        if (h > 0 && mm > 59) return null
        val sec = h * 3600 + mm * 60 + m.groupValues[3].toInt()
        return sec.takeIf { it in 0..86400 }
    }

    /** 대표 근거 = 코드 source 중 가장 약한 것(추정 > 말함 > 화면). 전부 비면 추정 */
    fun evidenceOf(sources: List<String>): String = when {
        sources.isEmpty() || "추정" in sources -> "추정"
        "말함" in sources -> "말함"
        else -> "화면"
    }

    private fun JsonObject.str(name: String): String =
        (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim().orEmpty()

    /**
     * 노트 분석 결과에서 진행 행 목록을 만든다. 코드가 0개가 된 진행은 건너뛴다(순번은 원본 배열 기준 유지).
     * `noteTitle`·`channel`·`videoId`는 노트 행 값.
     */
    fun fromAnalysis(analysis: JsonObject, noteTitle: String, channel: String, videoId: String): List<Row> {
        val progressions = (analysis["harmony"] as? JsonObject)?.get("progressions") as? JsonArray ?: return emptyList()
        return progressions.mapIndexedNotNull { index, elem ->
            val p = elem as? JsonObject ?: return@mapIndexedNotNull null
            val sources = mutableListOf<String>()
            var firstTimestamp: String? = null
            val chords = (p["chords"] as? JsonArray).orEmpty().mapNotNull { cElem ->
                val c = cElem as? JsonObject ?: return@mapNotNull null
                val symbol = c.str("symbol")
                if (symbol.isEmpty() || symbol.length > MAX_SYMBOL) return@mapNotNull null
                val source = c.str("source").takeIf { it in SOURCES }
                val timestamp = c.str("timestamp").takeIf { parseTimestamp(it) != null }
                buildJsonObject {
                    put("symbol", symbol)
                    put("roman", normalizeRoman(c.str("roman")))
                    if (source != null) put("source", source)
                    if (timestamp != null) put("timestamp", timestamp)
                }.also {
                    sources.add(source.orEmpty())
                    if (firstTimestamp == null && timestamp != null) firstTimestamp = timestamp
                }
            }.take(MAX_CHORDS)
            if (chords.isEmpty()) return@mapIndexedNotNull null

            var start = parseTimestamp(p.str("start").ifEmpty { firstTimestamp })
            var end = parseTimestamp(p.str("end"))
            if (start != null && end != null && start >= end) {
                start = null
                end = null
            }
            Row(
                index = index,
                title = p.str("song").ifEmpty { noteTitle.trim() }.ifEmpty { "(제목 없음)" }.take(300),
                part = p.str("name").take(100),
                artist = p.str("artist").take(200),
                channel = channel.trim().take(200),
                key = normalizeKey(p.str("key")),
                instrument = p.str("instrument").takeIf { it in INSTRUMENTS },
                chords = JsonArray(chords),
                evidence = evidenceOf(sources.map { it.ifEmpty { "추정" } }), // source 없는 코드는 추정으로 본다
                url = "https://www.youtube.com/watch?v=$videoId",
                videoId = videoId,
                startSec = start,
                endSec = end
            )
        }
    }
}
