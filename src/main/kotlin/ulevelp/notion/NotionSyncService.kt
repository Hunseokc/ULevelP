package ulevelp.notion

import io.ktor.http.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import org.jetbrains.exposed.sql.*
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import org.jetbrains.exposed.sql.SqlExpressionBuilder.greaterEq
import org.jetbrains.exposed.sql.SqlExpressionBuilder.less
import org.slf4j.LoggerFactory
import ulevelp.api.ApiException
import ulevelp.api.NotFoundException
import ulevelp.db.*
import ulevelp.service.ExportImportService
import ulevelp.service.IntegrationService
import ulevelp.service.SongService
import ulevelp.service.TakeService
import ulevelp.storage.StorageClient
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.Clock
import java.time.Duration
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.UUID

@Serializable
data class NotionSyncStatusResponse(
    val enabled: Boolean,
    val pending: Int,
    val failed: Int,
    val lastPushAt: String? = null,
    val lastPullAt: String? = null,
    val lastError: String? = null
)

@Serializable
data class NotionSyncEnableResponse(
    val ok: Boolean = true,
    val importedSongs: Int,
    val importedSessions: Int,
    val importedTakes: Int,
    val skippedTakesByQuota: Int
)

@Serializable
data class NotionPullResponse(
    val ok: Boolean = true,
    val updatedSongs: Int,
    val updatedSessions: Int,
    val lastPullAt: String
)

private data class NotionParsedSong(
    val pageId: String,
    val videoId: String,
    val title: String,
    val artist: String,
    val status: String,
    val pos: BigDecimal?,
    val a: BigDecimal?,
    val b: BigDecimal?,
    val rate: BigDecimal,
    val lastDate: LocalDate?,
    val memo: String
)

private data class NotionParsedSession(
    val pageId: String,
    val songNotionPageId: String,
    val date: LocalDate,
    val seconds: Int,
    val loops: Int,
    val rate: BigDecimal?,
    val a: BigDecimal?,
    val b: BigDecimal?,
    val memo: String,
    val files: List<NotionFileItem>
)

private data class NotionFileItem(
    val name: String,
    val url: String
)

private data class ImportedSessionContext(
    val sessionPageId: String,
    val sessionId: UUID,
    val songId: UUID,
    val date: LocalDate,
    val a: BigDecimal?,
    val b: BigDecimal?,
    val rate: BigDecimal?,
    val files: List<NotionFileItem>
)

