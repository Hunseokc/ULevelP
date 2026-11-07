# CH-1b 결과 — 설계 (V3 스키마 · API · 진행 전용 프롬프트 · 코드 파서 규칙)

- 날짜: 2026-11-04 (win)
- 입력: `결과/CH-0_범위확정.md`, `결과/CH-1a_프레임.md`, 기존 코드(`V1__init.sql`·`V2__categories.sql`, `GeminiSchemas.kt`, `NoteService.kt`·`NoteRoutes.kt`, `CategoryRoutes.kt`, `NotionPushWorker.kt`, `IntegrationService.kt`, `public/lib/voicing.js`·`theory.js`, `frontend/src/lib/progressions.ts`·`musicEngine.ts`, `package.json`·`tsconfig.json`·`vite.config.ts`·`Dockerfile`·CI)
- 상태: **확정(2026-11-04, 사용자 승인)** — §10 Q1~Q6 모두 추천안. §9 파일 목록은 진행 파일 표에 반영함. 이후 스키마·API·파일 경로를 바꾸려면 먼저 묻는다
- 다음 step(CH-E, CH-2, CH-3 …)은 이 파일과 진행 파일만 읽고 시작한다

## 1. CH-0 §5 미결 항목 → 답 (요약)

| # | 항목 | 답 (추천) | 자세히 |
| --- | --- | --- | --- |
| 1 | 진행 테이블 모양 | **한 행 = 진행 하나**, 코드는 `chords JSONB` 배열(코드 행 분리 안 함) | §2 |
| 1 | 노트 연결 | `progressions.note_id`(FK, 노트 삭제 시 `SET NULL` — 진행은 남음) + `note_prog_index`(노트 안 진행 순번) | §2-2 |
| 1 | "수집에 넣기" 플래그 위치 | **`notes.collect_progressions BOOLEAN`** 칼럼(진행 행 존재 여부로 추정하지 않음 — 화성 진행이 0개인 노트도 켠 상태를 기억해야 함) | §2-2 |
| 1 | 곡·아티스트 정규화 키(2차 대비) | 1차는 `title`·`artist`를 **따로 저장만** 한다. 2차에 생성 칼럼(`GENERATED ALWAYS AS (lower(btrim(…)))`)을 마이그레이션으로 추가하면 기존 행도 자동 계산되므로 지금 칼럼을 만들 필요 없음 | §2-3 |
| 1 | Mood·Genre·Tag | `TEXT[]` 세 칼럼(자유 입력, 개수·길이 제한). 별도 테이블 안 만듦 | §2 |
| 2 | 진행 CRUD | `GET/POST /api/v1/progressions`, `PATCH/DELETE /api/v1/progressions/{id}` | §3 |
| 2 | 코드 진행 영상 분석 | **새 경로 `POST /api/v1/progressions/analyze`**(기존 `analysis_jobs` 재사용, `kind='progression'` 칼럼 추가). 상태 조회는 기존 `/notes/jobs/{id}` | §3-5 |
| 2 | 노트 수집 토글 | `PUT /api/v1/notes/{noteId}/collect` `{ "collect": true }` | §3-6 |
| 2 | 통계(취향 코드 진행) | **프론트 계산**(API 없음). 개인용 규모(수백 행)라 목록 한 번 받아 브라우저에서 집계 | §8 |
| 3 | 진행 전용 프롬프트 | 노트 공통 스키마 + 화성 스키마 **확장판**(곡·아티스트·구간·키 형식·로마숫자 형식). "코드 심볼은 화면 표기 그대로" 규칙 추가 | §4 |
| 4 | 파서·로마숫자·키 추정 위치 | **프론트 TS 한 곳**(`frontend/src/lib/chords/*.mts`). 서버는 계산하지 않고 받은 값을 검증·저장. AI 행만 서버가 AI 값을 **가볍게 정규화**(키 형식, `maj7→M7` 등) | §5 |
| 5 | 화면 | `결과/CH-1a_프레임.md` §2 그대로. 페이지 경로 `/progressions.html` | §8 |
| 6 | 연습실 연동 | CH-1a §5 확정 그대로. 퀄리티 추가 방식은 "도수 목록으로 보이싱 생성" 함수 신설(§6) | §6 |
| 7 | 내보내기/가져오기 | **1차 제외**(분류와 같음). 계정 삭제 땐 CASCADE로 같이 지움. 2차 후보 | §2 |
| 7 | AI 행 수정 시 출처 | **코드(`chords`)나 키(`key`)를 고치면 `origin`=`manual`(직접), `evidence`=NULL**. 메모·Mood·Tag만 고치면 AI 유지 | §3-3 |
| — | CH-E 모듈 형식(진행 파일 §3 메모) | 엔진은 **`.mjs`**(내용 불변 + `export default`), 새 파서는 **`.mts`**(타입 있는 ES 모듈). `node --test`는 `await import()`로 읽는다 — Node 26 실측 통과, CI(Node 22·24)는 CH-E 첫 CI에서 확인 | §6-1 |

## 2. DB — `V3__progressions.sql` (초안)

