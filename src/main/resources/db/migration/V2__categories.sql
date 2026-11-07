-- categories: 사용자 정의 곡 분류 (홈 바로가기·플레이어 분류 폴더)
CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 20),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  on_home     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, id)             -- song_categories 복합 FK 대상 (다른 사용자 분류 참조 차단)
);
CREATE UNIQUE INDEX categories_user_name_uq ON categories (user_id, lower(name));
CREATE TRIGGER categories_updated BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- song_categories: 곡 ↔ 분류 (N:M). 복합 FK로 다른 사용자의 곡·분류 연결 차단
CREATE TABLE song_categories (
  user_id     UUID NOT NULL,
  song_id     UUID NOT NULL,
  category_id UUID NOT NULL,
  PRIMARY KEY (song_id, category_id),
  FOREIGN KEY (user_id, song_id) REFERENCES songs (user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, category_id) REFERENCES categories (user_id, id) ON DELETE CASCADE
);
CREATE INDEX song_categories_category_idx ON song_categories (category_id);
