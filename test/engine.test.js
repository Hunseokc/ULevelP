'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CT = require('../public/lib/theory.js');
const GE = require('../public/lib/voicing.js');
const { routes } = require('../server.js');

const q = (o) => new URLSearchParams(o);

test('Cmaj7 Drop 2 기본형은 1-2-3-4번줄에서 x x 10 12 12 12', () => {
  const st = CT.dropStructure('d2')[0];
  const p = CT.placeOn(st, [2, 3, 4, 5], 0, 'maj7', {}).find((x) => x.ok);
  assert.deepEqual(p.frets, [10, 12, 12, 12]);
});

test('같은 자리에서 maj7 -> 7 은 7도 줄만 1프렛 내려간다', () => {
  const st = CT.dropStructure('d2')[0];
  const m = CT.mutation('maj7', '7', st, [2, 3, 4, 5]);
  assert.equal(m.length, 1);
  assert.equal(m[0].delta, -1);
  assert.equal(m[0].to, 'b7');
});

test('2-note-per-string 은 줄마다 정확히 두 음', () => {
  const ns = CT.arpeggio2nps(0, 0, 3);
  assert.equal(ns.length, 12);
  for (let s = 0; s < 6; s++) assert.equal(ns.filter((n) => n.s === s).length, 2);
  for (let i = 1; i < ns.length; i++) assert.ok(ns[i].pitch > ns[i - 1].pitch);
});

test('F# A C# G# 배열은 Dmaj7(#11), Ebm7(b5), Ab7sus4(b9) 로 해석된다', () => {
  const notes = [[2, 4], [3, 2], [4, 2], [5, 4]].map(([s, f]) => ({ s, f, pitch: CT.OPEN[s] + f }));
  const names = CT.interpret(notes).map((x) => x.name);
  assert.ok(names.includes('Dmaj7(#11)'));
  assert.ok(names.some((n) => n.startsWith('Ebm7(b5')));
  assert.ok(names.includes('Ab7sus4(b9)'));
});

test('5도권: F9 탑 G 는 Bb13, Eb7(3도) 로 이어지고 Ab 칸은 불가', () => {
  const st = CT.circleSteps(5, 2);
  assert.deepEqual(st.slice(0, 3).map((s) => s.deg), ['9', '13', '3']);
  assert.equal(st[3].q, null);
});

test('도미넌트 텐션 코드는 그 텐션이 실제로 들어간 폼만 나온다', () => {
  const vs = GE.genVoicings(0, '7b9', { lo: 1, hi: 12 });
  assert.ok(vs.length > 0);
  assert.ok(vs.every((v) => v.notes.some((n) => n.deg === 'b9')));
});

test('API: interpret 는 잘못된 입력에 오류를 낸다', () => {
  assert.throws(() => routes['/api/interpret'](q({ frets: '1,2' })));
  const ok = routes['/api/interpret'](q({ frets: 'x,x,4,2,2,4' }));
  assert.ok(ok.length >= 4);
});

test('API: matrix, circle, voicings 응답 형태', () => {
  assert.ok(routes['/api/matrix'](q({ root: 'C', drop: 'd2', inv: '0' }))[0].qualities.length === 9);
  assert.equal(routes['/api/circle'](q({ root: 'F', top: '2' })).length, 12);
  assert.equal(routes['/api/voicings'](q({ root: 'G', quality: '13' })).chord, 'G13');
});

test('스케일 음이름: 도수마다 글자를 하나씩 쓴다', () => {
  const names = (r, s) => CT.scaleInfo(r, s).notes.map((n) => n.name).join(' ');
  assert.equal(names(0, 'pentMaj'), 'C D E G A');
  assert.equal(names(2, 'harmMinor'), 'D E F G A Bb C#');
  assert.equal(names(6, 'major'), 'Gb Ab Bb Cb Db Eb F');
  assert.equal(names(11, 'lydian'), 'B C# D# E# F# G# A#');
});

