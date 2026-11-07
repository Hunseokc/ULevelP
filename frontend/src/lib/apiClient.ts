// frontend/src/lib/apiClient.ts
import { auth, ApiClientError, KeySummaryDto, MeProfile, ProfilePatchInput } from './auth';

export interface SongDto {
  id: string;
  title: string;
  artist: string;
  status: string;
  statusCode: string;
  videoId: string;
  pos: number | null;
  a: number | null;
  b: number | null;
  rate: number;
  lastDate: string | null;
  memo: string;
  categoryIds: string[];
  totalSeconds: number;
  resumeUrl: string;
}

export interface CategoryDto {
  id: string;
  name: string;
  sortOrder: number;
  onHome: boolean;
  songCount: number;
}

export interface TakeDto {
  id: string;
  sessionId: string;
  recordedAt: string;
  a: number | null;
  b: number | null;
  rate: number | null;
  durationSec: number;
  mime: string;
  sizeBytes: number;
  storage: 'supabase' | 'drive' | string;
  storageKey: string;
  memo: string;
}

export interface SongSessionDto {
  id: string;
  date: string;
  seconds: number;
  minutes: number;
  loops: number;
  a: number | null;
  b: number | null;
  segment: string;
  rate: number | null;
  memo: string;
}

export interface SongDetailResponse {
  song: SongDto;
  sessions: SongSessionDto[];
  takes: TakeDto[];
}

export interface SessionSummaryDto {
  thisWeekSeconds: number;
  thisMonthSeconds: number;
}

export interface CalendarDayDto {
  date: string;
  totalSeconds: number;
  level: number;
}

export interface SessionWithSongDto extends SongSessionDto {
  songId: string;
  songTitle: string;
  songArtist: string;
  videoId: string;
  takes: TakeDto[];
}

export interface SessionListResponse {
  summary: SessionSummaryDto;
  calendar: CalendarDayDto[];
  sessions: SessionWithSongDto[];
}

export interface SaveProgressInput {
  songId: string;
  pos?: number | null;
  a?: number | null;
  b?: number | null;
  rate?: number | null;
  date: string;
  addSeconds?: number;
  addLoops?: number;
}

export interface SaveProgressResponse {
  ok: boolean;
  keep: boolean;
  sessionId?: string | null;
  totalSeconds?: number | null;
  minutes?: number | null;
  pendingSeconds?: number | null;
}

export interface TakeUploadMeta {
  songId: string;
  date: string;
  recordedAt: string;
  a?: number | null;
  b?: number | null;
  rate?: number | null;
  durationSec: number;
  mime: string;
  replaceOldSongTakes?: boolean;
}

export interface DriveTakeRegisterMeta extends TakeUploadMeta {
  sizeBytes: number;
  storageKey?: string;
  driveFileId?: string;
}

export interface IntegrationDto {
  provider: 'notion' | 'gemini' | string;
  hint: string;
  config: Record<string, any>;
  updatedAt: string;
  verified?: boolean;
  displayName?: string | null;
}

export interface SaveNotionInput {
  token?: string | null;
  songsDb: string;
  sessionsDb: string;
  notesDb?: string | null;
}

export interface SaveGeminiInput {
  apiKey?: string | null;
  model?: string;
  verify?: boolean;
}

export interface NotionSyncStatusDto {
  enabled: boolean;
  pending: number;
  failed: number;
  lastPushAt?: string | null;
  lastPullAt?: string | null;
  lastError?: string | null;
}

