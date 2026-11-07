// CH-2c-3: 정석 폼 사람 검토(유지보수) — 표에 없는 코드 중 "애매"한 것만 목록으로 만들고, 사람 판정을 엔진 표로 반영
// 사용:
//   node scripts/chord_form_review.mjs --write   목록 다시 만들기(이미 적은 판정·메모는 그대로 남김)
//   node scripts/chord_form_review.mjs --apply   판정 → frontend/src/lib/engine/chordFormReview.json
//   node scripts/chord_form_review.mjs --check   목록·판정 형식·JSON이 지금 규칙과 맞는지만 확인(다르면 exit 1)
// 애매 = 규칙 1등 폼이 표 폼(정답지)에 3% 미만인 특징(flags)을 가짐(자동 회피 뒤에도). 기준·근거: 개발산출물/결과/CH-2c-3_정석폼검토.md
// 판정 칸: 빈칸(미검토) · ok(=1) · 2 · 3(그 번호 후보) · 직접:x 3 2 0 1 0 · 빼기(정석 폼 없음 → 화면은 compact로 대체)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseChord, BASE_QUALITIES, TENSION_ORDER } from '../frontend/src/lib/chords/symbol.mts';
import { formId, ruleForms } from '../frontend/src/lib/engine/chordShapes.mjs';
import { checkForm } from './build_chord_forms.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CSV_PATH = join(ROOT, '개발산출물/자료/정석폼_검토목록.csv');
export const JSON_PATH = join(ROOT, 'frontend/src/lib/engine/chordFormReview.json');
const TABLE_PATH = join(ROOT, 'frontend/src/lib/engine/chordForms.json');
const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const HEADER = ['id', '코드', '표시', '후보1', '후보2', '후보3', '판정', '메모'];
const FLAG_KO = { 'split-barre': '끊긴 바레', semitone: '반음 부딪힘', 'three-strings': '3줄', 'top-muted': '위 2줄 막음' };
const fx = (frets) => frets.map((f) => (f < 0 ? 'x' : f)).join(' ');

/** 파서가 받는 퀄리티(BASE_QUALITIES + 텐션 하나, CH-2b-2와 같은 목록) 중 표에 없는 것 × 12루트 */
export function ruleOnlyChords(table) {
  const inTable = new Set(Object.keys(table.forms).filter((k) => !k.includes('/')).map((k) => k.split(':')[1]));
  const suffix = new Map();
  for (const q of BASE_QUALITIES) {
    for (const t of ['', ...TENSION_ORDER]) {
      const s = (q === 'maj' ? '' : q) + (t ? `(${t})` : '');
      const c = parseChord('C' + s);
      if (c.ok && !suffix.has(c.quality)) suffix.set(c.quality, s);
    }
  }
  const out = [];
  for (const [q, s] of suffix) {
    if (inTable.has(q)) continue;
    for (const r of NAMES) out.push(parseChord(r + s));
  }
  return out;
}

/** 지금 규칙으로 애매 목록 계산 → { rows, total, zero } (rows: 판정 빈칸) */
export function listAmbiguous(table) {
  const chords = ruleOnlyChords(table);
  const rows = [];
  const zero = [];
  for (const c of chords) {
    const g = ruleForms(c, {});
    if (!g.length) { zero.push(c.raw); continue; }
    if (!g[0].flags.length) continue;
    rows.push({
      id: formId(c), 코드: c.raw, 표시: g[0].flags.map((f) => FLAG_KO[f]).join('·'),
      후보1: fx(g[0].frets), 후보2: g[1] ? fx(g[1].frets) : '', 후보3: g[2] ? fx(g[2].frets) : '', 판정: '', 메모: '',
    });
  }
  return { rows, total: chords.length, zero };
}

