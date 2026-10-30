package ulevelp.service

import io.ktor.http.*
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.sql.*
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import org.jetbrains.exposed.sql.SqlExpressionBuilder.plus
import org.jetbrains.exposed.sql.vendors.ForUpdateOption
import ulevelp.api.ApiException
import ulevelp.api.NotFoundException
import ulevelp.db.DatabaseFactory
import ulevelp.db.OutboxRepository
import ulevelp.db.SessionsTable
import ulevelp.db.SongsTable
import java.math.BigDecimal
import java.time.LocalDate
import java.util.UUID

@Serializable
data class SaveProgressResponse(
    val ok: Boolean = true,
    val keep: Boolean,
    val sessionId: String?,
    val totalSeconds: Int?,
    val minutes: Double?,
    val pendingSeconds: Int?
)

data class SaveProgressInput(
    val songId: UUID,
    val pos: BigDecimal,
    val a: BigDecimal?,
    val b: BigDecimal?,
    val rate: BigDecimal?,
    val date: LocalDate,
    val addSeconds: Int,
    val addLoops: Int
)

class PracticeService(private val db: Database?) {

    private fun requireDb(): Database =
        db ?: throw ApiException(
            status = HttpStatusCode.ServiceUnavailable,
            code = "DB_UNAVAILABLE",
            message = "데이터베이스가 연결되어 있지 않습니다."
        )

    private fun Transaction.updateSessionInTransaction(userId: UUID, input: SaveProgressInput): Int {
        return SessionsTable.update({
            (SessionsTable.userId eq userId) and
            (SessionsTable.songId eq input.songId) and
            (SessionsTable.date eq input.date)
        }) {
            with(SqlExpressionBuilder) {
                it[seconds] = seconds + input.addSeconds
                it[loops] = loops + input.addLoops
            }
            if (input.rate != null) {
                it[rate] = input.rate
            }
            it[a] = input.a
            it[b] = input.b
        }
    }

    suspend fun saveProgress(userId: UUID, input: SaveProgressInput): SaveProgressResponse {
        val database = requireDb()
        return DatabaseFactory.dbQuery(database) {
            // 1. 곡 존재 확인 및 배타적 행 잠금 (FOR UPDATE)
            val songRow = SongsTable
                .select(SongsTable.lastDate)
                .where { (SongsTable.id eq input.songId) and (SongsTable.userId eq userId) }
                .forUpdate(ForUpdateOption.ForUpdate)
                .singleOrNull() ?: throw NotFoundException("곡을 찾을 수 없습니다.")

            val existingLastDate = songRow[SongsTable.lastDate]
            val newLast = if (existingLastDate != null) {
                if (existingLastDate > input.date) existingLastDate else input.date
            } else {
                input.date
            }

            // 2. 곡 위치·구간·배속·마지막 연습일 갱신
            SongsTable.update({ (SongsTable.id eq input.songId) and (SongsTable.userId eq userId) }) {
                it[pos] = input.pos
                it[a] = input.a
                it[b] = input.b
                if (input.rate != null) {
                    it[rate] = input.rate
                }
                it[lastDate] = newLast
            }

            // 3. 추가 초/루프가 0이면 곡만 갱신하고 종료
            if (input.addSeconds == 0 && input.addLoops == 0) {
                OutboxRepository.enqueueIfSyncEnabled(userId, "song", input.songId, "upsert")
                return@dbQuery SaveProgressResponse(
                    ok = true,
                    keep = false,
                    sessionId = null,
                    totalSeconds = null,
                    minutes = null,
                    pendingSeconds = null
                )
            }

            // 4. 당일 세션 합산 UPDATE 시도
            val updatedSessionCount = updateSessionInTransaction(userId, input)

            // 5. 합산 대상 행이 없는 경우 (당일 첫 연습 기록)
            if (updatedSessionCount == 0) {
                if (input.addSeconds < MIN_NEW_SESSION_SECONDS) {
                    OutboxRepository.enqueueIfSyncEnabled(userId, "song", input.songId, "upsert")
                    return@dbQuery SaveProgressResponse(
                        ok = true,
                        keep = true,
                        sessionId = null,
                        totalSeconds = null,
                        minutes = null,
                        pendingSeconds = input.addSeconds
                    )
                }

                val newSessionId = UUID.randomUUID()
                val insCount = SessionsTable.insertIgnore {
                    it[id] = newSessionId
                    it[SessionsTable.userId] = userId
                    it[SessionsTable.songId] = input.songId
                    it[date] = input.date
                    it[seconds] = input.addSeconds
                    it[loops] = input.addLoops
                    if (input.rate != null) {
                        it[rate] = input.rate
                    }
                    it[a] = input.a
                    it[b] = input.b
                }.insertedCount

                if (insCount == 0) {
                    // 동시 요청으로 다른 트랜잭션이 이미 INSERT한 경우 다시 UPDATE
                    updateSessionInTransaction(userId, input)
                }
            }

            // 6. 당일 세션 읽기
            val sessionRow = SessionsTable.selectAll()
                .where {
                    (SessionsTable.userId eq userId) and
                    (SessionsTable.songId eq input.songId) and
                    (SessionsTable.date eq input.date)
                }
                .single()

            val sessionId = sessionRow[SessionsTable.id]
            val totalSeconds = sessionRow[SessionsTable.seconds]

            // 7. Outbox 적재
            OutboxRepository.enqueueIfSyncEnabled(userId, "song", input.songId, "upsert")
            OutboxRepository.enqueueIfSyncEnabled(userId, "session", sessionId, "upsert")

            // 8. 응답 반환
            val minutes = Math.round(totalSeconds / 60.0 * 10) / 10.0
            SaveProgressResponse(
                ok = true,
                keep = false,
                sessionId = sessionId.toString(),
                totalSeconds = totalSeconds,
                minutes = minutes,
                pendingSeconds = null
            )
        }
    }

    companion object {
        const val MIN_NEW_SESSION_SECONDS = 60
    }
}
