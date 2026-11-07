package ulevelp.notion

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import org.slf4j.LoggerFactory
import java.io.ByteArrayOutputStream
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.UUID

class NotionApiException(
    val statusCode: Int,
    val code: String?,
    override val message: String,
    val retryAfterSeconds: Int? = null
) : RuntimeException(message)

interface NotionClient {
    suspend fun queryDatabase(token: String, databaseId: String, body: JsonObject): JsonObject
    suspend fun retrievePage(token: String, pageId: String): JsonObject
    suspend fun createPage(token: String, body: JsonObject): JsonObject
    suspend fun updatePage(token: String, pageId: String, body: JsonObject): JsonObject
    suspend fun appendBlockChildren(token: String, blockId: String, children: JsonArray): JsonObject
    suspend fun archiveBlock(token: String, blockId: String): JsonObject
    /**
     * Code.gs upload(bytes, mime, name) 1:1 이식:
     * - 20MB(20,971,520B) 이하: POST /file_uploads -> POST /file_uploads/{id}/send (단일 파트) -> id 반환
     * - 20MB 초과: ceil(size / 10MB) 계산 -> POST /file_uploads (mode="multi_part", number_of_parts=parts)
     *   -> 파트별 POST /file_uploads/{id}/send (file + part_number="1".."N")
     *   -> POST /file_uploads/{id}/complete ({}) -> id 반환
     */
    suspend fun uploadFile(token: String, filename: String, mime: String, bytes: ByteArray): String
    /** 노션 파일 URL에서 오디오 바이트 다운로드 (K4-3 초기 동기화에서 사용) */
    suspend fun downloadExternalFile(url: String): Pair<ByteArray, String?>
}

