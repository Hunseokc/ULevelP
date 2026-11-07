package ulevelp.support

import kotlinx.serialization.json.*
import ulevelp.notion.NotionClient
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

data class QueryDatabaseCall(val token: String, val databaseId: String, val body: JsonObject)
data class RetrievePageCall(val token: String, val pageId: String)
data class CreatePageCall(val token: String, val body: JsonObject)
data class UpdatePageCall(val token: String, val pageId: String, val body: JsonObject)
data class AppendBlockChildrenCall(val token: String, val blockId: String, val children: JsonArray)
data class ArchiveBlockCall(val token: String, val blockId: String)
data class UploadFileCall(val token: String, val filename: String, val mime: String, val bytes: ByteArray)

class FakeNotionClient : NotionClient {
    val queryDatabaseCalls = CopyOnWriteArrayList<QueryDatabaseCall>()
    val retrievePageCalls = CopyOnWriteArrayList<RetrievePageCall>()
    val createPageCalls = CopyOnWriteArrayList<CreatePageCall>()
    val updatePageCalls = CopyOnWriteArrayList<UpdatePageCall>()
    val appendBlockChildrenCalls = CopyOnWriteArrayList<AppendBlockChildrenCall>()
    val archiveBlockCalls = CopyOnWriteArrayList<ArchiveBlockCall>()
    val uploadFileCalls = CopyOnWriteArrayList<UploadFileCall>()
    val downloadExternalFileCalls = CopyOnWriteArrayList<String>()

    @Volatile var queryDatabaseHandler: (suspend (token: String, databaseId: String, body: JsonObject) -> JsonObject)? = null
    @Volatile var retrievePageHandler: (suspend (token: String, pageId: String) -> JsonObject)? = null
    @Volatile var createPageHandler: (suspend (token: String, body: JsonObject) -> JsonObject)? = null
    @Volatile var updatePageHandler: (suspend (token: String, pageId: String, body: JsonObject) -> JsonObject)? = null
    @Volatile var appendBlockChildrenHandler: (suspend (token: String, blockId: String, children: JsonArray) -> JsonObject)? = null
    @Volatile var archiveBlockHandler: (suspend (token: String, blockId: String) -> JsonObject)? = null
    @Volatile var uploadFileHandler: (suspend (token: String, filename: String, mime: String, bytes: ByteArray) -> String)? = null
    @Volatile var downloadExternalFileHandler: (suspend (url: String) -> Pair<ByteArray, String?>)? = null

    private val pageProperties = ConcurrentHashMap<String, JsonObject>()

    override suspend fun queryDatabase(token: String, databaseId: String, body: JsonObject): JsonObject {
        queryDatabaseCalls.add(QueryDatabaseCall(token, databaseId, body))
        queryDatabaseHandler?.let { return it(token, databaseId, body) }
        return buildJsonObject {
            putJsonArray("results") {}
            put("has_more", false)
        }
    }

    override suspend fun retrievePage(token: String, pageId: String): JsonObject {
        retrievePageCalls.add(RetrievePageCall(token, pageId))
        retrievePageHandler?.let { return it(token, pageId) }
        val props = pageProperties[pageId] ?: buildJsonObject {
            putJsonObject("녹음") {
                putJsonArray("files") {}
            }
        }
        return buildJsonObject {
            put("id", pageId)
            put("properties", props)
        }
    }

    override suspend fun createPage(token: String, body: JsonObject): JsonObject {
        createPageCalls.add(CreatePageCall(token, body))
        createPageHandler?.let { return it(token, body) }
        val pageId = UUID.randomUUID().toString()
        val props = body["properties"]?.jsonObject ?: JsonObject(emptyMap())
        pageProperties[pageId] = props
        return buildJsonObject {
            put("id", pageId)
            put("properties", props)
        }
    }

    override suspend fun updatePage(token: String, pageId: String, body: JsonObject): JsonObject {
        updatePageCalls.add(UpdatePageCall(token, pageId, body))
        updatePageHandler?.let { return it(token, pageId, body) }
        val existingProps = pageProperties[pageId]?.toMutableMap() ?: mutableMapOf()
        val patchProps = body["properties"]?.jsonObject
        if (patchProps != null) {
            existingProps.putAll(patchProps)
        }
        val newProps = JsonObject(existingProps)
        pageProperties[pageId] = newProps
        return buildJsonObject {
            put("id", pageId)
            put("properties", newProps)
            if (body["archived"]?.jsonPrimitive?.booleanOrNull == true) {
                put("archived", true)
            }
        }
    }

    override suspend fun appendBlockChildren(token: String, blockId: String, children: JsonArray): JsonObject {
        appendBlockChildrenCalls.add(AppendBlockChildrenCall(token, blockId, children))
        appendBlockChildrenHandler?.let { return it(token, blockId, children) }
        return buildJsonObject {
            putJsonArray("results") {
                children.forEach { _ ->
                    addJsonObject {
                        put("id", UUID.randomUUID().toString())
                    }
                }
            }
        }
    }

    override suspend fun archiveBlock(token: String, blockId: String): JsonObject {
        archiveBlockCalls.add(ArchiveBlockCall(token, blockId))
        archiveBlockHandler?.let { return it(token, blockId) }
        return buildJsonObject {
            put("id", blockId)
            put("archived", true)
        }
    }

    override suspend fun uploadFile(token: String, filename: String, mime: String, bytes: ByteArray): String {
        uploadFileCalls.add(UploadFileCall(token, filename, mime, bytes))
        uploadFileHandler?.let { return it(token, filename, mime, bytes) }
        return "file-upload-${UUID.randomUUID()}"
    }

    override suspend fun downloadExternalFile(url: String): Pair<ByteArray, String?> {
        downloadExternalFileCalls.add(url)
        downloadExternalFileHandler?.let { return it(url) }
        return Pair(ByteArray(0), "audio/mp4")
    }

    fun clear() {
        queryDatabaseCalls.clear()
        retrievePageCalls.clear()
        createPageCalls.clear()
        updatePageCalls.clear()
        appendBlockChildrenCalls.clear()
        archiveBlockCalls.clear()
        uploadFileCalls.clear()
        downloadExternalFileCalls.clear()
        pageProperties.clear()
        queryDatabaseHandler = null
        retrievePageHandler = null
        createPageHandler = null
        updatePageHandler = null
        appendBlockChildrenHandler = null
        archiveBlockHandler = null
        uploadFileHandler = null
        downloadExternalFileHandler = null
    }
}
