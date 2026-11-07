// CH-5: 붙여넣기 — 코드 사이트 텍스트 → 코드 줄 → 반복 구간 후보 → 하나 골라 직접 입력 폼으로 (CH-1a §2, 설계 §5-5)
import React, { useMemo, useState } from 'react';
import { extractChordLines, findRepeats } from '../../lib/chords/pasteParse.mts';
import type { RepeatCandidate } from '../../lib/chords/pasteParse.mts';
import styles from './Progressions.module.css';

export interface PastePanelProps {
  onPick: (chords: string[], part: string) => void;
}

type Group = { section?: string; symbols: string[] };

// 줄을 섹션별로 묶는다(섹션 머리가 없으면 한 묶음). x2 같은 반복 표시는 펼친다
function groupLines(text: string): Group[] {
  const groups: Group[] = [];
  for (const line of extractChordLines(text)) {
    let g = groups[groups.length - 1];
    if (!g || g.section !== line.section) {
      g = { section: line.section, symbols: [] };
      groups.push(g);
    }
    for (let r = 0; r < Math.max(1, line.repeat); r++) g.symbols.push(...line.symbols);
  }
  return groups;
}

export function PastePanel({ onPick }: PastePanelProps): React.ReactElement {
  const [text, setText] = useState('');
  const groups = useMemo(() => groupLines(text), [text]);
  const lineCount = useMemo(() => (text.trim() ? extractChordLines(text).length : 0), [text]);
  const candidates = useMemo(() => {
    const out: RepeatCandidate[] = [];
    for (const g of groups) out.push(...findRepeats(g.symbols, g.section));
    return out;
  }, [groups]);

  return (
    <div className={styles.editor} data-testid="pastePanel">
      <label className={styles.field}>
        <span className={styles.lab}>코드 사이트에서 복사한 텍스트</span>
        <textarea
          className={`inpField ${styles.pasteArea}`}
          id="pasteText"
          value={text}
          spellCheck={false}
          placeholder={'[Chorus]\nFM7   E7   Am7   Gm7 C7\n가사 줄은 자동으로 건너뜁니다'}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {text.trim() && (
        <p className="hint" id="pasteSummary">
          {lineCount ? `코드 줄 ${lineCount}개를 찾았어요. 반복 묶음을 골라 입력 폼으로 넘기세요.` : '코드만 적힌 줄을 찾지 못했어요. 코드 줄을 함께 복사했는지 확인해 주세요.'}
        </p>
      )}
      {candidates.length > 0 && (
        <ul className={styles.candidates} aria-label="진행 후보">
          {candidates.map((c, i) => {
            const label = c.repeats > 1 ? `${c.chords.length}코드 ×${c.repeats}` : `전체 순서 그대로 (${c.chords.length}코드)`;
            return (
              <li key={i} className={styles.candidate} data-candidate={i}>
                <div>
                  <div className={styles.candLabel}>
                    {c.section ? `${c.section}: ` : ''}
                    {label}
                  </div>
                  <div className={styles.candChords}>{c.chords.join(' - ')}</div>
                </div>
                <button type="button" className="ghostBtn" onClick={() => onPick(c.chords, c.section || '')}>
                  이 진행으로 입력
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
