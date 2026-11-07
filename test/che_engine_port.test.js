// CH-E: public/lib(옛, CJS) 엔진과 frontend/src/lib/engine(새, ES 모듈) 엔진이 같은 입력에 같은 결과를 내는지 확인
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OLD_CT = require('../public/lib/theory.js');
const OLD_GE = require('../public/lib/voicing.js');
let NEW_CT;
let NEW_GE;

before(async () => {
  NEW_CT = (await import('../frontend/src/lib/engine/theory.mjs')).default;
  NEW_GE = (await import('../frontend/src/lib/engine/voicing.mjs')).default;
});

const ROOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
// 같은 입력을 옛·새 함수에 넣어 결과 비교
const same = (oldFn, newFn, args) => assert.deepStrictEqual(newFn(...args), oldFn(...args), JSON.stringify(args));

// voicing.mjs는 CH-2b에서 고쳤다(genVoicingsByDegrees·DEG 추가·trans export) — 줄 비교는 theory만, voicing은 CH-E-2·4가 지킨다
describe('CH-E-1: 파일 내용 불변 (export 줄만 다름)', () => {
  for (const [oldRel, newRel, name] of [
    ['public/lib/theory.js', 'frontend/src/lib/engine/theory.mjs', 'CT'],
  ]) {
    test(`${newRel}`, () => {
      const lines = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r/g, '').trimEnd().split('\n');
      const a = lines(oldRel);
      const b = lines(newRel);
      assert.equal(b.length, a.length);
      assert.equal(a.at(-1), `if (typeof module !== 'undefined') module.exports = ${name};`);
      assert.equal(b.at(-1), `export default ${name};`);
      assert.deepStrictEqual(b.slice(0, -1), a.slice(0, -1));
    });
  }
});

describe('CH-E-2: export 목록과 상수', () => {
  test('theory export 키·상수 값이 같다', () => {
    assert.deepStrictEqual(Object.keys(NEW_CT), Object.keys(OLD_CT));
    for (const [k, v] of Object.entries(OLD_CT)) if (typeof v !== 'function') assert.deepStrictEqual(NEW_CT[k], v, k);
  });
  test('voicing: 옛 export 키 ⊂ 새 키, 옛 상수 항목은 값이 같다(DEG는 도수 추가만)', () => {
    const newKeys = Object.keys(NEW_GE);
    for (const k of Object.keys(OLD_GE)) assert.ok(newKeys.includes(k), k);
    for (const [k, v] of Object.entries(OLD_GE)) {
      if (typeof v === 'function') continue;
      if (k === 'DEG') for (const [d, x] of Object.entries(v)) assert.deepStrictEqual(NEW_GE.DEG[d], x, d);
      else assert.deepStrictEqual(NEW_GE[k], v, k);
    }
  });
});

