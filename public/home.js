// 첫 화면(index.html): 링크 붙여넣기, 주간 스트릭·작심삼일, 최근 연습 곡, BETTER(7모드·연습곡) | VAULT(최근 노트·코드 진행), 노션 바로가기
'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const { raw, json, videoIdFrom, thumb, esc, safeUrl } = UL;

  // ---------- 1. 링크 붙여넣기 ----------
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
  $('go').addEventListener('submit', (e) => {
    e.preventDefault();
    pick();
    if (!$('goPick').hidden) $('goPlay').click();
  });

  // ---------- 2. 코드 연습: 7개 탭 목록, 마지막으로 쓴 탭 표시 ----------
  const MODES = [
    ['scale', '스케일 연습'],
    ['tone', '코드톤 지도'],
    ['matrix', '보이싱 매트릭스'],
    ['circle', '탑노트 5도권'],
    ['reint', '코드 재해석'],
    ['tf', '2-5-1 탐색'],
    ['ds', '더블 스탑 연습'],
  ];
  const last = raw.get('ulp:tab');
  $('modes').innerHTML = MODES.map(
    ([id, name], i) =>
      '<li' +
      (id === last ? ' class="cur"' : '') +
      '><a href="chords.html#' +
      encodeURIComponent(id) +
      '"><span class="t">' +
      (i + 1) +
      ' · ' +
      esc(name) +
      '</span>' +
      '<span class="m">' +
      (id === last ? '이어서' : '') +
      '</span></a></li>'
  ).join('');

  // ---------- 3. 날짜·스트릭·시간 포맷 헬퍼 ----------
  const DOW_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

  function localTodayStr() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function parseYmdUtc(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
    if (!m) return null;
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }

  function formatYmdUtc(dt) {
    return (
      dt.getUTCFullYear() +
      '-' +
      String(dt.getUTCMonth() + 1).padStart(2, '0') +
      '-' +
      String(dt.getUTCDate()).padStart(2, '0')
    );
  }

  function addDaysUtc(dt, delta) {
    return new Date(dt.getTime() + delta * 86400000);
  }

  function fmtSec(sec) {
    if (typeof sec !== 'number' || !isFinite(sec) || sec < 0) return '00:00';
    const total = Math.floor(sec);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function renderWeeklyStreak(activeDates) {
    const daysEl = $('streakDays');
    const textEl = $('streakChallengeText');
    const dotsEl = $('streakDots');
    if (!daysEl || !textEl || !dotsEl) return;

    const practicedSet = new Set();
    (activeDates || []).forEach((d) => {
      if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) {
        practicedSet.add(d.trim());
      }
    });

    const todayStr = localTodayStr();
    const baseDate = parseYmdUtc(todayStr);
    const jsDay = baseDate.getUTCDay();
    const mondayOffset = jsDay === 0 ? -6 : 1 - jsDay;
    const mondayDate = addDaysUtc(baseDate, mondayOffset);

    daysEl.replaceChildren();
    DOW_LABELS.forEach((dow, idx) => {
      const dt = addDaysUtc(mondayDate, idx);
      const dStr = formatYmdUtc(dt);
      const practiced = practicedSet.has(dStr);
      const isToday = dStr === todayStr;

      const cell = document.createElement('div');
      cell.className = 'streak-cell' + (practiced ? ' done' : '') + (isToday ? ' today' : '');
      cell.dataset.date = dStr;
      cell.dataset.practiced = practiced ? '1' : '0';

      const dowSpan = document.createElement('span');
      dowSpan.className = 'dow';
      dowSpan.textContent = dow;

      const numSpan = document.createElement('span');
      numSpan.className = 'num';
      numSpan.textContent = String(dt.getUTCDate());

      cell.appendChild(dowSpan);
      cell.appendChild(numSpan);
      daysEl.appendChild(cell);
    });

    let streakDays = 0;
    const yesterdayStr = formatYmdUtc(addDaysUtc(baseDate, -1));
    let cursor = null;
    if (practicedSet.has(todayStr)) cursor = baseDate;
    else if (practicedSet.has(yesterdayStr)) cursor = addDaysUtc(baseDate, -1);

    while (cursor && streakDays < 3650) {
      if (!practicedSet.has(formatYmdUtc(cursor))) break;
      streakDays++;
      cursor = addDaysUtc(cursor, -1);
    }

    const cycleStep = streakDays === 0 ? 0 : ((streakDays - 1) % 3) + 1;
    textEl.textContent =
      streakDays === 0
        ? '작심삼일 도전하기 · 오늘 첫 연습을 시작해 보세요'
        : '작심삼일 도전하기 · 연속 ' + streakDays + '일째 (' + cycleStep + '/3)';

    dotsEl.replaceChildren();
    for (let s = 1; s <= 3; s++) {
      const dot = document.createElement('i');
      dot.className = 'streak-dot' + (cycleStep >= s ? ' on' : '');
      dotsEl.appendChild(dot);
    }
  }

  function renderRecentSong(song) {
    const goEl = $('recentSongGo');
    const bodyEl = $('recentSongBody');
    const emptyEl = $('recentSongEmpty');
    const thumbEl = $('recentSongThumb');
    const titleEl = $('recentSongTitle');
    const segEl = $('recentSongSegment');
    const resumeEl = $('recentSongResume');
    if (!bodyEl || !emptyEl) return;

    if (!song || !song.videoId) {
      if (goEl) goEl.hidden = true;
      bodyEl.hidden = true;
      emptyEl.hidden = false;
      return;
    }

    const vid = videoIdFrom(song.videoId) || song.videoId;
    if (thumbEl) thumbEl.src = thumb(vid);
    if (titleEl) titleEl.textContent = song.title || '최근 연습 영상 (' + vid + ')';

    const hasLoop = typeof song.a === 'number' && typeof song.b === 'number' && song.b > song.a;
    if (segEl) {
      if (hasLoop) {
        const rPart = song.rate && song.rate !== 1 ? ' · ' + song.rate + '×' : '';
        segEl.textContent = fmtSec(song.a) + ' ~ ' + fmtSec(song.b) + ' 구간 연습 중' + rPart;
      } else {
        const pStr = typeof song.pos === 'number' && song.pos > 0 ? fmtSec(song.pos) : '00:00';
        const rStr = song.rate ? song.rate + '×' : '1×';
        segEl.textContent = '마지막 위치 ' + pStr + ' · ' + rStr + ' 연습 중';
      }
    }

    if (goEl) {
      goEl.href = 'practice.html?v=' + encodeURIComponent(vid);
      goEl.hidden = false;
    }
    if (resumeEl) {
      resumeEl.href = 'practice.html?v=' + encodeURIComponent(vid);
    }

    emptyEl.hidden = true;
    bodyEl.hidden = false;
  }

  function renderRecentNote(note) {
    const bodyEl = $('recentNoteBody');
    const emptyEl = $('recentNoteEmpty');
    const thumbEl = $('recentNoteThumb');
    const titleEl = $('recentNoteTitle');
    const hlEl = $('recentNoteHeadline');
    const linkEl = $('recentNoteLink');
    if (!bodyEl || !emptyEl) return;

    if (!note || !note.id) {
      bodyEl.hidden = true;
      emptyEl.hidden = false;
      return;
    }

    if (thumbEl && note.videoId) thumbEl.src = thumb(note.videoId);
    if (titleEl) titleEl.textContent = note.title || '(제목 없음)';
    if (hlEl) hlEl.textContent = note.headline || note.channel || '핵심 요약 노트';
    if (linkEl) linkEl.href = 'note.html?id=' + encodeURIComponent(note.id);

    emptyEl.hidden = true;
    bodyEl.hidden = false;
  }

  // ---------- 4. 코드 진행 꺼내보기 (REFERENCE / ARCHIVE) ----------
  const SEED_REF = [
    { chords: 'CM7 - C7 - F#m7b5 - Fm6', title: 'Neo-Soul Minor Plagal Cadence', key: 'C Major', src: '기본', tab: 'reint' },
    { chords: 'FM9 - E7b9 - Am9 - C13', title: 'Just the Two of Us Turnaround', key: 'A Minor', src: '기본', tab: 'tf' },
    { chords: 'EbM9 - D7#9 - Gm9 - C9sus4', title: 'R&B Floating IV-III-vi-II', key: 'G Minor', src: '기본', tab: 'matrix' },
    { chords: 'BbM7 - A7b13 - Dm9 - G7b9', title: 'Autumn Leaves Minor Cycle', key: 'D Minor', src: '기본', tab: 'circle' },
    { chords: 'AbM9 - G7#5#9 - Cm9 - F13', title: 'Modern Gospel Dorian Vamp', key: 'C Minor', src: '기본', tab: 'tone' },
  ];

  const SEED_ARCH = [
    { chords: 'Dm9 - G13 - CM9 - A7b13', title: 'Drop 2 가이드톤 2-5-1-6 순환', key: 'C Major', src: '기본', tab: 'tf' },
    { chords: 'Em7b5 - A7b9 - Dm6/9 - Bm7b5', title: '마이너 2-5-1 및 6도 토닉 보이싱', key: 'D Minor', src: '기본', tab: 'tf' },
    { chords: 'F9 - Bb13 - Eb9 - Ab13', title: '탑노트 고정 도미넌트 5도권 연결', key: 'F Dominant', src: '기본', tab: 'circle' },
    { chords: 'Gm9 - C7sus4 - FM9 - Bb7#11', title: '서스포(sus4) 해결과 리디안 도미넌트(#11)', key: 'F Major', src: '기본', tab: 'reint' },
    { chords: 'Am11 - D9 - GM9 - C#m7b5 - F#7alt', title: '조표 전환 모듈레이션 브리지 진행', key: 'G Major', src: '기본', tab: 'matrix' },
  ];

  let refItems = SEED_REF.slice();
  let archItems = SEED_ARCH.slice();
  let refIdx = 0;
  let archIdx = 0;

  function pickNextIdx(cur, len) {
    if (len <= 1) return 0;
    const r = Math.floor(Math.random() * (len - 1));
    return r >= cur ? r + 1 : r;
  }

  function renderProgressionCards() {
    const rItem = refItems[refIdx] || SEED_REF[0];
    const aItem = archItems[archIdx] || SEED_ARCH[0];

    if ($('progRefKey')) $('progRefKey').textContent = rItem.key;
    if ($('progRefChords')) {
      $('progRefChords').textContent = rItem.chords;
      if (rItem.noteId) {
        $('progRefChords').href = 'note.html?id=' + encodeURIComponent(rItem.noteId);
      } else {
        $('progRefChords').href = 'chords.html#' + encodeURIComponent(rItem.tab || 'reint');
      }
    }
    if ($('progRefTitle')) $('progRefTitle').textContent = rItem.title + ' · 출처: ' + rItem.src;

    if ($('progArchKey')) $('progArchKey').textContent = aItem.key;
    if ($('progArchChords')) {
      $('progArchChords').textContent = aItem.chords;
      if (aItem.noteId) {
        $('progArchChords').href = 'note.html?id=' + encodeURIComponent(aItem.noteId);
      } else {
        $('progArchChords').href = 'chords.html#' + encodeURIComponent(aItem.tab || 'tf');
      }
    }
    if ($('progArchTitle')) $('progArchTitle').textContent = aItem.title + ' · 출처: ' + aItem.src;
  }

  if ($('btnRandRef')) {
    $('btnRandRef').addEventListener('click', () => {
      refIdx = pickNextIdx(refIdx, refItems.length);
      renderProgressionCards();
    });
  }
  if ($('btnRandArch')) {
    $('btnRandArch').addEventListener('click', () => {
      archIdx = pickNextIdx(archIdx, archItems.length);
      renderProgressionCards();
    });
  }
  renderProgressionCards();

  // ---------- 5. 플레이어: 내 연습 곡 및 대시보드 동기화 ----------
  function songsNote(t, toLogin) {
    $('songs').innerHTML =
      '<li class="note">' +
      (toLogin
        ? '<a href="settings.html#account">' +
          esc(t) +
          '</a> · <a href="settings.html#keys">SETTING에서 노션을 연결하면 연습 곡이 여기 보여요</a>'
        : esc(t)) +
      '</li>';
  }

  let homeReqSeq = 0;

  async function loadDashboard() {
    const D = window.ULData;
    const mySeq = ++homeReqSeq;
    const locals = D && typeof D.listLocalSongs === 'function' ? D.listLocalSongs() : [];

    if (!D || !D.isLoggedIn()) {
      renderWeeklyStreak(locals.map((it) => it.date || '').filter(Boolean));
      renderRecentSong(locals[0] || null);
      renderRecentNote(null);
      refItems = SEED_REF.slice();
      archItems = SEED_ARCH.slice();
      refIdx = 0;
      archIdx = 0;
      renderProgressionCards();
      return songsNote('로그인하면 내 연습 곡이 여기 보여요', true);
    }

    const u = window.ULAuth && typeof window.ULAuth.getUser === 'function' ? window.ULAuth.getUser() : null;
    const myUid = u ? u.id : null;
    if (!myUid) {
      renderWeeklyStreak(locals.map((it) => it.date || '').filter(Boolean));
      renderRecentSong(locals[0] || null);
      renderRecentNote(null);
      return songsNote('로그인하면 내 연습 곡이 여기 보여요', true);
    }

    songsNote('불러오는 중…');

    let loadedSongDates = [];
    try {
      const list = await D.songs.list();
      const curU = window.ULAuth && typeof window.ULAuth.getUser === 'function' ? window.ULAuth.getUser() : null;
      const curUid = curU ? curU.id : null;
      if (mySeq !== homeReqSeq || myUid !== curUid) return;

      const allSongs = Array.isArray(list) ? list : [];
      loadedSongDates = allSongs.map((s) => s.lastDate || '').filter(Boolean);
      renderRecentSong(allSongs[0] || null);
      renderWeeklyStreak(loadedSongDates);

      const topSongs = allSongs.slice(0, 5);
      if (!topSongs.length) {
        songsNote('아직 곡이 없어요. 위에 링크를 붙여넣어 시작하세요');
      } else {
        $('songs').innerHTML = topSongs
          .map((s) => {
            const meta = [s.status, s.rate ? s.rate + '×' : '', s.lastDate ? s.lastDate.slice(5).replace('-', '/') : '']
              .filter(Boolean)
              .join(' · ');
            return (
              '<li><a href="practice.html?v=' +
              encodeURIComponent(s.videoId) +
              '"><span class="t">' +
              esc(s.title) +
              '</span><span class="m">' +
              esc(meta) +
              '</span></a></li>'
            );
          })
          .join('');
      }
    } catch (e) {
      const curU = window.ULAuth && typeof window.ULAuth.getUser === 'function' ? window.ULAuth.getUser() : null;
      const curUid = curU ? curU.id : null;
      if (mySeq !== homeReqSeq || myUid !== curUid) return;
      renderRecentSong(null);
      songsNote((e && e.message) || '곡 목록을 불러오지 못했어요');
    }

    // 주간 스트릭용 세션 달력 병렬 보강
    if (D.sessions && typeof D.sessions.list === 'function') {
      D.sessions
        .list({ today: localTodayStr() })
        .then((res) => {
          const curU = window.ULAuth && typeof window.ULAuth.getUser === 'function' ? window.ULAuth.getUser() : null;
          const curUid = curU ? curU.id : null;
          if (mySeq !== homeReqSeq || myUid !== curUid) return;
          const calDates = ((res && res.calendar) || []).filter((d) => d && d.totalSeconds > 0).map((d) => d.date);
          const sessDates = ((res && res.sessions) || []).filter((s) => s && s.seconds > 0).map((s) => s.date);
          renderWeeklyStreak(loadedSongDates.concat(calDates, sessDates));
        })
        .catch(() => {});
    }

    // 최근 학습 노트 조회 및 상세 병렬 조회로 코드 진행 카드 연동 (PR #38 리뷰 반영)
    if (D.notes && typeof D.notes.list === 'function') {
      D.notes
        .list()
        .then(async (notes) => {
          const curU = window.ULAuth && typeof window.ULAuth.getUser === 'function' ? window.ULAuth.getUser() : null;
          const curUid = curU ? curU.id : null;
          if (mySeq !== homeReqSeq || myUid !== curUid) return;
          const safeNotes = Array.isArray(notes) ? notes : [];
          renderRecentNote(safeNotes[0] || null);

          if (safeNotes.length > 0 && typeof D.notes.get === 'function') {
            const topNotes = safeNotes.slice(0, 3);
            const userRef = [];
            const userArch = [];
            await Promise.all(
              topNotes.map(async (n) => {
                try {
                  const detail = await D.notes.get(n.id);
                  const progs =
                    detail && detail.analysis && detail.analysis.harmony && Array.isArray(detail.analysis.harmony.progressions)
                      ? detail.analysis.harmony.progressions
                      : [];
                  progs.forEach((p) => {
                    const chords = Array.isArray(p && p.chords)
                      ? p.chords.map((c) => String((c && c.symbol) || '').trim()).filter(Boolean)
                      : [];
                    if (chords.length >= 2) {
                      const isRef = Array.isArray(detail.tags) && detail.tags.includes('편곡');
                      const item = {
                        chords: chords.join(' - '),
                        title: String(p.name || detail.title || '화성 노트 진행'),
                        key: String(p.key || '분석 노트'),
                        src: 'AI',
                        noteId: detail.id,
                      };
                      if (isRef) userRef.push(item);
                      else userArch.push(item);
                    }
                  });
                } catch (e) {
                  /* 개별 노트 상세 실패 격리 */
                }
              })
            );

            const curU2 = window.ULAuth && typeof window.ULAuth.getUser === 'function' ? window.ULAuth.getUser() : null;
            const curUid2 = curU2 ? curU2.id : null;
            if (mySeq !== homeReqSeq || myUid !== curUid2) return;

            refItems = userRef.length > 0 ? userRef.concat(SEED_REF) : SEED_REF.slice();
            archItems = userArch.length > 0 ? userArch.concat(SEED_ARCH) : SEED_ARCH.slice();
            refIdx = 0;
            archIdx = 0;
            renderProgressionCards();
          }
        })
        .catch(() => {
          const curU = window.ULAuth && typeof window.ULAuth.getUser === 'function' ? window.ULAuth.getUser() : null;
          const curUid = curU ? curU.id : null;
          if (mySeq !== homeReqSeq || myUid !== curUid) return;
          renderRecentNote(null);
        });
    }
  }

  let lastSongsUid = undefined;
  function handleAuthChange(state) {
    const u =
      (state && state.user) ||
      (window.ULAuth && typeof window.ULAuth.getUser === 'function' && window.ULAuth.getUser()) ||
      null;
    const uid = u ? u.id : null;
    if (uid !== lastSongsUid) {
      lastSongsUid = uid;
      loadDashboard();
    }
  }

  if (window.ULAuth && typeof window.ULAuth.onChange === 'function') {
    window.ULAuth.onChange(handleAuthChange);
  } else {
    loadDashboard();
  }

  // ---------- 6. 노션 바로가기 (https 링크만) ----------
  const links = [
    ['nlPractice', safeUrl(raw.get('ulp:notion-practice'))],
    ['nlNotes', safeUrl(raw.get('ulp:notion-notes'))],
  ];
  links.forEach(([id, href]) => {
    $(id).hidden = !href;
    if (href) $(id).href = safeUrl(href);
  });
  $('notionLinks').hidden = !links.some(([, href]) => href);
  const main = links.find(([, href]) => href);
  if (main) {
    $('notionBig').href = safeUrl(main[1]);
    $('notionBig').target = '_blank';
    $('notionBig').rel = 'noopener';
  }

  $('copy').textContent = '©' + new Date().getFullYear();
})();
