// CH-2: 코드 심볼 파서 · 로마숫자 · 키 추정 · 붙여넣기 파서 (frontend/src/lib/chords/*.mts)
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let S; // symbol.mts
let R; // roman.mts
let K; // keyGuess.mts
let P; // pasteParse.mts

before(async () => {
  S = await import('../frontend/src/lib/chords/symbol.mts');
  R = await import('../frontend/src/lib/chords/roman.mts');
  K = await import('../frontend/src/lib/chords/keyGuess.mts');
  P = await import('../frontend/src/lib/chords/pasteParse.mts');
});

const q = (text) => {
  const c = S.parseChord(text);
  assert.equal(c.ok, true, `${text}: ${c.reason}`);
  return c.quality;
};

describe('CH-2-1: parseChord 별칭 → 정규 퀄리티 (설계 §5-2 표)', () => {
  const cases = {
    maj: ['C', 'CM', 'Cmaj'],
    m: ['Cm', 'Cmin', 'C-'],
    dim: ['Cdim', 'Co', 'C°'],
    aug: ['Caug', 'C+', 'C(#5)'],
    sus2: ['Csus2'],
    sus4: ['Csus', 'Csus4'],
    add9: ['Cadd9', 'C(add9)', 'Cadd2'],
    madd9: ['Cm(add9)', 'Cmadd9'],
    6: ['C6'],
    m6: ['Cm6'],
    69: ['C6/9', 'C69'],
    m69: ['Cm6/9', 'Cm69'],
    maj7: ['CM7', 'Cmaj7', 'CΔ', 'CΔ7', 'Cma7', 'C∆7'],
    maj9: ['CM9', 'Cmaj9'],
    maj13: ['Cmaj13'],
    maj7s11: ['Cmaj7#11', 'CM7(#11)'],
    'maj7#5': ['CM7#5'],
    m7: ['Cm7', 'C-7', 'Cmin7'],
    m9: ['Cm9'],
    m11: ['Cm11'],
    m13: ['Cm13'],
    mmaj7: ['Cm(maj7)', 'CmM7', 'Cm∆7', 'CmMaj7'],
    m7b5: ['Cm7b5', 'Cø', 'Cø7', 'C-7b5', 'Cm7(b5)'],
    dim7: ['Cdim7', 'Co7', 'C°7'],
    7: ['C7'],
    9: ['C9'],
    13: ['C13'],
    '7sus4': ['C7sus4', 'C7sus'],
    '9sus4': ['C9sus4'],
    '13sus4': ['C13sus'],
    '7b5': ['C7b5'],
    '7#5': ['C7#5', 'C7+5', 'Caug7', 'C+7'],
    '7b9': ['C7b9', 'C7(b9)'],
    '7#9': ['C7#9'],
    '7#11': ['C7#11'],
    '7b13': ['C7b13'],
    '13b9': ['C13b9'],
    '7#5#9': ['C7#5#9'],
    '7b9b13': ['C7(b9,b13)', 'C7(b9, b13)', 'C7b9b13'],
    '7alt': ['C7alt'],
  };
  for (const [quality, texts] of Object.entries(cases)) {
    test(`${quality} ← ${texts.join(' ')}`, () => {
      for (const t of texts) assert.equal(q(t), quality, t);
    });
  }

  test('도수: 엔진 CH 표와 같은 이름·순서', () => {
    const deg = (t) => S.parseChord(t).degrees;
    assert.deepEqual(deg('Cmaj7'), ['R', '3', '5', '7']);
    assert.deepEqual(deg('Cm11'), ['R', 'b3', '5', 'b7', '11']);
    assert.deepEqual(deg('C13'), ['R', '3', '5', 'b7', '13']);
    assert.deepEqual(deg('CM7(#11)'), ['R', '3', '5', '7', '#11']);
    assert.deepEqual(deg('C7sus4'), ['R', '4', '5', 'b7']);
    assert.deepEqual(deg('Cø'), ['R', 'b3', 'b5', 'b7']);
    assert.deepEqual(deg('Cdim7'), ['R', 'b3', 'b5', 'bb7']);
    assert.deepEqual(deg('C6/9'), ['R', '3', '5', '6', '9']);
    assert.deepEqual(deg('Cadd9'), ['R', '3', '5', '9']);
    assert.deepEqual(deg('Csus2'), ['R', '2', '5']);
    assert.deepEqual(deg('C7(b9,b13)'), ['R', '3', '5', 'b7', 'b9', 'b13']);
    assert.deepEqual(deg('C7alt'), ['R', '3', '#5', 'b7', 'b9', '#9']); // 5도 생략
    assert.deepEqual(deg('C11'), ['R', '5', 'b7', '9', '11']); // 도미넌트 11은 3도 생략
  });

  test('BASE_QUALITIES 전부: 도수가 DEGREE_SEMITONES 안에 있다', () => {
    for (const name of S.BASE_QUALITIES) {
      const text = name === 'maj' ? 'C' : 'C' + name.replace('maj7s11', 'maj7#11');
      const c = S.parseChord(text);
      assert.equal(c.ok, true, text);
      assert.equal(c.quality, name, text);
      for (const d of c.degrees) assert.ok(d in S.DEGREE_SEMITONES, `${text} ${d}`);
    }
  });
});

