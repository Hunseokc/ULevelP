package ulevelp.auth

import com.sun.net.httpserver.HttpServer
import com.zaxxer.hikari.HikariDataSource
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.server.testing.*
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import org.jetbrains.exposed.sql.Database
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import org.jetbrains.exposed.sql.deleteAll
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.transactions.transaction
import org.jetbrains.exposed.sql.update
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import ulevelp.api.NotFoundException
import ulevelp.db.*
import ulevelp.module
import ulevelp.security.CryptoService
import ulevelp.service.ProfileService
import java.math.BigInteger
import java.net.InetSocketAddress
import java.net.URI
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.interfaces.RSAPublicKey
import java.security.spec.ECGenParameterSpec
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Base64
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.test.*

class AuthAndProfileApiTest {

    companion object {
        private const val TEST_SUPABASE_URL = "https://testproj.supabase.co"
        private const val TEST_ISSUER = "$TEST_SUPABASE_URL/auth/v1"
        private const val TEST_AUDIENCE = "authenticated"
        private const val EC_KID = "test-ec-key-1"
        private const val RSA_KID = "test-rsa-key-1"

        private val FIXED_NOW: Instant = Instant.parse("2026-10-30T12:00:00Z")
        private val TEST_CLOCK: Clock = Clock.fixed(FIXED_NOW, ZoneOffset.UTC)
        private val urlEncoder = Base64.getUrlEncoder().withoutPadding()

        private lateinit var dataSource: HikariDataSource
        private lateinit var db: Database
        private lateinit var dbConfig: DatabaseConfig

        private lateinit var ecKeyPair: KeyPair
        private lateinit var wrongEcKeyPair: KeyPair
        private lateinit var rsaKeyPair: KeyPair
        private lateinit var validJwksJson: String
        private lateinit var jwksProvider: JwksProvider
        private lateinit var authConfig: SupabaseAuthConfig

        @JvmStatic
        @BeforeAll
        fun setUp() {
            dbConfig = PostgresTestContainer.getConfig()
            dataSource = DatabaseFactory.createDataSource(dbConfig)
            DatabaseFactory.migrate(dataSource)
            db = DatabaseFactory.connect(dataSource)

            ecKeyPair = KeyPairGenerator.getInstance("EC").apply {
                initialize(ECGenParameterSpec("secp256r1"))
            }.generateKeyPair()

            wrongEcKeyPair = KeyPairGenerator.getInstance("EC").apply {
                initialize(ECGenParameterSpec("secp256r1"))
            }.generateKeyPair()

            rsaKeyPair = KeyPairGenerator.getInstance("RSA").apply {
                initialize(2048)
            }.generateKeyPair()

            val ecPub = ecKeyPair.public as ECPublicKey
            val rsaPub = rsaKeyPair.public as RSAPublicKey

            validJwksJson = buildJsonObject {
                putJsonArray("keys") {
                    // 불량 키가 함께 포함되어 있어도 개별 격리(runCatching)로 정상 키는 유지되어야 함 (리뷰 5번)
                    addJsonObject {
                        put("kty", "EC")
                        put("crv", "P-256")
                        put("alg", "ES256")
                        put("use", "sig")
                        put("kid", "corrupted-ec-key")
                        put("x", "!!!not_base64_url!!!")
                        put("y", "")
                    }
                    addJsonObject {
                        put("kty", "EC")
                        put("crv", "P-256")
                        put("alg", "ES256")
                        put("use", "sig")
                        put("kid", EC_KID)
                        put("x", urlEncoder.encodeToString(toFixedUnsignedBytes(ecPub.w.affineX, 32)))
                        put("y", urlEncoder.encodeToString(toFixedUnsignedBytes(ecPub.w.affineY, 32)))
                    }
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

            jwksProvider = StaticJwksProvider.fromJwksJson(validJwksJson)
            authConfig = SupabaseAuthConfig(
                issuer = TEST_ISSUER,
                audience = TEST_AUDIENCE,
                jwksProvider = jwksProvider,
                clock = TEST_CLOCK
            )
        }

        @JvmStatic
        @AfterAll
        fun tearDown() {
            if (::dataSource.isInitialized) {
                runCatching {
                    dataSource.connection.use { conn ->
                        conn.createStatement().use { stmt ->
                            stmt.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
                        }
                        conn.commit()
                    }
                }
                dataSource.close()
            }
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

        fun signJwt(
            sub: String,
            email: String = "player@example.com",
            fullName: String? = null,
            iss: String = TEST_ISSUER,
            aud: String = TEST_AUDIENCE,
            exp: Long = FIXED_NOW.epochSecond + 3600,
            nbf: Long? = null,
            alg: String = "ES256",
            kid: String = EC_KID,
            privateKey: PrivateKey = ecKeyPair.private
        ): String {
            val headerJson = buildJsonObject {
                put("alg", alg)
                put("typ", "JWT")
                put("kid", kid)
            }.toString()

            val payloadJson = buildJsonObject {
                put("iss", iss)
                put("aud", aud)
                put("sub", sub)
                put("email", email)
                put("exp", exp)
                if (nbf != null) put("nbf", nbf)
                if (fullName != null) {
                    putJsonObject("user_metadata") {
                        put("full_name", fullName)
                    }
                }
            }.toString()

            val headerB64 = urlEncoder.encodeToString(headerJson.toByteArray(Charsets.UTF_8))
            val payloadB64 = urlEncoder.encodeToString(payloadJson.toByteArray(Charsets.UTF_8))
            val signingInput = "$headerB64.$payloadB64".toByteArray(Charsets.US_ASCII)

            val signatureBytes = when (alg) {
                "ES256" -> Signature.getInstance("SHA256withECDSAinP1363Format").run {
                    initSign(privateKey)
                    update(signingInput)
                    sign()
                }
                "RS256" -> Signature.getInstance("SHA256withRSA").run {
                    initSign(privateKey)
                    update(signingInput)
                    sign()
                }
                "HS256" -> Mac.getInstance("HmacSHA256").run {
                    init(SecretKeySpec("secret-key-for-hs256-confusion-test".toByteArray(), "HmacSHA256"))
                    doFinal(signingInput)
                }
                "none" -> ByteArray(1)
                else -> error("Unsupported test alg: $alg")
            }

            val sigB64 = urlEncoder.encodeToString(signatureBytes)
            return "$headerB64.$payloadB64.$sigB64"
        }
    }

    @BeforeEach
    fun cleanDatabase() {
        transaction(db) {
            StorageTrashTable.deleteAll()
            UsersTable.deleteAll()
        }
    }

    private fun ApplicationTestBuilder.configureTestApp() {
        application {
            module(
                dbConfig = dbConfig.copy(runMigrations = false),
                authConfig = authConfig,
                allowedOrigins = listOf("https://hunseokc.github.io", "http://localhost:3000")
            )
        }
    }

    private fun assertStandardError(
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

    @Test
    fun `missing token, forged signature, expired token, wrong iss or aud, alg confusion, and unknown v1 route`() = testApplication {
        configureTestApp()
        val userId = UUID.randomUUID().toString()

        // 1. 토큰 없는 요청 -> 401
        val noTokenRes = client.get("/api/v1/me")
        assertEquals(HttpStatusCode.Unauthorized, noTokenRes.status)
        assertStandardError(noTokenRes.bodyAsText(), 401, "UNAUTHORIZED")

        // 2. 다른 개인키로 위조 서명한 토큰 -> 401
        val forgedToken = signJwt(sub = userId, privateKey = wrongEcKeyPair.private)
        val forgedRes = client.get("/api/v1/me") {
            header(HttpHeaders.Authorization, "Bearer $forgedToken")
        }
        assertEquals(HttpStatusCode.Unauthorized, forgedRes.status)
        val forgedErr = assertStandardError(forgedRes.bodyAsText(), 401, "UNAUTHORIZED")
        assertFalse(forgedErr.toString().contains(forgedToken), "Error response must never leak raw token")

        // 3. 만료된 토큰 (exp <= now) -> 401
        val expiredToken = signJwt(sub = userId, exp = FIXED_NOW.epochSecond - 10)
        val expiredRes = client.get("/api/v1/me") {
            header(HttpHeaders.Authorization, "Bearer $expiredToken")
        }
        assertEquals(HttpStatusCode.Unauthorized, expiredRes.status)
        assertStandardError(expiredRes.bodyAsText(), 401, "UNAUTHORIZED")

        // 4. 잘못된 iss -> 401
        val wrongIssToken = signJwt(sub = userId, iss = "https://other.supabase.co/auth/v1")
        val wrongIssRes = client.get("/api/v1/me") {
            header(HttpHeaders.Authorization, "Bearer $wrongIssToken")
        }
        assertEquals(HttpStatusCode.Unauthorized, wrongIssRes.status)
        assertStandardError(wrongIssRes.bodyAsText(), 401, "UNAUTHORIZED")

        // 5. 잘못된 aud -> 401
        val wrongAudToken = signJwt(sub = userId, aud = "anon")
        val wrongAudRes = client.get("/api/v1/me") {
            header(HttpHeaders.Authorization, "Bearer $wrongAudToken")
        }
        assertEquals(HttpStatusCode.Unauthorized, wrongAudRes.status)
        assertStandardError(wrongAudRes.bodyAsText(), 401, "UNAUTHORIZED")

        // 6. 알고리즘 변조 공격 (alg = HS256 또는 none) -> 401
        val hs256Token = signJwt(sub = userId, alg = "HS256", kid = EC_KID)
        val hs256Res = client.get("/api/v1/me") {
            header(HttpHeaders.Authorization, "Bearer $hs256Token")
        }
        assertEquals(HttpStatusCode.Unauthorized, hs256Res.status)

        val noneToken = signJwt(sub = userId, alg = "none", kid = EC_KID)
        val noneRes = client.get("/api/v1/me") {
            header(HttpHeaders.Authorization, "Bearer $noneToken")
        }
        assertEquals(HttpStatusCode.Unauthorized, noneRes.status)

        // 7. RSA 키 kid에 ES256 알고리즘 지정(키-알고리즘 불일치) -> 401
        val mismatchAlgToken = signJwt(sub = userId, alg = "ES256", kid = RSA_KID, privateKey = ecKeyPair.private)
        val mismatchRes = client.get("/api/v1/me") {
            header(HttpHeaders.Authorization, "Bearer $mismatchAlgToken")
        }
        assertEquals(HttpStatusCode.Unauthorized, mismatchRes.status)

        // 8. 존재하지 않는 /api/v1 경로 요청 시 인증/토큰 유무와 무관하게 404 NOT_FOUND 반환 (리뷰 9번)
        val unknownV1Res = client.get("/api/v1/non-existent-endpoint")
        assertEquals(HttpStatusCode.NotFound, unknownV1Res.status)
        assertStandardError(unknownV1Res.bodyAsText(), 404, "NOT_FOUND")
    }

    @Test
    fun `HttpJwksProvider caches keys and throttles retries on fetch failure using minRefreshInterval`() = runTest {
        val requestCount = AtomicInteger(0)
        val shouldFail = AtomicReference(false)

        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/auth/v1/.well-known/jwks.json") { exchange ->
            requestCount.incrementAndGet()
            if (shouldFail.get()) {
                exchange.sendResponseHeaders(500, -1)
                exchange.close()
            } else {
                val bytes = validJwksJson.toByteArray(Charsets.UTF_8)
                exchange.responseHeaders.add("Content-Type", "application/json")
                exchange.sendResponseHeaders(200, bytes.size.toLong())
                exchange.responseBody.use { it.write(bytes) }
            }
        }
        server.start()

        try {
            var currentInstant = FIXED_NOW
            val mutableClock = object : Clock() {
                override fun getZone(): ZoneId = ZoneOffset.UTC
                override fun withZone(zone: ZoneId?): Clock = this
                override fun instant(): Instant = currentInstant
            }

            val port = server.address.port
            val provider = HttpJwksProvider(
                jwksUri = URI("http://127.0.0.1:$port/auth/v1/.well-known/jwks.json"),
                clock = mutableClock,
                cacheTtl = Duration.ofSeconds(60),
                minRefreshInterval = Duration.ofSeconds(10)
            )

            // 1. 첫 조회 -> HTTP 1회 호출 후 캐시
            val key1 = provider.resolveKey(EC_KID)
            assertNotNull(key1)
            assertEquals(1, requestCount.get())

            // 2. TTL 이내 재조회 -> 캐시 히트(HTTP 추가 호출 없음)
            currentInstant = currentInstant.plusSeconds(30)
            val key2 = provider.resolveKey(RSA_KID)
            assertNotNull(key2)
            assertEquals(1, requestCount.get())

            // 3. TTL(60초) 만료 후 JWKS 서버 장애(500) 발생 -> 1회 재시도 후 실패 시각(lastAttemptAt) 기록
            currentInstant = currentInstant.plusSeconds(35) // 총 +65초 (TTL 만료)
            shouldFail.set(true)
            val key3 = provider.resolveKey(EC_KID)
            assertNotNull(key3, "Existing cached key should be returned as fallback when refresh fails")
            assertEquals(2, requestCount.get())

            // 4. 실패 직후 minRefreshInterval(10초) 이내 연속 요청 -> HTTP 재호출 없이 즉시 반환 (리뷰 3번)
            currentInstant = currentInstant.plusSeconds(3)
            provider.resolveKey(EC_KID)
            provider.resolveKey("unknown-kid")
            assertEquals(2, requestCount.get(), "Failed JWKS fetch must not retry within minRefreshInterval")

            // 5. minRefreshInterval(10초) 경과 후 서버 복구 -> 정상 재조회
            currentInstant = currentInstant.plusSeconds(10)
            shouldFail.set(false)
            val key4 = provider.resolveKey(EC_KID)
            assertNotNull(key4)
            assertEquals(3, requestCount.get())
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun `CORS plugin returns Access-Control-Allow-Origin only for ALLOWED_ORIGINS on both 200 and 4xx responses`() = testApplication {
        configureTestApp()
        val userId = UUID.randomUUID().toString()
        val token = signJwt(sub = userId)

        // 1. 허용된 Origin + 정상 응답(200) -> CORS 헤더 포함
        val allowedOkRes = client.get("/api/v1/me") {
            header(HttpHeaders.Origin, "https://hunseokc.github.io")
            header(HttpHeaders.Authorization, "Bearer $token")
        }
        assertEquals(HttpStatusCode.OK, allowedOkRes.status)
        assertEquals("https://hunseokc.github.io", allowedOkRes.headers[HttpHeaders.AccessControlAllowOrigin])

        // 2. 허용된 Origin + 오류 응답(401) -> 오류 응답에도 CORS 헤더 포함
        val allowedErrRes = client.get("/api/v1/me") {
            header(HttpHeaders.Origin, "http://localhost:3000")
        }
        assertEquals(HttpStatusCode.Unauthorized, allowedErrRes.status)
        assertEquals("http://localhost:3000", allowedErrRes.headers[HttpHeaders.AccessControlAllowOrigin])

        // 3. 허용되지 않은 Origin -> CORS 헤더 미포함
        val disallowedRes = client.get("/api/v1/me") {
            header(HttpHeaders.Origin, "https://evil.example.com")
            header(HttpHeaders.Authorization, "Bearer $token")
        }
        assertNull(disallowedRes.headers[HttpHeaders.AccessControlAllowOrigin])
    }

    @Test
    fun `first authenticated request creates users and profiles and calculates takeUsedBytes and ulevelp-only key summaries`() = testApplication {
        configureTestApp()
        val userId = UUID.randomUUID()
        val token = signJwt(sub = userId.toString(), email = "player@example.com")

        // 첫 요청 시 users, profiles 자동 생성 확인 (FR-AUTH-2)
        val firstRes = client.get("/api/v1/me") {
            header(HttpHeaders.Authorization, "Bearer $token")
        }
        assertEquals(HttpStatusCode.OK, firstRes.status)
        val firstJson = Json.parseToJsonElement(firstRes.bodyAsText()).jsonObject
        assertEquals(userId.toString(), firstJson["id"]?.jsonPrimitive?.content)
        assertEquals("player@example.com", firstJson["email"]?.jsonPrimitive?.content)
        assertEquals("player", firstJson["displayName"]?.jsonPrimitive?.content)
        assertEquals("user", firstJson["role"]?.jsonPrimitive?.content)
        assertEquals("supabase", firstJson["storageProvider"]?.jsonPrimitive?.content)
        assertTrue(firstJson["driveFolderId"] is JsonNull)
        assertEquals(0L, firstJson["takeUsedBytes"]?.jsonPrimitive?.long)
        assertEquals(209_715_200L, firstJson["takeQuotaBytes"]?.jsonPrimitive?.long)
        assertTrue(firstJson["migratedLocalAt"] is JsonNull)
        val keysObj = firstJson["keys"]!!.jsonObject
        assertTrue(keysObj["notion"] is JsonNull)
        assertTrue(keysObj["gemini"] is JsonNull)

        // RS256 서명 토큰 및 이메일 변경 + 녹음 용량 + 키 힌트 반영 확인
        val masterKey = Base64.getEncoder().encodeToString(ByteArray(32) { (it + 1).toByte() })
        val crypto = CryptoService.fromBase64Key(masterKey)
        val rawNotionSecret = "ntn_1234567890abcdefghijABCDEFGHIJ9a8b"
        val encPayload = crypto.encryptProviderKey(userId, "notion", rawNotionSecret, appId = "ulevelp")
        val otherAppGeminiPayload = crypto.encryptProviderKey(
            userId,
            "gemini",
            "AIzaSyA1234567890abcdefghijk123456789ab",
            appId = "guitar-practice"
        )
        val songId = UUID.randomUUID()
        val sessionId = UUID.randomUUID()
        val now = OffsetDateTime.ofInstant(FIXED_NOW, ZoneOffset.UTC)

        transaction(db) {
            SongsTable.insert {
                it[id] = songId
                it[SongsTable.userId] = userId
                it[title] = "Autumn Leaves"
                it[videoId] = "dQw4w9WgXcQ"
            }
            SessionsTable.insert {
                it[id] = sessionId
                it[SessionsTable.userId] = userId
                it[SessionsTable.songId] = songId
                it[date] = LocalDate.of(2026, 10, 30)
                it[seconds] = 600
            }
            // supabase 스토리지 녹음 (용량 합산 대상)
            TakesTable.insert {
                it[TakesTable.userId] = userId
                it[TakesTable.sessionId] = sessionId
                it[TakesTable.songId] = songId
                it[recordedAt] = now
                it[durationSec] = 20
                it[mime] = "audio/mp4"
                it[sizeBytes] = 1_500_000L
                it[storage] = "supabase"
                it[storageKey] = "$userId/take1.m4a"
            }
            // drive 스토리지 녹음 (서비스 쿼터 미차감 - FR-DRIVE-2)
            TakesTable.insert {
                it[TakesTable.userId] = userId
                it[TakesTable.sessionId] = sessionId
                it[TakesTable.songId] = songId
                it[recordedAt] = now
                it[durationSec] = 40
                it[mime] = "audio/mp4"
                it[sizeBytes] = 5_000_000L
                it[storage] = "drive"
                it[storageKey] = "drive-file-id-123"
            }
            IntegrationsTable.insert {
                it[IntegrationsTable.userId] = userId
                it[appId] = "ulevelp"
                it[provider] = "notion"
                it[encryptedSecret] = encPayload.encryptedSecret
                it[iv] = encPayload.iv
                it[keyVersion] = encPayload.keyVersion
                it[hint] = encPayload.hint
            }
            // 다른 앱(guitar-practice)에만 등록된 키는 ulevelp keys 요약에 대체 표시되면 안 됨 (리뷰 10번)
            IntegrationsTable.insert {
                it[IntegrationsTable.userId] = userId
                it[appId] = "guitar-practice"
                it[provider] = "gemini"
                it[encryptedSecret] = otherAppGeminiPayload.encryptedSecret
                it[iv] = otherAppGeminiPayload.iv
                it[keyVersion] = otherAppGeminiPayload.keyVersion
                it[hint] = otherAppGeminiPayload.hint
            }
        }

        val rsaTokenWithNewEmail = signJwt(
            sub = userId.toString(),
            email = "new-email@example.com",
            alg = "RS256",
            kid = RSA_KID,
            privateKey = rsaKeyPair.private
        )
        val secondRes = client.get("/api/v1/me") {
            header(HttpHeaders.Authorization, "Bearer $rsaTokenWithNewEmail")
        }
        assertEquals(HttpStatusCode.OK, secondRes.status)
        val secondBody = secondRes.bodyAsText()
        assertFalse(secondBody.contains(rawNotionSecret), "Response must never expose raw integration secret")
        val secondJson = Json.parseToJsonElement(secondBody).jsonObject
        assertEquals("new-email@example.com", secondJson["email"]?.jsonPrimitive?.content)
        assertEquals("player", secondJson["displayName"]?.jsonPrimitive?.content, "Existing displayName must not be overwritten")
        assertEquals(1_500_000L, secondJson["takeUsedBytes"]?.jsonPrimitive?.long, "Only supabase takes count toward quota")
        val secondKeysObj = secondJson["keys"]!!.jsonObject
        val notionKeyObj = secondKeysObj["notion"]!!.jsonObject
        assertEquals("9a8b", notionKeyObj["hint"]?.jsonPrimitive?.content)
        assertTrue(notionKeyObj["updatedAt"]?.jsonPrimitive?.content?.isNotBlank() == true)
        assertTrue(secondKeysObj["gemini"] is JsonNull, "guitar-practice key must not be shown as ulevelp key")
    }

    @Test
    fun `PATCH me updates allowed fields, ignores role and takeQuotaBytes tampering, and blocks drive when notion sync is enabled`() = testApplication {
        configureTestApp()
        val userId = UUID.randomUUID()
        val token = signJwt(sub = userId.toString(), email = "patch@example.com")

        // 1. role, takeQuotaBytes 변조 시도와 함께 허용된 필드 수정 (FR-AUTH-3)
        val patchRes = client.patch("/api/v1/me") {
            header(HttpHeaders.Authorization, "Bearer $token")
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("displayName", "석훈")
                    put("storageProvider", "drive")
                    put("driveFolderId", "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs")
                    put("migratedLocalAt", "2026-10-30T09:30:00Z")
                    put("role", "owner")
                    put("takeQuotaBytes", 999_999_999_999L)
                }.toString()
            )
        }
        assertEquals(HttpStatusCode.OK, patchRes.status)
        val patchJson = Json.parseToJsonElement(patchRes.bodyAsText()).jsonObject
        assertEquals("석훈", patchJson["displayName"]?.jsonPrimitive?.content)
        assertEquals("drive", patchJson["storageProvider"]?.jsonPrimitive?.content)
        assertEquals("1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs", patchJson["driveFolderId"]?.jsonPrimitive?.content)
        assertEquals("2026-10-30T09:30:00Z", patchJson["migratedLocalAt"]?.jsonPrimitive?.content)
        // 권한 및 쿼터 변조 무시 확인
        assertEquals("user", patchJson["role"]?.jsonPrimitive?.content)
        assertEquals(209_715_200L, patchJson["takeQuotaBytes"]?.jsonPrimitive?.long)

        // 2. 노션 실시간 연동이 활성화된 상태에서 storageProvider: "drive" 변경 시 409 Conflict 거부 (FR-SYNC-5)
        transaction(db) {
            ProfilesTable.update({ ProfilesTable.id eq userId }) {
                it[storageProvider] = "supabase"
            }
            NotionSyncTable.insert {
                it[NotionSyncTable.userId] = userId
                it[enabled] = true
            }
        }

        val conflictRes = client.patch("/api/v1/me") {
            header(HttpHeaders.Authorization, "Bearer $token")
            contentType(ContentType.Application.Json)
            setBody("""{"storageProvider":"drive"}""")
        }
        assertEquals(HttpStatusCode.Conflict, conflictRes.status)
        assertStandardError(conflictRes.bodyAsText(), 409, "NOTION_SYNC_CONFLICT")

        // 3. 잘못된 storageProvider 입력 시 400 INVALID_INPUT 거부
        val invalidRes = client.patch("/api/v1/me") {
            header(HttpHeaders.Authorization, "Bearer $token")
            contentType(ContentType.Application.Json)
            setBody("""{"storageProvider":"s3"}""")
        }
        assertEquals(HttpStatusCode.BadRequest, invalidRes.status)
        assertStandardError(invalidRes.bodyAsText(), 400, "INVALID_INPUT")
    }

    @Test
    fun `user B cannot access or mutate user A data (0 rows and 404 NotFound) and DELETE me cascades all child tables and blocks recreation`() = testApplication {
        configureTestApp()
        val userA = UUID.randomUUID()
        val userB = UUID.randomUUID()
        val tokenA = signJwt(sub = userA.toString(), email = "userA@example.com")
        val tokenB = signJwt(sub = userB.toString(), email = "userB@example.com")

        // 두 사용자 첫 요청으로 생성
        assertEquals(HttpStatusCode.OK, client.get("/api/v1/me") { header(HttpHeaders.Authorization, "Bearer $tokenA") }.status)
        assertEquals(HttpStatusCode.OK, client.get("/api/v1/me") { header(HttpHeaders.Authorization, "Bearer $tokenB") }.status)

        val songA = UUID.randomUUID()
        val sessionA = UUID.randomUUID()
        val noteA = UUID.randomUUID()
        val now = OffsetDateTime.ofInstant(FIXED_NOW, ZoneOffset.UTC)
        val masterKey = Base64.getEncoder().encodeToString(ByteArray(32) { (it + 3).toByte() })
        val crypto = CryptoService.fromBase64Key(masterKey)
        val encA = crypto.encryptProviderKey(userA, "gemini", "AIzaSyA1234567890abcdefghijk123456789ab")

        // 사용자 A의 하위 데이터 전체 세팅
        transaction(db) {
            SongsTable.insert {
                it[id] = songA
                it[userId] = userA
                it[title] = "User A Secret Song"
                it[videoId] = "dQw4w9WgXcQ"
            }
            SessionsTable.insert {
                it[id] = sessionA
                it[userId] = userA
                it[songId] = songA
                it[date] = LocalDate.of(2026, 10, 30)
                it[seconds] = 1200
            }
            TakesTable.insert {
                it[userId] = userA
                it[sessionId] = sessionA
                it[songId] = songA
                it[recordedAt] = now
                it[durationSec] = 30
                it[mime] = "audio/mp4"
                it[sizeBytes] = 2_000_000L
                it[storage] = "supabase"
                it[storageKey] = "$userA/take-a1.m4a"
            }
            TakesTable.insert {
                it[userId] = userA
                it[sessionId] = sessionA
                it[songId] = songA
                it[recordedAt] = now
                it[durationSec] = 25
                it[mime] = "audio/mp4"
                it[sizeBytes] = 1_000_000L
                it[storage] = "drive"
                it[storageKey] = "drive-file-a2"
            }
            NotesTable.insert {
                it[id] = noteA
                it[userId] = userA
                it[videoId] = "dQw4w9WgXcQ"
                it[title] = "User A Note"
                it[tags] = listOf("화성")
                it[analysis] = buildJsonObject { put("summary", "test") }
            }
            AnalysisJobsTable.insert {
                it[userId] = userA
                it[url] = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
                it[tags] = listOf("화성")
                it[noteId] = noteA
            }
            IntegrationsTable.insert {
                it[userId] = userA
                it[appId] = "ulevelp"
                it[provider] = "gemini"
                it[encryptedSecret] = encA.encryptedSecret
                it[iv] = encA.iv
                it[keyVersion] = encA.keyVersion
                it[hint] = encA.hint
            }
            NotionSyncTable.insert {
                it[userId] = userA
                it[enabled] = false
            }
            NotionLinksTable.insert {
                it[entity] = "song"
                it[entityId] = songA
                it[userId] = userA
                it[notionPageId] = "notion-page-a1"
            }
            SyncOutboxTable.insert {
                it[userId] = userA
                it[entity] = "song"
                it[entityId] = songA
                it[op] = "upsert"
            }
        }

        // 1. 사용자 B가 조회할 때 사용자 A의 데이터는 0행이며, 단건 접근 시 404 NotFoundException 발생 (NFR-SEC-2)
        val profileService = ProfileService(db)
        assertEquals(1, profileService.listOwnedSongIds(userA).size)
        assertEquals(0, profileService.listOwnedSongIds(userB).size, "User B must see 0 rows of User A's songs")
        assertFailsWith<NotFoundException> {
            profileService.requireOwnedSong(userB, songA)
        }.also { ex ->
            assertEquals(HttpStatusCode.NotFound, ex.status)
        }
        assertFailsWith<NotFoundException> {
            profileService.requireOwnedSession(userB, sessionA)
        }.also { ex ->
            assertEquals(HttpStatusCode.NotFound, ex.status)
        }

        // 사용자 B의 GET /api/v1/me에는 사용자 A의 녹음 용량이나 키가 전혀 노출되지 않음
        val meBRes = client.get("/api/v1/me") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
        }
        val meBJson = Json.parseToJsonElement(meBRes.bodyAsText()).jsonObject
        assertEquals(0L, meBJson["takeUsedBytes"]?.jsonPrimitive?.long)
        assertTrue(meBJson["keys"]!!.jsonObject["gemini"] is JsonNull)

        // 2. 잘못된 confirmText로 DELETE /api/v1/me 요청 시 400 INVALID_INPUT 거부
        val badDeleteRes = client.delete("/api/v1/me") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("""{"confirmText":"동의합니다"}""")
        }
        assertEquals(HttpStatusCode.BadRequest, badDeleteRes.status)
        assertStandardError(badDeleteRes.bodyAsText(), 400, "INVALID_INPUT")

        // 3. 사용자 A가 올바른 confirmText("삭제합니다")로 DELETE /api/v1/me 호출
        val deleteRes = client.delete("/api/v1/me") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("""{"confirmText":"삭제합니다"}""")
        }
        assertEquals(HttpStatusCode.OK, deleteRes.status)
        val deleteJson = Json.parseToJsonElement(deleteRes.bodyAsText()).jsonObject
        assertEquals(true, deleteJson["ok"]?.jsonPrimitive?.boolean)

        // 4. 탈퇴 직후 동일한 잔여 토큰(tokenA)으로 재요청 시 빈 프로필이 재생성되지 않고 401 UNAUTHORIZED로 차단됨 (리뷰 2번)
        val afterDeleteRes = client.get("/api/v1/me") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.Unauthorized, afterDeleteRes.status)
        assertStandardError(afterDeleteRes.bodyAsText(), 401, "UNAUTHORIZED")

