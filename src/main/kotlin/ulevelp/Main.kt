package ulevelp

import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.plugins.contentnegotiation.*
import io.ktor.server.plugins.cors.routing.*
import io.ktor.server.plugins.statuspages.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.*
import org.jetbrains.exposed.sql.Database
import ulevelp.api.ApiException
import ulevelp.api.respondApiError
import ulevelp.auth.SupabaseAuthConfig
import ulevelp.auth.SupabaseJwtVerifier
import ulevelp.db.DatabaseConfig
import ulevelp.db.DatabaseFactory
import ulevelp.routes.BadRequestException
import ulevelp.routes.ChordApi
import ulevelp.routes.registerChordRoutes
import ulevelp.routes.registerMeRoutes
import ulevelp.service.ProfileService
import java.io.File
import java.net.URI

private const val DEFAULT_ALLOWED_ORIGINS = "https://hunseokc.github.io,http://localhost:3000"

fun parseAllowedOrigins(raw: String?): List<String> {
    val source = raw?.takeIf { it.isNotBlank() } ?: DEFAULT_ALLOWED_ORIGINS
    return source.split(',')
        .map { it.trim() }
        .filter { it.isNotEmpty() }
}

fun main() {
    val port = System.getenv("PORT")?.toIntOrNull() ?: 3000
    val host = System.getenv("HOST")?.takeIf { it.isNotBlank() } ?: "0.0.0.0"
    embeddedServer(Netty, port = port, host = host, module = Application::module).start(wait = true)
}

@OptIn(ExperimentalSerializationApi::class)
fun Application.module(
    publicDir: File = File(System.getenv("PUBLIC_DIR") ?: "public"),
    dbConfig: DatabaseConfig? = DatabaseFactory.fromEnvOrNull(),
    authConfig: SupabaseAuthConfig? = SupabaseAuthConfig.fromEnvOrNull(),
    allowedOrigins: List<String> = parseAllowedOrigins(System.getenv("ALLOWED_ORIGINS"))
) {
    val db: Database? = if (dbConfig != null) {
        val (dataSource, database) = DatabaseFactory.init(dbConfig)
        monitor.subscribe(ApplicationStopped) {
            runCatching { dataSource.close() }
        }
        database
    } else {
        environment.log.warn("DB 설정(DATABASE_URL / REMOTE_DB_HOST)이 없어 데이터베이스 초기화를 건너뜁니다.")
        null
    }

    val jwtVerifier: SupabaseJwtVerifier? = if (authConfig != null) {
        SupabaseJwtVerifier(authConfig)
    } else {
        environment.log.warn("인증 설정(SUPABASE_URL)이 없어 JWT 검증기가 비활성화됩니다.")
        null
    }

    val profileService = ProfileService(db)

    install(CORS) {
        allowMethod(HttpMethod.Options)
        allowMethod(HttpMethod.Get)
        allowMethod(HttpMethod.Post)
        allowMethod(HttpMethod.Put)
        allowMethod(HttpMethod.Patch)
        allowMethod(HttpMethod.Delete)
        allowMethod(HttpMethod.Head)

        allowHeader(HttpHeaders.Authorization)
        allowHeader(HttpHeaders.ContentType)
        allowHeader(HttpHeaders.Accept)
        allowCredentials = true

        for (origin in allowedOrigins) {
            runCatching {
                val uri = URI(origin)
                val scheme = uri.scheme?.lowercase() ?: return@runCatching
                val host = uri.host ?: return@runCatching
                val hostWithPort = if (uri.port != -1) "$host:${uri.port}" else host
                allowHost(hostWithPort, schemes = listOf(scheme))
            }
        }
    }

    install(ContentNegotiation) {
        json(
            Json {
                encodeDefaults = true
                explicitNulls = true
                ignoreUnknownKeys = true
            }
        )
    }

    install(StatusPages) {
        exception<ApiException> { call, cause ->
            call.respondApiError(
                status = cause.status,
                code = cause.code,
                message = cause.message,
                source = cause.source,
                retryAfter = cause.retryAfter
            )
        }
        exception<BadRequestException> { call, cause ->
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(
                HttpStatusCode.BadRequest,
                buildJsonObject { put("error", cause.message) }
            )
        }
        exception<Throwable> { call, cause ->
            call.application.environment.log.error("Unhandled server error", cause)
            if (call.request.path().startsWith("/api/v1")) {
                call.respondApiError(
                    status = HttpStatusCode.InternalServerError,
                    code = "INTERNAL_ERROR",
                    message = "서버 내부 오류가 발생했습니다."
                )
            } else {
                call.response.headers.append(HttpHeaders.CacheControl, "no-store")
                call.respond(
                    HttpStatusCode.InternalServerError,
                    buildJsonObject { put("error", "서버 오류") }
                )
            }
        }
    }

    intercept(ApplicationCallPipeline.Plugins) {
        call.response.headers.append("X-Content-Type-Options", "nosniff")
    }

    val canonicalPublicRoot = publicDir.canonicalFile

    routing {
        registerChordRoutes()

        route("/api/v1") {
            registerMeRoutes(jwtVerifier, profileService)

            route("{...}") {
                handle {
                    call.respondApiError(
                        status = HttpStatusCode.NotFound,
                        code = "NOT_FOUND",
                        message = "존재하지 않는 API 경로입니다."
                    )
                }
            }
        }

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
