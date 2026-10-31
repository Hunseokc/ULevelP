// public/data.js 단위 테스트 (D1 ~ D9)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const configSrc = fs.readFileSync(path.join(ROOT, 'public', 'config.js'), 'utf8');
const dataSrc = fs.readFileSync(path.join(ROOT, 'public', 'data.js'), 'utf8');

function createMockEnv({
  session = { access_token: 'valid_token' },
  me = {
    id: 'user-1',
    email: 'user@example.com',
    displayName: '홍길동',
    migratedLocalAt: null,
  },
  apiResponse = { ok: true },
  apiHandler = null,
  fetchResponse = { ok: true, status: 200, json: async () => ({ ok: true, keep: true }) },
  confirmAnswers = [],
} = {}) {
  const map = new Map();
  const localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    key: (i) => Array.from(map.keys())[i] || null,
    get length() {
      return map.size;
    },
  };

  const apiCalls = [];
  let fetchMeCount = 0;
  const fetchCalls = [];
  const confirmCalls = [];
  const answers = [...confirmAnswers];

  const mockULAuth = {
    getSession: () => session,
    getMe: () => me,
    apiFetch: async (path, opts) => {
      apiCalls.push({ path, opts });
      if (typeof apiHandler === 'function') {
        return apiHandler(path, opts);
      }
      return apiResponse;
    },
    fetchMe: async () => {
      fetchMeCount++;
      return me;
    },
  };

  async function mockFetch(url, opts) {
    fetchCalls.push({ url, opts });
    if (typeof fetchResponse === 'function') {
      return fetchResponse(url, opts);
    }
    return fetchResponse;
  }

  function mockConfirm(msg) {
    confirmCalls.push(msg);
    return answers.length > 0 ? answers.shift() : true;
  }

  const sandbox = {
    window: null,
    self: null,
    top: null,
    localStorage,
    fetch: mockFetch,
    confirm: mockConfirm,
    ULAuth: mockULAuth,
    FormData,
    Blob,
    URLSearchParams,
    ULEVELP_CONFIG: { apiBaseUrl: '' },
    console,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.top = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(configSrc, sandbox);
  sandbox.ULEVELP_CONFIG.apiBaseUrl = '';
  vm.runInContext(dataSrc, sandbox);

  return {
    ULData: sandbox.ULData,
    localStorage,
    storageMap: map,
    apiCalls,
    fetchCalls,
    confirmCalls,
    get fetchMeCount() {
      return fetchMeCount;
    },
    setMe(newMe) {
      me = newMe;
    },
    setSession(newSession) {
      session = newSession;
    },
    setFetchResponse(res) {
      fetchResponse = res;
    },
    setApiHandler(fn) {
      apiHandler = fn;
    },
    setApiResponse(res) {
      apiResponse = res;
    },
  };
}

test('D1 비로그인: isLoggedIn()은 false, 다른 함수는 401 NOT_LOGGED_IN 거부, 서버 호출 0', async () => {
  const env = createMockEnv({ session: null });
  const { ULData, apiCalls, fetchCalls } = env;

  assert.equal(ULData.isLoggedIn(), false);

  await assert.rejects(
    () => ULData.songs.list(),
    (err) => {
      assert.equal(err.code, 'NOT_LOGGED_IN');
      assert.equal(err.status, 401);
      return true;
    }
  );

  await assert.rejects(
    () => ULData.songs.create({ videoId: 'dummy' }),
    (err) => {
      assert.equal(err.code, 'NOT_LOGGED_IN');
      assert.equal(err.status, 401);
      return true;
    }
  );

  await assert.rejects(
    () => ULData.saveProgress({ songId: 's', date: '2026-10-30' }),
    (err) => {
      assert.equal(err.code, 'NOT_LOGGED_IN');
      assert.equal(err.status, 401);
      return true;
    }
  );

  await assert.rejects(
    () => ULData.saveProgress({ songId: 's', date: '2026-10-30' }, { keepalive: true }),
    (err) => {
      assert.equal(err.code, 'NOT_LOGGED_IN');
      assert.equal(err.status, 401);
      return true;
    }
  );

  const dummyBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
  await assert.rejects(
    () => ULData.takes.upload({ songId: 's', date: '2026-10-30' }, dummyBlob),
    (err) => {
      assert.equal(err.code, 'NOT_LOGGED_IN');
      assert.equal(err.status, 401);
      return true;
    }
  );

  assert.equal(apiCalls.length, 0);
  assert.equal(fetchCalls.length, 0);
});

