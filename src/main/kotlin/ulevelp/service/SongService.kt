package ulevelp.service

import io.ktor.http.*
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import org.jetbrains.exposed.sql.*
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import org.jetbrains.exposed.sql.SqlExpressionBuilder.inList
import ulevelp.api.ApiException
import ulevelp.api.NotFoundException
import ulevelp.db.*
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.UUID

@Serializable
data class SongDto(
    val id: String,
    val title: String,
    val artist: String,
    val status: String,
    val statusCode: String,
    val videoId: String,
    val pos: Double?,
    val a: Double?,
    val b: Double?,
    val rate: Double,
    val lastDate: String?,
    val memo: String,
    val totalSeconds: Long,
    val resumeUrl: String
)

@Serializable
data class SongEnvelope(val song: SongDto?)

@Serializable
data class SongListResponse(val songs: List<SongDto>)

@Serializable
data class MigrateLocalResponse(
    val created: Int,
    val skipped: Int,
    val migratedLocalAt: String?
)

data class CreateSongInput(
    val videoId: String,
    val title: String,
    val artist: String,
    val rate: BigDecimal
)

data class CreateSongResult(
    val song: SongDto,
    val created: Boolean
)

data class UpdateSongInput(
    val statusCode: String?,
    val memo: String?,
    val title: String?
)

data class LocalSongItem(
    val videoId: String,
    val pos: BigDecimal?,
    val a: BigDecimal?,
    val b: BigDecimal?,
    val rate: BigDecimal,
    val date: LocalDate?
)

private val DATE_REGEX = Regex("^\\d{4}-\\d{2}-\\d{2}$")
private val MIN_DATE = LocalDate.of(2000, 1, 1)

