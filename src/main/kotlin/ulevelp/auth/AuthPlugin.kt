package ulevelp.auth

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.request.*
import io.ktor.util.*
import ulevelp.api.UnauthorizedException
import ulevelp.service.ProfileService

val AuthenticatedUserKey = AttributeKey<AuthenticatedUser>("AuthenticatedUser")

class SupabaseAuthPluginConfig {
    var jwtVerifier: SupabaseJwtVerifier? = null
    var profileService: ProfileService? = null
}

/**
 * `/api/v1` 라우트 스코프에 장착되는 Supabase Access Token 검증 및 첫 요청 프로필 자동 생성 플러그인.
 */
val SupabaseAuthPlugin = createRouteScopedPlugin(
    name = "SupabaseAuthPlugin",
    createConfiguration = ::SupabaseAuthPluginConfig
) {
    val verifier = pluginConfig.jwtVerifier
    val profileService = pluginConfig.profileService

    onCall { call ->
        if (call.request.httpMethod == HttpMethod.Options) {
            return@onCall
        }

        val activeVerifier = verifier
            ?: throw UnauthorizedException("서버 인증 설정(SUPABASE_URL)이 구성되어 있지 않습니다.")

        val authHeader = call.request.headers[HttpHeaders.Authorization]
        val user = activeVerifier.verifyBearerHeader(authHeader)

        profileService?.ensureUserAndProfile(user)
        call.attributes.put(AuthenticatedUserKey, user)
    }
}

fun ApplicationCall.requireAuthUser(): AuthenticatedUser =
    attributes.getOrNull(AuthenticatedUserKey)
        ?: throw UnauthorizedException("인증된 사용자 컨텍스트가 없습니다.")

