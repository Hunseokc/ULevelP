package ulevelp.service

import io.ktor.http.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import org.jetbrains.exposed.sql.*
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import ulevelp.api.ApiException
import ulevelp.api.InvalidInputException
import ulevelp.api.NotFoundException
import ulevelp.db.DatabaseFactory
import ulevelp.db.ProgressionsTable
import ulevelp.note.ProgressionExtract
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.util.UUID

@Serializable
data class ProgressionDto(
    val id: String,
    val kind: String,
    val origin: String,
    val route: String,
    val evidence: String?,
    val title: String,
    val part: String,
    val artist: String,
    val album: String,
    val channel: String,
    val releaseDate: String?,
    val key: String?,
    val instrument: String?,
    val chords: JsonArray,
    val moods: List<String>,
    val genres: List<String>,
    val tags: List<String>,
    val url: String,
    val videoId: String?,
    val startSec: Int?,
    val endSec: Int?,
    val memo: String,
    val noteId: String?,
    val createdAt: String,
    val updatedAt: String
)

@Serializable
data class ProgressionEnvelope(val progression: ProgressionDto)

@Serializable
data class ProgressionListResponse(val progressions: List<ProgressionDto>)

@Serializable
data class NoteCollectResponse(val noteId: String, val collect: Boolean, val progressions: List<ProgressionDto>)

/**
 * 요청 본문에서 읽은 진행 필드. `present`에 든 이름만 보낸 것으로 본다(PATCH는 보낸 필드만 바꾼다).
 * 문자열 칸의 null은 빈 문자열, 목록 칸의 null은 빈 목록, 그 외 null은 "비움".
 */
data class ProgressionInput(
    val present: Set<String>,
    val kind: String? = null,
    val title: String? = null,
    val part: String = "",
    val artist: String = "",
    val album: String = "",
    val channel: String = "",
    val releaseDate: LocalDate? = null,
    val key: String? = null,
    val chords: JsonArray? = null,
    val moods: List<String> = emptyList(),
    val genres: List<String> = emptyList(),
    val tags: List<String> = emptyList(),
    val url: String = "",
    val startSec: Int? = null,
    val endSec: Int? = null,
    val memo: String = ""
)

/**
 * 코드 진행 모음 CRUD (`개발산출물/결과/CH-1b_설계.md` §2·§3).
 * 노션 outbox 적재는 CH-7에서 넣는다(워커가 progression을 처리하기 전에 쌓이지 않게).
 */
class ProgressionService(private val db: Database?) {
    private fun requireDb(): Database =
        db ?: throw ApiException(
            status = HttpStatusCode.ServiceUnavailable,
            code = "DB_UNAVAILABLE",
            message = "데이터베이스가 연결되어 있지 않습니다."
        )

    suspend fun list(userId: UUID, scope: String): List<ProgressionDto> {
        val database = requireDb()
        return DatabaseFactory.dbQuery(database) {
            val query = ProgressionsTable.selectAll().where { ProgressionsTable.userId eq userId }
            if (scope != SCOPE_ALL) {
                query.andWhere { ProgressionsTable.kind eq scope }
            }
            query.orderBy(ProgressionsTable.createdAt to SortOrder.DESC, ProgressionsTable.id to SortOrder.DESC)
                .map { rowToDto(it) }
        }
    }

    suspend fun create(userId: UUID, input: ProgressionInput): ProgressionDto {
        val database = requireDb()
        val kind = input.kind ?: throw InvalidInputException("kind 값이 필요합니다.")
        val title = input.title ?: throw InvalidInputException("title 값이 필요합니다.")
        val chords = input.chords ?: throw InvalidInputException("chords 값이 필요합니다.")
        checkRange(input.startSec, input.endSec)

        return DatabaseFactory.dbQuery(database) {
            val count = ProgressionsTable.selectAll().where { ProgressionsTable.userId eq userId }.count()
            if (count >= MAX_PER_USER) {
                throw InvalidInputException("코드 진행은 최대 ${MAX_PER_USER}개까지 저장할 수 있습니다.")
            }
            val newId = UUID.randomUUID()
            ProgressionsTable.insert {
                it[id] = newId
                it[ProgressionsTable.userId] = userId
                it[ProgressionsTable.kind] = kind
                it[origin] = "manual"
                it[route] = "manual"
                it[evidence] = null
                it[ProgressionsTable.title] = title
                it[part] = input.part
                it[artist] = input.artist
                it[album] = input.album
                it[channel] = input.channel
                it[releaseDate] = input.releaseDate
                it[key] = input.key
                it[instrument] = null
                it[ProgressionsTable.chords] = manualChords(chords)
                it[moods] = input.moods
                it[genres] = input.genres
                it[tags] = input.tags
                it[url] = input.url
                it[videoId] = youtubeVideoId(input.url)
                it[startSec] = input.startSec
                it[endSec] = input.endSec
                it[memo] = input.memo
            }
            loadOne(userId, newId)
        }
    }

