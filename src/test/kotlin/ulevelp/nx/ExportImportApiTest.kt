package ulevelp.nx

import com.zaxxer.hikari.HikariDataSource
import io.ktor.client.HttpClient
import io.ktor.client.request.*
import io.ktor.client.request.forms.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.server.testing.*
import kotlinx.serialization.json.*
import org.jetbrains.exposed.sql.Database
import org.jetbrains.exposed.sql.deleteAll
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.transactions.transaction
import org.jetbrains.exposed.sql.update
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import ulevelp.db.*
import ulevelp.service.ExportImportService
import ulevelp.support.*
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.math.BigDecimal
import java.nio.charset.StandardCharsets
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream
import kotlin.test.*

class ExportImportApiTest {

    companion object {
        private lateinit var dataSource: HikariDataSource
        private lateinit var db: Database
        private lateinit var dbConfig: DatabaseConfig

        @JvmStatic
        @BeforeAll
        fun setUpAll() {
            dbConfig = PostgresTestContainer.getConfig()
            dataSource = DatabaseFactory.createDataSource(dbConfig)
            DatabaseFactory.migrate(dataSource)
            db = DatabaseFactory.connect(dataSource)
        }

        @JvmStatic
        @AfterAll
        fun tearDownAll() {
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
    }

    private val userA = UUID.fromString("00000000-0000-4000-8000-000000000001")
    private val userB = UUID.fromString("00000000-0000-4000-8000-000000000002")
    private lateinit var tokenA: String
    private lateinit var tokenB: String
    private val fakeStorage = FakeStorageClient()

    @BeforeEach
    fun setUp() {
        tokenA = TestJwt.token(sub = userA, email = "usera@example.com")
        tokenB = TestJwt.token(sub = userB, email = "userb@example.com")
        fakeStorage.objects.clear()
        fakeStorage.deleted.clear()

        transaction(db) {
            TakesTable.deleteAll()
            SessionsTable.deleteAll()
            SongsTable.deleteAll()
            NotesTable.deleteAll()
            SyncOutboxTable.deleteAll()
            NotionSyncTable.deleteAll()
            ProfilesTable.deleteAll()
            UsersTable.deleteAll()

            UsersTable.insert {
                it[id] = userA
                it[email] = "usera@example.com"
            }
            ProfilesTable.insert {
                it[id] = userA
                it[displayName] = "사용자A"
                it[takeQuotaBytes] = 209_715_200L
            }

            UsersTable.insert {
                it[id] = userB
                it[email] = "userb@example.com"
            }
            ProfilesTable.insert {
                it[id] = userB
                it[displayName] = "사용자B"
                it[takeQuotaBytes] = 209_715_200L
            }
        }
    }

    private fun createZip(entries: Map<String, ByteArray>): ByteArray {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out, StandardCharsets.UTF_8).use { zos ->
            for ((name, bytes) in entries) {
                zos.putNextEntry(ZipEntry(name))
                zos.write(bytes)
                zos.closeEntry()
            }
            zos.finish()
        }
        return out.toByteArray()
    }

    private fun readZipEntries(zipBytes: ByteArray): Map<String, ByteArray> {
        val map = mutableMapOf<String, ByteArray>()
        ZipInputStream(ByteArrayInputStream(zipBytes)).use { zis ->
            while (true) {
                val entry = zis.nextEntry ?: break
                if (entry.isDirectory) continue
                val baos = ByteArrayOutputStream()
                zis.copyTo(baos)
                map[entry.name] = baos.toByteArray()
            }
        }
        return map
    }

    private suspend fun HttpClient.uploadZipFile(
        token: String?,
        bytes: ByteArray,
        filename: String = "backup.zip"
    ): HttpResponse = post("/api/v1/import/notion/preview") {
        if (token != null) header(HttpHeaders.Authorization, "Bearer $token")
        setBody(
            MultiPartFormDataContent(
                formData {
                    append(
                        "file",
                        bytes,
                        Headers.build {
                            append(HttpHeaders.ContentType, "application/zip")
                            append(HttpHeaders.ContentDisposition, "filename=\"$filename\"")
                        }
                    )
                }
            )
        )
    }

    @Test
    fun `NX1 빈 계정 ZIP 내보내기`() = testApplication {
        configureApiTestApp(dbConfig = dbConfig, storageClient = fakeStorage)

        val res = client.get("/api/v1/export/zip") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }

        assertEquals(HttpStatusCode.OK, res.status)
        assertEquals("application/zip", res.headers[HttpHeaders.ContentType])
        val cd = res.headers[HttpHeaders.ContentDisposition] ?: ""
        assertTrue(cd.contains("ULeveLP-export-"), "Content-Disposition must contain ULeveLP-export-: $cd")

