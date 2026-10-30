package ulevelp.storage

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.slf4j.LoggerFactory
import java.io.IOException
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.net.http.HttpTimeoutException
import java.time.Duration

class SupabaseStorageClient(
    private val supabaseUrl: String,          // "https://<ref>.supabase.co" (끝 "/" 없음)
    private val secretKey: String,
    private val bucket: String = "takes",
    private val requestTimeout: Duration = Duration.ofSeconds(60),
    private val httpClient: HttpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()
) : StorageClient {

    private val log = LoggerFactory.getLogger(SupabaseStorageClient::class.java)

    override suspend fun upload(key: String, bytes: ByteArray, contentType: String) {
        val targetUrl = "$supabaseUrl/storage/v1/object/$bucket/$key"
        val request = HttpRequest.newBuilder()
            .uri(URI.create(targetUrl))
            .timeout(requestTimeout)
            .header("Authorization", "Bearer $secretKey")
            .header("apikey", secretKey)
            .header("Content-Type", contentType)
            .header("x-upsert", "false")
            .POST(HttpRequest.BodyPublishers.ofByteArray(bytes))
            .build()

        executeRequest("upload", request)
    }

    override suspend fun createSignedUrl(key: String, expiresInSec: Int): String {
        val targetUrl = "$supabaseUrl/storage/v1/object/sign/$bucket/$key"
        val requestBody = """{"expiresIn":$expiresInSec}"""
        val request = HttpRequest.newBuilder()
            .uri(URI.create(targetUrl))
            .timeout(requestTimeout)
            .header("Authorization", "Bearer $secretKey")
            .header("apikey", secretKey)
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(requestBody))
            .build()

        val responseBody = executeRequest("sign", request)
        val signedUrl = try {
            val json = Json.parseToJsonElement(responseBody).jsonObject
            json["signedURL"]?.jsonPrimitive?.contentOrNull
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            throw StorageException("Supabase Storage sign 응답 파싱 실패", e)
        }

        if (signedUrl == null) {
            throw StorageException("Supabase Storage sign 응답에 signedURL이 없습니다.")
        }

        val prefix = "$supabaseUrl/storage/v1"
        return if (signedUrl.startsWith("/")) "$prefix$signedUrl" else "$prefix/$signedUrl"
    }

    override suspend fun delete(key: String) {
        val targetUrl = "$supabaseUrl/storage/v1/object/$bucket"
        val escapedKey = key.replace("\\", "\\\\").replace("\"", "\\\"")
        val requestBody = """{"prefixes":["$escapedKey"]}"""
        val request = HttpRequest.newBuilder()
            .uri(URI.create(targetUrl))
            .timeout(requestTimeout)
            .header("Authorization", "Bearer $secretKey")
            .header("apikey", secretKey)
            .header("Content-Type", "application/json")
            .method("DELETE", HttpRequest.BodyPublishers.ofString(requestBody))
            .build()

        executeRequest("delete", request)
    }

    private suspend fun executeRequest(action: String, request: HttpRequest): String {
        return withContext(Dispatchers.IO) {
            try {
                val response = httpClient.send(request, HttpResponse.BodyHandlers.ofString())
                val statusCode = response.statusCode()
                val responseBody = response.body() ?: ""

                if (statusCode in 200..299) {
                    responseBody
                } else {
                    val preview = responseBody.take(200)
                    log.warn("Supabase Storage {} 실패: HTTP {} - 본문: {}", action, statusCode, preview)
                    throw StorageException("Supabase Storage $action 실패: HTTP $statusCode")
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: StorageException) {
                throw e
            } catch (e: HttpTimeoutException) {
                throw StorageException("Supabase Storage $action 요청 타임아웃", e)
            } catch (e: IOException) {
                throw StorageException("Supabase Storage $action 네트워크 오류", e)
            } catch (e: Exception) {
                throw StorageException("Supabase Storage $action 예기치 않은 오류", e)
            }
        }
    }

    companion object {
        /** SUPABASE_URL(trim, 끝 "/" 제거)과 SUPABASE_SECRET_KEY(trim)가 둘 다 비어 있지 않을 때만 만든다 */
        fun fromEnvOrNull(env: Map<String, String> = System.getenv()): SupabaseStorageClient? {
            val rawUrl = env["SUPABASE_URL"]?.trim()?.trimEnd('/') ?: ""
            val rawKey = env["SUPABASE_SECRET_KEY"]?.trim() ?: ""
            if (rawUrl.isEmpty() || rawKey.isEmpty()) {
                return null
            }
            return SupabaseStorageClient(supabaseUrl = rawUrl, secretKey = rawKey)
        }
    }
}