export interface AnalysisJobDto {
  id: string;
  kind?: 'note' | 'progression' | string;
  url: string;
  tags: string[];
  status: 'queued' | 'running' | 'done' | 'failed' | string;
  error?: string | null;
  noteId?: string | null;
  /** 코드 진행 영상 작업의 분석 구간(초)·속도 (GA-2). 노트 작업은 null */
  startSec?: number | null;
  endSec?: number | null;
  pace?: 'slow' | 'normal' | 'fast' | string | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface NoteSummaryDto {
  id: string;
  videoId: string;
  url: string;
  title: string;
  channel: string;
  tags: string[];
  memo: string;
  headline: string;
  points: string[];
  keywords: string[];
  difficulty?: string | null;
  model: string;
  collectProgressions?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NoteDetailDto extends NoteSummaryDto {
  analysis: Record<string, any>;
  diagramsSvg: string[];
}

// 코드 진행 모음 (docs/03-api-spec.md 8.5, 결과/CH-1b_설계.md §3)
export interface ProgressionChordDto {
  symbol: string;
  roman: string;
  source?: '화면' | '말함' | '추정' | string;
  timestamp?: string;
}

export interface ProgressionDto {
  id: string;
  kind: 'reference' | 'analysis';
  origin: 'ai' | 'manual';
  route: 'video' | 'note' | 'manual';
  evidence: '화면' | '말함' | '추정' | null;
  title: string;
  part: string;
  artist: string;
  album: string;
  channel: string;
  releaseDate: string | null;
  key: string | null;
  instrument: '건반' | '기타' | null;
  chords: ProgressionChordDto[];
  moods: string[];
  genres: string[];
  tags: string[];
  url: string;
  videoId: string | null;
  startSec: number | null;
  endSec: number | null;
  memo: string;
  noteId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ProgressionScope = 'reference' | 'analysis' | 'all';

// POST 본문(kind·title·chords 필수) / PATCH 본문(보낸 필드만)
export interface ProgressionInput {
  kind?: 'reference' | 'analysis';
  title?: string;
  chords?: ProgressionChordDto[];
  part?: string;
  artist?: string;
  album?: string;
  channel?: string;
  releaseDate?: string | null;
  key?: string | null;
  moods?: string[];
  genres?: string[];
  tags?: string[];
  url?: string;
  startSec?: number | null;
  endSec?: number | null;
  memo?: string;
}

export interface NoteCollectResult {
  noteId: string;
  collect: boolean;
  progressions: ProgressionDto[];
}

export interface LocalMigrationResult {
  status: 'skipped' | 'done' | 'failed';
  created: number;
  skipped: number;
  message: string;
}

export interface LocalSongRecord {
  videoId: string;
  pos: number | null;
  a: number | null;
  b: number | null;
  rate: number | null;
  date: string | null;
}

const EXT: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/webm': 'weba',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/aac': 'aac',
};

function getAuthRef() {
  const win: Record<string, any> = typeof window !== 'undefined' ? (window as any) : {};
  return win.ULAuth || auth;
}

let migrating = false;

function isLoggedIn(): boolean {
  const A = getAuthRef();
  const sess = A && typeof A.getSession === 'function' ? A.getSession() : null;
  return !!(sess && sess.access_token);
}

function requireLogin(): void {
  if (!isLoggedIn()) {
    const err: ApiClientError = new Error('로그인이 필요해요');
    err.code = 'NOT_LOGGED_IN';
    err.status = 401;
    throw err;
  }
}

async function listSongs(status?: string): Promise<SongDto[]> {
  requireLogin();
  let path = '/api/v1/songs';
  if (status) path += '?status=' + encodeURIComponent(status);
  const r = await getAuthRef().apiFetch(path);
  return r && Array.isArray(r.songs) ? r.songs : [];
}

async function byVideo(videoId: string): Promise<SongDto | null> {
  requireLogin();
  const path = '/api/v1/songs/by-video/' + encodeURIComponent(videoId);
  const r = await getAuthRef().apiFetch(path);
  return r && r.song !== undefined ? r.song : null;
}

async function createSong(input: { videoId: string; title?: string; artist?: string; rate?: number }): Promise<SongDto | null> {
  requireLogin();
  const body = JSON.stringify({
    videoId: input?.videoId,
    title: input?.title,
    artist: input?.artist,
    rate: input?.rate,
  });
  const r = await getAuthRef().apiFetch('/api/v1/songs', {
    method: 'POST',
    body,
  });
  return r ? r.song : null;
}

async function getSong(songId: string): Promise<SongDetailResponse> {
  requireLogin();
  const path = '/api/v1/songs/' + encodeURIComponent(songId);
  return await getAuthRef().apiFetch(path);
}

async function updateSong(
  songId: string,
  patch: { status?: string; memo?: string; title?: string; categoryIds?: string[] }
): Promise<SongDto | null> {
  requireLogin();
  const body: Record<string, unknown> = {};
  if (patch && typeof patch === 'object') {
    if (patch.status !== undefined) body.status = patch.status;
    if (patch.memo !== undefined) body.memo = patch.memo;
    if (patch.title !== undefined) body.title = patch.title;
    if (patch.categoryIds !== undefined) body.categoryIds = patch.categoryIds;
  }
  const path = '/api/v1/songs/' + encodeURIComponent(songId);
  const r = await getAuthRef().apiFetch(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return r ? r.song : null;
}

// 곡 분류 (docs/03-api-spec.md 3.7). 응답이 비거나 모양이 다르면 빈 목록
function categoryList(r: any): CategoryDto[] {
  return r && Array.isArray(r.categories) ? r.categories : [];
}

async function listCategories(): Promise<CategoryDto[]> {
  requireLogin();
  const r = await getAuthRef().apiFetch('/api/v1/categories');
  return categoryList(r);
}

async function createCategory(name: string): Promise<CategoryDto | null> {
  requireLogin();
  const r = await getAuthRef().apiFetch('/api/v1/categories', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  return r ? r.category : null;
}

async function updateCategory(
  categoryId: string,
  patch: { name?: string; onHome?: boolean }
): Promise<CategoryDto | null> {
  requireLogin();
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.onHome !== undefined) body.onHome = patch.onHome;
  const r = await getAuthRef().apiFetch('/api/v1/categories/' + encodeURIComponent(categoryId), {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return r ? r.category : null;
}

async function reorderCategories(ids: string[]): Promise<CategoryDto[]> {
  requireLogin();
  const r = await getAuthRef().apiFetch('/api/v1/categories/order', {
    method: 'PUT',
    body: JSON.stringify({ ids }),
  });
  return categoryList(r);
}

async function removeCategory(categoryId: string): Promise<{ ok: boolean }> {
  requireLogin();
  await getAuthRef().apiFetch('/api/v1/categories/' + encodeURIComponent(categoryId), {
    method: 'DELETE',
  });
  return { ok: true };
}

async function removeSong(songId: string): Promise<{ ok: boolean }> {
  requireLogin();
  const path = '/api/v1/songs/' + encodeURIComponent(songId);
  await getAuthRef().apiFetch(path, {
    method: 'DELETE',
  });
  return { ok: true };
}

function saveProgress(
  body: SaveProgressInput,
  opts?: { keepalive?: boolean }
): Promise<SaveProgressResponse> {
  try {
    requireLogin();
  } catch (e) {
    return Promise.reject(e);
  }
  const input = body || ({} as SaveProgressInput);
  const options = opts || {};
  const payload = {
    songId: input.songId,
    pos: input.pos,
    a: input.a,
    b: input.b,
    rate: input.rate,
    date: input.date,
    addSeconds: input.addSeconds,
    addLoops: input.addLoops,
  };
  const jsonBody = JSON.stringify(payload);
  const A = getAuthRef();

  if (options.keepalive === true) {
    const sess = A.getSession();
    const token = sess ? sess.access_token : '';
    const win: Record<string, any> = typeof window !== 'undefined' ? (window as any) : {};
    const apiBaseUrl = (win.ULEVELP_CONFIG && win.ULEVELP_CONFIG.apiBaseUrl) || '';
    const url = (apiBaseUrl ? String(apiBaseUrl).replace(/\/+$/, '') : '') + '/api/v1/practice/save';
    return fetch(url, {
      method: 'POST',
      keepalive: true,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: jsonBody,
    }).then(async (res) => {
      const data = res.status === 204 ? null : await res.json().catch(() => null);
      if (!res.ok) {
        const msg = (data && (data.message || data.error)) || '요청 처리에 실패했어요 (' + res.status + ')';
        const err: ApiClientError = new Error(msg);
        err.status = res.status;
        err.code = data && data.code ? data.code : '';
        err.data = data;
        throw err;
      }
      return data as SaveProgressResponse;
    });
  }

  return A.apiFetch('/api/v1/practice/save', {
    method: 'POST',
    body: jsonBody,
  });
}

async function uploadTake(meta: TakeUploadMeta, blob: Blob): Promise<TakeDto | null> {
  const A = getAuthRef();
  const win: Record<string, any> = typeof window !== 'undefined' ? (window as any) : {};
  const me = A && typeof A.getMe === 'function' ? A.getMe() : null;
  if (me && me.storageProvider === 'drive' && win.ULDrive && typeof win.ULDrive.uploadTake === 'function') {
    requireLogin();
    return await win.ULDrive.uploadTake(meta, blob);
  }
  requireLogin();
  const m = meta || ({} as TakeUploadMeta);
  const metaPayload: Record<string, unknown> = {
    songId: m.songId,
    date: m.date,
    recordedAt: m.recordedAt,
    a: m.a,
    b: m.b,
    rate: m.rate,
    durationSec: m.durationSec,
    mime: m.mime,
  };
  if (m.replaceOldSongTakes === true) {
    metaPayload.replaceOldSongTakes = true;
  }
  const ext = EXT[m.mime] || 'webm';
  const filename = 'take.' + ext;
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metaPayload)], { type: 'application/json' }));
  form.append('file', blob, filename);
  const r = await A.apiFetch('/api/v1/takes', {
    method: 'POST',
    body: form,
  });
  return r ? r.take : null;
}

function readLocal(prefix: string): LocalSongRecord[] {
  const out: LocalSongRecord[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      const vid = k.slice(prefix.length);
      if (!/^[\w-]{11}$/.test(vid)) continue;
      let parsed: any = null;
      try {
        const raw = localStorage.getItem(k);
        parsed = raw ? JSON.parse(raw) : null;
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== 'object') continue;
      const pos = typeof parsed.pos === 'number' && isFinite(parsed.pos) ? parsed.pos : null;
      const a = typeof parsed.a === 'number' && isFinite(parsed.a) ? parsed.a : null;
      const b = typeof parsed.b === 'number' && isFinite(parsed.b) ? parsed.b : null;
      const rate = typeof parsed.rate === 'number' && isFinite(parsed.rate) ? parsed.rate : null;
      const date = typeof parsed.date === 'string' ? parsed.date : null;
      out.push({ videoId: vid, pos, a, b, rate, date });
    }
  } catch {
    return [];
  }
  return out;
}

