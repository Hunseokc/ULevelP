package ulevelp

import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import io.ktor.client.request.*
import io.ktor.http.*
import io.ktor.server.testing.*
import org.slf4j.LoggerFactory
import kotlin.test.*

class ForwardedHeadersTest {
    @Test
    fun `Z7 Cloud Run 프록시 뒤 같은 출처 요청은 CORS로 막지 않는다`() = testApplication {
        application {
            module(dbConfig = null, authConfig = null, allowedOrigins = listOf("https://hunseokc.github.io"))
        }
        // Cloud Run은 TLS를 끝내고 컨테이너에 http로 넘기며 X-Forwarded-Proto: https만 붙인다.
        // 브라우저는 같은 출처라도 POST·PUT·DELETE엔 Origin을 보낸다. CORS 판정은 메서드와 무관하므로
        // 인증 플러그인이 끼지 않는 /api/health로 본다(테스트 엔진에선 인증 401이 CORS 403을 덮어쓴다)
        val runApp = "ulevelp-d5ympfsmfq-du.a.run.app"
        suspend fun behindCloudRun(origin: String, block: HttpRequestBuilder.() -> Unit = {}) =
            client.get("/api/health") {
                header(HttpHeaders.Host, runApp)
                header(HttpHeaders.XForwardedProto, "https")
                header(HttpHeaders.Origin, origin)
                block()
            }.status

        assertEquals(HttpStatusCode.OK, behindCloudRun("https://$runApp"), "같은 출처가 CORS 403")
        assertEquals(HttpStatusCode.Forbidden, behindCloudRun("https://evil.example.com"), "다른 출처는 계속 거부")
        // X-Forwarded-Host는 믿지 않는다(위조로 같은 출처처럼 보이게 할 수 없어야 한다)
        assertEquals(
            HttpStatusCode.Forbidden,
            behindCloudRun("https://evil.example.com") { header(HttpHeaders.XForwardedHost, "evil.example.com") },
            "X-Forwarded-Host 위조"
        )
    }

    @Test
    fun `FX-1 CORS가 거부한 요청은 라우트를 돌지 않고 ERROR 로그도 남기지 않는다`() = testApplication {
        application {
            module(dbConfig = null, authConfig = null, allowedOrigins = listOf("https://hunseokc.github.io"))
        }
        val root = LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME) as Logger
        val appender = ListAppender<ILoggingEvent>().apply { start() }
        root.addAppender(appender)
        try {
            // 인증이 필요한 라우트: 거부 뒤에도 라우트가 돌면 401을 던지고, 이미 보낸 응답에 헤더를 붙이다 ERROR가 난다
            val get = client.get("/api/v1/me") { header(HttpHeaders.Origin, "https://evil.example.com") }
            assertEquals(HttpStatusCode.Forbidden, get.status, "GET 거부")
            val post = client.post("/api/v1/songs") { header(HttpHeaders.Origin, "https://evil.example.com") }
            assertEquals(HttpStatusCode.Forbidden, post.status, "POST 거부")

            val errors = appender.list.filter { it.level == Level.ERROR }
            assertTrue(errors.isEmpty(), "ERROR 로그: ${errors.map { it.formattedMessage + " / " + it.throwableProxy?.message }}")
        } finally {
            root.detachAppender(appender)
        }
    }
}
