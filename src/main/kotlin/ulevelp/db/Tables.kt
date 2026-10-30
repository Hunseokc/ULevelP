package ulevelp.db

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import org.jetbrains.exposed.sql.ReferenceOption
import org.jetbrains.exposed.sql.Table
import org.jetbrains.exposed.sql.TextColumnType
import org.jetbrains.exposed.sql.javatime.CurrentTimestampWithTimeZone
import org.jetbrains.exposed.sql.javatime.date
import org.jetbrains.exposed.sql.javatime.timestampWithTimeZone
import org.jetbrains.exposed.sql.json.jsonb
import java.math.BigDecimal

/**
 * 1. users (사용자 계정)
 */
object UsersTable : Table("users") {
    val id = uuid("id")
    val email = text("email")
    val createdAt = timestampWithTimeZone("created_at").defaultExpression(CurrentTimestampWithTimeZone)

    override val primaryKey = PrimaryKey(id)
}

/**
 * 2. profiles (사용자 프로필 및 쿼터)
 */
object ProfilesTable : Table("profiles") {
    val id = uuid("id").references(UsersTable.id, onDelete = ReferenceOption.CASCADE)
    val displayName = text("display_name").default("")
    val role = text("role").default("user")
    val storageProvider = text("storage_provider").default("supabase")
    val driveFolderId = text("drive_folder_id").nullable()
    val takeQuotaBytes = long("take_quota_bytes").default(209_715_200L)
    val migratedLocalAt = timestampWithTimeZone("migrated_local_at").nullable()
    val createdAt = timestampWithTimeZone("created_at").defaultExpression(CurrentTimestampWithTimeZone)
    val updatedAt = timestampWithTimeZone("updated_at").defaultExpression(CurrentTimestampWithTimeZone)

    override val primaryKey = PrimaryKey(id)
}

/**
 * 3. songs (연습 곡 - 노션: 연습 곡 DB)
 */
object SongsTable : Table("songs") {
    val id = uuid("id").autoGenerate()
    val userId = uuid("user_id").references(UsersTable.id, onDelete = ReferenceOption.CASCADE)
    val title = text("title")
    val artist = text("artist").default("")
    val status = text("status").default("practicing")
    val videoId = text("video_id")
    val pos = decimal("pos", 8, 1).nullable()
    val a = decimal("a", 8, 1).nullable()
    val b = decimal("b", 8, 1).nullable()
    val rate = decimal("rate", 4, 2).default(BigDecimal("1.00"))
    val lastDate = date("last_date").nullable()
    val memo = text("memo").default("")
    val createdAt = timestampWithTimeZone("created_at").defaultExpression(CurrentTimestampWithTimeZone)
    val updatedAt = timestampWithTimeZone("updated_at").defaultExpression(CurrentTimestampWithTimeZone)

    override val primaryKey = PrimaryKey(id)

    init {
        uniqueIndex(userId, videoId)
        uniqueIndex(userId, id)
    }
}

/**
 * 4. sessions (일별 연습 기록 - 노션: 연습 기록 DB)
 */
object SessionsTable : Table("sessions") {
    val id = uuid("id").autoGenerate()
    val userId = uuid("user_id").references(UsersTable.id, onDelete = ReferenceOption.CASCADE)
    val songId = uuid("song_id")
    val date = date("date")
    val seconds = integer("seconds").default(0)
    val loops = integer("loops").default(0)
    val rate = decimal("rate", 4, 2).nullable()
    val a = decimal("a", 8, 1).nullable()
    val b = decimal("b", 8, 1).nullable()
    val memo = text("memo").default("")
    val createdAt = timestampWithTimeZone("created_at").defaultExpression(CurrentTimestampWithTimeZone)
    val updatedAt = timestampWithTimeZone("updated_at").defaultExpression(CurrentTimestampWithTimeZone)

    override val primaryKey = PrimaryKey(id)

    init {
        uniqueIndex(userId, songId, date)
        uniqueIndex(userId, id, songId)
    }
}

/**
 * 5. takes (오디오 녹음 - 노션: 연습 기록 본문 오디오 블록 + 녹음 속성)
 */
object TakesTable : Table("takes") {
    val id = uuid("id").autoGenerate()
    val userId = uuid("user_id").references(UsersTable.id, onDelete = ReferenceOption.CASCADE)
    val sessionId = uuid("session_id")
    val songId = uuid("song_id")
    val recordedAt = timestampWithTimeZone("recorded_at")
    val a = decimal("a", 8, 1).nullable()
    val b = decimal("b", 8, 1).nullable()
    val rate = decimal("rate", 4, 2).nullable()
    val durationSec = integer("duration_sec")
    val mime = text("mime")
    val sizeBytes = long("size_bytes")
    val storage = text("storage")
    val storageKey = text("storage_key")
    val memo = text("memo").default("")
    val createdAt = timestampWithTimeZone("created_at").defaultExpression(CurrentTimestampWithTimeZone)

    override val primaryKey = PrimaryKey(id)
}

/**
 * 6. notes (Gemini 학습 영상 노트)
 */
