package ulevelp.api

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.response.*
import kotlinx.serialization.Serializable

/**
 * 표준 에러 응답 DTO (`docs/03-api-spec.md` 1.2절, `NFR-SEC-10`).
 */
@Serializable
data class ApiErrorResponse(
    val ok: Boolean = false,
    val source: String = "server",
    val status: Int,
    val code: String,
    val message: String,
    val retryAfter: Int? = null
)

open class ApiException(
    val status: HttpStatusCode,
    val code: String,
    override val message: String,
    val source: String = "server",
    val retryAfter: Int? = null
) : RuntimeException(message)

class UnauthorizedException(
    message: String = "유효한 인증 토큰이 필요합니다.",
    code: String = "UNAUTHORIZED"
) : ApiException(HttpStatusCode.Unauthorized, code, message)

class InvalidInputException(
    message: String,
    code: String = "INVALID_INPUT"
) : ApiException(HttpStatusCode.BadRequest, code, message)

class NotFoundException(
    message: String = "요청한 리소스를 찾을 수 없습니다.",
    code: String = "NOT_FOUND"
) : ApiException(HttpStatusCode.NotFound, code, message)

class ConflictException(
    message: String,
    code: String = "CONFLICT"
) : ApiException(HttpStatusCode.Conflict, code, message)

suspend fun ApplicationCall.respondApiError(
    status: HttpStatusCode,
    code: String,
    message: String,
    source: String = "server",
    retryAfter: Int? = null
) {
    response.headers.append(HttpHeaders.CacheControl, "no-store")
    respond(
        status,
        ApiErrorResponse(
            ok = false,
            source = source,
            status = status.value,
            code = code,
            message = message,
            retryAfter = retryAfter
        )
    )
}

