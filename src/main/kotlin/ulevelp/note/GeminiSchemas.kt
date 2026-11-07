package ulevelp.note

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

@Serializable
data class HarmonyChordDto(
    val symbol: String = "",
    val roman: String = "",
    val function: String = "",
    val split: Boolean = false,
    val lh: List<String> = emptyList(),
    val rh: List<String> = emptyList(),
    val frets: List<String> = emptyList(),
    @SerialName("voicing_note") val voicingNote: String = "",
    val nuance: String = "",
    val source: String = "",
    val timestamp: String = ""
)

@Serializable
data class HarmonyProgressionDto(
    val name: String = "",
    val key: String = "",
    val instrument: String = "건반",
    val chords: List<HarmonyChordDto> = emptyList()
)

object GeminiSchemas {
    /** 분석 요청(POST /api/v1/notes/analyze)에서 선택 가능한 6개 태그 (scripts/schemas.py TAGS 순서 고정) */
    val TAGS: List<String> = listOf("화성", "사운드 디자인", "DAW/MIDI", "리듬", "편곡", "믹싱")

    /** 노트 수정(PATCH /api/v1/notes/{id}) 및 목록 필터(GET /api/v1/notes?tag=)에서 허용하는 7개 태그 (docs/04 4.3절) */
    val ALLOWED_NOTE_TAGS: Set<String> = (TAGS + "TAB").toSet()

    /** 태그 이름 -> JSON 필드명 매핑 */
    val SECTION_FIELDS: Map<String, String> = mapOf(
        "화성" to "harmony",
        "사운드 디자인" to "sound_design",
        "DAW/MIDI" to "daw",
        "리듬" to "rhythm",
        "편곡" to "arrangement",
        "믹싱" to "mixing"
    )

    const val PROMPT_TEMPLATE: String = """당신은 음악 이론·작곡·프로듀싱 강의를 정리하는 조교입니다.
이 유튜브 영상을 보고 학습 노트용 데이터를 JSON으로 추출하세요.

규칙:
- 모든 설명은 한국어로 쓰고, 코드 심볼·플러그인 이름 같은 고유 표기는 원문 그대로 둡니다.
- 모든 설명은 개조식으로 짧게 씁니다. "~합니다/~입니다" 문장이나 접속사로 이어 붙이지 말고 명사구로 끝냅니다.
  예) "부드러운 연결감과 자연스러운 하행 뉘앙스", "도미넌트 긴장감 유지한 채 색다른 종지"
- 영상의 말, 화면(자막, 피아노롤, 악보, 건반, 플러그인 화면)을 모두 근거로 씁니다.
- source 필드가 있는 항목은 근거를 정직하게 표시합니다. 소리만 듣고 짐작한 것은 반드시 "추정"입니다.
- 영상에 없는 내용을 지어내지 마세요. 해당 내용이 없으면 빈 배열이나 빈 문자열로 둡니다.
- timestamp는 가능한 한 채워서 나중에 그 구간으로 바로 갈 수 있게 합니다.

분류 태그: {tags}
태그별 지시:
{guides}{memo}"""

    private fun arr(items: JsonObject, description: String? = null): JsonObject = buildJsonObject {
        put("type", "array")
        if (description != null) put("description", description)
        put("items", items)
    }

    private fun obj(props: Map<String, JsonObject>, required: List<String>? = null): JsonObject = buildJsonObject {
        put("type", "object")
        putJsonObject("properties") {
            for ((k, v) in props) {
                put(k, v)
            }
        }
        putJsonArray("required") {
            val reqList = required ?: props.keys.toList()
            reqList.forEach { add(JsonPrimitive(it)) }
        }
    }

    private val sourceSchema = buildJsonObject {
        put("type", "string")
        putJsonArray("enum") {
            add(JsonPrimitive("말함"))
            add(JsonPrimitive("화면"))
            add(JsonPrimitive("추정"))
        }
        put("description", "근거: 강사가 직접 말함 / 화면(자막·피아노롤·악보·건반)에 보임 / 소리만 듣고 추정")
    }

