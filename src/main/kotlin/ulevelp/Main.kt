package ulevelp

import io.ktor.http.*
import io.ktor.http.content.OutgoingContent
import io.ktor.serialization.kotlinx.json.*
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.plugins.contentnegotiation.*
import io.ktor.server.plugins.cors.routing.*
import io.ktor.server.plugins.forwardedheaders.*
import io.ktor.server.plugins.statuspages.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.*
import org.jetbrains.exposed.sql.Database
import ulevelp.api.ApiException
import ulevelp.api.respondApiError
import ulevelp.auth.CronOidcConfig
import ulevelp.auth.CronOidcVerifier
import ulevelp.auth.SupabaseAuthConfig
import ulevelp.auth.SupabaseJwtVerifier
import ulevelp.db.DatabaseConfig
import ulevelp.db.DatabaseFactory
import ulevelp.note.AnalyzeJobDispatcher
import ulevelp.note.CloudRunJobDispatcher
import ulevelp.note.GeminiClient
import ulevelp.note.HttpGeminiClient
import ulevelp.note.LocalAsyncJobDispatcher
import ulevelp.notion.HttpNotionClient
import ulevelp.notion.NotionClient
import ulevelp.notion.NotionPushWorker
import ulevelp.notion.NotionSyncService
import ulevelp.routes.BadRequestException
import ulevelp.routes.ChordApi
import ulevelp.routes.registerCategoryRoutes
import ulevelp.routes.registerChordRoutes
import ulevelp.routes.registerExportImportRoutes
import ulevelp.routes.registerIntegrationRoutes
import ulevelp.routes.registerInternalCronRoutes
import ulevelp.routes.registerMeRoutes
import ulevelp.routes.registerNoteRoutes
import ulevelp.routes.registerNotionSyncRoutes
import ulevelp.routes.registerPracticeRoutes
import ulevelp.routes.registerProgressionRoutes
import ulevelp.routes.registerSessionRoutes
import ulevelp.routes.registerSongRoutes
import ulevelp.routes.registerTakeRoutes
import ulevelp.security.CryptoService
import ulevelp.service.CategoryService
import ulevelp.service.ProgressionService
import ulevelp.service.ExportImportService
import ulevelp.service.HttpIntegrationCheckClient
import ulevelp.service.IntegrationCheckClient
import ulevelp.service.IntegrationService
import ulevelp.service.NoteService
import ulevelp.service.PracticeService
import ulevelp.service.ProfileService
import ulevelp.service.SongService
import ulevelp.service.StorageTrashService
import ulevelp.service.TakeService
import ulevelp.service.SessionService
import ulevelp.service.VideoMetaClient
import ulevelp.service.YoutubeOEmbedClient
import ulevelp.storage.StorageClient
import ulevelp.storage.SupabaseStorageClient
import java.io.File
import java.net.URI
import java.util.UUID

private const val DEFAULT_ALLOWED_ORIGINS = "https://hunseokc.github.io,http://localhost:3000"
private const val DEFAULT_PUBLIC_APP_URL = "https://hunseokc.github.io/ULevelP/"

fun parseAllowedOrigins(raw: String?): List<String> {
    val source = raw?.takeIf { it.isNotBlank() } ?: DEFAULT_ALLOWED_ORIGINS
    return source.split(',')
        .map { it.trim() }
        .filter { it.isNotEmpty() }
}

fun parsePublicAppUrl(raw: String?): String {
    val trimmed = raw?.trim()
    if (trimmed.isNullOrEmpty()) {
        return DEFAULT_PUBLIC_APP_URL
    }
    return if (trimmed.endsWith("/")) trimmed else "$trimmed/"
}

fun runAnalyzeJobCli(jobId: UUID) = runBlocking {
    val dbConfig = DatabaseFactory.fromEnvOrNull()
        ?: error("ANALYZE_JOB_CLI_ERROR: DB 설정(DATABASE_URL / REMOTE_DB_HOST)이 없습니다.")
    val (_, database) = DatabaseFactory.init(dbConfig)
    val cryptoService = CryptoService.fromEnvOrNull()
    val integrationCheckClient = HttpIntegrationCheckClient()
    val integrationService = IntegrationService(database, cryptoService, integrationCheckClient)
    val videoMetaClient = YoutubeOEmbedClient()
    val geminiClient = HttpGeminiClient()
    val noteService = NoteService(
        db = database,
        integrationService = integrationService,
        videoMetaClient = videoMetaClient,
        geminiClient = geminiClient
    )
    noteService.executeJob(jobId)
}

