// 인증·계정 공통(auth.js): Supabase Auth(Google 공급자) 로그인·로그아웃, 상단 메뉴 계정 표시(FR-AUTH-1·5),
// Ktor 서버 /api/v1 호출 래퍼 및 내 프로필(/api/v1/me) 동기화
'use strict';
window.ULAuth = (function () {
  const cfg = window.ULEVELP_CONFIG || {};
  const supabaseUrl = String(cfg.supabaseUrl || '').trim().replace(/\/+$/, '');
  const supabaseAnonKey = String(cfg.supabaseAnonKey || '').trim();
  const apiBaseUrl = String(cfg.apiBaseUrl || '').trim().replace(/\/+$/, '');

  let client = null;
  if (window.supabase && typeof window.supabase.createClient === 'function' && supabaseUrl && supabaseAnonKey) {
    client = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storageKey: 'ulp:auth',
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  let currentSession = null;
  let currentMe = null;
  let lastFetchedUid = null;
  const listeners = new Set();

  function isConfigured() {
    return !!client;
  }

  function isEmbedded() {
    try { return window.self !== window.top; } catch (e) { return true; }
  }

  function stripHash(url) {
    return String(url || location.href).split('#')[0];
  }

  function clearKeysCache() {
    try { localStorage.removeItem('ulp:keys'); } catch (e) { /* 저장 불가 무시 */ }
  }

  function saveKeysCache(me) {
    if (!me || !me.id) return;
    try {
      const payload = {
        uid: me.id,
        notion: me.keys && me.keys.notion ? me.keys.notion : null,
        gemini: me.keys && me.keys.gemini ? me.keys.gemini : null,
      };
      localStorage.setItem('ulp:keys', JSON.stringify(payload));
    } catch (e) { /* 저장 불가 무시 */ }
  }

  function computeInitial(user, me) {
    const rawName = (
      (me && me.displayName) ||
      (user && user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) ||
      (user && user.email ? user.email.split('@')[0] : '') ||
      ''
    ).trim();
    if (!rawName) return 'ME';
    if (/^[가-힣]/.test(rawName)) return rawName.slice(0, 2);
    const parts = rawName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2 && /^[A-Za-z]/.test(parts[0]) && /^[A-Za-z]/.test(parts[1])) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return rawName.slice(0, 2).toUpperCase();
  }

  function ensureNavElements() {
    const els = [...document.querySelectorAll('#navAuth, [data-nav-auth]')];
    const linksWrap = document.querySelector('.site-nav .links');
    if (linksWrap && !linksWrap.querySelector('#navAuth, [data-nav-auth]')) {
      const a = document.createElement('a');
      a.id = 'navAuth';
      a.href = 'settings.html#account';
      a.textContent = 'LOGIN';
      linksWrap.appendChild(a);
      els.push(a);
    }
    const ppHead = document.querySelector('.pp-head');
    if (ppHead && !ppHead.querySelector('#navAuth, [data-nav-auth]')) {
      const a = document.createElement('a');
      a.id = 'navAuth';
      a.className = 'ghost pp-auth-btn';
      a.href = 'settings.html#account';
      a.textContent = 'LOGIN';
      ppHead.appendChild(a);
      els.push(a);
    }
    return els;
  }

  function renderNav() {
    const els = ensureNavElements();
    const user = currentSession && currentSession.user ? currentSession.user : null;
    els.forEach((el) => {
      if (user) {
        const label = computeInitial(user, currentMe);
        el.textContent = label;
        el.setAttribute('href', 'settings.html#account');
        el.removeAttribute('target');
        el.removeAttribute('rel');
        el.setAttribute('aria-label', '계정 설정 (' + (user.email || label) + ')');
        el.dataset.authState = 'signed-in';
      } else {
        el.textContent = 'LOGIN';
        el.setAttribute('href', 'settings.html#account');
        el.setAttribute('aria-label', 'Google 계정으로 로그인');
        el.dataset.authState = 'signed-out';
        if (isEmbedded()) {
          el.setAttribute('target', '_blank');
          el.setAttribute('rel', 'noopener');
        } else {
          el.removeAttribute('target');
          el.removeAttribute('rel');
        }
      }
      if (!el.dataset.authBound) {
        el.dataset.authBound = '1';
        el.addEventListener('click', async (e) => {
          if (currentSession && currentSession.user) return;
          if (isEmbedded()) return;
          if (!isConfigured()) return;
          e.preventDefault();
          try {
            await signIn();
          } catch (err) {
            location.href = 'settings.html#account';
          }
        });
      }
    });
  }

  function notify() {
    renderNav();
    const state = {
      configured: isConfigured(),
      session: currentSession,
      user: currentSession ? currentSession.user : null,
      me: currentMe,
    };
    listeners.forEach((fn) => {
      try { fn(state); } catch (e) { /* 콜백 오류 격리 */ }
    });
  }

  async function getAccessToken() {
    if (!client) return '';
    try {
      const { data } = await client.auth.getSession();
      currentSession = data ? data.session : null;
      return currentSession ? currentSession.access_token : '';
    } catch (e) {
      return currentSession ? currentSession.access_token : '';
    }
  }

  async function apiFetch(path, opts) {
    opts = opts || {};
    const token = await getAccessToken();
    const headers = Object.assign({}, opts.headers || {});
    if (token) headers.Authorization = 'Bearer ' + token;
    if (opts.body && typeof opts.body === 'string' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
    }
    const url = (apiBaseUrl || '') + path;
    const res = await fetch(url, Object.assign({}, opts, { headers }));
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      if (data && data.code === 'PROVIDER_KEY_INVALID') {
        clearKeysCache();
      }
      const msg = (data && (data.message || data.error)) || ('요청 처리에 실패했어요 (' + res.status + ')');
      const err = new Error(msg);
      err.status = res.status;
      err.code = data && data.code ? data.code : '';
      err.data = data;
      throw err;
    }
    return data;
  }

  async function fetchMe() {
    if (!currentSession || !currentSession.access_token) {
      currentMe = null;
      lastFetchedUid = null;
      clearKeysCache();
      notify();
      return null;
    }
    const uid = currentSession.user ? currentSession.user.id : null;
    if (currentMe && uid && currentMe.id !== uid) {
      currentMe = null;
      clearKeysCache();
    }
    try {
      const me = await apiFetch('/api/v1/me');
      currentMe = me;
      lastFetchedUid = uid || (me ? me.id : null);
      saveKeysCache(me);
      notify();
      return me;
    } catch (e) {
      currentMe = null;
      lastFetchedUid = null;
      clearKeysCache();
      notify();
      return null;
    }
  }

  async function signIn(redirectTo) {
    if (isEmbedded()) {
      window.open('settings.html#account', '_blank', 'noopener');
      return;
    }
    if (!client) {
      throw new Error('public/config.js에 Supabase URL과 Publishable 키를 먼저 설정해 주세요.');
    }
    const target = stripHash(redirectTo || location.href);
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: target },
    });
    if (error) throw error;
  }

  async function signOut() {
    clearKeysCache();
    currentMe = null;
    currentSession = null;
    lastFetchedUid = null;
    if (client) {
      try { await client.auth.signOut({ scope: 'local' }); } catch (e) { /* 네트워크 오류 무시 */ }
    }
    try { localStorage.removeItem('ulp:auth'); } catch (e) { /* 저장 불가 무시 */ }
    notify();
  }

  async function updateProfile(patch) {
    const updated = await apiFetch('/api/v1/me', {
      method: 'PATCH',
      body: JSON.stringify(patch || {}),
    });
    currentMe = updated;
    lastFetchedUid = updated ? updated.id : lastFetchedUid;
    saveKeysCache(updated);
    notify();
    return updated;
  }

  async function deleteAccount(confirmText) {
    const res = await apiFetch('/api/v1/me', {
      method: 'DELETE',
      body: JSON.stringify({ confirmText: String(confirmText || '') }),
    });
    await signOut();
    return res;
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    try {
      fn({
        configured: isConfigured(),
        session: currentSession,
        user: currentSession ? currentSession.user : null,
        me: currentMe,
      });
    } catch (e) { /* 초기 콜백 오류 무시 */ }
    return () => listeners.delete(fn);
  }

  async function init() {
    renderNav();
    if (!client) {
      notify();
      return;
    }
    try {
      const { data } = await client.auth.getSession();
      currentSession = data ? data.session : null;
      notify();
      if (currentSession) {
        await fetchMe();
      }
    } catch (e) {
      notify();
    }

    client.auth.onAuthStateChange((event, session) => {
      const prevUid = currentSession && currentSession.user ? currentSession.user.id : null;
      const nextUid = session && session.user ? session.user.id : null;
      currentSession = session || null;

      if (event === 'SIGNED_OUT' || !session) {
        currentMe = null;
        lastFetchedUid = null;
        clearKeysCache();
        notify();
        return;
      }

      if (prevUid && nextUid && prevUid !== nextUid) {
        currentMe = null;
        lastFetchedUid = null;
        clearKeysCache();
      }

      notify();

      const shouldFetch = (
        event === 'USER_UPDATED' ||
        (event === 'SIGNED_IN' && (!currentMe || lastFetchedUid !== nextUid)) ||
        (nextUid && lastFetchedUid !== nextUid)
      );
      if (shouldFetch) {
        fetchMe();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    isConfigured,
    isEmbedded,
    stripHash,
    getClient: () => client,
    getSession: () => currentSession,
    getUser: () => (currentSession ? currentSession.user : null),
    getMe: () => currentMe,
    getAccessToken,
    apiFetch,
    fetchMe,
    signIn,
    signOut,
    updateProfile,
    deleteAccount,
    clearKeysCache,
    computeInitial,
    onChange,
  };
})();

