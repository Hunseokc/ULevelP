// R0-1 프론트 코어 & DESIGN.md 정렬·토큰·래퍼·보안 컴포넌트 검증 (R0-T1 ~ R0-T10)
// 외부 의존성 없이 Node 내장 모듈(node:test, node:assert/strict, node:fs, node:path)만 사용한다.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function readText(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8').replace(/\r\n/g, '\n');
}

function extractCssVars(cssBlock) {
  const vars = new Map();
  const re = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  for (const m of cssBlock.matchAll(re)) {
    vars.set(m[1].trim(), m[2].trim());
  }
  return vars;
}

const REQUIRED_TOKENS = [
  '--bg', '--surface', '--surface2', '--ink', '--ink-navy', '--muted', '--line',
  '--accent', '--accent-ink', '--blue-vivid', '--blue-deep', '--accent-text', '--link',
  '--root', '--root-ink', '--guide', '--guide-ink', '--other', '--other-line',
  '--orange-vivid', '--orange-terra', '--now', '--now-ink', '--now-ring', '--moved',
  '--wood', '--wood-line', '--string', '--good', '--bad',
  '--font-body', '--font-mono', '--font-display',
  '--radius-pill', '--radius-card',
  '--container-max', '--page-narrow-max', '--player-max', '--header-height',
];

test('R0-T1: tokens.css ↔ public/styles.css 필수 디자인 토큰 일치 및 순백(#ffffff/#fff) 0건', () => {
  const tokensCss = readText('frontend/src/styles/tokens.css');
  const stylesCss = readText('public/styles.css');
  const siteCss = readText('public/site.css');
  const practiceCss = readText('public/practice.css');

  const rootTokens = extractCssVars(tokensCss.split('@media')[0]);
  const rootStyles = extractCssVars(stylesCss.split('@media')[0]);

  for (const token of REQUIRED_TOKENS) {
    assert.ok(rootTokens.has(token), 'tokens.css 누락 토큰: ' + token);
    assert.ok(rootStyles.has(token), 'public/styles.css 누락 토큰: ' + token);
    assert.equal(
      rootTokens.get(token).toLowerCase(),
      rootStyles.get(token).toLowerCase(),
      '토큰 값 불일치: ' + token
    );
  }

  assert.equal(rootTokens.get('--bg').toUpperCase(), '#F0EEEA');
  assert.equal(rootTokens.get('--radius-pill'), '9999px');
  assert.equal(rootTokens.get('--radius-card'), '0px');
  assert.equal(rootTokens.get('--container-max'), '1120px');

  // 주석 제거 후 #ffffff 또는 #fff 존재 여부 검사
  for (const [name, content] of [
    ['frontend/src/styles/tokens.css', tokensCss],
    ['public/styles.css', stylesCss],
    ['public/site.css', siteCss],
    ['public/practice.css', practiceCss],
  ]) {
    const noComments = content.replace(/\/\*[\s\S]*?\*\//g, '');
    const whiteMatch = noComments.match(/#(?:ffffff|fff)\b/i);
    assert.equal(whiteMatch, null, name + '에 금지된 순백 컬러가 남아 있음: ' + (whiteMatch && whiteMatch[0]));
  }
});

test('R0-T2: DESIGN.md 곡률 규칙 — 모든 CSS 파일에서 중간 곡률(3px/4px/6px/999px 등) 0건', () => {
  const cssFiles = [
    'public/styles.css',
    'public/site.css',
    'public/practice.css',
    'frontend/src/styles/tokens.css',
    'frontend/src/components/layout/AppShell.module.css',
  ];
  const allowedRadius = new Set(['0', '0px', '50%', '9999px', 'var(--radius-pill)', 'var(--radius-card)']);

  for (const file of cssFiles) {
    const src = readText(file).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of src.matchAll(/border-radius\s*:\s*([^;!}]+)/gi)) {
      const val = m[1].trim();
      assert.ok(allowedRadius.has(val), file + '에 허용되지 않은 중간 곡률 사용: border-radius: ' + val);
    }
  }
});

