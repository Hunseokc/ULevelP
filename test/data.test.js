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
const driveSrc = fs.readFileSync(path.join(ROOT, 'public', 'drive.js'), 'utf8');

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
  loadDrive = false,
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
  const authListeners = [];

  const mockULAuth = {
    getSession: () => session,
    getUser: () => (session ? (session.user || (me ? { id: me.id } : { id: 'user-1' })) : null),
    getMe: () => me,
    getAccessToken: async () => (session ? session.access_token : ''),
    onChange: (cb) => {
      authListeners.push(cb);
    },
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
  if (loadDrive) {
    vm.runInContext(driveSrc, sandbox);
  }

  return {
    sandbox,
    ULData: sandbox.ULData,
    localStorage,
    storageMap: map,
    apiCalls,
    fetchCalls,
    confirmCalls,
    triggerAuthChange(st) {
      authListeners.forEach((cb) => cb(st));
    },
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

test('D17 비로그인 거부: nx.exportZip, nx.previewNotionZip, nx.confirmNotionZip은 401 reject 반환', async () => {
  const env = createMockEnv({ session: null });
  const blob = new Blob(['dummy'], { type: 'application/zip' });
  const funcs = [
    () => env.ULData.nx.exportZip(),
    () => env.ULData.nx.previewNotionZip(blob),
    () => env.ULData.nx.confirmNotionZip('f1000000-0000-4000-8000-000000000001'),
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
  assert.equal(env.fetchCalls.length, 0);
  assert.equal(env.apiCalls.length, 0);
});

test('D18 nx.exportZip: includeAudio 플래그 및 헤더 전송 확인', async () => {
  const dummyBlob = new Blob(['zipdata'], { type: 'application/zip' });
  const env = createMockEnv({
    session: { access_token: 'tok' },
    fetchResponse: {
      ok: true,
      status: 200,
      headers: {
        get: (h) => (h.toLowerCase() === 'content-disposition' ? 'attachment; filename="ULeveLP-export-20261101.zip"' : null),
      },
      blob: async () => dummyBlob,
    },
  });

  const res = await env.ULData.nx.exportZip(false);
  assert.equal(env.fetchCalls.length, 1);
  assert.equal(env.fetchCalls[0].url, '/api/v1/export/zip?includeAudio=false');
  assert.equal(env.fetchCalls[0].opts.headers.Authorization, 'Bearer tok');
  assert.equal(res.filename, 'ULeveLP-export-20261101.zip');
  assert.equal(res.blob, dummyBlob);
});

test('D19 nx.previewNotionZip & confirmNotionZip: FormData 전송 및 confirm 요청 검증', async () => {
  const env = createMockEnv({
    session: { access_token: 'tok' },
    apiHandler: (p, opts) => {
      if (p === '/api/v1/import/notion/preview') {
        return { ok: true, previewToken: 'f1000000-0000-4000-8000-000000000001', newSongs: 1 };
      }
      if (p === '/api/v1/import/notion/confirm') {
        return { ok: true, createdSongs: 1 };
      }
      return { ok: true };
    },
  });

  // ① preview
  const dummyZip = new Blob(['pk0304'], { type: 'application/zip' });
  const previewRes = await env.ULData.nx.previewNotionZip(dummyZip);
  assert.equal(previewRes.previewToken, 'f1000000-0000-4000-8000-000000000001');
  assert.equal(env.apiCalls.length, 1);
  assert.equal(env.apiCalls[0].path, '/api/v1/import/notion/preview');
  assert.equal(env.apiCalls[0].opts.method, 'POST');
  assert.ok(env.apiCalls[0].opts.body instanceof FormData);
  assert.ok(env.apiCalls[0].opts.body.get('file'));

  // ② confirm
  const confirmRes = await env.ULData.nx.confirmNotionZip('f1000000-0000-4000-8000-000000000001');
  assert.equal(confirmRes.createdSongs, 1);
  assert.equal(env.apiCalls.length, 2);
  assert.equal(env.apiCalls[1].path, '/api/v1/import/notion/confirm');
  assert.equal(env.apiCalls[1].opts.method, 'POST');
  const body = JSON.parse(env.apiCalls[1].opts.body);
  assert.deepEqual(body, { previewToken: 'f1000000-0000-4000-8000-000000000001' });
});

test('D20 비로그인 거부: integrations API 5종은 401 reject 반환', async () => {
  const env = createMockEnv({ session: null });
  const funcs = [
    () => env.ULData.integrations.list(),
    () => env.ULData.integrations.saveNotion({}),
    () => env.ULData.integrations.saveGemini({}),
    () => env.ULData.integrations.check('notion'),
    () => env.ULData.integrations.remove('notion'),
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

test('D21 saveNotion & saveGemini 시 fetchMe 자동 호출', async () => {
  const env = createMockEnv({
    session: { access_token: 'valid_token' },
    apiHandler: (path, opts) => {
      if (path === '/api/v1/integrations/notion') {
        return { provider: 'notion', hint: '9a8b', config: {}, updatedAt: '2026-11-01T00:00:00Z' };
      }
      if (path === '/api/v1/integrations/gemini') {
        return { provider: 'gemini', hint: 'X9zQ', config: {}, updatedAt: '2026-11-01T00:00:00Z' };
      }
      return { ok: true };
    },
  });

  const r1 = await env.ULData.integrations.saveNotion({ token: 't', songsDb: 'a', sessionsDb: 'b' });
  assert.equal(r1.provider, 'notion');
  assert.equal(env.apiCalls.length, 1);
  assert.equal(env.apiCalls[0].path, '/api/v1/integrations/notion');
  assert.equal(env.apiCalls[0].opts.method, 'PUT');
  const b1 = JSON.parse(env.apiCalls[0].opts.body);
  assert.equal(b1.appId, 'ulevelp');
  assert.equal(b1.token, 't');
  assert.equal(env.fetchMeCount, 1);

  const r2 = await env.ULData.integrations.saveGemini({ apiKey: 'k', model: 'gemini-flash-latest' });
  assert.equal(r2.provider, 'gemini');
  assert.equal(env.apiCalls.length, 2);
  assert.equal(env.apiCalls[1].path, '/api/v1/integrations/gemini');
  assert.equal(env.apiCalls[1].opts.method, 'PUT');
  const b2 = JSON.parse(env.apiCalls[1].opts.body);
  assert.equal(b2.appId, 'ulevelp');
  assert.equal(b2.apiKey, 'k');
  assert.equal(env.fetchMeCount, 2);
});

test('D22 integrations.check & remove 호출 및 fetchMe 갱신', async () => {
  const env = createMockEnv({
    session: { access_token: 'valid_token' },
    apiHandler: (path, opts) => {
      if (path === '/api/v1/integrations/notion/check?appId=ulevelp') {
        return { ok: true, provider: 'notion', songsTitle: '곡', sessionsTitle: '기록' };
      }
      if (path === '/api/v1/integrations/notion?appId=ulevelp') {
        return { ok: true };
      }
      return { ok: true };
    },
  });

  const chk = await env.ULData.integrations.check('notion');
  assert.equal(chk.provider, 'notion');
  assert.equal(env.apiCalls.length, 1);
  assert.equal(env.apiCalls[0].path, '/api/v1/integrations/notion/check?appId=ulevelp');
  assert.equal(env.apiCalls[0].opts.method, 'POST');
  assert.equal(env.fetchMeCount, 0);

  const del = await env.ULData.integrations.remove('notion');
  assert.equal(del.ok, true);
  assert.equal(env.apiCalls.length, 2);
  assert.equal(env.apiCalls[1].path, '/api/v1/integrations/notion?appId=ulevelp');
  assert.equal(env.apiCalls[1].opts.method, 'DELETE');
  assert.equal(env.fetchMeCount, 1);
});

test('D23 getCachedKeys() uid 일치 검증', async () => {
  const env = createMockEnv({
    session: { access_token: 'valid_token', user: { id: 'user-1' } },
    me: { id: 'user-1' },
  });

  env.localStorage.setItem(
    'ulp:keys',
    JSON.stringify({
      uid: 'user-1',
      notion: { hint: '9a8b', updatedAt: '2026-11-01T00:00:00Z' },
      gemini: { hint: 'X9zQ', updatedAt: '2026-11-01T00:00:00Z' },
    })
  );

  // ① 현재 세션 user가 'user-1'일 때 getCachedKeys()
  const cached1 = env.ULData.getCachedKeys();
  assert.deepEqual({ ...cached1.notion }, { hint: '9a8b', updatedAt: '2026-11-01T00:00:00Z' });
  assert.deepEqual({ ...cached1.gemini }, { hint: 'X9zQ', updatedAt: '2026-11-01T00:00:00Z' });

  // ② 현재 세션 user가 'user-2'이거나 비로그인일 때 getCachedKeys()
  env.setSession({ access_token: 'valid_token_2', user: { id: 'user-2' } });
  env.setMe({ id: 'user-2' });
  const cached2 = env.ULData.getCachedKeys();
  assert.deepEqual({ ...cached2 }, { notion: null, gemini: null });

  env.setSession(null);
  env.setMe(null);
  const cached3 = env.ULData.getCachedKeys();
  assert.deepEqual({ ...cached3 }, { notion: null, gemini: null });
});

test('D24 비로그인 거부', async () => {
  const env = createMockEnv({ session: null });
  const fns = [
    () => env.ULData.notionSync.status(),
    () => env.ULData.notionSync.enable(),
    () => env.ULData.notionSync.disable(),
    () => env.ULData.notionSync.pull(),
    () => env.ULData.notionSync.push(),
  ];
  for (const fn of fns) {
    await assert.rejects(fn(), (err) => {
      assert.equal(err.code, 'NOT_LOGGED_IN');
      assert.equal(err.status, 401);
      return true;
    });
  }
});

test('D25 notionSync status·enable·disable', async () => {
  const env = createMockEnv({
    session: { access_token: 'valid_token' },
    apiHandler: (path, opts) => {
      if (path === '/api/v1/notion/sync/status') {
        return { enabled: true, pending: 0, failed: 0 };
      }
      if (path === '/api/v1/notion/sync/enable') {
        return { ok: true, importedSongs: 1, importedSessions: 1, importedTakes: 1, skippedTakesByQuota: 0 };
      }
      if (path === '/api/v1/notion/sync/disable') {
        return { ok: true };
      }
      return { ok: true };
    },
  });

  const st = await env.ULData.notionSync.status();
  assert.equal(st.enabled, true);
  assert.equal(env.apiCalls.length, 1);
  assert.equal(env.apiCalls[0].path, '/api/v1/notion/sync/status');
  assert.equal(env.apiCalls[0].opts, undefined);

  const en = await env.ULData.notionSync.enable();
  assert.equal(en.ok, true);
  assert.equal(en.importedSongs, 1);
  assert.equal(env.apiCalls.length, 2);
  assert.equal(env.apiCalls[1].path, '/api/v1/notion/sync/enable');
  assert.equal(env.apiCalls[1].opts.method, 'POST');

  const dis = await env.ULData.notionSync.disable();
  assert.equal(dis.ok, true);
  assert.equal(env.apiCalls.length, 3);
  assert.equal(env.apiCalls[2].path, '/api/v1/notion/sync/disable');
  assert.equal(env.apiCalls[2].opts.method, 'POST');
});

test('D26 notionSync pull·push', async () => {
  const env = createMockEnv({
    session: { access_token: 'valid_token' },
    apiHandler: (path, opts) => {
      if (path === '/api/v1/notion/sync/pull') {
        return { ok: true, updatedSongs: 1, updatedSessions: 1, lastPullAt: '2026-11-01T00:00:00Z' };
      }
      if (path === '/api/v1/notion/sync/push') {
        return { ok: true, processed: 1, failed: 0 };
      }
      return { ok: true };
    },
  });

  const pl = await env.ULData.notionSync.pull();
  assert.equal(pl.ok, true);
  assert.equal(pl.updatedSongs, 1);
  assert.equal(env.apiCalls.length, 1);
  assert.equal(env.apiCalls[0].path, '/api/v1/notion/sync/pull');
  assert.equal(env.apiCalls[0].opts.method, 'POST');

  const ps = await env.ULData.notionSync.push();
  assert.equal(ps.ok, true);
  assert.equal(ps.processed, 1);
  assert.equal(env.apiCalls.length, 2);
  assert.equal(env.apiCalls[1].path, '/api/v1/notion/sync/push');
  assert.equal(env.apiCalls[1].opts.method, 'POST');
});

test('D27 notes 비로그인 거부', async () => {
  const env = createMockEnv({ session: null });
  const fns = [
    () => env.ULData.notes.analyze({ url: 'https://youtube.com/watch?v=dQw4w9WgXcQ', tags: ['화성'] }),
    () => env.ULData.notes.listJobs(),
    () => env.ULData.notes.getJob('a1000000-0000-4000-8000-000000000001'),
    () => env.ULData.notes.list(),
    () => env.ULData.notes.get('b1000000-0000-4000-8000-000000000001'),
    () => env.ULData.notes.update('b1000000-0000-4000-8000-000000000001', { memo: 'm' }),
    () => env.ULData.notes.remove('b1000000-0000-4000-8000-000000000001'),
  ];
  for (const fn of fns) {
    await assert.rejects(fn(), (err) => {
      assert.equal(err.code, 'NOT_LOGGED_IN');
      assert.equal(err.status, 401);
      return true;
    });
  }
});

test('D28 notes.analyze & jobs 조회', async () => {
  const env = createMockEnv({
    session: { access_token: 'valid_token' },
    apiHandler: (path, opts) => {
      if (path === '/api/v1/notes/analyze') {
        return { jobId: 'job-1', status: 'queued' };
      }
      if (path === '/api/v1/notes/jobs') {
        return { jobs: [{ id: 'job-1', status: 'queued' }] };
      }
      if (path === '/api/v1/notes/jobs/a1000000-0000-4000-8000-000000000001') {
        return { id: 'a1000000-0000-4000-8000-000000000001', status: 'done', noteId: 'note-1' };
      }
      return { ok: true };
    },
  });

  const an = await env.ULData.notes.analyze({
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    tags: ['화성'],
    memo: 'm',
  });
  assert.equal(an.jobId, 'job-1');
  assert.equal(an.status, 'queued');
  assert.equal(env.apiCalls.length, 1);
  assert.equal(env.apiCalls[0].path, '/api/v1/notes/analyze');
  assert.equal(env.apiCalls[0].opts.method, 'POST');
  const anBody = JSON.parse(env.apiCalls[0].opts.body);
  assert.equal(anBody.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.deepEqual(anBody.tags, ['화성']);
  assert.equal(anBody.memo, 'm');

  const jobs = await env.ULData.notes.listJobs();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, 'job-1');
  assert.equal(env.apiCalls.length, 2);
  assert.equal(env.apiCalls[1].path, '/api/v1/notes/jobs');

  const j = await env.ULData.notes.getJob('a1000000-0000-4000-8000-000000000001');
  assert.equal(j.id, 'a1000000-0000-4000-8000-000000000001');
  assert.equal(j.status, 'done');
  assert.equal(env.apiCalls.length, 3);
  assert.equal(env.apiCalls[2].path, '/api/v1/notes/jobs/a1000000-0000-4000-8000-000000000001');
});

test('D29 notes.list·get·update·remove', async () => {
  const env = createMockEnv({
    session: { access_token: 'valid_token' },
    apiHandler: (path, opts) => {
      if (path === '/api/v1/notes?tag=%ED%99%94%EC%84%B1') {
        return { notes: [{ id: 'b1000000-0000-4000-8000-000000000001', title: '화성 노트' }] };
      }
      if (path === '/api/v1/notes/b1000000-0000-4000-8000-000000000001' && (!opts || !opts.method)) {
        return { note: { id: 'b1000000-0000-4000-8000-000000000001', title: '화성 노트', memo: '기존' } };
      }
      if (path === '/api/v1/notes/b1000000-0000-4000-8000-000000000001' && opts && opts.method === 'PATCH') {
        return { note: { id: 'b1000000-0000-4000-8000-000000000001', memo: 'x', tags: ['화성', 'TAB'] } };
      }
      if (path === '/api/v1/notes/b1000000-0000-4000-8000-000000000001' && opts && opts.method === 'DELETE') {
        return { ok: true };
      }
      return { ok: true };
    },
  });

  const list = await env.ULData.notes.list('화성');
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'b1000000-0000-4000-8000-000000000001');
  assert.equal(env.apiCalls[0].path, '/api/v1/notes?tag=%ED%99%94%EC%84%B1');

  const note = await env.ULData.notes.get('b1000000-0000-4000-8000-000000000001');
  assert.equal(note.title, '화성 노트');
  assert.equal(env.apiCalls[1].path, '/api/v1/notes/b1000000-0000-4000-8000-000000000001');

  const updated = await env.ULData.notes.update('b1000000-0000-4000-8000-000000000001', {
    memo: 'x',
    tags: ['화성', 'TAB'],
  });
  assert.equal(updated.memo, 'x');
  assert.deepEqual(updated.tags, ['화성', 'TAB']);
  assert.equal(env.apiCalls[2].path, '/api/v1/notes/b1000000-0000-4000-8000-000000000001');
  assert.equal(env.apiCalls[2].opts.method, 'PATCH');

  const del = await env.ULData.notes.remove('b1000000-0000-4000-8000-000000000001');
  assert.equal(del.ok, true);
  assert.equal(env.apiCalls[3].path, '/api/v1/notes/b1000000-0000-4000-8000-000000000001');
  assert.equal(env.apiCalls[3].opts.method, 'DELETE');
});

test('D30 412 NO_KEY 및 비동기 잡 PROVIDER_KEY_INVALID: 실패 시 ulp:keys gemini 캐시 무효화 (FR-KEY-5)', async () => {
  const env = createMockEnv({
    session: { access_token: 'valid_token', user: { id: 'user-1' } },
    me: { id: 'user-1' },
    apiHandler: (path, opts) => {
      if (path === '/api/v1/notes/analyze') {
        const err = new Error('Gemini API 키가 등록되지 않았습니다.');
        err.status = 412;
        err.code = 'NO_KEY';
        throw err;
      }
      if (path === '/api/v1/notes/jobs') {
        return {
          jobs: [
            {
              id: 'job-err',
              status: 'failed',
              error: 'PROVIDER_KEY_INVALID: API 키가 잘못되었습니다.',
            },
          ],
        };
      }
      return { ok: true };
    },
  });

  // 초기 캐시 저장
  env.localStorage.setItem(
    'ulp:keys',
    JSON.stringify({
      uid: 'user-1',
      notion: { hint: '9a8b' },
      gemini: { hint: '1234' },
    })
  );

  // 1. notes.analyze 412 NO_KEY 실패 시 gemini 캐시 무효화 확인
  await assert.rejects(
    env.ULData.notes.analyze({ url: 'https://youtube.com/watch?v=dQw4w9WgXcQ', tags: ['화성'] }),
    (err) => err.code === 'NO_KEY'
  );
  const cachedAfterAnalyze = env.ULData.getCachedKeys();
  assert.equal(cachedAfterAnalyze.gemini, null);
  assert.equal(cachedAfterAnalyze.notion.hint, '9a8b');

  // 2. gemini 캐시 복원 후 listJobs 호출 시 PROVIDER_KEY_INVALID 감지 확인
  env.localStorage.setItem(
    'ulp:keys',
    JSON.stringify({
      uid: 'user-1',
      notion: { hint: '9a8b' },
      gemini: { hint: '1234' },
    })
  );

  const jobs = await env.ULData.notes.listJobs();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, 'failed');

  const cachedAfterJobs = env.ULData.getCachedKeys();
  assert.equal(cachedAfterJobs.gemini, null);
  assert.equal(cachedAfterJobs.notion.hint, '9a8b');
});

test('D31 me.update 및 Drive 저장소 전환', async () => {
  const env = createMockEnv({
    session: { access_token: 'tok' },
    apiResponse: {
      user: {
        id: 'user-1',
        storageProvider: 'drive',
        driveFolderId: 'fld_12345',
      },
    },
  });

  const res = await env.ULData.me.update({
    storageProvider: 'drive',
    driveFolderId: 'fld_12345',
  });

  assert.equal(env.apiCalls.length, 1);
  assert.equal(env.apiCalls[0].path, '/api/v1/me');
  assert.equal(env.apiCalls[0].opts.method, 'PATCH');
  const body = JSON.parse(env.apiCalls[0].opts.body);
  assert.equal(body.storageProvider, 'drive');
  assert.equal(body.driveFolderId, 'fld_12345');
  assert.equal(env.fetchMeCount, 1);
  assert.equal(res.user.storageProvider, 'drive');
});

test("D32 takes.upload — storageProvider === 'drive'일 때 ULDrive.uploadTake 위임", async () => {
  const env = createMockEnv({
    session: { access_token: 'tok' },
    me: { id: 'user-1', storageProvider: 'drive' },
  });

  let delegatedMeta = null;
  let delegatedBlob = null;
  env.sandbox.window.ULDrive = {
    uploadTake: async (meta, blob) => {
      delegatedMeta = meta;
      delegatedBlob = blob;
      return { id: 'take-drive-1', storage: 'drive', storageKey: 'drv_file_1' };
    },
  };

  const meta = { songId: 'song-1', date: '2026-11-02' };
  const blob = new Blob(['audiodata'], { type: 'audio/mp4' });
  const result = await env.ULData.takes.upload(meta, blob);

  assert.equal(env.fetchCalls.length, 0);
  assert.equal(env.apiCalls.length, 0);
  assert.deepEqual(delegatedMeta, meta);
  assert.equal(delegatedBlob, blob);
  assert.equal(result.id, 'take-drive-1');
  assert.equal(result.storage, 'drive');
});

test('D33 takes.registerDrive & takes.migrateToDrive', async () => {
  const env = createMockEnv({
    session: { access_token: 'tok' },
    apiResponse: {
      ok: true,
      take: { id: 'take-1', storage: 'drive', storageKey: 'drv_12345' },
    },
  });

  // 1. registerDrive
  const meta = {
    songId: 'c1a2b3c4-0000-4000-8000-000000000001',
    date: '2026-11-02',
    recordedAt: '2026-11-02T10:00:00Z',
    durationSec: 10,
    mime: 'audio/mp4',
    sizeBytes: 1024,
    storageKey: 'drv_12345',
  };
  const regTake = await env.ULData.takes.registerDrive(meta);

  assert.equal(env.apiCalls.length, 1);
  assert.equal(env.apiCalls[0].path, '/api/v1/takes');
  assert.equal(env.apiCalls[0].opts.method, 'POST');
  assert.equal(env.apiCalls[0].opts.headers['Content-Type'], 'application/json');
  const regBody = JSON.parse(env.apiCalls[0].opts.body);
  assert.equal(regBody.storage, 'drive');
  assert.equal(regBody.storageKey, 'drv_12345');
  assert.equal(regTake.storage, 'drive');

  // 2. migrateToDrive
  const migTake = await env.ULData.takes.migrateToDrive('d1000000-0000-4000-8000-000000000001', 'drv_12345');
  assert.equal(env.apiCalls.length, 2);
  assert.equal(env.apiCalls[1].path, '/api/v1/takes/d1000000-0000-4000-8000-000000000001/migrate-drive');
  assert.equal(env.apiCalls[1].opts.method, 'POST');
  assert.equal(env.apiCalls[1].opts.headers['Content-Type'], 'application/json');
  const migBody = JSON.parse(env.apiCalls[1].opts.body);
  assert.equal(migBody.driveFileId, 'drv_12345');
  assert.equal(migTake.storage, 'drive');
});

test('D34 ULDrive.uploadBlob 5MB 이하 multipart / 5MB 초과 resumable 분기 및 ULEVELP_CONFIG.googleClientId 참조', async () => {
  const env = createMockEnv({
    session: { access_token: 'tok' },
    loadDrive: true,
  });

  // Google OAuth stub
  env.sandbox.window.google = {
    accounts: {
      oauth2: {
        initTokenClient: ({ callback }) => ({
          requestAccessToken: () => callback({ access_token: 'fake_drive_token', expires_in: '3600' }),
        }),
      },
    },
  };
  env.sandbox.window.ULEVELP_CONFIG = { googleClientId: 'fake-client-id.apps.googleusercontent.com' };

  // 1. 1KB Blob (<= 5MB: multipart)
  const smallBlob = new Blob([new Uint8Array(1024)], { type: 'audio/mp4' });
  env.setFetchResponse(async (url, opts) => {
    if (url.includes('uploadType=multipart')) {
      assert.equal(opts.method, 'POST');
      assert.equal(opts.headers.Authorization, 'Bearer fake_drive_token');
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'small_drive_id' }),
      };
    }
    throw new Error('Unexpected fetch url: ' + url);
  });

  const smallId = await env.sandbox.window.ULDrive.uploadBlob(smallBlob, 'small.m4a', 'audio/mp4', 'fld_1');
  assert.equal(smallId, 'small_drive_id');

  // 2. 6MB Blob (> 5MB: resumable)
  const largeBlob = new Blob([new Uint8Array(6 * 1024 * 1024)], { type: 'audio/mp4' });
  const resumeUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=sess_abc';
  let initCalled = false;
  let putCalled = false;

  env.setFetchResponse(async (url, opts) => {
    if (url === resumeUrl) {
      putCalled = true;
      assert.equal(opts.method, 'PUT');
      assert.equal(opts.headers['Content-Type'], 'audio/mp4');
      assert.equal(opts.headers['Content-Length'], String(largeBlob.size));
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'large_drive_id' }),
      };
    }
    if (url.includes('uploadType=resumable')) {
      initCalled = true;
      assert.equal(opts.method, 'POST');
      assert.equal(opts.headers['X-Upload-Content-Type'], 'audio/mp4');
      assert.equal(opts.headers['X-Upload-Content-Length'], String(largeBlob.size));
      return {
        ok: true,
        status: 200,
        headers: {
          get: (h) => (h.toLowerCase() === 'location' ? resumeUrl : null),
        },
      };
    }
    throw new Error('Unexpected fetch url: ' + url);
  });

  const largeId = await env.sandbox.window.ULDrive.uploadBlob(largeBlob, 'large.m4a', 'audio/mp4', 'fld_1');
  assert.equal(largeId, 'large_drive_id');
  assert.equal(initCalled, true);
  assert.equal(putCalled, true);
});

