package ulevelp.routes

import io.ktor.http.*
import io.ktor.http.content.*
import io.ktor.server.application.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import io.ktor.utils.io.readRemaining
import kotlinx.coroutines.CancellationException
import kotlinx.io.readByteArray
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import ulevelp.api.*
import ulevelp.auth.SupabaseAuthPlugin
import ulevelp.auth.SupabaseJwtVerifier
import ulevelp.auth.requireAuthUser
import ulevelp.service.*
import java.math.BigDecimal
import java.math.RoundingMode

fun Route.registerTakeRoutes(
    jwtVerifier: SupabaseJwtVerifier?,
    profileService: ProfileService,
    takeService: TakeService,
    storageTrashService: StorageTrashService
) {
    route("/takes") {
        install(SupabaseAuthPlugin) {
            this.jwtVerifier = jwtVerifier
            this.profileService = profileService
        }

        post {
            val user = call.requireAuthUser()

            if (call.request.isMultipart()) {
                if (!takeService.isStorageConfigured) {
                    throw ApiException(
                        status = HttpStatusCode.ServiceUnavailable,
                        code = "STORAGE_UNAVAILABLE",
                        message = "녹음 저장소가 설정되어 있지 않습니다."
                    )
                }

                val contentLength = call.request.header(HttpHeaders.ContentLength)?.toLongOrNull()
                if (contentLength != null && contentLength > TakeService.MAX_REQUEST_BYTES) {
                    throw ApiException(
                        status = HttpStatusCode.PayloadTooLarge,
                        code = "TAKE_TOO_LARGE",
                        message = "녹음 파일은 50MB 이하만 올릴 수 있습니다."
                    )
                }

                var metadataRaw: String? = null
                var fileBytes: ByteArray? = null

                try {
                    val multipart = call.receiveMultipart(formFieldLimit = TakeService.MAX_REQUEST_BYTES)
                    multipart.forEachPart { part ->
                        try {
                            when (part) {
                                is PartData.FormItem -> {
                                    if (part.name == "metadata") {
                                        if (part.value.toByteArray(Charsets.UTF_8).size > TakeService.MAX_METADATA_BYTES) {
                                            throw InvalidInputException("metadata가 너무 큽니다.")
                                        }
                                        metadataRaw = part.value
                                    }
                                }
                                is PartData.FileItem -> {
                                    if (part.name == "metadata") {
                                        val bytes = part.provider().readRemaining(TakeService.MAX_METADATA_BYTES + 1).readByteArray()
                                        if (bytes.size > TakeService.MAX_METADATA_BYTES) {
                                            throw InvalidInputException("metadata가 너무 큽니다.")
                                        }
                                        metadataRaw = bytes.toString(Charsets.UTF_8)
                                    } else if (part.name == "file") {
                                        fileBytes = part.provider().readRemaining(TakeService.MAX_FILE_BYTES + 1).readByteArray()
                                    }
                                }
                                else -> {}
                            }
                        } finally {
                            part.dispose()
                        }
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: ApiException) {
                    throw e
                } catch (e: Exception) {
                    throw InvalidInputException("multipart 본문을 읽지 못했습니다.")
                }

                val metadataStr = metadataRaw ?: throw InvalidInputException("metadata 파트가 필요합니다.")
                val bytes = fileBytes ?: throw InvalidInputException("file 파트가 필요합니다.")

                if (bytes.size > TakeService.MAX_FILE_BYTES) {
                    throw ApiException(
                        status = HttpStatusCode.PayloadTooLarge,
                        code = "TAKE_TOO_LARGE",
                        message = "녹음 파일은 50MB 이하만 올릴 수 있습니다."
                    )
                }
                if (bytes.isEmpty()) {
                    throw InvalidInputException("녹음 파일이 비어 있습니다.")
                }

                val metaElement = try {
                    Json.parseToJsonElement(metadataStr)
                } catch (_: Exception) {
                    throw InvalidInputException("metadata는 JSON 객체여야 합니다.")
                }
                val metaJson = metaElement as? JsonObject
                    ?: throw InvalidInputException("metadata는 JSON 객체여야 합니다.")

                val songId = metaJson.requireUuid("songId")
                val date = metaJson.requireDate("date")
                val recordedAt = metaJson.requireInstant("recordedAt")

                val aDbl = metaJson.optDouble("a", 0.0, 86400.0)
                val a = aDbl?.let { BigDecimal.valueOf(it).setScale(1, RoundingMode.HALF_UP) }

                val bDbl = metaJson.optDouble("b", 0.0, 86400.0)
                val b = bDbl?.let { BigDecimal.valueOf(it).setScale(1, RoundingMode.HALF_UP) }

                if (a != null && b != null && a >= b) {
                    throw InvalidInputException("a는 b보다 작아야 합니다.")
                }

                val rateDbl = metaJson.optDouble("rate", 0.25, 2.0)
                val rate = rateDbl?.let { BigDecimal.valueOf(it).setScale(2, RoundingMode.HALF_UP) }

                val durationSec = metaJson.requireInt("durationSec", 0, 3600)

                val rawMime = metaJson.requireString("mime", 100)
                val normalizedMime = rawMime.substringBefore(';').trim().lowercase()
                if (normalizedMime !in TakeService.MIME_EXT) {
                    throw InvalidInputException("mime 값이 올바르지 않습니다.")
                }

                val replaceOldSongTakes = metaJson.optBoolean("replaceOldSongTakes", false)

                val input = TakeUploadInput(
                    songId = songId,
                    date = date,
                    recordedAt = recordedAt,
                    a = a,
                    b = b,
                    rate = rate,
                    durationSec = durationSec,
                    mime = normalizedMime,
                    bytes = bytes,
                    replaceOldSongTakes = replaceOldSongTakes
                )

                val takeDto = takeService.upload(user.id, input)
                call.respond(HttpStatusCode.Created, TakeEnvelope(ok = true, take = takeDto))
            } else if (call.request.contentType().withoutParameters() == ContentType.Application.Json) {
                val body = call.receiveJsonObject()

                val storage = body.requireString("storage", 50)
                if (storage != "drive") {
                    throw InvalidInputException("storage는 'drive'여야 합니다.")
                }

                val storageKey = body.requireString("storageKey", 200)
                if (!TakeService.DRIVE_FILE_ID_REGEX.matches(storageKey)) {
                    throw InvalidInputException("storageKey 형식이 올바르지 않습니다.")
                }

                val songId = body.requireUuid("songId")
                val date = body.requireDate("date")
                val recordedAt = body.requireInstant("recordedAt")

                val aDbl = body.optDouble("a", 0.0, 86400.0)
                val a = aDbl?.let { BigDecimal.valueOf(it).setScale(1, RoundingMode.HALF_UP) }

                val bDbl = body.optDouble("b", 0.0, 86400.0)
                val b = bDbl?.let { BigDecimal.valueOf(it).setScale(1, RoundingMode.HALF_UP) }

                if (a != null && b != null && a >= b) {
                    throw InvalidInputException("a는 b보다 작아야 합니다.")
                }

                val rateDbl = body.optDouble("rate", 0.25, 2.0)
                val rate = rateDbl?.let { BigDecimal.valueOf(it).setScale(2, RoundingMode.HALF_UP) }

                val durationSec = body.requireInt("durationSec", 0, 3600)

                val sizeElement = body["sizeBytes"] ?: throw InvalidInputException("sizeBytes 값이 필요합니다.")
                if (sizeElement is JsonNull) throw InvalidInputException("sizeBytes 값이 필요합니다.")
                if (sizeElement !is JsonPrimitive || sizeElement.isString) {
                    throw InvalidInputException("sizeBytes 형식이 올바르지 않습니다.")
                }
                val sizeBytes = sizeElement.content.toLongOrNull() ?: throw InvalidInputException("sizeBytes 형식이 올바르지 않습니다.")
                if (sizeBytes < 1L || sizeBytes > 52_428_800L) {
                    throw InvalidInputException("sizeBytes은(는) 1~52428800 범위여야 합니다.")
                }

                val rawMime = body.requireString("mime", 100)
                val normalizedMime = rawMime.substringBefore(';').trim().lowercase()
                if (normalizedMime !in TakeService.MIME_EXT) {
                    throw InvalidInputException("mime 값이 올바르지 않습니다.")
                }

                val input = DriveTakeRegisterInput(
                    songId = songId,
                    date = date,
                    recordedAt = recordedAt,
                    a = a,
                    b = b,
                    rate = rate,
                    durationSec = durationSec,
                    mime = normalizedMime,
                    sizeBytes = sizeBytes,
                    driveFileId = storageKey
                )

                val takeDto = takeService.registerDriveTake(user.id, input)
                call.respond(HttpStatusCode.Created, TakeEnvelope(ok = true, take = takeDto))
            } else {
                throw InvalidInputException("multipart/form-data 또는 application/json 요청이 필요합니다.")
            }
        }

        get("/{takeId}/download") {
            val user = call.requireAuthUser()
            val takeId = parsePathUuid(call.parameters["takeId"])
            val data = takeService.downloadBytes(user.id, takeId)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respondBytes(data.bytes, ContentType.parse(data.mime), HttpStatusCode.OK)
        }

        post("/{takeId}/migrate-drive") {
            val user = call.requireAuthUser()
            val takeId = parsePathUuid(call.parameters["takeId"])
            val body = call.receiveJsonObject()
            val driveFileId = body.requireString("driveFileId", 200)
            if (!TakeService.DRIVE_FILE_ID_REGEX.matches(driveFileId)) {
                throw InvalidInputException("driveFileId 형식이 올바르지 않습니다.")
            }
            val (takeDto, trashIds) = takeService.migrateToDrive(user.id, takeId, driveFileId)
            if (trashIds.isNotEmpty()) {
                storageTrashService.purge(trashIds)
            }
            call.respond(HttpStatusCode.OK, TakeEnvelope(ok = true, take = takeDto))
        }

        get("/{takeId}/url") {
            val user = call.requireAuthUser()
            val takeId = parsePathUuid(call.parameters["takeId"])
            val response = takeService.signedUrl(user.id, takeId)
            call.respond(HttpStatusCode.OK, response)
        }

        delete("/{takeId}") {
            val user = call.requireAuthUser()
            val takeId = parsePathUuid(call.parameters["takeId"])
            val trashIds = takeService.delete(user.id, takeId)
            storageTrashService.purge(trashIds)
            call.respond(HttpStatusCode.OK, buildJsonObject { put("ok", true) })
        }
    }
}
