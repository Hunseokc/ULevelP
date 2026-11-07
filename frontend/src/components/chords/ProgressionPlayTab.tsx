// frontend/src/components/chords/ProgressionPlayTab.tsx
// CH-5b: 연습실 8번째 탭 "진행 연주" — chords.html#prog?c=&k=&t=&from= 로 받은 진행을 정석 폼 보이싱 경로로 연주
// 프레임: 개발산출물/결과/CH-1a_프레임.md §3, 엔진: 결과/CH-2b_엔진퀄리티.md §2, 결과/CH-2c-2_정석폼.md §2
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SafeLink } from '../common/SafeLink';
import { audioEngine, CT, GE, loadChordForms, PATH } from '../../lib/musicEngine';
import type { FormTable, PathOptions, Voicing, VoicingPath } from '../../lib/musicEngine';
import { ChordBoxSvg, ChordNeckSvg, buildCtxNotes, geNotesToDiagram, pitchesOf } from './ChordDiagrams';
import { parseChord } from '../../lib/chords/symbol.mts';
import type { ChordOk } from '../../lib/chords/symbol.mts';
import {
  backHref,
  checkChord,
  computeRomans,
  parseProgHash,
  playHref,
  seedToDto,
  splitChordInput,
  transposeKey,
  transposeSymbol,
} from '../progressions/model.mts';
import { DEFAULT_ARCHIVE_PROGRESSIONS, DEFAULT_REFERENCE_PROGRESSIONS } from '../../lib/progressions';
import styles from '../../pages/ChordsPage.module.css';

export interface ProgressionPlayTabProps {
  /** 이 탭이 보이는지 — 숨겨지면 재생을 멈춘다 */
  active: boolean;
  /** window.location.hash ("#prog?c=…") */
  hash: string;
  /** 빈 상태에서 진행을 고르거나 입력했을 때 새 해시로 */
  onNavigate: (hash: string) => void;
  onOpenMatrix: (root: number, quality: string) => void;
  onOpenTone: (root: number, quality: string) => void;
}

type PathMode = 'standard' | 'both' | 'wide' | 'none';

// 정석 폼(standard) → 없으면 재즈식 간단한 폼과 섞어(both) → 그래도 없으면 범위를 0~15로 넓혀서 (CH-2c-2 §2)
function computePaths(chords: ChordOk[], table: FormTable, lo: number, hi: number): { paths: VoicingPath[]; mode: PathMode } {
  if (!chords.length) return { paths: [], mode: 'none' };
  const base: PathOptions = { formTable: table, loop: true, lo, hi };
  let paths = PATH.bestPaths(chords, { ...base, shapes: 'standard' });
  if (paths.length) return { paths, mode: 'standard' };
  paths = PATH.bestPaths(chords, { ...base, shapes: 'both' });
  if (paths.length) return { paths, mode: 'both' };
  paths = PATH.bestPaths(chords, { ...base, shapes: 'both', lo: 0, hi: 15 });
  if (paths.length) return { paths, mode: 'wide' };
  return { paths: [], mode: 'none' };
}

const KIND_TEXT: Record<string, string> = { table: '정석 폼', rule: '규칙 폼', compact: '간단한 폼(대체)' };

function voicingNotes(v: Voicing, chord: ChordOk): string[] {
  const out: string[] = [];
  const kind = v.kind || 'compact';
  out.push(KIND_TEXT[kind] || kind);
  if (v.omit && v.omit.length) out.push(`${v.omit.join('·')} 생략`);
  if (chord.bass !== undefined && v.notes.length && v.notes[0].pc !== chord.bass) out.push('베이스 생략(재생 베이스로만)');
  return out;
}

const bassMidi = (pc: number): number => 36 + pc + (pc < 4 ? 12 : 0);

const SEEDS = [...DEFAULT_REFERENCE_PROGRESSIONS, ...DEFAULT_ARCHIVE_PROGRESSIONS].map(seedToDto);
const SEMIS = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6];
const Q4_IDS = new Set(CT.Q4.map((q) => q.id));