```sql
-- progressions: 코드 진행 모음 (CHORDS). 한 행 = 진행 하나
CREATE TABLE progressions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('reference', 'analysis')),       -- 구분: 레퍼런스 / 코드 분석
  origin           TEXT NOT NULL CHECK (origin IN ('ai', 'manual')),              -- 출처: AI / 직접
  route            TEXT NOT NULL CHECK (route IN ('video', 'note', 'manual')),    -- 수집 경로: 코드 진행 영상 / 학습 영상 노트 / 직접 입력
  evidence         TEXT CHECK (evidence IN ('화면', '말함', '추정')),              -- AI 근거(대표값). 직접 행은 NULL
  title            TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300), -- 곡 제목 / 영상 제목
  part             TEXT NOT NULL DEFAULT '' CHECK (char_length(part) <= 100),     -- 진행 이름·구간 (인트로, 후렴, 2-5-1 변형)
  artist           TEXT NOT NULL DEFAULT '' CHECK (char_length(artist) <= 200),
  album            TEXT NOT NULL DEFAULT '' CHECK (char_length(album) <= 200),
  channel          TEXT NOT NULL DEFAULT '' CHECK (char_length(channel) <= 200),
  release_date     DATE,
  key              TEXT CHECK (key ~ '^[A-G](#|b)? (Major|min)$'),                 -- 키 24개 표기(KEYS): "F Major" / "A min". 모르면 NULL
  instrument       TEXT CHECK (instrument IN ('건반', '기타')),                     -- AI 행: 영상 악기. 직접 행은 NULL
  chords           JSONB NOT NULL CHECK (jsonb_typeof(chords) = 'array' AND jsonb_array_length(chords) BETWEEN 1 AND 64),
  moods            TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(moods) <= 10),
  genres           TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(genres) <= 10),
  tags             TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 10),
  url              TEXT NOT NULL DEFAULT '' CHECK (char_length(url) <= 500),      -- 레퍼런스: 코드 사이트 / 분석: 영상
  video_id         TEXT CHECK (video_id ~ '^[A-Za-z0-9_-]{11}$'),                  -- 구간 반복 링크용(유튜브일 때만)
  start_sec        INTEGER CHECK (start_sec BETWEEN 0 AND 86400),
  end_sec          INTEGER CHECK (end_sec BETWEEN 0 AND 86400),
  memo             TEXT NOT NULL DEFAULT '' CHECK (char_length(memo) <= 2000),
  note_id          UUID REFERENCES notes(id) ON DELETE SET NULL,                  -- 노트에서 온 행(route video·note)
  note_prog_index  SMALLINT CHECK (note_prog_index >= 0),                         -- notes.analysis.harmony.progressions[i]
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_sec IS NULL OR end_sec IS NULL OR start_sec < end_sec),
  CHECK (kind = 'analysis' OR route = 'manual'),            -- 레퍼런스는 직접 입력만
  CHECK (origin = 'ai' OR evidence IS NULL),                -- 근거는 AI 행만
  UNIQUE (note_id, note_prog_index)                         -- 같은 노트 진행을 두 번 수집하지 않음 (NULL끼리는 겹쳐도 됨)
);
CREATE INDEX progressions_user_created_idx ON progressions (user_id, created_at DESC);
CREATE INDEX progressions_note_idx ON progressions (note_id) WHERE note_id IS NOT NULL;
CREATE TRIGGER progressions_updated BEFORE UPDATE ON progressions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- notes: "코드 진행 수집에 넣기" 토글
ALTER TABLE notes ADD COLUMN collect_progressions BOOLEAN NOT NULL DEFAULT false;

-- analysis_jobs: 작업 종류 (기존 행은 note)
ALTER TABLE analysis_jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'progression'));

```

### 2-1. `chords` 원소 모양 (기존 `HarmonyChordDto` 이름을 따름)

```json
{ "symbol": "FM9", "roman": "IM7", "source": "화면", "timestamp": "0:42" }
```

| 필드 | 규칙 |
| --- | --- |
| `symbol` | 필수, 1~24자, 앞뒤 공백 제거. **입력 표기 그대로 저장**(정규화하지 않음 — 화면 표기 우선). 파싱은 화면에서 |
| `roman` | 0~24자. 직접 행은 프론트가 계산해 보냄(사용자가 고칠 수 있음). AI 행은 AI 값 정규화(§5-3) |
| `source` | AI 행만 `화면`/`말함`/`추정`, 직접 행은 생략 |
| `timestamp` | AI 행만 `mm:ss`·`h:mm:ss`, 없으면 생략 |

- 서버 검증: 배열 1~64개, 각 원소가 객체, `symbol` 필수·길이, 나머지 길이·enum. **모르는 키는 버린다**(저장하지 않음)
- 행 수 제한: 사용자당 **3000행**(넘으면 400 `INVALID_INPUT` "코드 진행은 최대 3000개까지 저장할 수 있습니다.")
- Mood·Genre·Tag 원소: 1~30자, 앞뒤 공백 제거, 중복 제거, 쉼표 금지

### 2-2. 노트 ↔ 진행

