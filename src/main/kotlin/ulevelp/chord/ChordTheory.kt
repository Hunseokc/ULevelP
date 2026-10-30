package ulevelp.chord

object ChordTheory {
    val OPEN = listOf(40, 45, 50, 55, 59, 64) // index 0 = 6번줄(저음 E)
    val NAMES = listOf("C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B")

    fun pc(n: Int): Int = ((n % 12) + 12) % 12

    data class Quality4(val id: String, val name: String, val iv: List<Int>, val deg: List<String>)

    val Q4 = listOf(
        Quality4("maj7", "maj7", listOf(0, 4, 7, 11), listOf("R", "3", "5", "7")),
        Quality4("maj7sus2", "maj7(sus2)", listOf(0, 2, 7, 11), listOf("R", "2", "5", "7")),
        Quality4("7", "7", listOf(0, 4, 7, 10), listOf("R", "3", "5", "b7")),
        Quality4("7sus4", "7sus4", listOf(0, 5, 7, 10), listOf("R", "4", "5", "b7")),
        Quality4("6", "6", listOf(0, 4, 7, 9), listOf("R", "3", "5", "6")),
        Quality4("m7", "m7", listOf(0, 3, 7, 10), listOf("R", "b3", "5", "b7")),
        Quality4("m6", "m6", listOf(0, 3, 7, 9), listOf("R", "b3", "5", "6")),
        Quality4("m7b5", "m7(b5)", listOf(0, 3, 6, 10), listOf("R", "b3", "b5", "b7")),
        Quality4("dim7", "dim7", listOf(0, 3, 6, 9), listOf("R", "b3", "b5", "bb7")),
    )
    val QBY = Q4.associateBy { it.id }
    val SLOT_CLS = listOf("root", "guide", "other", "guide")

    data class DropDef(val id: String, val name: String, val drop: List<Int>)

    val DROPS = listOf(
        DropDef("close", "Close", emptyList()),
        DropDef("d2", "Drop 2", listOf(2)),
        DropDef("d3", "Drop 3", listOf(3)),
        DropDef("d4", "Drop 4", listOf(4)),
        DropDef("d24", "Drop 2&4", listOf(2, 4)),
        DropDef("d23", "Drop 2&3", listOf(2, 3)),
    )

    data class StructVoice(val slot: Int, var rel: Int)

    fun dropStructure(dropId: String): Map<Int, List<StructVoice>> {
        val d = DROPS.first { it.id == dropId }
        val base = QBY.getValue("maj7").iv
        val out = mutableMapOf<Int, List<StructVoice>>()
        for (r in 0 until 4) {
            val slots = (0 until 4).map { (r + it) % 4 }
            var prev = Int.MIN_VALUE
            val v = slots.map { s ->
                var p = base[s]
                while (p <= prev) p += 12
                prev = p
                StructVoice(s, p)
            }
            val desc = v.sortedByDescending { it.rel }
            for (k in d.drop) {
                desc[k - 1].rel -= 12
            }
            val asc = desc.sortedBy { it.rel }
            val shift = Math.floorDiv(asc[0].rel, 12) * 12
            for (n in asc) {
                n.rel -= shift
            }
            out[asc[0].slot] = asc.map { it.copy() }
        }
        return out
    }

    val STRING_SETS: List<List<Int>> = buildList {
        for (a in 0 until 6)
            for (b in a + 1 until 6)
                for (c in b + 1 until 6)
                    for (d in c + 1 until 6)
                        add(listOf(a, b, c, d))
    }

    fun setLabelHi(set: List<Int>): String = set.reversed().joinToString("-") { (6 - it).toString() }
    fun isAdjacent(set: List<Int>): Boolean = set[3] - set[0] == 3

    fun spanOf(frets: List<Int>): Int {
        val f = frets.filter { it > 0 }
        return if (f.isNotEmpty()) f.max() - f.min() else 0
    }

    data class PlacedNote(val s: Int, val f: Int, val pitch: Int, val slot: Int, val deg: String, val cls: String)
    data class Placement(val r0: Int, val frets: List<Int>, val span: Int, val ok: Boolean, val notes: List<PlacedNote>)