    suspend fun update(userId: UUID, progressionId: UUID, input: ProgressionInput): ProgressionDto {
        val database = requireDb()
        if (input.present.isEmpty()) {
            throw InvalidInputException("수정할 값이 없습니다.")
        }
        val has = input.present
        return DatabaseFactory.dbQuery(database) {
            val row = ProgressionsTable.selectAll()
                .where { (ProgressionsTable.id eq progressionId) and (ProgressionsTable.userId eq userId) }
                .singleOrNull() ?: throw NotFoundException("코드 진행을 찾을 수 없습니다.")

            val route = row[ProgressionsTable.route]
            if ("kind" in has && input.kind == "reference" && route != "manual") {
                throw InvalidInputException("영상에서 온 진행은 레퍼런스로 바꿀 수 없습니다.")
            }
            val newStart = if ("startSec" in has) input.startSec else row[ProgressionsTable.startSec]
            val newEnd = if ("endSec" in has) input.endSec else row[ProgressionsTable.endSec]
            checkRange(newStart, newEnd)

            // 코드·키가 실제로 바뀌면 출처를 직접으로 (설계 §3-3)
            val oldChords = row[ProgressionsTable.chords] as? JsonArray ?: JsonArray(emptyList())
            val becomesManual = row[ProgressionsTable.origin] == "ai" && (
                ("chords" in has && stripSource(input.chords!!) != stripSource(oldChords)) ||
                    ("key" in has && input.key != row[ProgressionsTable.key])
                )
            val manualAfter = row[ProgressionsTable.origin] == "manual" || becomesManual

            ProgressionsTable.update({ (ProgressionsTable.id eq progressionId) and (ProgressionsTable.userId eq userId) }) {
                if ("kind" in has) it[kind] = input.kind!!
                if ("title" in has) it[title] = input.title!!
                if ("part" in has) it[part] = input.part
                if ("artist" in has) it[artist] = input.artist
                if ("album" in has) it[album] = input.album
                if ("channel" in has) it[channel] = input.channel
                if ("releaseDate" in has) it[releaseDate] = input.releaseDate
                if ("key" in has) it[key] = input.key
                if ("chords" in has) {
                    it[chords] = if (manualAfter) manualChords(input.chords!!) else keepAiSources(input.chords!!, oldChords)
                } else if (becomesManual) {
                    it[chords] = manualChords(oldChords)
                }
                if ("moods" in has) it[moods] = input.moods
                if ("genres" in has) it[genres] = input.genres
                if ("tags" in has) it[tags] = input.tags
                if ("url" in has) {
                    it[url] = input.url
                    it[videoId] = youtubeVideoId(input.url)
                }
                if ("startSec" in has) it[startSec] = input.startSec
                if ("endSec" in has) it[endSec] = input.endSec
                if ("memo" in has) it[memo] = input.memo
                if (becomesManual) {
                    it[origin] = "manual"
                    it[evidence] = null
                }
            }
            loadOne(userId, progressionId)
        }
    }

    suspend fun delete(userId: UUID, progressionId: UUID) {
        val database = requireDb()
        DatabaseFactory.dbQuery(database) {
            val deleted = ProgressionsTable.deleteWhere {
                (ProgressionsTable.id eq progressionId) and (ProgressionsTable.userId eq userId)
            }
            if (deleted == 0) {
                throw NotFoundException("코드 진행을 찾을 수 없습니다.")
            }
        }
    }

    private fun Transaction.loadOne(userId: UUID, progressionId: UUID): ProgressionDto =
        ProgressionsTable.selectAll()
            .where { (ProgressionsTable.id eq progressionId) and (ProgressionsTable.userId eq userId) }
            .singleOrNull()?.let { rowToDto(it) }
            ?: throw NotFoundException("코드 진행을 찾을 수 없습니다.")

