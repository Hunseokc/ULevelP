// 공통 정렬 검사기 (FT-1): 규격 개발산출물/프론트_정렬규격.md §3~§5, §8
// checkLayout(page, options) → { fails, warns } · layoutSuite({...}) → 상태 × 폭 테스트 생성
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { mockApp, STATES } = require('./mock-app');

const WIDTHS = [1280, 1150, 768, 390];
const HEIGHT = 900;
const DEFAULT_SCALE = [0, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64];

// ---------------------------------------------------------------------------
// 브라우저 안에서 도는 판정. page.evaluate로 넘기므로 바깥 변수를 쓰지 않는다
// ---------------------------------------------------------------------------
function browserCheck(o) {
  const fails = [];
  const warns = [];
  const RULES = ['G1', 'G2', 'G3', 'G4', 'G5', 'G5a', 'G5b', 'G6', 'G7', 'G7a', 'G7b', 'G8', 'A1'];
  const LINES = ['top', 'bottom', 'left', 'right', 'height', 'width', 'center-x', 'center-y'];
  const LINE_KO = {
    top: '윗선', bottom: '아랫선', left: '왼쪽선', right: '오른쪽선',
    height: '높이', width: '폭', 'center-x': '가로 중심', 'center-y': '세로 중심',
  };
  const NOT_CARD = new Set(['HTML', 'BODY', 'BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY', 'IMG', 'SVG', 'VIDEO', 'IFRAME', 'CANVAS']);
  const MEDIA = new Set(['IMG', 'VIDEO', 'PICTURE', 'IFRAME']);
  const FORM = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
  const r1 = (n) => Math.round(n);
  const css = new Map();
  const S = (el) => {
    let s = css.get(el);
    if (!s) css.set(el, (s = getComputedStyle(el)));
    return s;
  };
  const R = (el) => el.getBoundingClientRect();

  // --- 대상 표기: #id → [그룹이름] → 태그.모듈클래스 + 글자 앞 16자
  const label = (el) => {
    if (el.id) return '#' + el.id;
    const g = (el.getAttribute('data-align-group') || '').match(/^\s*([A-Za-z][\w-]*)\s*:/);
    if (g) return '[' + g[1] + ']';
    const tag = el.tagName.toLowerCase();
    let cls = '';
    for (const c of el.classList) {
      const m = c.match(/^_?([A-Za-z][\w-]*?)_[a-z0-9]{5}_\d+$/);
      if (m) { cls = m[1]; break; }
      if (!cls) cls = c;
    }
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return tag + (cls ? '.' + cls : '') + (text ? ` "${text.length > 16 ? text.slice(0, 16) + '…' : text}"` : '');
  };

  // --- 보이는 요소
  const inSvg = (el) => el.tagName !== 'svg' && el.closest('svg') !== null;
  const visible = (el) => {
    if (inSvg(el)) return false;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = R(el);
    return r.width > 1 && r.height > 1;
  };
  const all = [...document.body.querySelectorAll('*')].filter(visible);
  const shown = new Set(all);
  const inFlow = (el) => !['absolute', 'fixed'].includes(S(el).position);
  const flowKids = (el) => [...el.children].filter((c) => shown.has(c) && inFlow(c));
  const clips = (el) => S(el).overflowX !== 'visible' || S(el).overflowY !== 'visible';
  const scrolls = (el) => /auto|scroll/.test(S(el).overflowX + S(el).overflowY);
  const directText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '');

  // --- G0: 약속·예외 표기
  const ignoreMap = new Map();
  for (const el of document.querySelectorAll('[data-layout-ignore]')) {
    const v = el.getAttribute('data-layout-ignore') || '';
    const m = v.match(/^\s*([^:]+?)\s*:\s*(.*)$/);
    const ids = m ? m[1].split(/\s+/) : [];
    const bad = !m || m[2].trim() === '' || ids.length === 0 || ids.some((id) => !RULES.includes(id));
    if (bad) fails.push(`G0 ${label(el)} data-layout-ignore 형식 오류 "${v}" (규칙 ID: 사유)`);
    else ignoreMap.set(el, ids);
  }
  const ignored = (el, rule) => {
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const ids = ignoreMap.get(a);
      if (ids && ids.some((id) => id === rule || (rule.length === 3 && id === rule.slice(0, 2)))) return true;
    }
    return false;
  };
  const groups = new Map(); // name → { lines:Set, minW, members:[] }
  for (const el of document.querySelectorAll('[data-align-group]')) {
    const v = el.getAttribute('data-align-group') || '';
    for (const part of v.split(';').map((p) => p.trim()).filter(Boolean)) {
      const m = part.match(/^([A-Za-z][\w-]*)\s*:\s*([a-z,\s-]+?)\s*(?:@(\d+))?$/);
      const lines = m ? m[2].split(',').map((s) => s.trim()) : [];
      if (!m || lines.some((l) => !LINES.includes(l))) {
        fails.push(`G0 ${label(el)} data-align-group 형식 오류 "${part}"`);
        continue;
      }
      const g = groups.get(m[1]) || { lines: new Set(), minW: 0, members: [] };
      lines.forEach((l) => g.lines.add(l));
      if (m[3]) g.minW = Math.max(g.minW, Number(m[3]));
      if (!g.members.includes(el)) g.members.push(el);
      groups.set(m[1], g);
    }
  }

  // --- 색 파싱: rgb()/rgba()/color(srgb …) → [r,g,b,a] (0~255, 알파 0~1)
  const parseColor = (s) => {
    if (!s) return null;
    let m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
    if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : parseFloat(m[4]) / (m[4].endsWith('%') ? 100 : 1)];
    m = s.match(/^color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/);
    if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, m[4] === undefined ? 1 : parseFloat(m[4]) / (m[4].endsWith('%') ? 100 : 1)];
    return null;
  };
  const sameRgb = (a, b) => Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1 && Math.abs(a[2] - b[2]) <= 1;
  const fmt = (c) => `rgb(${r1(c[0])}, ${r1(c[1])}, ${r1(c[2])})`;

  // 현재 테마의 색 토큰: :root 규칙에 선언된 --이름을 모아 var()로 풀어 본다
  const tokenNames = new Set();
  const walk = (rules) => {
    for (const rule of rules) {
      if (rule.cssRules && !rule.style) walk(rule.cssRules);
      else if (rule.style && /:root/.test(rule.selectorText || '')) {
        for (const p of rule.style) if (p.startsWith('--')) tokenNames.add(p);
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try { walk(sheet.cssRules); } catch (e) { /* 다른 출처 시트 */ }
  }
  const probeHost = document.createElement('div');
  probeHost.style.cssText = 'position:absolute;left:-9999px;top:0;color:rgb(1, 2, 3)';
  const probe = document.createElement('span');
  probeHost.appendChild(probe);
  document.body.appendChild(probeHost);
  const tokens = new Map();
  for (const name of tokenNames) {
    probe.style.color = '';
    probe.style.color = `var(${name})`;
    const v = getComputedStyle(probe).color;
    if (v !== 'rgb(1, 2, 3)') {
      const c = parseColor(v);
      if (c) tokens.set(name, c);
    }
  }
  probeHost.remove();
  const palette = [...tokens.values()];

  // --- 카드 자동 인식(§5-1)
  const bgOf = (el) => {
    for (let a = el; a; a = a.parentElement) {
      const c = parseColor(S(a).backgroundColor);
      if (c && c[3] > 0) return c;
    }
    return [255, 255, 255, 1];
  };
  const sideBorder = (s, side) =>
    parseFloat(s[`border${side}Width`]) >= 1 && s[`border${side}Style`] !== 'none' && (parseColor(s[`border${side}Color`]) || [0, 0, 0, 0])[3] > 0;
  const isCard = (el) => {
    if (NOT_CARD.has(el.tagName.toUpperCase())) return false;
    const s = S(el);
    if (['inline', 'contents', 'none'].includes(s.display)) return false;
    if (parseFloat(s.borderTopLeftRadius) >= 1) return false;
    const r = R(el);
    if (r.width < 48 || r.height < 32) return false;
    if (['Top', 'Right', 'Bottom', 'Left'].every((side) => sideBorder(s, side))) return true;
    const bg = parseColor(s.backgroundColor);
    if (!bg || bg[3] === 0) return false;
    const up = el.parentElement ? bgOf(el.parentElement) : [255, 255, 255, 1];
    return !(sameRgb(bg, up) && Math.abs(bg[3] - up[3]) < 0.01);
  };
  const cards = new Set(all.filter(isCard));

  // --- G1 넘침: 가장 가까운 카드 기준. 사이에 잘라내는 상자가 있으면 그 상자가 대신 검사된다
  const overflowed = new Set();
  for (const el of all) {
    if (S(el).position === 'fixed' || ignored(el, 'G1')) continue;
    let card = null;
    let blocked = false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (cards.has(a)) { card = a; break; }
      if (clips(a) || S(a).position === 'fixed') { blocked = true; break; }
    }
    if (!card || blocked) continue;
    if (MEDIA.has(el.tagName.toUpperCase()) && /hidden|clip/.test(S(card).overflowX + S(card).overflowY)) continue;
    const c = R(card);
    const r = R(el);
    const out = [];
    if (r.left < c.left - 0.5) out.push(`왼쪽 +${r1(c.left - r.left)}px`);
    if (r.right > c.right + 0.5) out.push(`오른쪽 +${r1(r.right - c.right)}px`);
    if (r.top < c.top - 0.5) out.push(`위 +${r1(c.top - r.top)}px`);
    if (r.bottom > c.bottom + 0.5) out.push(`아래 +${r1(r.bottom - c.bottom)}px`);
    if (!out.length) continue;
    overflowed.add(el);
    if (el.parentElement && overflowed.has(el.parentElement)) continue; // 바깥쪽 하나만 보고
    fails.push(`G1 ${label(card)} 밖으로 ${label(el)} 넘침 (${out.join(', ')})`);
  }

  // --- G2 형제 겹침: 보이는 범위(자기 ∪ 흐름 안 자손, 잘린 것 제외)
  const extentCache = new Map();
  const extent = (el) => {
    if (extentCache.has(el)) return extentCache.get(el);
    const r = R(el);
    const e = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    if (!clips(el)) {
      for (const k of flowKids(el)) {
        const x = extent(k);
        e.left = Math.min(e.left, x.left); e.top = Math.min(e.top, x.top);
        e.right = Math.max(e.right, x.right); e.bottom = Math.max(e.bottom, x.bottom);
      }
    }
    extentCache.set(el, e);
    return e;
  };
  for (const parent of new Set(all.map((el) => el.parentElement))) {
    if (!parent) continue;
    const kids = flowKids(parent).filter((k) => S(k).display !== 'inline' && !ignored(k, 'G2'));
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = extent(kids[i]);
        const b = extent(kids[j]);
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 0.5 && h > 0.5) {
          fails.push(`G2 ${label(parent)} 안 ${label(kids[i])} ↔ ${label(kids[j])} ${r1(Math.min(w, h))}px 겹침`);
        }
      }
    }
  }

  // --- G3 글자 잘림·넘침: 글자를 직접 가진 요소만
  for (const el of all) {
    if (FORM.has(el.tagName.toUpperCase()) || scrolls(el) || !directText(el) || ignored(el, 'G3')) continue;
    if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) {
      fails.push(`G3 ${label(el)} 말줄임·넘침 (${el.scrollWidth}>${el.clientWidth})`);
    } else if (/hidden|clip/.test(S(el).overflowY) && el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1) {
      fails.push(`G3 ${label(el)} 줄 잘림 (높이 ${el.scrollHeight}>${el.clientHeight})`);
    }
  }

  // --- G4 가로 스크롤
  const de = document.documentElement;
  if (de.scrollWidth - de.clientWidth > 0) {
    const far = all
      .filter((el) => S(el).position !== 'fixed' && R(el).right > de.clientWidth + 0.5)
      .sort((a, b) => R(b).right - R(a).right)
      .slice(0, 3)
      .map((el) => `${label(el)} +${r1(R(el).right - de.clientWidth)}px`);
    fails.push(`G4 가로 스크롤 ${de.scrollWidth - de.clientWidth}px (${far.join(', ')})`);
  }

  // --- G5 색
  const forbid = (o.forbidColors || []).map((n) => [n, tokens.get(n)]).filter(([, c]) => c);
  for (const n of o.forbidColors || []) if (!tokens.has(n)) fails.push(`G0 forbidColors ${n}: 색 토큰이 아님`);
  const colorUses = (el) => {
    const s = S(el);
    const used = [];
    // 체크박스·라디오·범위 입력의 color는 글자로 그려지지 않는다(v1.2)
    const noText = el.matches('input[type="checkbox"], input[type="radio"], input[type="range"]');
    if (!noText && (directText(el) || FORM.has(el.tagName.toUpperCase()))) used.push(['color', s.color]);
    used.push(['background', s.backgroundColor]);
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      if (parseFloat(s[`border${side}Width`]) >= 1 && s[`border${side}Style`] !== 'none') used.push(['border', s[`border${side}Color`]]);
    }
    if (s.textDecorationLine && s.textDecorationLine !== 'none') used.push(['text-decoration', s.textDecorationColor]);
    return used;
  };
  const svgShapes = [...document.querySelectorAll('svg path, svg circle, svg rect, svg line, svg polyline, svg polygon, svg ellipse, svg text')].filter((el) => {
    const host = el.closest('svg');
    return host && shown.has(host) && el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  });
  // svg line은 fill이 그려지지 않는다(v1.2)
  const svgUses = (el) => (el.tagName.toLowerCase() === 'line' ? [] : [['fill', S(el).fill]]).concat([['stroke', S(el).stroke]]);
  const colorTargets = [...all.map((el) => [el, colorUses(el)]), ...svgShapes.map((el) => [el, svgUses(el)])];
  for (const [el, uses] of colorTargets) {
    for (const [prop, value] of uses) {
      if (!value || value === 'none' || value.startsWith('url(')) continue;
      const c = parseColor(value);
      if (!c || c[3] === 0) continue;
      const hit = forbid.find(([, t]) => sameRgb(c, t));
      if (hit && !ignored(el, 'G5a')) fails.push(`G5a ${label(el)} 금지 색 ${hit[0]} (${prop})`);
      else if (!hit && !palette.some((t) => sameRgb(c, t)) && !ignored(el, 'G5b')) warns.push(`G5b ${label(el)} 팔레트 밖 색 ${fmt(c)} (${prop})`);
    }
  }

  // --- G6 처짐: 카드의 흐름 안 첫 두 자식이 위아래로 쌓였을 때
  const sagMax = o.sagMax === undefined ? 24 : o.sagMax;
  for (const card of cards) {
    if (ignored(card, 'G6')) continue;
    const [a, b] = flowKids(card);
    if (!a || !b) continue;
    const ra = R(a);
    const rb = R(b);
    if (rb.top < ra.bottom - 0.5) continue;
    const gap = rb.top - ra.bottom;
    if (gap > sagMax) fails.push(`G6 ${label(card)} 제목 아래 ${r1(gap)}px 빔 (기준 ${sagMax})`);
  }

  // --- G7 터치 대상: 24px 미만이면 WCAG 2.5.8 간격 예외(지름 24px 원이 다른 대상·원과 안 겹침)까지 본다
  const targets = all.filter((el) => {
    if (!el.matches('a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], label[for]')) return false;
    if (S(el).display === 'inline' && el.parentElement && directText(el.parentElement)) return false; // 문장 속 링크
    return true;
  });
  const center = (r) => [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
  const circleHitsRect = ([cx, cy], r, rad) => {
    const dx = Math.max(r.left - cx, 0, cx - r.right);
    const dy = Math.max(r.top - cy, 0, cy - r.bottom);
    return dx * dx + dy * dy < rad * rad;
  };
  const small = new Set(targets.filter((el) => R(el).width < 24 || R(el).height < 24));
  for (const el of small) {
    if (ignored(el, 'G7a')) continue;
    const r = R(el);
    const c = center(r);
    const clash = targets.find((t) => {
      if (t === el || t.contains(el) || el.contains(t)) return false;
      if (circleHitsRect(c, R(t), 12)) return true;
      if (small.has(t)) { const [x, y] = center(R(t)); return (x - c[0]) ** 2 + (y - c[1]) ** 2 < 24 * 24; }
      return false;
    });
    if (clash) fails.push(`G7a ${label(el)} 터치 대상 ${r1(r.width)}×${r1(r.height)} (최소 24, ${label(clash)}와 가까움)`);
  }
  if (o.width <= 768) {
    for (const el of targets) {
      const h = R(el).height;
      if (h < 44 && !ignored(el, 'G7b')) warns.push(`G7b ${label(el)} 높이 ${r1(h)}px (권장 44)`);
    }
  }

  // --- G8 간격 스케일
  const sp = o.spacing || {};
  const scale = sp.scale || o.defaultScale;
  const g8 = sp.level === 'fail' ? fails : warns;
  for (const box of all) {
    if (ignored(box, 'G8')) continue;
    const kids = flowKids(box).filter((k) => S(k).display !== 'inline');
    if (kids.length < 2) continue;
    const vgaps = [];
    const hgaps = [];
    for (let i = 1; i < kids.length; i++) {
      const p = R(kids[i - 1]);
      const q = R(kids[i]);
      if (q.top >= p.bottom - 0.5) vgaps.push(Math.max(0, r1(q.top - p.bottom)));
      else if (q.left >= p.right - 0.5 && q.top < p.bottom && q.bottom > p.top) hgaps.push(Math.max(0, r1(q.left - p.right)));
    }
    for (const [dir, gaps] of [['세로', vgaps], ['가로', hgaps]]) {
      const off = [...new Set(gaps.filter((g) => !scale.includes(g)))];
      if (off.length) g8.push(`G8 ${label(box)} ${dir} 간격 ${off.join('·')}px 스케일 밖`);
      const uniq = [...new Set(gaps)];
      if (uniq.length > 1) g8.push(`G8 ${label(box)} ${dir} 간격 들쭉날쭉 (${uniq.join('·')}px)`);
    }
  }

  // --- A1 배치 약속
  for (const [name, g] of groups) {
    const members = g.members.filter((m) => shown.has(m));
    if (members.length < 2) {
      if (members.length === 1) warns.push(`A1 ${name} 보이는 구성원 1개 (이름 오타?)`);
      continue;
    }
    if (ignored(members[0], 'A1')) continue;
    const ref = members[0];
    const a = R(ref);
    const val = {
      top: (r) => r.top, bottom: (r) => r.bottom, left: (r) => r.left, right: (r) => r.right,
      height: (r) => r.height, width: (r) => r.width,
      'center-x': (r) => (r.left + r.right) / 2, 'center-y': (r) => (r.top + r.bottom) / 2,
    };
    for (const m of members.slice(1)) {
      const b = R(m);
      const stacked = b.top >= a.bottom - 0.5 || a.top >= b.bottom - 0.5; // 세로 범위가 안 겹침
      const sideBy = b.left >= a.right - 0.5 || a.left >= b.right - 0.5; // 가로 범위가 안 겹침
      for (const line of g.lines) {
        const yLine = ['top', 'bottom', 'height', 'center-y'].includes(line);
        const skip = yLine ? stacked : sideBy;
        if (skip) {
          if (g.minW && o.width >= g.minW) {
            const msg = yLine ? '나란해야 하는데 쌓임' : '쌓여야 하는데 나란함';
            fails.push(`A1 ${name} ${o.width}px에서 ${msg} (${label(ref)} ↔ ${label(m)})`);
          }
          continue;
        }
        const d = val[line](b) - val[line](a);
        if (Math.abs(d) > 1) fails.push(`A1 ${name} ${LINE_KO[line]} 차이 ${r1(d)}px (${label(ref)} ↔ ${label(m)})`);
      }
    }
  }

  return { fails: [...new Set(fails)], warns: [...new Set(warns)], cards: [...cards].map(label) };
}