// React 빌드(spa.html)가 대신 서빙하는 HTML 진입 경로 (RZ-3)
private val SPA_ENTRY_PAGES = setOf(
    "index.html", "chords.html", "practice.html", "log.html",
    "notes.html", "note.html", "settings.html", "privacy.html", "progressions.html"
)

fun main(args: Array<String>) {
    val jobIdArg = args.indexOf("--analyze-job").takeIf { it >= 0 && it + 1 < args.size }?.let { args[it + 1] }
        ?: System.getenv("ANALYZE_JOB_ID")?.takeIf { it.isNotBlank() }

    if (jobIdArg != null) {
        runAnalyzeJobCli(UUID.fromString(jobIdArg.trim()))
        return
    }
    val port = System.getenv("PORT")?.toIntOrNull() ?: 3000
    val host = System.getenv("HOST")?.takeIf { it.isNotBlank() } ?: "0.0.0.0"
    embeddedServer(Netty, port = port, host = host, module = Application::module).start(wait = true)
}

@OptIn(ExperimentalSerializationApi::class)
fun Application.module(
    publicDir: File = File(System.getenv("PUBLIC_DIR") ?: "public"),
    dbConfig: DatabaseConfig? = DatabaseFactory.fromEnvOrNull(),
    authConfig: SupabaseAuthConfig? = SupabaseAuthConfig.fromEnvOrNull(),
    allowedOrigins: List<String> = parseAllowedOrigins(System.getenv("ALLOWED_ORIGINS")),
    videoMetaClient: VideoMetaClient = YoutubeOEmbedClient(),
    publicAppUrl: String = parsePublicAppUrl(System.getenv("PUBLIC_APP_URL")),
    storageClient: StorageClient? = SupabaseStorageClient.fromEnvOrNull(),
    cryptoService: CryptoService? = CryptoService.fromEnvOrNull(),
    integrationCheckClient: IntegrationCheckClient = HttpIntegrationCheckClient(),
    notionClient: NotionClient = HttpNotionClient(),
    cronOidcVerifier: CronOidcVerifier? = CronOidcConfig.fromEnvOrNull()?.let { CronOidcVerifier(it) },
    geminiClient: GeminiClient = HttpGeminiClient(),
    analyzeJobDispatcher: AnalyzeJobDispatcher? = null,
    uiMode: String = System.getenv("ULP_UI").orEmpty()
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

    if (storageClient == null) {
        environment.log.warn("녹음 저장소 설정(SUPABASE_URL / SUPABASE_SECRET_KEY)이 없어 녹음 업로드가 비활성화됩니다.")
    }

    if (cryptoService == null) {
        environment.log.warn("외부 연동 암호화 키(APP_MASTER_KEY)가 없어 키 관리가 비활성화됩니다.")
    }

    if (cronOidcVerifier == null) {
        environment.log.warn("크론 OIDC 설정(CRON_AUDIENCE / CRON_SA_EMAIL)이 없어 크론 엔드포인트 인증이 비활성화됩니다.")
    }

    val profileService = ProfileService(db)
    val songService = SongService(db, videoMetaClient, publicAppUrl)
    val categoryService = CategoryService(db)
    val progressionService = ProgressionService(db)
    val practiceService = PracticeService(db)
    val storageTrashService = StorageTrashService(db, storageClient)
    val takeService = TakeService(db, storageClient)
    val sessionService = SessionService(db)
    val exportImportService = ExportImportService(db, storageClient, publicAppUrl)
    val integrationService = IntegrationService(db, cryptoService, integrationCheckClient)
    val notionPushWorker = NotionPushWorker(
        db = db,
        integrationService = integrationService,
        notionClient = notionClient,
        storageClient = storageClient,
        storageTrashService = storageTrashService,
        publicAppUrl = publicAppUrl
    )
    val notionSyncService = NotionSyncService(
        db = db,
        integrationService = integrationService,
        notionClient = notionClient,
        storageClient = storageClient
    )
    val noteService = NoteService(
        db = db,
        integrationService = integrationService,
        videoMetaClient = videoMetaClient,
        geminiClient = geminiClient,
        notionPushWorker = notionPushWorker
    )
    val cloudRunJobUri = System.getenv("CLOUD_RUN_ANALYZE_JOB_URI")?.takeIf { it.isNotBlank() }
    val effectiveDispatcher: AnalyzeJobDispatcher = analyzeJobDispatcher ?: if (cloudRunJobUri != null) {
        CloudRunJobDispatcher(cloudRunJobUri)
    } else {
        LocalAsyncJobDispatcher(runner = { jobId -> noteService.executeJob(jobId) })
    }

    // Cloud Run은 TLS를 끝내고 http로 넘긴다. X-Forwarded-Proto로 https를 알아야 CORS가 같은 출처를 알아본다.
    // 호스트·클라이언트 IP 헤더는 위조될 수 있어 믿지 않는다
    install(XForwardedHeaders) {
        hostHeaders.clear()
        forHeaders.clear()
        portHeaders.clear()
        httpsFlagHeaders.clear()
    }

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

    // CORS는 Validators 단계에서 거부할 때 403을 보내기만 하고 파이프라인을 끝내지 않는다.
    // 그대로 두면 라우트가 돌아 이미 보낸 응답에 헤더를 붙이다 ERROR가 난다(FX-1).
    // Validators는 internal이라 다음 단계 Call에 routing보다 먼저 건다
    intercept(ApplicationCallPipeline.Call) {
        if (call.response.isCommitted) finish()
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
        call.response.headers.append("X-Frame-Options", "DENY")
    }

    val canonicalPublicRoot = publicDir.canonicalFile
    // ULP_UI=legacy면 spa.html이 있어도 옛 public/*.html을 서빙한다(재빌드 없는 롤백 스위치)
    val spaEnabled = uiMode.trim().lowercase() != "legacy" && File(canonicalPublicRoot, "spa.html").isFile

    routing {
        registerChordRoutes()

        route("/api/v1") {
            registerMeRoutes(jwtVerifier, profileService)
            registerSongRoutes(jwtVerifier, profileService, songService, storageTrashService)
            registerCategoryRoutes(jwtVerifier, profileService, categoryService)
            registerProgressionRoutes(jwtVerifier, profileService, progressionService, noteService, effectiveDispatcher)
            registerPracticeRoutes(jwtVerifier, profileService, practiceService)
            registerTakeRoutes(jwtVerifier, profileService, takeService, storageTrashService)
            registerSessionRoutes(jwtVerifier, profileService, sessionService)
            registerExportImportRoutes(jwtVerifier, profileService, exportImportService)
            registerIntegrationRoutes(jwtVerifier, profileService, integrationService)
            registerNotionSyncRoutes(jwtVerifier, profileService, notionPushWorker, notionSyncService)
            registerNoteRoutes(jwtVerifier, profileService, noteService, effectiveDispatcher)

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

        registerInternalCronRoutes(cronOidcVerifier, notionPushWorker)

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

                val servedPath = if (spaEnabled && relPath in SPA_ENTRY_PAGES) "spa.html" else relPath
                val targetFile = File(canonicalPublicRoot, servedPath).canonicalFile
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
                if (ext == "html") {
                    call.response.headers.append("Content-Security-Policy", "frame-ancestors 'none'")
                }

                if (method == HttpMethod.Head) {
                    // Content-Length를 헤더로 직접 붙이면 엔진이 0을 한 번 더 붙여 중복된다(Cloud Run 프런트엔드가 502로 거부)
                    val length = targetFile.length()
                    call.respond(object : OutgoingContent.NoContent() {
                        override val status = HttpStatusCode.OK
                        override val contentType = contentType
                        override val contentLength = length
                    })
                } else {
                    call.respondBytes(targetFile.readBytes(), contentType, HttpStatusCode.OK)
                }
            }
        }
    }
}
