// CH-2: 키 추정 — 24개 키마다 점수를 매겨 상위 3개
// 규칙: 개발산출물/결과/CH-1b_설계.md §5-4

import { chordPcs, parseChord } from './symbol.mts';
import type { ChordOk, ParsedChord } from './symbol.mts';
import { KEYS, parseKey } from './roman.mts';

export type KeyGuess = { key: string; score: number };

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10, 11]; // 자연단음계 + 화성단음계 7음

export function guessKeys(chords: (ParsedChord | string)[]): KeyGuess[] {
  const list = chords.map((c) => (typeof c === 'string' ? parseChord(c) : c)).filter((c): c is ChordOk => c.ok);
  if (!list.length) return [];
  const pcsList = list.map(chordPcs);

  const scored = KEYS.map((key, order) => {
    const { tonic, minor } = parseKey(key)!;
    const scale = new Set((minor ? MINOR_SCALE : MAJOR_SCALE).map((i) => (tonic + i) % 12));
    // I(메이저 키) = 으뜸음 근음 + b3 없음, i(마이너 키) = 으뜸음 근음 + b3
    const isTonic = (c: ChordOk) => c.root === tonic && c.degrees.includes('b3') === minor;
    const isDominant = (c: ChordOk) => c.root === (tonic + 7) % 12 && c.degrees.includes('3') && c.degrees.includes('b7');

    let score = 0;
    for (const pcs of pcsList) score += pcs.filter((p) => scale.has(p)).length / pcs.length;
    if (isTonic(list[0])) score += 2;
    if (isTonic(list[list.length - 1])) score += 1.5;
    for (let i = 0; i + 1 < list.length; i++) if (isDominant(list[i]) && isTonic(list[i + 1])) score += 1;
    return { key, score: Math.round(score * 100) / 100, order };
  });

  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.slice(0, 3).map(({ key, score }) => ({ key, score }));
}
