package ulevelp.notion

import kotlinx.coroutines.CancellationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import org.jetbrains.exposed.sql.*
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import org.jetbrains.exposed.sql.SqlExpressionBuilder.inList
import org.jetbrains.exposed.sql.SqlExpressionBuilder.less
import org.jetbrains.exposed.sql.javatime.CurrentTimestampWithTimeZone
import org.slf4j.LoggerFactory
import ulevelp.db.*
import ulevelp.note.NotionNoteBlockBuilder
import ulevelp.service.DecryptedNotionIntegration
import ulevelp.service.IntegrationService
import ulevelp.service.SessionService
import ulevelp.service.SongService
import ulevelp.service.StorageTrashService
import ulevelp.storage.StorageClient
import java.math.BigDecimal
import java.time.Clock
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.UUID

@Serializable
data class PushResultDto(
    val ok: Boolean = true,
    val processed: Int,
    val failed: Int
)

@Serializable
data class CronPushResultDto(
    val ok: Boolean = true,
    val pushedUsers: Int,
    val processedOutbox: Int,
    val purgedTrash: Int,
    val timedOutJobs: Int
)

private data class OutboxItem(
    val id: Long,
    val userId: UUID,
    val entity: String,
    val entityId: UUID,
    val op: String,
    val attempts: Int
)