export function listLocalSongs(): LocalSongRecord[] {
  const items = readLocal('ulp:v:');
  items.sort((x, y) => {
    if (x.date && y.date) return y.date.localeCompare(x.date);
    if (x.date) return -1;
    if (y.date) return 1;
    return 0;
  });
  return items;
}

async function listSessions(params?: { from?: string; to?: string; today?: string }): Promise<SessionListResponse> {
  requireLogin();
  const p = params || {};
  const qs = new URLSearchParams();
  if (p.from) qs.set('from', p.from);
  if (p.to) qs.set('to', p.to);
  if (p.today) qs.set('today', p.today);
  const queryString = qs.toString();
  const path = '/api/v1/sessions' + (queryString ? '?' + queryString : '');
  return await getAuthRef().apiFetch(path);
}

async function updateMemo(sessionId: string, memo: string): Promise<{ ok: boolean }> {
  requireLogin();
  const path = '/api/v1/sessions/' + encodeURIComponent(sessionId);
  return await getAuthRef().apiFetch(path, {
    method: 'PATCH',
    body: JSON.stringify({ memo: String(memo ?? '') }),
  });
}

async function getTakeUrl(takeId: string): Promise<{ url: string; expiresIn: number }> {
  requireLogin();
  const path = '/api/v1/takes/' + encodeURIComponent(takeId) + '/url';
  return await getAuthRef().apiFetch(path);
}

