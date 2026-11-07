-- progressions: 코드 진행 모음 (CHORDS). 한 행 = 진행 하나 (개발산출물/결과/CH-1b_설계.md §2)
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
  key              TEXT CHECK (key ~ '^[A-G](#|b)? (Major|min)$'),                 -- 노션 Scale 형식: "F Major" / "A min". 모르면 NULL
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

