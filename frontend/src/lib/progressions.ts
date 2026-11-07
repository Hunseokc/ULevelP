// frontend/src/lib/progressions.ts
import { raw, videoIdFrom } from './security';

export type ProgressionCategory = 'REFERENCE' | 'ARCHIVE';

export interface ProgressionItem {
  id: string;
  category: ProgressionCategory;
  chordsText: string;
  title: string;
  keyLabel: string;
  sourceType: 'AI' | '직접' | '기본';
  href: string;
}

export interface WeeklyStreakDay {
  dowLabel: 'Mo' | 'Tu' | 'We' | 'Th' | 'Fr' | 'Sa' | 'Su';
  dateStr: string;
  dayNumber: number;
  practiced: boolean;
  isToday: boolean;
}

export interface WeeklyStreakSummary {
  days: WeeklyStreakDay[];
  streakDays: number;
  cycleStep: number; // 0 | 1 | 2 | 3
  challengeText: string;
}

export const CHORD_MODES: ReadonlyArray<readonly [string, string]> = [
  ['scale', '스케일 연습'],
  ['tone', '코드톤 지도'],
  ['matrix', '보이싱 매트릭스'],
  ['circle', '탑노트 5도권'],
  ['reint', '코드 재해석'],
  ['tf', '2-5-1 탐색'],
  ['ds', '더블 스탑 연습'],
];

export const DEFAULT_REFERENCE_PROGRESSIONS: ReadonlyArray<ProgressionItem> = [
  {
    id: 'ref-seed-1',
    category: 'REFERENCE',
    chordsText: 'CM7 - C7 - F#m7b5 - Fm6',
    title: 'Neo-Soul Minor Plagal Cadence',
    keyLabel: 'C Major',
    sourceType: '기본',
    href: 'chords.html#reint',
  },
  {
    id: 'ref-seed-2',
    category: 'REFERENCE',
    chordsText: 'FM9 - E7b9 - Am9 - C13',
    title: 'Just the Two of Us Turnaround',
    keyLabel: 'A Minor',
    sourceType: '기본',
    href: 'chords.html#tf',
  },
  {
    id: 'ref-seed-3',
    category: 'REFERENCE',
    chordsText: 'EbM9 - D7#9 - Gm9 - C9sus4',
    title: 'R&B Floating IV-III-vi-II',
    keyLabel: 'G Minor',
    sourceType: '기본',
    href: 'chords.html#matrix',
  },
  {
    id: 'ref-seed-4',
    category: 'REFERENCE',
    chordsText: 'BbM7 - A7b13 - Dm9 - G7b9',
    title: 'Autumn Leaves Minor Cycle',
    keyLabel: 'D Minor',
    sourceType: '기본',
    href: 'chords.html#circle',
  },
  {
    id: 'ref-seed-5',
    category: 'REFERENCE',
    chordsText: 'AbM9 - G7#5#9 - Cm9 - F13',
    title: 'Modern Gospel Dorian Vamp',
    keyLabel: 'C Minor',
    sourceType: '기본',
    href: 'chords.html#tone',
  },
];

export const DEFAULT_ARCHIVE_PROGRESSIONS: ReadonlyArray<ProgressionItem> = [
  {
    id: 'arch-seed-1',
    category: 'ARCHIVE',
    chordsText: 'Dm9 - G13 - CM9 - A7b13',
    title: 'Drop 2 가이드톤 2-5-1-6 순환',
    keyLabel: 'C Major',
    sourceType: '기본',
    href: 'chords.html#tf',
  },
  {
    id: 'arch-seed-2',
    category: 'ARCHIVE',
    chordsText: 'Em7b5 - A7b9 - Dm6/9 - Bm7b5',
    title: '마이너 2-5-1 및 6도 토닉 보이싱',
    keyLabel: 'D Minor',
    sourceType: '기본',
    href: 'chords.html#tf',
  },
  {
    id: 'arch-seed-3',
    category: 'ARCHIVE',
    chordsText: 'F9 - Bb13 - Eb9 - Ab13',
    title: '탑노트 고정 도미넌트 5도권 연결',
    keyLabel: 'F Dominant',
    sourceType: '기본',
    href: 'chords.html#circle',
  },
  {
    id: 'arch-seed-4',
    category: 'ARCHIVE',
    chordsText: 'Gm9 - C7sus4 - FM9 - Bb7#11',
    title: '서스포(sus4) 해결과 리디안 도미넌트(#11)',
    keyLabel: 'F Major',
    sourceType: '기본',
    href: 'chords.html#reint',
  },
  {
    id: 'arch-seed-5',
    category: 'ARCHIVE',
    chordsText: 'Am11 - D9 - GM9 - C#m7b5 - F#7alt',
    title: '조표 전환 모듈레이션 브리지 진행',
    keyLabel: 'G Major',
    sourceType: '기본',
    href: 'chords.html#matrix',
  },
];

const DOW_LABELS: ReadonlyArray<'Mo' | 'Tu' | 'We' | 'Th' | 'Fr' | 'Sa' | 'Su'> = [
  'Mo',
  'Tu',
  'We',
  'Th',
  'Fr',
  'Sa',
  'Su',
];