object NotesTable : Table("notes") {
    val id = uuid("id").autoGenerate()
    val userId = uuid("user_id").references(UsersTable.id, onDelete = ReferenceOption.CASCADE)
    val videoId = text("video_id")
    val title = text("title")
    val channel = text("channel").default("")
    val tags = array<String>("tags", TextColumnType())
    val memo = text("memo").default("")
    val headline = text("headline").default("")
    val points = array<String>("points", TextColumnType()).default(emptyList())
    val keywords = array<String>("keywords", TextColumnType()).default(emptyList())
    val difficulty = text("difficulty").nullable()
    val analysis = jsonb<JsonElement>("analysis", Json)
    val diagramsSvg = jsonb<JsonElement>("diagrams_svg", Json).default(JsonArray(emptyList()))
    val model = text("model").default("")
    val createdAt = timestampWithTimeZone("created_at").defaultExpression(CurrentTimestampWithTimeZone)
    val updatedAt = timestampWithTimeZone("updated_at").defaultExpression(CurrentTimestampWithTimeZone)

    override val primaryKey = PrimaryKey(id)
}

/**
 * 7. analysis_jobs (Gemini 비동기 분석 작업 큐)
 */
object AnalysisJobsTable : Table("analysis_jobs") {
    val id = uuid("id").autoGenerate()
    val userId = uuid("user_id").references(UsersTable.id, onDelete = ReferenceOption.CASCADE)
    val url = text("url")
    val tags = array<String>("tags", TextColumnType())
    val memo = text("memo").default("")
    val status = text("status").default("queued")
    val error = text("error").nullable()
    val noteId = uuid("note_id").references(NotesTable.id, onDelete = ReferenceOption.SET_NULL).nullable()
    val createdAt = timestampWithTimeZone("created_at").defaultExpression(CurrentTimestampWithTimeZone)
    val startedAt = timestampWithTimeZone("started_at").nullable()
    val finishedAt = timestampWithTimeZone("finished_at").nullable()

    override val primaryKey = PrimaryKey(id)
}

/**
 * 8. integrations (외부 API 키 보관 - AES-256-GCM 암호화)
 */
object IntegrationsTable : Table("integrations") {
    val userId = uuid("user_id").references(UsersTable.id, onDelete = ReferenceOption.CASCADE)
    val appId = text("app_id")
    val provider = text("provider")
    val encryptedSecret = binary("encrypted_secret")
    val iv = binary("iv", 12)
    val keyVersion = short("key_version").default(1)
    val hint = text("hint")
    val config = jsonb<JsonElement>("config", Json).default(JsonObject(emptyMap()))
    val createdAt = timestampWithTimeZone("created_at").defaultExpression(CurrentTimestampWithTimeZone)
    val updatedAt = timestampWithTimeZone("updated_at").defaultExpression(CurrentTimestampWithTimeZone)

    override val primaryKey = PrimaryKey(userId, appId, provider)
}

/**
 * 9. notion_sync (사용자별 노션 동기화 상태 및 Push 워커 lease)
 */
object NotionSyncTable : Table("notion_sync") {
    val userId = uuid("user_id").references(UsersTable.id, onDelete = ReferenceOption.CASCADE)
    val enabled = bool("enabled").default(false)
    val lastPushAt = timestampWithTimeZone("last_push_at").nullable()
    val lastPullAt = timestampWithTimeZone("last_pull_at").nullable()
    val lastError = text("last_error").nullable()
    val leaseUntil = timestampWithTimeZone("lease_until").nullable()
    val leaseOwner = text("lease_owner").nullable()
    val updatedAt = timestampWithTimeZone("updated_at").defaultExpression(CurrentTimestampWithTimeZone)

    override val primaryKey = PrimaryKey(userId)
}

/**
 * 10. notion_links (로컬 엔티티 ID ↔ 노션 페이지/블록 ID 매핑)
 */
object NotionLinksTable : Table("notion_links") {
    val entity = text("entity")
    val entityId = uuid("entity_id")
    val userId = uuid("user_id").references(UsersTable.id, onDelete = ReferenceOption.CASCADE)
    val notionPageId = text("notion_page_id")
    val notionExtra = text("notion_extra").nullable()
    val syncedAt = timestampWithTimeZone("synced_at").defaultExpression(CurrentTimestampWithTimeZone)

    override val primaryKey = PrimaryKey(entity, entityId)

    init {
        uniqueIndex(userId, notionPageId)
    }
}

/**
 * 11. sync_outbox (노션 실시간 Push 대기열)
 */
object SyncOutboxTable : Table("sync_outbox") {
    val id = long("id").autoIncrement()
    val userId = uuid("user_id").references(UsersTable.id, onDelete = ReferenceOption.CASCADE)
    val entity = text("entity")
    val entityId = uuid("entity_id")
    val op = text("op")
    val attempts = integer("attempts").default(0)
    val lastError = text("last_error").nullable()
    val createdAt = timestampWithTimeZone("created_at").defaultExpression(CurrentTimestampWithTimeZone)
    val doneAt = timestampWithTimeZone("done_at").nullable()

    override val primaryKey = PrimaryKey(id)
}

/**
 * 12. storage_trash (지울 스토리지 파일 대기열)
 */
object StorageTrashTable : Table("storage_trash") {
    val id = long("id").autoIncrement()
    val storageKey = text("storage_key")
    val attempts = integer("attempts").default(0)
    val lastError = text("last_error").nullable()
    val createdAt = timestampWithTimeZone("created_at").defaultExpression(CurrentTimestampWithTimeZone)

    override val primaryKey = PrimaryKey(id)
}

val ALL_TABLES: List<Table> = listOf(
    UsersTable,
    ProfilesTable,
    SongsTable,
    SessionsTable,
    TakesTable,
    NotesTable,
    AnalysisJobsTable,
    IntegrationsTable,
    NotionSyncTable,
    NotionLinksTable,
    SyncOutboxTable,
    StorageTrashTable
)