    private val timestampSchema = buildJsonObject {
        put("type", "string")
        put("description", "영상 내 위치, mm:ss 또는 h:mm:ss. 모르면 빈 문자열")
    }

    private val noteSchema = buildJsonObject {
        put("type", "string")
        put("description", "옥타브 포함 음이름, 가운데 도 = C4 (예: Gb4, F#3)")
    }

    private val sSchema = buildJsonObject {
        put("type", "string")
    }

    private val commonSchemas: Map<String, JsonObject> = mapOf(
        "summary" to obj(
            mapOf(
                "headline" to buildJsonObject {
                    put("type", "string")
                    put("description", "영상 전체 핵심 한 줄. 개조식")
                },
                "points" to arr(
                    obj(
                        mapOf(
                            "point" to buildJsonObject {
                                put("type", "string")
                                put("description", "핵심 요점 하나. 개조식 명사구")
                            },
                            "details" to arr(sSchema, "요점의 이유·효과 0~2개. 개조식 짧은 구")
                        )
                    ),
                    "요점 2~4개"
                )
            )
        ),
        "key_concepts" to arr(sSchema, "분류용 핵심 개념 키워드 3~8개, 짧은 명사형 (예: 세컨더리 도미넌트, 사이드체인)"),
        "difficulty" to buildJsonObject {
            put("type", "string")
            putJsonArray("enum") {
                add(JsonPrimitive("입문"))
                add(JsonPrimitive("중급"))
                add(JsonPrimitive("고급"))
            }
        },
        "moments" to arr(
            obj(
                mapOf(
                    "timestamp" to timestampSchema,
                    "point" to sSchema
                )
            ),
            "다시 볼 만한 주요 구간"
        ),
        "practice" to arr(sSchema, "영상 내용으로 해볼 연습 과제 2~4개")
    )

