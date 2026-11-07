package ulevelp.service

import io.ktor.http.*
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.sql.*
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import org.jetbrains.exposed.sql.SqlExpressionBuilder.inList
import ulevelp.api.ApiException
import ulevelp.api.ConflictException
import ulevelp.api.InvalidInputException
import ulevelp.api.NotFoundException
import ulevelp.db.*
import java.util.UUID

@Serializable
data class CategoryDto(
    val id: String,
    val name: String,
    val sortOrder: Int,
    val onHome: Boolean,
    val songCount: Int
)

@Serializable
data class CategoryEnvelope(val category: CategoryDto)

@Serializable
data class CategoryListResponse(val categories: List<CategoryDto>)

/**
 * 사용자 정의 곡 분류 (`개발산출물/결과/G-3c_분류설계.md`). 노션으로 보내지 않으므로 outbox를 쓰지 않는다.
 */
class CategoryService(private val db: Database?) {
    private fun requireDb(): Database =
        db ?: throw ApiException(
            status = HttpStatusCode.ServiceUnavailable,
            code = "DB_UNAVAILABLE",
            message = "데이터베이스가 연결되어 있지 않습니다."
        )

    private fun Transaction.loadAll(userId: UUID): List<CategoryDto> {
        val countExpr = SongCategoriesTable.songId.count()
        val counts = SongCategoriesTable
            .select(SongCategoriesTable.categoryId, countExpr)
            .where { SongCategoriesTable.userId eq userId }
            .groupBy(SongCategoriesTable.categoryId)
            .associate { it[SongCategoriesTable.categoryId] to it[countExpr].toInt() }

        return CategoriesTable.selectAll()
            .where { CategoriesTable.userId eq userId }
            .orderBy(CategoriesTable.sortOrder to SortOrder.ASC, CategoriesTable.createdAt to SortOrder.ASC)
            .map { row ->
                val id = row[CategoriesTable.id]
                CategoryDto(
                    id = id.toString(),
                    name = row[CategoriesTable.name],
                    sortOrder = row[CategoriesTable.sortOrder],
                    onHome = row[CategoriesTable.onHome],
                    songCount = counts[id] ?: 0
                )
            }
    }

    private fun Transaction.loadOne(userId: UUID, categoryId: UUID): CategoryDto =
        loadAll(userId).firstOrNull { it.id == categoryId.toString() }
            ?: throw NotFoundException("분류를 찾을 수 없습니다.")

    private fun Transaction.ensureNameFree(userId: UUID, name: String, exceptId: UUID? = null) {
        val query = CategoriesTable.selectAll()
            .where { (CategoriesTable.userId eq userId) and (CategoriesTable.name.lowerCase() eq name.lowercase()) }
        if (exceptId != null) {
            query.andWhere { CategoriesTable.id neq exceptId }
        }
        if (query.count() > 0L) {
            throw ConflictException("같은 이름의 분류가 이미 있습니다.")
        }
    }

    suspend fun list(userId: UUID): List<CategoryDto> {
        val database = requireDb()
        return DatabaseFactory.dbQuery(database) { loadAll(userId) }
    }

    suspend fun create(userId: UUID, name: String): CategoryDto {
        val database = requireDb()
        return DatabaseFactory.dbQuery(database) {
            val existingCount = CategoriesTable.selectAll().where { CategoriesTable.userId eq userId }.count()
            if (existingCount >= MAX_CATEGORIES) {
                throw InvalidInputException("분류는 최대 ${MAX_CATEGORIES}개까지 만들 수 있습니다.")
            }
            ensureNameFree(userId, name)

            val maxExpr = CategoriesTable.sortOrder.max()
            val nextOrder = (CategoriesTable.select(maxExpr)
                .where { CategoriesTable.userId eq userId }
                .singleOrNull()?.get(maxExpr) ?: -1) + 1

            val newId = UUID.randomUUID()
            CategoriesTable.insert {
                it[id] = newId
                it[CategoriesTable.userId] = userId
                it[CategoriesTable.name] = name
                it[sortOrder] = nextOrder
            }
            loadOne(userId, newId)
        }
    }

    suspend fun update(userId: UUID, categoryId: UUID, name: String?, onHome: Boolean?): CategoryDto {
        val database = requireDb()
        return DatabaseFactory.dbQuery(database) {
            val exists = CategoriesTable.selectAll()
                .where { (CategoriesTable.id eq categoryId) and (CategoriesTable.userId eq userId) }
                .count() > 0L
            if (!exists) {
                throw NotFoundException("분류를 찾을 수 없습니다.")
            }
            if (name != null) {
                ensureNameFree(userId, name, exceptId = categoryId)
            }
            CategoriesTable.update({ (CategoriesTable.id eq categoryId) and (CategoriesTable.userId eq userId) }) {
                if (name != null) it[CategoriesTable.name] = name
                if (onHome != null) it[CategoriesTable.onHome] = onHome
            }
            loadOne(userId, categoryId)
        }
    }

    suspend fun reorder(userId: UUID, ids: List<UUID>): List<CategoryDto> {
        val database = requireDb()
        return DatabaseFactory.dbQuery(database) {
            val ownIds = CategoriesTable.select(CategoriesTable.id)
                .where { CategoriesTable.userId eq userId }
                .map { it[CategoriesTable.id] }
                .toSet()
            if (ids.size != ids.toSet().size || ids.toSet() != ownIds) {
                throw InvalidInputException("ids는 내 분류 전부를 중복 없이 담아야 합니다.")
            }
            ids.forEachIndexed { index, id ->
                CategoriesTable.update({ (CategoriesTable.id eq id) and (CategoriesTable.userId eq userId) }) {
                    it[sortOrder] = index
                }
            }
            loadAll(userId)
        }
    }

    suspend fun delete(userId: UUID, categoryId: UUID) {
        val database = requireDb()
        DatabaseFactory.dbQuery(database) {
            // song_categories는 FK CASCADE로 함께 지워지고 곡은 그대로 남는다
            val deleted = CategoriesTable.deleteWhere { (CategoriesTable.id eq categoryId) and (CategoriesTable.userId eq userId) }
            if (deleted == 0) {
                throw NotFoundException("분류를 찾을 수 없습니다.")
            }
        }
    }

    companion object {
        const val MAX_CATEGORIES = 50
        const val MAX_NAME_LENGTH = 20
        const val MAX_PER_SONG = 10

        /** 곡별 분류 id 목록 (분류 순서대로). songIds가 null이면 사용자 곡 전부 */
        fun Transaction.categoryIdsBySong(userId: UUID, songIds: List<UUID>? = null): Map<UUID, List<String>> {
            val query = SongCategoriesTable
                .join(CategoriesTable, JoinType.INNER, SongCategoriesTable.categoryId, CategoriesTable.id)
                .select(SongCategoriesTable.songId, SongCategoriesTable.categoryId)
                .where { SongCategoriesTable.userId eq userId }
            if (songIds != null) {
                query.andWhere { SongCategoriesTable.songId inList songIds }
            }
            return query
                .orderBy(CategoriesTable.sortOrder to SortOrder.ASC, CategoriesTable.createdAt to SortOrder.ASC)
                .toList()
                .groupBy({ it[SongCategoriesTable.songId] }, { it[SongCategoriesTable.categoryId].toString() })
        }
    }
}
