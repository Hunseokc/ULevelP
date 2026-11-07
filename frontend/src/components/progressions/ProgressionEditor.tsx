// CH-5: 진행 입력·수정 폼 (직접 입력 탭과 행 수정이 같이 쓴다)
// 코드 칩 미리보기 + 키 자동 추정(→ 드롭다운 확인) + 로마숫자 자동 계산
import React, { useMemo, useState } from 'react';
import type { ProgressionDto, ProgressionInput } from '../../lib/apiClient';
import {
  KEYS,
  KIND_LABEL,
  checkChord,
  computeRomans,
  formToCreate,
  formToPatch,
  keyCandidates,
  patchTurnsManual,
  splitChordInput,
  validateForm,
} from './model.mts';
import type { ProgressionForm } from './model.mts';
import styles from './Progressions.module.css';

export interface ProgressionEditorProps {
  initial: ProgressionForm;
  original?: ProgressionDto; // 있으면 수정(PATCH), 없으면 추가(POST)
  submitLabel: string;
  onSubmit: (body: ProgressionInput) => Promise<void>;
  onCancel?: () => void;
  idPrefix: string;
}

export function ProgressionEditor({
  initial,
  original,
  submitLabel,
  onSubmit,
  onCancel,
  idPrefix,
}: ProgressionEditorProps): React.ReactElement {
  const [form, setForm] = useState<ProgressionForm>(initial);
  // 새 입력은 사용자가 키를 고르기 전까지 추정 1등을 따라간다. 수정은 저장된 키 그대로
  const [keyTouched, setKeyTouched] = useState<boolean>(Boolean(original) || Boolean(initial.key));
  // 수정: 키를 안 바꾸고 "다시 계산"도 안 누르면 같은 자리·같은 심볼의 원래 roman(AI 값 포함)을 유지
  const [recalc, setRecalc] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: '' | 'ok' | 'err' }>({ text: '', kind: '' });
  const [saving, setSaving] = useState(false);

  const symbols = useMemo(() => splitChordInput(form.chordsText), [form.chordsText]);
  const guesses = useMemo(() => keyCandidates(symbols), [symbols]);
  const key = keyTouched ? form.key : guesses[0]?.key || '';
  const keepRomans = original && !recalc && key === (original.key || '') ? original.chords : undefined;
  const romans = useMemo(() => computeRomans(symbols, key, keepRomans), [symbols, key, keepRomans]);
  const checks = useMemo(() => symbols.map(checkChord), [symbols]);
  const badCount = checks.filter((c) => !c.ok).length;
  const fromVideo = Boolean(original && original.route !== 'manual');

  const set = <K extends keyof ProgressionForm>(k: K, v: ProgressionForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const fid = (name: string) => `${idPrefix}-${name}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const full = { ...form, key };
    const err = validateForm(full, symbols);
    if (err) {
      setMsg({ text: err, kind: 'err' });
      return;
    }
    let body: ProgressionInput;
    if (original) {
      body = formToPatch(full, symbols, romans, original);
      if (Object.keys(body).length === 0) {
        setMsg({ text: '바뀐 내용이 없습니다.', kind: '' });
        return;
      }
      if (patchTurnsManual(body, original) && !window.confirm('코드나 키를 고치면 출처가 "직접"으로 바뀌고 AI 근거 표시가 사라집니다. 저장할까요?')) {
        return;
      }
    } else {
      body = formToCreate(full, symbols, romans);
    }
    setSaving(true);
    setMsg({ text: '저장하는 중...', kind: '' });
    try {
      await onSubmit(body);
      setMsg({ text: '', kind: '' });
    } catch (ex: any) {
      setMsg({ text: (ex && ex.message) || '저장에 실패했어요.', kind: 'err' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={styles.editor} onSubmit={handleSubmit} data-testid={`${idPrefix}-form`} noValidate>
      <div className={styles.field}>
          <span className={styles.lab}>구분</span>
          <div className={styles.segment} role="group" aria-label="구분">
            {(['reference', 'analysis'] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={form.kind === k}
                disabled={k === 'reference' && fromVideo}
                title={k === 'reference' && fromVideo ? '영상에서 온 진행은 레퍼런스로 바꿀 수 없습니다.' : undefined}
                onClick={() => set('kind', k)}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <span className="hint">
            {form.kind === 'reference' ? '좋아하는 실제 곡의 진행' : '영상·공부에서 얻은 진행'}
          </span>
        </div>

      <div className={styles.grid2}>
        <label className={styles.field}>
          <span className={styles.lab}>{form.kind === 'reference' ? '곡 제목' : '제목'} <em>*</em></span>
          <input className="inpField" id={fid('title')} value={form.title} maxLength={300} onChange={(e) => set('title', e.target.value)} />
        </label>
        <label className={styles.field}>
          <span className={styles.lab}>
            아티스트 {form.kind === 'reference' ? <em>*</em> : <span className="hint">(선택)</span>}
          </span>
          <input className="inpField" id={fid('artist')} value={form.artist} maxLength={200} onChange={(e) => set('artist', e.target.value)} />
        </label>
      </div>

      <label className={styles.field}>
        <span className={styles.lab}>코드 <em>*</em></span>
        <input
          className="inpField"
          id={fid('chords')}
          value={form.chordsText}
          placeholder="FM7 - E7 - Am7 - Gm7 C7"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => set('chordsText', e.target.value)}
        />
        <span className="hint">- 나 공백으로 나눕니다. 입력한 표기 그대로 저장돼요.</span>
      </label>

      {symbols.length > 0 && (
        <ol className={styles.chips} aria-label="코드 미리보기" data-testid={`${idPrefix}-chips`}>
          {checks.map((c, i) => (
            <li key={i} className={`${styles.chip} ${c.ok ? '' : styles.chipBad}`} data-ok={c.ok ? '1' : '0'} title={c.warning || undefined}>
              <span className={styles.chipSym}>{c.symbol}</span>
              <span className={styles.chipRoman}>{romans[i] || (c.ok ? '–' : '?')}</span>
              {c.warning && <span className={styles.chipWarn}>{c.ok ? '⚠ ' : '✕ '}{c.warning}</span>}
            </li>
          ))}
        </ol>
      )}
      {badCount > 0 && (
        <p className={styles.warnLine} role="note">
          읽지 못한 코드 {badCount}개는 그대로 저장되지만 로마숫자·연습실 연주에서 빠집니다.
        </p>
      )}

      <div className={styles.grid2}>
        <label className={styles.field}>
          <span className={styles.lab}>키</span>
          <select
            className="inpField"
            id={fid('key')}
            value={key}
            onChange={(e) => {
              setKeyTouched(true);
              set('key', e.target.value);
            }}
          >
            <option value="">모름</option>
            {guesses.length > 0 && (
              <optgroup label="추정">
                {guesses.map((g, i) => (
                  <option key={'g' + g.key} value={g.key}>
                    {g.key}{i === 0 ? ' (추천)' : ''}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="전체">
              {KEYS.filter((k) => !guesses.some((g) => g.key === k)).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </optgroup>
          </select>
          <span className="hint" data-testid={`${idPrefix}-keyHint`}>
            {!keyTouched && guesses[0] ? '코드로 추정한 키예요. 다르면 골라 주세요.' : ' '}
          </span>
        </label>
        <div className={styles.field}>
          <span className={styles.lab}>로마숫자</span>
          <output className={styles.romanOut} id={fid('roman')}>
            {romans.some(Boolean) ? romans.map((r) => r || '?').join(' - ') : '키를 고르면 계산돼요'}
          </output>
          {original && keepRomans && (
            <button type="button" className={styles.linkBtn} onClick={() => setRecalc(true)}>
              로마숫자 다시 계산
            </button>
          )}
        </div>
      </div>

      <details className={styles.more} open={Boolean(initial.part || initial.moods || initial.genres || initial.tags || initial.url || initial.memo)}>
        <summary>더 적기 (구간·Mood·Genre·Tag·링크·메모)</summary>
        <div className={styles.grid2}>
          <label className={styles.field}>
            <span className={styles.lab}>진행 이름·구간</span>
            <input className="inpField" id={fid('part')} value={form.part} maxLength={100} placeholder="후렴, 인트로, 2-5-1 변형" onChange={(e) => set('part', e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.lab}>앨범</span>
            <input className="inpField" id={fid('album')} value={form.album} maxLength={200} onChange={(e) => set('album', e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.lab}>Mood</span>
            <input className="inpField" id={fid('moods')} value={form.moods} placeholder="nostalgia, dreamy" onChange={(e) => set('moods', e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.lab}>Genre</span>
            <input className="inpField" id={fid('genres')} value={form.genres} placeholder="RnB, Neo Soul" onChange={(e) => set('genres', e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.lab}>Tag</span>
            <input className="inpField" id={fid('tags')} value={form.tags} placeholder="쉼표로 나눔" onChange={(e) => set('tags', e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.lab}>발매일</span>
            <input className="inpField" id={fid('releaseDate')} type="date" min="1900-01-01" max="2100-12-31" value={form.releaseDate} onChange={(e) => set('releaseDate', e.target.value)} />
          </label>
        </div>
        <label className={styles.field}>
          <span className={styles.lab}>링크 (코드 사이트·영상)</span>
          <input className="inpField" id={fid('url')} type="url" value={form.url} maxLength={500} placeholder="https://" onChange={(e) => set('url', e.target.value)} />
        </label>
        <label className={styles.field}>
          <span className={styles.lab}>메모</span>
          <textarea className="inpField" id={fid('memo')} value={form.memo} maxLength={2000} onChange={(e) => set('memo', e.target.value)} />
        </label>
      </details>

      <div className={styles.actions}>
        <button className="pillBtn" type="submit" id={fid('submit')} disabled={saving}>
          {submitLabel}
        </button>
        {onCancel && (
          <button className="ghostBtn" type="button" onClick={onCancel} disabled={saving}>
            취소
          </button>
        )}
      </div>
      <p className={`msg${msg.kind ? ' ' + msg.kind : ''}`} role="status" id={fid('msg')}>
        {msg.text}
      </p>
    </form>
  );
}
