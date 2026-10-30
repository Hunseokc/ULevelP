package ulevelp.auth

import kotlinx.serialization.json.*
import ulevelp.api.UnauthorizedException
import java.math.BigInteger
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.PublicKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.interfaces.RSAPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import java.security.spec.RSAPublicKeySpec
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.Base64
import java.util.UUID

/**
 * JWT 검증을 통과한 인증 사용자 컨텍스트.
 */
data class AuthenticatedUser(
    val id: UUID,
    val email: String,
    val displayNameHint: String
)

/**
 * JWKS에서 파싱된 개별 서명 검증 공개키.
 */
data class JwkKey(
    val kid: String,
    val kty: String,
    val alg: String,
    val publicKey: PublicKey
) {
    override fun toString(): String = "JwkKey(kid=$kid, kty=$kty, alg=$alg)"
}

fun interface JwksProvider {
    fun resolveKey(kid: String): JwkKey?
}

/**
 * 고정된 공개키 목록 또는 JWKS JSON 문자열을 사용하는 JwksProvider (단위·통합 테스트용).
 */
class StaticJwksProvider(keys: List<JwkKey>) : JwksProvider {
    private val keyMap: Map<String, JwkKey> = keys.associateBy { it.kid }

    override fun resolveKey(kid: String): JwkKey? = keyMap[kid]

    companion object {
        fun fromJwksJson(jwksJson: String): StaticJwksProvider =
            StaticJwksProvider(JwksParser.parseJwks(jwksJson))
    }
}

/**
 * Supabase JWKS 엔드포인트(`https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`)에서
 * 공개키를 조회하고 메모리에 캐싱하는 Provider.
 */
class HttpJwksProvider(
    private val jwksUri: URI,
    private val clock: Clock = Clock.systemUTC(),
    private val cacheTtl: Duration = Duration.ofHours(1),
    private val minRefreshInterval: Duration = Duration.ofSeconds(10),
    private val httpClient: HttpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .build()
) : JwksProvider {

    @Volatile
    private var cachedKeys: Map<String, JwkKey> = emptyMap()

    @Volatile
    private var lastFetchedAt: Instant = Instant.EPOCH

    override fun resolveKey(kid: String): JwkKey? {
        val now = clock.instant()
        val currentMap = cachedKeys
        val isExpired = Duration.between(lastFetchedAt, now) >= cacheTtl

        if (!isExpired) {
            currentMap[kid]?.let { return it }
        }

        synchronized(this) {
            val nowInside = clock.instant()
            val expiredInside = Duration.between(lastFetchedAt, nowInside) >= cacheTtl
            if (!expiredInside) {
                cachedKeys[kid]?.let { return it }
                if (Duration.between(lastFetchedAt, nowInside) < minRefreshInterval) {
                    return null
                }
            }
            return runCatching {
                val req = HttpRequest.newBuilder(jwksUri)
                    .timeout(Duration.ofSeconds(5))
                    .header("Accept", "application/json")
                    .GET()
                    .build()
                val res = httpClient.send(req, HttpResponse.BodyHandlers.ofString())
                if (res.statusCode() in 200..299) {
                    val parsed = JwksParser.parseJwks(res.body()).associateBy { it.kid }
                    cachedKeys = parsed
                    lastFetchedAt = nowInside
                    parsed[kid]
                } else {
                    cachedKeys[kid]
                }
            }.getOrElse {
                cachedKeys[kid]
            }
        }
    }
}

/**
 * RFC 7517 JWK Set 파서 (ES256 P-256 및 RS256 지원).
 */
object JwksParser {
    private val urlDecoder = Base64.getUrlDecoder()

    fun parseJwks(jwksJson: String): List<JwkKey> {
        val root = Json.parseToJsonElement(jwksJson).jsonObject
        val keysArray = root["keys"]?.jsonArray ?: return emptyList()
        val result = mutableListOf<JwkKey>()

        for (elem in keysArray) {
            val obj = elem as? JsonObject ?: continue
            val use = obj["use"]?.jsonPrimitive?.contentOrNull
            if (use != null && use != "sig") continue

            val kid = obj["kid"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() } ?: continue
            val kty = obj["kty"]?.jsonPrimitive?.contentOrNull ?: continue
            val alg = obj["alg"]?.jsonPrimitive?.contentOrNull

            when (kty) {
                "EC" -> {
                    val crv = obj["crv"]?.jsonPrimitive?.contentOrNull
                    if (crv != "P-256") continue
                    if (alg != null && alg != "ES256") continue
                    val xStr = obj["x"]?.jsonPrimitive?.contentOrNull ?: continue
                    val yStr = obj["y"]?.jsonPrimitive?.contentOrNull ?: continue
                    val pubKey = buildEcP256PublicKey(xStr, yStr)
                    result.add(JwkKey(kid = kid, kty = "EC", alg = "ES256", publicKey = pubKey))
                }
                "RSA" -> {
                    if (alg != null && alg != "RS256") continue
                    val nStr = obj["n"]?.jsonPrimitive?.contentOrNull ?: continue
                    val eStr = obj["e"]?.jsonPrimitive?.contentOrNull ?: continue
                    val pubKey = buildRsaPublicKey(nStr, eStr)
                    result.add(JwkKey(kid = kid, kty = "RSA", alg = "RS256", publicKey = pubKey))
                }
            }
        }
        return result
    }

