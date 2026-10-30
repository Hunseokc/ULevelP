package ulevelp.storage

class StorageException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)

interface StorageClient {
    /** 실패하면 StorageException */
    suspend fun upload(key: String, bytes: ByteArray, contentType: String)
    /** 브라우저가 바로 열 수 있는 전체 URL. 실패하면 StorageException */
    suspend fun createSignedUrl(key: String, expiresInSec: Int): String
    /** 없는 파일도 성공으로 본다. 실패하면 StorageException */
    suspend fun delete(key: String)
}

