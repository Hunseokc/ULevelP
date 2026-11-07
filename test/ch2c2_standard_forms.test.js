// CH-2c-2: 정석 코드 폼(표 + 규칙, frontend/src/lib/engine/chordShapes.mjs) — 재현율 · 정석 폼 · 진행 연결 · 회귀 · 잘못된 입력
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TABLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend/src/lib/engine/chordForms.json'), 'utf8'));
const MAX_FRET = 15; // 표 폼의 최고 프렛

let X; // engine/chordShapes.mjs
let P; // engine/progressionPath.mjs
let S; // chords/symbol.mts
let B; // scripts/build_chord_forms.mjs (CH-2c-1 검증)
before(async () => {
  X = await import('../frontend/src/lib/engine/chordShapes.mjs');
  P = await import('../frontend/src/lib/engine/progressionPath.mjs');
  S = await import('../frontend/src/lib/chords/symbol.mts');
  B = await import('../scripts/build_chord_forms.mjs');
});

const fx = (frets) => frets.map((f) => (f < 0 ? 'x' : f)).join(' ');
const chord = (name) => { const c = S.parseChord(name); assert.equal(c.ok, true, name); return c; };
const rankOf = (vs, frets) => vs.findIndex((v) => fx(v.frets) === frets);

// 핵심 정석 폼 14개 (CH-2c-1-3과 같은 목록)
const CORE = {
  F: '1 3 3 2 1 1', C: 'x 3 2 0 1 0', G: '3 2 0 0 0 3', D: 'x x 0 2 3 2', A: 'x 0 2 2 2 0', E: '0 2 2 1 0 0',
  Am: 'x 0 2 2 1 0', Em: '0 2 2 0 0 0', Dm: 'x x 0 2 3 1', Bm: 'x 2 4 4 3 2', C7: 'x 3 2 3 1 0', G7: '3 2 0 0 0 1',
  Am7: 'x 0 2 0 1 0', Fmaj7: 'x x 3 2 1 0',
};

describe('CH-2c-2-1 재현율 (규칙이 표 폼을 만드는가)', () => {
  let M;
  before(() => {
    // 분모 = add(11·13 아래 텐션) 폼을 뺀 표 폼. 규칙은 구성음만 내므로 add는 따로 센다
    M = { den: 0, hit: 0, add: 0, miss: [], cat: {}, r2den: 0, top1: 0, top5: 0, counts: [] };
    for (const [id, e] of Object.entries(TABLE.forms)) {
      const c = chord(e.name);
      assert.equal(X.formId(c), id, e.name);
      const gen = X.ruleForms(c, { lo: 0, hi: MAX_FRET });
      M.counts.push(gen.length);
      const rank = new Map(gen.map((v, i) => [fx(v.frets), i]));
      for (const f of e.forms) {
        if (f.add) { M.add++; continue; }
        const k = (c.bass != null ? 'slash' : 'plain') + (f.fix ? '+mute-low' : '') + (f.omit ? '+omit' : '');
        M.cat[k] ??= [0, 0];
        M.cat[k][0]++; M.den++;
        if (rank.has(fx(f.frets))) { M.hit++; M.cat[k][1]++; } else M.miss.push(`${e.name} ${fx(f.frets)}`);
      }
      if (!e.forms[0].add) {
        M.r2den++;
        const r = rank.get(fx(e.forms[0].frets));
        if (r === 0) M.top1++;
        if (r != null && r < 5) M.top5++;
      }
    }
  });

  test('R1 허용률: 표 폼이 규칙 생성 전체에 들어 있는 비율 ≥ 95%', (t) => {
    const pct = (M.hit / M.den) * 100;
    t.diagnostic(`R1 ${M.hit}/${M.den} = ${pct.toFixed(1)}% (add ${M.add}폼 분모 밖) · 범주 ${JSON.stringify(M.cat)}`);
    t.diagnostic(`R1 못 만든 폼 ${M.miss.length}: ${M.miss.join(' / ')}`);
    assert.ok(pct >= 95, `R1 ${pct}`);
  });

  test('R2 첫 폼 순위: 상위 5개 ≥ 80%, 상위 1개 ≥ 50%', (t) => {
    const p1 = (M.top1 / M.r2den) * 100; const p5 = (M.top5 / M.r2den) * 100;
    const cs = [...M.counts].sort((a, b) => a - b);
    t.diagnostic(`R2 ${M.r2den}코드 · 1등 ${M.top1} (${p1.toFixed(1)}%) · 5등 안 ${M.top5} (${p5.toFixed(1)}%) · 코드당 규칙 폼 중앙값 ${cs[cs.length >> 1]} 최대 ${cs[cs.length - 1]}`);
    assert.ok(p5 >= 80, `top5 ${p5}`);
    assert.ok(p1 >= 50, `top1 ${p1}`);
  });
});

