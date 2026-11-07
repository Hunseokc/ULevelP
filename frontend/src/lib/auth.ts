// frontend/src/lib/auth.ts
import { useEffect, useState } from 'react';
import type { SupabaseClientLike, SupabaseSessionLike, SupabaseUserLike } from '../vite-env';

export interface KeySummaryDto {
  hint: string;
  updatedAt: string;
}

export interface MeProfile {
  id: string;
  email: string;
  displayName: string;
  role: string;
  storageProvider: 'supabase' | 'drive' | string;
  driveFolderId: string | null;
  takeUsedBytes: number;
  takeQuotaBytes: number;
  migratedLocalAt: string | null;
  keys: {
    notion: KeySummaryDto | null;
    gemini: KeySummaryDto | null;
  };
}

export interface ProfilePatchInput {
  displayName?: string;
  storageProvider?: 'supabase' | 'drive';
  driveFolderId?: string | null;
  migratedLocalAt?: string | null;
}

export interface AuthState {
  configured: boolean;
  session: SupabaseSessionLike | null;
  user: SupabaseUserLike | null;
  me: MeProfile | null;
}

export interface ApiClientError extends Error {
  status?: number;
  code?: string;
  data?: unknown;
}

function createAuthModule() {
  const win: Record<string, any> = typeof window !== 'undefined' ? (window as any) : {};
  const cfg = win.ULEVELP_CONFIG || {};
  const supabaseUrl = String(cfg.supabaseUrl || '').trim().replace(/\/+$/, '');
  const supabaseAnonKey = String(cfg.supabaseAnonKey || '').trim();
  const apiBaseUrl = String(cfg.apiBaseUrl || '').trim().replace(/\/+$/, '');

  let client: SupabaseClientLike | null = null;
  if (win.supabase && typeof win.supabase.createClient === 'function' && supabaseUrl && supabaseAnonKey) {
    client = win.supabase.createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storageKey: 'ulp:auth',
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  let currentSession: SupabaseSessionLike | null = null;
  let currentMe: MeProfile | null = null;
  let lastFetchedUid: string | null = null;
  const listeners = new Set<(state: AuthState) => void>();

  function isConfigured(): boolean {
    return !!client;
  }

  function isEmbedded(): boolean {
    try {
      return typeof window !== 'undefined' && window.self !== window.top;
    } catch {
      return true;
    }
  }

  function stripHash(url?: string): string {
    const fallback = typeof location !== 'undefined' ? location.href : '';
    return String(url || fallback).split('#')[0];
  }

  function clearKeysCache(): void {
    try {
      localStorage.removeItem('ulp:keys');
    } catch {
      /* 저장 불가 무시 */
    }
  }

  function saveKeysCache(me: MeProfile | null): void {
    if (!me || !me.id) return;
    try {
      const payload = {
        uid: me.id,
        notion: me.keys && me.keys.notion ? me.keys.notion : null,
        gemini: me.keys && me.keys.gemini ? me.keys.gemini : null,
      };
      localStorage.setItem('ulp:keys', JSON.stringify(payload));
    } catch {
      /* 저장 불가 무시 */
    }
  }

  function computeInitial(user?: SupabaseUserLike | null, me?: MeProfile | null): string {
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

  function getSnapshot(): AuthState {
    return {
      configured: isConfigured(),
      session: currentSession,
      user: currentSession ? currentSession.user : null,
      me: currentMe,
    };
  }

  function notify(): void {
    const state = getSnapshot();
    listeners.forEach((fn) => {
      try {
        fn(state);
      } catch {
        /* 콜백 오류 격리 */
      }
    });
  }

  async function getAccessToken(): Promise<string> {
    if (!client) return '';
    try {
      const { data } = await client.auth.getSession();
      currentSession = data ? data.session || null : null;
      return currentSession ? currentSession.access_token : '';
    } catch {
      return currentSession ? currentSession.access_token : '';
    }
  }

  async function apiFetch<T = any>(path: string, opts?: RequestInit): Promise<T> {
    const options = opts || {};
    const token = await getAccessToken();
    const headers: Record<string, string> = Object.assign({}, (options.headers as Record<string, string>) || {});
    if (token) headers.Authorization = 'Bearer ' + token;
    if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
    }
    const url = (apiBaseUrl || '') + path;
    const res = await fetch(url, Object.assign({}, options, { headers }));
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      if (data && data.code === 'PROVIDER_KEY_INVALID') {
        clearKeysCache();
      }
      const msg = (data && (data.message || data.error)) || '요청 처리에 실패했어요 (' + res.status + ')';
      const err: ApiClientError = new Error(msg);
      err.status = res.status;
      err.code = data && data.code ? data.code : '';
      err.data = data;
      throw err;
    }
    return data as T;
  }

  async function fetchMe(): Promise<MeProfile | null> {
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
      const me = await apiFetch<MeProfile>('/api/v1/me');
      currentMe = me;
      lastFetchedUid = uid || (me ? me.id : null);
      saveKeysCache(me);
      notify();
      return me;
    } catch {
      currentMe = null;
      lastFetchedUid = null;
      clearKeysCache();
      notify();
      return null;
    }
  }

  async function signIn(redirectTo?: string): Promise<void> {
    if (isEmbedded()) {
      if (typeof window !== 'undefined' && typeof window.open === 'function') {
        window.open('settings.html#account', '_blank', 'noopener');
      }
      return;
    }
    if (!client) {
      throw new Error('public/config.js에 Supabase URL과 Publishable 키를 먼저 설정해 주세요.');
    }
    const target = stripHash(redirectTo);
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: target },
    });
    if (error) throw error;
  }

  async function signOut(): Promise<void> {
    clearKeysCache();
    currentMe = null;
    currentSession = null;
    lastFetchedUid = null;
    if (client) {
      try {
        await client.auth.signOut({ scope: 'local' });
      } catch {
        /* 네트워크 오류 무시 */
      }
    }
    try {
      localStorage.removeItem('ulp:auth');
    } catch {
      /* 저장 불가 무시 */
    }
    notify();
  }

  async function updateProfile(patch: ProfilePatchInput): Promise<MeProfile> {
    const updated = await apiFetch<MeProfile>('/api/v1/me', {
      method: 'PATCH',
      body: JSON.stringify(patch || {}),
    });
    currentMe = updated;
    lastFetchedUid = updated ? updated.id : lastFetchedUid;
    saveKeysCache(updated);
    notify();
    return updated;
  }

  async function deleteAccount(confirmText: string): Promise<{ ok: boolean }> {
    const res = await apiFetch<{ ok: boolean }>('/api/v1/me', {
      method: 'DELETE',
      body: JSON.stringify({ confirmText: String(confirmText || '') }),
    });
    await signOut();
    return res;
  }

  function onChange(fn: (state: AuthState) => void): () => void {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    try {
      fn(getSnapshot());
    } catch {
      /* 초기 콜백 오류 무시 */
    }
    return () => {
      listeners.delete(fn);
    };
  }

  async function init(): Promise<void> {
    if (!client) {
      notify();
      return;
    }
    try {
      const { data } = await client.auth.getSession();
      currentSession = data ? data.session || null : null;
      notify();
      if (currentSession) {
        await fetchMe();
      }
    } catch {
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

      const shouldFetch =
        event === 'USER_UPDATED' ||
        (event === 'SIGNED_IN' && (!currentMe || lastFetchedUid !== nextUid)) ||
        Boolean(nextUid && lastFetchedUid !== nextUid);

      if (shouldFetch) {
        void fetchMe();
      }
    });
  }

  void init();

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
}

export const auth = createAuthModule();

if (typeof window !== 'undefined' && !window.ULAuth) {
  window.ULAuth = auth;
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>(() => ({
    configured: auth.isConfigured(),
    session: auth.getSession(),
    user: auth.getUser(),
    me: auth.getMe(),
  }));

  useEffect(() => {
    return auth.onChange((next) => {
      setState(next);
    });
  }, []);

  return state;
}