test('D2 keepalive는 즉시 fetch: await 전 fetch 호출 1번, keepalive true, Bearer 헤더, 8개 키 JSON', async () => {
  const env = createMockEnv({
    session: { access_token: 'tok' },
    fetchResponse: {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, keep: true }),
    },
  });

  const p = env.ULData.saveProgress(
    {
      songId: 's',
      pos: 1,
      a: null,
      b: null,
      rate: 1,
      date: '2026-10-30',
      addSeconds: 30,
      addLoops: 0,
      title: 'x',
      resumeUrl: 'y',
    },
    { keepalive: true }
  );

  assert.equal(env.fetchCalls.length, 1);
  const call = env.fetchCalls[0];
  assert.equal(call.url, '/api/v1/practice/save');
  assert.equal(call.opts.keepalive, true);
  assert.equal(call.opts.headers.Authorization, 'Bearer tok');

  const parsedBody = JSON.parse(call.opts.body);
  const keys = Object.keys(parsedBody).sort();
  assert.deepEqual(keys, ['a', 'addLoops', 'addSeconds', 'b', 'date', 'pos', 'rate', 'songId']);
  assert.equal(parsedBody.title, undefined);
  assert.equal(parsedBody.resumeUrl, undefined);

  const result = await p;
  assert.deepEqual(result, { ok: true, keep: true });
});

test('D3 keepalive 오류: fetch 실패 시 404 NOT_FOUND 에러 객체 reject', async () => {
  const env = createMockEnv({
    session: { access_token: 'tok' },
    fetchResponse: {
      ok: false,
      status: 404,
      json: async () => ({ code: 'NOT_FOUND', message: '곡을 찾을 수 없습니다.' }),
    },
  });

  await assert.rejects(
    async () => env.ULData.saveProgress({ songId: 's', date: '2026-10-30' }, { keepalive: true }),
    (err) => {
      assert.equal(err.status, 404);
      assert.equal(err.code, 'NOT_FOUND');
      assert.equal(err.message, '곡을 찾을 수 없습니다.');
      return true;
    }
  );
});

test('D4 일반 저장은 apiFetch: opts 없으면 apiFetch 호출, fetch 직접 호출 0', async () => {
  const env = createMockEnv({
    session: { access_token: 'tok' },
    apiResponse: { ok: true, keep: false, totalSeconds: 60 },
  });

  const result = await env.ULData.saveProgress({
    songId: 's',
    pos: 10,
    a: 5,
    b: 20,
    rate: 1,
    date: '2026-10-30',
    addSeconds: 15,
    addLoops: 2,
    extraField: 'ignore',
  });

  assert.deepEqual(result, { ok: true, keep: false, totalSeconds: 60 });
  assert.equal(env.fetchCalls.length, 0);
  assert.equal(env.apiCalls.length, 1);
  assert.equal(env.apiCalls[0].path, '/api/v1/practice/save');
  assert.equal(env.apiCalls[0].opts.method, 'POST');

  const parsed = JSON.parse(env.apiCalls[0].opts.body);
  const keys = Object.keys(parsed).sort();
  assert.deepEqual(keys, ['a', 'addLoops', 'addSeconds', 'b', 'date', 'pos', 'rate', 'songId']);
  assert.equal(parsed.extraField, undefined);
});