describe('CH-2c-2-2 R3 핵심 정석 폼 (표 없이 규칙만)', () => {
  test('14개 중 13개는 상위 3개 안, Fmaj7 x x 3 2 1 0은 상위 5개 안(바레 3종 다음 — 결과 파일 §4)', (t) => {
    const ranks = {};
    for (const [name, frets] of Object.entries(CORE)) ranks[name] = rankOf(X.ruleForms(chord(name), { lo: 0, hi: 12 }), frets);
    t.diagnostic(`R3 순위(0부터) ${JSON.stringify(ranks)}`);
    for (const [name, r] of Object.entries(ranks)) {
      if (name === 'Fmaj7') assert.ok(r >= 0 && r < 5, `${name} ${r}`);
      else assert.ok(r >= 0 && r < 3, `${name} ${r}`);
    }
    // 오픈 C·G·D·Am·Em·E·A, F 바레는 1등
    for (const name of ['C', 'G', 'D', 'A', 'E', 'Am', 'Em', 'F']) assert.equal(ranks[name], 0, name);
  });

  test('손가락·바레 판정: F 바레 4손가락 [1], A x 0 2 2 2 0 바레 [2], C9 x 3 2 3 3 3 두 번째 바레로 3손가락', () => {
    const find = (name, frets) => X.ruleForms(chord(name), { lo: 0, hi: 12 }).find((v) => fx(v.frets) === frets);
    const f = find('F', '1 3 3 2 1 1');
    assert.equal(f.fingers, 4); assert.deepEqual(f.barres, [1]); assert.equal(f.kind, 'rule');
    assert.deepEqual(find('A', 'x 0 2 2 2 0').barres, [2]);
    const c9 = find('C9', 'x 3 2 3 3 3');
    assert.equal(c9.fingers, 3); assert.deepEqual(c9.barres, [3]);
  });
});

describe('CH-2c-2-3 R4 규칙 폼은 전부 CH-2c-1 검증 통과', () => {
  test('표의 모든 코드 × 0~15프렛: 음 · 맨 아래 · 프렛 폭 · 생략 규칙 · 손가락 ≤ 4 · 가운데 막음 ≤ 1', () => {
    let n = 0;
    for (const e of Object.values(TABLE.forms)) {
      const c = chord(e.name);
      for (const v of X.ruleForms(c, { lo: 0, hi: MAX_FRET })) {
        const r = B.checkForm(c, { frets: v.frets, baseFret: 1 });
        assert.deepEqual(r.problems, [], `${e.name} ${fx(v.frets)}`);
        assert.ok(v.fingers <= 4 && v.gaps <= 1 && v.notes.length >= 3, `${e.name} ${fx(v.frets)}`);
        n++;
      }
    }
    assert.ok(n > 50000, `규칙 폼 ${n}`);
  });

  test('표에 없는 퀄리티(파서는 받음)도 규칙 폼이 나온다: m13·9sus4·7alt·maj7#11·7b9b13', () => {
    for (const name of ['Cm13', 'C9sus4', 'C7alt', 'Cmaj7#11', 'C7b9b13']) {
      const c = chord(name);
      assert.equal(TABLE.forms[X.formId(c)], undefined, name);
      const vs = X.standardForms(c, TABLE, {});
      assert.ok(vs.length > 0, name);
      assert.ok(vs.every((v) => v.kind === 'rule'), name);
    }
  });
});

