package ulevelp.db

import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.selectAll
import java.util.UUID

object OutboxRepository {
    /** 반드시 DatabaseFactory.dbQuery { } 트랜잭션 안에서 부른다. */
    fun enqueueIfSyncEnabled(userId: UUID, entity: String, entityId: UUID, op: String) {
        val syncEnabled = NotionSyncTable
            .selectAll()
            .where { (NotionSyncTable.userId eq userId) and (NotionSyncTable.enabled eq true) }
            .count() > 0L
        if (!syncEnabled) return

        if (op == "upsert") {
            val existingCount = SyncOutboxTable
                .selectAll()
                .where {
                    (SyncOutboxTable.userId eq userId) and
                    (SyncOutboxTable.entity eq entity) and
                    (SyncOutboxTable.entityId eq entityId) and
                    (SyncOutboxTable.op eq "upsert") and
                    (SyncOutboxTable.doneAt.isNull())
                }
                .count()
            if (existingCount > 0L) return
        }

        SyncOutboxTable.insert {
            it[SyncOutboxTable.userId] = userId
            it[SyncOutboxTable.entity] = entity
            it[SyncOutboxTable.entityId] = entityId
            it[SyncOutboxTable.op] = op
        }
    }
}