        val zipBytes = res.bodyAsBytes()
        val entries = readZipEntries(zipBytes)

        assertEquals(
            setOf("읽어주세요.txt", "연습 곡.csv", "연습 기록.csv", "학습 영상 노트.csv"),
            entries.keys
        )

        for (csvName in listOf("연습 곡.csv", "연습 기록.csv", "학습 영상 노트.csv")) {
            val text = entries[csvName]!!.toString(StandardCharsets.UTF_8)
            assertTrue(text.startsWith(ExportImportService.UTF8_BOM), "$csvName must start with UTF-8 BOM")
        }

        val songsHeader = entries["연습 곡.csv"]!!.toString(StandardCharsets.UTF_8).lines().first()
        assertEquals(
            "${ExportImportService.UTF8_BOM}곡명,아티스트,상태,유튜브 링크,이어서 연습,마지막 위치(초),구간 시작(초),구간 끝(초),속도,마지막 연습일,메모",
            songsHeader
        )
        val sessionsHeader = entries["연습 기록.csv"]!!.toString(StandardCharsets.UTF_8).lines().first()
        assertEquals(
            "${ExportImportService.UTF8_BOM}기록,곡,날짜,연습 시간(분),반복 횟수,속도,구간,메모,녹음",
            sessionsHeader
        )
        val notesHeader = entries["학습 영상 노트.csv"]!!.toString(StandardCharsets.UTF_8).lines().first()
        assertEquals(
            "${ExportImportService.UTF8_BOM}제목,URL,태그,채널,요약,키워드,난이도,메모",
            notesHeader
        )
    }

    @Test
    fun `NX2 곡·세션·녹음·노트 포함 ZIP 내보내기 및 includeAudio=false`() = testApplication {
        configureApiTestApp(dbConfig = dbConfig, storageClient = fakeStorage)

        val songId = UUID.randomUUID()
        val sessionId = UUID.randomUUID()
        val takeId = UUID.randomUUID()
        val noteId = UUID.randomUUID()
        val takeAudioBytes = "fake-audio-m4a-data".toByteArray(StandardCharsets.UTF_8)
        val storageKey = "$userA/$takeId.m4a"
        fakeStorage.objects[storageKey] = takeAudioBytes

        transaction(db) {
            SongsTable.insert {
                it[id] = songId
                it[userId] = userA
                it[title] = "Rick Astley"
                it[artist] = "Rick"
                it[status] = "practicing"
                it[videoId] = "dQw4w9WgXcQ"
                it[pos] = BigDecimal("10.5")
                it[a] = BigDecimal("38.0")
                it[b] = BigDecimal("55.2")
                it[rate] = BigDecimal("1.00")
                it[lastDate] = LocalDate.parse("2026-10-30")
                it[memo] = "보이싱 \"A\", 연습"
            }

            SessionsTable.insert {
                it[id] = sessionId
                it[userId] = userA
                it[this.songId] = songId
                it[date] = LocalDate.parse("2026-10-30")
                it[seconds] = 990
                it[loops] = 5
                it[rate] = BigDecimal("0.75")
                it[a] = BigDecimal("38.0")
                it[b] = BigDecimal("55.2")
                it[memo] = "세션 메모"
            }

            TakesTable.insert {
                it[id] = takeId
                it[userId] = userA
                it[this.sessionId] = sessionId
                it[this.songId] = songId
                it[recordedAt] = OffsetDateTime.parse("2026-10-30T14:22:10Z")
                it[a] = BigDecimal("38.0")
                it[b] = BigDecimal("55.2")
                it[rate] = BigDecimal("0.75")
                it[durationSec] = 30
                it[mime] = "audio/mp4"
                it[sizeBytes] = takeAudioBytes.size.toLong()
                it[storage] = "supabase"
                it[this.storageKey] = storageKey
                it[memo] = ""
            }

            NotesTable.insert {
                it[id] = noteId
                it[userId] = userA
                it[videoId] = "dQw4w9WgXcQ"
                it[title] = "보이싱 마스터"
                it[channel] = "Rick Channel"
                it[tags] = listOf("화성", "리듬")
                it[memo] = "학습 노트 메모"
                it[headline] = "헤드라인 요약"
                it[points] = listOf("핵심 1", "핵심 2")
                it[keywords] = listOf("보이싱", "코드")
                it[difficulty] = "중급"
                it[analysis] = buildJsonObject { put("test", "data") }
            }
        }

        // ① includeAudio=true
        val resTrue = client.get("/api/v1/export/zip?includeAudio=true") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, resTrue.status)
        val entriesTrue = readZipEntries(resTrue.bodyAsBytes())

        val audioEntryName = entriesTrue.keys.firstOrNull { it.startsWith("녹음/2026-10-30_142210_") && it.endsWith(".m4a") }
        assertNotNull(audioEntryName, "Audio entry 녹음/2026-10-30_142210_...m4a must exist. Entries: ${entriesTrue.keys}")
        assertContentEquals(takeAudioBytes, entriesTrue[audioEntryName])

        val mdEntryName = entriesTrue.keys.firstOrNull { it.startsWith("학습 영상 노트/") && it.endsWith(".md") }
        assertNotNull(mdEntryName, "Markdown note must exist. Entries: ${entriesTrue.keys}")

        // ② includeAudio=false
        val resFalse = client.get("/api/v1/export/zip?includeAudio=false") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.OK, resFalse.status)
        val entriesFalse = readZipEntries(resFalse.bodyAsBytes())
        val audioCount = entriesFalse.keys.count { it.startsWith("녹음/") }
        assertEquals(0, audioCount, "includeAudio=false must contain 0 audio files")
    }

    @Test
    fun `NX3 내보내기 → 가져오기 왕복(Round-trip) 테스트`() = testApplication {
        configureApiTestApp(dbConfig = dbConfig, storageClient = fakeStorage)

        val songId = UUID.randomUUID()
        val sessionId = UUID.randomUUID()
        val takeId = UUID.randomUUID()
        val takeAudioBytes = "roundtrip-audio-bytes".toByteArray(StandardCharsets.UTF_8)
        val storageKey = "$userA/$takeId.m4a"
        fakeStorage.objects[storageKey] = takeAudioBytes

        transaction(db) {
            SongsTable.insert {
                it[id] = songId
                it[userId] = userA
                it[title] = "RoundTrip Song"
                it[artist] = "RoundTrip Artist"
                it[status] = "practicing"
                it[videoId] = "dQw4w9WgXcQ"
                it[pos] = BigDecimal("10.5")
                it[a] = BigDecimal("38.0")
                it[b] = BigDecimal("55.2")
                it[rate] = BigDecimal("1.00")
                it[lastDate] = LocalDate.parse("2026-10-30")
                it[memo] = "보이싱 \"A\", 연습"
            }

            SessionsTable.insert {
                it[id] = sessionId
                it[userId] = userA
                it[this.songId] = songId
                it[date] = LocalDate.parse("2026-10-30")
                it[seconds] = 990
                it[loops] = 5
                it[rate] = BigDecimal("0.75")
                it[a] = BigDecimal("38.0")
                it[b] = BigDecimal("55.2")
                it[memo] = "세션 메모"
            }

            TakesTable.insert {
                it[id] = takeId
                it[userId] = userA
                it[this.sessionId] = sessionId
                it[this.songId] = songId
                it[recordedAt] = OffsetDateTime.parse("2026-10-30T14:22:10Z")
                it[a] = BigDecimal("38.0")
                it[b] = BigDecimal("55.2")
                it[rate] = BigDecimal("0.75")
                it[durationSec] = 30
                it[mime] = "audio/mp4"
                it[sizeBytes] = takeAudioBytes.size.toLong()
                it[storage] = "supabase"
                it[this.storageKey] = storageKey
                it[memo] = ""
            }

            // 리뷰 1번 검증용: 세션 2026-10-31 + recordedAt 2026-10-30T16:00:00Z (서울 10-31 01:00)
            val sessionId2 = UUID.randomUUID()
            val takeId2 = UUID.randomUUID()
            val takeAudioBytes2 = "roundtrip-audio-bytes-2".toByteArray(StandardCharsets.UTF_8)
            val storageKey2 = "$userA/$takeId2.m4a"
            fakeStorage.objects[storageKey2] = takeAudioBytes2

            SessionsTable.insert {
                it[id] = sessionId2
                it[userId] = userA
                it[this.songId] = songId
                it[date] = LocalDate.parse("2026-10-31")
                it[seconds] = 600
                it[loops] = 3
                it[rate] = BigDecimal("1.00")
                it[a] = BigDecimal("10.0")
                it[b] = BigDecimal("20.0")
                it[memo] = "두번째 세션 메모"
            }

            TakesTable.insert {
                it[id] = takeId2
                it[userId] = userA
                it[this.sessionId] = sessionId2
                it[this.songId] = songId
                it[recordedAt] = OffsetDateTime.parse("2026-10-30T16:00:00Z")
                it[a] = BigDecimal("10.0")
                it[b] = BigDecimal("20.0")
                it[rate] = BigDecimal("1.00")
                it[durationSec] = 20
                it[mime] = "audio/mp4"
                it[sizeBytes] = takeAudioBytes2.size.toLong()
                it[storage] = "supabase"
                it[this.storageKey] = storageKey2
                it[memo] = ""
            }
        }

        // A의 ZIP 내보내기
        val exportRes = client.get("/api/v1/export/zip?includeAudio=true") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        val exportZipBytes = exportRes.bodyAsBytes()

        // B 토큰으로 미리보기
        val previewRes = client.uploadZipFile(tokenB, exportZipBytes)
        assertEquals(HttpStatusCode.OK, previewRes.status)
        val previewJson = Json.parseToJsonElement(previewRes.bodyAsText()).jsonObject
        assertTrue(previewJson["ok"]!!.jsonPrimitive.boolean)
        val previewToken = previewJson["previewToken"]!!.jsonPrimitive.content
        assertEquals(1, previewJson["newSongs"]!!.jsonPrimitive.int)
        assertEquals(0, previewJson["updatedSongs"]!!.jsonPrimitive.int)
        assertEquals(2, previewJson["sessions"]!!.jsonPrimitive.int)
        assertEquals(2, previewJson["takes"]!!.jsonPrimitive.int)
        assertEquals(0, previewJson["errors"]!!.jsonArray.size)

        // ② confirm 전에는 B의 songs, sessions, takes 행이 0개
        val bSongsBefore = transaction(db) { SongsTable.selectAll().where { SongsTable.userId eq userB }.count() }
        val bSessionsBefore = transaction(db) { SessionsTable.selectAll().where { SessionsTable.userId eq userB }.count() }
        val bTakesBefore = transaction(db) { TakesTable.selectAll().where { TakesTable.userId eq userB }.count() }
        assertEquals(0L, bSongsBefore)
        assertEquals(0L, bSessionsBefore)
        assertEquals(0L, bTakesBefore)

        // ③ confirm
        val confirmRes = client.post("/api/v1/import/notion/confirm") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
            contentType(ContentType.Application.Json)
            setBody("""{"previewToken":"$previewToken"}""")
        }
        assertEquals(HttpStatusCode.OK, confirmRes.status)
        val confirmJson = Json.parseToJsonElement(confirmRes.bodyAsText()).jsonObject
        assertEquals(1, confirmJson["createdSongs"]!!.jsonPrimitive.int)
        assertEquals(2, confirmJson["upsertedSessions"]!!.jsonPrimitive.int)
        assertEquals(2, confirmJson["importedTakes"]!!.jsonPrimitive.int)

        // ④ B의 복원 데이터 확인
        val bSongs = transaction(db) { SongsTable.selectAll().where { SongsTable.userId eq userB }.toList() }
        assertEquals(1, bSongs.size)
        val bSong = bSongs[0]
        assertEquals("RoundTrip Song", bSong[SongsTable.title])
        assertEquals("RoundTrip Artist", bSong[SongsTable.artist])
        assertEquals("practicing", bSong[SongsTable.status])
        assertEquals(BigDecimal("38.0"), bSong[SongsTable.a])
        assertEquals(BigDecimal("55.2"), bSong[SongsTable.b])
        assertEquals("보이싱 \"A\", 연습", bSong[SongsTable.memo])

        val bSessions = transaction(db) { SessionsTable.selectAll().where { SessionsTable.userId eq userB }.toList() }
        assertEquals(2, bSessions.size)

        val bTakes = transaction(db) { TakesTable.selectAll().where { TakesTable.userId eq userB }.orderBy(TakesTable.recordedAt to org.jetbrains.exposed.sql.SortOrder.ASC).toList() }
        assertEquals(2, bTakes.size)
        val bTake1 = bTakes[0]
        assertEquals(OffsetDateTime.parse("2026-10-30T14:22:10Z"), bTake1[TakesTable.recordedAt])
        assertEquals(0, bTake1[TakesTable.durationSec])
        assertEquals("audio/mp4", bTake1[TakesTable.mime])
        assertEquals(BigDecimal("38.0"), bTake1[TakesTable.a])
        // 연습 기록.csv의 "0:38–0:55"에서 복원되므로 55.0
        assertEquals(BigDecimal("55.0"), bTake1[TakesTable.b])
        assertEquals(BigDecimal("0.75"), bTake1[TakesTable.rate])

        val bTake2 = bTakes[1]
        // 리뷰 1번 핵심: 세션 날짜는 10-31이지만 recordedAt(UTC)은 10-30T16:00:00Z로 온전하게 복원됨
        assertEquals(OffsetDateTime.parse("2026-10-30T16:00:00Z"), bTake2[TakesTable.recordedAt])
    }

    @Test
    fun `NX4 노션 백업 스타일 파일명(32자리 해시 접미어·서울 시각 오디오 파일명) 및 중첩 폴더 파싱`() = testApplication {
        configureApiTestApp(dbConfig = dbConfig, storageClient = fakeStorage)

        val songCsv = """
            ${ExportImportService.UTF8_BOM}곡명,아티스트,상태,유튜브 링크,이어서 연습,마지막 위치(초),구간 시작(초),구간 끝(초),속도,마지막 연습일,메모
            Autumn Leaves,Bill Evans,연습 중,https://www.youtube.com/watch?v=dQw4w9WgXcQ,,,,,,
        """.trimIndent()

        val sessionCsv = """
            ${ExportImportService.UTF8_BOM}기록,곡,날짜,연습 시간(분),반복 횟수,속도,구간,메모,녹음
            2026-10-30 Autumn Leaves,"Autumn Leaves (https://www.notion.so/Autumn-Leaves-1234)",2026-10-30,10,2,1.00,0:30–1:00,,"녹음/2026-10-30%201422%20Autumn%20Leaves.m4a"
        """.trimIndent()

        val audioBytes = "fake-seoul-audio".toByteArray(StandardCharsets.UTF_8)
        val zipBytes = createZip(
            mapOf(
                "연습 곡 959cbe517e224419b48ca3313895a427.csv" to songCsv.toByteArray(StandardCharsets.UTF_8),
                "연습 기록 6260633380b34d28989af90ddfbb4e67.csv" to sessionCsv.toByteArray(StandardCharsets.UTF_8),
                "녹음/2026-10-30 1422 Autumn Leaves.m4a" to audioBytes
            )
        )

        val previewRes = client.uploadZipFile(tokenB, zipBytes)
        assertEquals(HttpStatusCode.OK, previewRes.status)
        val previewJson = Json.parseToJsonElement(previewRes.bodyAsText()).jsonObject
        val previewToken = previewJson["previewToken"]!!.jsonPrimitive.content
        assertEquals(1, previewJson["newSongs"]!!.jsonPrimitive.int)
        assertEquals(1, previewJson["sessions"]!!.jsonPrimitive.int)
        assertEquals(1, previewJson["takes"]!!.jsonPrimitive.int)
        assertEquals(0, previewJson["errors"]!!.jsonArray.size)

        val confirmRes = client.post("/api/v1/import/notion/confirm") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
            contentType(ContentType.Application.Json)
            setBody("""{"previewToken":"$previewToken"}""")
        }
        assertEquals(HttpStatusCode.OK, confirmRes.status)

        val takes = transaction(db) { TakesTable.selectAll().where { TakesTable.userId eq userB }.toList() }
        assertEquals(1, takes.size)
        // 서울 14:22:00 -> UTC 05:22:00
        assertEquals(OffsetDateTime.parse("2026-10-30T05:22:00Z"), takes[0][TakesTable.recordedAt])
    }

    @Test
    fun `NX5 멱등성(2회 연속 가져오기) 및 기존 곡 갱신`() = testApplication {
        configureApiTestApp(dbConfig = dbConfig, storageClient = fakeStorage)

        val songCsv = """
            ${ExportImportService.UTF8_BOM}곡명,아티스트,상태,유튜브 링크,이어서 연습,마지막 위치(초),구간 시작(초),구간 끝(초),속도,마지막 연습일,메모
            Test Song,Artist,연습 중,https://www.youtube.com/watch?v=dQw4w9WgXcQ,,,,,,
        """.trimIndent()

        val sessionCsv = """
            ${ExportImportService.UTF8_BOM}기록,곡,날짜,연습 시간(분),반복 횟수,속도,구간,메모,녹음
            2026-10-30 Test Song,Test Song,2026-10-30,10,2,1.00,0:30–1:00,,take1.m4a
        """.trimIndent()

        val audioBytes = "fake-audio-bytes".toByteArray(StandardCharsets.UTF_8)
        val zipBytes = createZip(
            mapOf(
                "연습 곡.csv" to songCsv.toByteArray(StandardCharsets.UTF_8),
                "연습 기록.csv" to sessionCsv.toByteArray(StandardCharsets.UTF_8),
                "take1.m4a" to audioBytes
            )
        )

        // 1회차
        val p1 = client.uploadZipFile(tokenB, zipBytes)
        val token1 = Json.parseToJsonElement(p1.bodyAsText()).jsonObject["previewToken"]!!.jsonPrimitive.content
        client.post("/api/v1/import/notion/confirm") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
            contentType(ContentType.Application.Json)
            setBody("""{"previewToken":"$token1"}""")
        }

        // 2회차 preview
        val p2 = client.uploadZipFile(tokenB, zipBytes)
        val p2Json = Json.parseToJsonElement(p2.bodyAsText()).jsonObject
        assertEquals(0, p2Json["newSongs"]!!.jsonPrimitive.int)
        assertEquals(1, p2Json["updatedSongs"]!!.jsonPrimitive.int)

        // 2회차 confirm
        val token2 = p2Json["previewToken"]!!.jsonPrimitive.content
        val c2 = client.post("/api/v1/import/notion/confirm") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
            contentType(ContentType.Application.Json)
            setBody("""{"previewToken":"$token2"}""")
        }
        val c2Json = Json.parseToJsonElement(c2.bodyAsText()).jsonObject
        assertEquals(0, c2Json["createdSongs"]!!.jsonPrimitive.int)
        assertEquals(1, c2Json["updatedSongs"]!!.jsonPrimitive.int)
        assertEquals(1, c2Json["upsertedSessions"]!!.jsonPrimitive.int)
        assertEquals(0, c2Json["importedTakes"]!!.jsonPrimitive.int) // 중복으로 건너뜀

        // 총 데이터 행 수 확인 (불어나지 않음)
        val songCount = transaction(db) { SongsTable.selectAll().where { SongsTable.userId eq userB }.count() }
        val sessionCount = transaction(db) { SessionsTable.selectAll().where { SessionsTable.userId eq userB }.count() }
        val takeCount = transaction(db) { TakesTable.selectAll().where { TakesTable.userId eq userB }.count() }
        assertEquals(1L, songCount)
        assertEquals(1L, sessionCount)
        assertEquals(1L, takeCount)
    }

    @Test
    fun `NX6 파싱 오류 행 분리 (errors)`() = testApplication {
        configureApiTestApp(dbConfig = dbConfig, storageClient = fakeStorage)

        val songCsv = """
            ${ExportImportService.UTF8_BOM}곡명,아티스트,상태,유튜브 링크,이어서 연습,마지막 위치(초),구간 시작(초),구간 끝(초),속도,마지막 연습일,메모
            Good Song,Artist,연습 중,https://www.youtube.com/watch?v=dQw4w9WgXcQ,,,,,,
            Bad Song,Artist,연습 중,https://example.com/not-youtube,,,,,,
        """.trimIndent()

        val zipBytes = createZip(mapOf("연습 곡.csv" to songCsv.toByteArray(StandardCharsets.UTF_8)))
        val res = client.uploadZipFile(tokenB, zipBytes)
        assertEquals(HttpStatusCode.OK, res.status)

        val json = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        assertEquals(1, json["newSongs"]!!.jsonPrimitive.int)
        val errors = json["errors"]!!.jsonArray
        assertEquals(1, errors.size)
        val err = errors[0].jsonObject
        assertEquals(3, err["row"]!!.jsonPrimitive.int)
        assertTrue(err["reason"]!!.jsonPrimitive.content.contains("영상 ID"))
    }

    @Test
    fun `NX7 녹음 쿼터(200MB) 초과 시 녹음만 건너뜀`() = testApplication {
        configureApiTestApp(dbConfig = dbConfig, storageClient = fakeStorage)

        // B의 쿼터를 500바이트로 축소
        transaction(db) {
            ProfilesTable.update({ ProfilesTable.id eq userB }) {
                it[takeQuotaBytes] = 500L
            }
        }

        val songCsv = """
            ${ExportImportService.UTF8_BOM}곡명,아티스트,상태,유튜브 링크,이어서 연습,마지막 위치(초),구간 시작(초),구간 끝(초),속도,마지막 연습일,메모
            Song Quota,Artist,연습 중,https://www.youtube.com/watch?v=dQw4w9WgXcQ,,,,,,
        """.trimIndent()

        val sessionCsv = """
            ${ExportImportService.UTF8_BOM}기록,곡,날짜,연습 시간(분),반복 횟수,속도,구간,메모,녹음
            2026-10-30 Song Quota,Song Quota,2026-10-30,10,2,1.00,0:30–1:00,,heavy.m4a
        """.trimIndent()

        val heavyAudio = ByteArray(1000) { 1 }
        val zipBytes = createZip(
            mapOf(
                "연습 곡.csv" to songCsv.toByteArray(StandardCharsets.UTF_8),
                "연습 기록.csv" to sessionCsv.toByteArray(StandardCharsets.UTF_8),
                "heavy.m4a" to heavyAudio
            )
        )

        val previewRes = client.uploadZipFile(tokenB, zipBytes)
        val previewToken = Json.parseToJsonElement(previewRes.bodyAsText()).jsonObject["previewToken"]!!.jsonPrimitive.content

        val confirmRes = client.post("/api/v1/import/notion/confirm") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
            contentType(ContentType.Application.Json)
            setBody("""{"previewToken":"$previewToken"}""")
        }
        assertEquals(HttpStatusCode.OK, confirmRes.status)
        val confirmJson = Json.parseToJsonElement(confirmRes.bodyAsText()).jsonObject
        assertEquals(1, confirmJson["createdSongs"]!!.jsonPrimitive.int)
        assertEquals(1, confirmJson["upsertedSessions"]!!.jsonPrimitive.int)
        assertEquals(0, confirmJson["importedTakes"]!!.jsonPrimitive.int)
        assertEquals(1, confirmJson["skippedTakesByQuota"]!!.jsonPrimitive.int)
    }

    @Test
    fun `NX8 잘못된 입력 및 만료·타 사용자 previewToken 거부`() = testApplication {
        configureApiTestApp(dbConfig = dbConfig, storageClient = fakeStorage)

        // ① 빈 파일 preview
        val resEmpty = client.uploadZipFile(tokenA, byteArrayOf())
        assertEquals(HttpStatusCode.BadRequest, resEmpty.status)
        assertStandardError(resEmpty.bodyAsText(), 400, "INVALID_INPUT")

        // ② 연습 곡.csv 없는 ZIP preview
        val zipNoSong = createZip(mapOf("dummy.txt" to "hello".toByteArray(StandardCharsets.UTF_8)))
        val resNoSong = client.uploadZipFile(tokenA, zipNoSong)
        assertEquals(HttpStatusCode.BadRequest, resNoSong.status)
        assertStandardError(resNoSong.bodyAsText(), 400, "INVALID_INPUT")

        // A의 정상 previewToken 발급
        val validSongCsv = """
            ${ExportImportService.UTF8_BOM}곡명,아티스트,상태,유튜브 링크,이어서 연습,마지막 위치(초),구간 시작(초),구간 끝(초),속도,마지막 연습일,메모
            Valid Song,Artist,연습 중,https://www.youtube.com/watch?v=dQw4w9WgXcQ,,,,,,
        """.trimIndent()
        val validZip = createZip(mapOf("연습 곡.csv" to validSongCsv.toByteArray(StandardCharsets.UTF_8)))
        val pA = client.uploadZipFile(tokenA, validZip)
        val tokenA_preview = Json.parseToJsonElement(pA.bodyAsText()).jsonObject["previewToken"]!!.jsonPrimitive.content

        // ③ B 토큰으로 A의 previewToken confirm -> 404
        val resBConfirmA = client.post("/api/v1/import/notion/confirm") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
            contentType(ContentType.Application.Json)
            setBody("""{"previewToken":"$tokenA_preview"}""")
        }
        assertEquals(HttpStatusCode.NotFound, resBConfirmA.status)
        assertStandardError(resBConfirmA.bodyAsText(), 404, "NOT_FOUND")

        // A가 confirm 정상 실행
        val resAConfirm = client.post("/api/v1/import/notion/confirm") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("""{"previewToken":"$tokenA_preview"}""")
        }
        assertEquals(HttpStatusCode.OK, resAConfirm.status)

        // ④ 이미 사용한 previewToken 재호출 -> 404
        val resAReuse = client.post("/api/v1/import/notion/confirm") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
            contentType(ContentType.Application.Json)
            setBody("""{"previewToken":"$tokenA_preview"}""")
        }
        assertEquals(HttpStatusCode.NotFound, resAReuse.status)
        assertStandardError(resAReuse.bodyAsText(), 404, "NOT_FOUND")
    }

    @Test
    fun `NX9 Zip Bomb 방어 (압축 해제 한도 초과)`() = testApplication {
        configureApiTestApp(dbConfig = dbConfig, storageClient = fakeStorage)

        // 제로 바이트를 매우 크게 압축
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { zos ->
            zos.putNextEntry(ZipEntry("bomb.txt"))
            val zeroChunk = ByteArray(1024 * 1024) { 0 }
            // 210MB 분량 쓰기
            for (i in 0 until 210) {
                zos.write(zeroChunk)
            }
            zos.closeEntry()
        }
        val bombBytes = out.toByteArray()

        val res = client.uploadZipFile(tokenA, bombBytes)
        assertEquals(HttpStatusCode.BadRequest, res.status)
        assertStandardError(res.bodyAsText(), 400, "INVALID_INPUT")
    }

    @Test
    fun `NX10 토큰 없음`() = testApplication {
        configureApiTestApp(dbConfig = dbConfig, storageClient = fakeStorage)

        val resGet = client.get("/api/v1/export/zip")
        assertEquals(HttpStatusCode.Unauthorized, resGet.status)
        assertStandardError(resGet.bodyAsText(), 401, "UNAUTHORIZED")

        val resPreview = client.uploadZipFile(null, byteArrayOf(1, 2, 3))
        assertEquals(HttpStatusCode.Unauthorized, resPreview.status)
        assertStandardError(resPreview.bodyAsText(), 401, "UNAUTHORIZED")

        val resConfirm = client.post("/api/v1/import/notion/confirm") {
            contentType(ContentType.Application.Json)
            setBody("""{"previewToken":"00000000-0000-4000-8000-000000000001"}""")
        }
        assertEquals(HttpStatusCode.Unauthorized, resConfirm.status)
        assertStandardError(resConfirm.bodyAsText(), 401, "UNAUTHORIZED")
    }

    @Test
    fun `NX11 노션 폴더별 동일 파일명 오디오의 전체 경로 매칭 및 중복 단순 파일명 에러 검증`() = testApplication {
        configureApiTestApp(dbConfig = dbConfig, storageClient = fakeStorage)

        val songCsv = """
            ${ExportImportService.UTF8_BOM}곡명,아티스트,상태,유튜브 링크,이어서 연습,마지막 위치(초),구간 시작(초),구간 끝(초),속도,마지막 연습일,메모
            Autumn Leaves,Bill Evans,연습 중,https://www.youtube.com/watch?v=dQw4w9WgXcQ,,,,,,
        """.trimIndent()

        // session 1: 경로 지정 "기록A/Rec.m4a" -> 폴더 A 바이트 매칭
        // session 2: 경로 지정 "기록B/Rec.m4a" -> 폴더 B 바이트 매칭
        // session 3: 단순 파일명 "Rec.m4a" -> ZIP 내에 2개 존재하므로 충돌 에러
        val sessionCsv = """
            ${ExportImportService.UTF8_BOM}기록,곡,날짜,연습 시간(분),반복 횟수,속도,구간,메모,녹음
            2026-10-30 Autumn Leaves,Autumn Leaves,2026-10-30,10,2,1.00,0:30–1:00,,"기록A/Rec.m4a"
            2026-10-31 Autumn Leaves,Autumn Leaves,2026-10-31,15,3,1.00,0:30–1:00,,"기록B/Rec.m4a"
            2026-11-01 Autumn Leaves,Autumn Leaves,2026-11-01,20,4,1.00,0:30–1:00,,"Rec.m4a"
        """.trimIndent()

        val audioA = "audio-bytes-A".toByteArray(StandardCharsets.UTF_8)
        val audioB = "audio-bytes-B".toByteArray(StandardCharsets.UTF_8)

        val zipBytes = createZip(
            mapOf(
                "연습 곡.csv" to songCsv.toByteArray(StandardCharsets.UTF_8),
                "연습 기록.csv" to sessionCsv.toByteArray(StandardCharsets.UTF_8),
                "기록A/Rec.m4a" to audioA,
                "기록B/Rec.m4a" to audioB
            )
        )

        val previewRes = client.uploadZipFile(tokenB, zipBytes)
        assertEquals(HttpStatusCode.OK, previewRes.status)
        val previewJson = Json.parseToJsonElement(previewRes.bodyAsText()).jsonObject
        assertEquals(2, previewJson["takes"]!!.jsonPrimitive.int)
        val errors = previewJson["errors"]!!.jsonArray
        assertEquals(1, errors.size)
        val errObj = errors[0].jsonObject
        assertEquals(4, errObj["row"]!!.jsonPrimitive.int) // 3번째 데이터 행 (헤더=1이므로 4행)
        assertTrue(errObj["reason"]!!.jsonPrimitive.content.contains("녹음 파일 이름이 ZIP 안에서 겹쳐 연결할 수 없습니다"))

        val previewToken = previewJson["previewToken"]!!.jsonPrimitive.content
        val confirmRes = client.post("/api/v1/import/notion/confirm") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
            contentType(ContentType.Application.Json)
            setBody("""{"previewToken":"$previewToken"}""")
        }
        assertEquals(HttpStatusCode.OK, confirmRes.status)
        val confirmJson = Json.parseToJsonElement(confirmRes.bodyAsText()).jsonObject
        assertEquals(2, confirmJson["importedTakes"]!!.jsonPrimitive.int)

        // DB에 저장된 각 take의 바이트가 실제 A, B에 각각 올바르게 저장되었는지 확인
        val bTakes = transaction(db) {
            TakesTable.selectAll()
                .where { TakesTable.userId eq userB }
                .orderBy(TakesTable.recordedAt to org.jetbrains.exposed.sql.SortOrder.ASC)
                .toList()
        }
        assertEquals(2, bTakes.size)
        assertContentEquals(audioA, fakeStorage.objects[bTakes[0][TakesTable.storageKey]])
        assertContentEquals(audioB, fakeStorage.objects[bTakes[1][TakesTable.storageKey]])
    }
}
