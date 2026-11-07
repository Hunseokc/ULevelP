// frontend/src/pages/LogPage.tsx
import React, { useEffect, useRef, useState } from 'react';
import { AppShell } from '../components/layout/AppShell';
import { SafeAudio } from '../components/common/SafeAudio';
import { SafeLink } from '../components/common/SafeLink';
import { auth, useAuth } from '../lib/auth';
import {
  apiClient,
  SessionListResponse,
  SessionWithSongDto,
  SongDetailResponse,
  SongDto,
  TakeDto,
} from '../lib/apiClient';
import { drive } from '../lib/drive';
import { safeAudioUrl, safeUrl } from '../lib/security';
import styles from './LogPage.module.css';

export function getLogTodayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function build84Days(baseDateStr: string): string[] {
  const parts = baseDateStr.split('-').map(Number);
  const base = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
  const arr: string[] = [];
  for (let i = 83; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    arr.push(`${y}-${m}-${day}`);
  }
  return arr;
}

export function fmtDuration(sec?: number | null): string {
  const n = Number(sec) || 0;
  if (n <= 0) return '0분';
  if (n < 60) return `${n}초`;
  if (n < 3600) return `${Math.round(n / 60)}분`;
  const h = Math.floor(n / 3600);
  const m = Math.round((n % 3600) / 60);
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
}

export function fmtTakeMeta(take: TakeDto): string {
  let timeStr = '';
  if (take.recordedAt) {
    try {
      const d = new Date(take.recordedAt);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      timeStr = `${hh}:${mm}`;
    } catch {
      timeStr = '';
    }
  }
  let res = timeStr ? `${timeStr} · ` : '';
  res += `${take.durationSec || 0}초`;
  if (take.rate != null) {
    res += ` · ${take.rate}×`;
  }
  return res;
}

export function sortAbTakes(t1: TakeDto, t2: TakeDto): [TakeDto, TakeDto] {
  return t1.recordedAt > t2.recordedAt ? [t2, t1] : [t1, t2];
}

// 개별 테이크 행 컴포넌트 (다른 테이크/세션의 미저장 입력 및 오디오 상태 보존)
interface TakeItemRowProps {
  take: TakeDto;
  showAbCheck?: boolean;
  abChecked?: boolean;
  onToggleAb?: (takeId: string, checked: boolean) => void;
  onDeleted: (takeId: string) => void;
}