test('5도권 순환: 메이저 스케일은 키마다 한 음만 바뀐다', () => {
  const ks = CT.scaleCircle(0, 'major', 1);
  assert.deepEqual(ks.map((k) => k.rootName).slice(0, 4), ['C', 'G', 'D', 'A']);
  assert.deepEqual([ks[1].removed, ks[1].added], [['F'], ['F#']]);
  ks.forEach((k) => assert.equal(k.added.length, 1));
  assert.deepEqual(CT.scaleCircle(0, 'major', -1).map((k) => k.rootName).slice(0, 3), ['C', 'F', 'Bb']);
});

test('지판 위 스케일: 6현 0~12프렛 C 메이저 펜타는 줄마다 5~6개', () => {
  const ns = CT.scaleOnBoard(0, 'pentMaj', CT.TUNING_BY.g6.open, 0, 12);
  for (let s = 0; s < 6; s++) { const c = ns.filter((n) => n.s === s).length; assert.ok(c >= 5 && c <= 6); }
  assert.ok(ns.filter((n) => n.isRoot).every((n) => CT.pc(n.pitch) === 0));
});

test('API: scale 기본 조회 및 화성·가락단음계 block=400 거부', () => {
  const r = routes['/api/scale'](q({ root: 'A', type: 'pentMin', tuning: 'b4', lo: '5', hi: '8' }));
  assert.equal(r.name, 'A Pentatonic Minor');
  assert.ok(r.positions.every((p) => p.fret >= 5 && p.fret <= 8 && p.string >= 1 && p.string <= 4));
  assert.equal(routes['/api/scale'](q({ root: 'C', circle: '5' })).length, 12);
  assert.throws(() => routes['/api/scale'](q({ type: 'nope' })));

  // CAGED 블럭 API 정상 호출
  const blkRes = routes['/api/scale'](q({ root: 'C', type: 'major', tuning: 'g6', block: '1' }));
  assert.equal(blkRes.block.shape, 'A');
  assert.equal(blkRes.positions.length, 16);
  assert.equal(blkRes.sequence.length, 31);

  // 화성·가락단음계는 CAGED block 요청 시 400 BadRequest 예외 발생 (전체 지판 조회는 정상)
  assert.equal(routes['/api/scale'](q({ root: 'A', type: 'harmMinor' })).name, 'A Harmonic Minor');
  assert.throws(() => routes['/api/scale'](q({ root: 'C', type: 'harmMinor', block: '1' })));
  assert.throws(() => routes['/api/scale'](q({ root: 'A', type: 'melMinor', block: '2' })));
  assert.throws(() => routes['/api/scale'](q({ root: 'C', type: 'major', block: '6' })));
});

test('CAGED 5블럭: C Major #1 (A) Shape 구성음 및 표준 루프 시퀀스 (5번줄 3f C -> 1번줄 5f A -> 6번줄 3f G -> 5번줄 3f C)', () => {
  assert.deepEqual(CT.TUNING_BY.b6.open, [23, 28, 33, 38, 43, 48]);
  assert.equal(CT.TUNING_BY.b6.frets, 20);

  const blocks = CT.scaleBlocks(0, 'major', CT.TUNING_BY.g6.open, 22);
  assert.equal(blocks.length, 5);
  const b1 = blocks[0];
  assert.equal(b1.blockId, 1);
  assert.equal(b1.shape, 'A');
  assert.equal(b1.lo, 2);
  assert.equal(b1.hi, 6);
  assert.equal(b1.notes.length, 16);

  const lowestRoot = b1.notes.find((n) => n.isLowestRoot);
  assert.deepEqual({ s: lowestRoot.s, f: lowestRoot.f, pitch: lowestRoot.pitch, name: lowestRoot.name }, { s: 1, f: 3, pitch: 48, name: 'C' });

  const seq = CT.scaleBlockSeq(b1.notes);
  assert.equal(seq.length, 31);
  assert.deepEqual({ s: seq[0].s, f: seq[0].f, name: seq[0].name }, { s: 1, f: 3, name: 'C' });
  assert.deepEqual({ s: seq[12].s, f: seq[12].f, name: seq[12].name }, { s: 5, f: 5, name: 'A' });
  assert.deepEqual({ s: seq[27].s, f: seq[27].f, name: seq[27].name }, { s: 0, f: 3, name: 'G' });
  assert.deepEqual({ s: seq[30].s, f: seq[30].f, name: seq[30].name }, { s: 1, f: 3, name: 'C' });
});

