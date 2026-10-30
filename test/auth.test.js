// 프런트엔드 로그인·계정 모듈(public/auth.js) 단위·통합 검증 (FR-AUTH-1, FR-AUTH-4, FR-AUTH-5)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const authSrc = fs.readFileSync(path.join(ROOT, 'public', 'auth.js'), 'utf8');
const configSrc = fs.readFileSync(path.join(ROOT, 'public', 'config.js'), 'utf8');

function createMockEnv({ embedded = false, initialSession = null, meResponse = null } = {}) {
  const storage = new Map();
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear(),
  };

  const navLink = {
    id: 'navAuth',
    href: 'settings.html#account',
    textContent: 'LOGIN',
    dataset: {},
    attrs: { href: 'settings.html#account' },
    listeners: {},
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'href') this.href = String(v); },
    getAttribute(k) { return this.attrs[k] || null; },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
  };

  let authChangeCallback = null;
  const oauthCalls = [];
  let signOutCalled = 0;
  let createClientOpts = null;
  let currentSession = initialSession;

  const mockSupabase = {
    createClient(url, key, opts) {
      createClientOpts = { url, key, opts };
      return {
        auth: {
          async getSession() {
            return { data: { session: currentSession } };
          },
          onAuthStateChange(cb) {
            authChangeCallback = cb;
            return { data: { subscription: { unsubscribe() {} } } };
          },
          async signInWithOAuth(params) {
            oauthCalls.push(params);
            return { data: params, error: null };
          },
          async signOut() {
            signOutCalled++;
            currentSession = null;
            if (authChangeCallback) authChangeCallback('SIGNED_OUT', null);
            return { error: null };
          },
        },
      };
    },
  };

  const fetchCalls = [];
  async function mockFetch(url, opts = {}) {
    fetchCalls.push({ url, opts });
    if (url.endsWith('/api/v1/me')) {
      if (typeof meResponse === 'function') return meResponse(url, opts);
      const body = meResponse || {
        id: '550e8400-e29b-41d4-a716-446655440000',
        email: 'player@example.com',
        displayName: '홍길동',
        role: 'user',
        storageProvider: 'supabase',
        driveFolderId: null,
        takeUsedBytes: 0,
        takeQuotaBytes: 209715200,
        migratedLocalAt: null,
        keys: { notion: { hint: '1234', updatedAt: '2026-10-30T00:00:00Z' }, gemini: null },
      };
      return {
        ok: true,
        status: 200,
        json: async () => body,
      };
    }
    return { ok: false, status: 404, json: async () => ({ message: 'Not found' }) };
  }

  const openedWindows = [];
  const selfWin = {};
  const topWin = embedded ? {} : selfWin;

  const sandbox = {
    window: null,
    self: selfWin,
    top: topWin,
    location: { href: 'http://localhost:3000/practice.html?v=jNQXAC9IVRw', origin: 'http://localhost:3000', pathname: '/practice.html', search: '?v=jNQXAC9IVRw' },
    localStorage,
    fetch: mockFetch,
    supabase: mockSupabase,
    document: {
      readyState: 'complete',
      querySelectorAll(sel) {
        if (sel.includes('#navAuth')) return [navLink];
        return [];
      },
      querySelector() { return null; },
      createElement() { return navLink; },
      addEventListener() {},
    },
  };
  sandbox.window = sandbox;
  sandbox.window.open = (u, t, f) => openedWindows.push({ u, t, f });

  vm.createContext(sandbox);
  vm.runInContext(configSrc, sandbox);
  sandbox.ULEVELP_CONFIG.supabaseAnonKey = 'sb_publishable_test_key_for_unit_test';
  vm.runInContext(authSrc, sandbox);

  return {
    ULAuth: sandbox.ULAuth,
    storage,
    navLink,
    oauthCalls,
    fetchCalls,
    openedWindows,
    get createClientOpts() { return createClientOpts; },
    get signOutCalled() { return signOutCalled; },
    triggerAuthChange(event, session) {
      currentSession = session;
      if (authChangeCallback) authChangeCallback(event, session);
    },
  };
}

test('auth.js: createClient에 storageKey ulp:auth 옵션을 고정하고 비로그인 시 상단 메뉴에 LOGIN을 표시한다', async () => {
  const env = createMockEnv();
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(env.createClientOpts.url, 'https://vefrfhafmiiivpgjhqiu.supabase.co');
  assert.equal(env.createClientOpts.opts.auth.storageKey, 'ulp:auth');
  assert.equal(env.navLink.textContent, 'LOGIN');
  assert.equal(env.navLink.dataset.authState, 'signed-out');
});

test('auth.js: 로그인 시 원래 페이지 주소(redirectTo)로 Google OAuth를 호출하고, 로그인 완료 시 GET /api/v1/me 호출·이니셜 표시·ulp:keys 캐시를 수행한다', async () => {
  const env = createMockEnv();
  await new Promise((r) => setTimeout(r, 10));

  await env.ULAuth.signIn();
  assert.equal(env.oauthCalls.length, 1);
  assert.equal(env.oauthCalls[0].provider, 'google');
  assert.equal(env.oauthCalls[0].options.redirectTo, 'http://localhost:3000/practice.html?v=jNQXAC9IVRw');

  // 로그인 세션 복귀 시뮬레이션
  env.triggerAuthChange('SIGNED_IN', {
    access_token: 'test-jwt-token',
    user: { id: '550e8400-e29b-41d4-a716-446655440000', email: 'player@example.com' },
  });
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(env.fetchCalls.length, 1);
  assert.equal(env.fetchCalls[0].url, '/api/v1/me');
  assert.equal(env.fetchCalls[0].opts.headers.Authorization, 'Bearer test-jwt-token');
  assert.equal(env.navLink.textContent, '홍길');
  assert.equal(env.navLink.dataset.authState, 'signed-in');

  const cachedKeys = JSON.parse(env.storage.get('ulp:keys'));
  assert.equal(cachedKeys.uid, '550e8400-e29b-41d4-a716-446655440000');
  assert.equal(cachedKeys.notion.hint, '1234');
  assert.equal(cachedKeys.gemini, null);

  // 로그아웃 시 ulp:keys 및 ulp:auth 즉시 삭제 확인 (FR-AUTH-1)
  env.storage.set('ulp:auth', '{"access_token":"test"}');
  await env.ULAuth.signOut();
  assert.equal(env.storage.has('ulp:keys'), false);
  assert.equal(env.storage.has('ulp:auth'), false);
  assert.equal(env.navLink.textContent, 'LOGIN');
  assert.equal(env.navLink.dataset.authState, 'signed-out');
});

test('auth.js: 노션 임베드 iframe 안에서는 LOGIN 링크에 target=_blank를 부여하고 signIn 호출 시 새 창으로 연다 (FR-AUTH-1)', async () => {
  const env = createMockEnv({ embedded: true });
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(env.navLink.getAttribute('target'), '_blank');
  assert.equal(env.navLink.getAttribute('rel'), 'noopener');

  await env.ULAuth.signIn();
  assert.equal(env.oauthCalls.length, 0);
  assert.equal(env.openedWindows.length, 1);
  assert.equal(env.openedWindows[0].t, '_blank');
});
