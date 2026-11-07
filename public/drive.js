// Google Drive 연동 모듈 (drive.js)
'use strict';
(function () {
  let inMemoryToken = null;
  let tokenExpiresAt = 0;

  function clearToken() {
    inMemoryToken = null;
    tokenExpiresAt = 0;
  }

  function getCurrentUid() {
    if (window.ULAuth && typeof window.ULAuth.getUser === 'function') {
      const u = window.ULAuth.getUser();
      return (u && u.id) ? u.id : null;
    }
    return null;
  }

  let activeUid = getCurrentUid();

  // 로그아웃 또는 계정 변경(A->B) 시 토큰 즉시 폐기 (NFR-SEC-3, 리뷰 4번)
  if (window.ULAuth && typeof window.ULAuth.onChange === 'function') {
    window.ULAuth.onChange(function (state) {
      const nextUid = state && state.user ? state.user.id : null;
      if (!nextUid || (activeUid && activeUid !== nextUid)) {
        clearToken();
      }
      activeUid = nextUid;
    });
  }

  function getClientId() {
    const cfg = window.ULEVELP_CONFIG || {};
    return String(cfg.googleClientId || '').trim();
  }

  async function requestToken(opts) {
    opts = opts || {};
    const curUid = getCurrentUid();
    if (!curUid || (activeUid && activeUid !== curUid)) {
      clearToken();
    }
    activeUid = curUid;
    if (inMemoryToken && tokenExpiresAt && Date.now() < tokenExpiresAt - 60000 && !opts.force) {
      return inMemoryToken;
    }

    if (typeof window.google === 'undefined' || !window.google.accounts || !window.google.accounts.oauth2) {
      throw new Error('Google Identity Services가 로드되지 않았습니다.');
    }

    const clientId = (opts.clientId && String(opts.clientId).trim()) || getClientId();
    if (!clientId) {
      throw new Error('public/config.js에 googleClientId가 설정되지 않았습니다.');
    }

    return new Promise(function (resolve, reject) {
      try {
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'https://www.googleapis.com/auth/drive.file',
          callback: function (resp) {
            if (resp.error) {
              reject(new Error(resp.error_description || resp.error || 'Google 인증에 실패했습니다.'));
              return;
            }
            inMemoryToken = resp.access_token;
            const expiresIn = parseInt(resp.expires_in, 10) || 3600;
            tokenExpiresAt = Date.now() + expiresIn * 1000;
            resolve(inMemoryToken);
          },
          error_callback: function (err) {
            reject(new Error((err && (err.message || err.type)) || 'Google 인증 오류가 발생했습니다.'));
          },
        });
        client.requestAccessToken({ prompt: opts.prompt || '' });
      } catch (err) {
        reject(err);
      }
    });
  }

  async function deleteFile(fileId) {
    if (!fileId) return;
    try {
      const token = await requestToken();
      await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId), {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer ' + token,
        },
      });
    } catch (_) {
      // best-effort cleanup
    }
  }

  async function ensureFolder(preferredId) {
    const token = await requestToken();

    // 1. preferredId 유효성 확인
    if (preferredId) {
      try {
        const checkRes = await fetch(
          'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(preferredId) + '?fields=id,trashed',
          {
            headers: { Authorization: 'Bearer ' + token },
          }
        );
        if (checkRes.ok) {
          const file = await checkRes.json();
          if (file && !file.trashed) {
            return file.id;
          }
        }
      } catch (_) {}
    }

    // 2. 'ULeveLP 녹음' 폴더 검색
    const query = encodeURIComponent("name = 'ULeveLP 녹음' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
    const searchRes = await fetch(
      'https://www.googleapis.com/drive/v3/files?q=' + query + '&fields=files(id,name)&spaces=drive',
      {
        headers: { Authorization: 'Bearer ' + token },
      }
    );
    if (!searchRes.ok) {
      throw new Error('Drive 폴더를 검색하지 못했습니다 (' + searchRes.status + ')');
    }
    const searchData = await searchRes.json();
    if (searchData && Array.isArray(searchData.files) && searchData.files.length > 0) {
      return searchData.files[0].id;
    }

    // 3. 폴더 생성
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        name: 'ULeveLP 녹음',
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });
    if (!createRes.ok) {
      throw new Error('Drive 폴더를 생성하지 못했습니다 (' + createRes.status + ')');
    }
    const created = await createRes.json();
    return created.id;
  }

  async function uploadBlob(blob, name, mime, folderId) {
    if (!blob) throw new Error('업로드할 파일이 없습니다.');
    const token = await requestToken();
    mime = mime || 'audio/mp4';
    name = name || ('take-' + Date.now() + '.m4a');
    const size = blob.size;

    // 5MB 이하: multipart/related 단일 요청 (FR-DRIVE-2)
    if (size <= 5 * 1024 * 1024) {
      const boundary = '-------ulp_boundary_' + Math.random().toString(36).slice(2);
      const meta = JSON.stringify({
        name: name,
        parents: folderId ? [folderId] : [],
        mimeType: mime,
      });

      const body = new Blob(
        [
          '--' + boundary + '\r\n' +
            'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
            meta +
            '\r\n--' +
            boundary +
            '\r\n' +
            'Content-Type: ' +
            mime +
            '\r\n\r\n',
          blob,
          '\r\n--' + boundary + '--',
        ],
        { type: 'multipart/related; boundary=' + boundary }
      );

      const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
        },
        body: body,
      });

      if (!res.ok) {
        let errData = {};
        try { errData = await res.json(); } catch (_) {}
        throw new Error((errData.error && errData.error.message) || ('Drive 업로드 실패 (' + res.status + ')'));
      }
      const data = await res.json();
      return data.id;
    }

    // 5MB 초과: Resumable Upload (FR-DRIVE-2)
    const initRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mime,
        'X-Upload-Content-Length': String(size),
      },
      body: JSON.stringify({
        name: name,
        parents: folderId ? [folderId] : [],
        mimeType: mime,
      }),
    });

    if (!initRes.ok) {
      throw new Error('Drive 세션 시작 실패 (' + initRes.status + ')');
    }

    const locationUrl = initRes.headers.get('Location');
    if (!locationUrl || !locationUrl.startsWith('https://www.googleapis.com/')) {
      throw new Error('유효하지 않은 Drive 업로드 주소입니다.');
    }

    const uploadRes = await fetch(locationUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': mime,
        'Content-Length': String(size),
      },
      body: blob,
    });

    if (!uploadRes.ok) {
      throw new Error('Drive 파일 전송 실패 (' + uploadRes.status + ')');
    }
    const uploadedData = await uploadRes.json();
    return uploadedData.id;
  }

  async function uploadTake(meta, blob) {
    meta = meta || {};
    const me = window.ULAuth && typeof window.ULAuth.getMe === 'function' ? window.ULAuth.getMe() : null;
    const folderId = await ensureFolder(me ? me.driveFolderId : null);
    const ext = (meta.mime && meta.mime.includes('webm')) ? 'weba' : 'm4a';
    const filename = 'take-' + Date.now() + '.' + ext;
    const driveFileId = await uploadBlob(blob, filename, meta.mime, folderId);

    try {
      const registered = await window.ULData.takes.registerDrive({
        songId: meta.songId,
        date: meta.date,
        recordedAt: meta.recordedAt,
        a: meta.a,
        b: meta.b,
        rate: meta.rate,
        durationSec: meta.durationSec,
        mime: meta.mime,
        sizeBytes: blob.size,
        storageKey: driveFileId,
      });
      return registered;
    } catch (err) {
      await deleteFile(driveFileId);
      throw err;
    }
  }

  async function fetchMediaObjectUrl(fileId) {
    if (!fileId) throw new Error('파일 ID가 필요합니다.');
    const token = await requestToken();
    const res = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media', {
      headers: {
        Authorization: 'Bearer ' + token,
      },
    });
    if (!res.ok) {
      throw new Error('Drive 녹음 파일을 불러오지 못했습니다 (' + res.status + ')');
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }

  async function checkNotionSyncConflict() {
    if (window.ULData && window.ULData.notionSync && typeof window.ULData.notionSync.status === 'function') {
      const sync = await window.ULData.notionSync.status();
      if (sync && sync.enabled) {
        throw new Error('노션 실시간 연동이 켜져 있는 동안에는 Google Drive 저장소를 사용할 수 없습니다.');
      }
    }
  }

  async function enableDriveStorage() {
    await checkNotionSyncConflict();
    const me = window.ULAuth && typeof window.ULAuth.getMe === 'function' ? window.ULAuth.getMe() : null;
    const folderId = await ensureFolder(me ? me.driveFolderId : null);
    const updated = await window.ULData.me.update({
      storageProvider: 'drive',
      driveFolderId: folderId,
    });
    return updated;
  }

  async function disableDriveStorage() {
    const updated = await window.ULData.me.update({
      storageProvider: 'supabase',
    });
    return updated;
  }

  async function migrateAllToDrive(onProgress) {
    await checkNotionSyncConflict();
    const me = window.ULAuth && typeof window.ULAuth.getMe === 'function' ? window.ULAuth.getMe() : null;
    const folderId = await ensureFolder(me ? me.driveFolderId : null);

    // 모든 세션 조회 후 supabase 저장소의 takes 수집 (명세 2.3절: storage === 'supabase' 대상만 이전)
    const sData = await window.ULData.sessions.list({ from: '2000-01-01', to: '2099-12-31' });
    const sessions = (sData && Array.isArray(sData.sessions)) ? sData.sessions : [];
    const targetTakes = [];
    for (let sIdx = 0; sIdx < sessions.length; sIdx++) {
      const sess = sessions[sIdx];
      if (Array.isArray(sess.takes)) {
        for (let tIdx = 0; tIdx < sess.takes.length; tIdx++) {
          const t = sess.takes[tIdx];
          if (t.storage === 'supabase') {
            targetTakes.push(t);
          }
        }
      }
    }

    let migrated = 0;
    let skipped = 0;
    const total = targetTakes.length;

    for (let i = 0; i < total; i++) {
      const take = targetTakes[i];
      if (typeof onProgress === 'function') {
        onProgress({ current: i + 1, total: total, take: take });
      }
      let uploadedDriveFileId = null;
      try {
        const blob = await window.ULData.takes.downloadBlob(take.id);
        const ext = (take.mime && take.mime.includes('webm')) ? 'weba' : 'm4a';
        const name = 'take-' + take.id + '.' + ext;
        uploadedDriveFileId = await uploadBlob(blob, name, take.mime, folderId);
        await window.ULData.takes.migrateToDrive(take.id, uploadedDriveFileId);
        migrated++;
      } catch (err) {
        if (uploadedDriveFileId) {
          await deleteFile(uploadedDriveFileId);
        }
        console.warn('녹음 Drive 이전 실패 takeId=' + take.id, err);
        skipped++;
      }
    }

    return { migrated: migrated, skipped: skipped };
  }

  window.ULDrive = {
    requestToken: requestToken,
    ensureFolder: ensureFolder,
    uploadBlob: uploadBlob,
    uploadTake: uploadTake,
    fetchMediaObjectUrl: fetchMediaObjectUrl,
    enableDriveStorage: enableDriveStorage,
    disableDriveStorage: disableDriveStorage,
    migrateAllToDrive: migrateAllToDrive,
    clearToken: clearToken,
  };
})();
