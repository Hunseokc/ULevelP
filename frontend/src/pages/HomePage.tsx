// frontend/src/pages/HomePage.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../components/layout/AppShell';
import { SafeLink } from '../components/common/SafeLink';
import { GeminiKeyOnboardingModal } from '../components/common/GeminiKeyOnboardingModal';
import { useAuth } from '../lib/auth';
import { apiClient, CategoryDto, LocalSongRecord, NoteSummaryDto, ProgressionDto, ProgressionScope, SongDto } from '../lib/apiClient';
import { raw, safeUrl, thumb, videoIdFrom } from '../lib/security';
import {
  buildPracticeResumeHref,
  CHORD_MODES,
  computeWeeklyStreak,
  DEFAULT_ARCHIVE_PROGRESSIONS,
  DEFAULT_REFERENCE_PROGRESSIONS,
  formatRecentSongSegment,
  getLastChordTab,
  getLocalTodayStr,
} from '../lib/progressions';
import { chordLine, filterScope, KIND_LABEL, ORIGIN_LABEL, playHref, seedToDto } from '../components/progressions/model.mts';
import { pickRandom, tasteStats } from '../lib/chords/stats.mts';
import { CATEGORY_NAME_MAX, homeCategories, setOpenCategory } from '../lib/categories';
import styles from './HomePage.module.css';

// 홈 "취향 코드 진행 꺼내보기"(CH-6): 서버 진행 목록(없으면 기본 시드) + 범위 토글. 노트 화성 읽기·`편곡` 태그 규칙은 없앴다(설계 §8)
const PROG_SEEDS: ProgressionDto[] = [...DEFAULT_REFERENCE_PROGRESSIONS, ...DEFAULT_ARCHIVE_PROGRESSIONS].map(seedToDto);
const PROG_SCOPES: ReadonlyArray<readonly [ProgressionScope, string]> = [
  ['reference', '레퍼런스'],
  ['analysis', '분석'],
  ['all', '합산'],
];

