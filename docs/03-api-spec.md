# 03. 기능 API 명세서 (Kotlin Ktor + Google Cloud Run)

> **문서 버전:** 2026-10-30
> **Base URL:** `https://<cloud-run-domain>` (로컬 개발 시 `http://localhost:3000`)

---

## 1. 공통 규칙

### 1.1 인증 및 헤더
- **인증 방식:** `Authorization: Bearer <access_token>` (Google OAuth2 로그인 후 발급된 JWT 또는 Supabase Auth 호환 JWT)
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
  - `NO_KEY` (`412`): 해당 기능에 필요한 노션/Gemini 키 미등록 (`FR-KEY-GATE`)
  - `PROVIDER_KEY_INVALID` (`400` / `401` / `403`): 등록된 노션 토큰 또는 Gemini 키가 외부 API에서 거부됨 → 클라이언트는 `ulp:keys` 캐시 초기화
  - `NOTION_OBJECT_NOT_FOUND` (`404`): 노션 DB를 찾을 수 없거나 페이지에 통합이 연결되지 않음
  - `TAKE_QUOTA_EXCEEDED` (`413`): 기본 스토리지 녹음 용량 한도(200MB) 초과
  - `RATE_LIMITED` (`429`): 요청 빈도 제한 초과 (`retryAfter` 초 반환)

---

## 2. 인증 및 내 프로필 API (`Auth & Profile`)

### 2.1 Google OAuth 로그인 콜백 / 토큰 교환
- **`POST /api/v1/auth/google`** (또는 OAuth2 Redirect 흐름 `GET /api/v1/auth/google/callback`)
- **설명:** Google OAuth 인가 코드(Authorization Code, PKCE) 또는 ID Token을 검증하고, 최초 로그인 시 `users` 및 `profiles` 행을 자동 생성(`FR-AUTH-2`)한 뒤 세션 JWT를 발급합니다.
- **Response (`200 OK`):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "def50200...",
  "expiresIn": 3600,
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "player@example.com",
    "displayName": "player"
  }
}
```

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
      "totalSeconds": 3420,
      "resumeUrl": "https://hunseokc.github.io/ULevelP/practice.html?v=dQw4w9WgXcQ&t=42.5&a=38&b=55.2&r=0.75"
    }
  ]
}
```

### 3.2 유튜브 영상 ID로 단일 곡 조회
- **`GET /api/v1/songs/by-video/{videoId}`**
- **설명:** 플레이어(`practice.html?v=...`) 진입 시 호출합니다(`FR-SONG-1`). 등록된 곡이 없으면 `song: null`을 반환합니다.
- **Response (`200 OK`):** `{ "song": { ... } }` 또는 `{ "song": null }`

### 3.3 연습 곡 추가 (멱등 생성)
- **`POST /api/v1/songs`**
- **설명:** 새 연습 곡을 등록합니다(`FR-SONG-2`). 이미 동일 `videoId`로 등록된 곡이 있으면 기존 곡을 그대로 반환합니다. `title`이 비어 있으면 서버가 YouTube oEmbed API를 호출하여 제목과 채널명을 채웁니다.
- **Request Body:**
```json
{
  "videoId": "dQw4w9WgXcQ",
  "title": "",
  "artist": "",
  "rate": 1.0
}
```
- **Response (`200 OK` / `201 Created`):** `{ "song": { ... } }`

