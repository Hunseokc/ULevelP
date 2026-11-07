// 모든 화면 <head>에서 defer 없이 가장 먼저 불러옴: 옛 저장 키를 처음 한 번 새 키로 복사하고(D19, docs/03 2.5),
// 화면을 그리기 전에 라이트/다크를 적용해서 깜빡임을 막는다
'use strict';
(function () {
  try {
    if (!localStorage.getItem('ulp:copied')) {
      // 옛 키는 guitar-practice가 같은 Origin에서 계속 쓰므로 지우지 않는다
      [
        ['gv-theme', 'ulp:theme'],
        ['gv-tab', 'ulp:tab'],
        ['pp-lead', 'ulp:lead'],
        ['ul-notion-practice', 'ulp:notion-practice'],
        ['ul-notion-notes', 'ulp:notion-notes'],
      ].forEach(([from, to]) => {
        const v = localStorage.getItem(from);
        if (v != null && localStorage.getItem(to) == null) localStorage.setItem(to, v);
      });
      localStorage.setItem('ulp:copied', '1');
    }
    const t = localStorage.getItem('ulp:theme');
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch (e) { /* 저장소를 못 쓰면 시스템 설정을 따름 */ }
})();
