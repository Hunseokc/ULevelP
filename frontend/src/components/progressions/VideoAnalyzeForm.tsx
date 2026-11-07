// CH-5: 코드 진행 영상 — URL + 메모 → POST /progressions/analyze (작업 큐, 결과는 목록 맨 위 작업 줄에서)
// GA-2: 구간(시작~끝) + 코드 진행 변화 속도(느림·보통·빠름 → 초당 캡처량). 개발산출물/진행_분석설정.md §3-2
// GA-4: 중복 방지 — 누르는 순간 ref 잠금, 분석 중이면 버튼 잠금, 409 DUPLICATE_ANALYSIS면 "다시 분석"(force)
import React, { useRef, useState } from 'react';
import { SafeLink } from '../common/SafeLink';
import { apiClient } from '../../lib/apiClient';
import { thumb, videoIdFrom } from '../../lib/security';
import { PACES, PACE_LABEL, checkRange } from './model.mts';
import type { Pace } from './model.mts';
import styles from './Progressions.module.css';

export interface VideoAnalyzeFormProps {
  hasKey: boolean;
  onOpenKeyModal: () => void;
  onRequested: (jobId: string) => void;
  onKeyMissing: () => void;
  /** 이 화면의 코드 진행 분석이 대기·진행 중(서버 동시 1건 제한) */
  busy?: boolean;
}

export function VideoAnalyzeForm({ hasKey, onOpenKeyModal, onRequested, onKeyMissing, busy = false }: VideoAnalyzeFormProps): React.ReactElement {
  const [url, setUrl] = useState('');
  const [memo, setMemo] = useState('');
  const [startText, setStartText] = useState('');
  const [endText, setEndText] = useState('');
  const [pace, setPace] = useState<Pace>('normal');
  const [msg, setMsg] = useState<{ text: string; kind: '' | 'ok' | 'err' }>({ text: '', kind: '' });
  const [sending, setSending] = useState(false);
  const [confirmDup, setConfirmDup] = useState(false); // 409 뒤 한 번 더 누르면 force
  const sendingRef = useRef(false); // state 반영 전 같은 순간의 두 번째 클릭 막기
  const vid = videoIdFrom(url);

  // 입력이 바뀌면 "다시 분석" 확인을 풀고 처음 상태로
  function edited<T>(set: (v: T) => void): (v: T) => void {
    return (v: T) => {
      setConfirmDup(false);
      set(v);
    };
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sendingRef.current || busy) return;
    if (!vid) {
      setMsg({ text: '유튜브 영상 링크가 아니에요.', kind: 'err' });
      return;
    }
    const range = checkRange(startText, endText);
    if (range.error) {
      setMsg({ text: range.error, kind: 'err' });
      return;
    }
    sendingRef.current = true;
    setSending(true);
    setMsg({ text: '분석 요청을 보내는 중...', kind: '' });
    try {
      const r = await apiClient.progressions.analyze({
        url: `https://www.youtube.com/watch?v=${vid}`,
        memo: memo.trim(),
        startSec: range.startSec,
        endSec: range.endSec,
        pace,
        force: confirmDup,
      });
      setConfirmDup(false);
      setMsg({ text: '분석을 요청했어요. 보통 1~3분 뒤 목록 맨 위에 진행이 생겨요. 학습 노트도 같이 남습니다.', kind: 'ok' });
      setUrl('');
      setMemo('');
      setStartText('');
      setEndText('');
      setPace('normal');
      onRequested(r.jobId);
    } catch (err: any) {
      if (err && (err.code === 'NO_KEY' || err.status === 412)) onKeyMissing();
      if (err && err.code === 'DUPLICATE_ANALYSIS') {
        setConfirmDup(true);
        setMsg({ text: '이미 같은 영상·구간·속도로 분석했어요. 다시 분석하려면 "다시 분석"을 한 번 더 눌러 주세요.', kind: 'err' });
      } else {
        setMsg({ text: (err && err.message) || '요청 실패', kind: 'err' });
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  return (
    <form className={styles.editor} onSubmit={submit} data-testid="videoForm" noValidate>
      <p className={styles.intro}>
        코드 진행을 설명하거나 연주하는 영상을 넣으면 AI가 진행(코드·로마숫자·키·구간)을 뽑아 바로 모아 둡니다. 화면에 보이거나 말한
        코드를 우선하고, 짐작한 코드는 "추정"으로 표시돼요.
      </p>
      {!hasKey && (
        <div className={styles.keyGate} id="progKeyGate">
          <span>영상 분석에는 Gemini API 키가 필요해요.</span>
          <button type="button" className="ghostBtn" onClick={onOpenKeyModal}>
            🔑 1분 무료 키 발급
          </button>
          <SafeLink href="settings.html#keys">SETTING에서 등록 →</SafeLink>
        </div>
      )}
      <label className={styles.field}>
        <span className={styles.lab}>유튜브 링크</span>
        <input
          className="inpField"
          id="progVideoUrl"
          type="url"
          value={url}
          placeholder="https://www.youtube.com/watch?v=..."
          autoComplete="off"
          onChange={(e) => edited(setUrl)(e.target.value)}
        />
      </label>
      {vid && (
        <div className={styles.videoPreview}>
          <img src={thumb(vid)} alt="" />
          <span className="hint">영상을 확인했어요</span>
        </div>
      )}
      <div className={styles.grid2}>
        <label className={styles.field}>
          <span className={styles.lab}>
            시작 <span className="hint">(선택)</span>
          </span>
          <input
            className="inpField"
            id="progVideoStart"
            type="text"
            inputMode="numeric"
            value={startText}
            placeholder="1:20 또는 80"
            autoComplete="off"
            onChange={(e) => edited(setStartText)(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.lab}>
            끝 <span className="hint">(선택)</span>
          </span>
          <input
            className="inpField"
            id="progVideoEnd"
            type="text"
            inputMode="numeric"
            value={endText}
            placeholder="비우면 영상 끝까지"
            autoComplete="off"
            onChange={(e) => edited(setEndText)(e.target.value)}
          />
        </label>
      </div>
      <div className={styles.field}>
        <span className={styles.lab} id="progVideoPaceLab">
          코드 진행 변화
        </span>
        <div className={styles.segment} role="group" aria-labelledby="progVideoPaceLab" id="progVideoPace">
          {PACES.map((p) => (
            <button key={p} type="button" data-pace={p} aria-pressed={pace === p} onClick={() => edited(setPace)(p)}>
              {PACE_LABEL[p]}
            </button>
          ))}
        </div>
        <span className="hint">
          코드가 짧은 시간 안에 많이 바뀐다면 빠름을 권장해요. 빠름은 분석량이 많아 구간을 짧게 잡는 게 좋아요.
        </span>
      </div>
      <label className={styles.field}>
        <span className={styles.lab}>
          메모 <span className="hint">(선택)</span>
        </span>
        <textarea
          className="inpField"
          id="progVideoMemo"
          value={memo}
          maxLength={2000}
          placeholder="예: 2:10부터 나오는 후렴 진행 위주로"
          onChange={(e) => setMemo(e.target.value)}
        />
      </label>
      <div className={styles.actions}>
        <button className="pillBtn" type="submit" id="progVideoSubmit" disabled={sending || busy || !hasKey}>
          {busy ? '분석 중…' : confirmDup ? '다시 분석' : '분석 요청'}
        </button>
      </div>
      <p className={`msg${msg.kind ? ' ' + msg.kind : ''}`} role="status" id="progVideoMsg">
        {msg.text}
      </p>
    </form>
  );
}
