package ulevelp.note

import kotlinx.serialization.json.*

object NotionNoteBlockBuilder {
    const val TEXT_LIMIT = 2000
    const val BLOCK_BATCH = 100

    private val DIGITS_REGEX = Regex("""\d+""")

    /** "2:15" -> 135, "1:02:03" -> 3723. 숫자가 2~3덩어리가 아니거나 숫자가 너무 커서 int 파싱 실패 시 null */
    fun seconds(ts: String?): Int? {
        val raw = ts?.trim().orEmpty()
        val parts = DIGITS_REGEX.findAll(raw).map { it.value.toIntOrNull() }.toList()
        if (parts.size !in 2..3 || parts.any { it == null }) return null
        var total = 0
        for (p in parts) {
            val num = p ?: return null
            total = total * 60 + num
        }
        return total
    }

    /** 2000자 단위로 쪼갠 Notion rich_text 배열 생성 (빈 문자열이면 빈 배열) */
    fun text(
        content: String?,
        link: String? = null,
        bold: Boolean = false,
        code: Boolean = false,
        color: String = "default"
    ): JsonArray {
        val str = content.orEmpty()
        val chunks = str.chunked(TEXT_LIMIT)
        return buildJsonArray {
            for (c in chunks) {
                addJsonObject {
                    put("type", "text")
                    putJsonObject("text") {
                        put("content", c)
                        if (link != null) {
                            putJsonObject("link") {
                                put("url", link)
                            }
                        } else {
                            put("link", JsonNull)
                        }
                    }
                    putJsonObject("annotations") {
                        put("bold", bold)
                        put("code", code)
                        put("color", color)
                    }
                }
            }
        }
    }

    /** 타임스탬프가 유효하면 "$url&t=${sec}s" 링크가 걸린 rich_text, 아니면 일반 텍스트 */
    fun tsLink(url: String, ts: String?): JsonArray {
        val sec = seconds(ts)
        return if (sec == null) {
            text(ts.orEmpty())
        } else {
            text(ts.orEmpty(), link = "$url&t=${sec}s")
        }
    }

    /** scripts/analyze.py voicing_cell(c) 1:1 이식 */
    fun voicingCell(chord: HarmonyChordDto): JsonArray {
        val frets = GuitarSvgRenderer.parseFrets(chord.frets)
        val notes: String = if (frets != null) {
            val degs = GuitarSvgRenderer.degrees(chord.symbol, frets)
            chord.frets.joinToString(" ") + "  ·  " + degs.filterNotNull().filter { it.isNotEmpty() }.joinToString(" ")
        } else if (chord.split) {
            "LH ${chord.lh.joinToString(" ")} · RH ${chord.rh.joinToString(" ")}"
        } else {
            (chord.lh + chord.rh).joinToString(" ")
        }

        val cell = text(notes, code = true).toMutableList()
        if (chord.voicingNote.isNotEmpty()) {
            cell.addAll(text("\n(${chord.voicingNote})", color = "gray"))
        }
        return JsonArray(cell)
    }

    private fun block(kind: String, rich: JsonArray, extra: Map<String, JsonElement> = emptyMap()): JsonObject =
        buildJsonObject {
            put("object", "block")
            put("type", kind)
            putJsonObject(kind) {
                put("rich_text", rich)
                for ((k, v) in extra) {
                    put(k, v)
                }
            }
        }

    private fun heading(content: String, level: Int = 2): JsonObject =
        block("heading_$level", text(content))

    private fun para(rich: JsonArray): JsonObject =
        block("paragraph", rich)

    private fun bullet(rich: JsonArray, children: List<JsonObject>? = null): JsonObject =
        buildJsonObject {
            put("object", "block")
            put("type", "bulleted_list_item")
            putJsonObject("bulleted_list_item") {
                put("rich_text", rich)
                if (!children.isNullOrEmpty()) {
                    putJsonArray("children") {
                        children.forEach { add(it) }
                    }
                }
            }
        }

