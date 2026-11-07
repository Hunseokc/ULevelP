// 설정 화면 정렬 검사 (FT-2): 공통 검사 G0~G8 + 옛 settings-spacing.spec.js 간격 검사(본문 섹션 세로 간격 6·12·16, 상자마다 일정)
// 규격: 개발산출물/프론트_정렬규격.md · 점검 기록: 개발산출물/결과/FT-2_전화면점검.md
'use strict';
const { test, expect } = require('@playwright/test');
const { layoutSuite } = require('../support/layout-check');
const { mockApp, STATES } = require('../support/mock-app');

layoutSuite({
  name: 'settings',
  path: '/settings.html',
  states: ['guest', 'user'],
  ready: async (page, state) => {
    if (state === 'user') await expect(page.locator('#accEmail')).toHaveText('a@example.com');
    else await page.locator('#accGuest').waitFor();
  },
  dark: 'user',
});

// 옛 settings-spacing.spec.js에서 옮김(판정 함수 그대로, 가짜 인증만 mockApp으로)
const WIDTHS = [1280, 390];
const SCALE = [6, 12, 16];

// 브라우저 안에서 도는 검사. 실패 문구 배열을 돌려준다
function collectGapProblems(scale) {
  const out = [];
  const R = (el) => el.getBoundingClientRect();
  const label = (el) =>
    el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).split(/\s+/)[0] + ' ' + (el.textContent || '').trim().slice(0, 12);
  const stacked = (el) => {
    const s = getComputedStyle(el);
    if (s.display.startsWith('inline') || s.display === 'none' || s.position === 'absolute') return false;
    const r = R(el);
    return r.width > 0 && r.height > 0;
  };

  for (const box of document.querySelectorAll('main section, main section *')) {
    if (!stacked(box) || /^(UL|OL|LABEL|SUMMARY|P|B|SPAN|BUTTON|A)$/.test(box.tagName)) continue;
    const kids = [...box.children].filter(stacked);
    if (kids.length < 2) continue;
    const gaps = [];
    for (let i = 1; i < kids.length; i++) {
      const prev = R(kids[i - 1]);
      const cur = R(kids[i]);
      if (cur.top < prev.bottom - 1) continue; // 같은 줄(가로 배치)은 대상 아님
      gaps.push(Math.round(cur.top - prev.bottom));
    }
    if (gaps.length === 0) continue;
    const bad = gaps.filter((g) => !scale.includes(g));
    if (bad.length) out.push(`${label(box)} 간격 ${gaps.join('/')} (스케일 밖 ${bad.join(',')})`);
    else if (new Set(gaps).size > 1) out.push(`${label(box)} 간격 들쭉날쭉 ${gaps.join('/')}`);
  }

  // 버튼이 감싼 상자(패널·섹션)의 안쪽 여백을 넘지 않음
  for (const btn of document.querySelectorAll('main section button, main section a.pillBtn, main section a.ghostBtn')) {
    if (!stacked(btn)) continue;
    let box = btn.parentElement;
    while (box && parseFloat(getComputedStyle(box).paddingRight) === 0) box = box.parentElement;
    if (!box) continue;
    const inner = R(box).right - parseFloat(getComputedStyle(box).paddingRight);
    if (R(btn).right > inner + 0.5) out.push(`${label(btn)} 상자 안쪽 여백 밖으로 ${Math.round(R(btn).right - inner)}px`);
  }
  return out;
}

// 버튼·필 글자가 한 줄인지(FT-4). 390 안쪽 폭(약 270px)에서 긴 문구가 두 줄 필이 되는 것을 손으로 재지 않게 한다.
// 판정: 지금 높이 > 줄바꿈을 막았을 때 높이 + 1px 이면 두 줄. 글자 크기·패딩·이모지와 상관없이 같은 식으로 잰다
function collectWrappedPills() {
  const out = [];
  for (const el of document.querySelectorAll('main button, main a.pillBtn, main a.ghostBtn')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || !(el.textContent || '').trim()) continue;
    const before = el.style.whiteSpace;
    el.style.whiteSpace = 'nowrap';
    const oneLine = el.getBoundingClientRect().height;
    el.style.whiteSpace = before;
    if (r.height > oneLine + 1) {
      out.push(`${el.id ? '#' + el.id : el.tagName.toLowerCase()} "${el.textContent.trim()}" 두 줄(높이 ${Math.round(r.height)}px > 한 줄 ${Math.round(oneLine)}px, 폭 ${Math.round(r.width)}px)`);
    }
  }
  return out;
}

for (const state of ['guest', 'user']) {
  for (const width of [390, 768, 1280]) {
    test(`FT settings ${state} ${width}px 버튼·필 글자 한 줄(고급 설정 펼침 포함)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockApp(page, STATES[state]);
      await page.goto('/settings.html', { waitUntil: 'load' });
      test.skip((await page.locator('#root').count()) === 0, 'legacy 모드: React 화면 아님');
      if (state === 'user') await expect(page.locator('#accEmail')).toHaveText('a@example.com');
      else await page.locator('#accGuest').waitFor();
      await page.evaluate(() => document.fonts.ready);
      // 접힌 details(고급 설정·계정 삭제 등)를 모두 펼쳐 안쪽 버튼도 잰다
      await page.evaluate(() => document.querySelectorAll('main details').forEach((d) => (d.open = true)));
      await page.waitForTimeout(200);
      expect(await page.evaluate(collectWrappedPills)).toEqual([]);
    });
  }
}

for (const width of WIDTHS) {
  test(`FT settings user ${width}px 본문 간격 스케일·일정함(고급 설정 펼침 포함)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApp(page, STATES.user);
    await page.goto('/settings.html', { waitUntil: 'load' });
    test.skip((await page.locator('#root').count()) === 0, 'legacy 모드: React 화면 아님');
    await expect(page.locator('#accEmail')).toHaveText('a@example.com');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
    const problems = await page.evaluate(collectGapProblems, SCALE);
    expect(problems).toEqual([]);
    // 노션 연동은 고급 설정 접힘 안(계획/앱_명세.md §5) — 기본 접힘, 펼쳐도 간격 규칙 같음
    await expect(page.locator('#advNotion')).not.toHaveAttribute('open', '');
    await expect(page.locator('#ntnToken')).toBeHidden();
    await page.locator('#advNotion > summary').click();
    await expect(page.locator('#ntnToken')).toBeVisible();
    expect(await page.evaluate(collectGapProblems, SCALE)).toEqual([]);
  });
}
