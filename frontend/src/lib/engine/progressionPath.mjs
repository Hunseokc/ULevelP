// 진행 보이싱 경로: 코드마다 보이싱 후보를 만들고 이웃 사이 이동 비용(GE.trans)이 작은 연결을 고른다
// search251(2-5-1 고정 3코드)을 길이 N 진행으로 넓힌 DP. 점수 = 보이싱 점수 합 - 이동 비용 합 (search251과 같은 식)
import GE from './voicing.mjs';
import { standardForms } from './chordShapes.mjs';

const DEF = { lo: 1, hi: 12, topK: 30, paths: 3, loop: false, shapes: 'compact' };
const VOPT_KEYS = ['lo', 'hi', 'maxSpan', 'minNotes', 'maxNotes', 'maxGap', 'needGuide', 'outsideMax', 'allowedPcs'];
const SHAPES = ['compact', 'standard', 'both'];

// 한 코드(베이스 그대로)의 후보: compact = genVoicingsByDegrees(재즈식 3~4음, 기존 결과),
// standard = 정석 폼(표 → 없으면 규칙, chordShapes.mjs). 정석 폼의 lo 기본은 0(개방현), compact는 1 그대로
function gen(chord, o, opts) {
  let out = [];
  if (o.shapes !== 'standard') {
    const vopt = {};
    for (const k of VOPT_KEYS) if (o[k] !== undefined) vopt[k] = o[k];
    if (chord.raw) vopt.name = chord.raw;
    if (chord.bass != null) vopt.bass = chord.bass;
    out = GE.genVoicingsByDegrees(chord.root, chord.degrees, vopt);
    if (o.shapes === 'both') for (const v of out) v.kind = 'compact'; // compact 기본은 결과 객체도 그대로
  }
  if (o.shapes !== 'compact') {
    const sopt = { lo: opts.lo ?? 0, hi: o.hi };
    const seen = new Set(out.map((v) => v.frets.join(',')));
    for (const v of standardForms(chord, o.formTable, sopt)) if (!seen.has(v.frets.join(','))) out.push(v);
  }
  return out;
}

// chord: CH-2 parseChord 결과 모양 { root, degrees, quality?, bass?, raw? } — quality가 있어야 정석 폼 표를 찾는다
// opts.shapes: 'compact'(기본, 기존 결과) | 'standard'(정석 폼만) | 'both'(둘 다 점수 순). opts.formTable = chordForms.json
// 슬래시 베이스로 보이싱이 없으면 베이스 없이 다시 만든다(bassDropped: true). 모르는 shapes → 후보 0개
function chordCandidates(chord, opts) {
  const o = Object.assign({}, DEF, opts || {});
  if (!SHAPES.includes(o.shapes)) return { voicings: [], bassDropped: false };
  let voicings = gen(chord, o, opts || {});
  let bassDropped = false;
  if (!voicings.length && chord.bass != null) {
    voicings = gen(Object.assign({}, chord, { bass: undefined }), o, opts || {});
    bassDropped = voicings.length > 0;
  }
  voicings.sort((a, b) => b.score - a.score);
  return { voicings: voicings.slice(0, o.topK), bassDropped };
}

// 상위 o.paths개 경로 [{ total, cost, voicings }]. 시작 보이싱마다 가장 좋은 경로 하나씩 구해(서로 다른 시작 = 다른 자리)
// 점수 순으로 고른다. o.loop면 마지막 → 첫 코드 이동도 비용에 넣는다. 코드가 없거나 후보 없는 코드가 있으면 []
function bestPaths(chords, opts) {
  const o = Object.assign({}, DEF, opts || {});
  if (!Array.isArray(chords) || !chords.length) return [];
  const cache = new Map();
  const cand = chords.map((c) => {
    const key = [c.root, c.degrees.join(','), c.quality ?? '', c.bass ?? '', c.raw ?? ''].join('|');
    if (!cache.has(key)) cache.set(key, chordCandidates(c, opts).voicings); // DEF는 chordCandidates가 합친다(정석 폼 lo 기본 0 유지)
    return cache.get(key);
  });
  if (cand.some((vs) => !vs.length)) return [];
  const N = cand.length;
  // T[i][k][j] = trans(cand[i][k], cand[i+1][j])
  const T = [];
  for (let i = 0; i + 1 < N; i++) T.push(cand[i].map((a) => cand[i + 1].map((b) => GE.trans(a, b))));

  const found = [];
  cand[0].forEach((start, s) => {
    // best[j] = 시작 s에서 cand[i][j]까지 (점수 - 비용) 최대, prev[i - 1][j] = 직전 후보 번호
    let best = cand[0].map((_, k) => (k === s ? start.score : -Infinity));
    const prev = [];
    for (let i = 1; i < N; i++) {
      const nb = []; const np = [];
      cand[i].forEach((v, j) => {
        let bv = -Infinity; let bk = -1;
        best.forEach((x, k) => {
          const y = x - T[i - 1][k][j];
          if (y > bv) { bv = y; bk = k; }
        });
        nb.push(bv + v.score); np.push(bk);
      });
      prev.push(np);
      best = nb;
    }
    let bj = -1; let bt = -Infinity;
    best.forEach((x, j) => {
      const t = o.loop && N > 1 ? x - GE.trans(cand[N - 1][j], start) : x;
      if (t > bt) { bt = t; bj = j; }
    });
    const pick = [bj];
    for (let i = N - 1; i >= 1; i--) pick.unshift(prev[i - 1][pick[0]]);
    const voicings = pick.map((j, i) => cand[i][j]);
    const score = voicings.reduce((a, v) => a + v.score, 0);
    found.push({ total: bt, cost: score - bt, voicings });
  });
  found.sort((a, b) => b.total - a.total);
  return found.slice(0, o.paths);
}

export { chordCandidates, bestPaths };