async function removeTake(takeId: string): Promise<{ ok: boolean }> {
  requireLogin();
  const path = '/api/v1/takes/' + encodeURIComponent(takeId);
  return await getAuthRef().apiFetch(path, {
    method: 'DELETE',
  });
}

async function runLocalMigration(): Promise<LocalMigrationResult> {
  if (!isLoggedIn()) {
    return { status: 'skipped', created: 0, skipped: 0, message: '' };
  }
  const A = getAuthRef();
  const me = A && typeof A.getMe === 'function' ? A.getMe() : null;
  if (!me || me.migratedLocalAt != null || migrating) {
    return { status: 'skipped', created: 0, skipped: 0, message: '' };
  }

  const own = readLocal('ulp:v:');
  const sister = readLocal('pp:v:');
  const ownVids = new Set(own.map((it) => it.videoId));
  const filteredSister = sister.filter((it) => !ownVids.has(it.videoId));

  if (own.length === 0 && filteredSister.length === 0) {
    return { status: 'skipped', created: 0, skipped: 0, message: '' };
  }

  migrating = true;
  try {
    const items: typeof own = [];
    const confirmFn = typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm : () => true;
    if (own.length > 0) {
      const ok = confirmFn('이 기기에서 연습하던 기록 ' + own.length + '곡을 계정으로 옮길까요?');
      if (ok) items.push(...own);
    }
    if (filteredSister.length > 0) {
      const ok = confirmFn(
        '같은 기기의 guitar-practice 기록 ' + filteredSister.length + '곡도 가져올까요? (원래 기록은 그대로 남아요)'
      );
      if (ok) items.push(...filteredSister);
    }

    items.sort((x, y) => {
      if (x.date && y.date) return y.date.localeCompare(x.date);
      if (x.date) return -1;
      if (y.date) return 1;
      return 0;
    });
    const topItems = items.slice(0, 100);

    const r = await A.apiFetch('/api/v1/songs/migrate-local', {
      method: 'POST',
      body: JSON.stringify({ items: topItems, markMigrated: true }),
    });

    if (A && typeof A.fetchMe === 'function') {
      await A.fetchMe();
    }
    return {
      status: 'done',
      created: r && typeof r.created === 'number' ? r.created : 0,
      skipped: r && typeof r.skipped === 'number' ? r.skipped : 0,
      message: '',
    };
  } catch (e: any) {
    return {
      status: 'failed',
      created: 0,
      skipped: 0,
      message: (e && e.message) || '기기 기록을 옮기지 못했어요',
    };
  } finally {
    migrating = false;
  }
}

