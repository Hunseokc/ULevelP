// CH-5: CHORDS 화면용 순수 함수 — 코드 입력 나누기, 로마숫자·키, 폼 ↔ API 본문, 연습실·구간 반복 링크, 시드 변환
// 규칙: 개발산출물/결과/CH-1b_설계.md §2-1·§3·§8, 결과/CH-3_진행API.md §3

import { duplicatePitches, parseChord } from '../../lib/chords/symbol.mts';
import type { ChordFailReason } from '../../lib/chords/symbol.mts';
import { KEYS, keyName, parseKey, romanize } from '../../lib/chords/roman.mts';
import { guessKeys } from '../../lib/chords/keyGuess.mts';
import type { KeyGuess } from '../../lib/chords/keyGuess.mts';
import type { ProgressionChordDto, ProgressionDto, ProgressionInput, ProgressionScope } from '../../lib/apiClient';

export { KEYS };
export type { KeyGuess };

export const MAX_CHORDS = 64;
export const MAX_SYMBOL = 24;
export const MAX_LIST = 10;
export const MAX_LIST_ITEM = 30;

// ── 코드 입력 ─────────────────────────────────────────

// 공백·| ·, ·→ 로 나누되 괄호 안(C7(b9, b13))은 나누지 않는다 (pasteParse.mts splitTokens와 같은 규칙 + →)
function splitTokens(line: string): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  for (const ch of line) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && /[\s|,→]/.test(ch)) {
      if (buf) out.push(buf);
      buf = '';
    } else buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

const isChord = (tok: string): boolean => parseChord(tok).ok;

// "FM7 - E7 - Am7 Gm7 C7" / "FM7-E7-Am7" → ["FM7","E7","Am7","Gm7","C7"].
// 못 읽는 토큰도 남긴다(칩에 경고로 보여 주고 저장은 입력 표기 그대로 — 설계 §2-1)
export function splitChordInput(text: string): string[] {
  const out: string[] = [];
  for (const tok of splitTokens(String(text ?? ''))) {
    if (/^[-–—]+$/.test(tok)) continue;
    if (isChord(tok)) {
      out.push(tok);
      continue;
    }
    // 하이픈으로 붙여 쓴 진행 (C-7 같은 코드는 위에서 이미 통과)
    const parts = tok.split(/[-–—]/);
    if (parts.length > 1 && parts.every((p) => p === '' || isChord(p))) out.push(...parts.filter(Boolean));
    else out.push(tok);
  }
  return out;
}

export const FAIL_TEXT: Record<ChordFailReason, string> = {
  empty: '빈 코드',
  'no-chord': '코드 없음(N.C.) 표시',
  'bad-root': '근음은 A~G로 시작해야 합니다',
  'bad-bass': '슬래시 뒤 베이스음을 읽지 못했습니다',
  'bad-paren': '괄호가 맞지 않습니다',
  'unknown-suffix': '모르는 코드 표기입니다',
  conflict: '서로 맞지 않는 표기가 섞였습니다',
};

export type ChordCheck = { symbol: string; ok: boolean; warning: string };

// 칩 한 개의 상태: 못 읽음 / 너무 김 / 같은 음 도수 중복(경고만 — 결정 기록 2026-11-04)
export function checkChord(symbol: string): ChordCheck {
  if (symbol.length > MAX_SYMBOL) return { symbol, ok: false, warning: `코드는 ${MAX_SYMBOL}자까지 넣을 수 있습니다` };
  const c = parseChord(symbol);
  if (!c.ok) return { symbol, ok: false, warning: FAIL_TEXT[c.reason] };
  const dup = duplicatePitches(c);
  if (dup.length) {
    const pairs = dup.map((g) => g.join(' = ')).join(', ');
    return { symbol, ok: true, warning: `도수 표기는 중복이지만 연주 음은 겹칩니다 (${pairs})` };
  }
  return { symbol, ok: true, warning: '' };
}

export function keyCandidates(symbols: string[]): KeyGuess[] {
  return guessKeys(symbols);
}

// 키가 없으면 전부 ''. keep이 있으면 같은 자리·같은 심볼은 원래 roman을 쓴다(AI 값 유지)
export function computeRomans(symbols: string[], key: string, keep?: ProgressionChordDto[]): string[] {
  const auto = key ? romanize(symbols, key) : symbols.map(() => '');
  if (!keep) return auto;
  return symbols.map((s, i) => (keep[i] && keep[i].symbol === s ? keep[i].roman || '' : auto[i]));
}

// ── 폼 ↔ API ─────────────────────────────────────────

