// frontend/src/pages/SettingsPage.tsx
import React, { useEffect, useRef, useState } from 'react';
import { AppShell } from '../components/layout/AppShell';
import { SafeLink } from '../components/common/SafeLink';
import { GeminiKeyOnboardingModal } from '../components/common/GeminiKeyOnboardingModal';
import { auth, useAuth } from '../lib/auth';
import { apiClient, IntegrationDto, NotionSyncStatusDto } from '../lib/apiClient';
import { drive } from '../lib/drive';
import { getTheme, raw, safeUrl, setTheme, THEME_EVENT } from '../lib/security';
import styles from './SettingsPage.module.css';

// 노션 DB 링크를 그대로 붙여넣어도 DB ID만 꺼낸다. ID는 마지막 경로 끝에 있고 ?v= 뒤는 보기 ID라 보지 않는다.
// URL이 아니거나 ID를 못 찾으면 입력 그대로(서버가 32자리 형식을 검증)
function notionDbIdFromInput(raw: string): string {
  const s = raw.trim();
  let pathname: string;
  try {
    pathname = new URL(s).pathname;
  } catch {
    return s;
  }
  const seg = pathname.split('/').filter(Boolean).pop() || '';
  const m = seg.match(/([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return m ? m[1] : s;
}

export function SettingsPage(): React.ReactElement {
  useEffect(() => {
    document.title = '설정 · ULeveLP';
  }, []);

  const authState = useAuth();
  const signedIn = Boolean(authState.user);
  const activeUid = authState.user?.id ?? null;
  const embedded = auth.isEmbedded();

  // 계정 상태
  const [accMsg, setAccMsg] = useState<{ text: string; kind: '' | 'ok' | 'err' }>({ text: '', kind: '' });
  const [delConfirm, setDelConfirm] = useState('');
  const [busyAuth, setBusyAuth] = useState(false);

  // Google Drive 저장소 상태
  const [driveMsg, setDriveMsg] = useState<{ text: string; kind: '' | 'ok' | 'err' }>({ text: '', kind: '' });
  const [busyDrive, setBusyDrive] = useState(false);

  // 노션 ZIP 입출력 상태
  const [exportAudio, setExportAudio] = useState(true);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  const [previewSummary, setPreviewSummary] = useState('');
  const [previewItems, setPreviewItems] = useState<Array<{ text: string; isErr?: boolean }>>([]);
  const [nxMsg, setNxMsg] = useState<{ text: string; kind: '' | 'ok' | 'err' }>({ text: '', kind: '' });
  const [busyNx, setBusyNx] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 외부 연동 키 상태
  const [notionStatusText, setNotionStatusText] = useState('미등록');
  const [notionHasKey, setNotionHasKey] = useState(false);
  const [ntnToken, setNtnToken] = useState('');
  const [ntnSongsDb, setNtnSongsDb] = useState('');
  const [ntnSessionsDb, setNtnSessionsDb] = useState('');
  const [ntnNotesDb, setNtnNotesDb] = useState('');
  const [ntnKeyMsg, setNtnKeyMsg] = useState<{ text: string; kind: '' | 'ok' | 'err' }>({ text: '', kind: '' });
  const [busyNtnKey, setBusyNtnKey] = useState(false);

  // 실시간 노션 동기화 상태
  const [syncState, setSyncState] = useState<NotionSyncStatusDto>({
    enabled: false,
    pending: 0,
    failed: 0,
  });
  const [syncStatusError, setSyncStatusError] = useState('');
  const [syncMsg, setSyncMsg] = useState<{ text: string; kind: '' | 'ok' | 'err' }>({ text: '', kind: '' });
  const [busySync, setBusySync] = useState(false);

  // Gemini 키 및 온보딩 모달 상태
  const [geminiStatusText, setGeminiStatusText] = useState('미등록');
  const [geminiHasKey, setGeminiHasKey] = useState(false);
  const [gemKey, setGemKey] = useState('');
  const [gemModel, setGemModel] = useState('');
  const [gemKeyMsg, setGemKeyMsg] = useState<{ text: string; kind: '' | 'ok' | 'err' }>({ text: '', kind: '' });
  const [busyGemKey, setBusyGemKey] = useState(false);
  const [geminiModalOpen, setGeminiModalOpen] = useState(false);

  // 고급 설정(노션) 접힘: 노션 관련 해시로 들어오면 펼친다
  const [advOpen, setAdvOpen] = useState(() => ['#advanced', '#notion', '#links'].includes(window.location.hash));
  // 노션 바로가기 및 화면 테마
  const [nlPractice, setNlPractice] = useState(() => raw.get('ulp:notion-practice'));
  const [nlNotes, setNlNotes] = useState(() => raw.get('ulp:notion-notes'));
  const [nlMsg, setNlMsg] = useState('');
  const [themeVal, setThemeVal] = useState<'light' | 'dark' | ''>(() => getTheme());
  useEffect(() => {
    const sync = () => setThemeVal(getTheme());
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);

  const keysReqSeqRef = useRef(0);
  const syncReqSeqRef = useRef(0);

  const resetAllUserFields = () => {
    setPreviewToken(null);
    setPreviewSummary('');
    setPreviewItems([]);
    setNxMsg({ text: '', kind: '' });
    if (fileInputRef.current) fileInputRef.current.value = '';
    setNotionStatusText('미등록');
    setNotionHasKey(false);
    setNtnToken('');
    setNtnSongsDb('');
    setNtnSessionsDb('');
    setNtnNotesDb('');
    setGeminiStatusText('미등록');
    setGeminiHasKey(false);
    setGemKey('');
    setGemModel('');
    setSyncState({ enabled: false, pending: 0, failed: 0 });
    setSyncStatusError('');
    setNtnKeyMsg({ text: '', kind: '' });
    setGemKeyMsg({ text: '', kind: '' });
    setSyncMsg({ text: '', kind: '' });
    setDriveMsg({ text: '', kind: '' });
  };

  const applyKeysList = (list: IntegrationDto[]) => {
    const arr = Array.isArray(list) ? list : [];
    const ntn = arr.find((it) => it.provider === 'notion');
    const gem = arr.find((it) => it.provider === 'gemini');

    if (ntn) {
      setNotionHasKey(true);
      setNotionStatusText(`설정됨 (끝 4자리 ${ntn.hint || ''} · ${(ntn.updatedAt || '').slice(0, 10)})`);
      const cfg = ntn.config || {};
      if (cfg.songsDb) setNtnSongsDb(String(cfg.songsDb));
      if (cfg.sessionsDb) setNtnSessionsDb(String(cfg.sessionsDb));
      setNtnNotesDb(cfg.notesDb ? String(cfg.notesDb) : '');
    } else {
      setNotionHasKey(false);
      setNotionStatusText('미등록');
      setNtnToken('');
      setNtnSongsDb('');
      setNtnSessionsDb('');
      setNtnNotesDb('');
    }

    if (gem) {
      setGeminiHasKey(true);
      setGeminiStatusText(`설정됨 (끝 4자리 ${gem.hint || ''} · ${(gem.updatedAt || '').slice(0, 10)})`);
      const cfg = gem.config || {};
      if (cfg.model) setGemModel(String(cfg.model));
    } else {
      setGeminiHasKey(false);
      setGeminiStatusText('미등록');
      setGemKey('');
      setGemModel('');
    }
  };

  const loadSyncStatusForUid = async (uid: string) => {
    const mySeq = ++syncReqSeqRef.current;
    try {
      const s = await apiClient.notionSync.status();
      if (activeUid !== uid || mySeq !== syncReqSeqRef.current) return;
      setSyncState(s || { enabled: false, pending: 0, failed: 0 });
      setSyncStatusError('');
    } catch (e: any) {
      if (activeUid !== uid || mySeq !== syncReqSeqRef.current) return;
      setSyncStatusError('연동 상태를 불러오지 못했어요.');
      setSyncMsg({ text: (e && e.message) || '연동 상태를 불러오지 못했어요.', kind: 'err' });
    }
  };

  useEffect(() => {
    resetAllUserFields();
    if (!activeUid) return;

    const myKeySeq = ++keysReqSeqRef.current;
    apiClient.integrations
      .list()
      .then((list) => {
        if (activeUid !== auth.getUser()?.id || myKeySeq !== keysReqSeqRef.current) return;
        applyKeysList(list);
      })
      .catch((e: any) => {
        if (activeUid !== auth.getUser()?.id || myKeySeq !== keysReqSeqRef.current) return;
        const msg = (e && e.message) || '연동 키 목록을 불러오지 못했어요.';
        setNtnKeyMsg({ text: msg, kind: 'err' });
        setGemKeyMsg({ text: msg, kind: 'err' });
      });

    void loadSyncStatusForUid(activeUid);
  }, [activeUid]);

  // 프로필 및 쿼터 계산
  const email = (authState.me && authState.me.email) || (authState.user && authState.user.email) || '';
  const displayName = (authState.me && authState.me.displayName) || '';
  const nameSuffix = displayName && displayName !== email.split('@')[0] ? `(${displayName})` : '';
  const quota = (authState.me && authState.me.takeQuotaBytes) || 209715200;
  const used = (authState.me && authState.me.takeUsedBytes) || 0;
  const quotaText = `${(used / 1048576).toFixed(1)}MB / ${Math.round(quota / 1048576)}MB`;
  const isDrive = Boolean(authState.me && authState.me.storageProvider === 'drive');

  // 공식 노션 템플릿 URL
  const winCfg = typeof window !== 'undefined' ? window.ULEVELP_CONFIG : undefined;
  const templateHref =
    (winCfg && winCfg.notionTemplateUrl && safeUrl(winCfg.notionTemplateUrl)) || 'https://www.notion.com';

  // 실시간 동기화 상태 문자열
  const formatSyncText = (): string => {
    if (syncStatusError) return syncStatusError;
    if (!syncState.enabled) return '연동 꺼짐';
    let txt = `실시간 연동 켜짐 · 대기 ${syncState.pending || 0}건 · 실패 ${syncState.failed || 0}건`;
    const parts: string[] = [];
    if (syncState.lastPushAt) parts.push('마지막 보냄: ' + syncState.lastPushAt.slice(0, 19).replace('T', ' '));
    if (syncState.lastPullAt) parts.push('마지막 가져옴: ' + syncState.lastPullAt.slice(0, 19).replace('T', ' '));
    if (parts.length > 0) txt += ` (${parts.join(', ')})`;
    return txt;
  };

  return (
    <AppShell variant="narrow" activeNav="settings" showThemeToggle>
      <div className={styles.headerBlock} data-align-group="col: left">
        <h1 className={`page-title ${styles.pageTitle}`}>Setting</h1>
        <p className={`page-sub ${styles.pageSub}`}>
          구글 계정으로 로그인하면 연습 기록과 녹음을 어디서나 이어갈 수 있어요.
        </p>
      </div>

      {/* 1. 계정 및 Google Drive 저장소 */}
      <section className={`set-sec ${styles.setSec}`} data-align-group="col: left; secs: right" id="account" aria-labelledby="hAccount">
        <h2 id="hAccount">계정</h2>
        <p id="accDesc">Google 계정으로 로그인하면 노션 설정 없이도 연습 곡과 녹음을 바로 저장할 수 있어요.</p>

        <div id="accGuest" className={styles.row} hidden={signedIn}>
          <button
            className="pillBtn"
            type="button"
            id="btnLogin"
            hidden={embedded}
            onClick={async () => {
              setAccMsg({ text: '', kind: '' });
              try {
                await auth.signIn(window.location.href);
              } catch (e: any) {
                setAccMsg({ text: (e && e.message) || '로그인을 시작하지 못했어요.', kind: 'err' });
              }
            }}
          >
            Google로 로그인
          </button>
          <SafeLink
            className="pillBtn"
            id="btnLoginBlank"
            href="settings.html#account"
            target="_blank"
            rel="noopener"
            hidden={!embedded}
          >
            새 창에서 로그인 ↗
          </SafeLink>
        </div>

        <div className={styles.stack} id="accUser" hidden={!signedIn}>
          <p>
            로그인 계정: <b id="accEmail">{email}</b>{' '}
            <span id="accName" className="hint">
              {nameSuffix}
            </span>
          </p>
          <div className={styles.field} id="accQuota">
            <span className={styles.lab}>
              녹음 저장 공간 (<span id="quotaText">{quotaText}</span>)
            </span>
            <progress className={`tl-bar ${styles.quotaBar}`} id="quotaBar" max={quota} value={used} />
          </div>

          <div className={styles.panel} id="driveStoragePanel">
            <h3>Google Drive 녹음 저장소</h3>
            <p className="hint">
              녹음 오디오를 개인 Google Drive의 <b>ULeveLP 녹음</b> 폴더에 직접 저장해요. 서비스 저장 공간(200MB)을 차지하지 않아요.
            </p>
            <p className="hint" id="driveProviderText">
              {authState.me
                ? isDrive
                  ? 'Google Drive 저장소 사용 중 (폴더: ULeveLP 녹음)'
                  : '기본 클라우드 저장소(200MB 쿼터) 사용 중'
                : ''}
            </p>
            <p className={`msg${driveMsg.kind ? ' ' + driveMsg.kind : ''}`} id="driveStatusMsg" role="status">
              {driveMsg.text}
            </p>
            <p className="msg err" id="driveConflictNotice" role="status" hidden={!syncState.enabled}>
              노션 실시간 연동이 켜져 있는 동안에는 Google Drive 저장소를 사용할 수 없습니다.
            </p>
            <div className={styles.row}>
              <button
                className="pillBtn"
                type="button"
                id="btnDriveEnable"
                hidden={isDrive}
                disabled={busyDrive || syncState.enabled}
                onClick={async () => {
                  setDriveMsg({ text: '', kind: '' });
                  setBusyDrive(true);
                  try {
                    await drive.enableDriveStorage();
                    setDriveMsg({ text: '✓ Google Drive 저장소로 전환되었어요.', kind: 'ok' });
                    await auth.fetchMe();
                  } catch (err: any) {
                    setDriveMsg({
                      text: (err && err.message) || 'Google Drive 저장소 전환에 실패했어요.',
                      kind: 'err',
                    });
                  } finally {
                    setBusyDrive(false);
                  }
                }}
              >
                Google Drive 저장소 사용
              </button>
              <button
                className="ghostBtn"
                type="button"
                id="btnDriveDisable"
                hidden={!isDrive}
                disabled={busyDrive}
                onClick={async () => {
                  setDriveMsg({ text: '', kind: '' });
                  setBusyDrive(true);
                  try {
                    await drive.disableDriveStorage();
                    setDriveMsg({ text: '✓ 기본 저장소로 전환되었어요.', kind: 'ok' });
                    await auth.fetchMe();
                  } catch (err: any) {
                    setDriveMsg({ text: (err && err.message) || '기본 저장소 전환에 실패했어요.', kind: 'err' });
                  } finally {
                    setBusyDrive(false);
                  }
                }}
              >
                기본 저장소로 전환
              </button>
              <button
                className="ghostBtn"
                type="button"
                id="btnDriveMigrate"
                hidden={!isDrive}
                disabled={busyDrive || syncState.enabled}
                onClick={async () => {
                  if (!window.confirm('기본 저장소에 저장된 기존 녹음들을 Google Drive로 이전할까요?')) return;
                  setBusyDrive(true);
                  setDriveMsg({ text: '녹음 파일 이전 중...', kind: '' });
                  try {
                    const res = await drive.migrateAllToDrive((p) => {
                      setDriveMsg({ text: `이전 진행 중... (${p.current} / ${p.total})`, kind: '' });
                    });
                    setDriveMsg({
                      text: `✓ 이전 완료: ${res.migrated}개 성공, ${res.skipped}개 건너뜀`,
                      kind: 'ok',
                    });
                    await auth.fetchMe();
                  } catch (err: any) {
                    setDriveMsg({ text: (err && err.message) || '녹음 파일 이전에 실패했어요.', kind: 'err' });
                  } finally {
                    setBusyDrive(false);
                  }
                }}
              >
                기존 녹음 전체를 Drive로 이전
              </button>
            </div>
          </div>

          <div className={styles.row}>
            <button
              className="ghostBtn"
              type="button"
              id="btnLogout"
              disabled={busyAuth}
              onClick={async () => {
                setBusyAuth(true);
                try {
                  await auth.signOut();
                  setAccMsg({ text: '✓ 로그아웃했어요', kind: 'ok' });
                } catch (e: any) {
                  setAccMsg({ text: (e && e.message) || '로그아웃 중 오류가 발생했어요.', kind: 'err' });
                } finally {
                  setBusyAuth(false);
                }
              }}
            >
              로그아웃
            </button>
          </div>

          <details>
            <summary>계정 삭제 (모든 연습 기록·녹음·연동 키 영구 삭제)</summary>
            <div className={`${styles.stackTight} ${styles.detailsBody}`}>
              <p className="hint">
                계정을 삭제하면 서비스에 저장된 모든 곡, 연습 기록, 녹음 오디오 파일, 외부 API 키가 즉시 삭제되며 복구할 수 없어요.
              </p>
              <label className={styles.field}>
                <span className={styles.lab}>
                  확인 문구 (<b>삭제합니다</b> 입력)
                </span>
                <input
                  className="inpField"
                  id="delConfirm"
                  placeholder="삭제합니다"
                  autoComplete="off"
                  value={delConfirm}
                  onChange={(e) => setDelConfirm(e.target.value)}
                />
              </label>
              <div className={styles.row}>
                <button
                  className="ghostBtn"
                  type="button"
                  id="btnDeleteAcc"
                  disabled={busyAuth}
                  onClick={async () => {
                    if (delConfirm.trim() !== '삭제합니다') {
                      setAccMsg({ text: '확인 문구로 "삭제합니다"를 정확히 입력해 주세요.', kind: 'err' });
                      return;
                    }
                    setBusyAuth(true);
                    setAccMsg({ text: '계정 삭제 처리 중…', kind: '' });
                    try {
                      await auth.deleteAccount(delConfirm.trim());
                      setDelConfirm('');
                      setAccMsg({ text: '✓ 계정이 삭제되었어요.', kind: 'ok' });
                    } catch (e: any) {
                      setAccMsg({ text: (e && e.message) || '계정 삭제에 실패했어요.', kind: 'err' });
                    } finally {
                      setBusyAuth(false);
                    }
                  }}
                >
                  계정 영구 삭제
                </button>
              </div>
            </div>
          </details>
        </div>

        <p className={`msg${accMsg.kind ? ' ' + accMsg.kind : ''}`} id="accMsg" role="status">
          {accMsg.text}
        </p>
        <p className="hint">
          <SafeLink href="privacy.html">개인정보처리방침</SafeLink>
        </p>
      </section>

      {/* 2. 데이터 백업 */}
      <section className={`set-sec ${styles.setSec}`} data-align-group="col: left; secs: right" id="nx" aria-labelledby="hNx">
        <h2 id="hNx">데이터 백업</h2>
        <p>서비스에 저장된 데이터를 ZIP으로 백업할 수 있어요.</p>
        <div className={styles.panel}>
          <h3>데이터 내보내기</h3>
          <p className="hint">
            서비스에 저장된 모든 곡, 연습 기록, 학습 영상 노트와 녹음 오디오를 ZIP으로 다운로드해요.
          </p>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              id="chkExportAudio"
              checked={exportAudio}
              onChange={(e) => setExportAudio(e.target.checked)}
            />
            <span>녹음 오디오 파일(.m4a 등) 함께 포함</span>
          </label>
          <div className={styles.row}>
            <button
              className="ghostBtn"
              type="button"
              id="btnExportZip"
              disabled={busyNx}
              onClick={async () => {
                if (!activeUid) {
                  setNxMsg({ text: '로그인 후 내보낼 수 있어요.', kind: 'err' });
                  return;
                }
                const reqUid = activeUid;
                setBusyNx(true);
                setNxMsg({ text: 'ZIP 내보내는 중…', kind: '' });
                try {
                  const res = await apiClient.nx.exportZip(exportAudio);
                  if (auth.getUser()?.id !== reqUid) return;
                  const url = URL.createObjectURL(res.blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = res.filename || 'ULeveLP-export.zip';
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                  setNxMsg({ text: '✓ 내보내기를 완료했어요.', kind: 'ok' });
                } catch (e: any) {
                  if (auth.getUser()?.id !== reqUid) return;
                  setNxMsg({ text: (e && e.message) || '내보내기 중 오류가 발생했어요.', kind: 'err' });
                } finally {
                  setBusyNx(false);
                }
              }}
            >
              백업 ZIP 다운로드
            </button>
          </div>
        </div>

        <p className={`msg${nxMsg.kind ? ' ' + nxMsg.kind : ''}`} id="nxMsg" role="status">
          {nxMsg.text}
        </p>
      </section>

      {/* 3. 외부 연동 키 관리 · BYOK */}
      <section className={`set-sec ${styles.setSec}`} data-align-group="col: left; secs: right" id="keys" aria-labelledby="hKeys">
        <h2 id="hKeys">외부 연동 키 관리 · BYOK</h2>
        <p>
          Google Gemini API 키를 등록하면 학습 노트 분석을 쓸 수 있어요. 키는 서버에 안전하게 암호화(AES-256-GCM)되어 보관돼요.
        </p>

        {/* Gemini 연동 카드 */}
        <div className={styles.panel}>
          <div className={styles.cardHead}>
            <h3 data-align-group="keyHead: center-y">Gemini 연동</h3>
            <span className={`${styles.badge}${geminiHasKey ? ' ' + styles.badgeOk : ''}`} id="geminiKeyStatus" data-align-group="keyHead: center-y">
              {geminiStatusText}
            </span>
          </div>
          <p className="hint">
            Google AI Studio에서 발급받은 무료 Gemini API 키를 등록해요. 키가 없다면 아래 1분 가이드로 바로 발급받을 수 있어요.
          </p>
          <div className={styles.row}>
            <button
              type="button"
              className={`ghostBtn ${styles.geminiGuideBtn}`}
              id="btnOpenGeminiModal"
              onClick={() => setGeminiModalOpen(true)}
            >
              🔑 무료 API 키 발급 가이드
            </button>
          </div>
          <label className={styles.field}>
            <span className={styles.lab}>Gemini API 키 (AIza...)</span>
            <input
              className="inpField"
              id="gemKey"
              type="password"
              placeholder="AIza… (비워두면 기존 키 유지)"
              autoComplete="off"
              value={gemKey}
              onChange={(e) => setGemKey(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.lab}>사용 모델</span>
            <input
              className="inpField"
              id="gemModel"
              type="text"
              placeholder="gemini-flash-latest"
              autoComplete="off"
              value={gemModel}
              onChange={(e) => setGemModel(e.target.value)}
            />
          </label>
          <div className={styles.row}>
            <button
              className="pillBtn"
              type="button"
              id="btnSaveGeminiKey"
              disabled={busyGemKey}
              onClick={async () => {
                if (!activeUid) {
                  setGemKeyMsg({ text: '로그인 후 키를 저장할 수 있어요.', kind: 'err' });
                  return;
                }
                const reqUid = activeUid;
                setBusyGemKey(true);
                setGemKeyMsg({ text: '저장 및 검증 중…', kind: '' });
                keysReqSeqRef.current++;
                try {
                  const dto = await apiClient.integrations.saveGemini({
                    apiKey: gemKey.trim() || null,
                    model: gemModel.trim() || undefined,
                  });
                  if (auth.getUser()?.id !== reqUid) return;
                  setGemKey('');
                  if (dto) {
                    setGeminiHasKey(true);
                    setGeminiStatusText(`설정됨 (끝 4자리 ${dto.hint || ''} · ${(dto.updatedAt || '').slice(0, 10)})`);
                    if (dto.config && dto.config.model) {
                      setGemModel(String(dto.config.model));
                    }
                  }
                  setGemKeyMsg({ text: '✓ Gemini 키를 저장했어요.', kind: 'ok' });
                } catch (e: any) {
                  if (auth.getUser()?.id !== reqUid) return;
                  setGemKeyMsg({ text: (e && e.message) || 'Gemini 키 저장에 실패했어요.', kind: 'err' });
                } finally {
                  setBusyGemKey(false);
                }
              }}
            >
              Gemini 키 저장
            </button>
            <button
              className="ghostBtn"
              type="button"
              id="btnCheckGeminiKey"
              disabled={busyGemKey}
              onClick={async () => {
                if (!activeUid) {
                  setGemKeyMsg({ text: '로그인 후 연결을 확인할 수 있어요.', kind: 'err' });
                  return;
                }
                const reqUid = activeUid;
                setBusyGemKey(true);
                setGemKeyMsg({ text: '연결 확인 중…', kind: '' });
                keysReqSeqRef.current++;
                try {
                  const r = await apiClient.integrations.check('gemini');
                  if (auth.getUser()?.id !== reqUid) return;
                  setGemKeyMsg({ text: `✓ 연결 성공 (${r.displayName || r.model || ''})`, kind: 'ok' });
                } catch (e: any) {
                  if (auth.getUser()?.id !== reqUid) return;
                  setGemKeyMsg({ text: (e && e.message) || 'Gemini 연결 확인에 실패했어요.', kind: 'err' });
                } finally {
                  setBusyGemKey(false);
                }
              }}
            >
              연결 확인
            </button>
            <button
              className="ghostBtn"
              type="button"
              id="btnDelGeminiKey"
              disabled={busyGemKey}
              onClick={async () => {
                if (!activeUid) {
                  setGemKeyMsg({ text: '로그인 후 연결을 해제할 수 있어요.', kind: 'err' });
                  return;
                }
                const reqUid = activeUid;
                setBusyGemKey(true);
                setGemKeyMsg({ text: '연결 해제 중…', kind: '' });
                keysReqSeqRef.current++;
                try {
                  await apiClient.integrations.remove('gemini');
                  if (auth.getUser()?.id !== reqUid) return;
                  setGeminiHasKey(false);
                  setGeminiStatusText('미등록');
                  setGemKey('');
                  setGemModel('');
                  setGemKeyMsg({ text: '✓ Gemini 연동을 해제했어요.', kind: 'ok' });
                } catch (e: any) {
                  if (auth.getUser()?.id !== reqUid) return;
                  setGemKeyMsg({ text: (e && e.message) || 'Gemini 연동 해제에 실패했어요.', kind: 'err' });
                } finally {
                  setBusyGemKey(false);
                }
              }}
            >
              연결 해제
            </button>
          </div>
          <p className={`msg${gemKeyMsg.kind ? ' ' + gemKeyMsg.kind : ''}`} id="gemKeyMsg" role="status">
            {gemKeyMsg.text}
          </p>
        </div>
      </section>

      {/* 4. 화면 모드 */}
      <section className={`set-sec ${styles.setSec}`} data-align-group="col: left; secs: right" id="screen" aria-labelledby="hScreen">
        <h2 id="hScreen">화면</h2>
        <div className={`seg-pill ${styles.segPill}`} role="group" aria-label="화면 모드">
          {(
            [
              ['', '시스템'],
              ['light', '라이트'],
              ['dark', '다크'],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val || 'sys'}
              type="button"
              className={styles.segBtn}
              data-theme={val}
              aria-pressed={themeVal === val}
              onClick={() => {
                setTheme(val);
                setThemeVal(val);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* 6. 고급 설정 — 노션 연동(2026-11-05 중단·동결: 새 기능 없음, 계획/앱_명세.md §5). 기본 접힘 */}
      <section className={`set-sec ${styles.setSec}`} data-align-group="col: left; secs: right" id="advanced" aria-labelledby="hAdvanced">
        <details
          className={styles.advanced}
          id="advNotion"
          open={advOpen}
          onToggle={(e) => setAdvOpen((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary id="hAdvanced">고급 설정 › 웹/노션 연동 (선택)</summary>
          <div className={styles.advBody}>
            <p className="hint">
              노션 연동은 더 이상 새 기능이 붙지 않아요(곡·연습 기록·녹음·노트만, 코드 진행은 보내지 않아요). 이미 쓰고 있다면 여기서 관리하세요.
            </p>
            <div className={styles.panel}>
              <h3>노션 템플릿</h3>
              <div className={styles.row}>
                <SafeLink className="ghostBtn" id="btnNotionTemplate" href={templateHref} external>
                  공식 노션 템플릿 복제하기 ↗
                </SafeLink>
              </div>
            </div>
            {/* 노션 연동 카드 */}
            <div className={styles.panel} id="notion">
              <div className={styles.cardHead}>
                <h3>노션 연동</h3>
                <span className={`${styles.badge}${notionHasKey ? ' ' + styles.badgeOk : ''}`} id="notionKeyStatus">
                  {notionStatusText}
                </span>
              </div>
              <ol className={`hint ${styles.guide}`} id="ntnGuide">
                <li>
                  <SafeLink href={templateHref} external>공식 노션 템플릿</SafeLink>을 열고 오른쪽 위 <b>복제</b>를 눌러 내 노션에 가져와요.
                </li>
                <li>
                  <SafeLink href="https://www.notion.so/my-integrations" external>notion.so/my-integrations</SafeLink>에서 새 통합을 만들고 토큰(ntn_…)을 복사해 아래에 붙여넣어요.
                </li>
                <li>복제한 페이지 오른쪽 위 <b>···</b> → <b>연결</b> → 방금 만든 통합을 추가해요.</li>
                <li>
                  페이지 안 DB(<b>연습 곡</b>·<b>연습 기록</b>·<b>학습 영상 노트</b>) 제목을 눌러 전체 페이지로 연 뒤, 주소창 링크를 복사해 아래 칸에 각각 붙여넣어요. 링크 그대로 넣어도 돼요.
                </li>
                <li><b>노션 키 저장</b> → <b>연결 확인</b>을 눌러요.</li>
              </ol>
              <label className={styles.field}>
                <span className={styles.lab}>노션 통합 토큰 (ntn_...)</span>
                <input
                  className="inpField"
                  id="ntnToken"
                  type="password"
                  placeholder="ntn_… (비워두면 기존 키 유지)"
                  autoComplete="off"
                  value={ntnToken}
                  onChange={(e) => setNtnToken(e.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.lab}>연습 곡 데이터베이스 ID</span>
                <input
                  className="inpField"
                  id="ntnSongsDb"
                  type="text"
                  placeholder="DB 링크 또는 32자리 ID"
                  autoComplete="off"
                  value={ntnSongsDb}
                  onChange={(e) => setNtnSongsDb(e.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.lab}>연습 기록 데이터베이스 ID</span>
                <input
                  className="inpField"
                  id="ntnSessionsDb"
                  type="text"
                  placeholder="DB 링크 또는 32자리 ID"
                  autoComplete="off"
                  value={ntnSessionsDb}
                  onChange={(e) => setNtnSessionsDb(e.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.lab}>학습 영상 노트 데이터베이스 ID (선택)</span>
                <input
                  className="inpField"
                  id="ntnNotesDb"
                  type="text"
                  placeholder="DB 링크 또는 32자리 ID (선택)"
                  autoComplete="off"
                  value={ntnNotesDb}
                  onChange={(e) => setNtnNotesDb(e.target.value)}
                />
              </label>
              <div className={styles.row}>
                <button
                  className="pillBtn"
                  type="button"
                  id="btnSaveNotionKey"
                  disabled={busyNtnKey}
                  onClick={async () => {
                    if (!activeUid) {
                      setNtnKeyMsg({ text: '로그인 후 키를 저장할 수 있어요.', kind: 'err' });
                      return;
                    }
                    const reqUid = activeUid;
                    setBusyNtnKey(true);
                    setNtnKeyMsg({ text: '저장 중…', kind: '' });
                    keysReqSeqRef.current++;
                    try {
                      const dto = await apiClient.integrations.saveNotion({
                        token: ntnToken.trim() || null,
                        songsDb: notionDbIdFromInput(ntnSongsDb),
                        sessionsDb: notionDbIdFromInput(ntnSessionsDb),
                        notesDb: notionDbIdFromInput(ntnNotesDb) || null,
                      });
                      if (auth.getUser()?.id !== reqUid) return;
                      setNtnToken('');
                      if (dto) {
                        setNotionHasKey(true);
                        setNotionStatusText(`설정됨 (끝 4자리 ${dto.hint || ''} · ${(dto.updatedAt || '').slice(0, 10)})`);
                        if (dto.config) {
                          if (dto.config.songsDb) setNtnSongsDb(String(dto.config.songsDb));
                          if (dto.config.sessionsDb) setNtnSessionsDb(String(dto.config.sessionsDb));
                          setNtnNotesDb(dto.config.notesDb ? String(dto.config.notesDb) : '');
                        }
                      }
                      setNtnKeyMsg({ text: '✓ 노션 키를 저장했어요.', kind: 'ok' });
                      void loadSyncStatusForUid(reqUid);
                    } catch (e: any) {
                      if (auth.getUser()?.id !== reqUid) return;
                      setNtnKeyMsg({ text: (e && e.message) || '노션 키 저장에 실패했어요.', kind: 'err' });
                    } finally {
                      setBusyNtnKey(false);
                    }
                  }}
                >
                  노션 키 저장
                </button>
                <button
                  className="ghostBtn"
                  type="button"
                  id="btnCheckNotionKey"
                  disabled={busyNtnKey}
                  onClick={async () => {
                    if (!activeUid) {
                      setNtnKeyMsg({ text: '로그인 후 연결을 확인할 수 있어요.', kind: 'err' });
                      return;
                    }
                    const reqUid = activeUid;
                    setBusyNtnKey(true);
                    setNtnKeyMsg({ text: '연결 확인 중…', kind: '' });
                    keysReqSeqRef.current++;
                    try {
                      const r = await apiClient.integrations.check('notion');
                      if (auth.getUser()?.id !== reqUid) return;
                      const notesPart = r.notesTitle ? ` · ${r.notesTitle}` : '';
                      setNtnKeyMsg({
                        text: `✓ 연결 성공 (${r.songsTitle || ''} · ${r.sessionsTitle || ''}${notesPart} · 파일 ${
                          r.maxUploadMB || 5
                        }MB까지)`,
                        kind: 'ok',
                      });
                    } catch (e: any) {
                      if (auth.getUser()?.id !== reqUid) return;
                      setNtnKeyMsg({ text: (e && e.message) || '노션 연결 확인에 실패했어요.', kind: 'err' });
                    } finally {
                      setBusyNtnKey(false);
                    }
                  }}
                >
                  연결 확인
                </button>
                <button
                  className="ghostBtn"
                  type="button"
                  id="btnDelNotionKey"
                  disabled={busyNtnKey}
                  onClick={async () => {
                    if (!activeUid) {
                      setNtnKeyMsg({ text: '로그인 후 연결을 해제할 수 있어요.', kind: 'err' });
                      return;
                    }
                    const reqUid = activeUid;
                    setBusyNtnKey(true);
                    setNtnKeyMsg({ text: '연결 해제 중…', kind: '' });
                    keysReqSeqRef.current++;
                    try {
                      await apiClient.integrations.remove('notion');
                      if (auth.getUser()?.id !== reqUid) return;
                      setNotionHasKey(false);
                      setNotionStatusText('미등록');
                      setNtnToken('');
                      setNtnSongsDb('');
                      setNtnSessionsDb('');
                      setNtnNotesDb('');
                      setSyncState({ enabled: false, pending: 0, failed: 0 });
                      setNtnKeyMsg({ text: '✓ 노션 연동을 해제했어요.', kind: 'ok' });
                      void loadSyncStatusForUid(reqUid);
                    } catch (e: any) {
                      if (auth.getUser()?.id !== reqUid) return;
                      setNtnKeyMsg({ text: (e && e.message) || '노션 연동 해제에 실패했어요.', kind: 'err' });
                    } finally {
                      setBusyNtnKey(false);
                    }
                  }}
                >
                  연결 해제
                </button>
              </div>
              <p className={`msg${ntnKeyMsg.kind ? ' ' + ntnKeyMsg.kind : ''}`} id="ntnKeyMsg" role="status">
                {ntnKeyMsg.text}
              </p>

              <div className={styles.stackTight} id="notionSyncPanel">
                <p className="hint" id="syncStatusText">
                  {formatSyncText()}
                </p>
                <p className="hint" id="syncErrorText" hidden={!syncState.lastError}>
                  {syncState.lastError ? `오류: ${syncState.lastError}` : ''}
                </p>
                <div className={styles.row}>
                  <button
                    className="pillBtn"
                    type="button"
                    id="btnSyncEnable"
                    hidden={syncState.enabled}
                    disabled={busySync}
                    onClick={async () => {
                      if (!activeUid) {
                        setSyncMsg({ text: '로그인이 필요해요.', kind: 'err' });
                        return;
                      }
                      const reqUid = activeUid;
                      setBusySync(true);
                      setSyncMsg({ text: '기존 노션 데이터를 이관하고 연동을 켜는 중…', kind: '' });
                      try {
                        syncReqSeqRef.current++;
                        const res = await apiClient.notionSync.enable();
                        if (auth.getUser()?.id !== reqUid) return;
                        const quotaPart = res.skippedTakesByQuota
                          ? `, 용량 초과 건너뜀 ${res.skippedTakesByQuota}개`
                          : '';
                        setSyncMsg({
                          text: `✓ 연동이 켜졌어요 (곡 ${res.importedSongs}개, 세션 ${res.importedSessions}개, 녹음 ${res.importedTakes}개 이관${quotaPart})`,
                          kind: 'ok',
                        });
                        await loadSyncStatusForUid(reqUid);
                      } catch (e: any) {
                        if (auth.getUser()?.id !== reqUid) return;
                        setSyncMsg({ text: (e && e.message) || '연동 켜기에 실패했어요.', kind: 'err' });
                      } finally {
                        setBusySync(false);
                      }
                    }}
                  >
                    연동 켜기 (노션 데이터 이관)
                  </button>
                  <button
                    className="ghostBtn"
                    type="button"
                    id="btnSyncDisable"
                    hidden={!syncState.enabled}
                    disabled={busySync}
                    onClick={async () => {
                      if (!activeUid) {
                        setSyncMsg({ text: '로그인이 필요해요.', kind: 'err' });
                        return;
                      }
                      const reqUid = activeUid;
                      setBusySync(true);
                      setSyncMsg({ text: '연동을 끄는 중…', kind: '' });
                      try {
                        syncReqSeqRef.current++;
                        await apiClient.notionSync.disable();
                        if (auth.getUser()?.id !== reqUid) return;
                        setSyncMsg({ text: '✓ 연동을 껐어요.', kind: 'ok' });
                        await loadSyncStatusForUid(reqUid);
                      } catch (e: any) {
                        if (auth.getUser()?.id !== reqUid) return;
                        setSyncMsg({ text: (e && e.message) || '연동 끄기에 실패했어요.', kind: 'err' });
                      } finally {
                        setBusySync(false);
                      }
                    }}
                  >
                    연동 끄기
                  </button>
                  <button
                    className="ghostBtn"
                    type="button"
                    id="btnSyncPull"
                    disabled={busySync}
                    onClick={async () => {
                      if (!activeUid) {
                        setSyncMsg({ text: '로그인이 필요해요.', kind: 'err' });
                        return;
                      }
                      const reqUid = activeUid;
                      setBusySync(true);
                      setSyncMsg({ text: '노션에서 변경사항을 가져오는 중…', kind: '' });
                      try {
                        syncReqSeqRef.current++;
                        const res = await apiClient.notionSync.pull();
                        if (auth.getUser()?.id !== reqUid) return;
                        setSyncMsg({
                          text: `✓ 노션에서 가져왔어요 (곡 ${res.updatedSongs}개, 세션 ${res.updatedSessions}개 갱신)`,
                          kind: 'ok',
                        });
                        await loadSyncStatusForUid(reqUid);
                      } catch (e: any) {
                        if (auth.getUser()?.id !== reqUid) return;
                        setSyncMsg({ text: (e && e.message) || '노션에서 가져오기에 실패했어요.', kind: 'err' });
                      } finally {
                        setBusySync(false);
                      }
                    }}
                  >
                    지금 노션에서 가져오기
                  </button>
                  <button
                    className="ghostBtn"
                    type="button"
                    id="btnSyncPush"
                    disabled={busySync}
                    onClick={async () => {
                      if (!activeUid) {
                        setSyncMsg({ text: '로그인이 필요해요.', kind: 'err' });
                        return;
                      }
                      const reqUid = activeUid;
                      setBusySync(true);
                      setSyncMsg({ text: '노션으로 변경사항을 보내는 중…', kind: '' });
                      try {
                        syncReqSeqRef.current++;
                        const res = await apiClient.notionSync.push();
                        if (auth.getUser()?.id !== reqUid) return;
                        setSyncMsg({
                          text: `✓ 노션으로 보냈어요 (처리 ${res.processed}건, 실패 ${res.failed}건)`,
                          kind: 'ok',
                        });
                        await loadSyncStatusForUid(reqUid);
                      } catch (e: any) {
                        if (auth.getUser()?.id !== reqUid) return;
                        setSyncMsg({ text: (e && e.message) || '노션으로 보내기에 실패했어요.', kind: 'err' });
                      } finally {
                        setBusySync(false);
                      }
                    }}
                  >
                    지금 노션으로 보내기
                  </button>
                </div>
                <p className={`msg${syncMsg.kind ? ' ' + syncMsg.kind : ''}`} id="syncMsg" role="status">
                  {syncMsg.text}
                </p>
              </div>
            </div>

            <div className={styles.panel}>
              <h3>노션 백업 가져오기</h3>
              <p className="hint">노션에서 내보낸 Markdown &amp; CSV 백업 ZIP 파일을 올려 곡과 연습 기록을 복원해요.</p>
              <label className={styles.field}>
                <span className={styles.lab}>노션 백업 ZIP 파일 (Markdown &amp; CSV 내보내기 파일)</span>
                <input
                  ref={fileInputRef}
                  className={styles.fileInput}
                  type="file"
                  id="inpImportZip"
                  accept=".zip,application/zip"
                  onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                />
              </label>
              <div className={styles.row}>
                <button
                  className="ghostBtn"
                  type="button"
                  id="btnPreviewZip"
                  disabled={busyNx}
                  onClick={async () => {
                    if (!activeUid) {
                      setNxMsg({ text: '로그인 후 가져올 수 있어요.', kind: 'err' });
                      return;
                    }
                    if (!importFile) {
                      setNxMsg({ text: 'ZIP 파일을 선택해 주세요.', kind: 'err' });
                      return;
                    }
                    const reqUid = activeUid;
                    setBusyNx(true);
                    setNxMsg({ text: 'ZIP 분석 중…', kind: '' });
                    try {
                      const r = await apiClient.nx.previewNotionZip(importFile);
                      if (auth.getUser()?.id !== reqUid) return;
                      setPreviewToken(r.previewToken);
                      const errSuffix =
                        Array.isArray(r.errors) && r.errors.length > 0 ? ` (오류 ${r.errors.length}건)` : '';
                      setPreviewSummary(
                        `신규 곡 ${r.newSongs || 0}개 · 갱신 곡 ${r.updatedSongs || 0}개 · 연습 기록 ${
                          r.sessions || 0
                        }건 · 녹음 ${r.takes || 0}건${errSuffix}`
                      );
                      const rows: Array<{ text: string; isErr?: boolean }> = [];
                      if (Array.isArray(r.songsSample)) {
                        r.songsSample.forEach((s: any) => {
                          const tag = s.isNew ? '[신규] ' : '[갱신] ';
                          rows.push({
                            text: `${tag}${s.title || '(제목 없음)'}${s.artist ? ' · ' + s.artist : ''}`,
                          });
                        });
                      }
                      if (Array.isArray(r.errors)) {
                        r.errors.forEach((er: any) => {
                          rows.push({
                            text: `[오류] ${er.file || '파일'} ${er.row != null ? er.row + '행: ' : ''}${er.reason || ''}`,
                            isErr: true,
                          });
                        });
                      }
                      setPreviewItems(rows);
                      setNxMsg({ text: '', kind: '' });
                    } catch (e: any) {
                      if (auth.getUser()?.id !== reqUid) return;
                      setPreviewToken(null);
                      setPreviewItems([]);
                      setNxMsg({ text: (e && e.message) || '미리보기 중 오류가 발생했어요.', kind: 'err' });
                    } finally {
                      setBusyNx(false);
                    }
                  }}
                >
                  가져오기 미리보기
                </button>
              </div>

              <div className={styles.previewBox} id="nxPreviewBox" hidden={!previewToken}>
                <p className={styles.previewSummary} id="nxPreviewSummary">
                  {previewSummary}
                </p>
                <ul className={styles.previewList} id="nxPreviewList">
                  {previewItems.map((it, idx) => (
                    <li key={idx} className={it.isErr ? styles.previewItemErr : undefined}>
                      {it.text}
                    </li>
                  ))}
                </ul>
                <div className={styles.row}>
                  <button
                    className="pillBtn"
                    type="button"
                    id="btnConfirmZip"
                    disabled={busyNx}
                    onClick={async () => {
                      if (!previewToken) {
                        setNxMsg({ text: '미리보기 내역이 없습니다. 다시 ZIP을 선택해 주세요.', kind: 'err' });
                        return;
                      }
                      const reqUid = activeUid;
                      setBusyNx(true);
                      setNxMsg({ text: '가져오기 반영 중…', kind: '' });
                      try {
                        const r = await apiClient.nx.confirmNotionZip(previewToken);
                        if (auth.getUser()?.id !== reqUid) return;
                        setNxMsg({
                          text: `✓ 가져오기를 완료했어요 (신규 곡 ${r.createdSongs || 0}개, 갱신 ${
                            r.updatedSongs || 0
                          }개, 기록 ${r.upsertedSessions || 0}건, 녹음 ${r.importedTakes || 0}건)`,
                          kind: 'ok',
                        });
                        setPreviewToken(null);
                        setPreviewItems([]);
                        setImportFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      } catch (e: any) {
                        if (auth.getUser()?.id !== reqUid) return;
                        setNxMsg({ text: (e && e.message) || '가져오기 확정 중 오류가 발생했어요.', kind: 'err' });
                      } finally {
                        setBusyNx(false);
                      }
                    }}
                  >
                    가져오기 확정
                  </button>
                  <button
                    className="ghostBtn"
                    type="button"
                    id="btnCancelZip"
                    disabled={busyNx}
                    onClick={() => {
                      setPreviewToken(null);
                      setPreviewItems([]);
                      setNxMsg({ text: '가져오기를 취소했어요.', kind: '' });
                    }}
                  >
                    취소
                  </button>
                </div>
              </div>
            </div>

          <div className={styles.panel} id="links">
            <h3 id="hLinks">노션 바로가기</h3>
            <p>
              첫 화면의 NOTION과 NOTES 페이지에서 여는 링크예요. 노션에서 페이지 <b>링크 복사</b>로 가져오세요. 비워 두면 숨겨져요.
            </p>
            <label className={styles.field}>
              <span className={styles.lab}>악기 연습 페이지</span>
              <input
                className="inpField"
                id="nlPractice"
                type="url"
                placeholder="https://www.notion.so/…"
                autoComplete="off"
                value={nlPractice}
                onChange={(e) => setNlPractice(e.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.lab}>학습 영상 노트 데이터베이스</span>
              <input
                className="inpField"
                id="nlNotes"
                type="url"
                placeholder="https://www.notion.so/…"
                autoComplete="off"
                value={nlNotes}
                onChange={(e) => setNlNotes(e.target.value)}
              />
            </label>
            <div className={styles.row}>
              <button
                className="ghostBtn"
                type="button"
                id="nlSave"
                onClick={() => {
                  raw.set('ulp:notion-practice', nlPractice.trim());
                  raw.set('ulp:notion-notes', nlNotes.trim());
                  setNlMsg('✓ 저장했어요');
                }}
              >
                저장
              </button>
            </div>
            <p className={`msg${nlMsg ? ' ok' : ''}`} id="nlMsg" role="status">
              {nlMsg}
            </p>
          </div>

          </div>
        </details>
      </section>

      <GeminiKeyOnboardingModal
        open={geminiModalOpen}
        initialModel={gemModel || 'gemini-flash-latest'}
        onClose={() => setGeminiModalOpen(false)}
        onSaved={(dto) => {
          setGeminiHasKey(true);
          setGeminiStatusText(`설정됨 (끝 4자리 ${dto.hint || ''} · ${(dto.updatedAt || '').slice(0, 10)})`);
          if (dto.config && dto.config.model) {
            setGemModel(String(dto.config.model));
          }
          setGemKeyMsg({
            text: `✓ 연결 완료! 무료 Gemini 모델이 정상 작동합니다 (끝 4자리 ${dto.hint || ''})`,
            kind: 'ok',
          });
        }}
      />
    </AppShell>
  );
}

export default SettingsPage;
