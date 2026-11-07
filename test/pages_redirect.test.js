const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const RD = require('../pages/redirect.js');

describe('R1-A2: Pages 이동 페이지 주소 변환', () => {
  test('같은 파일명 화면으로 가고 쿼리·해시를 그대로 붙인다', () => {
    assert.equal(
      RD.targetUrl('/ULevelP/practice.html', '?v=dQw4w9WgXcQ&t=42&a=38&b=55.2&r=0.75', '#x'),
      RD.TARGET + '/practice.html?v=dQw4w9WgXcQ&t=42&a=38&b=55.2&r=0.75#x',
    );
    assert.equal(RD.targetUrl('/ULevelP/note.html', '?id=abc', ''), RD.TARGET + '/note.html?id=abc');
  });

  test('저장소 루트(/ULevelP/, /ULevelP)는 첫 화면으로 간다', () => {
    assert.equal(RD.targetUrl('/ULevelP/', '', ''), RD.TARGET + '/');
    assert.equal(RD.targetUrl('/ULevelP', '', ''), RD.TARGET + '/');
  });

  test('모르는 경로·이상한 입력은 첫 화면으로 보낸다(이동 대상 출처는 바뀌지 않음)', () => {
    for (const p of ['//evil.com', '/ULevelP/../evil.html', '/ULevelP/foo.html', '/ULevelP/practice.html/', undefined, null]) {
      const url = RD.targetUrl(p, '', '');
      assert.equal(url, RD.TARGET + '/', String(p));
    }
    assert.ok(RD.targetUrl('//evil.com', '?a=1', '').startsWith(RD.TARGET + '/?'));
  });

  test('PAGES 목록 = public/*.html (레거시 화면이 늘면 같이 고치도록)', () => {
    const legacy = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html')).sort();
    assert.deepEqual([...RD.PAGES].sort(), legacy);
  });
});

describe('R1-A2: 이동 페이지 HTML·CI', () => {
  const html = read('pages/redirect.html');

  test('CSP meta가 있고 인라인 스크립트·스타일이 없다', () => {
    const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
    assert.ok(csp, 'CSP meta');
    assert.match(csp[1], /default-src 'none'/);
    assert.match(csp[1], /script-src 'self'/);
    assert.doesNotMatch(csp[1], /unsafe-inline|unsafe-eval/);
    for (const tag of html.match(/<script\b[^>]*>/g) || []) assert.match(tag, /\bsrc="/);
    assert.doesNotMatch(html, /<style\b|\sstyle="|\son[a-z]+="/);
  });

  test('JS 없이도 보이는 링크가 이동 대상 출처를 가리키고, 스크립트가 쓰는 id가 다 있다', () => {
    assert.match(html, new RegExp(`id="go" href="${RD.TARGET.replace(/\./g, '\\.')}/"`));
    for (const id of ['go', 'moving', 'framed']) assert.match(html, new RegExp(`id="${id}"`));
    assert.match(html, /id="framed" hidden/);
  });

  test('ci.yml Pages 배포는 public/ 대신 이동 페이지(_site)를 올린다', () => {
    const ci = read('.github/workflows/ci.yml');
    const job = ci.slice(ci.indexOf('deploy-pages:'));
    assert.match(job, /cp pages\/redirect\.html "_site\/\$\(basename "\$f"\)"/);
    assert.match(job, /for f in public\/\*\.html 404\.html/);
    assert.match(job, /upload-pages-artifact@v4\s+with:\s+path: _site/);
    assert.doesNotMatch(job, /path: public/);
  });
});
