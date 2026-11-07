// test/r3_practice_log.test.js
// R3-1 연습 플레이어(PracticePage) & 연습 기록(LogPage) React 전환 · Google Drive 기본 연결 유도 · 미연결 1곡 제한 교체 모달 검증 (R3-P1 ~ R3-P10)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function readText(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8').replace(/\r\n/g, '\n');
}

// 공통 DOM Mock 팩토리
function createMockElement(id = '', tagName = 'div', initialHidden = false) {
  const el = {
    id,
    tagName: tagName.toUpperCase(),
    value: '',
    checked: false,
    disabled: false,
    hidden: initialHidden,
    textContent: '',
    className: '',
    dataset: {},
    attributes: initialHidden ? { hidden: '' } : {},
    listeners: {},
    children: [],
    style: new Proxy({}, {
      set(target, prop, val) {
        target[prop] = val;
        el._styleAssigned = true;
        return true;
      },
    }),
    _styleAssigned: false,
    classList: {
      toggle(cls, force) {
        const set = new Set((el.className || '').split(/\s+/).filter(Boolean));
        if (force === undefined ? !set.has(cls) : force) set.add(cls);
        else set.delete(cls);
        el.className = [...set].join(' ');
      },
      contains(cls) {
        return (el.className || '').split(/\s+/).includes(cls);
      },
    },
    setAttribute(k, v) {
      el.attributes[k] = String(v);
      if (k === 'hidden') el.hidden = true;
      if (k.startsWith('data-')) {
        el.dataset[k.slice(5)] = String(v);
      }
    },
    getAttribute(k) {
      return el.attributes[k] ?? null;
    },
    removeAttribute(k) {
      delete el.attributes[k];
      if (k === 'hidden') el.hidden = false;
      if (k.startsWith('data-')) {
        delete el.dataset[k.slice(5)];
      }
    },
    addEventListener(ev, fn) {
      if (!el.listeners[ev]) el.listeners[ev] = [];
      el.listeners[ev].push(fn);
    },
    removeEventListener(ev, fn) {
      if (el.listeners[ev]) {
        el.listeners[ev] = el.listeners[ev].filter((f) => f !== fn);
      }
    },
    dispatchEvent(ev) {
      const type = typeof ev === 'string' ? ev : ev.type;
      const fns = el.listeners[type] || [];
      fns.forEach((fn) => fn.call(el, typeof ev === 'string' ? { type: ev, target: el } : ev));
    },
    click() {
      el.dispatchEvent('click');
    },
    appendChild(child) {
      el.children.push(child);
      child.parentElement = el;
      return child;
    },
    removeChild(child) {
      el.children = el.children.filter((c) => c !== child);
      child.parentElement = null;
      return child;
    },
    remove() {
      if (el.parentElement) {
        el.parentElement.removeChild(el);
      }
    },
    replaceChildren(...newChildren) {
      el.children = [];
      newChildren.forEach((c) => el.appendChild(c));
    },
    querySelectorAll(sel) {
      const res = [];
      function walk(node) {
        if (!node || !node.children) return;
        for (const c of node.children) {
          if (sel.startsWith('.') && c.classList?.contains(sel.slice(1))) res.push(c);
          else if (sel.startsWith('#') && c.id === sel.slice(1)) res.push(c);
          else if (c.tagName.toLowerCase() === sel.toLowerCase()) res.push(c);
          walk(c);
        }
      }
      walk(el);
      return res;
    },
    querySelector(sel) {
      const list = el.querySelectorAll(sel);
      return list.length ? list[0] : null;
    },
    pause() {
      el.paused = true;
    },
    play() {
      el.paused = false;
      return Promise.resolve();
    },
    load() {},
    paused: true,
  };
  return el;
}