test('D5 녹음 업로드 FormData: FormData에 8개 키 metadata와 file이 포함되어 전송됨', async () => {
  const env = createMockEnv({
    session: { access_token: 'tok' },
    apiResponse: { ok: true, take: { id: 't1' } },
  });

  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mp4' });
  const take = await env.ULData.takes.upload(
    {
      songId: 's',
      date: '2026-10-30',
      recordedAt: '2026-10-30T00:00:00.000Z',
      a: 1,
      b: 2,
      rate: 1,
      durationSec: 3,
      mime: 'audio/mp4',
      extra: 'x',
    },
    blob
  );

  assert.deepEqual(take, { id: 't1' });
  assert.equal(env.apiCalls.length, 1);
  assert.equal(env.apiCalls[0].path, '/api/v1/takes');
  assert.equal(env.apiCalls[0].opts.method, 'POST');

  const body = env.apiCalls[0].opts.body;
  assert.ok(body instanceof FormData);

  const metaBlob = body.get('metadata');
  assert.ok(metaBlob);
  const metaText = await metaBlob.text();
  const parsedMeta = JSON.parse(metaText);
  const keys = Object.keys(parsedMeta).sort();
  assert.deepEqual(keys, ['a', 'b', 'date', 'durationSec', 'mime', 'rate', 'recordedAt', 'songId']);
  assert.equal(parsedMeta.extra, undefined);

  const filePart = body.get('file');
  assert.ok(filePart);
  assert.equal(filePart.name, 'take.m4a');
  assert.equal(filePart.size, 3);
});

test('D6 이관: 두 출처·중복·불량 항목 정리 및 2곡 이관 완료, pp:v: 키 보존', async () => {
  const env = createMockEnv({
    session: { access_token: 'tok' },
    me: { id: 'user-1', migratedLocalAt: null },
    confirmAnswers: [true, true],
    apiResponse: { created: 2, skipped: 0, migratedLocalAt: '2026-10-30T10:00:00Z' },
  });

  env.localStorage.setItem('ulp:v:AAAAAAAAAAA', JSON.stringify({ pos: 1, date: '2026-10-01' }));
  env.localStorage.setItem('ulp:v:bad', '{}');
  env.localStorage.setItem('pp:v:BBBBBBBBBBB', JSON.stringify({ pos: 2 }));
  env.localStorage.setItem('pp:v:AAAAAAAAAAA', JSON.stringify({ pos: 9 }));
  env.localStorage.setItem('ulp:v:CCCCCCCCCCC', 'not json');

  const res = await env.ULData.runLocalMigration();

  assert.equal(env.confirmCalls.length, 2);
  assert.match(env.confirmCalls[0], /1곡/);
  assert.match(env.confirmCalls[1], /1곡/);

  assert.equal(env.apiCalls.length, 1);
  assert.equal(env.apiCalls[0].path, '/api/v1/songs/migrate-local');

  const req = JSON.parse(env.apiCalls[0].opts.body);
  assert.equal(req.markMigrated, true);
  assert.equal(req.items.length, 2);
  assert.equal(req.items[0].videoId, 'AAAAAAAAAAA');
  assert.equal(req.items[0].pos, 1);
  assert.equal(req.items[1].videoId, 'BBBBBBBBBBB');
  assert.equal(req.items[1].pos, 2);

  assert.equal(env.fetchMeCount, 1);
  assert.deepEqual({ ...res }, { status: 'done', created: 2, skipped: 0, message: '' });

  assert.ok(env.localStorage.getItem('pp:v:BBBBBBBBBBB') !== null);
  assert.ok(env.localStorage.getItem('pp:v:AAAAAAAAAAA') !== null);
});

test('D7 이관: 둘 다 거절해도 markMigrated 전송 및 status done 반환', async () => {
  const env = createMockEnv({
    session: { access_token: 'tok' },
    me: { id: 'user-1', migratedLocalAt: null },
    confirmAnswers: [false, false],
    apiResponse: { created: 0, skipped: 0, migratedLocalAt: '2026-10-30T10:00:00Z' },
  });

  env.localStorage.setItem('ulp:v:AAAAAAAAAAA', JSON.stringify({ pos: 1, date: '2026-10-01' }));
  env.localStorage.setItem('pp:v:BBBBBBBBBBB', JSON.stringify({ pos: 2 }));

  const res = await env.ULData.runLocalMigration();

  assert.equal(env.confirmCalls.length, 2);
  assert.equal(env.apiCalls.length, 1);

  const req = JSON.parse(env.apiCalls[0].opts.body);
  assert.equal(req.markMigrated, true);
  assert.deepEqual(req.items, []);
  assert.deepEqual({ ...res }, { status: 'done', created: 0, skipped: 0, message: '' });
});

