// CH-2b: 보이싱 엔진 퀄리티 추가(genVoicingsByDegrees) + 진행 보이싱 경로 DP(progressionPath.mjs)
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let GE; // engine/voicing.mjs
let P; // engine/progressionPath.mjs
let S; // chords/symbol.mts

before(async () => {
  GE = (await import('../frontend/src/lib/engine/voicing.mjs')).default;
  P = await import('../frontend/src/lib/engine/progressionPath.mjs');
  S = await import('../frontend/src/lib/chords/symbol.mts');
});

const ROOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const chord = (text) => {
  const c = S.parseChord(text);
  assert.equal(c.ok, true, `${text}: ${c.reason}`);
  return c;
};
const byDeg = (text, opts) => {
  const c = chord(text);
  return GE.genVoicingsByDegrees(c.root, c.degrees, Object.assign({ bass: c.bass, name: text }, opts || {}));
};
const pcsOf = (v) => v.notes.map((n) => n.pc);
// 파서가 내는 정규 퀄리티 + 텐션 조합 (CH-2 BASE_QUALITIES 34개 + 7화음류 × 텐션)
const allQualityChords = () => {
  const out = new Map();
  for (const q of S.BASE_QUALITIES) {
    const base = S.parseChord('C' + (q === 'maj' ? '' : q));
    if (base.ok) out.set(base.quality, base);
    for (const t of S.TENSION_ORDER) {
      const c = S.parseChord(`C${q === 'maj' ? '' : q}(${t})`);
      if (c.ok) out.set(c.quality, c);
    }
  }
  return [...out.values()];
};

describe('CH-2b-1: DEG 도수 표', () => {
  test('파서 DEGREE_SEMITONES의 도수가 전부 DEG에 있고 반음 수가 같다(2·#5·bb7 추가)', () => {
    for (const [d, semi] of Object.entries(S.DEGREE_SEMITONES)) {
      assert.ok(GE.DEG[d], d);
      assert.equal(GE.DEG[d][0], semi, d);
    }
    assert.deepStrictEqual(GE.DEG['2'], [2, '3']);
    assert.deepStrictEqual(GE.DEG['#5'], [8, '5']);
    assert.deepStrictEqual(GE.DEG.bb7, [9, '7']);
  });
});

describe('CH-2b-2: 파서 퀄리티 전부 보이싱이 나온다', () => {
  test('정규 퀄리티(BASE_QUALITIES + 텐션) × 12루트, 기본 옵션 — 모든 음이 코드톤', () => {
    const list = allQualityChords();
    assert.ok(list.length >= 100, `퀄리티 ${list.length}개`);
    const zero = [];
    for (const c of list) for (const root of ROOTS) {
      const vs = GE.genVoicingsByDegrees(root, c.degrees);
      if (!vs.length) { zero.push(`${c.quality}@${root}`); continue; }
      const allowed = new Set(c.degrees.map((d) => (root + GE.DEG[d][0]) % 12));
      for (const v of vs) {
        for (const p of pcsOf(v)) assert.ok(allowed.has(p), `${c.quality}@${root} ${GE.fretStr(v)}`);
        assert.ok(v.notes.length >= 3 && v.notes.length <= 4);
      }
    }
    assert.deepStrictEqual(zero, []);
  });

  test('BASE_QUALITIES 34개가 엔진 결과 이름·도수를 그대로 싣는다', () => {
    for (const q of S.BASE_QUALITIES) {
      const text = 'C' + ({ maj: '', maj7s11: 'maj7#11' }[q] ?? q); // maj7s11은 엔진 CH 키 이름, 입력은 maj7#11
      const c = chord(text);
      const vs = byDeg(text);
      assert.ok(vs.length, text);
      assert.equal(vs[0].name, text);
      assert.equal(vs[0].q, null);
      assert.deepStrictEqual(vs[0].degrees, c.degrees);
    }
  });
});

