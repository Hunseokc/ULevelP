// 정석 코드 폼(오픈·바레): 표(chordForms.json, chords-db MIT) 조회 + 표에 없는 코드는 규칙 생성
// voicing.mjs(genVoicings — 같은 음 한 번만·3~4음)와 따로 둔다: 정석 폼은 같은 음 중복·개방현·바레가 기본이라 규칙이 다르다
// 규칙: 개발산출물/결과/CH-2c-2_정석폼.md §3. 표 JSON은 import하지 않고 인자(table)로 받는다(화면은 musicEngine.ts loadChordForms)
import GE from './voicing.mjs';

const { OPEN, DEG, NAMES } = GE;
const pc = (n) => ((n % 12) + 12) % 12;
const BASS_DEG = ['R', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];
const CLS_PT = { root: 1, 3: 3, 7: 3, 5: 0.7, ext: 1.2, bass: 1 };
// 점수 가중치 — 표 첫 폼 재현율(R2)·핵심 정석 폼(R3)으로 맞춘 값(결과/CH-2c-2_정석폼.md §4). 바꾸면 test/ch2c2가 재현율을 다시 잰다
const W = { string: 1.2, pos: 0.6, finger: 0.2, inner: 2, span: 0.6, openHigh: 1, semi: 1, lowMute: -0.3, topMute: 1, split: 0.5, barre: 1 };

// 표 검증(scripts/build_chord_forms.mjs)과 같은 규칙: 생략은 5도(+ 11·13 코드의 9), 11·13 코드의 아래 텐션은 표 폼에만 있다
function allowedExtra(quality) {
  const m = /^(m|maj|mmaj)?(11|13)/.exec(quality || '');
  if (!m) return [];
  if (m[2] === '13') return ['9', '11'];
  return quality.startsWith('11') ? ['9', '3'] : ['9'];
}
function allowedOmit(quality) {
  return /^(m|maj|mmaj)?(11|13)/.test(quality || '') ? ['5', '9'] : ['5'];
}

const AVOID = 1;

const DEF = { lo: 0, hi: 12, minStrings: 3, maxSpan: 4, maxFingers: 4, maxInnerMute: 1 };

/** 표 id: `${root}:${quality}` (+ `/${bass}`). quality가 없으면 null(표 조회 안 함) */
function formId(chord) {
  if (!chord || chord.quality == null || !Number.isInteger(chord.root)) return null;
  return `${pc(chord.root)}:${chord.quality}${chord.bass != null ? '/' + pc(chord.bass) : ''}`;
}

// 코드 → 피치클래스별 도수(같은 음 도수는 앞쪽), 필수 피치클래스, 맨 아래 음
function chordInfo(chord) {
  if (!chord || !Number.isInteger(chord.root) || !Array.isArray(chord.degrees) || !chord.degrees.length) return null;
  if (chord.degrees.some((d) => !DEG[d])) return null;
  const root = pc(chord.root);
  const byPc = new Map();
  for (const d of chord.degrees) {
    const p = pc(root + DEG[d][0]);
    if (!byPc.has(p)) byPc.set(p, { deg: d, cls: DEG[d][1] });
  }
  const okOmit = allowedOmit(chord.quality);
  const need = new Set();
  for (const d of chord.degrees) {
    const p = pc(root + DEG[d][0]);
    // 같은 음 도수는 하나만 있으면 됨 → 그 음을 내는 도수 중 하나라도 생략 불가면 필수
    if (!okOmit.includes(d)) need.add(p);
  }
  const bass = chord.bass != null ? pc(chord.bass) : null;
  if (bass != null && !byPc.has(bass)) byPc.set(bass, { deg: BASS_DEG[pc(bass - root)], cls: 'bass' });
  if (bass != null) need.add(bass);
  const extra = new Map();
  for (const d of allowedExtra(chord.quality)) {
    const p = pc(root + DEG[d][0]);
    if (!byPc.has(p)) extra.set(p, { deg: d, cls: DEG[d][1] === 'root' ? 'ext' : DEG[d][1] });
  }
  return { root, byPc, need, bottom: bass ?? root, extra };
}

