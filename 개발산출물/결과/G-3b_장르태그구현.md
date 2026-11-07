# G-3b 결과: 곡 장르 태그 구현 (DB 컬럼 + API 필드)

- **날짜:** 2026-11-04 · **브랜치:** `feat/song-genre` (base `main`, PR #60 머지 후 분기, G-3 설계 커밋 cherry-pick)
- **설계:** `개발산출물/결과/G-3_장르태그설계.md` 그대로 구현(변경 없음)

## 1. 바뀐 파일

| 파일 | 내용 |
| --- | --- |
| `src/main/resources/db/migration/V2__songs_genre.sql` (새) | `songs.genre TEXT` NULL + CHECK 7개 id |
| `src/main/kotlin/ulevelp/db/Tables.kt` | `SongsTable.genre = text("genre").nullable()` |
| `src/main/kotlin/ulevelp/service/SongService.kt` | `SongDto.genre`(15필드), `UpdateSongInput.genre/genreSet`, `GENRE_IDS`, 장르만 바뀐 PATCH는 outbox 미적재 |
| `src/main/kotlin/ulevelp/routes/SongRoutes.kt` | PATCH `genre` 키 판정(`containsKey`), null=해제, 그 밖은 400 |
| `frontend/src/lib/apiClient.ts` | `SongDto.genre: string \| null`, `updateSong(..., { genre })` |
| `src/test/kotlin/ulevelp/db/DatabaseMigrationAndIntegrityTest.kt` | 버전 `"2"`, `'kpop'` insert → 23514 |
| `src/test/kotlin/ulevelp/song/SongApiTest.kt` | 키 15개, S16(설정·유지·해제·400 3종·남의 곡 404), S17(장르만 → outbox 0, 장르+memo → 1) |
| `docs/03-api-spec.md`, `docs/04-db-design.md` | 15필드·`genre` 예시·PATCH 규칙, songs 컬럼 |

## 2. G-4가 쓸 값

- 장르 id: `pop` `jazz` `rnb` `rock` `jpop` `ani` `etc` (서버 `SongService.GENRE_IDS` = 프론트 `GENRES`). 미지정 = `null`
- 모든 곡 응답에 `"genre"` 키가 항상 있다(미지정이면 `null`). 비로그인 곡(`ulp:v:*`)은 장르 없음 → "미지정" 폴더
- 장르 바꾸기: `apiClient.updateSong(songId, { genre: 'jazz' })`, 해제는 `{ genre: null }`
- 장르만 바꾸면 노션 outbox에 안 쌓인다(노션 미전송)

## 3. 검증 (실행 출력)

- `./gradlew test` → `BUILD SUCCESSFUL`, 197개 통과(실패 0). `SongApiTest` 17, `DatabaseMigrationAndIntegrityTest` 4. Flyway 로그 `Successfully applied 2 migrations ... now at version v2`
- `npm run build` → `✓ built in 1.22s` / `npm test` → `tests 140, pass 140, fail 0`
- curl: 로컬 Supabase(인증 `127.0.0.1:54321`, DB `127.0.0.1:54322`)로 `./gradlew run`(PORT=3099). 로컬 DB에 V2 적용됨. **원격 DB에는 아직 적용 안 함**(배포 때 Flyway가 적용)

```
$ curl -X PATCH http://127.0.0.1:3099/api/v1/songs/$SID -d '{"genre":"pop"}'
{"song":{"id":"501eb5c6-...","title":"Genre Curl",...,"memo":"","genre":"pop","totalSeconds":0,...}}
HTTP 200
$ curl -X PATCH http://127.0.0.1:3099/api/v1/songs/$SID -d '{"genre":"kpop"}'
{"ok":false,"source":"server","status":400,"code":"INVALID_INPUT","message":"genre는 pop, jazz, rnb, rock, jpop, ani, etc 중 하나 또는 null이어야 합니다.","retryAfter":null}
HTTP 400
$ curl -X PATCH http://127.0.0.1:3099/api/v1/songs/$SID -d '{"genre":null}'
"genre":null HTTP 200
```

## 4. 로컬 curl 방법 (다음에 재사용)

- `.env`는 원격 DB를 가리키므로 그대로 서버를 띄우면 원격에 마이그레이션된다 → 환경변수로 덮어쓴다:
  `env -u REMOTE_DB_HOST DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres SUPABASE_URL=http://127.0.0.1:54321 PORT=3099 ./gradlew run`
- 토큰: kong 컨테이너 `/home/kong/kong.yml`의 `sb_publishable_*` 키로 `POST /auth/v1/signup` → `POST /auth/v1/token?grant_type=password`(로컬은 자동 확인). 테스트 계정 `genre-curl@example.com`
- 이 저장소엔 compose 파일이 없어 `.env`의 `COMPOSE_FILE` 규칙은 해당 없음
