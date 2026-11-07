// CH-5 CHORDS 코드 진행 모음: 메뉴 · 범위 토글 · 입력 3종(직접·붙여넣기·영상) · 수정·삭제 · 노트 상세 수집 토글 · 4폭 배치
// 설계: 개발산출물/결과/CH-1a_프레임.md §2, CH-1b_설계.md §3. API는 테스트 안의 가짜 저장소로 흉내 낸다. React 화면 전용(legacy 모드는 skip)
'use strict';
const { test, expect } = require('@playwright/test');

const UID = '00000000-0000-4000-8000-000000000001';
const NOTE_ID = '00000000-0000-4000-8000-0000000000aa';

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
}

function apiError(route, status, code, message) {
  return json(route, { ok: false, source: 'server', status, code, message, retryAfter: null }, status);
}

function row(over) {
  return {
    kind: 'reference',
    origin: 'manual',
    route: 'manual',
    evidence: null,
    title: '',
    part: '',
    artist: '',
    album: '',
    channel: '',
    releaseDate: null,
    key: null,
    instrument: null,
    chords: [],
    moods: [],
    genres: [],
    tags: [],
    url: '',
    videoId: null,
    startSec: null,
    endSec: null,
    memo: '',
    noteId: null,
    createdAt: '2026-11-04T00:00:00Z',
    updatedAt: '2026-11-04T00:00:00Z',
    ...over,
  };
}

const AI_ROW = row({
  id: '00000000-0000-4000-8000-0000000000b1',
  kind: 'analysis',
  origin: 'ai',
  route: 'video',
  evidence: '화면',
  title: '네오소울 진행',
  part: '인트로',
  channel: '채널A',
  key: 'F Major',
  instrument: '건반',
  chords: [
    { symbol: 'FM9', roman: 'IM9', source: '화면', timestamp: '0:42' },
    { symbol: 'Dm9', roman: 'vim9', source: '화면', timestamp: '0:44' },
  ],
  url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
  videoId: 'jNQXAC9IVRw',
  startSec: 42,
  endSec: 60,
  noteId: NOTE_ID,
});