describe('CH-2b-3: 3화음·sus·add9', () => {
  test('C·Am·Cdim·Caug는 3음 폼만, 세 음이 다 들어간다', () => {
    for (const [text, want] of [['C', [0, 4, 7]], ['Am', [9, 0, 4]], ['Cdim', [0, 3, 6]], ['Caug', [0, 4, 8]]]) {
      const vs = byDeg(text);
      assert.ok(vs.length > 5, text);
      for (const v of vs) assert.deepStrictEqual([...pcsOf(v)].sort((a, b) => a - b), [...want].sort((a, b) => a - b), `${text} ${GE.fretStr(v)}`);
    }
  });

  test('Csus2는 2(D)가 3도 자리(cls 3), 3도(E)는 없다 / Csus4는 4(F)', () => {
    for (const v of byDeg('Csus2')) {
      assert.ok(v.notes.some((n) => n.deg === '2' && n.cls === '3' && n.pc === 2));
      assert.ok(!pcsOf(v).includes(4));
    }
    for (const v of byDeg('Csus4')) assert.ok(pcsOf(v).includes(5));
  });

  test('Cadd9는 9(D)와 3(E)가 반드시 있다 / C11(도미넌트 11)은 3도 없이 9·11 중 2개 이상', () => {
    for (const v of byDeg('Cadd9')) assert.ok(pcsOf(v).includes(2) && pcsOf(v).includes(4), GE.fretStr(v));
    for (const v of byDeg('C11')) {
      assert.ok(!pcsOf(v).includes(4));
      assert.ok(pcsOf(v).includes(2) && pcsOf(v).includes(5), GE.fretStr(v));
    }
  });

  test('Cdim7(bb7 = A)은 가이드톤 b3·bb7을 담는다', () => {
    for (const v of byDeg('Cdim7')) {
      assert.ok(v.notes.some((n) => n.deg === 'bb7' && n.cls === '7'));
      assert.ok(v.notes.some((n) => n.deg === 'b3'));
    }
  });
});

describe('CH-2b-4: 변화된 5도는 꼭 들어간다 (C7#5 ≠ C7)', () => {
  test('C7#5는 #5(Ab), C7b5·Cm7b5는 b5(Gb)가 모든 보이싱에', () => {
    for (const v of byDeg('C7#5')) assert.ok(pcsOf(v).includes(8), GE.fretStr(v));
    for (const v of byDeg('C7b5')) assert.ok(pcsOf(v).includes(6), GE.fretStr(v));
    for (const v of byDeg('Cm7b5')) assert.ok(pcsOf(v).includes(6), GE.fretStr(v));
  });

  test('옛 genVoicings(m7b5)는 그대로 b5 없는 폼도 낸다(결과 불변) — must를 넘기면 같아진다', () => {
    assert.ok(GE.genVoicings(0, 'm7b5').some((v) => !pcsOf(v).includes(6)));
    const a = GE.genVoicingsByDegrees(0, GE.CH.m7b5, { must: [] }).map(GE.fretStr);
    assert.deepStrictEqual(a, GE.genVoicings(0, 'm7b5').map(GE.fretStr));
  });
});

describe('CH-2b-5: 도수 6개 이상 생략 (5 → R → 9)', () => {
  test('C13b9(R 3 5 b7 b9 13) → 5 생략, G 없음', () => {
    const vs = byDeg('C13b9');
    assert.ok(vs.length);
    for (const v of vs) {
      assert.deepStrictEqual(v.omit, ['5']);
      assert.ok(!pcsOf(v).includes(7));
      assert.ok(pcsOf(v).includes(1) && pcsOf(v).includes(9), GE.fretStr(v)); // b9·13 둘 다
    }
  });

  test('C7alt(R 3 #5 b7 b9 #9) → 5가 없으니 R 생략, 변화음(#5·b9·#9) 중 2개 이상', () => {
    for (const v of byDeg('C7alt')) {
      assert.deepStrictEqual(v.omit, ['R']);
      assert.ok(!pcsOf(v).includes(0));
      assert.ok([8, 1, 3].filter((p) => pcsOf(v).includes(p)).length >= 2, GE.fretStr(v));
    }
  });

  test('5개가 되면 멈춘다: R 3 5 b7 9 11 13 → 5·R / R 3 #5 b7 9 #11 13 → R·9(다른 확장음 있음) / 5개 이하는 생략 없음', () => {
    const a = GE.genVoicingsByDegrees(0, ['R', '3', '5', 'b7', '9', '11', '13']);
    assert.ok(a.length);
    assert.deepStrictEqual(a[0].omit, ['5', 'R']);
    for (const v of a) assert.ok(!pcsOf(v).some((p) => [7, 0].includes(p)));
    const b = GE.genVoicingsByDegrees(0, ['R', '3', '#5', 'b7', '9', '#11', '13']);
    assert.ok(b.length);
    assert.deepStrictEqual(b[0].omit, ['R', '9']);
    for (const v of b) assert.ok(!pcsOf(v).some((p) => [0, 2].includes(p)));
    for (const v of byDeg('Cmaj9')) assert.deepStrictEqual(v.omit, []);
  });

  test('슬래시 베이스 음은 생략하지 않는다: C13b9/G → 5(G) 대신 R 생략', () => {
    const vs = byDeg('C13b9/G');
    assert.ok(vs.length);
    for (const v of vs) {
      assert.deepStrictEqual(v.omit, ['R']);
      assert.equal(v.notes[0].pc, 7);
    }
  });

  test('같은 음 도수(m7#9의 b3·#9)는 앞쪽만 — 보이싱이 나온다', () => {
    for (const text of ['Cm7(#9)', 'C7b5(#11)']) {
      const vs = byDeg(text);
      assert.ok(vs.length, text);
    }
  });
});

