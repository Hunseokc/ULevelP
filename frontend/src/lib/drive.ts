// frontend/src/lib/drive.ts
import { auth, MeProfile } from './auth';
import { apiClient, TakeDto, TakeUploadMeta } from './apiClient';

export interface DriveMigrationProgress {
  current: number;
  total: number;
  take: TakeDto;
}

function createDriveModule() {
  let inMemoryToken: string | null = null;
  let tokenExpiresAt = 0;

  function getAuthRef() {
    const win: Record<string, any> = typeof window !== 'undefined' ? (window as any) : {};
    return win.ULAuth || auth;
  }

  function getDataRef() {
    const win: Record<string, any> = typeof window !== 'undefined' ? (window as any) : {};
    return win.ULData || apiClient;
  }

  function clearToken(): void {
    inMemoryToken = null;
    tokenExpiresAt = 0;
  }

  function getCurrentUid(): string | null {
    const A = getAuthRef();
    if (A && typeof A.getUser === 'function') {
      const u = A.getUser();
      return u && u.id ? u.id : null;
    }
    return null;
  }

  let activeUid: string | null = getCurrentUid();

  const AInit = getAuthRef();
  if (AInit && typeof AInit.onChange === 'function') {
    AInit.onChange((state: any) => {
      const nextUid = state && state.user ? state.user.id : null;
      if (!nextUid || (activeUid && activeUid !== nextUid)) {
        clearToken();
      }
      activeUid = nextUid;
    });
  }

  function getClientId(): string {
    const win: Record<string, any> = typeof window !== 'undefined' ? (window as any) : {};
    const cfg = win.ULEVELP_CONFIG || {};
    return String(cfg.googleClientId || '').trim();
  }

  async function requestToken(opts?: { force?: boolean; clientId?: string; prompt?: string }): Promise<string> {
    const options = opts || {};
    const curUid = getCurrentUid();
    if (!curUid || (activeUid && activeUid !== curUid)) {
      clearToken();
    }
    activeUid = curUid;
    if (inMemoryToken && tokenExpiresAt && Date.now() < tokenExpiresAt - 60000 && !options.force) {
      return inMemoryToken;
    }

    const win: Record<string, any> = typeof window !== 'undefined' ? (window as any) : {};
    if (typeof win.google === 'undefined' || !win.google.accounts || !win.google.accounts.oauth2) {
      throw new Error('Google Identity Services가 로드되지 않았습니다.');
    }

    const clientId = (options.clientId && String(options.clientId).trim()) || getClientId();
    if (!clientId) {
      throw new Error('public/config.js에 googleClientId가 설정되지 않았습니다.');
    }

    return new Promise<string>((resolve, reject) => {
      try {
        const tokenClient = win.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'https://www.googleapis.com/auth/drive.file',
          callback: (resp: any) => {
            if (resp.error) {
              reject(new Error(resp.error_description || resp.error || 'Google 인증에 실패했습니다.'));
              return;
            }
            inMemoryToken = resp.access_token;
            const expiresIn = parseInt(String(resp.expires_in), 10) || 3600;
            tokenExpiresAt = Date.now() + expiresIn * 1000;
            resolve(inMemoryToken as string);
          },
          error_callback: (err: any) => {
            reject(new Error((err && (err.message || err.type)) || 'Google 인증 오류가 발생했습니다.'));
          },
        });
        tokenClient.requestAccessToken({ prompt: options.prompt || '' });
      } catch (err) {
        reject(err);
      }
    });
  }

  async function deleteFile(fileId: string): Promise<void> {
    if (!fileId) return;
    try {
      const token = await requestToken();
      await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId), {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer ' + token,
        },
      });
    } catch {
      /* best-effort cleanup */
    }
  }

  async function ensureFolder(preferredId?: string | null): Promise<string> {
    const token = await requestToken();

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
      } catch {
        /* ignore */
      }
    }

    const query = encodeURIComponent(
      "name = 'ULeveLP 녹음' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    );
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

  async function uploadBlob(blob: Blob, name?: string, mime?: string, folderId?: string | null): Promise<string> {
    if (!blob) throw new Error('업로드할 파일이 없습니다.');
    const token = await requestToken();
    const contentType = mime || 'audio/mp4';
    const fileName = name || 'take-' + Date.now() + '.m4a';
    const size = blob.size;

    if (size <= 5 * 1024 * 1024) {
      const boundary = '-------ulp_boundary_' + Math.random().toString(36).slice(2);
      const meta = JSON.stringify({
        name: fileName,
        parents: folderId ? [folderId] : [],
        mimeType: contentType,
      });

      const body = new Blob(
        [
          '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
            meta +
            '\r\n--' +
            boundary +
            '\r\nContent-Type: ' +
            contentType +
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
        body,
      });

      if (!res.ok) {
        let errData: any = {};
        try {
          errData = await res.json();
        } catch {
          /* ignore */
        }
        throw new Error((errData.error && errData.error.message) || 'Drive 업로드 실패 (' + res.status + ')');
      }
      const data = await res.json();
      return data.id;
    }

    const initRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': contentType,
        'X-Upload-Content-Length': String(size),
      },
      body: JSON.stringify({
        name: fileName,
        parents: folderId ? [folderId] : [],
        mimeType: contentType,
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
        'Content-Type': contentType,
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

  async function uploadTake(meta: TakeUploadMeta, blob: Blob): Promise<TakeDto> {
    const A = getAuthRef();
    const D = getDataRef();
    const me = A && typeof A.getMe === 'function' ? A.getMe() : null;
    const folderId = await ensureFolder(me ? me.driveFolderId : null);
    const ext = meta && meta.mime && meta.mime.includes('webm') ? 'weba' : 'm4a';
    const filename = 'take-' + Date.now() + '.' + ext;
    const driveFileId = await uploadBlob(blob, filename, meta?.mime, folderId);

    try {
      return await D.takes.registerDrive({
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
    } catch (err) {
      await deleteFile(driveFileId);
      throw err;
    }
  }

  async function fetchMediaObjectUrl(fileId: string): Promise<string> {
    if (!fileId) throw new Error('파일 ID가 필요합니다.');
    const token = await requestToken();
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media',
      {
        headers: {
          Authorization: 'Bearer ' + token,
        },
      }
    );
    if (!res.ok) {
      throw new Error('Drive 녹음 파일을 불러오지 못했습니다 (' + res.status + ')');
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }

  async function checkNotionSyncConflict(): Promise<void> {
    const D = getDataRef();
    if (D && D.notionSync && typeof D.notionSync.status === 'function') {
      const sync = await D.notionSync.status();
      if (sync && sync.enabled) {
        throw new Error('노션 실시간 연동이 켜져 있는 동안에는 Google Drive 저장소를 사용할 수 없습니다.');
      }
    }
  }

  async function enableDriveStorage(): Promise<MeProfile> {
    await checkNotionSyncConflict();
    const A = getAuthRef();
    const D = getDataRef();
    const me = A && typeof A.getMe === 'function' ? A.getMe() : null;
    const folderId = await ensureFolder(me ? me.driveFolderId : null);
    return await D.me.update({
      storageProvider: 'drive',
      driveFolderId: folderId,
    });
  }

  async function disableDriveStorage(): Promise<MeProfile> {
    const D = getDataRef();
    return await D.me.update({
      storageProvider: 'supabase',
    });
  }

  async function migrateAllToDrive(
    onProgress?: (p: DriveMigrationProgress) => void
  ): Promise<{ migrated: number; skipped: number }> {
    await checkNotionSyncConflict();
    const A = getAuthRef();
    const D = getDataRef();
    const me = A && typeof A.getMe === 'function' ? A.getMe() : null;
    const folderId = await ensureFolder(me ? me.driveFolderId : null);

    const sData = await D.sessions.list({ from: '2000-01-01', to: '2099-12-31' });
    const sessions = sData && Array.isArray(sData.sessions) ? sData.sessions : [];
    const targetTakes: TakeDto[] = [];
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
        onProgress({ current: i + 1, total, take });
      }
      let uploadedDriveFileId: string | null = null;
      try {
        const blob = await D.takes.downloadBlob(take.id);
        const ext = take.mime && take.mime.includes('webm') ? 'weba' : 'm4a';
        const name = 'take-' + take.id + '.' + ext;
        uploadedDriveFileId = await uploadBlob(blob, name, take.mime, folderId);
        await D.takes.migrateToDrive(take.id, uploadedDriveFileId);
        migrated++;
      } catch {
        if (uploadedDriveFileId) {
          await deleteFile(uploadedDriveFileId);
        }
        skipped++;
      }
    }

    return { migrated, skipped };
  }

  return {
    requestToken,
    ensureFolder,
    uploadBlob,
    uploadTake,
    fetchMediaObjectUrl,
    enableDriveStorage,
    disableDriveStorage,
    migrateAllToDrive,
    clearToken,
  };
}

export const drive = createDriveModule();

if (typeof window !== 'undefined' && !window.ULDrive) {
  window.ULDrive = drive;
}

