// frontend/src/components/chords/ChordDiagrams.tsx
import React from 'react';
import { BoardNote, CT, DoubleStopIntervalId, GE } from '../../lib/musicEngine';

export interface DiagramNote {
  s: number;
  f: number;
  pitch?: number;
  deg?: string;
  name?: string;
  text?: string;
  cls?: string;
  moved?: boolean;
  dim?: boolean;
  now?: boolean;
  ctx?: boolean;
  press?: boolean;
  isRoot?: boolean;
  isLowestRoot?: boolean;
  lowestRoot?: boolean;
}

export interface DoubleStopPairOption {
  key: string;
  pair: [number, number];
  label: string;
  sub?: string;
  skipped: boolean;
}

export interface BlockSeqMilestoneSummary {
  totalSteps: number;
  startLabel: string;
  highPeakLabel: string;
  lowPeakLabel: string;
  endLabel: string;
  summaryText: string;
}

const INLAY_FRETS = [3, 5, 7, 9, 15, 17, 19, 21];
const MARK_FRETS = [3, 5, 7, 9, 12, 15, 17, 19, 21];

export function dotClassOf(n: DiagramNote): string {
  const parts: string[] = ['nd'];
  if (n.now) parts.push('now');
  if (n.cls) parts.push(n.cls);
  if (n.moved) parts.push('moved');
  if (n.dim) parts.push('dim');
  if (n.ctx) parts.push('ctx');
  if (n.press) parts.push('press');
  if (n.lowestRoot || n.isLowestRoot) parts.push('lowestRoot');
  return parts.join(' ');
}

/** 6현 세로 코드표/지판용 프렛 문자열 (예: "x x 10 12 12 12") */
export function fretText(notes: ReadonlyArray<{ s: number; f: number }>): string {
  return [0, 1, 2, 3, 4, 5]
    .map((s) => {
      const found = notes.find((m) => m.s === s);
      return found ? String(found.f) : 'x';
    })
    .join(' ');
}

export function pitchesOf(notes: ReadonlyArray<{ s: number; f: number; pitch?: number }>, open: number[] = CT.OPEN): number[] {
  return notes.map((n) => (typeof n.pitch === 'number' ? n.pitch : open[n.s] + n.f));
}

export function buildCtxNotes(
  rootPc: number,
  tones: ReadonlyArray<{ iv: number; deg: string }>,
  open: number[] = CT.OPEN
): DiagramNote[] {
  const byPc: Record<number, { iv: number; deg: string }> = {};
  tones.forEach((t) => {
    byPc[CT.pc(rootPc + t.iv)] = t;
  });
  const out: DiagramNote[] = [];
  open.forEach((o, s) => {
    for (let f = 0; f <= 22; f++) {
      const t = byPc[CT.pc(o + f)];
      if (t) {
        out.push({
          s,
          f,
          pitch: o + f,
          deg: t.deg,
          cls: t.iv === 0 ? 'root' : '',
          ctx: true,
        });
      }
    }
  });
  return out;
}

export function q4Tones(qid: string): Array<{ iv: number; deg: string }> {
  const q = CT.QBY[qid];
  if (!q) return [];
  return q.iv.map((iv, i) => ({ iv, deg: q.deg[i] }));
}

export function geTones(q: string): Array<{ iv: number; deg: string }> {
  const ch = GE.CH[q];
  if (!ch) return [];
  return ch.map((d) => ({ iv: GE.DEG[d][0], deg: d }));
}

export function geNotesToDiagram(v: { notes: Array<{ s: number; f: number; pitch?: number; deg: string; cls: string }> }): DiagramNote[] {
  return v.notes.map((n) => ({
    s: n.s,
    f: n.f,
    pitch: n.pitch,
    deg: n.deg,
    cls: n.cls === 'root' ? 'root' : n.cls === '3' || n.cls === '7' ? 'guide' : '',
  }));
}

/**
 * 악기 줄 수(4~7현)와 더블 스탑 음정('3rd'|'6th'|'4th')에 맞는 줄 쌍 선택지 목록을 반환한다.
 * s 인덱스는 0 = 가장 굵은 저음현(n번줄), n - 1 = 1번줄.
 */