// 손가락 수: 누르는 줄마다 1개에서 바레로 줄인다
//  ① 가장 낮은 누름 프렛을 2줄 이상이 쓰고 그 사이 줄이 그 프렛 이상이거나 막힘(개방현 없음)이면 검지 바레 1개
//  ② 그래도 4개를 넘으면 같은 프렛이 이어진 줄(2줄 이상)을 손가락 1개로(두 번째 바레, 예 x 3 2 3 3 3의 3프렛)
function fingering(frets) {
  const pressed = frets.map((f, s) => [s, f]).filter(([, f]) => f > 0);
  if (!pressed.length) return { fingers: 0, barres: [], split: false };
  const minF = Math.min(...pressed.map(([, f]) => f));
  let fingers = pressed.length;
  const barres = [];
  const ss = pressed.filter(([, x]) => x === minF).map(([s]) => s);
  let split = false; // 최저 프렛을 2줄 이상 누르는데 개방현에 끊겨 검지 바레가 안 됨
  if (ss.length >= 2) {
    let ok = true;
    for (let s = ss[0]; s <= ss[ss.length - 1]; s++) if (frets[s] === 0) ok = false;
    if (ok) { fingers -= ss.length - 1; barres.push(minF); } else split = true;
  }
  if (fingers > 4) {
    let best = 1; let bf = null;
    for (let s = 0; s < 6; s++) {
      const f = frets[s];
      if (!(f > 0) || barres.includes(f)) continue;
      let e = s;
      while (e + 1 < 6 && frets[e + 1] === f) e++;
      if (e - s + 1 > best) { best = e - s + 1; bf = f; }
    }
    if (bf != null) { fingers -= best - 1; barres.push(bf); }
  }
  return { fingers, barres, split };
}

// 프렛 6개 → Voicing(genVoicings 결과 모양 + kind·fingers·barres·omit). 규칙에 안 맞으면 null
// strict = 규칙 생성(구성음만·손가락·가운데 막음 검사), 아니면 표 폼(검증은 CH-2c-1에서 끝남)
function toVoicing(frets, info, chord, o, strict) {
  const sounding = [];
  for (let s = 0; s < 6; s++) if (frets[s] >= 0) sounding.push(s);
  if (sounding.length < (strict ? o.minStrings : 1)) return null;
  const first = sounding[0]; const last = sounding[sounding.length - 1];
  let inner = 0;
  for (let s = first; s <= last; s++) if (frets[s] < 0) inner++;
  const notes = [];
  for (const s of sounding) {
    const f = frets[s]; const pitch = OPEN[s] + f; const p = pc(pitch);
    const t = info.byPc.get(p) || (!strict && info.extra.get(p));
    if (!t) return null;
    notes.push({ s, f, pitch, pc: p, deg: t.deg, cls: t.cls });
  }
  if (notes[0].pc !== info.bottom) return null;
  const got = new Set(notes.map((n) => n.pc));
  for (const p of info.need) if (!got.has(p)) return null;
  const fr = notes.filter((n) => n.f > 0).map((n) => n.f);
  const span = fr.length ? Math.max(...fr) - Math.min(...fr) : 0;
  const { fingers, barres, split } = fingering(frets);
  if (strict) {
    if (inner > o.maxInnerMute) return null;
    if (span + 1 > o.maxSpan) return null;
    if (fingers > o.maxFingers) return null;
  }
  const omit = chord.degrees.filter((d) => !got.has(pc(info.root + DEG[d][0])));
  const opens = notes.filter((n) => n.f === 0).length;
  const avgFret = fr.length ? fr.reduce((a, b) => a + b, 0) / fr.length : 0;
  const pos = fr.length ? Math.min(...fr) : 0;
  const maxF = fr.length ? Math.max(...fr) : 0;
  // 점수 = 도수 점수(음 이름마다 한 번, genVoicings 표) + 울리는 줄 − 자리(최저 누름 프렛) − 손가락·폭·가운데 막음
  //        − 높은 자리(누르는 프렛 5 이상)와 섞인 개방현 − 반음 부딪힘 − 위 줄 막음 + 아래 줄 막음(근음이 5·4번 줄) − 끊긴 바레 − 바레
  let sc = 0;
  const seen = new Set();
  for (const n of notes) if (!seen.has(n.pc) && seen.add(n.pc)) sc += CLS_PT[n.cls];
  const sorted = notes.map((n) => n.pitch).sort((a, b) => a - b);
  let semi = 0;
  for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] === 1) semi++;
  // split: 최저 프렛 바레가 개방현에 끊김 → 같은 프렛을 손가락 여러 개로 따로 눌러 잡기 어렵다(예 F 1 0 3 2 1 1). 손가락 수에 비례
  sc -= semi * W.semi + first * W.lowMute + (5 - last) * W.topMute + (split ? W.split * fingers : 0) + barres.length * W.barre;
  sc += notes.length * W.string - pos * W.pos - fingers * W.finger - inner * W.inner - span * W.span;
  if (maxF > 4) sc -= opens * W.openHigh;
  const cls = new Set(notes.map((n) => n.cls));
  // 표 폼(정답지)에 3% 미만으로만 나오는 특징 — 규칙 폼 1등이 이걸 가지면 "애매"(사람 검토 목록, CH-2c-3)
  const flags = [];
  if (split) flags.push('split-barre');
  if (semi) flags.push('semitone');
  if (notes.length === 3) flags.push('three-strings');
  if (5 - last >= 2) flags.push('top-muted');
  return {
    root: info.root, q: null, name: chord.raw || NAMES[info.root], score: sc, span, outside: 0, gaps: inner,
    guide: (cls.has('3') ? 1 : 0) + (cls.has('7') ? 1 : 0), top: notes[notes.length - 1].pitch, avgFret,
    notes, frets: frets.slice(), degrees: chord.degrees.slice(), omit,
    kind: strict ? 'rule' : 'table', fingers, barres, flags,
  };
}