    private fun buildEcP256PublicKey(xBase64Url: String, yBase64Url: String): ECPublicKey {
        val xBytes = urlDecoder.decode(xBase64Url)
        val yBytes = urlDecoder.decode(yBase64Url)
        val point = ECPoint(BigInteger(1, xBytes), BigInteger(1, yBytes))
        val params = AlgorithmParameters.getInstance("EC").apply {
            init(ECGenParameterSpec("secp256r1"))
        }
        val ecSpec = params.getParameterSpec(ECParameterSpec::class.java)
        val keySpec = ECPublicKeySpec(point, ecSpec)
        return KeyFactory.getInstance("EC").generatePublic(keySpec) as ECPublicKey
    }

    private fun buildRsaPublicKey(nBase64Url: String, eBase64Url: String): RSAPublicKey {
        val nBytes = urlDecoder.decode(nBase64Url)
        val eBytes = urlDecoder.decode(eBase64Url)
        val keySpec = RSAPublicKeySpec(BigInteger(1, nBytes), BigInteger(1, eBytes))
        return KeyFactory.getInstance("RSA").generatePublic(keySpec) as RSAPublicKey
    }
}

data class SupabaseAuthConfig(
    val issuer: String,
    val audience: String = "authenticated",
    val jwksProvider: JwksProvider,
    val clock: Clock = Clock.systemUTC()
) {
    companion object {
        fun fromEnvOrNull(env: Map<String, String> = System.getenv()): SupabaseAuthConfig? {
            val rawUrl = env["SUPABASE_URL"]?.trim()?.trimEnd('/')?.takeIf { it.isNotEmpty() }
                ?: return null
            val issuer = "$rawUrl/auth/v1"
            val jwksUri = URI("$issuer/.well-known/jwks.json")
            return SupabaseAuthConfig(
                issuer = issuer,
                audience = "authenticated",
                jwksProvider = HttpJwksProvider(jwksUri)
            )
        }
    }
}

/**
 * Supabase Auth access token(JWT) 검증기 (`docs/03-api-spec.md` 1.1절, `KC-D10`).
 *
 * - 허용 알고리즘: 비대칭 서명 `ES256`, `RS256`만 허용 (`none`, `HS256` 등 거부)
 * - `kid`로 JWKS 공개키 선택 및 암호학적 서명 검증
 * - `iss` = `https://<project-ref>.supabase.co/auth/v1`
 * - `aud` = `authenticated`
 * - `exp` 미만료 검증 (`nbf` 존재 시 함께 검증)
 * - `sub` = `users.id` (UUID)
 */
class SupabaseJwtVerifier(private val config: SupabaseAuthConfig) {

    companion object {
        private val ALLOWED_ALGORITHMS = setOf("ES256", "RS256")
        private val urlDecoder = Base64.getUrlDecoder()
    }

    fun verifyBearerHeader(authHeader: String?): AuthenticatedUser {
        if (authHeader.isNullOrBlank()) {
            throw UnauthorizedException("Authorization 헤더가 누락되었습니다.")
        }
        val prefix = "Bearer "
        if (!authHeader.startsWith(prefix, ignoreCase = true)) {
            throw UnauthorizedException("Bearer 토큰 형식이 아닙니다.")
        }
        val token = authHeader.substring(prefix.length).trim()
        if (token.isEmpty()) {
            throw UnauthorizedException("인증 토큰이 비어 있습니다.")
        }
        return verifyToken(token)
    }