// CSV (UTF-8 BOM — 스프레드시트에서 한글이 깨지지 않게)
const q = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export function toCsv(rows) {
  return '﻿' + [HEADER.join(','), ...rows.map((r) => HEADER.map((h) => q(String(r[h] ?? ''))).join(','))].join('\n') + '\n';
}
export function parseCsv(text) {
  const recs = []; let rec = []; let cur = ''; let inQ = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') inQ = false; else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { rec.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; rec.push(cur); cur = ''; if (rec.some((x) => x !== '')) recs.push(rec); rec = []; }
    else cur += ch;
  }
  if (cur !== '' || rec.length) { rec.push(cur); if (rec.some((x) => x !== '')) recs.push(rec); }
  const [head, ...body] = recs;
  if (!head || head.join(',') !== HEADER.join(',')) throw new Error(`검토 CSV 머리줄이 다름: ${head ? head.join(',') : '(없음)'}`);
  return body.map((r) => Object.fromEntries(HEADER.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/** 판정 하나 → { kind: 'none'|'todo'|'form', frets? } (잘못되면 throw) */
export function decide(row) {
  const d = row.판정;
  if (d === '') return { kind: 'todo' };
  if (d === '빼기') return { kind: 'none' };
  const n = d.toLowerCase() === 'ok' ? 1 : /^[123]$/.test(d) ? Number(d) : null;
  let text = null;
  if (n != null) { text = row[`후보${n}`]; if (!text) throw new Error(`${row.코드}: 후보${n}이 없음`); }
  else if (d.startsWith('직접:')) text = d.slice(3).trim();
  else throw new Error(`${row.코드}: 판정 "${d}"를 모름 (ok · 2 · 3 · 직접:x 3 2 0 1 0 · 빼기)`);
  const frets = text.split(/\s+/).map((t) => (t === 'x' ? -1 : Number(t)));
  if (frets.length !== 6 || frets.some((f) => !Number.isInteger(f) || f < -1 || f > 24)) throw new Error(`${row.코드}: 프렛 "${text}"가 6줄 형식이 아님`);
  const c = parseChord(row.코드);
  if (!c.ok || formId(c) !== row.id) throw new Error(`${row.코드}: id ${row.id}와 코드가 안 맞음`);
  const r = checkForm(c, { frets, baseFret: 1 });
  if (r.problems.length || r.fix) throw new Error(`${row.코드} ${text}: 음 검증 실패 ${r.problems.join(' ')}`);
  return { kind: 'form', frets };
}

/** 목록 다시 만들기: 판정·메모는 id로 이어 붙인다. 번호 판정인데 후보가 바뀌었으면 "직접:예전 프렛"으로 고정.
 *  지금은 애매가 아니어도 판정이 있던 행은 남긴다(표시 "판정 보존") */
export function regenerate(table, oldRows) {
  const { rows, total, zero } = listAmbiguous(table);
  const old = new Map((oldRows || []).map((r) => [r.id, r]));
  const keep = (r, o) => {
    let d = o.판정;
    const n = d.toLowerCase() === 'ok' ? 1 : /^[123]$/.test(d) ? Number(d) : null;
    if (n != null && o[`후보${n}`] !== r[`후보${n}`]) d = `직접:${o[`후보${n}`]}`;
    return { ...r, 판정: d, 메모: o.메모 };
  };
  const out = rows.map((r) => (old.has(r.id) ? keep(r, old.get(r.id)) : r));
  const ids = new Set(rows.map((r) => r.id));
  // 빠진 행은 후보 칸을 비운다(더는 갱신되지 않음) → 번호 판정은 "직접:예전 프렛"으로 고정
  for (const o of oldRows || []) if (!ids.has(o.id) && (o.판정 || o.메모)) out.push(keep({ ...o, 표시: '판정 보존', 후보1: '', 후보2: '', 후보3: '' }, o));
  return { rows: out, total, zero, ambiguous: rows.length };
}

/** 판정 → chordFormReview.json 내용 (미검토는 넣지 않음) */
export function applyDecisions(rows) {
  const forms = {};
  for (const r of rows) {
    const d = decide(r);
    if (d.kind === 'todo') continue;
    if (d.kind === 'none') { forms[r.id] = { name: r.코드, forms: [], none: true }; continue; }
    const c = parseChord(r.코드);
    const hit = ruleForms(c, { lo: 0, hi: 24 }).find((v) => fx(v.frets) === fx(d.frets));
    forms[r.id] = { name: r.코드, forms: [{ frets: d.frets, fingers: [], barres: hit ? hit.barres : [], src: `review ${r.코드}` }] };
  }
  const sorted = Object.fromEntries(Object.entries(forms).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));
  return { source: { name: '사람 검토', file: '개발산출물/자료/정석폼_검토목록.csv' }, forms: sorted };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const table = JSON.parse(readFileSync(TABLE_PATH, 'utf8'));
  const oldRows = existsSync(CSV_PATH) ? parseCsv(readFileSync(CSV_PATH, 'utf8')) : [];
  const mode = process.argv[2];
  if (mode === '--write') {
    const g = regenerate(table, oldRows);
    writeFileSync(CSV_PATH, toCsv(g.rows));
    console.log(`write: 애매 ${g.ambiguous}/${g.total} (${((g.ambiguous / g.total) * 100).toFixed(1)}%) · 행 ${g.rows.length} · 후보 0개 ${g.zero.length}(compact 대체)`);
  } else if (mode === '--apply') {
    const data = applyDecisions(oldRows);
    writeFileSync(JSON_PATH, JSON.stringify(data, null, 1) + '\n');
    const v = Object.values(data.forms);
    console.log(`apply: 폼 ${v.filter((e) => !e.none).length} · 빼기 ${v.filter((e) => e.none).length} · 미검토 ${oldRows.filter((r) => !r.판정).length}`);
  } else if (mode === '--check') {
    const g = regenerate(table, oldRows);
    const problems = [];
    if (toCsv(g.rows) !== toCsv(oldRows)) problems.push('목록이 지금 규칙과 다름 → --write');
    try {
      const want = JSON.stringify(applyDecisions(oldRows), null, 1) + '\n';
      if (!existsSync(JSON_PATH) || readFileSync(JSON_PATH, 'utf8') !== want) problems.push('chordFormReview.json이 판정과 다름 → --apply');
    } catch (e) { problems.push(e.message); }
    console.log(problems.length ? 'check: ' + problems.join(' / ') : `check: same (애매 ${g.ambiguous}/${g.total}, 판정 ${oldRows.filter((r) => r.판정).length})`);
    if (problems.length) process.exit(1);
  } else {
    console.log('사용: --write | --apply | --check');
    process.exit(1);
  }
}
