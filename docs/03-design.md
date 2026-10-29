# 03. 설계

[04-data-model.md](04-data-model.md)의 테이블·함수 이름을 그대로 씁니다.

## 1. 구성

```
브라우저 (GitHub Pages 정적 파일, 빌드 없음)
 ├─ supabase-js ──────────────▶ Supabase
 │                               ├─ Auth (Google OAuth)
 │                               ├─ Postgres (RLS) ── 테이블·함수
 │                               ├─ Storage (takes 버킷)
 │                               └─ Edge Functions (소유자 전용 + 계정 삭제)
 │                                    ├─ owner-settings ──▶ Vault (노션 토큰, Gemini 키)
 │                                    ├─ notion-push  ◀── pg_cron 1분마다 ──▶ 노션 API
 │                                    ├─ notion-pull ─────────────────────▶ 노션 API
 │                                    ├─ analyze-video ───────────────────▶ Gemini API
 │                                    └─ delete-account
 ├─ Google Identity Services ──▶ Google Drive API (P6, 브라우저에서 직접)
 └─ YouTube IFrame API
```

- 서버를 직접 운영하지 않습니다. 일반 사용자의 모든 읽기·쓰기는 브라우저 → Supabase(RLS) 직통입니다.
- Edge Function은 비밀 값이 필요한 일(소유자 키, 노션, Gemini)과 service role이 필요한 일(계정 삭제)에만 씁니다.
- `server.js`와 Docker는 로컬 개발용입니다. Supabase도 로컬에서는 `supabase start`(Supabase CLI, Docker 필요)로 띄웁니다.

## 2. 클라이언트 구조

새로 생기는 파일:

| 파일 | 역할 |
| --- | --- |
| `public/config.js` | `window.ULEVELP_CONFIG = { supabaseUrl, supabaseAnonKey, googleClientId, siteUrl }`. 모두 공개해도 되는 값 |
| `public/auth.js` | Supabase 클라이언트 생성, 로그인·로그아웃, 상단 메뉴 계정 표시, `onAuthStateChange` |
| `public/data.js` | 저장 계층. 아래 인터페이스. 화면 코드는 Supabase를 직접 부르지 않고 이것만 씀 |
| `public/drive.js` | (P6) Google Identity Services 토큰, 드라이브 폴더·업로드·재생 |
| `public/log.html` | 기록 화면 (기록·곡 탭, 곡 상세) |
| `public/note.html` | (P5) 학습 노트 한 건 보기 |
| `public/privacy.html` | 개인정보 안내 (NFR-PRIV-1) |
| `supabase/migrations/*.sql` | 04 문서의 SQL |
| `supabase/functions/*` | Edge Functions (Deno, TypeScript) |
| `supabase/tests/*.sql` | pgTAP 테스트 (RLS, 함수) |

`supabase-js`는 `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@<정확한 버전>/+esm`에서 ES 모듈로 불러옵니다. 압축(zip)은 JSZip을 같은 방식으로 정확한 버전을 고정해 불러옵니다. 각 HTML은 `<script type="module">`로 `auth.js`·`data.js`를 불러오고, 기존 `practice.js` 같은 클래식 스크립트는 `window.ULData`로 접근합니다.

### 2.1 저장 계층 인터페이스 (`data.js`)

지금 `practice.js`가 Apps Script에 보내던 요청과 1:1로 대응시켜서, `practice.js`의 수정은 `api.call(...)` 부분 교체로 끝나게 합니다.

