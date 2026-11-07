package ulevelp.note

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.future.await
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import org.slf4j.LoggerFactory
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.time.Duration

class GeminiApiException(
    val statusCode: Int,
    val code: String,
    override val message: String
) : RuntimeException(message)

data class GeminiGenerateResult(
    val analysis: JsonObject,
    val usageSummary: String
)

/**
 * 영상 입력 옵션(GA-2, `진행_분석설정.md` §3-2): `video_metadata`의 `fps`·`start_offset`·`end_offset`.
 * null 필드는 보내지 않는다(fps가 null이면 클라이언트 기본 `GEMINI_FRAME_FPS`).
 */
data class GeminiVideoOptions(
    val fps: Double? = null,
    val startSec: Int? = null,
    val endSec: Int? = null
)

interface GeminiClient {
    suspend fun generateNoteAnalysis(
        apiKey: String,
        model: String,
        youtubeUrl: String,
        prompt: String,
        responseJsonSchema: JsonObject,
        videoOptions: GeminiVideoOptions? = null
    ): GeminiGenerateResult
}

class HttpGeminiClient(
    private val baseUrl: String = "https://generativelanguage.googleapis.com/v1beta",
    private val frameFps: Double = System.getenv("GEMINI_FRAME_FPS")?.toDoubleOrNull() ?: 0.2,
    private val maxAttempts: Int = 4,
    private val retryDelayBaseMs: Long = 30_000L,
    private val requestTimeout: Duration = Duration.ofMinutes(12),
    private val httpClient: HttpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build()
) : GeminiClient {
    private val logger = LoggerFactory.getLogger(HttpGeminiClient::class.java)

    override suspend fun generateNoteAnalysis(
        apiKey: String,
        model: String,
        youtubeUrl: String,
        prompt: String,
        responseJsonSchema: JsonObject,
        videoOptions: GeminiVideoOptions?
    ): GeminiGenerateResult = withContext(Dispatchers.IO) {
        val requestUri = URI("$baseUrl/models/$model:generateContent")

        val requestPayload = buildJsonObject {
            putJsonArray("contents") {
                addJsonObject {
                    putJsonArray("parts") {
                        addJsonObject {
                            putJsonObject("file_data") {
                                put("file_uri", youtubeUrl)
                            }
                            putJsonObject("video_metadata") {
                                put("fps", videoOptions?.fps ?: frameFps)
                                videoOptions?.startSec?.let { put("start_offset", "${it}s") }
                                videoOptions?.endSec?.let { put("end_offset", "${it}s") }
                            }
                        }
                        addJsonObject {
                            put("text", prompt)
                        }
                    }
                }
            }
            putJsonObject("generationConfig") {
                put("responseMimeType", "application/json")
                put("responseJsonSchema", responseJsonSchema)
                put("mediaResolution", "MEDIA_RESOLUTION_LOW")
                putJsonObject("thinkingConfig") {
                    put("thinkingLevel", "LOW")
                }
            }
        }.toString()

        for (attempt in 1..maxAttempts) {
            val httpRequest = HttpRequest.newBuilder()
                .uri(requestUri)
                .timeout(requestTimeout)
                .header("x-goog-api-key", apiKey)
                .header("Content-Type", "application/json; charset=utf-8")
                .header("Accept", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(requestPayload, StandardCharsets.UTF_8))
                .build()

            val response: HttpResponse<String> = try {
                httpClient.sendAsync(httpRequest, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)).await()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                logger.warn("Gemini HTTP 요청 예외 (attempt {}/{}): {}", attempt, maxAttempts, e.message)
                if (attempt < maxAttempts) {
                    delay(retryDelayBaseMs * attempt)
                    continue
                } else {
                    throw GeminiApiException(500, CODE_API_ERROR, "$CODE_API_ERROR: Gemini 분석 호출에 실패했습니다: ${e.message}")
                }
            }

            val status = response.statusCode()
            val body = response.body()

            if (status in setOf(429, 500, 503)) {
                logger.warn("Gemini 일시적 오류 HTTP {} (attempt {}/{}): {}", status, attempt, maxAttempts, body.take(200))
                if (attempt < maxAttempts) {
                    delay(retryDelayBaseMs * attempt)
                    continue
                } else if (status == 429) {
                    throw failure(status, CODE_RATE_LIMIT, "Gemini 호출 한도를 넘었습니다", body)
                } else {
                    throw failure(status, CODE_OVERLOADED, "Gemini 서버가 일시적으로 응답하지 못했습니다", body)
                }
            }

            if (status == 402) {
                logger.warn("Gemini 결제/크레딧 오류 HTTP 402: {}", body.take(200))
                throw failure(status, CODE_BILLING, "Gemini 크레딧이 부족합니다", body)
            }

            if (status in setOf(401, 403) || (status == 400 && body.contains("API_KEY_INVALID"))) {
                logger.warn("Gemini API 키 무효/거부 HTTP {}: {}", status, body.take(200))
                throw GeminiApiException(
                    status,
                    "PROVIDER_KEY_INVALID",
                    "PROVIDER_KEY_INVALID: Gemini API 키가 유효하지 않거나 요청이 거부되었습니다 (HTTP $status)."
                )
            }

            if (status == 400) {
                logger.warn("Gemini 일반 400 오류: {}", body.take(200))
                throw failure(400, CODE_API_ERROR, "Gemini 분석 호출에 실패했습니다", body)
            }

            if (status != 200) {
                logger.warn("Gemini 비정상 응답 HTTP {}: {}", status, body.take(200))
                throw failure(status, CODE_API_ERROR, "Gemini 분석 호출에 실패했습니다", body)
            }

            // 200 OK 파싱
            return@withContext parseGeminiResponse(body)
        }

        throw GeminiApiException(500, CODE_API_ERROR, "$CODE_API_ERROR: Gemini 분석 호출에 실패했습니다.")
    }

    /**
     * 실패 원인 코드를 `error` 문자열 앞에 붙인다(`<코드>: 문장 (HTTP n) — Google 문구`).
     * 화면은 앞의 코드로 원인·안내를 고른다(`frontend/src/lib/jobError.ts`, 진행_분석설정.md §3-1).
     */
    private fun failure(status: Int, code: String, sentence: String, body: String): GeminiApiException {
        val googleMessage = runCatching {
            Json.parseToJsonElement(body).jsonObject["error"]?.jsonObject?.get("message")?.jsonPrimitive?.contentOrNull
        }.getOrNull()?.trim()?.take(200)
        val tail = if (googleMessage.isNullOrEmpty()) "" else " — $googleMessage"
        return GeminiApiException(status, code, "$code: $sentence (HTTP $status).$tail")
    }

    companion object {
        const val CODE_BILLING = "GEMINI_BILLING"
        const val CODE_RATE_LIMIT = "GEMINI_RATE_LIMIT"
        const val CODE_OVERLOADED = "GEMINI_OVERLOADED"
        const val CODE_API_ERROR = "GEMINI_API_ERROR"
    }

    private fun parseGeminiResponse(body: String): GeminiGenerateResult {
        val root = try {
            Json.parseToJsonElement(body).jsonObject
        } catch (e: Exception) {
            throw GeminiApiException(500, "GEMINI_API_ERROR", "Gemini 응답 JSON 파싱 실패: ${e.message}")
        }

        val candidates = root["candidates"]?.jsonArray
        val candidate = candidates?.firstOrNull()?.jsonObject
            ?: throw GeminiApiException(500, "GEMINI_API_ERROR", "Gemini 응답에 candidates가 없습니다.")

        val parts = candidate["content"]?.jsonObject?.get("parts")?.jsonArray
            ?: throw GeminiApiException(500, "GEMINI_API_ERROR", "Gemini 응답에 content.parts가 없습니다.")

        val nonThoughtParts = parts.filter { part ->
            part.jsonObject["thought"]?.jsonPrimitive?.booleanOrNull != true
        }

        val textPart = nonThoughtParts.lastOrNull { it.jsonObject["text"] != null }
            ?: throw GeminiApiException(500, "GEMINI_API_ERROR", "Gemini 응답에 텍스트 본문이 없습니다.")

        val textStr = textPart.jsonObject["text"]?.jsonPrimitive?.contentOrNull
            ?: throw GeminiApiException(500, "GEMINI_API_ERROR", "Gemini 응답 텍스트가 비어 있습니다.")

        val analysis = try {
            Json.parseToJsonElement(textStr).jsonObject
        } catch (e: Exception) {
            throw GeminiApiException(500, "GEMINI_API_ERROR", "Gemini 추출 데이터 JSON 파싱 실패: ${e.message}")
        }

        val usage = root["usageMetadata"]?.toString() ?: ""
        return GeminiGenerateResult(analysis = analysis, usageSummary = usage)
    }
}

