package ulevelp.note

import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.*

/** GA-1: Gemini 실패 원인 코드(`진행_분석설정.md` §3-1) */
class GeminiClientErrorTest {

    /** 매 요청마다 같은 상태·본문을 돌려주는 가짜 Gemini. 호출 횟수를 센다 */
    private fun <T> withFakeGemini(status: Int, body: String, block: suspend (HttpGeminiClient, AtomicInteger) -> T): T {
        val calls = AtomicInteger(0)
        val server = HttpServer.create(InetSocketAddress(0), 0)
        server.createContext("/models/gemini-flash-latest:generateContent") { exchange ->
            calls.incrementAndGet()
            val bytes = body.toByteArray()
            exchange.responseHeaders.add("Content-Type", "application/json")
            exchange.sendResponseHeaders(status, bytes.size.toLong())
            exchange.responseBody.write(bytes)
            exchange.responseBody.close()
        }
        server.start()
        try {
            val client = HttpGeminiClient(baseUrl = "http://127.0.0.1:${server.address.port}", retryDelayBaseMs = 1L)
            return runBlocking { block(client, calls) }
        } finally {
            server.stop(0)
        }
    }

    private suspend fun HttpGeminiClient.call() =
        generateNoteAnalysis("key", "gemini-flash-latest", "https://youtu.be/oWQZopUx0fA", "prompt", buildJsonObject {})

    private fun googleError(code: Int, message: String, status: String) =
        buildJsonObject {
            putJsonObject("error") {
                put("code", code)
                put("message", message)
                put("status", status)
            }
        }.toString()

    @Test
    fun ga1_402_billing_noRetry_withGoogleMessage() = withFakeGemini(402, googleError(402, "Your prepayment credits are depleted.", "PAYMENT_REQUIRED")) { client, calls ->
        val ex = assertFailsWith<GeminiApiException> { client.call() }
        assertEquals(1, calls.get(), "402는 재시도하지 않는다")
        assertEquals("GEMINI_BILLING", ex.code)
        assertEquals(402, ex.statusCode)
        assertTrue(ex.message.startsWith("GEMINI_BILLING: "), ex.message)
        assertTrue(ex.message.contains("prepayment credits are depleted"), ex.message)
    }

    @Test
    fun ga1_429_rateLimit_afterRetries() = withFakeGemini(429, googleError(429, "Resource exhausted.", "RESOURCE_EXHAUSTED")) { client, calls ->
        val ex = assertFailsWith<GeminiApiException> { client.call() }
        assertEquals(4, calls.get(), "429는 4회 시도 뒤 실패")
        assertEquals("GEMINI_RATE_LIMIT", ex.code)
        assertTrue(ex.message.startsWith("GEMINI_RATE_LIMIT: "), ex.message)
    }

    @Test
    fun ga1_503_overloaded_afterRetries() = withFakeGemini(503, googleError(503, "This model is currently experiencing high demand.", "UNAVAILABLE")) { client, calls ->
        val ex = assertFailsWith<GeminiApiException> { client.call() }
        assertEquals(4, calls.get())
        assertEquals("GEMINI_OVERLOADED", ex.code)
        assertTrue(ex.message.startsWith("GEMINI_OVERLOADED: "), ex.message)
        assertTrue(ex.message.contains("high demand"), ex.message)
    }

    @Test
    fun ga1_500_nonJsonBody_overloaded_withoutGoogleMessage() = withFakeGemini(500, "Internal Server Error") { client, _ ->
        val ex = assertFailsWith<GeminiApiException> { client.call() }
        assertEquals("GEMINI_OVERLOADED", ex.code)
        assertEquals("GEMINI_OVERLOADED: Gemini 서버가 일시적으로 응답하지 못했습니다 (HTTP 500).", ex.message)
    }

    @Test
    fun ga1_400_general_apiError_withGoogleMessage() = withFakeGemini(400, googleError(400, "Video is private or unavailable.", "INVALID_ARGUMENT")) { client, calls ->
        val ex = assertFailsWith<GeminiApiException> { client.call() }
        assertEquals(1, calls.get())
        assertEquals("GEMINI_API_ERROR", ex.code)
        assertTrue(ex.message.startsWith("GEMINI_API_ERROR: "), ex.message)
        assertTrue(ex.message.contains("Video is private"), ex.message)
    }

    @Test
    fun ga1_401_keyInvalid_unchanged() = withFakeGemini(401, googleError(401, "API key not valid.", "UNAUTHENTICATED")) { client, _ ->
        val ex = assertFailsWith<GeminiApiException> { client.call() }
        assertEquals("PROVIDER_KEY_INVALID", ex.code)
        assertTrue(ex.message.startsWith("PROVIDER_KEY_INVALID:"), ex.message)
    }

    /** GA-2: 요청 본문 `video_metadata` — 옵션 없음(기본 fps) / fps + 구간 offset / fps만 */
    @Test
    fun ga2_videoMetadata_fpsAndOffsets() {
        val bodies = java.util.concurrent.CopyOnWriteArrayList<JsonObject>()
        val ok = buildJsonObject {
            putJsonArray("candidates") {
                addJsonObject { putJsonObject("content") { putJsonArray("parts") { addJsonObject { put("text", "{}") } } } }
            }
        }.toString().toByteArray()
        val server = HttpServer.create(InetSocketAddress(0), 0)
        server.createContext("/models/gemini-flash-latest:generateContent") { exchange ->
            bodies.add(Json.parseToJsonElement(exchange.requestBody.readBytes().toString(Charsets.UTF_8)).jsonObject)
            exchange.sendResponseHeaders(200, ok.size.toLong())
            exchange.responseBody.write(ok)
            exchange.responseBody.close()
        }
        server.start()
        try {
            val client = HttpGeminiClient(baseUrl = "http://127.0.0.1:${server.address.port}", frameFps = 0.2, retryDelayBaseMs = 1L)
            runBlocking {
                client.call()
                client.generateNoteAnalysis("key", "gemini-flash-latest", "https://youtu.be/oWQZopUx0fA", "prompt", buildJsonObject {},
                    GeminiVideoOptions(fps = 3.0, startSec = 40, endSec = 80))
                client.generateNoteAnalysis("key", "gemini-flash-latest", "https://youtu.be/oWQZopUx0fA", "prompt", buildJsonObject {},
                    GeminiVideoOptions(fps = 1.0))
            }
        } finally {
            server.stop(0)
        }
        val metas = bodies.map {
            it["contents"]!!.jsonArray[0].jsonObject["parts"]!!.jsonArray[0].jsonObject["video_metadata"]!!.jsonObject
        }
        assertEquals(buildJsonObject { put("fps", 0.2) }, metas[0])
        assertEquals(buildJsonObject { put("fps", 3.0); put("start_offset", "40s"); put("end_offset", "80s") }, metas[1])
        assertEquals(buildJsonObject { put("fps", 1.0) }, metas[2])
    }
}
