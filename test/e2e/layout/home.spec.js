// 홈 화면 정렬 검사 (FT-1): 공통 검사 G0~G8 + 배치 약속(HomePage.tsx data-align-group)
// 규격: 개발산출물/프론트_정렬규격.md · 옛 H1~H6 대응: 개발산출물/결과/FT-0_규격설계.md §3
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { layoutSuite } = require('../support/layout-check');

layoutSuite({
  name: 'home',
  path: '/index.html',
  states: ['guest', 'guestLocal', 'userData'],
  ready: async (page, state) => {
    await page.locator('#weeklyStreakCard').waitFor();
    if (state === 'userData') {
      await expect(page.locator('#songs li a')).toHaveCount(5);
      await page.locator('#recentNoteBody').waitFor();
    }
  },
  options: { forbidColors: ['--link'] },
  dark: 'userData',
});

// H6 홈 모듈 CSS에 링크 파란색 토큰 없음 (전역 a 색을 홈에서 덮는다)
test('FT home HomePage.module.css에 링크 파란색 토큰 없음', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../../frontend/src/pages/HomePage.module.css'), 'utf8');
  expect(css.match(/var\(--(link|accent-text)\)/g) || []).toEqual([]);
});
