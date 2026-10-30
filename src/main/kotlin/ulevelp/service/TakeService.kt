package ulevelp.service

import io.ktor.http.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.sql.*
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import org.jetbrains.exposed.sql.vendors.ForUpdateOption
import org.slf4j.LoggerFactory
import ulevelp.api.ApiException
import ulevelp.api.InvalidInputException
import ulevelp.api.NotFoundException
import ulevelp.db.DatabaseFactory
import ulevelp.db.OutboxRepository
import ulevelp.db.ProfilesTable
import ulevelp.db.SessionsTable
import ulevelp.db.SongsTable
import ulevelp.db.StorageTrashTable
import ulevelp.db.TakesTable
import ulevelp.storage.StorageClient
import ulevelp.storage.StorageException
import java.math.BigDecimal
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.util.UUID

@Serializable
data class TakeDto(
    val id: String,
    val sessionId: String,
    val recordedAt: String,
    val a: Double?,
    val b: Double?,
    val rate: Double?,
    val durationSec: Int,
    val mime: String,
    val sizeBytes: Long,
    val storage: String,
    val storageKey: String,
    val memo: String
)

@Serializable
data class TakeEnvelope(val ok: Boolean = true, val take: TakeDto)

@Serializable
data class SignedUrlResponse(val url: String, val expiresIn: Int)

data class TakeUploadInput(
    val songId: UUID,
    val date: LocalDate,
    val recordedAt: OffsetDateTime,
    val a: BigDecimal?,
    val b: BigDecimal?,
    val rate: BigDecimal?,
    val durationSec: Int,
    val mime: String,
    val bytes: ByteArray
)

