// 코드 연습 화면 정렬 검사 (FT-2): 공통 검사 G0~G8, 탭 8개 × 4폭. 로그인과 무관한 화면이라 guest만
// 규격: 개발산출물/프론트_정렬규격.md · 점검 기록: 개발산출물/결과/FT-2_전화면점검.md
// FT-3-chords: tf 탭 다이어그램 넘침(F1·F2)을 고쳐 알려진 실패(known) 없음 — 결과/FT-3-chords_정렬수정.md
'use strict';
const { layoutSuite } = require('../support/layout-check');

for (const tab of ['scale', 'tone', 'matrix', 'circle', 'reint', 'tf', 'ds', 'prog']) {
  layoutSuite({
    name: `chords-${tab}`,
    path: `/chords.html#${tab}`,
    states: ['guest'],
    ready: async (page) => {
      await page.locator(`#pane-${tab}`).waitFor();
    },
    dark: tab === 'scale' ? 'guest' : undefined,
  });
}
