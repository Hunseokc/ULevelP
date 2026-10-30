CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- updated_at 자동 갱신 공통 트리거 함수
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

-- ============================================================
-- 1. users & profiles (사용자 계정 및 프로필)
-- ============================================================
CREATE TABLE users (
  id           UUID PRIMARY KEY,      -- Supabase Auth 사용자 id (JWT sub). 서버가 만들지 않는다
  email        TEXT NOT NULL,         -- 구글 계정 이메일은 바뀔 수 있어 UNIQUE를 걸지 않는다. 신원은 id
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE profiles (
  id                 UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name       TEXT NOT NULL DEFAULT '',
  role               TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'owner')),
  storage_provider   TEXT NOT NULL DEFAULT 'supabase' CHECK (storage_provider IN ('supabase', 'drive')),
  drive_folder_id    TEXT,
  take_quota_bytes   BIGINT NOT NULL DEFAULT 209715200 CHECK (take_quota_bytes >= 0), -- 기본 200MB
  migrated_local_at  TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER profiles_updated BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 2. songs (연습 곡 - 노션: 연습 곡 DB)
-- ============================================================
CREATE TABLE songs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  artist      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'practicing' CHECK (status IN ('practicing', 'paused', 'done')),
  video_id    TEXT NOT NULL CHECK (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  pos         NUMERIC(8,1),
  a           NUMERIC(8,1),
  b           NUMERIC(8,1),
  rate        NUMERIC(4,2) NOT NULL DEFAULT 1.00,
  last_date   DATE,
  memo        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, video_id),
  UNIQUE (user_id, id),            -- 하위 테이블 복합 FK 대상 (다른 사용자 곡 참조 차단)
  CHECK (a IS NULL OR b IS NULL OR a < b)
);
CREATE INDEX songs_user_status_idx ON songs (user_id, status, last_date DESC NULLS LAST, updated_at DESC);
CREATE TRIGGER songs_updated BEFORE UPDATE ON songs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 3. sessions (일별 연습 기록 - 노션: 연습 기록 DB)
-- ============================================================
CREATE TABLE sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  song_id     UUID NOT NULL,
  date        DATE NOT NULL,
  seconds     INTEGER NOT NULL DEFAULT 0 CHECK (seconds >= 0),
  loops       INTEGER NOT NULL DEFAULT 0 CHECK (loops >= 0),
  rate        NUMERIC(4,2),
  a           NUMERIC(8,1),
  b           NUMERIC(8,1),
  memo        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, song_id, date),
  UNIQUE (user_id, id, song_id),   -- takes 복합 FK 대상
  FOREIGN KEY (user_id, song_id) REFERENCES songs (user_id, id) ON DELETE CASCADE
);
CREATE INDEX sessions_user_date_idx ON sessions (user_id, date DESC);
CREATE INDEX sessions_song_date_idx ON sessions (song_id, date DESC);
CREATE TRIGGER sessions_updated BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 4. takes (오디오 녹음 - 노션: 연습 기록 본문 오디오 블록 + 녹음 속성)
-- ============================================================
CREATE TABLE takes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id    UUID NOT NULL,
  song_id       UUID NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL,
  a             NUMERIC(8,1),
  b             NUMERIC(8,1),
  rate          NUMERIC(4,2),
  duration_sec  INTEGER NOT NULL CHECK (duration_sec >= 0),
  mime          TEXT NOT NULL CHECK (mime IN ('audio/mp4', 'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/wav', 'audio/aac')),
  size_bytes    BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 52428800), -- 최대 50MB
  storage       TEXT NOT NULL CHECK (storage IN ('supabase', 'drive')),
  storage_key   TEXT NOT NULL,
  memo          TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 녹음의 사용자·세션·곡이 서로 같은 사용자, 같은 곡을 가리키도록 강제
  FOREIGN KEY (user_id, session_id, song_id) REFERENCES sessions (user_id, id, song_id) ON DELETE CASCADE
);
CREATE INDEX takes_session_idx ON takes (session_id, recorded_at);
CREATE INDEX takes_song_idx ON takes (song_id, recorded_at DESC);
CREATE INDEX takes_user_storage_idx ON takes (user_id, storage);

