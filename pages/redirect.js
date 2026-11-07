// GitHub Pages(옛 화면 주소) → Cloud Run 이동 페이지 (R1-A2).
// 레거시 화면과 같은 파일명이면 같은 화면으로, 아니면 첫 화면으로 보내고 쿼리·해시(practice.html?v=&t=…)는 그대로 붙인다.
// 노션 임베드(iframe) 안에서는 이동하지 않고 새 창 링크만 보인다 — Cloud Run은 X-Frame-Options: DENY라 iframe 안 이동은 빈 화면이 된다
const RD = (() => {
  const TARGET = 'https://ulevelp-d5ympfsmfq-du.a.run.app';
  const PAGES = ['index.html', 'chords.html', 'log.html', 'note.html', 'notes.html', 'practice.html', 'privacy.html', 'settings.html'];

  function targetUrl(pathname, search, hash) {
    const name = String(pathname || '').split('/').pop();
    const page = PAGES.includes(name) ? name : '';
    return TARGET + '/' + page + (search || '') + (hash || '');
  }

  return { TARGET, PAGES, targetUrl };
})();
if (typeof module !== 'undefined') module.exports = RD;

if (typeof document !== 'undefined') {
  const url = RD.targetUrl(location.pathname, location.search, location.hash);
  const link = document.getElementById('go');
  link.href = url;
  let framed = true;
  try { framed = window.self !== window.top; } catch { /* 교차 출처 top 접근 실패 = iframe */ }
  if (framed) {
    link.target = '_blank';
    link.rel = 'noopener';
    document.getElementById('moving').hidden = true;
    document.getElementById('framed').hidden = false;
  } else {
    location.replace(url);
  }
}
