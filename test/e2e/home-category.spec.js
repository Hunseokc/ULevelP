// 홈 분류 바로가기(G-4a): 서버 분류 중 홈에 켠 것만 순서대로 + `+` 팝업(추가·이름·삭제·홈 표시·순서), 비로그인 안내
// 설계: 개발산출물/결과/G-3c_분류설계.md. 분류 API는 테스트 안의 가짜 저장소로 흉내 낸다. React 화면 전용(legacy 모드는 skip)
'use strict';
const { test, expect } = require('@playwright/test');

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
}

function apiError(route, status, code, message) {
  return json(route, { ok: false, source: 'server', status, code, message, retryAfter: null }, status);
}

// docs/03-api-spec.md 3.7절 규칙만큼만 흉내 내는 가짜 분류 저장소 (새로고침해도 유지)
function fakeCategoryStore() {
  let seq = 0;
  const items = [];
  const dto = (c) => ({ ...c, songCount: 0 });
  const sorted = () => [...items].sort((a, b) => a.sortOrder - b.sortOrder).map(dto);
  const nameTaken = (name, exceptId) => items.some((c) => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase());
  return {
    names: () => sorted().map((c) => c.name),
    async handle(route) {
      const req = route.request();
      const p = new URL(req.url()).pathname;
      const method = req.method();
      const body = req.postData() ? JSON.parse(req.postData()) : {};
      if (p === '/api/v1/categories' && method === 'GET') return json(route, { categories: sorted() });
      if (p === '/api/v1/categories' && method === 'POST') {
        const name = String(body.name || '').trim();
        if (nameTaken(name)) return apiError(route, 409, 'CONFLICT', '같은 이름의 분류가 이미 있습니다.');
        seq += 1;
        const c = { id: `00000000-0000-4000-8000-0000000003${String(seq).padStart(2, '0')}`, name, sortOrder: items.length, onHome: true };
        items.push(c);
        return json(route, { category: dto(c) }, 201);
      }
      if (p === '/api/v1/categories/order' && method === 'PUT') {
        body.ids.forEach((id, i) => {
          items.find((c) => c.id === id).sortOrder = i;
        });
        return json(route, { categories: sorted() });
      }
      const id = p.split('/').pop();
      const c = items.find((x) => x.id === id);
      if (!c) return apiError(route, 404, 'NOT_FOUND', '분류를 찾을 수 없습니다.');
      if (method === 'PATCH') {
        if (body.name !== undefined) {
          if (nameTaken(body.name, id)) return apiError(route, 409, 'CONFLICT', '같은 이름의 분류가 이미 있습니다.');
          c.name = body.name;
        }
        if (body.onHome !== undefined) c.onHome = body.onHome;
        return json(route, { category: dto(c) });
      }
      if (method === 'DELETE') {
        items.splice(items.indexOf(c), 1);
        return json(route, { ok: true });
      }
      return json(route, {});
    },
  };
}

// 가짜 인증 (home-align.spec.js setupLoggedIn에서 인증 부분만 옮김)
async function setupLoggedIn(page, categoryHandler) {
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
  await page.route((url) => url.pathname.startsWith('/api/v1/songs'), (route) => json(route, { songs: [] }));
  await page.route((url) => url.pathname.startsWith('/api/v1/categories'), categoryHandler);
}

async function openHome(page) {
  await page.route(/youtube\.com|ytimg\.com|doubleclick\.net/, (route) => route.abort());
  await page.goto('/index.html', { waitUntil: 'load' });
  if ((await page.locator('#root').count()) === 0) return false;
  await page.locator('#categoryRow').waitFor();
  return true;
}

const shownNames = (page) => page.locator('#categoryRow a[data-category]').evaluateAll((els) => els.map((e) => e.textContent.trim()));

async function addCategory(page, name) {
  const pop = page.locator('#categorySettings');
  await pop.locator('#categoryNewName').fill(name);
  await pop.locator('#categoryAddBtn').click();
}

test('C4a-1 비로그인: 분류 줄 대신 로그인 안내, + 없음', async ({ page }) => {
  test.skip(!(await openHome(page)), 'legacy 모드: React 화면 아님');
  await expect(page.locator('#categoryHint')).toHaveText('로그인하면 곡을 분류할 수 있어요');
  await expect(page.locator('#categorySettingsBtn')).toHaveCount(0);
});

test('C4a-2 로그인 빈 상태: 안내 + 설정 버튼', async ({ page }) => {
  const store = fakeCategoryStore();
  await setupLoggedIn(page, (route) => store.handle(route));
  test.skip(!(await openHome(page)), 'legacy 모드: React 화면 아님');
  await expect(page.locator('#categoryHint')).toHaveText('+를 눌러 분류를 만들어 보세요');
  await expect(page.locator('#categoryRow #categorySettingsBtn')).toHaveText('+');
  await page.locator('#categorySettingsBtn').click();
  await expect(page.locator('#categorySettings')).toContainText('아직 분류가 없어요');
});