- `route='video'`(CHORDS 페이지 코드 진행 영상): 분석 작업이 노트를 만들면서 `collect_progressions=true`로 저장하고, 같은 트랜잭션에서 화성 진행마다 진행 행을 만든다
- `route='note'`(학습 영상 노트 토글): 토글을 켜면 그 노트의 `analysis.harmony.progressions[]`마다 행 생성(이미 있는 `note_prog_index`는 건너뜀), 끄면 `note_id`가 그 노트인 행을 **모두 삭제**(사람이 고친 행 포함 → 화면에서 "고친 진행 N개도 같이 빠집니다" 확인)
- 노트를 지우면 진행 행은 **남는다**(`SET NULL`). 토글 대상이 아니게 되고, `title`·`channel`·`video_id`·`url`·구간이 행에 복사돼 있으므로 목록·구간 반복은 그대로 된다. "노트" 버튼만 숨김
- 화성 진행이 없는 노트(화성 태그 없음): 토글을 켜도 0행 → 화면에 "이 노트에는 화성 진행이 없습니다" 안내. 토글 값은 저장
- `note_id`는 서버가 자기 노트에서만 넣는다(클라이언트 입력 아님) → 단순 FK로 충분(복합 FK 불필요)

### 2-3. 2차(공개) 대비 메모 — 1차에서 하지 않음

- 공개 전환 때 `visibility`·`song_key`(생성 칼럼)·신고 테이블을 V-다음 마이그레이션으로 추가. 1차 칼럼을 바꾸지 않아도 되게 `title`·`artist`를 분리해 둔 것이 전부
- RLS: 이 프로젝트는 서버가 `user_id`로 거른다(다른 테이블과 같음). 2차 공개 때 조회 경로를 따로 만든다

## 3. API (메뉴얼 — 승인 필요)

공통: Supabase JWT 필수(없으면 401 `UNAUTHORIZED`), `Cache-Control: no-store`, 에러는 기존 표준 형식(`docs/03` §1.2). 경로 UUID 형식 오류는 기존 `parsePathUuid`(400).

### 3-1. `ProgressionDto` (응답 공통)

```json
{
  "id": "uuid",
  "kind": "reference",            // reference | analysis
  "origin": "manual",             // ai | manual
  "route": "manual",              // video | note | manual
  "evidence": null,               // 화면 | 말함 | 추정 | null
  "title": "Just the Two of Us",
  "part": "",
  "artist": "Grover Washington Jr.",
  "album": "",
  "channel": "",
  "releaseDate": null,            // "YYYY-MM-DD" | null
  "key": "F Major",               // | null
  "instrument": null,             // 건반 | 기타 | null
  "chords": [{ "symbol": "FM7", "roman": "IVM7" }],
  "moods": ["nostalgia"], "genres": ["RnB"], "tags": [],
  "url": "",
  "videoId": null,
  "startSec": null, "endSec": null,
  "memo": "",
  "noteId": null,
  "createdAt": "ISO", "updatedAt": "ISO"
}
```

### 3-2. 목록·추가

- **`GET /api/v1/progressions?scope=reference|analysis|all`** → 200 `{ "progressions": [ProgressionDto] }`
  - `scope` 생략 = `all`(화면 기본 탭은 레퍼런스지만 통계·합산을 위해 한 번에 받는 게 기본 사용법). 다른 값은 400
  - 정렬 `created_at DESC, id DESC`
- **`POST /api/v1/progressions`** → 201 `{ "progression": ProgressionDto }`
  - 본문: `kind`(필수), `title`(필수), `chords`(필수), 나머지 선택(`part`·`artist`·`album`·`channel`·`releaseDate`·`key`·`moods`·`genres`·`tags`·`url`·`startSec`·`endSec`·`memo`)
  - 서버가 정함: `origin='manual'`, `route='manual'`, `evidence=NULL`, `note_id=NULL`, `instrument=NULL`. `url`이 유튜브면 `video_id` 추출(기존 `ExportImportService.extractVideoId`)
  - `url`은 `http(s)://`만 허용(그 외 400). `key`는 정규식 불일치면 400

### 3-3. 수정·삭제

