# G-3c 결과: 곡 "분류" 설계 (사용자 정의 · 곡당 여러 개) — **승인됨 (2026-11-04, "전부 승인": 설계 + §7 정리)**

- **날짜:** 2026-11-04 · **진행 파일:** `개발산출물/진행_홈메뉴장르.md`
- **대체:** `G-3_장르태그설계.md`(고정 7개 장르, `songs.genre`)와 G-3b 구현(미커밋, 원격 DB 미적용)은 **폐기**한다
- **사용자 결정(2026-11-04):** ① 곡당 분류 **여러 개(태그)** ② 기본 분류 없이 **빈 상태로 시작** ③ 홈 표시 여부·순서는 **서버(categories 테이블)** 에 저장

## 1. DB — `V2__categories.sql` (새 파일, 폐기한 `V2__songs_genre.sql` 대신)

```sql
-- categories: 사용자 정의 곡 분류 (홈 바로가기·플레이어 분류 폴더)
CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 20),
  sort_order  INT  NOT NULL DEFAULT 0,
  on_home     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, id)                         -- song_categories 복합 FK 대상
);
CREATE UNIQUE INDEX categories_user_name_uq ON categories (user_id, lower(name));
CREATE TRIGGER categories_updated BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- song_categories: 곡 ↔ 분류 (N:M). 복합 FK로 다른 사용자의 곡·분류 연결 차단
CREATE TABLE song_categories (
  user_id     UUID NOT NULL,
  song_id     UUID NOT NULL,
  category_id UUID NOT NULL,
  PRIMARY KEY (song_id, category_id),
  FOREIGN KEY (user_id, song_id)     REFERENCES songs (user_id, id)      ON DELETE CASCADE,
  FOREIGN KEY (user_id, category_id) REFERENCES categories (user_id, id) ON DELETE CASCADE
);
CREATE INDEX song_categories_category_idx ON song_categories (category_id);
```

- 한도: 사용자당 분류 50개(서버 검사, 넘으면 `400 INVALID_INPUT`), 곡당 분류 10개
- 이름 앞뒤 공백 제거 후 저장. 대소문자 무시 중복은 `409 CONFLICT`(코드 이름은 구현 때 `ApiException` 기존 코드 확인)
- 테이블 12개 → 14개 (`ALL_TABLES`, 마이그레이션 테스트 `EXPECTED_TABLES`도 함께)

## 2. API (새 경로 = 승인 필요)

`CategoryDto`: `{ id, name, sortOrder, onHome, songCount }`

| 메서드·경로 | 본문 | 응답 |
| --- | --- | --- |
| `GET /api/v1/categories` | — | `200 { categories: CategoryDto[] }` (`sortOrder`, `createdAt` 순) |
| `POST /api/v1/categories` | `{ name }` | `201 { category }` — 맨 뒤 순서로 추가 |
| `PATCH /api/v1/categories/{id}` | `{ name?, onHome? }` 하나 이상 | `200 { category }` |
| `PUT /api/v1/categories/order` | `{ ids: [...] }` 내 분류 전부, 중복 없이 | `200 { categories }` (아니면 400) |
| `DELETE /api/v1/categories/{id}` | — | `200 { ok: true }` — 곡 연결만 지워지고 곡은 그대로 |

- 없는 분류·남의 분류·비 UUID → `404 NOT_FOUND`
- **`SongDto`:** `categoryIds: string[]` 추가(14 → 15필드, 미지정은 `[]`). `memo` 다음
- **`PATCH /api/v1/songs/{songId}`:** `categoryIds` 배열을 받으면 **통째로 교체**(`[]`이면 전부 해제). 내 분류 id가 아니면 400. "수정할 값" 문구에 `categoryIds` 추가
- **outbox·노션·내보내기:** 분류만 바꾼 PATCH는 적재하지 않음, 노션 미전송, 내보내기 CSV 제외(G-3과 같음)

## 3. 프론트

