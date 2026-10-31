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
import java.math.BigDecimal
import java.math.RoundingMode

fun Route.registerSongRoutes(
    jwtVerifier: SupabaseJwtVerifier?,
    profileService: ProfileService,
    songService: SongService,
    storageTrashService: StorageTrashService
) {
    route("/songs") {
        install(SupabaseAuthPlugin) {
            this.jwtVerifier = jwtVerifier
            this.profileService = profileService
        }

        get {
            val user = call.requireAuthUser()
            val rawStatus = call.request.queryParameters["status"]
            val statusCode = if (!rawStatus.isNullOrEmpty()) {
                SongService.normalizeStatus(rawStatus)
                    ?: throw InvalidInputException("status 값이 올바르지 않습니다.")
            } else null

            val list = songService.list(user.id, statusCode)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, SongListResponse(songs = list))
        }

        post {
            val user = call.requireAuthUser()
            val body = call.receiveJsonObject()

            val rawVideoId = body["videoId"] ?: throw InvalidInputException("videoId 값이 필요합니다.")
            if (rawVideoId is JsonNull) {
                throw InvalidInputException("videoId 값이 필요합니다.")
            }
            if (rawVideoId !is JsonPrimitive || !rawVideoId.isString || !SongService.VIDEO_ID_REGEX.matches(rawVideoId.content)) {
                throw InvalidInputException("videoId 형식이 올바르지 않습니다.")
            }
            val videoId = rawVideoId.content

            val title = body.optString("title", 300) ?: ""
            val artist = body.optString("artist", 200) ?: ""
            val rateDbl = body.optDouble("rate", 0.25, 2.0) ?: 1.00
            val rate = BigDecimal.valueOf(rateDbl).setScale(2, RoundingMode.HALF_UP)

            val result = songService.create(user.id, CreateSongInput(videoId, title, artist, rate))
            val status = if (result.created) HttpStatusCode.Created else HttpStatusCode.OK

            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(status, SongEnvelope(song = result.song))
        }

        get("/by-video/{videoId}") {
            val user = call.requireAuthUser()
            val videoId = call.parameters["videoId"]
            if (videoId == null || !SongService.VIDEO_ID_REGEX.matches(videoId)) {
                throw InvalidInputException("videoId 형식이 올바르지 않습니다.")
            }

            val song = songService.findByVideo(user.id, videoId)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, SongEnvelope(song = song))
        }

        post("/migrate-local") {
            val user = call.requireAuthUser()
            val body = call.receiveJsonObject()

            val itemsArray = body.requireArray("items", 100)
            val markMigrated = body.optBoolean("markMigrated", false)

            val items = mutableListOf<LocalSongItem>()
            var invalidCount = 0
            for (element in itemsArray) {
                val parsed = SongService.parseLocalItem(element)
                if (parsed != null) {
                    items.add(parsed)
                } else {
                    invalidCount++
                }
            }

            val response = songService.migrateLocal(user.id, items, invalidCount, markMigrated)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, response)
        }

        get("/{songId}") {
            val user = call.requireAuthUser()
            val songId = parsePathUuid(call.parameters["songId"])
            val detail = songService.getDetail(user.id, songId)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, detail)
        }

        patch("/{songId}") {
            val user = call.requireAuthUser()
            val songId = parsePathUuid(call.parameters["songId"])
            val body = call.receiveJsonObject()

            val hasStatus = body.containsKey("status") && body["status"] !is JsonNull
            val hasMemo = body.containsKey("memo") && body["memo"] !is JsonNull
            val hasTitle = body.containsKey("title") && body["title"] !is JsonNull

            if (!hasStatus && !hasMemo && !hasTitle) {
                throw InvalidInputException("수정할 값(status, memo, title)이 없습니다.")
            }

            val statusCode = if (hasStatus) {
                val elem = body["status"]
                if (elem !is JsonPrimitive || !elem.isString) {
                    throw InvalidInputException("status 값이 올바르지 않습니다.")
                }
                SongService.normalizeStatus(elem.content)
                    ?: throw InvalidInputException("status 값이 올바르지 않습니다.")
            } else null

            val memo = if (hasMemo) {
                body.optString("memo", 2000)
            } else null

            val title = if (hasTitle) {
                val t = body.optString("title", 300)
                if (t.isNullOrBlank()) {
                    throw InvalidInputException("title은 비워 둘 수 없습니다.")
                }
                t
            } else null

            val updated = songService.update(user.id, songId, UpdateSongInput(statusCode, memo, title))
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, SongEnvelope(song = updated))
        }

        delete("/{songId}") {
            val user = call.requireAuthUser()
            val songId = parsePathUuid(call.parameters["songId"])

            val ids = songService.delete(user.id, songId)
            storageTrashService.purge(ids)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(
                HttpStatusCode.OK,
                buildJsonObject { put("ok", true) }
            )
        }
    }
}