        // 5. 계정 삭제 후 사용자 A의 모든 하위 테이블이 0행이고, supabase 녹음 파일 키만 storage_trash에 적재되었으며, 사용자 B는 유지됨을 검증
        transaction(db) {
            assertEquals(0L, UsersTable.selectAll().where { UsersTable.id eq userA }.count())
            assertEquals(0L, ProfilesTable.selectAll().where { ProfilesTable.id eq userA }.count())
            assertEquals(0L, SongsTable.selectAll().where { SongsTable.userId eq userA }.count())
            assertEquals(0L, SessionsTable.selectAll().where { SessionsTable.userId eq userA }.count())
            assertEquals(0L, TakesTable.selectAll().where { TakesTable.userId eq userA }.count())
            assertEquals(0L, NotesTable.selectAll().where { NotesTable.userId eq userA }.count())
            assertEquals(0L, AnalysisJobsTable.selectAll().where { AnalysisJobsTable.userId eq userA }.count())
            assertEquals(0L, IntegrationsTable.selectAll().where { IntegrationsTable.userId eq userA }.count())
            assertEquals(0L, NotionSyncTable.selectAll().where { NotionSyncTable.userId eq userA }.count())
            assertEquals(0L, NotionLinksTable.selectAll().where { NotionLinksTable.userId eq userA }.count())
            assertEquals(0L, SyncOutboxTable.selectAll().where { SyncOutboxTable.userId eq userA }.count())

            val trashKeys = StorageTrashTable.selectAll().map { it[StorageTrashTable.storageKey] }
            assertEquals(listOf("$userA/take-a1.m4a"), trashKeys, "Only supabase storage takes must be queued in storage_trash")

            // 사용자 B의 계정은 그대로 유지됨
            assertEquals(1L, UsersTable.selectAll().where { UsersTable.id eq userB }.count())
            assertEquals(1L, ProfilesTable.selectAll().where { ProfilesTable.id eq userB }.count())
        }
    }
}
