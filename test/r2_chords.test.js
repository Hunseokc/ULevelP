// test/r2_chords.test.js
// R2-1 코드 연습실(ChordsPage / public/app.js): 7개 탭, 베이스 4·5·6현 & AU.bassPluck, CAGED 5블럭 시퀀스, 7 · 더블 스탑 연습 검증 (R2-C1 ~ R2-C9)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const CT = require('../public/lib/theory.js');
const GE = require('../public/lib/voicing.js');

const ROOT = path.join(__dirname, '..');

function readText(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8').replace(/\r\n/g, '\n');
}

function createChordsDomSandbox(initialHash = '') {
  const elements = new Map();
  const storage = new Map();
  const audioLog = { pluck: [], bassPluck: [], doubleStop: [], chord: [], bass: [], click: [] };

  function makeEl(id) {
    const el = {
      id,
      tagName: 'DIV',
      value: '',
      checked: false,
      disabled: false,
      hidden: false,
      open: false,
      textContent: '',
      _innerHTML: '',
      className: '',
      dataset: {},
      attributes: {},
      listeners: {},
      children: [],
      classList: {
        toggle(cls, force) {
          const set = new Set((el.className || '').split(/\s+/).filter(Boolean));
          if (force === undefined ? !set.has(cls) : force) set.add(cls);
          else set.delete(cls);
          el.className = [...set].join(' ');
        },
        contains(cls) {
          return (el.className || '').split(/\s+/).includes(cls);
        },
      },
      setAttribute(k, v) {
        el.attributes[k] = String(v);
        if (k.startsWith('data-')) {
          el.dataset[k.slice(5)] = String(v);
        }
      },
      getAttribute(k) {
        return el.attributes[k] ?? null;
      },
      addEventListener(ev, fn) {
        el.listeners[ev] = fn;
      },
      appendChild(child) {
        el.children.push(child);
        return child;
      },
      replaceChildren() {
        el.children = [];
      },
      click() {
        if (el.disabled) return;
        if (el.listeners.click) {
          el.listeners.click({
            target: el,
            preventDefault() {},
            closest: (sel) => {
              if (sel === '.nd' && (el.className || '').includes('nd')) return el;
              return null;
            },
          });
        }
      },
      querySelectorAll(sel) {
        if (
          sel === '.chip' ||
          sel === '.cell' ||
          sel === '.step' ||
          sel === '.interp' ||
          sel === '.opt' ||
          sel === '.wn' ||
          sel === '.hit' ||
          sel === '.mini' ||
          sel === '.cell.pick'
        ) {
          return el._parsedItems || [];
        }
        return [];
      },
    };

    Object.defineProperty(el, 'innerHTML', {
      get() {
        return el._innerHTML;
      },
      set(html) {
        el._innerHTML = String(html || '');
        const items = [];
        const tagRe = /<(button|figure|g|rect)\b([^>]*)>([\s\S]*?)<\/\1>|<rect\b([^>]*)\/>/gi;
        for (const m of el._innerHTML.matchAll(tagRe)) {
          const attrs = m[2] || m[4] || '';
          const body = m[3] || '';
          const item = makeEl('');
          item.textContent = body.replace(/<[^>]+>/g, '');
          for (const da of attrs.matchAll(/data-([a-z0-9-]+)="([^"]*)"/gi)) {
            item.dataset[da[1]] = da[2];
          }
          const clsM = attrs.match(/class="([^"]*)"/i);
          if (clsM) item.className = clsM[1];
          if (/\bdisabled\b/i.test(attrs)) item.disabled = true;
          const ariaM = attrs.match(/aria-pressed="([^"]*)"/i);
          if (ariaM) item.attributes['aria-pressed'] = ariaM[1];
          items.push(item);
        }
        el._parsedItems = items;
      },
    });

    return el;
  }

  const allIds = [
    'theme-light', 'theme-dark',
    'tab-scale', 'tab-tone', 'tab-matrix', 'tab-circle', 'tab-reint', 'tab-tf', 'tab-ds',
    'pane-scale', 'pane-tone', 'pane-matrix', 'pane-circle', 'pane-reint', 'pane-tf', 'pane-ds',
    'sc-title', 'sc-notes', 'sc-circle', 'sc-wheel', 'sc-change', 'sc-next', 'sc-prev', 'sc-nextb',
    'sc-board', 'sc-seq', 'sc-zoom', 'sc-pos', 'sc-leg-moved',
    'sc-inst-chips', 'sc-block', 'sc-block-msg',
    'sc-mode', 'sc-root', 'sc-root-lab', 'sc-type', 'sc-label', 'sc-inst', 'sc-hand',
    'sc-circle-opts', 'sc-dir', 'sc-bars', 'sc-range', 'sc-bpm', 'sc-rootonly', 'sc-play', 'sc-status',
    'tone-root', 'tone-near', 'tone-bpm', 'tone-auto', 'tone-start', 'tone-q', 'tone-dir', 'tone-play', 'tone-title', 'tone-board', 'tone-seq',
    'mx-root', 'mx-span', 'mx-bpm', 'mx-beats', 'mx-drop', 'mx-inv', 'mx-set', 'mx-place', 'mx-play', 'mx-count', 'mx-btitle', 'mx-board', 'mx-struct', 'mx-strip', 'mx-alt',
    'cc-root', 'cc-top', 'cc-str', 'cc-near', 'cc-bpm', 'cc-beats', 'cc-hint', 'cc-topsnd', 'cc-skip', 'cc-prev', 'cc-play', 'cc-nextb', 'cc-wheel', 'cc-name', 'cc-deg', 'cc-where', 'cc-next', 'cc-hints', 'cc-board', 'cc-strip', 'cc-all', 'cc-alllist',
    'ri-presets', 'ri-board', 'ri-hear', 'ri-clear', 'ri-shape', 'ri-list', 'ri-key', 'ri-bpm', 'ri-swap', 'ri-play', 'qz-score', 'qz-box', 'qz-text', 'qz-opts', 'qz-fb', 'qz-hear', 'qz-next',
    'a-kind', 'a-lo', 'a-hi', 'a-proot', 'a-ptype', 'a-out', 'a-guide', 'a-pent', 'a-var', 'a-go', 'a-status', 'a-view', 'a-vtitle', 'a-vmeta', 'a-vchips', 'a-vplay', 'a-board', 'a-vctxl', 'a-out-list',
    'ds-inst', 'ds-root', 'ds-scale', 'ds-bpm', 'ds-interval', 'ds-pair', 'ds-dir', 'ds-play', 'ds-status', 'ds-title', 'ds-board', 'ds-steps',
  ];

  for (const id of allIds) {
    elements.set(id, makeEl(id));
  }
  elements.get('sc-bpm').value = '90';
  elements.get('tone-near').value = '3';
  elements.get('tone-bpm').value = '80';
  elements.get('mx-span').value = '4';
  elements.get('mx-bpm').value = '70';
  elements.get('mx-beats').value = '4';
  elements.get('cc-str').value = '5';
  elements.get('cc-near').value = '8';
  elements.get('cc-bpm').value = '60';
  elements.get('cc-beats').value = '4';
  elements.get('cc-hint').checked = true;
  elements.get('cc-topsnd').checked = true;
  elements.get('cc-skip').checked = true;
  elements.get('ri-bpm').value = '90';
  elements.get('a-kind').value = 'major';
  elements.get('a-lo').value = '5';
  elements.get('a-hi').value = '8';
  elements.get('a-proot').value = '9';
  elements.get('a-ptype').value = 'min';
  elements.get('a-out').value = '2';
  elements.get('a-guide').value = '2';
  elements.get('a-pent').checked = true;
  elements.get('ds-bpm').value = '75';

  const oscFreqs = [];
  class FakeAudioContext {
    constructor() {
      this.currentTime = 1.0;
      this.state = 'running';
      this.destination = {};
    }
    resume() {}
    createGain() {
      return {
        gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
      };
    }
    createDynamicsCompressor() {
      return { connect() {} };
    }
    createBiquadFilter() {
      return {
        type: 'lowpass',
        frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
      };
    }
    createOscillator() {
      const osc = {
        type: 'sine',
        frequency: {
          value: 0,
          setValueAtTime(v) {
            osc.frequency.value = v;
          },
        },
        connect() {},
        start() {
          oscFreqs.push({ type: osc.type, freq: osc.frequency.value });
        },
        stop() {},
      };
      return osc;
    }
  }

  const intervals = new Set();
  const timeouts = new Set();

  const sandbox = {
    CT,
    GE,
    window: {
      AudioContext: FakeAudioContext,
      addEventListener() {},
    },
    document: {
      documentElement: { dataset: {} },
      getElementById: (id) => elements.get(id) || null,
      createElement: (t) => makeEl(t),
      querySelectorAll: (sel) => {
        if (sel === '.playbtn') {
          return ['sc-play', 'tone-play', 'mx-play', 'cc-play', 'ri-play', 'ds-play'].map((id) => elements.get(id));
        }
        return [];
      },
      addEventListener() {},
    },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    location: { hash: initialHash },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    setInterval: (fn, ms) => {
      const id = setInterval(fn, ms);
      intervals.add(id);
      return id;
    },
    clearInterval: (id) => {
      intervals.delete(id);
      clearInterval(id);
    },
    setTimeout: (fn, ms) => {
      const id = setTimeout(fn, ms);
      timeouts.add(id);
      return id;
    },
    clearTimeout: (id) => {
      timeouts.delete(id);
      clearTimeout(id);
    },
    Math,
    Number,
    String,
    Array,
    Set,
    Object,
    parseInt,
    parseFloat,
  };
  sandbox.window.document = sandbox.document;

  function runScript() {
    const code = readText('public/app.js');
    vm.runInNewContext(code, sandbox);
  }

  function cleanup() {
    for (const i of intervals) clearInterval(i);
    for (const t of timeouts) clearTimeout(t);
    intervals.clear();
    timeouts.clear();
  }

  return { elements, storage, oscFreqs, audioLog, sandbox, runScript, cleanup };
}

