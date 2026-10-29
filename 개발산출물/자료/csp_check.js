// X1 확인 도구: 헤드리스 Chrome으로 모든 화면을 열어 CSP 위반(securitypolicyviolation, 콘솔 "Refused to")과
// 스크립트 오류를 모은다. 의존성 없음(Node 22+ 내장 WebSocket + Chrome DevTools Protocol). X2(Playwright)가 생기면 그쪽으로 옮긴다.
//   로컬:  npm start 를 띄운 뒤  node 개발산출물/자료/csp_check.js
//   Pages: node 개발산출물/자료/csp_check.js https://hunseokc.github.io/ULevelP/
// 환경 변수 CHROME 으로 브라우저 경로를 바꿀 수 있다. 위반·오류가 있으면 종료 코드 1
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BASE = (process.argv[2] || 'http://localhost:3000/').replace(/\/?$/, '/');
const CHROME = process.env.CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => fs.existsSync(p));
const PORT = 9333;
const VIDEO = 'jNQXAC9IVRw'; // 공개·임베드 허용 영상 (유튜브 첫 영상)

// 화면마다: 열기 전에 넣을 localStorage, 연 뒤에 할 일(문자열로 브라우저에서 실행), 확인할 값
const PAGES = [
  {
    name: '옛 키 복사(theme.js)', url: 'index.html',
    before: { 'gv-theme': 'dark', 'gv-tab': 'matrix', 'pp-lead': '2', 'ul-notion-practice': 'javascript:window.__xss=1', 'ul-notion-notes': 'https://www.notion.so/x' },
    expect: `({ theme: document.documentElement.dataset.theme, copied: localStorage.getItem('ulp:theme'), tab: localStorage.getItem('ulp:tab'),
      lead: localStorage.getItem('ulp:lead'), oldKept: localStorage.getItem('gv-theme'), flag: localStorage.getItem('ulp:copied'),
      practiceLinkHidden: document.getElementById('nlPractice').hidden, notesLink: document.getElementById('nlNotes').href, cur: document.querySelector('#modes .cur a').getAttribute('href') })`,
  },
  {
    name: '첫 화면 링크 붙여넣기', url: 'index.html',
    act: `(() => { const i = document.getElementById('goUrl'); i.value = 'https://youtu.be/${VIDEO}'; i.dispatchEvent(new Event('input')); })()`,
    expect: `({ thumb: document.getElementById('goThumb').src, play: document.getElementById('goPlay').getAttribute('href') })`,
  },
  {
    name: '첫 화면 + Apps Script 연결(connect-src)', url: 'index.html',
    before: { 'pp-api': '"https://script.google.com/macros/s/AKfy-csp-check/exec"', 'pp-key': '"x"' },
    expect: `({ songs: document.getElementById('songs').textContent })`,
  },
  { name: '코드 연습실 전체 탭', url: 'chords.html', act: `(() => { ['tone','matrix','circle','reint','tf','scale'].forEach((t) => document.getElementById('tab-' + t).click()); document.getElementById('a-go').click(); document.getElementById('cc-all').open = true; })()`,
    expect: `({ svgs: document.querySelectorAll('svg').length, strokeAttr: !!document.querySelector('line.str[stroke-width]'), styleAttr: document.querySelectorAll('[style]').length })` },
  { name: '플레이어 + 유튜브', url: `practice.html?v=${VIDEO}`, wait: 6000, expect: `({ iframe: !!document.querySelector('iframe[src*="youtube.com/embed"]'), title: document.getElementById('songTitle').textContent })` },
  { name: '학습 노트 + GitHub API(connect-src)', url: 'notes.html?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D' + VIDEO, before: { 'sn-token': 'x', 'sn-repo': 'Hunseokc/ULevelP' },
    expect: `({ preview: document.querySelector('#preview img').src, runs: document.getElementById('runs').textContent.slice(0, 60) })` },
  { name: '설정 + 테마 버튼', url: 'settings.html', act: `document.querySelector('[data-theme="light"]').click()`,
    expect: `({ theme: document.documentElement.dataset.theme, saved: localStorage.getItem('ulp:theme'), old: localStorage.getItem('gv-theme') })` },
  // 대조군: 검출기가 살아 있는지. 허용 안 된 주소로 fetch, style 속성 삽입 → 위반이 잡혀야 OK
  { name: '대조군(막혀야 함)', url: 'index.html', expectBlocked: true,
    act: `(() => { fetch('https://example.com/').catch(() => {}); document.body.insertAdjacentHTML('beforeend', '<i style="color:red">x</i>'); })()` },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const waiting = new Map(), events = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); } else events.push(msg);
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : r; };
  return { send, evaluate, events, close: () => ws.close() };
}

async function main() {
  if (!CHROME) throw new Error('Chrome/Edge를 찾지 못함 (CHROME 환경 변수)');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-check-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
  let bad = 0;
  try {
    let ver;
    for (let i = 0; i < 50 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch (e) { await sleep(200); } }
    console.log('브라우저:', ver.Browser, '| 대상:', BASE);
    for (const pg of PAGES) {
      const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
      const c = await cdp(t.webSocketDebuggerUrl);
      await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Log.enable');
      // CDP로 넣는 스크립트는 페이지 CSP를 받지 않는다
      await c.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));" });
      // 같은 Origin 저장소를 비우고 시작 값을 넣는다
      await c.send('Page.navigate', { url: BASE + 'icon-180.png' }); await sleep(800);
      await c.evaluate(`localStorage.clear(); Object.entries(${JSON.stringify(pg.before || {})}).forEach(([k, v]) => localStorage.setItem(k, v)); 1`);
      await c.send('Page.navigate', { url: BASE + pg.url }); await sleep(2500);
      if (pg.act) { await c.evaluate(pg.act); await sleep(1500); }
      await sleep(pg.wait || 0);
      const got = pg.expect ? await c.evaluate(pg.expect) : null;
      const csp = (await c.evaluate('JSON.stringify(window.__csp || [])')) || '[]';
      const xss = await c.evaluate('window.__xss === 1');
      const logs = c.events.filter((e) => (e.method === 'Log.entryAdded' && /Refused to|Content Security Policy/i.test(e.params.entry.text))
        || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error' && /Refused to|Content Security Policy/i.test(JSON.stringify(e.params.args))))
        .map((e) => (e.params.entry ? e.params.entry.text : JSON.stringify(e.params.args)).slice(0, 200));
      const errs = c.events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.exception ? e.params.exceptionDetails.exception.description.split('\n')[0] : e.params.exceptionDetails.text);
      const v = JSON.parse(csp);
      const ok = pg.expectBlocked ? v.length >= 2 : !v.length && !logs.length && !errs.length && !xss;
      if (!ok) bad++;
      console.log(`\n[${ok ? 'OK' : 'FAIL'}] ${pg.name} (${pg.url})`);
      console.log('  CSP 위반:', v.length ? v : '없음', '| 콘솔 Refused:', logs.length ? logs : '없음', '| 오류:', errs.length ? errs : '없음', '| __xss:', xss);
      if (got) console.log('  값:', JSON.stringify(got));
      c.close();
      await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`);
    }
  } finally {
    proc.kill();
  }
  console.log(`\n화면 ${PAGES.length}개 중 실패 ${bad}개`);
  process.exitCode = bad ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