test('C4a-3 추가·중복 오류·이름 변경·홈 끄기·순서 → 새로고침 후 유지', async ({ page }) => {
  const store = fakeCategoryStore();
  await setupLoggedIn(page, (route) => store.handle(route));
  test.skip(!(await openHome(page)), 'legacy 모드: React 화면 아님');
  await page.locator('#categorySettingsBtn').click();
  const pop = page.locator('#categorySettings');

  await addCategory(page, 'Jazz');
  await addCategory(page, '연습곡');
  await addCategory(page, 'Pop');
  await expect(page.locator('#categoryRow a[data-category]')).toHaveCount(3);
  expect(await shownNames(page)).toEqual(['Jazz', '연습곡', 'Pop']);
  await expect(page.locator('#categoryHint')).toHaveCount(0);

  // 빈 이름은 보내지 않음, 대소문자만 다른 이름은 서버 409 문구
  await addCategory(page, '   ');
  await expect(pop.locator('#categoryError')).toHaveText('이름을 입력하세요');
  await addCategory(page, 'jazz');
  await expect(pop.locator('#categoryError')).toHaveText('같은 이름의 분류가 이미 있습니다.');
  await expect(pop.locator('li[data-category]')).toHaveCount(3);

  // 이름 바꾸기(Enter)
  await pop.getByRole('button', { name: '연습곡 이름 바꾸기' }).click();
  await pop.getByLabel('분류 이름', { exact: true }).fill('Practice');
  await pop.getByLabel('분류 이름', { exact: true }).press('Enter');
  await expect(pop.getByRole('button', { name: 'Practice 이름 바꾸기' })).toBeVisible();

  // 홈 끄기·순서
  await pop.locator('li[data-category]').filter({ hasText: 'Jazz' }).locator('input[type="checkbox"]').uncheck();
  await pop.getByRole('button', { name: 'Pop 위로' }).click();
  await expect.poll(() => shownNames(page)).toEqual(['Pop', 'Practice']);
  await expect.poll(() => store.names()).toEqual(['Jazz', 'Pop', 'Practice']);

  await page.reload({ waitUntil: 'load' });
  await page.locator('#categoryRow a[data-category]').first().waitFor();
  expect(await shownNames(page)).toEqual(['Pop', 'Practice']);
});

test('C4a-4 삭제는 두 번 눌러야 하고, Esc는 이름 고치기만 취소', async ({ page }) => {
  const store = fakeCategoryStore();
  await setupLoggedIn(page, (route) => store.handle(route));
  test.skip(!(await openHome(page)), 'legacy 모드: React 화면 아님');
  await page.locator('#categorySettingsBtn').click();
  const pop = page.locator('#categorySettings');
  await addCategory(page, 'Rock');
  await addCategory(page, 'Ani');
  await expect(pop.locator('li[data-category]')).toHaveCount(2);

  await pop.getByRole('button', { name: 'Rock 삭제', exact: true }).click();
  await expect(pop.locator('li[data-category]')).toHaveCount(2);
  await pop.getByRole('button', { name: 'Rock 삭제 확인' }).click();
  await expect(pop.locator('li[data-category]')).toHaveCount(1);
  await expect.poll(() => store.names()).toEqual(['Ani']);

  await pop.getByRole('button', { name: 'Ani 이름 바꾸기' }).click();
  await pop.getByLabel('분류 이름', { exact: true }).fill('바꾸는 중');
  await pop.getByLabel('분류 이름', { exact: true }).press('Escape');
  await expect(pop).toBeVisible();
  await expect(pop.getByRole('button', { name: 'Ani 이름 바꾸기' })).toBeVisible();
  expect(store.names()).toEqual(['Ani']);

  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
});

// 플레이어는 도착하자마자 sessionStorage 값을 읽고 지운다(G-4b) → 서랍이 열리고 값이 소비됐는지로 본다
test('C4a-5 분류 버튼 → URL 그대로 플레이어, 서랍이 열리고 넘긴 값은 소비됨', async ({ page }) => {
  const store = fakeCategoryStore();
  await setupLoggedIn(page, (route) => store.handle(route));
  test.skip(!(await openHome(page)), 'legacy 모드: React 화면 아님');
  await page.locator('#categorySettingsBtn').click();
  await addCategory(page, 'Jazz');
  const link = page.locator('#categoryRow a[data-category]').first();
  await page.keyboard.press('Escape');
  await link.click();
  await page.waitForURL(/\/practice\.html$/);
  // 이 목은 곡이 0개라 폴더 없이 빈 안내만 보인다(폴더 펼침은 player-category.spec.js P4b-1)
  await expect(page.locator('#lib')).toBeVisible();
  await expect(page.locator('#songs')).toContainText('아직 곡이 없어요');
  expect(await page.evaluate(() => sessionStorage.getItem('ulp:open-category'))).toBeNull();
});

test('C4a-6 분류 목록을 못 불러오면 안내', async ({ page }) => {
  await setupLoggedIn(page, (route) => apiError(route, 500, 'INTERNAL', '서버 오류'));
  test.skip(!(await openHome(page)), 'legacy 모드: React 화면 아님');
  await expect(page.locator('#categoryHint')).toHaveText('분류를 불러오지 못했어요');
});