describe('CH-2-2: parseChord 근음·베이스', () => {
  test('근음 철자는 그대로, 계산은 피치클래스', () => {
    const bb = S.parseChord('Bbm7');
    assert.deepEqual([bb.rootName, bb.root, bb.quality], ['Bb', 10, 'm7']);
    const fs = S.parseChord('F#7');
    assert.deepEqual([fs.rootName, fs.root], ['F#', 6]);
    assert.equal(S.parseChord('A#').root, S.parseChord('Bb').root);
    assert.deepEqual([S.parseChord('B♭M7').rootName, S.parseChord('C♯m').rootName], ['Bb', 'C#']);
    assert.equal(S.parseChord('Cb').root, 11);
    assert.equal(S.parseChord('  Am7 ').raw, '  Am7 ');
  });
  test('슬래시 베이스, 6/9는 슬래시 아님', () => {
    const c = S.parseChord('C/E');
    assert.deepEqual([c.quality, c.bass, c.bassName], ['maj', 4, 'E']);
    const d = S.parseChord('Am7/G');
    assert.deepEqual([d.quality, d.bass], ['m7', 7]);
    assert.equal(S.parseChord('D/F#').bass, 6);
    assert.equal(S.parseChord('C6/9').bass, undefined);
    const e = S.parseChord('C6/9/E');
    assert.deepEqual([e.quality, e.bassName], ['69', 'E']);
  });
  test('chordPcs: 베이스 포함, 중복 없음', () => {
    assert.deepEqual(S.chordPcs(S.parseChord('C/Bb')).sort((a, b) => a - b), [0, 4, 7, 10]);
    assert.deepEqual(S.chordPcs(S.parseChord('C/E')).sort((a, b) => a - b), [0, 4, 7]);
  });
});

describe('CH-2-3: parseChord 잘못된 입력', () => {
  const bad = {
    'H7': 'bad-root',
    'h': 'bad-root',
    'am': 'bad-root',
    'Cxyz': 'unknown-suffix',
    'C/': 'bad-bass',
    'C/H': 'bad-bass',
    '': 'empty',
    '   ': 'empty',
    'N.C.': 'no-chord',
    'NC': 'no-chord',
    'C7(b9': 'bad-paren',
    'C7b9)': 'bad-paren',
    'C7()': 'bad-paren',
    'Cmsus4': 'conflict',
    'C(#11)': 'conflict',
    'Cdim9': 'conflict',
    'Cmaj7alt': 'conflict',
    'C5': 'unknown-suffix',
    'C m7': 'unknown-suffix',
  };
  for (const [text, reason] of Object.entries(bad)) {
    test(`${JSON.stringify(text)} → ${reason}`, () => {
      const c = S.parseChord(text);
      assert.equal(c.ok, false);
      assert.equal(c.reason, reason);
      assert.equal(c.raw, text);
    });
  }
  test('splitQuality', () => {
    assert.deepEqual(S.splitQuality('13b9'), { base: '13', tensions: ['b9'] });
    assert.deepEqual(S.splitQuality('m13'), { base: 'm13', tensions: [] });
    assert.deepEqual(S.splitQuality('7#5#9'), { base: '7#5', tensions: ['#9'] });
    assert.deepEqual(S.splitQuality('maj7s11'), { base: 'maj7', tensions: ['#11'] });
    assert.deepEqual(S.splitQuality('m7b5'), { base: 'm7b5', tensions: [] });
    assert.deepEqual(S.splitQuality('madd9'), { base: 'madd9', tensions: [] });
  });
});

