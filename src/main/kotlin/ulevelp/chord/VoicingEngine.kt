package ulevelp.chord

import kotlin.math.abs

object VoicingEngine {
    val OPEN = listOf(40, 45, 50, 55, 59, 64)
    val NAMES = listOf("C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B")

    fun pc(n: Int): Int = ((n % 12) + 12) % 12

    data class ToneDef(val deg: String, val iv: Int, val cls: String)

    val DEG: Map<String, Pair<Int, String>> = mapOf(
        "R" to (0 to "root"),
        "b9" to (1 to "ext"),
        "9" to (2 to "ext"),
        "#9" to (3 to "ext"),
        "b3" to (3 to "3"),
        "3" to (4 to "3"),
        "11" to (5 to "ext"),
        "#11" to (6 to "ext"),
        "b5" to (6 to "5"),
        "5" to (7 to "5"),
        "b13" to (8 to "ext"),
        "13" to (9 to "ext"),
        "6" to (9 to "7"),
        "b7" to (10 to "7"),
        "7" to (11 to "7"),
        "4" to (5 to "3"),
    )

    val CH: Map<String, List<String>> = linkedMapOf(
        "6" to listOf("R", "3", "5", "6"),
        "7" to listOf("R", "3", "5", "b7"),
        "9" to listOf("R", "3", "5", "b7", "9"),
        "13" to listOf("R", "3", "5", "b7", "13"),
        "maj7" to listOf("R", "3", "5", "7"),
        "maj9" to listOf("R", "3", "5", "7", "9"),
        "maj7s11" to listOf("R", "3", "5", "7", "#11"),
        "m7" to listOf("R", "b3", "5", "b7"),
        "m9" to listOf("R", "b3", "5", "b7", "9"),
        "m11" to listOf("R", "b3", "5", "b7", "11"),
        "m6" to listOf("R", "b3", "5", "6"),
        "m7b5" to listOf("R", "b3", "b5", "b7"),
        "7b9" to listOf("R", "3", "5", "b7", "b9"),
        "7#9" to listOf("R", "3", "5", "b7", "#9"),
        "7#11" to listOf("R", "3", "5", "b7", "#11"),
        "7b13" to listOf("R", "3", "5", "b7", "b13"),
        "7sus4" to listOf("R", "4", "5", "b7"),
    )

    val DOMS = listOf("7", "9", "13", "7b9", "7#9", "7#11", "7b13")

    fun chordTones(q: String): List<ToneDef> =
        CH.getValue(q).map { d ->
            val (iv, cls) = DEG.getValue(d)
            ToneDef(d, iv, cls)
        }

    fun chordName(root: Int, q: String): String = NAMES[pc(root)] + q

    private val PENT = mapOf(
        "min" to listOf(0, 3, 5, 7, 10),
        "maj" to listOf(0, 2, 4, 7, 9),
    )

    fun pentPcs(root: Int, type: String): List<Int> =
        PENT.getValue(type).map { pc(root + it) }

    data class TopTarget(val s: Int, val f: Int)

    data class VoicingOpts(
        val lo: Int = 1,
        val hi: Int = 12,
        val maxSpan: Int = 3,
        val minNotes: Int = 3,
        val maxNotes: Int = 4,
        val maxGap: Int = 1,
        val needGuide: Int = 2,
        val allowedPcs: List<Int>? = null,
        val outsideMax: Int = 99,
        val top: TopTarget? = null,
    )

    data class VoicingNote(
        val s: Int,
        val f: Int,
        val pitch: Int,
        val pc: Int,
        val deg: String,
        val cls: String,
    )

    data class Voicing(
        val root: Int,
        val q: String,
        val name: String,
        val score: Double,
        val span: Int,
        val outside: Int,
        val gaps: Int,
        val guide: Int,
        val top: Int,
        val avgFret: Double,
        val notes: List<VoicingNote>,
        val frets: List<Int>,
    )

    private data class StackNote(
        val s: Int,
        val f: Int,
        val pitch: Int,
        val pc: Int,
        val tone: ToneDef,
    )

