package ulevelp.security

import java.security.SecureRandom
import java.util.Base64
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class InvalidIntegrationKeyException(
    val provider: String,
    override val message: String
) : IllegalArgumentException(message)

/**
 * `integrations` 테이블 저장용 AES-256-GCM 암호화 결과 모델.
 *
 * - [encryptedSecret]: AES-256-GCM 암호문 + 16바이트(128-bit) Auth Tag
 * - [iv]: 12바이트(96-bit) 고유 초기화 벡터
 * - [keyVersion]: 마스터 키 회전 대비 버전 (기본 1)
 * - [hint]: 키 원문의 끝 4자리 (화면 표시용)
 */
data class EncryptedPayload(
    val encryptedSecret: ByteArray,
    val iv: ByteArray,
    val keyVersion: Short = 1,
    val hint: String
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is EncryptedPayload) return false
        return encryptedSecret.contentEquals(other.encryptedSecret) &&
            iv.contentEquals(other.iv) &&
            keyVersion == other.keyVersion &&
            hint == other.hint
    }

    override fun hashCode(): Int {
        var result = encryptedSecret.contentHashCode()
        result = 31 * result + iv.contentHashCode()
        result = 31 * result + keyVersion
        result = 31 * result + hint.hashCode()
        return result
    }

    override fun toString(): String =
        "EncryptedPayload(keyVersion=$keyVersion, hint=****$hint, ivBytes=${iv.size}, cipherBytes=${encryptedSecret.size})"
}

/**
 * KC-D4, KC-D5:
 * - 마스터 키(`APP_MASTER_KEY`, 32바이트 Base64) 기반 AES-256-GCM 암·복호화 (12바이트 고유 IV, 128-bit Auth Tag)
 * - 행 식별자(`$userId:$appId:$provider`)를 AAD(`cipher.updateAAD`)로 바인딩하여 타 사용자/행 복사 공격 방지
 * - 노션 통합 토큰, 노션 DB ID, Gemini API 키 형식 정규식 검증
 */
