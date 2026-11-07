package ulevelp.routes

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import ulevelp.api.InvalidInputException
import ulevelp.api.receiveJsonObject
import ulevelp.auth.SupabaseAuthPlugin
import ulevelp.auth.SupabaseJwtVerifier
import ulevelp.auth.requireAuthUser
import ulevelp.service.ProfileService

fun Route.registerMeRoutes(
    jwtVerifier: SupabaseJwtVerifier?,
    profileService: ProfileService
) {
    route("/me") {
        install(SupabaseAuthPlugin) {
            this.jwtVerifier = jwtVerifier
            this.profileService = profileService
        }

        get {
            val user = call.requireAuthUser()
            val me = profileService.getMe(user.id)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, me)
        }

        patch {
            val user = call.requireAuthUser()
            val body = call.receiveJsonObject()
            val updated = profileService.patchMe(user.id, body)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, updated)
        }

        delete {
            val user = call.requireAuthUser()
            val body = call.receiveJsonObject()
            val confirmElem = body["confirmText"]
            val confirmText = (confirmElem as? JsonPrimitive)?.takeIf { it.isString }?.content
                ?: throw InvalidInputException("confirmText 문자열이 필요합니다.")

            profileService.deleteMe(user.id, confirmText)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(
                HttpStatusCode.OK,
                buildJsonObject { put("ok", true) }
            )
        }
    }
}
