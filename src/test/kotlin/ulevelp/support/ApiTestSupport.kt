package ulevelp.support

import io.ktor.server.testing.*
import kotlinx.serialization.json.*
import ulevelp.auth.CronOidcConfig
import ulevelp.auth.CronOidcVerifier
import ulevelp.auth.StaticJwksProvider
import ulevelp.auth.SupabaseAuthConfig
import ulevelp.db.DatabaseConfig
import ulevelp.module
import ulevelp.notion.NotionClient
import ulevelp.note.AnalyzeJobDispatcher
import ulevelp.note.GeminiClient
import ulevelp.security.CryptoService
import ulevelp.service.GeminiCheckResponse
import ulevelp.service.IntegrationCheckClient
import ulevelp.service.NotionCheckResponse
import ulevelp.service.VideoMeta
import ulevelp.service.VideoMetaClient
import ulevelp.storage.StorageClient
import java.math.BigInteger
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.interfaces.RSAPublicKey
import java.security.spec.ECGenParameterSpec
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.Base64
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.assertEquals
import kotlin.test.assertTrue

object TestJwt {
    private const val TEST_SUPABASE_URL = "https://testproj.supabase.co"
    const val TEST_ISSUER = "$TEST_SUPABASE_URL/auth/v1"
    const val TEST_AUDIENCE = "authenticated"
    const val EC_KID = "test-ec-key-1"

    val FIXED_NOW: Instant = Instant.parse("2026-10-30T12:00:00Z")
    val TEST_CLOCK: Clock = Clock.fixed(FIXED_NOW, ZoneOffset.UTC)
    private val urlEncoder = Base64.getUrlEncoder().withoutPadding()

    private val ecKeyPair: KeyPair = KeyPairGenerator.getInstance("EC").apply {
        initialize(ECGenParameterSpec("secp256r1"))
    }.generateKeyPair()

    val authConfig: SupabaseAuthConfig

    init {
        val ecPub = ecKeyPair.public as ECPublicKey
        val validJwksJson = buildJsonObject {
            putJsonArray("keys") {
                addJsonObject {
                    put("kty", "EC")
                    put("crv", "P-256")
                    put("alg", "ES256")
                    put("use", "sig")
                    put("kid", EC_KID)
                    put("x", urlEncoder.encodeToString(toFixedUnsignedBytes(ecPub.w.affineX, 32)))
                    put("y", urlEncoder.encodeToString(toFixedUnsignedBytes(ecPub.w.affineY, 32)))
                }
            }
        }.toString()

        val jwksProvider = StaticJwksProvider.fromJwksJson(validJwksJson)
        authConfig = SupabaseAuthConfig(
            issuer = TEST_ISSUER,
            audience = TEST_AUDIENCE,
            jwksProvider = jwksProvider,
            clock = TEST_CLOCK
        )
    }

    private fun toUnsignedBytes(bigInt: BigInteger): ByteArray {
        val bytes = bigInt.toByteArray()
        return if (bytes.size > 1 && bytes[0] == 0.toByte()) {
            bytes.copyOfRange(1, bytes.size)
        } else {
            bytes
        }
    }

    private fun toFixedUnsignedBytes(bigInt: BigInteger, length: Int): ByteArray {
        val unsigned = toUnsignedBytes(bigInt)
        return when {
            unsigned.size == length -> unsigned
            unsigned.size > length -> unsigned.copyOfRange(unsigned.size - length, unsigned.size)
            else -> ByteArray(length).also {
                System.arraycopy(unsigned, 0, it, length - unsigned.size, unsigned.size)
            }
        }
    }