class CryptoService(
    masterKeyBytes: ByteArray,
    val keyVersion: Short = 1
) {
    private val secretKeySpec: SecretKeySpec
    private val secureRandom = SecureRandom()

    init {
        require(masterKeyBytes.size == MASTER_KEY_BYTES) {
            "APP_MASTER_KEY는 디코딩 후 정확히 ${MASTER_KEY_BYTES}바이트(256-bit)여야 합니다 (현재: ${masterKeyBytes.size}바이트)."
        }
        secretKeySpec = SecretKeySpec(masterKeyBytes.copyOf(), "AES")
    }

    /**
     * 평문 문자열을 AES-256-GCM(선택적 [aad] 포함)으로 암호화하고 끝 4자리 [EncryptedPayload.hint]와 함께 반환합니다.
     */
    fun encrypt(plaintext: String, aad: String? = null): EncryptedPayload {
        val trimmed = plaintext.trim()
        require(trimmed.isNotEmpty()) { "암호화할 시크릿이 비어 있습니다." }

        val iv = ByteArray(IV_BYTES).also { secureRandom.nextBytes(it) }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKeySpec, GCMParameterSpec(GCM_TAG_BITS, iv))
        if (!aad.isNullOrEmpty()) {
            cipher.updateAAD(aad.toByteArray(Charsets.UTF_8))
        }
        val encryptedSecret = cipher.doFinal(trimmed.toByteArray(Charsets.UTF_8))

        return EncryptedPayload(
            encryptedSecret = encryptedSecret,
            iv = iv,
            keyVersion = keyVersion,
            hint = extractHint(trimmed)
        )
    }

    /**
     * 공급자(`notion` | `gemini`) 키 형식을 정규식으로 먼저 검증한 뒤,
     * `$userId:$appId:$provider` AAD를 바인딩해 AES-256-GCM으로 암호화합니다.
     */
    fun encryptProviderKey(
        userId: UUID,
        provider: String,
        rawKey: String,
        appId: String = DEFAULT_APP_ID
    ): EncryptedPayload {
        val validated = validateProviderKey(provider, rawKey)
        return encrypt(validated, aad = integrationAad(userId, appId, provider))
    }

    /**
     * AES-256-GCM 암호문(`encrypted_secret`)과 12바이트 `iv`를 복호화하여 원문을 반환합니다.
     * 암호문·태그·IV·AAD가 1비트라도 변조되었거나 마스터 키가 다르면 `AEADBadTagException`이 발생합니다.
     */
    fun decrypt(encryptedSecret: ByteArray, iv: ByteArray, aad: String? = null): String {
        require(iv.size == IV_BYTES) {
            "IV 길이는 정확히 ${IV_BYTES}바이트여야 합니다 (현재: ${iv.size}바이트)."
        }
        require(encryptedSecret.size > GCM_TAG_BYTES) {
            "암호문 길이가 유효하지 않습니다."
        }

        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKeySpec, GCMParameterSpec(GCM_TAG_BITS, iv))
        if (!aad.isNullOrEmpty()) {
            cipher.updateAAD(aad.toByteArray(Charsets.UTF_8))
        }
        val plainBytes = cipher.doFinal(encryptedSecret)
        return String(plainBytes, Charsets.UTF_8)
    }

    fun decrypt(payload: EncryptedPayload, aad: String? = null): String =
        decrypt(payload.encryptedSecret, payload.iv, aad)

    /**
     * `$userId:$appId:$provider` AAD를 검증하며 `integrations` 행의 암호문을 복호화합니다.
     */
    fun decryptProviderKey(
        userId: UUID,
        provider: String,
        encryptedSecret: ByteArray,
        iv: ByteArray,
        appId: String = DEFAULT_APP_ID
    ): String = decrypt(encryptedSecret, iv, aad = integrationAad(userId, appId, provider))

    fun decryptProviderKey(
        userId: UUID,
        provider: String,
        payload: EncryptedPayload,
        appId: String = DEFAULT_APP_ID
    ): String = decrypt(payload.encryptedSecret, payload.iv, aad = integrationAad(userId, appId, provider))

    override fun toString(): String = "CryptoService(keyVersion=$keyVersion, algorithm=$TRANSFORMATION)"

    companion object {
        const val MASTER_KEY_BYTES = 32
        const val IV_BYTES = 12
        const val GCM_TAG_BITS = 128
        const val GCM_TAG_BYTES = 16
        const val DEFAULT_APP_ID = "ulevelp"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"

        /**
         * `integrations` 테이블 복합 PK `(user_id, app_id, provider)`를 AAD 문자열로 직렬화합니다.
         */
        fun integrationAad(userId: UUID, appId: String, provider: String): String =
            "$userId:$appId:$provider"

        /**
         * 노션 내부 통합 토큰 형식:
         * - 신형 `ntn_` + 영숫자 20~100자
         * - 구형 `secret_` + 영숫자 20~100자
         */
        val NOTION_TOKEN_REGEX = Regex("^(ntn_[A-Za-z0-9]{20,100}|secret_[A-Za-z0-9]{20,100})$")

        /**
         * Google Gemini (AI Studio) API 키 형식:
         * - `AIza` + 영숫자/`_`/`-` 35자 (총 39자)
         */
        val GEMINI_API_KEY_REGEX = Regex("^AIza[0-9A-Za-z_-]{35}$")

        /**
         * 노션 데이터베이스 ID 형식:
         * - 32자리 16진수 (하이픈 포함 UUID 형식 또는 하이픈 없는 32자)
         */
        val NOTION_DB_ID_REGEX = Regex(
            "^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$"
        )

        fun fromBase64Key(base64Key: String, keyVersion: Short = 1): CryptoService {
            val trimmed = base64Key.trim()
            require(trimmed.isNotEmpty()) { "APP_MASTER_KEY가 비어 있습니다." }
            val decoded = try {
                Base64.getDecoder().decode(trimmed)
            } catch (e: IllegalArgumentException) {
                throw IllegalArgumentException("APP_MASTER_KEY가 올바른 Base64 형식이 아닙니다.", e)
            }
            return CryptoService(decoded, keyVersion)
        }

        fun fromEnv(
            env: Map<String, String> = System.getenv(),
            envKey: String = "APP_MASTER_KEY",
            keyVersion: Short = 1
        ): CryptoService {
            val raw = env[envKey]
                ?: throw IllegalStateException("$envKey 환경 변수가 설정되지 않았습니다.")
            return fromBase64Key(raw, keyVersion)
        }

        fun isValidNotionToken(token: String): Boolean =
            NOTION_TOKEN_REGEX.matches(token.trim())

        fun isValidGeminiKey(apiKey: String): Boolean =
            GEMINI_API_KEY_REGEX.matches(apiKey.trim())

        fun isValidNotionDatabaseId(dbId: String): Boolean =
            NOTION_DB_ID_REGEX.matches(dbId.trim())

        fun validateProviderKey(provider: String, rawKey: String): String {
            val trimmed = rawKey.trim()
            when (provider) {
                "notion" -> if (!NOTION_TOKEN_REGEX.matches(trimmed)) {
                    throw InvalidIntegrationKeyException(
                        provider = "notion",
                        message = "유효하지 않은 노션 통합 토큰 형식입니다 (ntn_ 또는 secret_으로 시작해야 합니다)."
                    )
                }
                "gemini" -> if (!GEMINI_API_KEY_REGEX.matches(trimmed)) {
                    throw InvalidIntegrationKeyException(
                        provider = "gemini",
                        message = "유효하지 않은 Gemini API 키 형식입니다 (AIza로 시작하는 39자리 키여야 합니다)."
                    )
                }
                else -> throw InvalidIntegrationKeyException(
                    provider = provider,
                    message = "지원하지 않는 연동 공급자입니다: $provider"
                )
            }
            return trimmed
        }

        fun validateNotionDatabaseId(dbId: String): String {
            val trimmed = dbId.trim()
            if (!NOTION_DB_ID_REGEX.matches(trimmed)) {
                throw InvalidIntegrationKeyException(
                    provider = "notion",
                    message = "유효하지 않은 노션 데이터베이스 ID 형식입니다 (32자리 16진수)."
                )
            }
            return trimmed
        }

        fun extractHint(secret: String): String {
            val trimmed = secret.trim()
            require(trimmed.length >= 4) { "키 길이는 최소 4자 이상이어야 합니다." }
            return trimmed.takeLast(4)
        }
    }
}