// practice.js 실행 샌드박스
function createPracticeSandbox(opts = {}) {
  const elements = new Map();
  const getEl = (id) => {
    if (!elements.has(id)) {
      const isInitiallyHidden = ['takeLimitModal', 'recDriveBadge', 'recDriveBanner', 'lib', 'scrim', 'barLoop', 'recRetry', 'recSave', 'recPlay'].includes(id);
      elements.set(id, createMockElement(id, 'div', isInitiallyHidden));
    }
    return elements.get(id);
  };

  const requiredIds = [
    'songTitle', 'syncState', 'libBtn', 'player', 'emptyState', 'urlForm', 'urlInput',
    'seekRow', 'tNow', 'tDur', 'bar', 'barLoop', 'barFill', 'seek', 'rates', 'leads',
    'loopInfo', 'setA', 'setB', 'aTime', 'bTime', 'loopBtn', 'clearBtn', 'recBtn',
    'recRetry', 'recSave', 'recPlay', 'recMsg', 'recDriveBanner', 'recDriveBannerText',
    'btnRecDriveConnect', 'recDriveBadge', 'playBtn', 'startBtn', 'backBtn', 'fwdBtn',
    'saveBtn', 'kbdHint', 'lib', 'libClose', 'urlForm2', 'urlInput2', 'songs', 'scrim',
    'takeLimitModal', 'takeLimitTitle', 'takeLimitDesc', 'btnTakeLimitConnectDrive',
    'btnTakeLimitReplaceOld', 'btnTakeLimitClose',
  ];
  requiredIds.forEach(getEl);

  const storageMap = new Map();
  const localStorage = {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k),
    clear: () => storageMap.clear(),
  };

  let currentUser = opts.user || null;
  let currentMe = opts.me || { storageProvider: 'supabase' };
  const authListeners = [];

  const ULAuth = {
    getUser: () => currentUser,
    getMe: () => currentMe,
    getAccessToken: () => Promise.resolve(currentUser ? 'fake-token' : null),
    onChange: (fn) => authListeners.push(fn),
    _trigger(nextUser, nextMe) {
      currentUser = nextUser;
      currentMe = nextMe;
      authListeners.forEach((fn) => fn({ user: currentUser, me: currentMe }));
    },
    fetchMe: async () => currentMe,
  };

  const uploadCalls = [];
  const ULData = {
    isLoggedIn: () => Boolean(currentUser),
    songs: {
      byVideo: async (vid) => opts.songsByVideo?.[vid] || null,
      create: async (payload) => ({ id: 'song-' + payload.videoId, ...payload }),
      list: async () => opts.songsList || [],
    },
    saveProgress: async (payload, saveOpts) => ({ ok: true, keep: false }),
    takes: {
      upload: async (meta, blob) => {
        uploadCalls.push({ meta, blob });
        if (opts.onTakeUpload) {
          return opts.onTakeUpload(meta, blob, uploadCalls.length);
        }
        return { id: 'take-' + Date.now(), ...meta };
      },
    },
    runLocalMigration: async () => ({ status: 'done', created: 0 }),
  };

  let driveEnabled = false;
  const ULDrive = {
    enableDriveStorage: async () => {
      driveEnabled = true;
      currentMe = { ...currentMe, storageProvider: 'drive' };
      return { ok: true };
    },
  };

  const documentListeners = {};
  const windowListeners = {};

  const doc = {
    getElementById: (id) => getEl(id),
    querySelectorAll: (sel) => {
      const res = [];
      for (const el of elements.values()) {
        if (sel.startsWith('.') && el.classList?.contains(sel.slice(1))) res.push(el);
      }
      return res;
    },
    createElement: (tag) => createMockElement('', tag),
    head: { appendChild: () => {} },
    addEventListener: (ev, fn) => {
      if (!documentListeners[ev]) documentListeners[ev] = [];
      documentListeners[ev].push(fn);
    },
    removeEventListener: () => {},
    title: '',
  };

  const win = {
    document: doc,
    location: { origin: 'http://localhost', pathname: '/practice.html', search: opts.search || '' },
    history: { replaceState: () => {}, pushState: () => {} },
    localStorage,
    ULData,
    ULAuth,
    ULDrive,
    addEventListener: (ev, fn) => {
      if (!windowListeners[ev]) windowListeners[ev] = [];
      windowListeners[ev].push(fn);
    },
    removeEventListener: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: (fn, ms) => {
      if (opts.immediateTimeout) fn();
      return 1;
    },
    clearTimeout: () => {},
    Date,
    Math,
    String,
    Number,
    Boolean,
    Array,
    Object,
    URL,
    URLSearchParams,
    Blob: class MockBlob {
      constructor(chunks, options) {
        this.chunks = chunks;
        this.type = options?.type || '';
      }
    },
    navigator: { userAgent: 'test' },
  };

  win.window = win;

  const code = readText('public/practice.js');
  const context = vm.createContext(win);
  vm.runInContext(code, context);

  return { win, elements, storageMap, uploadCalls, ULAuth, ULDrive, getEl };
}