describe('CH-E-3: theory 함수 결과 동일', () => {
  test('pc·strName·setLabelHi·isAdjacent·spanOf', () => {
    for (const n of [-13, -1, 0, 5, 11, 12, 40, 64]) same(OLD_CT.pc, NEW_CT.pc, [n]);
    for (let s = 0; s < 6; s++) same(OLD_CT.strName, NEW_CT.strName, [s]);
    for (const set of OLD_CT.STRING_SETS) {
      same(OLD_CT.setLabelHi, NEW_CT.setLabelHi, [set]);
      same(OLD_CT.isAdjacent, NEW_CT.isAdjacent, [set]);
    }
    for (const frets of [[], [0, 0], [3, 5, 4, 0], [-1, 7, 9, 8]]) same(OLD_CT.spanOf, NEW_CT.spanOf, [frets]);
  });

  test('dropStructure·placeOn·atR0·mutation (드롭 × 전위 × 줄세트 × 성질)', () => {
    for (const d of OLD_CT.DROPS) {
      same(OLD_CT.dropStructure, NEW_CT.dropStructure, [d.id]);
      const st = OLD_CT.dropStructure(d.id);
      for (let inv = 0; inv < 4; inv++) for (const set of OLD_CT.STRING_SETS) for (const q of OLD_CT.Q4) {
        for (const root of [0, 5, 10]) same(OLD_CT.placeOn, NEW_CT.placeOn, [st[inv], set, root, q.id, { maxSpan: 4 }]);
        same(OLD_CT.atR0, NEW_CT.atR0, [st[inv], set, 48, q.id]);
        same(OLD_CT.mutation, NEW_CT.mutation, ['maj7', q.id, st[inv], set]);
      }
    }
  });

  test('countPlayable·playableSets', () => {
    for (const root of ROOTS) same(OLD_CT.countPlayable, NEW_CT.countPlayable, [root, 4]);
    for (const d of OLD_CT.DROPS) for (let inv = 0; inv < 4; inv++) for (const root of [0, 7]) {
      same(OLD_CT.playableSets, NEW_CT.playableSets, [d.id, inv, root, 4]);
    }
  });

  test('arpeggio2nps·arpeggioAs', () => {
    for (const root of ROOTS) for (let slot = 0; slot < 4; slot++) for (const near of [1, 5, 12]) {
      same(OLD_CT.arpeggio2nps, NEW_CT.arpeggio2nps, [root, slot, near]);
      const base = OLD_CT.arpeggio2nps(root, slot, near);
      for (const q of OLD_CT.ARP_Q) same(OLD_CT.arpeggioAs, NEW_CT.arpeggioAs, [base, q]);
    }
  });

  test('interpret·transposeShape', () => {
    const shapes = [];
    for (const root of ROOTS) for (const q of OLD_CT.Q4) {
      const st = OLD_CT.dropStructure('d2')[0];
      const p = OLD_CT.placeOn(st, [1, 2, 3, 4], root, q.id, { maxSpan: 5 })[0];
      if (p) shapes.push(p.notes);
    }
    shapes.push([{ s: 0, f: 3, pitch: 43 }], [{ s: 1, f: 2, pitch: 47 }, { s: 2, f: 2, pitch: 52 }, { s: 3, f: 1, pitch: 56 }]);
    for (const notes of shapes) {
      same(OLD_CT.interpret, NEW_CT.interpret, [notes]);
      for (const to of [0, 6, 11]) same(OLD_CT.transposeShape, NEW_CT.transposeShape, [notes, 0, to]);
    }
  });

  test('circleSteps·topFret', () => {
    for (const root of ROOTS) for (let iv = 0; iv < 12; iv++) same(OLD_CT.circleSteps, NEW_CT.circleSteps, [root, iv]);
    for (let s = 0; s < 6; s++) for (const top of ROOTS) for (const near of [0, 7, 15]) same(OLD_CT.topFret, NEW_CT.topFret, [s, top, near]);
  });

  test('scaleInfo·scaleOnBoard·scaleCircle·scaleBlocks·scaleBlockSeq (모든 스케일 × 튜닝)', () => {
    for (const sc of OLD_CT.SCALES) {
      for (const dir of [1, -1]) same(OLD_CT.scaleCircle, NEW_CT.scaleCircle, [0, sc.id, dir]);
      for (const root of ROOTS) {
        same(OLD_CT.scaleInfo, NEW_CT.scaleInfo, [root, sc.id]);
        for (const t of OLD_CT.TUNINGS) {
          same(OLD_CT.scaleOnBoard, NEW_CT.scaleOnBoard, [root, sc.id, t.open, 0, t.frets]);
          same(OLD_CT.scaleBlocks, NEW_CT.scaleBlocks, [root, sc.id, t.open, t.frets]);
        }
        for (const b of OLD_CT.scaleBlocks(root, sc.id, OLD_CT.OPEN, 17)) same(OLD_CT.scaleBlockSeq, NEW_CT.scaleBlockSeq, [b.notes]);
      }
    }
  });

  test('doubleStops (스케일 × 음정 × 루트)', () => {
    for (const sc of OLD_CT.SCALES) for (const di of OLD_CT.DOUBLE_STOP_INTERVALS) for (const root of [0, 4, 9]) {
      same(OLD_CT.doubleStops, NEW_CT.doubleStops, [{ rootPc: root, scaleId: sc.id, interval: di.id }]);
    }
    same(OLD_CT.doubleStops, NEW_CT.doubleStops, [undefined]);
  });
});

describe('CH-E-4: voicing 함수 결과 동일', () => {
  test('genVoicings·chordName (모든 루트 × 모든 CH 퀄리티, 기본·넓은 옵션)', () => {
    for (const root of ROOTS) for (const q of Object.keys(OLD_GE.CH)) {
      same(OLD_GE.genVoicings, NEW_GE.genVoicings, [root, q]);
      same(OLD_GE.genVoicings, NEW_GE.genVoicings, [root, q, { lo: 0, hi: 15, maxSpan: 4, maxNotes: 5 }]);
      same(OLD_GE.chordName, NEW_GE.chordName, [root, q]);
    }
  });

  test('pentPcs·fretStr', () => {
    for (const root of ROOTS) for (const t of ['min', 'maj']) same(OLD_GE.pentPcs, NEW_GE.pentPcs, [root, t]);
    for (const v of OLD_GE.genVoicings(0, 'maj7').slice(0, 10)) same(OLD_GE.fretStr, NEW_GE.fretStr, [v]);
  });

  test('search251 (메이저·마이너 × 기본·변형 × 펜타)', () => {
    for (const kind of ['major', 'minor']) for (const variants of [false, true]) {
      same(OLD_GE.search251, NEW_GE.search251, [{ kind, variants, keys: [0, 7], lo: 1, hi: 12, topK: 20 }]);
    }
    same(OLD_GE.search251, NEW_GE.search251, [{ kind: 'major', keys: [0], lo: 1, hi: 12, pent: { root: 9, type: 'min' }, topK: 20 }]);
  });

  test('topNoteDominants (1~3번줄 × 프렛)', () => {
    for (const s of [3, 4, 5]) for (const f of [1, 5, 8, 12]) same(OLD_GE.topNoteDominants, NEW_GE.topNoteDominants, [{ s, f }]);
  });
});

describe('CH-E-5: React가 새 위치를 쓰고 빌드 설정에 public/lib가 없다', () => {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  test('musicEngine.ts가 ./engine/*.mjs를 import한다', () => {
    const src = read('frontend/src/lib/musicEngine.ts');
    assert.match(src, /from '\.\/engine\/theory\.mjs'/);
    assert.match(src, /from '\.\/engine\/voicing\.mjs'/);
    assert.ok(!src.includes('public/lib'));
  });
  test('vite.config.ts·Dockerfile 1단계가 public/lib를 쓰지 않는다', () => {
    assert.ok(!/public(\[\\\\\/\]|\/)lib/.test(read('vite.config.ts')));
    assert.ok(!/COPY public\/lib/.test(read('Dockerfile')));
  });
});