describe('CH-2b-6: 슬래시 베이스', () => {
  test('G7/B: 맨 아래 음이 B(코드톤 3)', () => {
    const vs = byDeg('G7/B');
    assert.ok(vs.length);
    for (const v of vs) {
      assert.equal(v.notes[0].pc, 11);
      assert.equal(v.notes[0].deg, '3');
    }
  });

  test('C/D: 코드톤 아닌 베이스 D는 맨 아래에만(deg 2, cls bass)', () => {
    const vs = byDeg('C/D');
    assert.ok(vs.length);
    for (const v of vs) {
      assert.deepStrictEqual([v.notes[0].pc, v.notes[0].deg, v.notes[0].cls], [2, '2', 'bass']);
      assert.ok(v.notes.slice(1).every((n) => n.cls !== 'bass'));
    }
  });
});

describe('CH-2b-7: 잘못된 입력', () => {
  test('모르는 도수·빈 목록·배열 아님 → []', () => {
    assert.deepStrictEqual(GE.genVoicingsByDegrees(0, ['R', 'x9']), []);
    assert.deepStrictEqual(GE.genVoicingsByDegrees(0, []), []);
    assert.deepStrictEqual(GE.genVoicingsByDegrees(0, 'm7'), []);
    assert.deepStrictEqual(GE.genVoicingsByDegrees(0, undefined), []);
  });
});

describe('CH-2b-8: genVoicings = 같은 생성 함수 (CH 도수 + 확장음 must)', () => {
  test('모든 CH × 12루트: genVoicingsByDegrees(CH[q], must=확장음)이 genVoicings와 같은 보이싱·점수', () => {
    const strip = (v) => { const { q, name, degrees, omit, ...rest } = v; return rest; };
    for (const q of Object.keys(GE.CH)) for (const root of ROOTS) {
      const must = GE.CH[q].filter((d) => GE.DEG[d][1] === 'ext');
      const a = GE.genVoicingsByDegrees(root, GE.CH[q], { must }).map(strip);
      assert.deepStrictEqual(a, GE.genVoicings(root, q).map(strip), `${q}@${root}`);
    }
  });
});

describe('CH-2b-9: trans export', () => {
  test('7도 → 다음 3도 거리 + 탑노트·평균 프렛 차의 절반', () => {
    const a = GE.genVoicings(2, 'm7')[0];
    const b = GE.genVoicings(7, '7')[0];
    const p7 = a.notes.find((n) => n.cls === '7').pitch;
    const p3 = b.notes.find((n) => n.cls === '3').pitch;
    const want = Math.abs(p7 - p3) + 0.5 * Math.abs(a.top - b.top) + 0.5 * Math.abs(a.avgFret - b.avgFret);
    assert.equal(GE.trans(a, b), want);
  });
});