// -------------------------------------------------------------
// R3-P1: 라우트 및 필수 ID 전수 검증
// -------------------------------------------------------------
test('R3-P1: App.tsx, PracticePage.tsx, LogPage.tsx, public/practice.html 라우트 및 필수 ID 전수 검증', () => {
  const appTsx = readText('frontend/src/App.tsx');
  const practiceTsx = readText('frontend/src/pages/PracticePage.tsx');
  const logTsx = readText('frontend/src/pages/LogPage.tsx');
  const practiceHtml = readText('public/practice.html');

  // App.tsx 검증
  assert.ok(appTsx.includes('<Route path="/practice.html" element={<PracticePage />} />'), 'App.tsx에 PracticePage 연결 필수');
  assert.ok(appTsx.includes('<Route path="/log.html" element={<LogPage />} />'), 'App.tsx에 LogPage 연결 필수');
  assert.ok(!appTsx.includes('RouteShellPage'), 'App.tsx에서 RouteShellPage 완전 제거 필수');

  // PracticePage 필수 ID 목록 검증
  const practiceRequiredIds = [
    'songTitle', 'syncState', 'libBtn', 'player', 'emptyState', 'barLoop', 'barFill', 'seek',
    'recDriveBanner', 'btnRecDriveConnect', 'recDriveBadge', 'takeLimitModal',
    'btnTakeLimitConnectDrive', 'btnTakeLimitReplaceOld', 'btnTakeLimitClose',
  ];
  for (const id of practiceRequiredIds) {
    assert.ok(practiceTsx.includes(`id="${id}"`), `PracticePage.tsx에 id="${id}" 필수`);
    assert.ok(practiceHtml.includes(`id="${id}"`), `public/practice.html에 id="${id}" 필수`);
  }

  // LogPage 필수 ID 목록 검증
  const logRequiredIds = [
    'logGuest', 'pane-log', 'pane-songs', 'pane-song-detail', 'abPanel', 'abAudioA', 'abAudioB',
  ];
  for (const id of logRequiredIds) {
    assert.ok(logTsx.includes(`id="${id}"`), `LogPage.tsx에 id="${id}" 필수`);
  }
});

