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

  return {
    isLoggedIn,
    songs: {
      list,
      byVideo,
      create,
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
    },
    runLocalMigration,
  };
})();
