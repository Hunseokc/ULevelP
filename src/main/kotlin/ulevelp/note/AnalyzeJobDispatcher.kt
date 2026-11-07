package ulevelp.note

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.future.await
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import org.slf4j.LoggerFactory
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.util.UUID

fun interface AnalyzeJobDispatcher {
    suspend fun dispatch(jobId: UUID)
}

/**
 * 운영 환경(CLOUD_RUN_ANALYZE_JOB_URI 설정 시):
 * GCP 메타데이터 서버(http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token)
 * 또는 고정 토큰에서 Bearer 토큰을 얻어 POST $jobUri 로
 * {"overrides":{"containerOverrides":[{"env":[{"name":"ANALYZE_JOB_ID","value":"<jobId>"}]}]}} 를 전송한다.
 */
class CloudRunJobDispatcher(
    private val jobUri: String,
    private val staticAccessToken: String? = System.getenv("CLOUD_RUN_ACCESS_TOKEN")?.takeIf { it.isNotBlank() },
    private val httpClient: HttpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build()
) : AnalyzeJobDispatcher {
    private val logger = LoggerFactory.getLogger(CloudRunJobDispatcher::class.java)

    override suspend fun dispatch(jobId: UUID): Unit = withContext(Dispatchers.IO) {
        val token = staticAccessToken ?: fetchGcpMetadataToken()
        val requestUri = URI(jobUri)

        val payload = buildJsonObject {
            putJsonObject("overrides") {
                putJsonArray("containerOverrides") {
                    addJsonObject {
                        putJsonArray("env") {
                            addJsonObject {
                                put("name", "ANALYZE_JOB_ID")
                                put("value", jobId.toString())
                            }
                        }
                    }
                }
            }
        }.toString()

        val request = HttpRequest.newBuilder()
            .uri(requestUri)
            .timeout(Duration.ofSeconds(15))
            .header("Authorization", "Bearer $token")
            .header("Content-Type", "application/json; charset=utf-8")
            .POST(HttpRequest.BodyPublishers.ofString(payload, StandardCharsets.UTF_8))
            .build()

        val response = try {
            httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)).await()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            logger.error("Cloud Run Job 디스패치 네트워크 실패: {}", e.message)
            throw RuntimeException("Cloud Run Job 디스패치 실패: ${e.message}", e)
        }

        if (response.statusCode() !in 200..299) {
            logger.error("Cloud Run Job 디스패치 실패 HTTP {}: {}", response.statusCode(), response.body())
            throw RuntimeException("Cloud Run Job 디스패치 실패 (HTTP ${response.statusCode()})")
        }

        logger.info("Cloud Run Job 디스패치 성공 jobId={}", jobId)
    }

    private suspend fun fetchGcpMetadataToken(): String {
        val metadataUri = URI("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token")
        val req = HttpRequest.newBuilder()
            .uri(metadataUri)
            .timeout(Duration.ofSeconds(5))
            .header("Metadata-Flavor", "Google")
            .GET()
            .build()
        val res = try {
            httpClient.sendAsync(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)).await()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            throw RuntimeException("GCP 메타데이터 토큰 요청 네트워크 오류: ${e.message}", e)
        }
        if (res.statusCode() != 200) {
            throw RuntimeException("GCP 메타데이터 토큰 획득 실패 (HTTP ${res.statusCode()})")
        }
        val obj = Json.parseToJsonElement(res.body()).jsonObject
        return obj["access_token"]?.jsonPrimitive?.content
            ?: throw RuntimeException("GCP 메타데이터 응답에 access_token이 없습니다.")
    }
}

/**
 * 로컬 서버 실행 시(CLOUD_RUN_ANALYZE_JOB_URI 미설정 시) 백그라운드 코루틴으로 executeJob을 실행하는 기본 디스패처.
 */
class LocalAsyncJobDispatcher(
    private val runner: suspend (UUID) -> Unit,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
) : AnalyzeJobDispatcher {
    override suspend fun dispatch(jobId: UUID) {
        scope.launch { runner(jobId) }
    }
}
