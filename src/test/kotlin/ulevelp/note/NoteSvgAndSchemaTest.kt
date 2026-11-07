package ulevelp.note

import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.*

class NoteSvgAndSchemaTest {

    @Test
    fun sv1_guitarSvgRenderer_openAndBarre_degreesAndSvg() {
        val cmaj7Frets = listOf("x", "3", "2", "0", "0", "0")
        val cmaj7Parsed = GuitarSvgRenderer.parseFrets(cmaj7Frets)
        assertNotNull(cmaj7Parsed)
        val cmaj7Degs = GuitarSvgRenderer.degrees("Cmaj7", cmaj7Parsed)
        assertEquals(listOf(null, "R", "3", "5", "7", "3"), cmaj7Degs)

        val g7b9Frets = listOf("3", "x", "3", "4", "3", "4")
        val g7b9Parsed = GuitarSvgRenderer.parseFrets(g7b9Frets)
        assertNotNull(g7b9Parsed)
        val g7b9Degs = GuitarSvgRenderer.degrees("G7(b9)", g7b9Parsed)
        assertEquals(listOf("R", null, "b7", "3", "5", "b9"), g7b9Degs)

        val chords = listOf(
            HarmonyChordDto(symbol = "Cmaj7", frets = cmaj7Frets),
            HarmonyChordDto(symbol = "G7(b9)", frets = g7b9Frets)
        )
        val svg = GuitarSvgRenderer.progressionSvg(chords)
        assertNotNull(svg)
        assertTrue(svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\""))
        assertTrue(svg.contains("fill=\"#e8590c\""))
        assertTrue(svg.contains("Cmaj7"))
        assertTrue(svg.contains("G7(b9)"))
    }

    @Test
    fun sv2_guitarSvgRenderer_highFretsAndEmpty() {
        val dmFrets = listOf("x", "5", "7", "7", "6", "5")
        val chords = listOf(HarmonyChordDto(symbol = "Dm", frets = dmFrets))
        val svg = GuitarSvgRenderer.progressionSvg(chords)
        assertNotNull(svg)
        assertTrue(svg.contains("5fr"))

        val emptyChords = listOf(HarmonyChordDto(symbol = "None", frets = listOf("x", "x", "x", "x", "x", "x")))
        val nullSvg = GuitarSvgRenderer.progressionSvg(emptyChords)
        assertNull(nullSvg)
    }

    @Test
    fun sv3_keyboardSvgRenderer_midiAndSplitLegend() {
        assertEquals(66, KeyboardSvgRenderer.midi("Gb4"))
        assertEquals(60, KeyboardSvgRenderer.midi("C4"))
        assertNull(KeyboardSvgRenderer.midi("invalid"))

        val chords = listOf(
            HarmonyChordDto(
                symbol = "Dm9",
                split = true,
                lh = listOf("D3", "C4"),
                rh = listOf("F4", "A4", "E5")
            )
        )
        val svg = KeyboardSvgRenderer.progressionSvg(chords)
        assertNotNull(svg)
        assertTrue(svg.contains("#4263eb")) // LH 색상
        assertTrue(svg.contains("#f08c00")) // RH 색상
        assertTrue(svg.contains(">LH<"))
        assertTrue(svg.contains(">RH<"))
        assertTrue(svg.contains(">D3<"))
        assertTrue(svg.contains(">C4<"))
        assertTrue(svg.contains(">F4<"))
        assertTrue(svg.contains(">A4<"))
        assertTrue(svg.contains(">E5<"))
    }

    @Test
    fun sv4_keyboardSvgRenderer_noSplitAndEmpty() {
        val chords = listOf(
            HarmonyChordDto(
                symbol = "G13",
                split = false,
                lh = emptyList(),
                rh = listOf("G3", "F4", "B4", "E5")
            )
        )
        val svg = KeyboardSvgRenderer.progressionSvg(chords)
        assertNotNull(svg)
        assertFalse(svg.contains(">LH<"))
        assertFalse(svg.contains(">RH<"))
        assertTrue(svg.contains("#2f9e44")) // ALL 색상

        val emptyChords = listOf(HarmonyChordDto(symbol = "Empty", split = false, lh = emptyList(), rh = emptyList()))
        assertNull(KeyboardSvgRenderer.progressionSvg(emptyChords))
    }

    @Test
    fun sv5_geminiSchemas_buildPrompt_dynamicComposition() {
        val tags = listOf("화성", "믹싱")
        val memo = "보이싱 위주"
        val (schema, prompt) = GeminiSchemas.buildPrompt(tags, memo)

        val properties = schema["properties"]?.jsonObject
        assertNotNull(properties)
        // 공통 5개 + harmony + mixing
        val expectedKeys = setOf("summary", "key_concepts", "difficulty", "moments", "practice", "harmony", "mixing")
        assertEquals(expectedKeys, properties.keys)

        assertFalse(properties.containsKey("sound_design"))
        assertFalse(properties.containsKey("daw"))
        assertFalse(properties.containsKey("rhythm"))
        assertFalse(properties.containsKey("arrangement"))

        assertTrue(prompt.contains("분류 태그: 화성, 믹싱"))
        assertTrue(prompt.contains("사용자 메모(특히 신경 써서 볼 부분): 보이싱 위주"))
    }

    private fun progressionItem(schema: JsonObject): JsonObject =
        schema["properties"]!!.jsonObject["harmony"]!!.jsonObject["properties"]!!.jsonObject["progressions"]!!
            .jsonObject["items"]!!.jsonObject

    @Test
    fun sv5b_geminiSchemas_buildProgressionPrompt_extendsHarmonyOnly() {
        val (schema, prompt) = GeminiSchemas.buildProgressionPrompt("후렴 위주")

        // 공통 5개 + harmony만
        assertEquals(
            setOf("summary", "key_concepts", "difficulty", "moments", "practice", "harmony"),
            schema["properties"]!!.jsonObject.keys
        )
        val item = progressionItem(schema)
        val expected = listOf("name", "song", "artist", "key", "instrument", "start", "end", "chords")
        assertEquals(expected, item["properties"]!!.jsonObject.keys.toList())
        assertEquals(expected, item["required"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertTrue(item["properties"]!!.jsonObject["key"]!!.jsonObject["description"]!!.jsonPrimitive.content.contains("A min"))
        // 코드 객체는 기존 화성 스키마와 같다 (노트 다이어그램 렌더러 재사용)
        val (noteSchema, notePrompt) = GeminiSchemas.buildPrompt(listOf("화성"), "후렴 위주")
        val noteItem = progressionItem(noteSchema)
        assertEquals(noteItem["properties"]!!.jsonObject["chords"], item["properties"]!!.jsonObject["chords"])
        assertEquals(schema["properties"]!!.jsonObject["harmony"]!!.jsonObject["properties"]!!.jsonObject["concepts"],
            noteSchema["properties"]!!.jsonObject["harmony"]!!.jsonObject["properties"]!!.jsonObject["concepts"])

        // 일반 노트 화성 스키마는 그대로 (회귀 방지)
        assertEquals(listOf("name", "key", "instrument", "chords"), noteItem["properties"]!!.jsonObject.keys.toList())
        assertFalse(notePrompt.contains("[코드 진행]"))

        assertTrue(prompt.contains("분류 태그: 화성\n"))
        assertTrue(prompt.contains("- [코드 진행] 이 영상은 코드 진행을"))
        assertTrue(prompt.contains("maj7/M7/Δ"))
        assertTrue(prompt.contains("\n- [화성] 코드 진행은 코드 단위로 빠짐없이"))
        assertTrue(prompt.indexOf("[코드 진행]") < prompt.indexOf("[화성]"))
        assertTrue(prompt.endsWith("사용자 메모(특히 신경 써서 볼 부분): 후렴 위주"))
        assertFalse(GeminiSchemas.buildProgressionPrompt("  ").second.contains("사용자 메모"))
    }

    @Test
    fun sv6_notionNoteBlockBuilder_secondsAndTsLink() {
        assertEquals(135, NotionNoteBlockBuilder.seconds("2:15"))
        assertEquals(3723, NotionNoteBlockBuilder.seconds("1:02:03"))
        assertNull(NotionNoteBlockBuilder.seconds("알수없음"))
        assertNull(NotionNoteBlockBuilder.seconds("99999999999:00"))

        // text("") 빈 문자열은 원본 analyze.py처럼 빈 배열 반환 검증
        assertTrue(NotionNoteBlockBuilder.text("").isEmpty())
        assertTrue(NotionNoteBlockBuilder.text(null).isEmpty())

        val url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        val linkRich = NotionNoteBlockBuilder.tsLink(url, "2:15")
        val firstElem = linkRich.first().jsonObject
        val textObj = firstElem["text"]?.jsonObject
        val linkObj = textObj?.get("link")?.jsonObject
        assertEquals("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=135s", linkObj?.get("url")?.jsonPrimitive?.content)

        val noLinkRich = NotionNoteBlockBuilder.tsLink(url, "알수없음")
        assertEquals(JsonNull, noLinkRich.first().jsonObject["text"]?.jsonObject?.get("link"))
    }

    @Test
    fun sv7_notionNoteBlockBuilder_buildBlocksAndProperties() {
        val url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        val tags = listOf("화성", "리듬")
        val analysis = buildJsonObject {
            putJsonObject("summary") {
                put("headline", "헤드라인 요약")
                putJsonArray("points") {
                    addJsonObject {
                        put("point", "요점 1")
                        putJsonArray("details") { add(JsonPrimitive("세부내용")) }
                    }
                }
            }
            putJsonArray("key_concepts") {
                add(JsonPrimitive("개념1"))
                add(JsonPrimitive("개념2"))
            }
            put("difficulty", "중급")
            putJsonObject("harmony") {
                putJsonArray("progressions") {
                    addJsonObject {
                        put("name", "진행1")
                        put("key", "C")
                        put("instrument", "건반")
                        putJsonArray("chords") {
                            addJsonObject {
                                put("symbol", "Cmaj7")
                                put("roman", "Imaj7")
                                put("function", "T")
                                put("split", false)
                                putJsonArray("lh") {}
                                putJsonArray("rh") { add(JsonPrimitive("C4")) }
                                putJsonArray("frets") {}
                                put("voicing_note", "")
                                put("nuance", "밝음")
                                put("source", "화면")
                                put("timestamp", "0:30")
                            }
                        }
                    }
                }
                putJsonArray("concepts") {}
            }
            putJsonObject("rhythm") {
                putJsonArray("patterns") {
                    addJsonObject {
                        put("name", "패턴1")
                        put("time_signature", "4/4")
                        put("grid", "x---x---x---x---")
                        put("feel", "스트레이트")
                        put("source", "말함")
                        put("timestamp", "1:00")
                    }
                }
                putJsonArray("concepts") {}
            }
            putJsonArray("moments") {
                addJsonObject {
                    put("timestamp", "1:30")
                    put("point", "클라이맥스")
                }
            }
            putJsonArray("practice") {
                add(JsonPrimitive("매일 10분 연습"))
            }
        }

        val blocks = NotionNoteBlockBuilder.buildBlocks(
            url = url,
            tags = tags,
            analysis = analysis,
            harmonyUploadIds = listOf("upload-1")
        )

        // 1. video
        assertEquals("video", blocks[0]["type"]?.jsonPrimitive?.content)
        // 2. callout
        assertEquals("callout", blocks[1]["type"]?.jsonPrimitive?.content)
        assertEquals("📝", blocks[1]["callout"]?.jsonObject?.get("icon")?.jsonObject?.get("emoji")?.jsonPrimitive?.content)

        // 화성 및 이미지 블록 검사
        assertTrue(blocks.any { it["type"]?.jsonPrimitive?.content == "table" })
        val imageBlock = blocks.find { it["type"]?.jsonPrimitive?.content == "image" }
        assertNotNull(imageBlock)
        assertEquals("upload-1", imageBlock["image"]?.jsonObject?.get("file_upload")?.jsonObject?.get("id")?.jsonPrimitive?.content)

        // 리듬 code 블록
        val codeBlock = blocks.find { it["type"]?.jsonPrimitive?.content == "code" }
        assertNotNull(codeBlock)
        assertEquals("x---x---x---x---", codeBlock["code"]?.jsonObject?.get("rich_text")?.jsonArray?.first()?.jsonObject?.get("text")?.jsonObject?.get("content")?.jsonPrimitive?.content)

        // to_do 블록
        val todoBlock = blocks.find { it["type"]?.jsonPrimitive?.content == "to_do" }
        assertNotNull(todoBlock)
        assertEquals("매일 10분 연습", todoBlock["to_do"]?.jsonObject?.get("rich_text")?.jsonArray?.first()?.jsonObject?.get("text")?.jsonObject?.get("content")?.jsonPrimitive?.content)

        // 마지막 블록
        val lastBlock = blocks.last()
        assertEquals("paragraph", lastBlock["type"]?.jsonPrimitive?.content)

        // buildPageProperties 검사
        val props = NotionNoteBlockBuilder.buildPageProperties(
            url = url,
            tags = tags,
            memo = "메모 내용",
            title = "영상 제목",
            channel = "채널 이름",
            headline = "헤드라인 요약",
            keywords = listOf("개념1", "개념2"),
            difficulty = "중급"
        )
        assertNotNull(props["제목"])
        assertNotNull(props["URL"])
        assertNotNull(props["태그"])
        assertNotNull(props["난이도"])
        assertEquals("중급", props["난이도"]?.jsonObject?.get("select")?.jsonObject?.get("name")?.jsonPrimitive?.content)
    }

    @Test
    fun sv8_httpGeminiClient_retryAndErrorClassification() = runBlocking {
        val callCount = AtomicInteger(0)
        val server = HttpServer.create(InetSocketAddress(0), 0)

        server.createContext("/models/gemini-flash-latest:generateContent") { exchange ->
            val count = callCount.incrementAndGet()
            when (count) {
                1 -> {
                    exchange.sendResponseHeaders(503, 0)
                    exchange.responseBody.write("Service Unavailable".toByteArray())
                    exchange.responseBody.close()
                }
                2 -> {
                    exchange.sendResponseHeaders(429, 0)
                    exchange.responseBody.write("Resource Exhausted".toByteArray())
                    exchange.responseBody.close()
                }
                3 -> {
                    val resp = buildJsonObject {
                        putJsonArray("candidates") {
                            addJsonObject {
                                putJsonObject("content") {
                                    putJsonArray("parts") {
                                        addJsonObject {
                                            put("text", "{\"summary\":{\"headline\":\"성공\"}}")
                                        }
                                    }
                                }
                            }
                        }
                    }.toString()
                    exchange.responseHeaders.add("Content-Type", "application/json")
                    val bytes = resp.toByteArray()
                    exchange.sendResponseHeaders(200, bytes.size.toLong())
                    exchange.responseBody.write(bytes)
                    exchange.responseBody.close()
                }
                4 -> {
                    // 키 무효 오류
                    val err = "{\"error\":{\"code\":400,\"message\":\"API_KEY_INVALID\"}}"
                    val bytes = err.toByteArray()
                    exchange.sendResponseHeaders(400, bytes.size.toLong())
                    exchange.responseBody.write(bytes)
                    exchange.responseBody.close()
                }
                5 -> {
                    // 일반 400 오류 (비공개 영상 등)
                    val err = "{\"error\":{\"code\":400,\"message\":\"Video is private or unavailable.\"}}"
                    val bytes = err.toByteArray()
                    exchange.sendResponseHeaders(400, bytes.size.toLong())
                    exchange.responseBody.write(bytes)
                    exchange.responseBody.close()
                }
            }
        }
        server.start()
        val port = server.address.port

        try {
            val client = HttpGeminiClient(
                baseUrl = "http://127.0.0.1:$port",
                retryDelayBaseMs = 5L
            )

            // ① 1, 2차 실패 후 3차 성공
            val result = client.generateNoteAnalysis("valid-key", "gemini-flash-latest", "https://youtube.com", "prompt", buildJsonObject {})
            assertEquals(3, callCount.get())
            assertEquals("성공", result.analysis["summary"]?.jsonObject?.get("headline")?.jsonPrimitive?.content)

            // ② API_KEY_INVALID 포함 400
            val keyEx = assertFailsWith<GeminiApiException> {
                client.generateNoteAnalysis("bad-key", "gemini-flash-latest", "https://youtube.com", "prompt", buildJsonObject {})
            }
            assertEquals(4, callCount.get()) // 재시도 없이 1회만
            assertEquals("PROVIDER_KEY_INVALID", keyEx.code)
            assertTrue(keyEx.message.startsWith("PROVIDER_KEY_INVALID:"))

            // ③ API_KEY_INVALID 없는 일반 400
            val normalEx = assertFailsWith<GeminiApiException> {
                client.generateNoteAnalysis("valid-key", "gemini-flash-latest", "https://youtube.com", "prompt", buildJsonObject {})
            }
            assertEquals(5, callCount.get()) // 재시도 없이 1회만
            assertEquals("GEMINI_API_ERROR", normalEx.code)
            assertFalse(normalEx.message.startsWith("PROVIDER_KEY_INVALID:"))
        } finally {
            server.stop(0)
        }
    }
}

