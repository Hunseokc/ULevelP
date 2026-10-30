package ulevelp.service

import kotlinx.coroutines.CancellationException
import org.jetbrains.exposed.sql.Database
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import org.jetbrains.exposed.sql.SqlExpressionBuilder.plus
import org.jetbrains.exposed.sql.deleteWhere
import org.jetbrains.exposed.sql.select
import org.jetbrains.exposed.sql.update
import org.slf4j.LoggerFactory
import ulevelp.db.DatabaseFactory
import ulevelp.db.StorageTrashTable
import ulevelp.storage.StorageClient
import ulevelp.storage.StorageException

class StorageTrashService(
    private val db: Database?,
    private val storageClient: StorageClient?
) {
    private val log = LoggerFactory.getLogger(StorageTrashService::class.java)

    /** 커밋된 storage_trash 행을 바로 지운다. 예외를 밖으로 던지지 않는다(CancellationException 제외). */
    suspend fun purge(ids: List<Long>) {
        if (ids.isEmpty() || db == null || storageClient == null) {
            return
        }

        for (trashId in ids) {
            val key = try {
                DatabaseFactory.dbQuery(db) {
                    StorageTrashTable
                        .select(StorageTrashTable.storageKey)
                        .where { StorageTrashTable.id eq trashId }
                        .singleOrNull()
                        ?.get(StorageTrashTable.storageKey)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                log.warn("storage_trash 행($trashId) 조회 실패", e)
                continue
            } ?: continue

            try {
                storageClient.delete(key)
                // 성공 시 행 삭제
                DatabaseFactory.dbQuery(db) {
                    StorageTrashTable.deleteWhere { StorageTrashTable.id eq trashId }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: StorageException) {
                val errorMsg = (e.message ?: "스토리지 파일 삭제 실패").take(500)
                log.warn("스토리지 파일($key) 삭제 실패 (trashId=$trashId): {}", errorMsg)
                try {
                    DatabaseFactory.dbQuery(db) {
                        StorageTrashTable.update({ StorageTrashTable.id eq trashId }) {
                            it[attempts] = attempts + 1
                            it[lastError] = errorMsg
                        }
                    }
                } catch (updateEx: CancellationException) {
                    throw updateEx
                } catch (updateEx: Exception) {
                    log.warn("storage_trash 상태 갱신 실패 (trashId=$trashId)", updateEx)
                }
            } catch (e: Exception) {
                log.warn("스토리지 삭제 중 예기치 않은 오류 (trashId=$trashId, key=$key)", e)
            }
        }
    }
}

