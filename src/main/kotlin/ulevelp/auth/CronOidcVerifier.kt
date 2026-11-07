package ulevelp.auth

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import ulevelp.api.UnauthorizedException
import java.net.URI
import java.security.PublicKey
import java.security.Signature
import java.security.interfaces.RSAPublicKey
import java.time.Clock
import java.util.Base64

data class CronOidcConfig(
    val audience: String,
    val serviceAccountEmail: String,
    val jwksProvider: JwksProvider = HttpJwksProvider(URI("https://www.googleapis.com/oauth2/v3/certs")),
    val clock: Clock = Clock.systemUTC()
) {
    companion object {
        fun fromEnvOrNull(env: Map<String, String> = System.getenv()): CronOidcConfig? {
            val aud = env["CRON_AUDIENCE"]?.trim()?.takeIf { it.isNotEmpty() } ?: return null
            val email = env["CRON_SA_EMAIL"]?.trim()?.takeIf { it.isNotEmpty() } ?: return null
            return CronOidcConfig(audience = aud, serviceAccountEmail = email)
        }
    }
}

class CronOidcVerifier(private val config: CronOidcConfig) {

    private val urlDecoder = Base64.getUrlDecoder()

    /**
     * Authorization: Bearer <id_token> 검증:
     * 1. alg == "RS256", kid로 jwksProvider에서 공개키 조회 후 SHA256withRSA 서명 검증
     * 2. iss in setOf("https://accounts.google.com", "accounts.google.com")
     * 3. aud == config.audience
     * 4. email == config.serviceAccountEmail && email_verified == true
     * 5. exp > clock.instant().epochSecond
     * 하나라도 틀리면 UnauthorizedException("유효한 크론 OIDC 토큰이 아닙니다.") 발생
     */
    suspend fun verifyBearerHeader(authHeader: String?) {
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            throw UnauthorizedException("유효한 크론 OIDC 토큰이 아닙니다.")
        }

        val token = authHeader.substring("Bearer ".length).trim()
        if (token.isEmpty()) {
            throw UnauthorizedException("유효한 크론 OIDC 토큰이 아닙니다.")
        }

        val parts = token.split('.')
        if (parts.size != 3) {
            throw UnauthorizedException("유효한 크론 OIDC 토큰이 아닙니다.")
        }

        val headerJson = try {
            val decoded = String(urlDecoder.decode(parts[0]), Charsets.UTF_8)
            Json.parseToJsonElement(decoded).jsonObject
        } catch (_: Exception) {
            throw UnauthorizedException("유효한 크론 OIDC 토큰이 아닙니다.")
        }

        val alg = headerJson["alg"]?.jsonPrimitive?.contentOrNull
        if (alg != "RS256") {
            throw UnauthorizedException("유효한 크론 OIDC 토큰이 아닙니다.")
        }

        val kid = headerJson["kid"]?.jsonPrimitive?.contentOrNull
            ?: throw UnauthorizedException("유효한 크론 OIDC 토큰이 아닙니다.")

        val jwkKey = config.jwksProvider.resolveKey(kid)
            ?: throw UnauthorizedException("유효한 크론 OIDC 토큰이 아닙니다.")

        val signingInput = "${parts[0]}.${parts[1]}".toByteArray(Charsets.US_ASCII)
        val signatureBytes = try {
            urlDecoder.decode(parts[2])
        } catch (_: Exception) {
            throw UnauthorizedException("유효한 크론 OIDC 토큰이 아닙니다.")
        }

        if (!verifyRsaSignature(jwkKey.publicKey, signingInput, signatureBytes)) {
            throw UnauthorizedException("유효한 크론 OIDC 토큰이 아닙니다.")
        }

        val payloadJson = try {
            val decoded = String(urlDecoder.decode(parts[1]), Charsets.UTF_8)
            Json.parseToJsonElement(decoded).jsonObject
        } catch (_: Exception) {
            throw UnauthorizedException("유효한 크론 OIDC 토큰이 아닙니다.")
        }

        val iss = payloadJson["iss"]?.jsonPrimitive?.contentOrNull
        if (iss !in setOf("https://accounts.google.com", "accounts.google.com")) {
            throw UnauthorizedException("유효한 크론 OIDC 토큰이 아닙니다.")
        }

        val aud = payloadJson["aud"]?.jsonPrimitive?.contentOrNull
        if (aud != config.audience) {
            throw UnauthorizedException("유효한 크론 OIDC 토큰이 아닙니다.")
        }

        val email = payloadJson["email"]?.jsonPrimitive?.contentOrNull
        if (email != config.serviceAccountEmail) {
            throw UnauthorizedException("유효한 크론 OIDC 토큰이 아닙니다.")
        }

        val emailVerifiedElem = payloadJson["email_verified"]?.jsonPrimitive
        val emailVerified = (emailVerifiedElem?.booleanOrNull == true) || (emailVerifiedElem?.contentOrNull == "true")
        if (!emailVerified) {
            throw UnauthorizedException("유효한 크론 OIDC 토큰이 아닙니다.")
        }

        val exp = payloadJson["exp"]?.jsonPrimitive?.longOrNull
            ?: throw UnauthorizedException("유효한 크론 OIDC 토큰이 아닙니다.")
        if (exp <= config.clock.instant().epochSecond) {
            throw UnauthorizedException("유효한 크론 OIDC 토큰이 아닙니다.")
        }
    }

    private fun verifyRsaSignature(
        publicKey: PublicKey,
        signingInput: ByteArray,
        signatureBytes: ByteArray
    ): Boolean {
        return try {
            if (publicKey !is RSAPublicKey) return false
            Signature.getInstance("SHA256withRSA").run {
                initVerify(publicKey)
                update(signingInput)
                verify(signatureBytes)
            }
        } catch (_: Exception) {
            false
        }
    }
}
