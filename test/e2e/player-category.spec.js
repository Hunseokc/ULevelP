// 플레이어 분류(G-4b): 곡 목록 서랍을 분류 폴더(+미분류)로 묶고, 홈 분류 버튼으로 오면 그 폴더만 펼친 채 서랍을 연다.
// 상단 "분류" 버튼으로 현재 곡에 분류를 붙이고 뗀다. 설계: 개발산출물/결과/G-3c_분류설계.md. React 화면 전용(legacy 모드는 skip)
'use strict';
const { test, expect } = require('@playwright/test');

const CAT = {
  jazz: '00000000-0000-4000-8000-000000000301',
  pop: '00000000-0000-4000-8000-000000000302',
  empty: '00000000-0000-4000-8000-000000000303',
};
const CATEGORIES = [
  { id: CAT.jazz, name: 'Jazz', sortOrder: 0, onHome: true, songCount: 2 },
  { id: CAT.pop, name: 'Pop', sortOrder: 1, onHome: true, songCount: 1 },
  { id: CAT.empty, name: '빈 분류', sortOrder: 2, onHome: false, songCount: 0 },
];

function song(n, videoId, categoryIds) {
  return {
    id: `00000000-0000-4000-8000-00000000010${n}`,
    title: `Song ${n}`,
    artist: 'Artist',
    status: '연습 중',
    statusCode: 'practicing',
    videoId,
    pos: null,
    a: null,
    b: null,
    rate: 1,
    lastDate: '2026-11-03',
    memo: '',
    categoryIds,
    totalSeconds: 0,
    resumeUrl: '',
  };
}

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
}

// 곡 1: Jazz+Pop(두 폴더에 나옴), 곡 2: Jazz, 곡 3: 미분류
function fakeSongStore() {
  const songs = [song(1, 'aaaaaaaaaa1', [CAT.jazz, CAT.pop]), song(2, 'aaaaaaaaaa2', [CAT.jazz]), song(3, 'aaaaaaaaaa3', [])];
  const patches = [];
  return {
    patches,
    async handle(route) {
      const req = route.request();
      const p = new URL(req.url()).pathname;
      if (p === '/api/v1/songs') return json(route, { songs });
      if (p.startsWith('/api/v1/songs/by-video/')) {
        const vid = p.split('/').pop();
        return json(route, { song: songs.find((s) => s.videoId === vid) || null });
      }
      const id = p.split('/').pop();
      const s = songs.find((x) => x.id === id);
      if (req.method() === 'PATCH' && s) {
        const body = JSON.parse(req.postData() || '{}');
        patches.push(body);
        if (body.categoryIds) s.categoryIds = CATEGORIES.map((c) => c.id).filter((cid) => body.categoryIds.includes(cid));
        return json(route, { song: s });
      }
      return json(route, {});
    },
  };
}

