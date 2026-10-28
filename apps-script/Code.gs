// 연습 플레이어 ↔ 노션 중계 서버 (Google Apps Script 웹 앱)
// 노션 토큰은 여기(스크립트 속성)에만 두고, 플레이어는 비밀 키로만 접근합니다.
//
// 스크립트 속성 (프로젝트 설정 → 스크립트 속성)
//   NOTION_TOKEN   노션 통합 토큰
//   PRACTICE_KEY   플레이어 설정에 넣을 비밀 키. 아무 긴 문자열
//   SONGS_DB, SESSIONS_DB (선택) 노션 데이터베이스 ID. 기본값은 아래
//
// 플레이어는 모든 요청을 text/plain POST 한 번으로 보냅니다 (Apps Script는 커스텀 헤더와 preflight를 못 받음).
//   본문: { key, path: '/songs' | '/song' | '/save' | '/record' | '/health', method: 'GET' | 'POST', query: {...}, body: {...} }
//   응답은 항상 200이고, 실패하면 { error } 가 들어 있습니다.

const NOTION_VERSION = '2022-06-28';
const DEFAULT_SONGS_DB = '959cbe517e224419b48ca3313895a427';
const DEFAULT_SESSIONS_DB = '6260633380b34d28989af90ddfbb4e67';
const TIME_ZONE = 'Asia/Seoul';

// 노션 속성 이름 (노션에서 이름을 바꾸면 여기도 같이)
const P = {
  title: '곡명', artist: '아티스트', status: '상태', resume: '이어서 연습', link: '유튜브 링크',
  pos: '마지막 위치(초)', a: '구간 시작(초)', b: '구간 끝(초)', rate: '속도', lastDate: '마지막 연습일',
};
const S = {
  title: '기록', song: '곡', date: '날짜', minutes: '연습 시간(분)', segment: '구간', rate: '속도', loops: '반복 횟수',
  recording: '녹음',
};

function doPost(e) {
  return respond(handle(parse(e && e.postData && e.postData.contents)));
}

// 브라우저로 주소를 열었을 때 살아 있는지만 확인
function doGet() {
  return respond({ ok: true, hint: '플레이어 설정에 이 주소를 넣으세요' });
}

function parse(text) {
  try { return JSON.parse(text || '{}'); } catch (err) { return {}; }
}

