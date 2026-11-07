// 데이터 상태 장치: 가짜 인증·API 응답을 한 곳에 둔다 (FT-1, 규격 개발산출물/프론트_정렬규격.md §7)
// spec 파일끼리 함수를 export하지 않는다 — 공용은 test/e2e/support/에만 둔다
'use strict';

const DEFAULT_ME = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'a@example.com',
  displayName: 'Tester',
  role: 'user',
  storageProvider: 'supabase',
  driveFolderId: null,
  takeUsedBytes: 0,
  takeQuotaBytes: 209715200,
  migratedLocalAt: '2026-10-30T00:00:00Z',
  keys: { notion: null, gemini: null },
  // 나중에 덧붙일 자리: tier·credits(M1-1), locale(L1-1) — 화면 spec은 opts.me로 덮어쓴다
};

const LONG_TITLE = 'Neo-Soul Practice Session With A Very Long Title That Should Never Break The Card Layout';

const FIXTURES = {
  /** 긴 제목 곡 n개 */
  longSongs(n = 5) {
    return Array.from({ length: n }, (_, i) => ({
      id: `00000000-0000-4000-8000-0000000001${String(i + 1).padStart(2, '0')}`,
      title: `${i + 1} · ${LONG_TITLE}`,
      artist: 'Artist',
      status: '연습 중',
      statusCode: 'practicing',
      videoId: `abcdefghij${(i + 1) % 10}`,
      pos: 30,
      a: 12,
      b: 48,
      rate: 0.75,
      lastDate: '2026-11-03',
      memo: '',
      totalSeconds: 600,
      resumeUrl: '',
    }));
  },
  note: {
    id: '00000000-0000-4000-8000-000000000201',
    videoId: 'abcdefghij1',
    url: 'https://www.youtube.com/watch?v=abcdefghij1',
    title: `노트 · ${LONG_TITLE}`,
    channel: 'Channel',
    tags: [],
    memo: '',
    headline: `한 줄 요약 · ${LONG_TITLE}`,
    points: [],
    keywords: [],
    model: 'gemini',
    createdAt: '2026-11-03T00:00:00Z',
    updatedAt: '2026-11-03T00:00:00Z',
  },
  sessions: { calendar: [{ date: '2026-11-03', totalSeconds: 600 }], sessions: [] },
};

/** 표준 상태(§7-1) → mockApp 옵션 */
const STATES = {
  guest: { auth: 'guest' },
  guestLocal: {
    auth: 'guest',
    local: {
      'ulp:v:jNQXAC9IVRw': JSON.stringify({ pos: 30, a: 12, b: 48, rate: 0.75, date: '2026-11-03' }),
      'ulp:notion-practice': 'https://www.notion.so/practice',
      'ulp:notion-notes': 'https://www.notion.so/notes',
    },
  },
  user: { auth: 'user', songs: [], notes: [], sessions: { calendar: [], sessions: [] } },
  userData: { auth: 'user', songs: FIXTURES.longSongs(5), notes: [FIXTURES.note], sessions: FIXTURES.sessions },
};

const YT_STUB =
  'window.YT = { Player: function() { return { loadVideoById: () => {}, playVideo: () => {}, pauseVideo: () => {}, getCurrentTime: () => 0, getDuration: () => 100, setPlaybackRate: () => {} }; } };';

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
}

function supabaseStub(sessionUser) {
  const session = sessionUser ? JSON.stringify({ access_token: 'fake-jwt-token', user: sessionUser }) : 'null';
  return `
    window.supabase = {
      createClient: function() {
        const fakeSession = ${session};
        return {
          auth: {
            getSession: async function() { return { data: { session: fakeSession }, error: null }; },
            onAuthStateChange: function(cb) {
              window.__supabaseAuthListener = cb;
              return { data: { subscription: { unsubscribe: function() {} } } };
            },
            signInWithOAuth: async function() { return { error: null }; },
            signOut: async function() { return { error: null }; }
          }
        };
      }
    };
  `;
}