export function getDoubleStopPairs(numStrings: number, interval: DoubleStopIntervalId): DoubleStopPairOption[] {
  const n = Math.max(4, numStrings);
  const adjacent: DoubleStopPairOption[] = [];
  for (let sHigh = n - 1; sHigh >= 1; sHigh--) {
    const sLow = sHigh - 1;
    const highNum = n - sHigh;
    const lowNum = n - sLow;
    adjacent.push({
      key: `${sLow}-${sHigh}`,
      pair: [sLow, sHigh],
      label: `${highNum}-${lowNum}번줄`,
      skipped: false,
    });
  }

  const skipped: DoubleStopPairOption[] = [];
  for (let sHigh = n - 1; sHigh >= 2; sHigh--) {
    const sLow = sHigh - 2;
    const highNum = n - sHigh;
    const lowNum = n - sLow;
    skipped.push({
      key: `${sLow}-${sHigh}`,
      pair: [sLow, sHigh],
      label: `${highNum}-${lowNum}번줄`,
      sub: interval === '6th' ? '6도 추천' : '건너뛴 줄',
      skipped: true,
    });
  }

  return [...adjacent, ...skipped];
}

/**
 * 악기 줄 수(4~7현)와 음정('3rd'|'6th'|'4th'), 현재 줄 쌍을 받아 유효한 줄 쌍으로 정규화한다.
 * 이전 악기(예: 6현 [4,5])에서 줄 수가 적은 악기(예: 4현 [0,1,2,3])로 전환되거나 음정이 바뀔 때 렌더링 동기 크래시를 방지한다.
 */
export function getSafeDoubleStopPair(
  numStrings: number,
  interval: DoubleStopIntervalId,
  currentPair?: [number, number] | null
): [number, number] {
  const n = Math.max(4, numStrings);
  const isPairValid =
    Array.isArray(currentPair) &&
    currentPair.length === 2 &&
    currentPair[0] >= 0 &&
    currentPair[1] < n &&
    currentPair[0] < currentPair[1] &&
    (interval === '6th' ? currentPair[1] - currentPair[0] === 2 : currentPair[1] - currentPair[0] === 1);

  if (isPairValid && currentPair) {
    return [currentPair[0], currentPair[1]];
  }
  if (interval === '6th') {
    return [Math.max(0, n - 3), n - 1];
  }
  return [Math.max(0, n - 2), n - 1];
}

/**
 * CAGED 블럭 정규 음 배열과 scaleBlockSeq 시퀀스로부터 4대 이정표 요약(시작 최저 루트 -> 1번줄 끝 -> 최저현 최저음 -> 최저 루트 복귀)을 생성한다.
 */
export function formatBlockSeqSummary(
  blockNotes: ReadonlyArray<BoardNote>,
  seq: ReadonlyArray<BoardNote>,
  numStrings = 6
): BlockSeqMilestoneSummary {
  if (!blockNotes.length || !seq.length) {
    return {
      totalSteps: 0,
      startLabel: '-',
      highPeakLabel: '-',
      lowPeakLabel: '-',
      endLabel: '-',
      summaryText: '',
    };
  }
  const sorted = [...blockNotes].sort((a, b) => a.pitch - b.pitch);
  const lowestNote = sorted[0];
  const highestNote = sorted[sorted.length - 1];
  const startNote = seq[0];
  const endNote = seq[seq.length - 1];

  const fmtPos = (n: BoardNote) => `${numStrings - n.s}·${n.f} (${n.name})`;
  const startLabel = `시작: 최저 루트 ${fmtPos(startNote)}`;
  const highPeakLabel = `1번줄 끝 ${fmtPos(highestNote)}`;
  const lowPeakLabel = `${numStrings}번줄 최저 ${fmtPos(lowestNote)}`;
  const endLabel = `마무리: 최저 루트 ${fmtPos(endNote)}`;

  return {
    totalSteps: seq.length,
    startLabel,
    highPeakLabel,
    lowPeakLabel,
    endLabel,
    summaryText: `[${startLabel}] → [${highPeakLabel}] → [${lowPeakLabel}] → [${endLabel}] (총 ${seq.length}스텝)`,
  };
}

/** 1. 기본 6현 가로 지판 (코드톤 지도 · 코드 재해석 입력용) */
export interface FretboardSvgProps {
  from?: number;
  to?: number;
  fretW?: number;
  label?: string;
  clickable?: boolean;
  notes: ReadonlyArray<DiagramNote>;
  onCellClick?: (s: number, f: number) => void;
}