async function exportZip(includeAudio?: boolean): Promise<{ blob: Blob; filename: string }> {
  requireLogin();
  const A = getAuthRef();
  const sess = A && typeof A.getSession === 'function' ? A.getSession() : null;
  const token = sess && sess.access_token ? sess.access_token : '';
  const qs = '?includeAudio=' + (includeAudio !== false);
  const res = await fetch('/api/v1/export/zip' + qs, {
    headers: {
      Authorization: 'Bearer ' + token,
    },
  });
  if (!res.ok) {
    let errData: any = {};
    try {
      errData = await res.json();
    } catch {
      /* ignore */
    }
    const msg = (errData && (errData.message || errData.error)) || '내보내기에 실패했어요 (' + res.status + ')';
    const err: ApiClientError = new Error(msg);
    err.status = res.status;
    err.code = (errData && errData.code) || 'EXPORT_ERROR';
    err.data = errData;
    throw err;
  }
  const cd = res.headers.get('content-disposition') || '';
  let filename = 'ULeveLP-export.zip';
  const match = cd.match(/filename="?([^"]+)"?/);
  if (match && match[1]) {
    filename = match[1];
  }
  const blob = await res.blob();
  return { blob, filename };
}

async function previewNotionZip(file: Blob & { name?: string }) {
  requireLogin();
  const form = new FormData();
  form.append('file', file, (file && file.name) || 'backup.zip');
  return await getAuthRef().apiFetch('/api/v1/import/notion/preview', {
    method: 'POST',
    body: form,
  });
}

async function confirmNotionZip(previewToken: string) {
  requireLogin();
  return await getAuthRef().apiFetch('/api/v1/import/notion/confirm', {
    method: 'POST',
    body: JSON.stringify({ previewToken: String(previewToken || '') }),
  });
}

function getCachedKeys(): { notion: KeySummaryDto | null; gemini: KeySummaryDto | null } {
  try {
    const raw = localStorage.getItem('ulp:keys');
    if (!raw) return { notion: null, gemini: null };
    const parsed = JSON.parse(raw);
    const A = getAuthRef();
    const user = A && typeof A.getUser === 'function' ? A.getUser() : null;
    if (user && user.id && parsed && parsed.uid === user.id) {
      return {
        notion: parsed.notion || null,
        gemini: parsed.gemini || null,
      };
    }
  } catch {
    /* ignore */
  }
  return { notion: null, gemini: null };
}

async function listIntegrations(): Promise<IntegrationDto[]> {
  requireLogin();
  const r = await getAuthRef().apiFetch('/api/v1/integrations?appId=ulevelp');
  return r && Array.isArray(r.integrations) ? r.integrations : [];
}

async function saveNotionIntegration(input: SaveNotionInput): Promise<IntegrationDto> {
  requireLogin();
  const A = getAuthRef();
  const body = JSON.stringify({
    appId: 'ulevelp',
    token: input?.token,
    songsDb: input?.songsDb,
    sessionsDb: input?.sessionsDb,
    notesDb: input?.notesDb,
  });
  const r = await A.apiFetch('/api/v1/integrations/notion', {
    method: 'PUT',
    body,
  });
  if (A && typeof A.fetchMe === 'function') {
    await A.fetchMe();
  }
  return r;
}