describe('CH-2-4: 로마숫자 (설계 §5-3)', () => {
  test('KEYS = 노션 템플릿 Scale 24개', () => {
    assert.equal(R.KEYS.length, 24);
    assert.equal(new Set(R.KEYS.map((k) => JSON.stringify(R.parseKey(k)))).size, 24);
    assert.deepEqual(R.parseKey('F Major'), { tonic: 5, minor: false });
    assert.deepEqual(R.parseKey('C# min'), { tonic: 1, minor: true });
    assert.equal(R.keyName(1, false), 'Db Major');
    assert.equal(R.keyName(8, true), 'G# min');
    assert.equal(R.keyName(3, true), 'Eb min');
    assert.equal(R.parseKey('F major'), null);
    assert.equal(R.parseKey('Am'), null);
  });
  test('FM9 Dm9 Gm7 C7 @F Major → IM9 - vim9 - iim7 - V7', () => {
    assert.equal(R.romanize(['FM9', 'Dm9', 'Gm7', 'C7'], 'F Major').join(' - '), 'IM9 - vim9 - iim7 - V7');
  });
  test('마이너 키도 으뜸음 기준 같은 표', () => {
    assert.deepEqual(R.romanize(['Am7', 'FM7', 'E7', 'Am'], 'A min'), ['im7', 'bVIM7', 'V7', 'i']);
  });
  test('대소문자·접미사', () => {
    const r = (c, k = 'C Major') => R.toRoman(c, k);
    assert.equal(r('C'), 'I');
    assert.equal(r('Am'), 'vi');
    assert.equal(r('Bdim'), 'viidim');
    assert.equal(r('Bm7b5'), 'viim7b5');
    assert.equal(r('Bdim7'), 'viidim7');
    assert.equal(r('Ebaug'), 'bIIIaug');
    assert.equal(r('Gsus4'), 'Vsus4');
    assert.equal(r('G7sus4'), 'V7sus4');
    assert.equal(r('Cadd9'), 'Iadd9');
    assert.equal(r('CmM7'), 'imM7');
    assert.equal(r('CM7#5'), 'IM7#5');
    assert.equal(r('Bbmaj7'), 'bVIIM7');
    assert.equal(r('Db7'), 'bII7');
    assert.equal(r('C6/9'), 'I69');
  });
  test('텐션은 괄호', () => {
    assert.equal(R.toRoman('G7b9', 'C Major'), 'V7(b9)');
    assert.equal(R.toRoman('G7(b9,b13)', 'C Major'), 'V7(b9,b13)');
    assert.equal(R.toRoman('G13b9', 'C Major'), 'V13(b9)');
    assert.equal(R.toRoman('CM7(#11)', 'C Major'), 'IM7(#11)');
    assert.equal(R.toRoman('G7alt', 'C Major'), 'V7alt');
  });
  test('6반음: 마이너·dim 계열 #IV, 그 외 bV', () => {
    assert.equal(R.toRoman('F#m7b5', 'C Major'), '#ivm7b5');
    assert.equal(R.toRoman('F#dim7', 'C Major'), '#ivdim7');
    assert.equal(R.toRoman('Gb7', 'C Major'), 'bV7');
  });
  test('슬래시: 베이스 도수 대문자', () => {
    assert.equal(R.toRoman('C/E', 'C Major'), 'I/III');
    assert.equal(R.toRoman('G7/B', 'C Major'), 'V7/VII');
    assert.equal(R.toRoman('Am/G', 'C Major'), 'vi/V');
    assert.equal(R.toRoman('D/F#', 'C Major'), 'II/#IV');
  });
  test('잘못된 입력: 못 읽는 코드·키 → ""', () => {
    assert.equal(R.toRoman('H7', 'C Major'), '');
    assert.equal(R.toRoman('C', 'C major'), '');
    assert.equal(R.toRoman('C', ''), '');
    assert.deepEqual(R.romanize(['C', 'Xm', 'G'], 'C Major'), ['I', '', 'V']);
    assert.deepEqual(R.romanize([], 'C Major'), []);
  });
});