export function ProgressionPlayTab({ active, hash, onNavigate, onOpenMatrix, onOpenTone }: ProgressionPlayTabProps): React.ReactElement {
  const prog = useMemo(() => parseProgHash(hash) || { chords: [], key: '', title: '', from: '', note: '' }, [hash]);

  const [table, setTable] = useState<FormTable | null>(null);
  const [tableErr, setTableErr] = useState('');
  const [semis, setSemis] = useState(0);
  const [lo, setLo] = useState(0);
  const [hi, setHi] = useState(12);
  const [pathIdx, setPathIdx] = useState(0);
  const [cur, setCur] = useState(0);
  const [overrides, setOverrides] = useState<Record<number, Voicing>>({});
  const [showAlt, setShowAlt] = useState(false);
  const [bpm, setBpm] = useState(80);
  const [beats, setBeats] = useState(4);
  const [loop, setLoop] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [draft, setDraft] = useState('');
  const timerRef = useRef<number | null>(null);

  const stop = () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    setPlaying(false);
  };

  // 표는 이 탭을 처음 열 때만 받는다(첫 화면 번들에 안 넣음 — CH-2c-2 §1)
  useEffect(() => {
    if (!active || table) return;
    let alive = true;
    loadChordForms()
      .then((t) => alive && setTable(t))
      .catch(() => alive && setTableErr('정석 폼 표를 불러오지 못했어요. 새로고침해 보세요.'));
    return () => {
      alive = false;
    };
  }, [active, table]);

  useEffect(() => {
    if (!active) stop();
  }, [active]);
  useEffect(() => stop, []);

  // 다른 진행이 들어오면 탐구 상태를 처음으로
  useEffect(() => {
    stop();
    setSemis(0);
    setPathIdx(0);
    setCur(0);
    setOverrides({});
    setShowAlt(false);
  }, [hash]);

  const targetKey = prog.key ? transposeKey(prog.key, semis) : '';
  const romans = useMemo(() => computeRomans(prog.chords, prog.key), [prog]);
  const items = useMemo(
    () =>
      prog.chords.map((sym, i) => {
        const shown = transposeSymbol(sym, semis, targetKey);
        const c = parseChord(shown);
        return { i, sym, shown, chord: c.ok ? c : null, warn: checkChord(sym).warning, roman: romans[i] || '' };
      }),
    [prog, semis, targetKey, romans]
  );
  const playable = useMemo(() => items.filter((x) => x.chord), [items]);
  const skipped = items.length - playable.length;

  const { paths, mode } = useMemo(
    () => (table ? computePaths(playable.map((x) => x.chord!), table, lo, Math.max(lo, hi)) : { paths: [], mode: 'none' as PathMode }),
    [table, playable, lo, hi]
  );
  const path = paths[Math.min(pathIdx, Math.max(0, paths.length - 1))] || null;
  const voicings: Voicing[] = path ? path.voicings.map((v, k) => overrides[k] || v) : [];
  const curK = Math.min(cur, Math.max(0, playable.length - 1));
  const curItem = playable[curK];
  const curV = voicings[curK];

  // 경로·범위·조가 바뀌면 직접 고른 보이싱은 버린다(같은 자리라도 다른 코드일 수 있음)
  useEffect(() => {
    setOverrides({});
  }, [pathIdx, lo, hi, semis, table]);

  const alts = useMemo(() => {
    if (!showAlt || !curItem || !table) return [];
    const shapes = mode === 'standard' ? 'standard' : 'both';
    const range = mode === 'wide' ? { lo: 0, hi: 15 } : { lo, hi: Math.max(lo, hi) };
    return PATH.chordCandidates(curItem.chord!, { shapes, formTable: table, ...range, topK: 8 }).voicings;
  }, [showAlt, curItem, table, mode, lo, hi]);

  const playChordAt = (k: number, when: number, dur: number) => {
    const it = playable[k];
    const v = voicings[k];
    if (!it || !v) return;
    const c = it.chord!;
    audioEngine.bass(bassMidi(c.bass !== undefined ? c.bass : c.root), when, dur);
    audioEngine.chord(pitchesOf(v.notes), when + 0.01, dur * 0.9);
  };

  const togglePlay = () => {
    if (playing) {
      stop();
      return;
    }
    if (!voicings.length) return;
    audioEngine.resume();
    setPlaying(true);
    const n = voicings.length;
    const spb = 60 / bpm;
    let beat = 0;
    const tick = () => {
      const idx = Math.floor(beat / beats);
      if (idx >= n && !loop) {
        stop();
        return;
      }
      const k = beat % beats;
      const now = audioEngine.now();
      audioEngine.click(now, k === 0);
      if (k === 0) {
        playChordAt(idx % n, now, spb * beats);
        setCur(idx % n);
      }
      beat++;
    };
    tick();
    timerRef.current = window.setInterval(tick, spb * 1000);
  };

  const pickChord = (k: number) => {
    setCur(k);
    playChordAt(k, audioEngine.now() + 0.02, 1.5);
  };

  const back = (
    <SafeLink id="pp-back" className={styles.ghost} href={backHref(prog.from)}>
      ← 코드 진행 모음으로
    </SafeLink>
  );

  // ── 빈 상태: 기본 시드 고르기 + 직접 입력 ──
  if (!prog.chords.length) {
    const draftSymbols = splitChordInput(draft);
    return (
      <div className={styles.panel} id="pp-empty">
        <div className={styles.headRow}>
          <h2 className={styles.h3}>진행 연주</h2>
          {back}
        </div>
        <p className={styles.lead}>
          코드 진행 모음에서 <b>▶ 연습실에서 직접 연주해볼까요?</b>를 누르면 그 진행이 여기로 와요. 기본 진행을 고르거나 코드를 직접 넣어 볼 수도 있어요.
        </p>
        <div className={styles.chips} id="pp-seeds">
          {SEEDS.map((s) => (
            <SafeLink key={s.id} className={`${styles.chip} ${styles.ppSeed}`} href={playHref(s)} data-seed={s.id}>
              {s.title}
              <small>{s.chords.map((c) => c.symbol).join(' - ')}</small>
            </SafeLink>
          ))}
        </div>
        <form
          className={styles.row}
          onSubmit={(e) => {
            e.preventDefault();
            if (!draftSymbols.length) return;
            onNavigate(playHref({ chords: draftSymbols.map((symbol) => ({ symbol, roman: '' })) }).replace(/^chords\.html/, ''));
          }}
        >
          <label htmlFor="pp-input" className={styles.lab}>
            코드 직접 입력
          </label>
          <input
            id="pp-input"
            className={`${styles.numField} ${styles.ppInput}`}
            placeholder="예: C - G - Am - F"
            value={draft}
            maxLength={600}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className={styles.btn} disabled={!draftSymbols.length}>
            연주하기
          </button>
        </form>
      </div>
    );
  }

  const status = !table
    ? tableErr || '정석 폼 불러오는 중…'
    : !playable.length
      ? '읽을 수 있는 코드가 없어요.'
      : mode === 'none'
        ? '이 범위에서 이어 칠 수 있는 보이싱 경로가 없어요. 프렛 범위를 넓혀 보세요.'
        : mode === 'both'
          ? '정석 폼이 없는 코드가 있어 간단한 폼으로 대체했어요.'
          : mode === 'wide'
            ? '이 범위로는 경로가 없어 0–15프렛으로 넓혀 찾았어요.'
            : '';

  return (
    <div className={styles.pane}>
      <div className={styles.panel}>
        <div className={styles.headRow}>
          <h2 className={styles.h3} id="pp-title">
            {prog.title || '진행 연주'}
            {targetKey && <span className={styles.meta}>{targetKey}</span>}
          </h2>
          {back}
        </div>

        <div className={styles.chips} id="pp-chips">
          {items.map((it) => {
            const k = playable.indexOf(it);
            const v = k >= 0 ? voicings[k] : undefined;
            const notes = it.chord && v ? voicingNotes(v, it.chord) : [];
            const sub = [it.roman, it.chord ? '' : '못 읽음 — 빠집니다', ...(it.warn && it.chord ? ['도수 중복'] : [])].filter(Boolean).join(' · ');
            return (
              <button
                key={it.i}
                type="button"
                className={styles.chip}
                data-chord={it.i}
                data-kind={v?.kind || (v ? 'compact' : '')}
                aria-pressed={k >= 0 && k === curK}
                disabled={k < 0}
                title={[it.warn, ...notes].filter(Boolean).join(' · ')}
                onClick={() => k >= 0 && pickChord(k)}
              >
                {it.shown}
                {sub && <small>{sub}</small>}
              </button>
            );
          })}
        </div>
        {skipped > 0 && (
          <p className={styles.note} id="pp-skipped">
            못 읽는 코드 {skipped}개는 빼고 연주해요.
          </p>
        )}

        <div className={styles.controls}>
          <div className={styles.field}>
            <label htmlFor="pp-semis">키 옮기기</label>
            <select id="pp-semis" className={styles.selectField} value={semis} onChange={(e) => setSemis(+e.target.value)}>
              {SEMIS.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? '원래 키' : `${n > 0 ? '+' : ''}${n}`}
                  {prog.key ? ` · ${transposeKey(prog.key, n)}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="pp-lo">프렛 범위 시작</label>
            <input id="pp-lo" type="number" className={styles.numField} min={0} max={15} value={lo} onChange={(e) => setLo(Math.max(0, Math.min(15, +e.target.value || 0)))} />
          </div>
          <div className={styles.field}>
            <label htmlFor="pp-hi">프렛 범위 끝</label>
            <input id="pp-hi" type="number" className={styles.numField} min={1} max={15} value={hi} onChange={(e) => setHi(Math.max(1, Math.min(15, +e.target.value || 1)))} />
          </div>
          <div className={styles.field}>
            <label htmlFor="pp-bpm">BPM</label>
            <input id="pp-bpm" type="number" className={styles.numField} min={40} max={200} value={bpm} onChange={(e) => setBpm(Math.max(40, Math.min(200, +e.target.value || 80)))} />
          </div>
          <div className={styles.field}>
            <label htmlFor="pp-beats">코드당 박</label>
            <select id="pp-beats" className={styles.selectField} value={beats} onChange={(e) => setBeats(+e.target.value)}>
              {[1, 2, 4, 8].map((b) => (
                <option key={b} value={b}>
                  {b}박
                </option>
              ))}
            </select>
          </div>
          <label className={styles.check}>
            <input type="checkbox" id="pp-loop" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
            반복
          </label>
        </div>

        <div className={styles.row}>
          <div className={styles.chips} role="group" aria-label="보이싱 경로" id="pp-paths">
            {paths.map((p, i) => (
              <button key={i} type="button" className={styles.chip} aria-pressed={i === pathIdx} onClick={() => setPathIdx(i)}>
                경로 {i + 1}
                <small>이동 {p.cost.toFixed(1)}</small>
              </button>
            ))}
          </div>
          <button id="pp-play" type="button" className={styles.playbtn} aria-pressed={playing} disabled={!voicings.length} onClick={togglePlay}>
            {playing ? '■ 멈춤' : '▶ 재생'}
          </button>
        </div>
        {status && (
          <p className={styles.note} id="pp-status" role="status">
            {status}
          </p>
        )}
      </div>

      {voicings.length > 0 && (
        <div className={styles.panel}>
          <div className={styles.scroll}>
            <div className={`${styles.boxrowTight} ${styles.ppBoxes}`} id="pp-boxes">
              {voicings.map((v, k) => (
                <figure
                  key={k}
                  className={`${styles.cell} ${k === curK ? styles.dsStepCardSel : ''}`}
                  data-box={k}
                  onClick={() => pickChord(k)}
                >
                  <ChordBoxSvg notes={geNotesToDiagram(v)} label={playable[k].shown} />
                  <figcaption>
                    <b>{playable[k].shown}</b>
                    <span>{GE.fretStr(v)}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>

          {curItem && curV && (
            <>
              <h3 className={styles.h3} id="pp-cur">
                고른 코드: {curItem.shown}
                <span className={styles.meta}>{voicingNotes(curV, curItem.chord!).join(' · ')}</span>
                {curItem.warn && <span className={styles.meta}>{curItem.warn}</span>}
              </h3>
              <div className={styles.scroll}>
                <ChordNeckSvg
                  press={geNotesToDiagram(curV)}
                  ctx={buildCtxNotes(
                    curItem.chord!.root,
                    curItem.chord!.degrees.filter((d) => GE.DEG[d]).map((d) => ({ iv: GE.DEG[d][0], deg: d }))
                  )}
                  label={`${curItem.shown} 지판`}
                />
              </div>
              <div className={styles.row}>
                <button type="button" className={styles.ghost} id="pp-alt" aria-expanded={showAlt} onClick={() => setShowAlt((x) => !x)}>
                  {showAlt ? '다른 보이싱 닫기' : '다른 보이싱 보기'}
                </button>
                {Q4_IDS.has(curItem.chord!.quality) && (
                  <button type="button" className={styles.ghost} id="pp-open-matrix" onClick={() => onOpenMatrix(curItem.chord!.root, curItem.chord!.quality)}>
                    보이싱 매트릭스에서 열기
                  </button>
                )}
                {CT.ARP_Q.includes(curItem.chord!.quality) && (
                  <button type="button" className={styles.ghost} id="pp-open-tone" onClick={() => onOpenTone(curItem.chord!.root, curItem.chord!.quality)}>
                    코드톤 지도에서 열기
                  </button>
                )}
              </div>
              {showAlt && (
                <div className={`${styles.boxrow} ${styles.ppBoxes}`} id="pp-alts">
                  {alts.length === 0 && <p className={styles.note}>이 범위에는 다른 보이싱이 없어요.</p>}
                  {alts.map((v, i) => {
                    const sel = GE.fretStr(v) === GE.fretStr(curV);
                    return (
                      <figure
                        key={i}
                        className={`${styles.cell} ${sel ? styles.dsStepCardSel : ''}`}
                        data-alt={i}
                        onClick={() => {
                          setOverrides((o) => ({ ...o, [curK]: v }));
                          audioEngine.chord(pitchesOf(v.notes), audioEngine.now() + 0.02, 1.5);
                        }}
                      >
                        <ChordBoxSvg notes={geNotesToDiagram(v)} label={curItem.shown} />
                        <figcaption>
                          <span>{GE.fretStr(v)}</span>
                          <small>{KIND_TEXT[v.kind || 'compact']}</small>
                        </figcaption>
                      </figure>
                    );
                  })}
                </div>
              )}
            </>
          )}
          <p className={styles.note} id="pp-note-hint">
            연습실은 기타 지판 기준이에요.{' '}
            {prog.note ? (
              <>
                영상에서 온 진행이라 원본 노트에 영상 속 보이싱(건반 영상이면 건반 보이싱)이 있어요.{' '}
                <SafeLink id="pp-note-link" href={`note.html?id=${encodeURIComponent(prog.note)}`}>
                  원본 노트에서 보이싱 보기 →
                </SafeLink>
              </>
            ) : (
              '건반 영상에서 온 진행의 원본 건반 보이싱은 코드 진행 모음의 그 행에서 노트로 이어져요.'
            )}
          </p>
        </div>
      )}
    </div>
  );
}