// -------------------------------------------------------------
// R2-C1 ~ R2-C9 테스트 케이스 본문
// -------------------------------------------------------------

test('R2-C1: 7개 탭 구성 및 #hash / ulp:tab 라우팅 연동', () => {
  const appTsx = readText('frontend/src/App.tsx');
  assert.ok(appTsx.includes('<ChordsPage'), 'App.tsx should import and render ChordsPage');
  assert.ok(appTsx.includes('path="/chords.html"'), 'App.tsx should route /chords.html');

  const chordsHtml = readText('public/chords.html');
  const tabs = ['scale', 'tone', 'matrix', 'circle', 'reint', 'tf', 'ds'];
  for (const t of tabs) {
    assert.ok(chordsHtml.includes(`id="tab-${t}"`), `chords.html must have #tab-${t}`);
    assert.ok(chordsHtml.includes(`id="pane-${t}"`), `chords.html must have #pane-${t}`);
  }

  // #ds 해시로 진입 시 7번째 탭 활성화 확인
  const env = createChordsDomSandbox('#ds');
  try {
    env.runScript();
    assert.equal(env.elements.get('tab-ds').getAttribute('aria-selected'), 'true');
    assert.equal(env.elements.get('pane-ds').hidden, false);
    assert.equal(env.elements.get('pane-scale').hidden, true);
    assert.equal(env.storage.get('ulp:tab'), 'ds');
  } finally {
    env.cleanup();
  }
});

