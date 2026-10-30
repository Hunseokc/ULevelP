package ulevelp.routes

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import ulevelp.api.InvalidInputException
import ulevelp.auth.requireAuthUser
import ulevelp.service.ProfileService

private suspend fun ApplicationCall.parseJsonObjectBody(): JsonObject {
    val raw = receiveText()
    if (raw.isBlank()) {
        throw InvalidInputException("요청 본문(JSON)이 비어 있습니다.")
    }
    val element = try {
        Json.parseToJsonElement(raw)
    } catch (_: Exception) {
        throw InvalidInputException("올바른 JSON 형식이 아닙니다.")
    }
    return element as? JsonObject
        ?: throw InvalidInputException("요청 본문은 JSON 객체여야 합니다.")
}

fun Route.registerMeRoutes(profileService: ProfileService) {
    route("/me") {
        get {
            val user = call.requireAuthUser()
            val me = profileService.getMe(user.id)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, me)
        }

        patch {
            val user = call.requireAuthUser()
            val body = call.parseJsonObjectBody()
            val updated = profileService.patchMe(user.id, body)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, updated)
        }

        delete {
            val user = call.requireAuthUser()
            val body = call.parseJsonObjectBody()
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