class HttpNotionClient(
    private val baseUrl: String = "https://api.notion.com/v1",
    private val maxRetriesOn429: Int = 3,
    private val httpClient: HttpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build()
) : NotionClient {

    private val log = LoggerFactory.getLogger(HttpNotionClient::class.java)

    companion object {
        const val NOTION_VERSION = "2022-06-28"
        const val SINGLE_UPLOAD_LIMIT_BYTES = 20 * 1024 * 1024   // 20MB
        const val PART_SIZE_BYTES = 10 * 1024 * 1024             // 10MB
    }

    override suspend fun queryDatabase(token: String, databaseId: String, body: JsonObject): JsonObject {
        val uri = URI("${baseUrl.trimEnd('/')}/databases/$databaseId/query")
        return executeJsonRequest(token, uri, "POST", body)
    }

    override suspend fun retrievePage(token: String, pageId: String): JsonObject {
        val uri = URI("${baseUrl.trimEnd('/')}/pages/$pageId")
        return executeJsonRequest(token, uri, "GET", null)
    }

    override suspend fun createPage(token: String, body: JsonObject): JsonObject {
        val uri = URI("${baseUrl.trimEnd('/')}/pages")
        return executeJsonRequest(token, uri, "POST", body)
    }

    override suspend fun updatePage(token: String, pageId: String, body: JsonObject): JsonObject {
        val uri = URI("${baseUrl.trimEnd('/')}/pages/$pageId")
        return executeJsonRequest(token, uri, "PATCH", body)
    }

    override suspend fun appendBlockChildren(token: String, blockId: String, children: JsonArray): JsonObject {
        val uri = URI("${baseUrl.trimEnd('/')}/blocks/$blockId/children")
        val body = buildJsonObject { put("children", children) }
        return executeJsonRequest(token, uri, "PATCH", body)
    }

    override suspend fun archiveBlock(token: String, blockId: String): JsonObject {
        val uri = URI("${baseUrl.trimEnd('/')}/blocks/$blockId")
        return executeJsonRequest(token, uri, "DELETE", null)
    }

    override suspend fun uploadFile(token: String, filename: String, mime: String, bytes: ByteArray): String {
        val partSize = PART_SIZE_BYTES
        val parts = if (bytes.size > SINGLE_UPLOAD_LIMIT_BYTES) {
            (bytes.size + partSize - 1) / partSize
        } else {
            1
        }

        // 1. POST /file_uploads
        val createUploadUri = URI("${baseUrl.trimEnd('/')}/file_uploads")
        val createUploadReqBody = buildJsonObject {
            put("filename", filename)
            put("content_type", mime)
            if (parts > 1) {
                put("mode", "multi_part")
                put("number_of_parts", parts)
            }
        }
        val createRes = executeJsonRequest(token, createUploadUri, "POST", createUploadReqBody)
        val fileUploadId = createRes["id"]?.jsonPrimitive?.contentOrNull
            ?: throw NotionApiException(500, "upload_error", "파일 업로드 ID 획득에 실패했습니다.")

        // 2. POST /file_uploads/{id}/send
        val sendUri = URI("${baseUrl.trimEnd('/')}/file_uploads/$fileUploadId/send")
        for (i in 0 until parts) {
            val start = i * partSize
            val end = minOf((i + 1) * partSize, bytes.size)
            val partBytes = bytes.copyOfRange(start, end)
            val partNumber = if (parts > 1) (i + 1).toString() else null
            executeMultipartUpload(token, sendUri, filename, mime, partBytes, partNumber)
        }

        // 3. POST /file_uploads/{id}/complete (if multipart)
        if (parts > 1) {
            val completeUri = URI("${baseUrl.trimEnd('/')}/file_uploads/$fileUploadId/complete")
            executeJsonRequest(token, completeUri, "POST", buildJsonObject {})
        }

        return fileUploadId
    }

    override suspend fun downloadExternalFile(url: String): Pair<ByteArray, String?> {
        val uri = URI(url)
        val req = HttpRequest.newBuilder()
            .uri(uri)
            .GET()
            .timeout(Duration.ofSeconds(30))
            .build()

        val response = withContext(Dispatchers.IO) {
            httpClient.send(req, HttpResponse.BodyHandlers.ofByteArray())
        }

        if (response.statusCode() !in 200..299) {
            throw NotionApiException(
                statusCode = response.statusCode(),
                code = "download_failed",
                message = "외부 파일 다운로드 실패 (${response.statusCode()})"
            )
        }

        val contentType = response.headers().firstValue("Content-Type").orElse(null)
        return Pair(response.body(), contentType)
    }

    private suspend fun executeJsonRequest(
        token: String,
        uri: URI,
        method: String,
        body: JsonObject?
    ): JsonObject {
        var attempts = 0
        while (true) {
            val reqBuilder = HttpRequest.newBuilder()
                .uri(uri)
                .header("Authorization", "Bearer $token")
                .header("Notion-Version", NOTION_VERSION)
                .timeout(Duration.ofSeconds(20))

            when (method) {
                "GET" -> reqBuilder.GET()
                "POST" -> {
                    reqBuilder.header("Content-Type", "application/json; charset=utf-8")
                    reqBuilder.POST(HttpRequest.BodyPublishers.ofString(body?.toString() ?: "{}"))
                }
                "PATCH" -> {
                    reqBuilder.header("Content-Type", "application/json; charset=utf-8")
                    reqBuilder.method("PATCH", HttpRequest.BodyPublishers.ofString(body?.toString() ?: "{}"))
                }
                "DELETE" -> reqBuilder.DELETE()
                else -> throw IllegalArgumentException("지원하지 않는 HTTP 메서드: $method")
            }

            val response = withContext(Dispatchers.IO) {
                httpClient.send(reqBuilder.build(), HttpResponse.BodyHandlers.ofString())
            }

            val status = response.statusCode()
            if (status in 200..299) {
                val content = response.body().trim()
                return if (content.isEmpty()) {
                    JsonObject(emptyMap())
                } else {
                    try {
                        Json.parseToJsonElement(content).jsonObject
                    } catch (_: Exception) {
                        JsonObject(emptyMap())
                    }
                }
            }

            if (status == 429 && attempts < maxRetriesOn429) {
                attempts++
                val retryAfterHeader = response.headers().firstValue("Retry-After").orElse(null)
                val retrySec = retryAfterHeader?.toIntOrNull()?.coerceIn(1, 10) ?: 1
                log.warn("노션 429 수신, {}초 후 재시도 (시도 {}/{})", retrySec, attempts, maxRetriesOn429)
                delay(retrySec * 1000L)
                continue
            }

            val (code, message) = parseErrorBody(response.body(), status)
            val retryAfterSec = if (status == 429) {
                response.headers().firstValue("Retry-After").orElse(null)?.toIntOrNull()?.coerceIn(1, 10) ?: 1
            } else null

            throw NotionApiException(
                statusCode = status,
                code = code,
                message = message,
                retryAfterSeconds = retryAfterSec
            )
        }
    }

    private suspend fun executeMultipartUpload(
        token: String,
        uri: URI,
        filename: String,
        mime: String,
        bytes: ByteArray,
        partNumber: String?
    ) {
        var attempts = 0
        while (true) {
            val boundary = "----NotionBoundary" + UUID.randomUUID().toString().replace("-", "")
            val bodyBytes = buildMultipartBody(boundary, filename, mime, bytes, partNumber)

            val req = HttpRequest.newBuilder()
                .uri(uri)
                .header("Authorization", "Bearer $token")
                .header("Notion-Version", NOTION_VERSION)
                .header("Content-Type", "multipart/form-data; boundary=$boundary")
                .timeout(Duration.ofSeconds(60))
                .POST(HttpRequest.BodyPublishers.ofByteArray(bodyBytes))
                .build()

            val response = withContext(Dispatchers.IO) {
                httpClient.send(req, HttpResponse.BodyHandlers.ofString())
            }

            val status = response.statusCode()
            if (status in 200..299) {
                return
            }

            if (status == 429 && attempts < maxRetriesOn429) {
                attempts++
                val retryAfterHeader = response.headers().firstValue("Retry-After").orElse(null)
                val retrySec = retryAfterHeader?.toIntOrNull()?.coerceIn(1, 10) ?: 1
                log.warn("노션 파일 전송 429 수신, {}초 후 재시도 (시도 {}/{})", retrySec, attempts, maxRetriesOn429)
                delay(retrySec * 1000L)
                continue
            }

            val (code, message) = parseErrorBody(response.body(), status)
            val retryAfterSec = if (status == 429) {
                response.headers().firstValue("Retry-After").orElse(null)?.toIntOrNull()?.coerceIn(1, 10) ?: 1
            } else null

            throw NotionApiException(
                statusCode = status,
                code = code,
                message = message,
                retryAfterSeconds = retryAfterSec
            )
        }
    }

    private fun buildMultipartBody(
        boundary: String,
        filename: String,
        mime: String,
        bytes: ByteArray,
        partNumber: String?
    ): ByteArray {
        val baos = ByteArrayOutputStream()
        val crlf = "\r\n".toByteArray(Charsets.US_ASCII)

        // Part 1: file
        baos.write("--$boundary\r\n".toByteArray(Charsets.US_ASCII))
        baos.write("Content-Disposition: form-data; name=\"file\"; filename=\"$filename\"\r\n".toByteArray(Charsets.UTF_8))
        baos.write("Content-Type: $mime\r\n\r\n".toByteArray(Charsets.US_ASCII))
        baos.write(bytes)
        baos.write(crlf)

        // Part 2: part_number (if multipart)
        if (partNumber != null) {
            baos.write("--$boundary\r\n".toByteArray(Charsets.US_ASCII))
            baos.write("Content-Disposition: form-data; name=\"part_number\"\r\n\r\n".toByteArray(Charsets.US_ASCII))
            baos.write(partNumber.toByteArray(Charsets.US_ASCII))
            baos.write(crlf)
        }

        // Close
        baos.write("--$boundary--\r\n".toByteArray(Charsets.US_ASCII))
        return baos.toByteArray()
    }

    private fun parseErrorBody(body: String, status: Int): Pair<String?, String> {
        return try {
            val json = Json.parseToJsonElement(body).jsonObject
            val code = json["code"]?.jsonPrimitive?.contentOrNull
            val message = json["message"]?.jsonPrimitive?.contentOrNull
                ?: "노션 오류: $status"
            Pair(code, message)
        } catch (_: Exception) {
            Pair(null, "노션 오류: $status")
        }
    }
}