- **`PATCH /api/v1/progressions/{id}`** → 200 `{ "progression": ProgressionDto }`
  - 보낸 필드만 바꾼다(위 POST 선택 필드 + `kind`·`title`·`chords`). 빈 본문이면 400. 남의 행·없는 행 404
  - `chords` 또는 `key`가 **실제로 바뀌면** `origin='manual'`, `evidence=NULL`(§1 #7). `route`·`note_id`는 그대로(어디서 왔는지는 남김)
  - `kind`를 `reference`로 바꾸려면 `route='manual'`이어야 함(아니면 400 "영상에서 온 진행은 레퍼런스로 바꿀 수 없습니다.")
- **`DELETE /api/v1/progressions/{id}`** → 200 `{ "ok": true }`. 404 규칙 같음
  - 노트에서 온 행을 지워도 노트 토글은 켠 채로 둔다(다시 켜면 빠진 순번만 다시 생김 — 토글 끄고 켜기)

### 3-4. 노션 push — **2026-11-05 폐기** — 노션 연동 중단(`계획/앱_명세.md` §5)

### 3-5. 코드 진행 영상 분석

- **`POST /api/v1/progressions/analyze`** `{ "url": "...", "memo": "..." }` → 202 `{ "jobId": "uuid", "status": "queued" }`
  - 기존 `requestAnalyze`와 같은 검증·제한(유튜브 URL, Gemini 키 412 `NO_KEY`, 동시 1건·하루 20건 429 — **노트 분석과 합산**)
  - `analysis_jobs`에 `kind='progression'`, `tags=['화성']`으로 넣는다 → 결과 노트 태그는 `화성`
- 상태 조회는 기존 **`GET /api/v1/notes/jobs`·`/notes/jobs/{id}`** 그대로. `AnalysisJobDto`에 **`kind` 필드 추가**(`"note"` | `"progression"`, 응답 필드 추가 — 승인 항목)
- 완료 시(`executeJob`의 트랜잭션 2): 노트 생성(`collect_progressions=true`) + 진행 행 생성(`route='video'`, `origin='ai'`, `kind='analysis'`) + 작업 `done`
  - 화성 진행이 0개면 노트만 생기고 작업은 `done`. CHORDS 화면은 "진행을 찾지 못했습니다 · 노트 보기"를 보여 준다(작업 응답의 `noteId`로 판단, 진행 수는 목록에서)

### 3-6. 노트 수집 토글

- **`PUT /api/v1/notes/{noteId}/collect`** `{ "collect": true | false }` → 200 `{ "noteId": "uuid", "collect": true, "progressions": [ProgressionDto] }`(켜면 그 노트에서 온 행 전체, 끄면 `[]`)
  - `collect`가 boolean이 아니면 400, 남의 노트·없는 노트 404
- 노트 응답(`NoteSummaryDto`·`NoteDetailDto`)에 **`collectProgressions: boolean` 필드 추가**(승인 항목)

### 3-7. 노션 설정 — **2026-11-05 폐기** — 노션 연동 중단(`계획/앱_명세.md` §5)

## 4. 진행 전용 프롬프트·스키마 (CH-4)

`GeminiSchemas.buildProgressionPrompt(memo): Pair<JsonObject, String>` 신설. 기존 `buildPrompt`·`PROMPT_TEMPLATE`·화성 스키마는 **바꾸지 않는다**(일반 노트 회귀 방지).

### 4-1. 스키마 = 공통(`commonSchemas`) + `harmony` 확장판

진행 객체(`progressions[]`)에 필드를 더한다. 코드 객체는 기존과 같다(노트 다이어그램 렌더러 재사용).

| 필드 | 타입 | 설명(스키마 description) |
| --- | --- | --- |
| `name` | string | 진행 이름·구간 (인트로 진행, 후렴, 2-5-1 변형) → 행 `part` |
| `song` | string | 영상이 특정 곡을 다루면 곡 제목, 아니면 빈 문자열 → 행 `title`(비면 영상 제목) |
| `artist` | string | 곡 아티스트, 모르면 빈 문자열 |
| `key` | string | **`<음> Major` 또는 `<음> min` 형식**(예: `F Major`, `A min`). 모르면 빈 문자열 |
| `instrument` | enum 건반·기타 | 기존 |
| `start` / `end` | string | 이 진행이 나오는 구간 `mm:ss`, 모르면 빈 문자열 → 행 `start_sec`·`end_sec` |
| `chords[]` | 기존 코드 객체 | `symbol`·`roman`·`function`·`split`·`lh`·`rh`·`frets`·`voicing_note`·`nuance`·`source`·`timestamp` |

### 4-2. 프롬프트 (노트 템플릿 규칙 + 진행 전용 지시)

`PROMPT_TEMPLATE`의 규칙 목록을 그대로 쓰고 `태그별 지시` 자리에 아래를 넣는다(`분류 태그: 화성`).

```
- [코드 진행] 이 영상은 코드 진행을 배우거나 연주하는 영상입니다. 영상에 나오는 코드 진행을 진행 단위로 빠짐없이 모읍니다.
  · 코드 심볼은 화면(자막·악보·코드 다이어그램·피아노롤 라벨)에 적힌 표기를 글자 그대로 씁니다. maj7/M7/Δ, m7b5/ø 같은 표기를 바꾸지 않습니다.
  · 화면에 심볼이 없을 때만 표준 표기(예: Cmaj7, Am7, G7(b9)/B)로 적고 source는 "말함"(강사가 말함) 또는 "추정"(소리로 짐작)입니다.
  · 같은 진행이 반복되면 한 번만 적고, 코드가 바뀌는 진행(변형·전조)은 따로 적습니다.
  · key는 "F Major", "A min"처럼 적습니다(조를 말하거나 화면에 보이면 그대로, 아니면 진행으로 추정).
  · roman은 key 기준으로 대문자 메이저·소문자 마이너, 메이저7은 M7, 도미넌트7은 7, 변화음은 도수 앞 b/#(bVIIM7), 텐션은 뒤(Iadd9, V7(b9))로 적습니다. 세컨더리 도미넌트도 V/x 대신 근음 도수로 적습니다(VI7).
  · 특정 곡의 진행이면 song·artist를 적습니다.
  · start/end는 그 진행이 처음 나오는 구간입니다.
- [화성] (기존 화성 지시 문구 그대로 — 보이싱·lh/rh·frets 규칙)
```

### 4-3. AI 응답 → 진행 행 (서버 `ProgressionExtract`, CH-3에서 만들고 CH-4에서 씀)

- `title` = `song` 비면 영상 제목(노트 `title`), `artist` = `artist`, `channel` = 노트 `channel`, `part` = `name`
- `url` = `https://www.youtube.com/watch?v=<id>`, `video_id`, `start_sec`·`end_sec` = `start`·`end`를 초로(못 읽으면 NULL, `start>=end`면 둘 다 NULL). `start`가 비면 첫 코드 `timestamp`
- `key` = §5-3 키 정규화(실패하면 NULL), `instrument` = 그대로
- `chords` = 진행의 코드마다 `{symbol, roman(정규화), source, timestamp}`. `symbol`이 빈 코드는 버림, 0개가 되면 그 진행은 행을 안 만듦. 65개 이상이면 앞 64개
- `evidence`(대표 근거) = 코드 `source` 중 **가장 약한 것**: `추정`이 하나라도 있으면 `추정` → 아니면 `말함`이 있으면 `말함` → 아니면 `화면`(전부 비면 `추정`)
- 같은 함수를 노트 토글(`route='note'`)에도 쓴다(기존 노트의 진행 객체엔 `song`·`start` 등이 없으니 빈 값 처리)

## 5. 코드 파서 · 로마숫자 · 키 추정 · 붙여넣기 (CH-2, 프론트 TS)

### 5-1. 위치

```
frontend/src/lib/chords/
  symbol.mts      parseChord(text) / canonical 퀄리티·도수 목록
  roman.mts       toRoman(chord, key) / romanize(chords, key)
  keyGuess.mts    guessKeys(chords) → 후보 3개 (점수 순)
  pasteParse.mts  extractChordLines(text) / findRepeats(symbols)
  stats.mts       (CH-6) 빈도·이동·진행 Top·Mood/Genre/키 분포·랜덤
```

- 서로 import는 `./symbol.mts`처럼 확장자를 쓴다 → `tsconfig.json`에 `"allowImportingTsExtensions": true` 추가(`noEmit`이라 허용됨)
- 서버(Kotlin)에는 같은 파서를 만들지 않는다. 서버는 받은 `roman`·`key`를 검증만 하고, AI 값은 §5-3 정규화만 한다

### 5-2. 코드 심볼 지원 범위 (`parseChord`)

- 결과: `{ raw, root: 0..11, rootName: "Bb", quality: "m7", degrees: ["R","b3","5","b7"], bass?: 0..11, bassName?, ok: true }`, 못 읽으면 `{ raw, ok: false, reason }`
- 근음: `[A-G]` + `#`/`b`/`♯`/`♭` 0~1개. 철자는 **입력 그대로 보존**(`rootName`), 계산은 피치클래스
- 슬래시 베이스: 마지막 `/[A-G][#b]?` (분수 표기 `C/E`). `6/9`·`69`는 슬래시 아님
- 별칭 → 정규 퀄리티(엔진 `CH` 키와 같은 이름을 쓴다):

| 정규 | 받는 표기 예 | 도수 |
| --- | --- | --- |
| `maj` | `C`, `CM`, `Cmaj` | R 3 5 |
| `m` | `Cm`, `Cmin`, `C-` | R b3 5 |
| `dim` | `Cdim`, `Co`, `C°` | R b3 b5 |
| `aug` | `Caug`, `C+`, `C(#5)` | R 3 #5 |
| `sus2` / `sus4` | `Csus2`, `Csus`, `Csus4` | R 2 5 / R 4 5 |
| `add9` / `madd9` | `Cadd9`, `C(add9)`, `Cadd2`, `Cm(add9)` | R 3 5 9 / R b3 5 9 |
| `6` / `m6` / `69` / `m69` | `C6`, `Cm6`, `C6/9`, `C69`, `Cm6/9` | |
| `maj7` / `maj9` / `maj13` / `maj7s11` / `maj7#5` | `CM7`, `Cmaj7`, `CΔ`, `CΔ7`, `Cma7`, `CM9`, `Cmaj7#11`, `CM7(#11)`, `CM7#5` | |
| `m7` / `m9` / `m11` / `m13` / `mmaj7` | `Cm7`, `C-7`, `Cmin7`, `Cm(maj7)`, `CmM7`, `Cm∆7` | |
| `m7b5` / `dim7` | `Cm7b5`, `Cø`, `Cø7`, `C-7b5`, `Cdim7`, `Co7`, `C°7` | |
| `7` / `9` / `13` / `7sus4` / `9sus4` / `13sus4` / `7b5` / `7#5` | `C7`, `C9`, `C13`, `C7sus4`, `C7sus`, `C9sus4`, `C13sus`, `C7b5`, `C7#5`, `C7+5`, `Caug7` | |
| 도미넌트 + 변화 텐션 | `C7b9`, `C7(b9)`, `C7#9`, `C7#11`, `C7b13`, `C13b9`, `C7#5#9`, `C7(b9,b13)`, `C7alt` | 기본 `R 3 5 b7` + 텐션. `alt` = `b9 #9 #5`(5도 생략) |

- 텐션 괄호 `( … )` 안은 `,`·공백 구분 여러 개 허용. 정규 퀄리티 이름은 기본 퀄리티 + 텐션을 정해진 순서(`b9 9 #9 11 #11 b13 13`)로 붙여 만든다(`7b9b13`). 엔진은 이름이 아니라 **`degrees`로 보이싱**하므로(§6-2) 조합마다 표에 넣을 필요가 없다
- 못 읽는 예(잘못된 입력 테스트): `H7`, `Cxyz`, `C/`, 빈 문자열, `N.C.`(코드 없음 표시 — 붙여넣기에서는 건너뛰는 토큰)

### 5-3. 로마숫자 (`toRoman`)

- 도수 = (근음 − 키 으뜸음) mod 12 → `0 I, 1 bII, 2 II, 3 bIII, 4 III, 5 IV, 6 #IV|bV, 7 V, 8 bVI, 9 VI, 10 bVII, 11 VII`. 6은 마이너·dim 계열이면 `#IV`(`#ivm7b5`), 그 외 `bV`(`bV7`)
- 마이너 키도 **으뜸음 기준 같은 표**(A min에서 `Am7 → im7`, `FM7 → bVIM7`, `E7 → V7`) — 템플릿 `1st Chord` 옵션(`bVIM7`)과 맞음
- 대소문자: 3도가 b3인 퀄리티(`m`·`m7`·`m7b5`·`dim`·`dim7`·`mmaj7` …)는 소문자, 나머지 대문자
- 접미사: `maj`→없음, `m`→없음(소문자로 표시), `maj7`→`M7`, `maj9`→`M9`, `m7`→`m7`, `m7b5`→`m7b5`, `dim`→`dim`, `aug`→`aug`, `7`→`7`, 텐션은 괄호(`V7(b9)`), `add9`→`add9`, sus는 그대로. 예: `FM9 Dm9 Gm7 C7` @F Major → `IM9 - vim9 - iim7 - V7`
- 슬래시: `/` + 베이스 도수(대문자, 예 `I/III`, `V7/VII`)
- 진행 문자열 = 코드 roman을 ` - `로 이음, `1st Chord` = 첫 코드 roman
- **서버 정규화(AI 값용, Kotlin 작은 함수 2개)**: ① 키: `F major`/`F Major`/`F`/`Fmaj` → `F Major`, `Am`/`A minor`/`A min`/`a minor` → `A min`, 그 외 NULL ② roman: `maj7→M7`, `maj9→M9`, `Δ→M7`, `ø7`·`ø→m7b5`, `°7→dim7`, `°→dim`, 공백 제거. `V7/ii` 같은 세컨더리 표기는 그대로 둔다(화면 수정에서 "다시 계산" 버튼으로 프론트 계산값으로 바꿀 수 있음)

### 5-4. 키 추정 (`guessKeys`)

- 24개 키(12 × Major/min)마다 점수: 코드 구성음 중 그 키 스케일(메이저 / 자연단음계 + 화성단음계 7음) 안에 있는 비율 합 + 첫 코드가 I·i면 +2, 마지막 코드가 I·i면 +1.5, `V7→I`(마이너는 `V7→i`) 이동마다 +1
- 상위 3개를 `[{ key: "F Major", score }]`로 반환. 화면은 1등을 기본 선택, 드롭다운에 3개 + 전체 24개
- 철자: 키 으뜸음 철자는 키 24개 목록(`KEYS`)을 따른다(`Db Major`·`C# min`·`F# Major`·`G# min`·`Ab Major`·`Eb min` 등)
- 테스트 기준(CH-2): `C - Am - F - G` → C Major, `Am - Dm - E7 - Am` → A min, `FM7 - E7 - Am7 - Gm7 C7` → 1등 A min 또는 F Major(둘 다 후보 3개 안), 코드 1개(`C`) → 후보는 나오되 점수 차가 작음

### 5-5. 붙여넣기 파서

- `extractChordLines(text)`:
  1. 정리: `[ch]…[/ch]` 태그 벗김(ultimate-guitar), ChordPro `[Am]가사` 안의 대괄호 코드 추출, `[Verse]`·`[Chorus]`·`Verse 1:` 같은 섹션 머리는 **섹션 이름**으로 기억
  2. 줄마다 토큰화(공백·`|`·`-`·`,`). 무시 토큰: `|`, `/`, `%`, `x2`·`×4`(반복 표시 — 반복 수로 기억), `N.C.`, 마디 번호
  3. **남은 토큰이 모두 `parseChord` 성공인 줄만 코드 줄**(가사 줄의 `A`·`Am` 오인 방지). 한 줄짜리 진행 텍스트(`FM7 - E7 - Am7`)도 같은 규칙으로 통과
- `findRepeats(symbols)`: 길이 L = 2~8마다 같은 L개 묶음이 연속 2회 이상 반복되는 구간을 찾아 `{ chords, repeats, start, section? }` 후보로. 점수 = L × 반복 수, 같은 묶음의 회전(예: `Am F C G`·`F C G Am`)은 하나로 합쳐 먼저 나온 쪽. 상위 3개 + "전체 순서 그대로" 1개
- 섹션 머리가 있으면 섹션별로 `findRepeats`를 돌려 후보에 섹션 이름을 붙인다(`Chorus: 4코드 ×4`)

## 6. 엔진 이전(CH-E)과 퀄리티 추가(CH-2b)

### 6-1. CH-E 모듈 형식 (진행 파일 §3의 미결 → 결정)

- `public/lib/theory.js`·`voicing.js`를 `frontend/src/lib/engine/theory.mjs`·`voicing.mjs`로 복사. 바꾸는 줄은 마지막 `if (typeof module …) module.exports = X;` → `export default X;` 하나(IIFE 본문 불변)
- `musicEngine.ts`는 `import CT from './engine/theory.mjs'`·`import GE from './engine/voicing.mjs'`(기존 `@ts-ignore` 유지)로 바꾸고 내보내는 API는 그대로
- `vite.config.ts`의 `commonjsOptions`에서 `public/lib` 패턴 제거, `Dockerfile` 1단계의 `COPY public/lib ./public/lib` 제거(프론트 빌드가 더는 안 씀). `server.js`·옛 화면·`test/engine.test.js`·`test/r2_chords.test.js`는 `public/lib`를 계속 읽는다(동결 사본)
- 새 테스트 `test/che_engine_port.test.js`: `require('../public/lib/*.js')`(옛)와 `await import('../frontend/src/lib/engine/*.mjs')`(새)에 같은 입력(모든 루트 × 모든 `CH`·`Q4` 퀄리티의 `genVoicings`, `search251`, `scaleInfo`, `interpret` 등 export 전부)을 넣어 `deepStrictEqual`
- 확인 필요(CH-E 첫 CI): Node 22·24에서 CJS 테스트의 `await import('.mjs'/'.mts')` — 로컬 Node 26은 통과(2026-11-04, scratchpad 실측)

### 6-2. CH-2b 퀄리티 추가 방식

- `GE.CH` 표에 이름을 하나씩 늘리는 대신 **도수 목록으로 보이싱을 만드는 함수**를 새로 둔다: `genVoicingsByDegrees(root, degrees, opts)` — 기존 `genVoicings(root, q, opts)`는 `CH[q]`를 넘겨 이 함수를 부르는 형태로 바꾸되 **결과 불변**(CH-E 동일성 테스트 + `engine`·`r2_chords` 회귀)
- 도수가 기타로 잡기 어려울 만큼 많으면(6개 이상) 생략 순서 `5 → R → 9(다른 텐션이 있을 때)`로 줄이고 칩에 "5 생략"처럼 표시(= CH-1a §5-1의 "남는 예외")
- `DEG` 표에 없는 도수(`#5`, `2`, `bb7`)를 추가. 3화음은 도수 3개 그대로(드롭 보이싱 없이 `genVoicings` 탐색 범위 안에서 3음 폼)
- `trans`(이웃 보이싱 이동 비용)를 `voicing.mjs`에서 export하고, 진행 경로 DP는 `frontend/src/lib/engine/progressionPath.mjs`에 둔다(`bestPaths(chords, opts) → 상위 3개`)
- 서버 `VoicingEngine.kt`는 1차에 바꾸지 않는다(CH-1a §5-1 그대로)

## 7. 노션 `코드 진행` DB 매핑 — **2026-11-05 폐기** — 노션 연동 중단(`계획/앱_명세.md` §5)

- 진행은 노션 대상이 아니다. V3의 `notion_links`·`sync_outbox` CHECK 변경도 뺐다(운영 DB 적용 전)

## 8. 화면 쪽 데이터 결정 (CH-1a 보완)

- 페이지 경로 **`/progressions.html`**(`AppShell` CHORDS 메뉴 `href`). SPA 목록 두 곳(`Main.kt:110`, `server.js:15`)에 추가. `/chords.html`(연습실)은 그대로
- 목록은 `GET /progressions`(scope 생략) 한 번 → 범위 토글·취향 통계·랜덤은 브라우저에서 거른다
- 비로그인: 기존 시드 10개(`DEFAULT_REFERENCE_PROGRESSIONS`·`DEFAULT_ARCHIVE_PROGRESSIONS`)를 레퍼런스/분석 범위로 보여 줌. 진행 넣기·수정은 로그인 안내
- 홈 "취향 코드 진행 꺼내보기"(CH-6): 같은 목록 + 범위 토글. `extractProgressionsFromNotes`의 노트 화성 읽기·`ulp:progressions` 읽기·`편곡` 태그 규칙은 **없앤다**(진행은 서버 테이블이 원본)
- 연습실 링크: `chords.html#prog?c=<심볼 ,구분 URL 인코딩>&k=<key>&t=<제목>&from=<id>`(CH-1a §3-1 확정). 심볼은 저장된 표기 그대로 넘기고 연습실이 `parseChord`로 읽는다
- 저장 직후 안내·행 버튼 문구는 CH-1a §1·§2 그대로

## 9. step별 바꿀 파일 (승인되면 진행 파일 표에 반영)

| step | 파일 (새 = ★) |
| --- | --- |
| CH-E | ★`frontend/src/lib/engine/theory.mjs`, ★`frontend/src/lib/engine/voicing.mjs`, `frontend/src/lib/musicEngine.ts`, `vite.config.ts`, `Dockerfile`, ★`test/che_engine_port.test.js` |
| CH-2 | ★`frontend/src/lib/chords/symbol.mts`·`roman.mts`·`keyGuess.mts`·`pasteParse.mts`, `tsconfig.json`(`allowImportingTsExtensions`), ★`test/ch2_chord_parser.test.js` |
| CH-2b | `frontend/src/lib/engine/voicing.mjs`(`genVoicingsByDegrees`·`DEG` 추가·`trans` export), ★`frontend/src/lib/engine/progressionPath.mjs`, `frontend/src/lib/musicEngine.ts`(타입·래퍼), ★`test/ch2b_engine_quality.test.js` |
| CH-3 | ★`src/main/resources/db/migration/V3__progressions.sql`, `src/main/kotlin/ulevelp/db/Tables.kt`, ★`service/ProgressionService.kt`, ★`routes/ProgressionRoutes.kt`, ★`note/ProgressionExtract.kt`(AI→행, 키·roman 정규화, 근거), `routes/NoteRoutes.kt`(collect), `service/NoteService.kt`(DTO `collectProgressions`, 토글), `Main.kt`(라우트 등록), ★`src/test/kotlin/ulevelp/progression/ProgressionApiTest.kt`·`ProgressionExtractTest.kt`, `src/test/kotlin/ulevelp/db/DatabaseMigrationAndIntegrityTest.kt`(V3 제약), `docs/03-api-spec.md`, `docs/04-db-design.md` |
| CH-4 | `note/GeminiSchemas.kt`(`buildProgressionPrompt`), `service/NoteService.kt`(`kind` 분기, 완료 시 진행 행), `routes/ProgressionRoutes.kt`(`/analyze`), `src/test/kotlin/ulevelp/note/NoteSvgAndSchemaTest.kt`·`NoteApiTest.kt`, `src/test/kotlin/ulevelp/support/FakeGeminiClient.kt`(필요하면), `docs/03-api-spec.md` |
| CH-5 | ★`frontend/src/pages/ProgressionsPage.tsx`·`.module.css`, ★`frontend/src/components/progressions/*`(목록 행·진행 넣기 3탭·읽는 법 안내), `frontend/src/App.tsx`, `frontend/src/components/layout/AppShell.tsx`, `frontend/src/lib/apiClient.ts`, `frontend/src/pages/NoteDetailPage.tsx`(토글), `src/main/kotlin/ulevelp/Main.kt`·`server.js`(SPA 목록), ★`test/ch5_progressions.test.js`, ★`test/e2e/progressions.spec.js` |
| CH-5b | `frontend/src/pages/ChordsPage.tsx`(`#prog?` 파싱·8번째 탭), ★`frontend/src/components/chords/ProgressionPlayTab.tsx`, `frontend/src/lib/progressions.ts`(`CHORD_MODES`), `frontend/src/lib/musicEngine.ts`, ★`test/e2e/progression-play.spec.js`, `test/r2_chords.test.js`(탭 목록 기대값) |
| CH-6 | ★`frontend/src/lib/chords/stats.mts`, `frontend/src/pages/HomePage.tsx`, `frontend/src/lib/progressions.ts`, `test/r1_home.test.js`, ★`test/ch6_stats.test.js` |
| CH-7 | (노션 push 폐기 — 진행 파일 §2의 새 CH-7·7b·7c 행이 파일 목록) |

- 파일 경로·이름은 위 목록으로 확정(바꾸면 먼저 묻는다). `components/progressions/*` 안의 파일 나누기는 자유 항목
- 범위 밖 제안(1차 안 함): 내보내기 ZIP에 `코드 진행.csv`, 서버 `VoicingEngine.kt` 퀄리티 동기화

## 10. 사용자 승인 (메뉴얼) — 2026-11-04 전부 추천안으로 승인

| # | 질문 | 추천(= 승인) | 대안 |
| --- | --- | --- | --- |
| Q1 | §2 V3 스키마(새 `progressions`, `notes.collect_progressions`, `analysis_jobs.kind`. entity CHECK 변경은 2026-11-05 폐기) | 이대로 | — |
| Q2 | §3 API 경로·응답(새 `/progressions` 5개, `/notes/{id}/collect`, `AnalysisJobDto.kind`·노트 DTO `collectProgressions` 필드 추가. 노션 `progressionsDb`는 2026-11-05 폐기) | 이대로 | 분석 요청을 `/notes/analyze`에 `mode` 필드로 확장 |
| Q3 | 로마숫자 계산 위치 | **프론트 TS만**, AI 값은 서버가 가볍게 정규화 | Kotlin에도 같은 파서를 두고 서버가 항상 계산(공용 테스트 픽스처, CH-2 일이 약 2배) |
| Q4 | 노트를 지우면 그 노트에서 온 진행 | **남긴다**(`SET NULL`) | 같이 지운다(`CASCADE`) |
| Q5 | AI 행에서 코드·키를 고치면 | **출처 `직접`으로 바꿈**(근거 비움) | AI 유지 + "수정됨" 표시 칼럼 추가 |
| Q6 | 내보내기/가져오기 | **1차 제외** | 1차에 CSV 포함 |