// docs/03-api-spec.md 8.5 규칙만큼만 흉내 내는 가짜 저장소
function fakeStore(initial = [], opts = {}) {
  let seq = 0;
  const items = initial.map((x) => ({ ...x }));
  const calls = [];
  const jobs = [];
  let noteCollect = false;
  return {
    items,
    calls,
    async handle(route) {
      const req = route.request();
      const p = new URL(req.url()).pathname;
      const method = req.method();
      const body = req.postData() ? JSON.parse(req.postData()) : {};
      calls.push({ method, path: p, body });
      if (p === '/api/v1/progressions' && method === 'GET') return json(route, { progressions: items });
      if (p === '/api/v1/progressions' && method === 'POST') {
        if (!body.title) return apiError(route, 400, 'INVALID_INPUT', 'title은 1~300자여야 합니다.');
        seq += 1;
        const r = row({ ...body, id: `00000000-0000-4000-8000-0000000001${String(seq).padStart(2, '0')}`, origin: 'manual', route: 'manual' });
        items.unshift(r);
        return json(route, { progression: r }, 201);
      }
      if (p === '/api/v1/progressions/analyze' && method === 'POST') {
        // GA-4: 끝난 같은 영상·설정이 있으면 force 없이 409(서버 24시간 중복 규칙 흉내)
        const same = jobs.find((j) => j.url === body.url && j.status === 'done' && j.pace === (body.pace ?? 'normal') && j.startSec === (body.startSec ?? null) && j.endSec === (body.endSec ?? null));
        if (opts.dedupe && same && body.force !== true) {
          return apiError(route, 409, 'DUPLICATE_ANALYSIS', '이미 같은 영상·구간·속도로 분석했어요. 다시 분석하려면 한 번 더 눌러 주세요.');
        }
        const n = jobs.length + 1;
        jobs.unshift({ id: `00000000-0000-4000-8000-0000000000j${n}`, kind: 'progression', url: body.url, tags: ['화성'], status: 'queued', error: null, noteId: null, startSec: body.startSec ?? null, endSec: body.endSec ?? null, pace: body.pace ?? 'normal', createdAt: new Date().toISOString(), _n: n, _polls: 0 });
        if (opts.analyzeDelayMs) await new Promise((r) => setTimeout(r, opts.analyzeDelayMs));
        return json(route, { jobId: jobs[0].id, status: 'queued' }, 202);
      }
      if (p === '/api/v1/notes/jobs' && method === 'GET') {
        // 작업마다 두 번째 조회부터 완료 + 진행 2개 생성(n번째 작업 노트 = ...n{n+1})
        for (const j of jobs) {
          if (j.status !== 'queued' || j._polls++ < 1) continue;
          if (opts.failWith) {
            j.status = 'failed';
            j.error = opts.failWith;
          } else {
            j.status = 'done';
            j.noteId = `00000000-0000-4000-8000-0000000000n${j._n + 1}`;
            items.unshift(
              row({ ...AI_ROW, id: `00000000-0000-4000-8000-000000000${j._n}c1`, noteId: j.noteId, title: `새 영상 진행 ${j._n}-1` }),
              row({ ...AI_ROW, id: `00000000-0000-4000-8000-000000000${j._n}c2`, noteId: j.noteId, title: `새 영상 진행 ${j._n}-2` })
            );
          }
        }
        return json(route, { jobs: [...jobs.map(({ _n, _polls, ...j }) => j), { id: 'note-job', kind: 'note', url: 'https://youtu.be/x', tags: ['리듬'], status: 'running', createdAt: '2026-11-04T00:00:00Z' }] });
      }
      if (p === `/api/v1/notes/${NOTE_ID}/collect` && method === 'PUT') {
        noteCollect = body.collect === true;
        if (noteCollect) {
          if (!items.some((x) => x.noteId === NOTE_ID)) items.push({ ...AI_ROW, route: 'note' }, row({ ...AI_ROW, id: '00000000-0000-4000-8000-0000000000b2', route: 'note', origin: 'manual' }));
        } else {
          for (let i = items.length - 1; i >= 0; i--) if (items[i].noteId === NOTE_ID) items.splice(i, 1);
        }
        return json(route, { noteId: NOTE_ID, collect: noteCollect, progressions: items.filter((x) => x.noteId === NOTE_ID) });
      }
      if (p === `/api/v1/notes/${NOTE_ID}` && method === 'GET') {
        return json(route, {
          note: {
            id: NOTE_ID, videoId: 'jNQXAC9IVRw', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', title: '화성 노트', channel: '채널A',
            tags: ['화성'], memo: '', headline: '', points: [], keywords: [], difficulty: null, model: 'gemini', collectProgressions: noteCollect,
            createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z', analysis: { harmony: { progressions: [{ name: '인트로', chords: [] }] } }, diagramsSvg: [],
          },
        });
      }
      const m = /^\/api\/v1\/progressions\/([^/]+)$/.exec(p);
      if (m) {
        const it = items.find((x) => x.id === m[1]);
        if (!it) return apiError(route, 404, 'NOT_FOUND', '코드 진행을 찾을 수 없습니다.');
        if (method === 'PATCH') {
          if (body.kind === 'reference' && it.route !== 'manual') return apiError(route, 400, 'INVALID_INPUT', '영상에서 온 진행은 레퍼런스로 바꿀 수 없습니다.');
          Object.assign(it, body, { updatedAt: new Date().toISOString() });
          if (body.chords || body.key !== undefined) Object.assign(it, { origin: 'manual', evidence: null });
          return json(route, { progression: it });
        }
        if (method === 'DELETE') {
          items.splice(items.indexOf(it), 1);
          return json(route, { ok: true });
        }
      }
      return json(route, {});
    },
  };
}

// 가짜 인증 (home-category.spec.js setupLoggedIn에서 옮김)
async function setupLoggedIn(page, store, { gemini = false } = {}) {
  await page.route(
    (url) => url.pathname.endsWith('.html') || url.pathname === '/',
    async (route) => {
      const response = await route.fetch();
      const text = await response.text();
      const body = text.replace(/\sintegrity="[^"]*"/g, '');
      await route.fulfill({ response, body, headers: { ...response.headers(), 'content-length': String(Buffer.byteLength(body)) } });
    }
  );
  await page.route(/https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@.*/, async (route) => {
    const stub = `
      window.supabase = {
        createClient: function() {
          const fakeSession = { access_token: 'fake-jwt-token', user: { id: '${UID}', email: 'a@example.com', user_metadata: {} } };
          return {
            auth: {
              getSession: async function() { return { data: { session: fakeSession }, error: null }; },
              onAuthStateChange: function() { return { data: { subscription: { unsubscribe: function() {} } } }; },
              signInWithOAuth: async function() { return { error: null }; },
              signOut: async function() { return { error: null }; }
            }
          };
        }
      };
    `;
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stub });
  });
  await page.route((url) => url.pathname.startsWith('/api/v1/'), (route) => store.handle(route));
  await page.route((url) => url.pathname.startsWith('/api/v1/me'), (route) =>
    json(route, {
      id: UID, email: 'a@example.com', displayName: 'Tester', role: 'user', storageProvider: 'supabase', driveFolderId: null,
      takeUsedBytes: 0, takeQuotaBytes: 209715200, migratedLocalAt: '2026-10-30T00:00:00Z',
      keys: { notion: null, gemini: gemini ? { hint: 'AIza…abcd', updatedAt: '2026-11-04T00:00:00Z' } : null },
    })
  );
}