    fun placeOn(
        struct: List<StructVoice>,
        set: List<Int>,
        rootPc: Int,
        qid: String,
        minFret: Int = 0,
        maxFret: Int = 17,
        maxSpan: Int = 4,
    ): List<Placement> {
        val q = QBY.getValue(qid)
        val b = QBY.getValue("maj7")
        val rels = struct.map { n -> n.rel + (q.iv[n.slot] - b.iv[n.slot]) }
        val res = mutableListOf<Placement>()
        var r0 = 24 + pc(rootPc)
        while (r0 <= 84) {
            val frets = rels.mapIndexed { i, r -> r0 + r - OPEN[set[i]] }
            if (frets.all { it in minFret..maxFret }) {
                val sp = spanOf(frets)
                val notes = struct.mapIndexed { i, n ->
                    PlacedNote(set[i], frets[i], r0 + rels[i], n.slot, q.deg[n.slot], SLOT_CLS[n.slot])
                }
                res.add(Placement(r0, frets, sp, sp <= maxSpan, notes))
            }
            r0 += 12
        }
        return res
    }

    data class AtR0Result(val notes: List<PlacedNote>, val frets: List<Int>, val span: Int, val valid: Boolean)

    fun atR0(struct: List<StructVoice>, set: List<Int>, r0: Int, qid: String): AtR0Result {
        val q = QBY.getValue(qid)
        val b = QBY.getValue("maj7")
        val notes = struct.mapIndexed { i, n ->
            val pitch = r0 + n.rel + (q.iv[n.slot] - b.iv[n.slot])
            PlacedNote(set[i], pitch - OPEN[set[i]], pitch, n.slot, q.deg[n.slot], SLOT_CLS[n.slot])
        }
        val frets = notes.map { it.f }
        return AtR0Result(notes, frets, spanOf(frets), notes.all { it.f in 0..20 })
    }

    data class PlayableSet(
        val set: List<Int>,
        val label: String,
        val adjacent: Boolean,
        val full: Boolean,
        val placements: List<Placement>,
    )

    fun playableSets(dropId: String, inv: Int, rootPc: Int, maxSpan: Int): List<PlayableSet> {
        val st = dropStructure(dropId).getValue(inv)
        val out = mutableListOf<PlayableSet>()
        for (set in STRING_SETS) {
            val pl = placeOn(st, set, rootPc, "maj7", minFret = 2, maxFret = 18, maxSpan = maxSpan).filter { it.ok }
            if (pl.isEmpty()) continue
            val full = pl.any { p ->
                Q4.all { q ->
                    val a = atR0(st, set, p.r0, q.id)
                    a.valid && a.span <= maxSpan + 1
                }
            }
            out.add(PlayableSet(set, setLabelHi(set), isAdjacent(set), full, pl))
        }
        return out.sortedWith(compareByDescending<PlayableSet> { it.adjacent }.thenByDescending { it.set[3] })
    }

    data class MutationDiff(val s: Int, val slot: Int, val delta: Int, val from: String, val to: String)

    fun mutation(fromQ: String, toQ: String, struct: List<StructVoice>, set: List<Int>): List<MutationDiff> {
        val a = QBY.getValue(fromQ).iv
        val b = QBY.getValue(toQ).iv
        return struct.mapIndexed { i, n ->
            MutationDiff(set[i], n.slot, b[n.slot] - a[n.slot], QBY.getValue(fromQ).deg[n.slot], QBY.getValue(toQ).deg[n.slot])
        }.filter { it.delta != 0 }
    }

    data class ArpNote(val s: Int, val f: Int, val pitch: Int, val slot: Int, val order: Int)

    fun arpeggio2nps(rootPc: Int, startSlot: Int, nearFret: Int): List<ArpNote> {
        val q = QBY.getValue("maj7")
        var best: Int? = null
        for (f in 1..14) {
            if (pc(OPEN[0] + f) == pc(rootPc + q.iv[startSlot])) {
                if (best == null || kotlin.math.abs(f - nearFret) < kotlin.math.abs(best - nearFret)) {
                    best = f
                }
            }
        }
        var startFret = best ?: 1
        if (startFret < 2) startFret += 12
        val notes = mutableListOf<ArpNote>()
        var prev = OPEN[0] + startFret - 1
        for (k in 0 until 12) {
            val slot = (startSlot + k) % 4
            var p = prev + 1
            while (pc(p) != pc(rootPc + q.iv[slot])) p++
            val s = k / 2
            notes.add(ArpNote(s, p - OPEN[s], p, slot, k + 1))
            prev = p
        }
        return notes
    }

    data class FamilyDef(val id: String, val label: String, val allow: Map<Int, String>, val need: List<Int>)