function TakeItemRow({
  take,
  showAbCheck = false,
  abChecked = false,
  onToggleAb,
  onDeleted,
}: TakeItemRowProps): React.ReactElement {
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [audioVisible, setAudioVisible] = useState(false);
  const [loadingPlay, setLoadingPlay] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [rowMsg, setRowMsg] = useState('');

  const handlePlay = async () => {
    if (audioUrl) {
      setAudioVisible(true);
      return;
    }
    setLoadingPlay(true);
    if (take.storage === 'drive') {
      setRowMsg('드라이브에서 음원 로드 중...');
      try {
        const blobUrl = await drive.fetchMediaObjectUrl(take.storageKey);
        const valid = safeAudioUrl(blobUrl);
        if (valid) {
          setAudioUrl(valid);
          setAudioVisible(true);
          setRowMsg('');
        } else {
          setRowMsg('주소 발급 실패');
        }
      } catch (err: any) {
        setRowMsg((err && err.message) || '재생 실패');
      } finally {
        setLoadingPlay(false);
      }
      return;
    }

    setRowMsg('주소 요청 중...');
    try {
      const r = await apiClient.takes.getUrl(take.id);
      const valid = r && r.url ? safeAudioUrl(r.url) : '';
      if (valid) {
        setAudioUrl(valid);
        setAudioVisible(true);
        setRowMsg('');
      } else {
        setAudioUrl('');
        setAudioVisible(true);
        setRowMsg('주소 발급 실패');
      }
    } catch (err: any) {
      setRowMsg((err && err.message) || '재생 실패');
    } finally {
      setLoadingPlay(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('이 녹음을 삭제할까요?')) return;
    setDeleting(true);
    try {
      await apiClient.takes.remove(take.id);
      setAudioUrl('');
      setAudioVisible(false);
      onDeleted(take.id);
    } catch (err: any) {
      window.alert((err && err.message) || '녹음 삭제에 실패했어요');
      setDeleting(false);
    }
  };

  return (
    <div className={`take-row ${styles.takeRow}`}>
      {showAbCheck && (
        <label className={`check ${styles.checkLabel}`}>
          <input
            type="checkbox"
            className="ab-check"
            data-take-id={take.id}
            checked={abChecked}
            onChange={(e) => onToggleAb && onToggleAb(take.id, e.target.checked)}
          />
          <span>비교 선택</span>
        </label>
      )}
      <span className={`take-meta ${styles.takeMeta}`}>🎙 {fmtTakeMeta(take)}</span>
      <button
        type="button"
        className={`ghost mini ${styles.ghostMini}`}
        disabled={loadingPlay}
        onClick={() => void handlePlay()}
      >
        ▶ 듣기
      </button>
      <button
        type="button"
        className={`ghost mini ${styles.ghostMini}`}
        disabled={deleting}
        onClick={() => void handleDelete()}
      >
        삭제
      </button>
      <span className={`meta ${styles.meta}`}>{rowMsg}</span>
      <SafeAudio
        className={styles.takeAudio}
        srcUrl={audioUrl}
        takeId={take.id}
        preload="none"
        hidden={!audioVisible}
      />
    </div>
  );
}

// 개별 세션 카드 컴포넌트 (미저장 메모 격리)
interface SessionCardItemProps {
  session: SessionWithSongDto;
  onTakeRemoved: (sessionId: string, takeId: string) => void;
  onMemoSaved: (sessionId: string, memo: string) => void;
}

function SessionCardItem({ session, onTakeRemoved, onMemoSaved }: SessionCardItemProps): React.ReactElement {
  const [memoVal, setMemoVal] = useState(session.memo || '');
  const [savingMemo, setSavingMemo] = useState(false);
  const [memoStatus, setMemoStatus] = useState('');

  const titleText = `${session.songTitle || '제목 없는 곡'}${session.songArtist ? ' · ' + session.songArtist : ''}`;
  let metaText = `${session.minutes}분 (${session.seconds}초) · 반복 ${session.loops}회`;
  if (session.segment) metaText += ` · 구간 ${session.segment}`;
  if (session.rate != null) metaText += ` · ${session.rate}×`;

  return (
    <div className={`card session-card ${styles.card}`}>
      <div className={`session-head ${styles.sessionHead}`}>
        <div className={`session-title ${styles.sessionTitle}`}>{titleText}</div>
        <SafeLink
          className={`ghost mini ${styles.ghostMini}`}
          href={`practice.html?v=${encodeURIComponent(session.videoId || '')}`}
        >
          ▶ 연습
        </SafeLink>
      </div>
      <div className={`meta ${styles.meta}`}>{metaText}</div>
      <div className={`session-memo ${styles.sessionMemo}`}>
        <textarea
          className="inpField"
          rows={2}
          maxLength={2000}
          placeholder="세션 메모를 남겨보세요"
          value={memoVal}
          onChange={(e) => setMemoVal(e.target.value)}
        />
        <div className={`session-memo-act ${styles.sessionMemoAct}`}>
          <button
            type="button"
            className={`ghost mini ${styles.ghostMini}`}
            disabled={savingMemo}
            onClick={async () => {
              setSavingMemo(true);
              setMemoStatus('저장 중...');
              try {
                await apiClient.sessions.updateMemo(session.id, memoVal);
                onMemoSaved(session.id, memoVal.trim());
                setMemoStatus('저장됨');
                setTimeout(() => {
                  setMemoStatus((cur) => (cur === '저장됨' ? '' : cur));
                }, 2000);
              } catch (err: any) {
                setMemoStatus((err && err.message) || '저장 실패');
              } finally {
                setSavingMemo(false);
              }
            }}
          >
            메모 저장
          </button>
          <span className={`meta ${styles.meta}`}>{memoStatus}</span>
        </div>
      </div>
      {Array.isArray(session.takes) && session.takes.length > 0 && (
        <div className={`session-takes ${styles.sessionTakes}`}>
          {session.takes.map((t) => (
            <TakeItemRow
              key={t.id}
              take={t}
              onDeleted={(takeId) => onTakeRemoved(session.id, takeId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// 개별 곡 카드 컴포넌트 (미저장 메모 격리)
interface SongCardItemProps {
  song: SongDto;
  onOpenDetail: (songId: string) => void;
  onUpdated: (updated: SongDto) => void;
  onRemoved: (songId: string) => void;
}

function SongCardItem({ song, onOpenDetail, onUpdated, onRemoved }: SongCardItemProps): React.ReactElement {
  const [statusVal, setStatusVal] = useState(song.statusCode || 'practicing');
  const [memoVal, setMemoVal] = useState(song.memo || '');
  const [busyStatus, setBusyStatus] = useState(false);
  const [busyMemo, setBusyMemo] = useState(false);
  const [memoBtnText, setMemoBtnText] = useState('메모 저장');
  const [busyDel, setBusyDel] = useState(false);

  const safeResumeHref =
    (song.resumeUrl ? safeUrl(song.resumeUrl) : '') || `practice.html?v=${encodeURIComponent(song.videoId || '')}`;

  return (
    <div className={`card song-card ${styles.card}`}>
      <div className={`song-card-head ${styles.songCardHead}`}>
        <a
          className={`song-detail-link ${styles.songDetailLink}`}
          href={`log.html?song=${encodeURIComponent(song.id)}`}
          onClick={(e) => {
            e.preventDefault();
            onOpenDetail(song.id);
          }}
        >
          <b>{song.title}</b>
          {song.artist && <span className={`meta ${styles.meta}`}> · {song.artist}</span>}
        </a>
        <SafeLink className={`ghost mini ${styles.ghostMini}`} href={safeResumeHref}>
          ▶ 이어서 연습
        </SafeLink>
      </div>
      <div className={`meta ${styles.meta}`}>
        누적 {fmtDuration(song.totalSeconds)}
        {song.lastDate ? ` · 최근 연습 ${song.lastDate}` : ' · 연습 기록 없음'}
      </div>
      <div className={`song-card-edit ${styles.songCardEdit}`}>
        <select
          className={styles.selectPill}
          aria-label="곡 상태"
          value={statusVal}
          disabled={busyStatus}
          onChange={async (e) => {
            const nextStatus = e.target.value;
            setStatusVal(nextStatus);
            setBusyStatus(true);
            try {
              const updated = await apiClient.songs.update(song.id, { status: nextStatus });
              if (updated) onUpdated(updated);
            } catch (err: any) {
              window.alert((err && err.message) || '상태 변경에 실패했어요');
              setStatusVal(song.statusCode || 'practicing');
            } finally {
              setBusyStatus(false);
            }
          }}
        >
          <option value="practicing">연습 중</option>
          <option value="paused">보류</option>
          <option value="done">완료</option>
        </select>
        <input
          type="text"
          className={`inp ${styles.memoInlineInput}`}
          maxLength={2000}
          placeholder="곡 메모"
          value={memoVal}
          onChange={(e) => setMemoVal(e.target.value)}
        />
        <button
          type="button"
          className={`ghost mini ${styles.ghostMini}`}
          disabled={busyMemo}
          onClick={async () => {
            setBusyMemo(true);
            try {
              const updated = await apiClient.songs.update(song.id, { memo: memoVal });
              if (updated) onUpdated(updated);
              setMemoBtnText('저장됨');
              setTimeout(() => setMemoBtnText('메모 저장'), 1500);
            } catch (err: any) {
              window.alert((err && err.message) || '메모 저장에 실패했어요');
            } finally {
              setBusyMemo(false);
            }
          }}
        >
          {memoBtnText}
        </button>
        <button
          type="button"
          className={`ghost mini ${styles.ghostMini}`}
          disabled={busyDel}
          onClick={async () => {
            if (!window.confirm('이 곡과 모든 연습 기록·녹음 파일을 함께 삭제할까요?')) return;
            setBusyDel(true);
            try {
              await apiClient.songs.remove(song.id);
              onRemoved(song.id);
            } catch (err: any) {
              window.alert((err && err.message) || '곡 삭제에 실패했어요');
              setBusyDel(false);
            }
          }}
        >
          곡 삭제
        </button>
      </div>
    </div>
  );
}

export function LogPage(): React.ReactElement {
  const authState = useAuth();
  const activeUid = authState.user?.id ?? null;
  const isGuest = !activeUid || !apiClient.isLoggedIn();

  // 라우트 상태 (탭 vs 곡 상세)
  const [activeTab, setActiveTab] = useState<'log' | 'songs'>(() =>
    typeof window !== 'undefined' && window.location.hash === '#songs' ? 'songs' : 'log'
  );
  const [detailSongId, setDetailSongId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('song');
  });

  const [msg, setMsg] = useState<{ text: string; kind: '' | 'err' }>({ text: '', kind: '' });

  // 탭 1: 기록 달력 상태
  const [sessionsData, setSessionsData] = useState<SessionListResponse | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // 탭 2: 곡 보관함 상태
  const [songFilter, setSongFilter] = useState<string>('');
  const [songsList, setSongsList] = useState<SongDto[]>([]);

  // 탭 3: 곡 상세 및 A/B 비교 상태
  const [detailData, setDetailData] = useState<SongDetailResponse | null>(null);
  const [detailStatus, setDetailStatus] = useState<string>('practicing');
  const [detailMemo, setDetailMemo] = useState<string>('');
  const [detailMemoBtnText, setDetailMemoBtnText] = useState<string>('저장');
  const [abSelected, setAbSelected] = useState<string[]>([]);

  // A/B 오디오 엘리먼트 레프 (주니어 체크리스트 58·59행: dataset.takeId 비교 및 상호 배타 재생)
  const audioARef = useRef<HTMLAudioElement | null>(null);
  const audioBRef = useRef<HTMLAudioElement | null>(null);
  const [abBusySlot, setAbBusySlot] = useState<'A' | 'B' | null>(null);

  // A/B 재생 비동기 레이스 방어 토큰 및 최신 페어 레프 (PR #43 리뷰 1번)
  const abReqSeqRef = useRef(0);
  const abPairRef = useRef<[TakeDto, TakeDto] | null>(null);

  // 요청 순번 레프 (주니어 체크리스트 51행)
  const logReqSeqRef = useRef(0);
  const songsReqSeqRef = useRef(0);
  const detailReqSeqRef = useRef(0);

  const clearAudioEl = (el: HTMLAudioElement | null) => {
    if (!el) return;
    try {
      el.pause();
      el.removeAttribute('src');
      el.load();
      delete el.dataset.takeId;
    } catch {
      /* ignore */
    }
  };

  const resetAllLogState = () => {
    logReqSeqRef.current++;
    songsReqSeqRef.current++;
    detailReqSeqRef.current++;
    abReqSeqRef.current++;
    setSessionsData(null);
    setSelectedDate(null);
    setSongsList([]);
    setDetailData(null);
    setAbSelected([]);
    setAbBusySlot(null);
    setMsg({ text: '', kind: '' });
    clearAudioEl(audioARef.current);
    clearAudioEl(audioBRef.current);
  };

  const loadLogView = async (uid: string | null) => {
    if (!uid || !apiClient.isLoggedIn()) return;
    const mySeq = ++logReqSeqRef.current;
    const t = getLogTodayStr();
    setMsg({ text: '기록을 불러오는 중...', kind: '' });
    try {
      const data = await apiClient.sessions.list({ today: t });
      if (mySeq !== logReqSeqRef.current || auth.getUser()?.id !== uid) return;
      const safeData = data || {
        summary: { thisWeekSeconds: 0, thisMonthSeconds: 0 },
        calendar: [],
        sessions: [],
      };
      setSessionsData(safeData);
      setMsg({ text: '', kind: '' });
      setSelectedDate((prev) => {
        if (prev) return prev;
        if (Array.isArray(safeData.sessions) && safeData.sessions.length > 0) {
          return safeData.sessions[0].date;
        }
        return t;
      });
    } catch (e: any) {
      if (mySeq !== logReqSeqRef.current || auth.getUser()?.id !== uid) return;
      setMsg({ text: (e && e.message) || '연습 기록을 불러오지 못했어요', kind: 'err' });
    }
  };

  const loadSongsView = async (uid: string | null, statusFilter: string) => {
    if (!uid || !apiClient.isLoggedIn()) return;
    const mySeq = ++songsReqSeqRef.current;
    setMsg({ text: '곡 목록을 불러오는 중...', kind: '' });
    try {
      const list = await apiClient.songs.list(statusFilter);
      if (mySeq !== songsReqSeqRef.current || auth.getUser()?.id !== uid) return;
      setSongsList(Array.isArray(list) ? list : []);
      setMsg({ text: '', kind: '' });
    } catch (e: any) {
      if (mySeq !== songsReqSeqRef.current || auth.getUser()?.id !== uid) return;
      setMsg({ text: (e && e.message) || '곡 목록을 불러오지 못했어요', kind: 'err' });
    }
  };

  const loadSongDetailView = async (uid: string | null, sId: string) => {
    if (!uid || !apiClient.isLoggedIn()) return;
    const mySeq = ++detailReqSeqRef.current;
    abReqSeqRef.current++;
    setMsg({ text: '곡 상세 정보를 불러오는 중...', kind: '' });
    try {
      const data = await apiClient.songs.get(sId);
      if (mySeq !== detailReqSeqRef.current || auth.getUser()?.id !== uid) return;
      setDetailData(data);
      setDetailStatus(data?.song?.statusCode || 'practicing');
      setDetailMemo(data?.song?.memo || '');
      setAbSelected([]);
      clearAudioEl(audioARef.current);
      clearAudioEl(audioBRef.current);
      setMsg({ text: '', kind: '' });
    } catch (e: any) {
      if (mySeq !== detailReqSeqRef.current || auth.getUser()?.id !== uid) return;
      setMsg({ text: (e && e.message) || '곡 상세 정보를 불러오지 못했어요', kind: 'err' });
    }
  };

  useEffect(() => {
    document.title = '연습 기록 · ULeveLP';
    const onPopState = () => {
      const q = new URLSearchParams(window.location.search);
      const nextSongId = q.get('song');
      setDetailSongId(nextSongId);
      setActiveTab(window.location.hash === '#songs' ? 'songs' : 'log');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // 계정 전환 또는 뷰 전환 시 데이터 로드
  useEffect(() => {
    if (!activeUid || !apiClient.isLoggedIn()) {
      resetAllLogState();
      return;
    }
    if (detailSongId) {
      void loadSongDetailView(activeUid, detailSongId);
    } else if (activeTab === 'songs') {
      void loadSongsView(activeUid, songFilter);
    } else {
      void loadLogView(activeUid);
    }
  }, [activeUid, detailSongId, activeTab, songFilter]);

  // A/B 선택된 테이크 계산 및 슬롯 식별자 변경 시 오디오 리셋 (주니어 체크리스트 58·59행, PR #43 리뷰 1번)
  const detailTakes = detailData?.takes || [];
  const abPair: [TakeDto, TakeDto] | null =
    abSelected.length === 2
      ? (() => {
          const t1 = detailTakes.find((t) => t.id === abSelected[0]);
          const t2 = detailTakes.find((t) => t.id === abSelected[1]);
          return t1 && t2 ? sortAbTakes(t1, t2) : null;
        })()
      : null;

  useEffect(() => {
    abPairRef.current = abPair;
    abReqSeqRef.current++;
    setAbBusySlot(null);
    if (!abPair) {
      clearAudioEl(audioARef.current);
      clearAudioEl(audioBRef.current);
      return;
    }
    const [takeA, takeB] = abPair;
    if (audioARef.current && audioARef.current.dataset.takeId !== takeA.id) {
      clearAudioEl(audioARef.current);
    }
    if (audioBRef.current && audioBRef.current.dataset.takeId !== takeB.id) {
      clearAudioEl(audioBRef.current);
    }
  }, [abPair]);

  const handlePlayAbSlot = async (slot: 'A' | 'B', take: TakeDto) => {
    const audioEl = slot === 'A' ? audioARef.current : audioBRef.current;
    const otherEl = slot === 'A' ? audioBRef.current : audioARef.current;
    if (!audioEl) return;
    if (otherEl) {
      try {
        otherEl.pause();
      } catch {
        /* ignore */
      }
    }
    if (audioEl.dataset.takeId !== take.id) {
      const myToken = ++abReqSeqRef.current;
      const myUid = activeUid;
      setAbBusySlot(slot);

      // 비동기 복귀 후 슬롯·인증·페어 유효성 검증 (PR #43 리뷰 1번)
      const isSlotValid = () => {
        if (myToken !== abReqSeqRef.current) return false;
        if (!activeUid || activeUid !== myUid || !apiClient.isLoggedIn()) return false;
        const currentSlotTake = slot === 'A' ? abPairRef.current?.[0] : abPairRef.current?.[1];
        if (!currentSlotTake || currentSlotTake.id !== take.id) return false;
        return true;
      };

      try {
        if (take.storage === 'drive') {
          const blobUrl = await drive.fetchMediaObjectUrl(take.storageKey);
          if (!isSlotValid()) return;
          const valid = safeAudioUrl(blobUrl);
          if (!valid) throw new Error('유효하지 않은 오디오 주소예요');
          if (!isSlotValid()) return;
          audioEl['src'] = valid;
          audioEl.dataset.takeId = take.id;
          await audioEl.play().catch(() => {});
        } else {
          const r = await apiClient.takes.getUrl(take.id);
          if (!isSlotValid()) return;
          const valid = r && r.url ? safeAudioUrl(r.url) : '';
          if (!valid) {
            window.alert('녹음 재생 주소를 받지 못했어요');
            return;
          }
          if (!isSlotValid()) return;
          audioEl['src'] = valid;
          audioEl.dataset.takeId = take.id;
          await audioEl.play().catch(() => {});
        }
      } catch (err: any) {
        if (isSlotValid()) {
          window.alert((err && err.message) || '녹음 재생 주소를 받지 못했어요');
        }
      } finally {
        if (myToken === abReqSeqRef.current) {
          setAbBusySlot(null);
        }
      }
    } else if (audioEl.paused) {
      await audioEl.play().catch(() => {});
    } else {
      audioEl.pause();
    }
  };

  // 달력 84일 계산
  const today = getLogTodayStr();
  const days84 = build84Days(today);
  const calRangeText = days84.length >= 84 ? `${days84[0]} ~ ${days84[83]}` : '';
  const calendarMap = new Map<string, { totalSeconds: number; level: number }>();
  (sessionsData?.calendar || []).forEach((c) => {
    calendarMap.set(c.date, c);
  });

  const daySessionsList = (sessionsData?.sessions || []).filter((s) => s.date === selectedDate);
  const detailSong = detailData?.song || null;
  const detailSessions = detailData?.sessions || [];
  const maxTimelineSec = Math.max(60, ...detailSessions.map((s) => s.seconds || 0));

  const detailResumeHref = detailSong
    ? (detailSong.resumeUrl ? safeUrl(detailSong.resumeUrl) : '') ||
      `practice.html?v=${encodeURIComponent(detailSong.videoId || '')}`
    : '#';

  return (
    <AppShell variant="narrow" activeNav="trails">
      <div className={`log-page ${styles.logContainer}`}>
        <header id="logHeader" className={styles.headerBlock} hidden={!isGuest && Boolean(detailSongId)}>
          <h1 className={`page-title ${styles.pageTitle}`}>Log</h1>
          <p className={`page-sub ${styles.pageSub}`}>
            최근 12주 연습 달력과 곡별 기록·녹음을 한눈에 확인해요.
          </p>
          <nav
            className={`tabs ${styles.tabs}`}
            id="logTabs"
            role="tablist"
            aria-label="기록 보기"
            hidden={isGuest || Boolean(detailSongId)}
          >
            <button
              type="button"
              className={`tab ${styles.tab}`}
              role="tab"
              id="tab-log"
              aria-selected={activeTab === 'log'}
              onClick={() => {
                setDetailSongId(null);
                setActiveTab('log');
                window.history.pushState(null, '', 'log.html');
              }}
            >
              기록
            </button>
            <button
              type="button"
              className={`tab ${styles.tab}`}
              role="tab"
              id="tab-songs"
              aria-selected={activeTab === 'songs'}
              onClick={() => {
                setDetailSongId(null);
                setActiveTab('songs');
                window.history.pushState(null, '', 'log.html#songs');
              }}
            >
              곡
            </button>
          </nav>
        </header>

        <p className={`msg${msg.kind ? ' ' + msg.kind : ''}`} id="logMsg" role="status">
          {msg.text}
        </p>

        <div className={`panel ${styles.panel}`} id="logGuest" hidden={!isGuest}>
          <p>Google 계정으로 로그인하면 연습 달력과 녹음 기록을 볼 수 있어요.</p>
          <div className={styles.row}>
            <SafeLink className="pillBtn" href="settings.html#account">
              로그인하러 가기
            </SafeLink>
          </div>
        </div>

        {/* 1. 기록 탭 패널 */}
        <section
          id="pane-log"
          role="tabpanel"
          aria-labelledby="tab-log"
          className={styles.logContainer}
          hidden={isGuest || Boolean(detailSongId) || activeTab !== 'log'}
        >
          <div className={`log-summary ${styles.logSummary}`}>
            <div className={`summary-card ${styles.summaryCard}`}>
              <span className={`summary-title ${styles.summaryTitle}`}>이번 주 총 연습</span>
              <span className={`summary-val ${styles.summaryVal}`} id="sumWeek">
                {fmtDuration(sessionsData?.summary?.thisWeekSeconds)}
              </span>
            </div>
            <div className={`summary-card ${styles.summaryCard}`}>
              <span className={`summary-title ${styles.summaryTitle}`}>이번 달 총 연습</span>
              <span className={`summary-val ${styles.summaryVal}`} id="sumMonth">
                {fmtDuration(sessionsData?.summary?.thisMonthSeconds)}
              </span>
            </div>
          </div>

          <div className={`panel ${styles.panel}`}>
            <div className={`head-row ${styles.headRow}`}>
              <h2 className={`h3 ${styles.h3}`}>최근 12주 연습 달력</h2>
              <span className={`meta ${styles.meta}`} id="calRange">
                {calRangeText}
              </span>
            </div>
            <div className={`cal-grid ${styles.calGrid}`} id="calGrid" role="grid" aria-label="최근 12주 연습 달력">
              {days84.map((dateStr) => {
                const c = calendarMap.get(dateStr);
                const lv = c && c.level ? c.level : 0;
                const lvClass =
                  lv === 4
                    ? styles.lv4
                    : lv === 3
                      ? styles.lv3
                      : lv === 2
                        ? styles.lv2
                        : lv === 1
                          ? styles.lv1
                          : styles.lv0;
                const durText = c ? fmtDuration(c.totalSeconds) : '0분';
                return (
                  <button
                    key={dateStr}
                    type="button"
                    className={`cal-day lv${lv} ${styles.calDay} ${lvClass}`}
                    data-date={dateStr}
                    aria-pressed={dateStr === selectedDate}
                    aria-label={`${dateStr} · ${durText}`}
                    onClick={() => setSelectedDate(dateStr)}
                  />
                );
              })}
            </div>
            <div className={`cal-legend ${styles.calLegend}`} aria-hidden="true">
              <span>적음</span>
              <i className={`lv0 ${styles.lv0}`} />
              <i className={`lv1 ${styles.lv1}`} />
              <i className={`lv2 ${styles.lv2}`} />
              <i className={`lv3 ${styles.lv3}`} />
              <i className={`lv4 ${styles.lv4}`} />
              <span>많음</span>
            </div>
          </div>

          <div id="daySection" className={styles.logContainer}>
            <h2 id="dayTitle" className={styles.h3}>
              {selectedDate ? `${selectedDate} 연습 기록` : '연습 기록'}
            </h2>
            <div className={`log-sessions ${styles.logSessions}`} id="daySessions">
              {daySessionsList.length === 0 ? (
                <p className={`empty ${styles.empty}`}>이 날에는 기록된 연습 세션이 없어요.</p>
              ) : (
                daySessionsList.map((s) => (
                  <SessionCardItem
                    key={s.id}
                    session={s}
                    onMemoSaved={(sessId, nextMemo) => {
                      setSessionsData((prev) =>
                        prev
                          ? {
                              ...prev,
                              sessions: prev.sessions.map((it) =>
                                it.id === sessId ? { ...it, memo: nextMemo } : it
                              ),
                            }
                          : prev
                      );
                    }}
                    onTakeRemoved={(sessId, takeId) => {
                      setSessionsData((prev) =>
                        prev
                          ? {
                              ...prev,
                              sessions: prev.sessions.map((it) =>
                                it.id === sessId
                                  ? { ...it, takes: (it.takes || []).filter((tk) => tk.id !== takeId) }
                                  : it
                              ),
                            }
                          : prev
                      );
                    }}
                  />
                ))
              )}
            </div>
          </div>
        </section>

        {/* 2. 곡 보관함 탭 패널 (FR-LIB-1) */}
        <section
          id="pane-songs"
          role="tabpanel"
          aria-labelledby="tab-songs"
          className={styles.logContainer}
          hidden={isGuest || Boolean(detailSongId) || activeTab !== 'songs'}
        >
          <div className={`seg-pill ${styles.segPill}`} id="songFilters" role="group" aria-label="곡 상태 필터">
            {(
              [
                ['', '전체'],
                ['practicing', '연습 중'],
                ['paused', '보류'],
                ['done', '완료'],
              ] as const
            ).map(([stCode, label]) => (
              <button
                key={stCode || 'all'}
                type="button"
                className={styles.segBtn}
                data-status={stCode}
                aria-pressed={songFilter === stCode}
                onClick={() => setSongFilter(stCode)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={`log-sessions ${styles.logSessions}`} id="songList">
            {songsList.length === 0 ? (
              <p className={`empty ${styles.empty}`}>등록된 연습 곡이 없어요.</p>
            ) : (
              songsList.map((s) => (
                <SongCardItem
                  key={s.id}
                  song={s}
                  onOpenDetail={(sId) => {
                    setDetailSongId(sId);
                    window.history.pushState(null, '', `log.html?song=${encodeURIComponent(sId)}`);
                  }}
                  onUpdated={(updated) => {
                    setSongsList((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
                  }}
                  onRemoved={(sId) => {
                    setSongsList((prev) => prev.filter((it) => it.id !== sId));
                  }}
                />
              ))
            )}
          </div>
        </section>

        {/* 3. 곡 상세 패널 (FR-LIB-2, FR-LIB-3) */}
        <section
          id="pane-song-detail"
          className={styles.logContainer}
          hidden={isGuest || !detailSongId}
        >
          <div className={`panel ${styles.panel}`}>
            <div className={styles.row}>
              <button
                type="button"
                className={`ghost mini ${styles.ghostMini}`}
                id="btnBackSongs"
                onClick={() => {
                  setDetailSongId(null);
                  setActiveTab('songs');
                  window.history.pushState(null, '', 'log.html#songs');
                }}
              >
                ← 곡 목록
              </button>
            </div>
            <div>
              <h2 className={`h3 ${styles.h3}`} id="detailTitle">
                {detailSong?.title || ''}
              </h2>
              <span className={`meta ${styles.meta}`} id="detailArtist">
                {detailSong?.artist ? ` · ${detailSong.artist}` : ''}
              </span>
            </div>
            <div className={`meta ${styles.meta}`} id="detailMeta">
              {detailSong
                ? `누적 ${fmtDuration(detailSong.totalSeconds)}${
                    detailSong.lastDate ? ` · 최근 연습 ${detailSong.lastDate}` : ' · 연습 기록 없음'
                  }`
                : ''}
            </div>
            <div className={styles.row}>
              <SafeLink className="pillBtn" id="detailResume" href={detailResumeHref}>
                ▶ 이어서 연습
              </SafeLink>
              <select
                id="detailStatus"
                className={styles.selectPill}
                aria-label="곡 상태"
                value={detailStatus}
                onChange={async (e) => {
                  if (!detailSong) return;
                  const next = e.target.value;
                  setDetailStatus(next);
                  try {
                    const updated = await apiClient.songs.update(detailSong.id, { status: next });
                    if (updated) {
                      setDetailData((prev) => (prev ? { ...prev, song: updated } : prev));
                    }
                  } catch (err: any) {
                    window.alert((err && err.message) || '상태 변경에 실패했어요');
                    setDetailStatus(detailSong.statusCode || 'practicing');
                  }
                }}
              >
                <option value="practicing">연습 중</option>
                <option value="paused">보류</option>
                <option value="done">완료</option>
              </select>
              <button
                type="button"
                className="ghostBtn"
                id="btnDeleteSong"
                onClick={async () => {
                  if (!detailSong) return;
                  if (!window.confirm('이 곡과 모든 연습 기록·녹음 파일을 함께 삭제할까요?')) return;
                  try {
                    await apiClient.songs.remove(detailSong.id);
                    setDetailSongId(null);
                    setActiveTab('songs');
                    window.history.pushState(null, '', 'log.html#songs');
                  } catch (err: any) {
                    window.alert((err && err.message) || '곡 삭제에 실패했어요');
                  }
                }}
              >
                곡 삭제
              </button>
            </div>
            <div className={styles.field}>
              <label className={styles.lab} htmlFor="detailMemo">
                곡 메모
              </label>
              <textarea
                id="detailMemo"
                className="inpField"
                rows={2}
                maxLength={2000}
                placeholder="곡 메모"
                value={detailMemo}
                onChange={(e) => setDetailMemo(e.target.value)}
              />
              <div className={styles.row}>
                <button
                  type="button"
                  className="ghostBtn"
                  id="btnSaveSongMemo"
                  onClick={async () => {
                    if (!detailSong) return;
                    try {
                      const updated = await apiClient.songs.update(detailSong.id, { memo: detailMemo });
                      if (updated) {
                        setDetailData((prev) => (prev ? { ...prev, song: updated } : prev));
                      }
                      setDetailMemoBtnText('저장됨');
                      setTimeout(() => setDetailMemoBtnText('저장'), 1500);
                    } catch (err: any) {
                      window.alert((err && err.message) || '메모 저장에 실패했어요');
                    }
                  }}
                >
                  {detailMemoBtnText}
                </button>
              </div>
            </div>
          </div>

          {/* 연습 시간 막대 타임라인 (FR-LIB-2) */}
          <div className={`panel ${styles.panel}`}>
            <div className={`head-row ${styles.headRow}`}>
              <h3 className={`h3 ${styles.h3}`}>연습 세션 타임라인</h3>
            </div>
            <div id="detailTimeline">
              {detailSessions.length === 0 ? (
                <p className={`empty ${styles.empty}`}>아직 연습 세션 기록이 없어요.</p>
              ) : (
                detailSessions.map((s) => {
                  let leftText = s.date;
                  if (s.segment) leftText += ` · 구간 ${s.segment}`;
                  if (s.rate != null) leftText += ` · ${s.rate}×`;
                  return (
                    <div key={s.id} className={`tl-row ${styles.tlRow}`}>
                      <div className={`tl-meta ${styles.tlMeta}`}>
                        <span>{leftText}</span>
                        <span className={`meta ${styles.meta}`}>
                          {s.minutes}분 ({s.loops || 0}회)
                        </span>
                      </div>
                      <progress className={`tl-bar ${styles.tlBar}`} max={maxTimelineSec} value={s.seconds || 0} />
                      {s.memo && <div className={`tl-memo ${styles.tlMemo}`}>{s.memo}</div>}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 녹음 목록 및 A/B 비교 듣기 (FR-LIB-3) */}
          <div className={`panel ${styles.panel}`}>
            <div className={`head-row ${styles.headRow}`}>
              <h3 className={`h3 ${styles.h3}`}>녹음 테이크 목록</h3>
            </div>
            <div id="detailTakes" className={styles.sessionTakes}>
              {detailTakes.length === 0 ? (
                <p className={`empty ${styles.empty}`}>아직 녹음된 테이크가 없어요.</p>
              ) : (
                detailTakes.map((t) => (
                  <TakeItemRow
                    key={t.id}
                    take={t}
                    showAbCheck
                    abChecked={abSelected.includes(t.id)}
                    onToggleAb={(takeId, checked) => {
                      setAbSelected((prev) => {
                        if (checked) {
                          const next = prev.length >= 2 ? [...prev.slice(1), takeId] : [...prev, takeId];
                          return next;
                        }
                        return prev.filter((id) => id !== takeId);
                      });
                    }}
                    onDeleted={(takeId) => {
                      setAbSelected((prev) => prev.filter((id) => id !== takeId));
                      setDetailData((prev) =>
                        prev ? { ...prev, takes: prev.takes.filter((it) => it.id !== takeId) } : prev
                      );
                    }}
                  />
                ))
              )}
            </div>

            <div className={`panel ${styles.panel}`} id="abPanel" hidden={!abPair}>
              <div className={`head-row ${styles.headRow}`}>
                <h4 className={`h3 ${styles.h3}`}>녹음 A/B 비교 듣기</h4>
                <span className={`meta ${styles.meta}`}>과거 녹음과 최근 녹음 교차 비교</span>
              </div>
              <div className={`ab-slots ${styles.abSlots}`}>
                <div className={`ab-slot ${styles.abSlot}`} id="abSlotA">
                  <span className={`meta ${styles.meta}`} id="abLabelA">
                    {abPair
                      ? `A (과거 녹음) · ${abPair[0].recordedAt.slice(0, 16).replace('T', ' ')} · ${
                          abPair[0].durationSec || 0
                        }초`
                      : 'A (과거 녹음)'}
                  </span>
                  <button
                    type="button"
                    className={`ghost mini ${styles.ghostMini}`}
                    id="abPlayA"
                    disabled={abBusySlot === 'A'}
                    onClick={() => abPair && void handlePlayAbSlot('A', abPair[0])}
                  >
                    ▶ 재생
                  </button>
                  <audio
                    ref={audioARef}
                    id="abAudioA"
                    className={styles.takeAudio}
                    controls
                    preload="none"
                    onPlay={() => audioBRef.current?.pause()}
                  />
                </div>
                <div className={`ab-slot ${styles.abSlot}`} id="abSlotB">
                  <span className={`meta ${styles.meta}`} id="abLabelB">
                    {abPair
                      ? `B (최근 녹음) · ${abPair[1].recordedAt.slice(0, 16).replace('T', ' ')} · ${
                          abPair[1].durationSec || 0
                        }초`
                      : 'B (최근 녹음)'}
                  </span>
                  <button
                    type="button"
                    className={`ghost mini ${styles.ghostMini}`}
                    id="abPlayB"
                    disabled={abBusySlot === 'B'}
                    onClick={() => abPair && void handlePlayAbSlot('B', abPair[1])}
                  >
                    ▶ 재생
                  </button>
                  <audio
                    ref={audioBRef}
                    id="abAudioB"
                    className={styles.takeAudio}
                    controls
                    preload="none"
                    onPlay={() => audioARef.current?.pause()}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

export default LogPage;

