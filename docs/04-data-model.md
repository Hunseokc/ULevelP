# 04. DB 모델

Supabase Postgres 기준입니다. 이 문서의 SQL을 `supabase/migrations/0001_init.sql`로 시작하면 됩니다. 표는 **노션 템플릿과 1:1로 대응**하도록 만들었고(6장), 노션에서 파생되는 값(제목 문구, "이어서 연습" 주소, 구간 문자열)은 저장하지 않고 계산합니다.

## 1. 관계

```
auth.users 1─1 profiles
auth.users 1─* songs 1─* sessions 1─* takes
auth.users 1─* notes            (Gemini 키를 등록한 사용자)
auth.users 1─* analysis_jobs    (Gemini 키를 등록한 사용자)
auth.users 1─* integrations     (키를 등록한 사용자. (user_id, app_id, provider)마다 한 행, 키 원문은 vault.secrets)
auth.users 1─1 notion_sync      (노션 실시간 연동 상태)
notion_links: (entity, entity_id) → 노션 페이지 ID  (노션 실시간 연동)
sync_outbox: 노션으로 보낼 변경 대기열        (노션 실시간 연동)
```

**키 등록 사용자 (D13·D15):** 노션 실시간 연동과 학습 노트는 소유자 전용이 아니라, 해당 키(노션 / Gemini)를 등록한 사용자면 누구나 씁니다. 소유자(`profiles.role = 'owner'`)에게만 있는 것은 `take_quota_bytes` 같은 운영 값뿐이고, 기능을 열고 막는 데는 `role`을 쓰지 않습니다.

**공용 키 테이블 (D18):** `integrations`와 키 함수(`save_*_key`, `get_*_key`)는 guitar-practice도 같은 Supabase 프로젝트에서 씁니다(`app_id = 'guitar-practice'`). 이 문서의 마이그레이션이 원본이고, guitar-practice는 `개발산출물/결과/R2_설계개정.md`의 공용 스키마 절을 따릅니다.

## 2. 공통

```sql
create extension if not exists pgcrypto;

-- API로 노출되지 않는 내부 함수용 스키마 (PostgREST는 public만 노출)
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- updated_at 자동 갱신
create function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
```