    val FAM = listOf(
        FamilyDef("maj", "메이저", mapOf(0 to "R", 2 to "9", 4 to "3", 6 to "#11", 7 to "5", 9 to "13", 11 to "7"), listOf(4)),
        FamilyDef("min", "마이너", mapOf(0 to "R", 2 to "9", 3 to "b3", 5 to "11", 7 to "5", 9 to "13", 10 to "b7"), listOf(3)),
        FamilyDef("dom", "도미넌트", mapOf(0 to "R", 1 to "b9", 2 to "9", 3 to "#9", 4 to "3", 6 to "#11", 7 to "5", 8 to "b13", 9 to "13", 10 to "b7"), listOf(4, 10)),
        FamilyDef("sus", "서스포", mapOf(0 to "R", 1 to "b9", 2 to "9", 5 to "4", 7 to "5", 9 to "13", 10 to "b7"), listOf(5)),
        FamilyDef("hd", "하프 디미니시", mapOf(0 to "R", 2 to "9", 3 to "b3", 5 to "11", 6 to "b5", 8 to "b13", 10 to "b7"), listOf(3, 6)),
        FamilyDef("dim", "디미니시", mapOf(0 to "R", 2 to "9", 3 to "b3", 5 to "11", 6 to "b5", 8 to "b13", 9 to "bb7", 11 to "△7"), listOf(3, 6, 9)),
    )

    private val ROLE = mapOf(
        "maj" to "I",
        "min" to "ii",
        "dom" to "V",
        "sus" to "V",
        "hd" to "iiø",
        "dim" to "경과",
    )

    private fun chordSuffix(fam: String, h: (Int) -> Boolean): String {
        var base = ""
        val t = mutableListOf<String>()
        when (fam) {
            "maj" -> {
                base = if (h(11)) "maj7" else if (h(9)) "6" else ""
                if (h(2)) t.add("9")
                if (h(6)) t.add("#11")
                if (h(9) && h(11)) t.add("13")
                if (base.isEmpty() && t.size == 1 && t[0] == "9") return "add9"
            }
            "min" -> {
                base = if (h(10)) "m7" else if (h(9)) "m6" else "m"
                if (h(2)) t.add("9")
                if (h(5)) t.add("11")
                if (h(9) && h(10)) t.add("13")
                if (base == "m" && t.size == 1 && t[0] == "9") return "madd9"
            }
            "dom" -> {
                base = "7"
                for ((i, l) in listOf(1 to "b9", 2 to "9", 3 to "#9", 6 to "#11", 8 to "b13", 9 to "13")) {
                    if (h(i)) t.add(l)
                }
            }
            "sus" -> {
                base = if (h(10)) "7sus4" else "sus4"
                for ((i, l) in listOf(1 to "b9", 2 to "9", 9 to "13")) {
                    if (h(i)) t.add(l)
                }
            }
            "hd" -> {
                base = if (h(10)) "m7(b5)" else "dim"
                for ((i, l) in listOf(2 to "9", 5 to "11", 8 to "b13")) {
                    if (h(i)) t.add(l)
                }
                if (base == "m7(b5)" && t.isNotEmpty()) return "m7(b5,${t.joinToString(",")})"
            }
            "dim" -> {
                base = "dim7"
                for ((i, l) in listOf(2 to "9", 5 to "11", 8 to "b13", 11 to "△7")) {
                    if (h(i)) t.add(l)
                }
            }
        }
        return base + if (t.isNotEmpty()) "(${t.joinToString(",")})" else ""
    }

    data class NoteInput(val s: Int, val f: Int, val pitch: Int)
    data class InterpretResult(
        val root: Int,
        val fam: String,
        val famLabel: String,
        val name: String,
        val rootless: Boolean,
        val tens: Int,
        val degs: List<String>,
        val role: String,
        val key: Int?,
        val keyMinor: Boolean,
    )