export function FretboardSvg({
  from = 0,
  to = 15,
  fretW = 44,
  label = '지판',
  clickable = false,
  notes,
  onCellClick,
}: FretboardSvgProps): React.ReactElement {
  const L = 30;
  const T = 14;
  const GAP = 22;
  const W = fretW;
  const first = Math.max(1, from);
  const showOpen = from === 0;
  const xL = L + (showOpen ? 26 : 0);
  const width = xL + (to - first + 1) * W + 10;
  const height = T + GAP * 5 + 30;
  const xOf = (f: number) => (f === 0 ? L + 10 : xL + (f - first + 0.5) * W);
  const yOf = (s: number) => T + (5 - s) * GAP;

  const fretLines: number[] = [];
  for (let f = first - 1; f <= to; f++) fretLines.push(f);

  const fretLabels: number[] = [];
  for (let f = first; f <= to; f++) fretLabels.push(f);

  return (
    <svg
      className="fb"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
    >
      <rect
        className="wood"
        x={xL}
        y={T - 6}
        width={(to - first + 1) * W}
        height={GAP * 5 + 12}
        rx={0}
      />
      {INLAY_FRETS.filter((f) => f >= first && f <= to).map((f) => (
        <circle key={`inlay-${f}`} className="inlay" cx={xOf(f)} cy={T + GAP * 2.5} r={4} />
      ))}
      {12 >= first && 12 <= to && (
        <>
          <circle className="inlay" cx={xOf(12)} cy={T + GAP * 1.5} r={4} />
          <circle className="inlay" cx={xOf(12)} cy={T + GAP * 3.5} r={4} />
        </>
      )}
      {fretLines.map((f) => {
        const x = xL + (f - first + 1) * W;
        return (
          <line
            key={`line-${f}`}
            className={f === 0 ? 'nut' : 'fret'}
            x1={x}
            x2={x}
            y1={T - 6}
            y2={T + GAP * 5 + 6}
          />
        );
      })}
      {[0, 1, 2, 3, 4, 5].map((s) => (
        <React.Fragment key={`str-${s}`}>
          <line
            className="str"
            strokeWidth={(0.7 + (6 - s) * 0.22).toFixed(2)}
            x1={showOpen ? L : xL}
            x2={width - 10}
            y1={yOf(s)}
            y2={yOf(s)}
          />
          <text className="slab" x={10} y={yOf(s)}>
            {6 - s}
          </text>
        </React.Fragment>
      ))}
      {fretLabels.map((f) => (
        <text key={`flab-${f}`} className="flab" x={xOf(f)} y={T + GAP * 5 + 20}>
          {f}
        </text>
      ))}
      {clickable &&
        [0, 1, 2, 3, 4, 5].map((s) => (
          <React.Fragment key={`hit-row-${s}`}>
            {showOpen && (
              <rect
                className="hit"
                data-s={s}
                data-f={0}
                x={L - 4}
                y={yOf(s) - GAP / 2}
                width={xL - L + 4}
                height={GAP}
                onClick={() => onCellClick && onCellClick(s, 0)}
              />
            )}
            {fretLabels.map((f) => (
              <rect
                key={`hit-${s}-${f}`}
                className="hit"
                data-s={s}
                data-f={f}
                x={xL + (f - first) * W}
                y={yOf(s) - GAP / 2}
                width={W}
                height={GAP}
                onClick={() => onCellClick && onCellClick(s, f)}
              />
            ))}
          </React.Fragment>
        ))}
      {notes
        .filter((n) => n.f >= from && n.f <= to)
        .map((n, idx) => {
          const x = xOf(n.f);
          const y = yOf(n.s);
          return (
            <g key={`nd-${n.s}-${n.f}-${idx}`} className={dotClassOf(n)}>
              <circle cx={x} cy={y} r={9.5} />
              <text x={x} y={y}>
                {n.deg || ''}
              </text>
            </g>
          );
        })}
    </svg>
  );
}