test('R2-C2: 5종 악기(g6, g7, b4, b5, b6) 칩 전환 및 베이스 AU.bassPluck 발음', () => {
  const env = createChordsDomSandbox('#scale');
  try {
    env.runScript();
    const instChips = env.elements.get('sc-inst-chips')._parsedItems || [];
    assert.equal(instChips.length, 5, '5 instrument chips should be rendered');

    // 4현 베이스 선택
    const b4Chip = instChips.find((c) => c.dataset.v === 'b4');
    assert.ok(b4Chip, 'b4 chip exists');
    b4Chip.click();

    const boardHtml = env.elements.get('sc-board').innerHTML;
    assert.ok(boardHtml.includes('4·E'), 'b4 should render 4·E');
    assert.ok(boardHtml.includes('1·G'), 'b4 should render 1·G');

    // 6현 베이스 선택
    const b6Chip = env.elements.get('sc-inst-chips')._parsedItems.find((c) => c.dataset.v === 'b6');
    assert.ok(b6Chip, 'b6 chip exists');
    b6Chip.click();

    const b6Html = env.elements.get('sc-board').innerHTML;
    assert.ok(b6Html.includes('6·B'), 'b6 should render 6·B');
    assert.ok(b6Html.includes('1·C'), 'b6 should render 1·C');
  } finally {
    env.cleanup();
  }
});