/**
 * 가짜 인증·API 응답을 건다. 옵션으로 준 API만 응답하고, 나머지 /api/v1/*는 unknownApi로 처리한다.
 * @param {import('@playwright/test').Page} page
 * @param {object} [opts]
 * @param {'guest'|'user'} [opts.auth='user']
 * @param {object} [opts.me] DEFAULT_ME 위에 덮어쓴다(auth 'user'일 때만 응답)
 * @param {object} [opts.sessionUser] 가짜 Supabase 세션 사용자(기본: me의 id·email)
 * @param {Array} [opts.songs] @param {Array} [opts.notes] @param {object} [opts.sessions]
 * @param {object} [opts.songDetail] @param {object} [opts.takeUrl]
 * @param {Record<string,string>} [opts.local] localStorage 미리 넣기
 * @param {Array<[Function|RegExp|string, Function]>} [opts.routes] 화면 전용 추가 응답(가장 나중에 등록 → 먼저 매칭)
 * @param {'empty'|'pass'} [opts.unknownApi='empty'] 모르는 /api/v1/*: 'empty'면 {} 200, 'pass'면 실제 서버로
 */
async function mockApp(page, opts = {}) {
  const auth = opts.auth || 'user';
  const me = { ...DEFAULT_ME, ...(opts.me || {}) };

  if (opts.local) {
    await page.addInitScript((entries) => {
      for (const [k, v] of entries) localStorage.setItem(k, v);
    }, Object.entries(opts.local));
  }

  // HTML의 integrity 제거 (가짜 스텁의 SRI 불일치 방지)
  await page.route(
    (url) => url.pathname.endsWith('.html') || url.pathname === '/',
    async (route) => {
      const response = await route.fetch();
      const text = await response.text();
      const body = text.replace(/\sintegrity="[^"]*"/g, '');
      await route.fulfill({
        response,
        body,
        headers: { ...response.headers(), 'content-length': String(Buffer.byteLength(body)) },
      });
    }
  );

  const sessionUser =
    auth === 'user' ? opts.sessionUser || { id: me.id, email: me.email, user_metadata: {} } : null;
  await page.route(/https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@.*/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: supabaseStub(sessionUser) })
  );
  // 외부 요청 0: YouTube는 IFrame API 스텁, 썸네일은 빈 이미지
  await page.route(/https:\/\/(www\.)?youtube\.com\/.*/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: YT_STUB })
  );
  await page.route(/https:\/\/i\.ytimg\.com\/.*/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from([]) })
  );

  // 나중에 등록한 route가 먼저 매칭된다: 모르는 API부터
  if ((opts.unknownApi || 'empty') === 'empty') {
    await page.route((url) => url.pathname.startsWith('/api/v1/'), (route) => json(route, {}));
  }
  if (auth === 'user') {
    await page.route((url) => url.pathname.startsWith('/api/v1/me'), (route) => json(route, me));
  }
  if (opts.songs !== undefined) {
    const songs = opts.songs;
    await page.route((url) => url.pathname.startsWith('/api/v1/songs'), (route) => {
      const p = new URL(route.request().url()).pathname;
      if (p.includes('/by-video/')) return json(route, { song: songs[0] || null });
      if (p.includes('/migrate-local')) return json(route, { created: 0, skipped: 0, migratedLocalAt: me.migratedLocalAt });
      if (/\/api\/v1\/songs\/([a-f0-9-]+)$/.test(p)) {
        return json(route, opts.songDetail !== undefined ? opts.songDetail : { song: songs[0] || null, sessions: [], takes: [] });
      }
      if (route.request().method() === 'POST') return json(route, { song: songs[0], created: true }, 201);
      return json(route, { songs });
    });
  }
  if (opts.sessions !== undefined) {
    await page.route((url) => url.pathname.startsWith('/api/v1/sessions'), (route) => json(route, opts.sessions));
  }
  if (opts.takeUrl !== undefined) {
    await page.route((url) => url.pathname.startsWith('/api/v1/takes'), (route) => {
      if (new URL(route.request().url()).pathname.endsWith('/url')) return json(route, opts.takeUrl);
      return json(route, { ok: true });
    });
  }
  if (opts.notes !== undefined) {
    const notes = opts.notes;
    await page.route((url) => url.pathname.startsWith('/api/v1/notes'), (route) => {
      const p = new URL(route.request().url()).pathname;
      if (p === '/api/v1/notes') return json(route, { notes });
      if (p === '/api/v1/notes/jobs') return json(route, { jobs: [] });
      const id = decodeURIComponent(p.slice('/api/v1/notes/'.length));
      const note = notes.find((n) => n.id === id);
      return note ? json(route, { note }) : json(route, { error: 'NOTE_NOT_FOUND', message: '학습 노트를 찾을 수 없어요.' }, 404);
    });
  }
  for (const [match, handler] of opts.routes || []) {
    await page.route(match, handler);
  }
}

module.exports = { mockApp, STATES, FIXTURES, DEFAULT_ME, LONG_TITLE };
