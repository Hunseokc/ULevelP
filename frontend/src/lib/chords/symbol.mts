// CH-2: 코드 심볼 파서 — 화면 표기를 그대로 받아 근음·정규 퀄리티·도수를 돌려준다(계산은 피치클래스)
// 규칙: 개발산출물/결과/CH-1b_설계.md §5-2

export type ChordOk = {
  raw: string;
  ok: true;
  root: number;
  rootName: string;
  quality: string;
  degrees: string[];
  bass?: number;
  bassName?: string;
};
export type ChordFail = { raw: string; ok: false; reason: ChordFailReason };
export type ParsedChord = ChordOk | ChordFail;
export type ChordFailReason = 'empty' | 'no-chord' | 'bad-root' | 'bad-bass' | 'bad-paren' | 'unknown-suffix' | 'conflict';

// 도수 → 반음 (엔진 DEG 표와 같은 이름 + 2·4·#5·bb7)
export const DEGREE_SEMITONES: Record<string, number> = {
  R: 0, b9: 1, 9: 2, 2: 2, '#9': 3, b3: 3, 3: 4, 4: 5, 11: 5, '#11': 6, b5: 6,
  5: 7, '#5': 8, b13: 8, 6: 9, 13: 9, bb7: 9, b7: 10, 7: 11,
};

// 정규 퀄리티 이름 뒤에 붙는 텐션 순서
export const TENSION_ORDER = ['b9', '9', '#9', '11', '#11', 'b13', '13'];