// -------------------------------------------------------------
// R3-P2: URL 파라미터 복원, 구간 반복, SVG 진행 바 인라인 style 0건 검증
// -------------------------------------------------------------
test('R3-P2: public/practice.js URL 파라미터(?v=&t=&a=&b=&r=) 복원, 구간 반복 활성화, SVG 진행 바 인라인 style 0건 검증', async () => {
  const sb = createPracticeSandbox({
    search: '?v=jNQXAC9IVRw&t=12&a=10&b=25&r=0.75',
  });

  // start() 비동기 완료 대기
  await new Promise((r) => setTimeout(r, 20));

  const pp = sb.win.__pp;
  assert.ok(pp, 'window.__pp 디버그 객체 노출 필수');
  assert.equal(pp.st.videoId, 'jNQXAC9IVRw');
  assert.equal(pp.st.a, 10);
  assert.equal(pp.st.b, 25);
  assert.equal(pp.st.rate, 0.75);
  assert.equal(pp.st.loopOn, true);

  // 로컬스토리지 저장 확인
  const saved = JSON.parse(sb.storageMap.get('ulp:v:jNQXAC9IVRw') || '{}');
  assert.equal(saved.videoId, 'jNQXAC9IVRw');
  assert.equal(saved.a, 10);
  assert.equal(saved.b, 25);
  assert.equal(saved.rate, 0.75);

  // 진행 바 렌더링 검증: SVG 속성으로만 제어되고 .style 대입이 0건이어야 함
  pp.st.duration = 100;
  pp.st.ready = true;
  sb.getEl('barFill')._styleAssigned = false;
  sb.getEl('barLoop')._styleAssigned = false;

  pp.st.ready = false; // safeTime = 0
  pp.openSong('jNQXAC9IVRw', { params: { a: 10, b: 25, rate: 0.75, t: 12 } });

  const barLoop = sb.getEl('barLoop');
  const barFill = sb.getEl('barFill');

  assert.equal(barLoop._styleAssigned, false, '#barLoop에 인라인 .style 대입 금지');
  assert.equal(barFill._styleAssigned, false, '#barFill에 인라인 .style 대입 금지');
  assert.equal(barLoop.attributes['x'], '100');
  assert.equal(barLoop.attributes['width'], '150');
  assert.equal(barLoop.hidden, false);
});

// -------------------------------------------------------------
// R3-P3: Drive 미연결 시 안내 배너 노출 및 연결 버튼 클릭 시 Drive 활성화 검증
// -------------------------------------------------------------
test('R3-P3: Google Drive 미연결 시 #recDriveBanner 노출 및 #btnRecDriveConnect 클릭 시 Drive 저장소 활성화 검증', async () => {
  const sb = createPracticeSandbox({
    user: { id: 'u1' },
    me: { storageProvider: 'supabase' },
  });

  await new Promise((r) => setTimeout(r, 20));

  const banner = sb.getEl('recDriveBanner');
  const badge = sb.getEl('recDriveBadge');
  const connectBtn = sb.getEl('btnRecDriveConnect');

  assert.equal(banner.hidden, false, 'Drive 미연결 시 배너 표시');
  assert.equal(badge.hidden, true, 'Drive 미연결 시 배지 숨김');

  // 연결 버튼 클릭
  await connectBtn.listeners['click'][0]();

  assert.equal(sb.win.ULAuth.getMe().storageProvider, 'drive');
  assert.equal(banner.hidden, true, 'Drive 연결 후 배너 숨김');
  assert.equal(badge.hidden, false, 'Drive 연결 후 배지 표시');
  assert.ok(sb.getEl('recMsg').textContent.includes('Google Drive 저장소가 연결되었어요'));
});

// -------------------------------------------------------------
// R3-P4: Drive 미연결 409 SINGLE_SONG_TAKE_LIMIT → 모달 오픈 → 이전 곡 삭제 후 현재 곡 교체 업로드 검증
// -------------------------------------------------------------
test('R3-P4: Drive 미연결 409 SINGLE_SONG_TAKE_LIMIT 발생 시 모달 오픈 및 replaceOldSongTakes: true 교체 업로드 성공 검증', async () => {
  let attempt = 0;
  const sb = createPracticeSandbox({
    user: { id: 'u1' },
    me: { storageProvider: 'supabase' },
    onTakeUpload: (meta, blob, seq) => {
      attempt++;
      if (attempt === 1) {
        const err = new Error('1곡 제한 충돌');
        err.status = 409;
        err.code = 'SINGLE_SONG_TAKE_LIMIT';
        throw err;
      }
      return { id: 'take-new', ...meta };
    },
  });

  await new Promise((r) => setTimeout(r, 20));

  const pp = sb.win.__pp;
  pp.st.videoId = 'vid-current';
  pp.st.song = { id: 's-curr', videoId: 'vid-current', title: '현재 곡' };
  pp.rec.take = {
    blob: new sb.win.Blob(['audio']),
    mime: 'audio/webm',
    seconds: 15,
    done: false,
    videoId: 'vid-current',
    song: pp.st.song,
    date: '2026-11-03',
    time: '12:00',
    a: null,
    b: null,
    rate: 1,
    recordedAt: new Date().toISOString(),
  };

  const modal = sb.getEl('takeLimitModal');
  const btnReplace = sb.getEl('btnTakeLimitReplaceOld');

  // 첫 번째 업로드 실행 -> 409 발생
  await pp.uploadTake();

  assert.equal(modal.hidden, false, '409 수신 시 #takeLimitModal 오픈 필수');
  assert.equal(pp.rec.take.done, false, '업로드 실패 시 take.done = false 유지');

  // 교체 업로드 버튼 클릭
  await btnReplace.listeners['click'][0]();

  assert.equal(sb.uploadCalls.length, 2);
  assert.equal(sb.uploadCalls[1].meta.replaceOldSongTakes, true, '두 번째 요청에 replaceOldSongTakes: true 전달 필수');
  assert.equal(pp.rec.take.done, true, '교체 업로드 성공 후 take.done = true');
  assert.equal(modal.hidden, true, '교체 업로드 성공 후 모달 닫힘');
  assert.ok(sb.getEl('recMsg').textContent.includes('이전 곡 서버 녹음을 교체하고'));
});

