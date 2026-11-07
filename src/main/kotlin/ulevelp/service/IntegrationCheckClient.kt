package ulevelp.service

import io.ktor.http.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import ulevelp.api.ApiException
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.time.Duration

@Serializable
data class NotionCheckResponse(
    val ok: Boolean = true,
    val provider: String = "notion",
    val songsTitle: String,
    val sessionsTitle: String,
    val notesTitle: String? = null,
    val maxUploadMB: Int = 5
)

@Serializable
data class GeminiCheckResponse(
    val ok: Boolean = true,
    val provider: String = "gemini",
    val model: String,
    val displayName: String
)

interface IntegrationCheckClient {
    suspend fun checkNotion(
        token: String,
        songsDb: String,
        sessionsDb: String,
        notesDb: String?
    ): NotionCheckResponse

    suspend fun checkGemini(
        apiKey: String,
        model: String
    ): GeminiCheckResponse
}

class HttpIntegrationCheckClient(
    private val notionBaseUrl: String = "https://api.notion.com/v1",
    private val geminiBaseUrl: String = "https://generativelanguage.googleapis.com/v1beta",
    private val httpClient: HttpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()
) : IntegrationCheckClient {

    companion object {
        const val NOTION_VERSION = "2022-06-28"
        val REQUIRED_SONGS_PROPS = listOf(
            "곡명", "아티스트", "상태", "이어서 연습", "유튜브 링크",
            "마지막 위치(초)", "구간 시작(초)", "구간 끝(초)", "속도", "마지막 연습일"
        )
        val REQUIRED_SESSIONS_PROPS = listOf(
            "기록", "곡", "날짜", "연습 시간(분)", "구간", "속도", "반복 횟수", "녹음"
        )
        val REQUIRED_NOTES_PROPS = listOf(
            "제목", "URL", "태그", "채널", "요약", "키워드", "난이도", "메모"
        )
    }

    private fun extractTitle(dbJson: JsonObject, defaultTitle: String): String {
        val titleElem = dbJson["title"]
        if (titleElem is JsonPrimitive && titleElem.isString) {
            val content = titleElem.content.trim()
            if (content.isNotBlank()) return content
        }
        if (titleElem is JsonArray) {
            val joined = titleElem.mapNotNull {
                (it as? JsonObject)?.get("plain_text")?.jsonPrimitive?.content
                    ?: (it as? JsonPrimitive)?.content
            }.joinToString("").trim()
            if (joined.isNotBlank()) return joined
        }
        return defaultTitle
    }

    override suspend fun checkNotion(
        token: String,
        songsDb: String,
        sessionsDb: String,
        notesDb: String?
    ): NotionCheckResponse = withContext(Dispatchers.IO) {
        val baseUri = notionBaseUrl.trimEnd('/')

        fun fetchDatabase(dbId: String, dbRole: String, requiredProps: List<String>): Pair<String, JsonObject> {
            val req = HttpRequest.newBuilder()
                .uri(URI("$baseUri/databases/$dbId"))
                .header("Authorization", "Bearer $token")
                .header("Notion-Version", NOTION_VERSION)
                .header("Accept", "application/json")
                .timeout(Duration.ofSeconds(5))
                .GET()
                .build()

            val resp = try {
                httpClient.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                throw ApiException(
                    HttpStatusCode.BadGateway,
                    "NOTION_API_ERROR",
                    "노션 API 호출에 실패했습니다 (${e.message ?: "네트워크 오류"}).",
                    source = "notion"
                )
            }

            val status = resp.statusCode()
            when (status) {
                200 -> {
                    val json = try {
                        Json.parseToJsonElement(resp.body()).jsonObject
                    } catch (_: Exception) {
                        throw ApiException(
                            HttpStatusCode.BadGateway,
                            "NOTION_API_ERROR",
                            "노션 API 응답 파싱에 실패했습니다.",
                            source = "notion"
                        )
                    }
                    val propsObj = json["properties"] as? JsonObject
                    val propKeys = propsObj?.keys ?: emptySet()
                    val missing = requiredProps.filter { it !in propKeys }
                    if (missing.isNotEmpty()) {
                        throw ApiException(
                            HttpStatusCode.BadRequest,
                            "NOTION_SCHEMA_MISMATCH",
                            "노션 데이터베이스에 필수 속성이 없습니다: ${missing.joinToString(", ")}",
                            source = "notion"
                        )
                    }
                    val title = extractTitle(json, dbRole)
                    return Pair(title, json)
                }
                401, 403 -> throw ApiException(
                    HttpStatusCode.BadRequest,
                    "PROVIDER_KEY_INVALID",
                    "노션 통합 토큰이 유효하지 않습니다. 토큰을 다시 확인해 주세요.",
                    source = "notion"
                )
                404 -> throw ApiException(
                    HttpStatusCode.NotFound,
                    "NOTION_OBJECT_NOT_FOUND",
                    "노션 데이터베이스를 찾을 수 없습니다. 노션 페이지에 통합(Connections)을 연결했는지 확인해 주세요.",
                    source = "notion"
                )
                else -> throw ApiException(
                    HttpStatusCode.BadGateway,
                    "NOTION_API_ERROR",
                    "노션 API 호출에 실패했습니다 (HTTP $status).",
                    source = "notion"
                )
            }
        }

        val (songsTitle, _) = fetchDatabase(songsDb, "연습 곡", REQUIRED_SONGS_PROPS)
        val (sessionsTitle, _) = fetchDatabase(sessionsDb, "연습 기록", REQUIRED_SESSIONS_PROPS)
        val notesTitle = if (!notesDb.isNullOrBlank()) {
            fetchDatabase(notesDb, "학습 영상 노트", REQUIRED_NOTES_PROPS).first
        } else {
            null
        }

        var maxUploadMB = 5
        try {
            val userReq = HttpRequest.newBuilder()
                .uri(URI("$baseUri/users/me"))
                .header("Authorization", "Bearer $token")
                .header("Notion-Version", NOTION_VERSION)
                .header("Accept", "application/json")
                .timeout(Duration.ofSeconds(5))
                .GET()
                .build()

            val userResp = httpClient.send(userReq, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
            if (userResp.statusCode() == 200) {
                val userJson = Json.parseToJsonElement(userResp.body()).jsonObject
                val botObj = userJson["bot"] as? JsonObject
                val limitsObj = botObj?.get("workspace_limits") as? JsonObject
                val bytesElem = limitsObj?.get("max_file_upload_size_in_bytes") as? JsonPrimitive
                val bytes = bytesElem?.content?.toLongOrNull()
                if (bytes != null && bytes > 0L) {
                    val mb = (bytes / 1048576L).toInt()
                    if (mb > 0) maxUploadMB = mb
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // users/me 실패 시 기본값 5MB 유지
        }

        NotionCheckResponse(
            ok = true,
            provider = "notion",
            songsTitle = songsTitle,
            sessionsTitle = sessionsTitle,
            notesTitle = notesTitle,
            maxUploadMB = maxUploadMB
        )
    }

    override suspend fun checkGemini(
        apiKey: String,
        model: String
    ): GeminiCheckResponse = withContext(Dispatchers.IO) {
        val baseUri = geminiBaseUrl.trimEnd('/')
        val req = HttpRequest.newBuilder()
            .uri(URI("$baseUri/models/$model"))
            .header("x-goog-api-key", apiKey)
            .header("Accept", "application/json")
            .timeout(Duration.ofSeconds(5))
            .GET()
            .build()

        val resp = try {
            httpClient.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            throw ApiException(
                HttpStatusCode.BadGateway,
                "GEMINI_API_ERROR",
                "Gemini API 호출에 실패했습니다 (${e.message ?: "네트워크 오류"}).",
                source = "gemini"
            )
        }

        val status = resp.statusCode()
        when (status) {
            200 -> {
                val json = try {
                    Json.parseToJsonElement(resp.body()).jsonObject
                } catch (_: Exception) {
                    throw ApiException(
                        HttpStatusCode.BadGateway,
                        "GEMINI_API_ERROR",
                        "Gemini API 응답 파싱에 실패했습니다.",
                        source = "gemini"
                    )
                }
                val displayName = (json["displayName"] as? JsonPrimitive)?.content?.takeIf { it.isNotBlank() } ?: model
                GeminiCheckResponse(
                    ok = true,
                    provider = "gemini",
                    model = model,
                    displayName = displayName
                )
            }
            400, 401, 403 -> throw ApiException(
                HttpStatusCode.BadRequest,
                "PROVIDER_KEY_INVALID",
                "Gemini API 키가 유효하지 않거나 권한이 없습니다.",
                source = "gemini"
            )
            404 -> throw ApiException(
                HttpStatusCode.NotFound,
                "GEMINI_MODEL_NOT_FOUND",
                "지정한 Gemini 모델($model)을 찾을 수 없습니다.",
                source = "gemini"
            )
            else -> throw ApiException(
                HttpStatusCode.BadGateway,
                "GEMINI_API_ERROR",
                "Gemini API 호출에 실패했습니다 (HTTP $status).",
                source = "gemini"
            )
        }
    }
}

