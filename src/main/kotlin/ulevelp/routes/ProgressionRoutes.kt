package ulevelp.routes

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import ulevelp.api.*
import ulevelp.auth.SupabaseAuthPlugin
import ulevelp.auth.SupabaseJwtVerifier
import ulevelp.auth.requireAuthUser
import ulevelp.note.AnalyzeJobDispatcher
import ulevelp.note.GeminiSchemas
import ulevelp.service.*

/** 코드 진행 모음 CRUD (`개발산출물/결과/CH-1b_설계.md` §3-2·§3-3) + 코드 진행 영상 분석 `/analyze`(§3-5, CH-4) */
fun Route.registerProgressionRoutes(
    jwtVerifier: SupabaseJwtVerifier?,
    profileService: ProfileService,
    progressionService: ProgressionService,
    noteService: NoteService,
    analyzeJobDispatcher: AnalyzeJobDispatcher
) {
    route("/progressions") {
        install(SupabaseAuthPlugin) {
            this.jwtVerifier = jwtVerifier
            this.profileService = profileService
        }

        get {
            val user = call.requireAuthUser()
            val scope = call.request.queryParameters["scope"] ?: ProgressionService.SCOPE_ALL
            if (scope !in ProgressionService.SCOPES) {
                throw InvalidInputException("scope는 reference·analysis·all 중 하나여야 합니다.")
            }
            val list = progressionService.list(user.id, scope)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, ProgressionListResponse(progressions = list))
        }

        post {
            val user = call.requireAuthUser()
            val input = ProgressionService.parseInput(call.receiveJsonObject(), forCreate = true)
            val created = progressionService.create(user.id, input)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.Created, ProgressionEnvelope(progression = created))
        }

        // 노트 분석과 같은 검증·제한(동시 1건·하루 20건 합산) + 24시간 중복 409(GA-4, force로 건너뜀). 상태 조회는 /notes/jobs/{id}
        post("/analyze") {
            val user = call.requireAuthUser()
            val body = call.receiveJsonObject()
            val url = body.requireString("url", 500)
            val memo = body.optString("memo", 2000) ?: ""
            val options = parseAnalyzeOptions(body)
            val force = body.optBoolean("force", false) // GA-4: 같은 분석을 일부러 다시 할 때
            val response = noteService.requestAnalyze(
                userId = user.id,
                rawUrl = url,
                rawTags = GeminiSchemas.PROGRESSION_TAGS,
                memo = memo,
                dispatcher = analyzeJobDispatcher,
                kind = NoteService.JOB_KIND_PROGRESSION,
                options = options,
                force = force
            )
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.Accepted, response)
        }

        patch("/{progressionId}") {
            val user = call.requireAuthUser()
            val progressionId = parsePathUuid(call.parameters["progressionId"])
            val input = ProgressionService.parseInput(call.receiveJsonObject(), forCreate = false)
            val updated = progressionService.update(user.id, progressionId, input)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, ProgressionEnvelope(progression = updated))
        }

        delete("/{progressionId}") {
            val user = call.requireAuthUser()
            val progressionId = parsePathUuid(call.parameters["progressionId"])
            progressionService.delete(user.id, progressionId)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, buildJsonObject { put("ok", true) })
        }
    }
}

/** 분석 구간·속도 선택 필드(GA-2, `진행_분석설정.md` §3-2). 잘못되면 400 INVALID_INPUT */
internal fun parseAnalyzeOptions(body: JsonObject): AnalysisJobOptions {
    val startSec = optSec(body, "startSec")
    val endSec = optSec(body, "endSec")
    if (endSec != null && endSec <= (startSec ?: 0)) {
        throw InvalidInputException("endSec는 startSec보다 1초 이상 커야 합니다.")
    }
    val pace = body.optString("pace", 20) ?: NoteService.PACE_NORMAL
    if (pace !in NoteService.PACE_FPS) {
        throw InvalidInputException("pace는 slow·normal·fast 중 하나여야 합니다.")
    }
    return AnalysisJobOptions(startSec = startSec, endSec = endSec, pace = pace)
}

private fun optSec(body: JsonObject, name: String): Int? {
    val element = body[name]
    if (element == null || element is JsonNull) return null
    return body.requireInt(name, 0, 86400)
}