/** 2. 가변 줄 수(4~7현) 넓은 가로 지판 (스케일 연습 · 보이싱 매트릭스 · 탑노트 5도권 · 2-5-1 탐색 · 더블 스탑 연습) */
export interface NeckSvgProps {
  open?: number[];
  isBass?: boolean;
  lo: number;
  hi: number;
  flip?: boolean;
  block?: { lo: number; hi: number } | null;
  label?: string;
  notes: ReadonlyArray<DiagramNote>;
  onNoteClick?: (pitch: number, note: DiagramNote) => void;
}

export function NeckSvg({
  open = CT.OPEN,
  isBass = false,
  lo,
  hi,
  flip = false,
  block = null,
  label = '지판',
  notes,
  onNoteClick,
}: NeckSvgProps): React.ReactElement {
  const n = open.length;
  const VW = 1000;
  const L = 38;
  const R = 14;
  const T = 20;
  const GAP = isBass ? 34 : 30;
  const showOpen = lo === 0;
  const first = Math.max(1, lo);
  const OW = showOpen ? 40 : 0;
  const xL = L + OW;
  const W = (VW - xL - R) / Math.max(1, hi - first + 1);
  const H = T + GAP * (n - 1) + 40;
  const fx = (x: number) => (flip ? VW - x : x);
  const xOf = (f: number) => fx(f === 0 ? L + OW / 2 - 2 : xL + (f - first + 0.5) * W);
  const lineX = (f: number) => (f < first ? L : xL + (f - first + 1) * W);
  const yOf = (s: number) => T + (n - 1 - s) * GAP;
  const mid = T + (GAP * (n - 1)) / 2;

  const renderRect = (x1: number, x2: number, y: number, h: number, cls: string) => (
    <rect
      className={cls}
      x={Math.min(fx(x1), fx(x2))}
      y={y}
      width={Math.abs(x2 - x1)}
      height={h}
      rx={0}
    />
  );

  const fretLines: number[] = [];
  for (let f = first - 1; f <= hi; f++) fretLines.push(f);

  const fretNums: number[] = [];
  for (let f = lo; f <= hi; f++) fretNums.push(f);

  let blockRect: React.ReactNode = null;
  if (block) {
    const bl = Math.max(lo, block.lo);
    const bh = Math.min(hi, block.hi);
    if (bl <= bh) {
      blockRect = renderRect(lineX(bl - 1) - 2, lineX(bh) + 2, T - 17, GAP * (n - 1) + 34, 'blk');
    }
  }

  return (
    <svg className="fb sb" viewBox={`0 0 ${VW} ${H}`} role="img" aria-label={label}>
      {renderRect(xL, VW - R, T - 8, GAP * (n - 1) + 16, 'wood')}
      {INLAY_FRETS.filter((f) => f >= first && f <= hi).map((f) => (
        <circle key={`inlay-${f}`} className="inlay" cx={xOf(f)} cy={mid} r={5} />
      ))}
      {12 >= first && 12 <= hi && (
        <>
          <circle className="inlay" cx={xOf(12)} cy={mid - GAP} r={5} />
          <circle className="inlay" cx={xOf(12)} cy={mid + GAP} r={5} />
        </>
      )}
      {fretLines.map((f) => {
        const x = fx(xL + (f - first + 1) * W);
        return (
          <line
            key={`fline-${f}`}
            className={f === 0 ? 'nut' : 'fret'}
            x1={x}
            x2={x}
            y1={T - 8}
            y2={T + GAP * (n - 1) + 8}
          />
        );
      })}
      {open.map((oPitch, s) => {
        const noteName = CT.NAMES[CT.pc(oPitch)].replace(/b$/, '♭');
        const strLabel = `${n - s}·${noteName}`;
        return (
          <React.Fragment key={`sline-${s}`}>
            <line
              className="str"
              strokeWidth={(2.4 - (s * 1.5) / Math.max(1, n - 1)).toFixed(2)}
              x1={fx(showOpen ? L : xL)}
              x2={fx(VW - R)}
              y1={yOf(s)}
              y2={yOf(s)}
            />
            <text className="slab" x={fx(18)} y={yOf(s)}>
              {strLabel}
            </text>
          </React.Fragment>
        );
      })}
      {blockRect}
      {fretNums.map((f) => (
        <text
          key={`fnum-${f}`}
          className={`flab${MARK_FRETS.includes(f) ? ' mark' : ''}`}
          x={xOf(f)}
          y={T + GAP * (n - 1) + 28}
        >
          {f}
        </text>
      ))}
      {notes
        .filter((m) => m.f >= lo && m.f <= hi)
        .map((m, idx) => {
          const x = xOf(m.f);
          const y = yOf(m.s);
          const text = m.text != null ? m.text : m.deg || '';
          const pitch = m.pitch != null ? m.pitch : open[m.s] + m.f;
          const isLowest = Boolean(m.lowestRoot || m.isLowestRoot);
          const r = m.ctx ? 10 : m.press ? 13 : 12;
          return (
            <g
              key={`nd-${m.s}-${m.f}-${m.ctx ? 'c' : 'p'}-${idx}`}
              className={dotClassOf(m)}
              data-p={pitch}
              onClick={() => onNoteClick && onNoteClick(pitch, m)}
            >
              <circle cx={x} cy={y} r={r} />
              {isLowest && <circle className="lr-ring" cx={x} cy={y} r={16} />}
              <text x={x} y={y}>
                {text}
              </text>
            </g>
          );
        })}
    </svg>
  );
}

