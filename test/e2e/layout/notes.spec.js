// 학습 노트 목록 화면 정렬 검사 (FT-2): 공통 검사 G0~G8. M2에서 다시 만드는 화면이라 배치 약속은 M2 step에서 쓴다
// 규격: 개발산출물/프론트_정렬규격.md · 점검 기록: 개발산출물/결과/FT-2_전화면점검.md
'use strict';
const { expect } = require('@playwright/test');
const { layoutSuite } = require('../support/layout-check');

layoutSuite({
  name: 'notes',
  path: '/notes.html',
  states: ['guest', 'user', 'userData'],
  ready: async (page, state) => {
    await page.locator('#notesList').waitFor({ state: 'attached' });
    if (state === 'userData') await expect(page.locator('#notesList a').first()).toBeVisible();
  },
  dark: 'userData',
});