describe('CH-2-5: 키 추정 (설계 §5-4)', () => {
  const keysOf = (chords) => K.guessKeys(chords).map((g) => g.key);
  test('C - Am - F - G → C Major', () => {
    assert.equal(keysOf(['C', 'Am', 'F', 'G'])[0], 'C Major');
  });
  test('Am - Dm - E7 - Am → A min', () => {
    assert.equal(keysOf(['Am', 'Dm', 'E7', 'Am'])[0], 'A min');
  });
  test('FM7 - E7 - Am7 - Gm7 C7 → A min·F Major 둘 다 후보 3개 안, 1등은 둘 중 하나', () => {
    const keys = keysOf(['FM7', 'E7', 'Am7', 'Gm7', 'C7']);
    assert.equal(keys.length, 3);
    assert.ok(keys.includes('A min') && keys.includes('F Major'), keys.join());
    assert.ok(['A min', 'F Major'].includes(keys[0]), keys.join());
  });
  test('코드 1개(C) → 후보 3개, C Major 1등', () => {
    const g = K.guessKeys(['C']);
    assert.equal(g.length, 3);
    assert.equal(g[0].key, 'C Major');
    assert.ok(g.every((x) => typeof x.score === 'number'));
  });
  test('파싱된 코드도 받는다, 이명 키 철자는 템플릿', () => {
    const chords = ['Dbmaj7', 'Bbm7', 'Ebm7', 'Ab7'].map(S.parseChord);
    assert.equal(K.guessKeys(chords)[0].key, 'Db Major');
    assert.equal(keysOf(['C#m', 'F#m', 'G#7', 'C#m'])[0], 'C# min');
  });
  test('잘못된 입력: 빈 목록·전부 못 읽음 → [], 못 읽는 코드는 건너뜀', () => {
    assert.deepEqual(K.guessKeys([]), []);
    assert.deepEqual(K.guessKeys(['H7', 'xyz', '']), []);
    assert.equal(keysOf(['C', 'H7', 'Am', 'F', 'G'])[0], 'C Major');
  });
});

describe('CH-2-6: 붙여넣기 extractChordLines (설계 §5-5)', () => {
  const syms = (text) => P.extractChordLines(text).map((l) => l.symbols.join(' '));

  test('ultimate-guitar: [ch] 태그·섹션 머리, 가사 줄 제외', () => {
    const text = [
      '[Verse 1]',
      '[ch]Am[/ch]        [ch]F[/ch]',
      'A long time ago I met you',
      '[ch]C[/ch]         [ch]G[/ch]',
      'Am I the only one',
      '',
      '[Chorus]',
      '[ch]FM7[/ch]  [ch]E7[/ch]  [ch]Am7[/ch]',
    ].join('\n');
    const lines = P.extractChordLines(text);
    assert.deepEqual(lines.map((l) => [l.line, l.section, l.symbols.join(' ')]), [
      [2, 'Verse 1', 'Am F'],
      [4, 'Verse 1', 'C G'],
      [8, 'Chorus', 'FM7 E7 Am7'],
    ]);
  });
  test('ChordPro [Am]가사 → 대괄호 안 코드만', () => {
    const text = '{title: Test}\n[Am]오늘 밤 [F]너를 [C]기다려 [G7(b9)]\n[N.C.]말없이 [Dm7]';
    assert.deepEqual(syms(text), ['Am F C G7(b9)', 'Dm7']);
  });
  test('한 줄 진행·하이픈·마디선·반복 표시·마디 번호·N.C.', () => {
    assert.deepEqual(syms('FM7 - E7 - Am7 - Gm7 C7'), ['FM7 E7 Am7 Gm7 C7']);
    assert.deepEqual(syms('FM7-E7-Am7'), ['FM7 E7 Am7']);
    assert.deepEqual(syms('C-7 F7'), ['C-7 F7']);
    assert.deepEqual(syms('| Am | F | C | G | x4'), ['Am F C G']);
    assert.equal(P.extractChordLines('| Am | F | C | G | x4')[0].repeat, 4);
    assert.equal(P.extractChordLines('Am F C G (×2)')[0].repeat, 2);
    assert.deepEqual(syms('1. Dm7 G7 | 2. CM7 %'), ['Dm7 G7 CM7']);
    assert.deepEqual(syms('N.C. Am F'), ['Am F']);
    assert.deepEqual(syms('C7(b9, b13), Fm'), ['C7(b9, b13) Fm']);
    assert.deepEqual(syms('||: Am7 | D7 :||'), ['Am7 D7']);
  });
  test('섹션 이름 줄: Verse 1: / 후렴: Am F / Chorus', () => {
    const lines = P.extractChordLines('Intro\nC G\nVerse 1:\nAm F\n후렴: F G Em Am\nBridge over troubled water\nDm G');
    assert.deepEqual(lines.map((l) => [l.section, l.symbols.join(' ')]), [
      ['Intro', 'C G'],
      ['Verse 1', 'Am F'],
      ['후렴', 'F G Em Am'],
      ['후렴', 'Dm G'],
    ]);
  });
  test('잘못된 입력: 가사·빈 텍스트·N.C.만 → 코드 줄 없음', () => {
    assert.deepEqual(P.extractChordLines(''), []);
    assert.deepEqual(P.extractChordLines(null), []);
    assert.deepEqual(syms('A day in the life\nAm I dreaming\nCxyz Am\nN.C.\n| | |'), []);
  });
});

