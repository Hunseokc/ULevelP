// CH-2c-1: chords-db(MIT) 기타 폼 → 정석 코드 폼 표(frontend/src/lib/engine/chordForms.json)
// 사용: node scripts/build_chord_forms.mjs [--check]
//   원본: 개발산출물/자료/chords-db_guitar.json (tombatossals/chords-db lib/guitar.json 고정본)
//   --check: 파일을 쓰지 않고, 만든 결과가 저장된 JSON과 같은지만 확인(다르면 exit 1)
// 이름은 CH-2 파서(parseChord)로 정규화하고, 모든 폼을 음으로 검증한다. 불일치는 버리지 않고 보고에 남긴다.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseChord, chordPcs, DEGREE_SEMITONES } from '../frontend/src/lib/chords/symbol.mts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, '개발산출물/자료/chords-db_guitar.json');
const OUT = join(ROOT, 'frontend/src/lib/engine/chordForms.json');
const SOURCE = {
  name: 'chords-db',
  url: 'https://github.com/tombatossals/chords-db',
  file: 'lib/guitar.json',
  commit: 'df06fa7b425cf5fd29485ff6591236b3557e3fac',
  license: 'MIT (c) 2016 David Rubert — chordForms.LICENSE.txt',
};
const TUNING = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4 (6번 줄 → 1번 줄)
const MAX_SPAN = 4; // chords-db main.fretsOnChord
const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

// chords-db suffix → 파서에 넣을 접미사 (슬래시 suffix는 그대로 붙인다)
const SUFFIX = {
  major: '', minor: 'm', sus: 'sus', aug7: '7#5', aug9: '9#5',
};
const toSymbol = (key, suffix) => key + (suffix in SUFFIX ? SUFFIX[suffix] : suffix);

// 11·13 코드는 파서가 맨 위 확장음만 넣지만(CH-2 §2) 실제 폼은 아래 텐션을 함께 누르는 일이 많다
// → 아래 텐션(11: 9 · 도미넌트 11: 3도 · 13: 9·11)은 허용하고 폼에 add로 남긴다 (사용자 결정 2026-11-04)
export function allowedExtra(quality) {
  const m = /^(m|maj|mmaj)?(11|13)/.exec(quality);
  if (!m) return [];
  if (m[2] === '13') return ['9', '11'];
  return quality.startsWith('11') ? ['9', '3'] : ['9'];
}

export function allowedOmit(quality) {
  return /^(m|maj|mmaj)?(11|13)/.test(quality) ? ['5', '9'] : ['5'];
}

function evaluate(chord, frets, srcMidi) {
  const midi = frets.flatMap((f, i) => (f >= 0 ? [TUNING[i] + f] : []));
  const problems = [];
  if (srcMidi && JSON.stringify(midi) !== JSON.stringify(srcMidi)) problems.push('midi');
  const want = new Set(chordPcs(chord));
  const got = new Set(midi.map((m) => m % 12));
  const allowed = new Map(allowedExtra(chord.quality).map((d) => [(chord.root + DEGREE_SEMITONES[d]) % 12, d]));
  const add = [];
  const extra = [];
  for (const p of got) {
    if (want.has(p)) continue;
    if (allowed.has(p)) add.push(allowed.get(p));
    else extra.push(p);
  }
  if (extra.length) problems.push('extra:' + extra.map((p) => NAMES[p]).join(','));
  if (midi.length && midi[0] % 12 !== (chord.bass ?? chord.root)) problems.push('bottom:' + NAMES[midi[0] % 12]);
  const fretted = frets.filter((f) => f > 0);
  const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) + 1 : 0;
  if (span > MAX_SPAN) problems.push('span:' + span);
  // 빠진 도수(같은 음 도수는 하나만 있으면 됨). 생략은 5도(+ 11·13 코드의 9)만 허용 — 3도·7도·변화음·맨 위 확장음이 빠지면 그 코드 소리가 아님
  const omit = chord.degrees.filter((d) => !got.has((chord.root + DEGREE_SEMITONES[d]) % 12));
  const okOmit = allowedOmit(chord.quality);
  const bad = omit.filter((d) => !okOmit.includes(d));
  if (bad.length) problems.push('omit:' + bad.join(','));
  return { frets, midi, omit, add, problems, span };
}

/** 검증 1개: 상대 프렛 → 절대 프렛, 음 · 맨 아래 · 프렛 폭 · 원본 midi 일치.
 * 맨 아래가 근음/베이스가 아니면 그 음이 나올 때까지 아래 줄을 막아 다시 본다(3음 이상 남을 때만, fix 'mute-low') */