class NotionPushWorker(
    private val db: Database?,
    private val integrationService: IntegrationService,
    private val notionClient: NotionClient,
    private val storageClient: StorageClient?,
    private val storageTrashService: StorageTrashService,
    private val publicAppUrl: String,
    private val clock: Clock = Clock.systemUTC()
) {
    private val log = LoggerFactory.getLogger(NotionPushWorker::class.java)

    companion object {
        const val MAX_ATTEMPTS = 5
        const val BATCH_LIMIT_PER_USER = 20
        const val LEASE_MINUTES = 5L
        const val JOB_TIMEOUT_MINUTES = 70L
        val SEOUL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")

        private val AUDIO_MIME_TO_EXT = mapOf(
            "audio/mp4" to "m4a",
            "audio/webm" to "weba",
            "audio/ogg" to "ogg",
            "audio/mpeg" to "mp3",
            "audio/wav" to "wav",
            "audio/aac" to "aac"
        )

        /**
         * Outbox 배치 내 처리 우선순위:
         * upsert는 부모->자식 순(song=1, session=2, take=3, note=4),
         * delete는 자식->부모 순(take=5, session=6, song=7, note=8).
         */
        fun outboxPriority(op: String, entity: String): Int {
            return when {
                op == "upsert" && entity == "song" -> 1
                op == "upsert" && entity == "session" -> 2
                op == "upsert" && entity == "take" -> 3
                op == "upsert" && entity == "note" -> 4
                op == "delete" && entity == "take" -> 5
                op == "delete" && entity == "session" -> 6
                op == "delete" && entity == "song" -> 7
                op == "delete" && entity == "note" -> 8
                else -> 99
            }
        }
    }

    /** 단일 사용자의 sync_outbox 대기열을 처리한다 (POST /api/v1/notion/sync/push 용) */
    suspend fun pushUserOutbox(userId: UUID): PushResultDto {
        val notion = integrationService.requireDecryptedNotion(userId, "ulevelp")

        if (db == null) {
            return PushResultDto(ok = true, processed = 0, failed = 0)
        }

        val workerId = UUID.randomUUID().toString()

        // 1. Lease 획득
        val acquired = DatabaseFactory.dbQuery(db) {
            val nowUtc = clock.instant().atOffset(ZoneOffset.UTC)
            NotionSyncTable.update({
                (NotionSyncTable.userId eq userId) and
                (NotionSyncTable.enabled eq true) and
                (NotionSyncTable.leaseUntil.isNull() or (NotionSyncTable.leaseUntil less nowUtc))
            }) {
                it[leaseUntil] = nowUtc.plusMinutes(LEASE_MINUTES)
                it[leaseOwner] = workerId
            }
        }

        if (acquired == 0) {
            return PushResultDto(ok = true, processed = 0, failed = 0)
        }

        var processed = 0
        var failed = 0

        try {
            // 2. 대기열 조회 및 정렬
            val items = DatabaseFactory.dbQuery(db) {
                SyncOutboxTable
                    .selectAll()
                    .where {
                        (SyncOutboxTable.userId eq userId) and
                        (SyncOutboxTable.doneAt.isNull()) and
                        (SyncOutboxTable.attempts less MAX_ATTEMPTS)
                    }
                    .map { row ->
                        OutboxItem(
                            id = row[SyncOutboxTable.id],
                            userId = row[SyncOutboxTable.userId],
                            entity = row[SyncOutboxTable.entity],
                            entityId = row[SyncOutboxTable.entityId],
                            op = row[SyncOutboxTable.op],
                            attempts = row[SyncOutboxTable.attempts]
                        )
                    }
            }.sortedWith(compareBy({ outboxPriority(it.op, it.entity) }, { it.id }))
             .take(BATCH_LIMIT_PER_USER)

            for (item in items) {
                try {
                    processItem(userId, item, notion, workerId)

                    // 성공 시 완료 기록
                    DatabaseFactory.dbQuery(db) {
                        val nowUtc = clock.instant().atOffset(ZoneOffset.UTC)
                        SyncOutboxTable.update({ SyncOutboxTable.id eq item.id }) {
                            it[doneAt] = nowUtc
                            it[lastError] = null
                        }
                    }
                    processed++
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    val errMsg = (e.message ?: "Notion push error").take(500)
                    log.warn("Outbox 항목(${item.id}) 처리 실패: {}", errMsg)
                    DatabaseFactory.dbQuery(db) {
                        SyncOutboxTable.update({ SyncOutboxTable.id eq item.id }) {
                            it[attempts] = item.attempts + 1
                            it[lastError] = errMsg
                        }
                        NotionSyncTable.update({ NotionSyncTable.userId eq userId }) {
                            it[lastError] = errMsg
                        }
                    }
                    failed++
                }

                // 항목 처리 직후 짧은 트랜잭션으로 lease 연장
                DatabaseFactory.dbQuery(db) {
                    val nowUtc = clock.instant().atOffset(ZoneOffset.UTC)
                    NotionSyncTable.update({
                        (NotionSyncTable.userId eq userId) and (NotionSyncTable.leaseOwner eq workerId)
                    }) {
                        it[leaseUntil] = nowUtc.plusMinutes(LEASE_MINUTES)
                    }
                }
            }
        } finally {
            // 3. Lease 해제
            DatabaseFactory.dbQuery(db) {
                val nowUtc = clock.instant().atOffset(ZoneOffset.UTC)
                NotionSyncTable.update({
                    (NotionSyncTable.userId eq userId) and (NotionSyncTable.leaseOwner eq workerId)
                }) {
                    it[leaseUntil] = null
                    it[leaseOwner] = null
                    it[lastPushAt] = nowUtc
                    if (failed == 0 && processed > 0) {
                        it[lastError] = null
                    }
                }
            }
        }

        return PushResultDto(ok = true, processed = processed, failed = failed)
    }

    /** 1분 크론 배치: 대기열 있는 사용자 Push + storage_trash 정리 + 70분 초과 analysis_jobs 정리 */
    suspend fun runCronBatch(): CronPushResultDto {
        var pushedUsers = 0
        var processedOutbox = 0
        var purgedTrash = 0
        var timedOutJobs = 0

        if (db == null) {
            return CronPushResultDto(ok = true, 0, 0, 0, 0)
        }

        // 1. 사용자별 Outbox Push (사용자 단위 예외 격리)
        val candidateUserIds = DatabaseFactory.dbQuery(db) {
            val join = SyncOutboxTable.innerJoin(
                NotionSyncTable,
                { SyncOutboxTable.userId },
                { NotionSyncTable.userId }
            )
            join.select(SyncOutboxTable.userId)
                .where {
                    (NotionSyncTable.enabled eq true) and
                    (SyncOutboxTable.doneAt.isNull()) and
                    (SyncOutboxTable.attempts less MAX_ATTEMPTS)
                }
                .withDistinct()
                .limit(20)
                .map { it[SyncOutboxTable.userId] }
        }

        for (uid in candidateUserIds) {
            try {
                val r = pushUserOutbox(uid)
                pushedUsers++
                processedOutbox += r.processed
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val errMsg = (e.message ?: "Cron push error").take(500)
                try {
                    DatabaseFactory.dbQuery(db) {
                        NotionSyncTable.update({ NotionSyncTable.userId eq uid }) {
                            it[lastError] = errMsg
                        }
                    }
                } catch (ex: CancellationException) {
                    throw ex
                } catch (_: Exception) {
                }
            }
        }

        // 2. storage_trash 정리 및 건수 집계
        try {
            val trashIds = DatabaseFactory.dbQuery(db) {
                StorageTrashTable
                    .select(StorageTrashTable.id)
                    .where { StorageTrashTable.attempts less 5 }
                    .limit(50)
                    .map { it[StorageTrashTable.id] }
            }
            if (trashIds.isNotEmpty()) {
                storageTrashService.purge(trashIds)
                val remaining = DatabaseFactory.dbQuery(db) {
                    StorageTrashTable
                        .select(StorageTrashTable.id)
                        .where { StorageTrashTable.id inList trashIds }
                        .count()
                }
                purgedTrash = trashIds.size - remaining.toInt()
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            log.warn("크론 storage_trash 정리 실패: {}", e.message)
            purgedTrash = 0
        }

        // 3. 멈춘 analysis_jobs 타임아웃 정리
        val nowUtc = clock.instant().atOffset(ZoneOffset.UTC)
        val timeoutThreshold = nowUtc.minusMinutes(JOB_TIMEOUT_MINUTES)
        timedOutJobs = DatabaseFactory.dbQuery(db) {
            AnalysisJobsTable.update({
                (AnalysisJobsTable.status eq "running") and
                (AnalysisJobsTable.startedAt.isNotNull()) and
                (AnalysisJobsTable.startedAt less timeoutThreshold)
            }) {
                it[status] = "failed"
                it[error] = "timeout"
                it[finishedAt] = nowUtc
            }
        }

        return CronPushResultDto(
            ok = true,
            pushedUsers = pushedUsers,
            processedOutbox = processedOutbox,
            purgedTrash = purgedTrash,
            timedOutJobs = timedOutJobs
        )
    }

    private suspend fun processItem(
        userId: UUID,
        item: OutboxItem,
        notion: DecryptedNotionIntegration,
        workerId: String? = null
    ) {
        when (item.op) {
            "upsert" -> {
                when (item.entity) {
                    "song" -> pushSongUpsert(userId, item.entityId, notion)
                    "session" -> pushSessionUpsert(userId, item.entityId, notion)
                    "take" -> pushTakeUpsert(userId, item.entityId, notion, workerId)
                    "note" -> {
                        pushNoteUpsert(userId, item.entityId, notion, workerId)
                    }
                }
            }
            "delete" -> {
                pushDelete(userId, item.entity, item.entityId, notion)
            }
        }
    }

    private suspend fun pushSongUpsert(
        userId: UUID,
        songId: UUID,
        notion: DecryptedNotionIntegration
    ): String? {
        val songRow = DatabaseFactory.dbQuery(db!!) {
            SongsTable.selectAll()
                .where { (SongsTable.id eq songId) and (SongsTable.userId eq userId) }
                .singleOrNull()
        } ?: return null

        val existingLink = DatabaseFactory.dbQuery(db) {
            NotionLinksTable.selectAll()
                .where { (NotionLinksTable.entity eq "song") and (NotionLinksTable.entityId eq songId) }
                .singleOrNull()
                ?.let { it[NotionLinksTable.notionPageId] }
        }

        val titleContent = songRow[SongsTable.title].ifBlank { "(제목 없음)" }
        val artistContent = songRow[SongsTable.artist]
        val statusName = when (songRow[SongsTable.status]) {
            "practicing" -> "연습 중"
            "paused" -> "보류"
            "done" -> "완료"
            else -> "연습 중"
        }
        val videoId = songRow[SongsTable.videoId]
        val pos = songRow[SongsTable.pos]
        val a = songRow[SongsTable.a]
        val b = songRow[SongsTable.b]
        val rate = songRow[SongsTable.rate]
        val lastDate = songRow[SongsTable.lastDate]
        val memo = songRow[SongsTable.memo]

        val resumeUrl = SongService.resumeUrl(publicAppUrl, videoId, pos, a, b, rate)

        fun roundNumber(n: BigDecimal?): Double? =
            n?.toDouble()?.let { Math.round(it * 100.0) / 100.0 }

        val properties = buildJsonObject {
            putJsonObject("곡명") {
                putJsonArray("title") {
                    addJsonObject {
                        put("type", "text")
                        putJsonObject("text") { put("content", titleContent) }
                    }
                }
            }
            putJsonObject("아티스트") {
                putJsonArray("rich_text") {
                    addJsonObject {
                        put("type", "text")
                        putJsonObject("text") { put("content", artistContent) }
                    }
                }
            }
            putJsonObject("상태") {
                putJsonObject("select") { put("name", statusName) }
            }
            putJsonObject("유튜브 링크") {
                put("url", "https://www.youtube.com/watch?v=$videoId")
            }
            putJsonObject("이어서 연습") {
                put("url", resumeUrl)
            }
            putJsonObject("마지막 위치(초)") {
                val v = roundNumber(pos)
                if (v != null) put("number", v) else put("number", JsonNull)
            }
            putJsonObject("구간 시작(초)") {
                val v = roundNumber(a)
                if (v != null) put("number", v) else put("number", JsonNull)
            }
            putJsonObject("구간 끝(초)") {
                val v = roundNumber(b)
                if (v != null) put("number", v) else put("number", JsonNull)
            }
            putJsonObject("속도") {
                val v = roundNumber(rate)
                if (v != null) put("number", v) else put("number", JsonNull)
            }
            putJsonObject("마지막 연습일") {
                if (lastDate != null) {
                    putJsonObject("date") { put("start", lastDate.toString()) }
                } else {
                    put("date", JsonNull)
                }
            }
            putJsonObject("메모") {
                putJsonArray("rich_text") {
                    addJsonObject {
                        put("type", "text")
                        putJsonObject("text") { put("content", memo) }
                    }
                }
            }
        }

        val pageId: String
        if (existingLink != null) {
            val patchBody = buildJsonObject { put("properties", properties) }
            notionClient.updatePage(notion.token, existingLink, patchBody)
            pageId = existingLink
            DatabaseFactory.dbQuery(db) {
                val nowUtc = clock.instant().atOffset(ZoneOffset.UTC)
                NotionLinksTable.update({
                    (NotionLinksTable.entity eq "song") and (NotionLinksTable.entityId eq songId)
                }) {
                    it[syncedAt] = nowUtc
                }
            }
        } else {
            val createBody = buildJsonObject {
                putJsonObject("parent") { put("database_id", notion.songsDb) }
                putJsonObject("icon") {
                    put("type", "emoji")
                    put("emoji", "🎵")
                }
                put("properties", properties)
            }
            val res = notionClient.createPage(notion.token, createBody)
            pageId = res["id"]?.jsonPrimitive?.contentOrNull
                ?: throw NotionApiException(500, "notion_error", "노션 곡 페이지 생성 실패(id 없음)")
            DatabaseFactory.dbQuery(db) {
                val nowUtc = clock.instant().atOffset(ZoneOffset.UTC)
                NotionLinksTable.insert {
                    it[entity] = "song"
                    it[entityId] = songId
                    it[NotionLinksTable.userId] = userId
                    it[notionPageId] = pageId
                    it[notionExtra] = null
                    it[syncedAt] = nowUtc
                }
            }
        }
        return pageId
    }

    private suspend fun pushSessionUpsert(
        userId: UUID,
        sessionId: UUID,
        notion: DecryptedNotionIntegration
    ): String? {
        val sessionRow = DatabaseFactory.dbQuery(db!!) {
            SessionsTable.selectAll()
                .where { (SessionsTable.id eq sessionId) and (SessionsTable.userId eq userId) }
                .singleOrNull()
        } ?: return null

        val songId = sessionRow[SessionsTable.songId]
        var songPageId = DatabaseFactory.dbQuery(db) {
            NotionLinksTable.selectAll()
                .where { (NotionLinksTable.entity eq "song") and (NotionLinksTable.entityId eq songId) }
                .singleOrNull()
                ?.let { it[NotionLinksTable.notionPageId] }
        }
        if (songPageId == null) {
            songPageId = pushSongUpsert(userId, songId, notion) ?: return null
        }

        val songTitle = DatabaseFactory.dbQuery(db) {
            SongsTable.selectAll()
                .where { (SongsTable.id eq songId) and (SongsTable.userId eq userId) }
                .singleOrNull()
                ?.let { it[SongsTable.title] }
        } ?: ""

        val existingLink = DatabaseFactory.dbQuery(db) {
            NotionLinksTable.selectAll()
                .where { (NotionLinksTable.entity eq "session") and (NotionLinksTable.entityId eq sessionId) }
                .singleOrNull()
                ?.let { it[NotionLinksTable.notionPageId] }
        }

        val dateStr = sessionRow[SessionsTable.date].toString()
        val sessionTitle = (dateStr + " " + songTitle).trim()
        val minutes = Math.round((sessionRow[SessionsTable.seconds].toDouble() / 60.0) * 100.0) / 100.0
        val loops = sessionRow[SessionsTable.loops].toDouble()
        val rate = sessionRow[SessionsTable.rate]?.toDouble()?.let { Math.round(it * 100.0) / 100.0 }
        val segment = SessionService.formatSegment(sessionRow[SessionsTable.a], sessionRow[SessionsTable.b])
        val memo = sessionRow[SessionsTable.memo]

        val properties = buildJsonObject {
            putJsonObject("기록") {
                putJsonArray("title") {
                    addJsonObject {
                        put("type", "text")
                        putJsonObject("text") { put("content", sessionTitle) }
                    }
                }
            }
            putJsonObject("곡") {
                putJsonArray("relation") {
                    addJsonObject { put("id", songPageId) }
                }
            }
            putJsonObject("날짜") {
                putJsonObject("date") { put("start", dateStr) }
            }
            putJsonObject("연습 시간(분)") {
                put("number", minutes)
            }
            putJsonObject("반복 횟수") {
                put("number", loops)
            }
            putJsonObject("속도") {
                if (rate != null) put("number", rate) else put("number", JsonNull)
            }
            putJsonObject("구간") {
                putJsonArray("rich_text") {
                    addJsonObject {
                        put("type", "text")
                        putJsonObject("text") { put("content", segment) }
                    }
                }
            }
            putJsonObject("메모") {
                putJsonArray("rich_text") {
                    addJsonObject {
                        put("type", "text")
                        putJsonObject("text") { put("content", memo) }
                    }
                }
            }
        }

        val pageId: String
        if (existingLink != null) {
            val patchBody = buildJsonObject { put("properties", properties) }
            notionClient.updatePage(notion.token, existingLink, patchBody)
            pageId = existingLink
            DatabaseFactory.dbQuery(db) {
                val nowUtc = clock.instant().atOffset(ZoneOffset.UTC)
                NotionLinksTable.update({
                    (NotionLinksTable.entity eq "session") and (NotionLinksTable.entityId eq sessionId)
                }) {
                    it[syncedAt] = nowUtc
                }
            }
        } else {
            val createBody = buildJsonObject {
                putJsonObject("parent") { put("database_id", notion.sessionsDb) }
                put("properties", properties)
            }
            val res = notionClient.createPage(notion.token, createBody)
            pageId = res["id"]?.jsonPrimitive?.contentOrNull
                ?: throw NotionApiException(500, "notion_error", "노션 세션 페이지 생성 실패(id 없음)")
            DatabaseFactory.dbQuery(db) {
                val nowUtc = clock.instant().atOffset(ZoneOffset.UTC)
                NotionLinksTable.insert {
                    it[entity] = "session"
                    it[entityId] = sessionId
                    it[NotionLinksTable.userId] = userId
                    it[notionPageId] = pageId
                    it[notionExtra] = null
                    it[syncedAt] = nowUtc
                }
            }
        }
        return pageId
    }

    private suspend fun pushTakeUpsert(
        userId: UUID,
        takeId: UUID,
        notion: DecryptedNotionIntegration,
        workerId: String? = null
    ) {
        val existingLink = DatabaseFactory.dbQuery(db!!) {
            NotionLinksTable.selectAll()
                .where { (NotionLinksTable.entity eq "take") and (NotionLinksTable.entityId eq takeId) }
                .singleOrNull()
        }
        if (existingLink != null) {
            log.info("take({})는 이미 노션에 연동되어 있으므로 업로드를 건너뜁니다.", takeId)
            return
        }

        val takeRow = DatabaseFactory.dbQuery(db) {
            TakesTable.selectAll()
                .where { (TakesTable.id eq takeId) and (TakesTable.userId eq userId) }
                .singleOrNull()
        } ?: return

        val sessionId = takeRow[TakesTable.sessionId]
        var sessionPageId = DatabaseFactory.dbQuery(db) {
            NotionLinksTable.selectAll()
                .where { (NotionLinksTable.entity eq "session") and (NotionLinksTable.entityId eq sessionId) }
                .singleOrNull()
                ?.let { it[NotionLinksTable.notionPageId] }
        }
        if (sessionPageId == null) {
            sessionPageId = pushSessionUpsert(userId, sessionId, notion) ?: return
        }

        val songTitle = DatabaseFactory.dbQuery(db) {
            SongsTable.selectAll()
                .where { (SongsTable.id eq takeRow[TakesTable.songId]) and (SongsTable.userId eq userId) }
                .singleOrNull()
                ?.let { it[SongsTable.title] }
        } ?: ""

        val storageKey = takeRow[TakesTable.storageKey]
        val client = storageClient
            ?: throw NotionApiException(503, "STORAGE_UNAVAILABLE", "스토리지 클라이언트가 설정되지 않았습니다.")
        val audioBytes = client.download(storageKey)

        val recordedAtSeoul = takeRow[TakesTable.recordedAt].atZoneSameInstant(SEOUL_ZONE)
        val dateStr = recordedAtSeoul.toLocalDate().toString()
        val timeColon = recordedAtSeoul.format(DateTimeFormatter.ofPattern("HH:mm"))
        val timeNoColon = timeColon.replace(":", "")
        val safeTitle = songTitle.replace(Regex("[\\\\/:*?\"<>|]+"), " ").trim().take(60)
        val ext = AUDIO_MIME_TO_EXT[takeRow[TakesTable.mime].substringBefore(';').trim().lowercase()] ?: "m4a"
        val filename = "$dateStr $timeNoColon $safeTitle.$ext".trim()

        // 대용량 파일 업로드 전 lease 보호 연장
        if (workerId != null) {
            DatabaseFactory.dbQuery(db) {
                val nowUtc = clock.instant().atOffset(ZoneOffset.UTC)
                NotionSyncTable.update({
                    (NotionSyncTable.userId eq userId) and (NotionSyncTable.leaseOwner eq workerId)
                }) {
                    it[leaseUntil] = nowUtc.plusMinutes(LEASE_MINUTES)
                }
            }
        }

        val fileUploadId = notionClient.uploadFile(notion.token, filename, takeRow[TakesTable.mime], audioBytes)

        val captionParts = mutableListOf("🎙 $timeColon")
        val segment = SessionService.formatSegment(takeRow[TakesTable.a], takeRow[TakesTable.b])
        if (segment.isNotEmpty()) captionParts.add(segment)
        takeRow[TakesTable.rate]?.let { r ->
            captionParts.add("${r.stripTrailingZeros().toPlainString()}×")
        }
        val durationSec = takeRow[TakesTable.durationSec]
        if (durationSec > 0) {
            captionParts.add(formatMmSs(durationSec))
        }
        val caption = captionParts.joinToString(" · ")

        val children = buildJsonArray {
            addJsonObject {
                put("type", "paragraph")
                putJsonObject("paragraph") {
                    putJsonArray("rich_text") {
                        addJsonObject {
                            put("type", "text")
                            putJsonObject("text") { put("content", caption) }
                        }
                    }
                }
            }
            addJsonObject {
                put("type", "audio")
                putJsonObject("audio") {
                    put("type", "file_upload")
                    putJsonObject("file_upload") { put("id", fileUploadId) }
                }
            }
        }

        val appendRes = notionClient.appendBlockChildren(notion.token, sessionPageId, children)
        val results = appendRes["results"]?.jsonArray
        val captionBlockId = results?.getOrNull(0)?.jsonObject?.get("id")?.jsonPrimitive?.contentOrNull
        val audioBlockId = results?.getOrNull(1)?.jsonObject?.get("id")?.jsonPrimitive?.contentOrNull ?: fileUploadId

        // 세션 페이지 녹음 속성에 파일 첨부 (코루틴 취소는 전파하고 일반 예외는 로그 남김)
        try {
            val page = notionClient.retrievePage(notion.token, sessionPageId)
            val recProp = page["properties"]?.jsonObject?.get("녹음")?.jsonObject
            val curFiles = recProp?.get("files")?.jsonArray ?: JsonArray(emptyList())
            val newFiles = buildJsonArray {
                curFiles.forEach { fileElem ->
                    val fObj = fileElem.jsonObject
                    val fName = fObj["name"]?.jsonPrimitive?.contentOrNull ?: "recording"
                    val fType = fObj["type"]?.jsonPrimitive?.contentOrNull
                    when (fType) {
                        "external" -> addJsonObject {
                            put("name", fName)
                            put("type", "external")
                            putJsonObject("external") {
                                put("url", fObj["external"]?.jsonObject?.get("url")?.jsonPrimitive?.contentOrNull ?: "")
                            }
                        }
                        "file" -> addJsonObject {
                            put("name", fName)
                            put("type", "file")
                            putJsonObject("file") {
                                put("url", fObj["file"]?.jsonObject?.get("url")?.jsonPrimitive?.contentOrNull ?: "")
                            }
                        }
                        "file_upload" -> addJsonObject {
                            put("name", fName)
                            put("type", "file_upload")
                            putJsonObject("file_upload") {
                                put("id", fObj["file_upload"]?.jsonObject?.get("id")?.jsonPrimitive?.contentOrNull ?: "")
                            }
                        }
                        else -> add(fileElem)
                    }
                }
                addJsonObject {
                    put("name", filename)
                    put("type", "file_upload")
                    putJsonObject("file_upload") { put("id", fileUploadId) }
                }
            }
            val patchBody = buildJsonObject {
                putJsonObject("properties") {
                    putJsonObject("녹음") {
                        put("files", newFiles)
                    }
                }
            }
            notionClient.updatePage(notion.token, sessionPageId, patchBody)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            log.warn("세션 페이지($sessionPageId) 녹음 속성 첨부 실패: {}", e.message)
        }

        // notion_links 기록
        DatabaseFactory.dbQuery(db) {
            val nowUtc = clock.instant().atOffset(ZoneOffset.UTC)
            NotionLinksTable.insert {
                it[entity] = "take"
                it[entityId] = takeId
                it[NotionLinksTable.userId] = userId
                it[notionPageId] = audioBlockId
                it[notionExtra] = captionBlockId
                it[syncedAt] = nowUtc
            }
        }
    }

    private suspend fun pushNoteUpsert(
        userId: UUID,
        noteId: UUID,
        notion: DecryptedNotionIntegration,
        workerId: String? = null
    ): String? {
        val notesDb = notion.notesDb?.takeIf { it.isNotBlank() } ?: return null

        val noteRow = DatabaseFactory.dbQuery(db!!) {
            NotesTable.selectAll()
                .where { (NotesTable.id eq noteId) and (NotesTable.userId eq userId) }
                .singleOrNull()
        } ?: return null

        val existingLink = DatabaseFactory.dbQuery(db) {
            NotionLinksTable.selectAll()
                .where { (NotionLinksTable.entity eq "note") and (NotionLinksTable.entityId eq noteId) }
                .singleOrNull()
                ?.let { it[NotionLinksTable.notionPageId] }
        }

        val videoId = noteRow[NotesTable.videoId]
        val url = "https://www.youtube.com/watch?v=$videoId"
        val tags = noteRow[NotesTable.tags]
        val memo = noteRow[NotesTable.memo]
        val title = noteRow[NotesTable.title]
        val channel = noteRow[NotesTable.channel]
        val headline = noteRow[NotesTable.headline]
        val keywords = noteRow[NotesTable.keywords]
        val difficulty = noteRow[NotesTable.difficulty]
        val analysisObj = (noteRow[NotesTable.analysis] as? JsonObject) ?: JsonObject(emptyMap())
        val diagramsSvgArray = (noteRow[NotesTable.diagramsSvg] as? JsonArray)?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList()

        val properties = NotionNoteBlockBuilder.buildPageProperties(
            url = url,
            tags = tags,
            memo = memo,
            title = title,
            channel = channel,
            headline = headline,
            keywords = keywords,
            difficulty = difficulty
        )

        val pageId: String
        if (existingLink != null) {
            val patchBody = buildJsonObject { put("properties", properties) }
            notionClient.updatePage(notion.token, existingLink, patchBody)
            pageId = existingLink
            DatabaseFactory.dbQuery(db) {
                val nowUtc = clock.instant().atOffset(ZoneOffset.UTC)
                NotionLinksTable.update({
                    (NotionLinksTable.entity eq "note") and (NotionLinksTable.entityId eq noteId)
                }) {
                    it[syncedAt] = nowUtc
                }
            }
        } else {
            val harmonyUploadIds = mutableListOf<String?>()
            for ((idx, svg) in diagramsSvgArray.withIndex()) {
                if (svg.isBlank()) {
                    harmonyUploadIds.add(null)
                } else {
                    if (workerId != null) {
                        DatabaseFactory.dbQuery(db) {
                            val nowUtc = clock.instant().atOffset(ZoneOffset.UTC)
                            NotionSyncTable.update({
                                (NotionSyncTable.userId eq userId) and (NotionSyncTable.leaseOwner eq workerId)
                            }) {
                                it[leaseUntil] = nowUtc.plusMinutes(LEASE_MINUTES)
                            }
                        }
                    }
                    val uploadId = try {
                        notionClient.uploadFile(
                            notion.token,
                            "voicing_${idx + 1}.svg",
                            "image/svg+xml",
                            svg.toByteArray(Charsets.UTF_8)
                        )
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        log.warn("노트({}) SVG 업로드 실패 (idx={}): {}", noteId, idx, e.message)
                        null
                    }
                    harmonyUploadIds.add(uploadId)
                }
            }

            val blocks = NotionNoteBlockBuilder.buildBlocks(url, tags, analysisObj, harmonyUploadIds)
            val first100 = blocks.take(100)
            val createBody = buildJsonObject {
                putJsonObject("parent") { put("database_id", notesDb) }
                put("properties", properties)
                put("children", JsonArray(first100))
            }

            val res = notionClient.createPage(notion.token, createBody)
            pageId = res["id"]?.jsonPrimitive?.contentOrNull
                ?: throw NotionApiException(500, "notion_error", "노션 학습 노트 페이지 생성 실패(id 없음)")

            DatabaseFactory.dbQuery(db) {
                val nowUtc = clock.instant().atOffset(ZoneOffset.UTC)
                NotionLinksTable.insert {
                    it[entity] = "note"
                    it[entityId] = noteId
                    it[NotionLinksTable.userId] = userId
                    it[notionPageId] = pageId
                    it[notionExtra] = null
                    it[syncedAt] = nowUtc
                }
            }

            if (blocks.size > 100) {
                for (i in 100 until blocks.size step 100) {
                    if (workerId != null) {
                        DatabaseFactory.dbQuery(db) {
                            val nowUtc = clock.instant().atOffset(ZoneOffset.UTC)
                            NotionSyncTable.update({
                                (NotionSyncTable.userId eq userId) and (NotionSyncTable.leaseOwner eq workerId)
                            }) {
                                it[leaseUntil] = nowUtc.plusMinutes(LEASE_MINUTES)
                            }
                        }
                    }
                    val chunk = blocks.subList(i, minOf(i + 100, blocks.size))
                    notionClient.appendBlockChildren(notion.token, pageId, JsonArray(chunk))
                }
            }
        }
        return pageId
    }

    private suspend fun archiveIgnoringMissing(block: suspend () -> Unit) {
        try {
            block()
        } catch (e: NotionApiException) {
            // object_not_found(404)는 노션 측에서 이미 제거되었으므로 성공으로 간주
            if (e.statusCode == 404) return
            // 노션은 이미 아카이브된 블록/페이지 재아카이브 시 400 validation_error를 반환할 수 있음
            if (e.statusCode == 400 && e.message?.contains("already archived", ignoreCase = true) == true) return
            throw e
        }
    }

    private suspend fun pushDelete(
        userId: UUID,
        entity: String,
        entityId: UUID,
        notion: DecryptedNotionIntegration
    ) {
        val link = DatabaseFactory.dbQuery(db!!) {
            NotionLinksTable.selectAll()
                .where { (NotionLinksTable.entity eq entity) and (NotionLinksTable.entityId eq entityId) }
                .singleOrNull()
        } ?: return

        val notionPageId = link[NotionLinksTable.notionPageId]
        val notionExtra = link[NotionLinksTable.notionExtra]

        when (entity) {
            "take" -> {
                if (notionPageId.isNotBlank()) {
                    archiveIgnoringMissing {
                        notionClient.archiveBlock(notion.token, notionPageId)
                    }
                }
                if (!notionExtra.isNullOrBlank()) {
                    archiveIgnoringMissing {
                        notionClient.archiveBlock(notion.token, notionExtra)
                    }
                }
            }
            "song", "session", "note" -> {
                if (notionPageId.isNotBlank()) {
                    archiveIgnoringMissing {
                        notionClient.updatePage(
                            notion.token,
                            notionPageId,
                            buildJsonObject { put("archived", true) }
                        )
                    }
                }
            }
        }

        DatabaseFactory.dbQuery(db) {
            NotionLinksTable.deleteWhere {
                (NotionLinksTable.entity eq entity) and (NotionLinksTable.entityId eq entityId)
            }
        }
    }

    private fun formatMmSs(s: Int): String {
        val m = s / 60
        val sec = s % 60
        return "$m:${sec.toString().padStart(2, '0')}"
    }
}