// 가짜 인증 (home-category.spec.js setupLoggedIn에서 옮김)
async function setupLoggedIn(page, { categories = CATEGORIES, store = fakeSongStore() } = {}) {
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

  await page.route(/https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@.*/, async (route) => {
    const stub = `
      window.supabase = {
        createClient: function() {
          const fakeSession = { access_token: 'fake-jwt-token', user: { id: '00000000-0000-4000-8000-000000000001', email: 'a@example.com', user_metadata: {} } };
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

  // 나중에 등록한 route가 먼저 매칭된다: 모르는 API는 빈 객체
  await page.route((url) => url.pathname.startsWith('/api/v1/'), (route) => json(route, {}));
  await page.route((url) => url.pathname.startsWith('/api/v1/me'), (route) =>
    json(route, {
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
    })
  );
  await page.route((url) => url.pathname.startsWith('/api/v1/songs'), (route) => store.handle(route));
  await page.route((url) => url.pathname.startsWith('/api/v1/categories'), (route) => json(route, { categories }));
  await page.route(/youtube\.com|ytimg\.com|doubleclick\.net/, (route) => route.abort());
  return store;
}

async function isReact(page) {
  return (await page.locator('#root').count()) > 0;
}

const folderState = (page) =>
  page.locator('#songs > li[data-folder]').evaluateAll((els) =>
    els.map((el) => [el.querySelector('button').textContent.replace(/[▾▸]/g, '').trim(), el.querySelector('button').getAttribute('aria-expanded')])
  );

test('P4b-1 홈 분류 버튼 → 플레이어에서 서랍이 열리고 그 폴더만 펼쳐짐', async ({ page }) => {
  await setupLoggedIn(page);
  await page.goto('/index.html', { waitUntil: 'load' });
  test.skip(!(await isReact(page)), 'legacy 모드: React 화면 아님');
  await page.locator(`#categoryRow a[data-category="${CAT.pop}"]`).click();
  await page.waitForURL(/\/practice\.html$/);

  await expect(page.locator('#lib')).toBeVisible();
  await expect(page.locator('#songs > li[data-folder]')).toHaveCount(4);
  expect(await folderState(page)).toEqual([
    ['Jazz2', 'false'],
    ['Pop1', 'true'],
    ['빈 분류0', 'false'],
    ['미분류1', 'false'],
  ]);
  await expect(page.locator(`#songs > li[data-folder="${CAT.pop}"]`)).toContainText('Song 1');
  // 한 번 읽은 분류는 지워져 새로고침하면 서랍이 저절로 열리지 않는다
  expect(await page.evaluate(() => sessionStorage.getItem('ulp:open-category'))).toBeNull();
  await page.reload({ waitUntil: 'load' });
  await page.locator('#libBtn').waitFor();
  await expect(page.locator('#lib')).toBeHidden();
});

test('P4b-2 직접 열면 전부 펼침, 한 곡이 여러 폴더에, 폴더 접기', async ({ page }) => {
  await setupLoggedIn(page);
  await page.goto('/practice.html', { waitUntil: 'load' });
  test.skip(!(await isReact(page)), 'legacy 모드: React 화면 아님');
  await page.locator('#libBtn').click();
  await expect(page.locator('#songs > li[data-folder]')).toHaveCount(4);
  expect((await folderState(page)).map((f) => f[1])).toEqual(['true', 'true', 'true', 'true']);
  await expect(page.locator('#songs').getByRole('button', { name: /Song 1/ })).toHaveCount(2);
  await expect(page.locator(`#songs > li[data-folder="${CAT.empty}"]`)).toContainText('이 분류에 곡이 없어요');
  await expect(page.locator('#songs > li[data-folder="__uncategorized"]')).toContainText('Song 3');

  await page.locator(`#songs > li[data-folder="${CAT.jazz}"] > button`).click();
  expect((await folderState(page)).map((f) => f[1])).toEqual(['false', 'true', 'true', 'true']);
  await expect(page.locator('#songs').getByRole('button', { name: /Song 2/ })).toHaveCount(0);
});

test('P4b-3 분류가 없는 사용자는 예전처럼 평면 목록', async ({ page }) => {
  await setupLoggedIn(page, { categories: [] });
  await page.goto('/practice.html', { waitUntil: 'load' });
  test.skip(!(await isReact(page)), 'legacy 모드: React 화면 아님');
  await page.locator('#libBtn').click();
  await expect(page.locator('#songs > li button').first()).toBeVisible();
  await expect(page.locator('#songs > li[data-folder]')).toHaveCount(0);
  await expect(page.locator('#songs > li')).toHaveCount(3);
});

test('P4b-4 지워진 분류로 넘어오면 전부 펼침', async ({ page }) => {
  await setupLoggedIn(page);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      sessionStorage.setItem('ulp:open-category', '00000000-0000-4000-8000-000000000399');
    }
  });
  await page.goto('/practice.html', { waitUntil: 'load' });
  test.skip(!(await isReact(page)), 'legacy 모드: React 화면 아님');
  await expect(page.locator('#lib')).toBeVisible();
  await expect(page.locator('#songs > li[data-folder]')).toHaveCount(4);
  expect((await folderState(page)).map((f) => f[1])).toEqual(['true', 'true', 'true', 'true']);
});

test('P4b-5 현재 곡 분류 붙이기·떼기 → 서랍 폴더에 반영, Esc로 닫힘', async ({ page }) => {
  const store = await setupLoggedIn(page);
  await page.goto('/practice.html?v=aaaaaaaaaa3', { waitUntil: 'load' });
  test.skip(!(await isReact(page)), 'legacy 모드: React 화면 아님');
  const btn = page.locator('#songCatBtn');
  await expect(btn).toHaveText('분류');
  await btn.click();
  const pop = page.locator('#songCatPop');
  await expect(pop.locator('li[data-category]')).toHaveCount(3);
  // H6 규칙: 체크박스 파란색 없음
  expect(await pop.locator('input').first().evaluate((el) => getComputedStyle(el).accentColor)).not.toMatch(/rgb\(31, 63, 195\)|auto/);

  await pop.locator(`li[data-category="${CAT.pop}"] input`).check();
  await expect(btn).toHaveText('분류 1');
  await pop.locator(`li[data-category="${CAT.jazz}"] input`).check();
  await expect(btn).toHaveText('분류 2');
  await pop.locator(`li[data-category="${CAT.pop}"] input`).uncheck();
  await expect(btn).toHaveText('분류 1');
  expect(store.patches.map((b) => b.categoryIds)).toEqual([[CAT.pop], [CAT.pop, CAT.jazz], [CAT.jazz]]);

  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);

  await page.locator('#libBtn').click();
  await expect(page.locator(`#songs > li[data-folder="${CAT.jazz}"]`)).toContainText('Song 3');
  // 미분류였던 곡 3이 Jazz로 옮겨 미분류 폴더가 사라진다
  await expect(page.locator('#songs > li[data-folder="__uncategorized"]')).toHaveCount(0);
});

test('P4b-6 계정에 없는 곡이면 분류 버튼 없음', async ({ page }) => {
  await setupLoggedIn(page);
  await page.goto('/practice.html?v=zzzzzzzzzz9', { waitUntil: 'load' });
  test.skip(!(await isReact(page)), 'legacy 모드: React 화면 아님');
  await expect(page.locator('#syncState')).toHaveText(/계정에 없는 곡/);
  await expect(page.locator('#songCatBtn')).toHaveCount(0);
});
