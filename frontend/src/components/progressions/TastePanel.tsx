// CH-6: CHORDS 오른쪽 "취향 코드 진행" — 랜덤 꺼내보기(연주하기) + 자주 나오는 진행·코드 이동·코드 빈도·키·Mood·Genre
// 통계는 지금 범위(레퍼런스·분석·합산)의 목록으로 매번 계산한다(stats.mts)
import React, { useMemo, useState } from 'react';
import { SafeLink } from '../common/SafeLink';
import type { ProgressionDto } from '../../lib/apiClient';
import { pickRandom, tasteStats, top } from '../../lib/chords/stats.mts';
import type { Counted } from '../../lib/chords/stats.mts';
import { chordLine, playHref, romanLine } from './model.mts';
import styles from './Progressions.module.css';

export interface TastePanelProps {
  list: ProgressionDto[]; // 범위로 거른 목록(검색은 반영하지 않음)
  scopeLabel: string;
  filter?: string; // 지금 목록을 거르고 있는 통계 줄(자주 나오는 진행·코드 이동)
  onFilter?: (label: string) => void; // 줄을 누르면 그 묶음이 든 진행만 목록에(같은 줄을 다시 누르면 해제 — 페이지가 정함)
}

type CountListProps = { id: string; title: string; items: Counted[]; empty: string; active?: string; onPick?: (label: string) => void };

function CountList({ id, title, items, empty, active, onPick }: CountListProps): React.ReactElement {
  return (
    <section className={styles.tasteBlock} id={id}>
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="hint">{empty}</p>
      ) : (
        <ol className={styles.tasteList}>
          {items.map((it) => (
            <li key={it.label}>
              {onPick ? (
                <button
                  type="button"
                  className={styles.tastePickBtn}
                  aria-pressed={active === it.label}
                  title="이 묶음이 들어 있는 진행만 목록에 보기"
                  onClick={() => onPick(it.label)}
                >
                  <span className={styles.tasteLabel}>{it.label}</span>
                  <span className={styles.tasteCount}>{it.count}</span>
                </button>
              ) : (
                <>
                  <span className={styles.tasteLabel}>{it.label}</span>
                  <span className={styles.tasteCount}>{it.count}</span>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function TastePanel({ list, scopeLabel, filter, onFilter }: TastePanelProps): React.ReactElement {
  const stats = useMemo(() => tasteStats(list), [list]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const picked = list.find((p) => p.id === pickedId) || null;

  const draw = () => {
    const next = pickRandom(list, pickedId);
    setPickedId(next ? next.id : null);
  };

  if (list.length === 0) {
    return <p className="hint">{scopeLabel} 범위에 모은 진행이 없어요. 진행이 쌓이면 자주 쓰는 진행·코드 이동·키 분포가 여기에 생겨요.</p>;
  }

  const roman = picked ? romanLine(picked) : '';
  return (
    <>
      <p className={styles.tasteMeta} id="tasteSummary">
        {scopeLabel} · 진행 {stats.total}개 · 코드 {stats.chordTotal}개
      </p>

      <section className={styles.tastePick} id="tastePick">
        {picked ? (
          <>
            <div className={styles.rowTitle} id="tastePickTitle">
              {picked.title || '(제목 없음)'}
              {picked.key ? <span className={styles.rowMeta}> · {picked.key}</span> : null}
            </div>
            <div className={styles.rowChords} id="tastePickChords">
              {chordLine(picked)}
            </div>
            {roman && <div className={styles.rowRoman}>{roman}</div>}
            <div className={styles.rowActs}>
              <SafeLink href={playHref(picked)} className="pillBtn" id="tastePlay">
                연주하기
              </SafeLink>
              <button type="button" className="ghostBtn" id="tasteRand" onClick={draw}>
                다시 꺼내기
              </button>
            </div>
          </>
        ) : (
          <div className={styles.rowActs}>
            <button type="button" className="pillBtn" id="tasteRand" onClick={draw}>
              랜덤으로 꺼내보기
            </button>
          </div>
        )}
      </section>

      <CountList id="tastePatterns" title="자주 나오는 진행" items={top(stats.patterns)} empty="2곡 이상에 함께 나온 3~4코드 묶음이 아직 없어요." active={filter} onPick={onFilter} />
      <CountList id="tasteMoves" title="코드 이동" items={top(stats.moves)} empty="이동이 없어요." active={filter} onPick={onFilter} />
      <CountList id="tasteChords" title="코드 빈도" items={top(stats.chords, 8)} empty="코드가 없어요." />
      <CountList id="tasteKeys" title="키 분포" items={top(stats.keys)} empty="키가 적힌 진행이 없어요." />
      {stats.moods.length > 0 && <CountList id="tasteMoods" title="Mood" items={top(stats.moods)} empty="" />}
      {stats.genres.length > 0 && <CountList id="tasteGenres" title="Genre" items={top(stats.genres)} empty="" />}
    </>
  );
}
