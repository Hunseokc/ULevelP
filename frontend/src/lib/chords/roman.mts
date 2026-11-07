// CH-2: 로마숫자 — 표기(IM9 - vim9 - iim7 - V7)
// 규칙: 개발산출물/결과/CH-1b_설계.md §5-3

import { parseChord, pitchClass, splitQuality } from './symbol.mts';
import type { ParsedChord } from './symbol.mts';

// 키 24개(철자·순서 고정)
export const KEYS = [
  'C Major', 'C min', 'Db Major', 'C# min', 'D Major', 'D min', 'Eb Major', 'Eb min',
  'E Major', 'E min', 'F Major', 'F min', 'F# Major', 'F# min', 'G Major', 'G min',
  'Ab Major', 'G# min', 'A Major', 'A min', 'Bb Major', 'Bb min', 'B Major', 'B min',
];

const KEY_RE = /^([A-G][#b]?) (Major|min)$/;

export function parseKey(key: string): { tonic: number; minor: boolean } | null {
  const m = KEY_RE.exec(String(key ?? '').trim());
  if (!m) return null;
  return { tonic: pitchClass(m[1])!, minor: m[2] === 'min' };
}

// 으뜸음 피치클래스 → 템플릿 철자의 키 이름
export function keyName(tonic: number, minor: boolean): string {
  return KEYS.find((k) => {
    const p = parseKey(k)!;
    return p.tonic === ((tonic % 12) + 12) % 12 && p.minor === minor;
  })!;
}

// 으뜸음에서 반음 수 → 도수. 6은 마이너·dim 계열이면 #IV, 그 외 bV
const NUMERALS = ['I', 'bII', 'II', 'bIII', 'III', 'IV', 'bV', 'V', 'bVI', 'VI', 'bVII', 'VII'];
const numeral = (iv: number, sharpFour: boolean): string => (iv === 6 && sharpFour ? '#IV' : NUMERALS[iv]);

function romanSuffix(quality: string): string {
  const { base, tensions } = splitQuality(quality);
  const head = base === 'maj' || base === 'm' ? '' : base.replace(/^mmaj/, 'mM').replace(/^maj/, 'M');
  return head + (tensions.length ? `(${tensions.join(',')})` : '');
}

// 코드 하나 → 로마숫자. 못 읽는 코드·키면 ''
export function toRoman(chord: ParsedChord | string, key: string): string {
  const c = typeof chord === 'string' ? parseChord(chord) : chord;
  const k = parseKey(key);
  if (!c.ok || !k) return '';
  const minorish = c.degrees.includes('b3');
  const num = numeral((c.root - k.tonic + 12) % 12, minorish);
  let out = (minorish ? num.toLowerCase() : num) + romanSuffix(c.quality);
  if (c.bass !== undefined) out += '/' + numeral((c.bass - k.tonic + 12) % 12, true);
  return out;
}

export function romanize(chords: (ParsedChord | string)[], key: string): string[] {
  return chords.map((c) => toRoman(c, key));
}
