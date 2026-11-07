// CH-5b: 연습실 연동 순수 함수(model.mts — #prog? 파싱·돌아오기·조옮김·목록 검색·정렬) + 진행 연주 탭 연결 + 정석 폼 경로
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let M; // model.mts
let S; // symbol.mts
let PATH; // progressionPath.mjs
let SH; // chordShapes.mjs

before(async () => {
  M = await import('../frontend/src/components/progressions/model.mts');
  S = await import('../frontend/src/lib/chords/symbol.mts');
  PATH = await import('../frontend/src/lib/engine/progressionPath.mjs');
  SH = await import('../frontend/src/lib/engine/chordShapes.mjs');
});

describe('CH-5b-1 #prog? 해시', () => {
  test('playHref → parseProgHash 왕복 (쉼표·공백·한글 제목)', () => {
    const p = { id: '11111111-1111-4111-8111-111111111111', title: 'Just the Two of Us, 후렴', key: 'F Major', chords: [{ symbol: 'FM7', roman: '' }, { symbol: 'E7', roman: '' }, { symbol: 'G7/B', roman: '' }] };
    const href = M.playHref(p);
    assert.ok(href.startsWith('chords.html#prog?'));
    const back = M.parseProgHash(href.slice('chords.html'.length));
    assert.deepEqual(back, { chords: ['FM7', 'E7', 'G7/B'], key: 'F Major', title: 'Just the Two of Us, 후렴', from: p.id, note: '' });
  });

  test('시드 id(ref-seed-2)도 from으로 받는다', () => {
    assert.equal(M.parseProgHash('#prog?c=C&from=ref-seed-2').from, 'ref-seed-2');
  });

  test('isProgHash: #prog · #prog?… 만 (기존 탭 해시는 아님)', () => {
    for (const h of ['#prog', '#prog?c=C', 'prog?c=C']) assert.equal(M.isProgHash(h), true, h);
    for (const h of ['', '#matrix', '#progress', '#prog-x', '#tf']) assert.equal(M.isProgHash(h), false, h);
  });

  test('#prog만 오면 빈 진행', () => {
    assert.deepEqual(M.parseProgHash('#prog'), { chords: [], key: '', title: '', from: '', note: '' });
  });

  test('잘못된 입력: 모르는 키·위험한 from·빈 코드 조각은 버린다, 코드 64개·제목 300자까지', () => {
    const many = Array.from({ length: 80 }, () => 'C').join(',');
    const r = M.parseProgHash(`#prog?c=${many},,%20,Am&k=F&from=${encodeURIComponent('"><script>')}&t=${'가'.repeat(400)}`);
    assert.equal(r.chords.length, 64);
    assert.equal(r.key, '', '노션 Scale 24개 표기가 아니면 버림 (k=F)');
    assert.equal(r.from, '');
    assert.equal(r.title.length, 300);
    assert.equal(M.parseProgHash('#matrix'), null);
    assert.equal(M.parseProgHash(null), null);
  });
});

describe('CH-5b-2 돌아오기 링크', () => {
  test('from이 있으면 합산 범위 + 그 행, 없거나 이상하면 목록', () => {
    assert.equal(M.backHref('11111111-1111-4111-8111-111111111111'), 'progressions.html?scope=all#p-11111111-1111-4111-8111-111111111111');
    assert.equal(M.backHref('ref-seed-1'), 'progressions.html?scope=all#p-ref-seed-1');
    assert.equal(M.backHref(''), 'progressions.html');
    assert.equal(M.backHref('a b'), 'progressions.html');
  });

  test('진행 페이지가 시드 id 해시도 펼친다(#p-ref-seed-1)', () => {
    const src = read('frontend/src/pages/ProgressionsPage.tsx');
    assert.ok(src.includes('/^#p-([A-Za-z0-9_-]{1,64})$/'), 'initialFocusId가 시드 id를 받아야 한다');
  });
});

describe('CH-5b-3 키 옮기기', () => {
  test('transposeKey: 노션 Scale 표기로', () => {
    assert.equal(M.transposeKey('F Major', 2), 'G Major');
    assert.equal(M.transposeKey('A min', 3), 'C min');
    assert.equal(M.transposeKey('C Major', -1), 'B Major');
    assert.equal(M.transposeKey('C Major', 1), 'Db Major');
    assert.equal(M.transposeKey('', 2), '');
    assert.equal(M.transposeKey('F', 2), '');
  });

  test('transposeSymbol: 근음·슬래시 베이스만 바꾸고 표기는 그대로, 철자는 옮긴 키를 따름', () => {
    assert.equal(M.transposeSymbol('FM7', 2, 'G Major'), 'GM7');
    assert.equal(M.transposeSymbol('Bbmaj7#11', 2, 'C Major'), 'Cmaj7#11');
    assert.equal(M.transposeSymbol('G7/B', 2, 'A Major'), 'A7/C#');
    assert.equal(M.transposeSymbol('G7/B', 1, 'Ab Major'), 'Ab7/C');
    assert.equal(M.transposeSymbol('C6/9', 1, ''), 'Db6/9', '6/9는 슬래시 코드가 아님');
    assert.equal(M.transposeSymbol('Am7', 0, ''), 'Am7');
    assert.equal(M.transposeSymbol('Am7', 12, ''), 'Am7');
  });

  test('옮긴 코드도 같은 퀄리티로 읽히고, 로마숫자는 옮긴 키에서 원래와 같다', async () => {
    const R = await import('../frontend/src/lib/chords/roman.mts');
    const src = ['FM9', 'E7b9', 'Am9', 'C13', 'G7/B', 'Bbm6'];
    for (const n of [-5, -1, 1, 3, 6]) {
      const key = M.transposeKey('A min', n);
      const moved = src.map((s) => M.transposeSymbol(s, n, key));
      moved.forEach((m, i) => {
        const a = S.parseChord(src[i]);
        const b = S.parseChord(m);
        assert.ok(b.ok, m);
        assert.equal(b.quality, a.quality, m);
        assert.equal(b.root, (a.root + n + 120) % 12, m);
      });
      assert.deepEqual(R.romanize(moved, key), R.romanize(src, 'A min'), `n=${n}`);
    }
  });

  test('잘못된 입력: 못 읽는 코드는 그대로', () => {
    assert.equal(M.transposeSymbol('H7', 2, ''), 'H7');
    assert.equal(M.transposeSymbol('N.C.', 2, ''), 'N.C.');
    assert.equal(M.transposeSymbol('', 2, ''), '');
  });
});