    fun genVoicings(root: Int, q: String, opts: VoicingOpts = VoicingOpts()): List<Voicing> {
        val tones = chordTones(q)
        val byPc = mutableMapOf<Int, ToneDef>()
        for (t in tones) {
            byPc[pc(root + t.iv)] = t
        }
        val allowed = opts.allowedPcs?.toSet()
        val opt = Array(6) { mutableListOf<Int>() }
        for (s in 0 until 6) {
            if (opts.top != null && s > opts.top.s) continue
            for (f in opts.lo..opts.hi) {
                if (opts.top != null && s == opts.top.s && f != opts.top.f) continue
                if (byPc.containsKey(pc(OPEN[s] + f))) {
                    opt[s].add(f)
                }
            }
        }
        val out = mutableListOf<Voicing>()
        val notes = mutableListOf<StackNote>()
        val used = mutableSetOf<Int>()

        fun finalizeVoicing() {
            if (notes.size < opts.minNotes) return
            if (opts.top != null && notes.last().s != opts.top.s) return
            val cls = notes.map { it.tone.cls }.toSet()
            val guide = (if (cls.contains("3")) 1 else 0) + (if (cls.contains("7")) 1 else 0)
            if (guide < opts.needGuide) return
            val defTone = tones.last()
            if (defTone.cls == "ext" && notes.none { it.tone.deg == defTone.deg }) return
            val outside = if (allowed != null) notes.count { !allowed.contains(it.pc) } else 0
            if (outside > opts.outsideMax) return
            val fr = notes.filter { it.f > 0 }.map { it.f }
            val span = if (fr.isNotEmpty()) fr.max() - fr.min() else 0
            var sc = 0.0
            for (n in notes) {
                sc += when (n.tone.cls) {
                    "root" -> 1.0
                    "3" -> 3.0
                    "7" -> 3.0
                    "5" -> 0.7
                    "ext" -> 1.2
                    else -> 0.0
                }
            }
            sc += notes.size * 0.5 - outside * 1.5 - span * 0.35
            var gaps = 0
            for (i in 1 until notes.size) {
                gaps += notes[i].s - notes[i - 1].s - 1
                if (abs(notes[i].pitch - notes[i - 1].pitch) == 1) sc -= 1.0
            }
            sc -= gaps * 0.5
            val top = notes.last().pitch
            sc -= 0.12 * abs(top - 70)
            out.add(
                Voicing(
                    root = root,
                    q = q,
                    name = chordName(root, q),
                    score = sc,
                    span = span,
                    outside = outside,
                    gaps = gaps,
                    guide = guide,
                    top = top,
                    avgFret = if (fr.isNotEmpty()) fr.sum().toDouble() / fr.size else 0.0,
                    notes = notes.map { VoicingNote(it.s, it.f, it.pitch, it.pc, it.tone.deg, it.tone.cls) },
                    frets = (0 until 6).map { s -> notes.find { it.s == s }?.f ?: -1 },
                )
            )
        }

        fun dfs(s: Int, skipped: Int, gaps: Int) {
            if (s == 6) {
                finalizeVoicing()
                return
            }
            if (notes.isEmpty()) dfs(s + 1, 0, gaps)
            else dfs(s + 1, skipped + 1, gaps)
            if (notes.size >= opts.maxNotes) return
            for (f in opt[s]) {
                var ng = gaps
                if (notes.isNotEmpty()) {
                    if (skipped > 1) continue
                    ng = gaps + skipped
                    if (ng > opts.maxGap) continue
                }
                val pitch = OPEN[s] + f
                val p = pc(pitch)
                if (used.contains(p)) continue
                val fr = buildList {
                    for (n in notes) if (n.f > 0) add(n.f)
                    if (f > 0) add(f)
                }
                if (fr.isNotEmpty() && fr.max() - fr.min() > opts.maxSpan) continue
                notes.add(StackNote(s, f, pitch, p, byPc.getValue(p)))
                used.add(p)
                dfs(s + 1, 0, ng)
                notes.removeAt(notes.lastIndex)
                used.remove(p)
            }
        }

        dfs(0, 0, 0)
        return out
    }

    private fun pitchOf(v: Voicing, cls: String): Int? = v.notes.find { it.cls == cls }?.pitch

    private fun trans(a: Voicing, b: Voicing): Double {
        var c = 0.0
        val p7 = pitchOf(a, "7")
        val p3 = pitchOf(b, "3")
        c += if (p7 == null || p3 == null) 3.0 else abs(p7 - p3).toDouble()
        c += 0.5 * abs(a.top - b.top)
        c += 0.5 * abs(a.avgFret - b.avgFret)
        return c
    }

    private val SLOTS = mapOf(
        "major" to mapOf("ii" to listOf("m7", "m9", "m11"), "V" to DOMS, "I" to listOf("maj7", "maj9", "6", "maj7s11")),
        "minor" to mapOf("ii" to listOf("m7b5"), "V" to DOMS, "I" to listOf("m7", "m6", "m9")),
    )
    private val BASIC = mapOf(
        "major" to mapOf("ii" to listOf("m7"), "V" to listOf("7"), "I" to listOf("maj7")),
        "minor" to mapOf("ii" to listOf("m7b5"), "V" to listOf("7"), "I" to listOf("m7")),
    )

