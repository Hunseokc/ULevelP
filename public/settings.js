// 설정(settings.html): 계정(로그인·로그아웃·계정 삭제), 노션 연결, 학습 노트 토큰, 노션 바로가기, 화면 모드
'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const { raw, json, safeUrl } = UL;
  const auth = window.ULAuth;
  function say(id, text, cls) { $(id).textContent = text; $(id).className = 'msg' + (cls ? ' ' + cls : ''); }

  // ---------- 노션 템플릿 · 데이터 내보내기/가져오기 (K3-1) ----------
  let currentPreviewToken = null;
  let activeUid = null;
  let keysReqSeq = 0;

  function resetNotionFields() {
    if ($('notionKeyStatus')) {
      $('notionKeyStatus').textContent = '미등록';
      $('notionKeyStatus').className = 'badge';
    }
    if ($('ntnToken')) $('ntnToken').value = '';
    if ($('ntnSongsDb')) $('ntnSongsDb').value = '';
    if ($('ntnSessionsDb')) $('ntnSessionsDb').value = '';
    if ($('ntnNotesDb')) $('ntnNotesDb').value = '';
  }

  function resetGeminiFields() {
    if ($('geminiKeyStatus')) {
      $('geminiKeyStatus').textContent = '미등록';
      $('geminiKeyStatus').className = 'badge';
    }
    if ($('gemKey')) $('gemKey').value = '';
    if ($('gemModel')) $('gemModel').value = '';
  }

  function renderKeys(list) {
    list = Array.isArray(list) ? list : [];
    const notionItem = list.find((it) => it.provider === 'notion');
    const geminiItem = list.find((it) => it.provider === 'gemini');

    if (notionItem) {
      if ($('notionKeyStatus')) {
        $('notionKeyStatus').textContent = '설정됨 (끝 4자리 ' + (notionItem.hint || '') + ' · ' + (notionItem.updatedAt || '').slice(0, 10) + ')';
        $('notionKeyStatus').className = 'badge ok';
      }
      const cfg = notionItem.config || {};
      if ($('ntnSongsDb') && cfg.songsDb) $('ntnSongsDb').value = cfg.songsDb;
      if ($('ntnSessionsDb') && cfg.sessionsDb) $('ntnSessionsDb').value = cfg.sessionsDb;
      if ($('ntnNotesDb')) $('ntnNotesDb').value = cfg.notesDb || '';
    } else {
      resetNotionFields();
    }

    if (geminiItem) {
      if ($('geminiKeyStatus')) {
        $('geminiKeyStatus').textContent = '설정됨 (끝 4자리 ' + (geminiItem.hint || '') + ' · ' + (geminiItem.updatedAt || '').slice(0, 10) + ')';
        $('geminiKeyStatus').className = 'badge ok';
      }
      const cfg = geminiItem.config || {};
      if ($('gemModel') && cfg.model) $('gemModel').value = cfg.model;
    } else {
      resetGeminiFields();
    }
  }

  async function loadKeys(uid) {
    if (!window.ULData || !window.ULData.integrations) return;
    const seq = ++keysReqSeq;
    try {
      const list = await window.ULData.integrations.list();
      if (!activeUid || activeUid !== uid || seq !== keysReqSeq) return;
      renderKeys(list);
    } catch (e) {
      if (!activeUid || activeUid !== uid || seq !== keysReqSeq) return;
      const msg = (e && e.message) || '연동 키 목록을 불러오지 못했어요.';
      if ($('ntnKeyMsg')) say('ntnKeyMsg', msg, 'err');
      if ($('gemKeyMsg')) say('gemKeyMsg', msg, 'err');
    }
  }

  let syncReqSeq = 0;
  let notionSyncEnabled = false;

  function renderSyncStatus(s) {
    notionSyncEnabled = !!(s && s.enabled);
    if ($('syncStatusText')) {
      if (!notionSyncEnabled) {
        $('syncStatusText').textContent = '연동 꺼짐';
        if ($('btnSyncEnable')) $('btnSyncEnable').hidden = false;
        if ($('btnSyncDisable')) $('btnSyncDisable').hidden = true;
      } else {
        let txt = '실시간 연동 켜짐 · 대기 ' + (s.pending || 0) + '건 · 실패 ' + (s.failed || 0) + '건';
        const parts = [];
        if (s.lastPushAt) parts.push('마지막 보냄: ' + s.lastPushAt.slice(0, 19).replace('T', ' '));
        if (s.lastPullAt) parts.push('마지막 가져옴: ' + s.lastPullAt.slice(0, 19).replace('T', ' '));
        if (parts.length > 0) txt += ' (' + parts.join(', ') + ')';
        $('syncStatusText').textContent = txt;
        if ($('btnSyncEnable')) $('btnSyncEnable').hidden = true;
        if ($('btnSyncDisable')) $('btnSyncDisable').hidden = false;
      }
    }
    if ($('syncErrorText')) {
      if (s && s.lastError) {
        $('syncErrorText').textContent = '오류: ' + s.lastError;
        $('syncErrorText').hidden = false;
      } else {
        $('syncErrorText').textContent = '';
        $('syncErrorText').hidden = true;
      }
    }
    renderDrivePanel(auth && typeof auth.getMe === 'function' ? auth.getMe() : null);
  }

  async function loadSyncStatus(uid) {
    if (!window.ULData || !window.ULData.notionSync) return;
    const seq = ++syncReqSeq;
    try {
      const s = await window.ULData.notionSync.status();
      if (!activeUid || activeUid !== uid || seq !== syncReqSeq) return;
      renderSyncStatus(s);
    } catch (e) {
      if (!activeUid || activeUid !== uid || seq !== syncReqSeq) return;
      if ($('syncStatusText')) {
        $('syncStatusText').textContent = '연동 상태를 불러오지 못했어요.';
      }
      say('syncMsg', (e && e.message) ? e.message : '연동 상태를 불러오지 못했어요.', 'err');
    }
  }

  const templateAnchor = $('btnNotionTemplate');
  if (templateAnchor && window.ULEVELP_CONFIG && window.ULEVELP_CONFIG.notionTemplateUrl) {
    templateAnchor.href = safeUrl(window.ULEVELP_CONFIG.notionTemplateUrl);
  }

  if ($('btnExportZip')) {
    $('btnExportZip').addEventListener('click', async () => {
      say('nxMsg', '');
      const user = auth && typeof auth.getUser === 'function' ? auth.getUser() : null;
      if (!user) {
        return say('nxMsg', '로그인 후 내보낼 수 있어요.', 'err');
      }
      const reqUid = activeUid || user.id;
      const btn = $('btnExportZip');
      btn.disabled = true;
      say('nxMsg', 'ZIP 내보내는 중…');
      try {
        const includeAudio = $('chkExportAudio') ? $('chkExportAudio').checked : true;
        const res = await window.ULData.nx.exportZip(includeAudio);
        if (!activeUid || reqUid !== activeUid) return;
        const url = URL.createObjectURL(res.blob);
        const a = document.createElement('a');
        a['href'] = url;
        a.download = res.filename || 'ULeveLP-export.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        say('nxMsg', '✓ 내보내기를 완료했어요.', 'ok');
      } catch (e) {
        if (!activeUid || reqUid !== activeUid) return;
        say('nxMsg', e.message || '내보내기 중 오류가 발생했어요.', 'err');
      } finally {
        btn.disabled = false;
      }
    });
  }

  if ($('btnPreviewZip')) {
    $('btnPreviewZip').addEventListener('click', async () => {
      say('nxMsg', '');
      const user = auth && typeof auth.getUser === 'function' ? auth.getUser() : null;
      if (!user) {
        return say('nxMsg', '로그인 후 가져올 수 있어요.', 'err');
      }
      const fileInp = $('inpImportZip');
      const file = fileInp && fileInp.files && fileInp.files[0];
      if (!file) {
        return say('nxMsg', 'ZIP 파일을 선택해 주세요.', 'err');
      }
      const reqUid = activeUid || user.id;
      const btn = $('btnPreviewZip');
      btn.disabled = true;
      say('nxMsg', 'ZIP 분석 중…');
      try {
        const r = await window.ULData.nx.previewNotionZip(file);
        if (!activeUid || reqUid !== activeUid) return;
        currentPreviewToken = r.previewToken;
        const summaryText = '신규 곡 ' + (r.newSongs || 0) + '개 · 갱신 곡 ' + (r.updatedSongs || 0) + '개 · 연습 기록 ' + (r.sessions || 0) + '건 · 녹음 ' + (r.takes || 0) + '건' + (r.errors && r.errors.length ? ' (오류 ' + r.errors.length + '건)' : '');
        $('nxPreviewSummary').textContent = summaryText;

        const listEl = $('nxPreviewList');
        listEl.replaceChildren();

        if (Array.isArray(r.songsSample)) {
          r.songsSample.forEach((s) => {
            const li = document.createElement('li');
            const tag = s.isNew ? '[신규] ' : '[갱신] ';
            li.textContent = tag + (s.title || '(제목 없음)') + (s.artist ? ' · ' + s.artist : '');
            listEl.appendChild(li);
          });
        }

        if (Array.isArray(r.errors)) {
          r.errors.forEach((e) => {
            const li = document.createElement('li');
            li.className = 'err';
            li.textContent = '[오류] ' + (e.file || '파일') + ' ' + (e.row != null ? e.row + '행: ' : '') + (e.reason || '');
            listEl.appendChild(li);
          });
        }

        $('nxPreviewBox').hidden = false;
        say('nxMsg', '');
      } catch (e) {
        if (!activeUid || reqUid !== activeUid) return;
        currentPreviewToken = null;
        if ($('nxPreviewBox')) $('nxPreviewBox').hidden = true;
        say('nxMsg', e.message || '미리보기 중 오류가 발생했어요.', 'err');
      } finally {
        btn.disabled = false;
      }
    });
  }

  if ($('btnConfirmZip')) {
    $('btnConfirmZip').addEventListener('click', async () => {
      say('nxMsg', '');
      if (!currentPreviewToken) {
        return say('nxMsg', '미리보기 내역이 없습니다. 다시 ZIP을 선택해 주세요.', 'err');
      }
      const user = auth && typeof auth.getUser === 'function' ? auth.getUser() : null;
      const reqUid = activeUid || (user && user.id) || null;
      const btn = $('btnConfirmZip');
      btn.disabled = true;
      say('nxMsg', '가져오기 반영 중…');
      try {
        const r = await window.ULData.nx.confirmNotionZip(currentPreviewToken);
        if (!activeUid || reqUid !== activeUid) return;
        const doneText = '✓ 가져오기를 완료했어요 (신규 곡 ' + (r.createdSongs || 0) + '개, 갱신 ' + (r.updatedSongs || 0) + '개, 기록 ' + (r.upsertedSessions || 0) + '건, 녹음 ' + (r.importedTakes || 0) + '건)';
        say('nxMsg', doneText, 'ok');
        currentPreviewToken = null;
        if ($('nxPreviewBox')) $('nxPreviewBox').hidden = true;
        if ($('nxPreviewList')) $('nxPreviewList').replaceChildren();
        if ($('inpImportZip')) $('inpImportZip').value = '';
      } catch (e) {
        if (!activeUid || reqUid !== activeUid) return;
        say('nxMsg', e.message || '가져오기 확정 중 오류가 발생했어요.', 'err');
      } finally {
        btn.disabled = false;
      }
    });
  }

  if ($('btnCancelZip')) {
    $('btnCancelZip').addEventListener('click', () => {
      currentPreviewToken = null;
      if ($('nxPreviewBox')) $('nxPreviewBox').hidden = true;
      if ($('nxPreviewList')) $('nxPreviewList').replaceChildren();
      say('nxMsg', '가져오기를 취소했어요.');
    });
  }

  if (auth && $('account')) {
    const embedded = auth.isEmbedded();
    if (embedded) {
      $('btnLogin').hidden = true;
      $('btnLoginBlank').hidden = false;
    }
    auth.onChange((st) => {
      const signedIn = !!(st.user);
      $('accGuest').hidden = signedIn;
      $('accUser').hidden = !signedIn;
      if (signedIn) {
        const email = (st.me && st.me.email) || st.user.email || '';
        const name = (st.me && st.me.displayName) || '';
        $('accEmail').textContent = email;
        $('accName').textContent = name && name !== email.split('@')[0] ? '(' + name + ')' : '';
      } else {
        $('accEmail').textContent = '';
        $('accName').textContent = '';
      }

      if (st.me) {
        const quota = st.me.takeQuotaBytes || 209715200;
        const used = st.me.takeUsedBytes || 0;
        if ($('quotaBar')) {
          $('quotaBar').max = quota;
          $('quotaBar').value = used;
        }
        if ($('quotaText')) {
          $('quotaText').textContent = (used / 1048576).toFixed(1) + 'MB / ' + Math.round(quota / 1048576) + 'MB';
        }
      } else {
        if ($('quotaBar')) {
          $('quotaBar').max = 209715200;
          $('quotaBar').value = 0;
        }
        if ($('quotaText')) {
          $('quotaText').textContent = '0.0MB / 200MB';
        }
      }

      renderDrivePanel(st.me);

      const nextUid = st.user ? st.user.id : null;
      if (!nextUid || nextUid !== activeUid) {
        activeUid = nextUid;
        currentPreviewToken = null;
        if ($('nxPreviewBox')) $('nxPreviewBox').hidden = true;
        if ($('nxPreviewList')) $('nxPreviewList').replaceChildren();
        if ($('nxMsg')) say('nxMsg', '');
        if ($('inpImportZip')) $('inpImportZip').value = '';
        resetNotionFields();
        resetGeminiFields();
        notionSyncEnabled = false;
        renderSyncStatus({ enabled: false, pending: 0, failed: 0 });
        if ($('ntnKeyMsg')) say('ntnKeyMsg', '');
        if ($('gemKeyMsg')) say('gemKeyMsg', '');
        if ($('syncMsg')) say('syncMsg', '');
        if ($('driveProviderText')) $('driveProviderText').textContent = '';
        if ($('driveStatusMsg')) say('driveStatusMsg', '');
        if (nextUid) {
          loadKeys(nextUid);
          loadSyncStatus(nextUid);
        }
      }
    });

    $('btnLogin').addEventListener('click', async () => {
      say('accMsg', '');
      try {
        await auth.signIn(location.href);
      } catch (e) {
        say('accMsg', e.message || '로그인을 시작하지 못했어요.', 'err');
      }
    });

    $('btnLogout').addEventListener('click', async () => {
      $('btnLogout').disabled = true;
      try {
        await auth.signOut();
        say('accMsg', '✓ 로그아웃했어요', 'ok');
      } catch (e) {
        say('accMsg', e.message || '로그아웃 중 오류가 발생했어요.', 'err');
      } finally {
        $('btnLogout').disabled = false;
      }
    });

    $('btnDeleteAcc').addEventListener('click', async () => {
      const confirmVal = $('delConfirm').value.trim();
      if (confirmVal !== '삭제합니다') {
        return say('accMsg', '확인 문구로 "삭제합니다"를 정확히 입력해 주세요.', 'err');
      }
      $('btnDeleteAcc').disabled = true;
      say('accMsg', '계정 삭제 처리 중…');
      try {
        await auth.deleteAccount(confirmVal);
        $('delConfirm').value = '';
        say('accMsg', '✓ 계정이 삭제되었어요.', 'ok');
      } catch (e) {
        say('accMsg', e.message || '계정 삭제에 실패했어요.', 'err');
      } finally {
        $('btnDeleteAcc').disabled = false;
      }
    });

    if ($('btnDriveEnable')) {
      $('btnDriveEnable').addEventListener('click', async () => {
        say('driveStatusMsg', '');
        $('btnDriveEnable').disabled = true;
        try {
          if (!window.ULDrive) throw new Error('Google Drive 모듈이 로드되지 않았습니다.');
          await window.ULDrive.enableDriveStorage();
          say('driveStatusMsg', '✓ Google Drive 저장소로 전환되었어요.', 'ok');
          if (auth && typeof auth.fetchMe === 'function') await auth.fetchMe();
        } catch (err) {
          say('driveStatusMsg', (err && err.message) || 'Google Drive 저장소 전환에 실패했어요.', 'err');
        } finally {
          $('btnDriveEnable').disabled = !!notionSyncEnabled;
        }
      });
    }

    if ($('btnDriveDisable')) {
      $('btnDriveDisable').addEventListener('click', async () => {
        say('driveStatusMsg', '');
        $('btnDriveDisable').disabled = true;
        try {
          if (!window.ULDrive) throw new Error('Google Drive 모듈이 로드되지 않았습니다.');
          await window.ULDrive.disableDriveStorage();
          say('driveStatusMsg', '✓ 기본 저장소로 전환되었어요.', 'ok');
          if (auth && typeof auth.fetchMe === 'function') await auth.fetchMe();
        } catch (err) {
          say('driveStatusMsg', (err && err.message) || '기본 저장소 전환에 실패했어요.', 'err');
        } finally {
          $('btnDriveDisable').disabled = false;
        }
      });
    }

    if ($('btnDriveMigrate')) {
      $('btnDriveMigrate').addEventListener('click', async () => {
        if (!confirm('기본 저장소에 저장된 기존 녹음들을 Google Drive로 이전할까요?')) return;
        say('driveStatusMsg', '녹음 파일 이전 중...');
        $('btnDriveMigrate').disabled = true;
        try {
          if (!window.ULDrive) throw new Error('Google Drive 모듈이 로드되지 않았습니다.');
          const res = await window.ULDrive.migrateAllToDrive(function (p) {
            say('driveStatusMsg', '이전 진행 중... (' + p.current + ' / ' + p.total + ')');
          });
          say('driveStatusMsg', '✓ 이전 완료: ' + res.migrated + '개 성공, ' + res.skipped + '개 건너뜀', 'ok');
          if (auth && typeof auth.fetchMe === 'function') await auth.fetchMe();
        } catch (err) {
          say('driveStatusMsg', (err && err.message) || '녹음 파일 이전에 실패했어요.', 'err');
        } finally {
          $('btnDriveMigrate').disabled = !!notionSyncEnabled;
        }
      });
    }
  }

  function renderDrivePanel(me) {
    if (!$('driveStoragePanel')) return;
    if (!me) {
      if ($('driveProviderText')) $('driveProviderText').textContent = '';
      if ($('driveStatusMsg')) $('driveStatusMsg').textContent = '';
      if ($('driveConflictNotice')) $('driveConflictNotice').hidden = true;
      return;
    }
    const isDrive = me.storageProvider === 'drive';

    if ($('btnDriveEnable')) $('btnDriveEnable').hidden = isDrive;
    if ($('btnDriveDisable')) $('btnDriveDisable').hidden = !isDrive;
    if ($('btnDriveMigrate')) $('btnDriveMigrate').hidden = !isDrive;

    if ($('driveProviderText')) {
      if (isDrive) {
        $('driveProviderText').textContent = 'Google Drive 저장소 사용 중 (폴더: ULeveLP 녹음)';
      } else {
        $('driveProviderText').textContent = '기본 클라우드 저장소(200MB 쿼터) 사용 중';
      }
    }

    if ($('driveConflictNotice')) {
      $('driveConflictNotice').hidden = !notionSyncEnabled;
    }
    if ($('btnDriveEnable')) {
      $('btnDriveEnable').disabled = !!notionSyncEnabled;
    }
    if ($('btnDriveMigrate')) {
      $('btnDriveMigrate').disabled = !!notionSyncEnabled;
    }
  }

  // ---------- 외부 연동 키 관리 · BYOK (K4-1) ----------
  if ($('btnSaveNotionKey')) {
    $('btnSaveNotionKey').addEventListener('click', async () => {
      say('ntnKeyMsg', '');
      const user = auth && typeof auth.getUser === 'function' ? auth.getUser() : null;
      if (!user) return say('ntnKeyMsg', '로그인 후 키를 저장할 수 있어요.', 'err');
      const reqUid = activeUid || user.id;
      const token = $('ntnToken') ? $('ntnToken').value.trim() : '';
      const songsDb = $('ntnSongsDb') ? $('ntnSongsDb').value.trim() : '';
      const sessionsDb = $('ntnSessionsDb') ? $('ntnSessionsDb').value.trim() : '';
      const notesDb = $('ntnNotesDb') ? $('ntnNotesDb').value.trim() : '';
      const btn = $('btnSaveNotionKey');
      btn.disabled = true;
      say('ntnKeyMsg', '저장 중…');
      keysReqSeq++;
      try {
        const dto = await window.ULData.integrations.saveNotion({
          token: token || null,
          songsDb,
          sessionsDb,
          notesDb: notesDb || null,
        });
        if (!activeUid || reqUid !== activeUid) return;
        if ($('ntnToken')) $('ntnToken').value = '';
        if (dto) {
          if ($('notionKeyStatus')) {
            $('notionKeyStatus').textContent = '설정됨 (끝 4자리 ' + (dto.hint || '') + ' · ' + (dto.updatedAt || '').slice(0, 10) + ')';
            $('notionKeyStatus').className = 'badge ok';
          }
          if (dto.config) {
            if ($('ntnSongsDb') && dto.config.songsDb) $('ntnSongsDb').value = dto.config.songsDb;
            if ($('ntnSessionsDb') && dto.config.sessionsDb) $('ntnSessionsDb').value = dto.config.sessionsDb;
            if ($('ntnNotesDb')) $('ntnNotesDb').value = dto.config.notesDb || '';
          }
        }
        say('ntnKeyMsg', '✓ 노션 키를 저장했어요.', 'ok');
        loadSyncStatus(reqUid);
      } catch (e) {
        if (!activeUid || reqUid !== activeUid) return;
        say('ntnKeyMsg', e.message || '노션 키 저장에 실패했어요.', 'err');
      } finally {
        btn.disabled = false;
      }
    });
  }

  if ($('btnCheckNotionKey')) {
    $('btnCheckNotionKey').addEventListener('click', async () => {
      say('ntnKeyMsg', '');
      const user = auth && typeof auth.getUser === 'function' ? auth.getUser() : null;
      if (!user) return say('ntnKeyMsg', '로그인 후 연결을 확인할 수 있어요.', 'err');
      const reqUid = activeUid || user.id;
      const btn = $('btnCheckNotionKey');
      btn.disabled = true;
      say('ntnKeyMsg', '연결 확인 중…');
      keysReqSeq++;
      try {
        const r = await window.ULData.integrations.check('notion');
        if (!activeUid || reqUid !== activeUid) return;
        const notesPart = r.notesTitle ? ' · ' + r.notesTitle : '';
        say('ntnKeyMsg', '✓ 연결 성공 (' + (r.songsTitle || '') + ' · ' + (r.sessionsTitle || '') + notesPart + ' · 파일 ' + (r.maxUploadMB || 5) + 'MB까지)', 'ok');
      } catch (e) {
        if (!activeUid || reqUid !== activeUid) return;
        say('ntnKeyMsg', e.message || '노션 연결 확인에 실패했어요.', 'err');
      } finally {
        btn.disabled = false;
      }
    });
  }

  if ($('btnDelNotionKey')) {
    $('btnDelNotionKey').addEventListener('click', async () => {
      say('ntnKeyMsg', '');
      const user = auth && typeof auth.getUser === 'function' ? auth.getUser() : null;
      if (!user) return say('ntnKeyMsg', '로그인 후 연결을 해제할 수 있어요.', 'err');
      const reqUid = activeUid || user.id;
      const btn = $('btnDelNotionKey');
      btn.disabled = true;
      say('ntnKeyMsg', '연결 해제 중…');
      keysReqSeq++;
      try {
        await window.ULData.integrations.remove('notion');
        if (!activeUid || reqUid !== activeUid) return;
        resetNotionFields();
        renderSyncStatus({ enabled: false, pending: 0, failed: 0 });
        say('ntnKeyMsg', '✓ 노션 연동을 해제했어요.', 'ok');
        loadSyncStatus(reqUid);
      } catch (e) {
        if (!activeUid || reqUid !== activeUid) return;
        say('ntnKeyMsg', e.message || '노션 연동 해제에 실패했어요.', 'err');
      } finally {
        btn.disabled = false;
      }
    });
  }

  if ($('btnSaveGeminiKey')) {
    $('btnSaveGeminiKey').addEventListener('click', async () => {
      say('gemKeyMsg', '');
      const user = auth && typeof auth.getUser === 'function' ? auth.getUser() : null;
      if (!user) return say('gemKeyMsg', '로그인 후 키를 저장할 수 있어요.', 'err');
      const reqUid = activeUid || user.id;
      const apiKey = $('gemKey') ? $('gemKey').value.trim() : '';
      const model = $('gemModel') ? $('gemModel').value.trim() : '';
      const btn = $('btnSaveGeminiKey');
      btn.disabled = true;
      say('gemKeyMsg', '저장 중…');
      keysReqSeq++;
      try {
        const dto = await window.ULData.integrations.saveGemini({
          apiKey: apiKey || null,
          model: model || undefined,
        });
        if (!activeUid || reqUid !== activeUid) return;
        if ($('gemKey')) $('gemKey').value = '';
        if (dto) {
          if ($('geminiKeyStatus')) {
            $('geminiKeyStatus').textContent = '설정됨 (끝 4자리 ' + (dto.hint || '') + ' · ' + (dto.updatedAt || '').slice(0, 10) + ')';
            $('geminiKeyStatus').className = 'badge ok';
          }
          if (dto.config && dto.config.model && $('gemModel')) {
            $('gemModel').value = dto.config.model;
          }
        }
        say('gemKeyMsg', '✓ Gemini 키를 저장했어요.', 'ok');
      } catch (e) {
        if (!activeUid || reqUid !== activeUid) return;
        say('gemKeyMsg', e.message || 'Gemini 키 저장에 실패했어요.', 'err');
      } finally {
        btn.disabled = false;
      }
    });
  }

  if ($('btnCheckGeminiKey')) {
    $('btnCheckGeminiKey').addEventListener('click', async () => {
      say('gemKeyMsg', '');
      const user = auth && typeof auth.getUser === 'function' ? auth.getUser() : null;
      if (!user) return say('gemKeyMsg', '로그인 후 연결을 확인할 수 있어요.', 'err');
      const reqUid = activeUid || user.id;
      const btn = $('btnCheckGeminiKey');
      btn.disabled = true;
      say('gemKeyMsg', '연결 확인 중…');
      keysReqSeq++;
      try {
        const r = await window.ULData.integrations.check('gemini');
        if (!activeUid || reqUid !== activeUid) return;
        say('gemKeyMsg', '✓ 연결 성공 (' + (r.displayName || r.model || '') + ')', 'ok');
      } catch (e) {
        if (!activeUid || reqUid !== activeUid) return;
        say('gemKeyMsg', e.message || 'Gemini 연결 확인에 실패했어요.', 'err');
      } finally {
        btn.disabled = false;
      }
    });
  }

  if ($('btnDelGeminiKey')) {
    $('btnDelGeminiKey').addEventListener('click', async () => {
      say('gemKeyMsg', '');
      const user = auth && typeof auth.getUser === 'function' ? auth.getUser() : null;
      if (!user) return say('gemKeyMsg', '로그인 후 연결을 해제할 수 있어요.', 'err');
      const reqUid = activeUid || user.id;
      const btn = $('btnDelGeminiKey');
      btn.disabled = true;
      say('gemKeyMsg', '연결 해제 중…');
      keysReqSeq++;
      try {
        await window.ULData.integrations.remove('gemini');
        if (!activeUid || reqUid !== activeUid) return;
        resetGeminiFields();
        say('gemKeyMsg', '✓ Gemini 연동을 해제했어요.', 'ok');
      } catch (e) {
        if (!activeUid || reqUid !== activeUid) return;
        say('gemKeyMsg', e.message || 'Gemini 연동 해제에 실패했어요.', 'err');
      } finally {
        btn.disabled = false;
      }
    });
  }

  // ---------- Gemini 1분 온보딩 모달 (R1-2) ----------
  const GEMINI_KEY_RE = /^AIza[0-9A-Za-z\-_]{35}$/;

  function checkModalKeyFormat() {
    const inp = $('gemModalKeyInput');
    const hint = $('gemModalFormatHint');
    const saveBtn = $('btnModalSaveGemini');
    if (!inp || !hint || !saveBtn) return '';
    const trimmed = inp.value.trim();
    if (!trimmed) {
      hint.textContent = 'AIza로 시작하는 39자리 API 키를 붙여넣어 주세요.';
      hint.className = 'hint';
      saveBtn.disabled = true;
      return '';
    }
    if (GEMINI_KEY_RE.test(trimmed)) {
      hint.textContent = '✓ 형식이 올바릅니다 (39자)';
      hint.className = 'msg ok';
      saveBtn.disabled = false;
      return trimmed;
    }
    hint.textContent = 'AIza로 시작하는 39자리 키 전체를 복사해 주세요 (현재 ' + trimmed.length + '자)';
    hint.className = 'msg err';
    saveBtn.disabled = true;
    return '';
  }

  function openGeminiModal() {
    const modal = $('geminiOnboardingModal');
    if (!modal) return;
    if ($('gemModalKeyInput')) $('gemModalKeyInput').value = '';
    if ($('gemModalResultMsg')) {
      $('gemModalResultMsg').textContent = '';
      $('gemModalResultMsg').className = 'msg';
    }
    checkModalKeyFormat();
    modal.hidden = false;
  }

  function closeGeminiModal() {
    const modal = $('geminiOnboardingModal');
    if (modal) modal.hidden = true;
  }

  if ($('btnOpenGeminiModal')) {
    $('btnOpenGeminiModal').addEventListener('click', openGeminiModal);
  }
  if ($('btnCloseGeminiModal')) {
    $('btnCloseGeminiModal').addEventListener('click', closeGeminiModal);
  }
  if ($('gemModalKeyInput')) {
    $('gemModalKeyInput').addEventListener('input', checkModalKeyFormat);
  }
  if ($('btnModalSaveGemini')) {
    $('btnModalSaveGemini').addEventListener('click', async () => {
      const validKey = checkModalKeyFormat();
      if (!validKey) return;
      const user = auth && typeof auth.getUser === 'function' ? auth.getUser() : null;
      if (!user) {
        if ($('gemModalResultMsg')) {
          $('gemModalResultMsg').textContent = '로그인 후 키를 저장할 수 있어요.';
          $('gemModalResultMsg').className = 'msg err';
        }
        return;
      }
      const reqUid = activeUid || user.id;
      const btn = $('btnModalSaveGemini');
      btn.disabled = true;
      if ($('gemModalResultMsg')) {
        $('gemModalResultMsg').textContent = 'Gemini API 키 유효성을 실시간으로 확인하는 중…';
        $('gemModalResultMsg').className = 'msg';
      }
      keysReqSeq++;
      try {
        const model = ($('gemModel') && $('gemModel').value.trim()) || 'gemini-flash-latest';
        const dto = await window.ULData.integrations.saveGemini({
          apiKey: validKey,
          model,
          verify: true,
        });
        if (!activeUid || reqUid !== activeUid) return;
        if (dto) {
          if ($('geminiKeyStatus')) {
            $('geminiKeyStatus').textContent = '설정됨 (끝 4자리 ' + (dto.hint || '') + ' · ' + (dto.updatedAt || '').slice(0, 10) + ')';
            $('geminiKeyStatus').className = 'badge ok';
          }
          if (dto.config && dto.config.model && $('gemModel')) {
            $('gemModel').value = dto.config.model;
          }
          if ($('gemModalResultMsg')) {
            const modelLabel = dto.displayName ? ' · ' + dto.displayName : '';
            $('gemModalResultMsg').textContent = '✓ 연결 완료! 무료 Gemini 모델이 정상 작동합니다 (끝 4자리 ' + (dto.hint || '') + modelLabel + ')';
            $('gemModalResultMsg').className = 'msg ok';
          }
          if ($('gemModalKeyInput')) $('gemModalKeyInput').value = '';
          say('gemKeyMsg', '✓ Gemini 키를 저장했어요.', 'ok');
        }
      } catch (e) {
        if (!activeUid || reqUid !== activeUid) return;
        if ($('gemModalResultMsg')) {
          $('gemModalResultMsg').textContent = e.message || 'Gemini API 키 검증 및 저장에 실패했어요.';
          $('gemModalResultMsg').className = 'msg err';
        }
      } finally {
        btn.disabled = false;
      }
    });
  }

  // ---------- 실시간 노션 동기화 (K4-3) ----------
  if ($('btnSyncEnable')) {
    $('btnSyncEnable').addEventListener('click', async () => {
      say('syncMsg', '');
      const user = auth && typeof auth.getUser === 'function' ? auth.getUser() : null;
      if (!user) return say('syncMsg', '로그인이 필요해요.', 'err');
      const reqUid = activeUid || user.id;
      const btn = $('btnSyncEnable');
      btn.disabled = true;
      say('syncMsg', '기존 노션 데이터를 이관하고 연동을 켜는 중…');
      try {
        syncReqSeq++;
        const res = await window.ULData.notionSync.enable();
        if (!activeUid || reqUid !== activeUid) return;
        const quotaPart = res.skippedTakesByQuota ? ', 용량 초과 건너뜀 ' + res.skippedTakesByQuota + '개' : '';
        say('syncMsg', '✓ 연동이 켜졌어요 (곡 ' + res.importedSongs + '개, 세션 ' + res.importedSessions + '개, 녹음 ' + res.importedTakes + '개 이관' + quotaPart + ')', 'ok');
        await loadSyncStatus(reqUid);
      } catch (e) {
        if (!activeUid || reqUid !== activeUid) return;
        say('syncMsg', e.message || '연동 켜기에 실패했어요.', 'err');
      } finally {
        btn.disabled = false;
      }
    });
  }

  if ($('btnSyncDisable')) {
    $('btnSyncDisable').addEventListener('click', async () => {
      say('syncMsg', '');
      const user = auth && typeof auth.getUser === 'function' ? auth.getUser() : null;
      if (!user) return say('syncMsg', '로그인이 필요해요.', 'err');
      const reqUid = activeUid || user.id;
      const btn = $('btnSyncDisable');
      btn.disabled = true;
      say('syncMsg', '연동을 끄는 중…');
      try {
        syncReqSeq++;
        await window.ULData.notionSync.disable();
        if (!activeUid || reqUid !== activeUid) return;
        say('syncMsg', '✓ 연동을 껐어요.', 'ok');
        await loadSyncStatus(reqUid);
      } catch (e) {
        if (!activeUid || reqUid !== activeUid) return;
        say('syncMsg', e.message || '연동 끄기에 실패했어요.', 'err');
      } finally {
        btn.disabled = false;
      }
    });
  }

  if ($('btnSyncPull')) {
    $('btnSyncPull').addEventListener('click', async () => {
      say('syncMsg', '');
      const user = auth && typeof auth.getUser === 'function' ? auth.getUser() : null;
      if (!user) return say('syncMsg', '로그인이 필요해요.', 'err');
      const reqUid = activeUid || user.id;
      const btn = $('btnSyncPull');
      btn.disabled = true;
      say('syncMsg', '노션에서 변경사항을 가져오는 중…');
      try {
        syncReqSeq++;
        const res = await window.ULData.notionSync.pull();
        if (!activeUid || reqUid !== activeUid) return;
        say('syncMsg', '✓ 노션에서 가져왔어요 (곡 ' + res.updatedSongs + '개, 세션 ' + res.updatedSessions + '개 갱신)', 'ok');
        await loadSyncStatus(reqUid);
      } catch (e) {
        if (!activeUid || reqUid !== activeUid) return;
        say('syncMsg', e.message || '노션에서 가져오기에 실패했어요.', 'err');
      } finally {
        btn.disabled = false;
      }
    });
  }

  if ($('btnSyncPush')) {
    $('btnSyncPush').addEventListener('click', async () => {
      say('syncMsg', '');
      const user = auth && typeof auth.getUser === 'function' ? auth.getUser() : null;
      if (!user) return say('syncMsg', '로그인이 필요해요.', 'err');
      const reqUid = activeUid || user.id;
      const btn = $('btnSyncPush');
      btn.disabled = true;
      say('syncMsg', '노션으로 변경사항을 보내는 중…');
      try {
        syncReqSeq++;
        const res = await window.ULData.notionSync.push();
        if (!activeUid || reqUid !== activeUid) return;
        say('syncMsg', '✓ 노션으로 보냈어요 (처리 ' + res.processed + '건, 실패 ' + res.failed + '건)', 'ok');
        await loadSyncStatus(reqUid);
      } catch (e) {
        if (!activeUid || reqUid !== activeUid) return;
        say('syncMsg', e.message || '노션으로 보내기에 실패했어요.', 'err');
      } finally {
        btn.disabled = false;
      }
    });
  }

  // ---------- 노션 바로가기 ----------
  $('nlPractice').value = raw.get('ulp:notion-practice');
  $('nlNotes').value = raw.get('ulp:notion-notes');
  $('nlSave').addEventListener('click', () => {
    raw.set('ulp:notion-practice', $('nlPractice').value.trim());
    raw.set('ulp:notion-notes', $('nlNotes').value.trim());
    say('nlMsg', '✓ 저장했어요', 'ok');
  });

  // ---------- 화면 모드 (chords.html의 라이트/다크 버튼과 같은 키) ----------
  const themeBtns = document.querySelectorAll('.seg-pill [data-theme]');
  function renderTheme() {
    const cur = raw.get('ulp:theme');
    themeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === cur)));
  }
  themeBtns.forEach((b) => b.addEventListener('click', () => {
    raw.set('ulp:theme', b.dataset.theme);
    if (b.dataset.theme) document.documentElement.dataset.theme = b.dataset.theme;
    else delete document.documentElement.dataset.theme;
    renderTheme();
  }));
  renderTheme();
})();
