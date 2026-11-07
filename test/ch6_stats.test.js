// CH-6: 취향 코드 진행 통계·랜덤(frontend/src/lib/chords/stats.mts) + CHORDS·홈 연결
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let T; // stats.mts
let M; // model.mts

before(async () => {
  T = await import('../frontend/src/lib/chords/stats.mts');
  M = await import('../frontend/src/components/progressions/model.mts');
});

const ch = (pairs) => pairs.map(([symbol, roman]) => ({ symbol, roman: roman || '' }));
const prog = (id, pairs, over = {}) => ({ id, key: 'C Major', chords: ch(pairs), moods: [], genres: [], ...over });

describe('CH-6-1 tasteStats 빈도', () => {
  test('코드 빈도·로마숫자 빈도·키 분포·Mood·Genre', () => {
    const s = T.tasteStats([
      prog('a', [['C', 'I'], ['G', 'V'], ['Am', 'vi'], ['F', 'IV']], { moods: ['밝음', '밝음'], genres: ['팝'] }),
      prog('b', [['G', 'I'], ['D', 'V'], ['Em', 'vi'], ['C', 'IV']], { key: 'G Major', moods: ['밝음'], genres: ['팝', '록'] }),
      prog('c', [['Dm7', ''], ['G7', '']], { key: null }),
    ]);
    assert.equal(s.total, 3);
    assert.equal(s.chordTotal, 10);
    assert.deepEqual(s.chords.slice(0, 2), [
      { label: 'C', count: 2 },
      { label: 'G', count: 2 },
    ]);
    assert.deepEqual(s.romans.slice(0, 4).map((x) => [x.label, x.count]), [
      ['I', 2],
      ['V', 2],
      ['vi', 2],
      ['IV', 2],
    ]);
    assert.ok(!s.romans.some((x) => x.label === ''), '빈 로마숫자는 안 센다');
    assert.deepEqual(s.keys, [
      { label: 'C Major', count: 1 },
      { label: 'G Major', count: 1 },
    ]);
    assert.deepEqual(s.moods, [{ label: '밝음', count: 2 }], '한 진행 안 중복 Mood는 1번');
    assert.deepEqual(s.genres, [
      { label: '팝', count: 2 },
      { label: '록', count: 1 },
    ]);
  });

  test('코드 이동은 로마숫자 우선(키가 달라도 같은 기능), 없으면 심볼, 같은 코드 반복은 뺌', () => {
    const s = T.tasteStats([
      prog('a', [['CM7', 'IM7'], ['Am7', 'vim7'], ['Am7', 'vim7'], ['Dm7', 'iim7']]),
      prog('b', [['FM7', 'IM7'], ['Dm7', 'vim7']], { key: 'F Major' }),
      prog('c', [['Dm7', ''], ['G7', '']], { key: null }),
    ]);
    assert.deepEqual(s.moves[0], { label: 'IM7 → vim7', count: 2 });
    assert.ok(s.moves.some((m) => m.label === 'Dm7 → G7'));
    assert.ok(!s.moves.some((m) => m.label === 'vim7 → vim7'));
    assert.equal(s.moves.length, 3);
  });
});