// -------------------------------------------------------------
// R3-P5: 모달에서 Drive 연결 클릭 시 Drive 전환 및 대기 중인 녹음 자동 재업로드 검증
// -------------------------------------------------------------
test('R3-P5: #takeLimitModal에서 #btnTakeLimitConnectDrive 클릭 시 Drive 활성화 후 대기 녹음 재업로드 검증', async () => {
  let attempt = 0;
  const sb = createPracticeSandbox({
    user: { id: 'u1' },
    me: { storageProvider: 'supabase' },
    onTakeUpload: (meta, blob, seq) => {
      attempt++;
      if (attempt === 1) {
        const err = new Error('1곡 제한 충돌');
        err.status = 409;
        err.code = 'SINGLE_SONG_TAKE_LIMIT';
        throw err;
      }
      return { id: 'take-drive', ...meta };
    },
  });

  await new Promise((r) => setTimeout(r, 20));

  const pp = sb.win.__pp;
  pp.st.videoId = 'vid-current';
  pp.st.song = { id: 's-curr', videoId: 'vid-current', title: '현재 곡' };
  pp.rec.take = {
    blob: new sb.win.Blob(['audio']),
    mime: 'audio/webm',
    seconds: 15,
    done: false,
    videoId: 'vid-current',
    song: pp.st.song,
    date: '2026-11-03',
    time: '12:00',
    a: null,
    b: null,
    rate: 1,
    recordedAt: new Date().toISOString(),
  };

  await pp.uploadTake();
  assert.equal(sb.getEl('takeLimitModal').hidden, false);

  // 모달 안에서 Google Drive 연결 버튼 클릭
  const btnConnect = sb.getEl('btnTakeLimitConnectDrive');
  await btnConnect.listeners['click'][0]();

  assert.equal(sb.win.ULAuth.getMe().storageProvider, 'drive');
  assert.equal(pp.rec.take.done, true);
  assert.equal(sb.getEl('takeLimitModal').hidden, true);
  assert.ok(sb.getEl('recMsg').textContent.includes('계정에 저장됨'));
});