    data class PentSpec(val root: Int, val type: String)
    data class Search251Opts(
        val kind: String = "major",
        val keys: List<Int>? = null,
        val lo: Int = 5,
        val hi: Int = 8,
        val pent: PentSpec? = null,
        val outsideMax: Int = 1,
        val needGuide: Int = 2,
        val variants: Boolean = false,
        val perKey: Int = 3,
        val topK: Int = 45,
        val maxSpan: Int = 3,
        val minNotes: Int = 3,
        val maxNotes: Int = 4,
    )

    data class Path251(val total: Double, val cost: Double, val chords: List<Voicing>)
    data class Key251Result(val key: Int, val paths: List<Path251>)

    fun search251(o: Search251Opts): List<Key251Result> {
        val kind = o.kind
        val keys = o.keys ?: (0 until 12).toList()
        val slots = (if (o.variants) SLOTS else BASIC).getValue(kind)
        val vopt = VoicingOpts(
            lo = o.lo,
            hi = o.hi,
            maxSpan = o.maxSpan,
            minNotes = o.minNotes,
            maxNotes = o.maxNotes,
            needGuide = o.needGuide,
            outsideMax = o.outsideMax,
            allowedPcs = o.pent?.let { pentPcs(it.root, it.type) },
        )
        val results = mutableListOf<Key251Result>()
        for (k in keys) {
            val roots = mapOf("ii" to pc(k + 2), "V" to pc(k + 7), "I" to pc(k))
            val cand = mutableMapOf<String, List<Voicing>>()
            for (sl in listOf("ii", "V", "I")) {
                val all = mutableListOf<Voicing>()
                for (q in slots.getValue(sl)) {
                    all.addAll(genVoicings(roots.getValue(sl), q, vopt))
                }
                cand[sl] = all.sortedByDescending { it.score }.take(o.topK)
            }
            val cII = cand.getValue("ii")
            val cV = cand.getValue("V")
            val cI = cand.getValue("I")
            if (cII.isEmpty() || cV.isEmpty() || cI.isEmpty()) {
                results.add(Key251Result(k, emptyList()))
                continue
            }
            val paths = mutableListOf<Path251>()
            for (a in cII) {
                for (b in cV) {
                    val t1 = trans(a, b)
                    for (c in cI) {
                        val t2 = trans(b, c)
                        paths.add(Path251(a.score + b.score + c.score - (t1 + t2), t1 + t2, listOf(a, b, c)))
                    }
                }
            }
            val sortedPaths = paths.sortedByDescending { it.total }
            val picked = mutableListOf<Path251>()
            val seen = mutableSetOf<String>()
            for (p in sortedPaths) {
                val sig2 = p.chords[1].frets.joinToString(",")
                if (seen.contains(sig2)) continue
                seen.add(sig2)
                picked.add(p)
                if (picked.size >= o.perKey) break
            }
            results.add(Key251Result(k, picked))
        }
        return results
    }

    data class TopNoteOpts(
        val s: Int,
        val f: Int,
        val maxSpan: Int = 3,
        val minNotes: Int = 3,
        val maxNotes: Int = 4,
        val needGuide: Int = 2,
        val perChord: Int = 3,
        val allowOpen: Boolean = false,
        val qualities: List<String>? = null,
    )

    data class TopNoteChordResult(
        val root: Int,
        val q: String,
        val name: String,
        val topDeg: String,
        val voicings: List<Voicing>,
        val count: Int,
    )

    fun topNoteDominants(o: TopNoteOpts): List<TopNoteChordResult> {
        val s = o.s
        val f = o.f
        val topPc = pc(OPEN[s] + f)
        val quals = o.qualities ?: DOMS
        val res = mutableListOf<TopNoteChordResult>()
        for (root in 0 until 12) {
            for (q in quals) {
                if (CH.getValue(q).none { d -> pc(root + DEG.getValue(d).first) == topPc }) continue
                val vs = genVoicings(
                    root,
                    q,
                    VoicingOpts(
                        lo = maxOf(if (o.allowOpen) 0 else 1, f - o.maxSpan),
                        hi = f + o.maxSpan,
                        maxSpan = o.maxSpan,
                        minNotes = o.minNotes,
                        maxNotes = o.maxNotes,
                        needGuide = o.needGuide,
                        top = TopTarget(s, f),
                    )
                ).sortedByDescending { it.score }
                if (vs.isNotEmpty()) {
                    val topDeg = vs[0].notes.last().deg
                    res.add(
                        TopNoteChordResult(
                            root = root,
                            q = q,
                            name = chordName(root, q),
                            topDeg = topDeg,
                            voicings = vs.take(o.perChord),
                            count = vs.size,
                        )
                    )
                }
            }
        }
        return res
    }

    fun fretStr(v: Voicing): String = v.frets.joinToString(" ") { if (it < 0) "x" else it.toString() }
}