async function saveGeminiIntegration(input: SaveGeminiInput): Promise<IntegrationDto> {
  requireLogin();
  const A = getAuthRef();
  const payload: Record<string, unknown> = {
    appId: 'ulevelp',
    apiKey: input?.apiKey,
    model: input?.model,
  };
  if (input && input.verify !== undefined) {
    payload.verify = Boolean(input.verify);
  }
  const r = await A.apiFetch('/api/v1/integrations/gemini', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  if (A && typeof A.fetchMe === 'function') {
    await A.fetchMe();
  }
  return r;
}

async function checkIntegration(provider: 'notion' | 'gemini' | string) {
  requireLogin();
  const path = '/api/v1/integrations/' + encodeURIComponent(provider) + '/check?appId=ulevelp';
  return await getAuthRef().apiFetch(path, {
    method: 'POST',
  });
}

async function removeIntegration(provider: 'notion' | 'gemini' | string): Promise<{ ok: boolean }> {
  requireLogin();
  const A = getAuthRef();
  const path = '/api/v1/integrations/' + encodeURIComponent(provider) + '?appId=ulevelp';
  const r = await A.apiFetch(path, {
    method: 'DELETE',
  });
  if (A && typeof A.fetchMe === 'function') {
    await A.fetchMe();
  }
  return r && r.ok ? r : { ok: true };
}

async function syncStatus(): Promise<NotionSyncStatusDto> {
  requireLogin();
  return await getAuthRef().apiFetch('/api/v1/notion/sync/status');
}

async function syncEnable() {
  requireLogin();
  return await getAuthRef().apiFetch('/api/v1/notion/sync/enable', {
    method: 'POST',
  });
}

async function syncDisable() {
  requireLogin();
  return await getAuthRef().apiFetch('/api/v1/notion/sync/disable', {
    method: 'POST',
  });
}

async function syncPull() {
  requireLogin();
  return await getAuthRef().apiFetch('/api/v1/notion/sync/pull', {
    method: 'POST',
  });
}

async function syncPush() {
  requireLogin();
  return await getAuthRef().apiFetch('/api/v1/notion/sync/push', {
    method: 'POST',
  });
}

function clearCachedGeminiKey(): void {
  try {
    const raw = localStorage.getItem('ulp:keys');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      parsed.gemini = null;
      localStorage.setItem('ulp:keys', JSON.stringify(parsed));
    }
  } catch {
    /* ignore */
  }
}

function checkJobsForInvalidKey(jobs: AnalysisJobDto[]): void {
  if (!Array.isArray(jobs)) return;
  const hasInvalid = jobs.some(
    (j) => j && j.status === 'failed' && typeof j.error === 'string' && j.error.startsWith('PROVIDER_KEY_INVALID:')
  );
  if (hasInvalid) {
    clearCachedGeminiKey();
  }
}

async function noteAnalyze(input: { url: string; tags: string[]; memo?: string }): Promise<{ jobId: string; status: string }> {
  requireLogin();
  try {
    const r = await getAuthRef().apiFetch('/api/v1/notes/analyze', {
      method: 'POST',
      body: JSON.stringify({
        url: input?.url,
        tags: input?.tags,
        memo: input?.memo,
      }),
    });
    return { jobId: r.jobId, status: r.status };
  } catch (err: any) {
    if (err && (err.code === 'NO_KEY' || err.status === 412)) {
      clearCachedGeminiKey();
    }
    throw err;
  }
}

async function listNoteJobs(): Promise<AnalysisJobDto[]> {
  requireLogin();
  const r = await getAuthRef().apiFetch('/api/v1/notes/jobs');
  const jobs = r && Array.isArray(r.jobs) ? r.jobs : [];
  checkJobsForInvalidKey(jobs);
  return jobs;
}

async function getNoteJob(jobId: string): Promise<AnalysisJobDto> {
  requireLogin();
  const path = '/api/v1/notes/jobs/' + encodeURIComponent(jobId);
  const r = await getAuthRef().apiFetch(path);
  if (r) {
    checkJobsForInvalidKey([r]);
  }
  return r;
}

async function listNotes(tag?: string): Promise<NoteSummaryDto[]> {
  requireLogin();
  let path = '/api/v1/notes';
  if (tag) path += '?tag=' + encodeURIComponent(tag);
  const r = await getAuthRef().apiFetch(path);
  return r && Array.isArray(r.notes) ? r.notes : [];
}