// -------------------------------------------------------------
// R3-P6: 409 RECENT_SONG_ONLY 및 404 시 상위 곡 null 초기화 검증
// -------------------------------------------------------------
test('R3-P6: 녹음 업로드 시 409 RECENT_SONG_ONLY 에러 표시 및 404 시 상위 곡 null 초기화 검증', async () => {
  let failCode = 'RECENT_SONG_ONLY';
  let failStatus = 409;
  let failMsg = 'Google Drive 미연결 상태에서는 가장 최근 연습 곡에만 녹음을 저장할 수 있습니다.';

  const sb = createPracticeSandbox({
    user: { id: 'u1' },
    onTakeUpload: () => {
      const err = new Error(failMsg);
      err.status = failStatus;
      err.code = failCode;
      throw err;
    },
  });

  await new Promise((r) => setTimeout(r, 20));

  const pp = sb.win.__pp;
  pp.st.videoId = 'vid-1';
  pp.st.song = { id: 's-1', videoId: 'vid-1', title: '과거 곡' };
  pp.rec.take = {
    blob: new sb.win.Blob(['audio']),
    mime: 'audio/webm',
    seconds: 10,
    done: false,
    videoId: 'vid-1',
    song: pp.st.song,
    date: '2026-11-03',
    time: '12:00',
    a: null,
    b: null,
    rate: 1,
    recordedAt: new Date().toISOString(),
  };

  // 1. RECENT_SONG_ONLY
  await pp.uploadTake();
  assert.equal(sb.getEl('takeLimitModal').hidden, true, 'RECENT_SONG_ONLY는 모달을 띄우지 않음');
  assert.ok(sb.getEl('recMsg').textContent.includes('가장 최근 연습 곡에만'));

  // 2. 404
  failStatus = 404;
  failCode = 'NOT_FOUND';
  failMsg = '곡을 찾을 수 없습니다';
  await pp.uploadTake();
  assert.equal(pp.st.song, null, '404 수신 시 st.song = null 필수');
  assert.equal(pp.rec.take.song, null, '404 수신 시 rec.take.song = null 필수');
  assert.ok(sb.getEl('recMsg').textContent.includes('계정에서 지워진 곡이에요'));
});