/** 3. 코드 보이싱 + 배경 코드톤 통합 지판 래퍼 */
export interface ChordNeckSvgProps {
  press: ReadonlyArray<DiagramNote>;
  ctx: ReadonlyArray<DiagramNote>;
  hi?: number;
  block?: { lo: number; hi: number } | null;
  label?: string;
  open?: number[];
  isBass?: boolean;
  onNoteClick?: (pitch: number, note: DiagramNote) => void;
}

export function ChordNeckSvg({
  press,
  ctx,
  hi,
  block,
  label,
  open = CT.OPEN,
  isBass = false,
  onNoteClick,
}: ChordNeckSvgProps): React.ReactElement {
  const keyOf = (m: { s: number; f: number }) => `${m.s}:${m.f}`;
  const ps = new Set(press.map(keyOf));
  const fr = press.filter((m) => m.f > 0).map((m) => m.f);
  const minF = fr.length ? Math.min(...fr) : 1;
  const maxF = fr.length ? Math.max(...fr) : 1;
  const hiNeed = Math.max(maxF, block ? block.hi : 0);
  const computedHi = hi != null ? hi : Math.max(15, Math.min(22, hiNeed + 2));
  const computedBlock =
    block !== undefined
      ? block
      : press.length
        ? { lo: press.some((m) => m.f === 0) ? 0 : minF, hi: Math.max(maxF, minF + 3) }
        : null;

  const mergedNotes: DiagramNote[] = [
    ...ctx.filter((m) => !ps.has(keyOf(m))),
    ...press.map((m) => ({ ...m, press: true })),
  ];

  return (
    <NeckSvg
      open={open}
      isBass={isBass}
      lo={0}
      hi={computedHi}
      block={computedBlock}
      label={label}
      notes={mergedNotes}
      onNoteClick={onNoteClick}
    />
  );
}

/** 4. 세로 코드 다이어그램 박스 (<svg className="cb" />) */
export interface ChordBoxSvgProps {
  notes: ReadonlyArray<DiagramNote>;
  label?: string;
}

export function ChordBoxSvg({ notes, label = '코드 폼' }: ChordBoxSvgProps): React.ReactElement {
  const fr = notes.filter((n) => n.f > 0).map((n) => n.f);
  const min = fr.length ? Math.min(...fr) : 1;
  const max = fr.length ? Math.max(...fr) : 1;
  const start = min <= 3 && max <= 5 ? 1 : min;
  const rows = Math.max(4, max - start + 1);
  const L = 26;
  const T = 18;
  const GX = 14;
  const GY = 19;
  const W = L + GX * 5 + 14;
  const H = T + rows * GY + 6;

  const rowArr: number[] = [];
  for (let r = 0; r <= rows; r++) rowArr.push(r);

  return (
    <svg className="cb" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {rowArr.map((r) => {
        const y = T + r * GY;
        return (
          <line
            key={`r-${r}`}
            className={r === 0 && start === 1 ? 'nut' : 'fl'}
            x1={L}
            x2={L + GX * 5}
            y1={y}
            y2={y}
          />
        );
      })}
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const x = L + i * GX;
        const n = notes.find((m) => m.s === i);
        return (
          <React.Fragment key={`s-${i}`}>
            <line className="st" x1={x} x2={x} y1={T} y2={T + rows * GY} />
            {!n ? (
              <text className="mut" x={x} y={9}>
                ×
              </text>
            ) : n.f === 0 ? (
              <circle className="open" cx={x} cy={9} r={4} />
            ) : null}
          </React.Fragment>
        );
      })}
      {start > 1 && (
        <text className="fr" x={L - 7} y={T + GY / 2}>
          {start}fr
        </text>
      )}
      {notes
        .filter((n) => n.f > 0)
        .map((n, idx) => {
          const x = L + n.s * GX;
          const y = T + (n.f - start) * GY + GY / 2;
          return (
            <g key={`cbn-${n.s}-${n.f}-${idx}`} className={dotClassOf(n)}>
              <circle cx={x} cy={y} r={7.4} />
              <text x={x} y={y}>
                {n.deg || ''}
              </text>
            </g>
          );
        })}
    </svg>
  );
}

