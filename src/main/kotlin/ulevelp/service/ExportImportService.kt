package ulevelp.service

import io.ktor.http.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.sql.*
import org.jetbrains.exposed.sql.vendors.ForUpdateOption
import org.slf4j.LoggerFactory
import ulevelp.api.ApiException
import ulevelp.api.InvalidInputException
import ulevelp.api.NotFoundException
import ulevelp.db.*
import ulevelp.storage.StorageClient
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.math.BigDecimal
import java.math.RoundingMode
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.time.*
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

@Serializable
data class ImportSongSampleDto(
    val videoId: String,
    val title: String,
    val artist: String,
    val status: String,
    val isNew: Boolean
)

@Serializable
data class ImportRowErrorDto(
    val file: String,
    val row: Int,
    val reason: String
)

@Serializable
data class ImportPreviewResponse(
    val ok: Boolean = true,
    val previewToken: String,
    val newSongs: Int,
    val updatedSongs: Int,
    val sessions: Int,
    val takes: Int,
    val songsSample: List<ImportSongSampleDto>,
    val errors: List<ImportRowErrorDto>
)

@Serializable
data class ImportConfirmResponse(
    val ok: Boolean = true,
    val createdSongs: Int,
    val updatedSongs: Int,
    val upsertedSessions: Int,
    val importedTakes: Int,
    val skippedTakesByQuota: Int
)

/** loadExportData가 DB에서 읽어 온 내보내기용 스냅샷 */
class ExportBundleData internal constructor(
    internal val songs: List<ResultRow>,
    internal val sessions: List<ResultRow>,
    internal val takes: List<ResultRow>,
    internal val notes: List<ResultRow>
)

internal data class ParsedSong(
    val videoId: String,
    val title: String,
    val artist: String,
    val status: String,
    val pos: BigDecimal?,
    val a: BigDecimal?,
    val b: BigDecimal?,
    val rate: BigDecimal,
    val lastDate: LocalDate?,
    val memo: String,
    val isNew: Boolean
)

internal data class ParsedSession(
    val videoId: String,
    val date: LocalDate,
    val seconds: Int,
    val loops: Int,
    val rate: BigDecimal?,
    val a: BigDecimal?,
    val b: BigDecimal?,
    val memo: String
)

internal data class ParsedTake(
    val videoId: String,
    val sessionDate: LocalDate,
    val recordedAt: OffsetDateTime,
    val a: BigDecimal?,
    val b: BigDecimal?,
    val rate: BigDecimal?,
    val durationSec: Int,
    val mime: String,
    val bytes: ByteArray
)

internal data class PreviewCacheEntry(
    val token: UUID,
    val userId: UUID,
    val createdAt: Instant,
    val parsedSongs: List<ParsedSong>,
    val parsedSessions: List<ParsedSession>,
    val parsedTakes: List<ParsedTake>
)

internal class ImportPreviewStore(private val clock: Clock = Clock.systemUTC()) {
    private val entries = ConcurrentHashMap<UUID, PreviewCacheEntry>()

    @Synchronized
    fun put(
        userId: UUID,
        parsedSongs: List<ParsedSong>,
        parsedSessions: List<ParsedSession>,
        parsedTakes: List<ParsedTake>
    ): UUID {
        cleanExpiredAndUser(userId)
        while (entries.size >= ExportImportService.MAX_TOTAL_PREVIEWS) {
            val oldest = entries.values.minByOrNull { it.createdAt } ?: break
            entries.remove(oldest.token)
        }
        val token = UUID.randomUUID()
        entries[token] = PreviewCacheEntry(
            token = token,
            userId = userId,
            createdAt = clock.instant(),
            parsedSongs = parsedSongs,
            parsedSessions = parsedSessions,
            parsedTakes = parsedTakes
        )
        return token
    }

    @Synchronized
    fun take(userId: UUID, token: UUID): PreviewCacheEntry? {
        val entry = entries[token] ?: return null
        if (entry.userId != userId) {
            return null
        }
        val ageSec = ChronoUnit.SECONDS.between(entry.createdAt, clock.instant())
        if (ageSec > ExportImportService.PREVIEW_TTL_SECONDS) {
            entries.remove(token)
            return null
        }
        entries.remove(token)
        return entry
    }

    @Synchronized
    private fun cleanExpiredAndUser(userId: UUID) {
        val now = clock.instant()
        val it = entries.entries.iterator()
        while (it.hasNext()) {
            val e = it.next().value
            val ageSec = ChronoUnit.SECONDS.between(e.createdAt, now)
            if (ageSec > ExportImportService.PREVIEW_TTL_SECONDS || e.userId == userId) {
                it.remove()
            }
        }
    }
}