    private val sectionSchemas: Map<String, Triple<String, JsonObject, String>> = mapOf(
        "화성" to Triple(
            "harmony",
            obj(
                mapOf(
                    "progressions" to arr(
                        obj(
                            mapOf(
                                "name" to buildJsonObject {
                                    put("type", "string")
                                    put("description", "진행 이름이나 맥락 (예: 인트로 진행, 2-5-1 변형)")
                                },
                                "key" to sSchema,
                                "instrument" to buildJsonObject {
                                    put("type", "string")
                                    putJsonArray("enum") {
                                        add(JsonPrimitive("건반"))
                                        add(JsonPrimitive("기타"))
                                    }
                                    put("description", "이 진행을 연주·설명하는 악기")
                                },
                                "chords" to arr(
                                    obj(
                                        mapOf(
                                            "symbol" to buildJsonObject {
                                                put("type", "string")
                                                put("description", "코드 심볼 (예: Cmaj7, G7(b9)/B)")
                                            },
                                            "roman" to buildJsonObject {
                                                put("type", "string")
                                                put("description", "로마숫자 표기 (예: Imaj7, V7/ii)")
                                            },
                                            "function" to buildJsonObject {
                                                put("type", "string")
                                                put("description", "화성 기능 (T, SD, D, 차용 등)")
                                            },
                                            "split" to buildJsonObject {
                                                put("type", "boolean")
                                                put("description", "강사가 왼손/오른손을 구분해 보여줬으면 true")
                                            },
                                            "lh" to arr(noteSchema, "왼손 노트. split이 false면 빈 배열"),
                                            "rh" to arr(noteSchema, "오른손 노트. split이 false면 누른 노트 전부"),
                                            "frets" to arr(sSchema, "기타일 때만. 6번줄(저음 E)부터 1번줄까지 6개: 안 치는 줄 x, 개방현 0, 나머지 프렛 번호. 건반이면 빈 배열"),
                                            "voicing_note" to buildJsonObject {
                                                put("type", "string")
                                                put("description", "보이싱 특징 개조식 한 줄 (예: 3도 대신 4도/11도 음 사용)")
                                            },
                                            "nuance" to buildJsonObject {
                                                put("type", "string")
                                                put("description", "이 코드의 색채·역할·긴장감에 대한 설명")
                                            },
                                            "source" to sourceSchema,
                                            "timestamp" to timestampSchema
                                        )
                                    )
                                )
                            )
                        )
                    ),
                    "concepts" to arr(
                        obj(
                            mapOf(
                                "term" to sSchema,
                                "explanation" to sSchema
                            )
                        )
                    )
                )
            ),
            "코드 진행은 코드 단위로 빠짐없이 적으세요. 보이싱은 실제로 누른 건반을 전부 옥타브와 함께, 낮은 음부터 적습니다. " +
                "6개를 눌렀으면 6개 모두 적고, 같은 음이 다른 옥타브에 있으면 중복해서 넣습니다. " +
                "화면의 피아노롤·건반·악보를 우선 근거로 쓰고, 음 철자(Gb/F#)는 영상 표기를 따릅니다. " +
                "강사가 왼손/오른손을 나눠 보여주면 split=true로 lh/rh에 나누고, 아니면 split=false로 전부 rh에 넣습니다. " +
                "기타 영상이면 instrument=기타로 하고, 코드 폼을 frets에 6번줄부터 적습니다(lh/rh는 비워 둠). " +
                "화면의 코드 다이어그램·TAB·지판을 우선 근거로 씁니다."
        ),
        "사운드 디자인" to Triple(
            "sound_design",
            obj(
                mapOf(
                    "patches" to arr(
                        obj(
                            mapOf(
                                "target" to buildJsonObject {
                                    put("type", "string")
                                    put("description", "만드는 소리 (예: 슈퍼소 리드, 808 베이스)")
                                },
                                "instrument" to buildJsonObject {
                                    put("type", "string")
                                    put("description", "사용 신스/플러그인")
                                },
                                "steps" to arr(
                                    obj(
                                        mapOf(
                                            "stage" to buildJsonObject {
                                                put("type", "string")
                                                put("description", "OSC, 필터, 엔벨로프, LFO, FX 등")
                                            },
                                            "setting" to buildJsonObject {
                                                put("type", "string")
                                                put("description", "구체적인 설정값")
                                            },
                                            "why" to buildJsonObject {
                                                put("type", "string")
                                                put("description", "이 설정이 소리에 주는 효과")
                                            },
                                            "source" to sourceSchema,
                                            "timestamp" to timestampSchema
                                        )
                                    )
                                )
                            )
                        )
                    )
                )
            ),
            "패치를 만드는 단계를 순서대로, 화면에 보이는 파라미터 값은 가능한 한 정확히 적으세요."
        ),
        "DAW/MIDI" to Triple(
            "daw",
            obj(
                mapOf(
                    "daw" to buildJsonObject {
                        put("type", "string")
                        put("description", "사용 DAW와 버전. 모르면 빈 문자열")
                    },
                    "steps" to arr(
                        obj(
                            mapOf(
                                "action" to sSchema,
                                "detail" to sSchema,
                                "shortcut" to buildJsonObject {
                                    put("type", "string")
                                    put("description", "단축키. 없으면 빈 문자열")
                                },
                                "timestamp" to timestampSchema
                            )
                        )
                    ),
                    "tips" to arr(sSchema)
                )
            ),
            "작업 흐름을 따라 할 수 있게 순서대로 적고, 화면이나 말로 나온 단축키·메뉴 경로를 포함하세요."
        ),
        "리듬" to Triple(
            "rhythm",
            obj(
                mapOf(
                    "patterns" to arr(
                        obj(
                            mapOf(
                                "name" to sSchema,
                                "time_signature" to buildJsonObject {
                                    put("type", "string")
                                    put("description", "박자 (예: 4/4)")
                                },
                                "grid" to buildJsonObject {
                                    put("type", "string")
                                    put("description", "16분 그리드 표기. 악기별로 줄바꿈 (예: KICK x---x---x---x---)")
                                },
                                "feel" to buildJsonObject {
                                    put("type", "string")
                                    put("description", "그루브·스윙·강세 설명")
                                },
                                "source" to sourceSchema,
                                "timestamp" to timestampSchema
                            )
                        )
                    ),
                    "concepts" to arr(
                        obj(
                            mapOf(
                                "term" to sSchema,
                                "explanation" to sSchema
                            )
                        )
                    )
                )
            ),
            "리듬 패턴은 16분 그리드(x = 타격, - = 쉼)로 표기하고 스윙·강세·벨로시티 같은 그루브 요소를 설명하세요."
        ),
        "편곡" to Triple(
            "arrangement",
            obj(
                mapOf(
                    "sections" to arr(
                        obj(
                            mapOf(
                                "section" to buildJsonObject {
                                    put("type", "string")
                                    put("description", "인트로, 벌스, 프리코러스 등")
                                },
                                "bars" to buildJsonObject {
                                    put("type", "string")
                                    put("description", "마디 수. 모르면 빈 문자열")
                                },
                                "instruments" to sSchema,
                                "technique" to buildJsonObject {
                                    put("type", "string")
                                    put("description", "이 구간에서 쓰인 편곡 기법과 의도")
                                },
                                "timestamp" to timestampSchema
                            )
                        )
                    ),
                    "techniques" to arr(
                        obj(
                            mapOf(
                                "term" to sSchema,
                                "explanation" to sSchema
                            )
                        )
                    )
                )
            ),
            "구간별 악기 구성과 에너지 변화, 사용된 편곡 기법(빌드업, 대선율, 레이어링 등)을 정리하세요."
        ),
        "믹싱" to Triple(
            "mixing",
            obj(
                mapOf(
                    "chain" to arr(
                        obj(
                            mapOf(
                                "track" to buildJsonObject {
                                    put("type", "string")
                                    put("description", "대상 트랙/버스")
                                },
                                "processor" to buildJsonObject {
                                    put("type", "string")
                                    put("description", "EQ, 컴프레서 등과 플러그인 이름")
                                },
                                "settings" to buildJsonObject {
                                    put("type", "string")
                                    put("description", "구체적인 설정값")
                                },
                                "purpose" to sSchema,
                                "source" to sourceSchema,
                                "timestamp" to timestampSchema
                            )
                        )
                    ),
                    "tips" to arr(sSchema)
                )
            ),
            "처리 체인을 트랙별로 순서대로 적고, 화면에 보이는 설정값(주파수, 게인, 어택/릴리즈, 비율)을 포함하세요."
        )
    )

