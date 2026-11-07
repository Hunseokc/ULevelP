package ulevelp.note

object KeyboardSvgRenderer {
    private val NOTE_REGEX = Regex("""^([A-Ga-g])(##|bb|x|#|b|♯|♭)?(-?\d)$""")

    val STEP: Map<String, Int> = mapOf("C" to 0, "D" to 2, "E" to 4, "F" to 5, "G" to 7, "A" to 9, "B" to 11)
    val ACC: Map<String, Int> = mapOf("" to 0, "#" to 1, "♯" to 1, "##" to 2, "x" to 2, "b" to -1, "♭" to -1, "bb" to -2)
    val BLACK: Set<Int> = setOf(1, 3, 6, 8, 10)

    const val WHITE_W = 20
    const val WHITE_H = 72
    const val BLACK_W = 12
    const val BLACK_H = 44
    const val LABEL_W = 150
    const val ROW_GAP = 30
    const val PAD = 16

    val COLORS: Map<String, String> = mapOf("lh" to "#4263eb", "rh" to "#f08c00", "all" to "#2f9e44")

    fun escapeXml(s: String): String = buildString(s.length) {
        for (ch in s) {
            when (ch) {
                '&' -> append("&amp;")
                '<' -> append("&lt;")
                '>' -> append("&gt;")
                '"' -> append("&quot;")
                '\'' -> append("&#x27;")
                else -> append(ch)
            }
        }
    }

    /** "Gb4" -> 66. 옥타브가 없거나 파싱할 수 없으면 null */
    fun midi(note: String): Int? {
        val m = NOTE_REGEX.matchEntire(note.trim()) ?: return null
        val letter = m.groupValues[1].uppercase()
        val acc = m.groupValues[2]
        val octave = m.groupValues[3].toIntOrNull() ?: return null
        val stepVal = STEP[letter] ?: return null
        val accVal = ACC[acc] ?: return null
        return (octave + 1) * 12 + stepVal + accVal
    }

    private fun keys(lo: Int, hi: Int): Pair<Map<Int, Pair<Int, Boolean>>, Int> {
        val keysMap = LinkedHashMap<Int, Pair<Int, Boolean>>()
        var white = 0
        for (n in lo..hi) {
            val mod = ((n % 12) + 12) % 12
            if (mod in BLACK) {
                keysMap[n] = Pair(white * WHITE_W - BLACK_W / 2, true)
            } else {
                keysMap[n] = Pair(white * WHITE_W, false)
                white++
            }
        }
        return Pair(keysMap, white)
    }

    private fun row(chord: HarmonyChordDto, keysMap: Map<Int, Pair<Int, Boolean>>, y: Int): List<String> {
        val pressed = mutableMapOf<Int, Pair<String, String>>()
        for (hand in listOf("lh", "rh")) {
            val noteList = if (hand == "lh") chord.lh else chord.rh
            for (name in noteList) {
                val n = midi(name)
                if (n != null && n in keysMap) {
                    val color = if (chord.split) COLORS[hand] ?: "#222" else COLORS["all"] ?: "#222"
                    pressed[n] = Pair(color, name)
                }
            }
        }

        val out = mutableListOf<String>()
        out.add("""<text x="0" y="${y + WHITE_H / 2 + 5}" font-size="14" font-weight="700">${escapeXml(chord.symbol)}</text>""")

        for (black in listOf(false, true)) {
            for ((n, pair) in keysMap) {
                val (x, isBlack) = pair
                if (isBlack != black) continue
                val (w, h) = if (black) Pair(BLACK_W, BLACK_H) else Pair(WHITE_W, WHITE_H)
                val fill = pressed[n]?.first ?: if (black) "#222" else "#fff"
                out.add("""<rect x="${LABEL_W + x}" y="$y" width="$w" height="$h" fill="$fill" stroke="#555" stroke-width="0.8"/>""")

                if (n in pressed) {
                    val (color, name) = pressed[n]!!
                    val ty = if (black) y + WHITE_H + 12 else y + h - 6
                    val tfill = if (black) color else "#fff"
                    out.add("""<text x="${LABEL_W + x + w / 2}" y="$ty" font-size="9" fill="$tfill" text-anchor="middle" font-weight="700">${escapeXml(name)}</text>""")
                }
            }
        }
        return out
    }

    /**
     * chords 목록에서 유효한 MIDI 음이 있는 코드가 하나도 없으면 null 반환.
     * lo = Math.floorDiv(minNote, 12) * 12
     * hi = maxOf(Math.floorDiv(maxNote, 12) * 12 + 11, lo + 23)
     * split == true 인 행이 하나라도 있으면 상단에 LH/RH 범례(legend_h = 22)를 추가한다.
     */
    fun progressionSvg(chords: List<HarmonyChordDto>): String? {
        val rows = chords.filter { c -> (c.lh + c.rh).any { midi(it) != null } }
        if (rows.isEmpty()) return null

        val notes = rows.flatMap { it.lh + it.rh }.mapNotNull { midi(it) }
        val minNote = notes.minOrNull() ?: return null
        val maxNote = notes.maxOrNull() ?: return null

        val lo = Math.floorDiv(minNote, 12) * 12
        val hi = maxOf(Math.floorDiv(maxNote, 12) * 12 + 11, lo + 23)
        val (keysMap, whites) = keys(lo, hi)

        val legendH = if (rows.any { it.split }) 22 else 0
        val width = LABEL_W + whites * WHITE_W + PAD * 2
        val height = legendH + rows.size * (WHITE_H + ROW_GAP) - ROW_GAP + PAD * 2

        val body = mutableListOf<String>()
        if (legendH > 0) {
            body.add("""<rect x="$LABEL_W" y="0" width="10" height="10" fill="${COLORS["lh"]}"/>""")
            body.add("""<text x="${LABEL_W + 14}" y="9" font-size="11">LH</text>""")
            body.add("""<rect x="${LABEL_W + 44}" y="0" width="10" height="10" fill="${COLORS["rh"]}"/>""")
            body.add("""<text x="${LABEL_W + 58}" y="9" font-size="11">RH</text>""")
        }

        for ((i, chord) in rows.withIndex()) {
            body.addAll(row(chord, keysMap, legendH + i * (WHITE_H + ROW_GAP)))
        }

        val bodyStr = body.joinToString("")
        return """<svg xmlns="http://www.w3.org/2000/svg" width="$width" height="$height" viewBox="0 0 $width $height" font-family="Helvetica, Arial, sans-serif"><rect width="100%" height="100%" fill="#fff"/><g transform="translate($PAD,$PAD)" fill="#222">$bodyStr</g></svg>"""
    }
}

