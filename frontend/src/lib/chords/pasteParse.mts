// CH-2: 붙여넣기 파서 — 코드 악보 텍스트에서 코드 줄만 골라 내고, 반복되는 묶음을 진행 후보로
// 규칙: 개발산출물/결과/CH-1b_설계.md §5-5

import { parseChord } from './symbol.mts';

export type ChordLine = { line: number; section?: string; symbols: string[]; repeat: number };
export type RepeatCandidate = { chords: string[]; repeats: number; start: number; section?: string };

const SECTION_WORDS =
  'intro|verse|pre-?chorus|chorus|bridge|interlude|instrumental|solo|hook|refrain|break|outro|ending|coda|' +
  '인트로|벌스|프리코러스|코러스|후렴|브릿지|간주|아웃트로|엔딩';
const SECTION_RE = new RegExp(`^((?:${SECTION_WORDS})(?:\\s*\\d+)?)\\s*([:：])?\\s*(.*)$`, 'i');
const IGNORE_RE = /^[|/\\%:.\-–—~*→>]+$/; // 마디선·반복 기호·화살표
const BAR_NO_RE = /^\(?\d+\.?\)?$/; // 마디 번호
const NC_RE = /^\(?n\.?\s?c\.?\)?$/i;
const REPEAT_RE = /^\(?(?:[x×X]\s?(\d+)|(\d+)\s?[x×X])\)?$/;

const isChord = (tok: string): boolean => parseChord(tok).ok;

// 공백·| ·, 로 나누되 괄호 안(C7(b9, b13))은 나누지 않는다
function splitTokens(line: string): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  for (const ch of line) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && /[\s|,]/.test(ch)) {
      if (buf) out.push(buf);
      buf = '';
    } else buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

// 남은 토큰이 모두 코드여야 코드 줄(가사 줄의 A·Am 오인 방지). 아니면 null
function readTokens(line: string): { symbols: string[]; repeat: number } | null {
  const symbols: string[] = [];
  let repeat = 1;
  for (const tok of splitTokens(line)) {
    if (IGNORE_RE.test(tok) || BAR_NO_RE.test(tok) || NC_RE.test(tok)) continue;
    const rep = REPEAT_RE.exec(tok);
    if (rep) {
      repeat = Number(rep[1] || rep[2]);
      continue;
    }
    if (isChord(tok)) {
      symbols.push(tok);
      continue;
    }
    // "FM7-E7-Am7"처럼 하이픈으로 붙여 쓴 진행 (C-7 같은 코드는 위에서 이미 통과)
    const parts = tok.split('-');
    if (parts.length > 1 && parts.every((p) => p === '' || isChord(p))) {
      symbols.push(...parts.filter(Boolean));
      continue;
    }
    return null;
  }
  return symbols.length ? { symbols, repeat } : null;
}

export function extractChordLines(text: string): ChordLine[] {
  const out: ChordLine[] = [];
  let section: string | undefined;
  const push = (i: number, r: { symbols: string[]; repeat: number }) =>
    out.push({ line: i + 1, ...(section ? { section } : {}), symbols: r.symbols, repeat: r.repeat });

  String(text ?? '')
    .replace(/\r/g, '')
    .split('\n')
    .forEach((rawLine, i) => {
      let line = rawLine.replace(/\[\/?(?:ch|tab)\]/gi, '').trim(); // ultimate-guitar 태그
      if (!line) return;

      // 섹션 머리: [Verse 1] / [Chorus] Am F … (대괄호 안이 코드가 아닐 때)
      const bm = /^\[([^\]]+)\]\s*(.*)$/.exec(line);
      if (bm && !isChord(bm[1].trim()) && !NC_RE.test(bm[1].trim())) {
        section = bm[1].trim();
        line = bm[2].trim();
        if (!line) return;
      } else {
        // 섹션 머리: Verse 1: / Chorus / 후렴: Am F C G
        const sm = SECTION_RE.exec(line);
        if (sm) {
          const rest = sm[3].trim();
          const toks = rest ? readTokens(rest) : null;
          if (!rest || sm[2] || toks) {
            section = sm[1].trim();
            if (toks) push(i, toks);
            return;
          }
        }
      }

      // ChordPro: [Am]가사 [F]가사 → 대괄호 안 코드만
      const brackets = [...line.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim());
      if (brackets.length) {
        if (brackets.every((b) => isChord(b) || NC_RE.test(b))) {
          const symbols = brackets.filter((b) => !NC_RE.test(b));
          if (symbols.length) push(i, { symbols, repeat: 1 });
        }
        return;
      }

      const toks = readTokens(line);
      if (toks) push(i, toks);
    });
  return out;
}

// 같은 코드면 같은 키(FM7·Fmaj7은 같다)
function chordKey(sym: string): string {
  const c = parseChord(sym);
  return c.ok ? `${c.root}:${c.quality}:${c.bass ?? ''}` : sym;
}

// 더 짧은 묶음의 반복이면 true (C G C G = C G ×2)
function hasSmallerPeriod(block: string[]): boolean {
  for (let d = 1; d < block.length; d++) {
    if (block.length % d === 0 && block.every((x, j) => x === block[j % d])) return true;
  }
  return false;
}

function isRotation(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let r = 0; r < a.length; r++) if (b.every((x, j) => x === a[(j + r) % a.length])) return true;
  return false;
}

// 길이 2~8 묶음이 연속 2회 이상 반복되는 구간 → 상위 3개 + "전체 순서 그대로" 1개
export function findRepeats(symbols: string[], section?: string): RepeatCandidate[] {
  if (!symbols.length) return [];
  const keys = symbols.map(chordKey);
  const sec = section ? { section } : {};
  const groups: { sig: string[]; score: number; cand: RepeatCandidate }[] = [];

  for (let L = 2; L <= 8; L++) {
    for (let i = 0; i + 2 * L <= keys.length; i++) {
      const block = keys.slice(i, i + L);
      if (hasSmallerPeriod(block)) continue;
      let k = 1;
      while (i + (k + 1) * L <= keys.length && block.every((x, j) => keys[i + k * L + j] === x)) k++;
      if (k < 2) continue;
      // 같은 묶음·회전은 먼저 나온 쪽 하나로 합치고, 반복 수는 가장 큰 값
      const g = groups.find((x) => isRotation(x.sig, block));
      if (g) {
        g.score = Math.max(g.score, L * k);
        g.cand.repeats = Math.max(g.cand.repeats, k);
        continue;
      }
      groups.push({ sig: block, score: L * k, cand: { chords: symbols.slice(i, i + L), repeats: k, start: i, ...sec } });
    }
  }

  groups.sort((a, b) => b.score - a.score || a.cand.start - b.cand.start);
  return [...groups.slice(0, 3).map((g) => g.cand), { chords: symbols.slice(), repeats: 1, start: 0, ...sec }];
}