-- ============================================================
-- 5. notes & analysis_jobs (Gemini 학습 영상 노트)
-- ============================================================
CREATE TABLE notes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id      TEXT NOT NULL CHECK (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title         TEXT NOT NULL,
  channel       TEXT NOT NULL DEFAULT '',
  tags          TEXT[] NOT NULL,
  memo          TEXT NOT NULL DEFAULT '',
  headline      TEXT NOT NULL DEFAULT '',
  points        TEXT[] NOT NULL DEFAULT '{}',
  keywords      TEXT[] NOT NULL DEFAULT '{}',
  difficulty    TEXT CHECK (difficulty IN ('입문', '중급', '고급')),
  analysis      JSONB NOT NULL,                 -- Gemini 스키마 응답 원본
  diagrams_svg  JSONB NOT NULL DEFAULT '[]',    -- 화성 진행별 렌더링된 SVG 문자열 배열
  model         TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notes_user_created_idx ON notes (user_id, created_at DESC);
CREATE TRIGGER notes_updated BEFORE UPDATE ON notes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE analysis_jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  tags         TEXT[] NOT NULL CHECK (cardinality(tags) > 0),
  memo         TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  error        TEXT,
  note_id      UUID REFERENCES notes(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ
);
CREATE INDEX analysis_jobs_user_idx ON analysis_jobs (user_id, created_at DESC);

-- ============================================================
-- 6. integrations (외부 API 키 보관 - AES-256-GCM 암호화)
-- ============================================================
CREATE TABLE integrations (
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id            TEXT NOT NULL CHECK (app_id IN ('ulevelp', 'guitar-practice')),
  provider          TEXT NOT NULL CHECK (provider IN ('notion', 'gemini')),
  encrypted_secret  BYTEA NOT NULL,             -- AES-256-GCM 암호문 + 16바이트 Auth Tag
  iv                BYTEA NOT NULL CHECK (octet_length(iv) = 12), -- 96-bit 고유 IV
  key_version       SMALLINT NOT NULL DEFAULT 1, -- 마스터 키 회전(Rotation) 대비 버전
  hint              TEXT NOT NULL,              -- 키 끝 4자리 (화면 표시용)
  config            JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(config) = 'object'),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, app_id, provider)
);
CREATE TRIGGER integrations_updated BEFORE UPDATE ON integrations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 7. notion_sync, notion_links, sync_outbox (노션 실시간 연동)
-- ============================================================
CREATE TABLE notion_sync (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled       BOOLEAN NOT NULL DEFAULT false,
  last_push_at  TIMESTAMPTZ,
  last_pull_at  TIMESTAMPTZ,
  last_error    TEXT,
  lease_until   TIMESTAMPTZ,    -- Push 워커 점유 만료 시각 (3.4절). NULL 또는 과거면 비어 있음
  lease_owner   TEXT,           -- 점유한 워커 식별자 (인스턴스 ID + 난수)
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER notion_sync_updated BEFORE UPDATE ON notion_sync FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE notion_links (
  entity          TEXT NOT NULL CHECK (entity IN ('song', 'session', 'take', 'note')),
  entity_id       UUID NOT NULL,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notion_page_id  TEXT NOT NULL,  -- song·session·note: 노션 페이지 ID, take: 오디오 블록 ID
  notion_extra    TEXT,           -- take: 캡션 문단 블록 ID
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, entity_id)
);
CREATE UNIQUE INDEX notion_links_user_page_idx ON notion_links (user_id, notion_page_id);

CREATE TABLE sync_outbox (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity      TEXT NOT NULL CHECK (entity IN ('song', 'session', 'take', 'note')),
  entity_id   UUID NOT NULL,
  op          TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at     TIMESTAMPTZ
);
CREATE INDEX sync_outbox_pending_idx ON sync_outbox (user_id, id) WHERE done_at IS NULL;

-- ============================================================
-- 8. storage_trash (지울 스토리지 파일 대기열)
-- ============================================================
-- 곡·녹음·계정 삭제 시 DB 행과 같은 트랜잭션에서 파일 키를 넣고, 커밋 후 즉시 + 1분 cron이 실제 파일을 지운다.
-- 사용자 행이 지워져도 남아야 하므로 users FK를 걸지 않는다.
CREATE TABLE storage_trash (
  id           BIGSERIAL PRIMARY KEY,
  storage_key  TEXT NOT NULL,       -- Supabase Storage 'takes' 버킷 경로
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

