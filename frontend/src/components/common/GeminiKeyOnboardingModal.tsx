// frontend/src/components/common/GeminiKeyOnboardingModal.tsx
import React, { useEffect, useState } from 'react';
import { apiClient, IntegrationDto } from '../../lib/apiClient';
import { SafeLink } from './SafeLink';
import styles from './GeminiKeyOnboardingModal.module.css';

export const GEMINI_STUDIO_URL = 'https://aistudio.google.com/app/apikey';
export const GEMINI_KEY_REGEX = /^(AIza[0-9A-Za-z\-_]{35}|AQ\.[0-9A-Za-z\-_]{30,120})$/;

export interface GeminiKeyValidationResult {
  valid: boolean;
  trimmed: string;
  status: 'idle' | 'ok' | 'err';
  hint: string;
}

/** Gemini API 키 문자열을 trim()하고 형식(AIza+35자 또는 AQ.+30~120자)을 실시간 검사한다 */
export function validateGeminiKeyFormat(rawInput: string | null | undefined): GeminiKeyValidationResult {
  const trimmed = String(rawInput ?? '').trim();
  if (!trimmed) {
    return {
      valid: false,
      trimmed: '',
      status: 'idle',
      hint: 'AIza 또는 AQ.로 시작하는 API 키를 붙여넣어 주세요.',
    };
  }
  if (GEMINI_KEY_REGEX.test(trimmed)) {
    return {
      valid: true,
      trimmed,
      status: 'ok',
      hint: `✓ 형식이 올바릅니다 (${trimmed.length}자)`,
    };
  }
  return {
    valid: false,
    trimmed,
    status: 'err',
    hint: `AIza 또는 AQ.로 시작하는 키 전체를 복사해 주세요 (현재 ${trimmed.length}자)`,
  };
}

export interface GeminiKeyOnboardingModalProps {
  open: boolean;
  initialModel?: string;
  onClose: () => void;
  onSaved?: (dto: IntegrationDto) => void;
}

