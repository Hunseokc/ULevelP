package ulevelp.routes

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import ulevelp.api.NotFoundException
import ulevelp.api.optBoolean
import ulevelp.api.optString
import ulevelp.api.receiveJsonObject
import ulevelp.auth.SupabaseAuthPlugin
import ulevelp.auth.SupabaseJwtVerifier
import ulevelp.auth.requireAuthUser
import ulevelp.service.IntegrationListResponse
import ulevelp.service.IntegrationService
import ulevelp.service.ProfileService
import ulevelp.service.SaveGeminiKeyInput
import ulevelp.service.SaveNotionKeyInput

fun Route.registerIntegrationRoutes(
    jwtVerifier: SupabaseJwtVerifier?,
    profileService: ProfileService,
    integrationService: IntegrationService
) {
    route("/integrations") {
        install(SupabaseAuthPlugin) {
            this.jwtVerifier = jwtVerifier
            this.profileService = profileService
        }

        get {
            val user = call.requireAuthUser()
            val appId = call.request.queryParameters["appId"] ?: "ulevelp"
            val list = integrationService.list(user.id, appId)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, IntegrationListResponse(integrations = list))
        }

        put("/notion") {
            val user = call.requireAuthUser()
            val body = call.receiveJsonObject()
            val appId = body.optString("appId", 64) ?: "ulevelp"
            val token = body.optString("token", 256)
            val songsDb = (body["songsDb"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: ""
            val sessionsDb = (body["sessionsDb"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: ""
            val notesDb = (body["notesDb"] as? JsonPrimitive)?.takeIf { it.isString }?.content

            val dto = integrationService.saveNotion(
                userId = user.id,
                input = SaveNotionKeyInput(
                    appId = appId,
                    token = token,
                    songsDb = songsDb,
                    sessionsDb = sessionsDb,
                    notesDb = notesDb
                )
            )
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, dto)
        }

        put("/gemini") {
            val user = call.requireAuthUser()
            val body = call.receiveJsonObject()
            val appId = body.optString("appId", 64) ?: "ulevelp"
            val apiKey = body.optString("apiKey", 256)
            val model = body.optString("model", 64) ?: IntegrationService.DEFAULT_GEMINI_MODEL
            val verify = body.optBoolean("verify", true)

            val dto = integrationService.saveGemini(
                userId = user.id,
                input = SaveGeminiKeyInput(
                    appId = appId,
                    apiKey = apiKey,
                    model = model,
                    verify = verify
                )
            )
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, dto)
        }

        post("/{provider}/check") {
            val user = call.requireAuthUser()
            val provider = call.parameters["provider"]
            val appId = call.request.queryParameters["appId"] ?: "ulevelp"

            if (provider == null || provider !in IntegrationService.VALID_PROVIDERS) {
                throw NotFoundException("지원하지 않는 연동 공급자입니다.")
            }

            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            if (provider == "notion") {
                val res = integrationService.checkNotion(user.id, appId)
                call.respond(HttpStatusCode.OK, res)
            } else {
                val res = integrationService.checkGemini(user.id, appId)
                call.respond(HttpStatusCode.OK, res)
            }
        }

        delete("/{provider}") {
            val user = call.requireAuthUser()
            val provider = call.parameters["provider"]
            val appId = call.request.queryParameters["appId"] ?: "ulevelp"

            if (provider == null || provider !in IntegrationService.VALID_PROVIDERS) {
                throw NotFoundException("지원하지 않는 연동 공급자입니다.")
            }

            integrationService.delete(user.id, appId, provider)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, buildJsonObject { put("ok", true) })
        }
    }
}