class ExportImportService(
    private val db: Database?,
    private val storageClient: StorageClient?,
    private val publicAppUrl: String,
    private val clock: Clock = Clock.systemUTC()
) {
    private val log = LoggerFactory.getLogger(ExportImportService::class.java)
    private val previewStore = ImportPreviewStore(clock)
    private enum class Precheck { DUPLICATE, QUOTA_EXCEEDED, OK }

    private fun requireDb(): Database =
        db ?: throw ApiException(
            status = HttpStatusCode.ServiceUnavailable,
            code = "DB_UNAVAILABLE",
            message = "데이터베이스가 연결되어 있지 않습니다."
        )

    suspend fun loadExportData(userId: UUID): ExportBundleData {
        val database = requireDb()
        return DatabaseFactory.dbQuery(database) {
            val songs = SongsTable.selectAll()
                .where { SongsTable.userId eq userId }
                .orderBy(SongsTable.lastDate to SortOrder.DESC_NULLS_LAST, SongsTable.updatedAt to SortOrder.DESC)
                .toList()

            val sessions = SessionsTable.selectAll()
                .where { SessionsTable.userId eq userId }
                .orderBy(SessionsTable.date to SortOrder.DESC, SessionsTable.updatedAt to SortOrder.DESC)
                .toList()

            val takes = TakesTable.selectAll()
                .where { TakesTable.userId eq userId }
                .orderBy(TakesTable.recordedAt to SortOrder.ASC)
                .toList()

            val notes = NotesTable.selectAll()
                .where { NotesTable.userId eq userId }
                .orderBy(NotesTable.createdAt to SortOrder.DESC)
                .toList()

            ExportBundleData(songs, sessions, takes, notes)
        }
    }

    suspend fun writeExportZip(data: ExportBundleData, includeAudio: Boolean, out: OutputStream) {
        withContext(Dispatchers.IO) {
            ZipOutputStream(out, StandardCharsets.UTF_8).use { zip ->
                // 1. 읽어주세요.txt
                val readmeText = """
                    ULeveLP 데이터 내보내기 안내

                    이 ZIP 파일은 노션(Notion) 공식 템플릿과 100% 호환되는 CSV 백업 파일입니다.

                    1. 연습 곡.csv
                       - 노션의 '연습 곡' 데이터베이스에 'CSV로 병합(Merge with CSV)'할 수 있습니다.
                    2. 연습 기록.csv
                       - 노션의 '연습 기록' 데이터베이스에 'CSV로 병합'할 수 있습니다.
                    3. 학습 영상 노트.csv 및 학습 영상 노트/*.md
                       - 노션의 '학습 영상 노트' 데이터베이스에 병합하거나 마크다운으로 열람할 수 있습니다.
                    4. 녹음/*
                       - 연습 기록별 녹음 파일입니다.

                    ULeveLP 설정 화면(settings.html)의 '가져오기 미리보기'를 통해 언제든지 다시 복원할 수 있습니다.
                """.trimIndent()
                zip.putNextEntry(ZipEntry("읽어주세요.txt"))
                zip.write(readmeText.toByteArray(StandardCharsets.UTF_8))
                zip.closeEntry()

                // 2. 연습 곡.csv
                val songsCsv = buildString {
                    append(UTF8_BOM)
                    append("곡명,아티스트,상태,유튜브 링크,이어서 연습,마지막 위치(초),구간 시작(초),구간 끝(초),속도,마지막 연습일,메모\r\n")
                    for (row in data.songs) {
                        val title = row[SongsTable.title].ifBlank { "(제목 없음)" }
                        val artist = row[SongsTable.artist]
                        val rawStatus = row[SongsTable.status]
                        val status = SongService.STATUS_LABELS[rawStatus] ?: "연습 중"
                        val videoId = row[SongsTable.videoId]
                        val ytLink = "https://www.youtube.com/watch?v=$videoId"
                        val pos = row[SongsTable.pos]
                        val a = row[SongsTable.a]
                        val b = row[SongsTable.b]
                        val rate = row[SongsTable.rate]
                        val resume = SongService.resumeUrl(publicAppUrl, videoId, pos, a, b, rate)
                        val posStr = pos?.stripTrailingZeros()?.toPlainString() ?: ""
                        val aStr = a?.stripTrailingZeros()?.toPlainString() ?: ""
                        val bStr = b?.stripTrailingZeros()?.toPlainString() ?: ""
                        val rateStr = rate.stripTrailingZeros().toPlainString()
                        val lastDateStr = row[SongsTable.lastDate]?.toString() ?: ""
                        val memo = row[SongsTable.memo]

                        val cols = listOf(
                            csvCell(title),
                            csvCell(artist),
                            csvCell(status),
                            csvCell(ytLink),
                            csvCell(resume),
                            csvCell(posStr),
                            csvCell(aStr),
                            csvCell(bStr),
                            csvCell(rateStr),
                            csvCell(lastDateStr),
                            csvCell(memo)
                        )
                        append(cols.joinToString(",") + "\r\n")
                    }
                }
                zip.putNextEntry(ZipEntry("연습 곡.csv"))
                zip.write(songsCsv.toByteArray(StandardCharsets.UTF_8))
                zip.closeEntry()

                // 녹음 오디오 다운로드 및 매핑 준비
                val songsById = data.songs.associateBy { it[SongsTable.id] }
                val sessionsById = data.sessions.associateBy { it[SessionsTable.id] }
                val takePathsBySessionId = mutableMapOf<UUID, MutableList<String>>()

                if (includeAudio && storageClient != null) {
                    for (take in data.takes) {
                        val storage = take[TakesTable.storage]
                        if (storage != "supabase") continue
                        val sessionId = take[TakesTable.sessionId]
                        val session = sessionsById[sessionId]
                        val sessionDate = session?.get(SessionsTable.date) ?: LocalDate.now(ZoneOffset.UTC)
                        val song = songsById[take[TakesTable.songId]]
                        val songTitle = song?.get(SongsTable.title) ?: "untitled"
                        val safeTitle = sanitizeFilename(songTitle)
                        val recUtc = take[TakesTable.recordedAt].withOffsetSameInstant(ZoneOffset.UTC)
                        val recDateStr = recUtc.toLocalDate().toString()
                        val hhmmss = recUtc.format(DateTimeFormatter.ofPattern("HHmmss"))
                        val takeIdStr = take[TakesTable.id].toString().replace("-", "")
                        val takeId8 = takeIdStr.take(8)
                        val ext = TakeService.MIME_EXT[take[TakesTable.mime]] ?: "m4a"
                        val filename = "${recDateStr}_${hhmmss}_${safeTitle}_${takeId8}.${ext}"
                        val relativeZipPath = "녹음/$filename"

                        val audioBytes = try {
                            storageClient.download(take[TakesTable.storageKey])
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            log.warn("녹음 파일 다운로드 실패: key=${take[TakesTable.storageKey]}", e)
                            null
                        }
                        if (audioBytes != null) {
                            zip.putNextEntry(ZipEntry(relativeZipPath))
                            zip.write(audioBytes)
                            zip.closeEntry()

                            takePathsBySessionId.computeIfAbsent(sessionId) { mutableListOf() }.add(relativeZipPath)
                        }
                    }
                }

                // 3. 연습 기록.csv
                val sessionsCsv = buildString {
                    append(UTF8_BOM)
                    append("기록,곡,날짜,연습 시간(분),반복 횟수,속도,구간,메모,녹음\r\n")
                    for (row in data.sessions) {
                        val sessionId = row[SessionsTable.id]
                        val song = songsById[row[SessionsTable.songId]]
                        val songTitle = song?.get(SongsTable.title) ?: "(제목 없음)"
                        val date = row[SessionsTable.date]
                        val recordTitle = "$date $songTitle"
                        val seconds = row[SessionsTable.seconds]
                        val minutesVal = BigDecimal.valueOf(seconds / 60.0).setScale(2, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()
                        val loops = row[SessionsTable.loops].toString()
                        val rateStr = row[SessionsTable.rate]?.stripTrailingZeros()?.toPlainString() ?: ""
                        val segment = SessionService.formatSegment(row[SessionsTable.a], row[SessionsTable.b])
                        val memo = row[SessionsTable.memo]
                        val takePaths = takePathsBySessionId[sessionId]?.joinToString(", ") ?: ""

                        val cols = listOf(
                            csvCell(recordTitle),
                            csvCell(songTitle),
                            csvCell(date.toString()),
                            csvCell(minutesVal),
                            csvCell(loops),
                            csvCell(rateStr),
                            csvCell(segment),
                            csvCell(memo),
                            csvCell(takePaths)
                        )
                        append(cols.joinToString(",") + "\r\n")
                    }
                }
                zip.putNextEntry(ZipEntry("연습 기록.csv"))
                zip.write(sessionsCsv.toByteArray(StandardCharsets.UTF_8))
                zip.closeEntry()

                // 4. 학습 영상 노트.csv 및 md
                val notesCsv = buildString {
                    append(UTF8_BOM)
                    append("제목,URL,태그,채널,요약,키워드,난이도,메모\r\n")
                    for (row in data.notes) {
                        val title = row[NotesTable.title]
                        val videoId = row[NotesTable.videoId]
                        val url = "https://www.youtube.com/watch?v=$videoId"
                        val tags = row[NotesTable.tags].joinToString(", ")
                        val channel = row[NotesTable.channel]
                        val headline = row[NotesTable.headline]
                        val keywords = row[NotesTable.keywords].joinToString(", ")
                        val difficulty = row[NotesTable.difficulty] ?: ""
                        val memo = row[NotesTable.memo]

                        val cols = listOf(
                            csvCell(title),
                            csvCell(url),
                            csvCell(tags),
                            csvCell(channel),
                            csvCell(headline),
                            csvCell(keywords),
                            csvCell(difficulty),
                            csvCell(memo)
                        )
                        append(cols.joinToString(",") + "\r\n")
                    }
                }
                zip.putNextEntry(ZipEntry("학습 영상 노트.csv"))
                zip.write(notesCsv.toByteArray(StandardCharsets.UTF_8))
                zip.closeEntry()

                // 학습 영상 노트/*.md
                for (row in data.notes) {
                    val title = row[NotesTable.title]
                    val safeTitle = sanitizeFilename(title)
                    val noteId8 = row[NotesTable.id].toString().replace("-", "").take(8)
                    val mdPath = "학습 영상 노트/${safeTitle}_${noteId8}.md"
                    val videoId = row[NotesTable.videoId]
                    val channel = row[NotesTable.channel]
                    val tags = row[NotesTable.tags].joinToString(", ")
                    val difficulty = row[NotesTable.difficulty] ?: ""
                    val headline = row[NotesTable.headline]
                    val keywords = row[NotesTable.keywords].joinToString(", ")
                    val points = row[NotesTable.points]
                    val memo = row[NotesTable.memo]

                    val mdContent = buildString {
                        append("# $title\n\n")
                        append("- **URL:** https://www.youtube.com/watch?v=$videoId\n")
                        if (channel.isNotBlank()) append("- **채널:** $channel\n")
                        if (tags.isNotBlank()) append("- **태그:** $tags\n")
                        if (difficulty.isNotBlank()) append("- **난이도:** $difficulty\n")
                        if (headline.isNotBlank()) append("- **요약:** $headline\n")
                        if (keywords.isNotBlank()) append("- **키워드:** $keywords\n")
                        append("\n")
                        if (points.isNotEmpty()) {
                            append("## 핵심 요약\n")
                            for (pt in points) {
                                append("- $pt\n")
                            }
                            append("\n")
                        }
                        if (memo.isNotBlank()) {
                            append("## 메모\n")
                            append("$memo\n")
                        }
                    }

                    zip.putNextEntry(ZipEntry(mdPath))
                    zip.write(mdContent.toByteArray(StandardCharsets.UTF_8))
                    zip.closeEntry()
                }

                zip.finish()
            }
        }
    }

    suspend fun previewNotionZip(userId: UUID, zipBytes: ByteArray): ImportPreviewResponse {
        val database = requireDb()

        if (zipBytes.isEmpty()) {
            throw InvalidInputException("ZIP 파일(file 파트)이 비어 있거나 누락되었습니다.")
        }
        if (zipBytes.size > MAX_ZIP_BYTES) {
            throw ApiException(
                HttpStatusCode.PayloadTooLarge,
                "ZIP_TOO_LARGE",
                "ZIP 파일은 100MB 이하만 올릴 수 있습니다."
            )
        }

        // 1. 메모리 내 압축 해제 및 엔트리 수집
        data class RawCsv(val name: String, val content: String)
        val csvEntries = mutableListOf<RawCsv>()
        val audioEntries = mutableMapOf<String, ByteArray>()
        val audioFilenameCounts = mutableMapOf<String, Int>()
        val uniqueAudioByFilename = mutableMapOf<String, ByteArray>()

        var totalUncompressedBytes = 0L
        var totalEntries = 0
        var totalAudioBytes = 0L

        fun readStream(stream: ZipInputStream) {
            while (true) {
                val entry = stream.nextEntry ?: break
                if (entry.isDirectory) continue

                totalEntries++
                if (totalEntries > MAX_ZIP_ENTRIES) {
                    throw InvalidInputException("유효한 ZIP 파일이 아니거나 압축 해제 크기 제한(200MB)을 초과했습니다.")
                }

                val entryName = entry.name.replace("\\", "/").trimStart('/')
                val ext = entryName.substringAfterLast('.', "").lowercase()

                val buffer = ByteArrayOutputStream()
                val chunk = ByteArray(8192)
                var readCount: Int
                while (stream.read(chunk).also { readCount = it } != -1) {
                    totalUncompressedBytes += readCount
                    if (totalUncompressedBytes > MAX_UNZIPPED_BYTES) {
                        throw InvalidInputException("유효한 ZIP 파일이 아니거나 압축 해제 크기 제한(200MB)을 초과했습니다.")
                    }
                    buffer.write(chunk, 0, readCount)
                }
                val entryBytes = buffer.toByteArray()

                if (ext == "zip") {
                    // 이중 압축 해제
                    ZipInputStream(ByteArrayInputStream(entryBytes)).use { innerStream ->
                        readStream(innerStream)
                    }
                } else if (ext == "csv") {
                    val text = entryBytes.toString(StandardCharsets.UTF_8)
                    csvEntries.add(RawCsv(entryName, text))
                } else if (EXT_TO_MIME.containsKey(ext)) {
                    totalAudioBytes += entryBytes.size
                    if (totalAudioBytes > MAX_PREVIEW_AUDIO_BYTES) {
                        throw InvalidInputException("유효한 ZIP 파일이 아니거나 압축 해제 크기 제한(200MB)을 초과했습니다.")
                    }
                    audioEntries[entryName] = entryBytes
                    val simpleName = entryName.substringAfterLast('/')
                    val newCount = (audioFilenameCounts[simpleName] ?: 0) + 1
                    audioFilenameCounts[simpleName] = newCount
                    if (newCount == 1) {
                        uniqueAudioByFilename[simpleName] = entryBytes
                    } else {
                        uniqueAudioByFilename.remove(simpleName)
                    }
                }
            }
        }

        try {
            ZipInputStream(ByteArrayInputStream(zipBytes)).use { stream ->
                readStream(stream)
            }
        } catch (e: InvalidInputException) {
            throw e
        } catch (e: Exception) {
            throw InvalidInputException("유효한 ZIP 파일이 아니거나 압축 해제 크기 제한(200MB)을 초과했습니다.")
        }

        // 2. CSV 식별
        val songCsvEntry = csvEntries.filter { rawCsv ->
            val header = parseCsv(rawCsv.content).firstOrNull() ?: emptyList()
            header.any { it.trim() == "곡명" } &&
                (header.any { it.trim() == "유튜브 링크" } || header.any { it.trim() == "이어서 연습" })
        }.minByOrNull { if (it.name.contains("_all.csv")) 1 else 0 }
            ?: throw InvalidInputException("ZIP 파일 안에서 '연습 곡' CSV를 찾지 못했습니다.")

        val sessionCsvEntry = csvEntries.filter { rawCsv ->
            val header = parseCsv(rawCsv.content).firstOrNull() ?: emptyList()
            header.any { it.trim() == "기록" } && header.any { it.trim() == "날짜" }
        }.minByOrNull { if (it.name.contains("_all.csv")) 1 else 0 }

        val errors = mutableListOf<ImportRowErrorDto>()

        // 3. 연습 곡 행 파싱
        val songRows = parseCsv(songCsvEntry.content)
        val songHeader = songRows.firstOrNull() ?: emptyList()
        val songHeaderMap = songHeader.mapIndexed { idx, s -> s.trim() to idx }.toMap()

        val parsedSongs = mutableListOf<ParsedSong>()
        val seenVideoIds = mutableSetOf<String>()

        val colSongTitle = songHeaderMap["곡명"]
        val colSongArtist = songHeaderMap["아티스트"]
        val colSongStatus = songHeaderMap["상태"]
        val colSongYt = songHeaderMap["유튜브 링크"]
        val colSongResume = songHeaderMap["이어서 연습"]
        val colSongPos = songHeaderMap["마지막 위치(초)"]
        val colSongA = songHeaderMap["구간 시작(초)"]
        val colSongB = songHeaderMap["구간 끝(초)"]
        val colSongRate = songHeaderMap["속도"]
        val colSongLastDate = songHeaderMap["마지막 연습일"]
        val colSongMemo = songHeaderMap["메모"]

        for (i in 1 until songRows.size) {
            val row = songRows[i]
            if (row.all { it.isBlank() }) continue
            val rowNum = i + 1

            val ytLink = colSongYt?.let { row.getOrNull(it) }?.trim() ?: ""
            val resumeLink = colSongResume?.let { row.getOrNull(it) }?.trim() ?: ""
            val videoId = extractVideoId(ytLink.ifEmpty { resumeLink })
            if (videoId == null) {
                errors.add(ImportRowErrorDto(file = songCsvEntry.name, row = rowNum, reason = "유튜브 링크에서 11자리 영상 ID를 찾지 못했습니다."))
                continue
            }

            if (!seenVideoIds.add(videoId)) {
                // 중복 행 건너뜀
                continue
            }

            val rawTitle = colSongTitle?.let { row.getOrNull(it) }?.trim() ?: ""
            val title = (rawTitle.ifEmpty { "(제목 없음)" }).take(300)
            val artist = (colSongArtist?.let { row.getOrNull(it) }?.trim() ?: "").take(200)
            val rawStatus = colSongStatus?.let { row.getOrNull(it) }?.trim() ?: ""
            val status = SongService.normalizeStatus(rawStatus) ?: "practicing"

            val pos = parseDecimal(colSongPos?.let { row.getOrNull(it) }, 0.0, 86400.0, 1)
            var a = parseDecimal(colSongA?.let { row.getOrNull(it) }, 0.0, 86400.0, 1)
            var b = parseDecimal(colSongB?.let { row.getOrNull(it) }, 0.0, 86400.0, 1)
            if (a != null && b != null && a >= b) {
                a = null
                b = null
            }
            val rate = parseDecimal(colSongRate?.let { row.getOrNull(it) }, 0.25, 2.0, 2) ?: BigDecimal("1.00")

            val rawDate = colSongLastDate?.let { row.getOrNull(it) }?.trim() ?: ""
            val lastDate = if (DATE_REGEX.matches(rawDate)) runCatching { LocalDate.parse(rawDate) }.getOrNull() else null
            val memo = (colSongMemo?.let { row.getOrNull(it) }?.trim() ?: "").take(2000)

            parsedSongs.add(
                ParsedSong(
                    videoId = videoId,
                    title = title,
                    artist = artist,
                    status = status,
                    pos = pos,
                    a = a,
                    b = b,
                    rate = rate,
                    lastDate = lastDate,
                    memo = memo,
                    isNew = false // 4단계에서 판별
                )
            )
        }

        // 4. 기존 곡 조회 (트랜잭션 1, 읽기 전용)
        val existingSongs: List<ResultRow> = DatabaseFactory.dbQuery(database) {
            SongsTable.selectAll()
                .where { SongsTable.userId eq userId }
                .orderBy(SongsTable.lastDate to SortOrder.DESC_NULLS_LAST, SongsTable.updatedAt to SortOrder.DESC)
                .toList()
        }
        val existingByVideoId = existingSongs.associateBy { it[SongsTable.videoId] }
        val existingByTitleLower = existingSongs.groupBy { it[SongsTable.title].trim().lowercase() }.mapValues { it.value.first() }

        var newSongsCount = 0
        var updatedSongsCount = 0
        val finalParsedSongs = parsedSongs.map { s ->
            val isNew = !existingByVideoId.containsKey(s.videoId)
            if (isNew) newSongsCount++ else updatedSongsCount++
            s.copy(isNew = isNew)
        }

        // 5. 연습 기록 및 녹음 매칭
        val parsedSessions = mutableListOf<ParsedSession>()
        val parsedTakes = mutableListOf<ParsedTake>()
        val seenSessionKeys = mutableSetOf<Pair<String, LocalDate>>()

        if (sessionCsvEntry != null) {
            val sessionRows = parseCsv(sessionCsvEntry.content)
            val sessionHeader = sessionRows.firstOrNull() ?: emptyList()
            val sessionHeaderMap = sessionHeader.mapIndexed { idx, s -> s.trim() to idx }.toMap()

            val colRecTitle = sessionHeaderMap["기록"]
            val colRecSong = sessionHeaderMap["곡"]
            val colRecDate = sessionHeaderMap["날짜"]
            val colRecTime = sessionHeaderMap["연습 시간(분)"]
            val colRecLoops = sessionHeaderMap["반복 횟수"]
            val colRecRate = sessionHeaderMap["속도"]
            val colRecSegment = sessionHeaderMap["구간"]
            val colRecMemo = sessionHeaderMap["메모"]
            val colRecTakes = sessionHeaderMap["녹음"]

            for (i in 1 until sessionRows.size) {
                val row = sessionRows[i]
                if (row.all { it.isBlank() }) continue
                val rowNum = i + 1

                val rawDate = colRecDate?.let { row.getOrNull(it) }?.trim()?.take(10) ?: ""
                val sessionDate = if (DATE_REGEX.matches(rawDate)) runCatching { LocalDate.parse(rawDate) }.getOrNull() else null
                if (sessionDate == null) {
                    errors.add(ImportRowErrorDto(file = sessionCsvEntry.name, row = rowNum, reason = "날짜 형식이 올바르지 않습니다: $rawDate"))
                    continue
                }

                val rawSong = colRecSong?.let { row.getOrNull(it) }?.trim() ?: ""
                val cleanedSong = rawSong.replace(Regex("\\s*\\(https?://[^)]+\\)\\s*$"), "").trim()

                val rawRec = colRecTitle?.let { row.getOrNull(it) }?.trim() ?: ""
                val cleanedRec = rawRec.replace(Regex("^\\d{4}-\\d{2}-\\d{2}\\s+"), "").trim()

                // 곡 매칭 우선순위 (① cleanedSong -> ② cleanedRec -> ③ existingByTitleLower -> ④ error)
                var matchedVideoId: String? = null
                if (cleanedSong.isNotEmpty()) {
                    matchedVideoId = finalParsedSongs.firstOrNull { it.title.equals(cleanedSong, ignoreCase = true) }?.videoId
                }
                if (matchedVideoId == null && cleanedSong.isEmpty() && cleanedRec.isNotEmpty()) {
                    matchedVideoId = finalParsedSongs.firstOrNull { it.title.equals(cleanedRec, ignoreCase = true) }?.videoId
                }
                if (matchedVideoId == null) {
                    val keyToFind = (cleanedSong.ifEmpty { cleanedRec }).lowercase()
                    if (keyToFind.isNotEmpty()) {
                        matchedVideoId = existingByTitleLower[keyToFind]?.get(SongsTable.videoId)
                    }
                }

                if (matchedVideoId == null) {
                    val displaySong = cleanedSong.ifEmpty { cleanedRec }
                    errors.add(ImportRowErrorDto(file = sessionCsvEntry.name, row = rowNum, reason = "연결된 연습 곡을 찾을 수 없습니다: $displaySong"))
                    continue
                }

                val sessionKey = Pair(matchedVideoId, sessionDate)
                if (!seenSessionKeys.add(sessionKey)) {
                    continue
                }

                val rawTime = colRecTime?.let { row.getOrNull(it) }?.trim() ?: ""
                val minVal = rawTime.toDoubleOrNull() ?: 0.0
                val seconds = Math.round(minVal * 60.0).toInt().coerceIn(0, 86400)

                val rawLoops = colRecLoops?.let { row.getOrNull(it) }?.trim() ?: ""
                val loops = rawLoops.toIntOrNull()?.coerceIn(0, 100000) ?: 0

                val rawRate = colRecRate?.let { row.getOrNull(it) }?.trim() ?: ""
                val rate = parseDecimal(rawRate, 0.25, 2.0, 2)

                val rawSegment = colRecSegment?.let { row.getOrNull(it) }?.trim() ?: ""
                val (segA, segB) = parseSegment(rawSegment)

                val memo = (colRecMemo?.let { row.getOrNull(it) }?.trim() ?: "").take(2000)

                parsedSessions.add(
                    ParsedSession(
                        videoId = matchedVideoId,
                        date = sessionDate,
                        seconds = seconds,
                        loops = loops,
                        rate = rate,
                        a = segA,
                        b = segB,
                        memo = memo
                    )
                )

                // 녹음 열 파싱
                val rawTakes = colRecTakes?.let { row.getOrNull(it) }?.trim() ?: ""
                if (rawTakes.isNotEmpty()) {
                    val parts = rawTakes.split(",")
                    for (part in parts) {
                        val trimmed = part.trim()
                        if (trimmed.isEmpty()) continue

                        val decoded = try {
                            URLDecoder.decode(trimmed, StandardCharsets.UTF_8)
                        } catch (_: Exception) {
                            trimmed
                        }
                        val filename = decoded.substringAfterLast('/').substringAfterLast('\\').trim()
                        val decodedPath = decoded.replace("\\", "/").trimStart('/')
                        val csvDir = sessionCsvEntry.name.substringBeforeLast('/', "").replace("\\", "/").trimStart('/')
                        val relativeToCsv = if (csvDir.isNotEmpty()) "$csvDir/$decodedPath" else decodedPath

                        val bytes = audioEntries[decodedPath]
                            ?: audioEntries[relativeToCsv]
                            ?: run {
                                val count = audioFilenameCounts[filename] ?: 0
                                if (count > 1) {
                                    errors.add(ImportRowErrorDto(file = sessionCsvEntry.name, row = rowNum, reason = "녹음 파일 이름이 ZIP 안에서 겹쳐 연결할 수 없습니다: $filename"))
                                    null
                                } else if (count == 1) {
                                    uniqueAudioByFilename[filename]
                                } else {
                                    errors.add(ImportRowErrorDto(file = sessionCsvEntry.name, row = rowNum, reason = "녹음 파일을 ZIP 안에서 찾을 수 없습니다: $filename"))
                                    null
                                }
                            }
                        if (bytes == null) {
                            continue
                        }
                        if (bytes.isEmpty() || bytes.size > MAX_PREVIEW_AUDIO_BYTES) {
                            errors.add(ImportRowErrorDto(file = sessionCsvEntry.name, row = rowNum, reason = "녹음 파일 크기가 올바르지 않습니다: $filename"))
                            continue
                        }

                        val ext = filename.substringAfterLast('.', "").lowercase()
                        val mime = EXT_TO_MIME[ext]
                        if (mime == null) {
                            errors.add(ImportRowErrorDto(file = sessionCsvEntry.name, row = rowNum, reason = "지원하지 않는 녹음 파일 형식입니다: $filename"))
                            continue
                        }

                        val recordedAt = parseRecordedAtFromFilename(filename, sessionDate)
                        parsedTakes.add(
                            ParsedTake(
                                videoId = matchedVideoId,
                                sessionDate = sessionDate,
                                recordedAt = recordedAt,
                                a = segA,
                                b = segB,
                                rate = rate,
                                durationSec = 0,
                                mime = mime,
                                bytes = bytes
                            )
                        )
                    }
                }
            }
        }

        val token = previewStore.put(userId, finalParsedSongs, parsedSessions, parsedTakes)
        val songsSample = finalParsedSongs.take(20).map {
            ImportSongSampleDto(
                videoId = it.videoId,
                title = it.title,
                artist = it.artist,
                status = it.status,
                isNew = it.isNew
            )
        }

        return ImportPreviewResponse(
            ok = true,
            previewToken = token.toString(),
            newSongs = newSongsCount,
            updatedSongs = updatedSongsCount,
            sessions = parsedSessions.size,
            takes = parsedTakes.size,
            songsSample = songsSample,
            errors = errors
        )
    }

    suspend fun confirmNotionZip(userId: UUID, previewToken: UUID): ImportConfirmResponse {
        val database = requireDb()
        val entry = previewStore.take(userId, previewToken)
            ?: throw NotFoundException("미리보기 내역이 없거나 만료되었습니다. ZIP 파일을 다시 선택해 주세요.")

        var createdSongs = 0
        var updatedSongs = 0
        var upsertedSessions = 0
        var importedTakes = 0
        var skippedTakesByQuota = 0

        val songIdMap = mutableMapOf<String, UUID>()
        val sessionIdMap = mutableMapOf<Pair<String, LocalDate>, Pair<UUID, UUID>>()

        // 트랜잭션 1: 곡 및 세션 Upsert
        DatabaseFactory.dbQuery(database) {
            for (s in entry.parsedSongs) {
                val existing = SongsTable.selectAll()
                    .where { (SongsTable.userId eq userId) and (SongsTable.videoId eq s.videoId) }
                    .singleOrNull()

                val songId = if (existing == null) {
                    val newId = UUID.randomUUID()
                    SongsTable.insert {
                        it[id] = newId
                        it[SongsTable.userId] = userId
                        it[title] = s.title
                        it[artist] = s.artist
                        it[status] = s.status
                        it[videoId] = s.videoId
                        it[pos] = s.pos
                        it[a] = s.a
                        it[b] = s.b
                        it[rate] = s.rate
                        it[lastDate] = s.lastDate
                        it[memo] = s.memo
                    }
                    createdSongs++
                    OutboxRepository.enqueueIfSyncEnabled(userId, "song", newId, "upsert")
                    newId
                } else {
                    val id = existing[SongsTable.id]
                    val existingLastDate = existing[SongsTable.lastDate]
                    val mergedLastDate = when {
                        existingLastDate == null -> s.lastDate
                        s.lastDate == null -> existingLastDate
                        s.lastDate > existingLastDate -> s.lastDate
                        else -> existingLastDate
                    }
                    SongsTable.update({ (SongsTable.id eq id) and (SongsTable.userId eq userId) }) {
                        it[title] = s.title
                        it[artist] = s.artist
                        it[status] = s.status
                        it[pos] = s.pos
                        it[a] = s.a
                        it[b] = s.b
                        it[rate] = s.rate
                        it[lastDate] = mergedLastDate
                        it[memo] = s.memo
                    }
                    updatedSongs++
                    OutboxRepository.enqueueIfSyncEnabled(userId, "song", id, "upsert")
                    id
                }
                songIdMap[s.videoId] = songId
            }

            for (sess in entry.parsedSessions) {
                val songId = songIdMap[sess.videoId]
                    ?: SongsTable.select(SongsTable.id)
                        .where { (SongsTable.userId eq userId) and (SongsTable.videoId eq sess.videoId) }
                        .singleOrNull()?.get(SongsTable.id)
                    ?: continue

                val existing = SessionsTable.selectAll()
                    .where {
                        (SessionsTable.userId eq userId) and
                        (SessionsTable.songId eq songId) and
                        (SessionsTable.date eq sess.date)
                    }
                    .singleOrNull()

                val sessionId = if (existing == null) {
                    val newId = UUID.randomUUID()
                    SessionsTable.insert {
                        it[id] = newId
                        it[SessionsTable.userId] = userId
                        it[SessionsTable.songId] = songId
                        it[date] = sess.date
                        it[seconds] = sess.seconds
                        it[loops] = sess.loops
                        it[rate] = sess.rate
                        it[a] = sess.a
                        it[b] = sess.b
                        it[memo] = sess.memo
                    }
                    upsertedSessions++
                    OutboxRepository.enqueueIfSyncEnabled(userId, "session", newId, "upsert")
                    newId
                } else {
                    val id = existing[SessionsTable.id]
                    SessionsTable.update({ (SessionsTable.id eq id) and (SessionsTable.userId eq userId) }) {
                        it[seconds] = sess.seconds
                        it[loops] = sess.loops
                        it[rate] = sess.rate
                        it[a] = sess.a
                        it[b] = sess.b
                        it[memo] = sess.memo
                    }
                    upsertedSessions++
                    OutboxRepository.enqueueIfSyncEnabled(userId, "session", id, "upsert")
                    id
                }
                sessionIdMap[Pair(sess.videoId, sess.date)] = Pair(songId, sessionId)

                val currentSongLastDate = SongsTable.select(SongsTable.lastDate)
                    .where { SongsTable.id eq songId }
                    .single()[SongsTable.lastDate]
                if (currentSongLastDate == null || sess.date > currentSongLastDate) {
                    SongsTable.update({ SongsTable.id eq songId }) {
                        it[lastDate] = sess.date
                    }
                }
            }
        }

        // 트랜잭션 밖: 녹음 파일 반영
        if (storageClient != null && entry.parsedTakes.isNotEmpty()) {
            for (take in entry.parsedTakes) {
                val pair = sessionIdMap[Pair(take.videoId, take.sessionDate)] ?: continue
                val songId = pair.first
                val sessionId = pair.second

                // 사전 중복 및 쿼터 검사
                val check = DatabaseFactory.dbQuery(database) {
                    val dup = TakesTable.select(TakesTable.id)
                        .where {
                            (TakesTable.sessionId eq sessionId) and
                            (TakesTable.recordedAt eq take.recordedAt) and
                            (TakesTable.sizeBytes eq take.bytes.size.toLong())
                        }
                        .count() > 0L
                    if (dup) return@dbQuery Precheck.DUPLICATE

                    val quota = ProfilesTable.select(ProfilesTable.takeQuotaBytes)
                        .where { ProfilesTable.id eq userId }
                        .single()[ProfilesTable.takeQuotaBytes]

                    val sumExpr = TakesTable.sizeBytes.sum()
                    val used = TakesTable.select(sumExpr)
                        .where { (TakesTable.userId eq userId) and (TakesTable.storage eq "supabase") }
                        .singleOrNull()?.get(sumExpr) ?: 0L

                    if (used + take.bytes.size > quota) {
                        Precheck.QUOTA_EXCEEDED
                    } else {
                        Precheck.OK
                    }
                }

                if (check == Precheck.DUPLICATE) {
                    continue
                }
                if (check == Precheck.QUOTA_EXCEEDED) {
                    skippedTakesByQuota++
                    continue
                }

                val takeId = UUID.randomUUID()
                val ext = TakeService.MIME_EXT[take.mime] ?: "m4a"
                val key = "$userId/$takeId.$ext"

                try {
                    storageClient.upload(key, take.bytes, take.mime)
                } catch (e: CancellationException) {
                    cleanupUploadedFile(storageClient, database, key)
                    throw e
                } catch (e: Exception) {
                    log.warn("가져오기 중 스토리지 업로드 실패: key=$key", e)
                    cleanupUploadedFile(storageClient, database, key)
                    continue
                }

                class QuotaExceededException : RuntimeException()

                try {
                    DatabaseFactory.dbQuery(database) {
                        val quota = ProfilesTable.select(ProfilesTable.takeQuotaBytes)
                            .where { ProfilesTable.id eq userId }
                            .forUpdate(ForUpdateOption.ForUpdate)
                            .single()[ProfilesTable.takeQuotaBytes]

                        val sumExpr = TakesTable.sizeBytes.sum()
                        val used = TakesTable.select(sumExpr)
                            .where { (TakesTable.userId eq userId) and (TakesTable.storage eq "supabase") }
                            .singleOrNull()?.get(sumExpr) ?: 0L

                        if (used + take.bytes.size > quota) {
                            throw QuotaExceededException()
                        }

                        TakesTable.insert {
                            it[id] = takeId
                            it[TakesTable.userId] = userId
                            it[TakesTable.sessionId] = sessionId
                            it[TakesTable.songId] = songId
                            it[recordedAt] = take.recordedAt
                            it[a] = take.a
                            it[b] = take.b
                            it[rate] = take.rate
                            it[durationSec] = take.durationSec
                            it[mime] = take.mime
                            it[sizeBytes] = take.bytes.size.toLong()
                            it[storage] = "supabase"
                            it[storageKey] = key
                            it[memo] = ""
                        }
                        OutboxRepository.enqueueIfSyncEnabled(userId, "take", takeId, "upsert")
                        importedTakes++
                    }
                } catch (e: CancellationException) {
                    cleanupUploadedFile(storageClient, database, key)
                    throw e
                } catch (e: QuotaExceededException) {
                    skippedTakesByQuota++
                    cleanupUploadedFile(storageClient, database, key)
                } catch (e: Exception) {
                    log.warn("가져오기 중 DB 기록 실패, 업로드 파일 삭제: key=$key", e)
                    cleanupUploadedFile(storageClient, database, key)
                }
            }
        }

        return ImportConfirmResponse(
            ok = true,
            createdSongs = createdSongs,
            updatedSongs = updatedSongs,
            upsertedSessions = upsertedSessions,
            importedTakes = importedTakes,
            skippedTakesByQuota = skippedTakesByQuota
        )
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
                log.info("트랜잭션이 이미 커밋되었으므로 스토리지 파일($key)을 보존합니다.")
                return@withContext
            }

            try {
                client.delete(key)
            } catch (delEx: Throwable) {
                if (delEx is CancellationException) throw delEx
                log.warn("트랜잭션 실패 후 스토리지 파일($key) 삭제 실패, storage_trash에 등록합니다.", delEx)
                try {
                    DatabaseFactory.dbQuery(database) {
                        StorageTrashTable.insert {
                            it[storageKey] = key
                        }
                    }
                } catch (trashEx: Throwable) {
                    log.warn("storage_trash 등록 실패: key=$key", trashEx)
                }
            }
        }
    }

    companion object {
        const val MAX_ZIP_BYTES = 104_857_600L           // 100MB
        const val MAX_UNZIPPED_BYTES = 209_715_200L      // 200MB (Zip Bomb 방어)
        const val MAX_PREVIEW_AUDIO_BYTES = 52_428_800L  // 미리보기 1건당 메모리 보관 오디오 합계 한도 50MB
        const val MAX_ZIP_ENTRIES = 1_000
        const val PREVIEW_TTL_SECONDS = 900L             // 15분
        const val MAX_PREVIEWS_PER_USER = 1              // 사용자당 최신 미리보기 1개만 유지 (단일 인스턴스 전제)
        const val MAX_TOTAL_PREVIEWS = 10                // 서버 전체 최대 10개 유지
        const val UTF8_BOM = "\uFEFF"

        val EXT_TO_MIME: Map<String, String> = mapOf(
            "m4a" to "audio/mp4",
            "mp4" to "audio/mp4",
            "weba" to "audio/webm",
            "webm" to "audio/webm",
            "ogg" to "audio/ogg",
            "mp3" to "audio/mpeg",
            "wav" to "audio/wav",
            "aac" to "audio/aac"
        )

        private val DATE_REGEX = Regex("^\\d{4}-\\d{2}-\\d{2}$")
        private val FILENAME_UTC_REGEX = Regex("^(\\d{4}-\\d{2}-\\d{2})_(\\d{2})(\\d{2})(\\d{2})_")
        private val FILENAME_SEOUL_REGEX = Regex("^(\\d{4}-\\d{2}-\\d{2})\\s+(\\d{2})(\\d{2})(?:\\s+|\\.|\$)")
        private val VIDEO_ID_REGEX = Regex("""(?:youtu\.be/|[?&]v=|/(?:shorts|embed|live)/|^)([A-Za-z0-9_-]{11})(?:[?&#]|$)""")

        fun extractVideoId(urlOrId: String): String? {
            val trimmed = urlOrId.trim()
            if (trimmed.isEmpty()) return null
            val match = VIDEO_ID_REGEX.find(trimmed) ?: return null
            return match.groupValues[1]
        }

        fun sanitizeFilename(title: String): String {
            val safe = title.replace(Regex("[\\\\/:*?\"<>|\\s]+"), "_").trim('_')
            return if (safe.isEmpty()) "untitled" else safe.take(40)
        }

        private fun parseDecimal(raw: String?, min: Double, max: Double, scale: Int): BigDecimal? {
            if (raw.isNullOrBlank()) return null
            val d = raw.trim().toDoubleOrNull() ?: return null
            if (d < min || d > max) return null
            return BigDecimal.valueOf(d).setScale(scale, RoundingMode.HALF_UP)
        }

        fun csvCell(value: String?): String {
            if (value == null) return ""
            return if (value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r')) {
                "\"" + value.replace("\"", "\"\"") + "\""
            } else {
                value
            }
        }

        fun parseCsv(rawText: String): List<List<String>> {
            val text = if (rawText.startsWith(UTF8_BOM)) rawText.removePrefix(UTF8_BOM) else rawText
            val rows = mutableListOf<List<String>>()
            val currentRow = mutableListOf<String>()
            val currentField = StringBuilder()
            var inQuotes = false
            var i = 0

            while (i < text.length) {
                val c = text[i]
                if (inQuotes) {
                    if (c == '"') {
                        if (i + 1 < text.length && text[i + 1] == '"') {
                            currentField.append('"')
                            i++
                        } else {
                            inQuotes = false
                        }
                    } else {
                        currentField.append(c)
                    }
                } else {
                    when (c) {
                        '"' -> inQuotes = true
                        ',' -> {
                            currentRow.add(currentField.toString())
                            currentField.setLength(0)
                        }
                        '\r' -> {
                            if (i + 1 < text.length && text[i + 1] == '\n') {
                                i++
                            }
                            currentRow.add(currentField.toString())
                            currentField.setLength(0)
                            rows.add(currentRow.toList())
                            currentRow.clear()
                        }
                        '\n' -> {
                            currentRow.add(currentField.toString())
                            currentField.setLength(0)
                            rows.add(currentRow.toList())
                            currentRow.clear()
                        }
                        else -> currentField.append(c)
                    }
                }
                i++
            }

            if (currentField.isNotEmpty() || currentRow.isNotEmpty()) {
                currentRow.add(currentField.toString())
                rows.add(currentRow.toList())
            }

            // 끝에 공백 1칸만 있는 빈 행 제거
            if (rows.isNotEmpty() && rows.last().size == 1 && rows.last()[0].isEmpty()) {
                rows.removeAt(rows.size - 1)
            }

            return rows
        }

        fun parseSegment(raw: String?): Pair<BigDecimal?, BigDecimal?> {
            if (raw.isNullOrBlank()) return Pair(null, null)
            val parts = raw.trim().split(Regex("[\\u2013\\-]"))
            if (parts.size != 2) return Pair(null, null)

            fun parseMmSs(part: String): BigDecimal? {
                val trimmed = part.trim()
                if (!trimmed.contains(':')) {
                    val sec = trimmed.toDoubleOrNull() ?: return null
                    return BigDecimal.valueOf(sec).setScale(1, RoundingMode.HALF_UP)
                }
                val minStr = trimmed.substringBefore(':')
                val secStr = trimmed.substringAfter(':')
                val min = minStr.toLongOrNull() ?: return null
                val sec = secStr.toDoubleOrNull() ?: return null
                val total = min * 60.0 + sec
                return BigDecimal.valueOf(total).setScale(1, RoundingMode.HALF_UP)
            }

            val a = parseMmSs(parts[0])
            val b = parseMmSs(parts[1])
            if (a == null || b == null || a >= b || a < BigDecimal.ZERO || b > BigDecimal(86400)) {
                return Pair(null, null)
            }
            return Pair(a, b)
        }

        fun parseRecordedAtFromFilename(filename: String, sessionDate: LocalDate): OffsetDateTime {
            val fallback = sessionDate.atStartOfDay().atOffset(ZoneOffset.UTC).truncatedTo(ChronoUnit.SECONDS)
            try {
                val m1 = FILENAME_UTC_REGEX.find(filename)
                if (m1 != null) {
                    val dateStr = m1.groupValues[1]
                    val h = m1.groupValues[2].toInt()
                    val m = m1.groupValues[3].toInt()
                    val s = m1.groupValues[4].toInt()
                    val ld = LocalDate.parse(dateStr)
                    val lt = LocalTime.of(h, m, s)
                    return OffsetDateTime.of(ld, lt, ZoneOffset.UTC).truncatedTo(ChronoUnit.SECONDS)
                }

                val m2 = FILENAME_SEOUL_REGEX.find(filename)
                if (m2 != null) {
                    val dateStr = m2.groupValues[1]
                    val h = m2.groupValues[2].toInt()
                    val m = m2.groupValues[3].toInt()
                    val ld = LocalDate.parse(dateStr)
                    val lt = LocalTime.of(h, m, 0)
                    val seoulZone = ZoneOffset.ofHours(9)
                    return OffsetDateTime.of(ld, lt, seoulZone).withOffsetSameInstant(ZoneOffset.UTC).truncatedTo(ChronoUnit.SECONDS)
                }
            } catch (_: Exception) {
                return fallback
            }
            return fallback
        }
    }
}