describe('CH-2c-2-4 표 조회', () => {
  test('표가 있으면 표 폼만(kind table, src), 점수 순 — F 1등 = 1 3 3 2 1 1', () => {
    const vs = X.standardForms(chord('F'), TABLE, {});
    assert.ok(vs.length >= 4);
    assert.ok(vs.every((v) => v.kind === 'table' && v.src.startsWith('F major')));
    assert.equal(fx(vs[0].frets), '1 3 3 2 1 1');
  });

  test('범위: 오픈 폼은 lo 0일 때만, 범위 안 표 폼이 없으면 규칙으로', () => {
    const c = chord('C');
    assert.ok(X.tableForms(c, TABLE, { lo: 0 }).some((v) => fx(v.frets) === 'x 3 2 0 1 0'));
    assert.ok(X.tableForms(c, TABLE, { lo: 1 }).every((v) => !v.frets.includes(0)));
    const inRange = X.tableForms(c, TABLE, { lo: 5, hi: 9 });
    assert.ok(inRange.every((v) => v.frets.every((f) => f < 0 || (f >= 5 && f <= 9))));
    // 13~15프렛엔 C 표 폼이 없다 → 규칙
    assert.deepEqual(X.tableForms(c, TABLE, { lo: 13, hi: 15 }), []);
    const r = X.standardForms(c, TABLE, { lo: 13, hi: 15 });
    assert.ok(r.length > 0 && r.every((v) => v.kind === 'rule'));
  });

  test('슬래시: G/B 표 폼 맨 아래 = B, mute-low 폼은 fix 표시', () => {
    const vs = X.tableForms(chord('G/B'), TABLE, {});
    assert.ok(vs.length > 0);
    assert.ok(vs.every((v) => v.notes[0].pc === 11));
    assert.ok(X.tableForms(chord('B'), TABLE, {}).some((v) => v.fix === 'mute-low' && fx(v.frets) === 'x 2 4 4 4 2'));
  });

  test('11·13 표 폼의 아래 텐션(add)은 cls ext로 실린다', () => {
    const vs = X.tableForms(chord('C13'), TABLE, {});
    assert.ok(vs.length > 0);
    for (const v of vs) assert.ok(v.notes.every((n) => n.deg && n.cls), fx(v.frets));
  });
});

