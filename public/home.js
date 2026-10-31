// 첫 화면(index.html): 링크 붙여넣기, 코드 연습 탭 목록, 노션 연습 곡, 노션 바로가기
'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const { raw, videoIdFrom, thumb, esc, safeUrl } = UL;

  // ---------- 링크 붙여넣기 ----------
  function pick() {
    const id = videoIdFrom($('goUrl').value);
    $('goPick').hidden = !id;
    $('goMsg').textContent = $('goUrl').value.trim() && !id ? '유튜브 영상 링크가 아니에요' : '';
    $('goMsg').classList.toggle('err', !!$('goMsg').textContent);
    if (!id) return;
    $('goThumb').src = thumb(id);
    $('goPlay').href = 'practice.html?v=' + encodeURIComponent(id);
    $('goNote').href = 'notes.html?url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id);
  }
  $('goUrl').addEventListener('input', pick);
  $('go').addEventListener('submit', (e) => { e.preventDefault(); pick(); if (!$('goPick').hidden) $('goPlay').click(); });

  // ---------- 코드 연습: 탭 목록, 마지막으로 쓴 탭 표시 ----------
  const MODES = [['scale', '스케일 연습'], ['tone', '코드톤 지도'], ['matrix', '보이싱 매트릭스'], ['circle', '탑노트 5도권'], ['reint', '코드 재해석'], ['tf', '2-5-1 탐색']];
  const last = raw.get('ulp:tab');
  $('modes').innerHTML = MODES.map(([id, name], i) =>
    '<li' + (id === last ? ' class="cur"' : '') + '><a href="chords.html#' + encodeURIComponent(id) + '"><span class="t">' + (i + 1) + ' · ' + esc(name) + '</span>' +
    '<span class="m">' + (id === last ? '이어서' : '') + '</span></a></li>').join('');

  // ---------- 플레이어: 내 연습 곡 ----------
  function songsNote(t, toLogin) {
    $('songs').innerHTML = '<li class="note">' + (toLogin ? '<a href="settings.html#account">' + esc(t) + '</a>' : esc(t)) + '</li>';
  }
  let songsReqUid = null;
  async function loadSongs() {
    const D = window.ULData;
    if (!D || !D.isLoggedIn()) return songsNote('로그인하면 내 연습 곡이 여기 보여요', true);
    const u = window.ULAuth && typeof window.ULAuth.getUser === 'function' ? window.ULAuth.getUser() : null;
    const myUid = u ? u.id : null;
    if (!myUid) return songsNote('로그인하면 내 연습 곡이 여기 보여요', true);
    songsReqUid = myUid;
    songsNote('불러오는 중…');
    try {
      const list = await D.songs.list();
      const curU = window.ULAuth && typeof window.ULAuth.getUser === 'function' ? window.ULAuth.getUser() : null;
      const curUid = curU ? curU.id : null;
      if (songsReqUid !== curUid) return;
      const songs = (list || []).slice(0, 5);
      if (!songs.length) return songsNote('아직 곡이 없어요. 위에 링크를 붙여넣어 시작하세요');
      $('songs').innerHTML = songs.map((s) => {
        const meta = [s.status, s.rate ? s.rate + '×' : '', s.lastDate ? s.lastDate.slice(5).replace('-', '/') : ''].filter(Boolean).join(' · ');
        return '<li><a href="practice.html?v=' + encodeURIComponent(s.videoId) + '"><span class="t">' + esc(s.title) + '</span><span class="m">' + esc(meta) + '</span></a></li>';
      }).join('');
    } catch (e) {
      const curU = window.ULAuth && typeof window.ULAuth.getUser === 'function' ? window.ULAuth.getUser() : null;
      const curUid = curU ? curU.id : null;
      if (songsReqUid !== curUid) return;
      songsNote((e && e.message) || '곡 목록을 불러오지 못했어요');
    }
  }

  let lastSongsUid = undefined;
  function handleAuthChange(state) {
    const u = (state && state.user) || (window.ULAuth && typeof window.ULAuth.getUser === 'function' && window.ULAuth.getUser()) || null;
    const uid = u ? u.id : null;
    if (uid !== lastSongsUid) {
      lastSongsUid = uid;
      loadSongs();
    }
  }

  if (window.ULAuth && typeof window.ULAuth.onChange === 'function') {
    window.ULAuth.onChange(handleAuthChange);
  } else {
    loadSongs();
  }

  // ---------- 노션 바로가기 (https 링크만) ----------
  const links = [['nlPractice', safeUrl(raw.get('ulp:notion-practice'))], ['nlNotes', safeUrl(raw.get('ulp:notion-notes'))]];
  links.forEach(([id, href]) => { $(id).hidden = !href; if (href) $(id).href = safeUrl(href); });
  $('notionLinks').hidden = !links.some(([, href]) => href);
  const main = links.find(([, href]) => href);
  if (main) { $('notionBig').href = safeUrl(main[1]); $('notionBig').target = '_blank'; $('notionBig').rel = 'noopener'; }

  $('copy').textContent = '©' + new Date().getFullYear();
})();