/**
 * 지금 화면을 검사한다.
 * @param {import('@playwright/test').Page} page
 * @param {{ width?: number, forbidColors?: string[], sagMax?: number, spacing?: { scale?: number[], level?: 'warn'|'fail' } }} [options]
 * @returns {Promise<{ fails: string[], warns: string[], cards: string[] }>}
 */
async function checkLayout(page, options = {}) {
  const width = options.width || (page.viewportSize() || {}).width || 1280;
  return page.evaluate(browserCheck, { ...options, width, defaultScale: DEFAULT_SCALE });
}

async function openState(page, { path: url, state, width, ready, mock }) {
  await page.setViewportSize({ width, height: HEIGHT });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockApp(page, { ...(typeof state === 'string' ? STATES[state] : state.mock), ...(mock || {}) });
  await page.goto(url, { waitUntil: 'load' });
  if ((await page.locator('#root').count()) === 0) return false;
  if (ready) await ready(page, typeof state === 'string' ? state : state.name);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  return true;
}

async function runCheck(page, testInfo, { name, stateName, width, options, dark, known }) {
  const result = await checkLayout(page, { ...options, width });
  const shotName = `${name}-${stateName}-${width}${dark ? '-dark' : ''}`;
  if (result.warns.length) {
    for (const w of result.warns) testInfo.annotations.push({ type: 'layout-warn', description: w });
    await testInfo.attach('layout-warnings.txt', { body: result.warns.join('\n'), contentType: 'text/plain' });
  }
  if (process.env.LAYOUT_SHOTS === '1') {
    const dir = path.join(process.cwd(), 'test-results', 'layout-shots');
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${shotName}.png`), fullPage: true });
  }
  // 알려진 실패(규격 §8-2): 목록에 맞으면 기록만 하고 통과, 목록 밖 실패는 그대로 실패. LAYOUT_STRICT=1이면 알려진 것도 실패
  const isKnown = (f) => (known || []).some((k) => k.match.test(f));
  const knownFails = result.fails.filter(isKnown);
  if (knownFails.length) {
    for (const f of knownFails) testInfo.annotations.push({ type: 'layout-known', description: f });
    await testInfo.attach('layout-known.txt', { body: knownFails.join('\n'), contentType: 'text/plain' });
  }
  const fails =
    process.env.LAYOUT_STRICT === '1' ? [...result.fails, ...result.warns] : result.fails.filter((f) => !isKnown(f));
  expect(fails, `${shotName} 정렬 검사`).toEqual([]);
}

/**
 * 화면 하나의 상태 × 폭 테스트와 다크 1개를 만든다(§8).
 * @param {object} cfg
 * @param {string} cfg.name 화면 이름(테스트 이름·스크린샷 파일 이름)
 * @param {string} cfg.path 열 주소
 * @param {Array<string|{name: string, mock: object}>} cfg.states 표준 상태 키 또는 화면 전용 상태
 * @param {(page, state: string) => Promise<void>} [cfg.ready] 판정 전에 기다릴 것
 * @param {object} [cfg.options] checkLayout 화면별 설정
 * @param {object} [cfg.mock] 모든 상태에 덧붙일 mockApp 옵션(routes 등)
 * @param {string} [cfg.dark] 다크 모드로 한 번 더 볼 상태(1280px)
 * @param {number[]} [cfg.widths]
 * @param {Array<{match: RegExp, why: string}>} [cfg.known] 알려진 실패(기록만). why에 원인과 고칠 step을 적는다
 */
function layoutSuite(cfg) {
  const widths = cfg.widths || WIDTHS;
  const stateName = (s) => (typeof s === 'string' ? s : s.name);
  for (const state of cfg.states) {
    for (const width of widths) {
      test(`FT ${cfg.name} ${stateName(state)} ${width}px`, async ({ page }, testInfo) => {
        const ok = await openState(page, { ...cfg, state, width });
        test.skip(!ok, 'legacy 모드: React 화면 아님');
        await runCheck(page, testInfo, { name: cfg.name, stateName: stateName(state), width, options: cfg.options, known: cfg.known });
      });
    }
  }
  if (cfg.dark) {
    const state = cfg.states.find((s) => stateName(s) === cfg.dark) || cfg.dark;
    test(`FT ${cfg.name} ${cfg.dark} ${widths[0]}px 다크`, async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      const ok = await openState(page, { ...cfg, state, width: widths[0] });
      test.skip(!ok, 'legacy 모드: React 화면 아님');
      await runCheck(page, testInfo, { name: cfg.name, stateName: cfg.dark, width: widths[0], options: cfg.options, dark: true, known: cfg.known });
    });
  }
}

module.exports = { checkLayout, layoutSuite, WIDTHS, DEFAULT_SCALE };