    fun interpret(notes: List<NoteInput>): List<InterpretResult> {
        val pcs = notes.map { pc(it.pitch) }.distinct()
        if (pcs.size < 2) return emptyList()
        val out = mutableListOf<InterpretResult>()
        val basicIvs = setOf(0, 3, 4, 5, 6, 7, 9, 10, 11)
        val domTensIvs = setOf(3, 6, 8, 9)
        for (r in 0 until 12) {
            val ivs = pcs.map { pc(it - r) }.toSet()
            val h: (Int) -> Boolean = { ivs.contains(it) }
            for (f in FAM) {
                if (!ivs.all { it in f.allow }) continue
                if (!f.need.all(h)) continue
                val suffix = chordSuffix(f.id, h)
                val tens = ivs.count { i -> !basicIvs.contains(i) || (f.id == "dom" && domTensIvs.contains(i)) }
                var role = ROLE.getValue(f.id)
                var key: Int? = null
                if (f.id == "maj") {
                    key = r
                    if (h(6)) role = "IV (리디안)"
                }
                if (f.id == "min") key = pc(r - 2)
                if (f.id == "dom" || f.id == "sus") key = pc(r - 7)
                if (f.id == "hd") key = pc(r - 2)
                out.add(
                    InterpretResult(
                        root = r,
                        fam = f.id,
                        famLabel = f.label,
                        name = NAMES[r] + suffix,
                        rootless = !h(0),
                        tens = tens,
                        degs = notes.map { n -> f.allow.getValue(pc(n.pitch - r)) },
                        role = role,
                        key = key,
                        keyMinor = f.id == "hd",
                    )
                )
            }
        }
        return out.sortedWith(compareBy<InterpretResult> { it.rootless }.thenBy { it.tens })
    }

    private val TOP_DEG = mapOf(
        0 to "R", 1 to "b9", 2 to "9", 3 to "#9", 4 to "3", 5 to "4 (sus)",
        6 to "#11", 7 to "5", 8 to "b13", 9 to "13", 10 to "b7", 11 to "maj7",
    )
    private val TOP_Q = mapOf<Int, String?>(
        0 to "7", 1 to "7b9", 2 to "9", 3 to "7#9", 4 to "7", 5 to "7sus4",
        6 to "7#11", 7 to "7", 8 to "7b13", 9 to "13", 10 to "7", 11 to null,
    )

    data class CircleStep(val i: Int, val root: Int, val iv: Int, val topPc: Int, val deg: String, val q: String?, val name: String)

    fun circleSteps(startRoot: Int, startIv: Int): List<CircleStep> {
        val topPc = pc(startRoot + startIv)
        return (0 until 12).map { i ->
            val root = pc(startRoot + 5 * i)
            val iv = pc(topPc - root)
            val q = TOP_Q[iv]
            CircleStep(
                i = i,
                root = root,
                iv = iv,
                topPc = topPc,
                deg = TOP_DEG.getValue(iv),
                q = q,
                name = NAMES[root] + (q ?: "maj7"),
            )
        }
    }

    data class ScaleDef(val id: String, val name: String, val iv: List<Int>, val deg: List<String>, val rel: Int)

    val SCALES = listOf(
        ScaleDef("major", "Major (Ionian)", listOf(0, 2, 4, 5, 7, 9, 11), listOf("1", "2", "3", "4", "5", "6", "7"), 0),
        ScaleDef("minor", "Natural Minor (Aeolian)", listOf(0, 2, 3, 5, 7, 8, 10), listOf("1", "2", "b3", "4", "5", "b6", "b7"), 3),
        ScaleDef("pentMaj", "Pentatonic Major", listOf(0, 2, 4, 7, 9), listOf("1", "2", "3", "5", "6"), 0),
        ScaleDef("pentMin", "Pentatonic Minor", listOf(0, 3, 5, 7, 10), listOf("1", "b3", "4", "5", "b7"), 3),
        ScaleDef("blues", "Blues", listOf(0, 3, 5, 6, 7, 10), listOf("1", "b3", "4", "b5", "5", "b7"), 3),
        ScaleDef("majBlues", "Major Blues", listOf(0, 2, 3, 4, 7, 9), listOf("1", "2", "b3", "3", "5", "6"), 0),
        ScaleDef("dorian", "Dorian", listOf(0, 2, 3, 5, 7, 9, 10), listOf("1", "2", "b3", "4", "5", "6", "b7"), 10),
        ScaleDef("phrygian", "Phrygian", listOf(0, 1, 3, 5, 7, 8, 10), listOf("1", "b2", "b3", "4", "5", "b6", "b7"), 8),
        ScaleDef("lydian", "Lydian", listOf(0, 2, 4, 6, 7, 9, 11), listOf("1", "2", "3", "#4", "5", "6", "7"), 7),
        ScaleDef("mixolydian", "Mixolydian", listOf(0, 2, 4, 5, 7, 9, 10), listOf("1", "2", "3", "4", "5", "6", "b7"), 5),
        ScaleDef("locrian", "Locrian", listOf(0, 1, 3, 5, 6, 8, 10), listOf("1", "b2", "b3", "4", "b5", "b6", "b7"), 1),
        ScaleDef("harmMinor", "Harmonic Minor", listOf(0, 2, 3, 5, 7, 8, 11), listOf("1", "2", "b3", "4", "5", "b6", "7"), 3),
        ScaleDef("melMinor", "Melodic Minor", listOf(0, 2, 3, 5, 7, 9, 11), listOf("1", "2", "b3", "4", "5", "6", "7"), 3),
        ScaleDef("wholeTone", "Whole Tone", listOf(0, 2, 4, 6, 8, 10), listOf("1", "2", "3", "#4", "#5", "b7"), 0),
    )
    val SCALE_BY = SCALES.associateBy { it.id }

