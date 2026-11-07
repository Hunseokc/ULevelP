// 라이트/다크 전환: 모든 화면 하단 푸터에 있고 상단 메뉴에는 없다. 설정 화면 "화면" 섹션과 눌림 표시가 맞는다
// React 화면 전용(legacy 모드는 skip)
'use strict';
const { test, expect } = require('@playwright/test');

const PAGES = ['index.html', 'chords.html', 'practice.html', 'log.html', 'notes.html', 'note.html?id=x', 'settings.html', 'privacy.html'];

async function open(page, path) {
  await page.route(/youtube\.com|ytimg\.com|doubleclick\.net/, (route) => route.abort());
  await page.goto('/' + path, { waitUntil: 'load' });
  return (await page.locator('#root').count()) > 0;
}

for (const path of PAGES) {
  test(`T ${path} 하단 푸터에 테마 전환`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    test.skip(!(await open(page, path)), 'legacy 모드: React 화면 아님');
    const light = page.locator('footer #theme-light');
    await expect(light).toBeVisible();
    await expect(page.locator('nav #theme-light')).toHaveCount(0);
    const mainBottom = await page.locator('main').evaluate((el) => el.getBoundingClientRect().bottom);
    const footTop = await page.locator('footer:has(#theme-light)').evaluate((el) => el.getBoundingClientRect().top);
    expect(footTop).toBeGreaterThanOrEqual(mainBottom);

    await page.locator('footer #theme-dark').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('footer #theme-dark')).toHaveAttribute('aria-pressed', 'true');
  });
}

test('T settings.html 푸터·화면 섹션 눌림 표시 일치', async ({ page }) => {
  test.skip(!(await open(page, 'settings.html')), 'legacy 모드: React 화면 아님');
  await page.locator('footer #theme-dark').click();
  await expect(page.locator('#screen [data-theme="dark"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#screen [data-theme="light"]').click();
  await expect(page.locator('footer #theme-light')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('footer #theme-dark')).toHaveAttribute('aria-pressed', 'false');
});
