# CH-3 결과 — 백엔드: V3 마이그레이션 · 진행 CRUD API · 노트 수집 토글 API

- 날짜: 2026-11-04 (mac)
- 입력: `결과/CH-1b_설계.md` §2·§3·§4-3·§5-3·§9, `결과/CH-2_코드파서.md`(키 철자 `KEYS`)
- 상태: **완료** — `./gradlew test` 216개 통과, 로컬 DB curl(정상·401·400·404) 확인, **Draft PR #63 CI 전부 통과**(Test Node 22·24, Kotlin JDK 21, E2E spa·legacy, Docker build & smoke — run 41830466374, 커밋 `8470bb5`)
- 원격 DB: **V3 미적용**(로컬 postgres 컨테이너에만 적용 → 확인 뒤 삭제). 운영 반영은 CH-8 뒤 배포 때 Flyway가 한다

## 1. 바꾼 파일 (§9 목록 그대로)

| 파일 | 내용 |
| --- | --- |
| ★`src/main/resources/db/migration/V3__progressions.sql` | 설계 §2 그대로(노션 CHECK 변경 4줄은 2026-11-05 CH-7에서 뺌) |
| `src/main/kotlin/ulevelp/db/Tables.kt` | `ProgressionsTable`(15번), `NotesTable.collectProgressions`, `AnalysisJobsTable.kind`, `ALL_TABLES` 15개 |
| ★`src/main/kotlin/ulevelp/note/ProgressionExtract.kt` | AI 노트 → 행: `normalizeKey`·`normalizeRoman`·`parseTimestamp`·`evidenceOf`·`fromAnalysis` |
| ★`src/main/kotlin/ulevelp/service/ProgressionService.kt` | DTO 4개, `parseInput`·`parseChords`(검증), `list`·`create`·`update`·`delete`, 트랜잭션 헬퍼 `insertFromNote`·`listByNote`·`rowToDto`, `youtubeVideoId` |
| ★`src/main/kotlin/ulevelp/routes/ProgressionRoutes.kt` | `GET/POST /progressions`, `PATCH/DELETE /progressions/{id}` |
| `src/main/kotlin/ulevelp/routes/NoteRoutes.kt` | `PUT /notes/{noteId}/collect` |
| `src/main/kotlin/ulevelp/service/NoteService.kt` | `NoteSummaryDto`·`NoteDetailDto`에 `collectProgressions`, `setCollect` |
| `src/main/kotlin/ulevelp/Main.kt` | `ProgressionService` 생성·라우트 등록 |
| ★`src/test/kotlin/ulevelp/progression/ProgressionApiTest.kt` | P1~P7 |
| ★`src/test/kotlin/ulevelp/progression/ProgressionExtractTest.kt` | E1~E4 |
| `src/test/kotlin/ulevelp/db/DatabaseMigrationAndIntegrityTest.kt` | 버전 3·테이블 15, progressions CHECK 6종(23514)·순번 중복(23505)·노트 삭제 SET NULL·outbox `progression` 허용·`analysis_jobs.kind` 기본 `note`·CASCADE |
| `docs/03-api-spec.md` | 8.3(노트 DTO 필드 수), **8.4 토글**, **8.5 진행 API** |
| `docs/04-db-design.md` | ERD 2줄, **2.2 V3** |

## 2. 다음 step이 쓸 값

### API (CH-5 화면)

- `ProgressionDto` 25필드 = 설계 §3-1 그대로(`docs/03` 8.5에 예시). `chords[]` = `{symbol, roman, source?, timestamp?}`
- `GET /api/v1/progressions?scope=` → `{ progressions }`(최신 먼저) · `POST` → 201 `{ progression }` · `PATCH /{id}` → `{ progression }` · `DELETE /{id}` → `{ ok: true }`
- `PUT /api/v1/notes/{noteId}/collect` `{collect}` → `{ noteId, collect, progressions }`(켜면 그 노트 행 전체, 끄면 `[]`). 노트 DTO에 `collectProgressions: boolean`
- 에러 메시지(화면에 그대로 보여도 됨): "코드 진행은 최대 3000개까지 저장할 수 있습니다." / "영상에서 온 진행은 레퍼런스로 바꿀 수 없습니다." / "key는 \"F Major\"·\"A min\" 형식이어야 합니다." / "chords[i].symbol은 1~24자여야 합니다." 등 — 필드명이 메시지에 들어간다
- 프론트 `apiClient.ts`에 아직 타입·함수 없음(CH-5 몫)

