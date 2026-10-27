// 연습 플레이어 ↔ 노션 중계 서버 (Cloudflare Worker)
// 노션 토큰은 여기(워커 비밀 변수)에만 두고, 플레이어는 비밀 키로만 접근합니다.
//
// 워커 변수 (Settings → Variables and Secrets)
//   NOTION_TOKEN   (비밀) 노션 통합 토큰
//   PRACTICE_KEY   (비밀) 플레이어 설정에 넣을 비밀 키. 아무 긴 문자열
//   ALLOWED_ORIGINS (선택) 쉼표로 구분. 기본값은 아래 DEFAULT_ORIGINS
//   SONGS_DB, SESSIONS_DB (선택) 노션 데이터베이스 ID. 기본값은 아래

const NOTION_VERSION = '2022-06-28';
const DEFAULT_SONGS_DB = '959cbe517e224419b48ca3313895a427';
const DEFAULT_SESSIONS_DB = '6260633380b34d28989af90ddfbb4e67';
const DEFAULT_ORIGINS = 'https://hunseokc.github.io,http://localhost:3000';

// 노션 속성 이름 (노션에서 이름을 바꾸면 여기도 같이)
const P = {
  title: '곡명', artist: '아티스트', status: '상태', resume: '이어서 연습', link: '유튜브 링크',
  pos: '마지막 위치(초)', a: '구간 시작(초)', b: '구간 끝(초)', rate: '속도', lastDate: '마지막 연습일',
};
const S = {
  title: '기록', song: '곡', date: '날짜', minutes: '연습 시간(분)', segment: '구간', rate: '속도', loops: '반복 횟수',
};

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map((s) => s.trim()).filter(Boolean);
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Practice-Key',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (!env.NOTION_TOKEN || !env.PRACTICE_KEY) return json({ error: '워커에 NOTION_TOKEN, PRACTICE_KEY 변수를 넣어주세요' }, 500);
    if (!safeEqual(req.headers.get('X-Practice-Key') || '', env.PRACTICE_KEY)) return json({ error: '비밀 키가 맞지 않아요' }, 401);

    const ctx = makeCtx(env);
    const url = new URL(req.url);
    try {
      const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
      switch (url.pathname) {
        case '/health': return json(await health(ctx));
        case '/songs': return json({ songs: await listSongs(ctx) });
        case '/song':
          if (req.method === 'GET') return json({ song: await findSong(ctx, url.searchParams.get('v')) });
          return json({ song: await createSong(ctx, body) });
        case '/save': return json(await save(ctx, body));
        default: return json({ error: '없는 경로' }, 404);
      }
    } catch (e) {
      return json({ error: e.message || String(e) }, e.status && e.status < 500 ? e.status : 502);
    }
  },
};

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function makeCtx(env) {
  const songsDb = env.SONGS_DB || DEFAULT_SONGS_DB;
  const sessionsDb = env.SESSIONS_DB || DEFAULT_SESSIONS_DB;
  async function notion(path, method = 'GET', body) {
    const res = await fetch('https://api.notion.com/v1' + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + env.NOTION_TOKEN,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(friendly(res.status, data));
      err.status = res.status === 401 || res.status === 404 ? 502 : res.status;
      throw err;
    }
    return data;
  }
  return { songsDb, sessionsDb, notion };
}

function friendly(status, data) {
  if (status === 401) return '노션 토큰이 올바르지 않아요 (워커 NOTION_TOKEN 확인)';
  if (status === 404) return '노션 데이터베이스를 못 찾았어요. 악기 연습 페이지에 통합을 연결했는지 확인하세요';
  if (status === 429) return '노션 요청이 많아요. 잠시 후 다시 저장됩니다';
  return '노션 오류: ' + (data.message || status);
}

// ---------- 변환 ----------
const txt = (s) => [{ type: 'text', text: { content: String(s ?? '').slice(0, 2000) } }];
const num = (v) => ({ number: v == null || !isFinite(v) ? null : Math.round(Number(v) * 100) / 100 });
const plain = (arr) => (arr || []).map((t) => t.plain_text).join('');

function videoIdFrom(u) {
  if (!u) return null;
  try {
    const url = new URL(u);
    if (/(^|\.)youtu\.be$/.test(url.hostname)) return url.pathname.slice(1, 12) || null;
    if (url.searchParams.get('v')) return url.searchParams.get('v').slice(0, 11);
    const m = url.pathname.match(/\/(shorts|embed|live)\/([\w-]{11})/);
    return m ? m[2] : null;
  } catch {
    return null;
  }
}
const validId = (v) => typeof v === 'string' && /^[\w-]{11}$/.test(v);

function readSong(page) {
  const p = page.properties || {};
  const n = (k) => (p[k] && typeof p[k].number === 'number' ? p[k].number : null);
  return {
    id: page.id,
    url: page.url,
    title: plain(p[P.title]?.title) || '(제목 없음)',
    artist: plain(p[P.artist]?.rich_text),
    status: p[P.status]?.select?.name || '',
    videoId: videoIdFrom(p[P.link]?.url) || videoIdFrom(p[P.resume]?.url),
    pos: n(P.pos), a: n(P.a), b: n(P.b), rate: n(P.rate),
    lastDate: p[P.lastDate]?.date?.start || null,
  };
}