    fun build(tags: List<String>): Pair<JsonObject, String> {
        val props = LinkedHashMap<String, JsonObject>()
        props.putAll(commonSchemas)
        val guides = mutableListOf<String>()

        for (tag in tags) {
            val section = sectionSchemas[tag] ?: continue
            props[section.first] = section.second
            guides.add("- [$tag] ${section.third}")
        }

        val schema = obj(props)
        val guideText = guides.joinToString("\n")
        return Pair(schema, guideText)
    }

    fun buildPrompt(tags: List<String>, memo: String): Pair<JsonObject, String> {
        val (schema, guides) = build(tags)
        return Pair(schema, fillTemplate(tags, guides, memo))
    }

    private fun fillTemplate(tags: List<String>, guides: String, memo: String): String {
        val memoText = if (memo.isNotBlank()) {
            "\n사용자 메모(특히 신경 써서 볼 부분): ${memo.trim()}"
        } else {
            ""
        }
        return PROMPT_TEMPLATE
            .replace("{tags}", tags.joinToString(", "))
            .replace("{guides}", guides)
            .replace("{memo}", memoText)
    }

    /** 코드 진행 영상 분석의 분류 태그 (결과 노트 태그도 이것) */
    val PROGRESSION_TAGS: List<String> = listOf("화성")