// -------------------------------------------------------------
// R3-P7: public/log.js 12주 달력 및 녹음 삭제 시 타 세션 textarea 보존 검증
// -------------------------------------------------------------
test('R3-P7: public/log.js 12주(84일) 달력 생성 및 녹음 삭제 시 타 세션 textarea 메모 보존 검증', async () => {
  const elements = new Map();
  const getEl = (id) => {
    if (!elements.has(id)) elements.set(id, createMockElement(id));
    return elements.get(id);
  };

  const reqIds = [
    'logHeader', 'logTabs', 'tab-log', 'tab-songs', 'logMsg', 'logGuest',
    'pane-log', 'sumWeek', 'sumMonth', 'calRange', 'calGrid', 'dayTitle',
    'daySessions', 'pane-songs', 'songFilters', 'songList', 'pane-song-detail',
    'btnBackSongs', 'detailTitle', 'detailArtist', 'detailMeta', 'detailResume',
    'detailStatus', 'btnDeleteSong', 'detailMemo', 'btnSaveSongMemo', 'detailTimeline',
    'detailTakes', 'abPanel', 'abSlotA', 'abLabelA', 'abPlayA', 'abAudioA',
    'abSlotB', 'abLabelB', 'abPlayB', 'abAudioB',
  ];
  reqIds.forEach(getEl);

  let removeCalled = false;
  const win = {
    document: {
      getElementById: (id) => getEl(id),
      createElement: (tag) => createMockElement('', tag),
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    location: { hash: '', search: '', pathname: '/log.html' },
    history: { pushState: () => {}, replaceState: () => {} },
    UL: { safeUrl: (u) => u, esc: (s) => s },
    ULAuth: {
      getUser: () => ({ id: 'u1' }),
      getMe: () => ({ id: 'u1' }),
      onChange: () => {},
    },
    ULData: {
      isLoggedIn: () => true,
      sessions: {
        list: async () => ({
          summary: { thisWeekSeconds: 3600, thisMonthSeconds: 7200 },
          calendar: [{ date: '2026-11-03', totalSeconds: 1200, level: 2 }],
          sessions: [
            {
              id: 'sess-1',
              date: '2026-11-03',
              songTitle: '곡 1',
              minutes: 10,
              seconds: 600,
              loops: 5,
              takes: [{ id: 'tk-1', recordedAt: '2026-11-03T10:00:00Z', durationSec: 20, storage: 'supabase' }],
            },
            {
              id: 'sess-2',
              date: '2026-11-03',
              songTitle: '곡 2',
              minutes: 10,
              seconds: 600,
              loops: 3,
              takes: [],
            },
          ],
        }),
        updateMemo: async () => ({ ok: true }),
      },
      takes: {
        remove: async (id) => {
          removeCalled = true;
          return { ok: true };
        },
      },
      songs: { list: async () => [] },
    },
    confirm: () => true,
    alert: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    Date,
    String,
    Number,
    Array,
    Map,
    Math,
    URL,
    URLSearchParams,
  };
  win.window = win;

  const code = readText('public/log.js');
  vm.runInNewContext(code, win);

  // microtask 대기
  await new Promise((r) => setTimeout(r, 20));

  // 12주 달력 84개 버튼 검증
  const calGrid = getEl('calGrid');
  assert.equal(calGrid.children.length, 84, '12주 84일 달력 셀 84개 생성 필수');

  // 날짜별 세션 카드 2개 확인
  const daySessions = getEl('daySessions');
  assert.equal(daySessions.children.length, 2, '2개 세션 카드 생성');

  const card1 = daySessions.children[0];
  const card2 = daySessions.children[1];

  // 세션 2의 textarea에 사용자 미저장 입력 시뮬레이션
  const textarea2 = card2.querySelector('textarea');
  assert.ok(textarea2, '세션 2 카드에 textarea 필수');
  textarea2.value = '작성 중인 미저장 메모';

  // 세션 1의 테이크 삭제 버튼 클릭
  const delBtn1 = card1.querySelectorAll('button').find((b) => b.textContent === '삭제');
  assert.ok(delBtn1, '세션 1에 삭제 버튼 존재');
  await delBtn1.listeners['click'][0]();

  assert.equal(removeCalled, true);
  // 세션 2의 textarea 값이 초기화되지 않고 보존되는지 단언 (주니어 체크리스트 55행)
  assert.equal(textarea2.value, '작성 중인 미저장 메모', '녹음 삭제 시 타 세션 미저장 textarea 보존 필수');
});

// -------------------------------------------------------------
// R3-P8: 곡 상세 타임라인(<progress>) 및 A/B 비교 듣기 검증
// -------------------------------------------------------------
test('R3-P8: public/log.js 및 LogPage.tsx 곡 상세 타임라인 및 A/B 비교 듣기 오름차순/교체/상호배타 검증', () => {
  // 1. LogPage.tsx의 sortAbTakes 함수 정적 검증
  const logPageSrc = readText('frontend/src/pages/LogPage.tsx');
  const sortMatch = logPageSrc.match(/export function sortAbTakes[\s\S]*?\n\}/);
  assert.ok(sortMatch, 'sortAbTakes 함수 정의 존재');

  const jsSort = sortMatch[0]
    .replace(/export function sortAbTakes\([^)]*\):[^{]+/, 'function sortAbTakes(t1, t2)')
    .concat('\nmodule.exports = sortAbTakes;');
  const mod = { exports: {} };
  vm.runInNewContext(jsSort, { module: mod });
  const sortAbTakes = mod.exports;

  const tEarly = { id: 't1', recordedAt: '2026-11-03T09:00:00Z' };
  const tLate = { id: 't2', recordedAt: '2026-11-03T11:00:00Z' };
  const pair1 = sortAbTakes(tEarly, tLate);
  assert.equal(pair1[0].id, 't1');
  assert.equal(pair1[1].id, 't2');
  const pair2 = sortAbTakes(tLate, tEarly);
  assert.equal(pair2[0].id, 't1', '오름차순 정렬 필수');
  assert.equal(pair2[1].id, 't2');

  // 2. LogPage.tsx와 public/log.js의 <progress> 사용 여부 확인
  assert.ok(logPageSrc.includes('<progress className={`tl-bar'), 'LogPage.tsx 타임라인에 <progress> 사용 필수');
  assert.ok(readText('public/log.js').includes("document.createElement('progress')"), 'public/log.js 타임라인에 <progress> 사용 필수');
});

