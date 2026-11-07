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
import ulevelp.api.ApiException
import ulevelp.api.InvalidInputException
import ulevelp.api.receiveJsonObject
import ulevelp.api.requireUuid
import ulevelp.auth.SupabaseAuthPlugin
import ulevelp.auth.SupabaseJwtVerifier
import ulevelp.auth.requireAuthUser
import ulevelp.service.ExportImportService
import ulevelp.service.ProfileService
import java.time.LocalDate
import java.time.ZoneOffset

fun Route.registerExportImportRoutes(
    jwtVerifier: SupabaseJwtVerifier?,
    profileService: ProfileService,
    exportImportService: ExportImportService
) {
    route("/export") {
        install(SupabaseAuthPlugin) {
            this.jwtVerifier = jwtVerifier
            this.profileService = profileService
        }

        get("/zip") {
            val user = call.requireAuthUser()
            val rawInclude = call.request.queryParameters["includeAudio"]
            val includeAudio = when (rawInclude) {
                null, "", "true" -> true
                "false" -> false
                else -> throw InvalidInputException("includeAudio는 true 또는 false여야 합니다.")
            }

            // DB 조회 (트랜잭션 1, 스트리밍 시작 전)
            val data = exportImportService.loadExportData(user.id)

            val today = LocalDate.now(ZoneOffset.UTC)
            val filename = "ULeveLP-export-$today.zip"

            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.response.headers.append(
                HttpHeaders.ContentDisposition,
                "attachment; filename=\"$filename\""
            )
            call.respondOutputStream(ContentType.Application.Zip, HttpStatusCode.OK) {
                exportImportService.writeExportZip(data, includeAudio, this)
            }
        }
    }

    route("/import/notion") {
        install(SupabaseAuthPlugin) {
            this.jwtVerifier = jwtVerifier
            this.profileService = profileService
        }

        post("/preview") {
            val user = call.requireAuthUser()

            if (!call.request.isMultipart()) {
                throw InvalidInputException("multipart/form-data 요청이 필요합니다.")
            }

            val contentLength = call.request.header(HttpHeaders.ContentLength)?.toLongOrNull()
            if (contentLength != null && contentLength > ExportImportService.MAX_ZIP_BYTES + 1_048_576L) {
                throw ApiException(
                    HttpStatusCode.PayloadTooLarge,
                    "ZIP_TOO_LARGE",
                    "ZIP 파일은 100MB 이하만 올릴 수 있습니다."
                )
            }

            var zipBytes: ByteArray? = null
            try {
                val multipart = call.receiveMultipart(formFieldLimit = ExportImportService.MAX_ZIP_BYTES + 1_048_576L)
                multipart.forEachPart { part ->
                    try {
                        when (part) {
                            is PartData.FileItem -> {
                                if (part.name == "file") {
                                    zipBytes = part.provider().readRemaining(ExportImportService.MAX_ZIP_BYTES + 1).readByteArray()
                                }
                            }
                            is PartData.FormItem -> {
                                if (part.name == "file") {
                                    zipBytes = part.value.toByteArray(Charsets.ISO_8859_1)
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

            val bytes = zipBytes
            if (bytes == null || bytes.isEmpty()) {
                throw InvalidInputException("ZIP 파일(file 파트)이 비어 있거나 누락되었습니다.")
            }

            if (bytes.size > ExportImportService.MAX_ZIP_BYTES) {
                throw ApiException(
                    HttpStatusCode.PayloadTooLarge,
                    "ZIP_TOO_LARGE",
                    "ZIP 파일은 100MB 이하만 올릴 수 있습니다."
                )
            }

            val res = exportImportService.previewNotionZip(user.id, bytes)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, res)
        }

        post("/confirm") {
            val user = call.requireAuthUser()
            val body = call.receiveJsonObject()
            val previewToken = body.requireUuid("previewToken")

            val res = exportImportService.confirmNotionZip(user.id, previewToken)
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respond(HttpStatusCode.OK, res)
        }
    }
}

