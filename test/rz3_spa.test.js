const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const ENTRY = ['index.html', 'chords.html', 'practice.html', 'log.html', 'notes.html', 'note.html', 'settings.html', 'privacy.html', 'progressions.html'];

describe('RZ3-1: Ktor·server.js SPA 진입 경로 목록 일치', () => {
  test('Main.kt SPA_ENTRY_PAGES와 server.js SPA_PAGES가 9개 진입 경로로 같다', () => {
    const kt = read('src/main/kotlin/ulevelp/Main.kt');
    const js = read('server.js');
    for (const p of ENTRY) {
      assert.ok(new RegExp(`SPA_ENTRY_PAGES[\\s\\S]*"${p.replace('.', '\\.')}"`).test(kt), `Main.kt에 ${p}`);
      assert.ok(js.includes(`'/${p}'`), `server.js에 /${p}`);
    }
    assert.match(kt, /uiMode\.trim\(\)\.lowercase\(\)\s*!=\s*"legacy"/);
    assert.match(js, /process\.env\.ULP_UI\s*===\s*'spa'/);
  });
});

describe('RZ3-2: 엔진은 frontend/src/lib/engine의 ES 모듈 (CH-E에서 public/lib CJS 변환 제거)', () => {
  test('vite.config.ts에 public/lib CJS 변환이 없다', () => {
    assert.ok(!/public(\[\\\\\/\]|\/)lib/.test(read('vite.config.ts')));
  });
});

describe('RZ3-3: CI·배포 계약', () => {
  test('E2E가 legacy·spa 2모드로 돌고 Docker 스모크가 SPA·롤백을 확인한다', () => {
    const ci = read('.github/workflows/ci.yml');
    assert.match(ci, /ui:\s*\[legacy,\s*spa\]/);
    assert.match(ci, /ULP_UI:\s*\$\{\{\s*matrix\.ui\s*\}\}/);
    assert.match(ci, /-e ULP_UI=legacy/);
  });
  test('배포가 ULP_UI를 전달하고 운영 기본 ALLOWED_ORIGINS에 localhost가 없다', () => {
    const wf = read('.github/workflows/deploy-cloudrun.yml');
    const sh = read('scripts/deploy-cloudrun.sh');
    assert.match(wf, /ULP_UI:\s*\$\{\{\s*vars\.ULP_UI\s*\|\|\s*'spa'\s*\}\}/);
    assert.match(sh, /ULP_UI=\$\{ULP_UI\}/);
    assert.ok(!/ALLOWED_ORIGINS[^\n]*localhost/.test(wf), 'deploy-cloudrun.yml 기본값에 localhost 금지');
    assert.ok(!/ALLOWED_ORIGINS=[^\n]*localhost/.test(sh), 'deploy-cloudrun.sh 기본값에 localhost 금지');
  });
});

describe('RZ3-4: React 화면 제목·설정 버튼 줄바꿈', () => {
  test('5개 React 화면이 레거시와 같은 document.title을 설정한다', () => {
    const want = {
      ChordsPage: '기타 코드 연습실',
      NotesPage: '학습 노트 · ULeveLP',
      NoteDetailPage: '학습 노트 상세 · ULeveLP',
      SettingsPage: '설정 · ULeveLP',
      PrivacyPage: '개인정보처리방침 · ULeveLP',
    };
    for (const [name, title] of Object.entries(want)) {
      assert.ok(read(`frontend/src/pages/${name}.tsx`).includes(`document.title = '${title}'`), name);
    }
  });
  test('#btnOpenGeminiModal이 legacy·React 모두 줄바꿈을 허용한다', () => {
    assert.match(read('public/site.css'), /#btnOpenGeminiModal\s*\{[^}]*white-space:\s*normal/);
    assert.match(read('frontend/src/pages/SettingsPage.module.css'), /\.geminiGuideBtn\s*\{[^}]*white-space:\s*normal/);
    assert.match(read('frontend/src/pages/SettingsPage.tsx'), /styles\.geminiGuideBtn/);
  });
});
