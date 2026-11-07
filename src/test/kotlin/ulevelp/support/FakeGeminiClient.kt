package ulevelp.support

import kotlinx.serialization.json.*
import ulevelp.note.AnalyzeJobDispatcher
import ulevelp.note.GeminiClient
import ulevelp.note.GeminiGenerateResult
import ulevelp.note.GeminiVideoOptions
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList

class FakeGeminiClient : GeminiClient {
    val calls = CopyOnWriteArrayList<Triple<String, String, String>>()
    var handler: (suspend (apiKey: String, model: String, youtubeUrl: String, prompt: String, schema: JsonObject) -> GeminiGenerateResult)? = null
    var defaultResult: GeminiGenerateResult? = null
    /** 호출마다 받은 영상 옵션(GA-2). null이면 옵션 없이 호출됨 */
    val videoOptionsCalls = CopyOnWriteArrayList<GeminiVideoOptions?>()

    override suspend fun generateNoteAnalysis(
        apiKey: String,
        model: String,
        youtubeUrl: String,
        prompt: String,
        responseJsonSchema: JsonObject,
        videoOptions: GeminiVideoOptions?
    ): GeminiGenerateResult {
        calls.add(Triple(apiKey, model, youtubeUrl))
        videoOptionsCalls.add(videoOptions)
        val customHandler = handler
        if (customHandler != null) {
            return customHandler(apiKey, model, youtubeUrl, prompt, responseJsonSchema)
        }
        val preset = defaultResult
        if (preset != null) {
            return preset
        }
        return defaultSuccessResult()
    }

    companion object {
        fun defaultSuccessResult(): GeminiGenerateResult {
            val analysis = buildJsonObject {
                putJsonObject("summary") {
                    put("headline", "재즈 기타 2-5-1 핵심 보이싱 정리")
                    putJsonArray("points") {
                        addJsonObject {
                            put("point", "3도·7도 가이드톤 최소 이동")
                            putJsonArray("details") {
                                add(kotlinx.serialization.json.JsonPrimitive("부드러운 성부 연결"))
                            }
                        }
                    }
                }
                putJsonArray("key_concepts") {
                    add(kotlinx.serialization.json.JsonPrimitive("가이드톤"))
                    add(kotlinx.serialization.json.JsonPrimitive("2-5-1"))
                }
                put("difficulty", "중급")
                putJsonArray("moments") {
                    addJsonObject {
                        put("timestamp", "2:15")
                        put("point", "G7(b9) 텐션 설명")
                    }
                }
                putJsonArray("practice") {
                    add(kotlinx.serialization.json.JsonPrimitive("12키 가이드톤 연결 연습"))
                }
            }
            return GeminiGenerateResult(analysis = analysis, usageSummary = "{\"promptTokens\":100}")
        }
    }
}

class FakeAnalyzeJobDispatcher(
    val autoExecute: Boolean = false,
    val runner: (suspend (UUID) -> Unit)? = null
) : AnalyzeJobDispatcher {
    val dispatched = CopyOnWriteArrayList<UUID>()
    var handler: (suspend (UUID) -> Unit)? = null

    override suspend fun dispatch(jobId: UUID) {
        dispatched.add(jobId)
        val customHandler = handler
        if (customHandler != null) {
            customHandler(jobId)
            return
        }
        if (autoExecute && runner != null) {
            runner.invoke(jobId)
        }
    }
}