test('D8 이관 건너뜀: 이미 이관됨 / 로컬 기록 없음 / 비로그인 시 skipped 반환, 호출 0', async () => {
  // ① me.migratedLocalAt 존재
  const env1 = createMockEnv({
    session: { access_token: 'tok' },
    me: { id: 'user-1', migratedLocalAt: '2026-10-30T00:00:00Z' },
  });
  env1.localStorage.setItem('ulp:v:AAAAAAAAAAA', JSON.stringify({ pos: 1 }));
  const res1 = await env1.ULData.runLocalMigration();
  assert.deepEqual({ ...res1 }, { status: 'skipped', created: 0, skipped: 0, message: '' });
  assert.equal(env1.confirmCalls.length, 0);
  assert.equal(env1.apiCalls.length, 0);

  // ② migratedLocalAt null이지만 로컬 키 없음
  const env2 = createMockEnv({
    session: { access_token: 'tok' },
    me: { id: 'user-1', migratedLocalAt: null },
  });
  const res2 = await env2.ULData.runLocalMigration();
  assert.deepEqual({ ...res2 }, { status: 'skipped', created: 0, skipped: 0, message: '' });
  assert.equal(env2.confirmCalls.length, 0);
  assert.equal(env2.apiCalls.length, 0);

  // ③ 비로그인
  const env3 = createMockEnv({ session: null });
  env3.localStorage.setItem('ulp:v:AAAAAAAAAAA', JSON.stringify({ pos: 1 }));
  const res3 = await env3.ULData.runLocalMigration();
  assert.deepEqual({ ...res3 }, { status: 'skipped', created: 0, skipped: 0, message: '' });
  assert.equal(env3.confirmCalls.length, 0);
  assert.equal(env3.apiCalls.length, 0);
});

test('D9 이관 실패: 서버 에러 시 failed 반환, fetchMe 미호출, 재호출 시 confirm 다시 실행', async () => {
  const env = createMockEnv({
    session: { access_token: 'tok' },
    me: { id: 'user-1', migratedLocalAt: null },
    confirmAnswers: [true, true, true, true],
    apiHandler: async () => {
      throw new Error('서버 오류');
    },
  });

  env.localStorage.setItem('ulp:v:AAAAAAAAAAA', JSON.stringify({ pos: 1, date: '2026-10-01' }));

  const res1 = await env.ULData.runLocalMigration();
  assert.deepEqual({ ...res1 }, { status: 'failed', created: 0, skipped: 0, message: '서버 오류' });
  assert.equal(env.fetchMeCount, 0);
  assert.equal(env.confirmCalls.length, 1);

  // 바로 다시 호출하면 다시 confirm이 뜸 (migrating이 정상 해제됨)
  const res2 = await env.ULData.runLocalMigration();
  assert.equal(res2.status, 'failed');
  assert.equal(env.confirmCalls.length, 2);
});

test('D10 비로그인 거부: sessions·takes 신규 함수 4종 모두 Promise reject 및 api 호출 0건', async () => {
  const env = createMockEnv({ session: null });
  const funcs = [
    () => env.ULData.sessions.list(),
    () => env.ULData.sessions.updateMemo('s1', 'm'),
    () => env.ULData.takes.getUrl('t1'),
    () => env.ULData.takes.remove('t1'),
  ];

  for (const fn of funcs) {
    await assert.rejects(
      () => fn(),
      (err) => {
        assert.equal(err.code, 'NOT_LOGGED_IN');
        assert.equal(err.status, 401);
        return true;
      }
    );
  }
  assert.equal(env.apiCalls.length, 0);
});

test('D11 sessions.list 쿼리 조합: 파라미터 유무에 따른 URLSearchParams 쿼리 생성', async () => {
  const env = createMockEnv({
    session: { access_token: 'tok' },
    apiResponse: { summary: { thisWeekSeconds: 0, thisMonthSeconds: 0 }, calendar: [], sessions: [] },
  });

  // ① 파라미터 없음
  await env.ULData.sessions.list();
  assert.equal(env.apiCalls.length, 1);
  assert.equal(env.apiCalls[0].path, '/api/v1/sessions');

  // ② from, to, today 파라미터 있음
  await env.ULData.sessions.list({ from: '2026-10-01', to: '2026-10-30', today: '2026-10-30' });
  assert.equal(env.apiCalls.length, 2);
  assert.equal(env.apiCalls[1].path, '/api/v1/sessions?from=2026-10-01&to=2026-10-30&today=2026-10-30');
});

