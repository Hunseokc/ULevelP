package ulevelp.db

import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import kotlinx.coroutines.Dispatchers
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.output.MigrateResult
import org.jetbrains.exposed.sql.Database
import org.jetbrains.exposed.sql.Transaction
import org.jetbrains.exposed.sql.transactions.experimental.newSuspendedTransaction
import java.net.URI
import javax.sql.DataSource

data class DatabaseConfig(
    val jdbcUrl: String,
    val username: String,
    val password: String,
    val maximumPoolSize: Int = 10,
    val runMigrations: Boolean = true
)

object DatabaseFactory {
    fun fromEnvOrNull(env: Map<String, String> = System.getenv()): DatabaseConfig? {
        val rawUrl = env["DATABASE_URL"]?.takeIf { it.isNotBlank() }
            ?: env["REMOTE_DB_URL"]?.takeIf { it.isNotBlank() }

        if (rawUrl != null) {
            return parseUrlConfig(rawUrl, env)
        }

        val host = env["REMOTE_DB_HOST"]?.takeIf { it.isNotBlank() } ?: return null
        val port = env["REMOTE_DB_PORT"]?.takeIf { it.isNotBlank() } ?: "5432"
        val dbName = env["REMOTE_DB_NAME"]?.takeIf { it.isNotBlank() } ?: "postgres"
        val user = env["REMOTE_DB_USER"]?.takeIf { it.isNotBlank() }
            ?: env["DB_USER"]?.takeIf { it.isNotBlank() }
            ?: "postgres"
        val pass = env["REMOTE_DB_PASSWORD"]
            ?: env["DB_PASSWORD"]
            ?: ""

        return DatabaseConfig(
            jdbcUrl = "jdbc:postgresql://$host:$port/$dbName",
            username = user,
            password = pass
        )
    }

    private fun parseUrlConfig(rawUrl: String, env: Map<String, String>): DatabaseConfig {
        val fallbackUser = env["DB_USER"] ?: env["REMOTE_DB_USER"] ?: "postgres"
        val fallbackPass = env["DB_PASSWORD"] ?: env["REMOTE_DB_PASSWORD"] ?: ""

        if (rawUrl.startsWith("jdbc:postgresql://")) {
            return DatabaseConfig(
                jdbcUrl = rawUrl,
                username = fallbackUser,
                password = fallbackPass
            )
        }

        if (rawUrl.startsWith("postgres://") || rawUrl.startsWith("postgresql://")) {
            val normalized = if (rawUrl.startsWith("postgres://")) {
                "postgresql://" + rawUrl.removePrefix("postgres://")
            } else {
                rawUrl
            }
            val uri = URI(normalized)
            val userInfo = uri.userInfo?.split(":", limit = 2)
            val user = userInfo?.getOrNull(0)?.takeIf { it.isNotEmpty() } ?: fallbackUser
            val pass = userInfo?.getOrNull(1) ?: fallbackPass
            val portPart = if (uri.port != -1) ":${uri.port}" else ""
            val queryPart = uri.rawQuery?.let { "?$it" } ?: ""
            val jdbcUrl = "jdbc:postgresql://${uri.host}$portPart${uri.rawPath}$queryPart"
            return DatabaseConfig(
                jdbcUrl = jdbcUrl,
                username = user,
                password = pass
            )
        }

        throw IllegalArgumentException("지원하지 않는 DB URL 형식입니다.")
    }

    fun createDataSource(config: DatabaseConfig): HikariDataSource {
        val hikari = HikariConfig().apply {
            jdbcUrl = config.jdbcUrl
            username = config.username
            password = config.password
            driverClassName = "org.postgresql.Driver"
            maximumPoolSize = config.maximumPoolSize
            isAutoCommit = false
            transactionIsolation = "TRANSACTION_READ_COMMITTED"
            validate()
        }
        return HikariDataSource(hikari)
    }

    fun migrate(dataSource: DataSource, locations: String = "classpath:db/migration"): MigrateResult {
        return Flyway.configure()
            .dataSource(dataSource)
            .locations(locations)
            .baselineOnMigrate(true)
            .baselineVersion("0")
            .load()
            .migrate()
    }

    fun connect(dataSource: DataSource): Database {
        return Database.connect(dataSource)
    }

    fun init(config: DatabaseConfig): Pair<HikariDataSource, Database> {
        val dataSource = createDataSource(config)
        if (config.runMigrations) {
            migrate(dataSource)
        }
        val db = connect(dataSource)
        return dataSource to db
    }

    suspend fun <T> dbQuery(db: Database? = null, block: suspend Transaction.() -> T): T =
        newSuspendedTransaction(Dispatchers.IO, db) {
            block()
        }
}
