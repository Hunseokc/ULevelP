# G-3d 결과: 곡 분류 백엔드 (categories · song_categories · API)

- **날짜:** 2026-11-04 · **브랜치:** `feat/song-genre` (base `main`)
- **설계:** `개발산출물/결과/G-3c_분류설계.md` 그대로 구현. 차이: 곡 PATCH `categoryIds`의 중복 id는 400이 아니라 **한 번만 저장**(조용히 합침)
- **§7 정리 완료:** 미커밋 G-3b 변경 되돌림·`V2__songs_genre.sql` 삭제, 로컬 Supabase DB에서 `songs.genre` 컬럼·Flyway V2 이력 삭제 → 새 V2 적용됨

## 1. 바뀐 파일

| 파일 | 내용 |
| --- | --- |
| `src/main/resources/db/migration/V2__categories.sql` (새) | `categories`(이름 1~20자 CHECK, `(user_id, lower(name))` 고유), `song_categories`(복합 FK 2개, CASCADE) |
| `src/main/kotlin/ulevelp/db/Tables.kt` | `CategoriesTable`(13), `SongCategoriesTable`(14), `ALL_TABLES` 14개 |
| `src/main/kotlin/ulevelp/service/CategoryService.kt` (새) | 목록·생성·수정·순서·삭제, 한도 50/20자/곡당 10, `categoryIdsBySong` |
| `src/main/kotlin/ulevelp/routes/CategoryRoutes.kt` (새), `Main.kt` | `/api/v1/categories` 등록 |
| `src/main/kotlin/ulevelp/service/SongService.kt`, `routes/SongRoutes.kt` | `SongDto.categoryIds`(15필드), PATCH `categoryIds` 통째 교체, 분류만 바꾸면 outbox 미적재 |
| `frontend/src/lib/apiClient.ts` | `SongDto.categoryIds: string[]` (타입만. 분류 API 함수는 G-4a) |
| `src/test/kotlin/ulevelp/category/CategoryApiTest.kt` (새) | C1~C6 |
| `src/test/kotlin/ulevelp/song/SongApiTest.kt` | 키 15개, S16(교체·유지·해제·400 5종·404), S17(outbox) |
| `src/test/kotlin/ulevelp/db/DatabaseMigrationAndIntegrityTest.kt` | 버전 2·테이블 14, 이름 중복 23505·공백 23514·남의 분류 연결 23503·삭제 CASCADE |
| `docs/03-api-spec.md`(3.5·3.7절), `docs/04-db-design.md`(ERD·2.1절) | 명세 |

## 2. G-4a가 쓸 값 (API 요약)

- `CategoryDto` = `{ id, name, sortOrder, onHome, songCount }`
- `GET /api/v1/categories` → `{ categories }` (sortOrder 순) · `POST` `{name}` → 201 `{ category }` (중복 409 `CONFLICT`, 1~20자 아니면 400, 50개 넘으면 400)
- `PATCH /api/v1/categories/{id}` `{ name?, onHome? }` → `{ category }` · `PUT /api/v1/categories/order` `{ ids: 내 분류 전부 }` → `{ categories }` · `DELETE` → `{ ok: true }`
- 곡: `SongDto.categoryIds: string[]`(분류 순서), `PATCH /api/v1/songs/{id}` `{ categoryIds: [...] }` 교체, `[]` 해제, 최대 10개
- 프론트에 아직 없는 것: `apiClient`의 분류 함수 5개, `updateSong`의 `categoryIds`, `genres.ts` → `categories.ts`(G-4a)

## 3. 검증 (실행 출력)

- `./gradlew test` → `BUILD SUCCESSFUL in 1m 3s`, **204개 통과**(실패 0). `CategoryApiTest` 6, `SongApiTest` 17, `DatabaseMigrationAndIntegrityTest` 5
- `npm run build` → `✓ built in 1.27s` / `npm test` → `tests 140, pass 140, fail 0`
- curl (로컬 Supabase, `./gradlew run` PORT=3099, Flyway `Migrating schema "public" to version "2 - categories"`):

```
$ POST /categories {"name":"Jazz"}
{"category":{"id":"2ca87063-...","name":"Jazz","sortOrder":0,"onHome":true,"songCount":0}}
HTTP 201
$ POST /categories {"name":"jazz"}
{"ok":false,"source":"server","status":409,"code":"CONFLICT","message":"같은 이름의 분류가 이미 있습니다.","retryAfter":null}
HTTP 409
$ PATCH /songs/$SID {"categoryIds":["$CID"]}
"categoryIds":["2ca87063-..."] HTTP 200
$ PATCH /songs/$SID {"categoryIds":["not-a-uuid"]}
{"ok":false,"source":"server","status":400,"code":"INVALID_INPUT","message":"categoryIds 형식이 올바르지 않습니다.","retryAfter":null}
HTTP 400
```

## 4. 참고
- 로컬 curl 방법: `결과/G-3b_장르태그구현.md` §4와 같음(원격 DB 덮어쓰기 금지, 로컬 Supabase 54321/54322)
- 원격 DB에는 아직 V2 미적용(배포 때 Flyway가 적용)
- 증분 컴파일이 `FileNotFoundException ... InvalidInputException.class`로 깨지면 `./gradlew compileKotlin compileTestKotlin --rerun-tasks`
