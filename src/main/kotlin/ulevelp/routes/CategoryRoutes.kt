package ulevelp.routes

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import ulevelp.api.*
import ulevelp.auth.SupabaseAuthPlugin
import ulevelp.auth.SupabaseJwtVerifier
import ulevelp.auth.requireAuthUser
import ulevelp.service.*
import java.util.UUID

fun Route.registerCategoryRoutes(
    jwtVerifier: SupabaseJwtVerifier?,
    profileService: ProfileService,
    categoryService: CategoryService
) {
    route("/categories") {
        install(SupabaseAuthPlugin) {
            this.jwtVerifier = jwtVerifier
            this.profileService = profileService
        }

        fun requireName(raw: String?): String {
            if (raw.isNullOrEmpty()) {
                throw InvalidInputException("name은 비워 둘 수 없습니다.")
            }
            return raw
        }

        get {
            val user = call.requireAuthUser()
            val list = categoryService.list(user.id)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, CategoryListResponse(categories = list))
        }

        post {
            val user = call.requireAuthUser()
            val body = call.receiveJsonObject()
            val name = requireName(body.requireString("name", CategoryService.MAX_NAME_LENGTH))

            val created = categoryService.create(user.id, name)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.Created, CategoryEnvelope(category = created))
        }

        put("/order") {
            val user = call.requireAuthUser()
            val body = call.receiveJsonObject()
            val arr = body.requireArray("ids", CategoryService.MAX_CATEGORIES)
            val ids = arr.map { elem ->
                if (elem !is JsonPrimitive || !elem.isString) {
                    throw InvalidInputException("ids 형식이 올바르지 않습니다.")
                }
                runCatching { UUID.fromString(elem.content) }.getOrNull()
                    ?.takeIf { it.toString() == elem.content.lowercase() }
                    ?: throw InvalidInputException("ids 형식이 올바르지 않습니다.")
            }

            val list = categoryService.reorder(user.id, ids)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, CategoryListResponse(categories = list))
        }

        patch("/{categoryId}") {
            val user = call.requireAuthUser()
            val categoryId = parsePathUuid(call.parameters["categoryId"])
            val body = call.receiveJsonObject()

            val hasName = body.containsKey("name") && body["name"] !is JsonNull
            val hasOnHome = body.containsKey("onHome") && body["onHome"] !is JsonNull
            if (!hasName && !hasOnHome) {
                throw InvalidInputException("수정할 값(name, onHome)이 없습니다.")
            }

            val name = if (hasName) requireName(body.optString("name", CategoryService.MAX_NAME_LENGTH)) else null
            val onHome = if (hasOnHome) body.optBoolean("onHome", true) else null

            val updated = categoryService.update(user.id, categoryId, name, onHome)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, CategoryEnvelope(category = updated))
        }

        delete("/{categoryId}") {
            val user = call.requireAuthUser()
            val categoryId = parsePathUuid(call.parameters["categoryId"])

            categoryService.delete(user.id, categoryId)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(
                HttpStatusCode.OK,
                buildJsonObject { put("ok", true) }
            )
        }
    }
}
