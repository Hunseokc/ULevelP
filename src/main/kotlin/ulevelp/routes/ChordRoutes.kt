package ulevelp.routes

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.json.*
import ulevelp.chord.ChordTheory as CT
import ulevelp.chord.VoicingEngine as GE
import kotlin.math.round

class BadRequestException(override val message: String) : RuntimeException(message)

object ChordApi {
    val API_LIST = listOf(
        "/api/health",
        "/api/voicings",
        "/api/two-five-one",
        "/api/top-note",
        "/api/circle",
        "/api/matrix",
        "/api/scale",
        "/api/interpret",
    )

    private val NOTE_MAP = mapOf(
        "C" to 0, "C#" to 1, "DB" to 1, "D" to 2, "D#" to 3, "EB" to 3,
        "E" to 4, "F" to 5, "F#" to 6, "GB" to 6, "G" to 7, "G#" to 8,
        "AB" to 8, "A" to 9, "A#" to 10, "BB" to 10, "B" to 11,
    )

    fun noteParam(v: String?, name: String): Int {
        if (v.isNullOrEmpty()) {
            throw BadRequestException("$name 값이 필요합니다 (0~11 또는 C, Db, F# 같은 음이름)")
        }
        if (v.matches(Regex("^\\d+$"))) {
            val n = v.toIntOrNull()
            if (n != null && n in 0 until 12) return n
        }
        val k = v.trim().uppercase()
        NOTE_MAP[k]?.let { return it }
        throw BadRequestException("$name=$v 를 음이름으로 읽을 수 없습니다")
    }

    fun intParam(v: String?, name: String, def: Int, lo: Int, hi: Int): Int {
        if (v.isNullOrEmpty()) return def
        val n = v.toIntOrNull()
        if (n == null || n < lo || n > hi) {
            throw BadRequestException("$name 는 $lo~$hi 사이 정수여야 합니다")
        }
        return n
    }

    fun stringParam(v: String?, name: String, def: Int): Int {
        val n = intParam(v, name, def, 1, 6)
        return 6 - n
    }

    private fun numJson(v: Double): JsonPrimitive {
        val rounded = round(v * 100.0) / 100.0
        return if (rounded == rounded.toLong().toDouble()) {
            JsonPrimitive(rounded.toLong())
        } else {
            JsonPrimitive(rounded)
        }
    }

    private fun slimVoicing(v: GE.Voicing): JsonObject = buildJsonObject {
        put("chord", v.name)
        put("frets", GE.fretStr(v))
        putJsonArray("degrees") { v.notes.forEach { add(it.deg) } }
        put("score", numJson(v.score))
    }

    private fun fretStr(notes: List<CT.PlacedNote>): String =
        (0..5).joinToString(" ") { s ->
            val n = notes.find { it.s == s }
            n?.f?.toString() ?: "x"
        }

    fun health(): JsonObject = buildJsonObject {
        put("ok", true)
    }

    fun voicings(q: Parameters): JsonObject {
        val root = noteParam(q["root"], "root")
        val quality = q["quality"].takeUnless { it.isNullOrEmpty() } ?: "7"
        if (!GE.CH.containsKey(quality)) {
            throw BadRequestException("quality 는 ${GE.CH.keys.joinToString(", ")} 중 하나")
        }
        val list = GE.genVoicings(
            root,
            quality,
            GE.VoicingOpts(
                lo = intParam(q["lo"], "lo", 1, 0, 20),
                hi = intParam(q["hi"], "hi", 12, 0, 22),
                maxSpan = intParam(q["span"], "span", 3, 1, 6),
                maxNotes = intParam(q["notes"], "notes", 4, 3, 6),
                needGuide = intParam(q["guide"], "guide", 2, 0, 2),
            )
        ).sortedByDescending { it.score }
            .take(intParam(q["limit"], "limit", 30, 1, 500))

        return buildJsonObject {
            put("chord", GE.chordName(root, quality))
            put("count", list.size)
            putJsonArray("voicings") { list.forEach { add(slimVoicing(it)) } }
        }
    }

