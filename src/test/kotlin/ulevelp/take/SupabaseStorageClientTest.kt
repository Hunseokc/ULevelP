package ulevelp.take

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import ulevelp.storage.StorageException
import ulevelp.storage.SupabaseStorageClient
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class SupabaseStorageClientTest {

    data class RecordedRequest(
        val method: String,
        val path: String,
        val headers: Map<String, List<String>>,
        val body: ByteArray
    )

    private lateinit var server: HttpServer
    private var port: Int = 0
    private val recordedRequests = CopyOnWriteArrayList<RecordedRequest>()
    private var responseStatus: Int = 200
    private var responseBody: String = "{}"

    @BeforeEach
    fun setUp() {
        recordedRequests.clear()
        responseStatus = 200
        responseBody = "{}"

        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { exchange: HttpExchange ->
            val reqBody = exchange.requestBody.readAllBytes()
            recordedRequests.add(
                RecordedRequest(
                    method = exchange.requestMethod,
                    path = exchange.requestURI.rawPath,
                    headers = exchange.requestHeaders,
                    body = reqBody
                )
            )

            val bytes = responseBody.toByteArray(Charsets.UTF_8)
            exchange.sendResponseHeaders(responseStatus, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        server.start()
        port = server.address.port
    }

    @AfterEach
    fun tearDown() {
        server.stop(0)
    }

    @Test
    fun `C1 upload - 올바른 경로 헤더 본문으로 전송`() = runBlocking {
        responseStatus = 200
        responseBody = "{}"
        val client = SupabaseStorageClient("http://127.0.0.1:$port", "sb_secret_test")

        client.upload("u1/t1.m4a", byteArrayOf(1, 2, 3), "audio/mp4")

        assertEquals(1, recordedRequests.size)
        val req = recordedRequests[0]
        assertEquals("POST", req.method)
        assertEquals("/storage/v1/object/takes/u1/t1.m4a", req.path)
        assertEquals("Bearer sb_secret_test", req.headers["Authorization"]?.firstOrNull())
        assertEquals("sb_secret_test", req.headers["Apikey"]?.firstOrNull() ?: req.headers["apikey"]?.firstOrNull())
        assertEquals("audio/mp4", req.headers["Content-type"]?.firstOrNull() ?: req.headers["Content-Type"]?.firstOrNull())
        assertEquals("false", req.headers["X-upsert"]?.firstOrNull() ?: req.headers["x-upsert"]?.firstOrNull())
        assertContentEquals(byteArrayOf(1, 2, 3), req.body)
    }

    @Test
    fun `C2 sign - signedURL 요청 및 조합 반환`() = runBlocking {
        responseStatus = 200
        responseBody = """{"signedURL":"/object/sign/takes/u1/t1.m4a?token=abc"}"""
        val client = SupabaseStorageClient("http://127.0.0.1:$port", "sb_secret_test")

        val result = client.createSignedUrl("u1/t1.m4a", 3600)

        assertEquals("http://127.0.0.1:$port/storage/v1/object/sign/takes/u1/t1.m4a?token=abc", result)
        assertEquals(1, recordedRequests.size)
        val req = recordedRequests[0]
        assertEquals("POST", req.method)
        assertEquals("/storage/v1/object/sign/takes/u1/t1.m4a", req.path)

        val json = Json.parseToJsonElement(req.body.toString(Charsets.UTF_8)).jsonObject
        assertEquals(3600, json["expiresIn"]?.jsonPrimitive?.content?.toInt())
    }

    @Test
    fun `C3 delete - DELETE 경로와 prefixes 본문`() = runBlocking {
        responseStatus = 200
        responseBody = "[]"
        val client = SupabaseStorageClient("http://127.0.0.1:$port", "sb_secret_test")

        client.delete("u1/t1.m4a")

        assertEquals(1, recordedRequests.size)
        val req = recordedRequests[0]
        assertEquals("DELETE", req.method)
        assertEquals("/storage/v1/object/takes", req.path)

        val json = Json.parseToJsonElement(req.body.toString(Charsets.UTF_8)).jsonObject
        val prefixes = json["prefixes"]?.jsonArray?.map { it.jsonPrimitive.content }
        assertEquals(listOf("u1/t1.m4a"), prefixes)
    }

    @Test
    fun `C4 비 2xx 응답 시 StorageException 발생`() = runBlocking {
        responseStatus = 400
        responseBody = """{"error":"bad request"}"""
        val client = SupabaseStorageClient("http://127.0.0.1:$port", "sb_secret_test")

        assertThrows<StorageException> {
            runBlocking { client.upload("u1/t1.m4a", byteArrayOf(1), "audio/mp4") }
        }
        assertThrows<StorageException> {
            runBlocking { client.createSignedUrl("u1/t1.m4a", 3600) }
        }
        assertThrows<StorageException> {
            runBlocking { client.delete("u1/t1.m4a") }
        }
    }

    @Test
    fun `C5 sign 응답에 signedURL 필드 부재 시 StorageException`() = runBlocking {
        responseStatus = 200
        responseBody = "{}"
        val client = SupabaseStorageClient("http://127.0.0.1:$port", "sb_secret_test")

        assertThrows<StorageException> {
            runBlocking { client.createSignedUrl("u1/t1.m4a", 3600) }
        }
    }

    @Test
    fun `C6 fromEnvOrNull 환경변수 확인`() {
        val onlyUrl = mapOf("SUPABASE_URL" to "https://x.supabase.co/")
        val onlyKey = mapOf("SUPABASE_SECRET_KEY" to "secret")
        val both = mapOf(
            "SUPABASE_URL" to "https://x.supabase.co/",
            "SUPABASE_SECRET_KEY" to "secret"
        )

        assertNull(SupabaseStorageClient.fromEnvOrNull(onlyUrl))
        assertNull(SupabaseStorageClient.fromEnvOrNull(onlyKey))
        assertNotNull(SupabaseStorageClient.fromEnvOrNull(both))
    }
}

