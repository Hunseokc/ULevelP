package ulevelp.api

import io.ktor.server.application.*
import io.ktor.server.request.*
import kotlinx.serialization.json.*
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID

private val UUID_REGEX = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
private val DATE_REGEX = Regex("^\\d{4}-\\d{2}-\\d{2}$")
private val MIN_DATE = LocalDate.of(2000, 1, 1)
private val MIN_INSTANT = OffsetDateTime.of(2000, 1, 1, 0, 0, 0, 0, ZoneOffset.UTC)

suspend fun ApplicationCall.receiveJsonObject(): JsonObject {
    val raw = receiveText()
    if (raw.isBlank()) {
        throw InvalidInputException("요청 본문(JSON)이 비어 있습니다.")
    }
    val element = try {
        Json.parseToJsonElement(raw)
    } catch (_: Exception) {
        throw InvalidInputException("올바른 JSON 형식이 아닙니다.")
    }
    return element as? JsonObject
        ?: throw InvalidInputException("요청 본문은 JSON 객체여야 합니다.")
}

fun JsonObject.requireString(name: String, maxLength: Int): String {
    val element = this[name] ?: throw InvalidInputException("$name 값이 필요합니다.")
    if (element is JsonNull) {
        throw InvalidInputException("$name 값이 필요합니다.")
    }
    if (element !is JsonPrimitive || !element.isString) {
        throw InvalidInputException("$name 형식이 올바르지 않습니다.")
    }
    val trimmed = element.content.trim()
    if (trimmed.length > maxLength) {
        throw InvalidInputException("${name}은(는) ${maxLength}자 이하여야 합니다.")
    }
    return trimmed
}

fun JsonObject.optString(name: String, maxLength: Int): String? {
    val element = this[name] ?: return null
    if (element is JsonNull) return null
    if (element !is JsonPrimitive || !element.isString) {
        throw InvalidInputException("$name 형식이 올바르지 않습니다.")
    }
    val trimmed = element.content.trim()
    if (trimmed.length > maxLength) {
        throw InvalidInputException("${name}은(는) ${maxLength}자 이하여야 합니다.")
    }
    return trimmed
}

fun JsonObject.requireUuid(name: String): UUID {
    val element = this[name] ?: throw InvalidInputException("$name 값이 필요합니다.")
    if (element is JsonNull) {
        throw InvalidInputException("$name 값이 필요합니다.")
    }
    if (element !is JsonPrimitive || !element.isString || !UUID_REGEX.matches(element.content)) {
        throw InvalidInputException("$name 형식이 올바르지 않습니다.")
    }
    return try {
        UUID.fromString(element.content)
    } catch (_: Exception) {
        throw InvalidInputException("$name 형식이 올바르지 않습니다.")
    }
}

fun JsonObject.requireDate(name: String): LocalDate {
    val element = this[name] ?: throw InvalidInputException("$name 값이 필요합니다.")
    if (element is JsonNull) {
        throw InvalidInputException("$name 값이 필요합니다.")
    }
    if (element !is JsonPrimitive || !element.isString || !DATE_REGEX.matches(element.content)) {
        throw InvalidInputException("$name 형식이 올바르지 않습니다.")
    }
    val parsed = try {
        LocalDate.parse(element.content)
    } catch (_: Exception) {
        throw InvalidInputException("$name 형식이 올바르지 않습니다.")
    }
    val maxDate = LocalDate.now(ZoneOffset.UTC).plusDays(1)
    if (parsed < MIN_DATE || parsed > maxDate) {
        throw InvalidInputException("${name}은(는) 2000-01-01부터 내일(UTC)까지만 쓸 수 있습니다.")
    }
    return parsed
}