// 최근 곡 위젯 아래 분류 바로가기 `ㅁ ㅁ ㅁ +`. +는 분류 추가·이름·삭제·홈 표시·순서 팝업 (서버 저장)
function CategoryShortcuts({ uid }: { uid: string | null }): React.ReactElement {
  const [list, setList] = useState<CategoryDto[]>([]);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const uidRef = useRef(uid);
  uidRef.current = uid;

  const reload = async (myUid: string) => {
    try {
      const next = await apiClient.categories.list();
      if (uidRef.current !== myUid) return;
      setList(next);
      setLoadState('ok');
    } catch {
      if (uidRef.current !== myUid) return;
      setLoadState('error');
    }
  };

  useEffect(() => {
    setList([]);
    setOpen(false);
    setErr('');
    if (!uid || !apiClient.isLoggedIn()) {
      setLoadState('idle');
      return;
    }
    setLoadState('loading');
    void reload(uid);
  }, [uid]);

  useEffect(() => {
    if (!open) {
      setEditId(null);
      setConfirmId(null);
      setErr('');
      return;
    }
    const handleDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const sorted = [...list].sort((a, b) => a.sortOrder - b.sortOrder);
  const shown = homeCategories(list);

  // 실패하면 문구를 보이고 서버 목록으로 되돌린다
  const run = async (job: () => Promise<void>) => {
    setErr('');
    try {
      await job();
    } catch (e: any) {
      setErr((e && e.message) || '저장하지 못했어요');
      if (uidRef.current) void reload(uidRef.current);
    }
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) {
      setErr('이름을 입력하세요');
      return;
    }
    void run(async () => {
      const created = await apiClient.categories.create(name);
      if (created) setList((prev) => [...prev, created]);
      setNewName('');
    });
  };

  const patchOne = (id: string, patch: { name?: string; onHome?: boolean }) => {
    setList((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    void run(async () => {
      const updated = await apiClient.categories.update(id, patch);
      if (updated) setList((prev) => prev.map((c) => (c.id === id ? updated : c)));
    });
  };

  const saveEdit = () => {
    if (!editId) return;
    const id = editId;
    const name = editName.trim();
    setEditId(null);
    const cur = list.find((c) => c.id === id);
    if (!name || !cur || cur.name === name) return;
    patchOne(id, { name });
  };

  const move = (idx: number, dir: -1 | 1) => {
    const to = idx + dir;
    if (to < 0 || to >= sorted.length) return;
    const next = [...sorted];
    [next[idx], next[to]] = [next[to], next[idx]];
    setList(next.map((c, i) => ({ ...c, sortOrder: i })));
    void run(async () => {
      setList(await apiClient.categories.reorder(next.map((c) => c.id)));
    });
  };

  const remove = (id: string) => {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setConfirmId(null);
    setList((prev) => prev.filter((c) => c.id !== id));
    void run(async () => {
      await apiClient.categories.remove(id);
    });
  };

  if (!uid) {
    return (
      <div className={styles.genreWrap}>
        <div className={styles.genreRow} id="categoryRow" aria-label="분류 바로가기" data-align-group="strip:bottom@821">
          <p className={`${styles.genreCell} ${styles.genreHint} ${styles.genreHintFull}`} id="categoryHint">
            로그인하면 곡을 분류할 수 있어요
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.genreWrap} ref={wrapRef}>
      <div className={styles.genreRow} id="categoryRow" aria-label="분류 바로가기" data-align-group="strip:bottom@821">
        {shown.map((c) => (
          <SafeLink
            key={c.id}
            href="practice.html"
            className={styles.genreCell}
            data-category={c.id}
            title={c.name}
            onClick={() => setOpenCategory(c.id)}
          >
            <span className={styles.genreName}>{c.name}</span>
          </SafeLink>
        ))}
        {loadState !== 'loading' && shown.length === 0 && (
          <p className={`${styles.genreCell} ${styles.genreHint}`} id="categoryHint">
            {loadState === 'error'
              ? '분류를 불러오지 못했어요'
              : list.length === 0
                ? '+를 눌러 분류를 만들어 보세요'
                : '홈에 보일 분류를 켜 주세요'}
          </p>
        )}
        <button
          type="button"
          className={`${styles.genreCell} ${styles.genreAdd}`}
          id="categorySettingsBtn"
          aria-label="분류 관리"
          aria-expanded={open}
          aria-controls="categorySettings"
          onClick={() => setOpen((v) => !v)}
        >
          +
        </button>
      </div>
      {open && (
        <div className={styles.genrePop} id="categorySettings" role="dialog" aria-label="분류 관리">
          <p className={styles.genrePopTitle}>분류 · 홈에 보일 것 · 순서</p>
          <form className={styles.genrePopAdd} onSubmit={add}>
            <input
              type="text"
              id="categoryNewName"
              className={styles.genrePopInput}
              value={newName}
              maxLength={CATEGORY_NAME_MAX}
              placeholder="새 분류 이름"
              aria-label="새 분류 이름"
              onChange={(e) => setNewName(e.target.value)}
            />
            <button type="submit" className={styles.genrePopBtn} id="categoryAddBtn">
              추가
            </button>
          </form>
          {err && (
            <p className={styles.genrePopErr} role="alert" id="categoryError">
              {err}
            </p>
          )}
          {sorted.length === 0 ? (
            <p className={styles.genrePopEmpty}>아직 분류가 없어요</p>
          ) : (
            <ul className={styles.genrePopList}>
              {sorted.map((c, idx) => (
                <li key={c.id} data-category={c.id}>
                  {editId === c.id ? (
                    <input
                      type="text"
                      className={styles.genrePopInput}
                      value={editName}
                      maxLength={CATEGORY_NAME_MAX}
                      aria-label="분류 이름"
                      autoFocus
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={saveEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          saveEdit();
                        } else if (e.key === 'Escape') {
                          // 팝업은 닫지 않고 이름 고치기만 취소
                          e.nativeEvent.stopImmediatePropagation();
                          e.stopPropagation();
                          setEditId(null);
                        }
                      }}
                    />
                  ) : (
                    <label className={styles.genrePopLabel} title={c.name}>
                      <input type="checkbox" checked={c.onHome} onChange={() => patchOne(c.id, { onHome: !c.onHome })} />
                      <span className={styles.genreName}>{c.name}</span>
                    </label>
                  )}
                  <button
                    type="button"
                    className={styles.genreMove}
                    aria-label={`${c.name} 이름 바꾸기`}
                    onClick={() => {
                      setEditId(c.id);
                      setEditName(c.name);
                    }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className={styles.genreMove}
                    aria-label={`${c.name} 위로`}
                    disabled={idx === 0}
                    onClick={() => move(idx, -1)}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className={styles.genreMove}
                    aria-label={`${c.name} 아래로`}
                    disabled={idx === sorted.length - 1}
                    onClick={() => move(idx, 1)}
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    className={`${styles.genreMove} ${confirmId === c.id ? styles.genreConfirm : ''}`}
                    aria-label={confirmId === c.id ? `${c.name} 삭제 확인` : `${c.name} 삭제`}
                    onClick={() => remove(c.id)}
                  >
                    {confirmId === c.id ? '삭제' : '×'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function HomePage(): React.ReactElement {
  const authState = useAuth();
  const activeUid = authState.user?.id ?? null;

  // 1. 유튜브 링크 빠른 시작 상태
  const [goUrl, setGoUrl] = useState('');
  const goUrlRef = useRef<HTMLInputElement | null>(null);

  // csp_check.js처럼 el.value 대입 후 native input 이벤트만 보내는 경우에도 상태를 맞춘다
  useEffect(() => {
    const el = goUrlRef.current;
    if (!el) return;
    const handleNativeInput = (e: Event) => {
      const target = e.target as HTMLInputElement | null;
      if (target && typeof target.value === 'string') {
        setGoUrl(target.value);
      }
    };
    el.addEventListener('input', handleNativeInput);
    return () => el.removeEventListener('input', handleNativeInput);
  }, []);
  const [geminiModalOpen, setGeminiModalOpen] = useState(false);
  const pickedVideoId = videoIdFrom(goUrl);
  const hasInvalidUrl = Boolean(goUrl.trim() && !pickedVideoId);

  const checkHasGeminiKey = (): boolean => {
    if (!apiClient.isLoggedIn()) return false;
    const cached = apiClient.getCachedKeys();
    if (cached && cached.gemini) return true;
    const me = authState.me;
    if (me && me.keys && me.keys.gemini) return true;
    return false;
  };

  // 2. 코드 연습실 마지막 탭
  const [lastTab] = useState<string>(() => getLastChordTab());

  // 3. 연습 곡, 주간 스트릭, 최근 노트, 코드 진행 상태
  const [songs, setSongs] = useState<SongDto[]>([]);
  const [songsLoading, setSongsLoading] = useState<boolean>(false);
  const [songsError, setSongsError] = useState<string>('');
  const [activeDates, setActiveDates] = useState<string[]>([]);
  const [localSongs, setLocalSongs] = useState<LocalSongRecord[]>(() => apiClient.listLocalSongs());
  const [recentNote, setRecentNote] = useState<NoteSummaryDto | null>(null);
  const [progAll, setProgAll] = useState<ProgressionDto[]>(PROG_SEEDS);
  const [progSeeded, setProgSeeded] = useState<boolean>(true);
  const [progScope, setProgScope] = useState<ProgressionScope>('reference');
  const [progPickId, setProgPickId] = useState<string | null>(null);

  const reqSeqRef = useRef(0);

  useEffect(() => {
    const mySeq = ++reqSeqRef.current;
    const myUid = activeUid;

    if (!myUid || !apiClient.isLoggedIn()) {
      const locals = apiClient.listLocalSongs();
      setLocalSongs(locals);
      setSongs([]);
      setSongsLoading(false);
      setSongsError('');
      setActiveDates(locals.map((it) => it.date || '').filter(Boolean));
      setRecentNote(null);
      setProgAll(PROG_SEEDS);
      setProgSeeded(true);
      setProgPickId(null);
      return;
    }

    setSongsLoading(true);
    setSongsError('');

    // 곡 목록 조회
    apiClient.songs
      .list()
      .then((list) => {
        if (reqSeqRef.current !== mySeq || activeUid !== myUid) return;
        setSongs(Array.isArray(list) ? list : []);
        setSongsLoading(false);
      })
      .catch((err: any) => {
        if (reqSeqRef.current !== mySeq || activeUid !== myUid) return;
        setSongs([]);
        setSongsLoading(false);
        setSongsError((err && err.message) || '곡 목록을 불러오지 못했어요');
      });

    // 세션 달력 조회 (주간 스트릭용)
    apiClient.sessions
      .list({ today: getLocalTodayStr() })
      .then((res) => {
        if (reqSeqRef.current !== mySeq || activeUid !== myUid) return;
        const calDates = (res?.calendar || [])
          .filter((d) => d && d.totalSeconds > 0)
          .map((d) => d.date);
        const sessDates = (res?.sessions || [])
          .filter((s) => s && s.seconds > 0)
          .map((s) => s.date);
        setActiveDates([...calDates, ...sessDates]);
      })
      .catch(() => {
        if (reqSeqRef.current !== mySeq || activeUid !== myUid) return;
        setActiveDates([]);
      });

    // 최근 학습 노트 조회
    apiClient.notes
      .list()
      .then((notes) => {
        if (reqSeqRef.current !== mySeq || activeUid !== myUid) return;
        const safeNotes = Array.isArray(notes) ? notes : [];
        setRecentNote(safeNotes[0] || null);
      })
      .catch(() => {
        if (reqSeqRef.current !== mySeq || activeUid !== myUid) return;
        setRecentNote(null);
      });

    // 코드 진행 목록 (취향 코드 진행). 하나도 없거나 실패하면 기본 시드
    apiClient.progressions
      .list()
      .then((list) => {
        if (reqSeqRef.current !== mySeq || activeUid !== myUid) return;
        const mine = Array.isArray(list) ? list : [];
        setProgAll(mine.length > 0 ? mine : PROG_SEEDS);
        setProgSeeded(mine.length === 0);
        setProgPickId(null);
      })
      .catch(() => {
        if (reqSeqRef.current !== mySeq || activeUid !== myUid) return;
        setProgAll(PROG_SEEDS);
        setProgSeeded(true);
        setProgPickId(null);
      });
  }, [activeUid]);

  // 주간 스트릭 계산 (로그인 시 세션 날짜 + 곡 lastDate 병합, 비로그인 시 로컬 날짜)
  const mergedDates = activeUid
    ? [...activeDates, ...songs.map((s) => s.lastDate || '').filter(Boolean)]
    : activeDates;
  const streak = computeWeeklyStreak(mergedDates);

  // 최근 연습 곡 결정
  const recentSong: {
    videoId: string;
    title: string;
    a: number | null;
    b: number | null;
    pos: number | null;
    rate: number | null;
  } | null = activeUid
    ? songs[0]
      ? {
          videoId: songs[0].videoId,
          title: songs[0].title,
          a: songs[0].a,
          b: songs[0].b,
          pos: songs[0].pos,
          rate: songs[0].rate,
        }
      : null
    : localSongs[0]
      ? {
          videoId: localSongs[0].videoId,
          title: `최근 기기 연습 영상 (${localSongs[0].videoId})`,
          a: localSongs[0].a,
          b: localSongs[0].b,
          pos: localSongs[0].pos,
          rate: localSongs[0].rate,
        }
      : null;

  // 노션 바로가기 링크 — 노션 연동은 동결·은닉(계획/앱_명세.md §5). 설정 고급 메뉴에 주소를 넣은 사용자에게만 보인다
  const nlPracticeUrl = safeUrl(raw.get('ulp:notion-practice'));
  const nlNotesUrl = safeUrl(raw.get('ulp:notion-notes'));
  const mainNotionUrl = nlPracticeUrl || nlNotesUrl;

  const progInScope = useMemo(() => filterScope(progAll, progScope), [progAll, progScope]);
  const progStats = useMemo(() => tasteStats(progInScope), [progInScope]);
  const progCurrent = progInScope.find((p) => p.id === progPickId) || progInScope[0] || null;
  const progScopeLabel = PROG_SCOPES.find(([s]) => s === progScope)?.[1] || '';
  const progTasteTop = progStats.patterns[0] || progStats.moves[0] || null;
  const progTasteKind = progStats.patterns[0] ? '자주 나오는 진행' : progStats.moves[0] ? '가장 많은 코드 이동' : '';
  const progTasteHref = 'progressions.html' + (progScope === 'reference' ? '' : '?scope=' + progScope) + '#progTaste';

  // 빈 상태에서만 CHORDS·PLAYER 목록 아랫선을 맞춘다(안내 칸이 높이를 채움) — 프론트_정렬규격.md §3
  const songsEmpty = !activeUid || songs.length === 0;

  const handleGoSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pickedVideoId) {
      window.location.href = 'practice.html?v=' + encodeURIComponent(pickedVideoId);
    }
  };

  return (
    <AppShell variant="default" activeNav="home">
      <div className={styles.hero}>
        <h1 className={`wordmark ${styles.wordmark}`}>ULeveLP</h1>
        <hr className={`home-rule ${styles.homeRule}`} />
        <p className={`tagline ${styles.tagline}`}>DIVE INTO SOUND</p>

        <form className={`go ${styles.goForm}`} id="go" onSubmit={handleGoSubmit}>
          <input
            className="inpField"
            id="goUrl"
            ref={goUrlRef}
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="유튜브 링크를 붙여넣으세요"
            aria-label="유튜브 링크"
            value={goUrl}
            onChange={(e) => setGoUrl(e.target.value)}
          />
          <div className={`go-pick ${styles.goPick}`} id="goPick" hidden={!pickedVideoId}>
            <img
              id="goThumb"
              className={styles.goThumb}
              src={pickedVideoId ? thumb(pickedVideoId) : undefined}
              alt=""
            />
            <div className={`acts ${styles.goActs}`}>
              <SafeLink
                className="pillBtn"
                id="goPlay"
                href={pickedVideoId ? 'practice.html?v=' + encodeURIComponent(pickedVideoId) : 'practice.html'}
              >
                ▶ 바로 연습
              </SafeLink>
              <SafeLink
                className="ghostBtn"
                id="goNote"
                onClick={(e) => {
                  if (apiClient.isLoggedIn() && !checkHasGeminiKey()) {
                    e.preventDefault();
                    setGeminiModalOpen(true);
                  }
                }}
                href={
                  pickedVideoId
                    ? 'notes.html?url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + pickedVideoId)
                    : 'notes.html'
                }
              >
                노트 만들기
              </SafeLink>
            </div>
          </div>
          <p className={`msg${hasInvalidUrl ? ' err' : ''}`} id="goMsg" role="status">
            {hasInvalidUrl ? '유튜브 영상 링크가 아니에요' : ''}
          </p>
        </form>
      </div>

      {/* 상단 연속성 위젯: 주간 스트릭(Mo~Su)·작심삼일 + 가장 최근 연습했던 곡 */}
      <section className={styles.topWidgets} aria-label="연습 연속성 대시보드">
        <div className={styles.widgetCard} id="weeklyStreakCard" data-align-group="top1:top,bottom@821">
          <div className={styles.widgetHead}>
            <h2 className={styles.widgetTitle}>WEEKLY STREAK</h2>
            <SafeLink href="log.html" className={styles.widgetLink}>
              기록 보기 →
            </SafeLink>
          </div>
          <div className={styles.streakGrid} id="streakDays">
            {streak.days.map((d) => (
              <div
                key={d.dateStr}
                className={`${styles.streakCell} ${d.practiced ? styles.streakCellDone : ''} ${
                  d.isToday ? styles.streakCellToday : ''
                }`}
                data-date={d.dateStr}
                data-practiced={d.practiced ? '1' : '0'}
              >
                <span className={styles.dowText}>{d.dowLabel}</span>
                <span className={styles.dayNum}>{d.dayNumber}</span>
              </div>
            ))}
          </div>
          <SafeLink
            href="log.html"
            className={styles.streakBar}
            id="streakChallengeBar"
            data-align-group="strip:bottom@821"
          >
            <span id="streakChallengeText">{streak.challengeText}</span>
            <span className={styles.streakDots} aria-hidden="true">
              {[1, 2, 3].map((step) => (
                <i
                  key={step}
                  className={`${styles.streakDot} ${streak.cycleStep >= step ? styles.streakDotOn : ''}`}
                />
              ))}
            </span>
          </SafeLink>
        </div>

        <div className={styles.widgetCard} id="recentSongCard" data-align-group="top1:top,bottom@821">
          <div className={styles.widgetHead}>
            <h2 className={styles.widgetTitle}>가장 최근 연습했던 곡</h2>
            {recentSong && (
              <SafeLink
                href={buildPracticeResumeHref(recentSong)}
                className={styles.widgetLink}
                id="recentSongGo"
              >
                (바로가기)
              </SafeLink>
            )}
          </div>
          {recentSong ? (
            <div className={styles.recentBody} id="recentSongBody">
              <img
                id="recentSongThumb"
                className={styles.recentThumb}
                data-align-group="songBody:top"
                src={thumb(recentSong.videoId)}
                alt=""
              />
              <div className={styles.recentInfo} data-align-group="songBody:top; songText:left">
                <p
                  className={styles.recentSongTitle}
                  id="recentSongTitle"
                  data-layout-ignore="G3: 최근 곡 제목은 한 줄 말줄임(카드 높이 고정)"
                >
                  {recentSong.title}
                </p>
                <p className={styles.recentSegment} id="recentSongSegment">
                  {formatRecentSongSegment(recentSong)}
                </p>
                <SafeLink
                  href={buildPracticeResumeHref(recentSong)}
                  className={styles.widgetLink}
                  data-align-group="songText:left"
                >
                  ▶ 이어서 구간 연습하기 →
                </SafeLink>
              </div>
            </div>
          ) : (
            <div className={styles.recentBody} id="recentSongEmpty">
              <div className={styles.recentPlaceholder} data-align-group="songEmpty:top">
                NO SONG
              </div>
              <div className={styles.recentInfo} data-align-group="songEmpty:top">
                <p className={styles.emptyText}>
                  아직 연습 중인 곡이 없어요. 위 입력창에 유튜브 링크를 붙여넣어 시작하세요.
                </p>
              </div>
            </div>
          )}
          <CategoryShortcuts uid={activeUid} />
        </div>
      </section>

      {/* 하단 메인 분할 대시보드: 좌측 BETTER (연습실) | 우측 VAULT (학습) */}
      <div className={`frames ${styles.splitFrames}`}>
        <section
          className={`frame ${styles.frame}`}
          id="betterFrame"
          aria-labelledby="fBetter"
          data-align-group="frames:top,bottom@821"
        >
          <div className={`frame-head ${styles.frameHead}`}>
            <h2 id="fBetter">BETTER</h2>
            <span>연습실</span>
          </div>

          <div className={styles.betterCols}>
            <div className={styles.subCol} data-align-group="chordsCol:center-x">
              <div className={styles.subColHead}>
                <h3 className={styles.subColTitle}>CHORDS · 7가지 연습 모드</h3>
              </div>
              <ul
                className={`frame-list ${styles.frameList}`}
                id="modes"
                data-align-group={songsEmpty ? 'player:bottom@821' : undefined}
              >
                {CHORD_MODES.map(([id, name], idx) => {
                  const isCur = id === lastTab;
                  return (
                    <li key={id} className={isCur ? `cur ${styles.curItem}` : undefined}>
                      <SafeLink href={`chords.html#${encodeURIComponent(id)}`}>
                        <span className={`t ${styles.itemTitle}`}>
                          {idx + 1} · {name}
                        </span>
                        <span className={`m ${styles.itemMeta}`}>{isCur ? '이어서' : ''}</span>
                      </SafeLink>
                    </li>
                  );
                })}
              </ul>
              <div className={styles.subColAction}>
                <SafeLink
                  className={styles.sectionBtn}
                  id="betterChordsBtn"
                  href="chords.html"
                  data-align-group="btns:height,bottom@821; chordsCol:center-x; vaultBtm:bottom@821"
                >
                  코드 연습실
                </SafeLink>
              </div>
            </div>

            <div className={styles.subCol} data-align-group="playerCol:center-x">
              <div className={styles.subColHead}>
                <h3 className={styles.subColTitle}>PLAYER · 내 연습 곡</h3>
                <SafeLink href="log.html#songs" className={styles.widgetLink}>
                  곡 보관함 →
                </SafeLink>
              </div>
              <ul
                className={`frame-list ${styles.frameList}`}
                id="songs"
                data-align-group={songsEmpty ? 'player:bottom@821' : undefined}
              >
                {!activeUid ? (
                  <li className={`note ${styles.noteItem}`}>
                    로그인하면 내 연습 곡이 여기 보여요.
                    <SafeLink href="settings.html#account">로그인하러 가기 →</SafeLink>
                  </li>
                ) : songsLoading ? (
                  <li className={`note ${styles.noteItem}`}>불러오는 중…</li>
                ) : songsError ? (
                  <li className={`note ${styles.noteItem}`}>{songsError}</li>
                ) : songs.length === 0 ? (
                  <li className={`note ${styles.noteItem}`}>
                    아직 곡이 없어요. 위에 유튜브 링크를 붙여넣어 시작하세요.
                  </li>
                ) : (
                  songs.slice(0, 5).map((s) => {
                    const meta = [
                      s.status,
                      s.rate ? `${s.rate}×` : '',
                      s.lastDate ? s.lastDate.slice(5).replace('-', '/') : '',
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <li key={s.id}>
                        <SafeLink href={`practice.html?v=${encodeURIComponent(s.videoId)}`}>
                          <span
                            className={`t ${styles.itemTitle}`}
                            data-layout-ignore="G3: 곡 목록 제목은 한 줄 말줄임(목록 줄 높이 고정)"
                          >
                            {s.title}
                          </span>
                          <span className={`m ${styles.itemMeta}`}>{meta}</span>
                        </SafeLink>
                      </li>
                    );
                  })
                )}
              </ul>
              <div className={styles.subColAction}>
                <SafeLink
                  className={styles.sectionBtn}
                  id="betterPlayerBtn"
                  href="practice.html"
                  data-align-group="btns:height,bottom@821; playerCol:center-x"
                >
                  플레이어
                </SafeLink>
              </div>
            </div>
          </div>
        </section>

        <section
          className={`frame ${styles.frame}`}
          id="vaultFrame"
          aria-labelledby="fVault"
          data-align-group="frames:top,bottom@821"
        >
          <div className={`frame-head ${styles.frameHead}`}>
            <h2 id="fVault">VAULT</h2>
            <span>학습</span>
          </div>

          <div className={styles.vaultSection} id="recentNoteCard">
            <div className={styles.subColHead}>
              <h3 className={styles.subColTitle}>최근 공부한 내용</h3>
              <SafeLink href="notes.html" className={styles.widgetLink}>
                전체 노트 →
              </SafeLink>
            </div>
            {recentNote ? (
              <div className={styles.noteBox} id="recentNoteBody">
                <img
                  className={styles.noteThumb}
                  data-align-group="noteBody:top"
                  src={thumb(recentNote.videoId)}
                  alt=""
                />
                <div className={styles.noteBoxBody} data-align-group="noteBody:top; noteText:left">
                  <p
                    className={styles.noteBoxTitle}
                    id="recentNoteTitle"
                    data-layout-ignore="G3: 최근 노트 제목은 한 줄 말줄임(카드 높이 고정)"
                  >
                    {recentNote.title || '(제목 없음)'}
                  </p>
                  <p
                    className={styles.noteBoxSummary}
                    id="recentNoteHeadline"
                    data-layout-ignore="G3: 최근 노트 요약은 한 줄 말줄임(카드 높이 고정)"
                  >
                    {recentNote.headline || recentNote.channel || '핵심 요약 노트'}
                  </p>
                  <div className={styles.noteBoxFoot}>
                    <SafeLink
                      href={`note.html?id=${encodeURIComponent(recentNote.id)}`}
                      className={styles.widgetLink}
                      id="recentNoteLink"
                      data-align-group="noteText:left"
                    >
                      확인하기 →
                    </SafeLink>
                  </div>
                </div>
              </div>
            ) : (
              <div className={styles.noteBox} id="recentNoteEmpty">
                <div className={styles.recentPlaceholder} data-align-group="noteEmpty:top">
                  NO NOTE
                </div>
                <div className={styles.noteBoxBody} data-align-group="noteEmpty:top; noteEmptyText:left">
                  <p className={`${styles.noteBoxSummary} ${styles.wrapText}`}>아직 생성한 학습 노트가 없어요.</p>
                  <div className={styles.noteBoxFoot}>
                    <SafeLink href="notes.html" className={styles.widgetLink} data-align-group="noteEmptyText:left">
                      노트 만들러 가기 →
                    </SafeLink>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className={`${styles.vaultSection} ${styles.vaultSectionGrow}`} id="progressionPickerSection">
            <div className={styles.subColHead}>
              <h3 className={styles.subColTitle}>취향 코드 진행 꺼내보기</h3>
              <SafeLink href="progressions.html" className={styles.widgetLink}>
                코드 진행 모음 →
              </SafeLink>
            </div>
            <div className={styles.progScopeRow} id="progScope" role="group" aria-label="진행 범위">
              {PROG_SCOPES.map(([s, label]) => (
                <button
                  key={s}
                  type="button"
                  className={`${styles.progScopeBtn} ${progScope === s ? styles.progScopeBtnOn : ''}`}
                  aria-pressed={progScope === s}
                  data-scope={s}
                  onClick={() => {
                    setProgScope(s);
                    setProgPickId(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className={styles.progGrid}>
              <div className={styles.progCard} id="progRefBox" data-align-group="prog:top,bottom@821; vaultBtm:bottom@821">
                <div className={styles.progHead}>
                  <span className={styles.progBadge}>{progCurrent ? KIND_LABEL[progCurrent.kind] : progScopeLabel}</span>
                  <span className={styles.progKey} id="progRefKey">
                    {progCurrent ? progCurrent.key || '키 없음' : ''}
                  </span>
                </div>
                {progCurrent ? (
                  <>
                    <SafeLink href={playHref(progCurrent)} className={styles.progChordsLink} id="progRefChords">
                      {chordLine(progCurrent)}
                    </SafeLink>
                    <p className={styles.progSub} id="progRefTitle">
                      {progCurrent.title || '(제목 없음)'}
                      <span className={styles.progSource}>
                        출처: {progSeeded ? '기본' : ORIGIN_LABEL[progCurrent.origin] || progCurrent.origin}
                      </span>
                    </p>
                    <div className={styles.progActs}>
                      <button
                        type="button"
                        className={styles.randBtn}
                        id="btnRandRef"
                        disabled={progInScope.length < 2}
                        onClick={() => {
                          const next = pickRandom(progInScope, progCurrent.id);
                          setProgPickId(next ? next.id : null);
                        }}
                      >
                        # 랜덤으로 보여주기
                      </button>
                      <SafeLink href={playHref(progCurrent)} className={styles.randBtn} id="progRefPlay">
                        연주하기
                      </SafeLink>
                    </div>
                  </>
                ) : (
                  <>
                    <p className={styles.progSub} id="progRefTitle">
                      {progScopeLabel} 범위에 모은 진행이 없어요.
                    </p>
                    <div className={styles.progActs}>
                      <SafeLink href="progressions.html" className={styles.randBtn} id="btnRandRef">
                        진행 넣으러 가기
                      </SafeLink>
                    </div>
                  </>
                )}
              </div>

              <div className={styles.progCard} id="progArchBox" data-align-group="prog:top,bottom@821">
                <div className={styles.progHead}>
                  <span className={styles.progBadge}>취향</span>
                  <span className={styles.progKey} id="progArchKey">
                    진행 {progStats.total}개
                  </span>
                </div>
                <SafeLink href={progTasteHref} className={styles.progChordsLink} id="progArchChords">
                  {progTasteTop ? progTasteTop.label : '아직 겹치는 진행이 없어요'}
                </SafeLink>
                <p className={styles.progSub} id="progArchTitle">
                  {progTasteTop ? `${progTasteKind} · ${progTasteTop.count}번` : '진행이 쌓이면 자주 쓰는 진행이 보여요'}
                  <span className={styles.progSource}>
                    많이 쓴 키: {progStats.keys[0] ? progStats.keys[0].label : '—'}
                  </span>
                </p>
                <div className={styles.progActs}>
                  <SafeLink href={progTasteHref} className={styles.randBtn} id="progTasteLink">
                    취향 통계 보기
                  </SafeLink>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <SafeLink
        className={`notion-big ${styles.notionBig}`}
        id="notionBig"
        href={mainNotionUrl || '#'}
        external={Boolean(mainNotionUrl)}
        hidden={!mainNotionUrl}
      >
        NOTION
      </SafeLink>
      <div
        className={`notion-links ${styles.notionLinks}`}
        id="notionLinks"
        hidden={!nlPracticeUrl && !nlNotesUrl}
      >
        <SafeLink id="nlPractice" href={nlPracticeUrl || 'settings.html#links'} external={Boolean(nlPracticeUrl)} hidden={!nlPracticeUrl}>
          악기 연습 ↗
        </SafeLink>
        <SafeLink id="nlNotes" href={nlNotesUrl || 'settings.html#links'} external={Boolean(nlNotesUrl)} hidden={!nlNotesUrl}>
          학습 영상 노트 ↗
        </SafeLink>
      </div>

      <footer className={`home-foot ${styles.homeFoot}`}>
        <span>DAILY DIARY</span>
        <SafeLink href="privacy.html">PRIVACY</SafeLink>
        <span id="copy">©{new Date().getFullYear()}</span>
      </footer>

      <GeminiKeyOnboardingModal
        open={geminiModalOpen}
        onClose={() => setGeminiModalOpen(false)}
        onSaved={() => {
          setGeminiModalOpen(false);
          const target = pickedVideoId
            ? 'notes.html?url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + pickedVideoId)
            : 'notes.html';
          window.location.href = target;
        }}
      />
    </AppShell>
  );
}

export default HomePage;