function opt(opts) {
  const o = Object.assign({}, DEF);
  for (const k of Object.keys(DEF)) if (opts && opts[k] != null) o[k] = opts[k];
  return o;
}

/** 표 폼(범위 lo~hi 안, 개방현은 lo 0일 때만) → Voicing[] 점수 순. 표 없음·id 없음 → [] */
function tableForms(chord, table, opts) {
  const o = opt(opts);
  const info = chordInfo(chord);
  const id = formId(chord);
  const hit = info && id && table && table.forms && table.forms[id];
  if (!hit || o.lo > o.hi) return [];
  const out = [];
  for (const f of hit.forms) {
    if (f.frets.some((x) => x >= 0 && (x < o.lo || x > o.hi))) continue;
    const v = toVoicing(f.frets, info, chord, o, false);
    if (!v) continue;
    // 사람 검토 폼(src 'review')은 손가락 번호가 없다 → 규칙 판정(fingering) 값 그대로
    if (f.fingers && f.fingers.some((x) => x > 0)) v.fingers = new Set(f.fingers.filter((x) => x > 0)).size;
    v.barres = (f.barres || v.barres).slice();
    v.src = f.src;
    if (f.fix) v.fix = f.fix;
    out.push(v);
  }
  return out.sort((a, b) => b.score - a.score);
}

/** 규칙 생성: 6줄 × (막음 | lo~hi의 구성음 프렛) 전부 → 규칙(§3) 통과만, 점수 순. 잘못된 입력 → [] */
function ruleForms(chord, opts) {
  const o = opt(opts);
  const info = chordInfo(chord);
  if (!info || o.lo > o.hi || o.lo < 0) return [];
  const choices = [];
  for (let s = 0; s < 6; s++) {
    const c = [-1];
    for (let f = o.lo; f <= o.hi; f++) if (info.byPc.has(pc(OPEN[s] + f))) c.push(f);
    choices.push(c);
  }
  const out = [];
  const frets = [];
  function dfs(s, mn, mx, started) {
    if (s === 6) {
      if (!started) return;
      const v = toVoicing(frets, info, chord, o, true);
      if (v) out.push(v);
      return;
    }
    for (const f of choices[s]) {
      if (f >= 0 && !started && pc(OPEN[s] + f) !== info.bottom) continue; // 맨 아래 = 근음/베이스
      let a = mn; let b = mx;
      if (f > 0) { a = Math.min(a, f); b = Math.max(b, f); if (b - a + 1 > o.maxSpan) continue; }
      frets.push(f);
      dfs(s + 1, a, b, started || f >= 0);
      frets.pop();
    }
  }
  dfs(0, Infinity, -Infinity, false);
  out.sort((a, b) => b.score - a.score);
  // 자동 회피: 1등이 드문 특징(flags)을 가지면, 1등 점수와 AVOID 이내이면서 flags 없는 첫 후보를 1등으로 올린다
  // (표 코드 재현율 R2 1등 52.8 → 50.3%, 5등 안 82.9% 그대로 · 표에 없는 코드의 애매 11.9 → 4.1% — 결과/CH-2c-3_정석폼검토.md)
  if (out.length > 1 && out[0].flags.length) {
    const i = out.findIndex((v) => v.score >= out[0].score - AVOID && !v.flags.length);
    // 점수도 1등 바로 위로 맞춘다(chordCandidates·bestPaths가 다시 점수로 정렬해도 순서 유지, 올라간 점수 ≤ AVOID)
    if (i > 0) { const v = out.splice(i, 1)[0]; v.score = out[0].score + 0.001; v.avoided = true; out.unshift(v); }
  }
  return out;
}

/** 표 조회 우선: 범위 안 표 폼이 있으면 표만, 없으면 규칙 생성. 사람 검토에서 "정석 폼 없음"(none)으로 정한 코드 → [] */
function standardForms(chord, table, opts) {
  const id = formId(chord);
  if (id && table && table.forms && table.forms[id] && table.forms[id].none) return [];
  const t = tableForms(chord, table, opts);
  return t.length ? t : ruleForms(chord, opts);
}

/** 정석 폼 표 + 사람 검토 결과(chordFormReview.json)를 합친 새 표. 같은 id는 표가 우선(검토 목록은 표에 없는 코드만) */
function withReview(table, review) {
  if (!table) return table;
  const forms = Object.assign({}, table.forms);
  for (const [id, e] of Object.entries((review && review.forms) || {})) if (!forms[id]) forms[id] = e;
  return Object.assign({}, table, { forms });
}

export { formId, tableForms, ruleForms, standardForms, withReview };