async function open(page, path = '/progressions.html') {
  await page.route(/youtube\.com|ytimg\.com|doubleclick\.net/, (route) => route.abort());
  await page.goto(path, { waitUntil: 'load' });
  if ((await page.locator('#root').count()) === 0) return false;
  await page.locator('#progScope').waitFor();
  return true;
}

const rows = (page) => page.locator('#progList > li');

test('P1 비로그인: CHORDS 메뉴 활성, 기본 시드 범위 토글, 진행 넣기는 로그인 안내', async ({ page }) => {
  test.skip(!(await open(page)), 'legacy 모드: React 화면 아님');
  const nav = page.locator('nav a', { hasText: 'CHORDS' });
  await expect(nav).toHaveAttribute('href', 'progressions.html');
  await expect(nav).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#progSeedNote')).toBeVisible();
  await expect(rows(page)).toHaveCount(5);
  await expect(rows(page).first()).toHaveAttribute('data-kind', 'reference');
  await page.locator('#progScope [data-scope="analysis"]').click();
  await expect(rows(page)).toHaveCount(5);
  await expect(rows(page).first()).toHaveAttribute('data-kind', 'analysis');
  expect(page.url()).toContain('scope=analysis');
  await page.locator('#progScope [data-scope="all"]').click();
  await expect(rows(page)).toHaveCount(10);
  // 시드도 연습실 링크는 있고 수정은 없다
  await rows(page).first().locator('button[aria-expanded]').click();
  await expect(rows(page).first().locator('[data-act="play"]')).toHaveAttribute('href', /^chords\.html#prog\?c=/);
  await expect(rows(page).first().locator('[data-act="edit"]')).toHaveCount(0);
  await page.locator('#progAddBtn').click();
  await expect(page.locator('#progLoginGate')).toContainText('로그인하면 진행을 모을 수 있어요');
});

test('P2 직접 입력: 칩·키 추정·로마숫자 → 저장 → 저장 직후 연습실 안내, 빈 제목은 막음', async ({ page }) => {
  const store = fakeStore();
  await setupLoggedIn(page, store);
  test.skip(!(await open(page)), 'legacy 모드: React 화면 아님');
  await expect(page.locator('#progEmpty')).toContainText('아직 모은 진행이 없어요');
  await page.locator('#progAddBtn').click();
  await page.locator('#progTab-manual').click();
  await expect(page.getByTestId('readingGuide')).toBeVisible();

  await page.locator('#new-chords').fill('C - Am - F - G7 H7');
  const chips = page.getByTestId('new-chips').locator('li');
  await expect(chips).toHaveCount(5);
  await expect(chips.nth(4)).toHaveAttribute('data-ok', '0');
  await expect(page.locator('#new-key')).toHaveValue('C Major');
  await expect(page.locator('#new-roman')).toHaveText('I - vi - IV - V7 - ?');

  // 잘못된 입력: 제목 없음 → 요청 안 보냄
  await page.locator('#new-submit').click();
  await expect(page.locator('#new-msg')).toHaveText('곡 제목을 입력하세요.');
  expect(store.calls.filter((c) => c.method === 'POST')).toHaveLength(0);

  await page.locator('#new-chords').fill('C - Am - F - G7');
  await page.locator('#new-title').fill('My Song');
  await page.locator('#new-artist').fill('Me');
  await page.locator('#new-key').selectOption('A min');
  await expect(page.locator('#new-roman')).toHaveText('bIII - i - bVI - bVII7');
  await page.locator('#new-submit').click();

  await expect(page.locator('#progSavedBanner')).toContainText('방금 넣은 진행, 연습실에서 바로 연주해볼까요?');
  await expect(page.locator('#progSavedBanner a')).toHaveAttribute('href', /^chords\.html#prog\?c=C%2CAm%2CF%2CG7&k=A\+min&t=My\+Song&from=/);
  await expect(rows(page)).toHaveCount(1);
  const post = store.calls.find((c) => c.method === 'POST' && c.path === '/api/v1/progressions');
  expect(post.body).toMatchObject({ kind: 'reference', title: 'My Song', artist: 'Me', key: 'A min' });
  expect(post.body.chords).toEqual([
    { symbol: 'C', roman: 'bIII' },
    { symbol: 'Am', roman: 'i' },
    { symbol: 'F', roman: 'bVI' },
    { symbol: 'G7', roman: 'bVII7' },
  ]);
  await expect(page.locator('#new-title')).toHaveValue(''); // 폼 비움
});

test('P3 수정·삭제: 메모만 바꾸면 memo만 PATCH, 영상 행은 레퍼런스 불가, 삭제 확인', async ({ page }) => {
  const store = fakeStore([AI_ROW]);
  await setupLoggedIn(page, store);
  test.skip(!(await open(page, '/progressions.html?scope=analysis')), 'legacy 모드: React 화면 아님');
  const r = rows(page).first();
  await expect(r).toContainText('네오소울 진행');
  await expect(r).toContainText('F Major · AI · 근거 화면');
  await expect(r.locator('[data-act="loop"]')).toHaveAttribute('href', 'practice.html?v=jNQXAC9IVRw&t=42');
  await expect(r.locator('[data-act="note"]')).toHaveAttribute('href', `note.html?id=${NOTE_ID}`);
  await r.locator('button[aria-expanded]').click();
  await expect(r).toContainText('0:42');
  await r.locator('[data-act="edit"]').click();
  const pre = 'edit-00000000';
  await expect(page.getByRole('button', { name: '레퍼런스' }).last()).toBeDisabled();
  await page.locator(`#${pre}-memo`).fill('좋은 진행');
  await page.locator(`#${pre}-submit`).click();
  await expect(r).toContainText('좋은 진행');
  const patch = store.calls.find((c) => c.method === 'PATCH');
  expect(patch.body).toEqual({ memo: '좋은 진행' });

  // 코드를 바꾸면 "직접"으로 바뀐다는 확인 → 수락
  await r.locator('[data-act="edit"]').click();
  await page.locator(`#${pre}-chords`).fill('FM9 Bb7');
  page.once('dialog', (d) => d.accept());
  await page.locator(`#${pre}-submit`).click();
  await expect(r).toContainText('F Major · 직접');
  const patch2 = store.calls.filter((c) => c.method === 'PATCH')[1];
  expect(patch2.body.chords).toEqual([
    { symbol: 'FM9', roman: 'IM9', timestamp: '0:42' },
    { symbol: 'Bb7', roman: 'IV7' },
  ]);

  page.once('dialog', (d) => d.accept());
  await r.locator('[data-act="delete"]').click();
  await expect(rows(page)).toHaveCount(0);
  expect(store.items).toHaveLength(0);
});

test('P4 붙여넣기: 가사 줄은 건너뛰고 반복 묶음 후보 → 직접 입력 폼으로', async ({ page }) => {
  const store = fakeStore();
  await setupLoggedIn(page, store);
  test.skip(!(await open(page)), 'legacy 모드: React 화면 아님');
  await page.locator('#progAddBtn').click();
  await page.locator('#progTab-paste').click();
  await page.locator('#pasteText').fill('[Chorus]\nAm   F   C   G\n이 노래는 가사 줄 A\nAm   F   C   G\nAm   F   C   G');
  await expect(page.locator('#pasteSummary')).toContainText('코드 줄 3개');
  const first = page.locator('[data-candidate="0"]');
  await expect(first).toContainText('Chorus: 4코드 ×3');
  await first.getByRole('button', { name: '이 진행으로 입력' }).click();
  await expect(page.locator('#progTab-manual')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#new-chords')).toHaveValue('Am - F - C - G');
  await expect(page.locator('#new-part')).toHaveValue('Chorus');
});

test('P5 코드 진행 영상: 분석 요청 → 작업 줄 → 완료 시 "2개 수집 · 노트 보기"', async ({ page }) => {
  const store = fakeStore();
  await setupLoggedIn(page, store, { gemini: true });
  test.skip(!(await open(page)), 'legacy 모드: React 화면 아님');
  await page.locator('#progAddBtn').click();
  await page.locator('#progTab-video').click();
  await expect(page.locator('#progKeyGate')).toHaveCount(0);
  // 잘못된 입력: 유튜브 아님
  await page.locator('#progVideoUrl').fill('https://example.com/x');
  await page.locator('#progVideoSubmit').click();
  await expect(page.locator('#progVideoMsg')).toHaveText('유튜브 영상 링크가 아니에요.');

  await page.locator('#progVideoUrl').fill('https://youtu.be/jNQXAC9IVRw');
  await page.locator('#progVideoMemo').fill('후렴 위주');
  await page.locator('#progVideoSubmit').click();
  await expect(page.locator('#progVideoMsg')).toContainText('분석을 요청했어요');
  const req = store.calls.find((c) => c.path === '/api/v1/progressions/analyze');
  expect(req.body).toEqual({ url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', memo: '후렴 위주', pace: 'normal' });
  await expect(page.locator('#progScope [data-scope="analysis"]')).toHaveAttribute('aria-pressed', 'true');
  // 노트 작업(kind=note)은 이 화면에 안 나온다
  await expect(page.locator('#progJobs li')).toHaveCount(1);
  await expect(page.locator('#progJobs li')).toContainText('대기 중');
  await expect(page.locator('#progJobs li')).toContainText('2개 수집', { timeout: 12000 });
  await expect(page.locator('#progJobs li a')).toHaveAttribute('href', 'note.html?id=00000000-0000-4000-8000-0000000000n2');
  await expect(rows(page)).toHaveCount(2);
});

test('P5b 분석 실패: 원인 코드별 제목·안내를 보여 준다(GA-1)', async ({ page }) => {
  const store = fakeStore([], { failWith: 'GEMINI_BILLING: Gemini 크레딧이 부족합니다 (HTTP 402). — Your prepayment credits are depleted.' });
  await setupLoggedIn(page, store, { gemini: true });
  test.skip(!(await open(page)), 'legacy 모드: React 화면 아님');
  await page.locator('#progAddBtn').click();
  await page.locator('#progTab-video').click();
  await page.locator('#progVideoUrl').fill('https://youtu.be/jNQXAC9IVRw');
  await page.locator('#progVideoSubmit').click();
  const li = page.locator('#progJobs li');
  await expect(li).toContainText('크레딧 부족', { timeout: 12000 });
  await expect(li).toContainText('AI Studio에서 결제');
  await expect(li.locator('[data-error-code]')).toHaveAttribute('data-error-code', 'GEMINI_BILLING');
  await expect(li).not.toContainText('분석 실패');
});

test('P5c 구간 + 코드 진행 변화 속도: 잘못된 구간은 막고, 요청 본문·작업 줄에 반영(GA-2)', async ({ page }) => {
  const store = fakeStore();
  await setupLoggedIn(page, store, { gemini: true });
  test.skip(!(await open(page)), 'legacy 모드: React 화면 아님');
  await page.locator('#progAddBtn').click();
  await page.locator('#progTab-video').click();
  // 기본: 보통
  await expect(page.locator('#progVideoPace [data-pace="normal"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#progVideoPace button')).toHaveText(['느림', '보통', '빠름']);
  await expect(page.getByText('코드가 짧은 시간 안에 많이 바뀐다면 빠름을 권장해요')).toBeVisible();

  await page.locator('#progVideoUrl').fill('https://youtu.be/jNQXAC9IVRw');
  // 잘못된 입력: 끝 ≤ 시작, 형식 오류 → 요청 안 보냄
  await page.locator('#progVideoStart').fill('1:20');
  await page.locator('#progVideoEnd').fill('80');
  await page.locator('#progVideoSubmit').click();
  await expect(page.locator('#progVideoMsg')).toHaveText('끝 시간은 시작보다 1초 이상 뒤여야 해요.');
  await page.locator('#progVideoEnd').fill('1:99');
  await page.locator('#progVideoSubmit').click();
  await expect(page.locator('#progVideoMsg')).toContainText('1:20 또는 80');
  expect(store.calls.some((c) => c.path === '/api/v1/progressions/analyze')).toBe(false);

  await page.locator('#progVideoStart').fill('0:40');
  await page.locator('#progVideoEnd').fill('80');
  await page.locator('#progVideoPace [data-pace="fast"]').click();
  await expect(page.locator('#progVideoPace [data-pace="fast"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#progVideoPace [data-pace="normal"]')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#progVideoSubmit').click();
  await expect(page.locator('#progVideoMsg')).toContainText('분석을 요청했어요');
  const req = store.calls.find((c) => c.path === '/api/v1/progressions/analyze');
  expect(req.body).toEqual({ url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', memo: '', startSec: 40, endSec: 80, pace: 'fast' });
  await expect(page.locator('#progJobs li')).toContainText('0:40–1:20 · 빠름');
});

test('P5d 중복 방지 + 완료 줄 합치기: 두 번 눌러도 요청 1건, 분석 중 잠금, 같은 설정은 "다시 분석", 완료는 한 줄(GA-4)', async ({ page }) => {
  const store = fakeStore([], { dedupe: true, analyzeDelayMs: 300 });
  await setupLoggedIn(page, store, { gemini: true });
  test.skip(!(await open(page)), 'legacy 모드: React 화면 아님');
  await page.locator('#progAddBtn').click();
  await page.locator('#progTab-video').click();
  const submit = page.locator('#progVideoSubmit');
  const analyzeCalls = () => store.calls.filter((c) => c.path === '/api/v1/progressions/analyze');

  // 같은 순간 두 번 클릭 → POST 1건, 작업이 진행 중이면 버튼 잠김
  await page.locator('#progVideoUrl').fill('https://youtu.be/jNQXAC9IVRw');
  await submit.dblclick();
  await expect(page.locator('#progVideoMsg')).toContainText('분석을 요청했어요');
  expect(analyzeCalls()).toHaveLength(1);
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveText('분석 중…');
  await expect(page.locator('#progJobs li[data-status="done"]')).toContainText('2개 수집', { timeout: 12000 });
  await expect(submit).toHaveText('분석 요청');

  // 끝난 것과 같은 영상·설정 → 409 → "다시 분석"(입력을 바꾸면 처음 상태)
  await page.locator('#progVideoUrl').fill('https://youtu.be/jNQXAC9IVRw');
  await submit.click();
  await expect(page.locator('#progVideoMsg')).toContainText('이미 같은 영상·구간·속도로 분석했어요');
  await expect(submit).toHaveText('다시 분석');
  await page.locator('#progVideoPace [data-pace="fast"]').click();
  await expect(submit).toHaveText('분석 요청');
  await page.locator('#progVideoPace [data-pace="normal"]').click();
  await submit.click();
  await expect(submit).toHaveText('다시 분석');
  expect(analyzeCalls()).toHaveLength(3);
  await submit.click();
  await expect(page.locator('#progVideoMsg')).toContainText('분석을 요청했어요');
  expect(analyzeCalls()[3].body).toEqual({ url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', memo: '', pace: 'normal', force: true });

  // 두 번째도 끝나면 완료 줄은 한 줄 그대로, 수만 늘고 최근 노트로 연결
  const done = page.locator('#progJobs li[data-status="done"]');
  await expect(done).toContainText('영상 2개 · 4개 수집', { timeout: 12000 });
  await expect(page.locator('#progJobs li')).toHaveCount(1);
  await expect(done.locator('a')).toHaveAttribute('href', 'note.html?id=00000000-0000-4000-8000-0000000000n3');
  await expect(done.locator('a')).toHaveText('최근 노트 보기');
});

test('P6 키 없음: 영상 탭에 키 안내, 요청 버튼 잠김', async ({ page }) => {
  await setupLoggedIn(page, fakeStore());
  test.skip(!(await open(page)), 'legacy 모드: React 화면 아님');
  await page.locator('#progAddBtn').click();
  await page.locator('#progTab-video').click();
  await expect(page.locator('#progKeyGate')).toContainText('Gemini API 키가 필요해요');
  await expect(page.locator('#progVideoSubmit')).toBeDisabled();
});

test('P7 노트 상세 "코드 진행 수집에 넣기": 켜면 N개 + CHORDS 링크, 끄면 고친 진행 확인', async ({ page }) => {
  const store = fakeStore();
  await setupLoggedIn(page, store);
  await page.route(/youtube\.com|ytimg\.com|doubleclick\.net/, (route) => route.abort());
  await page.goto(`/note.html?id=${NOTE_ID}`, { waitUntil: 'load' });
  test.skip((await page.locator('#root').count()) === 0, 'legacy 모드: React 화면 아님');
  const toggle = page.locator('#noteCollectToggle');
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('#noteCollectLink')).toHaveCount(0);
  await toggle.click(); // 제어 컴포넌트: 응답 뒤에 바뀐다
  await expect(toggle).toBeChecked();
  await expect(page.locator('#noteCollectMsg')).toHaveText('진행 2개를 모았어요.');
  await expect(page.locator('#noteCollectLink')).toHaveText('CHORDS에서 보기 (2개) →');
  await expect(page.locator('#noteCollectLink')).toHaveAttribute('href', 'progressions.html?scope=analysis');

  let msg = '';
  page.once('dialog', (d) => {
    msg = d.message();
    d.dismiss();
  });
  await toggle.click();
  await expect.poll(() => msg).toContain('고친 진행 1개도 같이 빠집니다');
  await expect(toggle).toBeChecked(); // 취소하면 그대로
  page.once('dialog', (d) => d.accept());
  await toggle.click();
  await expect(page.locator('#noteCollectMsg')).toHaveText('코드 진행 모음에서 뺐어요.');
  await expect(toggle).not.toBeChecked();
  expect(store.items).toHaveLength(0);
});

// CH-6 취향 코드 진행: 같은 진행 I-V-vi-IV가 두 곡에 → 자주 나오는 진행, 랜덤 꺼내보기 → 연주하기
const POP = (id, title, key, syms) =>
  row({ id, title, artist: 'A', key, moods: ['밝음'], genres: ['팝'], chords: syms.map((s, i) => ({ symbol: s, roman: ['I', 'V', 'vi', 'IV'][i] })) });
const TASTE_ROWS = [
  POP('00000000-0000-4000-8000-0000000000e1', '팝 1', 'C Major', ['C', 'G', 'Am', 'F']),
  POP('00000000-0000-4000-8000-0000000000e2', '팝 2', 'G Major', ['G', 'D', 'Em', 'C']),
  AI_ROW,
];

test('P9 비로그인 취향: 시드 통계 + 랜덤 꺼내보기 → 연주하기, 범위 따라 바뀜', async ({ page }) => {
  test.skip(!(await open(page)), 'legacy 모드: React 화면 아님');
  const taste = page.locator('#progTaste');
  await expect(taste.locator('#tasteSummary')).toHaveText('레퍼런스 · 진행 5개 · 코드 20개');
  await expect(taste.locator('#tasteChords li').first()).toBeVisible();
  await expect(taste.locator('#tasteKeys li').first()).toBeVisible();
  await taste.locator('#tasteRand').click();
  const first = await taste.locator('#tastePickTitle').textContent();
  await expect(taste.locator('#tastePlay')).toHaveAttribute('href', /^chords\.html#prog\?c=.+&from=ref-seed-\d/);
  await taste.locator('#tasteRand').click();
  await expect(taste.locator('#tastePickTitle')).not.toHaveText(first);
  await page.locator('#progScope [data-scope="all"]').click();
  await expect(taste.locator('#tasteSummary')).toContainText('합산 · 진행 10개');
});

test('P10 로그인 취향: 두 곡의 I - V - vi - IV가 자주 나오는 진행, 코드 이동·Mood·Genre', async ({ page }) => {
  const store = fakeStore(TASTE_ROWS);
  await setupLoggedIn(page, store);
  test.skip(!(await open(page)), 'legacy 모드: React 화면 아님');
  const taste = page.locator('#progTaste');
  await expect(taste.locator('#tasteSummary')).toHaveText('레퍼런스 · 진행 2개 · 코드 8개');
  await expect(taste.locator('#tastePatterns li').first()).toContainText('I - V - vi - IV');
  await expect(taste.locator('#tastePatterns li').first()).toContainText('2');
  await expect(taste.locator('#tasteMoves li').first()).toContainText('I → V');
  await expect(taste.locator('#tasteMoods')).toContainText('밝음');
  await expect(taste.locator('#tasteGenres')).toContainText('팝');
  // 분석 범위는 AI 행 하나 → 자주 나오는 진행 없음 안내
  await page.locator('#progScope [data-scope="analysis"]').click();
  await expect(taste.locator('#tasteSummary')).toContainText('분석 · 진행 1개');
  await expect(taste.locator('#tastePatterns')).toContainText('아직 없어요');
});

test('P11 홈 비로그인: 취향 카드 범위 토글 + 연주하기 + 취향 통계 링크', async ({ page }) => {
  test.skip(!(await open(page, '/')), 'legacy 모드: React 화면 아님');
  const box = page.locator('#progRefBox');
  await expect(box.locator('#progRefPlay')).toHaveAttribute('href', /^chords\.html#prog\?c=.+&from=ref-seed-1$/);
  await expect(box.locator('#progRefChords')).toHaveAttribute('href', /^chords\.html#prog\?/);
  await expect(page.locator('#progRefTitle')).toContainText('출처: 기본');
  const before = await box.locator('#progRefChords').textContent();
  await box.locator('#btnRandRef').click();
  await expect(box.locator('#progRefChords')).not.toHaveText(before);
  await page.locator('#progScope [data-scope="analysis"]').click();
  await expect(box.locator('#progRefPlay')).toHaveAttribute('href', /from=arch-seed-1$/);
  await expect(page.locator('#progArchKey')).toHaveText('진행 5개');
  await expect(page.locator('#progTasteLink')).toHaveAttribute('href', 'progressions.html?scope=analysis#progTaste');
});

test('P12 홈 로그인: 서버 진행으로 카드, 자주 나오는 진행 요약, 범위에 없으면 안내', async ({ page }) => {
  const store = fakeStore(TASTE_ROWS.slice(0, 2));
  await setupLoggedIn(page, store);
  test.skip(!(await open(page, '/')), 'legacy 모드: React 화면 아님');
  await expect(page.locator('#progRefChords')).toHaveText('C - G - Am - F');
  await expect(page.locator('#progRefTitle')).toContainText('출처: 직접');
  await expect(page.locator('#progArchChords')).toHaveText('I - V - vi - IV');
  await expect(page.locator('#progArchTitle')).toContainText('자주 나오는 진행 · 2번');
  await page.locator('#progScope [data-scope="analysis"]').click();
  await expect(page.locator('#progRefTitle')).toContainText('분석 범위에 모은 진행이 없어요');
  await expect(page.locator('#btnRandRef')).toHaveAttribute('href', 'progressions.html');
  expect(store.calls.some((c) => /^\/api\/v1\/notes\/[^/]+$/.test(c.path) && c.method === 'GET')).toBe(false);
});

test('P13 취향 통계 줄 누르면 그 묶음·이동이 든 진행만 목록에, 다시 누르거나 해제하면 전체', async ({ page }) => {
  const store = fakeStore(TASTE_ROWS);
  await setupLoggedIn(page, store);
  test.skip(!(await open(page, '/progressions.html?scope=all')), 'legacy 모드: React 화면 아님');
  await expect(rows(page)).toHaveCount(3);
  const taste = page.locator('#progTaste');
  const pat = taste.locator('#tastePatterns button', { hasText: 'I - V - vi - IV' });
  await pat.click();
  await expect(pat).toHaveAttribute('aria-pressed', 'true');
  await expect(rows(page)).toHaveCount(2);
  await expect(page.locator('#progTasteFilter')).toContainText('I - V - vi - IV 묶음이 들어 있는 진행만');
  await expect(page.locator('#progSearchCount')).toHaveText('3개 중 2개');
  await pat.click(); // 같은 줄 다시 → 해제
  await expect(rows(page)).toHaveCount(3);
  await expect(page.locator('#progTasteFilter')).toHaveCount(0);
  // 코드 이동: AI 행(IM9 → vim9)만
  await taste.locator('#tasteMoves button', { hasText: 'IM9 → vim9' }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator('#progTasteFilter')).toContainText('이동이 들어 있는 진행만');
  // 검색과 같이: 없는 곡 → 맞는 진행 없음
  await page.locator('#progSearch').fill('팝');
  await expect(page.locator('#progNoMatch')).toHaveText('"팝"에 맞는 진행이 없어요.');
  await page.locator('#progTasteFilterClear').click();
  await expect(rows(page)).toHaveCount(2);
  // 범위를 바꾸면 필터 해제
  await taste.locator('#tasteMoves button').first().click();
  await page.locator('#progScope [data-scope="reference"]').click();
  await expect(page.locator('#progTasteFilter')).toHaveCount(0);
});

test('P14 노트에서 온 진행 → 연습실 링크에 n=<노트 id>, 진행 연주 탭에 원본 노트 링크', async ({ page }) => {
  const store = fakeStore([AI_ROW]);
  await setupLoggedIn(page, store);
  test.skip(!(await open(page, '/progressions.html?scope=analysis')), 'legacy 모드: React 화면 아님');
  await rows(page).first().locator('button[aria-expanded]').click();
  const play = rows(page).first().locator('[data-act="play"]');
  await expect(play).toHaveAttribute('href', new RegExp(`&n=${NOTE_ID}$`));
  await play.click();
  await page.waitForURL(/chords\.html#prog\?/);
  await expect(page.locator('#pp-note-link')).toHaveAttribute('href', `note.html?id=${NOTE_ID}`);
  // 노트 없는 진행(시드)은 링크 없이 안내만
  await page.goto('about:blank');
  await page.goto('/chords.html#prog?c=C%2CG&from=ref-seed-1', { waitUntil: 'load' });
  await expect(page.locator('#pp-note-hint')).toContainText('기타 지판 기준');
  await expect(page.locator('#pp-note-link')).toHaveCount(0);
});

for (const width of [1280, 1150, 768, 390]) {
  test(`P8 ${width}px 배치: 가로 스크롤 없음 + 스크린샷`, async ({ page }, testInfo) => {
    const store = fakeStore([AI_ROW, row({ id: '00000000-0000-4000-8000-0000000000d1', title: 'Just the Two of Us', artist: 'Grover Washington Jr.', key: 'A min', chords: ['FM7', 'E7', 'Am7', 'Gm7', 'C7'].map((s, i) => ({ symbol: s, roman: ['bVIM7', 'V7', 'im7', 'bviim7', 'bIII7'][i] })), moods: ['nostalgia'], genres: ['RnB'] })]);
    await page.setViewportSize({ width, height: 1000 });
    await setupLoggedIn(page, store);
    test.skip(!(await open(page, '/progressions.html?scope=all')), 'legacy 모드: React 화면 아님');
    await expect(rows(page)).toHaveCount(2);
    await rows(page).nth(1).locator('button[aria-expanded]').click();
    await page.locator('#progAddBtn').click();
    await page.locator('#progTab-manual').click();
    await page.locator('#new-chords').fill('Cm7b5(#11) F7 Bbmaj7 Xq');
    const px = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(px).toBe(0);
    await page.screenshot({ path: testInfo.outputPath(`progressions-${width}.png`), fullPage: true });
  });
}