class SongService(
    private val db: Database?,
    private val videoMetaClient: VideoMetaClient,
    private val publicAppUrl: String
) {
    private fun requireDb(): Database =
        db ?: throw ApiException(
            status = HttpStatusCode.ServiceUnavailable,
            code = "DB_UNAVAILABLE",
            message = "데이터베이스가 연결되어 있지 않습니다."
        )

    private fun formatTimestamp(dt: OffsetDateTime): String =
        DateTimeFormatter.ISO_INSTANT.format(dt.toInstant())

    private fun Transaction.loadSongDto(userId: UUID, songId: UUID? = null, videoId: String? = null): SongDto? {
        val query = SongsTable.selectAll().where { SongsTable.userId eq userId }
        if (songId != null) {
            query.andWhere { SongsTable.id eq songId }
        }
        if (videoId != null) {
            query.andWhere { SongsTable.videoId eq videoId }
        }
        val row = query.singleOrNull() ?: return null

        val actualSongId = row[SongsTable.id]
        val sumExpr = SessionsTable.seconds.sum()
        val totalSec = SessionsTable
            .select(sumExpr)
            .where { (SessionsTable.userId eq userId) and (SessionsTable.songId eq actualSongId) }
            .singleOrNull()
            ?.get(sumExpr)?.toLong() ?: 0L

        return rowToDto(row, totalSec)
    }

    suspend fun list(userId: UUID, statusCode: String?): List<SongDto> {
        val database = requireDb()
        return DatabaseFactory.dbQuery(database) {
            val query = SongsTable.selectAll().where { SongsTable.userId eq userId }
            if (statusCode != null) {
                query.andWhere { SongsTable.status eq statusCode }
            }
            val songRows = query.toList()

            val sumExpr = SessionsTable.seconds.sum()
            val totalSecondsMap = SessionsTable
                .select(SessionsTable.songId, sumExpr)
                .where { SessionsTable.userId eq userId }
                .groupBy(SessionsTable.songId)
                .associate { it[SessionsTable.songId] to (it[sumExpr]?.toLong() ?: 0L) }

            val statusOrder = mapOf("practicing" to 0, "paused" to 1, "done" to 2)

            songRows.sortedWith(
                compareBy<ResultRow> { statusOrder[it[SongsTable.status]] ?: 99 }
                    .thenBy(Comparator.nullsLast(Comparator.reverseOrder())) { it[SongsTable.lastDate] }
                    .thenByDescending { it[SongsTable.updatedAt] }
            ).map { row ->
                val songId = row[SongsTable.id]
                val totalSec = totalSecondsMap[songId] ?: 0L
                rowToDto(row, totalSec)
            }
        }
    }

    suspend fun findByVideo(userId: UUID, videoId: String): SongDto? {
        val database = requireDb()
        return DatabaseFactory.dbQuery(database) {
            loadSongDto(userId = userId, videoId = videoId)
        }
    }

    suspend fun create(userId: UUID, input: CreateSongInput): CreateSongResult {
        val database = requireDb()

        // 1. 트랜잭션 A: 이미 존재하는 곡 확인 (있으면 oEmbed 호출하지 않고 바로 반환)
        val existing = DatabaseFactory.dbQuery(database) {
            loadSongDto(userId = userId, videoId = input.videoId)
        }
        if (existing != null) {
            return CreateSongResult(song = existing, created = false)
        }

        // 2. 트랜잭션 밖: title이 빈 문자열이면 oEmbed 조회
        val finalTitle: String
        val finalArtist: String
        if (input.title.isEmpty()) {
            val meta = videoMetaClient.fetch(input.videoId)
            finalTitle = meta?.title ?: UNTITLED
            finalArtist = input.artist.ifEmpty { meta?.author ?: "" }
        } else {
            finalTitle = input.title
            finalArtist = input.artist
        }

        // 3. 트랜잭션 B: insertIgnore 실행
        return DatabaseFactory.dbQuery(database) {
            val newId = UUID.randomUUID()
            val insertedCount = SongsTable.insertIgnore {
                it[id] = newId
                it[SongsTable.userId] = userId
                it[title] = finalTitle
                it[artist] = finalArtist
                it[videoId] = input.videoId
                it[rate] = input.rate
            }.insertedCount

            if (insertedCount == 1) {
                OutboxRepository.enqueueIfSyncEnabled(userId, "song", newId, "upsert")
                val row = SongsTable.selectAll().where { SongsTable.id eq newId }.single()
                CreateSongResult(song = rowToDto(row, 0L), created = true)
            } else {
                val song = loadSongDto(userId = userId, videoId = input.videoId)
                    ?: error("Failed to load existing song after insertIgnore collision")
                CreateSongResult(song = song, created = false)
            }
        }
    }

    suspend fun update(userId: UUID, songId: UUID, input: UpdateSongInput): SongDto {
        val database = requireDb()
        return DatabaseFactory.dbQuery(database) {
            val updatedCount = SongsTable.update({ (SongsTable.id eq songId) and (SongsTable.userId eq userId) }) {
                if (input.statusCode != null) it[status] = input.statusCode
                if (input.memo != null) it[memo] = input.memo
                if (input.title != null) it[title] = input.title
            }
            if (updatedCount == 0) {
                throw NotFoundException("곡을 찾을 수 없습니다.")
            }

            OutboxRepository.enqueueIfSyncEnabled(userId, "song", songId, "upsert")

            loadSongDto(userId = userId, songId = songId)
                ?: throw NotFoundException("곡을 찾을 수 없습니다.")
        }
    }

    suspend fun delete(userId: UUID, songId: UUID): List<Long> {
        val database = requireDb()
        return DatabaseFactory.dbQuery(database) {
            val exists = SongsTable.selectAll()
                .where { (SongsTable.id eq songId) and (SongsTable.userId eq userId) }
                .count() > 0L
            if (!exists) {
                throw NotFoundException("곡을 찾을 수 없습니다.")
            }

            val supabaseStorageKeys = TakesTable
                .select(TakesTable.storageKey)
                .where { (TakesTable.userId eq userId) and (TakesTable.songId eq songId) and (TakesTable.storage eq "supabase") }
                .map { it[TakesTable.storageKey] }

            val trashIds = mutableListOf<Long>()
            for (storageKey in supabaseStorageKeys) {
                val trashId = StorageTrashTable.insert {
                    it[StorageTrashTable.storageKey] = storageKey
                } get StorageTrashTable.id
                trashIds.add(trashId)
            }

            val sessionIds = SessionsTable
                .select(SessionsTable.id)
                .where { (SessionsTable.userId eq userId) and (SessionsTable.songId eq songId) }
                .map { it[SessionsTable.id] }

            OutboxRepository.enqueueIfSyncEnabled(userId, "song", songId, "delete")
            for (sessionId in sessionIds) {
                OutboxRepository.enqueueIfSyncEnabled(userId, "session", sessionId, "delete")
            }

            SongsTable.deleteWhere { (SongsTable.id eq songId) and (SongsTable.userId eq userId) }

            trashIds
        }
    }

    suspend fun migrateLocal(
        userId: UUID,
        items: List<LocalSongItem>,
        invalidCount: Int,
        markMigrated: Boolean
    ): MigrateLocalResponse {
        val database = requireDb()

        // 1. items에서 같은 videoId는 처음 것만 남긴다
        val seenVideoIds = mutableSetOf<String>()
        val deduplicatedItems = mutableListOf<LocalSongItem>()
        var dupCount = 0
        for (item in items) {
            if (seenVideoIds.add(item.videoId)) {
                deduplicatedItems.add(item)
            } else {
                dupCount++
            }
        }

        // 2. 트랜잭션 A: 이미 등록된 곡 제외
        val candidateVideoIds = deduplicatedItems.map { it.videoId }
        val existingVideoIds = DatabaseFactory.dbQuery(database) {
            if (candidateVideoIds.isEmpty()) emptySet()
            else {
                SongsTable.select(SongsTable.videoId)
                    .where { (SongsTable.userId eq userId) and (SongsTable.videoId inList candidateVideoIds) }
                    .map { it[SongsTable.videoId] }
                    .toSet()
            }
        }
        val toFetch = deduplicatedItems.filter { it.videoId !in existingVideoIds }
        val existingCount = deduplicatedItems.size - toFetch.size

        // 3. 트랜잭션 밖: 남은 항목마다 videoMetaClient.fetch (Semaphore(8))
        val fetchedList = coroutineScope {
            val sem = Semaphore(8)
            toFetch.map { item ->
                async {
                    sem.withPermit {
                        val meta = videoMetaClient.fetch(item.videoId)
                        item to meta
                    }
                }
            }.awaitAll()
        }

        // 4. 트랜잭션 B: insertIgnore + profiles.migrated_local_at 갱신
        return DatabaseFactory.dbQuery(database) {
            var created = 0
            var conflictCount = 0

            for ((item, meta) in fetchedList) {
                val newId = UUID.randomUUID()
                val insCount = SongsTable.insertIgnore {
                    it[id] = newId
                    it[SongsTable.userId] = userId
                    it[title] = meta?.title ?: UNTITLED
                    it[artist] = meta?.author ?: ""
                    it[videoId] = item.videoId
                    it[pos] = item.pos
                    it[a] = item.a
                    it[b] = item.b
                    it[rate] = item.rate
                    it[lastDate] = item.date
                }.insertedCount

                if (insCount == 1) {
                    created++
                    OutboxRepository.enqueueIfSyncEnabled(userId, "song", newId, "upsert")
                } else {
                    conflictCount++
                }
            }

            if (markMigrated) {
                ProfilesTable.update({ ProfilesTable.id eq userId }) {
                    it[migratedLocalAt] = OffsetDateTime.now(ZoneOffset.UTC)
                }
            }

            val currentMigratedAt = ProfilesTable
                .select(ProfilesTable.migratedLocalAt)
                .where { ProfilesTable.id eq userId }
                .singleOrNull()
                ?.get(ProfilesTable.migratedLocalAt)
                ?.let { formatTimestamp(it) }

            val skipped = invalidCount + dupCount + existingCount + conflictCount
            MigrateLocalResponse(
                created = created,
                skipped = skipped,
                migratedLocalAt = currentMigratedAt
            )
        }
    }

    private fun rowToDto(row: ResultRow, totalSeconds: Long): SongDto {
        val statusCode = row[SongsTable.status]
        val statusLabel = STATUS_LABELS[statusCode] ?: statusCode
        val pos = row[SongsTable.pos]
        val a = row[SongsTable.a]
        val b = row[SongsTable.b]
        val rate = row[SongsTable.rate]
        val videoId = row[SongsTable.videoId]

        return SongDto(
            id = row[SongsTable.id].toString(),
            title = row[SongsTable.title],
            artist = row[SongsTable.artist],
            status = statusLabel,
            statusCode = statusCode,
            videoId = videoId,
            pos = pos?.toDouble(),
            a = a?.toDouble(),
            b = b?.toDouble(),
            rate = rate.toDouble(),
            lastDate = row[SongsTable.lastDate]?.toString(),
            memo = row[SongsTable.memo],
            totalSeconds = totalSeconds,
            resumeUrl = resumeUrl(publicAppUrl, videoId, pos, a, b, rate)
        )
    }

    companion object {
        const val UNTITLED = "(제목 없음)"
        val VIDEO_ID_REGEX = Regex("^[A-Za-z0-9_-]{11}$")
        val STATUS_LABELS: Map<String, String> = mapOf(
            "practicing" to "연습 중",
            "paused" to "보류",
            "done" to "완료"
        )

        fun normalizeStatus(raw: String): String? {
            return when (raw.trim()) {
                "practicing", "연습 중", "연습중" -> "practicing"
                "paused", "보류" -> "paused"
                "done", "완료" -> "done"
                else -> null
            }
        }

        fun resumeUrl(
            publicAppUrl: String,
            videoId: String,
            pos: BigDecimal?,
            a: BigDecimal?,
            b: BigDecimal?,
            rate: BigDecimal
        ): String {
            val base = if (publicAppUrl.endsWith("/")) publicAppUrl else "$publicAppUrl/"
            val tVal = pos ?: a
            val tParam = if (tVal != null && tVal.compareTo(BigDecimal.ZERO) != 0) {
                "t=${tVal.setScale(0, RoundingMode.FLOOR).toPlainString()}"
            } else null

            fun formatPlain(v: BigDecimal): String =
                if (v.compareTo(BigDecimal.ZERO) == 0) "0" else v.stripTrailingZeros().toPlainString()

            val aParam = a?.let { "a=${formatPlain(it)}" }
            val bParam = b?.let { "b=${formatPlain(it)}" }
            val rParam = if (rate.compareTo(BigDecimal.ONE) != 0) "r=${formatPlain(rate)}" else null

            val params = listOfNotNull("v=$videoId", tParam, aParam, bParam, rParam)
            return "${base}practice.html?${params.joinToString("&")}"
        }

        fun parseLocalItem(
            element: JsonElement,
            today: LocalDate = LocalDate.now(ZoneOffset.UTC)
        ): LocalSongItem? {
            val obj = element as? JsonObject ?: return null
            val videoIdElem = obj["videoId"] as? JsonPrimitive ?: return null
            if (!videoIdElem.isString) return null
            val videoId = videoIdElem.content
            if (!VIDEO_ID_REGEX.matches(videoId)) return null

            fun parseDecimal(key: String, min: Double, max: Double, scale: Int): BigDecimal? {
                val prim = obj[key] as? JsonPrimitive ?: return null
                if (prim.isString) return null
                val d = prim.doubleOrNull ?: return null
                if (d < min || d > max) return null
                return BigDecimal.valueOf(d).setScale(scale, RoundingMode.HALF_UP)
            }

            val pos = parseDecimal("pos", 0.0, 86400.0, 1)
            var a = parseDecimal("a", 0.0, 86400.0, 1)
            var b = parseDecimal("b", 0.0, 86400.0, 1)
            if (a != null && b != null && a >= b) {
                a = null
                b = null
            }

            val rate = parseDecimal("rate", 0.25, 2.0, 2) ?: BigDecimal("1.00")

            val date = (obj["date"] as? JsonPrimitive)?.takeIf { it.isString }?.content?.let { dateStr ->
                if (DATE_REGEX.matches(dateStr)) {
                    runCatching {
                        val d = LocalDate.parse(dateStr)
                        if (d >= MIN_DATE && d <= today.plusDays(1)) d else null
                    }.getOrNull()
                } else null
            }

            return LocalSongItem(
                videoId = videoId,
                pos = pos,
                a = a,
                b = b,
                rate = rate,
                date = date
            )
        }
    }
}