test('D35 계정 전환(A→B) 시 ULDrive 인메모리 토큰 즉시 폐기 및 이전 실패 시 고아 파일 DELETE 정리 (NFR-SEC-3, 리뷰 4번)', async () => {
  const env = createMockEnv({
    session: { access_token: 'token_user_a', user: { id: 'user-a' } },
    me: { id: 'user-a', storageProvider: 'drive', driveFolderId: 'fld_a' },
    loadDrive: true,
  });

  let tokenClientCallCount = 0;
  let currentToken = 'token_A';
  env.sandbox.window.google = {
    accounts: {
      oauth2: {
        initTokenClient: ({ callback }) => {
          tokenClientCallCount++;
          return {
            requestAccessToken: () => callback({ access_token: currentToken, expires_in: '3600' }),
          };
        },
      },
    },
  };
  env.sandbox.window.ULEVELP_CONFIG = { googleClientId: 'client-id.apps.googleusercontent.com' };

  // 1. 사용자 A 상태에서 토큰 발급
  const tokA = await env.sandbox.window.ULDrive.requestToken();
  assert.equal(tokA, 'token_A');
  assert.equal(tokenClientCallCount, 1);

  // 만료 전 재호출 시 인메모리 토큰 재사용 확인
  const tokA2 = await env.sandbox.window.ULDrive.requestToken();
  assert.equal(tokA2, 'token_A');
  assert.equal(tokenClientCallCount, 1);

  // 2. 사용자 B로 계정 전환 (A -> B)
  currentToken = 'token_B';
  env.triggerAuthChange({
    user: { id: 'user-b' },
    session: { access_token: 'token_user_b', user: { id: 'user-b' } },
  });

  // 사용자 B 상태에서 requestToken() 호출 시 token_A가 즉시 폐기되어 새로 토큰 발급
  const tokB = await env.sandbox.window.ULDrive.requestToken();
  assert.equal(tokB, 'token_B');
  assert.equal(tokenClientCallCount, 2);

  // 3. migrateAllToDrive() 중 migrateToDrive 실패 시 고아 파일 DELETE 정리 검증
  const deleteUrls = [];
  env.setFetchResponse(async (url, opts) => {
    // 1) ensureFolder search
    if (url.includes('/files?q=')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ files: [{ id: 'fld_folder_id' }] }),
      };
    }
    // 2) downloadBlob
    if (url.includes('/download')) {
      return {
        ok: true,
        status: 200,
        blob: async () => new Blob([new Uint8Array(100)], { type: 'audio/mp4' }),
      };
    }
    // 3) Drive uploadBlob
    if (url.includes('uploadType=multipart')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'uploaded_orphan_file_id' }),
      };
    }
    // 4) Drive deleteFile
    if (opts && opts.method === 'DELETE') {
      deleteUrls.push(url);
      return { ok: true, status: 204 };
    }
    throw new Error('Unexpected fetch url: ' + url);
  });

  // sessions.list stub: 1개 supabase take 반환
  env.sandbox.window.ULData.sessions = {
    list: async () => ({
      sessions: [
        {
          id: 'sess-1',
          takes: [
            { id: 'take-orphan-1', storage: 'supabase', mime: 'audio/mp4' },
          ],
        },
      ],
    }),
  };

  // migrateToDrive 실패 유도
  env.sandbox.window.ULData.takes.migrateToDrive = async () => {
    throw new Error('서버 DB 장애로 migrateToDrive 실패');
  };

  const res = await env.sandbox.window.ULDrive.migrateAllToDrive();
  assert.equal(res.migrated, 0);
  assert.equal(res.skipped, 1);

  // Drive 업로드 성공 후 서버 실패 시 해당 fileId에 대해 DELETE 요청이 나갔는지 검증
  assert.equal(deleteUrls.length, 1);
  assert.ok(deleteUrls[0].includes('/files/uploaded_orphan_file_id'));
});