// -------------------------------------------------------------
// R3-P9: 계정 전환 시 이전 상태 초기화 및 지연 응답 무시 검증
// -------------------------------------------------------------
test('R3-P9: practice.js 및 LogPage.tsx 계정 전환(A→B) 시 이전 상태 초기화 검증', async () => {
  const sb = createPracticeSandbox({
    user: { id: 'user-A' },
  });

  // start() 비동기 완료 대기
  await new Promise((r) => setTimeout(r, 20));

  const pp = sb.win.__pp;
  pp.st.song = { id: 's-A', videoId: 'vid-A', title: 'User A 곡' };
  pp.rec.take = { done: false, song: pp.st.song };

  // 사용자 B로 전환
  sb.ULAuth._trigger({ id: 'user-B' }, { storageProvider: 'supabase' });

  assert.equal(pp.st.song, null, '계정 전환 시 st.song 즉시 null 초기화');
  assert.equal(pp.rec.take.song, null, '계정 전환 시 rec.take.song 즉시 null 초기화');
});

// -------------------------------------------------------------
// R3-P10: 순백 0건, 중간 곡률 0건, 인라인 스타일 0건, 시크릿 리터럴 0건 검증
// -------------------------------------------------------------
test('R3-P10: PracticePage.module.css, LogPage.module.css, public/practice.css 순백 0건, 중간 곡률 0건, 인라인 스타일 0건 검증', () => {
  const cssFiles = [
    'frontend/src/pages/PracticePage.module.css',
    'frontend/src/pages/LogPage.module.css',
    'public/practice.css',
  ];
  const allowedRadius = new Set(['0', '0px', '50%', '9999px', 'var(--radius-pill)', 'var(--radius-card)']);

  for (const rel of cssFiles) {
    const text = readText(rel).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(text.match(/#(?:ffffff|fff)\b/i), null, `${rel}에 순백(#ffffff/#fff) 금지`);
    for (const m of text.matchAll(/border-radius\s*:\s*([^;!}]+)/gi)) {
      const val = m[1].trim();
      assert.ok(allowedRadius.has(val), `${rel}에 허용되지 않은 곡률 사용: ${val}`);
    }
  }

  // frontend/src 전체 tsx 파일 인라인 style={{ 0건 및 dangerouslySetInnerHTML 0건 검증
  const tsxFiles = [
    'frontend/src/pages/PracticePage.tsx',
    'frontend/src/pages/LogPage.tsx',
    'frontend/src/App.tsx',
  ];
  for (const rel of tsxFiles) {
    const text = readText(rel);
    assert.ok(!text.includes('style={{'), `${rel}에 style={{ 인라인 스타일 사용 금지`);
    assert.ok(!text.includes('dangerouslySetInnerHTML'), `${rel}에 dangerouslySetInnerHTML 사용 금지`);
  }
});

// -------------------------------------------------------------
// R3-P11: A/B 비교 듣기 비동기 URL 조회 중 페어 변경/로그아웃 레이스 방어 검증 (PR #43 리뷰 1번)
// -------------------------------------------------------------
test('R3-P11: LogPage.tsx 및 public/log.js A/B 비교 슬롯 재생 비동기 레이스 방어 토큰 검증', () => {
  const reactSrc = readText('frontend/src/pages/LogPage.tsx');
  assert.ok(reactSrc.includes('abReqSeqRef = useRef(0);'), 'LogPage.tsx에 abReqSeqRef 선언 필수');
  assert.ok(reactSrc.includes('abPairRef = useRef'), 'LogPage.tsx에 abPairRef 선언 필수');
  assert.ok(reactSrc.includes('const isSlotValid = () => {'), 'handlePlayAbSlot 내 isSlotValid 가드 필수');
  assert.ok(reactSrc.includes('if (!isSlotValid()) return;'), 'await 복귀 후 및 src 할당 직전 isSlotValid 가드 필수');

  const vanillaSrc = readText('public/log.js');
  assert.ok(vanillaSrc.includes('let abReqSeq = 0;'), 'public/log.js에 abReqSeq 선언 필수');
  assert.ok(vanillaSrc.includes('function isSlotValid() {'), 'public/log.js playSlot 내 isSlotValid 가드 필수');
});
