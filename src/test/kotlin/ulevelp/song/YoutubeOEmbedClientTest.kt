package ulevelp.song

import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import ulevelp.service.VideoMeta
import ulevelp.service.YoutubeOEmbedClient
import java.net.InetSocketAddress
import java.net.URI
import java.time.Duration
import java.util.concurrent.atomic.AtomicReference
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class YoutubeOEmbedClientTest {

    private lateinit var server: HttpServer
    private var port: Int = 0
    private val lastQuery = AtomicReference<String?>()
    private val responseHandler = AtomicReference<(query: String?) -> Pair<Int, String>>()

    @BeforeEach
    fun setUp() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/oembed") { exchange ->
            val query = exchange.requestURI.rawQuery
            lastQuery.set(query)
            val (status, body) = responseHandler.get().invoke(query)
            val bytes = body.toByteArray(Charsets.UTF_8)
            exchange.responseHeaders.add("Content-Type", "application/json")
            if (status == 200) {
                exchange.sendResponseHeaders(200, bytes.size.toLong())
                exchange.responseBody.use { it.write(bytes) }
            } else {
                exchange.sendResponseHeaders(status, -1)
                exchange.close()
            }
        }
        server.start()
        port = server.address.port
    }

    @AfterEach
    fun tearDown() {
        server.stop(0)
    }

    @Test
    fun `Y1 성공 - oEmbed 정상 응답 파싱 및 쿼리 파라미터 확인`() = runTest {
        responseHandler.set {
            200 to """{"title":" T ","author_name":"A"}"""
        }
        val client = YoutubeOEmbedClient(
            endpoint = URI("http://127.0.0.1:$port/oembed"),
            timeout = Duration.ofSeconds(2)
        )

        val meta = client.fetch("dQw4w9WgXcQ")
        assertNotNull(meta)
        assertEquals(VideoMeta("T", "A"), meta)

        val query = lastQuery.get()
        assertNotNull(query)
        assertTrue(query.contains("format=json"))
        assertTrue(query.contains("url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ"))
    }

    @Test
    fun `Y2 404 - 비 200 상태 코드는 null 반환`() = runTest {
        responseHandler.set {
            404 to ""
        }
        val client = YoutubeOEmbedClient(
            endpoint = URI("http://127.0.0.1:$port/oembed"),
            timeout = Duration.ofSeconds(2)
        )

        val meta = client.fetch("dQw4w9WgXcQ")
        assertNull(meta)
    }

    @Test
    fun `Y3 깨진 JSON - 파싱 오류 시 null 반환`() = runTest {
        responseHandler.set {
            200 to "not json"
        }
        val client = YoutubeOEmbedClient(
            endpoint = URI("http://127.0.0.1:$port/oembed"),
            timeout = Duration.ofSeconds(2)
        )

        val meta = client.fetch("dQw4w9WgXcQ")
        assertNull(meta)
    }

    @Test
    fun `Y4 시간 초과 - 타임아웃 발생 시 null 반환`() = runTest {
        responseHandler.set {
            Thread.sleep(1500)
            200 to """{"title":"Delayed","author_name":"Delayed"}"""
        }
        val client = YoutubeOEmbedClient(
            endpoint = URI("http://127.0.0.1:$port/oembed"),
            timeout = Duration.ofMillis(500)
        )

        val meta = client.fetch("dQw4w9WgXcQ")
        assertNull(meta)
    }

    @Test
    fun `Y5 title이 JSON null인 경우 null 반환`() = runTest {
        responseHandler.set {
            200 to """{"title":null,"author_name":"A"}"""
        }
        val client = YoutubeOEmbedClient(
            endpoint = URI("http://127.0.0.1:$port/oembed"),
            timeout = Duration.ofSeconds(2)
        )

        val meta = client.fetch("dQw4w9WgXcQ")
        assertNull(meta)
    }
}