test('D36 takes.upload — replaceOldSongTakes: true 전달 시 metadata JSON에 9번째 키로 포함되고 생략/false 시 기존 8개 키 유지 (E1-1 정합)', async () => {
  const env = createMockEnv({
    session: { access_token: 'tok' },
    apiResponse: { ok: true, take: { id: 't-replace-1' } },
  });

  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mp4' });

  // 1) replaceOldSongTakes: false -> 기존과 동일하게 8개 키만 포함
  await env.ULData.takes.upload(
    {
      songId: 's1',
      date: '2026-11-03',
      recordedAt: '2026-11-03T00:00:00.000Z',
      a: 1,
      b: 2,
      rate: 1,
      durationSec: 5,
      mime: 'audio/mp4',
      replaceOldSongTakes: false,
    },
    blob
  );
  const form1 = env.apiCalls[0].opts.body;
  const parsed1 = JSON.parse(await form1.get('metadata').text());
  assert.deepEqual(Object.keys(parsed1).sort(), ['a', 'b', 'date', 'durationSec', 'mime', 'rate', 'recordedAt', 'songId']);
  assert.equal(parsed1.replaceOldSongTakes, undefined);

  // 2) replaceOldSongTakes: true -> 9번째 키로 replaceOldSongTakes: true 포함
  await env.ULData.takes.upload(
    {
      songId: 's2',
      date: '2026-11-03',
      recordedAt: '2026-11-03T00:00:00.000Z',
      a: null,
      b: null,
      rate: 0.75,
      durationSec: 12,
      mime: 'audio/mp4',
      replaceOldSongTakes: true,
    },
    blob
  );
  const form2 = env.apiCalls[1].opts.body;
  const parsed2 = JSON.parse(await form2.get('metadata').text());
  assert.deepEqual(Object.keys(parsed2).sort(), [
    'a',
    'b',
    'date',
    'durationSec',
    'mime',
    'rate',
    'recordedAt',
    'replaceOldSongTakes',
    'songId',
  ]);
  assert.equal(parsed2.replaceOldSongTakes, true);
});

