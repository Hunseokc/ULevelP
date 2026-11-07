// CH-2c-1: 정석 코드 폼 표(frontend/src/lib/engine/chordForms.json) — 원본 재현 · 음 검증 · 정석 폼 존재
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FORMS = JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend/src/lib/engine/chordForms.json'), 'utf8'));
const RAW = JSON.parse(fs.readFileSync(path.join(ROOT, '개발산출물/자료/chords-db_guitar.json'), 'utf8'));
const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

let B; // scripts/build_chord_forms.mjs
let S; // chords/symbol.mts
before(async () => {
  B = await import('../scripts/build_chord_forms.mjs');
  S = await import('../frontend/src/lib/chords/symbol.mts');
});

const fx = (frets) => frets.map((f) => (f < 0 ? 'x' : f)).join(' ');
const formsOf = (name) => {
  const c = S.parseChord(name);
  assert.equal(c.ok, true, name);
  const id = `${c.root}:${c.quality}` + (c.bass != null ? `/${c.bass}` : '');
  return (FORMS.forms[id] || { forms: [] }).forms.map((f) => fx(f.frets));
};

describe('CH-2c-1-1 원본 재현', () => {
  test('고정 원본(chords-db) → 변환 결과 = 저장된 JSON', () => {
    const { data } = B.build(RAW);
    assert.equal(JSON.stringify(data) + '\n', fs.readFileSync(path.join(ROOT, 'frontend/src/lib/engine/chordForms.json'), 'utf8'));
  });
  test('수치: 원본 3283 · 표 2879 · 미지원 이름 47 · 불일치 212 · mute-low 273', () => {
    const { stats, unsupported, rejected } = B.build(RAW);
    assert.equal(stats.positions, 3283);
    assert.equal(stats.kept, 2879);
    assert.equal(unsupported.length, 47);
    assert.deepEqual([...new Set(unsupported.map((u) => u.suffix))].sort(), ['5', 'add11', 'alt', 'sus2sus4']);
    assert.equal(rejected.length, 212);
    assert.equal(stats.fixed, 273);
  });
});

describe('CH-2c-1-2 저장된 폼 전부 음 검증(스크립트와 따로 계산)', () => {
  test('울리는 음 ⊂ 구성음(+허용 아래 텐션) · 맨 아래 = 근음/베이스 · 폭 ≤ 4 · 생략은 5(+11·13의 9)만', () => {
    let n = 0;
    for (const [id, entry] of Object.entries(FORMS.forms)) {
      const c = S.parseChord(entry.name);
      assert.equal(c.ok, true, entry.name);
      assert.equal(`${c.root}:${c.quality}` + (c.bass != null ? `/${c.bass}` : ''), id);
      const want = new Set(S.chordPcs(c));
      const okOmit = /^(m|maj|mmaj)?(11|13)/.test(c.quality) ? ['5', '9'] : ['5'];
      for (const f of entry.forms) {
        n++;
        const msg = `${entry.name} ${fx(f.frets)}`;
        assert.equal(f.frets.length, 6, msg);
        const midi = f.frets.flatMap((fr, i) => (fr >= 0 ? [FORMS.tuning[i] + fr] : []));
        assert.ok(midi.length >= 3, msg);
        const addPcs = (f.add || []).map((d) => (c.root + S.DEGREE_SEMITONES[d]) % 12);
        for (const m of midi) assert.ok(want.has(m % 12) || addPcs.includes(m % 12), `${msg}: ${NAMES[m % 12]}`);
        assert.equal(midi[0] % 12, c.bass ?? c.root, msg);
        const fretted = f.frets.filter((x) => x > 0);
        if (fretted.length) assert.ok(Math.max(...fretted) - Math.min(...fretted) < 4, msg);
        const got = new Set(midi.map((m) => m % 12));
        const omit = c.degrees.filter((d) => !got.has((c.root + S.DEGREE_SEMITONES[d]) % 12));
        assert.deepEqual(omit, f.omit || [], msg);
        for (const d of omit) assert.ok(okOmit.includes(d), msg);
        assert.equal(f.fingers.length, 6, msg);
        f.frets.forEach((fr, i) => fr < 0 && assert.equal(f.fingers[i], 0, msg));
      }
    }
    assert.equal(n, 2879);
  });
});