    companion object {
        const val MAX_PER_USER = 3000
        const val SCOPE_ALL = "all"
        val SCOPES = setOf("reference", "analysis", SCOPE_ALL)
        val KINDS = setOf("reference", "analysis")
        private const val MAX_LABELS = 10
        private const val MAX_LABEL_LENGTH = 30
        private val KEY_RE = Regex("^[A-G](#|b)? (Major|min)$")
        private val DATE_RE = Regex("^\\d{4}-\\d{2}-\\d{2}$")
        private val URL_RE = Regex("^https?://\\S+$", RegexOption.IGNORE_CASE)
        private val YOUTUBE_HOST_RE = Regex("^https?://(?:[a-z0-9-]+\\.)*(?:youtube\\.com|youtu\\.be)(?:[/?#:]|$)", RegexOption.IGNORE_CASE)
        private val STRING_FIELDS = mapOf("part" to 100, "artist" to 200, "album" to 200, "channel" to 200, "memo" to 2000)
        val FIELDS = setOf(
            "kind", "title", "part", "artist", "album", "channel", "releaseDate", "key", "chords",
            "moods", "genres", "tags", "url", "startSec", "endSec", "memo"
        )

        private fun formatTs(t: OffsetDateTime): String = DateTimeFormatter.ISO_INSTANT.format(t.toInstant())

        fun rowToDto(row: ResultRow): ProgressionDto = ProgressionDto(
            id = row[ProgressionsTable.id].toString(),
            kind = row[ProgressionsTable.kind],
            origin = row[ProgressionsTable.origin],
            route = row[ProgressionsTable.route],
            evidence = row[ProgressionsTable.evidence],
            title = row[ProgressionsTable.title],
            part = row[ProgressionsTable.part],
            artist = row[ProgressionsTable.artist],
            album = row[ProgressionsTable.album],
            channel = row[ProgressionsTable.channel],
            releaseDate = row[ProgressionsTable.releaseDate]?.toString(),
            key = row[ProgressionsTable.key],
            instrument = row[ProgressionsTable.instrument],
            chords = row[ProgressionsTable.chords] as? JsonArray ?: JsonArray(emptyList()),
            moods = row[ProgressionsTable.moods],
            genres = row[ProgressionsTable.genres],
            tags = row[ProgressionsTable.tags],
            url = row[ProgressionsTable.url],
            videoId = row[ProgressionsTable.videoId],
            startSec = row[ProgressionsTable.startSec],
            endSec = row[ProgressionsTable.endSec],
            memo = row[ProgressionsTable.memo],
            noteId = row[ProgressionsTable.noteId]?.toString(),
            createdAt = formatTs(row[ProgressionsTable.createdAt]),
            updatedAt = formatTs(row[ProgressionsTable.updatedAt])
        )

        /** 노트에서 온 진행 행 생성. 이미 있는 순번(`note_prog_index`)은 건너뛴다. 반드시 트랜잭션 안에서 부른다 */
        fun Transaction.insertFromNote(userId: UUID, noteId: UUID, route: String, rows: List<ProgressionExtract.Row>) {
            val existing = ProgressionsTable.select(ProgressionsTable.noteProgIndex)
                .where { ProgressionsTable.noteId eq noteId }
                .mapNotNull { it[ProgressionsTable.noteProgIndex]?.toInt() }
                .toSet()
            for (r in rows) {
                if (r.index in existing || r.index > Short.MAX_VALUE) continue
                ProgressionsTable.insert {
                    it[ProgressionsTable.userId] = userId
                    it[kind] = "analysis"
                    it[origin] = "ai"
                    it[ProgressionsTable.route] = route
                    it[evidence] = r.evidence
                    it[title] = r.title
                    it[part] = r.part
                    it[artist] = r.artist
                    it[channel] = r.channel
                    it[key] = r.key
                    it[instrument] = r.instrument
                    it[chords] = r.chords
                    it[url] = r.url
                    it[videoId] = r.videoId
                    it[startSec] = r.startSec
                    it[endSec] = r.endSec
                    it[ProgressionsTable.noteId] = noteId
                    it[noteProgIndex] = r.index.toShort()
                }
            }
        }

        /** 그 노트에서 온 진행 행 (노트 안 순번 순) */
        fun Transaction.listByNote(userId: UUID, noteId: UUID): List<ProgressionDto> =
            ProgressionsTable.selectAll()
                .where { (ProgressionsTable.userId eq userId) and (ProgressionsTable.noteId eq noteId) }
                .orderBy(ProgressionsTable.noteProgIndex to SortOrder.ASC, ProgressionsTable.createdAt to SortOrder.ASC)
                .map { rowToDto(it) }

        fun youtubeVideoId(url: String): String? =
            if (YOUTUBE_HOST_RE.containsMatchIn(url)) ExportImportService.extractVideoId(url) else null

        private fun checkRange(start: Int?, end: Int?) {
            if (start != null && end != null && start >= end) {
                throw InvalidInputException("startSec는 endSec보다 작아야 합니다.")
            }
        }

        private fun stripSource(chords: JsonArray): JsonArray =
            JsonArray(chords.map { c -> JsonObject((c as JsonObject).filterKeys { it != "source" }) })

        /** 직접 행: 코드 source는 AI 근거라 저장하지 않는다 */
        private fun manualChords(chords: JsonArray): JsonArray = stripSource(chords)

        /** AI 행에서 코드가 그대로면(메모만 고침 등) 기존 source를 순서대로 다시 붙인다 */
        private fun keepAiSources(chords: JsonArray, old: JsonArray): JsonArray =
            JsonArray(chords.mapIndexed { i, c ->
                val src = ((old.getOrNull(i) as? JsonObject)?.get("source"))
                val base = (c as JsonObject).filterKeys { it != "source" }
                JsonObject(if (src != null) base + ("source" to src) else base)
            })

        private fun JsonObject.textField(name: String, maxLength: Int): String {
            val e = this[name] ?: return ""
            if (e is JsonNull) return ""
            if (e !is JsonPrimitive || !e.isString) throw InvalidInputException("$name 형식이 올바르지 않습니다.")
            val v = e.content.trim()
            if (v.length > maxLength) throw InvalidInputException("${name}은(는) ${maxLength}자 이하여야 합니다.")
            return v
        }

        private fun JsonObject.secField(name: String): Int? {
            val e = this[name] ?: return null
            if (e is JsonNull) return null
            val v = (e as? JsonPrimitive)?.takeIf { !it.isString }?.content?.toIntOrNull()
                ?: throw InvalidInputException("$name 형식이 올바르지 않습니다.")
            if (v !in 0..86400) throw InvalidInputException("${name}은(는) 0~86400 범위여야 합니다.")
            return v
        }

        private fun JsonObject.labelField(name: String): List<String> {
            val e = this[name] ?: return emptyList()
            if (e is JsonNull) return emptyList()
            if (e !is JsonArray) throw InvalidInputException("$name 형식이 올바르지 않습니다.")
            val out = LinkedHashSet<String>()
            for (item in e) {
                if (item !is JsonPrimitive || !item.isString) throw InvalidInputException("$name 형식이 올바르지 않습니다.")
                val v = item.content.trim()
                if (v.isEmpty() || v.length > MAX_LABEL_LENGTH || ',' in v) {
                    throw InvalidInputException("${name}의 각 값은 쉼표 없이 1~${MAX_LABEL_LENGTH}자여야 합니다.")
                }
                out.add(v)
            }
            if (out.size > MAX_LABELS) throw InvalidInputException("${name}은(는) 최대 ${MAX_LABELS}개까지 넣을 수 있습니다.")
            return out.toList()
        }

        /** chords 검증 (설계 §2-1): 1~64개 객체, symbol 필수 1~24자, roman ≤24자, source enum, timestamp mm:ss. 모르는 키는 버린다 */
        fun parseChords(e: JsonElement?): JsonArray {
            if (e == null || e is JsonNull) throw InvalidInputException("chords 값이 필요합니다.")
            if (e !is JsonArray || e.size !in 1..ProgressionExtract.MAX_CHORDS) {
                throw InvalidInputException("chords는 코드 1~${ProgressionExtract.MAX_CHORDS}개 배열이어야 합니다.")
            }
            return JsonArray(e.mapIndexed { i, item ->
                val c = item as? JsonObject ?: throw InvalidInputException("chords[$i] 형식이 올바르지 않습니다.")
                fun opt(name: String): String? {
                    val v = c[name] ?: return null
                    if (v is JsonNull) return null
                    if (v !is JsonPrimitive || !v.isString) throw InvalidInputException("chords[$i].$name 형식이 올바르지 않습니다.")
                    return v.content.trim()
                }
                val symbol = opt("symbol").orEmpty()
                if (symbol.isEmpty() || symbol.length > ProgressionExtract.MAX_SYMBOL) {
                    throw InvalidInputException("chords[$i].symbol은 1~${ProgressionExtract.MAX_SYMBOL}자여야 합니다.")
                }
                val roman = opt("roman").orEmpty()
                if (roman.length > ProgressionExtract.MAX_ROMAN) {
                    throw InvalidInputException("chords[$i].roman은 ${ProgressionExtract.MAX_ROMAN}자 이하여야 합니다.")
                }
                val source = opt("source").orEmpty()
                if (source.isNotEmpty() && source !in ProgressionExtract.SOURCES) {
                    throw InvalidInputException("chords[$i].source는 화면·말함·추정 중 하나여야 합니다.")
                }
                val timestamp = opt("timestamp").orEmpty()
                if (timestamp.isNotEmpty() && ProgressionExtract.parseTimestamp(timestamp) == null) {
                    throw InvalidInputException("chords[$i].timestamp는 mm:ss 형식이어야 합니다.")
                }
                buildJsonObject {
                    put("symbol", symbol)
                    put("roman", roman)
                    if (source.isNotEmpty()) put("source", source)
                    if (timestamp.isNotEmpty()) put("timestamp", timestamp)
                }
            })
        }

        /**
         * 요청 본문 → 입력. `forCreate`면 kind·title·chords 필수. 모르는 필드는 무시한다(목록에 없는 키는 `present`에 안 넣음).
         */
        fun parseInput(body: JsonObject, forCreate: Boolean): ProgressionInput {
            val present = body.keys.filter { it in FIELDS }.toSet()

            val kind = if ("kind" in present || forCreate) {
                val e = body["kind"]
                val v = (e as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim()
                if (v == null || v !in KINDS) throw InvalidInputException("kind는 reference 또는 analysis여야 합니다.")
                v
            } else null

            val title = if ("title" in present || forCreate) {
                val e = body["title"]
                val v = (e as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim()
                if (v.isNullOrEmpty()) throw InvalidInputException("title은 비워 둘 수 없습니다.")
                if (v.length > 300) throw InvalidInputException("title은(는) 300자 이하여야 합니다.")
                v
            } else null

            val chords = if ("chords" in present || forCreate) parseChords(body["chords"]) else null

            val strings = STRING_FIELDS.mapValues { (name, max) -> body.textField(name, max) }

            val releaseDate = body["releaseDate"].let { e ->
                if (e == null || e is JsonNull) null else {
                    val raw = (e as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim().orEmpty()
                    val d = if (DATE_RE.matches(raw)) runCatching { LocalDate.parse(raw) }.getOrNull() else null
                    if (d == null || d.year !in 1900..2100) throw InvalidInputException("releaseDate는 YYYY-MM-DD 형식이어야 합니다.")
                    d
                }
            }

            val key = body["key"].let { e ->
                if (e == null || e is JsonNull) null else {
                    val raw = (e as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim()
                    when {
                        raw == null -> throw InvalidInputException("key 형식이 올바르지 않습니다.")
                        raw.isEmpty() -> null
                        !KEY_RE.matches(raw) -> throw InvalidInputException("key는 \"F Major\"·\"A min\" 형식이어야 합니다.")
                        else -> raw
                    }
                }
            }

            val url = body.textField("url", 500)
            if (url.isNotEmpty() && !URL_RE.matches(url)) {
                throw InvalidInputException("url은 http:// 또는 https://로 시작해야 합니다.")
            }

            return ProgressionInput(
                present = present,
                kind = kind,
                title = title,
                part = strings.getValue("part"),
                artist = strings.getValue("artist"),
                album = strings.getValue("album"),
                channel = strings.getValue("channel"),
                releaseDate = releaseDate,
                key = key,
                chords = chords,
                moods = body.labelField("moods"),
                genres = body.labelField("genres"),
                tags = body.labelField("tags"),
                url = url,
                startSec = body.secField("startSec"),
                endSec = body.secField("endSec"),
                memo = strings.getValue("memo")
            )
        }
    }
}
