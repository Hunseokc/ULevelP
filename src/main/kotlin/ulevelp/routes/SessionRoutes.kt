package ulevelp.routes

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import ulevelp.api.*
import ulevelp.auth.SupabaseAuthPlugin
import ulevelp.auth.SupabaseJwtVerifier
import ulevelp.auth.requireAuthUser
import ulevelp.service.ProfileService
import ulevelp.service.SessionService
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit

private val DATE_REGEX = Regex("^\\d{4}-\\d{2}-\\d{2}$")
private val MIN_DATE = LocalDate.of(2000, 1, 1)

private fun parseQueryDate(name: String, raw: String?): LocalDate? {
    if (raw.isNullOrBlank()) return null
    if (!DATE_REGEX.matches(raw)) {
        throw InvalidInputException("$name 형식이 올바르지 않습니다.")
    }
    val date = try {
        LocalDate.parse(raw)
    } catch (_: Exception) {
        throw InvalidInputException("$name 형식이 올바르지 않습니다.")
    }
    val maxDate = LocalDate.now(ZoneOffset.UTC).plusDays(1)
    if (date.isBefore(MIN_DATE) || date.isAfter(maxDate)) {
        throw InvalidInputException("${name}은(는) 2000-01-01부터 내일(UTC)까지만 쓸 수 있습니다.")
    }
    return date
}

fun Route.registerSessionRoutes(
    jwtVerifier: SupabaseJwtVerifier?,
    profileService: ProfileService,
    sessionService: SessionService
) {
    route("/sessions") {
        install(SupabaseAuthPlugin) {
            this.jwtVerifier = jwtVerifier
            this.profileService = profileService
        }

        get {
            val user = call.requireAuthUser()
            val today = parseQueryDate("today", call.request.queryParameters["today"])
                ?: LocalDate.now(ZoneOffset.UTC)
            val to = parseQueryDate("to", call.request.queryParameters["to"])
                ?: today
            val from = parseQueryDate("from", call.request.queryParameters["from"])
                ?: to.minusDays(SessionService.DEFAULT_CALENDAR_DAYS - 1)

            if (from > to) {
                throw InvalidInputException("from은 to보다 늦을 수 없습니다.")
            }
            if (ChronoUnit.DAYS.between(from, to) > SessionService.MAX_RANGE_DAYS) {
                throw InvalidInputException("조회 기간은 최대 366일까지 가능합니다.")
            }

            val response = sessionService.list(user.id, from, to, today)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, response)
        }

        patch("/{sessionId}") {
            val user = call.requireAuthUser()
            val sessionId = parsePathUuid(call.parameters["sessionId"])
            val body = call.receiveJsonObject()
            val memo = body.requireString("memo", 2000)

            sessionService.updateMemo(user.id, sessionId, memo)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, buildJsonObject { put("ok", true) })
        }
    }
}