    fun twoFiveOne(q: Parameters): JsonArray {
        val pentParam = q["pent"]
        val pent = if (!pentParam.isNullOrEmpty()) {
            GE.PentSpec(
                root = noteParam(pentParam, "pent"),
                type = if (q["pentType"] == "maj") "maj" else "min",
            )
        } else null
        val keyParam = q["key"]
        val keys = if (!keyParam.isNullOrEmpty()) listOf(noteParam(keyParam, "key")) else null
        val res = GE.search251(
            GE.Search251Opts(
                kind = if (q["kind"] == "minor") "minor" else "major",
                keys = keys,
                lo = intParam(q["lo"], "lo", 5, 0, 20),
                hi = intParam(q["hi"], "hi", 8, 0, 22),
                pent = pent,
                outsideMax = if (pent != null) intParam(q["outside"], "outside", 2, 0, 4) else 99,
                needGuide = intParam(q["guide"], "guide", 2, 1, 2),
                variants = q["variants"] == "1",
                perKey = 3,
            )
        )
        return buildJsonArray {
            for (k in res) {
                addJsonObject {
                    put("key", CT.NAMES[k.key])
                    putJsonArray("paths") {
                        for (p in k.paths) {
                            addJsonObject {
                                put("score", numJson(p.total))
                                putJsonArray("chords") { p.chords.forEach { add(slimVoicing(it)) } }
                            }
                        }
                    }
                }
            }
        }
    }

    fun topNote(q: Parameters): JsonObject {
        val s = stringParam(q["string"], "string", 1)
        if (s < 3) throw BadRequestException("string 은 1~3번줄만 지원합니다")
        val f = intParam(q["fret"], "fret", 8, 1, 19)
        val res = GE.topNoteDominants(
            GE.TopNoteOpts(
                s = s,
                f = f,
                maxSpan = intParam(q["span"], "span", 3, 2, 5),
                maxNotes = intParam(q["notes"], "notes", 4, 3, 5),
                perChord = 3,
            )
        )
        return buildJsonObject {
            put("top", CT.NAMES[CT.pc(CT.OPEN[s] + f)])
            put("string", 6 - s)
            put("fret", f)
            putJsonArray("chords") {
                for (c in res) {
                    addJsonObject {
                        put("name", c.name)
                        put("topDegree", c.topDeg)
                        put("count", c.count)
                        putJsonArray("voicings") { c.voicings.forEach { add(slimVoicing(it)) } }
                    }
                }
            }
        }
    }

    fun circle(q: Parameters): JsonArray {
        val root = noteParam(q["root"].takeUnless { it.isNullOrEmpty() } ?: "F", "root")
        val iv = intParam(q["top"], "top", 2, 0, 11)
        val steps = CT.circleSteps(root, iv)
        return buildJsonArray {
            for (s in steps) {
                addJsonObject {
                    put("chord", if (s.q != null) s.name else CT.NAMES[s.root] + "7")
                    put("root", CT.NAMES[s.root])
                    put("topDegree", s.deg)
                    put("possible", s.q != null)
                }
            }
        }
    }

    fun matrix(q: Parameters): JsonArray {
        val root = noteParam(q["root"].takeUnless { it.isNullOrEmpty() } ?: "C", "root")
        val drop = q["drop"].takeUnless { it.isNullOrEmpty() } ?: "d2"
        if (CT.DROPS.none { it.id == drop }) {
            throw BadRequestException("drop 은 ${CT.DROPS.joinToString(", ") { it.id }} 중 하나")
        }
        val inv = intParam(q["inv"], "inv", 0, 0, 3)
        val span = intParam(q["span"], "span", 4, 2, 6)
        val st = CT.dropStructure(drop).getValue(inv)
        val sets = CT.playableSets(drop, inv, root, span)
        return buildJsonArray {
            for (s in sets) {
                val r0 = s.placements[0].r0
                addJsonObject {
                    put("strings", s.label)
                    put("allQualities", s.full)
                    putJsonArray("qualities") {
                        for (qq in CT.Q4) {
                            val a = CT.atR0(st, s.set, r0, qq.id)
                            addJsonObject {
                                put("chord", CT.NAMES[root] + qq.name)
                                put("frets", fretStr(a.notes))
                                putJsonArray("degrees") { a.notes.forEach { add(it.deg) } }
                                put("playable", a.valid && a.span <= span)
                            }
                        }
                    }
                }
            }
        }
    }

