package ulevelp.security

import java.util.Base64
import java.util.UUID
import javax.crypto.AEADBadTagException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CryptoServiceTest {
    private val masterKeyBytes = ByteArray(32) { idx -> (idx + 1).toByte() }
    private val masterKeyBase64 = Base64.getEncoder().encodeToString(masterKeyBytes)
    private val crypto = CryptoService.fromBase64Key(masterKeyBase64, keyVersion = 1)
    private val userA = UUID.fromString("10000000-0000-4000-8000-000000000001")
    private val userB = UUID.fromString("20000000-0000-4000-8000-000000000002")

    @Test
    fun `AES-256-GCM encrypt and decrypt round-trip preserves plaintext and extracts 4-char hint`() {
        val notionToken = "ntn_1234567890abcdefghijABCDEFGHIJ9876"
        val payload = crypto.encryptProviderKey(userA, "notion", notionToken)

        assertEquals(12, payload.iv.size, "IV must be 12 bytes (96-bit)")
        assertEquals(notionToken.toByteArray().size + 16, payload.encryptedSecret.size, "Ciphertext must include 16-byte GCM auth tag")
        assertEquals(1.toShort(), payload.keyVersion)
        assertEquals("9876", payload.hint)
        assertFalse(payload.toString().contains(notionToken), "toString() must never expose full secret")

        val decrypted = crypto.decryptProviderKey(userA, "notion", payload)
        assertEquals(notionToken, decrypted)
    }

    @Test
    fun `encrypting identical plaintext twice generates distinct random 12-byte IVs and ciphertexts`() {
        val geminiKey = "AIzaSyA1234567890abcdefghijklmnopqrstuv"
        val first = crypto.encryptProviderKey(userA, "gemini", geminiKey)
        val second = crypto.encryptProviderKey(userA, "gemini", geminiKey)

        assertFalse(first.iv.contentEquals(second.iv), "Each encryption must use a fresh random 12-byte IV")
        assertFalse(first.encryptedSecret.contentEquals(second.encryptedSecret), "Ciphertexts must differ when IVs differ")
        assertEquals(geminiKey, crypto.decryptProviderKey(userA, "gemini", first))
        assertEquals(geminiKey, crypto.decryptProviderKey(userA, "gemini", second))
        assertEquals("stuv", first.hint)
    }

    @Test
    fun `AAD binds ciphertext to userId, appId, and provider preventing row transplant`() {
        val notionToken = "ntn_1234567890abcdefghijABCDEFGHIJ9876"
        val payload = crypto.encryptProviderKey(userA, "notion", notionToken, appId = "ulevelp")

        // 다른 사용자(userB) 행으로 복사 시 복호화 거부
        assertFailsWith<AEADBadTagException> {
            crypto.decryptProviderKey(userB, "notion", payload, appId = "ulevelp")
        }
        // 다른 공급자(gemini)로 복호화 시도 시 거부
        assertFailsWith<AEADBadTagException> {
            crypto.decryptProviderKey(userA, "gemini", payload, appId = "ulevelp")
        }
        // 다른 appId(guitar-practice)로 복호화 시도 시 거부
        assertFailsWith<AEADBadTagException> {
            crypto.decryptProviderKey(userA, "notion", payload, appId = "guitar-practice")
        }
        // AAD 없이 복호화 시도 시 거부
        assertFailsWith<AEADBadTagException> {
            crypto.decrypt(payload)
        }
    }

    @Test
    fun `tampered ciphertext or auth tag is rejected with AEADBadTagException`() {
        val secret = "secret_abcdefghijklmnopqrstuvwxyz123456"
        val payload = crypto.encryptProviderKey(userA, "notion", secret)

        // 1. 암호문 첫 바이트 변조
        val tamperedCipher = payload.encryptedSecret.copyOf().also { it[0] = (it[0].toInt() xor 0x01).toByte() }
        assertFailsWith<AEADBadTagException> {
            crypto.decryptProviderKey(userA, "notion", tamperedCipher, payload.iv)
        }

        // 2. 끝 16바이트 GCM Auth Tag 마지막 바이트 변조
        val tamperedTag = payload.encryptedSecret.copyOf().also {
            val lastIdx = it.lastIndex
            it[lastIdx] = (it[lastIdx].toInt() xor 0x01).toByte()
        }
        assertFailsWith<AEADBadTagException> {
            crypto.decryptProviderKey(userA, "notion", tamperedTag, payload.iv)
        }

        // 3. IV 1비트 변조
        val tamperedIv = payload.iv.copyOf().also { it[0] = (it[0].toInt() xor 0x01).toByte() }
        assertFailsWith<AEADBadTagException> {
            crypto.decryptProviderKey(userA, "notion", payload.encryptedSecret, tamperedIv)
        }
    }

    @Test
    fun `decrypting with different master key fails authentication`() {
        val otherKeyBytes = ByteArray(32) { idx -> (255 - idx).toByte() }
        val otherCrypto = CryptoService(otherKeyBytes)

        val payload = crypto.encryptProviderKey(userA, "notion", "ntn_abcdefghijklmnopqrstuvwxyz012345")
        assertFailsWith<AEADBadTagException> {
            otherCrypto.decryptProviderKey(userA, "notion", payload)
        }
    }

    @Test
    fun `master key validation rejects non-32-byte or malformed Base64 keys`() {
        val shortKeyBase64 = Base64.getEncoder().encodeToString(ByteArray(16))
        val longKeyBase64 = Base64.getEncoder().encodeToString(ByteArray(33))

        assertFailsWith<IllegalArgumentException> {
            CryptoService.fromBase64Key(shortKeyBase64)
        }
        assertFailsWith<IllegalArgumentException> {
            CryptoService.fromBase64Key(longKeyBase64)
        }
        assertFailsWith<IllegalArgumentException> {
            CryptoService.fromBase64Key("not-valid-base64!!!")
        }
        assertFailsWith<IllegalArgumentException> {
            CryptoService.fromBase64Key("   ")
        }
    }

    @Test
    fun `provider key regex validation accepts valid Notion and Gemini keys and rejects malformed keys`() {
        // Valid Notion tokens (ntn_ and secret_)
        assertTrue(CryptoService.isValidNotionToken("ntn_1234567890abcdefghij12345"))
        assertTrue(CryptoService.isValidNotionToken("secret_1234567890abcdefghij1234567890"))

        // Invalid Notion tokens
        val invalidNotionTokens = listOf(
            "",
            "ntn_short123",
            "secret_short",
            "Bearer ntn_1234567890abcdefghij12345",
            "ntn_1234567890abcdefghij_with_underscore",
            "AIzaSyA1234567890abcdefghijklmnopqrstuv"
        )
        for (badToken in invalidNotionTokens) {
            assertFalse(CryptoService.isValidNotionToken(badToken), "Should reject Notion token: $badToken")
            val ex = assertFailsWith<InvalidIntegrationKeyException> {
                crypto.encryptProviderKey(userA, "notion", badToken)
            }
            assertEquals("notion", ex.provider)
        }

        // Valid Gemini API keys (AIza + 35 chars = 39 chars)
        assertTrue(CryptoService.isValidGeminiKey("AIzaSyA1234567890abcdefghijklmnopqrstuv"))
        assertTrue(CryptoService.isValidGeminiKey("AIzaSy_1234567890-abcdefghijklmnopqrstu"))

        // Invalid Gemini API keys
        val invalidGeminiKeys = listOf(
            "",
            "AIzaSyTooShort12345",
            "AIzaSyTooLong1234567890abcdefghijklmnopqrstuvwx",
            "sk-1234567890abcdefghijklmnopqrstuvwx123456",
            "AIzaSyA1234567890abcdefghijklmnopqrst!@"
        )
        for (badKey in invalidGeminiKeys) {
            assertFalse(CryptoService.isValidGeminiKey(badKey), "Should reject Gemini key: $badKey")
            val ex = assertFailsWith<InvalidIntegrationKeyException> {
                crypto.encryptProviderKey(userA, "gemini", badKey)
            }
            assertEquals("gemini", ex.provider)
        }

        // Valid & invalid Notion Database IDs
        assertTrue(CryptoService.isValidNotionDatabaseId("a1b2c3d4e5f60718293a4b5c6d7e8f90"))
        assertTrue(CryptoService.isValidNotionDatabaseId("a1b2c3d4-e5f6-0718-293a-4b5c6d7e8f90"))
        assertFalse(CryptoService.isValidNotionDatabaseId("not-a-uuid-at-all"))
        assertFalse(CryptoService.isValidNotionDatabaseId("a1b2c3d4e5f60718293a4b5c6d7e8f9")) // 31 chars
        assertFailsWith<InvalidIntegrationKeyException> {
            CryptoService.validateNotionDatabaseId("invalid_db_id")
        }

        // Unsupported provider
        assertFailsWith<InvalidIntegrationKeyException> {
            crypto.encryptProviderKey(userA, "openai", "sk-1234567890")
        }
    }
}
