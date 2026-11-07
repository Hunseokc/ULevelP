# 03. 기능 API 명세서 (Kotlin Ktor + Google Cloud Run)

> **문서 버전:** 2026-10-31
> **Base URL:** `https://<cloud-run-domain>` (로컬 개발 시 `http://localhost:3000`)

---

## 1. 공통 규칙

### 1.1 인증 및 헤더
- **인증 방식:** `Authorization: Bearer <access_token>` — **Supabase Auth**(Google 공급자)가 발급한 access token(JWT). 서버는 토큰을 발급하지 않고 검증만 합니다(KC-D10).
  - **검증:** 서명은 JWKS `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`(비대칭 서명 키, 캐시 후 `kid`로 선택), `iss` = `https://<project-ref>.supabase.co/auth/v1`, `aud` = `authenticated`, `exp` 미만료. `sub`가 `users.id`입니다. 실패하면 `401 UNAUTHORIZED`.
  - **환경변수:** `SUPABASE_URL`(=`https://<project-ref>.supabase.co`). JWKS 주소와 `iss`는 이것으로 만듭니다.
- **Content-Type:** 일반 요청/응답은 `application/json; charset=utf-8`, 오디오 직접 업로드는 `multipart/form-data`, ZIP 내보내기는 `application/zip`.
- **CORS:** 환경변수 `ALLOWED_ORIGINS` (`https://hunseokc.github.io,http://localhost:3000`)에 등록된 Origin에 대해서만 CORS 헤더를 반환합니다(오류 응답 시에도 CORS 헤더 포함).

### 1.2 표준 에러 응답 형식 (`NFR-SEC-10`)
모든 `4xx`, `5xx` 응답은 아래 JSON 구조를 따릅니다.

```json
{
  "ok": false,
  "source": "server",
  "status": 412,
  "code": "NO_KEY",
  "message": "Gemini 키가 등록되어 있지 않습니다. SETTING에서 먼저 등록해 주세요.",
  "retryAfter": null
}
```

- `source`: `"server"` (우리 백엔드 검증/제한) | `"notion"` (노션 API 오류 중계) | `"gemini"` (Gemini API 오류 중계)
- 주요 에러 코드(`code`):
  - `UNAUTHORIZED` (`401`): 토큰 누락·만료
  - `INVALID_INPUT` (`400`): 파라미터 형식 오류 (예: `invalid_notion_token`, `invalid_notion_db_id`, `invalid_gemini_key`)
  - `NOT_FOUND` (`404`): 없는 리소스, **다른 사용자의 리소스**(곡·세션·녹음 공통, 403을 쓰지 않음), 경로 id가 UUID 형식이 아님
  - `TAKE_TOO_LARGE` (`413`): 녹음 파일 1개가 50MB 초과
  - `STORAGE_UNAVAILABLE` (`503`): 서버에 녹음 저장소(`SUPABASE_SECRET_KEY`)가 설정되지 않음
  - `STORAGE_ERROR` (`502`): Supabase Storage 업로드·서명 URL 발급 실패
  - `NO_KEY` (`412`): 해당 기능에 필요한 노션/Gemini 키 미등록 (`FR-KEY-GATE`)
  - `PROVIDER_KEY_INVALID` (`400` / `401` / `403`): 등록된 노션 토큰 또는 Gemini 키가 외부 API에서 거부됨(Gemini는 401/403 또는 본문에 "API_KEY_INVALID"가 포함된 400 시 키 무효 판정, 일반 400[비공개·길이 초과 영상 등]은 GEMINI_API_ERROR로 처리되어 키 캐시 유지) → 클라이언트는 `ulp:keys` 캐시 초기화
  - `NOTION_OBJECT_NOT_FOUND` (`404`): 노션 DB를 찾을 수 없거나 페이지에 통합이 연결되지 않음
  - `TAKE_QUOTA_EXCEEDED` (`413`): 기본 스토리지 녹음 용량 한도(200MB) 초과
  - `RATE_LIMITED` (`429`): 요청 빈도 제한 초과 (`retryAfter` 초 반환)

---

## 2. 인증 및 내 프로필 API (`Auth & Profile`)

### 2.1 로그인·로그아웃 (서버 API 없음)
- **로그인:** 브라우저 `public/auth.js`가 supabase-js `signInWithOAuth({ provider: 'google', options: { redirectTo: <원래 페이지> } })`를 호출합니다. 토큰 발급·갱신(refresh)·저장은 supabase-js가 하며, `createClient` 옵션 `auth.storageKey = 'ulp:auth'`로 저장 키를 `ulp:` 규칙에 맞춥니다.
- **로그아웃:** `supabase.auth.signOut()` 후 `ulp:keys`를 지웁니다(`FR-AUTH-1`).
- **첫 로그인 프로필 생성(`FR-AUTH-2`):** 별도 가입 API 없이, 인증된 첫 요청에서 서버가 `users`(`id = sub`, `email`)와 `profiles`를 `INSERT ... ON CONFLICT (id) DO NOTHING`으로 만듭니다. 이메일이 바뀌었으면 `users.email`만 갱신합니다.