    fun scale(q: Parameters): JsonElement {
        val root = noteParam(q["root"].takeUnless { it.isNullOrEmpty() } ?: "C", "root")
        val type = q["type"].takeUnless { it.isNullOrEmpty() } ?: "major"
        if (!CT.SCALE_BY.containsKey(type)) {
            throw BadRequestException("type 은 ${CT.SCALES.joinToString(", ") { it.id }} 중 하나")
        }
        val circle = q["circle"]?.takeUnless { it.isEmpty() }
        if (circle != null) {
            if (circle != "5" && circle != "4") {
                throw BadRequestException("circle 은 5 또는 4")
            }
            val list = CT.scaleCircle(root, type, if (circle == "4") -1 else 1)
            return buildJsonArray {
                for (k in list) {
                    addJsonObject {
                        put("name", k.name)
                        putJsonArray("notes") { k.notes.forEach { add(it.name) } }
                        putJsonArray("added") { k.added.forEach { add(it) } }
                        putJsonArray("removed") { k.removed.forEach { add(it) } }
                    }
                }
            }
        }
        val tuningId = q["tuning"].takeUnless { it.isNullOrEmpty() } ?: "g6"
        val tuning = CT.TUNING_BY[tuningId]
            ?: throw BadRequestException("tuning 은 ${CT.TUNINGS.joinToString(", ") { it.id }} 중 하나")
        val lo = intParam(q["lo"], "lo", 0, 0, tuning.frets)
        val hi = intParam(q["hi"], "hi", 12, lo, tuning.frets)
        val info = CT.scaleInfo(root, type)
        val positions = CT.scaleOnBoard(root, type, tuning.open, lo, hi)
        return buildJsonObject {
            put("name", info.name)
            putJsonArray("notes") {
                for (n in info.notes) {
                    addJsonObject {
                        put("name", n.name)
                        put("degree", n.deg)
                    }
                }
            }
            putJsonArray("positions") {
                for (n in positions) {
                    addJsonObject {
                        put("string", tuning.open.size - n.s)
                        put("fret", n.f)
                        put("note", n.name)
                        put("degree", n.deg)
                    }
                }
            }
        }
    }

    fun interpret(q: Parameters): JsonArray {
        val raw = (q["frets"] ?: "").split(Regex("[,\\s]+")).filter { it.isNotEmpty() }
        if (raw.size != 6) {
            throw BadRequestException("frets 는 6번줄부터 6개 값입니다. 예: x,x,4,2,2,4")
        }
        val notes = raw.mapIndexedNotNull { s, v ->
            if (v.equals("x", ignoreCase = true)) {
                null
            } else {
                val f = v.toIntOrNull()
                if (f == null || f !in 0..22) {
                    throw BadRequestException("frets 값은 0~22 또는 x")
                }
                CT.NoteInput(s, f, CT.OPEN[s] + f)
            }
        }
        val res = CT.interpret(notes)
        return buildJsonArray {
            for (x in res) {
                addJsonObject {
                    put("chord", x.name)
                    put("family", x.famLabel)
                    put("role", x.role)
                    if (x.key != null) {
                        put("key", CT.NAMES[x.key] + if (x.keyMinor) "m" else "")
                    } else {
                        put("key", JsonNull)
                    }
                    put("rootless", x.rootless)
                    putJsonArray("degrees") { x.degs.forEach { add(it) } }
                }
            }
        }
    }
}

private suspend fun ApplicationCall.respondNoStoreJson(status: HttpStatusCode, element: JsonElement) {
    response.headers.append(HttpHeaders.CacheControl, "no-store")
    respond(status, element)
}

fun Route.registerChordRoutes() {
    get("/api/health") {
        call.respondNoStoreJson(HttpStatusCode.OK, ChordApi.health())
    }
    get("/api/voicings") {
        call.respondNoStoreJson(HttpStatusCode.OK, ChordApi.voicings(call.request.queryParameters))
    }
    get("/api/two-five-one") {
        call.respondNoStoreJson(HttpStatusCode.OK, ChordApi.twoFiveOne(call.request.queryParameters))
    }
    get("/api/top-note") {
        call.respondNoStoreJson(HttpStatusCode.OK, ChordApi.topNote(call.request.queryParameters))
    }
    get("/api/circle") {
        call.respondNoStoreJson(HttpStatusCode.OK, ChordApi.circle(call.request.queryParameters))
    }
    get("/api/matrix") {
        call.respondNoStoreJson(HttpStatusCode.OK, ChordApi.matrix(call.request.queryParameters))
    }
    get("/api/scale") {
        call.respondNoStoreJson(HttpStatusCode.OK, ChordApi.scale(call.request.queryParameters))
    }
    get("/api/interpret") {
        call.respondNoStoreJson(HttpStatusCode.OK, ChordApi.interpret(call.request.queryParameters))
    }
}