    private fun table(headers: List<String>, rows: List<List<JsonArray>>): JsonObject {
        fun row(cells: List<JsonArray>): JsonObject = buildJsonObject {
            put("type", "table_row")
            putJsonObject("table_row") {
                putJsonArray("cells") {
                    cells.forEach { add(it) }
                }
            }
        }

        return buildJsonObject {
            put("object", "block")
            put("type", "table")
            putJsonObject("table") {
                put("table_width", headers.size)
                put("has_column_header", true)
                put("has_row_header", false)
                putJsonArray("children") {
                    add(row(headers.map { text(it) }))
                    rows.forEach { add(row(it)) }
                }
            }
        }
    }

    private fun terms(items: List<Pair<String, String>>): List<JsonObject> =
        items.map { (term, explanation) ->
            val rich = buildJsonArray {
                text("$term: ", bold = true).forEach { add(it) }
                text(explanation).forEach { add(it) }
            }
            bullet(rich)
        }

    private fun summaryBlock(summary: JsonObject): JsonObject {
        val points = mutableListOf<JsonObject>()
        val pointsArray = summary["points"]?.jsonArray.orEmpty()
        for (itemElem in pointsArray) {
            val itemObj = itemElem as? JsonObject ?: continue
            val pointText = itemObj["point"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val detailsArray = itemObj["details"]?.jsonArray.orEmpty()
            val childBullets = detailsArray.mapNotNull { d ->
                val str = d.jsonPrimitive.contentOrNull ?: return@mapNotNull null
                bullet(text(str))
            }
            points.add(bullet(text(pointText), childBullets.takeIf { it.isNotEmpty() }))
        }

        val headline = summary["headline"]?.jsonPrimitive?.contentOrNull.orEmpty()
        return buildJsonObject {
            put("object", "block")
            put("type", "callout")
            putJsonObject("callout") {
                put("rich_text", text(headline, bold = true))
                putJsonObject("icon") {
                    put("type", "emoji")
                    put("emoji", "📝")
                }
                putJsonArray("children") {
                    points.forEach { add(it) }
                }
            }
        }
    }

    private fun renderHarmony(
        d: JsonObject,
        url: String,
        harmonyUploadIds: List<String?>
    ): List<JsonObject> {
        val out = mutableListOf<JsonObject>()
        val progressions = d["progressions"]?.jsonArray.orEmpty()
        for ((idx, pElem) in progressions.withIndex()) {
            val p = pElem as? JsonObject ?: continue
            val name = p["name"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val key = p["key"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val title = name + if (key.isNotEmpty()) " ($key)" else ""
            out.add(heading(title, 3))

            val chordDtos = p["chords"]?.jsonArray.orEmpty().mapNotNull { cElem ->
                val c = cElem as? JsonObject ?: return@mapNotNull null
                HarmonyChordDto(
                    symbol = c["symbol"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                    roman = c["roman"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                    function = c["function"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                    split = c["split"]?.jsonPrimitive?.booleanOrNull ?: false,
                    lh = c["lh"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull }.orEmpty(),
                    rh = c["rh"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull }.orEmpty(),
                    frets = c["frets"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull }.orEmpty(),
                    voicingNote = c["voicing_note"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                    nuance = c["nuance"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                    source = c["source"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                    timestamp = c["timestamp"]?.jsonPrimitive?.contentOrNull.orEmpty()
                )
            }

            out.add(para(text(chordDtos.joinToString(" → ") { it.symbol }, code = true)))

            val rows = chordDtos.map { c ->
                listOf(
                    text(c.symbol),
                    text(c.roman),
                    text(c.function),
                    voicingCell(c),
                    text(c.nuance),
                    text(c.source),
                    tsLink(url, c.timestamp)
                )
            }
            out.add(table(listOf("코드", "로마숫자", "기능", "보이싱", "뉘앙스", "근거", "시간"), rows))

            val uploadId = harmonyUploadIds.getOrNull(idx)
            if (uploadId != null) {
                out.add(
                    buildJsonObject {
                        put("object", "block")
                        put("type", "image")
                        putJsonObject("image") {
                            put("type", "file_upload")
                            putJsonObject("file_upload") {
                                put("id", uploadId)
                            }
                        }
                    }
                )
            }
        }

        val concepts = d["concepts"]?.jsonArray.orEmpty().mapNotNull { cElem ->
            val c = cElem as? JsonObject ?: return@mapNotNull null
            val term = c["term"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val expl = c["explanation"]?.jsonPrimitive?.contentOrNull.orEmpty()
            Pair(term, expl)
        }
        if (concepts.isNotEmpty()) {
            out.add(heading("개념 정리", 3))
            out.addAll(terms(concepts))
        }
        return out
    }

    private fun renderSound(d: JsonObject, url: String): List<JsonObject> {
        val out = mutableListOf<JsonObject>()
        val patches = d["patches"]?.jsonArray.orEmpty()
        for (pElem in patches) {
            val p = pElem as? JsonObject ?: continue
            val target = p["target"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val inst = p["instrument"]?.jsonPrimitive?.contentOrNull.orEmpty()
            out.add(heading("$target · $inst", 3))

            val steps = p["steps"]?.jsonArray.orEmpty().mapNotNull { sElem ->
                val s = sElem as? JsonObject ?: return@mapNotNull null
                val stage = s["stage"]?.jsonPrimitive?.contentOrNull.orEmpty()
                val setting = s["setting"]?.jsonPrimitive?.contentOrNull.orEmpty()
                val why = s["why"]?.jsonPrimitive?.contentOrNull.orEmpty()
                val src = s["source"]?.jsonPrimitive?.contentOrNull.orEmpty()
                val ts = s["timestamp"]?.jsonPrimitive?.contentOrNull.orEmpty()
                listOf(text(stage), text(setting), text(why), text(src), tsLink(url, ts))
            }
            out.add(table(listOf("단계", "설정", "효과", "근거", "시간"), steps))
        }
        return out
    }

    private fun renderDaw(d: JsonObject, url: String): List<JsonObject> {
        val out = mutableListOf<JsonObject>()
        val daw = d["daw"]?.jsonPrimitive?.contentOrNull.orEmpty()
        if (daw.isNotEmpty()) {
            out.add(para(text("DAW: $daw")))
        }
        val steps = d["steps"]?.jsonArray.orEmpty().mapNotNull { sElem ->
            val s = sElem as? JsonObject ?: return@mapNotNull null
            val action = s["action"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val detail = s["detail"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val shortcut = s["shortcut"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val ts = s["timestamp"]?.jsonPrimitive?.contentOrNull.orEmpty()
            listOf(text(action), text(detail), text(shortcut, code = shortcut.isNotEmpty()), tsLink(url, ts))
        }
        if (steps.isNotEmpty()) {
            out.add(table(listOf("작업", "방법", "단축키", "시간"), steps))
        }
        val tips = d["tips"]?.jsonArray.orEmpty().mapNotNull { it.jsonPrimitive.contentOrNull }
        out.addAll(tips.map { bullet(text(it)) })
        return out
    }

    private fun renderRhythm(d: JsonObject, url: String): List<JsonObject> {
        val out = mutableListOf<JsonObject>()
        val patterns = d["patterns"]?.jsonArray.orEmpty()
        for (pElem in patterns) {
            val p = pElem as? JsonObject ?: continue
            val name = p["name"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val sig = p["time_signature"]?.jsonPrimitive?.contentOrNull.orEmpty()
            out.add(heading("$name ($sig)", 3))

            val grid = p["grid"]?.jsonPrimitive?.contentOrNull.orEmpty()
            if (grid.isNotEmpty()) {
                out.add(
                    buildJsonObject {
                        put("object", "block")
                        put("type", "code")
                        putJsonObject("code") {
                            put("rich_text", text(grid))
                            put("language", "plain text")
                        }
                    }
                )
            }
            val feel = p["feel"]?.jsonPrimitive?.contentOrNull.orEmpty()
            out.add(para(text(feel)))

            val src = p["source"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val ts = p["timestamp"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val srcRich = buildJsonArray {
                text("근거: $src · ").forEach { add(it) }
                tsLink(url, ts).forEach { add(it) }
            }
            out.add(para(srcRich))
        }

        val concepts = d["concepts"]?.jsonArray.orEmpty().mapNotNull { cElem ->
            val c = cElem as? JsonObject ?: return@mapNotNull null
            val term = c["term"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val expl = c["explanation"]?.jsonPrimitive?.contentOrNull.orEmpty()
            Pair(term, expl)
        }
        if (concepts.isNotEmpty()) {
            out.add(heading("개념 정리", 3))
            out.addAll(terms(concepts))
        }
        return out
    }

    private fun renderArrangement(d: JsonObject, url: String): List<JsonObject> {
        val out = mutableListOf<JsonObject>()
        val sections = d["sections"]?.jsonArray.orEmpty().mapNotNull { sElem ->
            val s = sElem as? JsonObject ?: return@mapNotNull null
            val sec = s["section"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val bars = s["bars"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val inst = s["instruments"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val tech = s["technique"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val ts = s["timestamp"]?.jsonPrimitive?.contentOrNull.orEmpty()
            listOf(text(sec), text(bars), text(inst), text(tech), tsLink(url, ts))
        }
        if (sections.isNotEmpty()) {
            out.add(table(listOf("구간", "마디", "악기", "기법·의도", "시간"), sections))
        }

        val techniques = d["techniques"]?.jsonArray.orEmpty().mapNotNull { tElem ->
            val t = tElem as? JsonObject ?: return@mapNotNull null
            val term = t["term"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val expl = t["explanation"]?.jsonPrimitive?.contentOrNull.orEmpty()
            Pair(term, expl)
        }
        if (techniques.isNotEmpty()) {
            out.add(heading("편곡 기법", 3))
            out.addAll(terms(techniques))
        }
        return out
    }

    private fun renderMixing(d: JsonObject, url: String): List<JsonObject> {
        val out = mutableListOf<JsonObject>()
        val chain = d["chain"]?.jsonArray.orEmpty().mapNotNull { cElem ->
            val c = cElem as? JsonObject ?: return@mapNotNull null
            val track = c["track"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val proc = c["processor"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val settings = c["settings"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val purpose = c["purpose"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val src = c["source"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val ts = c["timestamp"]?.jsonPrimitive?.contentOrNull.orEmpty()
            listOf(text(track), text(proc), text(settings), text(purpose), text(src), tsLink(url, ts))
        }
        if (chain.isNotEmpty()) {
            out.add(table(listOf("트랙", "프로세서", "설정", "목적", "근거", "시간"), chain))
        }
        val tips = d["tips"]?.jsonArray.orEmpty().mapNotNull { it.jsonPrimitive.contentOrNull }
        out.addAll(tips.map { bullet(text(it)) })
        return out
    }

    /**
     * docs/04-db-design.md 4.3절 및 scripts/analyze.py create_page(337~348줄)와 100% 동일한 노션 페이지 속성 JSON 생성:
     * 제목(title), URL(url), 태그(multi_select), 채널(rich_text), 요약(rich_text), 키워드(multi_select, 쉼표 공백 치환·100자·중복 제거), 난이도(select), 메모(rich_text)
     */
    fun buildPageProperties(
        url: String,
        tags: List<String>,
        memo: String,
        title: String,
        channel: String,
        headline: String,
        keywords: List<String>,
        difficulty: String?
    ): JsonObject = buildJsonObject {
        putJsonObject("제목") {
            put("title", text(title.ifEmpty { url }))
        }
        putJsonObject("URL") {
            put("url", url)
        }
        putJsonObject("태그") {
            putJsonArray("multi_select") {
                tags.forEach { addJsonObject { put("name", it) } }
            }
        }
        putJsonObject("채널") {
            put("rich_text", text(channel))
        }
        putJsonObject("요약") {
            put("rich_text", text(headline))
        }
        putJsonObject("키워드") {
            putJsonArray("multi_select") {
                keywords.distinct().forEach { addJsonObject { put("name", it) } }
            }
        }
        putJsonObject("난이도") {
            if (difficulty != null) {
                putJsonObject("select") {
                    put("name", difficulty)
                }
            } else {
                put("select", JsonNull)
            }
        }
        putJsonObject("메모") {
            put("rich_text", text(memo))
        }
    }

    /**
     * scripts/analyze.py build_blocks(284~301줄)와 100% 동일한 노션 블록 배열 생성.
     * harmonyUploadIds는 harmony.progressions 각 인덱스에 대응하는 노션 file_upload ID(없거나 업로드 실패 시 null) 목록이다.
     */
    fun buildBlocks(
        url: String,
        tags: List<String>,
        analysis: JsonObject,
        harmonyUploadIds: List<String?> = emptyList()
    ): List<JsonObject> {
        val blocks = mutableListOf<JsonObject>()
        blocks.add(
            buildJsonObject {
                put("object", "block")
                put("type", "video")
                putJsonObject("video") {
                    put("type", "external")
                    putJsonObject("external") {
                        put("url", url)
                    }
                }
            }
        )

        val summary = analysis["summary"]?.jsonObject
        if (summary != null) {
            blocks.add(summaryBlock(summary))
        }

        for (tag in tags) {
            val field = GeminiSchemas.SECTION_FIELDS[tag] ?: continue
            val sectionData = analysis[field]?.jsonObject ?: continue
            blocks.add(heading(tag))
            when (field) {
                "harmony" -> blocks.addAll(renderHarmony(sectionData, url, harmonyUploadIds))
                "sound_design" -> blocks.addAll(renderSound(sectionData, url))
                "daw" -> blocks.addAll(renderDaw(sectionData, url))
                "rhythm" -> blocks.addAll(renderRhythm(sectionData, url))
                "arrangement" -> blocks.addAll(renderArrangement(sectionData, url))
                "mixing" -> blocks.addAll(renderMixing(sectionData, url))
            }
        }

        val moments = analysis["moments"]?.jsonArray
        if (!moments.isNullOrEmpty()) {
            blocks.add(heading("주요 구간"))
            for (mElem in moments) {
                val m = mElem as? JsonObject ?: continue
                val ts = m["timestamp"]?.jsonPrimitive?.contentOrNull.orEmpty()
                val pt = m["point"]?.jsonPrimitive?.contentOrNull.orEmpty()
                val rich = buildJsonArray {
                    tsLink(url, ts).forEach { add(it) }
                    text("  $pt").forEach { add(it) }
                }
                blocks.add(bullet(rich))
            }
        }

        val practice = analysis["practice"]?.jsonArray
        if (!practice.isNullOrEmpty()) {
            blocks.add(heading("연습 과제"))
            for (pElem in practice) {
                val pStr = pElem.jsonPrimitive.contentOrNull.orEmpty()
                blocks.add(
                    buildJsonObject {
                        put("object", "block")
                        put("type", "to_do")
                        putJsonObject("to_do") {
                            put("rich_text", text(pStr))
                            put("checked", false)
                        }
                    }
                )
            }
        }

        blocks.add(para(text("근거 표시: 말함 = 강사 설명 · 화면 = 영상에 보임 · 추정 = 소리로 짐작 (확인 필요)")))
        return blocks
    }
}