describe('CH-2b-10: 진행 보이싱 경로 bestPaths', () => {
  const totalOf = (vs, loop) => {
    let t = vs.reduce((a, v) => a + v.score, 0);
    for (let i = 1; i < vs.length; i++) t -= GE.trans(vs[i - 1], vs[i]);
    if (loop && vs.length > 1) t -= GE.trans(vs[vs.length - 1], vs[0]);
    return t;
  };
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

  test('FM7 Dm9 Gm7 C7 (5~9프렛): 3개, 점수 내림차순, total = 점수 합 - 이동 비용, 범위 안', () => {
    const chords = ['FM7', 'Dm9', 'Gm7', 'C7'].map(chord);
    const ps = P.bestPaths(chords, { lo: 5, hi: 9 });
    assert.equal(ps.length, 3);
    for (let i = 1; i < ps.length; i++) assert.ok(ps[i - 1].total >= ps[i].total);
    for (const p of ps) {
      assert.equal(p.voicings.length, 4);
      assert.deepStrictEqual(p.voicings.map((v) => v.name), ['FM7', 'Dm9', 'Gm7', 'C7']);
      near(p.total, totalOf(p.voicings, false), 'total');
      near(p.cost, p.voicings.reduce((a, v) => a + v.score, 0) - p.total, 'cost');
      for (const v of p.voicings) for (const n of v.notes) assert.ok(n.f >= 5 && n.f <= 9, GE.fretStr(v));
    }
    assert.equal(new Set(ps.map((p) => GE.fretStr(p.voicings[0]))).size, 3); // 시작 자리가 서로 다름
  });

  test('완전 탐색과 같은 최적값 (3코드 × 후보 8개, loop 꺼짐·켜짐)', () => {
    const chords = ['Am', 'Dm7', 'G7'].map(chord);
    for (const loop of [false, true]) {
      const opts = { topK: 8, loop };
      const cand = chords.map((c) => P.chordCandidates(c, opts).voicings);
      let best = -Infinity;
      for (const a of cand[0]) for (const b of cand[1]) for (const c of cand[2]) best = Math.max(best, totalOf([a, b, c], loop));
      const ps = P.bestPaths(chords, opts);
      near(ps[0].total, best, `loop ${loop}`);
      near(ps[0].total, totalOf(ps[0].voicings, loop), `loop ${loop} 재계산`);
    }
  });

  test('2-5-1은 search251(기본, C 메이저)과 같은 최적 경로', () => {
    const ref = GE.search251({ kind: 'major', keys: [0], lo: 1, hi: 12 })[0].paths[0];
    const ps = P.bestPaths(['Dm7', 'G7', 'Cmaj7'].map(chord), { lo: 1, hi: 12, topK: 45, outsideMax: 1 });
    near(ps[0].total, ref.total, 'total');
    assert.deepStrictEqual(ps[0].voicings.map(GE.fretStr), ref.chords.map(GE.fretStr));
  });

  test('반복 진행 loop: 끝 → 처음 이동이 비용에 들어간다', () => {
    const chords = ['C', 'G', 'Am', 'F'].map(chord);
    const open = P.bestPaths(chords);
    const loop = P.bestPaths(chords, { loop: true });
    near(loop[0].total, totalOf(loop[0].voicings, true), 'loop total');
    assert.ok(loop[0].total <= open[0].total + 1e-9);
  });

  test('코드 1개 → 보이싱 점수 순 상위 3개', () => {
    const ps = P.bestPaths([chord('Cmaj7')]);
    assert.equal(ps.length, 3);
    const top = P.chordCandidates(chord('Cmaj7')).voicings.slice(0, 3);
    assert.deepStrictEqual(ps.map((p) => GE.fretStr(p.voicings[0])), top.map(GE.fretStr));
    for (const p of ps) assert.equal(p.cost, 0);
  });

  test('슬래시 베이스가 범위 안에서 안 되면 베이스 없이(bassDropped)', () => {
    const r = P.chordCandidates(chord('G7/B'), { lo: 10, hi: 12 });
    assert.equal(r.bassDropped, true);
    assert.ok(r.voicings.length);
    const ok = P.chordCandidates(chord('G7/B'));
    assert.equal(ok.bassDropped, false);
    for (const v of ok.voicings) assert.equal(v.notes[0].pc, 11);
  });

  test('잘못된 입력: 빈 진행·후보 없는 코드 → []', () => {
    assert.deepStrictEqual(P.bestPaths([]), []);
    assert.deepStrictEqual(P.bestPaths(undefined), []);
    assert.deepStrictEqual(P.bestPaths([chord('C'), { root: 0, degrees: ['R', 'x9'] }]), []);
    assert.deepStrictEqual(P.bestPaths([chord('C')], { lo: 1, hi: 1 }), []);
  });

  test('16코드 진행도 1초 안', () => {
    const chords = 'Cmaj7 Am7 Dm7 G7 Em7 A7 Dm9 G13 Fmaj7 Fm6 Em7 A7alt Dm7 G7b9 C6 C69'.split(' ').map(chord);
    const t0 = Date.now();
    const ps = P.bestPaths(chords, { loop: true });
    assert.equal(ps.length, 3);
    assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0}ms`);
  });
});
