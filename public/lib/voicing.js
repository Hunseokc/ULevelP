// 기타 보이싱 생성 + 펜타토닉 박스 2-5-1 탐색 + 탑노트 고정 도미넌트 열거
const GE = (function () {
  const OPEN = [40, 45, 50, 55, 59, 64]; // 6E 5A 4D 3G 2B 1e (index 0 = 6번줄)
  const STR_LABEL = ['6', '5', '4', '3', '2', '1'];
  const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const pc = (n) => ((n % 12) + 12) % 12;

  // degree label -> [interval, class]
  const DEG = {
    R: [0, 'root'], b9: [1, 'ext'], 9: [2, 'ext'], '#9': [3, 'ext'], b3: [3, '3'], 3: [4, '3'],
    11: [5, 'ext'], '#11': [6, 'ext'], b5: [6, '5'], 5: [7, '5'], b13: [8, 'ext'], 13: [9, 'ext'],
    6: [9, '7'], b7: [10, '7'], 7: [11, '7'], 4: [5, '3'],
  };
  const CH = {
    maj7: ['R', '3', '5', '7'], maj9: ['R', '3', '5', '7', '9'], 6: ['R', '3', '5', '6'],
    maj7s11: ['R', '3', '5', '7', '#11'],
    m7: ['R', 'b3', '5', 'b7'], m9: ['R', 'b3', '5', 'b7', '9'], m11: ['R', 'b3', '5', 'b7', '11'],
    m6: ['R', 'b3', '5', '6'], m7b5: ['R', 'b3', 'b5', 'b7'],
    7: ['R', '3', '5', 'b7'], 9: ['R', '3', '5', 'b7', '9'], 13: ['R', '3', '5', 'b7', '13'],
    '7b9': ['R', '3', '5', 'b7', 'b9'], '7#9': ['R', '3', '5', 'b7', '#9'],
    '7#11': ['R', '3', '5', 'b7', '#11'], '7b13': ['R', '3', '5', 'b7', 'b13'],
    '7sus4': ['R', '4', '5', 'b7'],
  };
  const DOMS = ['7', '9', '13', '7b9', '7#9', '7#11', '7b13'];
  const chordTones = (q) => CH[q].map((d) => ({ deg: d, iv: DEG[d][0], cls: DEG[d][1] }));
  const chordName = (root, q) => NAMES[pc(root)] + q.replace('maj', 'maj').replace(/^7$/, '7');

  const PENT = { min: [0, 3, 5, 7, 10], maj: [0, 2, 4, 7, 9] };
  const pentPcs = (root, type) => PENT[type].map((i) => pc(root + i));

  const DEF = { lo: 1, hi: 12, maxSpan: 3, minNotes: 3, maxNotes: 4, maxGap: 1, needGuide: 2, allowedPcs: null, outsideMax: 99, top: null };

  function genVoicings(root, q, opts) {
    const o = Object.assign({}, DEF, opts || {});
    const tones = chordTones(q);
    const byPc = {};
    tones.forEach((t) => { byPc[pc(root + t.iv)] = t; });
    const allowed = o.allowedPcs ? new Set(o.allowedPcs) : null;
    const opt = [];
    for (let s = 0; s < 6; s++) {
      opt[s] = [];
      if (o.top && s > o.top.s) continue;
      for (let f = o.lo; f <= o.hi; f++) {
        if (o.top && s === o.top.s && f !== o.top.f) continue;
        if (byPc[pc(OPEN[s] + f)]) opt[s].push(f);
      }
    }
    const out = [];
    const notes = [];
    const used = new Set();
    function finalize() {
      if (notes.length < o.minNotes) return;
      if (o.top && notes[notes.length - 1].s !== o.top.s) return;
      const cls = new Set(notes.map((n) => n.tone.cls));
      const guide = (cls.has('3') ? 1 : 0) + (cls.has('7') ? 1 : 0);
      if (guide < o.needGuide) return;
      // 9, 13, b9 같은 확장음 코드는 그 확장음이 실제로 들어 있어야 해당 코드로 인정
      const defTone = tones[tones.length - 1];
      if (defTone.cls === 'ext' && !notes.some((n) => n.tone.deg === defTone.deg)) return;
      const outside = allowed ? notes.filter((n) => !allowed.has(n.pc)).length : 0;
      if (outside > o.outsideMax) return;
      const fr = notes.filter((n) => n.f > 0).map((n) => n.f);
      const span = fr.length ? Math.max(...fr) - Math.min(...fr) : 0;
      let sc = 0;
      for (const n of notes) {
        sc += { root: 1, 3: 3, 7: 3, 5: 0.7, ext: 1.2 }[n.tone.cls];
      }
      sc += notes.length * 0.5 - outside * 1.5 - span * 0.35;
      let gaps = 0;
      for (let i = 1; i < notes.length; i++) {
        gaps += notes[i].s - notes[i - 1].s - 1;
        if (Math.abs(notes[i].pitch - notes[i - 1].pitch) === 1) sc -= 1;
      }
      sc -= gaps * 0.5;
      const top = notes[notes.length - 1].pitch;
      sc -= 0.12 * Math.abs(top - 70);
      out.push({
        root, q, name: chordName(root, q), score: sc, span, outside, gaps,
        guide, top, avgFret: fr.length ? fr.reduce((a, b) => a + b, 0) / fr.length : 0,
        notes: notes.map((n) => ({ s: n.s, f: n.f, pitch: n.pitch, pc: n.pc, deg: n.tone.deg, cls: n.tone.cls })),
        frets: [0, 1, 2, 3, 4, 5].map((s) => { const n = notes.find((x) => x.s === s); return n ? n.f : -1; }),
      });
    }
    function dfs(s, skipped, gaps) {
      if (s === 6) { finalize(); return; }
      if (notes.length === 0) dfs(s + 1, 0, gaps);
      else dfs(s + 1, skipped + 1, gaps);
      if (notes.length >= o.maxNotes) return;
      for (const f of opt[s]) {
        let ng = gaps;
        if (notes.length > 0) { if (skipped > 1) continue; ng = gaps + skipped; if (ng > o.maxGap) continue; }
        const pitch = OPEN[s] + f; const p = pc(pitch);
        if (used.has(p)) continue;
        const fr = notes.filter((n) => n.f > 0).map((n) => n.f).concat(f > 0 ? [f] : []);
        if (fr.length && Math.max(...fr) - Math.min(...fr) > o.maxSpan) continue;
        notes.push({ s, f, pitch, pc: p, tone: byPc[p] }); used.add(p);
        dfs(s + 1, 0, ng);
        notes.pop(); used.delete(p);
      }
    }
    dfs(0, 0, 0);
    return out;
  }

  const pitchOf = (v, cls) => { const n = v.notes.find((x) => x.cls === cls); return n ? n.pitch : null; };
  function trans(a, b) {
    let c = 0;
    const p7 = pitchOf(a, '7'); const p3 = pitchOf(b, '3');
    if (p7 == null || p3 == null) c += 3; else c += Math.abs(p7 - p3);
    c += 0.5 * Math.abs(a.top - b.top);
    c += 0.5 * Math.abs(a.avgFret - b.avgFret);
    return c;
  }

  const SLOTS = {
    major: { ii: ['m7', 'm9', 'm11'], V: DOMS, I: ['maj7', 'maj9', '6', 'maj7s11'] },
    minor: { ii: ['m7b5'], V: DOMS, I: ['m7', 'm6', 'm9'] },
  };
  const BASIC = { major: { ii: ['m7'], V: ['7'], I: ['maj7'] }, minor: { ii: ['m7b5'], V: ['7'], I: ['m7'] } };

  // 2-5-1 탐색. o: {kind, keys, pent:{root,type}|null, lo, hi, variants, topK, perKey, ...voicingOpts}
  function search251(o) {
    const kind = o.kind || 'major';
    const keys = o.keys || [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const slots = o.variants ? SLOTS[kind] : BASIC[kind];
    const vopt = {
      lo: o.lo, hi: o.hi, maxSpan: o.maxSpan ?? 3, minNotes: o.minNotes ?? 3, maxNotes: o.maxNotes ?? 4,
      needGuide: o.needGuide ?? 2, outsideMax: o.outsideMax ?? 1,
      allowedPcs: o.pent ? pentPcs(o.pent.root, o.pent.type) : null,
    };
    const K = o.topK || 45;
    const results = [];
    for (const k of keys) {
      const roots = { ii: pc(k + 2), V: pc(k + 7), I: pc(k) };
      const cand = {};
      for (const sl of ['ii', 'V', 'I']) {
        let all = [];
        for (const q of slots[sl]) all = all.concat(genVoicings(roots[sl], q, vopt));
        all.sort((a, b) => b.score - a.score);
        cand[sl] = all.slice(0, K);
      }
      if (!cand.ii.length || !cand.V.length || !cand.I.length) { results.push({ key: k, paths: [] }); continue; }
      const paths = [];
      for (const a of cand.ii) for (const b of cand.V) {
        const t1 = trans(a, b);
        for (const c of cand.I) {
          const t2 = trans(b, c);
          paths.push({ total: a.score + b.score + c.score - (t1 + t2), cost: t1 + t2, chords: [a, b, c] });
        }
      }
      paths.sort((x, y) => y.total - x.total);
      // 서로 다른 모양 위주로 상위 N개
      const picked = []; const seen = new Set();
      for (const p of paths) {
        const sig = p.chords.map((c) => c.frets.join(',')).join('|');
        const sig2 = p.chords[1].frets.join(',');
        if (seen.has(sig2)) continue;
        seen.add(sig2); picked.push(p);
        if (picked.length >= (o.perKey || 3)) break;
      }
      results.push({ key: k, paths: picked });
    }
    return results;
  }

  // 탑노트 고정: 1~3번줄(index 5,4,3) 위의 한 음을 맨 위로 하는 모든 도미넌트 계열 보이싱
  function topNoteDominants(o) {
    const { s, f } = o; // s: string index (3,4,5), f: fret
    const topPc = pc(OPEN[s] + f);
    const quals = o.qualities || DOMS;
    const res = [];
    for (let root = 0; root < 12; root++) {
      for (const q of quals) {
        if (!CH[q].some((d) => pc(root + DEG[d][0]) === topPc)) continue;
        const vs = genVoicings(root, q, {
          lo: Math.max(o.allowOpen ? 0 : 1, f - (o.maxSpan ?? 3)), hi: f + (o.maxSpan ?? 3),
          maxSpan: o.maxSpan ?? 3, minNotes: o.minNotes ?? 3, maxNotes: o.maxNotes ?? 4,
          needGuide: o.needGuide ?? 2, top: { s, f },
        });
        vs.sort((a, b) => b.score - a.score);
        if (vs.length) {
          const topDeg = vs[0].notes[vs[0].notes.length - 1].deg;
          res.push({ root, q, name: chordName(root, q), topDeg, voicings: vs.slice(0, o.perChord || 3), count: vs.length });
        }
      }
    }
    return res;
  }

  // 지판 텍스트
  const fretStr = (v) => v.frets.map((x) => (x < 0 ? 'x' : x)).join(' ');
  return { OPEN, STR_LABEL, NAMES, DEG, CH, DOMS, pc, pentPcs, genVoicings, search251, topNoteDominants, chordName, fretStr };
})();
if (typeof module !== 'undefined') module.exports = GE;
