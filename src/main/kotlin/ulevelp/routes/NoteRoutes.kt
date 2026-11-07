package ulevelp.routes

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.json.*
import ulevelp.api.*
import ulevelp.auth.SupabaseAuthPlugin
import ulevelp.auth.SupabaseJwtVerifier
import ulevelp.auth.requireAuthUser
import ulevelp.note.AnalyzeJobDispatcher
import ulevelp.note.GeminiSchemas
import ulevelp.service.*

fun Route.registerNoteRoutes(
    jwtVerifier: SupabaseJwtVerifier?,
    profileService: ProfileService,
    noteService: NoteService,
    analyzeJobDispatcher: AnalyzeJobDispatcher
) {
    route("/notes") {
        install(SupabaseAuthPlugin) {
            this.jwtVerifier = jwtVerifier
            this.profileService = profileService
        }

        post("/analyze") {
            val user = call.requireAuthUser()
            val body = call.receiveJsonObject()

            val url = body.requireString("url", 500)
            val tagsElem = body.requireArray("tags", 6)
            val rawTags = tagsElem.map {
                if (it is JsonPrimitive && it.isString) {
                    it.content
                } else {
                    throw InvalidInputException("유효한 분석 태그를 1개 이상 선택해 주세요.")
                }
            }
            val memo = body.optString("memo", 2000) ?: ""

            val response = noteService.requestAnalyze(
                userId = user.id,
                rawUrl = url,
                rawTags = rawTags,
                memo = memo,
                dispatcher = analyzeJobDispatcher
            )
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.Accepted, response)
        }

        get("/jobs") {
            val user = call.requireAuthUser()
            val response = noteService.listJobs(user.id)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, response)
        }

        get("/jobs/{jobId}") {
            val user = call.requireAuthUser()
            val jobId = parsePathUuid(call.parameters["jobId"])
            val response = noteService.getJob(user.id, jobId)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, response)
        }

        get {
            val user = call.requireAuthUser()
            val tag = call.request.queryParameters["tag"]
            val response = noteService.listNotes(user.id, tag)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, response)
        }

        get("/{noteId}") {
            val user = call.requireAuthUser()
            val noteId = parsePathUuid(call.parameters["noteId"])
            val response = noteService.getNote(user.id, noteId)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, NoteDetailResponse(response))
        }

        patch("/{noteId}") {
            val user = call.requireAuthUser()
            val noteId = parsePathUuid(call.parameters["noteId"])
            val body = call.receiveJsonObject()

            val hasTitle = body.containsKey("title")
            val hasMemo = body.containsKey("memo")
            val hasTags = body.containsKey("tags")

            if (!hasTitle && !hasMemo && !hasTags) {
                throw InvalidInputException("수정할 항목(title, memo, tags 중 하나 이상)이 필요합니다.")
            }

            var newTitle: String? = null
            if (hasTitle) {
                val elem = body["title"]
                if (elem !is JsonPrimitive || !elem.isString) {
                    throw InvalidInputException("title은 빈 문자열일 수 없습니다.")
                }
                val trimmed = elem.content.trim()
                if (trimmed.isEmpty()) {
                    throw InvalidInputException("title은 빈 문자열일 수 없습니다.")
                }
                if (trimmed.length > 300) {
                    throw InvalidInputException("title은(는) 300자 이하여야 합니다.")
                }
                newTitle = trimmed
            }

            var newMemo: String? = null
            if (hasMemo) {
                val elem = body["memo"]
                if (elem !is JsonPrimitive || !elem.isString) {
                    throw InvalidInputException("memo 형식이 올바르지 않습니다.")
                }
                val trimmed = elem.content.trim()
                if (trimmed.length > 2000) {
                    throw InvalidInputException("memo은(는) 2000자 이하여야 합니다.")
                }
                newMemo = trimmed
            }

            var newTags: List<String>? = null
            if (hasTags) {
                val elem = body["tags"]
                if (elem !is JsonArray || elem.size !in 1..7) {
                    throw InvalidInputException("tags는 1개 이상 7개 이하여야 합니다.")
                }
                val parsedList = mutableListOf<String>()
                for (item in elem) {
                    if (item !is JsonPrimitive || !item.isString) {
                        throw InvalidInputException("유효하지 않은 태그가 포함되어 있습니다.")
                    }
                    val trimmed = item.content.trim()
                    if (trimmed !in GeminiSchemas.ALLOWED_NOTE_TAGS) {
                        throw InvalidInputException("유효하지 않은 태그가 포함되어 있습니다.")
                    }
                    parsedList.add(trimmed)
                }
                newTags = parsedList.distinct()
            }

            val updated = noteService.updateNote(
                userId = user.id,
                noteId = noteId,
                newMemo = newMemo,
                newTags = newTags,
                newTitle = newTitle
            )
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, NoteDetailResponse(updated))
        }

        put("/{noteId}/collect") {
            val user = call.requireAuthUser()
            val noteId = parsePathUuid(call.parameters["noteId"])
            val body = call.receiveJsonObject()
            val elem = body["collect"]
            if (elem !is JsonPrimitive || elem.isString || elem.booleanOrNull == null) {
                throw InvalidInputException("collect는 true 또는 false여야 합니다.")
            }
            val response = noteService.setCollect(user.id, noteId, elem.boolean)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, response)
        }

        delete("/{noteId}") {
            val user = call.requireAuthUser()
            val noteId = parsePathUuid(call.parameters["noteId"])
            noteService.deleteNote(user.id, noteId)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, buildJsonObject { put("ok", true) })
        }
    }
}