test('CAGED 5블럭: 관계장조 창 기준으로 12종 스케일 × 12키 × 5종 튜닝 전수에서 줄당 2~3음(최대 3음)을 만족한다', () => {
  const cagedScales = CT.SCALES.filter((s) => s.id !== 'harmMinor' && s.id !== 'melMinor');
  assert.equal(cagedScales.length, 12);

  for (const sc of cagedScales) {
    for (let rootPc = 0; rootPc < 12; rootPc++) {
      for (const tuning of CT.TUNINGS) {
        const blocks = CT.scaleBlocks(rootPc, sc.id, tuning.open, tuning.frets);
        assert.equal(blocks.length, 5);
        for (const blk of blocks) {
          for (let s = 0; s < tuning.open.length; s++) {
            const count = blk.notes.filter((n) => n.s === s).length;
            assert.ok(
              count >= 2 && count <= 3,
              `${sc.id} root=${rootPc} tuning=${tuning.id} block=#${blk.blockId} s=${s} count=${count}`
            );
          }
          for (let i = 1; i < blk.notes.length; i++) {
            assert.ok(blk.notes[i].pitch > blk.notes[i - 1].pitch);
          }
        }
      }
    }
  }

  // A 마이너 펜타토닉 #3 (E Shape) 누락 버그 회귀 검증: 7~10프렛, 6줄 모두 2음씩 총 12음
  const aPentMin3 = CT.scaleBlocks(9, 'pentMin', CT.TUNING_BY.g6.open, 22)[2];
  assert.equal(aPentMin3.lo, 7);
  assert.equal(aPentMin3.hi, 10);
  assert.equal(aPentMin3.notes.length, 12);

  // A 블루스 #2 (G Shape) 표준 박스1 검증: 5번줄 5f(D)·6f(Eb, b5)·7f(E)
  const aBlues2 = CT.scaleBlocks(9, 'blues', CT.TUNING_BY.g6.open, 22)[1];
  const str5 = aBlues2.notes.filter((n) => n.s === 1);
  assert.deepEqual(str5.map((n) => [n.f, n.deg]), [[5, '4'], [6, 'b5'], [7, '5']]);
});

test('더블 스탑: 3도·6도·4도 계산 및 /api/double-stops 응답 검증', () => {
  const thirds = CT.doubleStops({ rootPc: 0, scaleId: 'major', interval: '3rd', pair: [3, 4], open: CT.OPEN, lo: 0, hi: 17 });
  assert.ok(thirds.length >= 10);
  const cE = thirds.find((p) => p.notes[0].f === 5 && p.notes[1].f === 5);
  assert.ok(cE);
  assert.equal(cE.label, 'C+E');
  assert.equal(cE.isRootPair, true);

  const dF = thirds.find((p) => p.notes[0].f === 7 && p.notes[1].f === 6);
  assert.ok(dF);
  assert.equal(dF.label, 'D+F');

  const sixths = CT.doubleStops({ rootPc: 0, scaleId: 'major', interval: '6th', pair: [2, 4], open: CT.OPEN, lo: 0, hi: 17 });
  assert.ok(sixths.length >= 10);
  assert.ok(sixths.every((p) => p.span <= 3));

  const fourths = CT.doubleStops({ rootPc: 0, scaleId: 'pentMin', interval: '4th', pair: [3, 4], open: CT.OPEN, lo: 0, hi: 17 });
  assert.ok(fourths.length >= 5);

  const apiRes = routes['/api/double-stops'](q({ root: 'C', type: 'major', interval: '3rd', pair: '2-3' }));
  assert.equal(apiRes.name, 'C Major (Ionian)');
  assert.equal(apiRes.interval, '3rd');
  assert.equal(apiRes.strings, '2-3');
  assert.equal(apiRes.count, thirds.length);
  assert.throws(() => routes['/api/double-stops'](q({ interval: '2nd' })));
  assert.throws(() => routes['/api/double-stops'](q({ pair: '2-2' })));
});