- `frontend/src/lib/genres.ts` → **`categories.ts`로 바꿈**(파일 경로·export 변경 = 승인 필요). 고정 `GENRES`·기기 저장 `ulp:home-genres` 삭제, `setOpenGenre/takeOpenGenre` → `setOpenCategory/takeOpenCategory`(sessionStorage 키 `ulp:open-category`)
- `apiClient.ts`: `CategoryDto`, `listCategories/createCategory/updateCategory/reorderCategories/removeCategory`, `SongDto.categoryIds`, `updateSong({ categoryIds })`
- 홈(`HomePage.tsx`): 바로가기 줄은 서버 분류 중 `onHome`만 `sortOrder` 순. `+` 팝업 = 분류 **추가 · 이름 변경 · 삭제 · 홈 표시 · 순서**. 분류가 0개면 "분류를 만들어 보세요" 안내 + `+`만. **비로그인은 줄 대신 "로그인하면 곡을 분류할 수 있어요"**
- 플레이어(G-4): 분류별 폴더(한 곡이 여러 폴더에 나올 수 있음) + "미분류" 폴더, 곡에 분류 붙이기 UI

## 4. 바꿀 파일 목록과 이유

| 파일 | 이유 |
| --- | --- |
| `src/main/resources/db/migration/V2__categories.sql` (새) | 위 두 테이블 |
| `src/main/kotlin/ulevelp/db/Tables.kt` | `CategoriesTable`, `SongCategoriesTable`, `ALL_TABLES`; G-3b의 `SongsTable.genre` 되돌림 |
| `src/main/kotlin/ulevelp/service/CategoryService.kt` (새) | 분류 CRUD·순서·한도 |
| `src/main/kotlin/ulevelp/routes/CategoryRoutes.kt` (새) + 라우트 등록 파일(`Main.kt` 등) | `/categories` 경로 |
| `src/main/kotlin/ulevelp/service/SongService.kt`, `routes/SongRoutes.kt` | `categoryIds` 응답·PATCH 교체 |
| `src/test/kotlin/ulevelp/category/CategoryApiTest.kt` (새), `song/SongApiTest.kt`, `db/DatabaseMigrationAndIntegrityTest.kt` | 아래 §5 |
| `frontend/src/lib/genres.ts` → `categories.ts`, `apiClient.ts`, `pages/HomePage.tsx`(+ `.module.css`), `lib/security.ts`(키 목록에 `ulp:home-genres`가 있으면 정리) | §3 |
| `test/e2e/home-genre.spec.js` → `home-category.spec.js` | 고정 장르 → API 분류(목 응답) |
| `docs/03-api-spec.md`, `docs/04-db-design.md`, `docs/02-requirements.md`(분류 요구사항 한 줄) | 명세 |

## 5. 테스트 기준
- 마이그레이션: 버전 `"2"`, 테이블 14개, 남의 곡·남의 분류 연결 시 FK 거부, 같은 이름(대소문자 무시) 중복 거부
- `CategoryApiTest`: 생성 201·중복 409·빈 이름/21자 400·51번째 400, PATCH 이름/onHome, 순서 PUT 정상·누락/중복/남의 id 400, DELETE 후 곡 `categoryIds`에서 빠짐, 남의 분류 404, 토큰 없음 401
- `SongApiTest`: 키 15개(`categoryIds`), `categoryIds` 교체·`[]` 해제·남의 분류 id 400·11개 400, 분류만 바꾸면 outbox 0건

## 6. 단계 나누기 (제안)
| step | 내용 | 권장 effort |
| --- | --- | --- |
| G-3d | 백엔드: V2·Kotlin·테스트·docs 03/04, curl 확인 | 중간 |
| G-4a | 프론트: `categories.ts`·`apiClient`·홈 줄 + `+` 팝업(추가·이름·삭제·표시·순서), e2e | 중간 |
| G-4b | 플레이어: 분류 폴더 + 곡에 분류 붙이기 + 홈 버튼 → 그 폴더만 펼침, e2e | 높음 |

## 7. 구현 전 정리 (G-3d 시작 시)
- 미커밋 G-3b 변경 되돌리기: `git restore`로 9개 파일 + `V2__songs_genre.sql` 삭제 (사용자 확인 후)
- **로컬 Supabase DB**(`127.0.0.1:54322`)에 `V2 songs genre`가 적용돼 있다 → 그대로 두면 새 V2와 버전이 겹쳐 Flyway 검증 실패. `ALTER TABLE songs DROP COLUMN genre; DELETE FROM flyway_schema_history WHERE version = '2';`(로컬 전용, 사용자 확인 후)
