// 코드 연습 이론 엔진: 4성 보이싱 매트릭스, 2-note-per-string, 보이싱 재해석, 5도권 탑노트
const CT = (function () {
  const OPEN = [40, 45, 50, 55, 59, 64]; // index 0 = 6번줄(저음 E)
  const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const pc = (n) => ((n % 12) + 12) % 12;
  const strName = (s) => (6 - s) + '번줄';

  // ---------- 4성 코드 성질 (슬롯: 근음 / 3도 자리 / 5도 자리 / 7도 자리) ----------
  const Q4 = [
    { id: 'maj7', name: 'maj7', iv: [0, 4, 7, 11], deg: ['R', '3', '5', '7'] },
    { id: 'maj7sus2', name: 'maj7(sus2)', iv: [0, 2, 7, 11], deg: ['R', '2', '5', '7'] },
    { id: '7', name: '7', iv: [0, 4, 7, 10], deg: ['R', '3', '5', 'b7'] },
    { id: '7sus4', name: '7sus4', iv: [0, 5, 7, 10], deg: ['R', '4', '5', 'b7'] },
    { id: '6', name: '6', iv: [0, 4, 7, 9], deg: ['R', '3', '5', '6'] },
    { id: 'm7', name: 'm7', iv: [0, 3, 7, 10], deg: ['R', 'b3', '5', 'b7'] },
    { id: 'm6', name: 'm6', iv: [0, 3, 7, 9], deg: ['R', 'b3', '5', '6'] },
    { id: 'm7b5', name: 'm7(b5)', iv: [0, 3, 6, 10], deg: ['R', 'b3', 'b5', 'b7'] },
    { id: 'dim7', name: 'dim7', iv: [0, 3, 6, 9], deg: ['R', 'b3', 'b5', 'bb7'] },
  ];
  const QBY = Object.fromEntries(Q4.map((q) => [q.id, q]));
  const SLOT_NAME = ['근음', '3도', '5도', '7도'];
  const SLOT_CLS = ['root', 'guide', 'other', 'guide'];

  const DROPS = [
    { id: 'close', name: 'Close', drop: [] },
    { id: 'd2', name: 'Drop 2', drop: [2] },
    { id: 'd3', name: 'Drop 3', drop: [3] },
    { id: 'd4', name: 'Drop 4', drop: [4] },
    { id: 'd24', name: 'Drop 2&4', drop: [2, 4] },
    { id: 'd23', name: 'Drop 2&3', drop: [2, 3] },
  ];
  const INV_NAME = ['기본형 (베이스 근음)', '1전위 (베이스 3도)', '2전위 (베이스 5도)', '3전위 (베이스 7도)'];

  // 드롭 구조: 베이스 슬롯(전위) -> 아래에서 위로 [{slot, rel}] (maj7 기준 반음)
  function dropStructure(dropId) {
    const d = DROPS.find((x) => x.id === dropId);
    const base = QBY.maj7.iv;
    const out = {};
    for (let r = 0; r < 4; r++) {
      const slots = [0, 1, 2, 3].map((i) => (r + i) % 4);
      let prev = -Infinity;
      let v = slots.map((s) => {
        let p = base[s];
        while (p <= prev) p += 12;
        prev = p;
        return { slot: s, rel: p };
      });
      const desc = v.slice().sort((a, b) => b.rel - a.rel);
      d.drop.forEach((k) => { desc[k - 1].rel -= 12; });
      v = desc.sort((a, b) => a.rel - b.rel);
      const shift = Math.floor(v[0].rel / 12) * 12;
      v.forEach((n) => { n.rel -= shift; });
      out[v[0].slot] = v;
    }
    return out; // key: inversion (bass slot)
  }

  // 모든 4줄 조합 (아래 줄 -> 위 줄)
  const STRING_SETS = [];
  for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) for (let c = b + 1; c < 6; c++) for (let d = c + 1; d < 6; d++) STRING_SETS.push([a, b, c, d]);
  const setLabel = (set) => set.slice().reverse().map((s) => 6 - s).reverse().join('-'); // e.g. "6-5-4-3"
  const setLabelHi = (set) => set.slice().reverse().map((s) => 6 - s).join('-'); // 위 줄부터 "1-2-3-4"
  const isAdjacent = (set) => set[3] - set[0] === 3;

  const spanOf = (frets) => { const f = frets.filter((x) => x > 0); return f.length ? Math.max(...f) - Math.min(...f) : 0; };

  // 구조를 줄 세트에 올리기. qid의 반음 차이를 슬롯별로 반영
  function placeOn(struct, set, rootPc, qid, opt) {
    const o = Object.assign({ minFret: 0, maxFret: 17, maxSpan: 4 }, opt || {});
    const q = QBY[qid], b = QBY.maj7;
    const rels = struct.map((n) => n.rel + (q.iv[n.slot] - b.iv[n.slot]));
    const res = [];
    for (let R0 = 24 + pc(rootPc); R0 <= 84; R0 += 12) {
      const frets = rels.map((r, i) => R0 + r - OPEN[set[i]]);
      if (frets.some((f) => f < o.minFret || f > o.maxFret)) continue;
      const sp = spanOf(frets);
      res.push({ R0, frets, span: sp, ok: sp <= o.maxSpan, notes: struct.map((n, i) => ({ s: set[i], f: frets[i], pitch: R0 + rels[i], slot: n.slot, deg: q.deg[n.slot], cls: SLOT_CLS[n.slot] })) });
    }
    return res;
  }

  // 특정 R0에서 성질만 바꿔 계산 (같은 자리 유지)
  function atR0(struct, set, R0, qid) {
    const q = QBY[qid], b = QBY.maj7;
    const notes = struct.map((n, i) => {
      const pitch = R0 + n.rel + (q.iv[n.slot] - b.iv[n.slot]);
      return { s: set[i], f: pitch - OPEN[set[i]], pitch, slot: n.slot, deg: q.deg[n.slot], cls: SLOT_CLS[n.slot] };
    });
    return { notes, frets: notes.map((n) => n.f), span: spanOf(notes.map((n) => n.f)), valid: notes.every((n) => n.f >= 0 && n.f <= 20) };
  }

  // 한 루트에서 드롭×전위×줄세트×성질 중 연주 가능한 조합 수
  function countPlayable(rootPc, maxSpan) {
    let total = 0, ok = 0;
    for (const d of DROPS) {
      const st = dropStructure(d.id);
      for (let inv = 0; inv < 4; inv++) for (const q of Q4) for (const set of STRING_SETS) {
        total++;
        if (placeOn(st[inv], set, rootPc, q.id, { maxSpan, minFret: 0 }).some((p) => p.ok)) ok++;
      }
    }
    return { total, ok };
  }

  // 드롭/전위별로 연주 가능한 줄 세트 (maj7 기준, 같은 자리에서 9개 성질 모두 가능해야 "추천")
  function playableSets(dropId, inv, rootPc, maxSpan) {
    const st = dropStructure(dropId)[inv];
    const out = [];
    for (const set of STRING_SETS) {
      const pl = placeOn(st, set, rootPc, 'maj7', { maxSpan, minFret: 2, maxFret: 18 }).filter((p) => p.ok);
      if (!pl.length) continue;
      // 성질 전체 순환 가능 여부
      const full = pl.some((p) => Q4.every((q) => { const a = atR0(st, set, p.R0, q.id); return a.valid && a.span <= maxSpan + 1; }));
      out.push({ set, label: setLabelHi(set), adjacent: isAdjacent(set), full, placements: pl });
    }
    out.sort((a, b) => (b.adjacent - a.adjacent) || (b.set[3] - a.set[3]));
    return out;
  }

  // 두 성질 사이에서 움직인 음
  function mutation(fromQ, toQ, struct, set) {
    const a = QBY[fromQ].iv, b = QBY[toQ].iv;
    return struct.map((n, i) => ({ s: set[i], slot: n.slot, delta: b[n.slot] - a[n.slot], from: QBY[fromQ].deg[n.slot], to: QBY[toQ].deg[n.slot] })).filter((m) => m.delta !== 0);
  }

  // ---------- 2-note-per-string ----------
  const ARP_Q = ['maj7', '7', 'm7', 'm7b5', 'dim7'];
  function arpeggio2nps(rootPc, startSlot, nearFret) {
    const q = QBY.maj7;
    let best = null;
    for (let f = 1; f <= 14; f++) if (pc(OPEN[0] + f) === pc(rootPc + q.iv[startSlot])) {
      if (best == null || Math.abs(f - nearFret) < Math.abs(best - nearFret)) best = f;
    }
    // 반음 내림 변형을 위해 시작 프렛이 너무 낮으면 한 옥타브 위
    if (best < 2) best += 12;
    const notes = [];
    let prev = OPEN[0] + best - 1;
    for (let k = 0; k < 12; k++) {
      const slot = (startSlot + k) % 4;
      let p = prev + 1;
      while (pc(p) !== pc(rootPc + q.iv[slot])) p++;
      const s = Math.floor(k / 2);
      notes.push({ s, f: p - OPEN[s], pitch: p, slot, order: k + 1 });
      prev = p;
    }
    return notes;
  }
  function arpeggioAs(baseNotes, qid) {
    const q = QBY[qid], b = QBY.maj7;
    return baseNotes.map((n) => {
      const d = q.iv[n.slot] - b.iv[n.slot];
      return Object.assign({}, n, { f: n.f + d, pitch: n.pitch + d, deg: q.deg[n.slot], cls: SLOT_CLS[n.slot], moved: d !== 0 });
    });
  }

  // ---------- 보이싱 재해석 (우기기) ----------
  const FAM = [
    { id: 'maj', label: '메이저', allow: { 0: 'R', 2: '9', 4: '3', 6: '#11', 7: '5', 9: '13', 11: '7' }, need: [4] },
    { id: 'min', label: '마이너', allow: { 0: 'R', 2: '9', 3: 'b3', 5: '11', 7: '5', 9: '13', 10: 'b7' }, need: [3] },
    { id: 'dom', label: '도미넌트', allow: { 0: 'R', 1: 'b9', 2: '9', 3: '#9', 4: '3', 6: '#11', 7: '5', 8: 'b13', 9: '13', 10: 'b7' }, need: [4, 10] },
    { id: 'sus', label: '서스포', allow: { 0: 'R', 1: 'b9', 2: '9', 5: '4', 7: '5', 9: '13', 10: 'b7' }, need: [5] },
    { id: 'hd', label: '하프 디미니시', allow: { 0: 'R', 2: '9', 3: 'b3', 5: '11', 6: 'b5', 8: 'b13', 10: 'b7' }, need: [3, 6] },
    { id: 'dim', label: '디미니시', allow: { 0: 'R', 2: '9', 3: 'b3', 5: '11', 6: 'b5', 8: 'b13', 9: 'bb7', 11: '△7' }, need: [3, 6, 9] },
  ];
  function chordSuffix(fam, h) {
    let base = '', t = [];
    if (fam === 'maj') {
      base = h(11) ? 'maj7' : h(9) ? '6' : '';
      if (h(2)) t.push('9'); if (h(6)) t.push('#11'); if (h(9) && h(11)) t.push('13');
      if (!base && t.length === 1 && t[0] === '9') return 'add9';
    } else if (fam === 'min') {
      base = h(10) ? 'm7' : h(9) ? 'm6' : 'm';
      if (h(2)) t.push('9'); if (h(5)) t.push('11'); if (h(9) && h(10)) t.push('13');
      if (base === 'm' && t.length === 1 && t[0] === '9') return 'madd9';
    } else if (fam === 'dom') {
      base = '7';
      [[1, 'b9'], [2, '9'], [3, '#9'], [6, '#11'], [8, 'b13'], [9, '13']].forEach(([i, l]) => { if (h(i)) t.push(l); });
    } else if (fam === 'sus') {
      base = h(10) ? '7sus4' : 'sus4';
      [[1, 'b9'], [2, '9'], [9, '13']].forEach(([i, l]) => { if (h(i)) t.push(l); });
    } else if (fam === 'hd') {
      base = h(10) ? 'm7(b5)' : 'dim';
      [[2, '9'], [5, '11'], [8, 'b13']].forEach(([i, l]) => { if (h(i)) t.push(l); });
      if (base === 'm7(b5)' && t.length) return 'm7(b5,' + t.join(',') + ')';
    } else if (fam === 'dim') {
      base = 'dim7';
      [[2, '9'], [5, '11'], [8, 'b13'], [11, '△7']].forEach(([i, l]) => { if (h(i)) t.push(l); });
    }
    return base + (t.length ? '(' + t.join(',') + ')' : '');
  }
  const ROLE = { maj: 'I', min: 'ii', dom: 'V', sus: 'V', hd: 'iiø', dim: '경과' };
  function interpret(notes) {
    const pcs = [...new Set(notes.map((n) => pc(n.pitch)))];
    const out = [];
    if (pcs.length < 2) return out;
    for (let r = 0; r < 12; r++) {
      const ivs = new Set(pcs.map((p) => pc(p - r)));
      const h = (i) => ivs.has(i);
      for (const F of FAM) {
        if (![...ivs].every((i) => i in F.allow)) continue;
        if (!F.need.every(h)) continue;
        const suffix = chordSuffix(F.id, h);
        const tens = [...ivs].filter((i) => ![0, 3, 4, 5, 6, 7, 9, 10, 11].includes(i) || (F.id === 'dom' && [3, 6, 8, 9].includes(i))).length;
        let role = ROLE[F.id], key = null;
        if (F.id === 'maj') { key = r; if (h(6)) role = 'IV (리디안)'; }
        if (F.id === 'min') key = pc(r - 2);
        if (F.id === 'dom' || F.id === 'sus') key = pc(r - 7);
        if (F.id === 'hd') key = pc(r - 2);
        out.push({
          root: r, fam: F.id, famLabel: F.label, name: NAMES[r] + suffix, rootless: !h(0), tens,
          degs: notes.map((n) => F.allow[pc(n.pitch - r)]), role, key, keyMinor: F.id === 'hd',
        });
      }
    }
    out.sort((a, b) => (a.rootless - b.rootless) || (a.tens - b.tens));
    return out;
  }
  // 모양을 옮겨 근음 r을 target으로
  function transposeShape(notes, fromRoot, toRoot) {
    const base = pc(toRoot - fromRoot);
    for (const d of [base, base - 12, base + 12].sort((a, b) => Math.abs(a) - Math.abs(b))) {
      const fs = notes.map((n) => n.f + d);
      if (fs.every((f) => f >= 1 && f <= 17)) return notes.map((n) => Object.assign({}, n, { f: n.f + d, pitch: n.pitch + d }));
    }
    for (const d of [base, base - 12]) {
      const fs = notes.map((n) => n.f + d);
      if (fs.every((f) => f >= 0 && f <= 19)) return notes.map((n) => Object.assign({}, n, { f: n.f + d, pitch: n.pitch + d }));
    }
    return null;
  }

  // ---------- 5도권 탑노트 고정 ----------
  const TOP_DEG = { 0: 'R', 1: 'b9', 2: '9', 3: '#9', 4: '3', 5: '4 (sus)', 6: '#11', 7: '5', 8: 'b13', 9: '13', 10: 'b7', 11: 'maj7' };
  const TOP_Q = { 0: '7', 1: '7b9', 2: '9', 3: '7#9', 4: '7', 5: '7sus4', 6: '7#11', 7: '7', 8: '7b13', 9: '13', 10: '7', 11: null };
  function circleSteps(startRoot, startIv) {
    const topPc = pc(startRoot + startIv);
    const steps = [];
    for (let i = 0; i < 12; i++) {
      const root = pc(startRoot + 5 * i); // 5도 아래 = 4도 위
      const iv = pc(topPc - root);
      steps.push({ i, root, iv, topPc, deg: TOP_DEG[iv], q: TOP_Q[iv], name: NAMES[root] + (TOP_Q[iv] ? TOP_Q[iv].replace(/^7$/, '7') : 'maj7') });
    }
    return steps;
  }
  function topFret(s, topPc, near) {
    let best = null;
    for (let f = 1; f <= 17; f++) if (pc(OPEN[s] + f) === topPc) { if (best == null || Math.abs(f - near) < Math.abs(best - near)) best = f; }
    return best;
  }

  // ---------- 스케일 ----------
  // rel: 음 이름(#/b)을 정할 때 기준이 되는 장조 으뜸음까지의 반음 (D 도리안 -> C 장조 = -2 = 10)
  const SCALES = [
    { id: 'major', name: 'Major (Ionian)', iv: [0, 2, 4, 5, 7, 9, 11], deg: ['1', '2', '3', '4', '5', '6', '7'], rel: 0 },
    { id: 'minor', name: 'Natural Minor (Aeolian)', iv: [0, 2, 3, 5, 7, 8, 10], deg: ['1', '2', 'b3', '4', '5', 'b6', 'b7'], rel: 3 },
    { id: 'pentMaj', name: 'Pentatonic Major', iv: [0, 2, 4, 7, 9], deg: ['1', '2', '3', '5', '6'], rel: 0 },
    { id: 'pentMin', name: 'Pentatonic Minor', iv: [0, 3, 5, 7, 10], deg: ['1', 'b3', '4', '5', 'b7'], rel: 3 },
    { id: 'blues', name: 'Blues', iv: [0, 3, 5, 6, 7, 10], deg: ['1', 'b3', '4', 'b5', '5', 'b7'], rel: 3 },
    { id: 'majBlues', name: 'Major Blues', iv: [0, 2, 3, 4, 7, 9], deg: ['1', '2', 'b3', '3', '5', '6'], rel: 0 },
    { id: 'dorian', name: 'Dorian', iv: [0, 2, 3, 5, 7, 9, 10], deg: ['1', '2', 'b3', '4', '5', '6', 'b7'], rel: 10 },
    { id: 'phrygian', name: 'Phrygian', iv: [0, 1, 3, 5, 7, 8, 10], deg: ['1', 'b2', 'b3', '4', '5', 'b6', 'b7'], rel: 8 },
    { id: 'lydian', name: 'Lydian', iv: [0, 2, 4, 6, 7, 9, 11], deg: ['1', '2', '3', '#4', '5', '6', '7'], rel: 7 },
    { id: 'mixolydian', name: 'Mixolydian', iv: [0, 2, 4, 5, 7, 9, 10], deg: ['1', '2', '3', '4', '5', '6', 'b7'], rel: 5 },
    { id: 'locrian', name: 'Locrian', iv: [0, 1, 3, 5, 6, 8, 10], deg: ['1', 'b2', 'b3', '4', 'b5', 'b6', 'b7'], rel: 1 },
    { id: 'harmMinor', name: 'Harmonic Minor', iv: [0, 2, 3, 5, 7, 8, 11], deg: ['1', '2', 'b3', '4', '5', 'b6', '7'], rel: 3 },
    { id: 'melMinor', name: 'Melodic Minor', iv: [0, 2, 3, 5, 7, 9, 11], deg: ['1', '2', 'b3', '4', '5', '6', '7'], rel: 3 },
    { id: 'wholeTone', name: 'Whole Tone', iv: [0, 2, 4, 6, 8, 10], deg: ['1', '2', '3', '#4', '#5', 'b7'], rel: 0 },
  ];
  const SCALE_BY = Object.fromEntries(SCALES.map((s) => [s.id, s]));
  const TUNINGS = [
    { id: 'g6', name: '기타 (6현)', open: [40, 45, 50, 55, 59, 64], frets: 22 },
    { id: 'g7', name: '기타 (7현)', open: [35, 40, 45, 50, 55, 59, 64], frets: 22 },
    { id: 'b4', name: '베이스 (4현)', open: [28, 33, 38, 43], frets: 20 },
    { id: 'b5', name: '베이스 (5현)', open: [23, 28, 33, 38, 43], frets: 20 },
  ];
  const TUNING_BY = Object.fromEntries(TUNINGS.map((t) => [t.id, t]));
  const CIRCLE5 = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]; // C G D A E B Gb Db Ab Eb Bb F (5도 위로)

  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
  const FLAT_KEYS = new Set([1, 3, 5, 6, 8, 10]); // 플랫 조표를 쓰는 장조 (Gb 포함)
  // 근음 + 스케일 -> 도수 숫자대로 글자를 하나씩 올려 이름 붙이기 (D 하모닉 마이너 = D E F G A Bb C#)
  function scaleInfo(rootPc, scaleId) {
    const sc = SCALE_BY[scaleId];
    if (!sc) throw new Error('unknown scale ' + scaleId);
    const root = pc(rootPc);
    let li = LETTER_PC.indexOf(root);
    if (li < 0) li = FLAT_KEYS.has(pc(root + sc.rel)) ? LETTER_PC.indexOf(root + 1) : LETTER_PC.indexOf(root - 1);
    const notes = sc.iv.map((iv, i) => {
      const p = pc(root + iv);
      const l = (li + parseInt(sc.deg[i].replace(/\D/g, ''), 10) - 1) % 7;
      let acc = pc(p - LETTER_PC[l]);
      if (acc > 6) acc -= 12;
      return { pc: p, iv, deg: sc.deg[i], name: LETTERS[l] + (acc > 0 ? '#'.repeat(acc) : 'b'.repeat(-acc)) };
    });
    return { root, scale: sc, rootName: notes[0].name, name: notes[0].name + ' ' + sc.name, notes };
  }

  // 지판 위 스케일 음 (open: 저음 줄부터 개방현 MIDI)
  function scaleOnBoard(rootPc, scaleId, open, lo, hi) {
    const info = scaleInfo(rootPc, scaleId);
    const byPc = Object.fromEntries(info.notes.map((n) => [n.pc, n]));
    const out = [];
    open.forEach((o, s) => {
      for (let f = lo; f <= hi; f++) {
        const n = byPc[pc(o + f)];
        if (n) out.push({ s, f, pitch: o + f, deg: n.deg, name: n.name, isRoot: n.iv === 0 });
      }
    });
    return out;
  }

  // 5도권 순환: 시작 근음부터 12키. dir 1 = 5도 위(시계), -1 = 4도 위(반시계). added/removed = 직전 키와 달라진 음
  function scaleCircle(startRoot, scaleId, dir) {
    const step = dir === -1 ? 5 : 7;
    const keys = [];
    for (let i = 0; i < 12; i++) keys.push(scaleInfo(pc(startRoot + step * i), scaleId));
    return keys.map((k, i) => {
      const prev = keys[(i + 11) % 12];
      const prevPcs = new Set(prev.notes.map((n) => n.pc)), curPcs = new Set(k.notes.map((n) => n.pc));
      return Object.assign(k, {
        added: k.notes.filter((n) => !prevPcs.has(n.pc)).map((n) => n.name),
        removed: prev.notes.filter((n) => !curPcs.has(n.pc)).map((n) => n.name),
      });
    });
  }

  return {
    OPEN, NAMES, pc, strName, Q4, QBY, SLOT_NAME, SLOT_CLS, DROPS, INV_NAME, STRING_SETS, setLabelHi, isAdjacent,
    dropStructure, placeOn, atR0, countPlayable, playableSets, mutation, ARP_Q, arpeggio2nps, arpeggioAs,
    FAM, interpret, transposeShape, TOP_DEG, TOP_Q, circleSteps, topFret, spanOf,
    SCALES, SCALE_BY, TUNINGS, TUNING_BY, CIRCLE5, scaleInfo, scaleOnBoard, scaleCircle,
  };
})();
if (typeof module !== 'undefined') module.exports = CT;