// ---------- 동작 ----------
async function health({ notion, songsDb, sessionsDb }) {
  const songs = await notion(`/databases/${songsDb}`);
  const sessions = await notion(`/databases/${sessionsDb}`);
  const missing = [
    ...Object.values(P).filter((k) => !songs.properties?.[k]),
    ...Object.values(S).filter((k) => !sessions.properties?.[k]),
  ];
  if (missing.length) throw Object.assign(new Error('노션에 없는 속성: ' + missing.join(', ')), { status: 400 });
  return { ok: true, songsTitle: plain(songs.title), sessionsTitle: plain(sessions.title) };
}

async function listSongs({ notion, songsDb }) {
  const out = [];
  let cursor;
  do {
    const data = await notion(`/databases/${songsDb}/query`, 'POST', {
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    out.push(...data.results.map(readSong));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor && out.length < 300);
  // 연습 중 → 보류 → 완료, 같은 상태면 최근 연습 순
  const order = { '연습 중': 0, '': 1, '보류': 2, '완료': 3 };
  return out
    .filter((s) => s.videoId)
    .sort((x, y) => (order[x.status] ?? 1) - (order[y.status] ?? 1) || String(y.lastDate || '').localeCompare(String(x.lastDate || '')));
}

async function findSong({ notion, songsDb }, videoId) {
  if (!validId(videoId)) throw Object.assign(new Error('영상 ID가 올바르지 않아요'), { status: 400 });
  const data = await notion(`/databases/${songsDb}/query`, 'POST', {
    filter: { or: [{ property: P.link, url: { contains: videoId } }, { property: P.resume, url: { contains: videoId } }] },
    sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
    page_size: 10,
  });
  const hit = data.results.map(readSong).find((s) => s.videoId === videoId);
  return hit || null;
}

async function oembed(videoId) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + videoId)}`);
    if (!r.ok) return {};
    const d = await r.json();
    return { title: d.title, artist: d.author_name };
  } catch {
    return {};
  }
}

async function createSong(ctx, { videoId, title, artist, rate }) {
  if (!validId(videoId)) throw Object.assign(new Error('영상 ID가 올바르지 않아요'), { status: 400 });
  const existing = await findSong(ctx, videoId);
  if (existing) return existing;
  if (!title) {
    const o = await oembed(videoId);
    title = o.title;
    artist = artist || o.artist;
  }
  const link = 'https://www.youtube.com/watch?v=' + videoId;
  const page = await ctx.notion('/pages', 'POST', {
    parent: { database_id: ctx.songsDb },
    icon: { type: 'emoji', emoji: '🎵' },
    properties: {
      [P.title]: { title: txt(title || '새 곡') },
      [P.artist]: { rich_text: txt(artist || '') },
      [P.status]: { select: { name: '연습 중' } },
      [P.link]: { url: link },
      [P.rate]: num(rate ?? 1),
    },
  });
  return readSong(page);
}

async function save(ctx, b) {
  const { notion, sessionsDb } = ctx;
  if (!b.songId || !validId(b.videoId)) throw Object.assign(new Error('곡 정보가 없어요'), { status: 400 });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : new Date().toISOString().slice(0, 10);
  const resume = typeof b.resumeUrl === 'string' && /^https:\/\//.test(b.resumeUrl) ? b.resumeUrl : null;

  await notion(`/pages/${b.songId}`, 'PATCH', {
    properties: {
      [P.pos]: num(b.pos), [P.a]: num(b.a), [P.b]: num(b.b), [P.rate]: num(b.rate),
      [P.resume]: { url: resume },
      [P.lastDate]: { date: { start: date } },
    },
  });

  // 연습 기록: 곡별 하루 한 줄, 여러 기기에서 연습해도 시간과 반복 횟수가 더해짐
  const addSec = Math.max(0, Math.min(Number(b.addSeconds) || 0, 6 * 3600));
  const addLoops = Math.max(0, Math.min(Number(b.addLoops) || 0, 100000));
  if (!addSec && !addLoops) return { ok: true };

  const found = await notion(`/databases/${sessionsDb}/query`, 'POST', {
    filter: { and: [{ property: S.song, relation: { contains: b.songId } }, { property: S.date, date: { equals: date } }] },
    page_size: 1,
  });
  const segment = b.a != null && b.b != null ? `${mmss(b.a)}–${mmss(b.b)}` : '';
  const cur = found.results[0];
  if (cur) {
    const p = cur.properties;
    const mins = (p[S.minutes]?.number || 0) + addSec / 60;
    const loops = (p[S.loops]?.number || 0) + addLoops;
    await notion(`/pages/${cur.id}`, 'PATCH', {
      properties: {
        [S.minutes]: num(mins), [S.loops]: num(loops), [S.rate]: num(b.rate),
        ...(segment ? { [S.segment]: { rich_text: txt(segment) } } : {}),
      },
    });
    return { ok: true, sessionId: cur.id, minutes: mins };
  }
  // 1분 미만이면 아직 기록을 만들지 않음 (플레이어가 남은 시간을 다음 저장에 다시 보냄)
  if (addSec < 60) return { ok: true, pendingSeconds: addSec, keep: true };
  const page = await notion('/pages', 'POST', {
    parent: { database_id: sessionsDb },
    properties: {
      [S.title]: { title: txt(`${date} ${b.title || ''}`.trim()) },
      [S.song]: { relation: [{ id: b.songId }] },
      [S.date]: { date: { start: date } },
      [S.minutes]: num(addSec / 60), [S.loops]: num(addLoops), [S.rate]: num(b.rate),
      [S.segment]: { rich_text: txt(segment) },
    },
  });
  return { ok: true, sessionId: page.id, minutes: addSec / 60 };
}

function mmss(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s - m * 60)).padStart(2, '0')}`;
}
