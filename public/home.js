// 첫 화면(index.html): 링크 붙여넣기, 코드 연습 탭 목록, 노션 연습 곡, 노션 바로가기
'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const { raw, videoIdFrom, thumb, esc, safeUrl, notion } = UL;

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

  // ---------- 플레이어: 노션의 연습 곡 ----------
  function songsNote(t, toSettings) {
    $('songs').innerHTML = '<li class="note">' + (toSettings ? '<a href="settings.html#notion">' + esc(t) + '</a>' : esc(t)) + '</li>';
  }
  async function loadSongs() {
    if (!notion.ok()) return songsNote('SETTING에서 노션을 연결하면 연습 곡이 여기 보여요', true);
    songsNote('불러오는 중…');
    try {
      const songs = ((await notion.call('/songs')).songs || []).slice(0, 5);
      if (!songs.length) return songsNote('아직 곡이 없어요. 위에 링크를 붙여넣어 시작하세요');
      $('songs').innerHTML = songs.map((s) => {
        const meta = [s.status, s.rate ? s.rate + '×' : '', s.lastDate ? s.lastDate.slice(5).replace('-', '/') : ''].filter(Boolean).join(' · ');
        return '<li><a href="practice.html?v=' + encodeURIComponent(s.videoId) + '"><span class="t">' + esc(s.title) + '</span><span class="m">' + esc(meta) + '</span></a></li>';
      }).join('');
    } catch (e) {
      songsNote(e.message);
    }
  }
  loadSongs();

  // ---------- 노션 바로가기 (https 링크만) ----------
  const links = [['nlPractice', safeUrl(raw.get('ulp:notion-practice'))], ['nlNotes', safeUrl(raw.get('ulp:notion-notes'))]];
  links.forEach(([id, href]) => { $(id).hidden = !href; if (href) $(id).href = safeUrl(href); });
  $('notionLinks').hidden = !links.some(([, href]) => href);
  const main = links.find(([, href]) => href);
  if (main) { $('notionBig').href = safeUrl(main[1]); $('notionBig').target = '_blank'; $('notionBig').rel = 'noopener'; }

  $('copy').textContent = '©' + new Date().getFullYear();
})();
