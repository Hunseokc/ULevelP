package ulevelp.db

import java.sql.DriverManager
import java.util.concurrent.TimeUnit

/**
 * 테스트용 PostgreSQL 16 인스턴스 공급자.
 *
 * 1. `TEST_DATABASE_URL` 환경 변수가 있으면 해당 DB를 사용한다.
 * 2. 없으면 로컬 Docker 데몬으로 `postgres:16-alpine` 컨테이너를 임시 기동하고,
 *    JVM 종료 시(`Runtime.addShutdownHook`) 자동으로 제거한다.
 */
object PostgresTestContainer {
    private const val IMAGE = "postgres:16-alpine"
    private const val DB_NAME = "ulevelp_test"
    private const val DB_USER = "ulp_test"
    private const val DB_PASS = "ulp_test_pw"

    @Volatile
    private var cachedConfig: DatabaseConfig? = null

    @Synchronized
    fun getConfig(): DatabaseConfig {
        cachedConfig?.let { return it }

        val envUrl = System.getenv("TEST_DATABASE_URL")?.takeIf { it.isNotBlank() }
        if (envUrl != null) {
            val cfg = DatabaseFactory.fromEnvOrNull(
                mapOf(
                    "DATABASE_URL" to envUrl,
                    "DB_USER" to (System.getenv("TEST_DB_USER") ?: DB_USER),
                    "DB_PASSWORD" to (System.getenv("TEST_DB_PASSWORD") ?: DB_PASS)
                )
            ) ?: error("Invalid TEST_DATABASE_URL")
            cachedConfig = cfg
            return cfg
        }

        val containerId = runCommand(
            "docker", "run", "-d", "--rm",
            "-p", "127.0.0.1:0:5432",
            "-e", "POSTGRES_DB=$DB_NAME",
            "-e", "POSTGRES_USER=$DB_USER",
            "-e", "POSTGRES_PASSWORD=$DB_PASS",
            IMAGE
        ).trim()

        Runtime.getRuntime().addShutdownHook(
            Thread {
                runCatching {
                    ProcessBuilder("docker", "rm", "-f", containerId)
                        .redirectErrorStream(true)
                        .start()
                        .waitFor(10, TimeUnit.SECONDS)
                }
            }
        )

        val portOutput = runCommand("docker", "port", containerId, "5432/tcp").trim()
        val hostPort = portOutput
            .lineSequence()
            .firstOrNull()
            ?.substringAfterLast(':')
            ?.trim()
            ?.toIntOrNull()
            ?: error("Could not parse mapped port from docker port output: $portOutput")

        val jdbcUrl = "jdbc:postgresql://127.0.0.1:$hostPort/$DB_NAME"
        waitUntilReady(jdbcUrl, DB_USER, DB_PASS)

        val config = DatabaseConfig(
            jdbcUrl = jdbcUrl,
            username = DB_USER,
            password = DB_PASS,
            maximumPoolSize = 5,
            runMigrations = true
        )
        cachedConfig = config
        return config
    }

    private fun waitUntilReady(jdbcUrl: String, user: String, pass: String) {
        val deadline = System.currentTimeMillis() + 30_000L
        var lastError: Throwable? = null
        while (System.currentTimeMillis() < deadline) {
            try {
                DriverManager.getConnection(jdbcUrl, user, pass).use { conn ->
                    conn.createStatement().use { stmt ->
                        stmt.executeQuery("SELECT 1").use { rs ->
                            if (rs.next()) return
                        }
                    }
                }
            } catch (t: Throwable) {
                lastError = t
                Thread.sleep(250)
            }
        }
        throw IllegalStateException("PostgreSQL test container did not become ready in 30s: $jdbcUrl", lastError)
    }

    private fun runCommand(vararg command: String): String {
        val process = ProcessBuilder(*command)
            .redirectErrorStream(true)
            .start()
        val output = process.inputStream.bufferedReader().readText()
        val finished = process.waitFor(60, TimeUnit.SECONDS)
        if (!finished || process.exitValue() != 0) {
            throw IllegalStateException("Command failed (${command.joinToString(" ")}): $output")
        }
        return output
    }
}

