// R1-2 설정(SettingsPage) · 노트(NotesPage/NoteDetailPage) · Gemini 1분 온보딩 모달 검증 테스트 (R1-S1 ~ R1-S8)
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

// GeminiKeyOnboardingModal.tsx에서 validateGeminiKeyFormat 함수만 추출해 VM에서 실행
function loadValidateGeminiKeyFormat() {
  const src = readText('frontend/src/components/common/GeminiKeyOnboardingModal.tsx');
  const m = src.match(/export const GEMINI_KEY_REGEX[\s\S]*?export function validateGeminiKeyFormat[\s\S]*?\n\}/);
  assert.ok(m, 'validateGeminiKeyFormat 정의가 존재해야 함');
  const jsCode = m[0]
    .replace(/export\s+interface\s+[A-Za-z0-9_]+\s*\{[\s\S]*?\n\}/g, '')
    .replace(/export const /g, 'const ')
    .replace(/export function validateGeminiKeyFormat\([^)]*\):\s*GeminiKeyValidationResult/, 'function validateGeminiKeyFormat(rawInput)')
    .concat('\nmodule.exports = { GEMINI_KEY_REGEX, validateGeminiKeyFormat };');
  const mod = { exports: {} };
  vm.runInNewContext(jsCode, { module: mod, exports: mod.exports, String });
  return mod.exports.validateGeminiKeyFormat;
}

// NoteDetailPage.tsx에서 parseTimestampSec 함수 추출
function loadParseTimestampSec() {
  const src = readText('frontend/src/pages/NoteDetailPage.tsx');
  const m = src.match(/export function parseTimestampSec[\s\S]*?\n\}/);
  assert.ok(m, 'parseTimestampSec 정의가 존재해야 함');
  const jsCode = m[0]
    .replace(/export function parseTimestampSec\([^)]*\):\s*number\s*\|\s*null/, 'function parseTimestampSec(ts)')
    .concat('\nmodule.exports = parseTimestampSec;');
  const mod = { exports: {} };
  vm.runInNewContext(jsCode, { module: mod, Number, parseInt });
  return mod.exports;
}

test('R1-S1: validateGeminiKeyFormat — 빈 문자열·공백 포함 39자 유효 키·오류 입력 경계값 검증', () => {
  const validate = loadValidateGeminiKeyFormat();

  const rIdle = validate('   ');
  assert.equal(rIdle.valid, false);
  assert.equal(rIdle.status, 'idle');

  const validFakeKey = 'AI' + 'za' + 'A1b2_-'.repeat(5) + 'abcde'; // 4 + 30 + 5 = 39자
  assert.equal(validFakeKey.length, 39);
  const rOk = validate('  ' + validFakeKey + '\n ');
  assert.equal(rOk.valid, true);
  assert.equal(rOk.status, 'ok');
  assert.equal(rOk.trimmed, validFakeKey);
  assert.ok(rOk.hint.includes('39자'));

  const rShort = validate('AIza12345');
  assert.equal(rShort.valid, false);
  assert.equal(rShort.status, 'err');
  assert.ok(rShort.hint.includes('현재 9자'));
});

test('R1-S2: <GeminiKeyOnboardingModal /> 및 정적 HTML — 3대 안심 배지·AI Studio 링크·4단계 가이드·verify: true 검증', () => {
  const modalTsx = readText('frontend/src/components/common/GeminiKeyOnboardingModal.tsx');
  const pubSettings = readText('public/settings.html');
  const pubNotes = readText('public/notes.html');

  for (const target of [modalTsx, pubSettings, pubNotes]) {
    assert.ok(target.includes('AI 기능을 무료로 이용하기 위한 1분 설정'), '온보딩 모달 타이틀 필수');
    assert.ok(target.includes('무료 사용 가능 (분당 15회 무료 요청)'), '안심 배지 1 필수');
    assert.ok(target.includes('신용카드 등록 불필요'), '안심 배지 2 필수');
    assert.ok(target.includes('AES-256-GCM 암호화 보관'), '안심 배지 3 필수');
    assert.ok(target.includes('https://aistudio.google.com/app/apikey'), 'AI Studio 원클릭 링크 필수');
    assert.ok(target.includes('Create API key in new project'), '4단계 발급 안내 문구 필수');
  }

  assert.ok(modalTsx.includes('verify: true'), '모달 저장 시 verify: true 전달 필수');
});