class NotionSyncService(
    private val db: Database?,
    private val integrationService: IntegrationService,
    private val notionClient: NotionClient,
    private val storageClient: StorageClient?,
    private val clock: Clock = Clock.systemUTC()
) {
    private val log = LoggerFactory.getLogger(NotionSyncService::class.java)

    companion object {
        const val PULL_COOLDOWN_SECONDS = 300L     // 5분 쿨다운 (NFR-OPS-1)
        const val PULL_LOOKBACK_MINUTES = 2L       // 노션 last_edited_time 분 단위 절삭 보정용 여유 2분
        const val MAX_PAGES_PER_SYNC = 500         // 500페이지 도달 시 에러 없이 루프 종료(잘라서 반영)
    }

    private fun requireDb(): Database =
        db ?: throw ApiException(HttpStatusCode.ServiceUnavailable, "DATABASE_UNAVAILABLE", "데이터베이스를 사용할 수 없습니다.")

    suspend fun getStatus(userId: UUID): NotionSyncStatusResponse {
        if (db == null) {
            return NotionSyncStatusResponse(
                enabled = false,
                pending = 0,
                failed = 0
            )
        }

        return DatabaseFactory.dbQuery(db) {
            val syncRow = NotionSyncTable.selectAll().where { NotionSyncTable.userId eq userId }.singleOrNull()
            val enabled = syncRow?.get(NotionSyncTable.enabled) ?: false
            val lastPushAt = syncRow?.get(NotionSyncTable.lastPushAt)?.let { DateTimeFormatter.ISO_INSTANT.format(it.toInstant()) }
            val lastPullAt = syncRow?.get(NotionSyncTable.lastPullAt)?.let { DateTimeFormatter.ISO_INSTANT.format(it.toInstant()) }
            val lastError = syncRow?.get(NotionSyncTable.lastError)

            val pending = SyncOutboxTable.selectAll().where {
                (SyncOutboxTable.userId eq userId) and
                (SyncOutboxTable.doneAt.isNull()) and
                (SyncOutboxTable.attempts less NotionPushWorker.MAX_ATTEMPTS)
            }.count().toInt()

            val failed = SyncOutboxTable.selectAll().where {
                (SyncOutboxTable.userId eq userId) and
                (SyncOutboxTable.doneAt.isNull()) and
                (SyncOutboxTable.attempts greaterEq NotionPushWorker.MAX_ATTEMPTS)
            }.count().toInt()

            NotionSyncStatusResponse(
                enabled = enabled,
                pending = pending,
                failed = failed,
                lastPushAt = lastPushAt,
                lastPullAt = lastPullAt,
                lastError = lastError
            )
        }
    }

    suspend fun disable(userId: UUID) {
        if (db == null) return
        DatabaseFactory.dbQuery(db) {
            val exists = NotionSyncTable.selectAll().where { NotionSyncTable.userId eq userId }.count() > 0
            if (exists) {
                val nowUtc = clock.instant().atOffset(ZoneOffset.UTC)
                NotionSyncTable.update({ NotionSyncTable.userId eq userId }) {
                    it[enabled] = false
                    it[updatedAt] = nowUtc
                }
            }
        }
    }

    suspend fun enable(userId: UUID): NotionSyncEnableResponse {
        val database = requireDb()

        // 1. 사전 검증: profiles.storage_provider == "drive" 거부
        DatabaseFactory.dbQuery(database) {
            val profile = ProfilesTable.selectAll().where { ProfilesTable.id eq userId }.singleOrNull()
                ?: throw NotFoundException("사용자 프로필을 찾을 수 없습니다.")
            if (profile[ProfilesTable.storageProvider] == "drive") {
                throw ApiException(
                    HttpStatusCode.Conflict,
                    "NOTION_SYNC_CONFLICT",
                    "Google Drive 녹음 저장소가 켜져 있는 동안에는 노션 실시간 연동을 켤 수 없습니다. 먼저 기본 저장소로 변경해 주세요."
                )
            }
        }

        // 2. 키 확인
        val notion = integrationService.requireDecryptedNotion(userId, "ulevelp")

        // 3. 트랜잭션 밖: 노션 전체 조회 (최대 500개)
        val rawSongs = fetchNotionPages(notion.token, notion.songsDb)
        val parsedSongs = rawSongs.mapNotNull { parseNotionSong(it) }

        val rawSessions = fetchNotionPages(notion.token, notion.sessionsDb)
        val parsedSessions = rawSessions.mapNotNull { parseNotionSession(it) }

        val nowUtc = clock.instant().atOffset(ZoneOffset.UTC)
        var importedSongs = 0
        var importedSessions = 0
        val sessionContexts = mutableListOf<ImportedSessionContext>()

        // 4. 트랜잭션 2: 곡·세션 멱등 병합 및 notion_links 연결
        DatabaseFactory.dbQuery(database) {
            for (ps in parsedSongs) {
                val existingSong = SongsTable.selectAll().where {
                    (SongsTable.userId eq userId) and (SongsTable.videoId eq ps.videoId)
                }.singleOrNull()

                val songId: UUID
                if (existingSong == null) {
                    songId = UUID.randomUUID()
                    SongsTable.insert {
                        it[id] = songId
                        it[SongsTable.userId] = userId
                        it[title] = ps.title
                        it[artist] = ps.artist
                        it[status] = ps.status
                        it[videoId] = ps.videoId
                        it[pos] = ps.pos
                        it[a] = ps.a
                        it[b] = ps.b
                        it[rate] = ps.rate
                        it[lastDate] = ps.lastDate
                        it[memo] = ps.memo
                        it[createdAt] = nowUtc
                        it[updatedAt] = nowUtc
                    }
                } else {
                    songId = existingSong[SongsTable.id]
                    val oldLast = existingSong[SongsTable.lastDate]
                    val mergedLast = when {
                        oldLast == null -> ps.lastDate
                        ps.lastDate == null -> oldLast
                        ps.lastDate > oldLast -> ps.lastDate
                        else -> oldLast
                    }
                    SongsTable.update({ (SongsTable.id eq songId) and (SongsTable.userId eq userId) }) {
                        it[title] = ps.title
                        it[artist] = ps.artist
                        it[status] = ps.status
                        it[pos] = ps.pos
                        it[a] = ps.a
                        it[b] = ps.b
                        it[rate] = ps.rate
                        it[lastDate] = mergedLast
                        it[memo] = ps.memo
                        it[updatedAt] = nowUtc
                    }
                }
                upsertNotionLink(database, "song", songId, userId, ps.pageId, null, nowUtc)
                importedSongs++
            }

            for (ps in parsedSessions) {
                val songId = NotionLinksTable.selectAll().where {
                    (NotionLinksTable.userId eq userId) and
                    (NotionLinksTable.entity eq "song") and
                    (NotionLinksTable.notionPageId eq ps.songNotionPageId)
                }.singleOrNull()?.let { it[NotionLinksTable.entityId] } ?: continue

                val existingSession = SessionsTable.selectAll().where {
                    (SessionsTable.userId eq userId) and
                    (SessionsTable.songId eq songId) and
                    (SessionsTable.date eq ps.date)
                }.singleOrNull()

                val sessionId: UUID
                if (existingSession == null) {
                    sessionId = UUID.randomUUID()
                    SessionsTable.insert {
                        it[id] = sessionId
                        it[SessionsTable.userId] = userId
                        it[SessionsTable.songId] = songId
                        it[date] = ps.date
                        it[seconds] = ps.seconds
                        it[loops] = ps.loops
                        it[rate] = ps.rate
                        it[a] = ps.a
                        it[b] = ps.b
                        it[memo] = ps.memo
                        it[createdAt] = nowUtc
                        it[updatedAt] = nowUtc
                    }
                } else {
                    sessionId = existingSession[SessionsTable.id]
                    val oldSec = existingSession[SessionsTable.seconds]
                    val oldLoops = existingSession[SessionsTable.loops]
                    SessionsTable.update({ (SessionsTable.id eq sessionId) and (SessionsTable.userId eq userId) }) {
                        it[seconds] = maxOf(oldSec, ps.seconds)
                        it[loops] = maxOf(oldLoops, ps.loops)
                        it[rate] = ps.rate
                        it[a] = ps.a
                        it[b] = ps.b
                        it[memo] = ps.memo
                        it[updatedAt] = nowUtc
                    }
                }
                upsertNotionLink(database, "session", sessionId, userId, ps.pageId, null, nowUtc)
                importedSessions++

                sessionContexts.add(
                    ImportedSessionContext(
                        sessionPageId = ps.pageId,
                        sessionId = sessionId,
                        songId = songId,
                        date = ps.date,
                        a = ps.a,
                        b = ps.b,
                        rate = ps.rate,
                        files = ps.files
                    )
                )
            }
        }

        // 5. 녹음 파일 이관 (storageClient != null 일 때 — 다운로드 전 중복 필터)
        var importedTakes = 0
        var skippedTakesByQuota = 0

        if (storageClient != null) {
            for (ctx in sessionContexts) {
                for (file in ctx.files) {
                    val ext = file.name.substringAfterLast('.', "").lowercase()
                    val mime = ExportImportService.EXT_TO_MIME[ext] ?: continue
                    val parsedRecordedAt = ExportImportService.parseRecordedAtFromFilename(file.name, ctx.date)

                    // 다운로드 전 1차 중복 검사 (DB 트랜잭션)
                    val alreadyImported = DatabaseFactory.dbQuery(database) {
                        val byLink = NotionLinksTable.selectAll().where {
                            (NotionLinksTable.userId eq userId) and
                            (NotionLinksTable.entity eq "take") and
                            (NotionLinksTable.notionExtra eq "${ctx.sessionPageId}:${file.name}")
                        }.count() > 0

                        if (byLink) return@dbQuery true

                        val targetMinute = parsedRecordedAt.truncatedTo(ChronoUnit.MINUTES)
                        val takesForSession = TakesTable.selectAll().where {
                            (TakesTable.userId eq userId) and (TakesTable.sessionId eq ctx.sessionId)
                        }.map { it[TakesTable.recordedAt] }

                        takesForSession.any { it.truncatedTo(ChronoUnit.MINUTES) == targetMinute }
                    }

                    if (alreadyImported) {
                        continue
                    }

                    var storageKey: String? = null
                    try {
                        // 트랜잭션 밖 다운로드
                        val (bytes, _) = notionClient.downloadExternalFile(file.url)
                        if (bytes.isEmpty() || bytes.size > TakeService.MAX_FILE_BYTES) {
                            continue
                        }

                        // 쿼터 확인 및 업로드
                        val withinQuota = DatabaseFactory.dbQuery(database) {
                            val profile = ProfilesTable.selectAll().where { ProfilesTable.id eq userId }.forUpdate().single()
                            val quota = profile[ProfilesTable.takeQuotaBytes]
                            val usedExpr = TakesTable.sizeBytes.sum()
                            val usedBytes = TakesTable.select(usedExpr)
                                .where { (TakesTable.userId eq userId) and (TakesTable.storage eq "supabase") }
                                .singleOrNull()?.get(usedExpr) ?: 0L
                            usedBytes + bytes.size <= quota
                        }

                        if (!withinQuota) {
                            skippedTakesByQuota++
                            continue
                        }

                        val takeId = UUID.randomUUID()
                        val sKey = "$userId/$takeId.$ext"
                        storageKey = sKey
                        storageClient.upload(sKey, bytes, mime)

                        DatabaseFactory.dbQuery(database) {
                            val profile = ProfilesTable.selectAll().where { ProfilesTable.id eq userId }.forUpdate().single()
                            val quota = profile[ProfilesTable.takeQuotaBytes]
                            val usedExpr = TakesTable.sizeBytes.sum()
                            val usedBytes = TakesTable.select(usedExpr)
                                .where { (TakesTable.userId eq userId) and (TakesTable.storage eq "supabase") }
                                .singleOrNull()?.get(usedExpr) ?: 0L

                            if (usedBytes + bytes.size > quota) {
                                throw ApiException(HttpStatusCode.PayloadTooLarge, "TAKE_QUOTA_EXCEEDED", "쿼터 초과")
                            }

                            TakesTable.insert {
                                it[id] = takeId
                                it[TakesTable.userId] = userId
                                it[sessionId] = ctx.sessionId
                                it[songId] = ctx.songId
                                it[recordedAt] = parsedRecordedAt
                                it[a] = ctx.a
                                it[b] = ctx.b
                                it[rate] = ctx.rate
                                it[durationSec] = 0
                                it[TakesTable.mime] = mime
                                it[sizeBytes] = bytes.size.toLong()
                                it[storage] = "supabase"
                                it[TakesTable.storageKey] = sKey
                                it[memo] = ""
                                it[createdAt] = nowUtc
                            }

                            NotionLinksTable.insert {
                                it[entity] = "take"
                                it[entityId] = takeId
                                it[NotionLinksTable.userId] = userId
                                it[notionPageId] = "take-import:$takeId"
                                it[notionExtra] = "${ctx.sessionPageId}:${file.name}"
                                it[syncedAt] = nowUtc
                            }
                        }
                        importedTakes++
                    } catch (e: CancellationException) {
                        storageKey?.let { cleanupUploadedFile(storageClient, database, it) }
                        throw e
                    } catch (e: Exception) {
                        storageKey?.let { cleanupUploadedFile(storageClient, database, it) }
                        if (e is ApiException && e.code == "TAKE_QUOTA_EXCEEDED") {
                            skippedTakesByQuota++
                        } else {
                            log.warn("녹음 파일 가져오기 실패 (file={}): {}", file.name, e.message)
                        }
                    }
                }
            }
        }

        // 6. 트랜잭션 3: notion_sync 활성화 및 로컬 미연결 데이터 Outbox 적재
        DatabaseFactory.dbQuery(database) {
            val syncExists = NotionSyncTable.selectAll().where { NotionSyncTable.userId eq userId }.count() > 0
            if (syncExists) {
                NotionSyncTable.update({ NotionSyncTable.userId eq userId }) {
                    it[enabled] = true
                    it[lastPullAt] = nowUtc
                    it[lastError] = null
                    it[updatedAt] = nowUtc
                }
            } else {
                NotionSyncTable.insert {
                    it[NotionSyncTable.userId] = userId
                    it[enabled] = true
                    it[lastPullAt] = nowUtc
                    it[lastError] = null
                    it[updatedAt] = nowUtc
                }
            }

            // 로컬 전용 곡 Outbox 적재
            val linkedSongIds = NotionLinksTable.select(NotionLinksTable.entityId)
                .where { (NotionLinksTable.userId eq userId) and (NotionLinksTable.entity eq "song") }
                .map { it[NotionLinksTable.entityId] }
                .toSet()

            val unlinkedSongs = SongsTable.select(SongsTable.id)
                .where { SongsTable.userId eq userId }
                .map { it[SongsTable.id] }
                .filter { it !in linkedSongIds }

            for (sid in unlinkedSongs) {
                OutboxRepository.enqueueIfSyncEnabled(userId, "song", sid, "upsert")
            }

            // 로컬 전용 세션 Outbox 적재
            val linkedSessionIds = NotionLinksTable.select(NotionLinksTable.entityId)
                .where { (NotionLinksTable.userId eq userId) and (NotionLinksTable.entity eq "session") }
                .map { it[NotionLinksTable.entityId] }
                .toSet()

            val unlinkedSessions = SessionsTable.select(SessionsTable.id)
                .where { SessionsTable.userId eq userId }
                .map { it[SessionsTable.id] }
                .filter { it !in linkedSessionIds }

            for (sid in unlinkedSessions) {
                OutboxRepository.enqueueIfSyncEnabled(userId, "session", sid, "upsert")
            }

            // 로컬 전용 테이크 Outbox 적재
            val linkedTakeIds = NotionLinksTable.select(NotionLinksTable.entityId)
                .where { (NotionLinksTable.userId eq userId) and (NotionLinksTable.entity eq "take") }
                .map { it[NotionLinksTable.entityId] }
                .toSet()

            val unlinkedTakes = TakesTable.select(TakesTable.id)
                .where { TakesTable.userId eq userId }
                .map { it[TakesTable.id] }
                .filter { it !in linkedTakeIds }

            for (tid in unlinkedTakes) {
                OutboxRepository.enqueueIfSyncEnabled(userId, "take", tid, "upsert")
            }

            // 로컬 전용 노트 Outbox 적재 (notesDb가 설정된 경우)
            if (!notion.notesDb.isNullOrBlank()) {
                val linkedNoteIds = NotionLinksTable.select(NotionLinksTable.entityId)
                    .where { (NotionLinksTable.userId eq userId) and (NotionLinksTable.entity eq "note") }
                    .map { it[NotionLinksTable.entityId] }
                    .toSet()

                val unlinkedNotes = NotesTable.select(NotesTable.id)
                    .where { NotesTable.userId eq userId }
                    .map { it[NotesTable.id] }
                    .filter { it !in linkedNoteIds }

                for (nid in unlinkedNotes) {
                    OutboxRepository.enqueueIfSyncEnabled(userId, "note", nid, "upsert")
                }
            }
        }

        return NotionSyncEnableResponse(
            ok = true,
            importedSongs = importedSongs,
            importedSessions = importedSessions,
            importedTakes = importedTakes,
            skippedTakesByQuota = skippedTakesByQuota
        )
    }

    suspend fun pull(userId: UUID): NotionPullResponse {
        val database = requireDb()

        // 1. 사전 검증: 키 등록 여부, 연동 활성화 여부, 5분 쿨다운 확인
        val notion = integrationService.requireDecryptedNotion(userId, "ulevelp")

        val syncRow = DatabaseFactory.dbQuery(database) {
            NotionSyncTable.selectAll().where { NotionSyncTable.userId eq userId }.singleOrNull()
        }

        if (syncRow == null || !syncRow[NotionSyncTable.enabled]) {
            throw ApiException(
                HttpStatusCode.BadRequest,
                "INVALID_INPUT",
                "노션 실시간 연동이 꺼져 있습니다. 먼저 연동을 켜 주세요."
            )
        }

        val nowInstant = clock.instant()
        val nowUtc = nowInstant.atOffset(ZoneOffset.UTC)
        val lastPullAt = syncRow[NotionSyncTable.lastPullAt]
        if (lastPullAt != null) {
            val elapsed = Duration.between(lastPullAt.toInstant(), nowInstant).seconds
            if (elapsed < PULL_COOLDOWN_SECONDS) {
                val retry = (PULL_COOLDOWN_SECONDS - elapsed).toInt().coerceAtLeast(1)
                throw ApiException(
                    HttpStatusCode.TooManyRequests,
                    "RATE_LIMITED",
                    "노션 가져오기는 5분마다 실행할 수 있습니다. 잠시 후 다시 시도해 주세요.",
                    retryAfter = retry
                )
            }
        }

        // 2. 트랜잭션 밖 노션 증분 쿼리 (lastPullAt - 2분 보정)
        val querySince = lastPullAt?.minusMinutes(PULL_LOOKBACK_MINUTES)
        val filter = if (querySince != null) {
            buildJsonObject {
                put("timestamp", "last_edited_time")
                putJsonObject("last_edited_time") {
                    put("after", DateTimeFormatter.ISO_INSTANT.format(querySince.toInstant()))
                }
            }
        } else null

        val rawSongs = fetchNotionPages(notion.token, notion.songsDb, filter)
        val parsedSongs = rawSongs.mapNotNull { parseNotionSong(it) }

        val rawSessions = fetchNotionPages(notion.token, notion.sessionsDb, filter)
        val parsedSessions = rawSessions.mapNotNull { parseNotionSession(it) }

        var updatedSongs = 0
        var updatedSessions = 0

        // 3. 트랜잭션 2 (DB 반영 — 미처리 로컬 Outbox 우선 보호 및 Outbox 미적재!)
        DatabaseFactory.dbQuery(database) {
            val pendingOutboxSet = SyncOutboxTable.selectAll().where {
                (SyncOutboxTable.userId eq userId) and
                (SyncOutboxTable.doneAt.isNull()) and
                (SyncOutboxTable.attempts less NotionPushWorker.MAX_ATTEMPTS)
            }.map { Pair(it[SyncOutboxTable.entity], it[SyncOutboxTable.entityId]) }.toSet()

            for (ps in parsedSongs) {
                val linkedSongId = NotionLinksTable.selectAll().where {
                    (NotionLinksTable.userId eq userId) and
                    (NotionLinksTable.entity eq "song") and
                    (NotionLinksTable.notionPageId eq ps.pageId)
                }.singleOrNull()?.let { it[NotionLinksTable.entityId] }

                val existingSongRow = if (linkedSongId != null) {
                    SongsTable.selectAll().where {
                        (SongsTable.id eq linkedSongId) and (SongsTable.userId eq userId)
                    }.singleOrNull()
                } else null
                    ?: SongsTable.selectAll().where {
                        (SongsTable.userId eq userId) and (SongsTable.videoId eq ps.videoId)
                    }.singleOrNull()

                if (existingSongRow != null) {
                    val existingSongId = existingSongRow[SongsTable.id]
                    if (Pair("song", existingSongId) in pendingOutboxSet) {
                        // 로컬 수정사항이 아직 Push되기 전이므로 덮어쓰지 않고 건너뜀 (로컬 우선)
                        continue
                    }
                    val oldLast = existingSongRow[SongsTable.lastDate]
                    val mergedLast = when {
                        oldLast == null -> ps.lastDate
                        ps.lastDate == null -> oldLast
                        ps.lastDate > oldLast -> ps.lastDate
                        else -> oldLast
                    }
                    SongsTable.update({ (SongsTable.id eq existingSongId) and (SongsTable.userId eq userId) }) {
                        it[title] = ps.title
                        it[artist] = ps.artist
                        it[status] = ps.status
                        it[pos] = ps.pos
                        it[a] = ps.a
                        it[b] = ps.b
                        it[rate] = ps.rate
                        it[lastDate] = mergedLast
                        it[memo] = ps.memo
                        it[updatedAt] = nowUtc
                    }
                    upsertNotionLink(database, "song", existingSongId, userId, ps.pageId, null, nowUtc)
                    updatedSongs++
                } else {
                    val newId = UUID.randomUUID()
                    SongsTable.insert {
                        it[id] = newId
                        it[SongsTable.userId] = userId
                        it[title] = ps.title
                        it[artist] = ps.artist
                        it[status] = ps.status
                        it[videoId] = ps.videoId
                        it[pos] = ps.pos
                        it[a] = ps.a
                        it[b] = ps.b
                        it[rate] = ps.rate
                        it[lastDate] = ps.lastDate
                        it[memo] = ps.memo
                        it[createdAt] = nowUtc
                        it[updatedAt] = nowUtc
                    }
                    upsertNotionLink(database, "song", newId, userId, ps.pageId, null, nowUtc)
                    updatedSongs++
                }
            }

            for (ps in parsedSessions) {
                val linkedSongId = NotionLinksTable.selectAll().where {
                    (NotionLinksTable.userId eq userId) and
                    (NotionLinksTable.entity eq "song") and
                    (NotionLinksTable.notionPageId eq ps.songNotionPageId)
                }.singleOrNull()?.let { it[NotionLinksTable.entityId] } ?: continue

                // 링크로 얻은 songId가 SongsTable에 실제로 있는지 확인
                val songRow = SongsTable.selectAll().where {
                    (SongsTable.id eq linkedSongId) and (SongsTable.userId eq userId)
                }.singleOrNull()

                // 곡이 로컬에 없거나 ("song", songId) 삭제/수정 outbox가 대기 중이면 세션 건너뜀 (FK 위반 방지)
                if (songRow == null || Pair("song", linkedSongId) in pendingOutboxSet) {
                    continue
                }
                val songId = linkedSongId

                val linkedSessionId = NotionLinksTable.selectAll().where {
                    (NotionLinksTable.userId eq userId) and
                    (NotionLinksTable.entity eq "session") and
                    (NotionLinksTable.notionPageId eq ps.pageId)
                }.singleOrNull()?.let { it[NotionLinksTable.entityId] }

                val existingSessionRow = if (linkedSessionId != null) {
                    SessionsTable.selectAll().where {
                        (SessionsTable.id eq linkedSessionId) and (SessionsTable.userId eq userId)
                    }.singleOrNull()
                } else null
                    ?: SessionsTable.selectAll().where {
                        (SessionsTable.userId eq userId) and
                        (SessionsTable.songId eq songId) and
                        (SessionsTable.date eq ps.date)
                    }.singleOrNull()

                if (existingSessionRow != null) {
                    val existingSessionId = existingSessionRow[SessionsTable.id]
                    if (Pair("session", existingSessionId) in pendingOutboxSet) {
                        // 로컬 수정사항 보호: 건너뜀
                        continue
                    }
                    val oldSec = existingSessionRow[SessionsTable.seconds]
                    val oldLoops = existingSessionRow[SessionsTable.loops]
                    SessionsTable.update({ (SessionsTable.id eq existingSessionId) and (SessionsTable.userId eq userId) }) {
                        it[seconds] = maxOf(oldSec, ps.seconds)
                        it[loops] = maxOf(oldLoops, ps.loops)
                        it[rate] = ps.rate
                        it[a] = ps.a
                        it[b] = ps.b
                        it[memo] = ps.memo
                        it[updatedAt] = nowUtc
                    }
                    upsertNotionLink(database, "session", existingSessionId, userId, ps.pageId, null, nowUtc)
                    updatedSessions++
                } else {
                    val newSessionId = UUID.randomUUID()
                    SessionsTable.insert {
                        it[id] = newSessionId
                        it[SessionsTable.userId] = userId
                        it[SessionsTable.songId] = songId
                        it[date] = ps.date
                        it[seconds] = ps.seconds
                        it[loops] = ps.loops
                        it[rate] = ps.rate
                        it[a] = ps.a
                        it[b] = ps.b
                        it[memo] = ps.memo
                        it[createdAt] = nowUtc
                        it[updatedAt] = nowUtc
                    }
                    upsertNotionLink(database, "session", newSessionId, userId, ps.pageId, null, nowUtc)
                    updatedSessions++
                }
            }

            NotionSyncTable.update({ NotionSyncTable.userId eq userId }) {
                it[NotionSyncTable.lastPullAt] = nowUtc
                it[NotionSyncTable.lastError] = null
                it[NotionSyncTable.updatedAt] = nowUtc
            }
        }

        return NotionPullResponse(
            ok = true,
            updatedSongs = updatedSongs,
            updatedSessions = updatedSessions,
            lastPullAt = DateTimeFormatter.ISO_INSTANT.format(nowUtc.toInstant())
        )
    }

    private suspend fun fetchNotionPages(token: String, databaseId: String, filter: JsonObject? = null): List<JsonObject> {
        val pages = mutableListOf<JsonObject>()
        var cursor: String? = null
        do {
            val body = buildJsonObject {
                put("page_size", 100)
                if (cursor != null) put("start_cursor", cursor)
                if (filter != null) put("filter", filter)
            }
            val res = notionClient.queryDatabase(token, databaseId, body)
            val results = res["results"]?.jsonArray?.mapNotNull { it as? JsonObject }.orEmpty()
            pages.addAll(results)
            if (pages.size >= MAX_PAGES_PER_SYNC) {
                break
            }
            val hasMore = res["has_more"]?.jsonPrimitive?.booleanOrNull == true
            cursor = res["next_cursor"]?.jsonPrimitive?.contentOrNull
        } while (hasMore && cursor != null)
        return pages
    }

    private fun extractPlainText(element: JsonElement?): String {
        val arr = element?.jsonArray ?: return ""
        return arr.mapNotNull { it.jsonObject["plain_text"]?.jsonPrimitive?.contentOrNull }.joinToString("")
    }

    private fun parseNotionSong(page: JsonObject): NotionParsedSong? {
        if (page["archived"]?.jsonPrimitive?.booleanOrNull == true || page["in_trash"]?.jsonPrimitive?.booleanOrNull == true) {
            return null
        }
        val pageId = page["id"]?.jsonPrimitive?.contentOrNull ?: return null
        val props = page["properties"]?.jsonObject ?: return null

        val ytUrl = props["유튜브 링크"]?.jsonObject?.get("url")?.jsonPrimitive?.contentOrNull.orEmpty()
        val resumeUrl = props["이어서 연습"]?.jsonObject?.get("url")?.jsonPrimitive?.contentOrNull.orEmpty()
        val videoId = ExportImportService.extractVideoId(ytUrl) ?: ExportImportService.extractVideoId(resumeUrl) ?: return null

        val titleRaw = extractPlainText(props["곡명"]?.jsonObject?.get("title"))
        val title = titleRaw.ifBlank { "(제목 없음)" }.take(300)

        val artist = extractPlainText(props["아티스트"]?.jsonObject?.get("rich_text")).take(200)

        val rawStatus = props["상태"]?.jsonObject?.get("select")?.jsonObject?.get("name")?.jsonPrimitive?.contentOrNull.orEmpty()
        val status = SongService.normalizeStatus(rawStatus) ?: "practicing"

        fun parseNumber(elem: JsonElement?): BigDecimal? {
            val num = elem?.jsonObject?.get("number")?.jsonPrimitive?.doubleOrNull ?: return null
            return BigDecimal.valueOf(num).setScale(1, RoundingMode.HALF_UP)
        }

        var pos = parseNumber(props["마지막 위치(초)"])
        if (pos != null && (pos < BigDecimal.ZERO || pos > BigDecimal(86400))) pos = null

        var a = parseNumber(props["구간 시작(초)"])
        if (a != null && (a < BigDecimal.ZERO || a > BigDecimal(86400))) a = null

        var b = parseNumber(props["구간 끝(초)"])
        if (b != null && (b < BigDecimal.ZERO || b > BigDecimal(86400))) b = null

        if (a != null && b != null && a >= b) {
            a = null
            b = null
        }

        val rawRate = props["속도"]?.jsonObject?.get("number")?.jsonPrimitive?.doubleOrNull
        val rate = if (rawRate != null && rawRate in 0.25..2.0) {
            BigDecimal.valueOf(rawRate).setScale(2, RoundingMode.HALF_UP)
        } else {
            BigDecimal("1.00")
        }

        val dateStart = props["마지막 연습일"]?.jsonObject?.get("date")?.jsonObject?.get("start")?.jsonPrimitive?.contentOrNull
        val lastDate = dateStart?.take(10)?.takeIf { Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(it) }?.let {
            runCatching { LocalDate.parse(it) }.getOrNull()
        }

        val memo = extractPlainText(props["메모"]?.jsonObject?.get("rich_text")).take(2000)

        return NotionParsedSong(
            pageId = pageId,
            videoId = videoId,
            title = title,
            artist = artist,
            status = status,
            pos = pos,
            a = a,
            b = b,
            rate = rate,
            lastDate = lastDate,
            memo = memo
        )
    }

    private fun parseNotionSession(page: JsonObject): NotionParsedSession? {
        if (page["archived"]?.jsonPrimitive?.booleanOrNull == true || page["in_trash"]?.jsonPrimitive?.booleanOrNull == true) {
            return null
        }
        val pageId = page["id"]?.jsonPrimitive?.contentOrNull ?: return null
        val props = page["properties"]?.jsonObject ?: return null

        val songRelation = props["곡"]?.jsonObject?.get("relation")?.jsonArray
        val songNotionPageId = songRelation?.firstOrNull()?.jsonObject?.get("id")?.jsonPrimitive?.contentOrNull ?: return null

        val dateStart = props["날짜"]?.jsonObject?.get("date")?.jsonObject?.get("start")?.jsonPrimitive?.contentOrNull
        val date = dateStart?.take(10)?.takeIf { Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(it) }?.let {
            runCatching { LocalDate.parse(it) }.getOrNull()
        } ?: return null

        val minutes = props["연습 시간(분)"]?.jsonObject?.get("number")?.jsonPrimitive?.doubleOrNull ?: 0.0
        val seconds = Math.round(minutes * 60.0).toInt().coerceIn(0, 86400)

        val loops = props["반복 횟수"]?.jsonObject?.get("number")?.jsonPrimitive?.intOrNull?.coerceIn(0, 100000) ?: 0

        val rawRate = props["속도"]?.jsonObject?.get("number")?.jsonPrimitive?.doubleOrNull
        val rate = if (rawRate != null && rawRate in 0.25..2.0) {
            BigDecimal.valueOf(rawRate).setScale(2, RoundingMode.HALF_UP)
        } else null

        val segRaw = extractPlainText(props["구간"]?.jsonObject?.get("rich_text"))
        val (a, b) = ExportImportService.parseSegment(segRaw)

        val memo = extractPlainText(props["메모"]?.jsonObject?.get("rich_text")).take(2000)

        val filesRaw = props["녹음"]?.jsonObject?.get("files")?.jsonArray
        val files = filesRaw?.mapNotNull { item ->
            val obj = item.jsonObject
            val name = obj["name"]?.jsonPrimitive?.contentOrNull ?: ""
            val url = obj["file"]?.jsonObject?.get("url")?.jsonPrimitive?.contentOrNull ?: ""
            if (name.isNotBlank() && url.startsWith("https://", ignoreCase = true)) NotionFileItem(name, url) else null
        }.orEmpty()

        return NotionParsedSession(
            pageId = pageId,
            songNotionPageId = songNotionPageId,
            date = date,
            seconds = seconds,
            loops = loops,
            rate = rate,
            a = a,
            b = b,
            memo = memo,
            files = files
        )
    }

    private fun upsertNotionLink(
        database: Database,
        entity: String,
        entityId: UUID,
        userId: UUID,
        notionPageId: String,
        notionExtra: String? = null,
        nowUtc: OffsetDateTime
    ) {
        val existing = NotionLinksTable.selectAll().where {
            (NotionLinksTable.entity eq entity) and (NotionLinksTable.entityId eq entityId)
        }.singleOrNull()

        if (existing != null) {
            NotionLinksTable.update({
                (NotionLinksTable.entity eq entity) and (NotionLinksTable.entityId eq entityId)
            }) {
                it[NotionLinksTable.notionPageId] = notionPageId
                it[NotionLinksTable.notionExtra] = notionExtra
                it[NotionLinksTable.syncedAt] = nowUtc
            }
        } else {
            val byPage = NotionLinksTable.selectAll().where {
                (NotionLinksTable.userId eq userId) and (NotionLinksTable.notionPageId eq notionPageId)
            }.singleOrNull()

            if (byPage != null) {
                NotionLinksTable.update({
                    (NotionLinksTable.userId eq userId) and (NotionLinksTable.notionPageId eq notionPageId)
                }) {
                    it[NotionLinksTable.entity] = entity
                    it[NotionLinksTable.entityId] = entityId
                    it[NotionLinksTable.notionExtra] = notionExtra
                    it[NotionLinksTable.syncedAt] = nowUtc
                }
            } else {
                NotionLinksTable.insert {
                    it[NotionLinksTable.entity] = entity
                    it[NotionLinksTable.entityId] = entityId
                    it[NotionLinksTable.userId] = userId
                    it[NotionLinksTable.notionPageId] = notionPageId
                    it[NotionLinksTable.notionExtra] = notionExtra
                    it[NotionLinksTable.syncedAt] = nowUtc
                }
            }
        }
    }

    private suspend fun cleanupUploadedFile(
        client: StorageClient,
        database: Database,
        key: String
    ) {
        withContext(NonCancellable) {
            val committed = runCatching {
                DatabaseFactory.dbQuery(database) {
                    TakesTable.select(TakesTable.id).where { TakesTable.storageKey eq key }.limit(1).any()
                }
            }.getOrDefault(false)
            if (committed) {
                return@withContext
            }
            try {
                client.delete(key)
            } catch (_: Throwable) {
                try {
                    DatabaseFactory.dbQuery(database) {
                        StorageTrashTable.insert {
                            it[storageKey] = key
                            it[attempts] = 0
                            it[lastError] = "enable compensation"
                        }
                    }
                } catch (_: Throwable) {
                }
            }
        }
    }
}