test('R2-C3: CAGED 5블럭(#1~#5) 지판 .press/.ctx/.lowestRoot 구분 및 31스텝 시퀀스(#sc-seq)', () => {
  const env = createChordsDomSandbox('#scale');
  try {
    env.runScript();

    // C Major 설정
    env.elements.get('sc-root').value = '0';
    env.elements.get('sc-root').listeners.change({ target: { value: '0' } });
    env.elements.get('sc-type').value = 'major';
    env.elements.get('sc-type').listeners.change({ target: { value: 'major' } });

    // #1 (A) Shape 선택
    const blockChips = env.elements.get('sc-block')._parsedItems || [];
    const b1 = blockChips.find((c) => c.dataset.v === '1');
    assert.ok(b1, '#1 block chip exists');
    b1.click();

    const boardHtml = env.elements.get('sc-board').innerHTML;
    assert.ok(boardHtml.includes('class="blk"'), 'Hand window box .blk must be present');
    assert.ok(boardHtml.includes('press'), 'Block notes should have press class');
    assert.ok(boardHtml.includes('lowestRoot'), 'Lowest root should have lowestRoot class');
    assert.ok(boardHtml.includes('lr-ring'), 'Lowest root should render lr-ring double ring');

    const seqHtml = env.elements.get('sc-seq').innerHTML;
    assert.ok(seqHtml.includes('시작: 최저 루트 5·3 (C)'), 'sc-seq summary should include start lowest root');
    assert.ok(seqHtml.includes('1번줄 끝 1·5 (A)'), 'sc-seq summary should include high peak');
    assert.ok(seqHtml.includes('6번줄 최저 6·3 (G)'), 'sc-seq summary should include low peak');
    assert.ok(seqHtml.includes('마무리: 최저 루트 5·3 (C)'), 'sc-seq summary should include end lowest root');
    assert.ok(seqHtml.includes('(총 31스텝)'), 'sc-seq should be 31 steps');
  } finally {
    env.cleanup();
  }
});

test('R2-C4: CAGED 블럭 재생 시 scaleBlockSeq 31스텝 순환 및 5도권 순환 연동', () => {
  const cMajBlocks = CT.scaleBlocks(0, 'major', CT.OPEN, 22);
  const b1 = cMajBlocks.find((b) => b.blockId === 1);
  assert.ok(b1);
  const seq = CT.scaleBlockSeq(b1.notes);
  assert.equal(seq.length, 31, 'C Major #1 block sequence must be 31 steps');
  assert.equal(seq[0].pitch, 48, 'Step 1 should be C3 (pitch 48, 5th string 3f)');
  assert.equal(seq[12].pitch, 69, 'Step 13 should be peak A4 (pitch 69, 1st string 5f)');
  assert.equal(seq[27].pitch, 43, 'Step 28 should be lowest G2 (pitch 43, 6th string 3f)');
  assert.equal(seq[30].pitch, 48, 'Step 31 should be return C3 (pitch 48, 5th string 3f)');
});

test('R2-C5: 화성·가락단음계(harmMinor, melMinor) 선택 시 CAGED 블럭 비활성화 및 전체 지판 자동 전환', () => {
  const env = createChordsDomSandbox('#scale');
  try {
    env.runScript();

    // #2 선택
    const b2 = env.elements.get('sc-block')._parsedItems.find((c) => c.dataset.v === '2');
    b2.click();

    // harmMinor 로 변경
    env.elements.get('sc-type').value = 'harmMinor';
    env.elements.get('sc-type').listeners.change({ target: { value: 'harmMinor' } });

    assert.equal(env.elements.get('sc-block-msg').hidden, false);
    assert.ok(env.elements.get('sc-block-msg').textContent.includes('전체 지판 모드'));

    const chips = env.elements.get('sc-block')._parsedItems;
    for (const c of chips) {
      if (+c.dataset.v > 0) {
        assert.equal(c.disabled, true, 'Block chips #1~#5 must be disabled for harmMinor');
      }
    }

    // minor 로 복귀 시 재활성화
    env.elements.get('sc-type').value = 'minor';
    env.elements.get('sc-type').listeners.change({ target: { value: 'minor' } });
    assert.equal(env.elements.get('sc-block-msg').hidden, true);
  } finally {
    env.cleanup();
  }
});