test('D37 integrations.saveGemini — verify 옵션 전달 및 루트 IntegrationDto(verified, displayName) 반환 (E1-1 정합)', async () => {
  const env = createMockEnv({
    session: { access_token: 'valid_token' },
    apiHandler: (p, opts) => {
      if (p === '/api/v1/integrations/gemini') {
        const reqBody = JSON.parse(opts.body);
        return {
          provider: 'gemini',
          hint: 'X9zQ',
          config: { model: reqBody.model || 'gemini-flash-latest' },
          updatedAt: '2026-11-03T00:00:00Z',
          verified: reqBody.verify !== false,
          displayName: reqBody.verify === false ? null : 'Gemini 1.5 Flash',
        };
      }
      return { ok: true };
    },
  });

  // 1) verify: true 명시
  const res1 = await env.ULData.integrations.saveGemini({
    apiKey: 'k',
    model: 'gemini-flash-latest',
    verify: true,
  });
  const sent1 = JSON.parse(env.apiCalls[0].opts.body);
  assert.equal(sent1.verify, true);
  assert.equal(res1.verified, true);
  assert.equal(res1.displayName, 'Gemini 1.5 Flash');
  assert.equal(env.fetchMeCount, 1);

  // 2) verify: false 명시
  const res2 = await env.ULData.integrations.saveGemini({
    model: 'gemini-1.5-pro',
    verify: false,
  });
  const sent2 = JSON.parse(env.apiCalls[1].opts.body);
  assert.equal(sent2.verify, false);
  assert.equal(res2.verified, false);
  assert.equal(res2.displayName, null);
  assert.equal(env.fetchMeCount, 2);
});