export type ProgressionForm = {
  kind: 'reference' | 'analysis';
  title: string;
  artist: string;
  part: string;
  album: string;
  releaseDate: string;
  key: string;
  chordsText: string;
  moods: string;
  genres: string;
  tags: string;
  url: string;
  memo: string;
};

export function emptyForm(kind: 'reference' | 'analysis' = 'reference'): ProgressionForm {
  return {
    kind,
    title: '',
    artist: '',
    part: '',
    album: '',
    releaseDate: '',
    key: '',
    chordsText: '',
    moods: '',
    genres: '',
    tags: '',
    url: '',
    memo: '',
  };
}

export function formFromDto(p: ProgressionDto): ProgressionForm {
  return {
    kind: p.kind,
    title: p.title || '',
    artist: p.artist || '',
    part: p.part || '',
    album: p.album || '',
    releaseDate: p.releaseDate || '',
    key: p.key || '',
    chordsText: (p.chords || []).map((c) => c.symbol).join(' - '),
    moods: (p.moods || []).join(', '),
    genres: (p.genres || []).join(', '),
    tags: (p.tags || []).join(', '),
    url: p.url || '',
    memo: p.memo || '',
  };
}

// "nostalgia, RnB ,  RnB" → ["nostalgia","RnB"] (앞뒤 공백 제거·중복 제거, 쉼표는 구분자)
export function splitList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of String(text ?? '').split(/[,，]/)) {
    const v = raw.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

// 코드 배열: 같은 자리·같은 심볼이면 원래 timestamp를 남긴다(source는 서버가 AI 행에서 다시 붙임 — CH-3 §3)
export function buildChords(symbols: string[], romans: string[], orig?: ProgressionChordDto[]): ProgressionChordDto[] {
  return symbols.map((symbol, i) => {
    const c: ProgressionChordDto = { symbol, roman: romans[i] || '' };
    const o = orig && orig[i];
    if (o && o.symbol === symbol && o.timestamp) c.timestamp = o.timestamp;
    return c;
  });
}

// 입력 검사. 문제가 있으면 첫 문구, 없으면 ''
export function validateForm(form: ProgressionForm, symbols: string[]): string {
  if (!form.title.trim()) return form.kind === 'reference' ? '곡 제목을 입력하세요.' : '제목을 입력하세요.';
  if (form.title.trim().length > 300) return '제목은 300자까지 넣을 수 있습니다.';
  if (form.kind === 'reference' && !form.artist.trim()) return '아티스트를 입력하세요.';
  if (!symbols.length) return '코드를 하나 이상 입력하세요.';
  if (symbols.length > MAX_CHORDS) return `코드는 ${MAX_CHORDS}개까지 넣을 수 있습니다.`;
  const long = symbols.find((s) => s.length > MAX_SYMBOL);
  if (long) return `코드는 ${MAX_SYMBOL}자까지 넣을 수 있습니다: ${long}`;
  for (const [label, text] of [['Mood', form.moods], ['Genre', form.genres], ['Tag', form.tags]] as const) {
    const items = splitList(text);
    if (items.length > MAX_LIST) return `${label}는 ${MAX_LIST}개까지 넣을 수 있습니다.`;
    const over = items.find((x) => x.length > MAX_LIST_ITEM);
    if (over) return `${label} 항목은 ${MAX_LIST_ITEM}자까지 넣을 수 있습니다: ${over}`;
  }
  const url = form.url.trim();
  if (url && !/^https?:\/\//i.test(url)) return '링크는 http:// 또는 https://로 시작해야 합니다.';
  if (form.releaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(form.releaseDate)) return '발매일은 YYYY-MM-DD 형식이어야 합니다.';
  return '';
}

// POST 본문 (서버가 origin·route·evidence를 정한다)
export function formToCreate(form: ProgressionForm, symbols: string[], romans: string[]): ProgressionInput {
  return {
    kind: form.kind,
    title: form.title.trim(),
    chords: buildChords(symbols, romans),
    part: form.part.trim(),
    artist: form.artist.trim(),
    album: form.album.trim(),
    releaseDate: form.releaseDate || null,
    key: form.key || null,
    moods: splitList(form.moods),
    genres: splitList(form.genres),
    tags: splitList(form.tags),
    url: form.url.trim(),
    memo: form.memo.trim(),
  };
}

const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
const chordSig = (cs: ProgressionChordDto[]): string => JSON.stringify(cs.map((c) => [c.symbol, c.roman || '', c.timestamp || '']));

// PATCH 본문: 바뀐 필드만. 아무것도 안 바뀌면 빈 객체(서버는 빈 본문을 400으로 받으므로 화면이 보내지 않는다)
export function formToPatch(form: ProgressionForm, symbols: string[], romans: string[], orig: ProgressionDto): ProgressionInput {
  const next = formToCreate(form, symbols, romans);
  next.chords = buildChords(symbols, romans, orig.chords);
  const patch: ProgressionInput = {};
  if (next.kind !== orig.kind) patch.kind = next.kind;
  for (const f of ['title', 'part', 'artist', 'album', 'url', 'memo'] as const) {
    if (next[f] !== (orig[f] || '')) patch[f] = next[f];
  }
  if ((next.releaseDate || null) !== (orig.releaseDate || null)) patch.releaseDate = next.releaseDate || null;
  if ((next.key || null) !== (orig.key || null)) patch.key = next.key || null;
  for (const f of ['moods', 'genres', 'tags'] as const) {
    if (!sameList(next[f]!, orig[f] || [])) patch[f] = next[f];
  }
  if (chordSig(next.chords) !== chordSig(orig.chords || [])) patch.chords = next.chords;
  return patch;
}

// AI 행에서 코드·키를 바꾸면 출처가 직접으로 바뀐다(설계 Q5) → 저장 전에 알려 줄지
export function patchTurnsManual(patch: ProgressionInput, orig: ProgressionDto): boolean {
  return orig.origin === 'ai' && (patch.chords !== undefined || patch.key !== undefined);
}

// ── 목록 ─────────────────────────────────────────────

export function filterScope<T extends { kind: string }>(list: T[], scope: ProgressionScope): T[] {
  return scope === 'all' ? list.slice() : list.filter((p) => p.kind === scope);
}

export const ORIGIN_LABEL: Record<string, string> = { ai: 'AI', manual: '직접' };
export const ROUTE_LABEL: Record<string, string> = { video: '코드 진행 영상', note: '학습 영상 노트', manual: '직접 입력' };
export const KIND_LABEL: Record<string, string> = { reference: '레퍼런스', analysis: '분석' };

export function chordLine(p: { chords: ProgressionChordDto[] }): string {
  return (p.chords || []).map((c) => c.symbol).join(' - ');
}

export function romanLine(p: { chords: ProgressionChordDto[] }): string {
  const rs = (p.chords || []).map((c) => c.roman || '');
  return rs.some(Boolean) ? rs.map((r) => r || '?').join(' - ') : '';
}

// 연습실 "진행 연주" 탭 링크 (CH-1a §3-1 확정): chords.html#prog?c=<심볼,>&k=<키>&t=<제목>&from=<id>
// n=<노트 id>: 노트(영상 분석)에서 온 진행이면 연습실에서 원본 노트(건반 보이싱 등)로 바로 간다
export function playHref(p: { id?: string; title?: string; key?: string | null; chords: ProgressionChordDto[]; noteId?: string | null }): string {
  const qs = new URLSearchParams();
  qs.set('c', (p.chords || []).map((c) => c.symbol).join(','));
  if (p.key) qs.set('k', p.key);
  if (p.title) qs.set('t', p.title);
  if (p.id) qs.set('from', p.id);
  if (p.noteId && UUID_RE.test(p.noteId)) qs.set('n', p.noteId);
  return 'chords.html#prog?' + qs.toString();
}

// 영상 구간 반복 (CH-1a §1): practice.html?v=<영상>&t=<시작 초>
export function loopHref(p: { videoId: string | null; startSec: number | null }): string {
  if (!p.videoId || !/^[A-Za-z0-9_-]{11}$/.test(p.videoId)) return '';
  let href = 'practice.html?v=' + encodeURIComponent(p.videoId);
  if (p.startSec !== null && p.startSec !== undefined && p.startSec >= 0) href += '&t=' + p.startSec;
  return href;
}

export function formatSec(sec: number | null): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// ── 코드 진행 영상 분석 구간·속도 (GA-2, 개발산출물/진행_분석설정.md §3-2) ─────

export const MAX_SEC = 86400;
export type Pace = 'slow' | 'normal' | 'fast';
export const PACES: Pace[] = ['slow', 'normal', 'fast'];
export const PACE_LABEL: Record<Pace, string> = { slow: '느림', normal: '보통', fast: '빠름' };

/**
 * 시간 입력 → 초. `80`·`1:20`·`1:02:03`. 빈 칸은 null(전체), 형식·범위가 틀리면 undefined.
 * 분·초 칸(첫 칸 제외)은 0~59, 결과는 0~86400.
 */
export function parseTimeInput(text: string): number | null | undefined {
  const t = String(text ?? '').trim();
  if (!t) return null;
  if (!/^\d{1,5}(:\d{1,2}){0,2}$/.test(t)) return undefined;
  const parts = t.split(':').map(Number);
  if (parts.slice(1).some((n) => n > 59)) return undefined;
  const sec = parts.reduce((acc, n) => acc * 60 + n, 0);
  return sec <= MAX_SEC ? sec : undefined;
}

export type RangeCheck = { startSec: number | null; endSec: number | null; error: string };

/** 시작·끝 칸 → 초 + 오류 문구(없으면 ''). 서버 검증(§3-2)과 같은 규칙 */
export function checkRange(startText: string, endText: string): RangeCheck {
  const s = parseTimeInput(startText);
  const e = parseTimeInput(endText);
  if (s === undefined || e === undefined) {
    return { startSec: null, endSec: null, error: '시간은 1:20 또는 80처럼 적어 주세요(최대 24시간).' };
  }
  if (e !== null && e <= (s ?? 0)) {
    return { startSec: s, endSec: e, error: '끝 시간은 시작보다 1초 이상 뒤여야 해요.' };
  }
  return { startSec: s, endSec: e, error: '' };
}

/** 작업 줄 표시: `0:40–1:20 · 빠름`. 구간·속도 정보가 없으면 '' */
export function jobOptionsLabel(j: { startSec?: number | null; endSec?: number | null; pace?: string | null }): string {
  const has = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
  let range = '';
  if (has(j.startSec) || has(j.endSec)) {
    range = `${has(j.startSec) ? formatSec(j.startSec) : '0:00'}–${has(j.endSec) ? formatSec(j.endSec) : '끝'}`;
  }
  const pace = j.pace && (PACES as string[]).includes(j.pace) ? PACE_LABEL[j.pace as Pace] : '';
  return [range, pace].filter(Boolean).join(' · ');
}

/**
 * GA-4: 끝난(done) 작업을 한 줄로 합친다. jobs는 최신순(서버 /notes/jobs 순서).
 * collected = 그 작업들의 노트에서 온 진행 수, latestNoteId = 가장 최근 완료 작업의 노트
 */
export function summarizeDoneJobs(
  jobs: ReadonlyArray<{ status: string; noteId?: string | null }>,
  items: ReadonlyArray<{ noteId?: string | null }>
): { jobCount: number; collected: number; latestNoteId: string | null } {
  const done = jobs.filter((j) => j.status === 'done');
  const noteIds = new Set(done.map((j) => j.noteId).filter((v): v is string => Boolean(v)));
  const collected = items.filter((p) => p.noteId && noteIds.has(p.noteId)).length;
  const latest = done.find((j) => j.noteId);
  return { jobCount: done.length, collected, latestNoteId: latest && latest.noteId ? latest.noteId : null };
}

// ── 비로그인 시드 (설계 §8: DEFAULT_REFERENCE/ARCHIVE_PROGRESSIONS) ─────

export type SeedItem = { id: string; category: 'REFERENCE' | 'ARCHIVE'; chordsText: string; title: string; keyLabel: string };

// 시드 키 표기("A Minor")를 KEYS 표기("A min")로. 모르는 표기("F Dominant")는 null
export function seedKey(label: string): string | null {
  const m = /^([A-G][#b]?) (Major|Minor|min)$/.exec(String(label ?? '').trim());
  if (!m) return null;
  const want = `${m[1]} ${m[2] === 'Major' ? 'Major' : 'min'}`;
  return KEYS.includes(want) ? want : null;
}

export function seedToDto(s: SeedItem): ProgressionDto {
  const symbols = splitChordInput(s.chordsText);
  const key = seedKey(s.keyLabel);
  const romans = computeRomans(symbols, key || '');
  return {
    id: s.id,
    kind: s.category === 'REFERENCE' ? 'reference' : 'analysis',
    origin: 'manual',
    route: 'manual',
    evidence: null,
    title: s.title,
    part: '',
    artist: '',
    album: '',
    channel: '',
    releaseDate: null,
    key,
    instrument: null,
    chords: buildChords(symbols, romans),
    moods: [],
    genres: [],
    tags: [],
    url: '',
    videoId: null,
    startSec: null,
    endSec: null,
    memo: '',
    noteId: null,
    createdAt: '',
    updatedAt: '',
  };
}

// ── 목록 검색·정렬 (CH-5b) ─────────────────────────────

export type SortBy = 'recent' | 'title' | 'key';
export const SORT_LABEL: Record<SortBy, string> = { recent: '최근 추가', title: '곡명', key: '키' };

type Listed = { title?: string; artist?: string; channel?: string; key?: string | null };

// 곡명·아티스트(채널)·키에 검색어가 들어 있는 행. 공백만 다르면 같게 본다("fmajor" ~ "F Major")
export function searchProgressions<T extends Listed>(list: T[], query: string): T[] {
  const q = String(query ?? '').toLowerCase().replace(/\s+/g, '');
  if (!q) return list.slice();
  return list.filter((p) =>
    [p.title, p.artist, p.channel, p.key].some((v) => String(v ?? '').toLowerCase().replace(/\s+/g, '').includes(q))
  );
}

const titleCmp = (a: Listed, b: Listed): number => {
  const ta = (a.title || '').trim();
  const tb = (b.title || '').trim();
  if (!ta || !tb) return ta ? -1 : tb ? 1 : 0; // 제목 없는 행은 뒤로
  return ta.localeCompare(tb, 'ko', { sensitivity: 'base', numeric: true });
};

// recent = 받은 순서 그대로(서버·시드 순서). key = KEYS 24개 순서(C Major, C min, Db Major …), 키 없는 행은 뒤, 같은 키는 곡명 순
export function sortProgressions<T extends Listed>(list: T[], by: SortBy): T[] {
  const out = list.slice();
  if (by === 'title') return out.sort(titleCmp);
  if (by === 'key') {
    const rank = (p: Listed): number => {
      const i = p.key ? KEYS.indexOf(p.key) : -1;
      return i < 0 ? KEYS.length : i;
    };
    return out.sort((a, b) => rank(a) - rank(b) || titleCmp(a, b));
  }
  return out;
}

// ── 연습실 진행 연주 탭 (CH-5b) ─────────────────────────

export type ProgHash = { chords: string[]; key: string; title: string; from: string; note: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "#prog" 또는 "#prog?…" (연습실이 진행 연주 탭을 여는 해시)
export function isProgHash(hash: string): boolean {
  return /^#?prog(?:\?|$)/.test(String(hash ?? ''));
}

// playHref의 역함수. 키는 KEYS 24개 표기만, 노트 id(n)는 UUID만, 진행 id는 영숫자·_-(UUID·시드 id), 코드는 64개·제목은 300자까지
export function parseProgHash(hash: string): ProgHash | null {
  const h = String(hash ?? '');
  if (!isProgHash(h)) return null;
  const qi = h.indexOf('?');
  const qs = new URLSearchParams(qi >= 0 ? h.slice(qi + 1) : '');
  const chords = (qs.get('c') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_CHORDS);
  const k = (qs.get('k') || '').trim();
  const from = (qs.get('from') || '').trim();
  const note = (qs.get('n') || '').trim();
  return {
    chords,
    key: KEYS.includes(k) ? k : '',
    title: (qs.get('t') || '').trim().slice(0, 300),
    from: /^[A-Za-z0-9_-]{1,64}$/.test(from) ? from : '',
    note: UUID_RE.test(note) ? note : '',
  };
}

// 진행 연주 탭 → 코드 진행 모음의 그 행 (CH-5 §3: 범위가 맞아야 보이므로 scope=all)
export function backHref(from: string): string {
  return from && /^[A-Za-z0-9_-]{1,64}$/.test(from) ? `progressions.html?scope=all#p-${from}` : 'progressions.html';
}

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARP_KEYS = ['G Major', 'D Major', 'A Major', 'E Major', 'B Major', 'E min', 'B min'];

const mod12 = (n: number): number => ((n % 12) + 12) % 12;

// 키를 반음 n개 옮긴다(KEYS 표기). 키가 없거나 못 읽으면 ''
export function transposeKey(key: string, semis: number): string {
  const k = parseKey(key);
  return k ? keyName(k.tonic + semis, k.minor) : '';
}

// 코드 심볼을 반음 n개 옮긴다. 근음·슬래시 베이스만 바꾸고 나머지 표기는 그대로(못 읽는 코드는 그대로).
// 철자: 옮긴 키가 # 키면 #, 그 밖(키 없음 포함)은 b
export function transposeSymbol(symbol: string, semis: number, targetKey = ''): string {
  const c = parseChord(symbol);
  if (!c.ok || !mod12(semis)) return symbol;
  const names = targetKey.includes('#') || SHARP_KEYS.includes(targetKey) ? SHARP_NAMES : FLAT_NAMES;
  const s = String(symbol).trim();
  const rm = /^[A-G](?:[#b♯♭])?/.exec(s);
  if (!rm) return symbol;
  let rest = s.slice(rm[0].length);
  if (c.bass !== undefined) {
    const slash = rest.lastIndexOf('/');
    rest = rest.slice(0, slash) + '/' + names[mod12(c.bass + semis)];
  }
  return names[mod12(c.root + semis)] + rest;
}
