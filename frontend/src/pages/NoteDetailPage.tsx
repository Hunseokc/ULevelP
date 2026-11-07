// frontend/src/pages/NoteDetailPage.tsx
import React, { useEffect, useRef, useState } from 'react';
import { AppShell } from '../components/layout/AppShell';
import { SafeLink } from '../components/common/SafeLink';
import { SanitizedSvg } from '../components/common/SanitizedSvg';
import { auth, useAuth } from '../lib/auth';
import { apiClient, NoteDetailDto } from '../lib/apiClient';
import { safeUrl } from '../lib/security';
import { NOTE_FORM_TAGS } from './NotesPage';
import styles from './NoteDetailPage.module.css';

export function parseTimestampSec(ts: unknown): number | null {
  if (!ts || typeof ts !== 'string') return null;
  const parts = ts.trim().match(/\d+/g);
  if (!parts || parts.length < 2 || parts.length > 3) return null;
  let total = 0;
  for (const p of parts) {
    const num = parseInt(p, 10);
    if (Number.isNaN(num)) return null;
    total = total * 60 + num;
  }
  return total;
}

function TimestampCell({ ts, videoId }: { ts?: string; videoId?: string }): React.ReactElement {
  const sec = parseTimestampSec(ts);
  if (sec !== null && videoId) {
    return (
      <td>
        <SafeLink href={`practice.html?v=${encodeURIComponent(videoId)}&t=${encodeURIComponent(String(sec))}`}>
          {ts}
        </SafeLink>
      </td>
    );
  }
  return <td>{ts || ''}</td>;
}

