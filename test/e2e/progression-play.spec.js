// CH-5b 연습실 연동: 진행 → 연습실 "진행 연주" 탭(#prog?) → 돌아오기, 기존 7개 모드 회귀, 진행 목록 검색·정렬
// 설계: 개발산출물/결과/CH-1a_프레임.md §3, CH-1b_설계.md §8, CH-5_CHORDS화면.md §3. 비로그인 시드로 확인. React 화면 전용(legacy 모드는 skip)
'use strict';
const { test, expect } = require('@playwright/test');

const MODES = ['scale', 'tone', 'matrix', 'circle', 'reint', 'tf', 'ds'];

async function open(page, path) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route(/youtube\.com|ytimg\.com|doubleclick\.net/, (route) => route.abort());
  await page.goto(path, { waitUntil: 'load' });
  if ((await page.locator('#root').count()) === 0) return null;
  return errors;
}

const tab = (page, id) => page.locator(`#tab-${id}`);
const pane = (page, id) => page.locator(`#pane-${id}`);

test('PP1 기존 7개 모드 회귀: #해시로 새로 열기·탭 클릭(해시·ulp:tab)·hashchange·마지막 탭, 탭 8개', async ({ page }) => {
  const errors = await open(page, '/chords.html#scale');
  test.skip(errors === null, 'legacy 모드: React 화면 아님');
  await expect(page.locator('[role="tab"]')).toHaveCount(8);
  for (const id of MODES) {
    await page.goto('about:blank'); // 같은 문서 해시 이동이 아니라 새로 열기
    await page.goto(`/chords.html#${id}`, { waitUntil: 'load' });
    await expect(tab(page, id)).toHaveAttribute('aria-selected', 'true');
    await expect(pane(page, id)).toBeVisible();
    await expect(pane(page, id).locator('svg:visible').first()).toBeVisible();
    for (const other of [...MODES, 'prog'].filter((x) => x !== id)) await expect(pane(page, other)).toBeHidden();
  }
  // 탭 클릭 → 해시 갱신 (7 → 1 순서로)
  for (const id of [...MODES].reverse()) {
    await tab(page, id).click();
    await expect(pane(page, id)).toBeVisible();
    expect(new URL(page.url()).hash).toBe(`#${id}`);
    expect(await page.evaluate(() => localStorage.getItem('ulp:tab'))).toBe(id); // 새로 열 때는 원래도 저장 안 함 — 탭을 바꿀 때 저장
  }
  // 해시만 바꿔도 탭이 바뀐다(hashchange)
  await page.evaluate(() => (window.location.hash = '#tf'));
  await expect(tab(page, 'tf')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#a-view')).toBeVisible();
  // 해시 없이 열면 마지막 탭(ulp:tab)
  await page.goto('/chords.html', { waitUntil: 'load' });
  await expect(tab(page, 'tf')).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
});

test('PP2 진행 → 연습실 → 돌아오기 (시드 행)', async ({ page }) => {
  const errors = await open(page, '/progressions.html?scope=all');
  test.skip(errors === null, 'legacy 모드: React 화면 아님');
  const row = page.locator('#p-ref-seed-2');
  await row.locator('button[aria-expanded]').click();
  await row.locator('[data-act="play"]').click();
  await page.waitForURL(/chords\.html#prog\?/);
  await expect(tab(page, 'prog')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#pp-title')).toContainText('Just the Two of Us Turnaround');
  await expect(page.locator('#pp-title')).toContainText('A min');
  await expect(page.locator('#pp-chips > button')).toHaveCount(4);
  await expect(page.locator('#pp-chips > button').first()).toContainText('FM9');
  await expect(page.locator('#pp-boxes > figure')).toHaveCount(4);
  // 경로는 최대 3개(시작 보이싱이 다른 것만 — CH-2b §3)
  const nPaths = await page.locator('#pp-paths > button').count();
  expect(nPaths).toBeGreaterThanOrEqual(1);
  expect(nPaths).toBeLessThanOrEqual(3);
  await expect(page.locator('#pp-paths > button').first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#pp-back')).toHaveAttribute('href', 'progressions.html?scope=all#p-ref-seed-2');
  await page.locator('#pp-back').click();
  await page.waitForURL(/progressions\.html\?scope=all#p-ref-seed-2$/);
  await expect(page.locator('#pd-ref-seed-2')).toBeVisible();
  await expect(page.locator('#progScope [data-scope="all"]')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('PP3 진행 연주: 못 읽는 코드 빠짐, 정석 폼, 키 옮기기, 다른 보이싱, 매트릭스 입구, 탭 오가도 진행 유지, 재생', async ({ page }) => {
  const qs = new URLSearchParams({ c: 'C,G,Am,F,H7,G7/B', k: 'C Major', t: '팝 진행', from: '00000000-0000-4000-8000-0000000000b1' });
  const errors = await open(page, `/chords.html#prog?${qs}`);
  test.skip(errors === null, 'legacy 모드: React 화면 아님');
  const chips = page.locator('#pp-chips > button');
  await expect(chips).toHaveCount(6);
  await expect(chips.nth(4)).toBeDisabled();
  await expect(chips.nth(4)).toContainText('못 읽음');
  await expect(page.locator('#pp-skipped')).toContainText('1개');
  await expect(page.locator('#pp-boxes > figure')).toHaveCount(5);
  await expect(chips.nth(0)).toHaveAttribute('data-kind', 'table');
  await expect(chips.nth(0)).toContainText('I');
  await expect(page.locator('#pp-back')).toHaveAttribute('href', 'progressions.html?scope=all#p-00000000-0000-4000-8000-0000000000b1');

  // 키 옮기기 +2 → D Major, 심볼·로마숫자
  await page.locator('#pp-semis').selectOption('2');
  await expect(page.locator('#pp-title')).toContainText('D Major');
  await expect(chips.nth(1)).toContainText('A');
  await expect(chips.nth(2)).toContainText('Bm');
  await expect(chips.nth(2)).toContainText('vi');
  await expect(chips.nth(5)).toContainText('A7/C#');

  // 다른 보이싱으로 바꾸기
  await chips.nth(5).click();
  await expect(page.locator('#pp-cur')).toContainText('A7/C#');
  const before = await page.locator('#pp-boxes > figure').nth(4).locator('figcaption span').textContent();
  await page.locator('#pp-alt').click();
  const alts = page.locator('#pp-alts > figure');
  expect(await alts.count()).toBeGreaterThan(1);
  let picked = null;
  for (let i = 0; i < (await alts.count()); i++) {
    const f = await alts.nth(i).locator('figcaption span').textContent();
    if (f !== before) {
      await alts.nth(i).click();
      picked = f;
      break;
    }
  }
  expect(picked).not.toBeNull();
  await expect(page.locator('#pp-boxes > figure').nth(4).locator('figcaption span')).toHaveText(picked);

  // 재생 → 멈춤
  await page.locator('#pp-play').click();
  await expect(page.locator('#pp-play')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#pp-play').click();
  await expect(page.locator('#pp-play')).toHaveAttribute('aria-pressed', 'false');

  // 재생은 첫 코드부터 → 다시 A7/C# (퀄리티 7)를 골라 보이싱 매트릭스에서 열기 → 루트 A
  await chips.nth(2).click();
  await expect(page.locator('#pp-open-matrix')).toHaveCount(0); // Bm(3화음)은 매트릭스 9종 밖
  await chips.nth(5).click();
  await page.locator('#pp-open-matrix').click();
  await expect(tab(page, 'matrix')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#mx-root')).toHaveValue('9');
  expect(new URL(page.url()).hash).toBe('#matrix');
  // 진행 연주 탭으로 돌아오면 같은 진행
  await tab(page, 'prog').click();
  expect(page.url()).toContain('#prog?c=');
  await expect(chips).toHaveCount(6);
  await expect(page.locator('#pp-title')).toContainText('팝 진행');

  // 재생 중 다른 탭으로 가면 멈춘다
  await page.locator('#pp-play').click();
  await expect(page.locator('#pp-play')).toHaveAttribute('aria-pressed', 'true');
  await tab(page, 'scale').click();
  await tab(page, 'prog').click();
  await expect(page.locator('#pp-play')).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test('PP4 빈 진행 연주 탭: 시드 고르기·직접 입력, 잘못된 입력은 연주할 코드 없음', async ({ page }) => {
  const errors = await open(page, '/chords.html#prog');
  test.skip(errors === null, 'legacy 모드: React 화면 아님');
  await expect(page.locator('#pp-empty')).toBeVisible();
  await expect(page.locator('#pp-seeds a')).toHaveCount(10);
  await expect(page.locator('#pp-back')).toHaveAttribute('href', 'progressions.html');
  await page.locator('#pp-input').fill('Dm7 - G7 - Cmaj7');
  await page.locator('#pp-empty button[type="submit"]').click();
  await expect(page.locator('#pp-chips > button')).toHaveCount(3);
  expect(page.url()).toContain('#prog?c=Dm7%2CG7%2CCmaj7');
  await expect(page.locator('#pp-boxes > figure')).toHaveCount(3);
  // 잘못된 입력
  await page.goto('/chords.html#prog', { waitUntil: 'load' });
  await page.locator('#pp-input').fill('zzz');
  await page.locator('#pp-empty button[type="submit"]').click();
  await expect(page.locator('#pp-status')).toContainText('읽을 수 있는 코드가 없어요');
  await expect(page.locator('#pp-play')).toBeDisabled();
  // 시드 링크
  await page.goto('/chords.html#prog', { waitUntil: 'load' });
  await page.locator('#pp-seeds a[data-seed="ref-seed-1"]').click();
  await expect(page.locator('#pp-title')).toContainText('Neo-Soul Minor Plagal Cadence');
  await expect(page.locator('#pp-boxes > figure')).toHaveCount(4);
  expect(errors).toEqual([]);
});

test('PP5 코드 진행 모음 목록 검색·정렬(곡명·키)', async ({ page }) => {
  const errors = await open(page, '/progressions.html?scope=all');
  test.skip(errors === null, 'legacy 모드: React 화면 아님');
  const rows = page.locator('#progList > li');
  await expect(rows).toHaveCount(10);
  await page.locator('#progSearch').fill('autumn');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Autumn Leaves');
  await expect(page.locator('#progSearchCount')).toHaveText('10개 중 1개');
  await page.locator('#progSearch').fill('a min');
  await expect(rows.first()).toContainText('A min');
  await page.locator('#progSearch').fill('없는곡zzz');
  await expect(rows).toHaveCount(0);
  await expect(page.locator('#progNoMatch')).toBeVisible();
  await page.locator('#progSearch').fill('');
  await expect(rows).toHaveCount(10);

  const order = () => rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-progression')));
  // 키: 노션 Scale 순서(C Major → C min → … → A min), 키 없음(F Dominant) 마지막, 같은 키는 곡명(ko: 한글 → 영문)
  await page.locator('#progSort').selectOption('key');
  expect(await order()).toEqual(['arch-seed-1', 'ref-seed-1', 'ref-seed-5', 'arch-seed-2', 'ref-seed-4', 'arch-seed-4', 'arch-seed-5', 'ref-seed-3', 'ref-seed-2', 'arch-seed-3']);
  await page.locator('#progSort').selectOption('title');
  expect(await order()).toEqual(['arch-seed-2', 'arch-seed-4', 'arch-seed-5', 'arch-seed-3', 'ref-seed-4', 'arch-seed-1', 'ref-seed-2', 'ref-seed-5', 'ref-seed-1', 'ref-seed-3']);
  // 검색 + 정렬 같이
  await page.locator('#progSearch').fill('minor');
  expect(await order()).toEqual(['ref-seed-4', 'ref-seed-1']);
  await page.locator('#progSearch').fill('');
  await page.locator('#progSort').selectOption('recent');
  await expect(rows.first()).toHaveAttribute('data-progression', 'ref-seed-1');
  expect(errors).toEqual([]);
});
