package ulevelp.support

import kotlinx.coroutines.delay
import ulevelp.storage.StorageClient
import ulevelp.storage.StorageException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

class FakeStorageClient : StorageClient {
    val objects = ConcurrentHashMap<String, ByteArray>()
    val deleted = CopyOnWriteArrayList<String>()
    @Volatile var failUpload = false
    @Volatile var failSign = false
    @Volatile var failDelete = false
    @Volatile var uploadDelayMs = 0L

    override suspend fun upload(key: String, bytes: ByteArray, contentType: String) {
        if (uploadDelayMs > 0) {
            delay(uploadDelayMs)
        }
        if (failUpload) {
            throw StorageException("Fake upload failure")
        }
        objects[key] = bytes
    }

    override suspend fun createSignedUrl(key: String, expiresInSec: Int): String {
        if (failSign) {
            throw StorageException("Fake sign failure")
        }
        return "https://fake.storage/$key?exp=$expiresInSec"
    }

    override suspend fun delete(key: String) {
        if (failDelete) {
            throw StorageException("Fake delete failure")
        }
        objects.remove(key)
        deleted.add(key)
    }
}