    fun token(
        sub: UUID,
        email: String = "player@example.com",
        exp: Long = FIXED_NOW.epochSecond + 3600
    ): String {
        val headerJson = buildJsonObject {
            put("alg", "ES256")
            put("typ", "JWT")
            put("kid", EC_KID)
        }.toString()

        val payloadJson = buildJsonObject {
            put("iss", TEST_ISSUER)
            put("aud", TEST_AUDIENCE)
            put("sub", sub.toString())
            put("email", email)
            put("exp", exp)
        }.toString()

        val headerB64 = urlEncoder.encodeToString(headerJson.toByteArray(Charsets.UTF_8))
        val payloadB64 = urlEncoder.encodeToString(payloadJson.toByteArray(Charsets.UTF_8))
        val signingInput = "$headerB64.$payloadB64".toByteArray(Charsets.US_ASCII)

        val signatureBytes = Signature.getInstance("SHA256withECDSAinP1363Format").run {
            initSign(ecKeyPair.private)
            update(signingInput)
            sign()
        }

        val sigB64 = urlEncoder.encodeToString(signatureBytes)
        return "$headerB64.$payloadB64.$sigB64"
    }
}

object TestCronJwt {
    const val TEST_CRON_AUDIENCE = "https://test-cron-service.run.app"
    const val TEST_CRON_SA_EMAIL = "test-cron-sa@test-project.iam.gserviceaccount.com"
    const val RSA_KID = "test-rsa-cron-key-1"

    val FIXED_NOW: Instant = Instant.parse("2026-10-30T12:00:00Z")
    val TEST_CLOCK: Clock = Clock.fixed(FIXED_NOW, ZoneOffset.UTC)
    private val urlEncoder = Base64.getUrlEncoder().withoutPadding()

    val rsaKeyPair: KeyPair = KeyPairGenerator.getInstance("RSA").apply {
        initialize(2048)
    }.generateKeyPair()

    val cronConfig: CronOidcConfig

    init {
        val rsaPub = rsaKeyPair.public as RSAPublicKey
        fun toUnsignedBytes(bigInt: BigInteger): ByteArray {
            val bytes = bigInt.toByteArray()
            return if (bytes.size > 1 && bytes[0] == 0.toByte()) {
                bytes.copyOfRange(1, bytes.size)
            } else {
                bytes
            }
        }

        val validJwksJson = buildJsonObject {
            putJsonArray("keys") {
                addJsonObject {
                    put("kty", "RSA")
                    put("alg", "RS256")
                    put("use", "sig")
                    put("kid", RSA_KID)
                    put("n", urlEncoder.encodeToString(toUnsignedBytes(rsaPub.modulus)))
                    put("e", urlEncoder.encodeToString(toUnsignedBytes(rsaPub.publicExponent)))
                }
            }
        }.toString()

        val jwksProvider = StaticJwksProvider.fromJwksJson(validJwksJson)
        cronConfig = CronOidcConfig(
            audience = TEST_CRON_AUDIENCE,
            serviceAccountEmail = TEST_CRON_SA_EMAIL,
            jwksProvider = jwksProvider,
            clock = TEST_CLOCK
        )
    }

    fun token(
        iss: String = "https://accounts.google.com",
        aud: String = TEST_CRON_AUDIENCE,
        email: String = TEST_CRON_SA_EMAIL,
        emailVerified: Boolean = true,
        exp: Long = FIXED_NOW.epochSecond + 3600,
        kid: String = RSA_KID,
        keyPair: KeyPair = rsaKeyPair,
        alg: String = "RS256"
    ): String {
        val headerJson = buildJsonObject {
            put("alg", alg)
            put("typ", "JWT")
            put("kid", kid)
        }.toString()

        val payloadJson = buildJsonObject {
            put("iss", iss)
            put("aud", aud)
            put("email", email)
            put("email_verified", emailVerified)
            put("exp", exp)
        }.toString()

        val headerB64 = urlEncoder.encodeToString(headerJson.toByteArray(Charsets.UTF_8))
        val payloadB64 = urlEncoder.encodeToString(payloadJson.toByteArray(Charsets.UTF_8))
        val signingInput = "$headerB64.$payloadB64".toByteArray(Charsets.US_ASCII)

        val signatureBytes = Signature.getInstance("SHA256withRSA").run {
            initSign(keyPair.private)
            update(signingInput)
            sign()
        }

        val sigB64 = urlEncoder.encodeToString(signatureBytes)
        return "$headerB64.$payloadB64.$sigB64"
    }
}

