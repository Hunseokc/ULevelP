package ulevelp.routes

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import ulevelp.api.*
import ulevelp.auth.SupabaseAuthPlugin
import ulevelp.auth.SupabaseJwtVerifier
import ulevelp.auth.requireAuthUser
import ulevelp.service.PracticeService
import ulevelp.service.SaveProgressInput
import ulevelp.service.ProfileService
import java.math.BigDecimal
import java.math.RoundingMode

fun Route.registerPracticeRoutes(
    jwtVerifier: SupabaseJwtVerifier?,
    profileService: ProfileService,
    practiceService: PracticeService
) {
    route("/practice") {
        install(SupabaseAuthPlugin) {
            this.jwtVerifier = jwtVerifier
            this.profileService = profileService
        }

        post("/save") {
            val user = call.requireAuthUser()
            val body = call.receiveJsonObject()

            val songId = body.requireUuid("songId")
            val posDbl = body.requireDouble("pos", 0.0, 86400.0)
            val pos = BigDecimal.valueOf(posDbl).setScale(1, RoundingMode.HALF_UP)

            val aDbl = body.optDouble("a", 0.0, 86400.0)
            val a = aDbl?.let { BigDecimal.valueOf(it).setScale(1, RoundingMode.HALF_UP) }

            val bDbl = body.optDouble("b", 0.0, 86400.0)
            val b = bDbl?.let { BigDecimal.valueOf(it).setScale(1, RoundingMode.HALF_UP) }

            if (a != null && b != null && a >= b) {
                throw InvalidInputException("a는 b보다 작아야 합니다.")
            }

            val rateDbl = body.optDouble("rate", 0.25, 2.0)
            val rate = rateDbl?.let { BigDecimal.valueOf(it).setScale(2, RoundingMode.HALF_UP) }

            val date = body.requireDate("date")
            val addSeconds = body.optInt("addSeconds", 0, 21600, 0)
            val addLoops = body.optInt("addLoops", 0, 100000, 0)

            val response = practiceService.saveProgress(
                userId = user.id,
                input = SaveProgressInput(
                    songId = songId,
                    pos = pos,
                    a = a,
                    b = b,
                    rate = rate,
                    date = date,
                    addSeconds = addSeconds,
                    addLoops = addLoops
                )
            )

            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, response)
        }
    }
}