/** 5. 탑노트 5도권 바퀴 (<svg className="wheel" />) */
export interface CircleWheelSvgProps {
  steps: ReadonlyArray<{ i: number; root: number; topPc: number; deg: string; q: string | null }>;
  idx: number;
  onSelectStep?: (i: number) => void;
}

export function CircleWheelSvg({ steps, idx, onSelectStep }: CircleWheelSvgProps): React.ReactElement {
  const R = 74;
  const C = 92;
  const cur = steps[idx] || steps[0];
  return (
    <svg className="wheel" viewBox="0 0 184 184" width={184} height={184} role="img" aria-label="5도권 진행">
      <circle className="ring" cx={C} cy={C} r={R} />
      {steps.map((s, i) => {
        const a = -Math.PI / 2 + (i / 12) * Math.PI * 2;
        const x = Number((C + R * Math.cos(a)).toFixed(1));
        const y = Number((C + R * Math.sin(a)).toFixed(1));
        const cls = i === idx ? 'cur' : i === (idx + 1) % 12 ? 'nxt' : !s.q ? 'bad' : '';
        return (
          <g
            key={`cw-${i}`}
            className={`wn ${cls}`}
            data-i={i}
            onClick={() => onSelectStep && onSelectStep(i)}
          >
            <circle cx={x} cy={y} r={13} />
            <text x={x} y={y}>
              {CT.NAMES[s.root]}
            </text>
          </g>
        );
      })}
      {cur && (
        <>
          <text className="wc" x={C} y={C - 6}>
            탑 {CT.NAMES[cur.topPc]}
          </text>
          <text className="wc2" x={C} y={C + 12}>
            {cur.deg}
          </text>
        </>
      )}
    </svg>
  );
}

/** 6. 스케일 5도권 순환 바퀴 (<svg className="wheel" />) */
export interface ScaleWheelSvgProps {
  keys: ReadonlyArray<{ root: number; rootName: string }>;
  idx: number;
  dir: number;
  onSelectKey?: (i: number) => void;
}

export function ScaleWheelSvg({ keys, idx, dir, onSelectKey }: ScaleWheelSvgProps): React.ReactElement {
  const R = 74;
  const C = 92;
  const cur = keys[idx] || keys[0];
  return (
    <svg className="wheel" viewBox="0 0 184 184" width={184} height={184} role="img" aria-label="5도권 순환">
      <circle className="ring" cx={C} cy={C} r={R} />
      {keys.map((k, i) => {
        const a = -Math.PI / 2 + (i / 12) * Math.PI * 2 * dir;
        const x = Number((C + R * Math.cos(a)).toFixed(1));
        const y = Number((C + R * Math.sin(a)).toFixed(1));
        const cls = i === idx ? 'cur' : i === (idx + 1) % 12 ? 'nxt' : '';
        return (
          <g
            key={`sw-${i}`}
            className={`wn ${cls}`}
            data-i={i}
            onClick={() => onSelectKey && onSelectKey(i)}
          >
            <circle cx={x} cy={y} r={14} />
            <text x={x} y={y}>
              {k.rootName}
            </text>
          </g>
        );
      })}
      {cur && (
        <>
          <text className="wc" x={C} y={C - 6}>
            {idx + 1} / 12
          </text>
          <text className="wc2" x={C} y={C + 12}>
            {cur.rootName}
          </text>
        </>
      )}
    </svg>
  );
}