test('D12 sessions.updateMemo: PATCH 메서드 및 본문 memo JSON 직렬화', async () => {
  const env = createMockEnv({
    session: { access_token: 'tok' },
    apiResponse: { ok: true },
  });

  await env.ULData.sessions.updateMemo('s-1', '메모');
  assert.equal(env.apiCalls.length, 1);
  assert.equal(env.apiCalls[0].path, '/api/v1/sessions/s-1');
  assert.equal(env.apiCalls[0].opts.method, 'PATCH');
  assert.deepEqual(JSON.parse(env.apiCalls[0].opts.body), { memo: '메모' });
});

test('D13 takes.getUrl & takes.remove: 서명 URL 발급 GET 및 녹음 삭제 DELETE', async () => {
  const env = createMockEnv({
    session: { access_token: 'tok' },
    apiResponse: { ok: true },
  });

  // ① getUrl -> GET /api/v1/takes/{id}/url
  await env.ULData.takes.getUrl('t-1');
  assert.equal(env.apiCalls.length, 1);
  assert.equal(env.apiCalls[0].path, '/api/v1/takes/t-1/url');

  // ② remove -> DELETE /api/v1/takes/{id}
  await env.ULData.takes.remove('t-1');
  assert.equal(env.apiCalls.length, 2);
  assert.equal(env.apiCalls[1].path, '/api/v1/takes/t-1');
  assert.equal(env.apiCalls[1].opts.method, 'DELETE');
});

test('D14 비로그인 거부: songs.get, songs.update, songs.remove는 401 reject 반환', async () => {
  const env = createMockEnv({ session: null });
  const funcs = [
    () => env.ULData.songs.get('id'),
    () => env.ULData.songs.update('id', { status: 'done' }),
    () => env.ULData.songs.remove('id'),
  ];
  for (const fn of funcs) {
    await assert.rejects(
      () => fn(),
      (err) => {
        assert.equal(err.code, 'NOT_LOGGED_IN');
        assert.equal(err.status, 401);
        return true;
      }
    );
  }
  assert.equal(env.apiCalls.length, 0);
});

test('D15 songs.get & songs.remove: 상세 조회 GET 및 곡 삭제 DELETE', async () => {
  const env = createMockEnv({
    session: { access_token: 'tok' },
    apiResponse: { song: { id: 'song-1' }, sessions: [], takes: [] },
  });

  // ① songs.get('song-1')
  const detail = await env.ULData.songs.get('song-1');
  assert.equal(env.apiCalls.length, 1);
  assert.equal(env.apiCalls[0].path, '/api/v1/songs/song-1');
  assert.deepEqual({ ...detail.song }, { id: 'song-1' });

  // ② songs.remove('song-1')
  const res = await env.ULData.songs.remove('song-1');
  assert.equal(env.apiCalls.length, 2);
  assert.equal(env.apiCalls[1].path, '/api/v1/songs/song-1');
  assert.equal(env.apiCalls[1].opts.method, 'DELETE');
  assert.deepEqual({ ...res }, { ok: true });
});

test('D16 songs.update 필드 정제: patch 객체에서 status, memo, title 키만 추출', async () => {
  const env = createMockEnv({
    session: { access_token: 'tok' },
    apiResponse: { song: { id: 'song-1', status: '보류', memo: 'm' } },
  });

  const updated = await env.ULData.songs.update('song-1', {
    status: '보류',
    memo: 'm',
    extra: 'x',
    title: undefined,
  });

  assert.equal(env.apiCalls.length, 1);
  assert.equal(env.apiCalls[0].path, '/api/v1/songs/song-1');
  assert.equal(env.apiCalls[0].opts.method, 'PATCH');
  const sentBody = JSON.parse(env.apiCalls[0].opts.body);
  assert.deepEqual(Object.keys(sentBody).sort(), ['memo', 'status']);
  assert.equal(sentBody.status, '보류');
  assert.equal(sentBody.memo, 'm');
  assert.deepEqual({ ...updated }, { id: 'song-1', status: '보류', memo: 'm' });
});
