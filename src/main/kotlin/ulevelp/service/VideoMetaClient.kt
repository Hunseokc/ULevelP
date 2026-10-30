package ulevelp.service

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.slf4j.LoggerFactory
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.time.Duration

data class VideoMeta(val title: String, val author: String)

interface VideoMetaClient {
    /** 실패(네트워크·비 200·파싱·빈 제목)는 null. 예외를 던지지 않는다(CancellationException 제외). */
    suspend fun fetch(videoId: String): VideoMeta?
}

class YoutubeOEmbedClient(
    private val endpoint: URI = URI("https://www.youtube.com/oembed"),
    private val timeout: Duration = Duration.ofSeconds(3),
    private val httpClient: HttpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build()
) : VideoMetaClient {
    private val logger = LoggerFactory.getLogger(YoutubeOEmbedClient::class.java)

    override suspend fun fetch(videoId: String): VideoMeta? = withContext(Dispatchers.IO) {
        try {
            val encodedUrl = URLEncoder.encode("https://www.youtube.com/watch?v=$videoId", StandardCharsets.UTF_8)
            val requestUri = URI("$endpoint?format=json&url=$encodedUrl")
            val request = HttpRequest.newBuilder()
                .uri(requestUri)
                .timeout(timeout)
                .header("Accept", "application/json")
                .GET()
                .build()

            val response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
            if (response.statusCode() != 200) {
                logger.warn("oEmbed 조회 실패 videoId={}: HTTP status {}", videoId, response.statusCode())
                return@withContext null
            }

            val json = Json.parseToJsonElement(response.body()).jsonObject
            val titleRaw = json["title"]?.jsonPrimitive?.content?.trim() ?: ""
            if (titleRaw.isEmpty()) {
                logger.warn("oEmbed 조회 실패 videoId={}: title이 비어 있음", videoId)
                return@withContext null
            }
            val title = if (titleRaw.length > 300) titleRaw.take(300) else titleRaw
            val authorRaw = json["author_name"]?.jsonPrimitive?.content?.trim() ?: ""
            val author = if (authorRaw.length > 200) authorRaw.take(200) else authorRaw

            VideoMeta(title = title, author = author)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            logger.warn("oEmbed 조회 실패 videoId={}: {}", videoId, e.message, e)
            null
        }
    }
}

