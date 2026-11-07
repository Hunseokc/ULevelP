// 서버 데이터 접근(로그인 사용자): 곡·플레이어 저장·녹음 업로드·기기 기록 이관
'use strict';
window.ULData = (function () {
  const EXT = {
    'audio/mp4': 'm4a',
    'audio/webm': 'weba',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/aac': 'aac',
  };

  let migrating = false;

  function isLoggedIn() {
    const sess = window.ULAuth && typeof window.ULAuth.getSession === 'function' ? window.ULAuth.getSession() : null;
    return !!(sess && sess.access_token);
  }

  function requireLogin() {
    if (!isLoggedIn()) {
      const err = new Error('로그인이 필요해요');
      err.code = 'NOT_LOGGED_IN';
      err.status = 401;
      throw err;
    }
  }

  async function list(status) {
    requireLogin();
    let path = '/api/v1/songs';
    if (status) path += '?status=' + encodeURIComponent(status);
    const r = await window.ULAuth.apiFetch(path);
    return r && r.songs ? r.songs : [];
  }

  async function byVideo(videoId) {
    requireLogin();
    const path = '/api/v1/songs/by-video/' + encodeURIComponent(videoId);
    const r = await window.ULAuth.apiFetch(path);
    return r && r.song !== undefined ? r.song : null;
  }

  async function create(input) {
    requireLogin();
    input = input || {};
    const body = JSON.stringify({
      videoId: input.videoId,
      title: input.title,
      artist: input.artist,
      rate: input.rate,
    });
    const r = await window.ULAuth.apiFetch('/api/v1/songs', {
      method: 'POST',
      body,
    });
    return r ? r.song : null;
  }

  async function getSong(songId) {
    requireLogin();
    const path = '/api/v1/songs/' + encodeURIComponent(songId);
    return await window.ULAuth.apiFetch(path);
  }

  async function updateSong(songId, patch) {
    requireLogin();
    const body = {};
    if (patch && typeof patch === 'object') {
      if (patch.status !== undefined) body.status = patch.status;
      if (patch.memo !== undefined) body.memo = patch.memo;
      if (patch.title !== undefined) body.title = patch.title;
    }
    const path = '/api/v1/songs/' + encodeURIComponent(songId);
    const r = await window.ULAuth.apiFetch(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return r ? r.song : null;
  }

  async function removeSong(songId) {
    requireLogin();
    const path = '/api/v1/songs/' + encodeURIComponent(songId);
    await window.ULAuth.apiFetch(path, {
      method: 'DELETE',
    });
    return { ok: true };
  }

  function saveProgress(body, opts) {
    try {
      requireLogin();
    } catch (e) {
      return Promise.reject(e);
    }
    body = body || {};
    opts = opts || {};
    const payload = {
      songId: body.songId,
      pos: body.pos,
      a: body.a,
      b: body.b,
      rate: body.rate,
      date: body.date,
      addSeconds: body.addSeconds,
      addLoops: body.addLoops,
    };
    const jsonBody = JSON.stringify(payload);

    if (opts.keepalive === true) {
      const sess = window.ULAuth.getSession();
      const token = sess ? sess.access_token : '';
      const apiBaseUrl = (window.ULEVELP_CONFIG && window.ULEVELP_CONFIG.apiBaseUrl) || '';
      const url = (apiBaseUrl ? apiBaseUrl.replace(/\/+$/, '') : '') + '/api/v1/practice/save';
      const p = fetch(url, {
        method: 'POST',
        keepalive: true,
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: jsonBody,
      });
      return p.then(async (res) => {
        const data = res.status === 204 ? null : await res.json().catch(() => null);
        if (!res.ok) {
          const msg = (data && (data.message || data.error)) || ('요청 처리에 실패했어요 (' + res.status + ')');
          const err = new Error(msg);
          err.status = res.status;
          err.code = data && data.code ? data.code : '';
          err.data = data;
          throw err;
        }
        return data;
      });
    }

    return window.ULAuth.apiFetch('/api/v1/practice/save', {
      method: 'POST',
      body: jsonBody,
    });
  }

  async function upload(meta, blob) {
    const me = window.ULAuth && typeof window.ULAuth.getMe === 'function' ? window.ULAuth.getMe() : null;
    if (me && me.storageProvider === 'drive' && window.ULDrive && typeof window.ULDrive.uploadTake === 'function') {
      requireLogin();
      return await window.ULDrive.uploadTake(meta, blob);
    }
    requireLogin();
    meta = meta || {};
    const metaPayload = {
      songId: meta.songId,
      date: meta.date,
      recordedAt: meta.recordedAt,
      a: meta.a,
      b: meta.b,
      rate: meta.rate,
      durationSec: meta.durationSec,
      mime: meta.mime,
    };
    if (meta.replaceOldSongTakes === true) {
      metaPayload.replaceOldSongTakes = true;
    }
    const ext = EXT[meta.mime] || 'webm';
    const filename = 'take.' + ext;
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metaPayload)], { type: 'application/json' }));
    form.append('file', blob, filename);
    const r = await window.ULAuth.apiFetch('/api/v1/takes', {
      method: 'POST',
      body: form,
    });
    return r ? r.take : null;
  }

  function readLocal(prefix) {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(prefix)) continue;
        const vid = k.slice(prefix.length);
        if (!/^[\w-]{11}$/.test(vid)) continue;
        let parsed = null;
        try {
          const raw = localStorage.getItem(k);
          parsed = JSON.parse(raw);
        } catch (e) {
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
    } catch (e) {
      return [];
    }
    return out;
  }

  function listLocalSongs() {
    const items = readLocal('ulp:v:');
    items.sort((x, y) => {
      if (x.date && y.date) return y.date.localeCompare(x.date);
      if (x.date) return -1;
      if (y.date) return 1;
      return 0;
    });
    return items;
  }

  async function listSessions(params) {
    requireLogin();
    params = params || {};
    const qs = new URLSearchParams();
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.today) qs.set('today', params.today);
    const queryString = qs.toString();
    const path = '/api/v1/sessions' + (queryString ? '?' + queryString : '');
    return await window.ULAuth.apiFetch(path);
  }

  async function updateMemo(sessionId, memo) {
    requireLogin();
    const path = '/api/v1/sessions/' + encodeURIComponent(sessionId);
    return await window.ULAuth.apiFetch(path, {
      method: 'PATCH',
      body: JSON.stringify({ memo: String(memo ?? '') }),
    });
  }

  async function getTakeUrl(takeId) {
    requireLogin();
    const path = '/api/v1/takes/' + encodeURIComponent(takeId) + '/url';
    return await window.ULAuth.apiFetch(path);
  }

  async function removeTake(takeId) {
    requireLogin();
    const path = '/api/v1/takes/' + encodeURIComponent(takeId);
    return await window.ULAuth.apiFetch(path, {
      method: 'DELETE',
    });
  }

  async function runLocalMigration() {
    if (!isLoggedIn()) {
      return { status: 'skipped', created: 0, skipped: 0, message: '' };
    }
    const me = window.ULAuth && typeof window.ULAuth.getMe === 'function' ? window.ULAuth.getMe() : null;
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
      const items = [];
      if (own.length > 0) {
        const ok = window.confirm('이 기기에서 연습하던 기록 ' + own.length + '곡을 계정으로 옮길까요?');
        if (ok) items.push(...own);
      }
      if (filteredSister.length > 0) {
        const ok = window.confirm('같은 기기의 guitar-practice 기록 ' + filteredSister.length + '곡도 가져올까요? (원래 기록은 그대로 남아요)');
        if (ok) items.push(...filteredSister);
      }

      items.sort((x, y) => {
        if (x.date && y.date) return y.date.localeCompare(x.date);
        if (x.date) return -1;
        if (y.date) return 1;
        return 0;
      });
      const topItems = items.slice(0, 100);

      const r = await window.ULAuth.apiFetch('/api/v1/songs/migrate-local', {
        method: 'POST',
        body: JSON.stringify({ items: topItems, markMigrated: true }),
      });

      if (window.ULAuth && typeof window.ULAuth.fetchMe === 'function') {
        await window.ULAuth.fetchMe();
      }
      return {
        status: 'done',
        created: r && typeof r.created === 'number' ? r.created : 0,
        skipped: r && typeof r.skipped === 'number' ? r.skipped : 0,
        message: '',
      };
    } catch (e) {
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

  async function exportZip(includeAudio) {
    requireLogin();
    const sess = window.ULAuth && typeof window.ULAuth.getSession === 'function' ? window.ULAuth.getSession() : null;
    const token = sess && sess.access_token ? sess.access_token : '';
    const qs = '?includeAudio=' + (includeAudio !== false);
    const res = await fetch('/api/v1/export/zip' + qs, {
      headers: {
        Authorization: 'Bearer ' + token,
      },
    });
    if (!res.ok) {
      let errData = {};
      try {
        errData = await res.json();
      } catch (_) {}
      const msg = (errData && (errData.message || errData.error)) || ('내보내기에 실패했어요 (' + res.status + ')');
      const err = new Error(msg);
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

  async function previewNotionZip(file) {
    requireLogin();
    const form = new FormData();
    form.append('file', file, (file && file.name) || 'backup.zip');
    return await window.ULAuth.apiFetch('/api/v1/import/notion/preview', {
      method: 'POST',
      body: form,
    });
  }

  async function confirmNotionZip(previewToken) {
    requireLogin();
    return await window.ULAuth.apiFetch('/api/v1/import/notion/confirm', {
      method: 'POST',
      body: JSON.stringify({ previewToken: String(previewToken || '') }),
    });
  }

  function getCachedKeys() {
    try {
      const raw = localStorage.getItem('ulp:keys');
      if (!raw) return { notion: null, gemini: null };
      const parsed = JSON.parse(raw);
      const user = window.ULAuth && typeof window.ULAuth.getUser === 'function' ? window.ULAuth.getUser() : null;
      if (user && user.id && parsed && parsed.uid === user.id) {
        return {
          notion: parsed.notion || null,
          gemini: parsed.gemini || null,
        };
      }
    } catch (_) {}
    return { notion: null, gemini: null };
  }

  async function listIntegrations() {
    requireLogin();
    const r = await window.ULAuth.apiFetch('/api/v1/integrations?appId=ulevelp');
    return r && Array.isArray(r.integrations) ? r.integrations : [];
  }

  async function saveNotionIntegration(input) {
    requireLogin();
    input = input || {};
    const body = JSON.stringify({
      appId: 'ulevelp',
      token: input.token,
      songsDb: input.songsDb,
      sessionsDb: input.sessionsDb,
      notesDb: input.notesDb,
    });
    const r = await window.ULAuth.apiFetch('/api/v1/integrations/notion', {
      method: 'PUT',
      body,
    });
    if (window.ULAuth && typeof window.ULAuth.fetchMe === 'function') {
      await window.ULAuth.fetchMe();
    }
    return r;
  }

  async function saveGeminiIntegration(input) {
    requireLogin();
    input = input || {};
    const payload = {
      appId: 'ulevelp',
      apiKey: input.apiKey,
      model: input.model,
    };
    if (input.verify !== undefined) {
      payload.verify = Boolean(input.verify);
    }
    const r = await window.ULAuth.apiFetch('/api/v1/integrations/gemini', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    if (window.ULAuth && typeof window.ULAuth.fetchMe === 'function') {
      await window.ULAuth.fetchMe();
    }
    return r;
  }

  async function checkIntegration(provider) {
    requireLogin();
    const path = '/api/v1/integrations/' + encodeURIComponent(provider) + '/check?appId=ulevelp';
    return await window.ULAuth.apiFetch(path, {
      method: 'POST',
    });
  }

  async function removeIntegration(provider) {
    requireLogin();
    const path = '/api/v1/integrations/' + encodeURIComponent(provider) + '?appId=ulevelp';
    const r = await window.ULAuth.apiFetch(path, {
      method: 'DELETE',
    });
    if (window.ULAuth && typeof window.ULAuth.fetchMe === 'function') {
      await window.ULAuth.fetchMe();
    }
    return r && r.ok ? r : { ok: true };
  }

  async function syncStatus() {
    requireLogin();
    return await window.ULAuth.apiFetch('/api/v1/notion/sync/status');
  }

  async function syncEnable() {
    requireLogin();
    return await window.ULAuth.apiFetch('/api/v1/notion/sync/enable', {
      method: 'POST',
    });
  }

  async function syncDisable() {
    requireLogin();
    return await window.ULAuth.apiFetch('/api/v1/notion/sync/disable', {
      method: 'POST',
    });
  }

  async function syncPull() {
    requireLogin();
    return await window.ULAuth.apiFetch('/api/v1/notion/sync/pull', {
      method: 'POST',
    });
  }

  async function syncPush() {
    requireLogin();
    return await window.ULAuth.apiFetch('/api/v1/notion/sync/push', {
      method: 'POST',
    });
  }

  function clearCachedGeminiKey() {
    try {
      const raw = localStorage.getItem('ulp:keys');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        parsed.gemini = null;
        localStorage.setItem('ulp:keys', JSON.stringify(parsed));
      }
    } catch (_) {}
  }

  function checkJobsForInvalidKey(jobs) {
    if (!Array.isArray(jobs)) return;
    const hasInvalid = jobs.some(
      (j) => j && j.status === 'failed' && typeof j.error === 'string' && j.error.startsWith('PROVIDER_KEY_INVALID:')
    );
    if (hasInvalid) {
      clearCachedGeminiKey();
    }
  }

  async function noteAnalyze(input) {
    requireLogin();
    input = input || {};
    try {
      const r = await window.ULAuth.apiFetch('/api/v1/notes/analyze', {
        method: 'POST',
        body: JSON.stringify({
          url: input.url,
          tags: input.tags,
          memo: input.memo,
        }),
      });
      return { jobId: r.jobId, status: r.status };
    } catch (err) {
      if (err && (err.code === 'NO_KEY' || err.status === 412)) {
        clearCachedGeminiKey();
      }
      throw err;
    }
  }

  async function listNoteJobs() {
    requireLogin();
    const r = await window.ULAuth.apiFetch('/api/v1/notes/jobs');
    const jobs = r && Array.isArray(r.jobs) ? r.jobs : [];
    checkJobsForInvalidKey(jobs);
    return jobs;
  }

  async function getNoteJob(jobId) {
    requireLogin();
    const path = '/api/v1/notes/jobs/' + encodeURIComponent(jobId);
    const r = await window.ULAuth.apiFetch(path);
    if (r) {
      checkJobsForInvalidKey([r]);
    }
    return r;
  }

  async function listNotes(tag) {
    requireLogin();
    let path = '/api/v1/notes';
    if (tag) path += '?tag=' + encodeURIComponent(tag);
    const r = await window.ULAuth.apiFetch(path);
    return r && Array.isArray(r.notes) ? r.notes : [];
  }

  async function getNote(noteId) {
    requireLogin();
    const path = '/api/v1/notes/' + encodeURIComponent(noteId);
    const r = await window.ULAuth.apiFetch(path);
    return r && r.note ? r.note : null;
  }

  async function updateNote(noteId, patch) {
    requireLogin();
    patch = patch || {};
    const body = {};
    if (patch.memo !== undefined) body.memo = patch.memo;
    if (patch.tags !== undefined) body.tags = patch.tags;
    if (patch.title !== undefined) body.title = patch.title;
    const path = '/api/v1/notes/' + encodeURIComponent(noteId);
    const r = await window.ULAuth.apiFetch(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return r && r.note ? r.note : null;
  }

  async function removeNote(noteId) {
    requireLogin();
    const path = '/api/v1/notes/' + encodeURIComponent(noteId);
    await window.ULAuth.apiFetch(path, {
      method: 'DELETE',
    });
    return { ok: true };
  }

  async function updateMe(patch) {
    requireLogin();
    let updated;
    if (window.ULAuth && typeof window.ULAuth.updateProfile === 'function') {
      updated = await window.ULAuth.updateProfile(patch);
    } else {
      updated = await window.ULAuth.apiFetch('/api/v1/me', {
        method: 'PATCH',
        body: JSON.stringify(patch || {}),
      });
      if (window.ULAuth && typeof window.ULAuth.fetchMe === 'function') {
        await window.ULAuth.fetchMe();
      }
    }
    return updated;
  }

  async function registerDriveTake(meta) {
    requireLogin();
    meta = meta || {};
    const payload = {
      songId: meta.songId,
      date: meta.date,
      recordedAt: meta.recordedAt,
      a: meta.a,
      b: meta.b,
      rate: meta.rate,
      durationSec: meta.durationSec,
      mime: meta.mime,
      sizeBytes: meta.sizeBytes,
      storage: 'drive',
      storageKey: meta.storageKey || meta.driveFileId,
    };
    const r = await window.ULAuth.apiFetch('/api/v1/takes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return r && r.take ? r.take : r;
  }

  async function downloadTakeBlob(takeId) {
    requireLogin();
    // ULAuth.apiFetch는 JSON 응답 전용이므로 바이너리 res.blob() 수신을 위해 직접 fetch 호출하되,
    // 만료 토큰 갱신을 위해 await ULAuth.getAccessToken()으로 토큰을 얻고 ULEVELP_CONFIG.apiBaseUrl을 접두어로 붙인다.
    const token = (window.ULAuth && typeof window.ULAuth.getAccessToken === 'function')
      ? await window.ULAuth.getAccessToken()
      : ((window.ULAuth && typeof window.ULAuth.getSession === 'function' && window.ULAuth.getSession()?.access_token) || '');
    const apiBase = (window.ULEVELP_CONFIG && window.ULEVELP_CONFIG.apiBaseUrl) ? window.ULEVELP_CONFIG.apiBaseUrl.replace(/\/$/, '') : '';
    const res = await fetch(apiBase + '/api/v1/takes/' + encodeURIComponent(takeId) + '/download', {
      headers: {
        Authorization: 'Bearer ' + token,
      },
    });
    if (!res.ok) {
      let errData = {};
      try { errData = await res.json(); } catch (_) {}
      const msg = (errData && (errData.message || errData.error)) || ('다운로드 실패 (' + res.status + ')');
      const err = new Error(msg);
      err.status = res.status;
      err.code = (errData && errData.code) || 'DOWNLOAD_ERROR';
      throw err;
    }
    return await res.blob();
  }

  async function migrateTakeToDrive(takeId, driveFileId) {
    requireLogin();
    const r = await window.ULAuth.apiFetch('/api/v1/takes/' + encodeURIComponent(takeId) + '/migrate-drive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driveFileId: driveFileId }),
    });
    return r && r.take ? r.take : r;
  }

  return {
    isLoggedIn,
    getCachedKeys,
    me: {
      update: updateMe,
    },
    songs: {
      list,
      byVideo,
      create,
      get: getSong,
      update: updateSong,
      remove: removeSong,
    },
    sessions: {
      list: listSessions,
      updateMemo,
    },
    saveProgress,
    takes: {
      upload,
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
    },
    runLocalMigration,
    listLocalSongs,
    local: { listSongs: listLocalSongs },
  };
})();