### 서버 함수 (CH-4 코드 진행 영상 분석)

```kotlin
ProgressionExtract.fromAnalysis(analysis: JsonObject, noteTitle, channel, videoId): List<Row>   // Row.index = 노트 안 순번(원본 배열)
// 트랜잭션 안에서 (import ulevelp.service.ProgressionService.Companion.insertFromNote)
insertFromNote(userId, noteId, route = "video", rows)   // kind=analysis, origin=ai. 이미 있는 순번은 건너뜀
```

- CH-4 할 일: `executeJob`의 트랜잭션 2에서 `kind='progression'`이면 노트 `collect_progressions=true`로 넣고 `insertFromNote(..., "video", rows)`. `AnalysisJobDto.kind` 응답 필드 추가(설계 §3-5), `requestAnalyze`에 kind 인자. `fromAnalysis`는 `song`·`artist`·`start`·`end`가 있으면 이미 읽는다(설계 §4-1 확장 스키마 필드 이름 그대로)
- `AnalysisJobsTable.kind` 칼럼(기본 `note`)은 이미 있음

### 노션 — 2026-11-05 폐기 — 노션 연동 중단(`계획/앱_명세.md` §5)

- outbox 적재 안 함(넣지 않는다)

## 3. 설계에 없어 정한 것

| 항목 | 결정 | 이유 |
| --- | --- | --- |
| 경로 UUID 형식 오류 | **404**(기존 `parsePathUuid` 동작) | 설계 §3 "parsePathUuid(400)"는 문구 착오 — 기존 분류·노트 API와 같게 |
| AI 키 철자 | 앱 키 24개(`KEYS`) 철자로 맞춤(`C# Major`→`Db Major`, `Abm`→`G# min`) | 설계 §5-4 "철자는 `KEYS`를 따른다" + 같은 키가 두 철자로 갈리지 않게. 직접 입력 `key`는 정규식만 검사(프론트 드롭다운이 `KEYS`) |
| 직접 행 코드 `source` | 저장 안 함(POST·직접 행 PATCH·AI→직접 전환 때 제거). `timestamp`는 형식만 검사하고 유지 | `source`는 AI 근거라 직접 행엔 의미 없음. 타임스탬프는 영상 위치라 고친 행에도 쓸모 있음 |
| AI 행 "코드가 바뀜" 판정 | 코드 배열을 `source` 빼고 비교(roman·timestamp 포함). 안 바뀌면 기존 `source`를 순서대로 다시 붙임 | 화면이 `source` 없이 같은 코드를 다시 보내도 AI가 유지되게 |
| `key: ""` | `null`과 같음(비움) | 화면 "모름" 선택 |
| `releaseDate` 범위 | 1900~2100년 | 기존 `requireDate`(2000년~내일)는 연습 날짜용이라 옛 곡이 막힘 |
| AI 코드 `symbol` 25자 이상 | 그 코드만 버림(잘라 쓰지 않음) | 자르면 다른 코드가 됨 |
| AI 진행 `song`·노트 제목 둘 다 빔 | `title` = "(제목 없음)" | DB CHECK(1자 이상) |
| `source` 없는 AI 코드 | 근거 계산에서 `추정` | "가장 약한 것" 규칙에 맞춤 |
| 토글 동시성 | 노트 행 `FOR UPDATE` + `UNIQUE(note_id, note_prog_index)` | 두 번 눌러도 중복 행 없음 |
| 토글이 노트 `updated_at`을 바꿈 | 그대로 둠(`set_updated_at` 트리거). 값이 같으면 UPDATE를 건너뜀 | 노트 목록 정렬은 `created_at`이라 영향 없음 |
| PATCH `kind`·`title`·`chords`에 `null` | 400 | 필수 칸 |

## 4. 실행 결과 (로컬, mac)

```
./gradlew test --tests 'ulevelp.progression.*' --tests 'ulevelp.db.DatabaseMigrationAndIntegrityTest'
  → ProgressionApiTest P1~P7 PASSED, ProgressionExtractTest E1~E4 PASSED, DatabaseMigrationAndIntegrityTest 6개 PASSED
./gradlew test → BUILD SUCCESSFUL, tests=216 failed=0 skipped=0
```

- 변이 확인: `update`의 "키가 바뀌면 직접" 조건을 `false`로 바꾸면 P6 실패(`expected: <manual> but was: <ai>`) → 원복

### 로컬 DB curl (서버 PORT=3099, DB `127.0.0.1:55432` 로컬 컨테이너)

