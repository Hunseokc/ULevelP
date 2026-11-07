package ulevelp.service

import io.ktor.http.*
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.sql.*
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import ulevelp.api.ApiException
import ulevelp.api.NotFoundException
import ulevelp.db.DatabaseFactory
import ulevelp.db.OutboxRepository
import ulevelp.db.SessionsTable
import ulevelp.db.SongsTable
import ulevelp.db.TakesTable
import java.math.BigDecimal
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.temporal.TemporalAdjusters
import java.util.UUID

@Serializable
data class SessionSummaryDto(
    val thisWeekSeconds: Long,
    val thisMonthSeconds: Long
)

@Serializable
data class CalendarDayDto(
    val date: String,
    val totalSeconds: Long,
    val level: Int
)

@Serializable
data class SessionWithSongDto(
    val id: String,
    val songId: String,
    val songTitle: String,
    val songArtist: String,
    val videoId: String,
    val date: String,
    val seconds: Int,
    val minutes: Double,
    val loops: Int,
    val a: Double?,
    val b: Double?,
    val segment: String,
    val rate: Double?,
    val memo: String,
    val takes: List<TakeDto>
)

@Serializable
data class SessionListResponse(
    val summary: SessionSummaryDto,
    val calendar: List<CalendarDayDto>,
    val sessions: List<SessionWithSongDto>
)

class SessionService(private val db: Database?) {

    private fun requireDb(): Database =
        db ?: throw ApiException(
            status = HttpStatusCode.ServiceUnavailable,
            code = "DB_UNAVAILABLE",
            message = "데이터베이스가 연결되어 있지 않습니다."
        )

    suspend fun list(userId: UUID, from: LocalDate, to: LocalDate, today: LocalDate): SessionListResponse {
        val database = requireDb()
        return DatabaseFactory.dbQuery(database) {
            // 1. 주간·월간 범위 계산
            val weekStart = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
            val weekEnd = weekStart.plusDays(6)
            val monthStart = today.withDayOfMonth(1)
            val monthEnd = today.with(TemporalAdjusters.lastDayOfMonth())

            // 2. 주간·월간 합계 조회
            val sumExpr = SessionsTable.seconds.sum()
            val thisWeekSeconds = SessionsTable
                .select(sumExpr)
                .where {
                    (SessionsTable.userId eq userId) and
                    (SessionsTable.date greaterEq weekStart) and
                    (SessionsTable.date lessEq weekEnd)
                }
                .singleOrNull()?.get(sumExpr)?.toLong() ?: 0L

            val thisMonthSeconds = SessionsTable
                .select(sumExpr)
                .where {
                    (SessionsTable.userId eq userId) and
                    (SessionsTable.date greaterEq monthStart) and
                    (SessionsTable.date lessEq monthEnd)
                }
                .singleOrNull()?.get(sumExpr)?.toLong() ?: 0L

            // 3. 기간 내 세션 + 곡 조인 조회
            val sessionRows = SessionsTable
                .innerJoin(SongsTable, { SessionsTable.songId }, { SongsTable.id })
                .selectAll()
                .where {
                    (SessionsTable.userId eq userId) and
                    (SessionsTable.date greaterEq from) and
                    (SessionsTable.date lessEq to)
                }
                .orderBy(
                    SessionsTable.date to SortOrder.DESC,
                    SessionsTable.updatedAt to SortOrder.DESC
                )
                .toList()

            // 4. 기간 내 세션들의 녹음(takes) 일괄 조회
            val sessionIds = sessionRows.map { it[SessionsTable.id] }
            val takesBySessionId: Map<UUID, List<TakeDto>> = if (sessionIds.isNotEmpty()) {
                TakesTable
                    .selectAll()
                    .where {
                        (TakesTable.userId eq userId) and
                        (TakesTable.sessionId inList sessionIds)
                    }
                    .orderBy(TakesTable.recordedAt to SortOrder.ASC)
                    .map { rowToTakeDto(it) }
                    .groupBy { UUID.fromString(it.sessionId) }
            } else {
                emptyMap()
            }

            // 5. 달력 집계 (calendar): totalSeconds > 0L인 날짜만 date 오름차순으로 정렬
            val calendarByDate = mutableMapOf<LocalDate, Long>()
            for (row in sessionRows) {
                val d = row[SessionsTable.date]
                val sec = row[SessionsTable.seconds].toLong()
                calendarByDate[d] = (calendarByDate[d] ?: 0L) + sec
            }
            val calendar = calendarByDate
                .filter { it.value > 0L }
                .toSortedMap()
                .map { (d, totalSec) ->
                    CalendarDayDto(
                        date = d.toString(),
                        totalSeconds = totalSec,
                        level = levelForSeconds(totalSec)
                    )
                }

            // 세션 리스트 변환
            val sessions = sessionRows.map { row ->
                val sessionId = row[SessionsTable.id]
                val sec = row[SessionsTable.seconds]
                val aDec = row[SessionsTable.a]
                val bDec = row[SessionsTable.b]
                SessionWithSongDto(
                    id = sessionId.toString(),
                    songId = row[SessionsTable.songId].toString(),
                    songTitle = row[SongsTable.title],
                    songArtist = row[SongsTable.artist],
                    videoId = row[SongsTable.videoId],
                    date = row[SessionsTable.date].toString(),
                    seconds = sec,
                    minutes = toMinutes(sec),
                    loops = row[SessionsTable.loops],
                    a = aDec?.toDouble(),
                    b = bDec?.toDouble(),
                    segment = formatSegment(aDec, bDec),
                    rate = row[SessionsTable.rate]?.toDouble(),
                    memo = row[SessionsTable.memo],
                    takes = takesBySessionId[sessionId] ?: emptyList()
                )
            }

            SessionListResponse(
                summary = SessionSummaryDto(
                    thisWeekSeconds = thisWeekSeconds,
                    thisMonthSeconds = thisMonthSeconds
                ),
                calendar = calendar,
                sessions = sessions
            )
        }
    }