    data class TuningDef(val id: String, val name: String, val open: List<Int>, val frets: Int)

    val TUNINGS = listOf(
        TuningDef("g6", "기타 (6현)", listOf(40, 45, 50, 55, 59, 64), 22),
        TuningDef("g7", "기타 (7현)", listOf(35, 40, 45, 50, 55, 59, 64), 22),
        TuningDef("b4", "베이스 (4현)", listOf(28, 33, 38, 43), 20),
        TuningDef("b5", "베이스 (5현)", listOf(23, 28, 33, 38, 43), 20),
    )
    val TUNING_BY = TUNINGS.associateBy { it.id }

    private val LETTERS = listOf("C", "D", "E", "F", "G", "A", "B")
    private val LETTER_PC = listOf(0, 2, 4, 5, 7, 9, 11)
    private val FLAT_KEYS = setOf(1, 3, 5, 6, 8, 10)

    data class ScaleNote(val pc: Int, val iv: Int, val deg: String, val name: String)
    data class ScaleInfoResult(val root: Int, val scale: ScaleDef, val rootName: String, val name: String, val notes: List<ScaleNote>)

    fun scaleInfo(rootPc: Int, scaleId: String): ScaleInfoResult {
        val sc = SCALE_BY[scaleId] ?: throw IllegalArgumentException("unknown scale $scaleId")
        val root = pc(rootPc)
        var li = LETTER_PC.indexOf(root)
        if (li < 0) {
            li = if (FLAT_KEYS.contains(pc(root + sc.rel))) LETTER_PC.indexOf(root + 1) else LETTER_PC.indexOf(root - 1)
        }
        val notes = sc.iv.mapIndexed { i, iv ->
            val p = pc(root + iv)
            val degNum = sc.deg[i].replace(Regex("\\D"), "").toInt()
            val l = (li + degNum - 1) % 7
            var acc = pc(p - LETTER_PC[l])
            if (acc > 6) acc -= 12
            val accStr = if (acc > 0) "#".repeat(acc) else "b".repeat(-acc)
            ScaleNote(p, iv, sc.deg[i], LETTERS[l] + accStr)
        }
        return ScaleInfoResult(root, sc, notes[0].name, "${notes[0].name} ${sc.name}", notes)
    }

    data class BoardNote(val s: Int, val f: Int, val pitch: Int, val deg: String, val name: String, val isRoot: Boolean)

    fun scaleOnBoard(rootPc: Int, scaleId: String, open: List<Int>, lo: Int, hi: Int): List<BoardNote> {
        val info = scaleInfo(rootPc, scaleId)
        val byPc = info.notes.associateBy { it.pc }
        val out = mutableListOf<BoardNote>()
        open.forEachIndexed { s, o ->
            for (f in lo..hi) {
                val n = byPc[pc(o + f)]
                if (n != null) {
                    out.add(BoardNote(s, f, o + f, n.deg, n.name, n.iv == 0))
                }
            }
        }
        return out
    }

    data class ScaleCircleEntry(
        val root: Int,
        val rootName: String,
        val name: String,
        val notes: List<ScaleNote>,
        val added: List<String>,
        val removed: List<String>,
    )

    fun scaleCircle(startRoot: Int, scaleId: String, dir: Int): List<ScaleCircleEntry> {
        val step = if (dir == -1) 5 else 7
        val keys = (0 until 12).map { i -> scaleInfo(pc(startRoot + step * i), scaleId) }
        return keys.mapIndexed { i, k ->
            val prev = keys[(i + 11) % 12]
            val prevPcs = prev.notes.map { it.pc }.toSet()
            val curPcs = k.notes.map { it.pc }.toSet()
            ScaleCircleEntry(
                root = k.root,
                rootName = k.rootName,
                name = k.name,
                notes = k.notes,
                added = k.notes.filter { !prevPcs.contains(it.pc) }.map { it.name },
                removed = prev.notes.filter { !curPcs.contains(it.pc) }.map { it.name },
            )
        }
    }
}