    fun verifyToken(token: String): AuthenticatedUser {
        val parts = token.split('.')
        if (parts.size != 3 || parts.any { it.isEmpty() }) {
            throw UnauthorizedException("올바르지 않은 JWT 형식입니다.")
        }

        val headerB64 = parts[0]
        val payloadB64 = parts[1]
        val signatureB64 = parts[2]

        val headerObj = decodeJsonObject(headerB64, "JWT 헤더")
        val alg = headerObj["alg"]?.jsonPrimitive?.contentOrNull
            ?: throw UnauthorizedException("JWT 헤더에 alg가 없습니다.")
        if (alg !in ALLOWED_ALGORITHMS) {
            throw UnauthorizedException("지원하지 않는 서명 알고리즘입니다.")
        }

        val kid = headerObj["kid"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }
            ?: throw UnauthorizedException("JWT 헤더에 kid가 없습니다.")

        val jwkKey = config.jwksProvider.resolveKey(kid)
            ?: throw UnauthorizedException("알 수 없는 서명 키(kid)입니다.")

        if (jwkKey.alg != alg) {
            throw UnauthorizedException("토큰 알고리즘과 서명 키 알고리즘이 일치하지 않습니다.")
        }

        val signatureBytes = try {
            urlDecoder.decode(signatureB64)
        } catch (_: IllegalArgumentException) {
            throw UnauthorizedException("올바르지 않은 서명 인코딩입니다.")
        }

        val signingInput = "$headerB64.$payloadB64".toByteArray(Charsets.US_ASCII)
        val verified = verifySignature(alg, jwkKey.publicKey, signingInput, signatureBytes)
        if (!verified) {
            throw UnauthorizedException("토큰 서명 검증에 실패했습니다.")
        }

        val payloadObj = decodeJsonObject(payloadB64, "JWT 페이로드")

        // 1. iss 검증
        val iss = payloadObj["iss"]?.jsonPrimitive?.contentOrNull
        if (iss != config.issuer) {
            throw UnauthorizedException("유효하지 않은 토큰 발급자(iss)입니다.")
        }

        // 2. aud 검증 ("authenticated")
        val audElement = payloadObj["aud"]
            ?: throw UnauthorizedException("토큰에 대상(aud) 클레임이 없습니다.")
        val audMatches = when (audElement) {
            is JsonPrimitive -> audElement.isString && audElement.content == config.audience
            is JsonArray -> audElement.any { it is JsonPrimitive && it.isString && it.content == config.audience }
            else -> false
        }
        if (!audMatches) {
            throw UnauthorizedException("유효하지 않은 토큰 대상(aud)입니다.")
        }

        // 3. exp 및 nbf 검증
        val nowEpochSec = config.clock.instant().epochSecond
        val exp = payloadObj["exp"]?.jsonPrimitive?.longOrNull
            ?: throw UnauthorizedException("토큰에 만료 시각(exp) 클레임이 없습니다.")
        if (nowEpochSec >= exp) {
            throw UnauthorizedException("만료된 인증 토큰입니다.")
        }

        val nbf = payloadObj["nbf"]?.jsonPrimitive?.longOrNull
        if (nbf != null && nowEpochSec < nbf) {
            throw UnauthorizedException("아직 유효 시각(nbf)이 도래하지 않은 토큰입니다.")
        }

        // 4. sub (users.id UUID) 검증
        val subStr = payloadObj["sub"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }
            ?: throw UnauthorizedException("토큰에 사용자 식별자(sub)가 없습니다.")
        val userId = try {
            UUID.fromString(subStr)
        } catch (_: IllegalArgumentException) {
            throw UnauthorizedException("유효한 UUID 형식의 사용자 식별자(sub)가 아닙니다.")
        }

        val email = payloadObj["email"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        val metadataObj = payloadObj["user_metadata"] as? JsonObject
        val metaName = metadataObj?.get("full_name")?.jsonPrimitive?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() }
            ?: metadataObj?.get("name")?.jsonPrimitive?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() }
        val displayNameHint = metaName ?: email.substringBefore('@')

        return AuthenticatedUser(
            id = userId,
            email = email,
            displayNameHint = displayNameHint
        )
    }

    private fun decodeJsonObject(base64Url: String, label: String): JsonObject {
        return try {
            val decoded = String(urlDecoder.decode(base64Url), Charsets.UTF_8)
            Json.parseToJsonElement(decoded).jsonObject
        } catch (_: Exception) {
            throw UnauthorizedException("$label 파싱에 실패했습니다.")
        }
    }

    private fun verifySignature(
        alg: String,
        publicKey: PublicKey,
        signingInput: ByteArray,
        signatureBytes: ByteArray
    ): Boolean {
        return try {
            when (alg) {
                "ES256" -> {
                    if (publicKey !is ECPublicKey || signatureBytes.size != 64) return false
                    Signature.getInstance("SHA256withECDSAinP1363Format").run {
                        initVerify(publicKey)
                        update(signingInput)
                        verify(signatureBytes)
                    }
                }
                "RS256" -> {
                    if (publicKey !is RSAPublicKey) return false
                    Signature.getInstance("SHA256withRSA").run {
                        initVerify(publicKey)
                        update(signingInput)
                        verify(signatureBytes)
                    }
                }
                else -> false
            }
        } catch (_: Exception) {
            false
        }
    }
}