    suspend fun updateMemo(userId: UUID, sessionId: UUID, memo: String) {
        val database = requireDb()
        DatabaseFactory.dbQuery(database) {
            val updated = SessionsTable.update({
                (SessionsTable.id eq sessionId) and (SessionsTable.userId eq userId)
            }) {
                it[SessionsTable.memo] = memo
            }
            if (updated == 0) {
                throw NotFoundException("연습 기록을 찾을 수 없습니다.")
            }
            OutboxRepository.enqueueIfSyncEnabled(userId, "session", sessionId, "upsert")
        }
    }

    companion object {
        const val DEFAULT_CALENDAR_DAYS = 84L   // 12주 = 84일 (today - 83일 ~ today)
        const val MAX_RANGE_DAYS = 365L         // ChronoUnit.DAYS.between(from, to) <= 365 (최대 366일)

        /**
         * 연습 시간(초) → 달력 농도 단계(1~4).
         * 1..899초(15분 미만) -> 1, 900..1799초(30분 미만) -> 2, 1800..3599초(60분 미만) -> 3, 3600초 이상 -> 4.
         * 0초 이하는 0.
         */
        fun levelForSeconds(totalSeconds: Long): Int = when {
            totalSeconds >= 3600L -> 4
            totalSeconds >= 1800L -> 3
            totalSeconds >= 900L -> 2
            totalSeconds >= 1L -> 1
            else -> 0
        }

        /**
         * a, b가 둘 다 null이 아니면 "${formatMmSs(a)}–${formatMmSs(b)}" (en dash '\u2013'), 아니면 "".
         * formatMmSs(x): 초를 floor 정수 내림해 m:ss (초는 2자리 0 패딩). 예: 38.0 -> "0:38", 125.9 -> "2:05".
         */
        fun formatSegment(a: BigDecimal?, b: BigDecimal?): String {
            if (a == null || b == null) return ""
            fun formatMmSs(sec: BigDecimal): String {
                val totalSec = sec.toInt()
                val m = totalSec / 60
                val s = totalSec % 60
                return "$m:${s.toString().padStart(2, '0')}"
            }
            return "${formatMmSs(a)}\u2013${formatMmSs(b)}"
        }

        /** seconds -> 소수 첫째 자리 반올림 분 (Math.round(seconds / 60.0 * 10) / 10.0) */
        fun toMinutes(seconds: Int): Double =
            Math.round(seconds / 60.0 * 10.0) / 10.0

        /** TakesTable ResultRow -> TakeDto 변환 (K2-2에서도 공용으로 씀) */
        fun rowToTakeDto(row: ResultRow): TakeDto =
            TakeDto(
                id = row[TakesTable.id].toString(),
                sessionId = row[TakesTable.sessionId].toString(),
                recordedAt = DateTimeFormatter.ISO_INSTANT.format(row[TakesTable.recordedAt].toInstant()),
                a = row[TakesTable.a]?.toDouble(),
                b = row[TakesTable.b]?.toDouble(),
                rate = row[TakesTable.rate]?.toDouble(),
                durationSec = row[TakesTable.durationSec],
                mime = row[TakesTable.mime],
                sizeBytes = row[TakesTable.sizeBytes],
                storage = row[TakesTable.storage],
                storageKey = row[TakesTable.storageKey],
                memo = row[TakesTable.memo]
            )
    }
}
