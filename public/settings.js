// 설정(settings.html): 계정(로그인·로그아웃·계정 삭제), 노션 연결, 학습 노트 토큰, 노션 바로가기, 화면 모드
'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const { raw, json, notion, gh } = UL;
  const auth = window.ULAuth;
  function say(id, text, cls) { $(id).textContent = text; $(id).className = 'msg' + (cls ? ' ' + cls : ''); }

  // ---------- 계정 (FR-AUTH-1·4·5) ----------
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
  }

  // ---------- 노션 연결 (practice.js와 같은 키, JSON 형식) ----------
  $('apiUrl').value = notion.url();
  $('apiKey').value = notion.key();
  $('apiSave').addEventListener('click', async () => {
    json.set('pp-api', $('apiUrl').value.trim());
    json.set('pp-key', $('apiKey').value.trim());
    if (!notion.ok()) return say('apiMsg', '주소와 비밀 키를 모두 넣어주세요', 'err');
    say('apiMsg', '확인 중…');
    try {
      const r = await notion.call('/health');
      say('apiMsg', '✓ 연결됨 (' + r.songsTitle + ' · ' + r.sessionsTitle + (r.maxUploadMB ? ' · 파일 ' + r.maxUploadMB + 'MB까지' : '') + ')', 'ok');
    } catch (e) { say('apiMsg', e.message, 'err'); }
  });

  // ---------- 학습 노트 ----------
  $('ghToken').value = gh.token();
  $('ghRepo').value = raw.get('sn-repo');
  $('ghRepo').placeholder = gh.inferRepo() || 'owner/repo';
  $('ghRepoHint').textContent = gh.inferRepo() ? '비워 두면 이 페이지 주소에서 알아낸 ' + gh.inferRepo() + '을(를) 써요.' : 'github.io가 아닌 곳에서 열었으면 직접 넣어주세요.';
  $('ghSave').addEventListener('click', async () => {
    raw.set('sn-token', $('ghToken').value.trim());
    raw.set('sn-repo', $('ghRepo').value.trim());
    if (!gh.ok()) return say('ghMsg', '토큰과 저장소를 넣어주세요', 'err');
    say('ghMsg', '확인 중…');
    try {
      await gh.call('/actions/workflows/analyze.yml');
      say('ghMsg', '✓ ' + gh.repo() + '의 분석 워크플로를 찾았어요', 'ok');
    } catch (e) { say('ghMsg', e.message, 'err'); }
  });

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