### 2.2 내 프로필 및 사용량 조회
- **`GET /api/v1/me`**
- **설명:** 현재 로그인한 사용자의 프로필, 녹음 스토리지 사용량/한도, 기기 로컬 기록 마이그레이션 여부, 키 등록 요약을 한 번에 반환합니다.
- **Response (`200 OK`):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "player@example.com",
  "displayName": "player",
  "role": "user",
  "storageProvider": "supabase",
  "driveFolderId": null,
  "takeUsedBytes": 45219840,
  "takeQuotaBytes": 209715200,
  "migratedLocalAt": "2026-10-30T09:00:00Z",
  "keys": {
    "notion": { "hint": "9a8b", "updatedAt": "2026-10-29T12:00:00Z" },
    "gemini": null
  }
}
```

### 2.3 내 프로필 설정 수정
- **`PATCH /api/v1/me`**
- **설명:** 표시 이름, 녹음 저장소(`supabase` | `drive`), 구글 드라이브 폴더 ID, 로컬 기록 이관 완료 시각만 수정할 수 있습니다(`role`, `takeQuotaBytes`는 변경 불가, `FR-AUTH-3`). 노션 실시간 연동이 켜져 있는 상태에서 `storageProvider: "drive"`로 변경 시 `409 Conflict`로 거부합니다(`FR-SYNC-5`).
- **Request Body:**
```json
{
  "displayName": "석훈",
  "storageProvider": "drive",
  "driveFolderId": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs",
  "migratedLocalAt": "2026-10-30T09:30:00Z"
}
```

### 2.4 계정 탈퇴 (전체 삭제)
- **`DELETE /api/v1/me`**
- **설명:** 사용자의 Supabase Storage 오디오 파일(`takes/{userId}/*`)을 `storage_trash`에 넣어 삭제 → 암호화된 API 키 삭제 → DB 사용자 행 삭제(`ON DELETE CASCADE`)를 수행합니다(`FR-AUTH-4`).
- **Request Body:** `{ "confirmText": "삭제합니다" }`
- **Response (`200 OK`):** `{ "ok": true }`

---

## 3. 연습 곡 API (`Songs`)

> 프런트엔드 `public/data.js`의 `ULData.songs.*` 메서드와 1:1 대응하며, 반환되는 곡 객체 구조는 기존 `Code.gs`의 `readSong` 형식과 완벽히 호환됩니다.
> **곡 객체(`SongDto`)는 모든 곡 응답에서 3.1의 15개 필드 그대로입니다**(`{ "song": { ... } }`의 `...`도 같음). `categoryIds`는 그 곡에 붙은 분류 id 배열(분류 `sortOrder` 순, 미분류면 `[]`, 3.7절). `totalSeconds`는 그 곡 세션 `seconds` 합(초). `resumeUrl`은 `PUBLIC_APP_URL`(배포 기본값·운영 값 `https://ulevelp-d5ympfsmfq-du.a.run.app/`) + `practice.html?v=&t=&a=&b=&r=`로, `public/practice.js`의 `resumeUrl()`과 같은 규칙(`t`는 `pos ?? a`의 정수 내림, 0이면 생략 / `a`·`b`는 있을 때만 / `r`은 1이 아닐 때만)으로 계산합니다(FR-SONG-6). 구현 상세는 `개발산출물/명세/K1-1_구현명세.md`.

### 3.1 내 연습 곡 목록 조회
- **`GET /api/v1/songs`**
- **Query Params:** `status` (선택: `practicing` | `paused` | `done` 또는 한글 `연습 중` | `보류` | `완료`)
- **정렬 규칙 (`FR-SONG-4`):** 상태 순서(`연습 중` → `보류` → `완료`), 동일 상태 내에서는 `lastDate DESC NULLS LAST`, `updatedAt DESC`.
- **Response (`200 OK`):**
```json
{
  "songs": [
    {
      "id": "c1a2b3c4-0000-4000-8000-000000000001",
      "title": "Autumn Leaves Jazz Guitar Chord Melody",
      "artist": "Jens Larsen",
      "status": "연습 중",
      "statusCode": "practicing",
      "videoId": "dQw4w9WgXcQ",
      "pos": 42.5,
      "a": 38.0,
      "b": 55.2,
      "rate": 0.75,
      "lastDate": "2026-10-30",
      "memo": "39초 구간 보이싱 손가락 번호 주의",
      "categoryIds": ["d7e8f9a0-0000-4000-8000-000000000001"],
      "totalSeconds": 3420,
      "resumeUrl": "https://ulevelp-d5ympfsmfq-du.a.run.app/practice.html?v=dQw4w9WgXcQ&t=42&a=38&b=55.2&r=0.75"
    }
  ]
}
```

### 3.2 유튜브 영상 ID로 단일 곡 조회
- **`GET /api/v1/songs/by-video/{videoId}`**
- **설명:** 플레이어(`practice.html?v=...`) 진입 시 호출합니다(`FR-SONG-1`). 등록된 곡이 없으면 `song: null`을 반환합니다. `videoId`가 `^[A-Za-z0-9_-]{11}$`가 아니면 `400 INVALID_INPUT`. 이 API는 oEmbed를 부르지 않습니다.
- **Response (`200 OK`):** `{ "song": { ... } }` 또는 `{ "song": null }`

### 3.3 연습 곡 추가 (멱등 생성)
- **`POST /api/v1/songs`**
- **설명:** 새 연습 곡을 등록합니다(`FR-SONG-2`). 이미 동일 `videoId`로 등록된 곡이 있으면 기존 곡을 그대로 반환합니다(본문 값으로 바꾸지 않음). `title`이 비어 있으면 서버가 YouTube oEmbed API를 호출하여 제목과 채널명을 채우고, oEmbed가 실패하면 제목 `"(제목 없음)"`으로 만듭니다. `rate`는 0.25~2.0(생략 시 1.0), `title` 300자·`artist` 200자 이하.
- **Request Body:**
```json
{
  "videoId": "dQw4w9WgXcQ",
  "title": "",
  "artist": "",
  "rate": 1.0
}
```
- **Response:** 새로 만들면 `201 Created`, 같은 `videoId` 곡이 이미 있으면 `200 OK`. 본문은 둘 다 `{ "song": { ... } }`.

### 3.4 곡 상세 조회 (타임라인 및 녹음 목록 포함)
- **`GET /api/v1/songs/{songId}`** — K2-2에서 구현(A0·B0 결정, 구현 상세는 `개발산출물/명세/K2-2_구현명세.md`). `sessions[]`는 `date DESC, updatedAt DESC` 순(10개 필드), `takes[]`는 `recordedAt DESC` 순이며 항목은 5.1의 녹음 객체(`TakeDto`, 12개 필드)와 같습니다. 없는 곡·남의 곡·비 UUID는 `404 NOT_FOUND`.
- **설명:** 곡 상세 화면(`log.html?song={songId}`)을 위한 API로, 곡 정보와 날짜별 연습 세션 타임라인, 녹음 테이크 목록을 함께 반환합니다(`FR-LIB-2`).
- **Response (`200 OK`):**
```json
{
  "song": { ... },
  "sessions": [
    {
      "id": "s1000000-0000-4000-8000-000000000001",
      "date": "2026-10-30",
      "seconds": 960,
      "minutes": 16.0,
      "loops": 24,
      "a": 38.0,
      "b": 55.2,
      "segment": "0:38–0:55",
      "rate": 0.75,
      "memo": "0.75배속에서는 박자 안정됨"
    }
  ],
  "takes": [
    {
      "id": "t1000000-0000-4000-8000-000000000001",
      "sessionId": "s1000000-0000-4000-8000-000000000001",
      "recordedAt": "2026-10-30T14:22:10Z",
      "a": 38.0,
      "b": 55.2,
      "rate": 0.75,
      "durationSec": 18,
      "mime": "audio/mp4",
      "sizeBytes": 284120,
      "storage": "supabase",
      "storageKey": "550e.../t1000....m4a",
      "memo": ""
    }
  ]
}
```

### 3.5 곡 상태·메모 수정 및 곡 삭제
- **`PATCH /api/v1/songs/{songId}`**
  - **Request Body:** `{ "status": "보류", "memo": "다음 달 재도전", "title": "수정할 제목(선택)", "categoryIds": ["<분류 id>"] }` — 넷 중 하나 이상 필요(없으면 `400 INVALID_INPUT` "수정할 값(status, memo, title, categoryIds)이 없습니다."). `status`는 코드·한글 모두 허용, `memo` 2000자 이하, `title`은 빈 문자열 불가.
  - **`categoryIds`:** 그 곡의 분류를 **통째로 교체**한다(`[]`이면 전부 해제, 중복 id는 한 번만). 최대 10개, 각 항목은 내 분류 id여야 한다(형식 오류·남의 분류·없는 분류는 `400 INVALID_INPUT`, 이때 기존 분류는 그대로). 분류는 노션으로 보내지 않으므로 **분류만 바꾼 요청은 `sync_outbox`에 적재하지 않는다**(`status`·`memo`·`title` 중 하나라도 있으면 `song` `upsert` 적재).
  - **Response (`200 OK`):** `{ "song": { ... } }`
- **`DELETE /api/v1/songs/{songId}`**
  - **설명:** 곡과 하위 `sessions`, `takes`를 삭제하고 녹음 파일은 `storage_trash`로 지웁니다. 노션 연동 활성화 시 곡과 각 세션의 `delete` 이벤트를 `sync_outbox`에 적재합니다(`FR-SONG-5`, 절차는 [04 3.2.1절](04-db-design.md)).
  - **Response (`200 OK`):** `{ "ok": true }`

### 3.6 비로그인 로컬 기록 일괄 마이그레이션
- **`POST /api/v1/songs/migrate-local`**
- **설명:** 첫 로그인 시 기기의 `ulp:v:*` 및 `pp:v:*` 기록을 서버로 일괄 이관합니다(`FR-LOCAL-2`). 이미 서버에 존재하는 `videoId`는 덮어쓰지 않고 건너뜁니다.
- **Request Body:**
```json
{
  "items": [
    { "videoId": "dQw4w9WgXcQ", "pos": 12.4, "a": 10.0, "b": 25.0, "rate": 0.75, "date": "2026-10-28" }
  ],
  "markMigrated": true
}
```
- **규칙:** `items`는 최대 100개(넘으면 `400`). 기기 기록은 믿을 수 없으므로 항목 하나가 틀려도 요청 전체를 거부하지 않습니다 — `videoId` 형식이 틀린 항목·같은 `videoId` 중복·이미 있는 곡은 `skipped`로 셉니다. 범위를 벗어난 `pos`·`a`·`b`·`date`는 `null`, `rate`는 `1.0`으로 바꿔 저장합니다. 새 곡 제목은 oEmbed로 채웁니다(트랜잭션 밖, 동시 8건). `migratedLocalAt`은 처리 뒤 프로필 값이며 `markMigrated: false`이고 원래 없으면 `null`.
- **Response (`200 OK`):** `{ "created": 1, "skipped": 0, "migratedLocalAt": "2026-10-30T09:30:00Z" }`

### 3.7 곡 분류 (`Categories`)
- **설명:** 사용자가 직접 만드는 곡 분류(홈 바로가기·플레이어 분류 폴더). 기본 분류는 없고, 곡 하나에 여러 개를 붙인다(곡 쪽은 3.5절 `categoryIds`). 노션 미전송. 테이블은 [04 2.1절](04-db-design.md).
- **분류 객체(`CategoryDto`, 5개 필드):** `{ "id": "d7e8f9a0-...", "name": "Jazz", "sortOrder": 0, "onHome": true, "songCount": 3 }` — `songCount`는 이 분류가 붙은 내 곡 수.
- **`GET /api/v1/categories`** → `200 { "categories": [CategoryDto, ...] }` (`sortOrder`, 만든 순).
- **`POST /api/v1/categories`** `{ "name": "Jazz" }` → `201 { "category": CategoryDto }` (맨 뒤 순서). `name`은 앞뒤 공백을 빼고 1~20자(아니면 `400 INVALID_INPUT`). 같은 이름(대소문자 무시)이 있으면 `409 CONFLICT`. 사용자당 50개를 넘으면 `400 INVALID_INPUT`.
- **`PATCH /api/v1/categories/{categoryId}`** `{ "name"?: "재즈", "onHome"?: false }` (하나 이상) → `200 { "category": CategoryDto }`. 이름 규칙·중복은 POST와 같다(자기 이름은 중복 아님).
- **`PUT /api/v1/categories/order`** `{ "ids": [...] }` → `200 { "categories": [...] }`. `ids`는 내 분류 **전부를 중복 없이** 원하는 순서로 담아야 한다(누락·중복·남의 id·형식 오류는 `400 INVALID_INPUT`).
- **`DELETE /api/v1/categories/{categoryId}`** → `200 { "ok": true }`. 곡과의 연결만 지워지고 곡은 남는다.
- 없는 분류·남의 분류·비 UUID 경로는 `404 NOT_FOUND`, 토큰 없음 `401 UNAUTHORIZED`. 모든 응답 `Cache-Control: no-store`.

---

## 4. 플레이어 자동 저장 및 연습 기록 API (`Practice & Sessions`)

### 4.1 플레이어 진행 상태 및 연습 시간 통합 저장
- **`POST /api/v1/practice/save`**
- **설명:** 기존 설계에서 2번의 RPC(`save_song_progress` + `add_practice`)로 나뉘어 있던 저장을 **단일 원자적 API**로 통합했습니다. 브라우저가 닫힐 때(`pagehide`) `fetch(..., { keepalive: true })` 한 번으로 곡 위치와 연습 시간을 모두 안전하게 저장할 수 있습니다(`FR-SONG-3`, `FR-SESSION-1`, `FR-SESSION-2`).
- **Request Body:**
```json
{
  "songId": "c1a2b3c4-0000-4000-8000-000000000001",
  "pos": 45.0,
  "a": 38.0,
  "b": 55.2,
  "rate": 0.75,
  "date": "2026-10-30",
  "addSeconds": 30,
  "addLoops": 2
}
```
- **비즈니스 로직:**
  1. `songs` 테이블의 `pos`, `a`, `b`, `rate`, `last_date = GREATEST(last_date, date)` 갱신.
  2. `addSeconds > 0` 또는 `addLoops > 0`일 때 당일 `(user_id, song_id, date)` 세션 확인:
     - 기존 세션이 있으면 `seconds = seconds + addSeconds`, `loops = loops + addLoops` 원자적 합산.
     - 기존 세션이 없고 `addSeconds < 60`이면 세션을 만들지 않고 `keep: true` 반환.
     - 기존 세션이 없고 `addSeconds >= 60`이면 새 세션 생성.
  3. 노션 연동 사용자면 `sync_outbox`에 `song`(및 `session`) `upsert` 적재 후 비동기 Push 워커 깨우기.
- **Response (`200 OK`):**
```json
{
  "ok": true,
  "keep": false,
  "sessionId": "s1000000-0000-4000-8000-000000000001",
  "totalSeconds": 990,
  "minutes": 16.5,
  "pendingSeconds": null
}
```
- 응답은 항상 위 6개 키(`ok`, `keep`, `sessionId`, `totalSeconds`, `minutes`, `pendingSeconds`)이고 해당 없는 칸은 `null`입니다. `totalSeconds`는 그 세션의 합산 후 `seconds`, `minutes`는 소수 1자리.
  - 1분 미만 보류: `{ "ok": true, "keep": true, "sessionId": null, "totalSeconds": null, "minutes": null, "pendingSeconds": 30 }`
  - `addSeconds`·`addLoops`가 모두 0(곡 위치만 저장): `{ "ok": true, "keep": false, "sessionId": null, "totalSeconds": null, "minutes": null, "pendingSeconds": null }`
- **검증:** `songId`(UUID)·`pos`(0~86400초)·`date`(`YYYY-MM-DD`, 2000-01-01~내일 UTC) 필수. `a`·`b`는 0~86400초이고 `a < b`(생략·`null`이면 구간을 지움). `rate` 0.25~2.0(생략 시 기존 값 유지). `addSeconds` 0~21600 정수, `addLoops` 0~100000 정수. 남의 곡·없는 곡은 `404 NOT_FOUND`.

### 4.2 기간별 연습 기록 및 12주 달력 조회
- **`GET /api/v1/sessions`**
- **Query Params:** `from=2026-08-08&to=2026-10-30&today=2026-10-30` (모두 선택. `today` 생략 시 서버 UTC 오늘 날짜, `to` 생략 시 `today`, `from` 생략 시 `to - 83일`[최근 12주 = 84일]. `from > to` 또는 기간이 366일을 넘으면 `400 INVALID_INPUT`)
- **설명:** 기록 화면(`log.html`)을 위해 이번 주·이번 달 총 시간, 날짜별 합산 달력 데이터, 상세 세션 목록(녹음 메타데이터 포함)을 반환합니다(`FR-LOG-1` ~ `3`, 구현 상세는 `개발산출물/명세/K2-1_구현명세.md`).
  - `summary`: `from`/`to` 범위와 무관하게 `today`가 속한 주(월~일)와 달(1일~말일)의 전체 연습 시간(초) 합계.
  - `calendar`: `[from, to]` 범위 내 `totalSeconds > 0`인 날짜만 오름차순 반환. `level`은 `1..899`초 → `1`, `900..1799`초 → `2`, `1800..3599`초 → `3`, `>= 3600`초 → `4`.
  - `sessions`: `[from, to]` 범위 내 세션을 `date DESC, updatedAt DESC` 순으로 반환(15개 필드), 내부 `takes[]`는 `recordedAt ASC` 순(`TakeDto` 12개 필드).
- **Response (`200 OK`):**
```json
{
  "summary": {
    "thisWeekSeconds": 5400,
    "thisMonthSeconds": 19800
  },
  "calendar": [
    { "date": "2026-10-29", "totalSeconds": 1800, "level": 3 },
    { "date": "2026-10-30", "totalSeconds": 3600, "level": 4 }
  ],
  "sessions": [
    {
      "id": "s1000000-0000-4000-8000-000000000001",
      "songId": "c1a2b3c4-0000-4000-8000-000000000001",
      "songTitle": "Autumn Leaves Jazz Guitar Chord Melody",
      "songArtist": "Jens Larsen",
      "videoId": "dQw4w9WgXcQ",
      "date": "2026-10-30",
      "seconds": 990,
      "minutes": 16.5,
      "loops": 26,
      "a": 38.0,
      "b": 55.2,
      "segment": "0:38–0:55",
      "rate": 0.75,
      "memo": "",
      "takes": [ ... ]
    }
  ]
}
```

### 4.3 세션 메모 수정
- **`PATCH /api/v1/sessions/{sessionId}`**
- **Request Body:** `{ "memo": "메트로놈 80bpm 연습 병행" }` (`memo` 필수, 문자열 2000자 이하, 빈 문자열 허용. 없는 세션·남의 세션·비 UUID는 `404 NOT_FOUND`, 노션 연동 시 `sync_outbox` `session` `upsert` 적재)
- **Response (`200 OK`):** `{ "ok": true }`

---

## 5. 오디오 녹음 테이크 API (`Takes`)

### 5.1 녹음 업로드 (`Multipart` 또는 `Drive` 메타 등록)
- **`POST /api/v1/takes`**
- **설명:**
  - **방식 1 (`multipart/form-data`, 기본 Supabase Storage):** `metadata`(JSON 파트)와 `file`(오디오 바이너리 파트)을 전송합니다. 서버가 200MB 쿼터를 검사(`FR-TAKE-4`)하고, 당일 세션이 없으면 0분 세션을 생성(`FR-TAKE-2`)한 뒤 스토리지(`{userId}/{takeId}.{ext}`)에 저장합니다. 업로드·DB 기록 순서는 [04 3.2절](04-db-design.md) 참고.
    - `metadata`: `{ songId, date, recordedAt, a, b, rate, durationSec, mime }` — `durationSec` 0~3600초, `mime`은 `;codecs=…`를 떼고 6종(`FR-TAKE-5`) 중 하나. `sizeBytes`·`storageKey`는 서버가 정합니다(보내도 무시).
    - 파일 50MB 초과 `413 TAKE_TOO_LARGE`, 쿼터 초과 `413 TAKE_QUOTA_EXCEEDED`, 저장소 실패 `502 STORAGE_ERROR`, 저장소 미설정 `503 STORAGE_UNAVAILABLE`.
  - **방식 2 (`application/json`, Google Drive 모드 `P6`, K6-1에서 구현):** 브라우저가 Google Drive에 먼저 업로드한 뒤 `{ songId, date, recordedAt, a, b, rate, durationSec, mime, sizeBytes, storage: "drive", storageKey: "<driveFileId>" }`를 전송해 DB 행만 등록합니다(`FR-DRIVE-2`). K1-2~K6-1 사이에는 multipart가 아니면 `400 INVALID_INPUT`. 노션 실시간 연동이 켜진 상태(notion_sync.enabled = true)에서는 409 NOTION_SYNC_CONFLICT로 거부합니다(FR-SYNC-5).
- **Response (`201 Created`):** `take`는 녹음 객체(`TakeDto`) 12개 필드이며 3.4·4.2의 녹음 항목과 같습니다.
```json
{
  "ok": true,
  "take": {
    "id": "t1000000-0000-4000-8000-000000000001",
    "sessionId": "s1000000-0000-4000-8000-000000000001",
    "recordedAt": "2026-10-30T14:22:10Z",
    "a": 38.0,
    "b": 55.2,
    "rate": 0.75,
    "durationSec": 18,
    "mime": "audio/mp4",
    "sizeBytes": 284120,
    "storage": "supabase",
    "storageKey": "550e8400-e29b-41d4-a716-446655440000/t1000000-0000-4000-8000-000000000001.m4a",
    "memo": ""
  }
}
```

### 5.2 녹음 재생용 서명 URL 발급 및 원본 다운로드
- **`GET /api/v1/takes/{takeId}/url`**
  - **설명:** Supabase Storage에 저장된 녹음에 대해 60분간 유효한 서명 URL(`createSignedUrl`)을 반환합니다(`FR-TAKE-6`).
  - **Response (`200 OK`):** `{ "url": "https://<project-ref>.supabase.co/storage/v1/object/sign/takes/...?token=...", "expiresIn": 3600 }`
  - `storage = 'drive'`인 녹음은 `400 INVALID_INPUT`(브라우저가 Drive에서 직접 재생), 서명 실패 `502 STORAGE_ERROR`.
- **`GET /api/v1/takes/{takeId}/download`** (K6-1)
  - **설명:** 기존 Supabase Storage에 저장된 녹음을 사용자 Google Drive로 이전할 때 브라우저가 원본 오디오 바이트를 다운로드하기 위해 호출합니다(`FR-DRIVE-3`).
  - **Response (`200 OK`):** 오디오 바이너리 (`Content-Type: <mime>`, `Cache-Control: private, no-store`). `storage = 'drive'`인 녹음은 `400 INVALID_INPUT`, 스토리지 다운로드 실패는 `502 STORAGE_ERROR`.

### 5.3 녹음 삭제 및 드라이브 이전 갱신
- **`DELETE /api/v1/takes/{takeId}`**: 스토리지 파일 및 `takes` 행 삭제(파일은 `storage_trash`를 거쳐 커밋 직후 삭제), 노션 연동 시 노션 오디오 블록 아카이브(`sync_outbox` `delete`). 세션 행은 남깁니다. **Response (`200 OK`):** `{ "ok": true }`
- **`POST /api/v1/takes/{takeId}/migrate-drive`** (K6-1): 기존 스토리지 녹음을 사용자 Google Drive로 옮긴 뒤 `{ "driveFileId": "..." }`(`^[A-Za-z0-9_-]{5,200}$`)를 전달하면 서버가 `storage = 'drive'`, `storage_key = driveFileId`로 변경하고 기존 Supabase Storage 파일을 `storage_trash`를 거쳐 즉시 삭제해 쿼터를 반환합니다(`FR-DRIVE-3`). 노션 실시간 연동이 켜진 상태에서는 `409 NOTION_SYNC_CONFLICT`로 거부합니다(`FR-SYNC-5`). **Response (`200 OK`):** `{ "ok": true, "take": { ... } }`

---

## 6. 외부 연동 키 관리 API (`Integrations`)

### 6.1 등록된 키 상태 목록 조회
- **`GET /api/v1/integrations?appId=ulevelp`**
- **설명:** 키 원문 없이 끝 4자리(`hint`), 설정(`config`), 수정 시각만 반환합니다(`FR-KEY-1`).
- **Response (`200 OK`):**
```json
{
  "integrations": [
    {
      "provider": "notion",
      "hint": "9a8b",
      "config": {
        "songsDb": "959cbe517e224419b48ca3313895a427",
        "sessionsDb": "6260633380b34d28989af90ddfbb4e67",
        "notesDb": "d708a561eb574175a8bb979642b3a76a"
      },
      "updatedAt": "2026-10-29T12:00:00Z"
    },
    {
      "provider": "gemini",
      "hint": "X9zQ",
      "config": { "model": "gemini-flash-latest" },
      "updatedAt": "2026-10-29T12:05:00Z"
    }
  ]
}
```

### 6.2 노션 키 등록·수정
- **`PUT /api/v1/integrations/notion`**
- **검증 규칙:**
  - `token`: 최초 등록 시 필수, `^(ntn_[A-Za-z0-9]{20,100}|secret_[A-Za-z0-9]{20,100})$` 정규식 검사. 수정 시 `null` 또는 빈 문자열이면 기존 암호화 토큰 유지(`FR-KEY-2`).
  - `songsDb`, `sessionsDb`(필수), `notesDb`(선택): 하이픈 허용 36자리(`^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$`) 검증 후 하이픈을 제거한 소문자 32자리(`replace("-", "").lowercase()`)로 정규화되어 저장됨.
- **Request Body:**
```json
{
  "appId": "ulevelp",
  "token": "ntn_1234567890abcdefghijklmnop9a8b",
  "songsDb": "959cbe51-7e22-4419-b48c-a3313895a427",
  "sessionsDb": "62606333-80b3-4d28-989a-f90ddfbb4e67",
  "notesDb": "d708a561-eb57-4175-a8bb-979642b3a76a"
}
```
- **Response (`200 OK`):**
```json
{
  "provider": "notion",
  "hint": "9a8b",
  "config": {
    "songsDb": "959cbe517e224419b48ca3313895a427",
    "sessionsDb": "6260633380b34d28989af90ddfbb4e67",
    "notesDb": "d708a561eb574175a8bb979642b3a76a"
  },
  "updatedAt": "2026-10-30T09:30:00Z"
}
```

### 6.3 Gemini 키 등록·수정
- **`PUT /api/v1/integrations/gemini`**
- **검증 규칙:**
  - `apiKey`: 최초 등록 시 필수, `^AIza[0-9A-Za-z_-]{35}$`(39자, `CryptoService`). 수정 시 `null` 또는 빈 문자열이면 기존 암호화 키 유지.
  - `model`: 기본값 `gemini-flash-latest`, `^[a-z0-9][a-z0-9.-]{0,63}$`.
- **Request Body:** `{ "appId": "ulevelp", "apiKey": "AIzaSy...", "model": "gemini-flash-latest" }`
- **Response (`200 OK`):**
```json
{
  "provider": "gemini",
  "hint": "X9zQ",
  "config": { "model": "gemini-flash-latest" },
  "updatedAt": "2026-10-30T09:30:00Z"
}
```

### 6.4 연결 유효성 점검 (`Check`)
- **`POST /api/v1/integrations/{provider}/check?appId=ulevelp`** (`provider`: `notion` | `gemini`)
- **설명:** 서버가 DB에서 키를 복호화하여 실제 노션 DB 3개의 필수 속성 스키마 또는 Gemini API 모델을 테스트합니다(`FR-KEY-3`).
- **에러 응답:**
  - `412 NO_KEY`: 해당 공급자 키가 등록되지 않음.
  - `503 CRYPTO_UNAVAILABLE`: 서버에 마스터 암호화 키(`APP_MASTER_KEY`)가 설정되지 않음.
  - `400 PROVIDER_KEY_INVALID`: 외부 API에서 401/403 거부됨 (`source = "notion"` 또는 `"gemini"` — 클라이언트가 `ulp:keys` 캐시를 즉시 무효화).
  - `404 NOTION_OBJECT_NOT_FOUND`: 노션 데이터베이스/페이지를 찾을 수 없음.
  - `400 NOTION_SCHEMA_MISMATCH`: 노션 DB에 필수 속성이 누락됨 (누락된 속성명 전체 나열).
  - `404 GEMINI_MODEL_NOT_FOUND`: 지정한 Gemini 모델을 찾을 수 없음.
- **Response (`200 OK` - 노션 예시):**
```json
{
  "ok": true,
  "provider": "notion",
  "songsTitle": "연습 곡",
  "sessionsTitle": "연습 기록",
  "notesTitle": "학습 영상 노트",
  "maxUploadMB": 5
}
```
- **Response (`200 OK` - Gemini 예시):**
```json
{
  "ok": true,
  "provider": "gemini",
  "model": "gemini-flash-latest",
  "displayName": "Gemini 2.5 Flash"
}
```

### 6.5 연결 해제
- **`DELETE /api/v1/integrations/{provider}?appId=ulevelp`**
- **설명:** `integrations` 행을 삭제하며, `provider=notion`인 경우 같은 트랜잭션에서 `notion_sync.enabled = false, lease_until = null, lease_owner = null`로 초기화합니다(`FR-KEY-4`).
- **Response (`200 OK`):** `{ "ok": true }`

---

## 7. 노션 실시간 동기화 및 ZIP 내보내기/가져오기 API (`Notion Sync & NX`)

### 7.1 동기화 상태 조회
- **`GET /api/v1/notion/sync/status`**
- **Response (`200 OK`):**
```json
{
  "enabled": true,
  "pending": 0,
  "failed": 0,
  "lastPushAt": "2026-10-30T09:25:00Z",
  "lastPullAt": "2026-10-30T09:20:00Z",
  "lastError": null
}
```

### 7.2 실시간 연동 켜기 (초기 전체 동기화 `full` 포함) 및 끄기
- **`POST /api/v1/notion/sync/enable`**
  - **설명:** 처음 연동을 켤 때 노션 DB의 기존 곡·세션·녹음·노트를 모두 읽어 서비스로 이관(`FR-SYNC-4`)하고 `notion_links`를 연결한 뒤 `enabled = true`로 설정합니다. 구글 드라이브 모드 사용 중이면 `409 NOTION_SYNC_CONFLICT`로 거부됩니다(`FR-SYNC-5`). 이미 이관된 녹음은 다운로드 자체를 건너뛰며, 200MB 쿼터 초과 오디오는 건너뛰며 2회 실행 시에도 중복이 발생하지 않습니다.
  - **Response (`200 OK`):** `{ "ok": true, "importedSongs": 24, "importedSessions": 115, "importedTakes": 18, "skippedTakesByQuota": 0 }`
- **`POST /api/v1/notion/sync/disable`**
  - **설명:** `notion_sync.enabled = false`로 전환합니다.
  - **Response (`200 OK`):** `{ "ok": true }`

### 7.3 수동/자동 Pull 및 Push 트리거
- **`POST /api/v1/notion/sync/pull`**: 노션에서 `last_edited_time > (lastPullAt - 2분)`(분 단위 절삭 보정)인 변경사항을 가져옵니다(5분 쿨다운 적용 시 `429 RATE_LIMITED` 및 `retryAfter` 초 반환, `FR-SYNC-2`). 로컬에 미처리 Outbox 항목이 있는 엔티티는 로컬 우선으로 건너뜁니다. **단, Pull로 반영된 변경사항은 `sync_outbox`에 절대 적재하지 않습니다(무한 루프 방지).**
  - **Response (`200 OK`):** `{ "ok": true, "updatedSongs": 3, "updatedSessions": 7, "lastPullAt": "2026-10-30T09:30:00Z" }`
- **`POST /api/v1/notion/sync/push`**: 클라이언트가 저장 직후 호출하는 즉시 반영 트리거(본인 대기열을 동기 처리 후 `{ ok, processed, failed }` 반환).
  - **Response (`200 OK`):** `{ "ok": true, "processed": 2, "failed": 0 }`
- **`POST /internal/cron/notion-push`**: Google Cloud Scheduler가 1분마다 호출하는 배치 엔드포인트. 대기열(`sync_outbox`)이 있는 사용자들을 순회하며 Push 처리하고(`FR-SYNC-1`), 같은 호출에서 `storage_trash` 파일 삭제(`attempts < 5`, 최대 50건)와 70분 넘게 `running`인 `analysis_jobs` 타임아웃 정리도 수행합니다.
  - **호출자 검증:** Cloud Run 서비스는 사용자용으로 공개(인증 없이 호출 허용)이므로 앱이 직접 검증합니다. `Authorization: Bearer <Google OIDC ID 토큰>`을 Google JWKS(`https://www.googleapis.com/oauth2/v3/certs`)로 서명 검증하고, `iss` = `https://accounts.google.com`, `aud` = 환경변수 `CRON_AUDIENCE`(서비스 URL), `email` = 환경변수 `CRON_SA_EMAIL` 이고 `email_verified = true`인지 확인합니다. 하나라도 틀리면 `401`.
  - Cloud Scheduler 작업의 OIDC 설정: 서비스 계정 = `CRON_SA_EMAIL`, audience = `CRON_AUDIENCE`. 분석 Job 실행용 서비스 계정에는 `run.jobs.runWithOverrides` 권한을 줍니다.
  - **Response (`200 OK`):** `{ "ok": true, "pushedUsers": 1, "processedOutbox": 3, "purgedTrash": 2, "timedOutJobs": 0 }`

### 7.4 노션 호환 ZIP 내보내기 및 노션 백업 ZIP 가져오기
- **`GET /api/v1/export/zip?includeAudio=true`**
  - **설명:** 서버에서 UTF-8 BOM CSV(`연습 곡.csv`, `연습 기록.csv`, `학습 영상 노트.csv`), 마크다운 노트(`학습 영상 노트/*.md`), 녹음 파일(`녹음/*.m4a`), `읽어주세요.txt`를 스트리밍 ZIP으로 묶어 내려줍니다(`FR-NX-2`). (클라이언트 JSZip 생성을 위한 `GET /api/v1/export/data`도 지원)
  - **쿼리 파라미터:** `includeAudio` (기본값 true). "false" 전달 시 오디오 제외.
  - **Response Headers:** `Content-Type: application/zip`, `Content-Disposition: attachment; filename="ULeveLP-export-${todayUtc}.zip"`, `Cache-Control: no-store`.
- **`POST /api/v1/import/notion/preview`** (`multipart/form-data`, `file`: 노션 백업 `.zip`)
  - **설명:** DB에 반영하지 않고 ZIP 내부 CSV와 오디오 폴더를 파싱하여 추가/갱신 예정 건수와 오류 행, 샘플 목록을 반환합니다(`FR-NX-4`). 최대 ZIP 크기 100MB(초과 시 `413 ZIP_TOO_LARGE`), 최대 압축 해제 용량 200MB(Zip Bomb 방어, 초과 시 `400 INVALID_INPUT`), 최대 엔트리 1,000개. Cloud Run 단일 인스턴스(`max-instances=1`) 전제로 15분 유효한 인메모리 미리보기 토큰(사용자당 최대 1개)을 발급합니다.
  - **Response (`200 OK`):**
```json
{
  "ok": true,
  "previewToken": "f1000000-0000-4000-8000-000000000001",
  "newSongs": 12,
  "updatedSongs": 3,
  "sessions": 45,
  "takes": 8,
  "songsSample": [
    { "title": "Autumn Leaves", "artist": "Eva Cassidy", "status": "연습중", "sessionsCount": 10 }
  ],
  "errors": []
}
```
- **`POST /api/v1/import/notion/confirm`**
  - **설명:** 미리보기 토큰을 확정하여 곡·세션을 트랜잭션으로 Upsert하고, 녹음 파일 업로드는 트랜잭션 밖에서 선행한 뒤 짧은 트랜잭션으로 `takes` 행을 커밋합니다(`FR-NX-3`). 200MB 쿼터 초과분은 건너뜁니다.
  - **Request Body:** `{ "previewToken": "f1000000-0000-4000-8000-000000000001" }`
  - **Response (`200 OK`):**
```json
{
  "ok": true,
  "createdSongs": 12,
  "updatedSongs": 3,
  "upsertedSessions": 45,
  "importedTakes": 8,
  "skippedTakesByQuota": 0
}
```

---

## 8. AI 학습 영상 노트 API (`Notes & Analysis Jobs`)

### 8.1 영상 분석 요청 (비동기 Job 생성)
- **`POST /api/v1/notes/analyze`**
- **설명:** 사용자의 Gemini 키 등록 여부(`412 NO_KEY`)와 요청 제한(동시 실행 1건 `retryAfter = 30`, UTC 당일 최대 20건 `429 RATE_LIMITED`)을 `profiles FOR UPDATE` 잠금 안에서 검사한 뒤, `analysis_jobs` 행(`queued`)을 만들고 Cloud Run Job `analyze`(환경 변수 `ANALYZE_JOB_ID=<jobId>` 덮어쓰기)를 실행해 Gemini 분석을 시작합니다(`FR-NOTE-1`, `FR-NOTE-2`). 디스패치 호출이 실패하면 작업 상태를 즉시 `failed`로 바꾸고 `502 JOB_DISPATCH_ERROR`를 반환합니다.
- **검증 규칙:** `url`에서 11자리 유튜브 `videoId` 추출 필수, `tags`는 `["화성", "사운드 디자인", "DAW/MIDI", "리듬", "편곡", "믹싱"]` 중 1~6개 필수, `memo`는 최대 2,000자(선택).
- **Request Body:**
```json
{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "tags": ["화성", "리듬"],
  "memo": "2분 15초 세컨더리 도미넌트 보이싱 집중 분석"
}
```
- **Response (`202 Accepted`):**
```json
{
  "jobId": "a1000000-0000-4000-8000-000000000001",
  "status": "queued"
}
```

### 8.2 분석 작업 상태 조회
- **`GET /api/v1/notes/jobs`** (최근 20건 작업 목록, `{ "jobs": [ ... ] }`) / **`GET /api/v1/notes/jobs/{jobId}`** (단건 폴링, `AnalysisJobDto` 13개 필드 — `kind`는 `note`(8.1 노트 분석) | `progression`(8.5 코드 진행 영상 분석). 두 종류가 한 목록에 섞여 나온다. `startSec`·`endSec`·`pace`는 코드 진행 영상 작업의 분석 구간·속도, 노트 작업은 `null`). 비동기 분석 중 Gemini API 키가 401/403이거나 응답 본문에 "API_KEY_INVALID"가 포함된 400으로 거부되면 `status = "failed"`, `error = "PROVIDER_KEY_INVALID: ..."`로 기록되며 클라이언트는 폴링 시 이를 감지해 `ulp:keys`의 `gemini` 캐시를 즉시 무효화합니다(`FR-KEY-5`). "API_KEY_INVALID"가 없는 일반 400(비공개·길이 초과 영상 등)은 `GEMINI_API_ERROR`로 기록되어 키 캐시를 유지합니다.
- **Response (`200 OK` - 단건 예시):**
```json
{
  "id": "a1000000-0000-4000-8000-000000000001",
  "kind": "note",
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "tags": ["화성", "리듬"],
  "status": "done",
  "error": null,
  "noteId": "b1000000-0000-4000-8000-000000000001",
  "createdAt": "2026-10-30T09:10:00Z",
  "startedAt": "2026-10-30T09:10:01Z",
  "finishedAt": "2026-10-30T09:11:15Z"
}
```

### 8.3 학습 노트 목록·상세 조회 및 수정·삭제
- **`GET /api/v1/notes`**: 내 학습 노트 요약 목록 조회 (`?tag=` 선택 필터: `화성`, `사운드 디자인`, `DAW/MIDI`, `리듬`, `편곡`, `믹싱`, `TAB` 7종 지원). **Response (`200 OK`):** `{ "notes": [ NoteSummaryDto, ... ] }` (`NoteSummaryDto`는 `NoteDetailDto`에서 `analysis`와 `diagramsSvg`를 뺀 15개 필드).
- **`GET /api/v1/notes/{noteId}`**: 노트 상세 조회(`FR-NOTE-3`). `analysis` JSON 원본과 함께 `harmony.progressions` 인덱스별 렌더링된 SVG 문자열 배열(`diagramsSvg`)을 포함한 `NoteDetailDto`(17개 필드 — V3에서 `collectProgressions` 추가)를 `{ "note": { ... } }`로 반환합니다.
```json
{
  "note": {
    "id": "b1000000-0000-4000-8000-000000000001",
    "videoId": "dQw4w9WgXcQ",
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "title": "세컨더리 도미넌트 보이싱 실전",
    "channel": "Jazz Guitar Lab",
    "tags": ["화성", "리듬"],
    "memo": "2분 15초 세컨더리 도미넌트 보이싱 집중 분석",
    "headline": "V7/ii와 V7/V에서의 가이드톤 반음계 연결을 다룹니다.",
    "points": ["3도와 7도 가이드톤 최소 이동", "컴핑 시 2·4박 뒤쪽 싱코페이션"],
    "keywords": ["Secondary Dominant", "Guide Tone", "Comping"],
    "difficulty": "중급",
    "model": "gemini-2.5-pro",
    "collectProgressions": false,
    "analysis": {
      "title": "세컨더리 도미넌트 보이싱 실전",
      "channel": "Jazz Guitar Lab",
      "headline": "V7/ii와 V7/V에서의 가이드톤 반음계 연결을 다룹니다.",
      "difficulty": "중급",
      "points": ["3도와 7도 가이드톤 최소 이동", "컴핑 시 2·4박 뒤쪽 싱코페이션"],
      "keywords": ["Secondary Dominant", "Guide Tone", "Comping"],
      "harmony": {
        "instrument": "기타",
        "progressions": [
          {
            "section": "A파트",
            "timestamp": "02:15",
            "key": "C major",
            "roman": "Imaj7 - VI7 - iim7 - V7",
            "chords": ["Cmaj7", "A7", "Dm7", "G7"],
            "role": "VI7(A7)의 C#이 Dm7의 C로 반음 하행 해결"
          }
        ]
      },
      "rhythm": [
        {
          "timestamp": "03:10",
          "groove": "미디엄 스윙 4비트에 찰스턴 리듬 변형",
          "tip": "메트로놈을 2·4박에 두고 첫 박 뒤 8분음표 액센트 연습"
        }
      ],
      "practice": ["느린 템포(BPM 70)에서 가이드톤 2성부만 먼저 연결하기"]
    },
    "diagramsSvg": ["<svg xmlns=\"http://www.w3.org/2000/svg\" ...>...</svg>"],
    "createdAt": "2026-10-30T09:11:15Z",
    "updatedAt": "2026-10-30T09:11:15Z"
  }
}
```
- **`PATCH /api/v1/notes/{noteId}`**: `{ "memo": "...", "tags": ["화성", "TAB"], "title": "..." }`(셋 중 하나 이상 필수) 수정 및 노션 연동 시 `sync_outbox` `note` `upsert` 적재. **Response (`200 OK`):** `{ "note": { ... } }`.
- **`DELETE /api/v1/notes/{noteId}`**: 노트 삭제 및 노션 연동 시 노션 페이지 아카이브(`sync_outbox` `note` `delete`). **Response (`200 OK`):** `{ "ok": true }`. 그 노트에서 수집한 코드 진행은 남고 `noteId`만 `null`이 된다(8.5절).

### 8.4 노트 "코드 진행 수집에 넣기" 토글
- **`PUT /api/v1/notes/{noteId}/collect`** `{ "collect": true | false }` → `200 { "noteId": "...", "collect": true, "progressions": [ProgressionDto, ...] }` (켜면 그 노트에서 온 행 전체(노트 안 순번 순), 끄면 `[]`).
- 켜면 `analysis.harmony.progressions[]`마다 진행 행을 만든다(`kind=analysis`, `origin=ai`, `route=note`). 이미 있는 순번은 건너뛰므로 다시 켜도 중복이 없고, 지운 순번만 다시 생긴다. 코드가 하나도 없는 진행은 행을 만들지 않는다(화성 진행이 없는 노트는 0행, 토글 값은 저장).
- 끄면 그 노트에서 온 행을 **모두** 지운다(사람이 고친 행 포함).
- AI 값 정규화: 키 `C major`/`Am` → `C Major`/`A min`(노션 Scale 철자, 못 읽으면 `null`), roman `maj7→M7`·`ø→m7b5`·`°7→dim7`·공백 제거, 코드 `source`·`timestamp` 외 필드(`lh`·`frets` 등)는 저장하지 않음. 대표 근거 `evidence` = 코드 `source` 중 가장 약한 값(`추정` > `말함` > `화면`, `source` 없는 코드는 `추정`).
- `collect`가 boolean이 아니면 `400 INVALID_INPUT`, 남의 노트·없는 노트·비 UUID는 `404 NOT_FOUND`.

### 8.5 코드 진행 모음 (`Progressions`, CHORDS)
- **설명:** 한 행 = 진행 하나. 레퍼런스(직접 입력) / 분석(영상·노트에서 수집 또는 직접). 테이블은 [04 2.2절](04-db-design.md). 노션 push는 아직 없음(CH-7).
- **진행 객체(`ProgressionDto`, 25개 필드):**
```json
{
  "id": "uuid", "kind": "reference", "origin": "manual", "route": "manual", "evidence": null,
  "title": "Just the Two of Us", "part": "", "artist": "Grover Washington Jr.", "album": "", "channel": "",
  "releaseDate": null, "key": "F Major", "instrument": null,
  "chords": [{ "symbol": "FM7", "roman": "IM7" }],
  "moods": ["nostalgia"], "genres": ["RnB"], "tags": [],
  "url": "https://youtu.be/...", "videoId": "dQw4w9WgXcQ", "startSec": null, "endSec": null,
  "memo": "", "noteId": null, "createdAt": "ISO", "updatedAt": "ISO"
}
```
  - `kind` `reference`|`analysis`, `origin` `ai`|`manual`, `route` `video`|`note`|`manual`, `evidence` `화면`|`말함`|`추정`|`null`, `instrument` `건반`|`기타`|`null`
  - `chords[]` 원소: `symbol`(입력 표기 그대로) · `roman` · AI 행만 `source` · `timestamp`
- **`GET /api/v1/progressions?scope=reference|analysis|all`** → `200 { "progressions": [...] }`. `scope` 생략 = `all`, 다른 값은 `400`. 정렬 `createdAt` 내림차순.
- **`POST /api/v1/progressions`** → `201 { "progression": ProgressionDto }`
  - 필수: `kind`, `title`(1~300자), `chords`(1~64개). 선택: `part`(≤100) `artist`·`album`·`channel`(≤200) `releaseDate`(`YYYY-MM-DD`, 1900~2100년) `key`(`^[A-G](#|b)? (Major|min)$`, 빈 문자열·`null`은 없음) `moods`·`genres`·`tags`(각 ≤10개, 원소 1~30자·쉼표 금지·중복 제거) `url`(`http(s)://`, ≤500) `startSec`·`endSec`(0~86400, `start < end`) `memo`(≤2000)
  - `chords[]` 검증: 객체, `symbol` 1~24자(앞뒤 공백 제거), `roman` ≤24자, `source` 화면·말함·추정, `timestamp` `mm:ss`|`h:mm:ss`. 모르는 키는 버린다. 직접 행의 `source`는 저장하지 않는다
  - 서버가 정함: `origin=manual`, `route=manual`, `evidence`·`instrument`·`noteId` = `null`. `url`이 유튜브(youtube.com·youtu.be)면 `videoId` 추출
  - 사용자당 3000행을 넘으면 `400 INVALID_INPUT` "코드 진행은 최대 3000개까지 저장할 수 있습니다."
- **`PATCH /api/v1/progressions/{id}`** → `200 { "progression": ProgressionDto }`. 보낸 필드만 바꾼다(문자열 칸 `null` = 빈 문자열, 목록 `null` = `[]`, `key`·`releaseDate`·`startSec`·`endSec` `null` = 비움, `kind`·`title`·`chords` `null`은 400). 아는 필드가 하나도 없으면 400. `startSec`·`endSec`는 기존 값과 합쳐 검사.
  - AI 행에서 `chords`(source 제외 비교) 또는 `key`가 **실제로 바뀌면** `origin=manual`, `evidence=null`, 코드 `source` 제거. `route`·`noteId`는 그대로. 바뀌지 않으면 AI와 코드 `source` 유지
  - `kind`를 `reference`로 바꾸려면 `route=manual`이어야 함(아니면 `400` "영상에서 온 진행은 레퍼런스로 바꿀 수 없습니다.")
- **`DELETE /api/v1/progressions/{id}`** → `200 { "ok": true }`. 노트에서 온 행을 지워도 노트 토글은 켠 채로 둔다.
- 없는 행·남의 행·비 UUID 경로 `404 NOT_FOUND`, 토큰 없음 `401 UNAUTHORIZED`. 모든 응답 `Cache-Control: no-store`.
- **`POST /api/v1/progressions/analyze`** `{ "url": "유튜브 주소(≤500)", "memo": "선택(≤2000)", "startSec": 선택 정수, "endSec": 선택 정수, "pace": "선택 slow|normal|fast" }` → `202 { "jobId": "uuid", "status": "queued" }` — 코드 진행 영상 분석
  - 구간·속도(GA-2): `startSec`·`endSec`는 정수 초 0~86400, `endSec`는 `startSec`(없으면 0)보다 1초 이상 커야 한다. `pace`는 `slow`·`normal`·`fast`(없으면 `normal`). 어기면 `400 INVALID_INPUT`. Gemini `video_metadata`에 `fps`(slow 0.5 · normal 1 · fast 3)와 구간 `start_offset`·`end_offset`(`"40s"`)을 넣는다. 노트 분석(8.1)은 이 필드를 받지 않고 `GEMINI_FRAME_FPS`(기본 0.2)
  - 검증·제한은 8.1과 같다(유튜브 URL 아니면 `400`, Gemini 키 없음 `412 NO_KEY`, 동시 1건·UTC 하루 20건 `429 RATE_LIMITED` — **노트 분석과 합산**, 디스패치 실패 `502`). 태그는 서버가 `["화성"]`로 정한다(본문 `tags` 없음)
  - `analysis_jobs.kind = 'progression'`. 진행 전용 프롬프트(공통 스키마 + 화성 확장판: 진행에 `song`·`artist`·`start`·`end`, `key`는 `F Major`·`A min` 형식, 코드 심볼은 화면 표기 그대로)로 Gemini를 부른다. 일반 노트(8.1)의 프롬프트·스키마는 그대로
  - 상태 조회는 8.2(`/notes/jobs`·`/notes/jobs/{id}`), `kind = "progression"`
  - 완료 시 한 트랜잭션: 노트 생성(태그 `화성`, `collectProgressions = true`) + 화성 진행마다 진행 행(`kind=analysis`, `origin=ai`, `route=video`, `noteId` = 그 노트, 코드가 0개인 진행은 행 없음) + 작업 `done`. 화성 진행이 없으면 노트만 생긴다(작업은 `done`, 진행 수는 목록으로 확인)
  - 행 값: `title` = 진행 `song`(비면 영상 제목), `artist`, `part` = 진행 `name`, `channel` = 영상 채널, `key` 정규화(`C# Major`→`Db Major`, 못 읽으면 `null`), `roman` 정규화(`maj7`→`M7` 등), `startSec`·`endSec` = `start`·`end`(비면 첫 코드 `timestamp`), `evidence` = 코드 `source` 중 가장 약한 것(추정 > 말함 > 화면)

---

## 9. 코드 연습실 계산 API (기존 `server.js` 100% 호환)

기존 [server.js](../server.js)가 제공하던 8개 엔드포인트를 동일한 쿼리 파라미터와 JSON 응답 스펙으로 제공합니다.

| Method & Path | Query Params 예시 | 설명 |
| --- | --- | --- |
| `GET /api/health` | - | `{ "ok": true }` (Cloud Run Liveness/Readiness Probe 겸용) |
| `GET /api/voicings` | `?root=G&quality=13&lo=3&hi=8&span=3&notes=4&guide=2&limit=30` | 코드 하나의 보이싱 목록 |
| `GET /api/two-five-one` | `?key=C&lo=5&hi=8&pent=A&pentType=min&outside=2` | 프렛 창 안의 가이드톤 이동 최소 ii-V-I 경로 |
| `GET /api/top-note` | `?string=1&fret=8&span=3&notes=4` | 탑노트 고정 도미넌트 7th 보이싱 전체 |
| `GET /api/circle` | `?root=F&top=2` | 5도권 탑노트 고정 진행 |
| `GET /api/matrix` | `?root=C&drop=d2&inv=0&span=4` | 드롭 × 전위 × 줄 세트 × 9개 성질 매트릭스 |
| `GET /api/scale` | `?root=A&type=pentMin&tuning=g6&lo=5&hi=8` (또는 `&circle=5`) | 스케일 구성음 및 지판 위치 / 12키 순환 변화음 |
| `GET /api/interpret` | `?frets=x,x,4,2,2,4` | 6번줄~1번줄 프렛 배열 코드 재해석 |
