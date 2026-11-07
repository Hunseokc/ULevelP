// CH-6: 취향 코드 진행 통계 + 랜덤 꺼내보기 (순수 함수, 브라우저에서 매번 계산)
// 범위: 개발산출물/결과/CH-0_범위확정.md §1(코드별 빈도, 코드 사이 이동, 자주 나오는 진행, Mood·Genre 횟수, 키 분포),
//       결과/CH-1b_설계.md §8(목록 GET /progressions 한 번 → 범위·통계·랜덤은 브라우저에서)

import type { ProgressionChordDto } from '../apiClient';

export type TasteInput = {
  id: string;
  key?: string | null;
  chords: ProgressionChordDto[];
  moods?: string[];
  genres?: string[];
};

export type Counted = { label: string; count: number };

export type TasteStats = {
  total: number; // 진행 수
  chordTotal: number; // 코드 개수(전체 등장)
  chords: Counted[]; // 코드 심볼 빈도(등장 횟수)
  romans: Counted[]; // 로마숫자 빈도(등장 횟수, roman 있는 칸만)
  moves: Counted[]; // 코드 사이 이동 "IM7 → vim7"(로마숫자 우선, 없으면 심볼). 같은 코드 반복은 뺀다
  patterns: Counted[]; // 자주 나오는 진행: 연속 3·4코드 묶음, 2곡 이상에 나온 것만(한 곡 안 중복은 1번)
  moods: Counted[]; // 진행 수(한 진행 안 중복은 1번)
  genres: Counted[];
  keys: Counted[]; // 키 분포(키 없는 진행은 뺀다)
};

export const PATTERN_LENGTHS: ReadonlyArray<number> = [4, 3];
export const MOVE_ARROW = ' → ';

const clean = (s: unknown): string => String(s ?? '').trim();

// 칸 하나의 비교용 이름: 로마숫자가 있으면 로마숫자(키가 달라도 같은 기능끼리 묶임), 없으면 심볼
export function chordLabel(c: ProgressionChordDto): string {
  return clean(c?.roman) || clean(c?.symbol);
}

function bump(map: Map<string, number>, label: string): void {
  if (!label) return;
  map.set(label, (map.get(label) || 0) + 1);
}

// 많이 나온 순 → 같으면 처음 나온 순(Map 삽입 순서). 정렬은 안정 정렬이라 삽입 순서가 남는다
export function ranked(map: Map<string, number>, min = 1): Counted[] {
  return [...map.entries()]
    .filter(([, n]) => n >= min)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

export function tasteStats(list: ReadonlyArray<TasteInput>): TasteStats {
  const chords = new Map<string, number>();
  const romans = new Map<string, number>();
  const moves = new Map<string, number>();
  const patterns = new Map<string, number>();
  const moods = new Map<string, number>();
  const genres = new Map<string, number>();
  const keys = new Map<string, number>();
  let chordTotal = 0;
  let total = 0;

  for (const p of list || []) {
    if (!p || !Array.isArray(p.chords)) continue;
    total++;
    const cells = p.chords.filter((c) => c && clean(c.symbol));
    chordTotal += cells.length;
    for (const c of cells) {
      bump(chords, clean(c.symbol));
      bump(romans, clean(c.roman));
    }
    const labels = cells.map(chordLabel);
    for (let i = 1; i < labels.length; i++) {
      if (labels[i] !== labels[i - 1]) bump(moves, labels[i - 1] + MOVE_ARROW + labels[i]);
    }
    const seen = new Set<string>();
    for (const n of PATTERN_LENGTHS) {
      for (let i = 0; i + n <= labels.length; i++) {
        const label = labels.slice(i, i + n).join(' - ');
        if (!seen.has(label)) {
          seen.add(label);
          bump(patterns, label);
        }
      }
    }
    for (const m of new Set((p.moods || []).map(clean))) bump(moods, m);
    for (const g of new Set((p.genres || []).map(clean))) bump(genres, g);
    bump(keys, clean(p.key));
  }

  return {
    total,
    chordTotal,
    chords: ranked(chords),
    romans: ranked(romans),
    moves: ranked(moves),
    patterns: dropContained(ranked(patterns, 2)),
    moods: ranked(moods),
    genres: ranked(genres),
    keys: ranked(keys),
  };
}

// 4코드 묶음과 같은 횟수인 3코드 묶음은 그 4코드의 일부일 뿐이라 뺀다(I - V - vi - IV 하나가 3개로 보이지 않게)
function dropContained(list: Counted[]): Counted[] {
  return list.filter(
    (a) => !list.some((b) => b !== a && b.count === a.count && b.label.length > a.label.length && (' - ' + b.label + ' - ').includes(' - ' + a.label + ' - '))
  );
}

// 지금 보이는 진행(currentId)과 다른 진행 하나를 고른다. 목록이 1개면 그것, 비면 null
export function pickRandom<T extends { id: string }>(list: ReadonlyArray<T>, currentId: string | null = null, rand: () => number = Math.random): T | null {
  if (!list || list.length === 0) return null;
  const pool = list.length > 1 && currentId ? list.filter((p) => p.id !== currentId) : list;
  const from = pool.length > 0 ? pool : list;
  const i = Math.min(from.length - 1, Math.max(0, Math.floor(rand() * from.length)));
  return from[i];
}

// 상위 n개
export function top(list: ReadonlyArray<Counted>, n = 5): Counted[] {
  return list.slice(0, Math.max(0, n));
}

// 통계 줄(자주 나오는 진행 "I - V - vi" / 코드 이동 "I → V")이 이 진행 안에 이어서 들어 있는지 — CHORDS 목록 거르기용
export function sequenceOf(label: string): string[] {
  const t = clean(label);
  if (!t) return [];
  return (t.includes(MOVE_ARROW.trim()) ? t.split(MOVE_ARROW.trim()) : t.split(' - ')).map(clean).filter(Boolean);
}

export function hasSequence(p: TasteInput, label: string): boolean {
  const want = sequenceOf(label);
  if (!p || !Array.isArray(p.chords) || want.length === 0) return false;
  const labels = p.chords.filter((c) => c && clean(c.symbol)).map(chordLabel);
  for (let i = 0; i + want.length <= labels.length; i++) {
    if (want.every((w, j) => labels[i + j] === w)) return true;
  }
  return false;
}