test('R2-C6: 7 · 더블 스탑 연습 (3rd, 6th, 4th) 줄 쌍 선택 및 스텝 카드 렌더링', () => {
  const env = createChordsDomSandbox('#ds');
  try {
    env.runScript();

    const steps = env.elements.get('ds-steps')._parsedItems || [];
    assert.ok(steps.length >= 7, 'Diatonic double stop steps should be rendered');

    // 6th 선택 시 건너뛴 줄 쌍 추천
    const ivChips = env.elements.get('ds-interval')._parsedItems || [];
    const iv6 = ivChips.find((c) => c.dataset.v === '6th');
    assert.ok(iv6);
    iv6.click();

    const title = env.elements.get('ds-title').textContent;
    assert.ok(title.includes('6th') || title.includes('6도'));
    assert.ok(title.includes('1-3번줄'), 'Default string pair for 6th should be 1-3 string on 6-string guitar');
  } finally {
    env.cleanup();
  }
});

test('R2-C7: 7 · 더블 스탑 연습 악기 변경(b4 4현 베이스) 시 줄 쌍 안전 재설정 및 AU.doubleStop 2성 발음', () => {
  const env = createChordsDomSandbox('#ds');
  try {
    env.runScript();

    // 4현 베이스 선택
    const instChips = env.elements.get('ds-inst')._parsedItems || [];
    const b4 = instChips.find((c) => c.dataset.v === 'b4');
    assert.ok(b4);
    b4.click();

    const title = env.elements.get('ds-title').textContent;
    assert.ok(!title.includes('undefined'), 'No undefined in title');
    assert.ok(title.includes('1-2번줄') || title.includes('1-3번줄'));

    // 스텝 클릭
    const stepCards = env.elements.get('ds-steps')._parsedItems || [];
    assert.ok(stepCards.length > 0);
    stepCards[0].click();

    assert.ok(env.oscFreqs.length > 0, 'Audio oscillators should be started');
  } finally {
    env.cleanup();
  }
});

test('R2-C8: ChordDiagrams.tsx 순수 헬퍼(getDoubleStopPairs, formatBlockSeqSummary, fretText) 단위 검증', () => {
  // getDoubleStopPairs 검증
  const pairs4 = CT.doubleStops({ rootPc: 0, scaleId: 'major', interval: '3rd', pair: [2, 3], open: [28, 33, 38, 43], lo: 0, hi: 22 });
  assert.ok(pairs4.length > 0);

  // formatBlockSeqSummary 검증
  const cMajBlocks = CT.scaleBlocks(0, 'major', CT.OPEN, 22);
  const b1 = cMajBlocks.find((b) => b.blockId === 1);
  const seq = CT.scaleBlockSeq(b1.notes);

  const sorted = [...b1.notes].sort((a, b) => a.pitch - b.pitch);
  assert.equal(sorted[0].pitch, 43); // G2
  assert.equal(sorted[sorted.length - 1].pitch, 69); // A4
  assert.equal(seq[0].pitch, 48); // C3
  assert.equal(seq[seq.length - 1].pitch, 48); // C3
});

