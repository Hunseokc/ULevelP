// CH-7c: 진행 연주 링크의 원본 노트 id(n=) + 취향 통계 줄로 목록 거르기(hasSequence)
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let M; // model.mts
let T; // stats.mts
before(async () => {
  M = await import('../frontend/src/components/progressions/model.mts');
  T = await import('../frontend/src/lib/chords/stats.mts');
});

const NOTE = '00000000-0000-4000-8000-0000000000aa';
const ch = (pairs) => pairs.map(([symbol, roman]) => ({ symbol, roman: roman || '' }));

describe('CH-7c-1 n= 원본 노트', () => {
  test('노트에서 온 진행은 n=<노트 id>, 왕복', () => {
    const p = { id: 'p1', title: '네오소울', key: 'F Major', chords: ch([['FM9', 'IM9'], ['Dm9', 'vim9']]), noteId: NOTE };
    const href = M.playHref(p);
    assert.ok(href.includes('&n=' + NOTE));
    const back = M.parseProgHash(href.slice('chords.html'.length));
    assert.equal(back.note, NOTE);
    assert.equal(back.from, 'p1');
  });
  test('노트 없는 진행·시드는 n 없음', () => {
    assert.ok(!M.playHref({ id: 'ref-seed-1', chords: ch([['C']]) }).includes('n='));
    assert.ok(!M.playHref({ id: 'x', chords: ch([['C']]), noteId: null }).includes('n='));
  });
  test('잘못된 n은 버림(UUID만)', () => {
    assert.equal(M.parseProgHash('#prog?c=C&n=' + encodeURIComponent('"><script>')).note, '');
    assert.equal(M.parseProgHash('#prog?c=C&n=123').note, '');
    assert.ok(!M.playHref({ chords: ch([['C']]), noteId: 'not-a-uuid' }).includes('n='));
  });
  test('진행 연주 탭이 n으로 원본 노트 링크', () => {
    const src = read('frontend/src/components/chords/ProgressionPlayTab.tsx');
    assert.ok(src.includes('id="pp-note-link"'));
    assert.ok(src.includes('note.html?id=${encodeURIComponent(prog.note)}'));
  });
});

describe('CH-7c-2 hasSequence', () => {
  const p = { id: 'a', chords: ch([['C', 'I'], ['G', 'V'], ['Am', 'vi'], ['F', 'IV'], ['Dm7', '']]) };
  test('묶음·이동이 이어서 들어 있으면 true', () => {
    assert.equal(T.hasSequence(p, 'I - V - vi'), true);
    assert.equal(T.hasSequence(p, 'V - vi - IV'), true);
    assert.equal(T.hasSequence(p, 'I → V'), true);
    assert.equal(T.hasSequence(p, 'IV → Dm7'), true, 'roman 없으면 심볼');
  });
  test('떨어져 있거나 순서가 다르면 false, 잘못된 입력도 false', () => {
    assert.equal(T.hasSequence(p, 'I - vi'), false);
    assert.equal(T.hasSequence(p, 'V → I'), false);
    assert.equal(T.hasSequence(p, ''), false);
    assert.equal(T.hasSequence(null, 'I → V'), false);
    assert.equal(T.hasSequence({ id: 'b' }, 'I → V'), false);
  });
  test('tasteStats의 줄 이름을 그대로 넣으면 그 줄을 센 진행이 걸린다', () => {
    const list = [
      p,
      { id: 'b', key: 'G Major', chords: ch([['G', 'I'], ['D', 'V'], ['Em', 'vi'], ['C', 'IV']]) },
      { id: 'c', chords: ch([['Dm7', 'iim7'], ['G7', 'V7']]) },
    ];
    const s = T.tasteStats(list);
    for (const row of [...s.patterns, ...s.moves]) {
      const n = list.filter((x) => T.hasSequence(x, row.label)).length;
      assert.equal(n, s.patterns.includes(row) ? row.count : n, row.label);
      assert.ok(n >= 1, row.label);
    }
    assert.deepEqual(list.filter((x) => T.hasSequence(x, 'I - V - vi - IV')).map((x) => x.id), ['a', 'b']);
  });
  test('CHORDS 페이지가 필터를 목록에 적용', () => {
    const page = read('frontend/src/pages/ProgressionsPage.tsx');
    assert.ok(page.includes('hasSequence(p, tasteFilter)'));
    assert.ok(page.includes('id="progTasteFilter"') && page.includes('id="progTasteFilterClear"'));
  });
});
