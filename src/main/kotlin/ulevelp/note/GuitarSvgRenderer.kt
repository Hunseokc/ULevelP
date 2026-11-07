package ulevelp.note

object GuitarSvgRenderer {
    val OPEN: List<Int> = listOf(40, 45, 50, 55, 59, 64) // 6번줄(E2)~1번줄(E4)
    private val ROOT_REGEX = Regex("""^([A-G])(#|b|♯|♭)?""")
    private val EXTENDED_REGEX = Regex("""(?<!add)(9|11|13)|7""")

    val BASE: Map<Int, String> = mapOf(
        0 to "R", 1 to "b2", 2 to "2", 3 to "b3", 4 to "3", 5 to "4",
        6 to "b5", 7 to "5", 8 to "#5", 9 to "6", 10 to "b7", 11 to "7"
    )

    const val STR_GAP = 18
    const val FRET_GAP = 22
    const val DOT_R = 8
    const val CELL_W = 140
    const val PER_ROW = 6
    const val PAD = 16
    const val TITLE_H = 22
    const val MARK_H = 20

    fun rootPc(symbol: String): Int? {
        val m = ROOT_REGEX.find(symbol.trim()) ?: return null
        val letter = m.groupValues[1]
        val acc = m.groupValues[2]
        val step = KeyboardSvgRenderer.STEP[letter] ?: return null
        val accVal = KeyboardSvgRenderer.ACC[acc] ?: return null
        return ((step + accVal) % 12 + 12) % 12
    }

    /** ["x","3","2","0","1","0"] -> [null, 3, 2, 0, 1, 0]. 길이가 6이 아니거나 숫자가 아닌 값이면 null */
    fun parseFrets(frets: List<String>): List<Int?>? {
        if (frets.size != 6) return null
        val out = mutableListOf<Int?>()
        for (f in frets) {
            val trimmed = f.trim().lowercase()
            if (trimmed in setOf("x", "-", "")) {
                out.add(null)
            } else if (trimmed.isNotEmpty() && trimmed.all { it.isDigit() }) {
                out.add(trimmed.toInt())
            } else {
                return null
            }
        }
        return out
    }

    /** 각 줄의 도수(R, b2, 2, b3, 3, 4, b5, 5, #5, 6, b7, 7, b9, 9, #9, 11, #11, b13, 13). 7음 포함 또는 9/11/13(add 제외)·7 코드면 확장 도수 적용 */
    fun degrees(symbol: String, frets: List<Int?>): List<String?> {
        val root = rootPc(symbol) ?: return List(6) { null }
        val ivs = frets.mapIndexed { i, f ->
            if (f == null) null else ((OPEN[i] + f - root) % 12 + 12) % 12
        }
        val present = ivs.filterNotNull().toSet()
        val extended = (10 in present || 11 in present) || EXTENDED_REGEX.containsMatchIn(symbol)
        val sus = "sus" in symbol

        fun name(iv: Int): String {
            if (!extended) return BASE[iv] ?: ""
            if (iv == 1) return "b9"
            if (iv == 2) return "9"
            if (iv == 3 && 4 in present) return "#9"
            if (iv == 5 && !sus) return "11"
            if (iv == 6 && 7 in present) return "#11"
            if (iv == 8 && 7 in present) return "b13"
            if (iv == 9 && !symbol.contains("6")) return "13"
            return BASE[iv] ?: ""
        }

        return ivs.map { iv -> if (iv == null) null else name(iv) }
    }

