// frontend/src/pages/ChordsPage.tsx
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AppShell } from '../components/layout/AppShell';
import {
  audioEngine,
  BoardNote,
  CT,
  DoubleStopIntervalId,
  GE,
  TuningId,
} from '../lib/musicEngine';
import {
  BlockSeqMilestoneSummary,
  buildCtxNotes,
  ChordBoxSvg,
  ChordNeckSvg,
  CircleWheelSvg,
  DiagramNote,
  dotClassOf,
  formatBlockSeqSummary,
  FretboardSvg,
  fretText,
  geNotesToDiagram,
  geTones,
  getDoubleStopPairs,
  getSafeDoubleStopPair,
  NeckSvg,
  pitchesOf,
  q4Tones,
  ScaleWheelSvg,
} from '../components/chords/ChordDiagrams';
import { ProgressionPlayTab } from '../components/chords/ProgressionPlayTab';
import { isProgHash } from '../components/progressions/model.mts';
import styles from './ChordsPage.module.css';

export type ChordTabId = 'scale' | 'tone' | 'matrix' | 'circle' | 'reint' | 'tf' | 'ds' | 'prog';

export const CHORD_TABS: ReadonlyArray<{ id: ChordTabId; label: string }> = [
  { id: 'scale', label: '1 · 스케일 연습' },
  { id: 'tone', label: '2 · 코드톤 지도' },
  { id: 'matrix', label: '3 · 보이싱 매트릭스' },
  { id: 'circle', label: '4 · 탑노트 5도권' },
  { id: 'reint', label: '5 · 코드 재해석' },
  { id: 'tf', label: '6 · 2-5-1 탐색' },
  { id: 'ds', label: '7 · 더블 스탑 연습' },
  { id: 'prog', label: '8 · 진행 연주' },
];

// "#matrix" → 'matrix', "#prog?c=…" → 'prog' (CH-5b), 그 밖은 null
function tabFromHash(hash: string): ChordTabId | null {
  if (isProgHash(hash)) return 'prog';
  const h = hash.replace(/^#/, '');
  return CHORD_TABS.some((t) => t.id === h) ? (h as ChordTabId) : null;
}

export const CAGED_BLOCK_CHIPS: ReadonlyArray<{ v: number; label: string }> = [
  { v: 1, label: '#1 (A) Shape' },
  { v: 2, label: '#2 (G) Shape' },
  { v: 3, label: '#3 (E) Shape' },
  { v: 4, label: '#4 (D) Shape' },
  { v: 5, label: '#5 (C) Shape' },
  { v: 0, label: '전체 지판' },
];

export const DOUBLE_STOP_SCALES: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'major', name: 'Major (Ionian)' },
  { id: 'minor', name: 'Natural Minor (Aeolian)' },
  { id: 'dorian', name: 'Dorian' },
  { id: 'mixolydian', name: 'Mixolydian' },
  { id: 'pentMaj', name: 'Pentatonic Major' },
  { id: 'pentMin', name: 'Pentatonic Minor' },
];

export function isCagedUnsupportedScale(scaleId: string): boolean {
  return scaleId === 'harmMinor' || scaleId === 'melMinor';
}

const START_PAT = [
  { v: 0, label: 'A · 1도 시작' },
  { v: 1, label: 'B · 3도 시작' },
  { v: 2, label: 'C · 5도 시작' },
  { v: 3, label: 'D · 7도 시작' },
];

const RULE: Record<string, string> = {
  maj7: '기준 폼',
  '7': '7도를 반음 내림',
  m7: '3도도 반음 내림',
  m7b5: '5도도 반음 내림',
  dim7: '7도를 한 번 더 내림 (bb7)',
};

const PRESETS = [
  { id: 'p1', label: '모양 1', frets: [-1, -1, 4, 2, 2, 4] },
  { id: 'p2', label: '모양 2 (4도 쌓기)', frets: [-1, -1, 7, 7, 8, 8] },
  { id: 'p3', label: '모양 3', frets: [-1, -1, 5, 6, 6, 6] },
  { id: 'p4', label: '모양 4', frets: [-1, -1, 7, 8, 9, 9] },
  { id: 'p5', label: '모양 5 (m6 폼)', frets: [-1, -1, 2, 3, 3, 3] },
];