`security definer` 함수는 모두 `set search_path = ''`로 두고 테이블·함수 이름을 스키마까지 적습니다(`public.profiles`, `vault.secrets`). 함수 실행 권한은 [4.5](#45-함수-실행-권한)에서 역할 이름을 적어 회수합니다.

## 3. 테이블

### 3.1 profiles

```sql
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null default '',
  role text not null default 'user' check (role in ('user', 'owner')),  -- 운영 표시. 기능을 열고 막는 데 쓰지 않음 (D15)
  storage_provider text not null default 'supabase' check (storage_provider in ('supabase', 'drive')),
  drive_folder_id text,                         -- P6: 'ULeveLP 녹음' 폴더
  take_quota_bytes bigint not null default 209715200,  -- 200MB
  migrated_local_at timestamptz,                -- FR-LOCAL-2: 기기 기록 옮긴 시각
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated before update on profiles for each row execute function set_updated_at();

-- 가입하면 profiles 행 생성
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
```

### 3.2 songs (노션: 연습 곡)

```sql
create table songs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,                                   -- 곡명
  artist text not null default '',                       -- 아티스트
  status text not null default 'practicing'
    check (status in ('practicing', 'paused', 'done')),  -- 상태: 연습 중 / 보류 / 완료
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),  -- 유튜브 링크
  pos numeric(8,1),                                      -- 마지막 위치(초)
  a numeric(8,1),                                        -- 구간 시작(초)
  b numeric(8,1),                                        -- 구간 끝(초)
  rate numeric(4,2) not null default 1,                  -- 속도
  last_date date,                                        -- 마지막 연습일
  memo text not null default '',                         -- 메모
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, video_id),
  check (a is null or b is null or a < b)
);
create index songs_user_status on songs (user_id, status, last_date desc);
create trigger songs_updated before update on songs for each row execute function set_updated_at();
```

### 3.3 sessions (노션: 연습 기록)

```sql
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  song_id uuid not null references songs on delete cascade,   -- 곡
  date date not null,                                         -- 날짜 (사용자 현지)
  seconds integer not null default 0 check (seconds >= 0),    -- 연습 시간. 노션에는 분으로 (소수 둘째 자리)
  loops integer not null default 0 check (loops >= 0),        -- 반복 횟수
  rate numeric(4,2),                                          -- 속도 (마지막 값)
  a numeric(8,1),                                             -- 구간 시작 (마지막 값)
  b numeric(8,1),                                             -- 구간 끝 (마지막 값)
  memo text not null default '',                              -- 메모
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, song_id, date)
);
create index sessions_user_date on sessions (user_id, date desc);
create trigger sessions_updated before update on sessions for each row execute function set_updated_at();
```

### 3.4 takes (노션: 연습 기록 본문의 오디오 블록 + `녹음` 속성)

```sql
create table takes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  session_id uuid not null references sessions on delete cascade,
  song_id uuid not null references songs on delete cascade,
  recorded_at timestamptz not null,          -- 녹음 시작 시각
  a numeric(8,1), b numeric(8,1), rate numeric(4,2),   -- 녹음 시작 때 구간·속도
  duration_sec integer not null check (duration_sec >= 0),
  mime text not null check (mime in ('audio/mp4', 'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/wav', 'audio/aac')),
  size_bytes bigint not null check (size_bytes > 0),
  storage text not null check (storage in ('supabase', 'drive')),
  storage_key text not null,                 -- supabase: '{user_id}/{take_id}.{ext}', drive: 파일 ID
  memo text not null default '',
  created_at timestamptz not null default now()
);
create index takes_session on takes (session_id, recorded_at);

-- 녹음 한도: Storage에 올리는 녹음의 합이 take_quota_bytes를 넘으면 거부
create function check_take_quota() returns trigger language plpgsql as $$
declare used bigint; quota bigint;
begin
  if new.storage <> 'supabase' then return new; end if;
  select coalesce(sum(size_bytes), 0) into used from takes where user_id = new.user_id and storage = 'supabase';
  select take_quota_bytes into quota from profiles where id = new.user_id;
  if used + new.size_bytes > quota then
    raise exception 'take_quota_exceeded' using hint = '녹음 저장 한도를 넘었어요';
  end if;
  return new;
end $$;
create trigger takes_quota before insert on takes for each row execute function check_take_quota();
```

확장자 대응: `audio/mp4 → m4a`, `audio/webm → weba`, `audio/ogg → ogg`, `audio/mpeg → mp3`, `audio/wav → wav`, `audio/aac → aac` (노션 파일 업로드가 받는 조합. 지금 `Code.gs`의 `AUDIO`와 같음).

파일 이름(드라이브, 내보내기, 노션): `YYYY-MM-DD HHMM 곡명.확장자` (곡명에서 `\/:*?"<>|` 는 공백으로, 60자까지).

### 3.5 notes (노션: 학습 영상 노트) · Gemini 키 등록 사용자

행은 `analyze-video`(service role)만 만듭니다. Gemini 키 확인은 만들 때 한 번 하고, 키를 지운 뒤에도 이미 만든 노트는 본인 데이터라 계속 보입니다(내보내기 포함).

```sql
create table notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title text not null,                       -- 제목
  channel text not null default '',          -- 채널
  tags text[] not null,                      -- 태그 (화성, 사운드 디자인, DAW/MIDI, 리듬, 편곡, 믹싱, TAB)
  memo text not null default '',             -- 메모 (요청 때 입력)
  headline text not null default '',         -- 요약 (핵심 한 줄)
  points text[] not null default '{}',       -- 요약 요점
  keywords text[] not null default '{}',     -- 키워드
  difficulty text check (difficulty in ('입문', '중급', '고급')),  -- 난이도
  analysis jsonb not null,                   -- scripts/schemas.py build(tags) 스키마의 Gemini 출력 원본
  model text not null default '',            -- 사용한 Gemini 모델
  created_at timestamptz not null default now()
);
create index notes_user on notes (user_id, created_at desc);
```

같은 영상을 다른 태그로 여러 번 분석할 수 있어서 `video_id`에 unique를 두지 않습니다.

### 3.6 analysis_jobs · Gemini 키 등록 사용자

```sql
create table analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  url text not null,
  tags text[] not null check (cardinality(tags) > 0),
  memo text not null default '',
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  error text,
  note_id uuid references notes on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index analysis_jobs_user on analysis_jobs (user_id, created_at desc);
```

### 3.7 integrations · 키를 등록한 사용자 (ULevelP·guitar-practice 공용)

[키 보관 가이드](../개발산출물/자료/키캐싱_가이드_요약.md) 2절을 따릅니다. 키 원문은 `vault.secrets`에만 있고, 이 테이블에는 Vault 비밀의 ID, 끝 4자리, 설정(DB ID·모델), 갱신 시각만 둡니다.

- 저장은 `save_notion_key`·`save_gemini_key` RPC로만([4.4](#44-키-저장조회-save__key-get__key)). 이 테이블에는 insert·update 정책이 없습니다.
- 클라이언트는 본인 행의 `secret_id`를 뺀 열만 읽고, 본인 행을 지울 수 있습니다(연결 해제). 지우면 트리거가 Vault 비밀도 지웁니다(계정 삭제 cascade 포함).
- 원문 조회(`get_*_key`)는 service role 전용이고 Edge Function(ULevelP)과 Apps Script(guitar-practice)만 부릅니다.

```sql
create table integrations (
  user_id uuid not null references auth.users on delete cascade,
  app_id text not null check (app_id in ('ulevelp', 'guitar-practice')),
  provider text not null check (provider in ('notion', 'gemini')),
  secret_id uuid not null,                 -- vault.secrets.id
  hint text not null,                      -- 키 끝 4자리 (화면 표시용)
  config jsonb not null default '{}' check (jsonb_typeof(config) = 'object'),
    -- notion: {"songsDb", "sessionsDb", "notesDb"?} (32자리 hex), gemini: {"model"}
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),   -- 키 버전. guitar-practice 캐시 키에 씀
  primary key (user_id, app_id, provider)
);
create trigger integrations_updated before update on integrations for each row execute function set_updated_at();

-- 연결 행이 지워지면 Vault 비밀도 지우고, ULevelP 노션 키면 실시간 연동을 끔
create function private.integrations_drop_secret() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where id = old.secret_id;
  if old.app_id = 'ulevelp' and old.provider = 'notion' then
    update public.notion_sync set enabled = false where user_id = old.user_id;
  end if;
  return old;
end $$;
create trigger integrations_secret_cleanup after delete on integrations
  for each row execute function private.integrations_drop_secret();
```

Vault 비밀 이름은 `{app_id}:{provider}:{user_id}`입니다(`vault.secrets.name`이 unique라 같은 키가 두 번 생기지 않음).

### 3.8 notion_sync · 노션 실시간 연동 상태 (ULevelP 전용)

```sql
create table notion_sync (
  user_id uuid primary key references auth.users on delete cascade,
  enabled boolean not null default false,   -- 처음 연동(notion-pull full)이 끝나면 true
  last_push_at timestamptz,
  last_pull_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
create trigger notion_sync_updated before update on notion_sync for each row execute function set_updated_at();
```

켜기는 `notion-pull`(service role)만 합니다. 클라이언트는 끄기(`enabled = false`)만 할 수 있습니다. ULevelP 노션 키를 지우면 위 트리거가 끕니다.

### 3.9 notion_links, sync_outbox · 노션 실시간 연동

```sql
create table notion_links (
  entity text not null check (entity in ('song', 'session', 'take', 'note')),
  entity_id uuid not null,
  user_id uuid not null references auth.users on delete cascade,
  notion_page_id text not null,       -- song·session·note: 페이지 ID, take: 오디오 블록 ID
  notion_extra text,                  -- take: 설명 문단 블록 ID
  synced_at timestamptz not null default now(),
  primary key (entity, entity_id)
);
create unique index notion_links_page on notion_links (user_id, notion_page_id);

create table sync_outbox (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  entity text not null check (entity in ('song', 'session', 'take', 'note')),
  entity_id uuid not null,
  op text not null check (op in ('upsert', 'delete')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index sync_outbox_pending on sync_outbox (user_id, id) where done_at is null;

-- 연동이 켜진 사용자의 변경만 대기열에 넣음. 같은 대상의 처리 안 된 upsert가 있으면 또 넣지 않음
-- 노션에서 가져온 변경(app.sync_source = 'notion')은 다시 보내지 않음
create function private.enqueue_sync() returns trigger language plpgsql security definer set search_path = '' as $$
declare r record; v_kind text := tg_argv[0]; v_op text;
begin
  if current_setting('app.sync_source', true) = 'notion' then return null; end if;
  if tg_op = 'DELETE' then r := old; v_op := 'delete'; else r := new; v_op := 'upsert'; end if;
  if not exists (select 1 from public.notion_sync n where n.user_id = r.user_id and n.enabled) then return null; end if;
  if v_op = 'upsert' and exists (
    select 1 from public.sync_outbox o where o.entity = v_kind and o.entity_id = r.id and o.op = 'upsert' and o.done_at is null
  ) then return null; end if;
  insert into public.sync_outbox (user_id, entity, entity_id, op) values (r.user_id, v_kind, r.id, v_op);
  return null;
end $$;
create trigger songs_sync after insert or update or delete on songs for each row execute function private.enqueue_sync('song');
create trigger sessions_sync after insert or update or delete on sessions for each row execute function private.enqueue_sync('session');
create trigger takes_sync after insert or update or delete on takes for each row execute function private.enqueue_sync('take');
create trigger notes_sync after insert or update or delete on notes for each row execute function private.enqueue_sync('note');
```

삭제된 행은 `entity_id`로 다시 찾을 수 없으니, 노션 쪽 삭제는 `notion_links`의 페이지 ID로 처리합니다(노션 페이지는 보관함으로 이동).

노션에서 가져온 변경이 다시 대기열에 들어가 노션으로 되돌아가지 않도록, 가져오기 Edge Function은 같은 트랜잭션 안에서 쓰기 전에 `select set_config('app.sync_source', 'notion', true)`를 호출합니다. 여러 쓰기를 한 트랜잭션으로 묶어야 하므로 가져오기는 Postgres 함수(`rpc`) 하나로 감싸서 실행합니다.

## 4. 함수

### 4.1 add_practice: 연습 시간 더하기 (FR-SESSION-1, 2)

지금 `Code.gs` `save()`의 잠금 + 합산을 원자적으로 처리합니다. `security invoker`라 RLS가 그대로 적용됩니다.

```sql
create function add_practice(
  p_song uuid, p_date date, p_seconds integer, p_loops integer,
  p_rate numeric default null, p_a numeric default null, p_b numeric default null
) returns table (session_id uuid, total_seconds integer, kept boolean)
language plpgsql security invoker as $$
begin
  p_seconds := greatest(0, least(p_seconds, 6 * 3600));
  p_loops := greatest(0, least(p_loops, 100000));

  update sessions s set seconds = s.seconds + p_seconds, loops = s.loops + p_loops,
         rate = coalesce(p_rate, s.rate), a = p_a, b = p_b
   where s.user_id = auth.uid() and s.song_id = p_song and s.date = p_date
   returning s.id, s.seconds, false into session_id, total_seconds, kept;
  if found then return next; return; end if;

  -- 1분 미만이면 아직 만들지 않음. 플레이어가 남은 시간을 다음 저장에 다시 보냄
  if p_seconds < 60 then
    session_id := null; total_seconds := p_seconds; kept := true; return next; return;
  end if;

  insert into sessions (song_id, date, seconds, loops, rate, a, b)
  values (p_song, p_date, p_seconds, p_loops, p_rate, p_a, p_b)
  on conflict (user_id, song_id, date) do update
     set seconds = sessions.seconds + excluded.seconds, loops = sessions.loops + excluded.loops,
         rate = coalesce(excluded.rate, sessions.rate), a = excluded.a, b = excluded.b
  returning id, seconds, false into session_id, total_seconds, kept;
  return next;
end $$;
```

### 4.2 ensure_session: 녹음용 연습 기록 (FR-TAKE-2)

```sql
create function ensure_session(p_song uuid, p_date date) returns uuid
language plpgsql security invoker as $$
declare sid uuid;
begin
  insert into sessions (song_id, date) values (p_song, p_date)
  on conflict (user_id, song_id, date) do update set updated_at = now()
  returning id into sid;
  return sid;
end $$;
```

### 4.3 save_song_progress: 곡 위치·구간·속도 저장 (FR-SONG-3)

플레이어의 자동 저장 한 번 = `save_song_progress` + (시간이나 반복이 있으면) `add_practice`. 두 호출을 클라이언트가 순서대로 보냅니다.

```sql
create function save_song_progress(p_song uuid, p_pos numeric, p_a numeric, p_b numeric, p_rate numeric, p_date date)
returns void language sql security invoker as $$
  update songs set pos = p_pos, a = p_a, b = p_b, rate = coalesce(p_rate, rate),
         last_date = greatest(coalesce(last_date, p_date), p_date)
   where id = p_song and user_id = auth.uid();
$$;
```

### 4.4 키 저장·조회 (`save_*_key`, `get_*_key`)

- 저장 RPC는 브라우저가 부릅니다. 사용자는 함수 안에서 `auth.uid()`로 정하므로 남의 `user_id`로 저장할 수 없습니다. 반환은 끝 4자리와 갱신 시각뿐입니다.
- 키 인자를 `null`로 주면 키는 그대로 두고 설정(DB ID·모델)만 바꿉니다. 처음 저장할 때는 키가 꼭 있어야 합니다.
- 형식이 틀리면 `errcode = '22023'`과 아래 메시지로 거부합니다. 화면은 메시지로 안내 문구를 고릅니다.

| 메시지 | 뜻 |
| --- | --- |
| `not_authenticated` (errcode `28000`) | 로그인 안 됨 |
| `invalid_app_id` | `app_id`가 `ulevelp`·`guitar-practice`가 아님 |
| `missing_key` | 처음 저장인데 키 인자가 `null` |
| `invalid_notion_token` | `^(ntn_\|secret_)[A-Za-z0-9]{20,}$`가 아님 |
| `invalid_notion_db_id` | DB ID가 `^[0-9a-f]{32}$`가 아님 (하이픈 있는 UUID·노션 링크는 클라이언트가 32자리로 바꿔서 보냄) |
| `invalid_gemini_key` | `^AIza[0-9A-Za-z_-]{30,60}$`가 아님 |
| `invalid_gemini_model` | `^[a-z0-9][a-z0-9.-]{0,63}$`가 아님 |

```sql
-- 공통: Vault에 넣거나 바꾸고 integrations 행을 맞춤 (API로 노출 안 됨)
create function private.put_key(p_uid uuid, p_app_id text, p_provider text, p_secret text, p_config jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  select i.secret_id into sid from public.integrations i
   where i.user_id = p_uid and i.app_id = p_app_id and i.provider = p_provider for update;
  if sid is null then
    if p_secret is null then raise exception 'missing_key' using errcode = '22023'; end if;
    sid := vault.create_secret(p_secret, format('%s:%s:%s', p_app_id, p_provider, p_uid), p_provider || ' key');
    insert into public.integrations (user_id, app_id, provider, secret_id, hint, config)
    values (p_uid, p_app_id, p_provider, sid, right(p_secret, 4), p_config);
  else
    if p_secret is not null then perform vault.update_secret(sid, p_secret); end if;
    update public.integrations i
       set config = p_config, hint = coalesce(right(p_secret, 4), i.hint)
     where i.user_id = p_uid and i.app_id = p_app_id and i.provider = p_provider;
  end if;
end $$;

create function save_notion_key(
  p_app_id text, p_token text, p_songs_db text, p_sessions_db text, p_notes_db text default null
) returns table (hint text, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_app_id not in ('ulevelp', 'guitar-practice') then raise exception 'invalid_app_id' using errcode = '22023'; end if;
  if p_token is not null and p_token !~ '^(ntn_|secret_)[A-Za-z0-9]{20,}$' then
    raise exception 'invalid_notion_token' using errcode = '22023';
  end if;
  if coalesce(p_songs_db, '') !~ '^[0-9a-f]{32}$' or coalesce(p_sessions_db, '') !~ '^[0-9a-f]{32}$'
     or (p_notes_db is not null and p_notes_db !~ '^[0-9a-f]{32}$') then
    raise exception 'invalid_notion_db_id' using errcode = '22023';
  end if;
  perform private.put_key(uid, p_app_id, 'notion', p_token, jsonb_strip_nulls(
    jsonb_build_object('songsDb', p_songs_db, 'sessionsDb', p_sessions_db, 'notesDb', p_notes_db)));
  return query select i.hint, i.updated_at from public.integrations i
   where i.user_id = uid and i.app_id = p_app_id and i.provider = 'notion';
end $$;

create function save_gemini_key(p_app_id text, p_key text, p_model text default null)
returns table (hint text, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_app_id not in ('ulevelp', 'guitar-practice') then raise exception 'invalid_app_id' using errcode = '22023'; end if;
  if p_key is not null and p_key !~ '^AIza[0-9A-Za-z_-]{30,60}$' then
    raise exception 'invalid_gemini_key' using errcode = '22023';
  end if;
  p_model := coalesce(p_model, 'gemini-flash-latest');
  if p_model !~ '^[a-z0-9][a-z0-9.-]{0,63}$' then raise exception 'invalid_gemini_model' using errcode = '22023'; end if;
  perform private.put_key(uid, p_app_id, 'gemini', p_key, jsonb_build_object('model', p_model));
  return query select i.hint, i.updated_at from public.integrations i
   where i.user_id = uid and i.app_id = p_app_id and i.provider = 'gemini';
end $$;

-- 원문 조회: service role 전용 (Edge Function, guitar-practice Apps Script). 행이 없으면 0행 → 호출 쪽이 412 NO_KEY
create function get_notion_key(p_user_id uuid, p_app_id text)
returns table (token text, songs_db text, sessions_db text, notes_db text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.decrypted_secret, i.config->>'songsDb', i.config->>'sessionsDb', i.config->>'notesDb', i.updated_at
    from public.integrations i join vault.decrypted_secrets s on s.id = i.secret_id
   where i.user_id = p_user_id and i.app_id = p_app_id and i.provider = 'notion'
$$;

create function get_gemini_key(p_user_id uuid, p_app_id text)
returns table (api_key text, model text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.decrypted_secret, i.config->>'model', i.updated_at
    from public.integrations i join vault.decrypted_secrets s on s.id = i.secret_id
   where i.user_id = p_user_id and i.app_id = p_app_id and i.provider = 'gemini'
$$;
```

키 지우기(연결 해제)는 RPC 없이 본인 행 삭제입니다: `delete from integrations where app_id = 'ulevelp' and provider = 'notion'` (REST `DELETE /rest/v1/integrations?app_id=eq.ulevelp&provider=eq.notion`). Vault 정리는 3.7 트리거가 합니다.

### 4.5 sync_status: 노션 연동 상태 (FR-SYNC-3)

```sql
create function sync_status()
returns table (enabled boolean, pending integer, failed integer, last_push_at timestamptz, last_pull_at timestamptz, last_error text)
language sql stable security definer set search_path = '' as $$
  select coalesce(n.enabled, false),
         (select count(*)::int from public.sync_outbox o where o.user_id = u.uid and o.done_at is null and o.attempts < 5),
         (select count(*)::int from public.sync_outbox o where o.user_id = u.uid and o.done_at is null and o.attempts >= 5),
         n.last_push_at, n.last_pull_at, n.last_error
    from (select auth.uid() as uid) u left join public.notion_sync n on n.user_id = u.uid
$$;
```

`apply_notion_pull(p_user_id uuid, payload jsonb)`(노션에서 가져온 변경을 한 트랜잭션으로 쓰는 함수, [03 6.4](03-design.md#64-노션-실시간-연동))는 P4-4에서 이 문서에 추가하고, 권한은 `get_*_key`와 같게 service role 전용으로 둡니다.

### 4.6 함수 실행 권한

Supabase는 `public` 스키마에 새로 만든 함수의 실행 권한을 `anon`·`authenticated`·`service_role`에 **직접** 줍니다. `revoke ... from public`만으로는 회수되지 않으니 역할 이름을 적습니다. 트리거 함수는 `private` 스키마에 두어 API로 부를 수 없게 합니다(`handle_new_user`는 `auth.users` 트리거라 `public`에 두되 같은 방식으로 회수).

```sql
-- 로그인한 사용자만
revoke execute on function add_practice(uuid, date, integer, integer, numeric, numeric, numeric) from public, anon;
revoke execute on function ensure_session(uuid, date) from public, anon;
revoke execute on function save_song_progress(uuid, numeric, numeric, numeric, numeric, date) from public, anon;
revoke execute on function save_notion_key(text, text, text, text, text) from public, anon;
revoke execute on function save_gemini_key(text, text, text) from public, anon;
revoke execute on function sync_status() from public, anon;
grant  execute on function add_practice(uuid, date, integer, integer, numeric, numeric, numeric),
                           ensure_session(uuid, date),
                           save_song_progress(uuid, numeric, numeric, numeric, numeric, date),
                           save_notion_key(text, text, text, text, text),
                           save_gemini_key(text, text, text),
                           sync_status() to authenticated;

-- service role 전용 (키 원문)
revoke execute on function get_notion_key(uuid, text) from public, anon, authenticated;
revoke execute on function get_gemini_key(uuid, text) from public, anon, authenticated;
grant  execute on function get_notion_key(uuid, text), get_gemini_key(uuid, text) to service_role;

-- 직접 부를 일 없음
revoke execute on function handle_new_user() from public, anon, authenticated;
revoke execute on function set_updated_at() from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
```

배포 전 점검(모두 `false`, P0-2 pgTAP에 넣음):

```sql
select has_function_privilege('anon',          'public.get_notion_key(uuid, text)', 'execute'),
       has_function_privilege('authenticated', 'public.get_notion_key(uuid, text)', 'execute'),
       has_function_privilege('anon',          'public.get_gemini_key(uuid, text)', 'execute'),
       has_function_privilege('authenticated', 'public.get_gemini_key(uuid, text)', 'execute'),
       has_function_privilege('anon',          'public.save_notion_key(text, text, text, text, text)', 'execute'),
       has_function_privilege('authenticated', 'private.put_key(uuid, text, text, text, jsonb)', 'execute');
```

## 5. 접근 정책 (RLS)

```sql
alter table profiles enable row level security;
alter table songs enable row level security;
alter table sessions enable row level security;
alter table takes enable row level security;
alter table notes enable row level security;
alter table analysis_jobs enable row level security;
alter table integrations enable row level security;
alter table notion_sync enable row level security;
alter table notion_links enable row level security;
alter table sync_outbox enable row level security;

-- profiles: 본인 행만 보고, role·quota는 못 바꿈
create policy profiles_select on profiles for select using (id = auth.uid());
create policy profiles_update on profiles for update using (id = auth.uid()) with check (id = auth.uid());
revoke update on profiles from authenticated;
grant update (display_name, storage_provider, drive_folder_id, migrated_local_at) on profiles to authenticated;

-- songs: 본인 것만
create policy songs_all on songs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- sessions·takes: 본인 것이고, 붙는 곡(과 연습 기록)도 본인 것 (NFR-SEC-3)
create policy sessions_all on sessions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from songs where songs.id = song_id and songs.user_id = auth.uid()));
create policy takes_all on takes for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and exists (select 1 from songs where songs.id = song_id and songs.user_id = auth.uid())
    and exists (select 1 from sessions where sessions.id = session_id and sessions.user_id = auth.uid() and sessions.song_id = takes.song_id));

-- notes·analysis_jobs: 본인 것만. 행은 analyze-video(service role)만 만듦 → insert 정책 없음.
-- Gemini 키 확인은 만드는 쪽(Edge Function)이 한다(FR-KEY-GATE). 키를 지워도 이미 만든 노트는 본인 데이터로 남음
create policy notes_select on notes for select using (user_id = auth.uid());
create policy notes_update on notes for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notes_delete on notes for delete using (user_id = auth.uid());
revoke insert, update on notes from anon, authenticated;
grant update (memo, tags) on notes to authenticated;
create policy jobs_select on analysis_jobs for select using (user_id = auth.uid());
revoke insert, update, delete on analysis_jobs from anon, authenticated;

-- integrations: 본인 행 읽기(secret_id 제외)·지우기만. 저장은 save_*_key RPC로만 (가이드 2절)
create policy integrations_select on integrations for select using (user_id = auth.uid());
create policy integrations_delete on integrations for delete using (user_id = auth.uid());
revoke all on integrations from anon, authenticated;
grant select (user_id, app_id, provider, hint, config, created_at, updated_at) on integrations to authenticated;
grant delete on integrations to authenticated;

-- notion_sync: 본인 행 읽기, 끄기만
create policy notion_sync_select on notion_sync for select using (user_id = auth.uid());
create policy notion_sync_off on notion_sync for update using (user_id = auth.uid())
  with check (user_id = auth.uid() and enabled = false);
revoke all on notion_sync from anon, authenticated;
grant select on notion_sync to authenticated;
grant update (enabled) on notion_sync to authenticated;

-- notion_links, sync_outbox: 클라이언트 정책 없음 (Edge Function이 service role로만 접근. 상태는 sync_status())
revoke all on notion_links, sync_outbox from anon, authenticated;
```

**테스트 (P0 필수, NFR-SEC-2·8):** 사용자 A·B 두 계정을 만들고, B의 JWT로 A의 행을 `select/insert/update/delete`했을 때 모두 0행이거나 거부되는지 테이블마다 확인합니다. B가 A의 `song_id`로 `sessions`·`takes`를 넣는 것도 거부돼야 합니다. 그리고:
- 일반 사용자가 `profiles.role`·`take_quota_bytes`를 바꾸는 것 거부
- `integrations`에 직접 insert·update 거부, `secret_id` 열 select 거부, B가 A의 행 삭제 0행
- `save_notion_key`·`save_gemini_key`: 형식이 틀리면 4.4 표의 메시지로 거부, 저장 후 `vault.secrets`에 이름 `{app_id}:{provider}:{uid}` 한 행, 다시 저장하면 행이 늘지 않고 `updated_at`이 바뀜, 같은 사용자의 `ulevelp`·`guitar-practice` 행이 따로 생김
- `get_*_key`: `anon`·`authenticated`로 부르면 권한 오류, `service_role`로는 원문이 나옴 (4.6 점검 쿼리 포함)
- `integrations` 행 삭제(직접, 계정 삭제 cascade 둘 다) 뒤 해당 `vault.secrets` 행 없음, ULevelP 노션 키 삭제 뒤 `notion_sync.enabled = false`
- `notion_sync.enabled`를 클라이언트가 `true`로 바꾸는 것 거부, `false`로는 허용

### Storage

```sql
insert into storage.buckets (id, name, public, file_size_limit)
values ('takes', 'takes', false, 52428800);  -- 50MB

-- 본인 폴더만. 올리기 전에 takes 행이 먼저 있어야 함 (한도 확인이 행 삽입 때 일어나므로)
create policy takes_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'takes' and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.takes t where t.storage = 'supabase' and t.storage_key = name and t.user_id = auth.uid()));
create policy takes_obj_select on storage.objects for select to authenticated
  using (bucket_id = 'takes' and (storage.foldername(name))[1] = auth.uid()::text);
create policy takes_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'takes' and (storage.foldername(name))[1] = auth.uid()::text);
```

녹음 올리기 순서: ① `ensure_session` → ② `takes` 행 삽입(id를 클라이언트가 `crypto.randomUUID()`로 정해 `storage_key`에 씀, 한도 확인) → ③ Storage 업로드 → ③이 실패하면 ②의 행 삭제.

## 6. 노션 템플릿 대응표

지금 소유자가 쓰는 노션 구조가 공식 템플릿입니다. **속성 이름과 형식은 바꾸지 않습니다.** 바꾸면 내보내기 CSV, 가져오기, 노션 실시간 연동이 모두 함께 바뀌어야 합니다.

템플릿 페이지 구성:

```
ULeveLP 템플릿 (페이지)
├─ 연습 곡 (인라인 DB)
├─ 연습 기록 (인라인 DB)        곡 ↔ 연습 곡.연습 기록 (양방향 관계)
└─ 학습 영상 노트 (인라인 DB)   Gemini 키를 등록한 사용자가 채움. 키가 없으면 비어 있어도 됨
```

### 6.1 연습 곡 ↔ songs

| 노션 속성 | 형식 | 컬럼 | 변환 |
| --- | --- | --- | --- |
| 곡명 | 제목 | `title` | |
| 아티스트 | 텍스트 | `artist` | |
| 상태 | 선택 (연습 중·보류·완료) | `status` | 연습 중↔`practicing`, 보류↔`paused`, 완료↔`done` |
| 유튜브 링크 | URL | `video_id` | 내보낼 때 `https://www.youtube.com/watch?v={video_id}`. 가져올 때 `youtu.be/`, `?v=`, `/shorts/`, `/embed/`, `/live/` 형식에서 11자리 ID 추출 |
| 이어서 연습 | URL | (계산) | `https://hunseokc.github.io/ULevelP/practice.html?v=…&t=…&a=…&b=…&r=…` (FR-SONG-6). 가져올 때 `유튜브 링크`가 비어 있으면 여기서 영상 ID 추출 |
| 마지막 위치(초) | 숫자 | `pos` | |
| 구간 시작(초) | 숫자 | `a` | |
| 구간 끝(초) | 숫자 | `b` | |
| 속도 | 숫자 | `rate` | |
| 마지막 연습일 | 날짜 | `last_date` | |
| 메모 | 텍스트 | `memo` | |
| 연습 기록 | 관계 (→ 연습 기록) | (sessions.song_id) | 연습 기록 쪽 `곡`과 양방향 |

페이지 아이콘은 🎵.

### 6.2 연습 기록 ↔ sessions (+ takes)

| 노션 속성 | 형식 | 컬럼 | 변환 |
| --- | --- | --- | --- |
| 기록 | 제목 | (계산) | `{date} {곡명}` |
| 곡 | 관계 (→ 연습 곡) | `song_id` | |
| 날짜 | 날짜 | `date` | |
| 연습 시간(분) | 숫자 | `seconds` | 분 = `round(seconds / 60, 2)`. 가져올 때 `round(분 × 60)` |
| 반복 횟수 | 숫자 | `loops` | |
| 속도 | 숫자 | `rate` | |
| 구간 | 텍스트 | `a`, `b` | `m:ss–m:ss` (en dash). 가져올 때 이 형식을 초로 파싱, 실패하면 비움 |
| 메모 | 텍스트 | `memo` | |
| 녹음 | 파일 | `takes` | 그날 녹음 파일들 |

**녹음의 노션 표현** (지금 `Code.gs` `record()`와 같음): 연습 기록 페이지 본문 끝에 녹음마다 두 블록을 순서대로 붙입니다.
1. 문단: `🎙 HH:MM · m:ss–m:ss · 0.75× · m:ss` (녹음 시각 · 구간(있으면) · 속도 · 길이)
2. 오디오 블록 (노션 파일 업로드)

같은 파일을 `녹음` 파일 속성에도 넣습니다.

### 6.3 학습 영상 노트 ↔ notes

| 노션 속성 | 형식 | 컬럼 |
| --- | --- | --- |
| 제목 | 제목 | `title` |
| URL | URL | `video_id` → `https://www.youtube.com/watch?v=…` |
| 태그 | 다중 선택 (화성, 사운드 디자인, DAW/MIDI, 리듬, 편곡, 믹싱, TAB) | `tags` |
| 채널 | 텍스트 | `channel` |
| 요약 | 텍스트 | `headline` |
| 키워드 | 다중 선택 | `keywords` |
| 난이도 | 선택 (입문·중급·고급) | `difficulty` |
| 메모 | 텍스트 | `memo` |

페이지 본문은 `analysis`를 `scripts/analyze.py`의 `build_blocks`와 같은 규칙으로 그린 것입니다(요약, 태그별 표·개념 정리, 주요 구간(시간 링크), 연습 과제 체크리스트, 보이싱 그림).

`TAB` 태그는 노션에서 손으로 붙이는 태그입니다(분석 요청 태그에는 없음). 가져오기·연동에서 보존합니다.

## 7. 내보내기 zip 형식 (FR-NX-2)

```
ULeveLP-export-YYYY-MM-DD.zip
├─ 읽어주세요.txt          노션에 넣는 방법 (03-design.md 6.2의 순서)
├─ 연습 곡.csv
├─ 연습 기록.csv
├─ 학습 영상 노트.csv      (노트가 있을 때만)
├─ 학습 영상 노트/         노트마다 {제목}.md (본문)
└─ 녹음/                   {파일 이름 규칙}.m4a …
```

CSV 규칙: UTF-8 **BOM 포함**(엑셀·노션 한글 깨짐 방지), 쉼표 구분, 큰따옴표 이스케이프, 첫 줄은 노션 속성 이름.

| 형식 | CSV 값 |
| --- | --- |
| 날짜 | `YYYY-MM-DD` |
| 숫자 | 소수점 `.`, 천 단위 구분 없음 |
| 선택 | 한글 이름 (`연습 중`) |
| 다중 선택 | 쉼표로 구분한 한글 이름 (`화성, 리듬`) |
| 관계 | 상대 페이지의 제목 (`연습 기록.csv`의 `곡` 열 = 곡명). 같은 곡명이 둘 이상이면 `곡명 (아티스트)` |
| 파일 | `녹음/` 안의 파일 이름들을 쉼표로 (노션 CSV 병합은 파일을 올리지 못하므로 참고용) |

열 순서:
- `연습 곡.csv`: 곡명, 아티스트, 상태, 유튜브 링크, 이어서 연습, 마지막 위치(초), 구간 시작(초), 구간 끝(초), 속도, 마지막 연습일, 메모
- `연습 기록.csv`: 기록, 곡, 날짜, 연습 시간(분), 반복 횟수, 속도, 구간, 메모, 녹음
- `학습 영상 노트.csv`: 제목, URL, 태그, 채널, 요약, 키워드, 난이도, 메모

## 8. 노션 내보내기 파일 해석 (FR-NX-3)

노션에서 템플릿 페이지를 **내보내기 → Markdown & CSV, 하위 페이지 포함**으로 받은 zip을 읽습니다.

- CSV 파일 이름은 `연습 곡 <32자리 hex>.csv`, `연습 곡 <hex>_all.csv` 형태입니다. 이름에서 hex를 떼고 DB 이름으로 맞추며, `_all`이 있으면 그것을 씁니다(보기 필터와 상관없는 전체 행).
- 열은 속성 **이름**으로 찾습니다(순서는 믿지 않음). 필수 열이 없으면 그 파일 전체를 오류로 보여줍니다: 연습 곡 = `곡명`, `유튜브 링크` 또는 `이어서 연습` / 연습 기록 = `곡`, `날짜`.
- 관계 열(`곡`)의 값은 `곡명 (연습%20곡/곡명%20<hex>.md)` 형태일 수 있습니다. 괄호 안 경로와 hex를 떼고 곡명만 씁니다.
- 날짜는 노션 표시 형식(`October 28, 2026`, `2026년 10월 28일` 등)일 수 있어서 여러 형식을 파싱합니다. 실패한 행은 오류로 보고합니다.
- 녹음: `연습 기록 <hex>/<기록 제목> <hex>/` 폴더 안의 오디오 파일을 찾아 그 연습 기록의 녹음으로 붙입니다. 녹음 시각은 파일 이름(`YYYY-MM-DD HHMM …`)에서, 없으면 그날 12:00으로.

합치기 규칙:
- 곡: `video_id`가 같으면 같은 곡. 가져온 값으로 덮어씀(가져오기는 노션을 원본으로 봄). 영상 ID를 못 찾은 행은 건너뛰고 보고
- 연습 기록: (곡, 날짜)가 같으면 같은 기록. 시간·반복은 **덮어씀**(더하지 않음, 같은 파일을 두 번 가져와도 결과가 같게)
- 녹음: (연습 기록, 파일 이름)이 같으면 건너뜀
- 노트: (video_id, 제목)이 같으면 건너뜀
