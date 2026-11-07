package ulevelp.routes

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import ulevelp.api.UnauthorizedException
import ulevelp.auth.CronOidcVerifier
import ulevelp.auth.SupabaseAuthPlugin
import ulevelp.auth.SupabaseJwtVerifier
import ulevelp.auth.requireAuthUser
import ulevelp.notion.NotionPushWorker
import ulevelp.notion.NotionSyncService
import ulevelp.service.ProfileService

fun Route.registerNotionSyncRoutes(
    jwtVerifier: SupabaseJwtVerifier?,
    profileService: ProfileService,
    notionPushWorker: NotionPushWorker,
    notionSyncService: NotionSyncService
) {
    route("/notion/sync") {
        install(SupabaseAuthPlugin) {
            this.jwtVerifier = jwtVerifier
            this.profileService = profileService
        }

        get("/status") {
            val user = call.requireAuthUser()
            val res = notionSyncService.getStatus(user.id)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, res)
        }

        post("/enable") {
            val user = call.requireAuthUser()
            val res = notionSyncService.enable(user.id)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, res)
        }

        post("/disable") {
            val user = call.requireAuthUser()
            notionSyncService.disable(user.id)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, buildJsonObject { put("ok", true) })
        }

        post("/pull") {
            val user = call.requireAuthUser()
            val res = notionSyncService.pull(user.id)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, res)
        }

        post("/push") {
            val user = call.requireAuthUser()
            val res = notionPushWorker.pushUserOutbox(user.id)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, res)
        }
    }
}

fun Route.registerInternalCronRoutes(
    cronOidcVerifier: CronOidcVerifier?,
    notionPushWorker: NotionPushWorker
) {
    post("/internal/cron/notion-push") {
        if (cronOidcVerifier == null) {
            throw UnauthorizedException("유효한 크론 OIDC 토큰이 아닙니다.")
        }
        val authHeader = call.request.header(HttpHeaders.Authorization)
        cronOidcVerifier.verifyBearerHeader(authHeader)
        val res = notionPushWorker.runCronBatch()
        call.response.headers.append(HttpHeaders.CacheControl, "no-store")
        call.respond(HttpStatusCode.OK, res)
    }
}