export function NoteDetailPage(): React.ReactElement {
  useEffect(() => {
    document.title = '학습 노트 상세 · ULeveLP';
  }, []);

  const authState = useAuth();
  const activeUid = authState.user?.id ?? null;

  const [note, setNote] = useState<NoteDetailDto | null>(null);
  const [loadingMsg, setLoadingMsg] = useState<string>('학습 노트를 불러오는 중...');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editMemo, setEditMemo] = useState<string>('');
  const [editMsg, setEditMsg] = useState<{ text: string; kind: '' | 'ok' | 'err' }>({ text: '', kind: '' });

  const detailReqSeqRef = useRef(0);

  // CH-5: "코드 진행 수집에 넣기" 토글 (PUT /notes/{id}/collect). count = 이 노트에서 온 진행 수(null = 모름)
  const [collectOn, setCollectOn] = useState(false);
  const [collectCount, setCollectCount] = useState<number | null>(null);
  const [collectBusy, setCollectBusy] = useState(false);
  const [collectMsg, setCollectMsg] = useState<{ text: string; kind: '' | 'ok' | 'err' }>({ text: '', kind: '' });

  const loadCollectCount = async (noteId: string, uid: string | null) => {
    try {
      const list = await apiClient.progressions.list('analysis');
      if (auth.getUser()?.id !== uid) return;
      setCollectCount(list.filter((p) => p.noteId === noteId).length);
    } catch {
      setCollectCount(null);
    }
  };

  const toggleCollect = async (next: boolean) => {
    if (!note || collectBusy) return;
    const myUid = activeUid;
    if (!next) {
      let edited = 0;
      let total = collectCount ?? 0;
      try {
        const list = (await apiClient.progressions.list('analysis')).filter((p) => p.noteId === note.id);
        total = list.length;
        edited = list.filter((p) => p.origin === 'manual').length;
      } catch {
        /* 개수를 몰라도 확인은 묻는다 */
      }
      const extra = edited > 0 ? ` 고친 진행 ${edited}개도 같이 빠집니다.` : '';
      if (total > 0 && !window.confirm(`이 노트에서 모은 진행 ${total}개를 코드 진행 모음에서 뺄까요?${extra}`)) return;
    }
    setCollectBusy(true);
    setCollectMsg({ text: next ? '진행을 모으는 중...' : '빼는 중...', kind: '' });
    try {
      const r = await apiClient.notes.setCollect(note.id, next);
      if (auth.getUser()?.id !== myUid) return;
      setCollectOn(r.collect);
      setCollectCount(r.progressions.length);
      setCollectMsg(
        r.collect
          ? r.progressions.length > 0
            ? { text: `진행 ${r.progressions.length}개를 모았어요.`, kind: 'ok' }
            : { text: '이 노트에는 화성 진행이 없습니다.', kind: '' }
          : { text: '코드 진행 모음에서 뺐어요.', kind: 'ok' }
      );
    } catch (err: any) {
      if (auth.getUser()?.id !== myUid) return;
      setCollectMsg({ text: (err && err.message) || '바꾸지 못했어요.', kind: 'err' });
    } finally {
      setCollectBusy(false);
    }
  };

  const clearState = (msg: string) => {
    setNote(null);
    setCollectOn(false);
    setCollectCount(null);
    setCollectMsg({ text: '', kind: '' });
    setEditTags([]);
    setEditMemo('');
    setEditMsg({ text: '', kind: '' });
    setLoadingMsg(msg);
  };

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const noteId = q.get('id');
    const mySeq = ++detailReqSeqRef.current;
    const myUid = activeUid;

    if (!noteId) {
      clearState('노트 ID가 없어요.');
      return;
    }

    if (!myUid || !apiClient.isLoggedIn()) {
      clearState('로그인이 필요해요.');
      return;
    }

    clearState('학습 노트를 불러오는 중...');

    apiClient.notes
      .get(noteId)
      .then((res) => {
        if (detailReqSeqRef.current !== mySeq || auth.getUser()?.id !== myUid) return;
        if (!res) {
          clearState('학습 노트를 찾을 수 없어요.');
          return;
        }
        setNote(res);
        setCollectOn(Boolean(res.collectProgressions));
        if (res.collectProgressions) void loadCollectCount(res.id, myUid);
        setEditTags(Array.isArray(res.tags) ? res.tags : []);
        setEditMemo(res.memo || '');
        setLoadingMsg('');
      })
      .catch((err: any) => {
        if (detailReqSeqRef.current !== mySeq || auth.getUser()?.id !== myUid) return;
        clearState((err && err.message) || '학습 노트를 불러오지 못했어요.');
      });
  }, [activeUid]);

  const metaParts: string[] = [];
  if (note?.channel) metaParts.push(note.channel);
  if (note?.model) metaParts.push(note.model);
  if (note?.createdAt) metaParts.push(new Date(note.createdAt).toLocaleDateString('ko-KR'));

  const analysis = note?.analysis || {};
  const tags = Array.isArray(note?.tags) ? note!.tags : [];
  const diagramsSvg = Array.isArray(note?.diagramsSvg) ? note!.diagramsSvg : [];
  const moments = Array.isArray(analysis.moments) ? analysis.moments : [];
  const practiceItems = Array.isArray(analysis.practice) ? analysis.practice : [];

  return (
    <AppShell variant="narrow" activeNav="notes">
      <p className={`back-link ${styles.backLink}`}>
        <SafeLink href="notes.html">← 학습 노트 목록</SafeLink>
      </p>

      <div id="noteContent" hidden={!note}>
        <div className={`card ${styles.card}`} id="noteHeader">
          <h1 className={`page-title ${styles.pageTitle}`} id="noteTitle">
            {note ? note.title || note.url || '(제목 없음)' : ''}
          </h1>
          <div className={`note-meta ${styles.noteMeta}`} id="noteMeta">
            {metaParts.join(' · ')}
          </div>
          <div className={`note-badges ${styles.noteBadges}`}>
            <span className={`badge ${styles.badge}`} id="noteDifficulty" hidden={!note?.difficulty}>
              {note?.difficulty || ''}
            </span>
            <span id="noteTags">
              {tags.map((t) => (
                <span key={t} className={`badge ${styles.badge}`}>
                  {t}
                </span>
              ))}
            </span>
          </div>
          <div className={`row note-actions ${styles.noteActions}`}>
            <SafeLink
              id="notePracticeLink"
              className="pillBtn"
              href={note?.videoId ? `practice.html?v=${encodeURIComponent(note.videoId)}` : 'practice.html'}
              hidden={!note?.videoId}
            >
              ▶ 플레이어에서 연습
            </SafeLink>
            <SafeLink
              id="noteYoutubeLink"
              className="ghostBtn"
              href={note?.url ? safeUrl(note.url) : ''}
              external
              hidden={!note?.url}
            >
              유튜브 원본 ↗
            </SafeLink>
            <button
              id="btnDeleteNote"
              className="ghostBtn"
              type="button"
              onClick={async () => {
                if (!note || !note.id) return;
                if (!window.confirm('이 학습 노트를 삭제할까요?')) return;
                try {
                  await apiClient.notes.remove(note.id);
                  window.location.href = 'notes.html';
                } catch (err: any) {
                  window.alert((err && err.message) || '노트 삭제에 실패했어요.');
                }
              }}
            >
              노트 삭제
            </button>
          </div>
        </div>

        <div className={`card ${styles.card} ${styles.collectBox}`} id="noteCollectBox">
          <label className={styles.collectLabel}>
            <input
              type="checkbox"
              id="noteCollectToggle"
              checked={collectOn}
              disabled={collectBusy}
              onChange={(e) => void toggleCollect(e.target.checked)}
            />
            <span>코드 진행 수집에 넣기</span>
          </label>
          <span className="hint">켜면 이 노트의 화성 진행이 CHORDS 코드 진행 모음(분석)에 들어가요.</span>
          {collectOn && (
            <SafeLink id="noteCollectLink" href="progressions.html?scope=analysis">
              CHORDS에서 보기{collectCount !== null ? ` (${collectCount}개)` : ''} →
            </SafeLink>
          )}
          <p className={`msg${collectMsg.kind ? ' ' + collectMsg.kind : ''}`} id="noteCollectMsg" role="status">
            {collectMsg.text}
          </p>
        </div>

        <div className={`card summary-box ${styles.summaryBox}`} id="noteSummaryBox">
          <h2>핵심 요약</h2>
          <p className={`headline ${styles.headline}`} id="noteHeadline">
            {note?.headline || ''}
          </p>
          <ul className={`points ${styles.points}`} id="notePoints">
            {(note?.points || []).map((p, idx) => (
              <li key={idx}>{p}</li>
            ))}
          </ul>
          <div className={`keywords ${styles.keywords}`} id="noteKeywords">
            {(note?.keywords || []).map((k, idx) => (
              <span key={idx} className={`keyword-chip ${styles.keywordChip}`}>
                {k}
              </span>
            ))}
          </div>
        </div>

        <div id="noteSections">
          {tags.map((tag) => {
            if (tag === '화성' && analysis.harmony) {
              const progs = Array.isArray(analysis.harmony.progressions) ? analysis.harmony.progressions : [];
              const concepts = Array.isArray(analysis.harmony.concepts) ? analysis.harmony.concepts : [];
              return (
                <div key="harmony" className={`card note-section ${styles.card}`}>
                  <h2>화성 (Harmony)</h2>
                  {progs.map((prog: any, pIdx: number) => {
                    const chords = Array.isArray(prog.chords) ? prog.chords : [];
                    const pTitle = [
                      prog.name || '진행',
                      prog.key ? `(${prog.key})` : '',
                      prog.instrument ? `· ${prog.instrument}` : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <div key={pIdx} className={`progression-box ${styles.subBox}`}>
                        <h3>{pTitle}</h3>
                        {chords.length > 0 && (
                          <>
                            <p className={`progression-arrows ${styles.arrows}`}>
                              {chords.map((c: any) => c.symbol || '').join(' → ')}
                            </p>
                            <div className={`scroll ${styles.tableWrap}`}>
                              <table>
                                <thead>
                                  <tr>
                                    <th>코드</th>
                                    <th>로마숫자</th>
                                    <th>기능</th>
                                    <th>보이싱</th>
                                    <th>뉘앙스</th>
                                    <th>근거</th>
                                    <th>시간</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {chords.map((c: any, cIdx: number) => {
                                    let voicingStr = '';
                                    if (Array.isArray(c.frets) && c.frets.length > 0) {
                                      voicingStr = c.frets.join(' ');
                                    } else if (c.split) {
                                      voicingStr = `LH ${(c.lh || []).join(' ')} · RH ${(c.rh || []).join(' ')}`;
                                    } else {
                                      voicingStr = (c.lh || []).concat(c.rh || []).join(' ');
                                    }
                                    if (c.voicingNote) voicingStr += ` (${c.voicingNote})`;
                                    return (
                                      <tr key={cIdx}>
                                        <td>{c.symbol ?? ''}</td>
                                        <td>{c.roman ?? ''}</td>
                                        <td>{c.function ?? ''}</td>
                                        <td>{voicingStr}</td>
                                        <td>{c.nuance ?? ''}</td>
                                        <td>{c.basis ?? ''}</td>
                                        <TimestampCell ts={c.timestamp} videoId={note?.videoId} />
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </>
                        )}
                        {diagramsSvg[pIdx] && (
                          <SanitizedSvg className={`scroll svg-box ${styles.svgBox}`} svgText={diagramsSvg[pIdx]} />
                        )}
                      </div>
                    );
                  })}
                  {concepts.length > 0 && (
                    <div className={`concepts-box ${styles.conceptsBox}`}>
                      <h4>주요 화성 개념</h4>
                      <ul>
                        {concepts.map((c: any, idx: number) => (
                          <li key={idx}>{typeof c === 'string' ? c : `${c.term}: ${c.description || ''}`}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            }
            return null;
          })}
        </div>

        <div className={`card ${styles.card}`} id="noteMomentsBox">
          <h2>주요 구간</h2>
          <ul className={`moments-list ${styles.momentsList}`} id="noteMoments">
            {moments.length === 0 ? (
              <li className="empty">등록된 주요 구간이 없어요.</li>
            ) : (
              moments.map((m: any, idx: number) => {
                const sec = parseTimestampSec(m.timestamp);
                return (
                  <li key={idx} className={`moment-item ${styles.momentItem}`}>
                    {sec !== null && note?.videoId ? (
                      <SafeLink
                        className={`badge ${styles.badge}`}
                        href={`practice.html?v=${encodeURIComponent(note.videoId)}&t=${encodeURIComponent(String(sec))}`}
                      >
                        {m.timestamp}
                      </SafeLink>
                    ) : (
                      <span className={`badge ${styles.badge}`}>{m.timestamp || ''}</span>
                    )}
                    <span className="moment-point"> {m.point || ''}</span>
                  </li>
                );
              })
            )}
          </ul>
        </div>

        <div className={`card ${styles.card}`} id="notePracticeBox">
          <h2>연습 과제</h2>
          <div className={`practice-list ${styles.practiceList}`} id="notePractice">
            {practiceItems.length === 0 ? (
              <p className="empty">등록된 연습 과제가 없어요.</p>
            ) : (
              practiceItems.map((pText: string, idx: number) => (
                <label key={idx} className={`check ${styles.checkLabel}`}>
                  <input type="checkbox" />
                  <span>{pText}</span>
                </label>
              ))
            )}
          </div>
        </div>

        <div className={`card edit-panel ${styles.card}`} id="noteEditPanel">
          <h2>메모 및 태그 편집</h2>
          <div>
            <span className="lab">태그</span>
            <div className={`tags ${styles.tagsGroup}`} id="editTags" role="group" aria-label="태그 편집">
              {NOTE_FORM_TAGS.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={styles.tagBtn}
                  aria-pressed={editTags.includes(t)}
                  onClick={() =>
                    setEditTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
                  }
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <label>
            <span className="lab">메모</span>
            <textarea
              className="inpField"
              id="noteMemoInput"
              placeholder="노트에 대한 메모를 남겨보세요."
              value={editMemo}
              onChange={(e) => setEditMemo(e.target.value)}
            />
          </label>
          <div>
            <button
              id="btnSaveNote"
              className="ghostBtn"
              type="button"
              onClick={async () => {
                if (!note || !note.id) return;
                const myUid = activeUid;
                setEditMsg({ text: '저장하는 중...', kind: '' });
                try {
                  const ordered = NOTE_FORM_TAGS.filter((t) => editTags.includes(t));
                  const updated = await apiClient.notes.update(note.id, {
                    memo: editMemo.trim(),
                    tags: ordered,
                  });
                  if (auth.getUser()?.id !== myUid) return;
                  if (updated) setNote(updated);
                  setEditMsg({ text: '저장되었습니다.', kind: 'ok' });
                } catch (err: any) {
                  if (auth.getUser()?.id !== myUid) return;
                  setEditMsg({ text: (err && err.message) || '저장에 실패했어요.', kind: 'err' });
                }
              }}
            >
              메모·태그 저장
            </button>
          </div>
          <p className={`msg${editMsg.kind ? ' ' + editMsg.kind : ''}`} id="noteEditMsg" role="status">
            {editMsg.text}
          </p>
        </div>
      </div>

      <p className="empty" id="noteLoadingMsg" hidden={Boolean(note)}>
        {loadingMsg}
      </p>
    </AppShell>
  );
}

export default NoteDetailPage;
