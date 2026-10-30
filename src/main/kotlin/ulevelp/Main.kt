package ulevelp

import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.plugins.contentnegotiation.*
import io.ktor.server.plugins.statuspages.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.json.*
import ulevelp.routes.BadRequestException
import ulevelp.routes.ChordApi
import ulevelp.routes.registerChordRoutes
import java.io.File

fun main() {
    val port = System.getenv("PORT")?.toIntOrNull() ?: 3000
    val host = System.getenv("HOST")?.takeIf { it.isNotBlank() } ?: "0.0.0.0"
    embeddedServer(Netty, port = port, host = host, module = Application::module).start(wait = true)
}

fun Application.module(publicDir: File = File(System.getenv("PUBLIC_DIR") ?: "public")) {
    install(ContentNegotiation) {
        json(
            Json {
                encodeDefaults = true
            }
        )
    }

    install(StatusPages) {
        exception<BadRequestException> { call, cause ->
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(
                HttpStatusCode.BadRequest,
                buildJsonObject { put("error", cause.message) }
            )
        }
        exception<Throwable> { call, cause ->
            call.application.environment.log.error("Unhandled server error", cause)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(
                HttpStatusCode.InternalServerError,
                buildJsonObject { put("error", "서버 오류") }
            )
        }
    }

    intercept(ApplicationCallPipeline.Plugins) {
        call.response.headers.append("X-Content-Type-Options", "nosniff")
    }

    val canonicalPublicRoot = publicDir.canonicalFile

    routing {
        registerChordRoutes()

        route("/api/{...}") {
            handle {
                call.response.headers.append(HttpHeaders.CacheControl, "no-store")
                call.respond(
                    HttpStatusCode.NotFound,
                    buildJsonObject {
                        put("error", "없는 API입니다")
                        putJsonArray("apis") { ChordApi.API_LIST.forEach { add(it) } }
                    }
                )
            }
        }

        route("{path...}") {
            handle {
                val method = call.request.httpMethod
                if (method != HttpMethod.Get && method != HttpMethod.Head) {
                    call.response.headers.append(HttpHeaders.CacheControl, "no-store")
                    call.respond(
                        HttpStatusCode.MethodNotAllowed,
                        buildJsonObject { put("error", "GET 만 지원합니다") }
                    )
                    return@handle
                }

                val segments = call.parameters.getAll("path").orEmpty()
                val relPath = if (segments.isEmpty() || (segments.size == 1 && segments[0].isEmpty())) {
                    "index.html"
                } else {
                    segments.joinToString(File.separator)
                }

                val targetFile = File(canonicalPublicRoot, relPath).canonicalFile
                val rootPrefix = canonicalPublicRoot.path + File.separator
                if (targetFile.path != canonicalPublicRoot.path && !targetFile.path.startsWith(rootPrefix)) {
                    call.respondText("Forbidden", ContentType.Text.Plain.withCharset(Charsets.UTF_8), HttpStatusCode.Forbidden)
                    return@handle
                }

                if (!targetFile.exists() || !targetFile.isFile) {
                    call.respondText("Not found", ContentType.Text.Plain.withCharset(Charsets.UTF_8), HttpStatusCode.NotFound)
                    return@handle
                }

                val ext = targetFile.extension.lowercase()
                val contentType = when (ext) {
                    "html" -> ContentType.Text.Html.withCharset(Charsets.UTF_8)
                    "css" -> ContentType.Text.CSS.withCharset(Charsets.UTF_8)
                    "js" -> ContentType.Text.JavaScript.withCharset(Charsets.UTF_8)
                    "json" -> ContentType.Application.Json.withCharset(Charsets.UTF_8)
                    "svg" -> ContentType.Image.SVG
                    "png" -> ContentType.Image.PNG
                    "ico" -> ContentType.Image.XIcon
                    else -> ContentType.Application.OctetStream
                }

                call.response.headers.append(
                    HttpHeaders.CacheControl,
                    if (ext == "html") "no-cache" else "public, max-age=300"
                )

                if (method == HttpMethod.Head) {
                    call.response.headers.append(HttpHeaders.ContentLength, targetFile.length().toString())
                    call.respond(HttpStatusCode.OK)
                } else {
                    call.respondBytes(targetFile.readBytes(), contentType, HttpStatusCode.OK)
                }
            }
        }
    }
}