```
Flyway: Migrating schema "public" to version "1 - init" / "2 - categories" / "3 - progressions"
        Successfully applied 3 migrations to schema "public", now at version v3
$ GET /progressions (토큰 없음)          → 401 UNAUTHORIZED "Authorization 헤더가 누락되었습니다."
$ POST /progressions {kind:reference, title, key:"F Major", chords 3개, url:youtu.be/…}
  → 201 {"progression":{… "origin":"manual","route":"manual","evidence":null,"key":"F Major",
         "chords":[{"roman":"IM7","symbol":"FM7"},…],"videoId":"dQw4w9WgXcQ",…}}
$ POST … "key":"F major"                 → 400 INVALID_INPUT "key는 \"F Major\"·\"A min\" 형식이어야 합니다."
$ POST … "chords":[]                     → 400 INVALID_INPUT "chords는 코드 1~64개 배열이어야 합니다."
$ GET /progressions?scope=mine           → 400 INVALID_INPUT
$ PATCH /progressions/{id} {memo,tags}   → 200
$ PATCH (다른 사용자 토큰)                → 404 NOT_FOUND "코드 진행을 찾을 수 없습니다."
$ PUT /notes/{noteId}/collect {collect:true}
  → 200 {"collect":true,"progressions":[{"kind":"analysis","origin":"ai","route":"note","evidence":"화면",
         "key":"C Major"(원본 "C major"),"instrument":"기타",
         "chords":[…{"roman":"IM7"(원본 Imaj7),"source":"화면","symbol":"Cmaj7","timestamp":"0:38"}],"startSec":30,…}]}
$ PUT … {collect:"yes"}                  → 400 "collect는 true 또는 false여야 합니다."
$ GET /notes/{noteId}                    → note.collectProgressions = True
$ PUT … {collect:false}                  → 200 {"collect":false,"progressions":[]} · 목록엔 직접 행 1개만 남음
$ DELETE /progressions/{id}              → 200 {"ok":true}
$ DELETE /progressions/not-a-uuid        → 404
flyway_schema_history: 1|init|t · 2|categories|t · 3|progressions|t
```

## 5. 로컬 curl 방법 (mac — 로컬 Supabase 없이)

이 mac에는 Supabase CLI·이미지가 없어(`G-3b` §4는 win 방법) **postgres 컨테이너 + 직접 만든 JWKS·토큰**으로 했다. 원격 DB를 건드리지 않는다.

```bash
SP=<임시 폴더>; mkdir -p $SP/jwks/auth/v1/.well-known
docker run -d --rm --name ulp-ch3-pg -p 127.0.0.1:55432:5432 -e POSTGRES_PASSWORD=localpw postgres:16-alpine
node mkjwt.js $SP/jwks http://127.0.0.1:54399/auth/v1 <sub-uuid> …  > tokens.txt   # P-256 키 생성 → jwks.json 쓰기 + ES256 토큰(iss·aud=authenticated·exp 1h)
(cd $SP/jwks && python3 -m http.server 54399 --bind 127.0.0.1)                     # 백그라운드
env -u REMOTE_DB_HOST -u REMOTE_DB_URL -u REMOTE_DB_USER -u REMOTE_DB_PASSWORD -u SUPABASE_SECRET_KEY \
  DATABASE_URL=postgresql://postgres:localpw@127.0.0.1:55432/postgres SUPABASE_URL=http://127.0.0.1:54399 PORT=3099 ./gradlew run   # 백그라운드
curl $U/me -H "Authorization: Bearer $TOKEN"     # 사용자 행 생성 후 API 호출
docker rm -f ulp-ch3-pg                           # 끝나면 삭제
```

- `mkjwt.js` 핵심: `crypto.generateKeyPairSync('ec',{namedCurve:'P-256'})` → `publicKey.export({format:'jwk'})`에 `kid`·`alg:'ES256'` 붙여 `{keys:[…]}`, 서명은 `crypto.sign('sha256', …, {key, dsaEncoding:'ieee-p1363'})`
- 노트는 API로 못 만드므로(분석 필요) `docker exec ulp-ch3-pg psql -U postgres -c "INSERT INTO notes …"`로 넣었다
- Docker Desktop이 꺼져 있으면 `./gradlew test`도 실패한다(`PostgresTestContainer`) → `open -a Docker`
- 이 저장소엔 compose 파일이 없어 `.env`의 `COMPOSE_FILE` 규칙은 해당 없음(G-3b와 같음)