    private fun box(chord: HarmonyChordDto, frets: List<Int?>, x0: Int, y0: Int): Pair<List<String>, Int> {
        val degs = degrees(chord.symbol, frets)
        val fretted = frets.filterNotNull().filter { it > 0 }
        val maxFret = fretted.maxOrNull() ?: 0
        val minFret = fretted.minOrNull() ?: 1
        val start = if (fretted.isEmpty() || maxFret <= 4) 1 else minFret
        val count = maxOf(4, if (fretted.isNotEmpty()) maxFret - start + 1 else 4)

        val gx = x0 + (CELL_W - STR_GAP * 5) / 2
        val gy = y0 + TITLE_H + MARK_H
        val out = mutableListOf<String>()
        out.add("""<text x="${x0 + CELL_W / 2}" y="${y0 + 15}" font-size="14" font-weight="700" text-anchor="middle">${KeyboardSvgRenderer.escapeXml(chord.symbol)}</text>""")

        for (i in 0..count) {
            val w = if (i == 0 && start == 1) 4 else 1
            out.add("""<line x1="$gx" y1="${gy + i * FRET_GAP}" x2="${gx + STR_GAP * 5}" y2="${gy + i * FRET_GAP}" stroke="#222" stroke-width="$w"/>""")
        }
        for (s in 0..5) {
            out.add("""<line x1="${gx + s * STR_GAP}" y1="$gy" x2="${gx + s * STR_GAP}" y2="${gy + count * FRET_GAP}" stroke="#222" stroke-width="1"/>""")
        }
        if (start > 1) {
            out.add("""<text x="${gx + STR_GAP * 5 + 8}" y="${gy + FRET_GAP / 2 + 4}" font-size="11">${start}fr</text>""")
        }

        for (s in 0..5) {
            val f = frets[s]
            val d = degs[s]
            val x = gx + s * STR_GAP
            if (f == null) {
                val my = gy - MARK_H / 2
                out.add("""<path d="M${x - 5} ${my - 5} L${x + 5} ${my + 5} M${x + 5} ${my - 5} L${x - 5} ${my + 5}" stroke="#222" stroke-width="1.6"/>""")
            } else if (f == 0) {
                val my = gy - MARK_H / 2
                out.add("""<circle cx="$x" cy="$my" r="$DOT_R" fill="#fff" stroke="#222" stroke-width="1.2"/>""")
                out.add("""<text x="$x" y="${my + 3}" font-size="8" font-weight="700" text-anchor="middle">${KeyboardSvgRenderer.escapeXml(d ?: "")}</text>""")
            } else {
                val cy = gy + (f - start) * FRET_GAP + FRET_GAP / 2
                val fill = if (d == "R") "#e8590c" else "#222"
                out.add("""<circle cx="$x" cy="$cy" r="$DOT_R" fill="$fill"/>""")
                out.add("""<text x="$x" y="${cy + 3}" font-size="8" font-weight="700" fill="#fff" text-anchor="middle">${KeyboardSvgRenderer.escapeXml(d ?: "")}</text>""")
            }
        }

        return Pair(out, TITLE_H + MARK_H + count * FRET_GAP)
    }

    /**
     * 유효한 frets(길이 6이고 최소 1개 줄이 null이 아님)가 있는 코드가 없으면 null 반환.
     * 누른 자리: cy = gy + (f - start) * FRET_GAP + FRET_GAP / 2, 도수가 "R"이면 fill="#e8590c", 아니면 "#222".
     */
    fun progressionSvg(chords: List<HarmonyChordDto>): String? {
        val boxes = chords.mapNotNull { chord ->
            val f = parseFrets(chord.frets)
            if (f != null && f.any { it != null }) {
                Pair(chord, f)
            } else {
                null
            }
        }
        if (boxes.isEmpty()) return null

        val body = mutableListOf<String>()
        var y = 0
        var rowH = 0

        for ((i, pair) in boxes.withIndex()) {
            val (chord, frets) = pair
            val col = i % PER_ROW
            if (i > 0 && col == 0) {
                y += rowH + PAD
                rowH = 0
            }
            val (shapes, h) = box(chord, frets, col * CELL_W, y)
            body.addAll(shapes)
            rowH = maxOf(rowH, h)
        }

        val width = minOf(boxes.size, PER_ROW) * CELL_W + PAD * 2
        val height = y + rowH + PAD * 2
        val bodyStr = body.joinToString("")
        return """<svg xmlns="http://www.w3.org/2000/svg" width="$width" height="$height" viewBox="0 0 $width $height" font-family="Helvetica, Arial, sans-serif"><rect width="100%" height="100%" fill="#fff"/><g transform="translate($PAD,$PAD)" fill="#222">$bodyStr</g></svg>"""
    }
}