export function checkForm(chord, pos) {
  const frets = pos.frets.map((f) => (f > 0 ? f + pos.baseFret - 1 : f));
  const r = evaluate(chord, frets, pos.midi);
  if (!r.problems.some((p) => p.startsWith('bottom')) || r.problems.includes('midi')) return r;
  const want = chord.bass ?? chord.root;
  const muted = [...frets];
  let i = 0;
  while (i < 6 && !(muted[i] >= 0 && (TUNING[i] + muted[i]) % 12 === want)) muted[i++] = -1;
  if (i >= 6 || muted.filter((f) => f >= 0).length < 3) return r;
  const fixed = evaluate(chord, muted, null);
  if (fixed.problems.length) return r;
  return { ...fixed, fix: 'mute-low', muted: i };
}

export function build(db) {
  const forms = {};
  const unsupported = []; // 파서가 못 읽는 이름
  const rejected = []; // 검증 불일치
  const stats = { chords: 0, positions: 0, kept: 0, fixed: 0, omit: {} };
  for (const list of Object.values(db.chords)) {
    for (const entry of list) {
      stats.chords++;
      stats.positions += entry.positions.length;
      const sym = toSymbol(entry.key, entry.suffix);
      const chord = parseChord(sym);
      if (!chord.ok) {
        unsupported.push({ symbol: sym, suffix: entry.suffix, reason: chord.reason, positions: entry.positions.length });
        continue;
      }
      const id = `${chord.root}:${chord.quality}` + (chord.bass != null ? `/${chord.bass}` : '');
      entry.positions.forEach((pos, i) => {
        const r = checkForm(chord, pos);
        const src = `${entry.key} ${entry.suffix} #${i + 1}`;
        if (r.problems.length) {
          rejected.push({ symbol: sym, src, frets: r.frets, problems: r.problems });
          return;
        }
        const fingers = pos.fingers.map((f, s) => (r.frets[s] < 0 ? 0 : f));
        // 막은 줄 때문에 한 줄만 남은 바레는 지운다
        const barres = (pos.barres ?? [])
          .map((b) => b + pos.baseFret - 1)
          .filter((b) => r.frets.filter((f) => f === b).length >= 2);
        const form = { frets: r.frets, fingers, barres, src };
        if (r.add.length) form.add = r.add;
        if (r.fix) {
          form.fix = r.fix;
          stats.fixed = (stats.fixed ?? 0) + 1;
        }
        if (r.omit.length) {
          form.omit = r.omit;
          const k = r.omit.join(',');
          stats.omit[k] = (stats.omit[k] ?? 0) + 1;
        }
        // 같은 코드가 다른 suffix로 또 나오면(예 sus = sus4) 같은 프렛은 한 번만
        const arr = (forms[id] ??= { name: NAMES[chord.root] + chord.quality.replace(/^maj$/, '') + (chord.bass != null ? '/' + NAMES[chord.bass] : ''), forms: [] }).forms;
        if (arr.some((f) => f.frets.join() === form.frets.join())) return;
        arr.push(form);
        stats.kept++;
      });
    }
  }
  const sorted = Object.fromEntries(Object.entries(forms).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));
  return { data: { source: SOURCE, tuning: TUNING, forms: sorted }, unsupported, rejected, stats };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = JSON.parse(readFileSync(SRC, 'utf8'));
  const { data, unsupported, rejected, stats } = build(db);
  const text = JSON.stringify(data) + '\n';
  console.log(`chords ${stats.chords} · positions ${stats.positions} · kept ${stats.kept} · ids ${Object.keys(data.forms).length}`);
  console.log(`unsupported ${unsupported.length} names (${unsupported.reduce((s, u) => s + u.positions, 0)} positions)`);
  const bySuffix = {};
  for (const u of unsupported) (bySuffix[u.suffix + ' ' + u.reason] ??= 0), bySuffix[u.suffix + ' ' + u.reason]++;
  console.log('  ' + JSON.stringify(bySuffix));
  console.log(`rejected ${rejected.length}`);
  for (const r of rejected) console.log(`  ${r.symbol.padEnd(9)} ${r.src.padEnd(16)} ${r.frets.map((f) => (f < 0 ? 'x' : f)).join(' ').padEnd(18)} ${r.problems.join(' ')}`);
  console.log(`fixed(mute-low) ${stats.fixed} · add ${Object.values(data.forms).flatMap((e) => e.forms).filter((f) => f.add).length}`);
  console.log('omit ' + JSON.stringify(stats.omit));
  if (process.argv.includes('--check')) {
    const same = readFileSync(OUT, 'utf8') === text;
    console.log(same ? 'check: same' : 'check: DIFFERENT');
    process.exit(same ? 0 : 1);
  }
  writeFileSync(OUT, text);
  console.log('wrote ' + OUT);
}