export function GeminiKeyOnboardingModal({
  open,
  initialModel = 'gemini-flash-latest',
  onClose,
  onSaved,
}: GeminiKeyOnboardingModalProps): React.ReactElement | null {
  const [rawKey, setRawKey] = useState('');
  const [model, setModel] = useState(initialModel || 'gemini-flash-latest');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resultMsg, setResultMsg] = useState('');
  const [resultKind, setResultKind] = useState<'' | 'ok' | 'err'>('');

  useEffect(() => {
    if (open) {
      setRawKey('');
      setModel(initialModel || 'gemini-flash-latest');
      setShowKey(false);
      setSaving(false);
      setResultMsg('');
      setResultKind('');
    }
  }, [open, initialModel]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, saving, onClose]);

  if (!open) return null;

  const validation = validateGeminiKeyFormat(rawKey);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validation.valid) {
      setResultKind('err');
      setResultMsg(validation.hint);
      return;
    }
    if (!apiClient.isLoggedIn()) {
      setResultKind('err');
      setResultMsg('로그인 후 Gemini API 키를 저장할 수 있어요.');
      return;
    }

    setSaving(true);
    setResultKind('');
    setResultMsg('Gemini API 키 유효성을 실시간으로 확인하는 중…');

    try {
      const dto = await apiClient.integrations.saveGemini({
        apiKey: validation.trimmed,
        model: model.trim() || 'gemini-flash-latest',
        verify: true,
      });
      const modelLabel = dto.displayName ? ` · ${dto.displayName}` : '';
      setResultKind('ok');
      setResultMsg(
        `✓ 연결 완료! 무료 Gemini 모델이 정상 작동합니다 (끝 4자리 ${dto.hint || ''}${modelLabel})`
      );
      setRawKey('');
      if (onSaved) {
        onSaved(dto);
      }
    } catch (err: any) {
      setResultKind('err');
      setResultMsg((err && err.message) || 'Gemini API 키 검증 및 저장에 실패했어요.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={styles.backdrop}
      id="geminiOnboardingModal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gemModalTitle"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className={styles.modal}>
        <div className={styles.head}>
          <div>
            <h2 className={styles.title} id="gemModalTitle">
              AI 기능을 무료로 이용하기 위한 1분 설정
            </h2>
            <p className={styles.sub}>
              Google의 무료 Gemini API 키를 연결하면 모든 영상 분석 기능을 제한 없이 이용하실 수 있습니다.
            </p>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            id="btnCloseGeminiModal"
            onClick={onClose}
            disabled={saving}
          >
            닫기 ✕
          </button>
        </div>

        <div className={styles.badges} aria-label="안심 포인트">
          <span className={styles.reassureBadge}>✓ 무료 사용 가능 (분당 15회 무료 요청)</span>
          <span className={styles.reassureBadge}>✓ 신용카드 등록 불필요</span>
          <span className={styles.reassureBadge}>
            🔒 AES-256-GCM 암호화 보관 (브라우저 localStorage에 키 원문 미저장)
          </span>
        </div>

        <div className={styles.stepsBox}>
          <ol className={styles.stepsList}>
            <li>
              <b>1단계 (Google AI Studio 접속):</b> 아래 버튼을 눌러 기존 구글 계정으로 로그인합니다.
            </li>
            <li>
              <b>2단계 (API 키 생성):</b> 화면 좌측 상단 또는 중앙의 <b>[Create API key]</b> 파란색 버튼을 누릅니다.
            </li>
            <li>
              <b>3단계 (프로젝트 선택):</b> 팝업창에서 <b>[Create API key in new project]</b>(새 프로젝트에서 키 만들기)를 선택합니다.
            </li>
            <li>
              <b>4단계 (키 복사 및 붙여넣기):</b> 생성된 <code>AIza...</code>로 시작하는 긴 문자열 옆의 <b>[Copy]</b>를 누른 뒤 아래 입력창에 붙여넣어 주세요.
            </li>
          </ol>
          <div className={styles.studioRow}>
            <SafeLink
              href={GEMINI_STUDIO_URL}
              external
              className="ghostBtn"
              id="btnOpenAiStudio"
            >
              Google AI Studio 키 발급 페이지 바로 열기 ↗
            </SafeLink>
          </div>
        </div>

        <form className={styles.fieldGroup} onSubmit={handleSave}>
          <label className={styles.fieldLabel} htmlFor="gemModalKeyInput">
            복사한 Gemini API 키 붙여넣기 (AIza...)
          </label>
          <div className={styles.inputRow}>
            <input
              id="gemModalKeyInput"
              className="inpField"
              type={showKey ? 'text' : 'password'}
              placeholder="AIza..."
              autoComplete="off"
              value={rawKey}
              onChange={(e) => setRawKey(e.target.value.trim())}
              disabled={saving}
            />
            <button
              type="button"
              className={styles.toggleBtn}
              id="btnToggleGeminiKeyVis"
              onClick={() => setShowKey((prev) => !prev)}
            >
              {showKey ? '숨기기' : '보기'}
            </button>
          </div>
          <p
            id="gemModalFormatHint"
            className={`${styles.hintText} ${
              validation.status === 'ok'
                ? styles.hintOk
                : validation.status === 'err'
                  ? styles.hintErr
                  : ''
            }`}
          >
            {validation.hint}
          </p>

          <p
            id="gemModalResultMsg"
            className={`msg${resultKind ? ' ' + resultKind : ''}`}
            role="status"
          >
            {resultMsg}
          </p>

          <div className={styles.actions}>
            <button
              type="button"
              className="ghostBtn"
              onClick={onClose}
              disabled={saving}
            >
              취소
            </button>
            <button
              type="submit"
              className="pillBtn"
              id="btnModalSaveGemini"
              disabled={saving || !validation.valid}
            >
              {saving ? '검증 및 저장 중…' : '키 검증 후 저장'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
