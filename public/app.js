(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const NOTE = CT.NAMES;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ================= 오디오 =================
  const AU = (function () {
    let ctx = null, master = null;
    function ensure() {
      if (!ctx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        ctx = new C();
        master = ctx.createGain(); master.gain.value = 0.6;
        const comp = ctx.createDynamicsCompressor();
        master.connect(comp); comp.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    function pluck(midi, t, dur, vol) {
      const c = ensure(); if (!c) return;
      dur = dur || 1.6; vol = vol || 0.2;
      const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(Math.min(9000, hz(midi) * 9), t);
      f.frequency.exponentialRampToValueAtTime(Math.max(250, hz(midi) * 1.4), t + dur * 0.7);
      o.type = 'sawtooth'; o2.type = 'triangle';
      o.frequency.value = hz(midi); o2.frequency.value = hz(midi) * 1.004;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(f); o2.connect(f); f.connect(g); g.connect(master);
      o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
    }
    function chord(pitches, t, dur) {
      pitches.slice().sort((a, b) => a - b).forEach((p, i) => pluck(p, t + i * 0.028, dur || 1.8, 0.14));
    }
    function bass(midi, t, dur) {
      const c = ensure(); if (!c) return;
      dur = dur || 0.9;
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = hz(midi);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.42, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
    }
    function click(t, accent) {
      const c = ensure(); if (!c) return;
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'square'; o.frequency.value = accent ? 1760 : 1180;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(accent ? 0.12 : 0.06, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.07);
    }
    const now = () => { const c = ensure(); return c ? c.currentTime : 0; };
    return { ensure, pluck, chord, bass, click, now };
  })();

  // 박 단위 스케줄러 (탭마다 하나씩)
  function Transport() {
    let timer = null, next = 0, beat = 0, bpm = 80, onBeat = null, sub = 1;
    const api = {
      running: false,
      start(b, fn, subdiv) {
        if (!AU.ensure()) return false;
        api.stop(); bpm = b; onBeat = fn; sub = subdiv || 1; beat = 0; next = AU.now() + 0.12; api.running = true;
        timer = setInterval(tick, 25); tick(); return true;
      },
      setBpm(b) { bpm = b; },
      stop() { if (timer) clearInterval(timer); timer = null; api.running = false; },
    };
    function tick() {
      const c = AU.now();
      while (next < c + 0.12) {
        const t = next, b = beat;
        onBeat(b, t, Math.max(0, (t - c) * 1000));
        beat++; next += 60 / bpm / sub;
      }
    }
    return api;
  }
  const allTransports = [];
  function makeTransport() { const t = Transport(); allTransports.push(t); return t; }
  const stopAll = () => allTransports.forEach((t) => t.stop());

  // ================= 그림 =================
  const DOT_CLS = (n) => (n.now ? 'now ' : '') + (n.cls || '') + (n.moved ? ' moved' : '') + (n.dim ? ' dim' : '');

  // 가로 지판 (위 = 1번줄)
  function fretboard(o) {
    const from = o.from == null ? 0 : o.from, to = o.to || 15;
    const L = 30, T = 14, GAP = 22, W = o.fretW || 44;
    const first = Math.max(1, from);
    const showOpen = from === 0;
    const xL = L + (showOpen ? 26 : 0);
    const width = xL + (to - first + 1) * W + 10;
    const height = T + GAP * 5 + 30;
    const xOf = (f) => (f === 0 ? L + 10 : xL + (f - first + 0.5) * W);
    const yOf = (s) => T + (5 - s) * GAP;
    let h = '<svg class="fb" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" role="img" aria-label="' + esc(o.label || '지판') + '">';
    h += '<rect class="wood" x="' + xL + '" y="' + (T - 6) + '" width="' + ((to - first + 1) * W) + '" height="' + (GAP * 5 + 12) + '" rx="3"/>';
    [3, 5, 7, 9, 15, 17, 19, 21].forEach((f) => { if (f >= first && f <= to) h += '<circle class="inlay" cx="' + xOf(f) + '" cy="' + (T + GAP * 2.5) + '" r="4"/>'; });
    if (12 >= first && 12 <= to) { h += '<circle class="inlay" cx="' + xOf(12) + '" cy="' + (T + GAP * 1.5) + '" r="4"/><circle class="inlay" cx="' + xOf(12) + '" cy="' + (T + GAP * 3.5) + '" r="4"/>'; }
    for (let f = first - 1; f <= to; f++) {
      const x = xL + (f - first + 1) * W;
      h += '<line class="' + (f === 0 ? 'nut' : 'fret') + '" x1="' + x + '" x2="' + x + '" y1="' + (T - 6) + '" y2="' + (T + GAP * 5 + 6) + '"/>';
    }
    for (let s = 0; s < 6; s++) {
      h += '<line class="str" style="stroke-width:' + (0.7 + (5 - s) * 0.0 + s * 0 + (6 - s) * 0.22) + '" x1="' + (showOpen ? L : xL) + '" x2="' + (width - 10) + '" y1="' + yOf(s) + '" y2="' + yOf(s) + '"/>';
      h += '<text class="slab" x="10" y="' + yOf(s) + '">' + (6 - s) + '</text>';
    }
    for (let f = first; f <= to; f++) h += '<text class="flab" x="' + xOf(f) + '" y="' + (T + GAP * 5 + 20) + '">' + f + '</text>';
    if (o.clickable) {
      for (let s = 0; s < 6; s++) {
        if (showOpen) h += '<rect class="hit" data-s="' + s + '" data-f="0" x="' + (L - 4) + '" y="' + (yOf(s) - GAP / 2) + '" width="' + (xL - L + 4) + '" height="' + GAP + '"/>';
        for (let f = first; f <= to; f++) h += '<rect class="hit" data-s="' + s + '" data-f="' + f + '" x="' + (xL + (f - first) * W) + '" y="' + (yOf(s) - GAP / 2) + '" width="' + W + '" height="' + GAP + '"/>';
      }
    }
    (o.notes || []).forEach((n) => {
      if (n.f < from || n.f > to) return;
      const x = xOf(n.f), y = yOf(n.s);
      h += '<g class="nd ' + DOT_CLS(n) + '"><circle cx="' + x + '" cy="' + y + '" r="9.5"/><text x="' + x + '" y="' + y + '">' + esc(n.deg || '') + '</text></g>';
    });
    return h + '</svg>';
  }

  // 넓은 가로 지판: 줄 수 가변, 화면 폭에 맞춰 늘어남, 왼손잡이면 좌우 반전.
  // notes: ctx = 배경으로 흐리게 깔 음, press = 실제로 누를 음. block = 손 위치 상자 {lo, hi}
  function neck(o) {
    const open = o.open || CT.OPEN;
    const n = open.length, VW = 1000, L = 30, R = 14, T = 20, GAP = 30;
    const showOpen = o.lo === 0, first = Math.max(1, o.lo), OW = showOpen ? 40 : 0;
    const xL = L + OW, W = (VW - xL - R) / (o.hi - first + 1);
    const H = T + GAP * (n - 1) + 40;
    const fx = (x) => (o.flip ? VW - x : x);
    const xOf = (f) => fx(f === 0 ? L + OW / 2 - 4 : xL + (f - first + 0.5) * W);
    const lineX = (f) => (f < first ? L : xL + (f - first + 1) * W); // f번 프렛 오른쪽 줄
    const yOf = (s) => T + (n - 1 - s) * GAP;
    const mid = T + GAP * (n - 1) / 2;
    const rect = (x1, x2, y, h, cls, rx) => '<rect class="' + cls + '" x="' + Math.min(fx(x1), fx(x2)) + '" y="' + y + '" width="' + Math.abs(x2 - x1) + '" height="' + h + '" rx="' + (rx || 0) + '"/>';
    let h = '<svg class="fb sb" viewBox="0 0 ' + VW + ' ' + H + '" role="img" aria-label="' + esc(o.label || '지판') + '">';
    h += rect(xL, VW - R, T - 8, GAP * (n - 1) + 16, 'wood', 3);
    [3, 5, 7, 9, 15, 17, 19, 21].forEach((f) => { if (f >= first && f <= o.hi) h += '<circle class="inlay" cx="' + xOf(f) + '" cy="' + mid + '" r="5"/>'; });
    if (12 >= first && 12 <= o.hi) h += '<circle class="inlay" cx="' + xOf(12) + '" cy="' + (mid - GAP) + '" r="5"/><circle class="inlay" cx="' + xOf(12) + '" cy="' + (mid + GAP) + '" r="5"/>';
    for (let f = first - 1; f <= o.hi; f++) {
      const x = fx(xL + (f - first + 1) * W);
      h += '<line class="' + (f === 0 ? 'nut' : 'fret') + '" x1="' + x + '" x2="' + x + '" y1="' + (T - 8) + '" y2="' + (T + GAP * (n - 1) + 8) + '"/>';
    }
    for (let s = 0; s < n; s++) {
      h += '<line class="str" style="stroke-width:' + (2.4 - s * 1.5 / Math.max(1, n - 1)).toFixed(2) + '" x1="' + fx(showOpen ? L : xL) + '" x2="' + fx(VW - R) + '" y1="' + yOf(s) + '" y2="' + yOf(s) + '"/>';
      h += '<text class="slab" x="' + fx(12) + '" y="' + yOf(s) + '">' + NOTE[CT.pc(open[s])].replace(/b$/, '♭') + '</text>';
    }
    if (o.block) {
      const bl = Math.max(o.lo, o.block.lo), bh = Math.min(o.hi, o.block.hi);
      if (bl <= bh) h += rect(lineX(bl - 1) - 2, lineX(bh) + 2, T - 17, GAP * (n - 1) + 34, 'blk', 8);
    }
    for (let f = o.lo; f <= o.hi; f++) h += '<text class="flab' + ([3, 5, 7, 9, 12, 15, 17, 19, 21].includes(f) ? ' mark' : '') + '" x="' + xOf(f) + '" y="' + (T + GAP * (n - 1) + 28) + '">' + f + '</text>';
    o.notes.forEach((m) => {
      if (m.f < o.lo || m.f > o.hi) return;
      const x = xOf(m.f), y = yOf(m.s);
      const text = m.text != null ? m.text : (m.deg || '');
      h += '<g class="nd ' + DOT_CLS(m) + (m.ctx ? ' ctx' : '') + (m.press ? ' press' : '') + '" data-p="' + (m.pitch != null ? m.pitch : open[m.s] + m.f) + '"><circle cx="' + x + '" cy="' + y + '" r="' + (m.ctx ? 10 : m.press ? 13 : 12) + '"/><text x="' + x + '" y="' + y + '">' + esc(text) + '</text></g>';
    });
    return h + '</svg>';
  }
  // 지판 전체에 깔 배경 음. tones = [{iv, deg}] (근음 기준 반음)
  function ctxNotes(rootPc, tones, open) {
    open = open || CT.OPEN;
    const by = {};
    tones.forEach((t) => { by[CT.pc(rootPc + t.iv)] = t; });
    const out = [];
    open.forEach((o, s) => { for (let f = 0; f <= 22; f++) { const t = by[CT.pc(o + f)]; if (t) out.push({ s, f, pitch: o + f, deg: t.deg, cls: t.iv === 0 ? 'root' : '', ctx: true }); } });
    return out;
  }
  const q4Tones = (qid) => CT.QBY[qid].iv.map((iv, i) => ({ iv, deg: CT.QBY[qid].deg[i] }));
  const geTones = (q) => GE.CH[q].map((d) => ({ iv: GE.DEG[d][0], deg: d }));
  // 누를 음 + 배경 음 + 손 위치 상자. block 을 안 주면 누를 음 둘레 4프렛
  function chordNeck(press, ctx, o) {
    o = o || {};
    const key = (m) => m.s + ':' + m.f;
    const ps = new Set(press.map(key));
    const fr = press.filter((m) => m.f > 0).map((m) => m.f);
    const minF = fr.length ? Math.min.apply(null, fr) : 1, maxF = fr.length ? Math.max.apply(null, fr) : 1;
    const hiNeed = Math.max(maxF, o.block ? o.block.hi : 0);
    const hi = o.hi != null ? o.hi : Math.max(15, Math.min(22, hiNeed + 2));
    const block = o.block !== undefined ? o.block : press.length ? { lo: press.some((m) => m.f === 0) ? 0 : minF, hi: Math.max(maxF, minF + 3) } : null;
    return neck({
      lo: 0, hi, block, label: o.label,
      notes: ctx.filter((m) => !ps.has(key(m))).concat(press.map((m) => Object.assign({}, m, { press: true }))),
    });
  }

  // 세로 코드 박스
  function box(notes, o) {
    o = o || {};
    const fr = notes.filter((n) => n.f > 0).map((n) => n.f);
    const min = fr.length ? Math.min.apply(null, fr) : 1, max = fr.length ? Math.max.apply(null, fr) : 1;
    const start = min <= 3 && max <= 5 ? 1 : min;
    const rows = Math.max(4, max - start + 1);
    const L = 26, T = 18, GX = 14, GY = 19;
    const W = L + GX * 5 + 14, H = T + rows * GY + 6;
    let s = '<svg class="cb" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.label || '코드 폼') + '">';
    for (let r = 0; r <= rows; r++) {
      const y = T + r * GY;
      s += '<line class="' + (r === 0 && start === 1 ? 'nut' : 'fl') + '" x1="' + L + '" x2="' + (L + GX * 5) + '" y1="' + y + '" y2="' + y + '"/>';
    }
    for (let i = 0; i < 6; i++) {
      const x = L + i * GX;
      s += '<line class="st" x1="' + x + '" x2="' + x + '" y1="' + T + '" y2="' + (T + rows * GY) + '"/>';
      const n = notes.find((m) => m.s === i);
      if (!n) s += '<text class="mut" x="' + x + '" y="9">×</text>';
      else if (n.f === 0) s += '<circle class="open" cx="' + x + '" cy="9" r="4"/>';
    }
    if (start > 1) s += '<text class="fr" x="' + (L - 7) + '" y="' + (T + GY / 2) + '">' + start + 'fr</text>';
    for (const n of notes) {
      if (n.f === 0) continue;
      const x = L + n.s * GX, y = T + (n.f - start) * GY + GY / 2;
      s += '<g class="nd ' + DOT_CLS(n) + '"><circle cx="' + x + '" cy="' + y + '" r="7.4"/><text x="' + x + '" y="' + y + '">' + esc(n.deg || '') + '</text></g>';
    }
    return s + '</svg>';
  }
  const fretText = (notes) => [0, 1, 2, 3, 4, 5].map((s) => { const n = notes.find((m) => m.s === s); return n ? n.f : 'x'; }).join(' ');
  const pitchesOf = (notes) => notes.map((n) => CT.OPEN[n.s] + n.f);

  // 공통 위젯
  function noteOptions(sel, def) { sel.innerHTML = NOTE.map((n, i) => '<option value="' + i + '"' + (i === def ? ' selected' : '') + '>' + n + '</option>').join(''); }
  function chips(el, items, cur, onPick) {
    el.innerHTML = items.map((it) => '<button type="button" class="chip' + (it.sub ? ' has-sub' : '') + '" data-v="' + esc(it.v) + '" aria-pressed="' + (String(it.v) === String(cur)) + '"' + (it.title ? ' title="' + esc(it.title) + '"' : '') + '>' + esc(it.label) + (it.sub ? '<small>' + esc(it.sub) + '</small>' : '') + '</button>').join('');
    el.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => onPick(c.dataset.v)));
  }
  function setPlayBtn(btn, on) { btn.textContent = on ? '정지' : '재생'; btn.setAttribute('aria-pressed', on); }

  // ================= 탭 =================
  const TABS = ['scale', 'tone', 'matrix', 'circle', 'reint', 'tf'];
  function showTab(id) {
    stopAll();
    document.querySelectorAll('.playbtn').forEach((b) => setPlayBtn(b, false));
    TABS.forEach((t) => {
      $('tab-' + t).setAttribute('aria-selected', t === id);
      $('pane-' + t).hidden = t !== id;
    });
    try { localStorage.setItem('gv-tab', id); } catch (e) { /* 저장 불가 무시 */ }
  }
  TABS.forEach((t) => $('tab-' + t).addEventListener('click', () => showTab(t)));

  // ================= 1. 코드톤 지도 (2-note-per-string) =================
  const tone = { root: 0, start: 0, near: 3, q: 'maj7', dir: 'up', auto: false, idx: -1, cyc: 0 };
  const toneT = makeTransport();
  noteOptions($('tone-root'), 0);
  const START_PAT = [{ v: 0, label: 'A · 1도 시작' }, { v: 1, label: 'B · 3도 시작' }, { v: 2, label: 'C · 5도 시작' }, { v: 3, label: 'D · 7도 시작' }];
  const RULE = { maj7: '기준 폼', '7': '7도를 반음 내림', m7: '3도도 반음 내림', m7b5: '5도도 반음 내림', dim7: '7도를 한 번 더 내림 (bb7)' };
  function toneNotes() {
    const base = CT.arpeggio2nps(tone.root, tone.start, tone.near);
    return CT.arpeggioAs(base, tone.q);
  }
  function toneOrder(len) {
    const up = [...Array(len).keys()];
    if (tone.dir === 'up') return up;
    if (tone.dir === 'down') return up.slice().reverse();
    return up.concat(up.slice(1, -1).reverse());
  }
  function drawTone() {
    chips($('tone-start'), START_PAT, tone.start, (v) => { tone.start = +v; drawTone(); });
    chips($('tone-q'), CT.ARP_Q.map((q) => ({ v: q, label: CT.QBY[q].name, sub: RULE[q] })), tone.q, (v) => { tone.q = v; drawTone(); });
    chips($('tone-dir'), [{ v: 'up', label: '상행' }, { v: 'down', label: '하행' }, { v: 'round', label: '왕복' }], tone.dir, (v) => { tone.dir = v; drawTone(); });
    const notes = toneNotes();
    const ord = toneOrder(notes.length);
    const cur = tone.idx >= 0 ? ord[tone.idx % ord.length] : -1;
    const shown = notes.map((n, i) => Object.assign({}, n, { now: i === cur }));
    const maxF = Math.max.apply(null, notes.map((n) => n.f));
    $('tone-board').innerHTML = fretboard({ from: 0, to: Math.max(15, Math.min(22, maxF + 1)), notes: shown, label: NOTE[tone.root] + CT.QBY[tone.q].name + ' 2-note-per-string' });
    const name = NOTE[tone.root] + CT.QBY[tone.q].name;
    $('tone-title').textContent = name + ' · ' + START_PAT[tone.start].label;
    $('tone-seq').innerHTML = (tone.dir === 'down' ? notes.slice().reverse() : notes).map((n) => '<span class="seqn ' + (n.cls || '') + (n.moved ? ' moved' : '') + '">' + (6 - n.s) + '·' + n.f + '<b>' + esc(n.deg) + '</b></span>').join('');
  }
  $('tone-root').addEventListener('change', (e) => { tone.root = +e.target.value; drawTone(); });
  $('tone-near').addEventListener('change', (e) => { tone.near = Math.max(1, Math.min(12, +e.target.value || 1)); drawTone(); });
  $('tone-auto').addEventListener('change', (e) => { tone.auto = e.target.checked; });
  $('tone-bpm').addEventListener('change', (e) => toneT.setBpm(+e.target.value || 80));
  $('tone-play').addEventListener('click', () => {
    if (toneT.running) { toneT.stop(); tone.idx = -1; setPlayBtn($('tone-play'), false); drawTone(); return; }
    tone.idx = -1;
    const ok = toneT.start(+$('tone-bpm').value || 80, (b, t, delay) => {
      const notes = toneNotes(); const ord = toneOrder(notes.length);
      const k = b % ord.length;
      if (k === 0 && b > 0 && tone.auto) {
        const qi = CT.ARP_Q.indexOf(tone.q);
        tone.q = CT.ARP_Q[(qi + 1) % CT.ARP_Q.length];
      }
      const ns = toneNotes();
      AU.pluck(ns[ord[k]].pitch, t, 0.5, 0.2);
      if (b % 2 === 0) AU.click(t, k === 0);
      setTimeout(() => { if (!toneT.running) return; tone.idx = k; drawTone(); }, delay);
    }, 2);
    if (ok) setPlayBtn($('tone-play'), true);
  });

  // ================= 2. 보이싱 매트릭스 =================
  const mx = { root: 0, drop: 'd2', inv: 0, setKey: null, q: 'maj7', span: 4, place: 0, cur: -1, beats: 4 };
  const mxT = makeTransport();
  noteOptions($('mx-root'), 0);
  const setKey = (set) => set.join(',');
  function rootless3(struct, rootPc, maxSpan) {
    const st = struct.filter((n) => n.slot !== 0);
    const out = [];
    for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) for (let c = b + 1; c < 6; c++) {
      if (c - a > 3) continue;
      const set = [a, b, c];
      for (let R0 = 24 + rootPc; R0 <= 84; R0 += 12) {
        const notes = st.map((n, i) => { const pitch = R0 + n.rel; return { s: set[i], f: pitch - CT.OPEN[set[i]], pitch, slot: n.slot, deg: CT.QBY.maj7.deg[n.slot], cls: CT.SLOT_CLS[n.slot] }; });
        if (notes.some((n) => n.f < 1 || n.f > 17)) continue;
        if (CT.spanOf(notes.map((n) => n.f)) <= maxSpan) { out.push({ set, notes }); break; }
      }
    }
    return out;
  }
  function drawMatrix() {
    const st = CT.dropStructure(mx.drop)[mx.inv];
    chips($('mx-drop'), CT.DROPS.map((d) => ({ v: d.id, label: d.name })), mx.drop, (v) => { mx.drop = v; mx.setKey = null; mx.place = 0; drawMatrix(); });
    chips($('mx-inv'), CT.INV_NAME.map((n, i) => ({ v: i, label: n })), mx.inv, (v) => { mx.inv = +v; mx.setKey = null; mx.place = 0; drawMatrix(); });
    const sets = CT.playableSets(mx.drop, mx.inv, mx.root, mx.span);
    if (!sets.find((s) => setKey(s.set) === mx.setKey)) { mx.setKey = sets.length ? setKey(sets[0].set) : null; mx.place = 0; }
    chips($('mx-set'), sets.map((s) => ({ v: setKey(s.set), label: s.label + '번줄', sub: s.full ? '9개 성질 전부' : '일부 성질만', title: s.adjacent ? '붙어 있는 줄' : '건너뛴 줄 포함' })), mx.setKey, (v) => { mx.setKey = v; mx.place = 0; drawMatrix(); });
    const cnt = CT.countPlayable(mx.root, mx.span);
    $('mx-count').textContent = NOTE[mx.root] + ' 기준, 손 폭 ' + (mx.span + 1) + '프렛 안에서 잡히는 조합 ' + cnt.ok + '개 (드롭 6 × 전위 4 × 성질 9 × 4줄 조합 15 = ' + cnt.total + '개 중)';
    $('mx-struct').textContent = '아래 음부터: ' + st.map((n) => CT.SLOT_NAME[n.slot]).join(' → ');

    const strip = $('mx-strip'), alt = $('mx-alt');
    if (!mx.setKey) {
      strip.innerHTML = '<div class="empty">이 드롭·전위 조합은 손 폭 ' + (mx.span + 1) + '프렛 안에서 잡히는 4줄 조합이 없어요. 손 폭을 늘리거나 아래 근음 생략 버전을 써 보세요.</div>';
      $('mx-place').innerHTML = '';
      $('mx-btitle').textContent = '';
      $('mx-board').innerHTML = '';
      const rl = rootless3(st, mx.root, mx.span);
      alt.innerHTML = rl.length ? '<h3 class="h3">근음 생략 3음 버전</h3><div class="boxrow">' + rl.slice(0, 6).map((r) => '<figure class="cell">' + box(r.notes, { label: '근음 생략' }) + '<figcaption><b>' + NOTE[mx.root] + 'maj7 (근음 생략)</b><span>' + fretText(r.notes) + '</span></figcaption></figure>').join('') + '</div>' : '';
      return;
    }
    alt.innerHTML = '';
    const sObj = sets.find((s) => setKey(s.set) === mx.setKey);
    const set = sObj.set;
    const pls = sObj.placements;
    if (mx.place >= pls.length) mx.place = 0;
    chips($('mx-place'), pls.map((p, i) => ({ v: i, label: Math.min.apply(null, p.frets) + '프렛 부근' })), mx.place, (v) => { mx.place = +v; drawMatrix(); });
    const R0 = pls[mx.place].R0;
    const cells = CT.Q4.map((q, i) => {
      const a = CT.atR0(st, set, R0, q.id);
      const prev = i > 0 ? CT.mutation(CT.Q4[i - 1].id, q.id, st, set) : [];
      const movedS = new Set(prev.map((m) => m.s));
      const ns = a.notes.map((n) => Object.assign({}, n, { moved: movedS.has(n.s), now: i === mx.cur }));
      const hard = !a.valid || a.span > mx.span;
      const hint = i === 0 ? '기준' : prev.map((m) => CT.strName(m.s) + ' ' + m.from + '→' + m.to + ' (' + (m.delta > 0 ? '+' : '') + m.delta + ')').join(', ');
      return '<figure class="cell' + (q.id === mx.q ? ' sel' : '') + (i === mx.cur ? ' playing' : '') + (hard ? ' hard' : '') + '" data-q="' + q.id + '">' +
        (a.valid ? box(ns, { label: NOTE[mx.root] + q.name }) : '<div class="na">이 자리에선 불가</div>') +
        '<figcaption><b>' + NOTE[mx.root] + esc(q.name) + '</b><span>' + (a.valid ? fretText(a.notes) : '') + '</span><em>' + esc(hint) + (hard && a.valid ? ' · 손 폭 넘음' : '') + '</em></figcaption></figure>';
    });
    strip.innerHTML = cells.join('');
    const showQ = mx.cur >= 0 ? CT.Q4[mx.cur].id : mx.q, sa = CT.atR0(st, set, R0, showQ);
    $('mx-btitle').textContent = NOTE[mx.root] + CT.QBY[showQ].name + (sa.valid ? ' · ' + fretText(sa.notes) : ' · 이 자리에선 불가');
    $('mx-board').innerHTML = sa.valid ? chordNeck(sa.notes, ctxNotes(mx.root, q4Tones(showQ)), { label: NOTE[mx.root] + CT.QBY[showQ].name + ' 지판' }) : '';
    strip.querySelectorAll('.cell').forEach((c) => c.addEventListener('click', () => {
      mx.q = c.dataset.q; const a = CT.atR0(st, set, R0, mx.q);
      if (a.valid) AU.chord(pitchesOf(a.notes), AU.now() + 0.02);
      drawMatrix();
    }));
  }
  $('mx-root').addEventListener('change', (e) => { mx.root = +e.target.value; mx.setKey = null; drawMatrix(); });
  $('mx-span').addEventListener('change', (e) => { mx.span = +e.target.value; drawMatrix(); });
  $('mx-beats').addEventListener('change', (e) => { mx.beats = +e.target.value; });
  $('mx-bpm').addEventListener('change', (e) => mxT.setBpm(+e.target.value || 70));
  $('mx-play').addEventListener('click', () => {
    if (mxT.running) { mxT.stop(); mx.cur = -1; setPlayBtn($('mx-play'), false); drawMatrix(); return; }
    if (!mx.setKey) return;
    const ok = mxT.start(+$('mx-bpm').value || 70, (b, t, delay) => {
      const per = mx.beats, i = Math.floor(b / per) % CT.Q4.length, k = b % per;
      AU.click(t, k === 0);
      if (k === 0) {
        const st = CT.dropStructure(mx.drop)[mx.inv];
        const sObj = CT.playableSets(mx.drop, mx.inv, mx.root, mx.span).find((s) => setKey(s.set) === mx.setKey);
        if (sObj) {
          const a = CT.atR0(st, sObj.set, sObj.placements[Math.min(mx.place, sObj.placements.length - 1)].R0, CT.Q4[i].id);
          if (a.valid) AU.chord(pitchesOf(a.notes), t, 60 / mxT_bpm() * per * 0.9);
        }
        setTimeout(() => { if (!mxT.running) return; mx.cur = i; mx.q = CT.Q4[i].id; drawMatrix(); }, delay);
      }
    });
    if (ok) setPlayBtn($('mx-play'), true);
  });
  const mxT_bpm = () => +$('mx-bpm').value || 70;

  // ================= 3. 탑노트 5도권 =================
  const cc = { root: 5, iv: 2, s: 5, near: 8, idx: 0, hsel: 0, hint: true, topSound: true, skipMaj7: true, beats: 4 };
  const ccT = makeTransport();
  noteOptions($('cc-root'), 5);
  $('cc-top').innerHTML = [2, 9, 4, 6, 1, 8, 3, 10, 5, 0, 7].map((iv) => '<option value="' + iv + '"' + (iv === 2 ? ' selected' : '') + '>' + CT.TOP_DEG[iv] + '</option>').join('');
  function ccSteps() { return CT.circleSteps(cc.root, cc.iv); }
  function ccFret(steps) { return CT.topFret(cc.s, steps[0].topPc, cc.near); }
  function ccHints(step, f) {
    if (!step.q) return [];
    const vs = GE.genVoicings(step.root, step.q, { lo: Math.max(1, f - 4), hi: f + 3, maxSpan: 4, minNotes: 3, maxNotes: 4, needGuide: 2, top: { s: cc.s, f } });
    vs.sort((a, b) => b.score - a.score);
    const picked = [], seen = new Set();
    for (const v of vs) {
      const kind = v.notes.length === 3 ? '3음' : (v.notes.some((n) => n.cls === 'root') ? '근음 포함' : '근음 생략');
      const key = kind + v.notes[0].s;
      if (seen.has(key)) continue;
      seen.add(key); picked.push({ v, kind });
      if (picked.length >= 3) break;
    }
    return picked;
  }
  const geNotes = (v) => v.notes.map((n) => ({ s: n.s, f: n.f, deg: n.deg, cls: n.cls === 'root' ? 'root' : (n.cls === '3' || n.cls === '7') ? 'guide' : '' }));
  function wheel(steps, idx) {
    const R = 74, C = 92;
    let h = '<svg class="wheel" viewBox="0 0 184 184" width="184" height="184" role="img" aria-label="5도권 진행">';
    h += '<circle class="ring" cx="' + C + '" cy="' + C + '" r="' + R + '"/>';
    steps.forEach((s, i) => {
      const a = -Math.PI / 2 + (i / 12) * Math.PI * 2;
      const x = C + R * Math.cos(a), y = C + R * Math.sin(a);
      const cls = i === idx ? 'cur' : i === (idx + 1) % 12 ? 'nxt' : !s.q ? 'bad' : '';
      h += '<g class="wn ' + cls + '"><circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="13"/><text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '">' + NOTE[s.root] + '</text></g>';
    });
    const cur = steps[idx];
    h += '<text class="wc" x="' + C + '" y="' + (C - 6) + '">탑 ' + NOTE[cur.topPc] + '</text><text class="wc2" x="' + C + '" y="' + (C + 12) + '">' + esc(cur.deg) + '</text>';
    return h + '</svg>';
  }
  function drawCircle() {
    const steps = ccSteps();
    const f = ccFret(steps);
    if (cc.idx > 11) cc.idx = 0;
    const st = steps[cc.idx];
    $('cc-wheel').innerHTML = wheel(steps, cc.idx);
    $('cc-name').textContent = st.q ? st.name : NOTE[st.root] + '7';
    $('cc-deg').textContent = 'Top: ' + st.deg + ' (' + NOTE[st.topPc] + ')';
    $('cc-where').textContent = CT.strName(cc.s) + ' ' + f + '프렛 고정';
    const nxt = steps[(cc.idx + 1) % 12];
    $('cc-next').textContent = '다음: ' + (nxt.q ? nxt.name : NOTE[nxt.root] + '7') + ' · Top ' + nxt.deg;
    const hb = $('cc-hints');
    const topPress = [{ s: cc.s, f, deg: st.deg.replace(/ .*/, ''), cls: 'guide' }];
    let press = topPress, ctx = st.q ? ctxNotes(st.root, geTones(st.q)) : [];
    if (!st.q) {
      hb.innerHTML = '<div class="empty">' + NOTE[st.topPc] + '는 ' + NOTE[st.root] + '의 장7도라서 도미넌트 7(b7)과 부딪혀요. 이 칸은 ' + (cc.skipMaj7 ? '자동 재생에서 건너뜁니다.' : '쉬거나 ' + NOTE[st.root] + 'maj7으로 바꿔 치세요.') + '</div>';
    } else if (!cc.hint) {
      hb.innerHTML = '<div class="empty">힌트 꺼짐. 지판의 코드톤을 보고 탑노트 아래를 직접 짚어 보세요.</div>';
    } else {
      const hs = ccHints(st, f);
      if (cc.hsel >= hs.length) cc.hsel = 0;
      hb.innerHTML = hs.length ? hs.map((p, i) => '<figure class="cell pick' + (i === cc.hsel ? ' sel' : '') + '" data-i="' + i + '">' + box(geNotes(p.v), { label: p.v.name }) + '<figcaption><b>' + esc(p.kind) + '</b><span>' + GE.fretStr(p.v) + '</span><em>베이스 ' + esc(p.v.notes[0].deg) + '</em></figcaption></figure>').join('') : '<div class="empty">손 폭 5프렛 안에서 이 탑노트로 잡히는 폼이 없어요. 포지션을 바꿔 보세요.</div>';
      hb.querySelectorAll('.cell').forEach((c) => c.addEventListener('click', () => {
        cc.hsel = +c.dataset.i; drawCircle();
        AU.chord(hs[cc.hsel].v.notes.map((n) => n.pitch), AU.now() + 0.02);
      }));
      if (hs.length) press = geNotes(hs[cc.hsel].v);
    }
    $('cc-board').innerHTML = chordNeck(press, ctx, { label: (st.q ? st.name : NOTE[st.root] + '7') + ' 지판', block: press.length > 1 ? undefined : null });
    $('cc-strip').innerHTML = steps.map((s, i) => '<button type="button" class="step' + (i === cc.idx ? ' cur' : '') + (!s.q ? ' bad' : '') + '" data-i="' + i + '"><b>' + (s.q ? esc(s.name) : NOTE[s.root] + '7') + '</b><span>' + esc(s.deg) + '</span></button>').join('');
    $('cc-strip').querySelectorAll('.step').forEach((b) => b.addEventListener('click', () => { cc.idx = +b.dataset.i; drawCircle(); }));
  }
  function ccStepSound(t, dur) {
    const steps = ccSteps(), st = steps[cc.idx], f = ccFret(steps);
    AU.bass(36 + CT.pc(st.root - 0) + (CT.pc(st.root) < 4 ? 12 : 0), t, dur);
    if (cc.topSound) AU.pluck(CT.OPEN[cc.s] + f, t + 0.01, dur, 0.13);
  }
  function ccMove(d) {
    const steps = ccSteps();
    let i = (cc.idx + d + 12) % 12;
    if (cc.skipMaj7 && ccT.running && !steps[i].q) i = (i + d + 12) % 12;
    cc.idx = i; drawCircle();
  }
  $('cc-root').addEventListener('change', (e) => { cc.root = +e.target.value; cc.idx = 0; drawCircle(); });
  $('cc-top').addEventListener('change', (e) => { cc.iv = +e.target.value; cc.idx = 0; drawCircle(); });
  $('cc-str').addEventListener('change', (e) => { cc.s = +e.target.value; drawCircle(); drawAllDom(); });
  $('cc-near').addEventListener('change', (e) => { cc.near = Math.max(1, Math.min(17, +e.target.value || 8)); drawCircle(); drawAllDom(); });
  $('cc-hint').addEventListener('change', (e) => { cc.hint = e.target.checked; drawCircle(); });
  $('cc-topsnd').addEventListener('change', (e) => { cc.topSound = e.target.checked; });
  $('cc-skip').addEventListener('change', (e) => { cc.skipMaj7 = e.target.checked; drawCircle(); });
  $('cc-beats').addEventListener('change', (e) => { cc.beats = +e.target.value; });
  $('cc-bpm').addEventListener('change', (e) => ccT.setBpm(+e.target.value || 60));
  $('cc-prev').addEventListener('click', () => { ccMove(-1); ccStepSound(AU.now() + 0.02, 1.2); });
  $('cc-nextb').addEventListener('click', () => { ccMove(1); ccStepSound(AU.now() + 0.02, 1.2); });
  $('cc-play').addEventListener('click', () => {
    if (ccT.running) { ccT.stop(); setPlayBtn($('cc-play'), false); return; }
    const steps = ccSteps();
    if (cc.skipMaj7 && !steps[cc.idx].q) cc.idx = (cc.idx + 1) % 12;
    const ok = ccT.start(+$('cc-bpm').value || 60, (b, t, delay) => {
      const k = b % cc.beats;
      AU.click(t, k === 0);
      if (k === 0) {
        if (b > 0) { const d = delay; setTimeout(() => { if (ccT.running) ccMove(1); }, Math.max(0, d - 5)); }
        // 다음 칸 소리는 화면 이동 뒤에 맞추기 위해 계산
        const steps2 = ccSteps();
        let i = b === 0 ? cc.idx : (cc.idx + 1) % 12;
        if (b > 0 && cc.skipMaj7 && !steps2[i].q) i = (i + 1) % 12;
        const f = ccFret(steps2), dur = 60 / (+$('cc-bpm').value || 60) * cc.beats * 0.95;
        AU.bass(36 + CT.pc(steps2[i].root) + (CT.pc(steps2[i].root) < 4 ? 12 : 0), t, dur);
        if (cc.topSound) AU.pluck(CT.OPEN[cc.s] + f, t + 0.01, dur, 0.12);
      }
    });
    if (ok) { setPlayBtn($('cc-play'), true); drawCircle(); }
  });
  document.addEventListener('keydown', (e) => {
    if ($('pane-circle').hidden || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); ccMove(1); ccStepSound(AU.now() + 0.02, 1.2); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); ccMove(-1); ccStepSound(AU.now() + 0.02, 1.2); }
  });
  // 이 탑노트로 가능한 모든 도미넌트
  let allDomDrawn = false;
  function drawAllDom() {
    if (!$('cc-all').open) { allDomDrawn = false; return; }
    const steps = ccSteps(), f = ccFret(steps);
    const res = GE.topNoteDominants({ s: cc.s, f, maxNotes: 4, maxSpan: 3, needGuide: 2, perChord: 1 });
    $('cc-alllist').innerHTML = '<p class="note">' + NOTE[steps[0].topPc] + ' (' + CT.strName(cc.s) + ' ' + f + '프렛)을 맨 위에 둔 도미넌트 계열 ' + res.length + '종</p><div class="boxrow">' +
      res.map((c) => '<figure class="cell">' + box(geNotes(c.voicings[0]), { label: c.name }) + '<figcaption><b>' + esc(c.name) + '</b><span>' + GE.fretStr(c.voicings[0]) + '</span><em>탑 ' + esc(c.topDeg) + '</em></figcaption></figure>').join('') + '</div>';
    allDomDrawn = true;
  }
  $('cc-all').addEventListener('toggle', drawAllDom);

  // ================= 4. 우기기 =================
  const PRESETS = [
    { id: 'p1', label: '모양 1', frets: [-1, -1, 4, 2, 2, 4] },
    { id: 'p2', label: '모양 2 (4도 쌓기)', frets: [-1, -1, 7, 7, 8, 8] },
    { id: 'p3', label: '모양 3', frets: [-1, -1, 5, 6, 6, 6] },
    { id: 'p4', label: '모양 4', frets: [-1, -1, 7, 8, 9, 9] },
    { id: 'p5', label: '모양 5 (m6 폼)', frets: [-1, -1, 2, 3, 3, 3] },
  ];
  const ri = { frets: PRESETS[0].frets.slice(), preset: 'p1', pick: 0, key: 0 }; // pick: 기본은 첫 해석(도수 표기)
  const riT = makeTransport();
  noteOptions($('ri-key'), 0);
  const riNotes = () => ri.frets.map((f, s) => (f < 0 ? null : { s, f, pitch: CT.OPEN[s] + f })).filter(Boolean);
  function degNotes(notes, interp) {
    return notes.map((n, i) => {
      const d = interp ? interp.degs[i] : CT.NAMES[CT.pc(n.pitch)];
      const cls = !interp ? '' : d === 'R' ? 'root' : ['3', 'b3', '7', 'b7', 'bb7', '4'].includes(d) ? 'guide' : '';
      return { s: n.s, f: n.f, deg: d, cls };
    });
  }
  function drawReint() {
    chips($('ri-presets'), PRESETS.map((p) => ({ v: p.id, label: p.label })).concat([{ v: 'custom', label: '직접 찍기' }]), ri.preset, (v) => {
      if (v === 'custom') { ri.preset = 'custom'; } else { const p = PRESETS.find((x) => x.id === v); ri.frets = p.frets.slice(); ri.preset = v; }
      ri.pick = 0; drawReint();
    });
    const notes = riNotes();
    const list = CT.interpret(notes);
    if (ri.pick != null && ri.pick >= list.length) ri.pick = list.length ? 0 : null;
    const sel = ri.pick != null ? list[ri.pick] : null;
    $('ri-board').innerHTML = fretboard({ from: 0, to: 15, notes: degNotes(notes, sel), clickable: true, label: '보이싱 입력 지판' });
    $('ri-board').querySelectorAll('.hit').forEach((r) => r.addEventListener('click', () => {
      const s = +r.dataset.s, f = +r.dataset.f;
      ri.frets[s] = ri.frets[s] === f ? -1 : f; ri.preset = 'custom'; ri.pick = 0; drawReint();
      const n = CT.OPEN[s] + f; if (ri.frets[s] >= 0) AU.pluck(n, AU.now() + 0.02, 0.8, 0.18);
    }));
    $('ri-shape').innerHTML = notes.length ? box(degNotes(notes, sel), { label: '현재 모양' }) + '<div class="mono">' + fretText(notes) + '</div><div class="mono dimtxt">' + notes.map((n) => NOTE[CT.pc(n.pitch)]).join(' ') + '</div>' : '<div class="empty">지판을 눌러 줄마다 한 음씩 찍으세요.</div>';
    const groups = CT.FAM.map((F) => ({ F, items: list.map((x, i) => Object.assign({ i }, x)).filter((x) => x.fam === F.id) })).filter((g) => g.items.length);
    $('ri-list').innerHTML = notes.length < 3 ? '<div class="empty">3음 이상 찍으면 해석이 나와요.</div>' : !groups.length ? '<div class="empty">메이저·마이너·도미넌트·서스·하프디미니시·디미니시 어느 쪽으로도 우기기 어려운 배열이에요. 음 하나를 옮겨 보세요.</div>' :
      groups.map((g) => '<div class="fam"><h3 class="h3">' + g.F.label + ' 관점</h3>' + g.items.map((x) =>
        '<button type="button" class="interp' + (ri.pick === x.i ? ' on' : '') + '" data-i="' + x.i + '"><b>' + esc(x.name) + '</b>' +
        '<span class="role">' + (x.key != null ? NOTE[x.key] + (x.keyMinor ? ' 마이너' : '') + ' 키의 ' + esc(x.role) : esc(x.role)) + '</span>' +
        (x.rootless ? '<span class="tag">근음 없음</span>' : '') +
        '<span class="degs">' + notes.map((n, k) => (6 - n.s) + '번줄 ' + esc(x.degs[k])).reverse().join(' · ') + '</span></button>').join('') + '</div>').join('');
    $('ri-list').querySelectorAll('.interp').forEach((b) => b.addEventListener('click', () => {
      ri.pick = ri.pick === +b.dataset.i ? null : +b.dataset.i; drawReint();
      if (ri.pick != null) { const x = list[ri.pick]; const t = AU.now() + 0.02; AU.bass(36 + x.root + (x.root < 4 ? 12 : 0), t, 2); AU.chord(pitchesOf(riNotes()), t + 0.05, 2); }
    }));
    drawSwap(list);
  }
  $('ri-clear').addEventListener('click', () => { ri.frets = [-1, -1, -1, -1, -1, -1]; ri.preset = 'custom'; ri.pick = 0; drawReint(); });
  $('ri-hear').addEventListener('click', () => { const n = riNotes(); if (n.length) AU.chord(pitchesOf(n), AU.now() + 0.02, 2); });

  // 2-5-1 속에 넣기
  let swapPlan = null;
  function drawSwap(list) {
    const K = ri.key, notes = riNotes();
    const roles = [
      { r: '마이너 ii', root: CT.pc(K + 2), fams: ['min'] },
      { r: 'V', root: CT.pc(K + 7), fams: ['dom', 'sus'] },
      { r: 'I', root: K, fams: ['maj'] },
    ];
    swapPlan = roles.map((ro) => {
      const it = list.find((x) => ro.fams.includes(x.fam));
      if (!it) return { ro, none: true };
      const tn = CT.transposeShape(notes, it.root, ro.root);
      if (!tn) return { ro, none: true };
      const d = tn[0].f - notes[0].f;
      const name = NOTE[ro.root] + it.name.slice(NOTE[it.root].length);
      return { ro, it, notes: tn, name, d };
    });
    $('ri-swap').innerHTML = notes.length < 3 ? '' : swapPlan.map((p) => '<figure class="cell">' + (p.none ? '<div class="na">이 모양은 ' + p.ro.r + '로 우기기 어려움</div>' :
      box(degNotes(p.notes, p.it), { label: p.name })) + '<figcaption><b>' + p.ro.r + (p.none ? '' : ' · ' + esc(p.name)) + '</b><span>' + (p.none ? '' : fretText(p.notes)) + '</span><em>' + (p.none ? '' : (p.d === 0 ? '제자리' : (p.d > 0 ? '+' : '') + p.d + '프렛 이동')) + '</em></figcaption></figure>').join('');
  }
  $('ri-key').addEventListener('change', (e) => { ri.key = +e.target.value; drawReint(); });
  $('ri-play').addEventListener('click', () => {
    if (riT.running) { riT.stop(); setPlayBtn($('ri-play'), false); return; }
    const ok = riT.start(+$('ri-bpm').value || 90, (b, t) => {
      const bar = Math.floor(b / 4) % 4, k = b % 4;
      AU.click(t, k === 0);
      const p = swapPlan && swapPlan[Math.min(bar, 2)];
      const spb = 60 / (+$('ri-bpm').value || 90);
      if (!p) return;
      if (k === 0) AU.bass(36 + p.ro.root + (p.ro.root < 4 ? 12 : 0), t, spb * 3.8);
      if ((k === 0 || k === 2) && !p.none) AU.chord(pitchesOf(p.notes), t + 0.01, spb * 1.8);
    });
    if (ok) setPlayBtn($('ri-play'), true);
  });

  // 퀴즈
  const quiz = { score: 0, n: 0, q: null, done: false };
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function newQuiz() {
    const p = PRESETS[Math.floor(Math.random() * PRESETS.length)];
    const shift = Math.floor(Math.random() * 7) - 3;
    let notes = p.frets.map((f, s) => (f < 0 ? null : { s, f, pitch: CT.OPEN[s] + f })).filter(Boolean);
    if (notes.every((n) => n.f + shift >= 1)) notes = notes.map((n) => ({ s: n.s, f: n.f + shift, pitch: n.pitch + shift }));
    const list = CT.interpret(notes);
    const it = list[Math.floor(Math.random() * list.length)];
    let q;
    if (Math.random() < 0.5) {
      const valid = new Set(list.filter((x) => x.fam === it.fam).map((x) => x.root));
      const wrong = shuffle([...Array(12).keys()].filter((r) => !valid.has(r))).slice(0, 3);
      q = { notes, text: '이 모양을 ' + it.famLabel + ' 코드로 우기려면 근음은?', opts: shuffle([it.root].concat(wrong)).map((r) => ({ label: NOTE[r], ok: r === it.root })), explain: it.name + ' · ' + notes.map((n, k) => (6 - n.s) + '번줄 ' + it.degs[k]).reverse().join(', ') };
    } else {
      const k = Math.floor(Math.random() * notes.length);
      q = { notes, text: '이 모양을 ' + it.name + '(으)로 볼 때 ' + it.degs[k] + ' 역할을 하는 줄은?', opts: shuffle(notes.map((n, j) => ({ label: (6 - n.s) + '번줄', ok: j === k || it.degs[j] === it.degs[k] }))), explain: notes.map((n, j) => (6 - n.s) + '번줄 ' + it.degs[j]).reverse().join(', ') };
    }
    quiz.q = q; quiz.done = false; drawQuiz();
  }
  function drawQuiz() {
    const q = quiz.q;
    $('qz-score').textContent = quiz.n ? quiz.score + ' / ' + quiz.n : '아직 푼 문제 없음';
    $('qz-box').innerHTML = box(q.notes.map((n) => ({ s: n.s, f: n.f, deg: NOTE[CT.pc(n.pitch)], cls: '' })), { label: '퀴즈 모양' }) + '<div class="mono">' + fretText(q.notes) + '</div>';
    $('qz-text').textContent = q.text;
    $('qz-opts').innerHTML = q.opts.map((o, i) => '<button type="button" class="opt' + (quiz.done ? (o.ok ? ' right' : ' wrongc') : '') + '" data-i="' + i + '"' + (quiz.done ? ' disabled' : '') + '>' + esc(o.label) + '</button>').join('');
    $('qz-opts').querySelectorAll('.opt').forEach((b) => b.addEventListener('click', () => {
      if (quiz.done) return;
      const o = q.opts[+b.dataset.i]; quiz.done = true; quiz.n++; if (o.ok) quiz.score++;
      $('qz-fb').textContent = (o.ok ? '맞아요. ' : '아쉬워요. ') + q.explain;
      $('qz-fb').className = 'fb ' + (o.ok ? 'good' : 'bad');
      drawQuiz();
    }));
    if (!quiz.done) { $('qz-fb').textContent = ''; $('qz-fb').className = 'fb'; }
  }
  $('qz-next').addEventListener('click', newQuiz);
  $('qz-hear').addEventListener('click', () => { if (quiz.q) AU.chord(pitchesOf(quiz.q.notes), AU.now() + 0.02, 2); });

  // ================= 5. 2-5-1 탐색 =================
  NOTE.forEach((n, i) => { const o = document.createElement('option'); o.value = i; o.textContent = n; if (i === 9) o.selected = true; $('a-proot').appendChild(o); });
  function runA() {
    $('a-status').textContent = '탐색 중…';
    setTimeout(() => {
      const lo = +$('a-lo').value, hi = Math.max(lo, +$('a-hi').value);
      const usePent = $('a-pent').checked;
      const res = GE.search251({
        kind: $('a-kind').value, lo, hi, variants: $('a-var').checked, perKey: 3,
        needGuide: +$('a-guide').value, outsideMax: usePent ? +$('a-out').value : 99,
        pent: usePent ? { root: +$('a-proot').value, type: $('a-ptype').value } : null,
      });
      const ok = res.filter((k) => k.paths.length);
      $('a-status').textContent = '프렛 ' + lo + '–' + hi + ' 안에서 ' + ok.length + '/12개 키 성립';
      const boxEl = $('a-out-list');
      tfv.ok = ok; tfv.lo = lo; tfv.hi = hi; tfv.minor = $('a-kind').value === 'minor';
      tfv.pent = usePent ? { root: +$('a-proot').value, type: $('a-ptype').value } : null;
      if (!ok.find((k) => k.key === tfv.key)) { tfv.key = ok.length ? ok[0].key : null; tfv.p = 0; tfv.c = 0; }
      if (!ok.length) { $('a-view').hidden = true; boxEl.innerHTML = '<div class="empty">조건에 맞는 보이싱이 없어요. 펜타 밖 음 허용을 늘리거나, 가이드톤 필수를 "하나만"으로 바꾸거나, 프렛 창을 넓혀 보세요.</div>'; return; }
      const cell = (c, key, pi, ci) => '<figure class="cell pick" data-k="' + key + '" data-p="' + pi + '" data-c="' + ci + '">' + box(geNotes(c), { label: c.name }) + '<figcaption><b>' + esc(chordLabel(c)) + '</b><span>' + GE.fretStr(c) + '</span></figcaption></figure>';
      const row = (p, key, pi) => '<div class="boxrow tight">' + p.chords.map((c, ci) => cell(c, key, pi, ci)).join('') + '</div>';
      boxEl.innerHTML = ok.map((k) => {
        const p0 = k.paths[0], rest = k.paths.slice(1);
        const outs = p0.chords.reduce((a, c) => a + c.outside, 0);
        return '<article class="card"><h3 class="h3 between">' + NOTE[k.key] + (tfv.minor ? ' 마이너' : ' 메이저') + ' 2-5-1<span class="meta">펜타 밖 ' + outs + '음 · 이동 ' + p0.cost.toFixed(1) + '</span>' +
          '<button type="button" class="mini" data-k="' + k.key + '">듣기</button></h3>' + row(p0, k.key, 0) +
          (rest.length ? '<details><summary>다른 후보 ' + rest.length + '개</summary>' + rest.map((p, i) => row(p, k.key, i + 1)).join('') + '</details>' : '') + '</article>';
      }).join('');
      boxEl.querySelectorAll('.mini').forEach((b) => b.addEventListener('click', () => { tfv.key = +b.dataset.k; tfv.p = 0; tfv.c = 0; playTf(); }));
      boxEl.querySelectorAll('.cell.pick').forEach((c) => c.addEventListener('click', () => {
        tfv.key = +c.dataset.k; tfv.p = +c.dataset.p; tfv.c = +c.dataset.c; drawTfView();
        const ch = tfPath().chords[tfv.c];
        AU.chord(ch.notes.map((n) => n.pitch), AU.now() + 0.02, 1.5);
      }));
      drawTfView();
    }, 20);
  }
  $('a-go').addEventListener('click', runA);

  // 위쪽 지판: 고른 진행의 코드 하나를 프렛 창 상자 안에 표시
  const tfv = { ok: [], key: null, p: 0, c: 0, lo: 5, hi: 8, minor: false, pent: null, timers: [] };
  const chordLabel = (c) => c.name.replace('maj7s11', 'maj7#11');
  const ROMAN = { major: ['ii', 'V', 'I'], minor: ['iiø', 'V', 'i'] };
  function tfPath() { const k = tfv.ok.find((x) => x.key === tfv.key); return k.paths[Math.min(tfv.p, k.paths.length - 1)]; }
  function drawTfView() {
    if (tfv.key == null) { $('a-view').hidden = true; return; }
    $('a-view').hidden = false;
    const path = tfPath(), ch = path.chords[tfv.c], roman = ROMAN[tfv.minor ? 'minor' : 'major'];
    $('a-vtitle').textContent = NOTE[tfv.key] + (tfv.minor ? ' 마이너' : ' 메이저') + ' 2-5-1 · ' + chordLabel(ch) + ' (' + roman[tfv.c] + ')';
    $('a-vmeta').textContent = (tfv.p ? '후보 ' + (tfv.p + 1) : '최적 경로') + ' · ' + GE.fretStr(ch);
    chips($('a-vchips'), path.chords.map((c, i) => ({ v: i, label: roman[i] + ' · ' + chordLabel(c) })), tfv.c, (v) => {
      tfv.c = +v; drawTfView(); const c = tfPath().chords[tfv.c]; AU.chord(c.notes.map((n) => n.pitch), AU.now() + 0.02, 1.5);
    });
    let ctx;
    if (tfv.pent) {
      const info = CT.scaleInfo(tfv.pent.root, tfv.pent.type === 'min' ? 'pentMin' : 'pentMaj');
      ctx = ctxNotes(tfv.pent.root, info.notes.map((n) => ({ iv: n.iv, deg: n.deg })));
      $('a-vctxl').textContent = info.name + ' (펜타 도수)';
    } else {
      ctx = ctxNotes(ch.root, geTones(ch.q));
      $('a-vctxl').textContent = '지판 전체의 같은 코드톤';
    }
    $('a-board').innerHTML = chordNeck(geNotes(ch), ctx, { block: { lo: tfv.lo, hi: tfv.hi }, label: chordLabel(ch) + ' 지판' });
    document.querySelectorAll('#a-out-list .cell.pick').forEach((c) => c.classList.toggle('sel', +c.dataset.k === tfv.key && +c.dataset.p === tfv.p && +c.dataset.c === tfv.c));
  }
  function playTf() {
    tfv.timers.forEach(clearTimeout); tfv.timers = [];
    const path = tfPath(), t = AU.now() + 0.05;
    path.chords.forEach((c, i) => {
      AU.bass(36 + CT.pc(c.root) + (CT.pc(c.root) < 4 ? 12 : 0), t + i * 1.6, 1.5);
      AU.chord(c.notes.map((n) => n.pitch), t + i * 1.6 + 0.02, 1.5);
      tfv.timers.push(setTimeout(() => { tfv.c = i; drawTfView(); }, 50 + i * 1600));
    });
  }
  $('a-vplay').addEventListener('click', playTf);

  // ================= 6. 스케일 연습 =================
  const sc = { mode: 'simple', root: 0, type: 'pentMaj', label: 'deg', inst: 'g6', hand: 'right', dir: 1, bars: 0, range: 'oct', rootOnly: false, ci: 0, zoom: 10, pos: 0, now: null };
  const scT = makeTransport();
  noteOptions($('sc-root'), 0);
  $('sc-type').innerHTML = CT.SCALES.map((s) => '<option value="' + s.id + '"' + (s.id === sc.type ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('');
  $('sc-inst').innerHTML = CT.TUNINGS.map((t) => '<option value="' + t.id + '"' + (t.id === sc.inst ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('');
  const scTuning = () => CT.TUNING_BY[sc.inst];
  const scCircle = () => CT.scaleCircle(sc.root, sc.type, sc.dir);
  const scKey = (ci) => (sc.mode === 'circle' ? scCircle()[ci == null ? sc.ci : ci] : CT.scaleInfo(sc.root, sc.type));
  // 보이는 프렛 범위: zoom = 줄인 칸 수, pos = 시작 프렛
  function scWindow() {
    const maxF = scTuning().frets, count = maxF + 1 - sc.zoom;
    sc.pos = Math.max(0, Math.min(sc.pos, maxF + 1 - count));
    return { lo: sc.pos, hi: sc.pos + count - 1, maxF, count };
  }

  // 재생 순서: 보이는 범위 안에서 위치를 정하고 상행 후 하행
  function scSeq(key) {
    const { lo, hi } = scWindow();
    const all = CT.scaleOnBoard(key.root, sc.type, scTuning().open, lo, hi);
    if (!all.length) return [];
    let pitches = [...new Set(all.map((n) => n.pitch))].sort((a, b) => a - b);
    if (sc.range === 'oct') {
      const r = pitches.find((p) => CT.pc(p) === key.root);
      if (r != null && pitches.includes(r + 12)) pitches = pitches.filter((p) => p >= r && p <= r + 12);
    }
    let prev = null;
    const up = pitches.map((p) => {
      const cands = all.filter((n) => n.pitch === p);
      const pick = prev ? cands.reduce((a, b) => (Math.abs(b.f - prev.f) + 0.6 * Math.abs(b.s - prev.s) < Math.abs(a.f - prev.f) + 0.6 * Math.abs(a.s - prev.s) ? b : a))
        : cands.reduce((a, b) => (b.s < a.s ? b : a));
      prev = pick;
      return pick;
    });
    return up.concat(up.slice(1, -1).reverse());
  }

  function scWheel(keys, idx) {
    const R = 74, C = 92;
    let h = '<svg class="wheel" viewBox="0 0 184 184" width="184" height="184" role="img" aria-label="5도권 순환">';
    h += '<circle class="ring" cx="' + C + '" cy="' + C + '" r="' + R + '"/>';
    keys.forEach((k, i) => {
      const a = -Math.PI / 2 + (i / 12) * Math.PI * 2 * sc.dir;
      const x = (C + R * Math.cos(a)).toFixed(1), y = (C + R * Math.sin(a)).toFixed(1);
      h += '<g class="wn ' + (i === idx ? 'cur' : i === (idx + 1) % 12 ? 'nxt' : '') + '" data-i="' + i + '"><circle cx="' + x + '" cy="' + y + '" r="14"/><text x="' + x + '" y="' + y + '">' + esc(k.rootName) + '</text></g>';
    });
    h += '<text class="wc" x="' + C + '" y="' + (C - 6) + '">' + (idx + 1) + ' / 12</text><text class="wc2" x="' + C + '" y="' + (C + 12) + '">' + esc(keys[idx].rootName) + '</text>';
    return h + '</svg>';
  }

  function drawScale() {
    const circle = sc.mode === 'circle';
    const tun = scTuning(), win = scWindow();
    const keys = circle ? scCircle() : null;
    const key = circle ? keys[sc.ci] : CT.scaleInfo(sc.root, sc.type);
    chips($('sc-mode'), [{ v: 'simple', label: '단순 스케일' }, { v: 'circle', label: '5도권 순환' }], sc.mode, (v) => { sc.mode = v; sc.ci = 0; drawScale(); });
    chips($('sc-label'), [{ v: 'deg', label: '도수' }, { v: 'name', label: '음이름' }, { v: 'none', label: '없음' }], sc.label, (v) => { sc.label = v; drawScale(); });
    chips($('sc-hand'), [{ v: 'right', label: '오른손' }, { v: 'left', label: '왼손' }], sc.hand, (v) => { sc.hand = v; drawScale(); });
    chips($('sc-dir'), [{ v: 1, label: '5도 위로 (C→G→D)' }, { v: -1, label: '4도 위로 (C→F→Bb)' }], sc.dir, (v) => { sc.dir = +v; sc.ci = 0; drawScale(); });
    chips($('sc-range'), [{ v: 'oct', label: '한 옥타브' }, { v: 'pos', label: '보이는 범위 전체' }], sc.range, (v) => { sc.range = v; drawScale(); });
    $('sc-circle-opts').hidden = !circle;
    $('sc-circle').hidden = !circle;
    $('sc-leg-moved').hidden = !circle;
    $('sc-root-lab').textContent = circle ? '시작 루트' : '루트 음';

    $('sc-title').textContent = key.name;
    $('sc-notes').innerHTML = key.notes.map((n) => '<span class="scn' + (n.iv === 0 ? ' root' : '') + (circle && key.added.includes(n.name) ? ' moved' : '') + '"><b>' + esc(n.name) + '</b><small>' + esc(n.deg) + '</small></span>').join('');

    const zoomEl = $('sc-zoom'), posEl = $('sc-pos');
    zoomEl.max = win.maxF + 1 - 4; zoomEl.value = sc.zoom;
    posEl.max = win.maxF + 1 - win.count; posEl.value = sc.pos; posEl.disabled = +posEl.max === 0;

    const now = sc.now;
    const notes = CT.scaleOnBoard(key.root, sc.type, tun.open, win.lo, win.hi)
      .map((n) => {
        const isNow = !!now && now.s === n.s && now.f === n.f;
        return Object.assign({}, n, {
          cls: n.isRoot ? 'root' : 'guide', now: isNow,
          moved: circle && key.added.includes(n.name),
          text: sc.label === 'name' ? n.name : sc.label === 'deg' ? n.deg : '',
        });
      })
      .filter((n) => !sc.rootOnly || n.isRoot || n.now);
    $('sc-board').innerHTML = neck({ open: tun.open, lo: win.lo, hi: win.hi, notes, flip: sc.hand === 'left', label: key.name + ' 지판' });

    if (circle) {
      const prev = keys[(sc.ci + 11) % 12], nxt = keys[(sc.ci + 1) % 12];
      $('sc-wheel').innerHTML = scWheel(keys, sc.ci);
      $('sc-wheel').querySelectorAll('.wn').forEach((g) => g.addEventListener('click', () => { sc.ci = +g.dataset.i; drawScale(); scKeySound(); }));
      $('sc-change').innerHTML = sc.ci === 0 ? '<b>' + esc(key.rootName) + '</b>에서 시작. 바퀴를 돌면 키마다 바뀌는 음을 점선으로 보여줘요.' :
        esc(prev.rootName) + ' → <b>' + esc(key.rootName) + '</b> 바뀐 음: ' + (key.added.length ? key.removed.map(esc).join(', ') + ' → <b>' + key.added.map(esc).join(', ') + '</b>' : '없음');
      $('sc-next').textContent = '다음: ' + nxt.name + (nxt.added.length ? ' (' + nxt.removed.join(', ') + ' → ' + nxt.added.join(', ') + ')' : '');
    }
    $('sc-status').textContent = win.lo + '–' + win.hi + '프렛 · 보이는 스케일 음 ' + CT.scaleOnBoard(key.root, sc.type, tun.open, win.lo, win.hi).length + '개';
  }
  function scKeySound() { const k = scKey(); AU.bass(36 + k.root, AU.now() + 0.02, 1.2); }
  function scMove(d) { if (sc.mode !== 'circle') return; sc.ci = (sc.ci + d + 12) % 12; drawScale(); scKeySound(); }

  $('sc-root').addEventListener('change', (e) => { sc.root = +e.target.value; sc.ci = 0; drawScale(); });
  $('sc-type').addEventListener('change', (e) => { sc.type = e.target.value; drawScale(); });
  $('sc-inst').addEventListener('change', (e) => {
    sc.inst = e.target.value;
    sc.zoom = Math.max(0, scTuning().frets + 1 - 13); sc.pos = 0; // 기본: 0~12프렛
    drawScale();
  });
  $('sc-zoom').addEventListener('input', (e) => { sc.zoom = +e.target.value; drawScale(); });
  $('sc-pos').addEventListener('input', (e) => { sc.pos = +e.target.value; drawScale(); });
  $('sc-rootonly').addEventListener('change', (e) => { sc.rootOnly = e.target.checked; drawScale(); });
  $('sc-bars').addEventListener('change', (e) => { sc.bars = +e.target.value; });
  $('sc-bpm').addEventListener('change', (e) => scT.setBpm(+e.target.value || 90));
  $('sc-prev').addEventListener('click', () => scMove(-1));
  $('sc-nextb').addEventListener('click', () => scMove(1));
  $('sc-board').addEventListener('click', (e) => { const g = e.target.closest('.nd'); if (g) AU.pluck(+g.dataset.p, AU.now() + 0.02, 1, 0.2); });
  document.addEventListener('keydown', (e) => {
    if ($('pane-scale').hidden || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); scMove(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); scMove(-1); }
  });
  $('sc-play').addEventListener('click', () => {
    if (scT.running) { scT.stop(); sc.now = null; setPlayBtn($('sc-play'), false); drawScale(); return; }
    let seq = null, len = 0, k = 0, ci = sc.ci;
    const ok = scT.start(+$('sc-bpm').value || 90, (b, t, delay) => {
      if (seq === null || k >= len) {
        if (seq !== null && sc.mode === 'circle') ci = (sc.ci + 1) % 12;
        else ci = sc.ci;
        seq = scSeq(scKey(ci));
        // 키 하나 길이: 스케일 한 바퀴를 마디 단위로 올림, 또는 정한 마디 수 (8분음표 8개 = 1마디)
        len = sc.mode === 'circle' && sc.bars ? sc.bars * 8 : Math.max(8, Math.ceil(seq.length / 8) * 8);
        k = 0;
        if (sc.mode === 'circle') AU.bass(36 + scKey(ci).root, t, 60 / (+$('sc-bpm').value || 90) * 2);
      }
      const i = k++;
      if (i % 2 === 0) AU.click(t, i % 8 === 0);
      const looped = sc.mode === 'circle' && sc.bars;
      const n = seq.length && (looped || i < seq.length) ? seq[i % seq.length] : null;
      if (n) AU.pluck(n.pitch, t, 0.5, 0.2);
      const keyAt = ci;
      setTimeout(() => { if (!scT.running) return; sc.ci = keyAt; sc.now = n; drawScale(); }, delay);
    }, 2);
    if (ok) setPlayBtn($('sc-play'), true);
  });

  // ================= 시작 =================
  drawTone(); drawMatrix(); drawCircle(); drawReint(); newQuiz(); runA(); drawScale();
  // 라이트/다크: 고르기 전에는 시스템 설정을 따름
  function applyTheme(t) {
    if (t) document.documentElement.dataset.theme = t;
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    $('theme-light').setAttribute('aria-pressed', cur === 'light');
    $('theme-dark').setAttribute('aria-pressed', cur === 'dark');
  }
  ['light', 'dark'].forEach((t) => $('theme-' + t).addEventListener('click', () => {
    applyTheme(t);
    try { localStorage.setItem('gv-theme', t); } catch (e) { /* 저장 불가 무시 */ }
  }));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
  applyTheme();

  let startTab = 'scale';
  try { const s = localStorage.getItem('gv-tab'); if (s && TABS.includes(s)) startTab = s; } catch (e) { /* 무시 */ }
  if (/^#(tone|matrix|circle|reint|tf|scale)$/.test(location.hash)) startTab = location.hash.slice(1);
  showTab(startTab);
})();