fun JsonObject.requireInstant(name: String): OffsetDateTime {
    val element = this[name] ?: throw InvalidInputException("$name 값이 필요합니다.")
    if (element is JsonNull) {
        throw InvalidInputException("$name 값이 필요합니다.")
    }
    if (element !is JsonPrimitive || !element.isString) {
        throw InvalidInputException("$name 형식이 올바르지 않습니다.")
    }
    val raw = element.content.trim()
    val parsed = try {
        OffsetDateTime.parse(raw).withOffsetSameInstant(ZoneOffset.UTC)
    } catch (_: Exception) {
        try {
            Instant.parse(raw).atOffset(ZoneOffset.UTC)
        } catch (_: Exception) {
            throw InvalidInputException("$name 형식이 올바른 ISO-8601 시각이 아닙니다.")
        }
    }
    val maxInstant = OffsetDateTime.now(ZoneOffset.UTC).plusDays(1)
    if (parsed < MIN_INSTANT || parsed > maxInstant) {
        throw InvalidInputException("${name}은(는) 2000-01-01부터 내일(UTC)까지만 쓸 수 있습니다.")
    }
    return parsed
}

fun JsonObject.requireDouble(name: String, min: Double, max: Double): Double {
    val element = this[name] ?: throw InvalidInputException("$name 값이 필요합니다.")
    if (element is JsonNull) {
        throw InvalidInputException("$name 값이 필요합니다.")
    }
    if (element !is JsonPrimitive || element.isString || element.doubleOrNull == null) {
        throw InvalidInputException("$name 형식이 올바르지 않습니다.")
    }
    val value = element.double
    if (value < min || value > max) {
        throw InvalidInputException("${name}은(는) $min~$max 범위여야 합니다.")
    }
    return value
}

fun JsonObject.optDouble(name: String, min: Double, max: Double): Double? {
    val element = this[name] ?: return null
    if (element is JsonNull) return null
    if (element !is JsonPrimitive || element.isString || element.doubleOrNull == null) {
        throw InvalidInputException("$name 형식이 올바르지 않습니다.")
    }
    val value = element.double
    if (value < min || value > max) {
        throw InvalidInputException("${name}은(는) $min~$max 범위여야 합니다.")
    }
    return value
}

fun JsonObject.requireInt(name: String, min: Int, max: Int): Int {
    val element = this[name] ?: throw InvalidInputException("$name 값이 필요합니다.")
    if (element is JsonNull) {
        throw InvalidInputException("$name 값이 필요합니다.")
    }
    if (element !is JsonPrimitive || element.isString) {
        throw InvalidInputException("$name 형식이 올바르지 않습니다.")
    }
    val longVal = element.content.toLongOrNull()
        ?: throw InvalidInputException("$name 형식이 올바르지 않습니다.")
    if (longVal < min || longVal > max) {
        throw InvalidInputException("${name}은(는) $min~$max 범위여야 합니다.")
    }
    return longVal.toInt()
}

fun JsonObject.optInt(name: String, min: Int, max: Int, default: Int): Int {
    val element = this[name] ?: return default
    if (element is JsonNull) return default
    if (element !is JsonPrimitive || element.isString) {
        throw InvalidInputException("$name 형식이 올바르지 않습니다.")
    }
    val longVal = element.content.toLongOrNull()
        ?: throw InvalidInputException("$name 형식이 올바르지 않습니다.")
    if (longVal < min || longVal > max) {
        throw InvalidInputException("${name}은(는) $min~$max 범위여야 합니다.")
    }
    return longVal.toInt()
}

fun JsonObject.optBoolean(name: String, default: Boolean): Boolean {
    val element = this[name] ?: return default
    if (element is JsonNull) return default
    if (element !is JsonPrimitive || element.isString || element.booleanOrNull == null) {
        throw InvalidInputException("$name 형식이 올바르지 않습니다.")
    }
    return element.boolean
}

fun JsonObject.requireArray(name: String, maxSize: Int): JsonArray {
    val element = this[name] ?: throw InvalidInputException("$name 값이 필요합니다.")
    if (element is JsonNull) {
        throw InvalidInputException("$name 값이 필요합니다.")
    }
    if (element !is JsonArray) {
        throw InvalidInputException("$name 형식이 올바르지 않습니다.")
    }
    if (element.size > maxSize) {
        throw InvalidInputException("${name}은(는) 최대 ${maxSize}개까지 보낼 수 있습니다.")
    }
    return element
}

fun parsePathUuid(raw: String?): UUID {
    if (raw == null || !UUID_REGEX.matches(raw)) {
        throw NotFoundException()
    }
    return try {
        UUID.fromString(raw)
    } catch (_: Exception) {
        throw NotFoundException()
    }
}