describe('CH-2c-2-5 진행 연결 (chordCandidates · bestPaths)', () => {
  test("shapes 'standard': 정석 폼이 후보 1등 — F 바레·오픈 C G D Am Em (표 있음 · 표 없음 둘 다)", () => {
    const want = { F: '1 3 3 2 1 1', C: 'x 3 2 0 1 0', G: '3 2 0 0 0 3', D: 'x x 0 2 3 2', Am: 'x 0 2 2 1 0', Em: '0 2 2 0 0 0' };
    for (const [name, frets] of Object.entries(want)) {
      const t = P.chordCandidates(chord(name), { shapes: 'standard', formTable: TABLE }).voicings;
      assert.equal(fx(t[0].frets), frets, `${name} 표`);
      const r = P.chordCandidates(chord(name), { shapes: 'standard' }).voicings;
      assert.ok(rankOf(r, frets) >= 0 && rankOf(r, frets) < 3, `${name} 규칙 ${rankOf(r, frets)}`);
    }
  });

  test("bestPaths C G Am F (standard): 1등 경로 = 오픈 C · 오픈 G · 오픈 Am · F 바레", () => {
    const ps = P.bestPaths(['C', 'G', 'Am', 'F'].map(chord), { shapes: 'standard', formTable: TABLE });
    assert.equal(ps.length, 3);
    assert.deepEqual(ps[0].voicings.map((v) => fx(v.frets)), ['x 3 2 0 1 0', '3 2 0 0 0 3', 'x 0 2 2 1 0', '1 3 3 2 1 1']);
    for (let i = 1; i < ps.length; i++) assert.ok(ps[i - 1].total >= ps[i].total);
  });

  test('표에 없는 코드가 섞여도 경로가 나온다(표 + 규칙), 기본 범위 0~12', () => {
    const ps = P.bestPaths(['Dm9', 'G13', 'Cmaj7#11', 'C7alt'].map(chord), { shapes: 'standard', formTable: TABLE });
    assert.ok(ps.length > 0);
    assert.deepEqual(ps[0].voicings.map((v) => v.kind), ['table', 'table', 'rule', 'rule']);
    for (const v of ps[0].voicings) assert.ok(v.frets.every((f) => f <= 12), fx(v.frets));
  });

  test('범위가 좁아 정석 폼이 없는 코드가 있으면 [] (CH-5b가 범위를 넓히거나 대체 표시)', () => {
    // Dm9는 5~9프렛에 근음이 맨 아래이면서 9도가 든 정석 폼이 없다(표·규칙 둘 다)
    assert.equal(P.chordCandidates(chord('Dm9'), { shapes: 'standard', formTable: TABLE, lo: 5, hi: 9 }).voicings.length, 0);
    assert.deepEqual(P.bestPaths(['Dm9', 'G7'].map(chord), { shapes: 'standard', formTable: TABLE, lo: 5, hi: 9 }), []);
    // 'both'면 compact 후보로 경로가 나온다
    assert.ok(P.bestPaths(['Dm9', 'G7'].map(chord), { shapes: 'both', formTable: TABLE, lo: 5, hi: 9 }).length > 0);
  });

  test("shapes 'both': compact + 정석 폼이 한 후보 목록(kind로 구분, 같은 프렛 한 번)", () => {
    const vs = P.chordCandidates(chord('C'), { shapes: 'both', formTable: TABLE, topK: 200 }).voicings;
    const kinds = new Set(vs.map((v) => v.kind));
    assert.ok(kinds.has('compact') && kinds.has('table'));
    assert.equal(new Set(vs.map((v) => fx(v.frets))).size, vs.length);
  });

  test("기본(compact) 결과 불변: 옵션 없음 = shapes 'compact' + formTable, kind 없음", () => {
    for (const name of ['C', 'G7/B', 'Dm9', 'C13b9']) {
      const a = P.chordCandidates(chord(name));
      const b = P.chordCandidates(chord(name), { shapes: 'compact', formTable: TABLE });
      assert.deepEqual(a, b, name);
      assert.ok(a.voicings.every((v) => v.kind === undefined), name);
    }
    const prog = ['FM7', 'Dm9', 'Gm7', 'C7'].map(chord);
    assert.deepEqual(P.bestPaths(prog, { lo: 5, hi: 9 }), P.bestPaths(prog, { lo: 5, hi: 9, shapes: 'compact', formTable: TABLE }));
  });

  test('슬래시 베이스가 안 되면 베이스 없이(bassDropped) — standard에서도', () => {
    // G7/B: 표에 슬래시 id가 없고 10~12프렛엔 B 베이스 규칙 폼도 없다 → G7 표 폼(맨 아래 G)으로
    const g = P.chordCandidates(chord('G7/B'), { shapes: 'standard', formTable: TABLE, lo: 10, hi: 12 });
    assert.equal(g.bassDropped, true);
    assert.deepEqual(g.voicings.map((v) => [fx(v.frets), v.kind, v.notes[0].pc]), [['x 10 12 10 12 10', 'table', 7]]);
    // 0~3프렛이면 B 베이스 규칙 폼(x 2 0 0 0 1)이 나온다
    const low = P.chordCandidates(chord('G7/B'), { shapes: 'standard', formTable: TABLE, lo: 0, hi: 3 });
    assert.equal(low.bassDropped, false);
    assert.equal(fx(low.voicings[0].frets), 'x 2 0 0 0 1');
    assert.ok(low.voicings.every((v) => v.kind === 'rule' && v.notes[0].pc === 11));
  });

  test('16코드 진행 standard 1초 안', () => {
    const prog = 'C G Am F Dm7 G7 Cmaj7 A7 Dm9 G13 Em7 A7 Dm7 G7 C6 Cmaj7#11'.split(' ').map(chord);
    const t0 = Date.now();
    const ps = P.bestPaths(prog, { shapes: 'standard', formTable: TABLE, loop: true });
    assert.ok(ps.length > 0);
    assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0}ms`);
  });
});

describe('CH-2c-2-6 잘못된 입력', () => {
  test('모르는 shapes → 후보 0개 · 경로 []', () => {
    assert.deepEqual(P.chordCandidates(chord('C'), { shapes: 'foo' }), { voicings: [], bassDropped: false });
    assert.deepEqual(P.bestPaths([chord('C')], { shapes: 'foo' }), []);
  });

  test('ruleForms: 모르는 도수 · 빈 도수 · lo > hi · lo < 0 · 근음 없음 → []', () => {
    assert.deepEqual(X.ruleForms({ root: 0, degrees: ['R', 'x9'] }), []);
    assert.deepEqual(X.ruleForms({ root: 0, degrees: [] }), []);
    assert.deepEqual(X.ruleForms(chord('C'), { lo: 9, hi: 5 }), []);
    assert.deepEqual(X.ruleForms(chord('C'), { lo: -1, hi: 5 }), []);
    assert.deepEqual(X.ruleForms({ degrees: ['R', '3', '5'] }), []);
    assert.deepEqual(X.ruleForms(null), []);
  });

  test('tableForms: 표 없음 · quality 없음(formId null) → [], standardForms는 규칙으로', () => {
    assert.deepEqual(X.tableForms(chord('C'), null), []);
    const noQ = { root: 0, degrees: ['R', '3', '5'] };
    assert.equal(X.formId(noQ), null);
    assert.deepEqual(X.tableForms(noQ, TABLE), []);
    assert.ok(X.standardForms(noQ, TABLE).length > 0);
    assert.equal(X.formId(null), null);
  });
});