describe('CH-5b-4 목록 검색·정렬', () => {
  const list = [
    { id: 'a', title: 'Neo-Soul Minor Plagal', artist: '', channel: '', key: 'C Major' },
    { id: 'b', title: '봄날', artist: 'BTS', channel: '', key: 'Db Major' },
    { id: 'c', title: 'Autumn Leaves', artist: '', channel: '채널A', key: null },
    { id: 'd', title: '', artist: '', channel: '', key: 'A min' },
    { id: 'e', title: 'Just the Two of Us', artist: 'Grover Washington Jr.', channel: '', key: 'C Major' },
  ];
  const ids = (xs) => xs.map((x) => x.id).join('');

  test('검색: 곡명·아티스트·채널·키, 대소문자·공백 무시, 빈 검색어는 전부', () => {
    assert.equal(ids(M.searchProgressions(list, 'autumn')), 'c');
    assert.equal(ids(M.searchProgressions(list, 'bts')), 'b');
    assert.equal(ids(M.searchProgressions(list, '채널')), 'c');
    assert.equal(ids(M.searchProgressions(list, 'cmajor')), 'ae');
    assert.equal(ids(M.searchProgressions(list, ' A MIN ')), 'd');
    assert.equal(ids(M.searchProgressions(list, '')), 'abcde');
    assert.equal(ids(M.searchProgressions(list, '없는곡')), '');
  });

  test('정렬: 최근(받은 순서)·곡명(제목 없는 행 뒤)·키(Scale 순서, 키 없음 뒤, 같은 키는 곡명)', () => {
    assert.equal(ids(M.sortProgressions(list, 'recent')), 'abcde');
    assert.equal(ids(M.sortProgressions(list, 'title')), 'bcead', 'ko 정렬: 한글 → 영문, 제목 없는 행 마지막');
    assert.equal(ids(M.sortProgressions(list, 'key')), 'eabdc');
    assert.equal(ids(list), 'abcde', '원본 배열은 그대로');
  });
});

describe('CH-5b-5 진행 연주 탭 연결', () => {
  test('ChordsPage: 8번째 탭 prog, #prog? 해시로 열고 탭을 오가도 진행을 유지', () => {
    const src = read('frontend/src/pages/ChordsPage.tsx');
    assert.ok(src.includes("{ id: 'prog', label: '8 · 진행 연주' }"));
    assert.ok(src.includes('<ProgressionPlayTab'));
    assert.ok(src.includes('id="pane-prog"'));
    assert.ok(/tabId === 'prog' && progHash \? progHash/.test(src));
    for (const t of ['scale', 'tone', 'matrix', 'circle', 'reint', 'tf', 'ds']) assert.ok(src.includes(`id="pane-${t}"`), t);
  });

  test('탭 코드가 shapes standard + 표(loadChordForms)를 넘긴다 (CH-2c-2 사용자 결정)', () => {
    const src = read('frontend/src/components/chords/ProgressionPlayTab.tsx');
    assert.ok(src.includes("shapes: 'standard'"));
    assert.ok(src.includes('loadChordForms()'));
  });

  test('홈 연습 모드 목록은 7개 그대로(진행 연주 입구는 CH-6 취향 카드)', () => {
    const src = read('frontend/src/lib/progressions.ts');
    assert.ok(!src.includes("['prog'"));
  });

  test('시드 10개 전부: 표 + standard로 경로가 나온다(0~12프렛, loop)', () => {
    const table = SH.withReview(
      JSON.parse(read('frontend/src/lib/engine/chordForms.json')),
      JSON.parse(read('frontend/src/lib/engine/chordFormReview.json'))
    );
    const seeds = read('frontend/src/lib/progressions.ts').match(/chordsText: '([^']+)'/g).map((m) => m.slice(13, -1));
    assert.equal(seeds.length, 10);
    for (const text of seeds) {
      const chords = M.splitChordInput(text).map((s) => S.parseChord(s)).filter((c) => c.ok);
      const paths = PATH.bestPaths(chords, { shapes: 'standard', formTable: table, loop: true, lo: 0, hi: 12 });
      const both = paths.length ? paths : PATH.bestPaths(chords, { shapes: 'both', formTable: table, loop: true, lo: 0, hi: 12 });
      assert.ok(both.length > 0, text);
      assert.equal(both[0].voicings.length, chords.length, text);
    }
  });
});
