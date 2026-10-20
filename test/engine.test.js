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

test('F# A C# G# 배열은 Dmaj7(#11), Ebm7(b5), Ab7sus4(b9) 로 우길 수 있다', () => {
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

test('API: scale', () => {
  const r = routes['/api/scale'](q({ root: 'A', type: 'pentMin', tuning: 'b4', lo: '5', hi: '8' }));
  assert.equal(r.name, 'A Pentatonic Minor');
  assert.ok(r.positions.every((p) => p.fret >= 5 && p.fret <= 8 && p.string >= 1 && p.string <= 4));
  assert.equal(routes['/api/scale'](q({ root: 'C', circle: '5' })).length, 12);
  assert.throws(() => routes['/api/scale'](q({ type: 'nope' })));
});