class TakeService(
    private val db: Database?,
    private val storageClient: StorageClient?
) {
    private val log = LoggerFactory.getLogger(TakeService::class.java)

    val isStorageConfigured: Boolean get() = storageClient != null

    private fun requireDb(): Database =
        db ?: throw ApiException(
            status = HttpStatusCode.ServiceUnavailable,
            code = "DB_UNAVAILABLE",
            message = "데이터베이스가 연결되어 있지 않습니다."
        )

    private data class SessionEnsureResult(val sessionId: UUID, val created: Boolean)

    private fun Transaction.ensureSession(
        userId: UUID,
        songId: UUID,
        date: LocalDate,
        rate: BigDecimal?,
        a: BigDecimal?,
        b: BigDecimal?
    ): SessionEnsureResult {
        val existingSession = SessionsTable
            .select(SessionsTable.id)
            .where {
                (SessionsTable.userId eq userId) and
                (SessionsTable.songId eq songId) and
                (SessionsTable.date eq date)
            }
            .singleOrNull()

        if (existingSession != null) {
            return SessionEnsureResult(existingSession[SessionsTable.id], created = false)
        }

        val newId = UUID.randomUUID()
        val insCount = SessionsTable.insertIgnore {
            it[id] = newId
            it[SessionsTable.userId] = userId
            it[SessionsTable.songId] = songId
            it[SessionsTable.date] = date
            it[seconds] = 0
            it[loops] = 0
            if (rate != null) {
                it[SessionsTable.rate] = rate
            }
            it[SessionsTable.a] = a
            it[SessionsTable.b] = b
        }.insertedCount

        return if (insCount == 1) {
            SessionEnsureResult(newId, created = true)
        } else {
            val foundId = SessionsTable
                .select(SessionsTable.id)
                .where {
                    (SessionsTable.userId eq userId) and
                    (SessionsTable.songId eq songId) and
                    (SessionsTable.date eq date)
                }
                .single()[SessionsTable.id]
            SessionEnsureResult(foundId, created = false)
        }
    }

    private suspend fun cleanupUploadedFile(
        client: StorageClient,
        database: Database,
        key: String
    ) {
        withContext(NonCancellable) {
            try {
                client.delete(key)
            } catch (delEx: Throwable) {
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

    suspend fun upload(userId: UUID, input: TakeUploadInput): TakeDto {
        val client = storageClient
            ?: throw ApiException(
                HttpStatusCode.ServiceUnavailable,
                "STORAGE_UNAVAILABLE",
                "녹음 저장소가 설정되어 있지 않습니다."
            )
        val database = requireDb()

        // 1. 트랜잭션 A (읽기만): 곡 존재 확인 및 쿼터 사전 검사
        DatabaseFactory.dbQuery(database) {
            val songExists = SongsTable
                .select(SongsTable.id)
                .where { (SongsTable.id eq input.songId) and (SongsTable.userId eq userId) }
                .singleOrNull() != null
            if (!songExists) {
                throw NotFoundException("곡을 찾을 수 없습니다.")
            }

            val quota = ProfilesTable
                .select(ProfilesTable.takeQuotaBytes)
                .where { ProfilesTable.id eq userId }
                .single()[ProfilesTable.takeQuotaBytes]

            val sumExpr = TakesTable.sizeBytes.sum()
            val used = TakesTable
                .select(sumExpr)
                .where { (TakesTable.userId eq userId) and (TakesTable.storage eq "supabase") }
                .singleOrNull()
                ?.get(sumExpr) ?: 0L

            if (used + input.bytes.size > quota) {
                val quotaMb = quota / 1_048_576
                throw ApiException(
                    HttpStatusCode.PayloadTooLarge,
                    "TAKE_QUOTA_EXCEEDED",
                    "녹음 저장 한도(${quotaMb}MB)를 넘습니다. 오래된 녹음을 지운 뒤 다시 올려 주세요."
                )
            }
        }

        // 2. 트랜잭션 밖: 스토리지 업로드
        val takeId = UUID.randomUUID()
        val ext = MIME_EXT[input.mime] ?: throw InvalidInputException("mime 값이 올바르지 않습니다.")
        val key = "$userId/$takeId.$ext"

        try {
            client.upload(key, input.bytes, input.mime)
        } catch (e: CancellationException) {
            throw e
        } catch (e: StorageException) {
            throw ApiException(
                HttpStatusCode.BadGateway,
                "STORAGE_ERROR",
                "녹음 파일을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요."
            )
        }

        // 3. 트랜잭션 B: DB 기록
        return try {
            DatabaseFactory.dbQuery(database) {
                // 1) 곡 소유 재확인
                val songExists = SongsTable
                    .select(SongsTable.id)
                    .where { (SongsTable.id eq input.songId) and (SongsTable.userId eq userId) }
                    .singleOrNull() != null
                if (!songExists) {
                    throw NotFoundException("곡을 찾을 수 없습니다.")
                }

                // 2) profiles FOR UPDATE 및 쿼터 재검사
                val quota = ProfilesTable
                    .select(ProfilesTable.takeQuotaBytes)
                    .where { ProfilesTable.id eq userId }
                    .forUpdate(ForUpdateOption.ForUpdate)
                    .single()[ProfilesTable.takeQuotaBytes]

                val sumExpr = TakesTable.sizeBytes.sum()
                val used = TakesTable
                    .select(sumExpr)
                    .where { (TakesTable.userId eq userId) and (TakesTable.storage eq "supabase") }
                    .singleOrNull()
                    ?.get(sumExpr) ?: 0L

                if (used + input.bytes.size > quota) {
                    val quotaMb = quota / 1_048_576
                    throw ApiException(
                        HttpStatusCode.PayloadTooLarge,
                        "TAKE_QUOTA_EXCEEDED",
                        "녹음 저장 한도(${quotaMb}MB)를 넘습니다. 오래된 녹음을 지운 뒤 다시 올려 주세요."
                    )
                }

                // 3) ensureSession
                val sessionResult = ensureSession(userId, input.songId, input.date, input.rate, input.a, input.b)
                val sessionId = sessionResult.sessionId

                // 4) TakesTable.insert
                TakesTable.insert {
                    it[id] = takeId
                    it[TakesTable.userId] = userId
                    it[TakesTable.sessionId] = sessionId
                    it[TakesTable.songId] = input.songId
                    it[recordedAt] = input.recordedAt
                    it[a] = input.a
                    it[b] = input.b
                    if (input.rate != null) {
                        it[rate] = input.rate
                    }
                    it[durationSec] = input.durationSec
                    it[mime] = input.mime
                    it[sizeBytes] = input.bytes.size.toLong()
                    it[storage] = "supabase"
                    it[storageKey] = key
                    it[memo] = ""
                }

                // 5) Outbox 적재
                if (sessionResult.created) {
                    OutboxRepository.enqueueIfSyncEnabled(userId, "session", sessionId, "upsert")
                }
                OutboxRepository.enqueueIfSyncEnabled(userId, "take", takeId, "upsert")

                // 6) TakeDto 반환
                TakeDto(
                    id = takeId.toString(),
                    sessionId = sessionId.toString(),
                    recordedAt = DateTimeFormatter.ISO_INSTANT.format(input.recordedAt.toInstant()),
                    a = input.a?.toDouble(),
                    b = input.b?.toDouble(),
                    rate = input.rate?.toDouble(),
                    durationSec = input.durationSec,
                    mime = input.mime,
                    sizeBytes = input.bytes.size.toLong(),
                    storage = "supabase",
                    storageKey = key,
                    memo = ""
                )
            }
        } catch (originalEx: Throwable) {
            // 4. 트랜잭션 B 실패/취소 시 보상 트랜잭션: NonCancellable 안에서 스토리지 파일 삭제/trash 등록
            cleanupUploadedFile(client, database, key)
            throw originalEx
        }
    }

    suspend fun signedUrl(userId: UUID, takeId: UUID): SignedUrlResponse {
        val client = storageClient
            ?: throw ApiException(
                HttpStatusCode.ServiceUnavailable,
                "STORAGE_UNAVAILABLE",
                "녹음 저장소가 설정되어 있지 않습니다."
            )
        val database = requireDb()

        val row = DatabaseFactory.dbQuery(database) {
            TakesTable
                .select(TakesTable.storage, TakesTable.storageKey)
                .where { (TakesTable.id eq takeId) and (TakesTable.userId eq userId) }
                .singleOrNull() ?: throw NotFoundException("녹음을 찾을 수 없습니다.")
        }

        val storage = row[TakesTable.storage]
        val storageKey = row[TakesTable.storageKey]
        if (storage == "drive") {
            throw InvalidInputException("Google Drive에 저장된 녹음은 브라우저에서 직접 재생합니다.")
        }

        val signedUrl = try {
            client.createSignedUrl(storageKey, SIGNED_URL_TTL_SEC)
        } catch (e: CancellationException) {
            throw e
        } catch (e: StorageException) {
            throw ApiException(
                HttpStatusCode.BadGateway,
                "STORAGE_ERROR",
                "재생 주소를 만들지 못했습니다."
            )
        }

        return SignedUrlResponse(url = signedUrl, expiresIn = SIGNED_URL_TTL_SEC)
    }

    suspend fun delete(userId: UUID, takeId: UUID): List<Long> {
        val database = requireDb()

        return DatabaseFactory.dbQuery(database) {
            val row = TakesTable
                .select(TakesTable.storage, TakesTable.storageKey)
                .where { (TakesTable.id eq takeId) and (TakesTable.userId eq userId) }
                .singleOrNull() ?: throw NotFoundException("녹음을 찾을 수 없습니다.")

            val storage = row[TakesTable.storage]
            val storageKey = row[TakesTable.storageKey]

            val trashIds = mutableListOf<Long>()
            if (storage == "supabase") {
                val trashId = StorageTrashTable.insert {
                    it[StorageTrashTable.storageKey] = storageKey
                } get StorageTrashTable.id
                trashIds.add(trashId)
            }

            OutboxRepository.enqueueIfSyncEnabled(userId, "take", takeId, "delete")
            TakesTable.deleteWhere { (id eq takeId) and (TakesTable.userId eq userId) }

            trashIds
        }
    }

    companion object {
        const val MAX_FILE_BYTES = 52_428_800L            // 50MB
        const val MAX_REQUEST_BYTES = 53_477_376L         // 51MB (Content-Length 사전 거부·formFieldLimit)
        const val SIGNED_URL_TTL_SEC = 3600
        val MIME_EXT: Map<String, String> = mapOf(
            "audio/mp4" to "m4a",
            "audio/webm" to "weba",
            "audio/ogg" to "ogg",
            "audio/mpeg" to "mp3",
            "audio/wav" to "wav",
            "audio/aac" to "aac"
        )
    }
}