describe('CH-2-7: 붙여넣기 findRepeats', () => {
  const seq = (s, n) => Array(n).fill(s.split(' ')).flat();

  test('4코드 ×4 → 1등 + 전체 순서 그대로', () => {
    const symbols = seq('Am F C G', 4);
    const r = P.findRepeats(symbols);
    assert.deepEqual(r[0], { chords: ['Am', 'F', 'C', 'G'], repeats: 4, start: 0 });
    assert.deepEqual(r.at(-1), { chords: symbols, repeats: 1, start: 0 });
    // 회전(F C G Am)·더 짧은 묶음의 반복(8코드 = 4코드 ×2)은 따로 나오지 않는다
    assert.equal(r.length, 2);
  });
  test('회전은 먼저 나온 쪽, 같은 코드 다른 표기는 같은 코드', () => {
    const r = P.findRepeats([...seq('F C G Am', 2), ...seq('Am F C G', 3)]);
    assert.deepEqual(r[0], { chords: ['F', 'C', 'G', 'Am'], repeats: 3, start: 0 });
    assert.ok(!r.slice(1, -1).some((x) => x.chords.length === 4), '회전 후보가 따로 나오면 안 됨');
    const s = P.findRepeats(['FM7', 'G7', 'Fmaj7', 'G7']);
    assert.deepEqual(s[0], { chords: ['FM7', 'G7'], repeats: 2, start: 0 });
  });
  test('여러 묶음: 점수(길이 × 반복) 순 상위 3개 + 전체', () => {
    const symbols = [...seq('Dm7 G7', 2), ...seq('Am F C G', 3), ...seq('E7 Am', 2)];
    const r = P.findRepeats(symbols, 'Chorus');
    assert.equal(r.length, 4);
    assert.deepEqual(r[0], { chords: ['Am', 'F', 'C', 'G'], repeats: 3, start: 4, section: 'Chorus' });
    assert.deepEqual(r.slice(1, 3).map((x) => x.chords.join(' ')).sort(), ['Dm7 G7', 'E7 Am']);
    assert.deepEqual(r[3], { chords: symbols, repeats: 1, start: 0, section: 'Chorus' });
  });
  test('섹션별: extractChordLines → 반복 표시 펼침 → findRepeats', () => {
    const lines = P.extractChordLines('[Verse]\nAm F C G x2\n[Chorus]\nF G Em Am\nF G Em Am');
    const bySection = {};
    for (const l of lines) (bySection[l.section] ||= []).push(...Array(l.repeat).fill(l.symbols).flat());
    const verse = P.findRepeats(bySection.Verse, 'Verse');
    const chorus = P.findRepeats(bySection.Chorus, 'Chorus');
    assert.deepEqual(verse[0], { chords: ['Am', 'F', 'C', 'G'], repeats: 2, start: 0, section: 'Verse' });
    assert.deepEqual(chorus[0], { chords: ['F', 'G', 'Em', 'Am'], repeats: 2, start: 0, section: 'Chorus' });
  });
  test('잘못된 입력: 빈 목록 → [], 반복 없음 → 전체 순서 1개, 한 코드 반복은 묶음 아님', () => {
    assert.deepEqual(P.findRepeats([]), []);
    assert.deepEqual(P.findRepeats(['C', 'F', 'G']), [{ chords: ['C', 'F', 'G'], repeats: 1, start: 0 }]);
    assert.deepEqual(P.findRepeats(['C', 'C', 'C', 'C']).length, 1);
  });
});
