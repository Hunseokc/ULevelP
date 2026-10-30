// 연습 플레이어: 유튜브 임베드 + 속도 버튼 + A-B 구간 반복 + 계정 자동 저장(ULData)
'use strict';
(function () {
  const D = window.ULData;
  const loggedIn = () => !!(D && D.isLoggedIn());

  const RATES = [0.25, 0.5, 0.75, 1];
  const LEADS = [0, 1, 2];
  const AUTOSAVE_MS = 30000;
  const PLAYER_PATH = location.origin + location.pathname;

  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (s, tenths) => {
    if (s == null || isNaN(s)) return '--:--';
    const m = Math.floor(s / 60), r = s - m * 60;
    return tenths ? m + ':' + r.toFixed(1).padStart(4, '0') : m + ':' + pad(Math.floor(r));
  };
  const round1 = (x) => Math.round(x * 10) / 10;
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 무시 */ } },
  };

  function videoIdFrom(text) {
    const s = String(text || '').trim();
    if (/^[\w-]{11}$/.test(s)) return s;
    try {
      const u = new URL(s);
      if (/(^|\.)youtu\.be$/.test(u.hostname)) return u.pathname.slice(1, 12) || null;
      if (u.searchParams.get('v')) return u.searchParams.get('v').slice(0, 11);
      const m = u.pathname.match(/\/(shorts|embed|live)\/([\w-]{11})/);
      return m ? m[2] : null;
    } catch (e) { return null; }
  }
  const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };

  // ---------- 상태 ----------
  const st = {
    videoId: null, song: null, ready: false, playing: false, duration: 0,
    a: null, b: null, loopOn: false, lead: store.get('ulp:lead', 1), rate: 1,
    loops: 0, unsavedSec: 0, unsavedLoops: 0, dirty: false, seekGuardUntil: 0,
    saving: false, savePending: false, startAt: 0,
  };
  let player = null, ytReady = false, pendingLoad = null;

  // ---------- 화면 ----------
  const rateBtns = RATES.map((r) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = r === 1 ? '1.0' : String(r); b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => setRate(r));
    $('rates').appendChild(b); return b;
  });
  const leadBtns = LEADS.map((s) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = s + '초'; b.setAttribute('aria-label', '반복 전 여유 ' + s + '초'); b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => { st.lead = s; store.set('ulp:lead', s); render(); });
    $('leads').appendChild(b); return b;
  });

  let syncMsg = '', syncErr = false;
  function setSync(msg, err) { syncMsg = msg; syncErr = !!err; renderSync(); }
  function renderSync() {
    const el = $('syncState');
    el.textContent = syncMsg || (st.song ? '계정 연결됨' : '');
    el.classList.toggle('err', syncErr);
  }

  function render() {
    const hasA = st.a != null, hasB = st.b != null;
    rateBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(Math.abs(RATES[i] - st.rate) < 0.001)));
    leadBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(LEADS[i] === st.lead)));
    $('aTime').textContent = fmt(st.a, true);
    $('bTime').textContent = fmt(st.b, true);
    $('setA').classList.toggle('set', hasA);
    $('setB').classList.toggle('set', hasB);
    $('loopBtn').disabled = !(hasA && hasB);
    $('loopBtn').setAttribute('aria-pressed', String(st.loopOn));
    $('loopBtn').textContent = st.loopOn ? '반복 중' : '반복';
    $('loopInfo').textContent = hasA && hasB ? (st.b - st.a).toFixed(1) + '초' + (st.loopOn && st.loops ? ' · ' + st.loops + '회' : '') : '';
    $('playBtn').textContent = st.playing ? '❚❚' : '▶';
    $('playBtn').setAttribute('aria-label', st.playing ? '일시정지' : '재생');
    $('songTitle').textContent = st.song ? st.song.title : (st.videoId ? (videoTitle() || '연습 플레이어') : '연습 플레이어');
    $('emptyState').hidden = !!st.videoId;
    const save = $('saveBtn');
    save.textContent = loggedIn() && st.videoId && !st.song ? '곡 추가' : '저장';
    save.disabled = !st.videoId;
    save.classList.toggle('dirty', st.dirty);
    renderBar();
    renderSync();
    renderSongs();
    renderRec();
  }

  function renderBar() {
    const d = st.duration || 0;
    const t = player && st.ready ? safeTime() : 0;
    $('tNow').textContent = fmt(t);
    $('tDur').textContent = fmt(d);
    $('barFill').style.width = d ? (t / d * 100) + '%' : '0';
    if (!seeking) $('seek').value = d ? String(Math.round(t / d * 1000)) : '0';
    const loop = $('barLoop');
    if (d && st.a != null && st.b != null) {
      loop.style.display = 'block';
      loop.style.left = (st.a / d * 100) + '%';
      loop.style.width = ((st.b - st.a) / d * 100) + '%';
    } else loop.style.display = 'none';
  }

  // ---------- 유튜브 플레이어 ----------
  window.onYouTubeIframeAPIReady = function () {
    ytReady = true;
    if (pendingLoad) { const p = pendingLoad; pendingLoad = null; loadVideo(p.id, p.opts); }
  };
  (function loadYT() {
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => setSync('유튜브 플레이어를 불러오지 못했어요', true);
    document.head.appendChild(s);
  })();

  function safeTime() { try { return player.getCurrentTime() || 0; } catch (e) { return 0; } }
  function videoTitle() { try { return (player && player.getVideoData && player.getVideoData().title) || ''; } catch (e) { return ''; } }
  function videoAuthor() { try { return (player && player.getVideoData && player.getVideoData().author) || ''; } catch (e) { return ''; } }

  function createPlayer(id, start) {
    player = new YT.Player('player', {
      videoId: id,
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, start: Math.floor(start || 0), origin: location.origin },
      events: {
        onReady() {
          st.ready = true;
          applyRate();
          updateRateAvailability();
          if (start) player.seekTo(start, true);
          st.duration = player.getDuration() || 0;
          render();
        },
        onStateChange(e) {
          const S = YT.PlayerState;
          const wasPlaying = st.playing;
          st.playing = e.data === S.PLAYING || e.data === S.BUFFERING;
          if (e.data === S.PLAYING) { applyRate(); st.duration = player.getDuration() || st.duration; updateRateAvailability(); keepAwake(true); if (!st.song) render(); }
          if (e.data === S.ENDED && st.loopOn && st.a != null) { jumpToLoopStart(); st.loops++; st.unsavedLoops++; player.playVideo(); }
          if (wasPlaying && e.data === S.PAUSED) { keepAwake(false); schedule(1500); }
          render();
        },
        onPlaybackRateChange(e) {
          // 플레이어 자체 메뉴로 바꾼 경우에도 버튼 표시를 맞춘다
          if (Math.abs(e.data - st.rate) > 0.001) { st.rate = e.data; markDirty(); render(); }
        },
        onError() { setSync('이 영상은 임베드 재생이 막혀 있어요. 유튜브에서 직접 열어야 해요.', true); },
      },
    });
  }

  function loadVideo(id, opts) {
    opts = opts || {};
    if (!ytReady) { pendingLoad = { id, opts }; st.videoId = id; render(); return; }
    const start = opts.start || 0;
    if (!player) createPlayer(id, start);
    else player.cueVideoById({ videoId: id, startSeconds: start });
    st.videoId = id;
    st.duration = 0;
    render();
  }

  function applyRate() {
    if (!player || !st.ready) return;
    try { if (Math.abs(player.getPlaybackRate() - st.rate) > 0.001) player.setPlaybackRate(st.rate); } catch (e) { /* 준비 전 */ }
  }
  function updateRateAvailability() {
    let avail = null;
    try { avail = player.getAvailablePlaybackRates(); } catch (e) { /* 준비 전 */ }
    if (!avail || !avail.length) return;
    rateBtns.forEach((b, i) => { b.disabled = !avail.some((r) => Math.abs(r - RATES[i]) < 0.001); });
  }

  // ---------- 동작 ----------
  function setRate(r) {
    st.rate = r;
    applyRate();
    markDirty();
    render();
  }

  function setPoint(which, t) {
    if (!st.ready) return;
    const d = st.duration || Infinity;
    const time = round1(Math.max(0, Math.min(t == null ? safeTime() : t, d)));
    st[which] = time;
    if (which === 'a' && st.b != null && st.b <= st.a) st.b = null;
    if (which === 'b' && st.a != null && st.a >= st.b) st.a = null;
    if (which === 'b' && st.a != null && st.b != null && t == null) { st.loopOn = true; st.loops = 0; }
    if (st.a == null || st.b == null) st.loopOn = false;
    markDirty();
    render();
  }
  function nudge(which, d) { if (st[which] != null) setPoint(which, st[which] + d); }

  function jumpToLoopStart() {
    if (!player || !st.ready) return;
    const to = st.a != null ? Math.max(0, st.a - st.lead) : 0;
    st.seekGuardUntil = Date.now() + 400;
    player.seekTo(to, true);
  }

  function toggleLoop() {
    if (st.a == null || st.b == null) return;
    st.loopOn = !st.loopOn;
    st.loops = 0;
    if (st.loopOn) {
      const t = safeTime();
      if (t < st.a - st.lead - 0.5 || t >= st.b) jumpToLoopStart();
    }
    render();
  }

  function clearLoop() { st.a = st.b = null; st.loopOn = false; st.loops = 0; markDirty(); render(); }

  function togglePlay() {
    if (!player || !st.ready) return;
    if (st.playing) player.pauseVideo(); else player.playVideo();
  }
  function skip(d) { if (player && st.ready) { st.seekGuardUntil = Date.now() + 300; player.seekTo(Math.max(0, safeTime() + d), true); renderBar(); } }

  // 구간 반복 감시 (50ms)
  let lastBar = 0, lastTick = Date.now();
  setInterval(() => {
    const now = Date.now();
    if (player && st.ready && st.playing) {
      // 연습 시간 누적 (탭이 숨으면 브라우저가 타이머를 늦추므로 실제 경과 시간으로 계산, 한 번에 최대 2초)
      st.unsavedSec += Math.min(2, (now - lastTick) / 1000);
      if (st.loopOn && st.a != null && st.b != null && now > st.seekGuardUntil && safeTime() >= st.b) {
        jumpToLoopStart();
        st.loops++; st.unsavedLoops++;
        render();
      }
      if (now - lastBar > 250) { lastBar = now; renderBar(); }
    }
    lastTick = now;
  }, 50);

  // ---------- 진행 바 ----------
  let seeking = false;
  const seekEl = $('seek');
  seekEl.addEventListener('input', () => {
    seeking = true;
    const t = (Number(seekEl.value) / 1000) * (st.duration || 0);
    $('tNow').textContent = fmt(t);
    $('barFill').style.width = (Number(seekEl.value) / 10) + '%';
  });
  seekEl.addEventListener('change', () => {
    const t = (Number(seekEl.value) / 1000) * (st.duration || 0);
    if (player && st.ready) { st.seekGuardUntil = Date.now() + 400; player.seekTo(t, true); }
    seeking = false;
  });

  // ---------- 저장 ----------
  function markDirty() { st.dirty = true; schedule(4000); persistLocal(); }
  let saveTimer = null;
  function schedule(ms) { clearTimeout(saveTimer); saveTimer = setTimeout(() => save('auto'), ms); }

  function currentPos() {
    if (st.a != null) return st.a;
    return Math.max(0, Math.floor(safeTime()) - 2);
  }
  function resumeUrl(s) {
    const q = new URLSearchParams({ v: s.videoId });
    const t = s.pos != null ? s.pos : s.a;
    if (t) q.set('t', String(Math.floor(t)));
    if (s.a != null) q.set('a', String(s.a));
    if (s.b != null) q.set('b', String(s.b));
    if (s.rate && s.rate !== 1) q.set('r', String(s.rate));
    return PLAYER_PATH + '?' + q.toString();
  }
  function snapshot() {
    return { videoId: st.videoId, pos: st.ready ? currentPos() : st.startAt, a: st.a, b: st.b, rate: st.rate };
  }
  // 계정 연결이 없어도 이 기기와 주소창에는 남긴다
  function persistLocal() {
    if (!st.videoId) return;
    const s = snapshot();
    store.set('ulp:v:' + st.videoId, Object.assign({}, s, { date: today() }));
    try { history.replaceState(null, '', resumeUrl(s)); } catch (e) { /* 무시 */ }
  }

  async function ensureSong() {
    if (st.song) return st.song;
    const song = await D.songs.create({ videoId: st.videoId, title: videoTitle(), artist: videoAuthor(), rate: st.rate });
    st.song = song;
    songsCache = null;
    return st.song;
  }

  async function save(reason, opts) {
    if (!st.videoId) return;
    persistLocal();
    if (!loggedIn()) { if (reason === 'manual') setSync('이 기기에 저장됨 · 로그인하면 계정에 저장돼요'); return; }
    if (!st.song && reason !== 'manual') return; // 계정에 없는 곡은 '곡 추가'를 눌렀을 때만
    if (st.saving) { st.savePending = true; return; }
    const addSec = Math.floor(st.unsavedSec);
    const addLoops = st.unsavedLoops;
    if (reason === 'auto' && !st.dirty && addSec < 15) return;

    st.saving = true;
    setSync('저장 중…');
    try {
      const song = st.song || await ensureSong();
      const s = snapshot();
      const r = await D.saveProgress({
        songId: song.id, pos: s.pos, a: s.a, b: s.b, rate: s.rate,
        date: today(), addSeconds: addSec, addLoops,
      }, opts);
      // keep: 아직 1분이 안 돼서 연습 기록을 만들지 않음 → 시간은 다음 저장에 다시 보냄
      if (!r.keep) { st.unsavedSec -= addSec; st.unsavedLoops -= addLoops; }
      st.dirty = false;
      Object.assign(song, { a: s.a, b: s.b, rate: s.rate, pos: s.pos, lastDate: today() });
      const d = new Date();
      setSync('저장됨 ' + pad(d.getHours()) + ':' + pad(d.getMinutes()));
    } catch (e) {
      if (e && e.status === 404) {
        st.song = null;
        setSync('계정에서 지워진 곡이에요. 곡 추가를 누르면 다시 만들어요', true);
      } else {
        setSync((e && e.message) || '저장 실패', true);
      }
    } finally {
      st.saving = false;
      render();
      if (st.savePending) { st.savePending = false; save('auto'); }
    }
  }

  setInterval(() => { if (st.playing) save('auto'); }, AUTOSAVE_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { save('auto', { keepalive: true }); keepAwake(false); }
  });
  window.addEventListener('pagehide', () => save('auto', { keepalive: true }));

  // 연습 중 아이패드 화면 꺼짐 방지
  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
      if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) { /* 지원 안 함 */ }
  }

  // ---------- 녹음 ----------
  // 멈추면 바로 계정 저장소로 올림. 실패하면 이 화면에 남겨 두고 다시 올리거나 파일로 저장
  const REC_MAX_SEC = 30 * 60; // 서버 녹음 한도(50MB)
  const REC_TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  const REC_EXT = { 'audio/mp4': 'm4a', 'audio/webm': 'weba', 'audio/ogg': 'ogg' };
  const rec = { mr: null, stream: null, chunks: [], startedAt: 0, meta: null, take: null, uploading: false };
  let recMsg = '', recErr = false;
  function setRec(msg, err) { recMsg = msg; recErr = !!err; renderRec(); }
  const recSec = () => (rec.mr ? (Date.now() - rec.startedAt) / 1000 : 0);
  const hhmm = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };

  function renderRec() {
    const on = !!rec.mr, t = rec.take;
    const btn = $('recBtn');
    btn.textContent = on ? '■ ' + fmt(recSec()) : '● 녹음';
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? '녹음 멈추고 올리기' : '녹음 시작');
    btn.disabled = !on && (!st.videoId || rec.uploading);
    $('recRetry').hidden = !(t && !t.done && !rec.uploading && !on);
    $('recSave').hidden = !t || on;
    $('recPlay').hidden = !t || on;
    $('recMsg').textContent = recMsg;
    $('recMsg').classList.toggle('err', recErr);
  }

  async function startRec() {
    if (rec.mr || !st.videoId) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { setRec('이 브라우저는 녹음을 지원하지 않아요', true); return; }
    if (rec.take && !rec.take.done && !confirm('아직 계정에 못 올린 녹음이 있어요. 버리고 새로 녹음할까요?')) return;
    try {
      // 악기 소리가 깎이지 않도록 통화용 보정은 끔
      rec.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      setRec(e && e.name === 'NotAllowedError' ? '마이크 권한이 필요해요. 노션 안에서 열었다면 브라우저에서 직접 여세요' : '마이크를 열지 못했어요', true);
      return;
    }
    const type = REC_TYPES.find((x) => MediaRecorder.isTypeSupported(x)) || '';
    const mr = new MediaRecorder(rec.stream, Object.assign({ audioBitsPerSecond: 128000 }, type ? { mimeType: type } : {}));
    rec.chunks = [];
    rec.meta = { videoId: st.videoId, song: st.song, date: today(), time: hhmm(), a: st.a, b: st.b, rate: st.rate, recordedAt: new Date().toISOString() };
    mr.ondataavailable = (e) => { if (e.data && e.data.size) rec.chunks.push(e.data); };
    mr.onstop = () => {
      const mime = (mr.mimeType || type || 'audio/webm').split(';')[0];
      const seconds = Math.round((Date.now() - rec.startedAt) / 1000);
      const blob = new Blob(rec.chunks, { type: mime });
      rec.stream.getTracks().forEach((tr) => tr.stop());
      rec.mr = rec.stream = null; rec.chunks = [];
      setTake(Object.assign({ blob, mime, seconds, done: false }, rec.meta));
      rec.meta = null;
      uploadTake();
    };
    rec.mr = mr;
    rec.startedAt = Date.now();
    mr.start(1000);
    setRec('녹음 중');
  }
  function stopRec() { if (rec.mr && rec.mr.state !== 'inactive') rec.mr.stop(); }
  function toggleRec() { if (rec.mr) stopRec(); else startRec(); }

  function setTake(t) {
    if (rec.take) URL.revokeObjectURL(rec.take.url);
    t.url = URL.createObjectURL(t.blob);
    rec.take = t;
    $('recPlay').src = t.url;
    const a = $('recSave');
    a.href = t.url;
    a.download = (t.date + ' ' + t.time.replace(':', '') + ' ' + ((t.song && t.song.title) || '녹음')).replace(/[\\/:*?"<>|]+/g, ' ') + '.' + (REC_EXT[t.mime] || 'webm');
  }

  async function uploadTake() {
    const t = rec.take;
    if (!t || t.done || rec.uploading) return;
    if (!loggedIn()) { setRec('로그인하면 녹음을 계정에 올릴 수 있어요. 파일로 저장해 둘 수 있어요', true); return; }
    rec.uploading = true;
    setRec('녹음 올리는 중…');
    try {
      // 녹음하는 동안 다른 곡으로 넘어갔으면 녹음 시작 때의 곡으로 올림
      if (!t.song && st.videoId === t.videoId) t.song = await ensureSong();
      if (!t.song) throw new Error('곡 정보가 없어요. 곡 추가 후 다시 올려 주세요');
      t.serverTake = await D.takes.upload({
        songId: t.song.id,
        date: t.date,
        recordedAt: t.recordedAt,
        a: t.a,
        b: t.b,
        rate: t.rate,
        durationSec: t.seconds,
        mime: t.mime,
      }, t.blob);
      t.done = true;
      setRec('계정에 저장됨 ' + t.time + ' · ' + fmt(t.seconds));
    } catch (e) {
      if (e && e.status === 404) {
        t.song = null;
        if (st.videoId === t.videoId) st.song = null;
        setRec('계정에서 지워진 곡이에요. 다시 올리기를 누르면 새로 만들어요', true);
      } else {
        setRec((e && e.message) || '녹음 업로드 실패', true);
      }
    } finally {
      rec.uploading = false;
      renderRec();
    }
  }

  setInterval(() => {
    if (!rec.mr) return;
    if (recSec() >= REC_MAX_SEC) { stopRec(); return; }
    renderRec();
  }, 500);
  window.addEventListener('beforeunload', (e) => {
    if (rec.mr || rec.uploading || (rec.take && !rec.take.done)) { e.preventDefault(); e.returnValue = ''; }
  });

  // ---------- 곡 열기 ----------
  async function openSong(id, opts) {
    opts = opts || {};
    stopRec();
    if (st.videoId && st.videoId !== id) await save('auto');
    Object.assign(st, { song: null, a: null, b: null, loopOn: false, loops: 0, unsavedSec: 0, unsavedLoops: 0, dirty: false });
    setSync('');

    // 우선순위: 주소의 값 > 계정 > 이 기기 기록
    const local = store.get('ulp:v:' + id, null);
    let src = opts.params || null;
    let song = opts.song || null;
    if (!song && loggedIn()) {
      setSync('계정 기록 확인 중…');
      try {
        song = await D.songs.byVideo(id);
        setSync(song ? '계정 기록 불러옴' : '계정에 없는 곡');
      } catch (e) {
        setSync((e && e.message) || '계정 기록 확인 실패', true);
      }
    }
    st.song = song;
    const base = src || song || local || {};
    st.a = base.a != null ? base.a : null;
    st.b = base.b != null ? base.b : null;
    st.rate = RATES.includes(base.rate) ? base.rate : 1;
    st.loopOn = st.a != null && st.b != null && st.b > st.a;
    let start = base.t != null ? base.t : (base.pos != null ? base.pos : 0);
    if (st.loopOn && (start < st.a - 3 || start >= st.b)) start = Math.max(0, st.a - st.lead);
    st.startAt = start;
    loadVideo(id, { start });
    applyRate();
    persistLocal();
    render();
  }

  // ---------- 곡 목록 ----------
  let songsCache = null;
  function renderSongs() {
    const ul = $('songs');
    if ($('lib').hidden) return;
    ul.textContent = '';
    const msg = (t) => { const li = document.createElement('li'); li.className = 'note'; li.textContent = t; ul.appendChild(li); };
    if (!loggedIn()) return msg('로그인하면 내 연습 곡이 여기 보여요.');
    if (!songsCache) return msg('불러오는 중…');
    if (songsCache.error) return msg(songsCache.error);
    if (!songsCache.length) return msg('아직 곡이 없어요. 링크를 붙여넣어 열고 곡 추가를 누르세요.');
    songsCache.forEach((s) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      if (s.videoId === st.videoId) b.setAttribute('aria-current', 'true');
      const t = document.createElement('span'); t.className = 't'; t.textContent = s.title;
      const m = document.createElement('span'); m.className = 'm';
      const parts = [];
      if (s.status) parts.push(s.status);
      if (s.a != null && s.b != null) parts.push(fmt(s.a) + '–' + fmt(s.b));
      if (s.rate) parts.push(s.rate + '×');
      if (s.lastDate) parts.push(s.lastDate.slice(5).replace('-', '/'));
      m.textContent = parts.join(' · ');
      b.append(t, m);
      b.addEventListener('click', () => { closeLib(); openSong(s.videoId, { song: s }); });
      li.appendChild(b); ul.appendChild(li);
    });
  }
  async function loadSongs() {
    if (!loggedIn()) { renderSongs(); return; }
    songsCache = null; renderSongs();
    try { songsCache = await D.songs.list(); }
    catch (e) { songsCache = []; songsCache.error = (e && e.message) || '곡 목록을 불러오지 못했어요'; }
    renderSongs();
  }
  // 노션 연결 설정은 settings.html에서
  function openLib() {
    $('lib').hidden = false; $('scrim').hidden = false; $('libBtn').setAttribute('aria-expanded', 'true');
    loadSongs();
  }
  function closeLib() { $('lib').hidden = true; $('scrim').hidden = true; $('libBtn').setAttribute('aria-expanded', 'false'); }

  // ---------- 이벤트 연결 ----------
  function onUrl(input) {
    return (e) => {
      e.preventDefault();
      const id = videoIdFrom($(input).value);
      if (!id) { setSync('유튜브 링크를 읽지 못했어요', true); return; }
      $(input).value = ''; closeLib();
      openSong(id);
    };
  }
  $('urlForm').addEventListener('submit', onUrl('urlInput'));
  $('urlForm2').addEventListener('submit', onUrl('urlInput2'));
  $('libBtn').addEventListener('click', () => ($('lib').hidden ? openLib() : closeLib()));
  $('libClose').addEventListener('click', closeLib);
  $('scrim').addEventListener('click', closeLib);
  $('setA').addEventListener('click', () => setPoint('a'));
  $('setB').addEventListener('click', () => setPoint('b'));
  document.querySelectorAll('.pp-nudge').forEach((b) => b.addEventListener('click', () => nudge(b.dataset.pt, Number(b.dataset.d))));
  $('loopBtn').addEventListener('click', toggleLoop);
  $('clearBtn').addEventListener('click', clearLoop);
  $('playBtn').addEventListener('click', togglePlay);
  $('startBtn').addEventListener('click', jumpToLoopStart);
  $('backBtn').addEventListener('click', () => skip(-5));
  $('fwdBtn').addEventListener('click', () => skip(5));
  $('saveBtn').addEventListener('click', () => save('manual'));
  $('recBtn').addEventListener('click', toggleRec);
  $('recRetry').addEventListener('click', uploadTake);

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === 'Escape') { closeLib(); return; }
    const map = {
      Space: togglePlay, Digit1: () => setRate(0.25), Digit2: () => setRate(0.5), Digit3: () => setRate(0.75), Digit4: () => setRate(1),
      BracketLeft: () => setPoint('a'), BracketRight: () => setPoint('b'), KeyL: toggleLoop, KeyR: jumpToLoopStart,
      ArrowLeft: () => skip(-5), ArrowRight: () => skip(5), KeyS: () => save('manual'), KeyM: toggleRec,
    };
    const fn = map[e.code];
    if (!fn) return;
    e.preventDefault();
    fn();
  });

  // ---------- 시작 ----------
  const q = new URLSearchParams(location.search);
  const startId = videoIdFrom(q.get('v') || '');
  let started = false, lastUid = null;
  const migrationAttempted = {};
  render();
  (async function start() {
    // 저장된 로그인 세션을 먼저 읽는다 (ULAuth.init보다 먼저 실행되므로)
    if (window.ULAuth) await ULAuth.getAccessToken();
    const u = window.ULAuth && ULAuth.getUser();
    lastUid = u ? u.id : null;
    started = true;
    if (startId) {
      const params = (q.has('a') || q.has('b') || q.has('r') || q.has('t'))
        ? { a: num(q.get('a')), b: num(q.get('b')), rate: num(q.get('r')) || 1, t: num(q.get('t')) }
        : null;
      await openSong(startId, { params });
    }
    const me = window.ULAuth && ULAuth.getMe();
    if (me && !me.migratedLocalAt && lastUid && !migrationAttempted[lastUid]) {
      migrationAttempted[lastUid] = true;
      runMigration();
    }
  })();

  function refreshSong() {
    const id = st.videoId;
    if (!id || !D) return;
    D.songs.byVideo(id).then((song) => {
      if (st.videoId !== id || st.song) return;
      if (song) {
        st.song = song;
        setSync('계정 기록 불러옴');
      } else {
        setSync('계정에 없는 곡');
      }
      render();
    }).catch((e) => {
      if (st.videoId !== id) return;
      setSync((e && e.message) || '계정 기록 확인 실패', true);
      render();
    });
  }

  function runMigration() {
    if (!D) return;
    D.runLocalMigration().then((r) => {
      if (!r) return;
      if (r.status === 'done') {
        setSync('기기 기록 ' + r.created + '곡을 계정으로 옮겼어요');
        songsCache = null;
        if (st.videoId && !st.song) refreshSong();
      } else if (r.status === 'failed') {
        setSync(r.message, true);
      }
    }).catch((e) => {
      setSync((e && e.message) || '기기 기록 이관 실패', true);
    });
  }

  if (window.ULAuth) ULAuth.onChange((state) => {
    if (!started) return;
    const uid = state.user ? state.user.id : null;
    if (uid !== lastUid) {
      lastUid = uid;
      st.song = null; songsCache = null;
      if (rec.take && !rec.take.done) rec.take.song = null;
      if (rec.meta) rec.meta.song = null;
      if (uid && st.videoId) refreshSong();
      render();
    }
    if (state.me && !state.me.migratedLocalAt && uid && !migrationAttempted[uid]) {
      migrationAttempted[uid] = true;
      runMigration();
    }
  });

  window.__pp = { st, rec, save, openSong }; // 디버그용
})();