| 지금 (`api.call`) | 새 메서드 | 구현 |
| --- | --- | --- |
| `/health` | (없음) | 로그인 여부로 대체 |
| `/songs` | `ULData.songs.list()` | `songs` 선택, FR-SONG-4 순서로 정렬 |
| `/song?v=` | `ULData.songs.findByVideo(videoId)` | `songs` where `video_id` |
| `/song` POST | `ULData.songs.create({ videoId, title, artist, rate })` | insert, 충돌하면 기존 행 반환. 제목이 비면 oEmbed |
| `/save` | `ULData.saveProgress({ songId, pos, a, b, rate, date, addSeconds, addLoops })` → `{ keep, sessionId, totalSeconds }` | `rpc('save_song_progress')` 후 `addSeconds·addLoops`가 있으면 `rpc('add_practice')`. `kept`를 `keep`으로 |
| `/record` | `ULData.takes.upload({ songId, date, recordedAt, a, b, rate, seconds, mime, blob })` → `{ takeId }` | [4.2](#42-녹음) 순서 |
| 새로 | `ULData.songs.update(id, { status, memo })`, `songs.remove(id)` | |
| 새로 | `ULData.sessions.range(from, to)`, `sessions.bySong(songId)`, `sessions.update(id, { memo })` | 기록 화면 |
| 새로 | `ULData.takes.list({ sessionId | songId })`, `takes.url(take)`, `takes.remove(id)` | `url`: Storage는 `createSignedUrl(60분)`, 드라이브는 [5.2](#52-구글-드라이브-p6) |

반환하는 곡 객체 모양은 지금 `Code.gs` `readSong`과 같게 유지합니다: `{ id, title, artist, status, videoId, pos, a, b, rate, lastDate }`. `status`는 화면에 쓰는 한글 이름(`연습 중` 등)으로 바꿔서 돌려주고, 저장할 때 코드로 바꿉니다.

비로그인일 때 `ULData`는 `{ signedIn: false }`이고, `practice.js`는 지금의 "노션 연결 없음" 분기처럼 기기 저장만 합니다(FR-LOCAL-1).

## 3. 인증

- `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: 지금 페이지 주소 } })`. PKCE 흐름(supabase-js 기본).
- Supabase 대시보드 Auth → URL Configuration: Site URL = `https://hunseokc.github.io/ULevelP/`, Redirect URLs = `https://hunseokc.github.io/ULevelP/**`, `http://localhost:3000/**`, `https://hunseokc.github.io/guitar-practice/**`(D18: guitar-practice도 같은 프로젝트로 로그인).
- 세션은 supabase-js 기본(localStorage)에 둡니다.
- 상단 메뉴 오른쪽 끝에 계정 표시(FR-AUTH-5). 누르면 SETTING의 계정 칸으로.
- **첫 로그인 후 기기 기록 옮기기 (FR-LOCAL-2):** 로그인 직후 `profiles.migrated_local_at`이 비어 있고 localStorage에 `pp:v:*` 키가 있으면 확인 창. 확인하면 키마다 `songs.create` + `save_song_progress`(시간 기록은 없음), 끝나면 `migrated_local_at = now()`. 취소해도 `migrated_local_at`을 채워 다시 묻지 않음.
- **계정 삭제 (FR-AUTH-4):** Edge Function `delete-account`가 호출자 JWT 확인 → Storage `takes/{uid}/` 전부 삭제 → `auth.admin.deleteUser(uid)` (나머지 행은 `on delete cascade`).

## 4. 플레이어 저장 흐름

### 4.1 자동 저장

```
영상 열기 → songs.findByVideo → 있으면 위치·구간·속도 적용 (지금 openSong 우선순위 유지: 주소 > 서버 > 기기)
변경 4초 뒤 / 재생 중 30초마다 / 탭 숨김·페이지 닫기
  → saveProgress
      ├─ rpc save_song_progress(song, pos, a, b, rate, date)
      └─ addSeconds>0 또는 addLoops>0 이면 rpc add_practice(...)
           └─ kept=true 이면 플레이어가 unsavedSec를 유지 (다음 저장에 다시 보냄)
```

페이지를 닫을 때(`pagehide`)는 `fetch`의 `keepalive`가 필요합니다. supabase-js의 `rpc`는 `keepalive`를 못 넘기므로, 닫을 때만 PostgREST를 직접 부릅니다: `fetch(`${supabaseUrl}/rest/v1/rpc/add_practice`, { method: 'POST', keepalive: true, headers: { apikey, Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' }, body })`.

### 4.2 녹음

녹음 흐름(마이크, MediaRecorder, 형식 선택, 미리 듣기, 다시 올리기, 파일 저장)은 지금 `practice.js`의 "녹음" 부분을 그대로 씁니다. 업로드만 바뀝니다.

```
멈춤 → takes.upload
  1. sessionId = rpc ensure_session(song, date)
  2. takeId = crypto.randomUUID(), key = `${uid}/${takeId}.${ext}`
     insert takes { id: takeId, session_id, song_id, recorded_at, a, b, rate, duration_sec, mime, size_bytes, storage: 'supabase', storage_key: key }
     → take_quota_exceeded 오류면 "녹음 저장 한도를 넘었어요" (파일 저장 버튼은 계속 보임)
  3. storage.from('takes').upload(key, blob, { contentType: mime })
     → 실패하면 2의 행 삭제 후 오류 표시
```

`profiles.storage_provider = 'drive'`이면 3 대신 [5.2](#52-구글-드라이브-p6) 업로드를 하고, 2의 `storage`·`storage_key`를 드라이브 값으로 넣습니다. 드라이브 업로드가 끝난 뒤에 행을 넣습니다(드라이브에는 한도 확인이 없음).

## 5. 녹음 저장소

### 5.1 Supabase Storage (P1)

- 비공개 버킷 `takes`, 경로 `{user_id}/{take_id}.{ext}`, 파일 하나 최대 50MB.
- 사용자별 한도 `profiles.take_quota_bytes`(기본 200MB). SETTING에 사용량 막대.
- 재생은 60분짜리 서명 URL.

### 5.2 구글 드라이브 (P6)

Supabase가 주는 구글 토큰(`provider_token`)은 로그인 직후에만 있고 1시간 뒤 만료되며 갱신에 비밀 값이 필요합니다. 그래서 **드라이브 토큰은 로그인과 별개로 Google Identity Services(GIS) 토큰 클라이언트로 받습니다.** 비밀 값이 필요 없습니다.

- 같은 구글 OAuth 클라이언트 ID 사용. 승인된 JavaScript 원본: `https://hunseokc.github.io`, `http://localhost:3000`.
- `google.accounts.oauth2.initTokenClient({ client_id, scope: 'https://www.googleapis.com/auth/drive.file', callback })`. 토큰은 메모리에만 두고, 만료(약 1시간) 전후에 다시 요청합니다.
- 토큰 요청은 팝업이 뜰 수 있어 **사용자 조작 안에서** 불러야 합니다. 녹음 시작 버튼을 누를 때 토큰이 없거나 10분 안에 만료되면 그때 `requestAccessToken({ prompt: '' })`을 부릅니다(이미 동의한 사용자는 보통 팝업 없이 받음). 재생 버튼도 같습니다.
- 켜기(FR-DRIVE-1): 동의 → `ULeveLP 녹음` 폴더 생성(`POST https://www.googleapis.com/drive/v3/files`, `mimeType: application/vnd.google-apps.folder`) → `profiles.drive_folder_id`, `storage_provider = 'drive'`.
- 업로드: 5MB 이하는 `uploadType=multipart`, 넘으면 `uploadType=resumable`. 파일 이름은 [04 3.4](04-data-model.md#34-takes-노션-연습-기록-본문의-오디오-블록--녹음-속성) 규칙. 결과의 `id`가 `storage_key`.
- 재생: `GET https://www.googleapis.com/drive/v3/files/{id}?alt=media` (Authorization 헤더) → Blob → `URL.createObjectURL`.
- 옮기기(FR-DRIVE-4): Storage 녹음마다 서명 URL로 받아 드라이브에 올리고 행의 `storage`·`storage_key`를 바꾼 뒤 Storage 파일 삭제. 한 건씩, 중간에 멈춰도 이어서 할 수 있게.
- **소유자 예외:** 노션 연동이 켜져 있으면 녹음을 노션에 올려야 하는데 Edge Function은 사용자 드라이브를 읽을 수 없습니다. 그래서 `notion_sync_enabled`인 사용자에게는 드라이브 켜기를 숨기고 Storage를 씁니다(소유자는 `take_quota_bytes`를 SQL로 늘림).

## 6. 노션

### 6.1 공식 템플릿 (FR-NX-1)

- 소유자의 지금 `악기 연습` 페이지에서 데이터 없이 구조만 복제해 `ULeveLP 템플릿` 페이지를 만듭니다. 내용: 연습 곡·연습 기록·학습 영상 노트 DB([04 6장](04-data-model.md#6-노션-템플릿-대응표)), 사용법 안내(내보내기 파일 넣는 법), 첫 화면 임베드(`https://hunseokc.github.io/ULevelP/`).
- 연습 곡 DB에 수식 속성 `연습하기`를 둡니다(지금 `apps-script/README.md`의 수식과 같음). 노션에서 곡을 눌러 바로 플레이어를 엶.
- 페이지를 웹에 게시하고 **템플릿으로 복제 허용**을 켭니다. 그 공개 주소를 `config.js`의 `notionTemplateUrl`에 두고 SETTING에서 링크합니다.
- 템플릿 구조를 바꾸면 이 문서의 04 6장, 내보내기·가져오기 코드, 소유자 연동 코드를 같이 바꿉니다.

### 6.2 내보내기: 서비스 → 노션 (FR-NX-2)

브라우저에서 만듭니다(서버 불필요). 형식은 [04 7장](04-data-model.md#7-내보내기-zip-형식-fr-nx-2).

1. `ULData`로 곡·연습 기록·녹음 목록·(소유자면) 노트를 전부 읽음
2. CSV 생성, 녹음 파일을 서명 URL(드라이브는 토큰)로 받아 `녹음/`에 담음. 진행률 표시, 녹음 빼고 받기 옵션
3. JSZip으로 묶어 다운로드

사용자가 노션에 넣는 순서 (`읽어주세요.txt`와 SETTING에 같은 내용):
1. 템플릿 페이지를 내 워크스페이스로 복제
2. `연습 곡` DB `···` → **CSV로 병합** → `연습 곡.csv`
3. `연습 기록` DB에서 같은 방법으로 `연습 기록.csv` (곡을 먼저 넣어야 관계가 이어짐)
4. 녹음은 CSV로 올라가지 않으므로 `녹음/` 폴더 파일을 필요한 기록에 끌어다 놓음

`곡` 관계 열이 CSV 병합으로 연결되는지는 S2에서 확인합니다. 연결되지 않으면 `연습 기록.csv`에 `곡 이름` 텍스트 열을 추가로 두고, 템플릿 사용법에 "관계는 비어 있으니 `곡 이름`으로 보세요"라고 적습니다.

### 6.3 가져오기: 노션 → 서비스 (FR-NX-3, 4)

브라우저에서 처리합니다. 해석 규칙은 [04 8장](04-data-model.md#8-노션-내보내기-파일-해석-fr-nx-3).

1. SETTING → 노션에서 가져오기 → zip 선택
2. JSZip으로 열어 CSV 해석 → **미리보기**: 곡 n(새로 m), 연습 기록 n, 녹음 n, 오류 행 목록
3. 확정 → 곡 upsert(`on conflict (user_id, video_id)`) → 연습 기록 upsert(`on conflict (user_id, song_id, date)`, 값 덮어쓰기) → 녹음은 [4.2](#42-녹음) 순서로 한 건씩
4. 결과 요약. 녹음 업로드가 중간에 실패하면 실패 목록과 다시 시도 버튼

### 6.4 소유자 실시간 연동

**원칙:** 서비스가 원본입니다. 서비스에서 바뀐 것은 노션으로 보내고(push), 노션에서는 정해진 항목만 가져옵니다(pull).

**키와 설정 (FR-OWN-KEY):** Edge Function `owner-settings`
- `GET`: `integrations`에서 힌트(끝 4자리), DB ID, 연동 켜짐 여부, 마지막 성공 시각·오류, 대기 건수를 돌려줌. 키 원문은 절대 내려주지 않음
- `POST { notionToken?, geminiKey?, geminiModel?, notionSongsDb?, notionSessionsDb?, notionNotesDb?, syncEnabled? }`: 키는 `vault.create_secret`(이미 있으면 `vault.update_secret`)로 저장하고 ID와 힌트만 `integrations`에
- `POST /check`: 노션 DB 3개의 속성 이름 점검(지금 `Code.gs` `health()`와 같은 방식, 빠진 속성 이름 목록), Gemini는 `models.list`로 키 확인
- 모든 Edge Function 첫 줄: JWT로 사용자 확인 → `is_owner(uid)`가 아니면 403

**보내기 (push, FR-OWN-SYNC-1):** Edge Function `notion-push`
- 실행: pg_cron이 1분마다 `pg_net`으로 호출 + 클라이언트가 저장 직후 한 번 호출(빠른 반영, 실패해도 무시)
- `sync_outbox`에서 처리 안 된 것을 사용자별 `id` 순으로 최대 50건. 같은 사용자에 대한 동시 실행은 `pg_try_advisory_lock(hashtext(user_id))`로 막음
- 대상별 처리 (노션 쪽 결과는 지금 `Code.gs`가 만드는 것과 같게):
  - `song`: 링크 없으면 페이지 생성(아이콘 🎵) 후 `notion_links`, 있으면 속성 PATCH. 속성은 [04 6.1](04-data-model.md#61-연습-곡--songs)
  - `session`: 같은 방식. `곡` 관계는 곡의 `notion_links`로. 곡이 아직 안 보내졌으면 곡을 먼저 보냄
  - `take`: Storage에서 파일을 받아 노션 파일 업로드(20MB 넘으면 나눠 올리기) → 연습 기록 페이지 본문에 설명 문단 + 오디오 블록 추가 → `녹음` 속성에 추가. 블록 ID 2개를 `notion_links`에
  - `note`: 페이지 생성 + 본문 블록([7.3](#73-노트-보기와-노션-페이지))
  - `delete`: 페이지·블록을 보관함으로(`archived: true`) 후 링크 삭제
- 성공하면 `done_at`, 실패하면 `attempts + 1`, `last_error`. 5번 실패한 건은 건너뛰고 SETTING에 표시. 429는 다음 실행에 다시
- 노션 API 버전은 `2022-06-28`(지금 `Code.gs`와 같음)

**가져오기 (pull, FR-OWN-SYNC-2):** Edge Function `notion-pull`
- 실행: 소유자가 앱을 열 때(마지막 pull 후 5분 지났으면), SETTING 버튼
- 연습 곡 DB를 `last_edited_time > last_pull_at` 필터로 조회:
  - 링크 있는 페이지: 노션 수정 시각이 서비스 `updated_at`보다 늦으면 곡명·아티스트·상태·메모·마지막 위치·구간·속도를 반영
  - 링크 없는 페이지: 영상 ID를 찾을 수 있으면 곡 생성 + 링크 (크롬 확장 프로그램이나 노션에서 직접 넣은 곡)
- 연습 기록 DB: 링크 있는 페이지의 `메모`만 반영
- 모든 쓰기는 Postgres 함수 `apply_notion_pull(payload jsonb)` 하나로 한 트랜잭션 안에서 하고, 시작할 때 `set_config('app.sync_source', 'notion', true)`로 대기열에 다시 들어가지 않게 함
- 끝나면 `last_pull_at = 조회 시작 시각`

**처음 연동 (FR-OWN-SYNC-4):** `notion-pull`의 `full` 모드
- 연습 곡·연습 기록·학습 영상 노트 DB 전체를 읽어 서비스에 넣고 링크를 만듦 (연습 기록의 시간·반복도 포함)
- 연습 기록의 `녹음` 속성 파일은 노션 파일 URL(1시간 유효)로 받아 Storage에 올리고 `takes` + 링크(오디오 블록 ID는 페이지 본문에서 같은 파일의 audio 블록을 찾아서)
- 끝난 뒤 `notion_sync_enabled = true`. 그 전까지는 push가 돌지 않음(대기열 트리거가 연동 꺼짐을 보고 건너뜀)

**전환:** 처음 연동이 끝나고 소유자 기기들에서 새 버전이 확인되면 `apps-script/` 중계 서버와 SETTING의 "노션 연결" 칸을 지웁니다.

## 7. 학습 노트 (Gemini, 소유자 전용)

### 7.1 실행

Edge Function `analyze-video`:
1. `POST { url, tags, memo }` → 소유자 확인 → 영상 ID 확인 → `analysis_jobs` 행(`queued`) → 바로 `{ jobId }` 응답
2. 같은 요청 안에서 `EdgeRuntime.waitUntil(run(jobId))`로 백그라운드 실행:
   - `running` → oEmbed로 제목·채널 → Vault에서 Gemini 키
   - Gemini REST `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` (헤더 `x-goog-api-key`). `contents.parts`: `{ fileData: { fileUri: 유튜브 URL }, videoMetadata: { fps } }` + 프롬프트 텍스트. `generationConfig`: `responseMimeType: 'application/json'`, `responseSchema`
   - 프롬프트와 응답 스키마는 `scripts/schemas.py`의 `PROMPT`, `build(tags)`를 TypeScript로 그대로 옮김. 재시도 규칙은 `analyze.py`의 `GEMINI_ATTEMPTS = 4`와 같게
   - `notes` 행 생성 → `done`, `note_id`. 실패하면 `failed`, `error`
3. 화면은 `analysis_jobs`를 5초마다 다시 읽어 상태를 보여줌(진행 중인 작업이 있을 때만)

**S1 결과에 따른 대체안:** 분석이 Edge Function 실행 시간 한도를 넘으면, 소유자 전용으로 GitHub Actions 실행기를 유지합니다. `analyze-video`는 job만 만들고 GitHub `workflow_dispatch`를 호출(토큰은 Vault), 워크플로는 `analyze.py`를 실행해 결과를 `notes`에 쓰고 job을 갱신(Supabase service role 키는 저장소 시크릿). 워크플로 입력값은 실행 기록에 남으므로 Gemini 키를 입력값으로 넘기지 않습니다. 이 대체안에서는 Gemini 키를 지금처럼 저장소 시크릿에 두고, SETTING 소유자 칸의 Gemini 키 입력은 숨깁니다(FR-OWN-KEY-1 예외).

### 7.2 키워드·태그

- 요청 태그: 화성, 사운드 디자인, DAW/MIDI, 리듬, 편곡, 믹싱 (지금 `TAGS`)
- 노션의 `TAB` 태그는 사람이 붙이는 것. `notes.tags`에 있으면 보존

### 7.3 노트 보기와 노션 페이지

- `note.html?id=`: `analysis`를 `analyze.py`의 `render_harmony`, `render_sound`, `render_daw`, `render_rhythm`, `render_arrangement`, `render_mixing`, `summary_block`, `build_blocks`와 같은 구성으로 HTML에 그립니다. 주요 구간의 시간은 `practice.html?v={id}&t={초}` 링크.
- 보이싱 그림은 `scripts/guitar.py`, `keyboard.py`의 SVG 생성을 JS로 옮겨 화면과 노션(업로드 이미지)에 같이 씀.
- 노션 페이지 본문은 `notion-push`의 `note` 처리에서 `build_blocks`와 같은 블록을 만듦.

## 8. 화면

디자인은 [DESIGN.md](../DESIGN.md)와 `styles.css` 토큰을 따릅니다(웜 뉴트럴 바탕, 강조는 명도, 파랑은 링크·근음, 버튼은 필, 카드는 직각, 강한 버튼은 화면당 하나).

### 8.1 상단 메뉴

`⌂ HOME` | `LOG` · `NOTES`(소유자만) · `SETTING` · 계정(`LOGIN` 또는 이니셜)

### 8.2 첫 화면 (`index.html`)

지금 구성 유지. PLAYER 프레임의 곡 목록만 `ULData.songs.list()`로 바꾸고, 비로그인이면 "로그인하면 연습 곡이 여기 보여요". "노트 만들기" 버튼은 소유자만.

### 8.3 기록 (`log.html`)

- 탭: `기록` | `곡`
- 기록 탭: 이번 주·이번 달 총 시간 → 12주 달력(정사각형 칸, 연습 시간 구간별 잉크 농도 4단계, 빈 날은 선만) → 고른 날짜의 기록 목록(곡, 시간, 반복, 구간, 속도, 녹음 재생 버튼, 메모 편집)
- 곡 탭: 상태 필터(필 버튼: 전체·연습 중·보류·완료) → 곡 행(제목, 아티스트, 상태, 마지막 연습일, 총 연습 시간) → 누르면 곡 상세
- 곡 상세(`log.html?song=`): 머리말(제목, 상태 선택, 메모, `▶ 이어서 연습`, 삭제) → 연습 기록 타임라인(날짜별 시간 막대) → 녹음 목록(체크해서 두 개 고르면 비교 듣기 패널: A·B 재생 버튼, 하나 재생하면 다른 하나 멈춤)

### 8.4 플레이어 (`practice.html`)

화면은 그대로. 곡 목록 서랍의 데이터 출처와 저장 메시지("저장됨 HH:MM")만 바뀜. 서랍 맨 아래 링크는 `기록 보기 →`(log.html)로.

### 8.5 SETTING (`settings.html`)

순서:
1. 계정: 이메일, 로그아웃, 계정 삭제
2. 녹음 저장소: Storage 사용량 막대, (P6) 구글 드라이브에 저장 켜기·끄기, 기존 녹음 옮기기
3. 노션: 템플릿 열기, 내보내기, 노션에서 가져오기, 넣는 방법 안내
4. 소유자(소유자만): 노션 토큰, Gemini 키, Gemini 모델, DB ID 3개, 연결 확인, 연동 켜기(처음이면 "처음 연동" 실행), 상태(대기·마지막 성공·오류), 지금 가져오기
5. 노션 바로가기 (지금 그대로)
6. 화면 모드 (지금 그대로)

지금의 "노션 연결 · 플레이어와 녹음"(Apps Script) 칸은 P4 전환까지만, "학습 노트 · Gemini 분석"(GitHub 토큰) 칸은 P5 전환까지만 둡니다.

## 9. 외부 설정 (사람이 직접 해야 하는 것)

| 어디 | 무엇 | 단계 |
| --- | --- | --- |
| Supabase | 프로젝트 생성(리전: 서울 `ap-northeast-2`), URL·anon 키를 `config.js`에 | P0 |
| Google Cloud | OAuth 동의 화면(외부, 테스트 사용자 등록), OAuth 클라이언트(웹). 승인된 리디렉션 URI: `https://<ref>.supabase.co/auth/v1/callback`. 승인된 JavaScript 원본: `https://hunseokc.github.io`, `http://localhost:3000` | P0 |
| Supabase Auth | Google 공급자 켜기(클라이언트 ID·시크릿), Site URL·Redirect URLs ([3장](#3-인증)) | P0 |
| Supabase SQL | 마이그레이션 적용, 소유자 지정 `update profiles set role = 'owner', take_quota_bytes = 2147483648 where id = '<소유자 uid>';` | P0, P4 |
| Supabase | `pg_cron`, `pg_net`, Vault 확장 켜기, `notion-push` 1분 일정 등록 | P4 |
| Google Cloud | Drive API 사용 설정, 동의 화면에 `drive.file` 범위 추가 | P6 |
| Google Cloud | 일반 공개 전 동의 화면 검증 신청 | 공개 전 |
| 노션 | 템플릿 페이지 만들고 웹 게시·복제 허용 | P3 |

## 10. 먼저 확인할 것 (스파이크)

구현 전에 짧게 확인하고 결과를 이 문서에 반영합니다.

| ID | 확인할 것 | 방법 | 결과에 따라 |
| --- | --- | --- | --- |
| S1 | Gemini 영상 분석 시간이 Edge Function 실행 시간 한도 안에 드는지 | 5분·15분·40분 영상을 `analyze.py`로 분석해 시간 측정, 구현 시점의 Supabase Edge Function 한도와 비교 | 넘으면 7.1 대체안 |
| S2 | 노션 "CSV로 병합"이 관계 열(곡명)을 실제 관계로 연결하는지, BOM·날짜 형식이 맞게 들어가는지 | 템플릿 복제본에 샘플 CSV 병합 | 안 되면 6.2 대체안 |
| S3 | 노션 "Markdown & CSV" 내보내기 zip 구조 (파일 이름, `_all.csv`, 관계 값 모양, 파일 속성 첨부가 들어 있는지와 위치) | 템플릿 복제본에 샘플 데이터를 넣고 내보내기 | 04 8장 해석 규칙 수정 |
| S4 | 아이패드 홈 화면 앱(standalone)에서 구글 로그인 후 세션이 앱으로 돌아오는지 | 실제 기기 | 안 되면 홈 화면 앱에서는 "Safari에서 로그인" 안내 또는 `display: browser` 사용 |
| S5 | 노션 파일 속성 PATCH 때 기존 노션 호스팅 파일(`type: file`, URL)을 다시 보내면 유지되는지 | 노션 API로 직접 | 안 되면 `녹음` 속성은 그날 녹음 전체를 file_upload ID로 다시 붙임(업로드 ID 재사용 가능) |
| S6 | GIS 토큰 클라이언트가 이미 동의한 사용자에게 팝업 없이 토큰을 주는지 (iPad Safari 포함) | 실제 기기 | 팝업이 매번 뜨면 녹음 시작 때 토큰 받는 흐름 유지 |

## 11. 없앨 것과 시점

| 대상 | 언제 |
| --- | --- |
| `apps-script/` 전체, `site.js`의 `notion` 객체, SETTING "노션 연결" 칸, `practice.js`의 `api` 객체 | P4 처음 연동 완료 후 |
| `.github/workflows/analyze.yml`, `scripts/*.py`, `requirements.txt`, `notes.html`의 GitHub 호출, `site.js`의 `gh` 객체, SETTING "학습 노트" 칸 | P5 완료 후 (S1 대체안이면 유지) |
| `practice.html#api=…&k=…` 한 번에 설정하는 주소 | P4 |

## 12. 테스트

- **DB:** `supabase/tests/*.sql` (pgTAP, `supabase test db`). RLS(04 5장의 테스트 목록), `add_practice`(동시 호출 합계, 1분 규칙), `ensure_session`, 녹음 한도, `enqueue_sync`(연동 꺼짐·`app.sync_source`)
- **Edge Functions:** Deno 테스트. 노션·Gemini `fetch`를 가짜로 바꿔 push 대상별 요청 본문이 지금 `Code.gs`가 만드는 것과 같은지 확인
- **화면:** 내보내기 CSV와 가져오기 해석은 순수 함수로 분리해 `node --test`로 (기존 `test/`에 추가). 왕복 테스트: 내보내기 → 해석 → 같은 데이터
- **CI:** 기존 `ci.yml`에 `supabase test db` 작업 추가(Supabase CLI가 Docker로 로컬 DB를 띄움)
- **수동:** 아이패드 Safari에서 녹음(유튜브 소리 줄어드는지 포함), 로그인(S4), 드라이브 재생(S6)