test('R0-T3: 전 화면 정렬 보정 — public/site.css 충돌 셀렉터 7종 .page 스코프 격리 및 .site-nav 1120px 통일', () => {
  const siteCss = readText('public/site.css').replace(/\/\*[\s\S]*?\*\//g, '');

  // chords.html과 충돌하던 최상위 셀렉터 7종이 .page 없이 단독 선언되지 않았는지 검증
  const forbiddenTopLevel = [
    /(?:^|\n)\s*\.tabs\s*\{/,
    /(?:^|\n)\s*\.tab\s*\{/,
    /(?:^|\n)\s*\.panel\s*\{/,
    /(?:^|\n)\s*\.head-row\s*\{/,
    /(?:^|\n)\s*\.h3\s*\{/,
    /(?:^|\n)\s*\.empty\s*\{/,
    /(?:^|\n)\s*\.check\s*\{/,
  ];
  for (const re of forbiddenTopLevel) {
    assert.equal(re.test(siteCss), false, 'public/site.css에 미격리 전역 셀렉터가 남아 있음: ' + re);
  }

  assert.ok(siteCss.includes('.page .tabs'), '.page .tabs 격리 선언 필요');
  assert.ok(siteCss.includes('.page .panel'), '.page .panel 격리 선언 필요');
  assert.ok(!/body\.home\s*\{\s*padding-top\s*:\s*12px/i.test(siteCss), 'body.home의 12px 상단 패딩이 제거되어야 함');
  assert.ok(/\.site-nav\s*\{[^}]*max-width\s*:\s*var\(--container-max\)/s.test(siteCss), '.site-nav는 var(--container-max)를 사용해야 함');
});

test('R0-T4: frontend/src 내 인라인 style={{ 및 dangerouslySetInnerHTML 0건, frontend/index.html CSP 일치', () => {
  function walkTs(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walkTs(p, out);
      else if (/\.(?:ts|tsx|html|css)$/.test(e.name)) out.push(p);
    }
    return out;
  }

  const files = walkTs(path.join(ROOT, 'frontend'));
  assert.ok(files.length >= 10, 'frontend/ 파일이 충분히 생성되어야 함');

  for (const f of files) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    const txt = fs.readFileSync(f, 'utf8');
    assert.equal(/ style\s*=\s*\{\{/.test(txt), false, rel + '에 금지된 React 인라인 style={{ 속성이 있음');
    assert.equal(/ dangerouslySetInnerHTML /.test(txt), false, rel + '에 금지된 dangerouslySetInnerHTML이 있음');
  }

  const indexHtml = readText('frontend/index.html');
  const pubIndexHtml = readText('public/index.html');
  const meta1 = indexHtml.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i);
  const meta2 = pubIndexHtml.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i);
  assert.ok(meta1 && meta2, 'CSP meta가 존재해야 함');
  assert.equal(meta1[1], meta2[1], 'frontend/index.html과 public/index.html의 CSP 원문이 일치해야 함');
});

test('R0-T5 ~ R0-T10: 공통 래퍼 5종 및 보안 DOM 컴포넌트 3종·AppShell 핵심 규격 정적·구조 검증', () => {
  const secSrc = readText('frontend/src/lib/security.ts');
  const authSrc = readText('frontend/src/lib/auth.ts');
  const apiSrc = readText('frontend/src/lib/apiClient.ts');
  const driveSrc = readText('frontend/src/lib/drive.ts');
  const musicSrc = readText('frontend/src/lib/musicEngine.ts');
  const safeLinkSrc = readText('frontend/src/components/common/SafeLink.tsx');
  const safeAudioSrc = readText('frontend/src/components/common/SafeAudio.tsx');
  const sanitizedSvgSrc = readText('frontend/src/components/common/SanitizedSvg.tsx');
  const appShellSrc = readText('frontend/src/components/layout/AppShell.tsx');

  // R0-T5: security.ts
  for (const fnName of ['migrateLegacyStorageOnce', 'safeUrl', 'safeHref', 'safeAudioUrl', 'videoIdFrom', 'renderSanitizedSvg']) {
    assert.ok(secSrc.includes('export function ' + fnName), 'security.ts 누락 함수: ' + fnName);
  }
  assert.ok(secSrc.includes("x.protocol === 'https:'"), 'safeUrl은 https: 프로토콜만 허용해야 함');

  // R0-T6: auth.ts
  assert.ok(authSrc.includes("storageKey: 'ulp:auth'"), 'auth.ts storageKey ulp:auth 필수');
  assert.ok(authSrc.includes("flowType: 'pkce'"), 'auth.ts flowType pkce 필수');
  assert.ok(authSrc.includes("scope: 'local'"), 'auth.ts 로컬 로그아웃 scope: local 필수');
  assert.ok(authSrc.includes('export function useAuth'), 'useAuth 훅 export 필수');

  // R0-T7: apiClient.ts
  assert.ok(apiSrc.includes('replaceOldSongTakes'), 'apiClient.ts E1-1 replaceOldSongTakes 지원 필수');
  assert.ok(apiSrc.includes('payload.verify = Boolean(input.verify)'), 'apiClient.ts E1-1 verify 지원 필수');
  assert.ok(apiSrc.includes('PROVIDER_KEY_INVALID:'), 'apiClient.ts 비동기 잡 키 무효화 감지 필수');

  // R0-T8: drive.ts
  assert.ok(driveSrc.includes('let inMemoryToken'), 'drive.ts 인메모리 토큰 클로저 필수');
  assert.ok(!driveSrc.includes('localStorage.setItem'), 'drive.ts는 localStorage에 토큰을 저장하면 안 됨');
  assert.ok(driveSrc.includes('5 * 1024 * 1024'), 'drive.ts 5MB 업로드 분기 필수');
  assert.ok(driveSrc.includes('deleteFile(driveFileId)') || driveSrc.includes('deleteFile(uploadedDriveFileId)'), 'drive.ts 고아 파일 정리 필수');

  // R0-T9: musicEngine.ts
  for (const sym of ['scaleBlocks', 'scaleBlockSeq', 'DOUBLE_STOP_INTERVALS', 'doubleStops', 'bassPluck', 'doubleStop']) {
    assert.ok(musicSrc.includes(sym), 'musicEngine.ts 누락 심볼: ' + sym);
  }

  // R0-T10: SafeLink, SafeAudio, SanitizedSvg, AppShell
  assert.ok(safeLinkSrc.includes('safeUrl') && safeLinkSrc.includes('safeHref'), 'SafeLink는 safeUrl/safeHref를 사용해야 함');
  assert.ok(safeAudioSrc.includes("removeAttribute('src')") && safeAudioSrc.includes("el['src'] = valid"), 'SafeAudio는 removeAttribute(src) 및 el[src] 대입 규칙을 준수해야 함');
  assert.ok(sanitizedSvgSrc.includes('renderSanitizedSvg'), 'SanitizedSvg는 renderSanitizedSvg를 호출해야 함');
  assert.ok(appShellSrc.includes('id="navAuth"') && appShellSrc.includes('data-auth-state'), 'AppShell은 #navAuth와 data-auth-state를 렌더링해야 함');
});