export function getLocalTodayStr(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseYmdUtc(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const dt = new Date(Date.UTC(year, month, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return dt;
}

function formatYmdUtc(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysUtc(dt: Date, deltaDays: number): Date {
  return new Date(dt.getTime() + deltaDays * 86400000);
}

/**
 * 이번 주 월(Mo)~일(Su) 7일 스트릭 현황과 작심삼일 연속 일수를 계산한다.
 * @param activeDates 연습 기록이 존재하는 YYYY-MM-DD 문자열 목록
 * @param todayStr 기준 오늘 날짜 (YYYY-MM-DD, 기본값 로컬 오늘)
 */
export function computeWeeklyStreak(
  activeDates: Iterable<string>,
  todayStr: string = getLocalTodayStr()
): WeeklyStreakSummary {
  const practicedSet = new Set<string>();
  for (const d of activeDates) {
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) {
      practicedSet.add(d.trim());
    }
  }

  const baseDate = parseYmdUtc(todayStr) || parseYmdUtc(getLocalTodayStr())!;
  const cleanToday = formatYmdUtc(baseDate);

  // 월요일(Mo=0) ~ 일요일(Su=6) 오프셋
  const jsDay = baseDate.getUTCDay(); // 0(일) ~ 6(토)
  const mondayOffset = jsDay === 0 ? -6 : 1 - jsDay;
  const mondayDate = addDaysUtc(baseDate, mondayOffset);

  const days: WeeklyStreakDay[] = DOW_LABELS.map((dowLabel, idx) => {
    const dt = addDaysUtc(mondayDate, idx);
    const dateStr = formatYmdUtc(dt);
    return {
      dowLabel,
      dateStr,
      dayNumber: dt.getUTCDate(),
      practiced: practicedSet.has(dateStr),
      isToday: dateStr === cleanToday,
    };
  });

  // 연속 연습일(streakDays): 오늘 연습했으면 오늘부터 역산, 아직 안 했으면 어제부터 역산
  let streakDays = 0;
  const yesterdayStr = formatYmdUtc(addDaysUtc(baseDate, -1));
  let cursor: Date | null = null;
  if (practicedSet.has(cleanToday)) {
    cursor = baseDate;
  } else if (practicedSet.has(yesterdayStr)) {
    cursor = addDaysUtc(baseDate, -1);
  }

  while (cursor && streakDays < 3650) {
    const curStr = formatYmdUtc(cursor);
    if (!practicedSet.has(curStr)) break;
    streakDays++;
    cursor = addDaysUtc(cursor, -1);
  }

  const cycleStep = streakDays === 0 ? 0 : ((streakDays - 1) % 3) + 1;
  const challengeText =
    streakDays === 0
      ? '작심삼일 도전하기 · 오늘 첫 연습을 시작해 보세요'
      : `작심삼일 도전하기 · 연속 ${streakDays}일째 (${cycleStep}/3)`;

  return {
    days,
    streakDays,
    cycleStep,
    challengeText,
  };
}

/** 초(number)를 MM:SS 문자열로 포맷한다 (예: 90 -> "01:30") */
export function formatSec(sec: number | null | undefined): string {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec < 0) return '00:00';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

/** 최근 연습 곡의 상태/구간 요약 문구를 만든다 */
export function formatRecentSongSegment(song: {
  a?: number | null;
  b?: number | null;
  pos?: number | null;
  rate?: number | null;
}): string {
  if (
    typeof song.a === 'number' &&
    typeof song.b === 'number' &&
    Number.isFinite(song.a) &&
    Number.isFinite(song.b) &&
    song.b > song.a
  ) {
    const ratePart = song.rate && song.rate !== 1 ? ` · ${song.rate}×` : '';
    return `${formatSec(song.a)} ~ ${formatSec(song.b)} 구간 연습 중${ratePart}`;
  }
  const posStr = typeof song.pos === 'number' && song.pos > 0 ? formatSec(song.pos) : '00:00';
  const rateStr = song.rate ? `${song.rate}×` : '1×';
  return `마지막 위치 ${posStr} · ${rateStr} 연습 중`;
}

/** 최근 연습 곡의 플레이어 이어하기 상대 경로를 생성한다 */
export function buildPracticeResumeHref(song: {
  videoId: string;
  pos?: number | null;
  a?: number | null;
  b?: number | null;
  rate?: number | null;
}): string {
  const vid = videoIdFrom(song.videoId) || '';
  if (!vid) return 'practice.html';
  const params = new URLSearchParams();
  params.set('v', vid);
  if (typeof song.pos === 'number' && Number.isFinite(song.pos) && song.pos > 0) {
    params.set('t', String(Math.floor(song.pos)));
  }
  if (
    typeof song.a === 'number' &&
    typeof song.b === 'number' &&
    Number.isFinite(song.a) &&
    Number.isFinite(song.b) &&
    song.b > song.a
  ) {
    params.set('a', String(song.a));
    params.set('b', String(song.b));
  }
  if (typeof song.rate === 'number' && Number.isFinite(song.rate) && song.rate !== 1) {
    params.set('r', String(song.rate));
  }
  return 'practice.html?' + params.toString();
}

export function getLastChordTab(): string {
  const saved = raw.get('ulp:tab');
  return CHORD_MODES.some(([id]) => id === saved) ? saved : '';
}