function respond(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function handle(req) {
  const props = PropertiesService.getScriptProperties();
  const env = {
    token: props.getProperty('NOTION_TOKEN'),
    key: props.getProperty('PRACTICE_KEY'),
    songsDb: props.getProperty('SONGS_DB') || DEFAULT_SONGS_DB,
    sessionsDb: props.getProperty('SESSIONS_DB') || DEFAULT_SESSIONS_DB,
  };
  if (!env.token || !env.key) return { error: '스크립트 속성에 NOTION_TOKEN, PRACTICE_KEY를 넣어주세요' };
  if (!safeEqual(String(req.key || ''), env.key)) return { error: '비밀 키가 맞지 않아요' };

  const ctx = makeCtx(env);
  const query = req.query || {};
  const body = req.body || {};
  try {
    switch (req.path) {
      case '/health': return health(ctx);
      case '/songs': return { songs: listSongs(ctx) };
      case '/song':
        if (req.method === 'GET') return { song: findSong(ctx, query.v) };
        return { song: createSong(ctx, body) };
      case '/save': return save(ctx, body);
      case '/record': return record(ctx, body);
      default: return { error: '없는 경로' };
    }
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function makeCtx(env) {
  function call(path, opts) {
    const res = UrlFetchApp.fetch('https://api.notion.com/v1' + path, Object.assign({
      headers: { Authorization: 'Bearer ' + env.token, 'Notion-Version': NOTION_VERSION },
      muteHttpExceptions: true,
    }, opts));
    const status = res.getResponseCode();
    let data = {};
    try { data = JSON.parse(res.getContentText()); } catch (err) { /* 빈 응답 */ }
    if (status >= 400) throw new Error(friendly(status, data));
    return data;
  }
  function notion(path, method, body) {
    return call(path, {
      method: (method || 'GET').toLowerCase(),
      contentType: 'application/json',
      payload: body ? JSON.stringify(body) : undefined,
    });
  }
  // 노션 파일 업로드. 20MB까지는 한 번에, 넘으면 10MB씩 나눠 보냄
  // payload에 Blob을 넣으면 UrlFetchApp이 multipart/form-data로 만들어 줌
  function upload(bytes, mime, name) {
    const PART = 10 * 1024 * 1024;
    const parts = bytes.length > 20 * 1024 * 1024 ? Math.ceil(bytes.length / PART) : 1;
    const req = { filename: name, content_type: mime };
    if (parts > 1) { req.mode = 'multi_part'; req.number_of_parts = parts; }
    const fu = notion('/file_uploads', 'POST', req);
    for (let i = 0; i < parts; i++) {
      const form = { file: Utilities.newBlob(parts > 1 ? bytes.slice(i * PART, (i + 1) * PART) : bytes, mime, name) };
      if (parts > 1) form.part_number = String(i + 1);
      call('/file_uploads/' + fu.id + '/send', { method: 'post', payload: form });
    }
    if (parts > 1) notion('/file_uploads/' + fu.id + '/complete', 'POST', {});
    return fu.id;
  }
  return { songsDb: env.songsDb, sessionsDb: env.sessionsDb, notion, upload };
}

function friendly(status, data) {
  if (status === 401) return '노션 토큰이 올바르지 않아요 (스크립트 속성 NOTION_TOKEN 확인)';
  if (status === 404) return '노션 데이터베이스를 못 찾았어요. 악기 연습 페이지에 통합을 연결했는지 확인하세요';
  if (status === 429) return '노션 요청이 많아요. 잠시 후 다시 저장됩니다';
  if (status === 413) return '녹음 파일이 너무 커요';
  return '노션 오류: ' + (data.message || status);
}

// ---------- 변환 ----------
const txt = (s) => [{ type: 'text', text: { content: String(s == null ? '' : s).slice(0, 2000) } }];
const num = (v) => ({ number: v == null || !isFinite(v) ? null : Math.round(Number(v) * 100) / 100 });
const plain = (arr) => (arr || []).map((t) => t.plain_text).join('');
const prop = (p, k, field) => (p[k] ? p[k][field] : undefined);

// Apps Script에는 URL 클래스가 없어서 정규식으로 읽음
function videoIdFrom(u) {
  if (!u) return null;
  const m = String(u).match(/(?:youtu\.be\/|[?&]v=|\/(?:shorts|embed|live)\/)([\w-]{11})/);
  return m ? m[1] : null;
}
const validId = (v) => typeof v === 'string' && /^[\w-]{11}$/.test(v);

function readSong(page) {
  const p = page.properties || {};
  const n = (k) => (typeof prop(p, k, 'number') === 'number' ? p[k].number : null);
  const select = prop(p, P.status, 'select');
  const date = prop(p, P.lastDate, 'date');
  return {
    id: page.id,
    url: page.url,
    title: plain(prop(p, P.title, 'title')) || '(제목 없음)',
    artist: plain(prop(p, P.artist, 'rich_text')),
    status: select ? select.name : '',
    videoId: videoIdFrom(prop(p, P.link, 'url')) || videoIdFrom(prop(p, P.resume, 'url')),
    pos: n(P.pos), a: n(P.a), b: n(P.b), rate: n(P.rate),
    lastDate: date ? date.start : null,
  };
}

// ---------- 동작 ----------
function health(ctx) {
  const songs = ctx.notion('/databases/' + ctx.songsDb);
  const sessions = ctx.notion('/databases/' + ctx.sessionsDb);
  const has = (db, k) => db.properties && db.properties[k];
  const missing = Object.values(P).filter((k) => !has(songs, k))
    .concat(Object.values(S).filter((k) => !has(sessions, k)));
  if (missing.length) throw new Error('노션에 없는 속성: ' + missing.join(', '));
  let maxUploadMB = null;
  try {
    const me = ctx.notion('/users/me');
    const lim = me.bot && me.bot.workspace_limits && me.bot.workspace_limits.max_file_upload_size_in_bytes;
    if (lim) maxUploadMB = Math.round(lim / 1024 / 1024);
  } catch (err) { /* 몰라도 됨 */ }
  return { ok: true, songsTitle: plain(songs.title), sessionsTitle: plain(sessions.title), maxUploadMB };
}

function listSongs(ctx) {
  const out = [];
  let cursor = null;
  do {
    const q = { sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }], page_size: 100 };
    if (cursor) q.start_cursor = cursor;
    const data = ctx.notion('/databases/' + ctx.songsDb + '/query', 'POST', q);
    data.results.forEach((r) => out.push(readSong(r)));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor && out.length < 300);
  // 연습 중 → 보류 → 완료, 같은 상태면 최근 연습 순
  const order = { '연습 중': 0, '': 1, '보류': 2, '완료': 3 };
  const rank = (s) => (s.status in order ? order[s.status] : 1);
  return out
    .filter((s) => s.videoId)
    .sort((x, y) => rank(x) - rank(y) || String(y.lastDate || '').localeCompare(String(x.lastDate || '')));
}

function findSong(ctx, videoId) {
  if (!validId(videoId)) throw new Error('영상 ID가 올바르지 않아요');
  const data = ctx.notion('/databases/' + ctx.songsDb + '/query', 'POST', {
    filter: { or: [{ property: P.link, url: { contains: videoId } }, { property: P.resume, url: { contains: videoId } }] },
    sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
    page_size: 10,
  });
  return data.results.map(readSong).find((s) => s.videoId === videoId) || null;
}

function oembed(videoId) {
  try {
    const watch = 'https://www.youtube.com/watch?v=' + videoId;
    const r = UrlFetchApp.fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(watch), { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return {};
    const d = JSON.parse(r.getContentText());
    return { title: d.title, artist: d.author_name };
  } catch (err) {
    return {};
  }
}

function createSong(ctx, b) {
  if (!validId(b.videoId)) throw new Error('영상 ID가 올바르지 않아요');
  const existing = findSong(ctx, b.videoId);
  if (existing) return existing;
  let title = b.title, artist = b.artist;
  if (!title) {
    const o = oembed(b.videoId);
    title = o.title;
    artist = artist || o.artist;
  }
  const props = {};
  props[P.title] = { title: txt(title || '새 곡') };
  props[P.artist] = { rich_text: txt(artist || '') };
  props[P.status] = { select: { name: '연습 중' } };
  props[P.link] = { url: 'https://www.youtube.com/watch?v=' + b.videoId };
  props[P.rate] = num(b.rate == null ? 1 : b.rate);
  const page = ctx.notion('/pages', 'POST', {
    parent: { database_id: ctx.songsDb },
    icon: { type: 'emoji', emoji: '🎵' },
    properties: props,
  });
  return readSong(page);
}

const dayOf = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd'));
const segmentOf = (b) => (b.a != null && b.b != null ? mmss(b.a) + '–' + mmss(b.b) : '');

// 같은 곡·같은 날 기록을 동시에 두 번 만들지 않도록 잠금
function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function findSession(ctx, songId, date) {
  const found = ctx.notion('/databases/' + ctx.sessionsDb + '/query', 'POST', {
    filter: { and: [{ property: S.song, relation: { contains: songId } }, { property: S.date, date: { equals: date } }] },
    page_size: 1,
  });
  return found.results[0] || null;
}

function createSession(ctx, b, date, seconds, loops) {
  const props = {};
  props[S.title] = { title: txt((date + ' ' + (b.title || '')).trim()) };
  props[S.song] = { relation: [{ id: b.songId }] };
  props[S.date] = { date: { start: date } };
  props[S.minutes] = num(seconds / 60); props[S.loops] = num(loops); props[S.rate] = num(b.rate);
  props[S.segment] = { rich_text: txt(segmentOf(b)) };
  return ctx.notion('/pages', 'POST', { parent: { database_id: ctx.sessionsDb }, properties: props });
}

function save(ctx, b) {
  if (!b.songId || !validId(b.videoId)) throw new Error('곡 정보가 없어요');
  const date = dayOf(b.date);
  const resume = typeof b.resumeUrl === 'string' && /^https:\/\//.test(b.resumeUrl) ? b.resumeUrl : null;

  const songProps = {};
  songProps[P.pos] = num(b.pos); songProps[P.a] = num(b.a); songProps[P.b] = num(b.b); songProps[P.rate] = num(b.rate);
  songProps[P.resume] = { url: resume };
  songProps[P.lastDate] = { date: { start: date } };
  ctx.notion('/pages/' + b.songId, 'PATCH', { properties: songProps });

  // 연습 기록: 곡별 하루 한 줄, 여러 기기에서 연습해도 시간과 반복 횟수가 더해짐
  const addSec = Math.max(0, Math.min(Number(b.addSeconds) || 0, 6 * 3600));
  const addLoops = Math.max(0, Math.min(Number(b.addLoops) || 0, 100000));
  if (!addSec && !addLoops) return { ok: true };

  return withLock(() => {
    const segment = segmentOf(b);
    const cur = findSession(ctx, b.songId, date);
    if (cur) {
      const p = cur.properties;
      const mins = (prop(p, S.minutes, 'number') || 0) + addSec / 60;
      const loops = (prop(p, S.loops, 'number') || 0) + addLoops;
      const upd = {};
      upd[S.minutes] = num(mins); upd[S.loops] = num(loops); upd[S.rate] = num(b.rate);
      if (segment) upd[S.segment] = { rich_text: txt(segment) };
      ctx.notion('/pages/' + cur.id, 'PATCH', { properties: upd });
      return { ok: true, sessionId: cur.id, minutes: mins };
    }
    // 1분 미만이면 아직 기록을 만들지 않음 (플레이어가 남은 시간을 다음 저장에 다시 보냄)
    if (addSec < 60) return { ok: true, pendingSeconds: addSec, keep: true };
    const page = createSession(ctx, b, date, addSec, addLoops);
    return { ok: true, sessionId: page.id, minutes: addSec / 60 };
  });
}

// 녹음: 그날 연습 기록 페이지 본문에 설명 한 줄 + 오디오 블록, 녹음 속성에도 같은 파일 추가
const AUDIO = { 'audio/mp4': 'm4a', 'audio/webm': 'weba', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/aac': 'aac' };

function record(ctx, b) {
  if (!b.songId || !validId(b.videoId)) throw new Error('곡 정보가 없어요');
  if (!b.data) throw new Error('녹음 데이터가 없어요');
  const mime = String(b.mime || '').split(';')[0].trim().toLowerCase();
  if (!AUDIO[mime]) throw new Error('지원하지 않는 녹음 형식: ' + (b.mime || '없음'));
  const bytes = Utilities.base64Decode(b.data);
  if (!bytes.length) throw new Error('녹음 데이터가 비어 있어요');

  const date = dayOf(b.date);
  const time = /^\d{2}:\d{2}$/.test(b.time || '') ? b.time : Utilities.formatDate(new Date(), TIME_ZONE, 'HH:mm');
  const safeTitle = String(b.title || '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60);
  const name = (date + ' ' + time.replace(':', '') + ' ' + safeTitle).trim() + '.' + AUDIO[mime];
  const fileId = ctx.upload(bytes, mime, name);

  const caption = ['🎙 ' + time];
  const segment = segmentOf(b);
  if (segment) caption.push(segment);
  if (b.rate) caption.push(b.rate + '×');
  if (b.seconds) caption.push(mmss(b.seconds));

  return withLock(() => {
    const session = findSession(ctx, b.songId, date) || createSession(ctx, b, date, 0, 0);
    ctx.notion('/blocks/' + session.id + '/children', 'PATCH', {
      children: [
        { type: 'paragraph', paragraph: { rich_text: txt(caption.join(' · ')) } },
        { type: 'audio', audio: { type: 'file_upload', file_upload: { id: fileId } } },
      ],
    });
    // 파일 속성은 통째로 바뀌므로 기존 파일을 다시 넣어서 보냄. 실패해도 본문 녹음은 남음
    let warning = null;
    try {
      const page = ctx.notion('/pages/' + session.id);
      const cur = (page.properties[S.recording] && page.properties[S.recording].files) || [];
      const files = cur.map((f) => (f.type === 'external'
        ? { name: f.name, type: 'external', external: { url: f.external.url } }
        : { name: f.name, type: 'file', file: { url: f.file.url } }));
      files.push({ name, type: 'file_upload', file_upload: { id: fileId } });
      const upd = {};
      upd[S.recording] = { files };
      ctx.notion('/pages/' + session.id, 'PATCH', { properties: upd });
    } catch (err) {
      warning = '녹음 속성에는 못 넣었어요 (' + err.message + ')';
    }
    return { ok: true, sessionId: session.id, url: session.url, name, warning };
  });
}

function mmss(s) {
  const m = Math.floor(s / 60);
  return m + ':' + String(Math.floor(s - m * 60)).padStart(2, '0');
}