describe('CH-2c-1-3 정석 폼이 표에 있음', () => {
  const cases = [
    ['F', '1 3 3 2 1 1'],
    ['C', 'x 3 2 0 1 0'],
    ['G', '3 2 0 0 0 3'],
    ['D', 'x x 0 2 3 2'],
    ['A', 'x 0 2 2 2 0'],
    ['E', '0 2 2 1 0 0'],
    ['Am', 'x 0 2 2 1 0'],
    ['Em', '0 2 2 0 0 0'],
    ['Dm', 'x x 0 2 3 1'],
    ['Bm', 'x 2 4 4 3 2'],
    ['C7', 'x 3 2 3 1 0'],
    ['G7', '3 2 0 0 0 1'],
    ['Am7', 'x 0 2 0 1 0'],
    ['Fmaj7', 'x x 3 2 1 0'],
  ];
  for (const [name, frets] of cases) test(`${name} ${frets}`, () => assert.ok(formsOf(name).includes(frets), formsOf(name).join(' | ')));
  test('오픈 C/G/D/Am/Em은 첫 폼(원본 순서)', () => {
    for (const [name, frets] of cases.slice(1, 8)) assert.equal(formsOf(name)[0], frets, name);
  });
  test('B 바레 2 2 4 4 4 2(원본 6번 줄 F#) → x 2 4 4 4 2 로 고쳐 fix 표시', () => {
    const f = FORMS.forms['11:maj'].forms.find((x) => fx(x.frets) === 'x 2 4 4 4 2');
    assert.ok(f);
    assert.equal(f.fix, 'mute-low');
    assert.equal(f.fingers[0], 0);
  });
});

describe('CH-2c-1-4 checkForm 잘못된 입력', () => {
  const pos = (frets, baseFret = 1) => ({ frets, baseFret, fingers: [0, 0, 0, 0, 0, 0] });
  test('C 코드에 F 폼 → extra', () => {
    const r = B.checkForm(S.parseChord('C'), pos([1, 3, 3, 2, 1, 1]));
    assert.ok(r.problems.some((p) => p.startsWith('extra')), r.problems.join());
  });
  test('Cm에 C 폼 → extra(E) + omit(b3)', () => {
    const r = B.checkForm(S.parseChord('Cm'), pos([-1, 3, 2, 0, 1, 0]));
    assert.ok(r.problems.includes('extra:E'), r.problems.join());
    assert.ok(r.problems.includes('omit:b3'), r.problems.join());
  });
  test('폭 6 → span (폭 4는 통과)', () => {
    assert.deepEqual(B.checkForm(S.parseChord('C'), pos([-1, 3, 2, 0, 5, 0])).problems, []);
    const r2 = B.checkForm(S.parseChord('C'), pos([-1, 3, 5, 5, 5, 8]));
    assert.ok(r2.problems.includes('span:6'), r2.problems.join());
  });
  test('원본 midi와 프렛이 다르면 midi(고치지 않음)', () => {
    const r = B.checkForm(S.parseChord('C'), { ...pos([-1, 3, 2, 0, 1, 0]), midi: [48, 52, 55, 60, 65] });
    assert.ok(r.problems.includes('midi'));
    assert.equal(r.fix, undefined);
  });
  test('바레 상대 프렛: baseFret 8 의 1 3 3 2 1 1 = C 8 10 10 9 8 8', () => {
    const r = B.checkForm(S.parseChord('C'), pos([1, 3, 3, 2, 1, 1], 8));
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.frets, [8, 10, 10, 9, 8, 8]);
  });
  test('아래 텐션 허용: Cm11에 9 → add, C7에 9 → extra', () => {
    assert.deepEqual(B.allowedExtra('m11'), ['9']);
    assert.deepEqual(B.allowedExtra('11'), ['9', '3']);
    assert.deepEqual(B.allowedExtra('13'), ['9', '11']);
    assert.deepEqual(B.allowedExtra('7'), []);
    assert.deepEqual(B.allowedExtra('maj7#11'), []);
  });
});