    const val PROGRESSION_GUIDE: String =
        "- [코드 진행] 이 영상은 코드 진행을 배우거나 연주하는 영상입니다. 영상에 나오는 코드 진행을 진행 단위로 빠짐없이 모읍니다.\n" +
            "  · 코드 심볼은 화면(자막·악보·코드 다이어그램·피아노롤 라벨)에 적힌 표기를 글자 그대로 씁니다. maj7/M7/Δ, m7b5/ø 같은 표기를 바꾸지 않습니다.\n" +
            "  · 화면에 심볼이 없을 때만 표준 표기(예: Cmaj7, Am7, G7(b9)/B)로 적고 source는 \"말함\"(강사가 말함) 또는 \"추정\"(소리로 짐작)입니다.\n" +
            "  · 같은 진행이 반복되면 한 번만 적고, 코드가 바뀌는 진행(변형·전조)은 따로 적습니다.\n" +
            "  · key는 \"F Major\", \"A min\"처럼 적습니다(조를 말하거나 화면에 보이면 그대로, 아니면 진행으로 추정).\n" +
            "  · roman은 key 기준으로 대문자 메이저·소문자 마이너, 메이저7은 M7, 도미넌트7은 7, 변화음은 도수 앞 b/#(bVIIM7), 텐션은 뒤(Iadd9, V7(b9))로 적습니다. 세컨더리 도미넌트도 V/x 대신 근음 도수로 적습니다(VI7).\n" +
            "  · 특정 곡의 진행이면 song·artist를 적습니다.\n" +
            "  · start/end는 그 진행이 처음 나오는 구간입니다."

    private fun strSchema(description: String): JsonObject = buildJsonObject {
        put("type", "string")
        put("description", description)
    }

    /**
     * 화성 스키마 확장판 (`개발산출물/결과/CH-1b_설계.md` §4-1): 진행 객체에 song·artist·start·end를 더하고
     * key 설명을 형식 지시로 바꾼다. 기존 화성 스키마(`sectionSchemas`)는 그대로 두고 복사본만 고친다
     */
    private fun progressionHarmonySchema(): JsonObject {
        val harmony = sectionSchemas.getValue("화성").second
        val progressions = harmony.getValue("properties").jsonObject.getValue("progressions").jsonObject
        val item = progressions.getValue("items").jsonObject
        val oldProps = item.getValue("properties").jsonObject
        val newProps = linkedMapOf(
            "name" to strSchema("진행 이름·구간 (예: 인트로 진행, 후렴, 2-5-1 변형)"),
            "song" to strSchema("영상이 특정 곡을 다루면 곡 제목, 아니면 빈 문자열"),
            "artist" to strSchema("곡 아티스트, 모르면 빈 문자열"),
            "key" to strSchema("\"<음> Major\" 또는 \"<음> min\" 형식 (예: F Major, A min). 모르면 빈 문자열"),
            "instrument" to oldProps.getValue("instrument").jsonObject,
            "start" to strSchema("이 진행이 처음 나오는 구간 시작, mm:ss 또는 h:mm:ss. 모르면 빈 문자열"),
            "end" to strSchema("이 진행이 처음 나오는 구간 끝, mm:ss 또는 h:mm:ss. 모르면 빈 문자열"),
            "chords" to oldProps.getValue("chords").jsonObject
        )
        val newItem = obj(newProps)
        val newProgressions = JsonObject(progressions + ("items" to newItem))
        val newHarmonyProps = JsonObject(harmony.getValue("properties").jsonObject + ("progressions" to newProgressions))
        return JsonObject(harmony + ("properties" to newHarmonyProps))
    }

    /**
     * 코드 진행 영상 분석 프롬프트 (CH-4, 설계 §4). 공통 스키마 + 화성 확장판, 태그별 지시는
     * [코드 진행] 지시 뒤에 기존 [화성] 지시를 그대로 붙인다. 일반 노트(`buildPrompt`)는 바뀌지 않는다
     */
    fun buildProgressionPrompt(memo: String): Pair<JsonObject, String> {
        val props = LinkedHashMap<String, JsonObject>()
        props.putAll(commonSchemas)
        props["harmony"] = progressionHarmonySchema()
        val guides = PROGRESSION_GUIDE + "\n- [화성] " + sectionSchemas.getValue("화성").third
        return Pair(obj(props), fillTemplate(PROGRESSION_TAGS, guides, memo))
    }
}