const ROMAN: Record<'major' | 'minor', string[]> = {
  major: ['ii', 'V', 'I'],
  minor: ['iiø', 'V', 'i'],
};

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function ChordsPage(): React.ReactElement {
  useEffect(() => {
    document.title = '기타 코드 연습실';
  }, []);

  // 초기 탭 결정
  const [activeTab, setActiveTab] = useState<ChordTabId>(() => {
    if (typeof window !== 'undefined') {
      const fromHash = tabFromHash(window.location.hash);
      if (fromHash) return fromHash;
      try {
        const s = localStorage.getItem('ulp:tab');
        if (s && CHORD_TABS.some((t) => t.id === s)) return s as ChordTabId;
      } catch {
        /* ignore */
      }
    }
    return 'scale';
  });

  // 진행 연주 탭이 받은 해시("#prog?c=…") — 다른 탭에 갔다 돌아와도 같은 진행을 연다
  const [progHash, setProgHash] = useState<string>(() =>
    typeof window !== 'undefined' && isProgHash(window.location.hash) ? window.location.hash : ''
  );

  // 전역 타이머 관리 레프
  const timersRef = useRef<number[]>([]);
  const intervalsRef = useRef<number[]>([]);

  function stopAllTransports() {
    intervalsRef.current.forEach((id) => window.clearInterval(id));
    intervalsRef.current = [];
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
    setScPlaying(false);
    setTonePlaying(false);
    setMxPlaying(false);
    setCcPlaying(false);
    setRiPlaying(false);
    setTfPlaying(false);
    setDsPlaying(false);
  }

  function handleTabChange(tabId: ChordTabId) {
    stopAllTransports();
    setActiveTab(tabId);
    try {
      localStorage.setItem('ulp:tab', tabId);
    } catch {
      /* ignore */
    }
    if (typeof window !== 'undefined') {
      window.location.hash = tabId === 'prog' && progHash ? progHash : `#${tabId}`;
    }
  }

  useEffect(() => {
    function handleHashChange() {
      const h = tabFromHash(window.location.hash);
      if (h === 'prog') setProgHash(window.location.hash === '#prog' ? '' : window.location.hash);
      if (h && h !== activeTab) {
        stopAllTransports();
        setActiveTab(h);
        try {
          localStorage.setItem('ulp:tab', h);
        } catch {
          /* ignore */
        }
      }
    }
    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      stopAllTransports();
    };
  }, [activeTab]);

  // ================= 1. 스케일 연습 상태 =================
  const [scMode, setScMode] = useState<'simple' | 'circle'>('simple');
  const [scRoot, setScRoot] = useState<number>(0);
  const [scType, setScType] = useState<string>('pentMaj');
  const [scInst, setScInst] = useState<TuningId>('g6');
  const [scBlock, setScBlock] = useState<number>(1);
  const [scLabel, setScLabel] = useState<'deg' | 'name' | 'none'>('deg');
  const [scHand, setScHand] = useState<'right' | 'left'>('right');
  const [scDir, setScDir] = useState<1 | -1>(1);
  const [scBars, setScBars] = useState<number>(0);
  const [scRange, setScRange] = useState<'oct' | 'pos'>('oct');
  const [scBpm, setScBpm] = useState<number>(90);
  const [scRootOnly, setScRootOnly] = useState<boolean>(false);
  const [scCi, setScCi] = useState<number>(0);
  const [scZoom, setScZoom] = useState<number>(10);
  const [scPos, setScPos] = useState<number>(0);
  const [scNow, setScNow] = useState<{ s: number; f: number } | null>(null);
  const [scPlaying, setScPlaying] = useState<boolean>(false);

  const scTuning = CT.TUNING_BY[scInst] || CT.TUNING_BY.g6;
  const scIsCagedUnsupported = isCagedUnsupportedScale(scType);
  const scEffBlock = scIsCagedUnsupported ? 0 : scBlock;
  const scCircleList = useMemo(() => CT.scaleCircle(scRoot, scType, scDir), [scRoot, scType, scDir]);
  const scCurrentKey = scMode === 'circle' ? scCircleList[scCi] : CT.scaleInfo(scRoot, scType);

  // 블럭 자동 맞춤
  const scActiveBlockObj = useMemo(() => {
    if (scEffBlock <= 0) return null;
    const blocks = CT.scaleBlocks(scCurrentKey.root, scType, scTuning.open, scTuning.frets);
    return blocks.find((b) => b.blockId === scEffBlock) || blocks[0] || null;
  }, [scEffBlock, scCurrentKey.root, scType, scTuning.open, scTuning.frets]);

  useEffect(() => {
    if (scActiveBlockObj) {
      const maxF = scTuning.frets;
      const count = maxF + 1 - scZoom;
      const targetLo = Math.max(0, scActiveBlockObj.lo - 1);
      const targetHi = Math.min(maxF, scActiveBlockObj.hi + 1);
      if (targetLo < scPos || targetHi > scPos + count - 1) {
        setScPos(Math.max(0, Math.min(maxF + 1 - count, targetLo)));
      }
    }
  }, [scActiveBlockObj, scTuning.frets, scZoom]);

  const scWindowCount = scTuning.frets + 1 - scZoom;
  const scWinLo = Math.max(0, Math.min(scPos, scTuning.frets + 1 - scWindowCount));
  const scWinHi = scWinLo + scWindowCount - 1;

  const scSeqNotes = useMemo<BoardNote[]>(() => {
    if (scActiveBlockObj) {
      return CT.scaleBlockSeq(scActiveBlockObj.notes);
    }
    const all = CT.scaleOnBoard(scCurrentKey.root, scType, scTuning.open, scWinLo, scWinHi);
    if (!all.length) return [];
    let pitches = [...new Set(all.map((n) => n.pitch))].sort((a, b) => a - b);
    if (scRange === 'oct') {
      const r = pitches.find((p) => CT.pc(p) === scCurrentKey.root);
      if (r != null && pitches.includes(r + 12)) {
        pitches = pitches.filter((p) => p >= r && p <= r + 12);
      }
    }
    let prev: BoardNote | null = null;
    const up = pitches.map((p) => {
      const cands = all.filter((n) => n.pitch === p);
      const pick = prev
        ? cands.reduce((a, b) =>
            Math.abs(b.f - prev!.f) + 0.6 * Math.abs(b.s - prev!.s) <
            Math.abs(a.f - prev!.f) + 0.6 * Math.abs(a.s - prev!.s)
              ? b
              : a
          )
        : cands.reduce((a, b) => (b.s < a.s ? b : a));
      prev = pick;
      return pick;
    });
    return up.concat(up.slice(1, -1).reverse());
  }, [scActiveBlockObj, scCurrentKey.root, scType, scTuning.open, scWinLo, scWinHi, scRange]);

  const scMilestoneSummary = useMemo<BlockSeqMilestoneSummary>(() => {
    if (!scActiveBlockObj) {
      return {
        totalSteps: 0,
        startLabel: '-',
        highPeakLabel: '-',
        lowPeakLabel: '-',
        endLabel: '-',
        summaryText: '',
      };
    }
    return formatBlockSeqSummary(scActiveBlockObj.notes, scSeqNotes, scTuning.open.length);
  }, [scActiveBlockObj, scSeqNotes, scTuning.open.length]);

  const scBoardNotes = useMemo<DiagramNote[]>(() => {
    const raw = CT.scaleOnBoard(scCurrentKey.root, scType, scTuning.open, scWinLo, scWinHi);
    const blkKeySet = scActiveBlockObj
      ? new Set(scActiveBlockObj.notes.map((n) => `${n.s}:${n.f}`))
      : null;
    const lrKey = scActiveBlockObj
      ? scActiveBlockObj.notes.find((n) => n.isLowestRoot)
      : null;
    const lrKeyStr = lrKey ? `${lrKey.s}:${lrKey.f}` : '';

    return raw
      .map((n) => {
        const isNow = !!scNow && scNow.s === n.s && scNow.f === n.f;
        const keyStr = `${n.s}:${n.f}`;
        const isPress = blkKeySet ? blkKeySet.has(keyStr) : true;
        const isLowest = scActiveBlockObj ? keyStr === lrKeyStr : false;
        return {
          s: n.s,
          f: n.f,
          pitch: n.pitch,
          deg: n.deg,
          name: n.name,
          cls: n.isRoot ? 'root' : 'guide',
          now: isNow,
          ctx: blkKeySet ? !isPress : false,
          press: blkKeySet ? isPress : false,
          lowestRoot: isLowest,
          isLowestRoot: isLowest,
          moved: scMode === 'circle' && scCurrentKey.added?.includes(n.name),
          text: scLabel === 'name' ? n.name : scLabel === 'deg' ? n.deg : '',
        };
      })
      .filter((n) => !scRootOnly || n.cls === 'root' || n.now);
  }, [
    scCurrentKey,
    scType,
    scTuning.open,
    scWinLo,
    scWinHi,
    scActiveBlockObj,
    scNow,
    scMode,
    scLabel,
    scRootOnly,
  ]);

  function scPlayNote(midi: number, t?: number, dur = 0.55) {
    if (scTuning.kind === 'bass') {
      audioEngine.bassPluck(midi, t, dur);
    } else {
      audioEngine.pluck(midi, t, dur);
    }
  }

  function toggleScPlay() {
    if (scPlaying) {
      stopAllTransports();
      setScNow(null);
      return;
    }
    audioEngine.resume();
    setScPlaying(true);
    let stepIdx = 0;
    let localCi = scCi;
    let seq = scSeqNotes;
    const intervalMs = (60 / scBpm) * 500; // 8분음표 단위

    const timerId = window.setInterval(() => {
      if (seq.length === 0) return;
      const note = seq[stepIdx % seq.length];
      const nowTime = audioEngine.now();
      scPlayNote(note.pitch, nowTime, 0.5);
      if (stepIdx % 2 === 0) {
        audioEngine.click(nowTime, stepIdx % 8 === 0);
      }
      setScNow({ s: note.s, f: note.f });

      stepIdx++;
      if (scMode === 'circle' && scBars > 0 && stepIdx >= scBars * 8) {
        stepIdx = 0;
        localCi = (localCi + 1) % 12;
        setScCi(localCi);
        audioEngine.bass(36 + scCircleList[localCi].root, audioEngine.now(), 1.0);
      } else if (stepIdx >= seq.length && scMode === 'circle' && scBars === 0) {
        stepIdx = 0;
        localCi = (localCi + 1) % 12;
        setScCi(localCi);
        audioEngine.bass(36 + scCircleList[localCi].root, audioEngine.now(), 1.0);
      }
    }, intervalMs);

    intervalsRef.current.push(timerId);
  }

  // ================= 2. 코드톤 지도 상태 =================
  const [toneRoot, setToneRoot] = useState<number>(0);
  const [toneStart, setToneStart] = useState<number>(0);
  const [toneNear, setToneNear] = useState<number>(3);
  const [toneQ, setToneQ] = useState<string>('maj7');
  const [toneDir, setToneDir] = useState<'up' | 'down' | 'round'>('up');
  const [toneAuto, setToneAuto] = useState<boolean>(false);
  const [toneBpm, setToneBpm] = useState<number>(80);
  const [toneIdx, setToneIdx] = useState<number>(-1);
  const [tonePlaying, setTonePlaying] = useState<boolean>(false);

  const toneNotes = useMemo(() => {
    const base = CT.arpeggio2nps(toneRoot, toneStart, toneNear);
    return CT.arpeggioAs(base, toneQ);
  }, [toneRoot, toneStart, toneNear, toneQ]);

  const toneOrderList = useMemo(() => {
    const up = [...Array(toneNotes.length).keys()];
    if (toneDir === 'up') return up;
    if (toneDir === 'down') return [...up].reverse();
    return up.concat([...up].slice(1, -1).reverse());
  }, [toneNotes.length, toneDir]);

  const toneBoardNotes = useMemo<DiagramNote[]>(() => {
    const cur = toneIdx >= 0 ? toneOrderList[toneIdx % toneOrderList.length] : -1;
    return toneNotes.map((n: any, i: number) => ({
      ...n,
      now: i === cur,
    }));
  }, [toneNotes, toneIdx, toneOrderList]);

  function toggleTonePlay() {
    if (tonePlaying) {
      stopAllTransports();
      setToneIdx(-1);
      return;
    }
    audioEngine.resume();
    setTonePlaying(true);
    let step = 0;
    const intervalMs = (60 / toneBpm) * 500;

    const timerId = window.setInterval(() => {
      if (!toneOrderList.length) return;
      const k = step % toneOrderList.length;
      const noteIdx = toneOrderList[k];
      const n = toneNotes[noteIdx];
      const nowTime = audioEngine.now();
      audioEngine.pluck(n.pitch, nowTime, 0.5);
      if (step % 2 === 0) {
        audioEngine.click(nowTime, k === 0);
      }
      setToneIdx(k);
      step++;
      if (k === toneOrderList.length - 1 && toneAuto) {
        const qi = CT.ARP_Q.indexOf(toneQ);
        setToneQ(CT.ARP_Q[(qi + 1) % CT.ARP_Q.length]);
      }
    }, intervalMs);

    intervalsRef.current.push(timerId);
  }

  // ================= 3. 보이싱 매트릭스 상태 =================
  const [mxRoot, setMxRoot] = useState<number>(0);
  const [mxDrop, setMxDrop] = useState<string>('d2');
  const [mxInv, setMxInv] = useState<number>(0);
  const [mxSetKey, setMxSetKey] = useState<string | null>(null);
  const [mxQ, setMxQ] = useState<string>('maj7');
  const [mxSpan, setMxSpan] = useState<number>(4);
  const [mxPlace, setMxPlace] = useState<number>(0);
  const [mxBeats, setMxBeats] = useState<number>(4);
  const [mxBpm, setMxBpm] = useState<number>(70);
  const [mxCur, setMxCur] = useState<number>(-1);
  const [mxPlaying, setMxPlaying] = useState<boolean>(false);

  const mxDropStructure = useMemo(
    () => CT.dropStructure(mxDrop)[mxInv] || [],
    [mxDrop, mxInv]
  );
  const mxPlayableSets = useMemo(
    () => CT.playableSets(mxDrop, mxInv, mxRoot, mxSpan),
    [mxDrop, mxInv, mxRoot, mxSpan]
  );

  // setKey 동기화
  const activeMxSetObj = useMemo(() => {
    if (!mxPlayableSets.length) return null;
    const found = mxPlayableSets.find((s: any) => s.set.join(',') === mxSetKey);
    return found || mxPlayableSets[0];
  }, [mxPlayableSets, mxSetKey]);

  useEffect(() => {
    if (activeMxSetObj && activeMxSetObj.set.join(',') !== mxSetKey) {
      setMxSetKey(activeMxSetObj.set.join(','));
      setMxPlace(0);
    }
  }, [activeMxSetObj, mxSetKey]);

  const mxPlacements = activeMxSetObj ? activeMxSetObj.placements : [];
  const safeMxPlace = Math.min(mxPlace, Math.max(0, mxPlacements.length - 1));
  const mxR0 = mxPlacements.length ? mxPlacements[safeMxPlace].R0 : 0;

  const mxCounts = useMemo(
    () => CT.countPlayable(mxRoot, mxSpan),
    [mxRoot, mxSpan]
  );

  function toggleMxPlay() {
    if (mxPlaying) {
      stopAllTransports();
      setMxCur(-1);
      return;
    }
    if (!activeMxSetObj) return;
    audioEngine.resume();
    setMxPlaying(true);
    let beat = 0;
    const intervalMs = (60 / mxBpm) * 1000;

    const timerId = window.setInterval(() => {
      const qIdx = Math.floor(beat / mxBeats) % CT.Q4.length;
      const k = beat % mxBeats;
      const nowTime = audioEngine.now();
      audioEngine.click(nowTime, k === 0);
      if (k === 0) {
        const qId = CT.Q4[qIdx].id;
        const a = CT.atR0(mxDropStructure, activeMxSetObj.set, mxR0, qId);
        if (a.valid) {
          audioEngine.chord(pitchesOf(a.notes), nowTime, (60 / mxBpm) * mxBeats * 0.9);
        }
        setMxCur(qIdx);
        setMxQ(qId);
      }
      beat++;
    }, intervalMs);

    intervalsRef.current.push(timerId);
  }

  // ================= 4. 탑노트 5도권 상태 =================
  const [ccRoot, setCcRoot] = useState<number>(5);
  const [ccIv, setCcIv] = useState<number>(2);
  const [ccStr, setCcStr] = useState<number>(5);
  const [ccNear, setCcNear] = useState<number>(8);
  const [ccIdx, setCcIdx] = useState<number>(0);
  const [ccHsel, setCcHsel] = useState<number>(0);
  const [ccHint, setCcHint] = useState<boolean>(true);
  const [ccTopSnd, setCcTopSnd] = useState<boolean>(true);
  const [ccSkip, setCcSkip] = useState<boolean>(true);
  const [ccBeats, setCcBeats] = useState<number>(4);
  const [ccBpm, setCcBpm] = useState<number>(60);
  const [ccAllOpen, setCcAllOpen] = useState<boolean>(false);
  const [ccPlaying, setCcPlaying] = useState<boolean>(false);

  const ccStepsList = useMemo(() => CT.circleSteps(ccRoot, ccIv), [ccRoot, ccIv]);
  const ccTopFret = useMemo(
    () => CT.topFret(ccStr, ccStepsList[0]?.topPc ?? 0, ccNear),
    [ccStr, ccStepsList, ccNear]
  );
  const ccCurrentStep = ccStepsList[ccIdx % 12];
  const ccNextStep = ccStepsList[(ccIdx + 1) % 12];

  const ccHintsList = useMemo(() => {
    if (!ccCurrentStep || !ccCurrentStep.q) return [];
    const vs = GE.genVoicings(ccCurrentStep.root, ccCurrentStep.q, {
      lo: Math.max(1, ccTopFret - 4),
      hi: ccTopFret + 3,
      maxSpan: 4,
      minNotes: 3,
      maxNotes: 4,
      needGuide: 2,
      top: { s: ccStr, f: ccTopFret },
    });
    vs.sort((a: any, b: any) => b.score - a.score);
    const picked: any[] = [];
    const seen = new Set<string>();
    for (const v of vs) {
      const kind =
        v.notes.length === 3
          ? '3음'
          : v.notes.some((n: any) => n.cls === 'root')
          ? '근음 포함'
          : '근음 생략';
      const key = kind + v.notes[0].s;
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push({ v, kind });
      if (picked.length >= 3) break;
    }
    return picked;
  }, [ccCurrentStep, ccTopFret, ccStr]);

  function ccStepSound(stepIdx: number) {
    const st = ccStepsList[stepIdx % 12];
    const nowTime = audioEngine.now() + 0.02;
    audioEngine.bass(36 + CT.pc(st.root) + (CT.pc(st.root) < 4 ? 12 : 0), nowTime, 1.2);
    if (ccTopSnd) {
      audioEngine.pluck(CT.OPEN[ccStr] + ccTopFret, nowTime + 0.01, 1.2);
    }
  }

  function ccMove(delta: number) {
    let nextIdx = (ccIdx + delta + 12) % 12;
    if (ccSkip && ccPlaying && !ccStepsList[nextIdx].q) {
      nextIdx = (nextIdx + delta + 12) % 12;
    }
    setCcIdx(nextIdx);
    setCcHsel(0);
    ccStepSound(nextIdx);
  }

  function toggleCcPlay() {
    if (ccPlaying) {
      stopAllTransports();
      return;
    }
    audioEngine.resume();
    setCcPlaying(true);
    let beat = 0;
    let localIdx = ccIdx;
    const intervalMs = (60 / ccBpm) * 1000;

    const timerId = window.setInterval(() => {
      const k = beat % ccBeats;
      const nowTime = audioEngine.now();
      audioEngine.click(nowTime, k === 0);
      if (k === 0) {
        if (beat > 0) {
          localIdx = (localIdx + 1) % 12;
          if (ccSkip && !ccStepsList[localIdx].q) {
            localIdx = (localIdx + 1) % 12;
          }
          setCcIdx(localIdx);
        }
        const st = ccStepsList[localIdx];
        const dur = (60 / ccBpm) * ccBeats * 0.95;
        audioEngine.bass(36 + CT.pc(st.root) + (CT.pc(st.root) < 4 ? 12 : 0), nowTime, dur);
        if (ccTopSnd) {
          audioEngine.pluck(CT.OPEN[ccStr] + ccTopFret, nowTime + 0.01, dur);
        }
      }
      beat++;
    }, intervalMs);

    intervalsRef.current.push(timerId);
  }

  // ================= 5. 코드 재해석 상태 =================
  const [riFrets, setRiFrets] = useState<number[]>([-1, -1, 4, 2, 2, 4]);
  const [riPreset, setRiPreset] = useState<string>('p1');
  const [riPick, setRiPick] = useState<number | null>(0);
  const [riKey, setRiKey] = useState<number>(0);
  const [riBpm, setRiBpm] = useState<number>(90);
  const [riPlaying, setRiPlaying] = useState<boolean>(false);

  // 퀴즈 상태
  const [quizScore, setQuizScore] = useState<{ score: number; n: number }>({ score: 0, n: 0 });
  const [quizQuestion, setQuizQuestion] = useState<{
    notes: Array<{ s: number; f: number; pitch: number }>;
    text: string;
    opts: Array<{ label: string; ok: boolean }>;
    explain: string;
  } | null>(null);
  const [quizDone, setQuizDone] = useState<boolean>(false);
  const [quizFeedback, setQuizFeedback] = useState<{ text: string; good: boolean } | null>(null);

  const riNotes = useMemo(
    () =>
      riFrets
        .map((f, s) => (f < 0 ? null : { s, f, pitch: CT.OPEN[s] + f }))
        .filter(Boolean) as Array<{ s: number; f: number; pitch: number }>,
    [riFrets]
  );

  const riInterpretList = useMemo(() => CT.interpret(riNotes), [riNotes]);
  const riSelectedInterp = riPick != null ? riInterpretList[riPick] : null;

  const riDegNotes = useMemo<DiagramNote[]>(() => {
    return riNotes.map((n, i) => {
      const d = riSelectedInterp ? riSelectedInterp.degs[i] : CT.NAMES[CT.pc(n.pitch)];
      const cls = !riSelectedInterp
        ? ''
        : d === 'R'
        ? 'root'
        : ['3', 'b3', '7', 'b7', 'bb7', '4'].includes(d)
        ? 'guide'
        : '';
      return { s: n.s, f: n.f, deg: d, cls };
    });
  }, [riNotes, riSelectedInterp]);

  const riSwapPlan = useMemo(() => {
    if (riNotes.length < 3) return [];
    const roles = [
      { r: '마이너 ii', root: CT.pc(riKey + 2), fams: ['min'] },
      { r: 'V', root: CT.pc(riKey + 7), fams: ['dom', 'sus'] },
      { r: 'I', root: riKey, fams: ['maj'] },
    ];
    return roles.map((ro) => {
      const it = riInterpretList.find((x: any) => ro.fams.includes(x.fam));
      if (!it) return { ro, none: true };
      const tn = CT.transposeShape(riNotes, it.root, ro.root);
      if (!tn) return { ro, none: true };
      const d = tn[0].f - riNotes[0].f;
      const name = CT.NAMES[ro.root] + it.name.slice(CT.NAMES[it.root].length);
      return { ro, it, notes: tn, name, d };
    });
  }, [riNotes, riKey, riInterpretList]);

  function startNewQuiz() {
    const p = PRESETS[Math.floor(Math.random() * PRESETS.length)];
    const shift = Math.floor(Math.random() * 7) - 3;
    let notes = p.frets
      .map((f, s) => (f < 0 ? null : { s, f, pitch: CT.OPEN[s] + f }))
      .filter(Boolean) as Array<{ s: number; f: number; pitch: number }>;
    if (notes.every((n) => n.f + shift >= 1)) {
      notes = notes.map((n) => ({ s: n.s, f: n.f + shift, pitch: n.pitch + shift }));
    }
    const list = CT.interpret(notes);
    if (!list.length) return;
    const it = list[Math.floor(Math.random() * list.length)];
    let qObj: any;
    if (Math.random() < 0.5) {
      const valid = new Set(list.filter((x: any) => x.fam === it.fam).map((x: any) => x.root));
      const wrong = shuffle([...Array(12).keys()].filter((r) => !valid.has(r))).slice(0, 3);
      qObj = {
        notes,
        text: `이 모양을 ${it.famLabel} 코드로 읽으려면 근음은?`,
        opts: shuffle([it.root, ...wrong]).map((r) => ({
          label: CT.NAMES[r],
          ok: r === it.root,
        })),
        explain: `${it.name} · ${notes
          .map((n, k) => `${6 - n.s}번줄 ${it.degs[k]}`)
          .reverse()
          .join(', ')}`,
      };
    } else {
      const k = Math.floor(Math.random() * notes.length);
      qObj = {
        notes,
        text: `이 모양을 ${it.name}(으)로 볼 때 ${it.degs[k]} 역할을 하는 줄은?`,
        opts: shuffle(
          notes.map((n, j) => ({
            label: `${6 - n.s}번줄`,
            ok: j === k || it.degs[j] === it.degs[k],
          }))
        ),
        explain: notes
          .map((n, j) => `${6 - n.s}번줄 ${it.degs[j]}`)
          .reverse()
          .join(', '),
      };
    }
    setQuizQuestion(qObj);
    setQuizDone(false);
    setQuizFeedback(null);
  }

  useEffect(() => {
    startNewQuiz();
  }, []);

  function toggleRiPlay() {
    if (riPlaying) {
      stopAllTransports();
      return;
    }
    audioEngine.resume();
    setRiPlaying(true);
    let beat = 0;
    const intervalMs = (60 / riBpm) * 1000;

    const timerId = window.setInterval(() => {
      const bar = Math.floor(beat / 4) % 4;
      const k = beat % 4;
      const nowTime = audioEngine.now();
      audioEngine.click(nowTime, k === 0);
      const p = riSwapPlan[Math.min(bar, 2)];
      const spb = 60 / riBpm;
      if (p) {
        if (k === 0) {
          audioEngine.bass(36 + p.ro.root + (p.ro.root < 4 ? 12 : 0), nowTime, spb * 3.8);
        }
        if ((k === 0 || k === 2) && !p.none) {
          audioEngine.chord(pitchesOf(p.notes), nowTime + 0.01, spb * 1.8);
        }
      }
      beat++;
    }, intervalMs);

    intervalsRef.current.push(timerId);
  }

  // ================= 6. 2-5-1 탐색 상태 =================
  const [tfKind, setTfKind] = useState<'major' | 'minor'>('major');
  const [tfLo, setTfLo] = useState<number>(5);
  const [tfHi, setTfHi] = useState<number>(8);
  const [tfProot, setTfProot] = useState<number>(9);
  const [tfPtype, setTfPtype] = useState<'min' | 'maj'>('min');
  const [tfOutsideMax, setTfOutsideMax] = useState<number>(2);
  const [tfNeedGuide, setTfNeedGuide] = useState<number>(2);
  const [tfUsePent, setTfUsePent] = useState<boolean>(true);
  const [tfVariants, setTfVariants] = useState<boolean>(false);
  const [tfStatus, setTfStatus] = useState<string>('');
  const [tfOkList, setTfOkList] = useState<any[]>([]);
  const [tfKey, setTfKey] = useState<number | null>(null);
  const [tfP, setTfP] = useState<number>(0);
  const [tfC, setTfC] = useState<number>(0);
  const [tfPlaying, setTfPlaying] = useState<boolean>(false);

  function runTfSearch() {
    setTfStatus('탐색 중…');
    const timerId = window.setTimeout(() => {
      const lo = tfLo;
      const hi = Math.max(lo, tfHi);
      const res = GE.search251({
        kind: tfKind,
        lo,
        hi,
        variants: tfVariants,
        perKey: 3,
        needGuide: tfNeedGuide,
        outsideMax: tfUsePent ? tfOutsideMax : 99,
        pent: tfUsePent ? { root: tfProot, type: tfPtype } : null,
      });
      const ok = res.filter((k: any) => k.paths.length);
      setTfStatus(`프렛 ${lo}–${hi} 안에서 ${ok.length}/12개 키 성립`);
      setTfOkList(ok);
      if (!ok.some((k: any) => k.key === tfKey)) {
        setTfKey(ok.length ? ok[0].key : null);
        setTfP(0);
        setTfC(0);
      }
    }, 20);
    timersRef.current.push(timerId);
  }

  useEffect(() => {
    runTfSearch();
  }, []);

  const tfCurrentPath = useMemo(() => {
    if (tfKey == null) return null;
    const found = tfOkList.find((k: any) => k.key === tfKey);
    return found ? found.paths[Math.min(tfP, found.paths.length - 1)] : null;
  }, [tfKey, tfOkList, tfP]);

  function playTfSequence() {
    if (!tfCurrentPath) return;
    audioEngine.resume();
    setTfPlaying(true);
    const path = tfCurrentPath;
    const t0 = audioEngine.now() + 0.05;
    path.chords.forEach((c: any, i: number) => {
      audioEngine.bass(36 + CT.pc(c.root) + (CT.pc(c.root) < 4 ? 12 : 0), t0 + i * 1.6, 1.5);
      audioEngine.chord(pitchesOf(c.notes), t0 + i * 1.6 + 0.02, 1.5);
      const tid = window.setTimeout(() => {
        setTfC(i);
        if (i === path.chords.length - 1) setTfPlaying(false);
      }, 50 + i * 1600);
      timersRef.current.push(tid);
    });
  }

  // ================= 7. 더블 스탑 연습 상태 =================
  const [dsRoot, setDsRoot] = useState<number>(0);
  const [dsScale, setDsScale] = useState<string>('major');
  const [dsInst, setDsInst] = useState<TuningId>('g6');
  const [dsInterval, setDsInterval] = useState<DoubleStopIntervalId>('3rd');
  const [dsPair, setDsPair] = useState<[number, number]>([4, 5]);
  const [dsDir, setDsDir] = useState<'up' | 'down' | 'round'>('round');
  const [dsBpm, setDsBpm] = useState<number>(75);
  const [dsSel, setDsSel] = useState<number>(0);
  const [dsPlaying, setDsPlaying] = useState<boolean>(false);

  const dsTuning = CT.TUNING_BY[dsInst] || CT.TUNING_BY.g6;
  const dsPairOptions = useMemo(
    () => getDoubleStopPairs(dsTuning.open.length, dsInterval),
    [dsTuning.open.length, dsInterval]
  );

  // PR #41 리뷰 반영: 렌더 타임에 현재 악기 현 수와 음정에 맞는 유효한 줄 쌍을 동기 계산
  // 이전 악기(6현 [4,5])에서 줄 수가 적은 악기(4현)로 전환될 때 useEffect 대기 중 크래시 방지
  const effectiveDsPair = useMemo(
    () => getSafeDoubleStopPair(dsTuning.open.length, dsInterval, dsPair),
    [dsTuning.open.length, dsInterval, dsPair]
  );

  // 악기 또는 음정 변경 시 상태 동기화 (렌더 타임 정규화 후 비동기 상태 일치)
  useEffect(() => {
    if (dsPair[0] !== effectiveDsPair[0] || dsPair[1] !== effectiveDsPair[1]) {
      setDsPair(effectiveDsPair);
      setDsSel(0);
    }
  }, [effectiveDsPair, dsPair]);

  const dsStepsList = useMemo(() => {
    return CT.doubleStops({
      rootPc: dsRoot,
      scaleId: dsScale,
      interval: dsInterval,
      pair: effectiveDsPair,
      open: dsTuning.open,
      lo: 0,
      hi: dsTuning.frets,
    });
  }, [dsRoot, dsScale, dsInterval, effectiveDsPair, dsTuning.open, dsTuning.frets]);

  const safeDsSel = Math.min(dsSel, Math.max(0, dsStepsList.length - 1));
  const activeDsPair = dsStepsList[safeDsSel];

  const dsBoardNotes = useMemo<DiagramNote[]>(() => {
    const ctxAll = CT.scaleOnBoard(dsRoot, dsScale, dsTuning.open, 0, dsTuning.frets);
    const activeMidis = activeDsPair ? [activeDsPair.notes[0].pitch, activeDsPair.notes[1].pitch] : [];

    return ctxAll.map((n) => {
      const isNow = activeMidis.includes(n.pitch);
      return {
        s: n.s,
        f: n.f,
        pitch: n.pitch,
        deg: n.deg,
        cls: n.isRoot ? 'root' : '',
        ctx: !isNow,
        press: isNow,
        now: isNow,
      };
    });
  }, [dsRoot, dsScale, dsTuning.open, dsTuning.frets, activeDsPair]);

  function playDsStep(stepIdx: number) {
    const pair = dsStepsList[stepIdx];
    if (!pair) return;
    audioEngine.resume();
    audioEngine.doubleStop(
      [pair.notes[0].pitch, pair.notes[1].pitch],
      audioEngine.now() + 0.02,
      1.1,
      dsTuning.kind === 'bass'
    );
    setDsSel(stepIdx);
  }

  function toggleDsPlay() {
    if (dsPlaying) {
      stopAllTransports();
      return;
    }
    if (!dsStepsList.length) return;
    audioEngine.resume();
    setDsPlaying(true);
    let step = 0;
    const intervalMs = (60 / dsBpm) * 1000;

    const ord: number[] = [];
    const up = [...Array(dsStepsList.length).keys()];
    if (dsDir === 'up') ord.push(...up);
    else if (dsDir === 'down') ord.push(...[...up].reverse());
    else ord.push(...up, ...[...up].slice(1, -1).reverse());

    const timerId = window.setInterval(() => {
      const idx = ord[step % ord.length];
      const p = dsStepsList[idx];
      const nowTime = audioEngine.now();
      audioEngine.doubleStop(
        [p.notes[0].pitch, p.notes[1].pitch],
        nowTime,
        1.0,
        dsTuning.kind === 'bass'
      );
      audioEngine.click(nowTime, step % 4 === 0);
      setDsSel(idx);
      step++;
    }, intervalMs);

    intervalsRef.current.push(timerId);
  }

  return (
    <AppShell variant="default" activeNav="learn" showThemeToggle>
      <div className={styles.pane}>
      <header className={styles.pageHeader}>
        <div className={styles.headRow}>
          <h1 className={styles.pageTitle} data-align-group="head: center-y">코드 연습실</h1>
          <a href="/practice.html" className={styles.practiceLink} data-align-group="head: center-y">
            플레이어로 돌아가기 →
          </a>
        </div>
        <p className={styles.subText}>
          스케일 연습(CAGED 5블럭) · 코드톤 지도 · 보이싱 매트릭스 · 탑노트 5도권 · 코드 재해석 · 2-5-1 탐색 · 7 · 더블 스탑 연습 · 진행 연주
        </p>
      </header>

      {/* 상단 탭 내비게이션 */}
      <nav className={styles.tabs} role="tablist" aria-label="연습 모드">
        {CHORD_TABS.map((t) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            role="tab"
            type="button"
            className={styles.tab}
            data-align-group="tabs: top,height"
            aria-selected={activeTab === t.id}
            onClick={() => handleTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* 1. 스케일 연습 패널 */}
      <section id="pane-scale" role="tabpanel" className={styles.pane} hidden={activeTab !== 'scale'}>
        <div className={styles.panel}>
          <div className={styles.scHead}>
            <h2 id="sc-title" className={styles.scTitle}>
              {scCurrentKey.name}
            </h2>
            <div id="sc-notes" className={styles.scNotes}>
              {scCurrentKey.notes.map((n: any) => (
                <span
                  key={n.name}
                  className={`scn ${n.iv === 0 ? 'root' : ''} ${
                    scMode === 'circle' && scCurrentKey.added?.includes(n.name) ? 'moved' : ''
                  }`}
                >
                  <b>{n.name}</b>
                  <small>{n.deg}</small>
                </span>
              ))}
            </div>
          </div>

          {/* 5도권 바퀴 */}
          <div id="sc-circle" className={styles.scCircle} hidden={scMode !== 'circle'}>
            <div id="sc-wheel">
              <ScaleWheelSvg
                keys={scCircleList}
                idx={scCi}
                dir={scDir}
                onSelectKey={(i) => {
                  setScCi(i);
                  audioEngine.bass(36 + scCircleList[i].root, audioEngine.now() + 0.02, 1.2);
                }}
              />
            </div>
            <div className={styles.field}>
              <div id="sc-change" className={styles.note}>
                {scCi === 0 ? (
                  <span>
                    <b>{scCurrentKey.rootName}</b>에서 시작. 바퀴를 돌면 키마다 바뀌는 음을 점선으로 보여줘요.
                  </span>
                ) : (
                  <span>
                    {scCircleList[(scCi + 11) % 12]?.rootName} → <b>{scCurrentKey.rootName}</b> 바뀐 음:{' '}
                    {scCurrentKey.added?.length ? scCurrentKey.added.join(', ') : '없음'}
                  </span>
                )}
              </div>
              <div id="sc-next" className={styles.status}>
                다음: {scCircleList[(scCi + 1) % 12]?.name}
              </div>
              <div className={styles.row}>
                <button
                  id="sc-prev"
                  type="button"
                  className={styles.ghost}
                  onClick={() => setScCi((scCi + 11) % 12)}
                >
                  ◀ 이전 키
                </button>
                <button
                  id="sc-nextb"
                  type="button"
                  className={styles.ghost}
                  onClick={() => setScCi((scCi + 1) % 12)}
                >
                  다음 키 ▶
                </button>
              </div>
            </div>
          </div>

          {/* 지판 및 시퀀스 바 */}
          <div className={styles.scroll}>
            <div id="sc-board">
              <NeckSvg
                open={scTuning.open}
                isBass={scTuning.kind === 'bass'}
                lo={scWinLo}
                hi={scWinHi}
                flip={scHand === 'left'}
                block={scActiveBlockObj ? { lo: scActiveBlockObj.lo, hi: scActiveBlockObj.hi } : null}
                label={`${scCurrentKey.name} 지판`}
                notes={scBoardNotes}
                onNoteClick={(pitch) => scPlayNote(pitch, audioEngine.now() + 0.02)}
              />
            </div>
          </div>

          {/* CAGED 4대 이정표 요약 및 31스텝 시퀀스 바 */}
          <div id="sc-seq" className={styles.seq} aria-label="CAGED 블럭 연주 시퀀스">
            {scActiveBlockObj && (
              <div className={styles.seqSummary}>
                {scMilestoneSummary.summaryText}
              </div>
            )}
            {scSeqNotes.map((n, i) => {
              const isNow = !!scNow && scNow.s === n.s && scNow.f === n.f;
              return (
                <span
                  key={`${n.s}-${n.f}-${i}`}
                  className={`seqn ${n.isRoot ? 'root' : ''} ${isNow ? 'now' : ''}`}
                >
                  {scTuning.open.length - n.s}·{n.f}
                  <b>{n.name}</b>
                </span>
              );
            })}
          </div>

          {/* 범례 */}
          <div className={styles.legend}>
            <span><i className="r" />근음</span>
            <span><i className="g" />스케일 구성음</span>
            <span><i className="ctxk" />블럭 밖 스케일 음</span>
            <span><i className="blkk" />CAGED 블럭 폼</span>
            <span><i className="lowest-k" />블럭 시작·종착 최저 루트</span>
            <span id="sc-leg-moved" hidden={scMode !== 'circle'}><i className="m" />이전 키에서 바뀐 음</span>
            <span><i className="n" />지금 울리는 음</span>
          </div>

          {/* 슬라이더 컨트롤 */}
          <div className={styles.scSliders}>
            <label className={styles.scSl}>
              줌 (프렛 폭)
              <input
                id="sc-zoom"
                type="range"
                min="0"
                max={Math.max(0, scTuning.frets + 1 - 4)}
                value={scZoom}
                onChange={(e) => setScZoom(+e.target.value)}
              />
            </label>
            <label className={styles.scSl}>
              위치 (시작 프렛)
              <input
                id="sc-pos"
                type="range"
                min="0"
                max={Math.max(0, scTuning.frets + 1 - scWindowCount)}
                value={scPos}
                disabled={scTuning.frets + 1 - scWindowCount <= 0}
                onChange={(e) => setScPos(+e.target.value)}
              />
            </label>
          </div>
        </div>

        {/* 프렛보드 및 스케일 설정 패널 */}
        <div className={styles.panel}>
          {/* 악기 선택 필 칩 */}
          <div className={styles.field}>
            <span className={styles.lab}>악기 선택 (기타 / 베이스)</span>
            <div id="sc-inst-chips" className={styles.chips}>
              {CT.TUNINGS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={styles.chip}
                  aria-pressed={scInst === t.id}
                  onClick={() => {
                    setScInst(t.id);
                    setScZoom(Math.max(0, (CT.TUNING_BY[t.id]?.frets || 22) + 1 - 13));
                    setScPos(0);
                  }}
                >
                  {t.name}
                  <small>{t.open.length}현 · {t.frets}f</small>
                </button>
              ))}
            </div>
            {/* 하위 호환용 hidden select */}
            <select
              id="sc-inst"
              value={scInst}
              onChange={(e) => setScInst(e.target.value as TuningId)}
              hidden
            >
              {CT.TUNINGS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* CAGED 5블럭 선택기 */}
          <div className={styles.field}>
            <span className={styles.lab}>CAGED 5블럭 포지션 (관계장조 창 기준)</span>
            <div id="sc-block" className={styles.chips}>
              {CAGED_BLOCK_CHIPS.map((b) => (
                <button
                  key={b.v}
                  type="button"
                  className={styles.chip}
                  disabled={scIsCagedUnsupported && b.v > 0}
                  aria-pressed={scEffBlock === b.v}
                  onClick={() => setScBlock(b.v)}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <span id="sc-block-msg" className={styles.note} hidden={!scIsCagedUnsupported}>
              화성·가락단음계는 CAGED 5블럭 대신 전체 지판 모드로 표시됩니다 (3NPS 7포지션 후보).
            </span>
          </div>

          <div className={styles.controls}>
            <div className={styles.field}>
              <span className={styles.lab}>연습 모드</span>
              <div id="sc-mode" className={styles.chips}>
                <button
                  type="button"
                  className={styles.chip}
                  aria-pressed={scMode === 'simple'}
                  onClick={() => {
                    setScMode('simple');
                    setScCi(0);
                  }}
                >
                  단순 스케일
                </button>
                <button
                  type="button"
                  className={styles.chip}
                  aria-pressed={scMode === 'circle'}
                  onClick={() => {
                    setScMode('circle');
                    setScCi(0);
                  }}
                >
                  5도권 순환
                </button>
              </div>
            </div>

            <div className={styles.field}>
              <label id="sc-root-lab" htmlFor="sc-root">
                {scMode === 'circle' ? '시작 루트' : '루트 음'}
              </label>
              <select
                id="sc-root"
                className={styles.selectField}
                value={scRoot}
                onChange={(e) => {
                  setScRoot(+e.target.value);
                  setScCi(0);
                }}
              >
                {CT.NAMES.map((name, i) => (
                  <option key={name} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label htmlFor="sc-type">스케일 종류</label>
              <select
                id="sc-type"
                className={styles.selectField}
                value={scType}
                onChange={(e) => setScType(e.target.value)}
              >
                {CT.SCALES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <span className={styles.lab}>음표 라벨</span>
              <div id="sc-label" className={styles.chips}>
                {(['deg', 'name', 'none'] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    className={styles.chip}
                    aria-pressed={scLabel === l}
                    onClick={() => setScLabel(l)}
                  >
                    {l === 'deg' ? '도수' : l === 'name' ? '음이름' : '없음'}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.lab}>손잡이</span>
              <div id="sc-hand" className={styles.chips}>
                <button
                  type="button"
                  className={styles.chip}
                  aria-pressed={scHand === 'right'}
                  onClick={() => setScHand('right')}
                >
                  오른손
                </button>
                <button
                  type="button"
                  className={styles.chip}
                  aria-pressed={scHand === 'left'}
                  onClick={() => setScHand('left')}
                >
                  왼손
                </button>
              </div>
            </div>

            <div id="sc-circle-opts" className={styles.field} hidden={scMode !== 'circle'}>
              <span className={styles.lab}>순환 방향</span>
              <div id="sc-dir" className={styles.chips}>
                <button
                  type="button"
                  className={styles.chip}
                  aria-pressed={scDir === 1}
                  onClick={() => {
                    setScDir(1);
                    setScCi(0);
                  }}
                >
                  5도 위 (C→G→D)
                </button>
                <button
                  type="button"
                  className={styles.chip}
                  aria-pressed={scDir === -1}
                  onClick={() => {
                    setScDir(-1);
                    setScCi(0);
                  }}
                >
                  4도 위 (C→F→B♭)
                </button>
              </div>
            </div>

            <div className={styles.field} hidden={scMode !== 'circle'}>
              <label htmlFor="sc-bars">키당 마디 수</label>
              <select
                id="sc-bars"
                className={styles.selectField}
                value={scBars}
                onChange={(e) => setScBars(+e.target.value)}
              >
                <option value={0}>스케일 한 바퀴</option>
                <option value={1}>1마디 (8박)</option>
                <option value={2}>2마디 (16박)</option>
                <option value={4}>4마디 (32박)</option>
              </select>
            </div>

            <div className={styles.field}>
              <span className={styles.lab}>재생 범위</span>
              <div id="sc-range" className={styles.chips}>
                <button
                  type="button"
                  className={styles.chip}
                  aria-pressed={scRange === 'oct'}
                  onClick={() => setScRange('oct')}
                >
                  한 옥타브
                </button>
                <button
                  type="button"
                  className={styles.chip}
                  aria-pressed={scRange === 'pos'}
                  onClick={() => setScRange('pos')}
                >
                  보이는 범위 전체
                </button>
              </div>
            </div>

            <div className={styles.field}>
              <label htmlFor="sc-bpm">BPM (8분음표)</label>
              <input
                id="sc-bpm"
                className={styles.numField}
                type="number"
                min="30"
                max="220"
                value={scBpm}
                onChange={(e) => setScBpm(+e.target.value)}
              />
            </div>

            <label className={styles.check}>
              <input
                id="sc-rootonly"
                type="checkbox"
                checked={scRootOnly}
                onChange={(e) => setScRootOnly(e.target.checked)}
              />
              근음만 보기 (암기)
            </label>
          </div>

          <div className={styles.row}>
            <button
              id="sc-play"
              type="button"
              className={styles.playbtn}
              aria-pressed={scPlaying}
              onClick={toggleScPlay}
            >
              {scPlaying ? '정지' : '재생'}
            </button>
            <span id="sc-status" className={styles.status}>
              {scWinLo}–{scWinHi}프렛 · 보이는 스케일 음 {scBoardNotes.length}개
            </span>
          </div>
        </div>
      </section>

      {/* 2. 코드톤 지도 패널 */}
      <section id="pane-tone" role="tabpanel" className={styles.pane} hidden={activeTab !== 'tone'}>
        <div className={styles.panel}>
          <p className={styles.lead}>
            <b>2-note-per-string 코드톤 지도.</b> 줄마다 두 음씩 짚어 4성 화음의 모든 구성음을 1~4프렛 안에서 파악합니다.
          </p>
          <div className={styles.controls}>
            <div className={styles.field}>
              <label htmlFor="tone-root">루트 음</label>
              <select
                id="tone-root"
                className={styles.selectField}
                value={toneRoot}
                onChange={(e) => setToneRoot(+e.target.value)}
              >
                {CT.NAMES.map((name, i) => (
                  <option key={name} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="tone-near">시작 프렛 부근</label>
              <input
                id="tone-near"
                className={styles.numField}
                type="number"
                min="1"
                max="12"
                value={toneNear}
                onChange={(e) => setToneNear(+e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="tone-bpm">BPM</label>
              <input
                id="tone-bpm"
                className={styles.numField}
                type="number"
                min="40"
                max="200"
                value={toneBpm}
                onChange={(e) => setToneBpm(+e.target.value)}
              />
            </div>
            <label className={styles.check}>
              <input
                id="tone-auto"
                type="checkbox"
                checked={toneAuto}
                onChange={(e) => setToneAuto(e.target.checked)}
              />
              한 바퀴 돌면 다음 성질 자동 전환
            </label>
          </div>

          <div className={styles.field}>
            <span className={styles.lab}>시작 도수 패턴</span>
            <div id="tone-start" className={styles.chips}>
              {START_PAT.map((p) => (
                <button
                  key={p.v}
                  type="button"
                  className={styles.chip}
                  aria-pressed={toneStart === p.v}
                  onClick={() => setToneStart(p.v)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.lab}>화음 성질</span>
            <div id="tone-q" className={styles.chips}>
              {CT.ARP_Q.map((q) => (
                <button
                  key={q}
                  type="button"
                  className={styles.chip}
                  aria-pressed={toneQ === q}
                  onClick={() => setToneQ(q)}
                >
                  {CT.QBY[q]?.name}
                  <small>{RULE[q]}</small>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.row}>
            <div id="tone-dir" className={styles.chips}>
              {(['up', 'down', 'round'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  className={styles.chip}
                  aria-pressed={toneDir === d}
                  onClick={() => setToneDir(d)}
                >
                  {d === 'up' ? '상행' : d === 'down' ? '하행' : '왕복'}
                </button>
              ))}
            </div>
            <button
              id="tone-play"
              type="button"
              className={styles.playbtn}
              aria-pressed={tonePlaying}
              onClick={toggleTonePlay}
            >
              {tonePlaying ? '정지' : '재생'}
            </button>
          </div>
        </div>

        <div className={styles.panel}>
          <h3 id="tone-title" className={styles.h3}>
            {CT.NAMES[toneRoot]}
            {CT.QBY[toneQ]?.name} · {START_PAT[toneStart]?.label}
          </h3>
          <div className={styles.scroll}>
            <div id="tone-board">
              <FretboardSvg
                from={0}
                to={Math.max(15, Math.min(22, Math.max(...toneNotes.map((n: any) => n.f)) + 1))}
                label={`${CT.NAMES[toneRoot]}${CT.QBY[toneQ]?.name} 2-note-per-string`}
                notes={toneBoardNotes}
              />
            </div>
          </div>
          <div id="tone-seq" className={styles.seq}>
            {(toneDir === 'down' ? [...toneNotes].reverse() : toneNotes).map((n: any, i: number) => (
              <span key={i} className={`seqn ${n.cls || ''} ${n.moved ? 'moved' : ''}`}>
                {6 - n.s}·{n.f}
                <b>{n.deg}</b>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* 3. 보이싱 매트릭스 패널 */}
      <section id="pane-matrix" role="tabpanel" className={styles.pane} hidden={activeTab !== 'matrix'}>
        <div className={styles.panel}>
          <p className={styles.lead}>
            <b>보이싱 매트릭스.</b> 드롭 2·3·2&4의 4가지 전위와 4줄 조합을 손 폭 안에 맞춰 펼칩니다.
          </p>
          <div className={styles.controls}>
            <div className={styles.field}>
              <label htmlFor="mx-root">루트 음</label>
              <select
                id="mx-root"
                className={styles.selectField}
                value={mxRoot}
                onChange={(e) => setMxRoot(+e.target.value)}
              >
                {CT.NAMES.map((name, i) => (
                  <option key={name} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="mx-span">손 폭 (프렛)</label>
              <input
                id="mx-span"
                className={styles.numField}
                type="number"
                min="3"
                max="6"
                value={mxSpan}
                onChange={(e) => setMxSpan(+e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="mx-bpm">BPM</label>
              <input
                id="mx-bpm"
                className={styles.numField}
                type="number"
                min="40"
                max="160"
                value={mxBpm}
                onChange={(e) => setMxBpm(+e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="mx-beats">코드당 박자</label>
              <input
                id="mx-beats"
                className={styles.numField}
                type="number"
                min="1"
                max="8"
                value={mxBeats}
                onChange={(e) => setMxBeats(+e.target.value)}
              />
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.lab}>드롭 종류</span>
            <div id="mx-drop" className={styles.chips}>
              {CT.DROPS.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={styles.chip}
                  aria-pressed={mxDrop === d.id}
                  onClick={() => setMxDrop(d.id)}
                >
                  {d.name}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.lab}>전위 (베이스 음)</span>
            <div id="mx-inv" className={styles.chips}>
              {CT.INV_NAME.map((n, i) => (
                <button
                  key={n}
                  type="button"
                  className={styles.chip}
                  aria-pressed={mxInv === i}
                  onClick={() => setMxInv(i)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.lab}>줄 조합</span>
            <div id="mx-set" className={styles.chips}>
              {mxPlayableSets.map((s: any) => {
                const sk = s.set.join(',');
                return (
                  <button
                    key={sk}
                    type="button"
                    className={styles.chip}
                    aria-pressed={mxSetKey === sk}
                    onClick={() => setMxSetKey(sk)}
                  >
                    {s.label}번줄
                    <small>{s.full ? '9개 성질 전부' : '일부 성질만'}</small>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.lab}>포지션 선택</span>
            <div id="mx-place" className={styles.chips}>
              {mxPlacements.map((p: any, i: number) => (
                <button
                  key={i}
                  type="button"
                  className={styles.chip}
                  aria-pressed={safeMxPlace === i}
                  onClick={() => setMxPlace(i)}
                >
                  {Math.min(...p.frets)}프렛 부근
                </button>
              ))}
            </div>
          </div>

          <div className={styles.row}>
            <button
              id="mx-play"
              type="button"
              className={styles.playbtn}
              aria-pressed={mxPlaying}
              onClick={toggleMxPlay}
            >
              {mxPlaying ? '정지' : '재생'}
            </button>
            <span id="mx-count" className={styles.status}>
              {CT.NAMES[mxRoot]} 기준, 손 폭 {mxSpan + 1}프렛 안에서 잡히는 조합 {mxCounts.ok}개
            </span>
          </div>
        </div>

        <div className={styles.panel}>
          <div id="mx-struct" className={styles.meta}>
            아래 음부터: {mxDropStructure.map((n: any) => CT.SLOT_NAME[n.slot]).join(' → ')}
          </div>
          <h3 id="mx-btitle" className={styles.h3}>
            {CT.NAMES[mxRoot]}
            {CT.QBY[mxQ]?.name}
          </h3>
          <div className={styles.scroll}>
            <div id="mx-board">
              {activeMxSetObj && (
                <ChordNeckSvg
                  press={
                    CT.atR0(mxDropStructure, activeMxSetObj.set, mxR0, mxQ)?.notes || []
                  }
                  ctx={buildCtxNotes(mxRoot, q4Tones(mxQ))}
                  label={`${CT.NAMES[mxRoot]}${CT.QBY[mxQ]?.name} 지판`}
                />
              )}
            </div>
          </div>
          <div id="mx-strip" className={styles.strip}>
            {CT.Q4.map((q) => {
              if (!activeMxSetObj) return null;
              const a = CT.atR0(mxDropStructure, activeMxSetObj.set, mxR0, q.id);
              return (
                <figure
                  key={q.id}
                  className={`${styles.cell} ${q.id === mxQ ? styles.dsStepCardSel : ''}`}
                  onClick={() => {
                    setMxQ(q.id);
                    if (a.valid) {
                      audioEngine.chord(pitchesOf(a.notes), audioEngine.now() + 0.02);
                    }
                  }}
                >
                  {a.valid ? (
                    <ChordBoxSvg notes={a.notes} label={`${CT.NAMES[mxRoot]}${q.name}`} />
                  ) : (
                    <div>이 자리에선 불가</div>
                  )}
                  <figcaption>
                    <b>
                      {CT.NAMES[mxRoot]}
                      {q.name}
                    </b>
                    <span>{a.valid ? fretText(a.notes) : ''}</span>
                  </figcaption>
                </figure>
              );
            })}
          </div>
          <div id="mx-alt" />
        </div>
      </section>

      {/* 4. 탑노트 5도권 패널 */}
      <section id="pane-circle" role="tabpanel" className={styles.pane} hidden={activeTab !== 'circle'}>
        <div className={styles.panel}>
          <div className={styles.ccTop}>
            <div id="cc-wheel">
              <CircleWheelSvg
                steps={ccStepsList}
                idx={ccIdx}
                onSelectStep={(i) => {
                  setCcIdx(i);
                  ccStepSound(i);
                }}
              />
            </div>
            <div className={styles.field}>
              <h2 id="cc-name" className={styles.h3}>
                {ccCurrentStep?.name}
              </h2>
              <div id="cc-deg" className={styles.meta}>
                Top: {ccCurrentStep?.deg} ({CT.NAMES[ccCurrentStep?.topPc]})
              </div>
              <div id="cc-where" className={styles.status}>
                {CT.strName(ccStr)} {ccTopFret}프렛 고정
              </div>
              <div id="cc-next" className={styles.note}>
                다음: {ccNextStep?.name} · Top {ccNextStep?.deg}
              </div>
            </div>
            <div className={styles.row}>
              <button id="cc-prev" type="button" className={styles.ghost} onClick={() => ccMove(-1)}>
                ◀ 이전
              </button>
              <button
                id="cc-play"
                type="button"
                className={styles.playbtn}
                aria-pressed={ccPlaying}
                onClick={toggleCcPlay}
              >
                {ccPlaying ? '정지' : '재생'}
              </button>
              <button id="cc-nextb" type="button" className={styles.ghost} onClick={() => ccMove(1)}>
                다음 ▶
              </button>
            </div>
          </div>

          <div className={styles.controls}>
            <div className={styles.field}>
              <label htmlFor="cc-root">시작 루트</label>
              <select
                id="cc-root"
                className={styles.selectField}
                value={ccRoot}
                onChange={(e) => setCcRoot(+e.target.value)}
              >
                {CT.NAMES.map((name, i) => (
                  <option key={name} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="cc-top">탑노트 음정</label>
              <select
                id="cc-top"
                className={styles.selectField}
                value={ccIv}
                onChange={(e) => setCcIv(+e.target.value)}
              >
                {[2, 9, 4, 6, 1, 8, 3, 10, 5, 0, 7].map((iv) => (
                  <option key={iv} value={iv}>
                    {CT.TOP_DEG[iv]}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="cc-str">탑노트 줄</label>
              <select
                id="cc-str"
                className={styles.selectField}
                value={ccStr}
                onChange={(e) => setCcStr(+e.target.value)}
              >
                {[5, 4, 3, 2, 1, 0].map((s) => (
                  <option key={s} value={s}>
                    {6 - s}번줄
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="cc-near">프렛 부근</label>
              <input
                id="cc-near"
                className={styles.numField}
                type="number"
                min="1"
                max="17"
                value={ccNear}
                onChange={(e) => setCcNear(+e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="cc-bpm">BPM</label>
              <input
                id="cc-bpm"
                className={styles.numField}
                type="number"
                min="30"
                max="140"
                value={ccBpm}
                onChange={(e) => setCcBpm(+e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="cc-beats">코드당 박자</label>
              <input
                id="cc-beats"
                className={styles.numField}
                type="number"
                min="1"
                max="8"
                value={ccBeats}
                onChange={(e) => setCcBeats(+e.target.value)}
              />
            </div>
            <label className={styles.check}>
              <input
                id="cc-hint"
                type="checkbox"
                checked={ccHint}
                onChange={(e) => setCcHint(e.target.checked)}
              />
              추천 폼 힌트 보기
            </label>
            <label className={styles.check}>
              <input
                id="cc-topsnd"
                type="checkbox"
                checked={ccTopSnd}
                onChange={(e) => setCcTopSnd(e.target.checked)}
              />
              탑노트 단음 울림
            </label>
            <label className={styles.check}>
              <input
                id="cc-skip"
                type="checkbox"
                checked={ccSkip}
                onChange={(e) => setCcSkip(e.target.checked)}
              />
              불협 칸 건너뛰기
            </label>
          </div>
        </div>

        <div className={styles.panel}>
          <div id="cc-hints" className={styles.boxrow}>
            {ccHintsList.map((h, i) => (
              <figure
                key={i}
                className={`${styles.cell} ${i === ccHsel ? styles.dsStepCardSel : ''}`}
                onClick={() => {
                  setCcHsel(i);
                  audioEngine.chord(
                    h.v.notes.map((n: any) => n.pitch),
                    audioEngine.now() + 0.02
                  );
                }}
              >
                <ChordBoxSvg notes={geNotesToDiagram(h.v)} label={h.v.name} />
                <figcaption>
                  <b>{h.kind}</b>
                  <span>{GE.fretStr(h.v)}</span>
                </figcaption>
              </figure>
            ))}
          </div>

          <div className={styles.scroll}>
            <div id="cc-board">
              <ChordNeckSvg
                press={
                  ccHintsList.length
                    ? geNotesToDiagram(ccHintsList[ccHsel]?.v || ccHintsList[0].v)
                    : [{ s: ccStr, f: ccTopFret, deg: ccCurrentStep?.deg.replace(/ .*/, ''), cls: 'guide' }]
                }
                ctx={ccCurrentStep?.q ? buildCtxNotes(ccCurrentStep.root, geTones(ccCurrentStep.q)) : []}
                label={`${ccCurrentStep?.name} 지판`}
              />
            </div>
          </div>

          <div id="cc-strip" className={styles.stepstrip}>
            {ccStepsList.map((s: any, i: number) => (
              <button
                key={i}
                type="button"
                className={`${styles.ccStep} ${i === ccIdx ? styles.ccStepCur : ''} ${!s.q ? styles.ccStepBad : ''}`}
                onClick={() => {
                  setCcIdx(i);
                  ccStepSound(i);
                }}
              >
                <b>{s.q ? s.name : `${CT.NAMES[s.root]}7`}</b>
                <span>{s.deg}</span>
              </button>
            ))}
          </div>

          <details id="cc-all" open={ccAllOpen} onToggle={() => setCcAllOpen(!ccAllOpen)}>
            <summary>이 탑노트로 가능한 모든 도미넌트 보기</summary>
            <div id="cc-alllist" />
          </details>
        </div>
      </section>

      {/* 5. 코드 재해석 패널 */}
      <section id="pane-reint" role="tabpanel" className={styles.pane} hidden={activeTab !== 'reint'}>
        <div className={styles.panel}>
          <p className={styles.lead}>
            <b>코드 재해석.</b> 하나의 손 모양이 바라보는 근음에 따라 전혀 다른 코드로 변하는 화성적 다의성을 익힙니다.
          </p>
          <div className={styles.field}>
            <span className={styles.lab}>프리셋 폼</span>
            <div id="ri-presets" className={styles.chips}>
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={styles.chip}
                  aria-pressed={riPreset === p.id}
                  onClick={() => {
                    setRiPreset(p.id);
                    setRiFrets([...p.frets]);
                    setRiPick(0);
                  }}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                className={styles.chip}
                aria-pressed={riPreset === 'custom'}
                onClick={() => setRiPreset('custom')}
              >
                직접 찍기
              </button>
            </div>
          </div>

          <div className={styles.scroll}>
            <div id="ri-board">
              <FretboardSvg
                from={0}
                to={15}
                clickable
                notes={riDegNotes}
                label="보이싱 입력 지판"
                onCellClick={(s, f) => {
                  const copy = [...riFrets];
                  copy[s] = copy[s] === f ? -1 : f;
                  setRiFrets(copy);
                  setRiPreset('custom');
                  setRiPick(0);
                  if (copy[s] >= 0) {
                    audioEngine.pluck(CT.OPEN[s] + f, audioEngine.now() + 0.02, 0.8);
                  }
                }}
              />
            </div>
          </div>

          <div className={styles.row}>
            <button
              id="ri-hear"
              type="button"
              className={styles.btn}
              onClick={() => {
                if (riNotes.length) audioEngine.chord(pitchesOf(riNotes), audioEngine.now() + 0.02);
              }}
            >
              소리 듣기
            </button>
            <button
              id="ri-clear"
              type="button"
              className={styles.ghost}
              onClick={() => {
                setRiFrets([-1, -1, -1, -1, -1, -1]);
                setRiPreset('custom');
                setRiPick(0);
              }}
            >
              지판 비우기
            </button>
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.riGrid}>
            <div id="ri-shape">
              {riNotes.length ? (
                <figure className={styles.cell}>
                  <ChordBoxSvg notes={riDegNotes} label="현재 모양" />
                  <figcaption>
                    <b>{fretText(riNotes)}</b>
                  </figcaption>
                </figure>
              ) : (
                <div className={styles.empty}>지판을 눌러 줄마다 한 음씩 찍으세요.</div>
              )}
            </div>

            <div id="ri-list" className={styles.chips}>
              {riInterpretList.map((interp: any, i: number) => (
                <button
                  key={i}
                  type="button"
                  className={`${styles.chip} ${riPick === i ? styles.dsStepCardSel : ''}`}
                  onClick={() => {
                    setRiPick(riPick === i ? null : i);
                    const nowTime = audioEngine.now() + 0.02;
                    audioEngine.bass(36 + interp.root + (interp.root < 4 ? 12 : 0), nowTime, 2);
                    audioEngine.chord(pitchesOf(riNotes), nowTime + 0.05, 2);
                  }}
                >
                  <b>{interp.name}</b>
                  <small>{interp.role}</small>
                </button>
              ))}
            </div>
          </div>

          <h3 className={styles.h3}>2-5-1 진행 속에 넣기</h3>
          <div className={styles.controls}>
            <div className={styles.field}>
              <label htmlFor="ri-key">키 선택</label>
              <select
                id="ri-key"
                className={styles.selectField}
                value={riKey}
                onChange={(e) => setRiKey(+e.target.value)}
              >
                {CT.NAMES.map((name, i) => (
                  <option key={name} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="ri-bpm">BPM</label>
              <input
                id="ri-bpm"
                className={styles.numField}
                type="number"
                min="40"
                max="180"
                value={riBpm}
                onChange={(e) => setRiBpm(+e.target.value)}
              />
            </div>
            <button
              id="ri-play"
              type="button"
              className={styles.playbtn}
              aria-pressed={riPlaying}
              onClick={toggleRiPlay}
            >
              {riPlaying ? '정지' : '재생'}
            </button>
          </div>
          <div id="ri-swap" className={styles.boxrow}>
            {riSwapPlan.map((p, i) => (
              <figure key={i} className={styles.cell}>
                {!p.none ? (
                  <ChordBoxSvg notes={p.notes} label={p.name} />
                ) : (
                  <div className={styles.empty}>이 모양은 불가</div>
                )}
                <figcaption>
                  <b>{p.ro.r} {p.name}</b>
                  <span>{p.notes ? fretText(p.notes) : ''}</span>
                </figcaption>
              </figure>
            ))}
          </div>

          {/* 퀴즈 박스 */}
          <h3 className={styles.h3}>보이싱 해석 퀴즈</h3>
          <div className={styles.quiz}>
            <div id="qz-box">
              {quizQuestion && (
                <ChordBoxSvg notes={quizQuestion.notes} label="퀴즈 모양" />
              )}
            </div>
            <div className={styles.field}>
              <div id="qz-score" className={styles.meta}>
                {quizScore.n ? `${quizScore.score} / ${quizScore.n}` : '아직 푼 문제 없음'}
              </div>
              <div id="qz-text" className={styles.lead}>
                {quizQuestion?.text}
              </div>
              <div id="qz-opts" className={styles.chips}>
                {quizQuestion?.opts.map((o, i) => (
                  <button
                    key={i}
                    type="button"
                    className={styles.chip}
                    disabled={quizDone}
                    onClick={() => {
                      if (quizDone) return;
                      setQuizDone(true);
                      setQuizScore((prev) => ({
                        score: o.ok ? prev.score + 1 : prev.score,
                        n: prev.n + 1,
                      }));
                      setQuizFeedback({
                        text: (o.ok ? '맞아요! ' : '아쉬워요. ') + quizQuestion.explain,
                        good: o.ok,
                      });
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {quizFeedback && (
                <div id="qz-fb" className={styles.note}>
                  {quizFeedback.text}
                </div>
              )}
              <div className={styles.row}>
                <button
                  id="qz-hear"
                  type="button"
                  className={styles.ghost}
                  onClick={() => {
                    if (quizQuestion) audioEngine.chord(pitchesOf(quizQuestion.notes), audioEngine.now() + 0.02);
                  }}
                >
                  소리 듣기
                </button>
                <button id="qz-next" type="button" className={styles.btn} onClick={startNewQuiz}>
                  다음 문제 ▶
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. 2-5-1 탐색 패널 */}
      <section id="pane-tf" role="tabpanel" className={styles.pane} hidden={activeTab !== 'tf'}>
        <div className={styles.panel}>
          <p className={styles.lead}>
            <b>2-5-1 탐색기.</b> 목표 프렛 창 안에서 부드러운 성부 진행으로 연결되는 2-5-1 보이싱 경로를 자동 발굴합니다.
          </p>
          <div className={styles.controls}>
            <div className={styles.field}>
              <label htmlFor="a-kind">진행 성격</label>
              <select
                id="a-kind"
                className={styles.selectField}
                value={tfKind}
                onChange={(e) => setTfKind(e.target.value as 'major' | 'minor')}
              >
                <option value="major">메이저 2-5-1</option>
                <option value="minor">마이너 2-5-1</option>
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="a-lo">시작 프렛</label>
              <input
                id="a-lo"
                className={styles.numField}
                type="number"
                min="0"
                max="15"
                value={tfLo}
                onChange={(e) => setTfLo(+e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="a-hi">끝 프렛</label>
              <input
                id="a-hi"
                className={styles.numField}
                type="number"
                min="3"
                max="20"
                value={tfHi}
                onChange={(e) => setTfHi(+e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="a-proot">펜타토닉 기준 루트</label>
              <select
                id="a-proot"
                className={styles.selectField}
                value={tfProot}
                onChange={(e) => setTfProot(+e.target.value)}
              >
                {CT.NAMES.map((name, i) => (
                  <option key={name} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="a-ptype">펜타 종류</label>
              <select
                id="a-ptype"
                className={styles.selectField}
                value={tfPtype}
                onChange={(e) => setTfPtype(e.target.value as 'min' | 'maj')}
              >
                <option value="min">마이너 펜타</option>
                <option value="maj">메이저 펜타</option>
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="a-out">펜타 밖 최대 음수</label>
              <input
                id="a-out"
                className={styles.numField}
                type="number"
                min="0"
                max="6"
                value={tfOutsideMax}
                onChange={(e) => setTfOutsideMax(+e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="a-guide">가이드톤 필수</label>
              <select
                id="a-guide"
                className={styles.selectField}
                value={tfNeedGuide}
                onChange={(e) => setTfNeedGuide(+e.target.value)}
              >
                <option value={2}>3도·7도 모두 필수</option>
                <option value={1}>하나만 필수</option>
                <option value={0}>제한 없음</option>
              </select>
            </div>
            <label className={styles.check}>
              <input
                id="a-pent"
                type="checkbox"
                checked={tfUsePent}
                onChange={(e) => setTfUsePent(e.target.checked)}
              />
              펜타토닉 창 필터
            </label>
            <label className={styles.check}>
              <input
                id="a-var"
                type="checkbox"
                checked={tfVariants}
                onChange={(e) => setTfVariants(e.target.checked)}
              />
              텐션 변형 포함
            </label>
          </div>

          <div className={styles.row}>
            <button id="a-go" type="button" className={styles.btn} onClick={runTfSearch}>
              탐색 실행
            </button>
            <span id="a-status" className={styles.status}>
              {tfStatus}
            </span>
          </div>
        </div>

        {/* 선택된 경로 지판 뷰 */}
        <div id="a-view" className={styles.panel} hidden={!tfCurrentPath}>
          <div className={styles.headRow}>
            <h3 id="a-vtitle" className={styles.h3}>
              {tfKey != null && CT.NAMES[tfKey]} 2-5-1 진행
            </h3>
            <span id="a-vmeta" className={styles.meta} />
            <button
              id="a-vplay"
              type="button"
              className={styles.playbtn}
              aria-pressed={tfPlaying}
              onClick={playTfSequence}
            >
              {tfPlaying ? '재생 중…' : '진행 듣기'}
            </button>
          </div>

          <div id="a-vchips" className={styles.chips}>
            {tfCurrentPath?.chords.map((c: any, i: number) => (
              <button
                key={i}
                type="button"
                className={styles.chip}
                aria-pressed={tfC === i}
                onClick={() => {
                  setTfC(i);
                  audioEngine.chord(pitchesOf(c.notes), audioEngine.now() + 0.02, 1.5);
                }}
              >
                {ROMAN[tfKind][i]} · {c.name}
              </button>
            ))}
          </div>

          <div className={styles.scroll}>
            <div id="a-board">
              {tfCurrentPath && (
                <ChordNeckSvg
                  press={geNotesToDiagram(tfCurrentPath.chords[tfC])}
                  ctx={buildCtxNotes(
                    tfCurrentPath.chords[tfC].root,
                    geTones(tfCurrentPath.chords[tfC].q)
                  )}
                  block={{ lo: tfLo, hi: tfHi }}
                  label="2-5-1 지판"
                />
              )}
            </div>
          </div>
          <div id="a-vctxl" className={styles.note}>
            지판 전체의 같은 코드톤
          </div>

          <div id="a-out-list" className={styles.results}>
            {tfOkList.map((k: any) => (
              <article key={k.key} className={styles.panel}>
                <h4 className={styles.h3}>
                  {CT.NAMES[k.key]} {tfKind === 'minor' ? '마이너' : '메이저'} 2-5-1
                </h4>
                <div className={styles.boxrowTight}>
                  {k.paths[0].chords.map((c: any, ci: number) => (
                    <figure
                      key={ci}
                      data-align-group={`tf-${k.key}:top,height`}
                      className={`${styles.cell} ${tfKey === k.key && tfC === ci ? styles.dsStepCardSel : ''}`}
                      onClick={() => {
                        setTfKey(k.key);
                        setTfP(0);
                        setTfC(ci);
                        audioEngine.chord(pitchesOf(c.notes), audioEngine.now() + 0.02, 1.5);
                      }}
                    >
                      <ChordBoxSvg notes={geNotesToDiagram(c)} label={c.name} />
                      <figcaption>
                        <b>{c.name}</b>
                        <span>{GE.fretStr(c)}</span>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 7. 더블 스탑 연습 패널 */}
      <section id="pane-ds" role="tabpanel" className={styles.pane} hidden={activeTab !== 'ds'}>
        <div className={styles.panel}>
          <p className={styles.lead}>
            <b>3도 · 6도 · 4도 더블 스탑.</b> 스케일 위에서 두 줄 화음(Double-Stop)을 인접 줄 또는 한 줄 건너뛴 줄 쌍으로 익히고 두 음을 동시에 울려 하모니 감각을 키웁니다.
          </p>

          <div className={styles.field}>
            <span className={styles.lab}>악기 선택</span>
            <div id="ds-inst" className={styles.chips}>
              {CT.TUNINGS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={styles.chip}
                  aria-pressed={dsInst === t.id}
                  onClick={() => {
                    const nextTun = CT.TUNING_BY[t.id] || CT.TUNING_BY.g6;
                    const nextPair = getSafeDoubleStopPair(nextTun.open.length, dsInterval, dsPair);
                    setDsInst(t.id);
                    setDsPair(nextPair);
                    setDsSel(0);
                  }}
                >
                  {t.name}
                  <small>{t.open.length}현 · {t.frets}f</small>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.controls}>
            <div className={styles.field}>
              <label htmlFor="ds-root">루트 음</label>
              <select
                id="ds-root"
                className={styles.selectField}
                value={dsRoot}
                onChange={(e) => setDsRoot(+e.target.value)}
              >
                {CT.NAMES.map((name, i) => (
                  <option key={name} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="ds-scale">스케일 종류</label>
              <select
                id="ds-scale"
                className={styles.selectField}
                value={dsScale}
                onChange={(e) => setDsScale(e.target.value)}
              >
                {DOUBLE_STOP_SCALES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="ds-bpm">BPM</label>
              <input
                id="ds-bpm"
                className={styles.numField}
                type="number"
                min="30"
                max="200"
                value={dsBpm}
                onChange={(e) => setDsBpm(+e.target.value)}
              />
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.lab}>더블 스탑 음정</span>
            <div id="ds-interval" className={styles.chips}>
              {CT.DOUBLE_STOP_INTERVALS.map((iv) => (
                <button
                  key={iv.id}
                  type="button"
                  className={styles.chip}
                  aria-pressed={dsInterval === iv.id}
                  onClick={() => {
                    const nextPair = getSafeDoubleStopPair(dsTuning.open.length, iv.id, dsPair);
                    setDsInterval(iv.id);
                    setDsPair(nextPair);
                    setDsSel(0);
                  }}
                >
                  {iv.name}
                  <small>{iv.desc}</small>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.lab}>줄 쌍 선택</span>
            <div id="ds-pair" className={styles.chips}>
              {dsPairOptions.map((opt) => {
                const isSel = effectiveDsPair[0] === opt.pair[0] && effectiveDsPair[1] === opt.pair[1];
                return (
                  <button
                    key={opt.key}
                    type="button"
                    className={styles.chip}
                    aria-pressed={isSel}
                    onClick={() => {
                      setDsPair(opt.pair);
                      setDsSel(0);
                    }}
                  >
                    {opt.label}
                    {opt.sub && <small>{opt.sub}</small>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={styles.row}>
            <div id="ds-dir" className={styles.chips}>
              {(['up', 'down', 'round'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  className={styles.chip}
                  aria-pressed={dsDir === d}
                  onClick={() => setDsDir(d)}
                >
                  {d === 'up' ? '상행' : d === 'down' ? '하행' : '왕복'}
                </button>
              ))}
            </div>
            <button
              id="ds-play"
              type="button"
              className={styles.playbtn}
              aria-pressed={dsPlaying}
              onClick={toggleDsPlay}
            >
              {dsPlaying ? '정지' : '재생'}
            </button>
            <span id="ds-status" className={styles.status}>
              다이어토닉 더블 스탑 {dsStepsList.length}개 스텝
            </span>
          </div>
        </div>

        <div className={styles.panel}>
          <h3 id="ds-title" className={styles.h3}>
            {CT.NAMES[dsRoot]} {dsScale} · {CT.DOUBLE_STOP_INTERVALS.find((i) => i.id === dsInterval)?.name} (
            {dsTuning.open.length - effectiveDsPair[1]}-{dsTuning.open.length - effectiveDsPair[0]}번줄)
          </h3>
          <div className={styles.scroll}>
            <div id="ds-board">
              <NeckSvg
                open={dsTuning.open}
                isBass={dsTuning.kind === 'bass'}
                lo={0}
                hi={dsTuning.frets}
                label="더블 스탑 지판"
                notes={dsBoardNotes}
                onNoteClick={(pitch) => {
                  const foundIdx = dsStepsList.findIndex(
                    (st) => st.notes[0].pitch === pitch || st.notes[1].pitch === pitch
                  );
                  if (foundIdx >= 0) playDsStep(foundIdx);
                }}
              />
            </div>
          </div>

          <div className={styles.legend}>
            <span><i className="r" />근음</span>
            <span><i className="g" />더블 스탑 구성음</span>
            <span><i className="ctxk" />지판 전체 스케일 음</span>
            <span><i className="blkk" />현재 짚는 두 음 범위</span>
            <span><i className="n" />지금 울리는 두 음</span>
          </div>

          <h3 className={styles.h3}>
            다이어토닉 더블 스탑 스텝 (카드를 누르면 두 음이 동시에 울려요)
          </h3>
          <div id="ds-steps" className={styles.strip}>
            {dsStepsList.map((step, idx) => {
              const isSel = idx === safeDsSel;
              const n0 = step.notes[0];
              const n1 = step.notes[1];
              return (
                <button
                  key={step.step}
                  type="button"
                  className={`${styles.dsStepCard} ${isSel ? styles.dsStepCardSel : ''}`}
                  onClick={() => playDsStep(idx)}
                >
                  <b>{step.label}</b>
                  <span>
                    {n0.name}+{n1.name} ({n0.deg}+{n1.deg})
                  </span>
                  <small>
                    {dsTuning.open.length - n0.s}·{n0.f}f + {dsTuning.open.length - n1.s}·{n1.f}f
                  </small>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* 8. 진행 연주 패널 (CH-5b) */}
      <section id="pane-prog" role="tabpanel" className={styles.pane} hidden={activeTab !== 'prog'}>
        <ProgressionPlayTab
          active={activeTab === 'prog'}
          hash={progHash}
          onNavigate={(h) => {
            window.location.hash = h;
          }}
          onOpenMatrix={(root, q) => {
            setMxRoot(root);
            setMxQ(q);
            handleTabChange('matrix');
          }}
          onOpenTone={(root, q) => {
            setToneRoot(root);
            setToneQ(q);
            handleTabChange('tone');
          }}
        />
      </section>
    </div>
    </AppShell>
  );
}