async function getNote(noteId: string): Promise<NoteDetailDto | null> {
  requireLogin();
  const path = '/api/v1/notes/' + encodeURIComponent(noteId);
  const r = await getAuthRef().apiFetch(path);
  return r && r.note ? r.note : null;
}

async function updateNote(
  noteId: string,
  patch: { memo?: string; tags?: string[]; title?: string }
): Promise<NoteDetailDto | null> {
  requireLogin();
  const body: Record<string, unknown> = {};
  if (patch) {
    if (patch.memo !== undefined) body.memo = patch.memo;
    if (patch.tags !== undefined) body.tags = patch.tags;
    if (patch.title !== undefined) body.title = patch.title;
  }
  const path = '/api/v1/notes/' + encodeURIComponent(noteId);
  const r = await getAuthRef().apiFetch(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return r && r.note ? r.note : null;
}

async function removeNote(noteId: string): Promise<{ ok: boolean }> {
  requireLogin();
  const path = '/api/v1/notes/' + encodeURIComponent(noteId);
  await getAuthRef().apiFetch(path, {
    method: 'DELETE',
  });
  return { ok: true };
}

async function setNoteCollect(noteId: string, collect: boolean): Promise<NoteCollectResult> {
  requireLogin();
  const path = '/api/v1/notes/' + encodeURIComponent(noteId) + '/collect';
  const r = await getAuthRef().apiFetch(path, {
    method: 'PUT',
    body: JSON.stringify({ collect }),
  });
  return {
    noteId: r && r.noteId ? r.noteId : noteId,
    collect: Boolean(r && r.collect),
    progressions: r && Array.isArray(r.progressions) ? r.progressions : [],
  };
}

async function listProgressions(scope?: ProgressionScope): Promise<ProgressionDto[]> {
  requireLogin();
  let path = '/api/v1/progressions';
  if (scope) path += '?scope=' + encodeURIComponent(scope);
  const r = await getAuthRef().apiFetch(path);
  return r && Array.isArray(r.progressions) ? r.progressions : [];
}

async function createProgression(input: ProgressionInput): Promise<ProgressionDto | null> {
  requireLogin();
  const r = await getAuthRef().apiFetch('/api/v1/progressions', {
    method: 'POST',
    body: JSON.stringify(input || {}),
  });
  return r && r.progression ? r.progression : null;
}

async function updateProgression(progressionId: string, patch: ProgressionInput): Promise<ProgressionDto | null> {
  requireLogin();
  const path = '/api/v1/progressions/' + encodeURIComponent(progressionId);
  const r = await getAuthRef().apiFetch(path, {
    method: 'PATCH',
    body: JSON.stringify(patch || {}),
  });
  return r && r.progression ? r.progression : null;
}

async function removeProgression(progressionId: string): Promise<{ ok: boolean }> {
  requireLogin();
  const path = '/api/v1/progressions/' + encodeURIComponent(progressionId);
  await getAuthRef().apiFetch(path, {
    method: 'DELETE',
  });
  return { ok: true };
}

async function analyzeProgression(input: {
  url: string;
  memo?: string;
  startSec?: number | null;
  endSec?: number | null;
  pace?: 'slow' | 'normal' | 'fast';
  /** GA-4: 24시간 안 같은 분석(409 DUPLICATE_ANALYSIS)을 일부러 다시 할 때 */
  force?: boolean;
}): Promise<{ jobId: string; status: string }> {
  requireLogin();
  try {
    const body: Record<string, unknown> = { url: input?.url, memo: input?.memo };
    if (typeof input?.startSec === 'number') body.startSec = input.startSec;
    if (typeof input?.endSec === 'number') body.endSec = input.endSec;
    if (input?.pace) body.pace = input.pace;
    if (input?.force === true) body.force = true;
    const r = await getAuthRef().apiFetch('/api/v1/progressions/analyze', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { jobId: r.jobId, status: r.status };
  } catch (err: any) {
    if (err && (err.code === 'NO_KEY' || err.status === 412)) {
      clearCachedGeminiKey();
    }
    throw err;
  }
}

async function updateMe(patch: ProfilePatchInput): Promise<MeProfile> {
  requireLogin();
  const A = getAuthRef();
  if (A && typeof A.updateProfile === 'function') {
    return await A.updateProfile(patch);
  }
  const updated = await A.apiFetch('/api/v1/me', {
    method: 'PATCH',
    body: JSON.stringify(patch || {}),
  });
  if (A && typeof A.fetchMe === 'function') {
    await A.fetchMe();
  }
  return updated;
}

async function registerDriveTake(meta: DriveTakeRegisterMeta): Promise<TakeDto> {
  requireLogin();
  const payload = {
    songId: meta?.songId,
    date: meta?.date,
    recordedAt: meta?.recordedAt,
    a: meta?.a,
    b: meta?.b,
    rate: meta?.rate,
    durationSec: meta?.durationSec,
    mime: meta?.mime,
    sizeBytes: meta?.sizeBytes,
    storage: 'drive',
    storageKey: meta?.storageKey || meta?.driveFileId,
  };
  const r = await getAuthRef().apiFetch('/api/v1/takes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r && r.take ? r.take : r;
}

async function downloadTakeBlob(takeId: string): Promise<Blob> {
  requireLogin();
  const A = getAuthRef();
  const token =
    A && typeof A.getAccessToken === 'function'
      ? await A.getAccessToken()
      : (A && typeof A.getSession === 'function' && A.getSession()?.access_token) || '';
  const win: Record<string, any> = typeof window !== 'undefined' ? (window as any) : {};
  const apiBase =
    win.ULEVELP_CONFIG && win.ULEVELP_CONFIG.apiBaseUrl
      ? String(win.ULEVELP_CONFIG.apiBaseUrl).replace(/\/$/, '')
      : '';
  const res = await fetch(apiBase + '/api/v1/takes/' + encodeURIComponent(takeId) + '/download', {
    headers: {
      Authorization: 'Bearer ' + token,
    },
  });
  if (!res.ok) {
    let errData: any = {};
    try {
      errData = await res.json();
    } catch {
      /* ignore */
    }
    const msg = (errData && (errData.message || errData.error)) || '다운로드 실패 (' + res.status + ')';
    const err: ApiClientError = new Error(msg);
    err.status = res.status;
    err.code = (errData && errData.code) || 'DOWNLOAD_ERROR';
    throw err;
  }
  return await res.blob();
}

async function migrateTakeToDrive(takeId: string, driveFileId: string): Promise<TakeDto> {
  requireLogin();
  const r = await getAuthRef().apiFetch('/api/v1/takes/' + encodeURIComponent(takeId) + '/migrate-drive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driveFileId }),
  });
  return r && r.take ? r.take : r;
}

export const apiClient = {
  isLoggedIn,
  getCachedKeys,
  me: {
    update: updateMe,
  },
  songs: {
    list: listSongs,
    byVideo,
    create: createSong,
    get: getSong,
    update: updateSong,
    remove: removeSong,
  },
  categories: {
    list: listCategories,
    create: createCategory,
    update: updateCategory,
    reorder: reorderCategories,
    remove: removeCategory,
  },
  sessions: {
    list: listSessions,
    updateMemo,
  },
  saveProgress,
  takes: {
    upload: uploadTake,
    getUrl: getTakeUrl,
    remove: removeTake,
    registerDrive: registerDriveTake,
    downloadBlob: downloadTakeBlob,
    migrateToDrive: migrateTakeToDrive,
  },
  nx: {
    exportZip,
    previewNotionZip,
    confirmNotionZip,
  },
  integrations: {
    list: listIntegrations,
    saveNotion: saveNotionIntegration,
    saveGemini: saveGeminiIntegration,
    check: checkIntegration,
    remove: removeIntegration,
  },
  notionSync: {
    status: syncStatus,
    enable: syncEnable,
    disable: syncDisable,
    pull: syncPull,
    push: syncPush,
  },
  notes: {
    analyze: noteAnalyze,
    listJobs: listNoteJobs,
    getJob: getNoteJob,
    list: listNotes,
    get: getNote,
    update: updateNote,
    remove: removeNote,
    setCollect: setNoteCollect,
  },
  progressions: {
    list: listProgressions,
    create: createProgression,
    update: updateProgression,
    remove: removeProgression,
    analyze: analyzeProgression,
  },
  runLocalMigration,
  listLocalSongs,
  local: { listSongs: listLocalSongs },
};

if (typeof window !== 'undefined' && !window.ULData) {
  window.ULData = apiClient;
}