class FakeVideoMetaClient(
    @Volatile var meta: VideoMeta? = VideoMeta("Fake Title", "Fake Channel")
) : VideoMetaClient {
    val calls = CopyOnWriteArrayList<String>()

    override suspend fun fetch(videoId: String): VideoMeta? {
        calls.add(videoId)
        return meta
    }
}

object TestCrypto {
    val keyBytes = ByteArray(32) { (it + 1).toByte() }
    val service = CryptoService(keyBytes)
}

class FakeIntegrationCheckClient : IntegrationCheckClient {
    @Volatile var notionHandler: (suspend (token: String, songsDb: String, sessionsDb: String, notesDb: String?) -> NotionCheckResponse)? = null
    @Volatile var geminiHandler: (suspend (apiKey: String, model: String) -> GeminiCheckResponse)? = null

    val notionCalls = CopyOnWriteArrayList<List<String?>>()
    val geminiCalls = CopyOnWriteArrayList<Pair<String, String>>()

    override suspend fun checkNotion(
        token: String,
        songsDb: String,
        sessionsDb: String,
        notesDb: String?
    ): NotionCheckResponse {
        notionCalls.add(listOf(token, songsDb, sessionsDb, notesDb))
        val handler = notionHandler
        if (handler != null) return handler(token, songsDb, sessionsDb, notesDb)
        return NotionCheckResponse(
            ok = true,
            provider = "notion",
            songsTitle = "연습 곡",
            sessionsTitle = "연습 기록",
            notesTitle = if (notesDb != null) "학습 영상 노트" else null,
            maxUploadMB = 5
        )
    }

    override suspend fun checkGemini(
        apiKey: String,
        model: String
    ): GeminiCheckResponse {
        geminiCalls.add(apiKey to model)
        val handler = geminiHandler
        if (handler != null) return handler(apiKey, model)
        return GeminiCheckResponse(
            ok = true,
            provider = "gemini",
            model = model,
            displayName = if (model == "gemini-flash-latest") "Gemini Flash Latest" else model
        )
    }
}

fun ApplicationTestBuilder.configureApiTestApp(
    dbConfig: DatabaseConfig,
    videoMetaClient: VideoMetaClient = FakeVideoMetaClient(),
    storageClient: StorageClient? = null,
    cryptoService: CryptoService? = TestCrypto.service,
    integrationCheckClient: IntegrationCheckClient = FakeIntegrationCheckClient(),
    notionClient: NotionClient = FakeNotionClient(),
    cronOidcVerifier: CronOidcVerifier? = CronOidcVerifier(TestCronJwt.cronConfig),
    geminiClient: GeminiClient = FakeGeminiClient(),
    analyzeJobDispatcher: AnalyzeJobDispatcher? = null
) {
    application {
        module(
            dbConfig = dbConfig.copy(runMigrations = false),
            authConfig = TestJwt.authConfig,
            allowedOrigins = listOf("http://localhost:3000"),
            videoMetaClient = videoMetaClient,
            publicAppUrl = "https://hunseokc.github.io/ULevelP/",
            storageClient = storageClient,
            cryptoService = cryptoService,
            integrationCheckClient = integrationCheckClient,
            notionClient = notionClient,
            cronOidcVerifier = cronOidcVerifier,
            geminiClient = geminiClient,
            analyzeJobDispatcher = analyzeJobDispatcher
        )
    }
}

fun assertStandardError(
    bodyText: String,
    expectedStatus: Int,
    expectedCode: String,
    expectedSource: String = "server"
): JsonObject {
    val obj = Json.parseToJsonElement(bodyText).jsonObject
    assertEquals(
        setOf("ok", "source", "status", "code", "message", "retryAfter"),
        obj.keys,
        "Standard error response must contain exact 6 keys"
    )
    assertEquals(false, obj["ok"]?.jsonPrimitive?.boolean)
    assertEquals(expectedSource, obj["source"]?.jsonPrimitive?.content)
    assertEquals(expectedStatus, obj["status"]?.jsonPrimitive?.int)
    assertEquals(expectedCode, obj["code"]?.jsonPrimitive?.content)
    assertTrue(obj["message"]?.jsonPrimitive?.content?.isNotBlank() == true)
    assertTrue(obj["retryAfter"] is JsonNull)
    return obj
}