test('R1-S3: R1-2 신규 CSS Modules 4종 & public/site.css — 순백(#ffffff/#fff) 0건 및 중간 곡률 0건', () => {
  const cssFiles = [
    'frontend/src/components/common/GeminiKeyOnboardingModal.module.css',
    'frontend/src/pages/SettingsPage.module.css',
    'frontend/src/pages/NotesPage.module.css',
    'frontend/src/pages/NoteDetailPage.module.css',
    'public/site.css',
  ];
  const allowedRadius = new Set(['0', '0px', '50%', '9999px', 'var(--radius-pill)', 'var(--radius-card)']);

  for (const file of cssFiles) {
    const src = readText(file).replace(/\/\*[\s\S]*?\*\//g, '');
    const whiteMatch = src.match(/#(?:ffffff|fff)\b/i);
    assert.equal(whiteMatch, null, file + '에 금지된 순백 컬러가 존재함');
    for (const m of src.matchAll(/border-radius\s*:\s*([^;!}]+)/gi)) {
      const val = m[1].trim();
      assert.ok(allowedRadius.has(val), file + '에 허용되지 않은 중간 곡률 사용: ' + val);
    }
  }
});

test('R1-S4: SettingsPage, NotesPage, NoteDetailPage, PrivacyPage 및 App.tsx 라우트·필수 ID 구조 검증', () => {
  const appTsx = readText('frontend/src/App.tsx');
  const settingsTsx = readText('frontend/src/pages/SettingsPage.tsx');
  const notesTsx = readText('frontend/src/pages/NotesPage.tsx');
  const detailTsx = readText('frontend/src/pages/NoteDetailPage.tsx');
  const privacyTsx = readText('frontend/src/pages/PrivacyPage.tsx');

  for (const comp of ['<SettingsPage />', '<NotesPage />', '<NoteDetailPage />', '<PrivacyPage />']) {
    assert.ok(appTsx.includes(comp), 'App.tsx 라우트 누락: ' + comp);
  }

  for (const id of [
    'account', 'accEmail', 'accName', 'quotaBar', 'driveStoragePanel',
    'nx', 'inpImportZip', 'btnPreviewZip', 'nxPreviewBox', 'nxPreviewList',
    'keys', 'notionKeyStatus', 'ntnSongsDb', 'ntnSessionsDb', 'geminiKeyStatus', 'gemModel', 'btnOpenGeminiModal',
  ]) {
    assert.ok(settingsTsx.includes(`id="${id}"`), 'SettingsPage.tsx 누락 ID: ' + id);
  }

  for (const id of ['keyGateBox', 'keyGateMsg', 'btnKeyGateModal', 'form', 'url', 'preview', 'tags', 'memo', 'submit', 'jobs', 'notesList']) {
    assert.ok(notesTsx.includes(`id="${id}"`), 'NotesPage.tsx 누락 ID: ' + id);
  }

  for (const id of ['noteContent', 'noteHeader', 'noteTitle', 'noteMeta', 'noteHeadline', 'noteSections', 'notePractice', 'noteMemoInput', 'noteLoadingMsg']) {
    assert.ok(detailTsx.includes(`id="${id}"`), 'NoteDetailPage.tsx 누락 ID: ' + id);
  }

  for (const id of ['privH1', 'privH2', 'privH3', 'privH4']) {
    assert.ok(privacyTsx.includes(`id="${id}"`), 'PrivacyPage.tsx 누락 ID: ' + id);
  }
});

test('R1-S5: public/settings.js 온보딩 모달 오픈·실시간 형식 검증·verify: true 저장 후 상태 배지 즉시 갱신', async () => {
  const elements = new Map();
  function makeEl(id) {
    return {
      id,
      value: '',
      hidden: id === 'geminiOnboardingModal' || id === 'nxPreviewBox',
      disabled: false,
      checked: true,
      textContent: '',
      className: '',
      href: '',
      dataset: { theme: '' },
      listeners: {},
      addEventListener(ev, fn) {
        this.listeners[ev] = fn;
      },
      setAttribute(k, v) {
        this[k] = v;
      },
      replaceChildren() {},
    };
  }

  for (const id of [
    'account', 'accGuest', 'accUser', 'btnLogin', 'btnLoginBlank', 'accEmail', 'accName', 'quotaBar', 'quotaText',
    'driveStoragePanel', 'driveProviderText', 'driveStatusMsg', 'driveConflictNotice', 'btnDriveEnable', 'btnDriveDisable', 'btnDriveMigrate',
    'btnLogout', 'delConfirm', 'btnDeleteAcc', 'accMsg',
    'btnNotionTemplate', 'chkExportAudio', 'btnExportZip', 'inpImportZip', 'btnPreviewZip', 'nxPreviewBox', 'nxPreviewSummary', 'nxPreviewList', 'btnConfirmZip', 'btnCancelZip', 'nxMsg',
    'notionKeyStatus', 'ntnToken', 'ntnSongsDb', 'ntnSessionsDb', 'ntnNotesDb', 'btnSaveNotionKey', 'btnCheckNotionKey', 'btnDelNotionKey', 'ntnKeyMsg',
    'notionSyncPanel', 'syncStatusText', 'syncErrorText', 'btnSyncEnable', 'btnSyncDisable', 'btnSyncPull', 'btnSyncPush', 'syncMsg',
    'geminiKeyStatus', 'btnOpenGeminiModal', 'gemKey', 'gemModel', 'btnSaveGeminiKey', 'btnCheckGeminiKey', 'btnDelGeminiKey', 'gemKeyMsg',
    'nlPractice', 'nlNotes', 'nlSave', 'nlMsg',
    'geminiOnboardingModal', 'btnCloseGeminiModal', 'gemModalKeyInput', 'gemModalFormatHint', 'gemModalResultMsg', 'btnModalSaveGemini',
  ]) {
    elements.set(id, makeEl(id));
  }

  let savedPayload = null;
  const user = { id: 'u-1', email: 'test@example.com' };
  const sandbox = {
    document: {
      getElementById: (id) => elements.get(id) || null,
      querySelectorAll: () => [],
      createElement: (t) => makeEl(t),
      documentElement: { dataset: {} },
    },
    location: { href: 'http://localhost:3000/settings.html' },
    UL: {
      raw: { get: () => '', set: () => {} },
      json: { get: (_k, d) => d, set: () => {} },
      safeUrl: (u) => String(u || ''),
    },
    window: {
      ULEVELP_CONFIG: {},
      ULAuth: {
        isEmbedded: () => false,
        getUser: () => user,
        getMe: () => ({ id: 'u-1', email: 'test@example.com', storageProvider: 'supabase', keys: {} }),
        onChange: (cb) => cb({ user, me: { id: 'u-1', email: 'test@example.com', storageProvider: 'supabase' } }),
      },
      ULData: {
        integrations: {
          list: async () => [],
          saveGemini: async (input) => {
            savedPayload = input;
            return {
              provider: 'gemini',
              hint: 'X9zQ',
              config: { model: input.model || 'gemini-flash-latest' },
              updatedAt: '2026-11-03T00:00:00Z',
              verified: true,
              displayName: 'Gemini 1.5 Flash',
            };
          },
        },
        notionSync: {
          status: async () => ({ enabled: false, pending: 0, failed: 0 }),
        },
      },
    },
    Math,
    String,
    Array,
  };
  sandbox.window.document = sandbox.document;
  sandbox.window.UL = sandbox.UL;

  vm.runInNewContext(readText('public/settings.js'), sandbox);
  await new Promise((r) => setTimeout(r, 10));

  // 1) 가이드 모달 열기
  assert.equal(elements.get('geminiOnboardingModal').hidden, true);
  elements.get('btnOpenGeminiModal').listeners.click();
  assert.equal(elements.get('geminiOnboardingModal').hidden, false);
  assert.equal(elements.get('btnModalSaveGemini').disabled, true);

  // 2) 39자리 키 입력
  const fakeKey = 'AI' + 'za' + 'K'.repeat(35);
  elements.get('gemModalKeyInput').value = '  ' + fakeKey + ' ';
  elements.get('gemModalKeyInput').listeners.input();
  assert.equal(elements.get('btnModalSaveGemini').disabled, false);

  // 3) 키 검증 후 저장 클릭
  await elements.get('btnModalSaveGemini').listeners.click();
  assert.equal(savedPayload.apiKey, fakeKey);
  assert.equal(savedPayload.verify, true);
  assert.ok(elements.get('geminiKeyStatus').textContent.includes('X9zQ'));
  assert.ok(elements.get('gemModalResultMsg').textContent.includes('정상 작동합니다'));
});

test('R1-S6: public/notes.js 온보딩 모달 키 저장 시 미저장 입력(#url, #tags, #memo) 보존 및 즉시 분석 버튼 활성화', async () => {
  const elements = new Map();
  const tagButtons = [];
  function makeEl(id) {
    return {
      id,
      value: '',
      hidden: id === 'geminiOnboardingModal',
      disabled: false,
      textContent: '',
      className: '',
      href: '',
      src: '',
      firstChild: null,
      children: [],
      listeners: {},
      classList: { toggle() {} },
      addEventListener(ev, fn) {
        this.listeners[ev] = fn;
      },
      setAttribute(k, v) {
        this[k] = v;
      },
      appendChild(c) {
        this.children.push(c);
        if (id === 'tags') tagButtons.push(c);
        return c;
      },
      removeChild() {},
      querySelector: () => ({ src: '' }),
      querySelectorAll: () => [],
    };
  }

  for (const id of [
    'msg', 'keyGateBox', 'keyGateMsg', 'btnKeyGateModal', 'form', 'url', 'preview', 'tags', 'memo', 'submit',
    'jobs', 'noteTagFilter', 'notesList', 'notionLink',
    'geminiOnboardingModal', 'btnCloseGeminiModal', 'gemModalKeyInput', 'gemModalFormatHint', 'gemModalResultMsg', 'btnModalSaveGemini',
  ]) {
    elements.set(id, makeEl(id));
  }

  let hasKey = false;
  const user = { id: 'u-notes-1' };
  const sandbox = {
    document: {
      readyState: 'complete',
      getElementById: (id) => elements.get(id) || null,
      createElement: (t) => makeEl(t),
      addEventListener: () => {},
    },
    location: { search: '?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DjNQXAC9IVRw', pathname: '/notes.html' },
    history: { replaceState: () => {} },
    UL: {
      raw: { get: () => '', set: () => {} },
      videoIdFrom: (s) => (String(s || '').includes('jNQXAC9IVRw') ? 'jNQXAC9IVRw' : null),
      thumb: (id) => 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg',
      safeUrl: (u) => String(u || ''),
    },
    window: {
      ULAuth: {
        getAccessToken: async () => 'tok',
        getUser: () => user,
        getMe: () => ({ id: 'u-notes-1', keys: { gemini: hasKey ? { hint: '9999' } : null } }),
        onChange: () => {},
      },
      ULData: {
        isLoggedIn: () => true,
        getCachedKeys: () => ({ notion: null, gemini: hasKey ? { hint: '9999' } : null }),
        integrations: {
          saveGemini: async () => {
            hasKey = true;
            return { provider: 'gemini', hint: '9999', config: { model: 'gemini-flash-latest' }, updatedAt: '2026-11-03T00:00:00Z', verified: true };
          },
        },
        notes: {
          listJobs: async () => [],
          list: async () => [],
        },
      },
    },
    URLSearchParams,
    Set,
    Date,
    Math,
    String,
    Array,
    setTimeout,
    clearTimeout,
    encodeURIComponent,
  };
  sandbox.window.document = sandbox.document;
  sandbox.window.UL = sandbox.UL;

  vm.runInNewContext(readText('public/notes.js'), sandbox);
  await new Promise((r) => setTimeout(r, 10));

  // 초기: 키 미등록이므로 keyGateBox 노출 및 submit 비활성
  assert.equal(elements.get('keyGateBox').hidden, false);
  assert.equal(elements.get('submit').disabled, true);

  // 사용자가 메모와 태그('화성')를 선택해 둔 상태
  elements.get('memo').value = '3:20 보이싱 집중 분석';
  tagButtons[0].listeners.click();
  assert.equal(tagButtons[0]['aria-pressed'], 'true');

  // 배너에서 1분 무료 키 발급 모달 열기 -> 키 저장
  elements.get('btnKeyGateModal').listeners.click();
  assert.equal(elements.get('geminiOnboardingModal').hidden, false);
  elements.get('gemModalKeyInput').value = 'AI' + 'za' + 'Z'.repeat(35);
  elements.get('gemModalKeyInput').listeners.input();
  await elements.get('btnModalSaveGemini').listeners.click();

  // 저장 직후: 미저장 URL, 태그, 메모가 날아가지 않고 그대로 유지되며 keyGateBox가 숨겨지고 submit이 즉시 활성화됨
  assert.equal(elements.get('url').value, 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
  assert.equal(elements.get('memo').value, '3:20 보이싱 집중 분석');
  assert.equal(tagButtons[0]['aria-pressed'], 'true');
  assert.equal(elements.get('keyGateBox').hidden, true);
  assert.equal(elements.get('submit').disabled, false);
});

test('R1-S7 & R1-S8: parseTimestampSec 검증 및 frontend/ 시크릿 패턴·인라인 스타일 0건 검증', () => {
  const parseTs = loadParseTimestampSec();
  assert.equal(parseTs('0:15'), 15);
  assert.equal(parseTs('03:20'), 200);
  assert.equal(parseTs('1:02:05'), 3725);
  assert.equal(parseTs(''), null);
  assert.equal(parseTs('abc'), null);

  function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(?:ts|tsx|css|html)$/.test(e.name)) out.push(p);
    }
    return out;
  }
  const secretRe = /AIza[0-9A-Za-z_-]{30,}|\bntn_[A-Za-z0-9]{10,}/;
  for (const f of walk(path.join(ROOT, 'frontend'))) {
    const txt = fs.readFileSync(f, 'utf8');
    assert.equal(secretRe.test(txt), false, f + '에 실제 시크릿 모양 리터럴이 포함됨');
    assert.equal(/\bstyle\s*=\s*\{\{/.test(txt), false, f + '에 인라인 style={{ 속성이 포함됨');
    assert.equal(/\bdangerouslySetInnerHTML\s*=/.test(txt), false, f + '에 dangerouslySetInnerHTML 속성이 포함됨');
  }
});

test('R1-S9 (PR #39 리뷰 반영): NotesPage 및 public/notes.js 태그 필터 변경 시 잡 폴링 타이머 유지 및 최신 필터 참조 검증', async () => {
  const notesTsx = readText('frontend/src/pages/NotesPage.tsx');
  assert.ok(notesTsx.includes('const notesReqSeqRef = useRef(0);'), 'notesReqSeqRef 분리 필수');
  assert.ok(notesTsx.includes('const jobsReqSeqRef = useRef(0);'), 'jobsReqSeqRef 분리 필수');
  assert.ok(notesTsx.includes('const filterTagRef = useRef(filterTag);'), 'filterTagRef 선언 필수');
  assert.ok(notesTsx.includes('loadNotesOnly(filterTagRef.current, uid)'), '잡 완료 시 최신 filterTagRef 참조 필수');
  assert.ok(notesTsx.includes('const refreshJobsAndNotes = async (uid: string | null) =>'), 'refreshJobsAndNotes는 특정 tag를 캡처하지 않아야 함');

  const notesJs = readText('public/notes.js');
  assert.ok(notesJs.includes('let notesReqSeq = 0;'), 'public/notes.js notesReqSeq 분리 필수');
  assert.ok(notesJs.includes('let jobsReqSeq = 0;'), 'public/notes.js jobsReqSeq 분리 필수');

  // VM 환경에서 태그 필터 변경 시 백그라운드 잡 폴링이 중단되지 않고 유지되는지 검증
  const tagButtons = [];
  const elements = new Map();
  function makeEl(id) {
    return {
      id,
      value: '',
      hidden: false,
      disabled: false,
      textContent: '',
      children: [],
      listeners: {},
      addEventListener(ev, fn) {
        this.listeners[ev] = fn;
      },
      setAttribute(k, v) {
        this[k] = v;
      },
      appendChild(c) {
        this.children.push(c);
        if (id === 'noteTagFilter') tagButtons.push(c);
        return c;
      },
      removeChild() {},
      querySelectorAll: () => tagButtons,
    };
  }

  for (const id of [
    'msg', 'keyGateBox', 'keyGateMsg', 'btnKeyGateModal', 'form', 'url', 'preview', 'tags', 'memo', 'submit',
    'jobs', 'noteTagFilter', 'notesList', 'notionLink',
    'geminiOnboardingModal', 'btnCloseGeminiModal', 'gemModalKeyInput', 'gemModalFormatHint', 'gemModalResultMsg', 'btnModalSaveGemini',
  ]) {
    elements.set(id, makeEl(id));
  }

  const requestedNoteTags = [];
  let pollCount = 0;
  const timers = new Set();
  const customSetTimeout = (fn, delay) => {
    const id = setTimeout(fn, delay);
    timers.add(id);
    return id;
  };
  const customClearTimeout = (id) => {
    timers.delete(id);
    clearTimeout(id);
  };

  const user = { id: 'u-notes-poll' };
  const sandbox = {
    document: {
      readyState: 'complete',
      getElementById: (id) => elements.get(id) || null,
      createElement: (t) => makeEl(t),
      addEventListener: () => {},
    },
    location: { search: '', pathname: '/notes.html' },
    history: { replaceState: () => {} },
    UL: {
      raw: { get: () => '', set: () => {} },
      videoIdFrom: () => null,
      thumb: () => '',
      safeUrl: (u) => String(u || ''),
    },
    window: {
      ULAuth: {
        getAccessToken: async () => 'tok',
        getUser: () => user,
        getMe: () => ({ id: 'u-notes-poll', keys: { gemini: { hint: '9999' } } }),
        onChange: (fn) => {
          // 초기 사용자 설정
          customSetTimeout(() => fn({ user }), 0);
        },
      },
      ULData: {
        isLoggedIn: () => true,
        getCachedKeys: () => ({ notion: null, gemini: { hint: '9999' } }),
        notes: {
          listJobs: async () => {
            pollCount++;
            return [{ id: 'job-run-1', status: 'running', createdAt: new Date().toISOString() }];
          },
          list: async (tag) => {
            requestedNoteTags.push(tag);
            return [];
          },
        },
      },
    },
    URLSearchParams,
    Set,
    Date,
    Math,
    String,
    Array,
    setTimeout: customSetTimeout,
    clearTimeout: customClearTimeout,
    console,
  };
  sandbox.window.document = sandbox.document;
  sandbox.window.UL = sandbox.UL;

  try {
    vm.runInNewContext(notesJs, sandbox);
    await new Promise((r) => setTimeout(r, 20));

    // 초기 로드 시 1회 잡 조회
    assert.ok(pollCount >= 1, '최소 1회 잡 조회 실행');

    // 사용자가 태그 필터('화성', 2번째 버튼)를 클릭
    const harmonicTagBtn = tagButtons.find((b) => b.textContent === '화성');
    assert.ok(harmonicTagBtn, '화성 태그 버튼이 존재해야 함');
    harmonicTagBtn.listeners.click();
    await new Promise((r) => setTimeout(r, 20));

    // 태그 변경 시 notes.list('화성') 호출 확인
    assert.ok(requestedNoteTags.includes('화성'), '태그 필터 변경 시 화성 태그로 notes.list가 호출되어야 함');
  } finally {
    for (const t of timers) {
      clearTimeout(t);
    }
    timers.clear();
  }
});

// SettingsPage.tsx의 notionDbIdFromInput 추출
function loadNotionDbIdFromInput() {
  const src = readText('frontend/src/pages/SettingsPage.tsx');
  const m = src.match(/function notionDbIdFromInput\(raw: string\): string \{[\s\S]*?\n\}/);
  assert.ok(m, 'notionDbIdFromInput 정의가 존재해야 함');
  const jsCode = m[0]
    .replace('function notionDbIdFromInput(raw: string): string', 'function notionDbIdFromInput(raw)')
    .replace('let pathname: string;', 'let pathname;')
    .concat('\nmodule.exports = notionDbIdFromInput;');
  const mod = { exports: {} };
  vm.runInNewContext(jsCode, { module: mod, URL });
  return mod.exports;
}

test('R1-S10: 노션 DB 링크를 붙여넣어도 DB ID만 저장하고, 템플릿 기준 연결 안내가 있다', () => {
  const f = loadNotionDbIdFromInput();
  const id = '8f539d9f76f84014af586a19f965d862';
  const view = '0123456789abcdef0123456789abcdef';
  assert.equal(f(`https://www.notion.so/${id}?v=${view}`), id, '?v= 보기 ID가 아니라 경로의 DB ID');
  assert.equal(f(`https://www.notion.so/myspace/Cafe-${id}?v=${view}&pvs=4`), id, '워크스페이스·제목 slug 포함');
  assert.equal(f(`https://app.notion.com/p/${id}?pvs=204`), id);
  assert.equal(f('https://www.notion.so/8f539d9f-76f8-4014-af58-6a19f965d862'), '8f539d9f-76f8-4014-af58-6a19f965d862');
  assert.equal(f(`  ${id}  `), id, 'ID 직접 입력은 공백만 제거');
  // 잘못된 입력: ID가 없는 링크는 그대로 넘겨 서버 400(32자리 형식 오류)으로
  assert.equal(f('https://www.notion.so/no-id-here'), 'https://www.notion.so/no-id-here');
  assert.equal(f(''), '');

  const src = readText('frontend/src/pages/SettingsPage.tsx');
  assert.match(src, /songsDb: notionDbIdFromInput\(ntnSongsDb\)/);
  assert.match(src, /sessionsDb: notionDbIdFromInput\(ntnSessionsDb\)/);
  assert.match(src, /notesDb: notionDbIdFromInput\(ntnNotesDb\) \|\| null/);
  const guide = src.match(/<ol className=[^>]* id="ntnGuide">[\s\S]*?<\/ol>/);
  assert.ok(guide, '노션 연결 안내 목록');
  assert.match(guide[0], /href=\{templateHref\}/, '안내 1단계가 공식 템플릿 링크');
  assert.equal((guide[0].match(/<li>/g) || []).length, 5);
  assert.match(readText('public/config.js'), /notionTemplateUrl: 'https:\/\/app\.notion\.com\/p\/4097a337e26f8167aa10eb435edb676e\?source=copy_link'/);
});

test('CH-7b: 노션 연동은 설정 맨 아래 고급 접힘 안으로 은닉(계획/앱_명세.md §5), 다른 화면의 노션 유도 없음', () => {
  const src = readText('frontend/src/pages/SettingsPage.tsx');
  const a = src.indexOf('id="advNotion"');
  const end = src.indexOf('</details>', a);
  assert.ok(a > 0 && end > a, '고급 설정 details가 있어야 함');
  assert.ok(src.indexOf('id="screen"') < a, '고급 설정은 화면 섹션 뒤(맨 아래)');
  for (const id of ['btnNotionTemplate', 'ntnGuide', 'ntnToken', 'btnSyncEnable', 'inpImportZip', 'nlPractice']) {
    const i = src.indexOf(`id="${id}"`);
    assert.ok(i > a && i < end, `${id}는 고급 설정 안에 있어야 함`);
  }
  assert.ok(src.indexOf('id="btnExportZip"') < a, '백업 ZIP 내보내기는 밖에 남음');
  assert.ok(!/<details[^>]*id="advNotion"[^>]*\sopen\s*>/.test(src) && src.includes("useState(() => ['#advanced', '#notion', '#links'].includes(window.location.hash))"), '기본 접힘, 노션 해시로 오면 펼침');
  const home = readText('frontend/src/pages/HomePage.tsx');
  assert.ok(!home.includes('노션 연결 →'));
  assert.match(home, /id="notionBig"[\s\S]{0,120}hidden=\{!mainNotionUrl\}/, 'NOTION 큰 링크는 주소가 있을 때만');
  assert.ok(!readText('frontend/src/pages/PracticePage.tsx').includes('노션 연결 설정'));
  assert.ok(!readText('frontend/src/pages/NotesPage.tsx').includes('노션에 자동 정리'));
});