### 3.4 곡 상세 조회 (타임라인 및 녹음 목록 포함)
- **`GET /api/v1/songs/{songId}`**
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
  - **Request Body:** `{ "status": "보류", "memo": "다음 달 재도전", "title": "수정할 제목(선택)" }`
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
- **Response (`200 OK`):** `{ "created": 1, "skipped": 0, "migratedLocalAt": "2026-10-30T09:30:00Z" }`

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
  "minutes": 16.5
}
```
*(1분 미만 보류 시: `{ "ok": true, "keep": true, "sessionId": null, "pendingSeconds": 30 }`)*

### 4.2 기간별 연습 기록 및 12주 달력 조회
- **`GET /api/v1/sessions`**
- **Query Params:** `from=2026-08-01&to=2026-10-30` (기본값: 오늘 기준 최근 12주)
- **설명:** 기록 화면(`log.html`)을 위해 이번 주·이번 달 총 시간, 날짜별 합산 달력 데이터, 상세 세션 목록(녹음 메타데이터 포함)을 반환합니다(`FR-LOG-1` ~ `3`).
- **Response (`200 OK`):**
```json
{
  "summary": {
    "thisWeekSeconds": 5400,
    "thisMonthSeconds": 19800
  },
  "calendar": [
    { "date": "2026-10-29", "totalSeconds": 1800, "level": 2 },
    { "date": "2026-10-30", "totalSeconds": 3600, "level": 3 }
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
- **Request Body:** `{ "memo": "메트로놈 80bpm 연습 병행" }`
- **Response (`200 OK`):** `{ "ok": true }`

---

## 5. 오디오 녹음 테이크 API (`Takes`)

### 5.1 녹음 업로드 (`Multipart` 또는 `Drive` 메타 등록)
- **`POST /api/v1/takes`**
- **설명:**
  - **방식 1 (`multipart/form-data`, 기본 Supabase Storage):** `metadata`(JSON 파트)와 `file`(오디오 바이너리 파트)을 전송합니다. 서버가 200MB 쿼터를 검사(`FR-TAKE-4`)하고, 당일 세션이 없으면 0분 세션을 생성(`FR-TAKE-2`)한 뒤 스토리지(`{userId}/{takeId}.{ext}`)에 저장합니다. 업로드·DB 기록 순서는 [04 3.2절](04-db-design.md) 참고.
  - **방식 2 (`application/json`, Google Drive 모드 `P6`):** 브라우저가 Google Drive에 먼저 업로드한 뒤 `{ songId, date, recordedAt, a, b, rate, durationSec, mime, sizeBytes, storage: "drive", storageKey: "<driveFileId>" }`를 전송해 DB 행만 등록합니다(`FR-DRIVE-2`).
- **Response (`201 Created`):**
```json
{
  "ok": true,
  "take": {
    "id": "t1000000-0000-4000-8000-000000000001",
    "sessionId": "s1000000-0000-4000-8000-000000000001",
    "recordedAt": "2026-10-30T14:22:10Z",
    "durationSec": 18,
    "mime": "audio/mp4",
    "sizeBytes": 284120,
    "storage": "supabase"
  }
}
```

### 5.2 녹음 재생용 서명 URL 발급
- **`GET /api/v1/takes/{takeId}/url`**
- **설명:** Supabase Storage에 저장된 녹음에 대해 60분간 유효한 서명 URL(`createSignedUrl`)을 반환합니다(`FR-TAKE-6`).
- **Response (`200 OK`):** `{ "url": "https://storage.googleapis.com/...", "expiresIn": 3600 }`

### 5.3 녹음 삭제 및 드라이브 이전 갱신
- **`DELETE /api/v1/takes/{takeId}`**: 스토리지 파일 및 `takes` 행 삭제, 노션 연동 시 노션 오디오 블록 아카이브(`sync_outbox` `delete`).
- **`POST /api/v1/takes/{takeId}/migrate-drive`**: 기존 스토리지 녹음을 사용자 Google Drive로 옮긴 뒤 `{ "driveFileId": "..." }`를 전달하면 서버가 `storage = 'drive'`, `storage_key = driveFileId`로 변경하고 기존 Supabase Storage 파일을 삭제해 쿼터를 반환합니다(`FR-DRIVE-4`).

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
  - `token`: 최초 등록 시 필수, `^(ntn_|secret_)[A-Za-z0-9]{20,}$` 정규식 검사. 수정 시 `null`이면 기존 암호화 토큰 유지.
  - `songsDb`, `sessionsDb`(필수), `notesDb`(선택): 32자리 16진수(`^[0-9a-f]{32}$`).
- **Request Body:**
```json
{
  "appId": "ulevelp",
  "token": "ntn_1234567890abcdefghijklmnop9a8b",
  "songsDb": "959cbe517e224419b48ca3313895a427",
  "sessionsDb": "6260633380b34d28989af90ddfbb4e67",
  "notesDb": "d708a561eb574175a8bb979642b3a76a"
}
```
- **Response (`200 OK`):** `{ "provider": "notion", "hint": "9a8b", "updatedAt": "2026-10-30T09:30:00Z" }`

### 6.3 Gemini 키 등록·수정
- **`PUT /api/v1/integrations/gemini`**
- **검증 규칙:**
  - `apiKey`: 최초 등록 시 필수, `^AIza[0-9A-Za-z_-]{30,60}$`.
  - `model`: 기본값 `gemini-flash-latest`, `^[a-z0-9][a-z0-9.-]{0,63}$`.
- **Request Body:** `{ "appId": "ulevelp", "apiKey": "AIzaSy...", "model": "gemini-flash-latest" }`
- **Response (`200 OK`):** `{ "provider": "gemini", "hint": "X9zQ", "updatedAt": "2026-10-30T09:30:00Z" }`

### 6.4 연결 유효성 점검 (`Check`)
- **`POST /api/v1/integrations/{provider}/check`** (`provider`: `notion` | `gemini`)
- **설명:** 서버가 DB에서 키를 복호화하여 실제 노션 DB 3개의 속성 스키마 또는 Gemini API 모델을 테스트합니다(`FR-KEY-3`).
- **Response (`200 OK` - 노션 예시):**
```json
{
  "ok": true,
  "songsTitle": "연습 곡",
  "sessionsTitle": "연습 기록",
  "notesTitle": "학습 영상 노트",
  "maxUploadMB": 5
}
```

### 6.5 연결 해제
- **`DELETE /api/v1/integrations/{provider}?appId=ulevelp`**
- **설명:** `integrations` 행을 삭제하며, `provider=notion`인 경우 `notion_sync.enabled = false`로 함께 전환합니다(`FR-KEY-4`).

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
  - **설명:** 처음 연동을 켤 때 노션 DB 3개의 기존 곡·세션·녹음·노트를 모두 읽어 서비스로 이관(`FR-SYNC-4`)하고 `notion_links`를 연결한 뒤 `enabled = true`로 설정합니다.
  - **Response (`200 OK`):** `{ "ok": true, "importedSongs": 24, "importedSessions": 115, "importedTakes": 18, "skippedTakesByQuota": 0 }`
- **`POST /api/v1/notion/sync/disable`**
  - **설명:** `notion_sync.enabled = false`로 전환합니다.

### 7.3 수동/자동 Pull 및 Push 트리거
- **`POST /api/v1/notion/sync/pull`**: 노션에서 `last_edited_time > last_pull_at`인 변경사항을 가져옵니다(5분 쿨다운 적용, `FR-SYNC-2`).
- **`POST /api/v1/notion/sync/push`**: 클라이언트가 저장 직후 호출하는 즉시 반영 트리거(본인 대기열만 비동기 실행).
- **`POST /internal/cron/notion-push`**: Google Cloud Scheduler가 1분마다 호출하는 배치 엔드포인트. 대기열(`sync_outbox`)이 있는 사용자들을 순회하며 처리하고(`FR-SYNC-1`), 같은 호출에서 `storage_trash` 파일 삭제와 70분 넘게 `running`인 `analysis_jobs` 정리도 합니다.
  - **호출자 검증:** Cloud Run 서비스는 사용자용으로 공개(인증 없이 호출 허용)이므로 앱이 직접 검증합니다. `Authorization: Bearer <Google OIDC ID 토큰>`을 Google JWKS(`https://www.googleapis.com/oauth2/v3/certs`)로 서명 검증하고, `iss` = `https://accounts.google.com`, `aud` = 환경변수 `CRON_AUDIENCE`(서비스 URL), `email` = 환경변수 `CRON_SA_EMAIL` 이고 `email_verified = true`인지 확인합니다. 하나라도 틀리면 `401`.
  - Cloud Scheduler 작업의 OIDC 설정: 서비스 계정 = `CRON_SA_EMAIL`, audience = `CRON_AUDIENCE`. 분석 Job 실행용 서비스 계정에는 `run.jobs.runWithOverrides` 권한을 줍니다.

### 7.4 노션 호환 ZIP 내보내기 및 노션 백업 ZIP 가져오기
- **`GET /api/v1/export/zip?includeAudio=true`**
  - **설명:** 서버에서 UTF-8 BOM CSV(`연습 곡.csv`, `연습 기록.csv`, `학습 영상 노트.csv`), 마크다운 노트, 녹음 파일, `읽어주세요.txt`를 스트리밍 ZIP으로 묶어 내려줍니다(`FR-NX-2`). (클라이언트 JSZip 생성을 위한 `GET /api/v1/export/data`도 지원)
- **`POST /api/v1/import/notion/preview`** (`multipart/form-data`, `file`: 노션 백업 `.zip`)
  - **설명:** DB에 반영하지 않고 ZIP 내부 CSV와 오디오 폴더를 파싱하여 추가/갱신 예정 건수와 오류 행을 반환합니다(`FR-NX-4`).
- **`POST /api/v1/import/notion/confirm`**
  - **설명:** 미리보기 토큰(또는 파싱된 페이로드)을 확정하여 곡·세션·녹음을 일괄 Upsert합니다(`FR-NX-3`).

---

## 8. AI 학습 영상 노트 API (`Notes & Analysis Jobs`)

### 8.1 영상 분석 요청 (비동기 Job 생성)
- **`POST /api/v1/notes/analyze`**
- **설명:** 사용자의 Gemini 키 등록 여부(`412 NO_KEY`)와 요청 제한(동시 실행 1건, 일 최대 20건 `429 RATE_LIMITED`)을 검사한 뒤, `analysis_jobs` 행(`queued`)을 만들고 Cloud Run Job `analyze`(`runWithOverrides`, 인자 `jobId`)를 실행해 Gemini 분석을 시작합니다(`FR-NOTE-1`, `FR-NOTE-2`).
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
  "jobId": "j1000000-0000-4000-8000-000000000001",
  "status": "queued"
}
```

### 8.2 분석 작업 상태 조회
- **`GET /api/v1/notes/jobs`** (최근 작업 목록) / **`GET /api/v1/notes/jobs/{jobId}`** (단건 폴링)
- **Response (`200 OK`):**
```json
{
  "id": "j1000000-0000-4000-8000-000000000001",
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "tags": ["화성", "리듬"],
  "status": "done",
  "error": null,
  "noteId": "n1000000-0000-4000-8000-000000000001",
  "createdAt": "2026-10-30T09:10:00Z",
  "startedAt": "2026-10-30T09:10:01Z",
  "finishedAt": "2026-10-30T09:11:15Z"
}
```

### 8.3 학습 노트 목록·상세 조회 및 수정·삭제
- **`GET /api/v1/notes`**: 내 학습 노트 목록 조회 (`tag` 필터 지원).
- **`GET /api/v1/notes/{noteId}`**: 노트 상세 조회(`FR-NOTE-3`). `analysis` JSON 원본과 함께 화성 진행별 렌더링된 SVG 문자열(`diagramsSvg`)을 포함해 반환하므로 프런트엔드는 별도 계산 없이 즉시 화면에 표시할 수 있습니다.
- **`PATCH /api/v1/notes/{noteId}`**: `{ "memo": "...", "tags": ["화성", "TAB"] }` 수정.
- **`DELETE /api/v1/notes/{noteId}`**: 노트 삭제 (노션 연동 시 노션 페이지 아카이브).

---

## 9. 코드 연습실 계산 API (기존 `server.js` 100% 호환)

기존 [`server.js`](../server.js)가 제공하던 8개 엔드포인트를 동일한 쿼리 파라미터와 JSON 응답 스펙으로 제공합니다.

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