// 지원하는 정규 퀄리티(텐션 붙이기 전 기본형). 텐션 조합은 이름 뒤에 TENSION_ORDER 순으로 붙는다(7b9b13)
export const BASE_QUALITIES = [
  'maj', 'm', 'dim', 'aug', 'sus2', 'sus4', 'add9', 'madd9', '6', 'm6', '69', 'm69',
  'maj7', 'maj9', 'maj13', 'maj7s11', 'maj7#5', 'm7', 'm9', 'm11', 'm13', 'mmaj7',
  'm7b5', 'dim7', '7', '9', '11', '13', '7sus4', '9sus4', '13sus4', '7b5', '7#5', '7alt',
];

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ROOT_RE = /^([A-G])([#b]?)/;
const NOTE_RE = /^([A-G])([#b]?)$/;
const NO_CHORD_RE = /^\(?n\.?\s?c\.?\)?$/i;
const MOD_RE = /^(?:sus4|sus2|sus|add9|add2|alt|b13|b9|b5|#11|#9|#5|\+11|\+9|\+5|\+|13|11|9)/;
const PAREN_MAJ7_RE = /^(?:maj7|Maj7|ma7|M7|Δ7|Δ)$/;

const normalize = (s: string): string =>
  s.replace(/♯/g, '#').replace(/♭/g, 'b').replace(/∆/g, 'Δ').replace(/º/g, '°').replace(/Ø/g, 'ø').replace(/[−–]/g, '-');

export function pitchClass(name: string): number | null {
  const m = NOTE_RE.exec(normalize(name.trim()));
  if (!m) return null;
  return (LETTER_PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
}

type Suffix = { quality: string; degrees: string[] };

// 근음·베이스를 뗀 나머지(예: "m7(b5)", "6/9", "maj7#11")를 정규 퀄리티와 도수로
function readSuffix(rest: string): Suffix | ChordFailReason {
  // 괄호 묶음은 항목 목록으로 떼어 낸다: "7(b9, b13)" → 바깥 "7", 항목 [b9, b13]
  const items: string[] = [];
  let outside = '';
  let buf = '';
  let inParen = false;
  for (const ch of rest) {
    if (ch === '(') {
      if (inParen) return 'bad-paren';
      inParen = true;
      buf = '';
    } else if (ch === ')') {
      if (!inParen || !buf.trim()) return 'bad-paren';
      inParen = false;
      items.push(...buf.split(/[,\s]+/).filter(Boolean));
    } else if (inParen) buf += ch;
    else outside += ch;
  }
  if (inParen) return 'bad-paren';

  let t = outside;
  const eat = (re: RegExp): string | null => {
    const m = re.exec(t);
    if (!m) return null;
    t = t.slice(m[0].length);
    return m[0];
  };

  let minor = false, maj = false, delta = false, dim = false, half = false, aug = false;
  let head: string | null;
  if (eat(/^(?:min|mi|m|-)(?:maj|Maj|M|Δ)/)) { minor = true; maj = true; delta = true; }
  else if ((head = eat(/^(?:maj|Maj|MAJ|ma(?![a-z])|M|Δ)/))) { maj = true; delta = head === 'Δ'; }
  else if (eat(/^(?:min|mi|m|-)/)) minor = true;
  else if (eat(/^(?:dim|o|°)/)) dim = true;
  else if (eat(/^ø/)) half = true;
  else if (eat(/^(?:aug|\+)/)) aug = true;

  const num = (eat(/^(?:6\/9|69|13|11|9|7|6)/) || '').replace('/', '');

  let sus = '';
  let fifthMod = '';
  let add9 = false;
  let alt = false;
  const tensions = new Set<string>();
  const apply = (tok: string): ChordFailReason | null => {
    if (tok.startsWith('sus')) {
      const s = tok === 'sus2' ? '2' : '4';
      if (sus && sus !== s) return 'conflict';
      sus = s;
    } else if (tok === 'add9' || tok === 'add2') add9 = true;
    else if (tok === 'alt') alt = true;
    else if (tok === 'b5' || tok === '#5' || tok === '+5' || tok === '+') {
      const f = tok === 'b5' ? 'b5' : '#5';
      if (fifthMod && fifthMod !== f) return 'conflict';
      fifthMod = f;
    } else tensions.add(tok.replace('+', '#'));
    return null;
  };
  let tok: string | null;
  while (t) {
    if (!(tok = eat(MOD_RE))) return 'unknown-suffix';
    const err = apply(tok);
    if (err) return err;
  }
  for (const item of items) {
    if (PAREN_MAJ7_RE.test(item)) { maj = true; delta = true; continue; }
    let r = item;
    while (r) {
      const m = MOD_RE.exec(r);
      if (!m) return 'unknown-suffix';
      const err = apply(m[0]);
      if (err) return err;
      r = r.slice(m[0].length);
    }
  }

  // 3도·5도
  let third = minor || dim || half ? 'b3' : '3';
  if (sus) {
    if (third === 'b3') return 'conflict';
    third = sus;
  }
  let fifth = dim || half ? 'b5' : aug ? '#5' : '5';
  if (fifthMod) {
    if (fifth !== '5' && fifth !== fifthMod) return 'conflict';
    fifth = fifthMod;
  }

  // 7도·확장음(머리 숫자 9·11·13·69)
  let seventh = '';
  let ext = '';
  if (dim) {
    if (maj || sus || (num && num !== '7')) return 'conflict';
    if (num === '7') seventh = 'bb7';
  } else if (num === '6' || num === '69') {
    if (half) return 'conflict';
    seventh = '6';
    if (num === '69') ext = '9';
  } else if (num) {
    seventh = maj && !half ? '7' : 'b7';
    if (num !== '7') ext = num;
  } else if (half) seventh = 'b7';
  else if (maj && delta) seventh = '7';

  // 7도 없는 코드(3화음·6화음)는 텐션 9만 add9로 받는다
  if (!seventh || seventh === '6') {
    for (const x of tensions) {
      if (x !== '9') return 'conflict';
      add9 = true;
    }
    tensions.clear();
    if (alt) return 'conflict';
  }
  if (seventh === '6') {
    if (fifth !== '5' || (third !== '3' && third !== 'b3')) return 'conflict';
    if (add9) { ext = '9'; add9 = false; }
  }
  if (alt) {
    if (seventh !== 'b7' || third !== '3' || fifth !== '5' || ext) return 'conflict';
    fifth = '#5';
  }

  // 정규 이름
  let name: string;
  if (!seventh) {
    if (add9) {
      if (fifth !== '5' || (third !== '3' && third !== 'b3')) return 'conflict';
      name = third === 'b3' ? 'madd9' : 'add9';
    } else if (third === '2' || third === '4') {
      if (fifth !== '5') return 'conflict';
      name = 'sus' + third;
    } else if (third === 'b3') {
      if (fifth === '#5') return 'conflict';
      name = fifth === 'b5' ? 'dim' : 'm';
    } else {
      if (fifth === 'b5') return 'conflict';
      name = fifth === '#5' ? 'aug' : 'maj';
    }
  } else if (seventh === '6') name = (third === 'b3' ? 'm' : '') + (ext ? '69' : '6');
  else if (seventh === 'bb7') name = 'dim7';
  else {
    if (add9) return 'conflict';
    name = (seventh === '7' ? (third === 'b3' ? 'mmaj' : 'maj') : third === 'b3' ? 'm' : '') + (ext || '7');
    if (third === '2' || third === '4') name += 'sus' + third;
    if (alt) name += 'alt';
    else if (fifth !== '5') name += fifth;
  }
  name += TENSION_ORDER.filter((x) => tensions.has(x) && x !== ext).join('');
  if (name === 'maj7#11') name = 'maj7s11'; // 엔진 CH 키 이름

  // 도수: R, 3도, 5도, 7도, 텐션(TENSION_ORDER 순). 도미넌트 11은 3도를 빼고 9를 넣는다
  const dom11 = seventh === 'b7' && third === '3' && ext === '11';
  const degrees = ['R'];
  if (!dom11) degrees.push(third);
  degrees.push(fifth);
  if (seventh) degrees.push(seventh);
  const top = new Set(tensions);
  if (ext) top.add(ext);
  if (dom11 || add9) top.add('9');
  if (alt) { top.add('b9'); top.add('#9'); }
  degrees.push(...TENSION_ORDER.filter((x) => top.has(x)));

  return { quality: name, degrees };
}

export function parseChord(text: string): ParsedChord {
  const raw = text;
  const fail = (reason: ChordFailReason): ChordFail => ({ raw, ok: false, reason });
  const s = normalize(String(text ?? '')).trim();
  if (!s) return fail('empty');
  if (NO_CHORD_RE.test(s)) return fail('no-chord');
  const rm = ROOT_RE.exec(s);
  if (!rm) return fail('bad-root');
  const rootName = rm[0];
  let rest = s.slice(rootName.length);

  // 슬래시 베이스: 마지막 "/음이름". "6/9"는 슬래시가 아니다
  let bassName: string | undefined;
  const slash = rest.lastIndexOf('/');
  if (slash >= 0) {
    const tail = rest.slice(slash + 1);
    if (NOTE_RE.test(tail)) {
      bassName = tail;
      rest = rest.slice(0, slash);
    } else if (!(tail === '9' && rest.slice(0, slash).endsWith('6'))) return fail('bad-bass');
  }

  const suffix = readSuffix(rest);
  if (typeof suffix === 'string') return fail(suffix);
  const out: ChordOk = { raw, ok: true, root: pitchClass(rootName)!, rootName, quality: suffix.quality, degrees: suffix.degrees };
  if (bassName) {
    out.bass = pitchClass(bassName)!;
    out.bassName = bassName;
  }
  return out;
}

// 정규 퀄리티 → 기본형 + 텐션 목록 ("13b9" → 13 + [b9], "maj7s11" → maj7 + [#11])
const SPLIT_RE = /^((?:mmaj|maj|dim|m)?(?:69|6|7|9|11|13)(?:sus[24])?(?:alt|b5|#5)?)((?:b9|#9|#11|b13|9|11|13)*)$/;
export function splitQuality(quality: string): { base: string; tensions: string[] } {
  if (quality === 'maj7s11') return { base: 'maj7', tensions: ['#11'] };
  const m = SPLIT_RE.exec(quality);
  if (!m) return { base: quality, tensions: [] };
  return { base: m[1], tensions: m[2].match(/b9|#9|#11|b13|9|11|13/g) ?? [] };
}

// 코드가 내는 피치클래스(베이스 포함, 중복 없음)
export function chordPcs(chord: ChordOk): number[] {
  const set = new Set(chord.degrees.map((d) => (chord.root + DEGREE_SEMITONES[d]) % 12));
  if (chord.bass !== undefined) set.add(chord.bass);
  return [...set];
}

// 같은 음을 내는 도수 묶음(예: m7b5#11 → [["b5","#11"]]). 엔진은 앞쪽 도수만 연주한다(CH-2b) → 화면 경고용
export function duplicatePitches(chord: ChordOk): string[][] {
  const byPc = new Map<number, string[]>();
  for (const d of chord.degrees) {
    const pc = DEGREE_SEMITONES[d] % 12;
    byPc.set(pc, [...(byPc.get(pc) ?? []), d]);
  }
  return [...byPc.values()].filter((g) => g.length > 1);
}
