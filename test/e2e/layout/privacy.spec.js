// 개인정보처리방침 화면 정렬 검사 (FT-2): 공통 검사 G0~G8. 정적 문서라 guest만
// 규격: 개발산출물/프론트_정렬규격.md · 점검 기록: 개발산출물/결과/FT-2_전화면점검.md
'use strict';
const { layoutSuite } = require('../support/layout-check');

layoutSuite({
  name: 'privacy',
  path: '/privacy.html',
  states: ['guest'],
  ready: async (page) => {
    await page.locator('#privH1').waitFor();
  },
  dark: 'guest',
});