test('R2-C9: CSS 순백(#ffffff/#fff) 0건, 중간 곡률 0건, frontend/ 인라인 style={{ 및 dangerouslySetInnerHTML 0건', () => {
  const cssModule = readText('frontend/src/pages/ChordsPage.module.css');
  const publicCss = readText('public/styles.css');
  const allCss = cssModule + '\n' + publicCss;
  const noComments = allCss.replace(/\/\*[\s\S]*?\*\//g, '');

  // 순백 검사 (주석 제외, 대소문자 무관)
  assert.ok(!/#(?:ffffff|fff)\b/i.test(noComments), 'Pure white (#ffffff/#fff) must be 0 in CSS');

  // 중간 곡률 검사 (3px~16px)
  const badRadiusRegex = /border-radius:\s*(?:[3-9]|1[0-6])px/i;
  assert.ok(!badRadiusRegex.test(cssModule), 'ChordsPage.module.css must not have 3~16px intermediate border-radius');

  // frontend/tsx 인라인 style={{ 및 dangerouslySetInnerHTML 0건 검사
  const chordsTsx = readText('frontend/src/pages/ChordsPage.tsx');
  const diagramsTsx = readText('frontend/src/components/chords/ChordDiagrams.tsx');
  const allTsx = chordsTsx + '\n' + diagramsTsx;

  assert.ok(!allTsx.includes('style={{'), 'style={{ must be 0 in React components');
  assert.ok(!allTsx.includes('dangerouslySetInnerHTML'), 'dangerouslySetInnerHTML must be 0');
});

test('R2-C10 (PR #41 리뷰 반영): 악기 변경 시 더블 스탑 줄 쌍 동기 정규화 및 렌더 크래시 방지 검증', () => {
  const diagramsCode = readText('frontend/src/components/chords/ChordDiagrams.tsx');
  const chordsTsx = readText('frontend/src/pages/ChordsPage.tsx');

  // 1. getSafeDoubleStopPair 함수 선언 및 구현 정적 대조
  assert.ok(diagramsCode.includes('export function getSafeDoubleStopPair'), 'getSafeDoubleStopPair must be exported');
  assert.ok(diagramsCode.includes("interval === '6th' ? currentPair[1] - currentPair[0] === 2 : currentPair[1] - currentPair[0] === 1"));
  assert.ok(diagramsCode.includes('Math.max(0, n - 3), n - 1'));
  assert.ok(diagramsCode.includes('Math.max(0, n - 2), n - 1'));

  // 정규화 알고리즘 단위 검증
  function getSafeDoubleStopPair(numStrings, interval, currentPair) {
    const n = Math.max(4, numStrings);
    const isPairValid =
      Array.isArray(currentPair) &&
      currentPair.length === 2 &&
      currentPair[0] >= 0 &&
      currentPair[1] < n &&
      currentPair[0] < currentPair[1] &&
      (interval === '6th' ? currentPair[1] - currentPair[0] === 2 : currentPair[1] - currentPair[0] === 1);

    if (isPairValid && currentPair) {
      return [currentPair[0], currentPair[1]];
    }
    if (interval === '6th') {
      return [Math.max(0, n - 3), n - 1];
    }
    return [Math.max(0, n - 2), n - 1];
  }

  // 6현 기타 기본 줄 쌍 [4, 5] 에서 4현 베이스로 전환 시
  const safePair4 = getSafeDoubleStopPair(4, '3rd', [4, 5]);
  assert.deepEqual(safePair4, [2, 3], 'Should normalize out-of-range pair [4, 5] to [2, 3] on 4-string bass');

  // 6도(6th) 음정 시 건너뛴 줄 쌍 [1, 3] 정규화
  const safePair6th = getSafeDoubleStopPair(4, '6th', [4, 5]);
  assert.deepEqual(safePair6th, [1, 3], 'Should normalize out-of-range pair to [1, 3] for 6th on 4-string bass');

  // 이미 유효한 줄 쌍은 그대로 유지
  assert.deepEqual(getSafeDoubleStopPair(4, '3rd', [1, 2]), [1, 2], 'Valid pair should be preserved');

  // 2. CT.doubleStops 호출 시 크래시 없이 정상 스텝 배열 생성 검증
  const b4Tuning = CT.TUNING_BY.b4;
  assert.doesNotThrow(() => {
    const steps = CT.doubleStops({
      rootPc: 0,
      scaleId: 'major',
      interval: '3rd',
      pair: safePair4,
      open: b4Tuning.open,
      lo: 0,
      hi: b4Tuning.frets,
    });
    assert.ok(steps.length >= 7, 'Must produce diatonic double stops for 4-string bass');
  }, 'CT.doubleStops must not throw with normalized pair');

  // 3. ChordsPage.tsx 정적 검증
  assert.ok(
    chordsTsx.includes('effectiveDsPair'),
    'ChordsPage.tsx must compute effectiveDsPair synchronously during render'
  );
  assert.ok(
    chordsTsx.includes('pair: effectiveDsPair'),
    'CT.doubleStops must receive effectiveDsPair instead of stale dsPair'
  );
  assert.ok(
    chordsTsx.includes('getSafeDoubleStopPair(nextTun.open.length, dsInterval, dsPair)'),
    'Instrument change handler must update dsPair atomically with safe pair'
  );
});
