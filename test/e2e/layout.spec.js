// 반응형 가로 스크롤 검사 (RZ-3): 390·768·1280px × 9개 화면, 가로 스크롤 0건
'use strict';
const { test, expect } = require('@playwright/test');

const PAGES = [
  '/index.html',
  '/chords.html',
  '/practice.html?v=jNQXAC9IVRw',
  '/log.html',
  '/notes.html',
  '/note.html?id=00000000-0000-0000-0000-000000000001',
  '/settings.html',
  '/privacy.html',
  '/progressions.html',
];

for (const width of [390, 768, 1280]) {
  test(`L1 ${width}px 전 화면 가로 스크롤 0건`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route(/youtube\.com|ytimg\.com|doubleclick\.net/, (route) => route.abort());
    const over = [];
    for (const p of PAGES) {
      await page.goto(p, { waitUntil: 'load' });
      await page.waitForTimeout(300);
      const px = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (px > 0) over.push(`${p} +${px}px`);
    }
    expect(over).toEqual([]);
  });
}