describe('CH-6-2 자주 나오는 진행', () => {
  test('2곡 이상에 나온 3~4코드 묶음, 4코드에 포함되고 횟수가 같은 3코드는 뺌', () => {
    const s = T.tasteStats([
      prog('a', [['C', 'I'], ['G', 'V'], ['Am', 'vi'], ['F', 'IV']]),
      prog('b', [['G', 'I'], ['D', 'V'], ['Em', 'vi'], ['C', 'IV'], ['G', 'I'], ['D', 'V'], ['Em', 'vi'], ['C', 'IV']], { key: 'G Major' }),
      prog('c', [['F', 'I'], ['C', 'V'], ['Dm', 'vi'], ['Gm', 'ii']], { key: 'F Major' }),
    ]);
    // I-V-vi-IV: a·b(한 곡 안 반복은 1번) = 2. I-V-vi: a·b·c = 3 → 4코드와 횟수가 달라 남음
    assert.deepEqual(s.patterns[0], { label: 'I - V - vi', count: 3 });
    assert.ok(s.patterns.some((p) => p.label === 'I - V - vi - IV' && p.count === 2));
    assert.ok(!s.patterns.some((p) => p.label === 'V - vi - IV'), '4코드와 같은 횟수인 3코드는 빠짐');
    assert.ok(s.patterns.every((p) => p.count >= 2));
  });

  test('한 곡뿐이면 자주 나오는 진행 없음, 빈 목록·깨진 행도 안전', () => {
    assert.deepEqual(T.tasteStats([prog('a', [['C', 'I'], ['G', 'V'], ['Am', 'vi']])]).patterns, []);
    const empty = T.tasteStats([]);
    assert.equal(empty.total, 0);
    assert.deepEqual(empty.chords, []);
    const broken = T.tasteStats([null, { id: 'x' }, { id: 'y', chords: [{ symbol: '  ', roman: '' }, null] }]);
    assert.equal(broken.total, 1);
    assert.equal(broken.chordTotal, 0);
  });
});

describe('CH-6-3 pickRandom', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  test('지금 진행과 다른 것을 고른다', () => {
    for (const cur of ['a', 'b', 'c']) {
      for (const r of [0, 0.3, 0.6, 0.999]) {
        const p = T.pickRandom(list, cur, () => r);
        assert.notEqual(p.id, cur);
      }
    }
    // 모든 후보가 나올 수 있다
    const got = new Set([0, 0.5, 0.99].map((r) => T.pickRandom(list, null, () => r).id));
    assert.deepEqual([...got].sort(), ['a', 'b', 'c']);
  });
  test('1개면 그것, 비면 null, rand가 범위 밖이어도 안전', () => {
    assert.equal(T.pickRandom([{ id: 'a' }], 'a', () => 0.5).id, 'a');
    assert.equal(T.pickRandom([], null), null);
    assert.equal(T.pickRandom(list, 'zz', () => 1).id, 'c');
    assert.equal(T.pickRandom(list, null, () => -1).id, 'a');
  });
});

describe('CH-6-4 시드·연결', () => {
  test('기본 시드 10개로 통계가 나오고 연주하기 링크가 진행 연주 탭을 연다', () => {
    const src = read('frontend/src/lib/progressions.ts');
    // 시드 표기를 그대로 seedToDto로(시드 데이터는 progressions.ts가 원본)
    const seeds = [];
    for (const m of src.matchAll(/id: '([a-z]+-seed-\d)',\s*category: '(\w+)',\s*chordsText: '([^']+)',\s*title: '([^']+)',\s*keyLabel: '([^']+)'/g)) {
      seeds.push(M.seedToDto({ id: m[1], category: m[2], chordsText: m[3], title: m[4], keyLabel: m[5] }));
    }
    assert.equal(seeds.length, 10);
    const s = T.tasteStats(seeds);
    assert.equal(s.total, 10);
    assert.ok(s.chordTotal >= 40);
    assert.ok(s.keys.length > 0 && s.moves.length > 0);
    const href = M.playHref(seeds[0]);
    assert.ok(href.startsWith('chords.html#prog?c='));
    assert.ok(href.includes('from=ref-seed-1'));
  });

  test('CHORDS #progTaste에 TastePanel, 홈은 stats.mts·playHref', () => {
    const page = read('frontend/src/pages/ProgressionsPage.tsx');
    assert.ok(page.includes('<TastePanel'));
    assert.ok(!page.includes('TODO(stub): CH-6'));
    const panel = read('frontend/src/components/progressions/TastePanel.tsx');
    for (const id of ['tastePick', 'tasteRand', 'tastePlay', 'tastePatterns', 'tasteMoves', 'tasteChords', 'tasteKeys']) {
      assert.ok(panel.includes(`id="${id}"`), `TastePanel 누락 ID: ${id}`);
    }
  });
});
