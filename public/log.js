// public/log.js — 최근 12주 연습 달력, 주간/월간 요약, 날짜별 세션·녹음 재생·메모 저장 + 곡 탭·곡 상세·A/B 비교 듣기
(function () {
  'use strict';

  const safeUrl = (window.UL && window.UL.safeUrl) || function (u) { return String(u || ''); };
  const esc = (window.UL && window.UL.esc) || function (s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  let currentUid = null;
  let sessionsData = null; // { summary, calendar, sessions }
  let selectedDate = null;
  let activeTab = 'log'; // 'log' | 'songs'
  let currentSongFilter = ''; // '' | 'practicing' | 'paused' | 'done'
  let songsCache = null;
  let currentDetailSong = null; // { song, sessions, takes }
  let abSelected = []; // [takeId1, takeId2]
  let detailTakesMap = new Map();

  function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function build84Days(baseDateStr) {
    const parts = baseDateStr.split('-').map(Number);
    const base = new Date(parts[0], parts[1] - 1, parts[2]);
    const arr = [];
    for (let i = 83; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      arr.push(y + '-' + m + '-' + day);
    }
    return arr;
  }

  function fmtDuration(sec) {
    sec = Number(sec) || 0;
    if (sec <= 0) return '0분';
    if (sec < 60) return sec + '초';
    if (sec < 3600) return Math.round(sec / 60) + '분';
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return m > 0 ? h + '시간 ' + m + '분' : h + '시간';
  }

  function fmtTakeMeta(take) {
    let timeStr = '';
    if (take.recordedAt) {
      try {
        const d = new Date(take.recordedAt);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        timeStr = hh + ':' + mm;
      } catch (_) {
        timeStr = '';
      }
    }
    let res = timeStr ? timeStr + ' · ' : '';
    res += (take.durationSec || 0) + '초';
    if (take.rate != null) {
      res += ' · ' + take.rate + '×';
    }
    return res;
  }

  function setMsg(text, type) {
    const el = document.getElementById('logMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'msg' + (type ? ' ' + type : '');
  }

  function showGuest(isGuest) {
    const guestEl = document.getElementById('logGuest');
    const paneLog = document.getElementById('pane-log');
    const paneSongs = document.getElementById('pane-songs');
    const paneDetail = document.getElementById('pane-song-detail');
    const tabs = document.getElementById('logTabs');
    const header = document.getElementById('logHeader');

    if (guestEl) guestEl.hidden = !isGuest;
    if (isGuest) {
      if (paneLog) paneLog.hidden = true;
      if (paneSongs) paneSongs.hidden = true;
      if (paneDetail) paneDetail.hidden = true;
      if (tabs) tabs.hidden = true;
      if (header) header.hidden = false;
    } else {
      routeView();
    }
  }

  function resetState() {
    sessionsData = null;
    selectedDate = null;
    songsCache = null;
    currentDetailSong = null;
    abSelected = [];
    detailTakesMap.clear();

    document.querySelectorAll('audio').forEach(function (a) {
      try {
        a.pause();
        a.src = '';
      } catch (_) {}
    });

    const sumWeek = document.getElementById('sumWeek');
    if (sumWeek) sumWeek.textContent = '0분';
    const sumMonth = document.getElementById('sumMonth');
    if (sumMonth) sumMonth.textContent = '0분';
    const calRange = document.getElementById('calRange');
    if (calRange) calRange.textContent = '';
    const calGrid = document.getElementById('calGrid');
    if (calGrid) calGrid.replaceChildren();
    const daySessions = document.getElementById('daySessions');
    if (daySessions) daySessions.replaceChildren();
    const dayTitle = document.getElementById('dayTitle');
    if (dayTitle) dayTitle.textContent = '연습 기록';
    const songList = document.getElementById('songList');
    if (songList) songList.replaceChildren();
    const abPanel = document.getElementById('abPanel');
    if (abPanel) abPanel.hidden = true;
  }

  // -------------------- 탭 1: 연습 기록 (Log) --------------------
  function renderSummary() {
    const sumWeek = document.getElementById('sumWeek');
    const sumMonth = document.getElementById('sumMonth');
    const summary = (sessionsData && sessionsData.summary) || {};
    if (sumWeek) sumWeek.textContent = fmtDuration(summary.thisWeekSeconds);
    if (sumMonth) sumMonth.textContent = fmtDuration(summary.thisMonthSeconds);
  }

  function renderCalendar() {
    const calGrid = document.getElementById('calGrid');
    const calRange = document.getElementById('calRange');
    if (!calGrid) return;

    const t = todayStr();
    const days84 = build84Days(t);

    if (calRange && days84.length >= 84) {
      calRange.textContent = days84[0] + ' ~ ' + days84[83];
    }

    const calendarMap = new Map();
    if (sessionsData && Array.isArray(sessionsData.calendar)) {
      sessionsData.calendar.forEach(function (c) {
        calendarMap.set(c.date, c);
      });
    }

    calGrid.replaceChildren();

    days84.forEach(function (dateStr) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const c = calendarMap.get(dateStr);
      const lv = c && c.level ? c.level : 0;
      btn.className = 'cal-day lv' + lv;
      btn.setAttribute('data-date', dateStr);
      const isSelected = dateStr === selectedDate;
      btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
      const durText = c ? fmtDuration(c.totalSeconds) : '0분';
      btn.setAttribute('aria-label', dateStr + ' · ' + durText);

      btn.addEventListener('click', function () {
        if (selectedDate !== dateStr) {
          selectedDate = dateStr;
          renderCalendar();
          renderDaySessions();
        }
      });

      calGrid.appendChild(btn);
    });
  }

  function renderDaySessions() {
    const dayTitle = document.getElementById('dayTitle');
    const daySessions = document.getElementById('daySessions');
    if (!daySessions) return;

    if (dayTitle) {
      dayTitle.textContent = selectedDate ? selectedDate + ' 연습 기록' : '연습 기록';
    }

    daySessions.replaceChildren();

    const allSessions = (sessionsData && sessionsData.sessions) || [];
    const matched = allSessions.filter(function (s) {
      return s.date === selectedDate;
    });

    if (matched.length === 0) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = '이 날에는 기록된 연습 세션이 없어요.';
      daySessions.appendChild(p);
      return;
    }

    matched.forEach(function (s) {
      const card = document.createElement('div');
      card.className = 'card session-card';

      // 1. 헤더: 제목 + ▶ 연습 링크
      const head = document.createElement('div');
      head.className = 'session-head';

      const titleDiv = document.createElement('div');
      titleDiv.className = 'session-title';
      let titleText = s.songTitle || '제목 없는 곡';
      if (s.songArtist) titleText += ' · ' + s.songArtist;
      titleDiv.textContent = titleText;
      head.appendChild(titleDiv);

      const playLink = document.createElement('a');
      playLink.className = 'ghost mini';
      playLink.href = 'practice.html?v=' + encodeURIComponent(s.videoId || '');
      playLink.textContent = '▶ 연습';
      head.appendChild(playLink);

      card.appendChild(head);

      // 2. 메타
      const metaDiv = document.createElement('div');
      metaDiv.className = 'meta';
      let metaText = s.minutes + '분 (' + s.seconds + '초) · 반복 ' + s.loops + '회';
      if (s.segment) {
        metaText += ' · 구간 ' + s.segment;
      }
      if (s.rate != null) {
        metaText += ' · ' + s.rate + '×';
      }
      metaDiv.textContent = metaText;
      card.appendChild(metaDiv);

      // 3. 메모 편집 행
      const memoDiv = document.createElement('div');
      memoDiv.className = 'session-memo';

      const textarea = document.createElement('textarea');
      textarea.className = 'inp';
      textarea.rows = 2;
      textarea.maxLength = 2000;
      textarea.placeholder = '세션 메모를 남겨보세요';
      textarea.value = s.memo || '';
      memoDiv.appendChild(textarea);

      const actDiv = document.createElement('div');
      actDiv.className = 'session-memo-act';

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'ghost mini';
      saveBtn.textContent = '메모 저장';

      const statusSpan = document.createElement('span');
      statusSpan.className = 'meta';

      saveBtn.addEventListener('click', function () {
        saveBtn.disabled = true;
        statusSpan.textContent = '저장 중...';
        window.ULData.sessions.updateMemo(s.id, textarea.value)
          .then(function () {
            s.memo = textarea.value.trim();
            statusSpan.textContent = '저장됨';
            setTimeout(function () {
              if (statusSpan.textContent === '저장됨') {
                statusSpan.textContent = '';
              }
            }, 2000);
          })
          .catch(function (err) {
            statusSpan.textContent = (err && err.message) || '저장 실패';
          })
          .finally(function () {
            saveBtn.disabled = false;
          });
      });

      actDiv.appendChild(saveBtn);
      actDiv.appendChild(statusSpan);
      memoDiv.appendChild(actDiv);
      card.appendChild(memoDiv);

      // 4. 녹음 목록 (takes)
      if (Array.isArray(s.takes) && s.takes.length > 0) {
        const takesDiv = document.createElement('div');
        takesDiv.className = 'session-takes';

        s.takes.forEach(function (t) {
          const row = document.createElement('div');
          row.className = 'take-row';

          const label = document.createElement('span');
          label.className = 'take-meta';
          label.textContent = '🎙 ' + fmtTakeMeta(t);
          row.appendChild(label);

          const playBtn = document.createElement('button');
          playBtn.type = 'button';
          playBtn.className = 'ghost mini';
          playBtn.textContent = '▶ 듣기';
          row.appendChild(playBtn);

          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'ghost mini';
          delBtn.textContent = '삭제';
          row.appendChild(delBtn);

          const msgSpan = document.createElement('span');
          msgSpan.className = 'meta';
          row.appendChild(msgSpan);

          const audio = document.createElement('audio');
          audio.controls = true;
          audio.preload = 'none';
          audio.hidden = true;
          row.appendChild(audio);

          playBtn.addEventListener('click', function () {
            if (t.storage === 'drive') {
              msgSpan.textContent = 'Google Drive 녹음은 드라이브 연동 단계(K6-1)에서 재생을 지원해요.';
              return;
            }
            if (t.storage === 'supabase') {
              if (!audio.src) {
                playBtn.disabled = true;
                msgSpan.textContent = '주소 요청 중...';
                window.ULData.takes.getUrl(t.id)
                  .then(function (r) {
                    if (r && r.url) {
                      audio.src = safeUrl(r.url);
                      audio.hidden = false;
                      msgSpan.textContent = '';
                      audio.play().catch(function () {});
                    } else {
                      msgSpan.textContent = '주소 발급 실패';
                    }
                  })
                  .catch(function (err) {
                    msgSpan.textContent = (err && err.message) || '재생 실패';
                  })
                  .finally(function () {
                    playBtn.disabled = false;
                  });
              } else {
                audio.hidden = false;
                audio.play().catch(function () {});
              }
            }
          });

          delBtn.addEventListener('click', function () {
            if (!window.confirm('이 녹음을 삭제할까요?')) return;
            delBtn.disabled = true;
            window.ULData.takes.remove(t.id)
              .then(function () {
                s.takes = s.takes.filter(function (it) {
                  return it.id !== t.id;
                });
                row.remove();
                if (!s.takes || s.takes.length === 0) {
                  takesDiv.remove();
                }
              })
              .catch(function (err) {
                alert((err && err.message) || '녹음 삭제에 실패했어요');
                delBtn.disabled = false;
              });
          });

          takesDiv.appendChild(row);
        });

        card.appendChild(takesDiv);
      }

      daySessions.appendChild(card);
    });
  }

  async function loadLog() {
    setMsg('기록을 불러오는 중...');
    const t = todayStr();
    const reqUid = currentUid;
    try {
      const data = await window.ULData.sessions.list({ today: t });
      if (reqUid !== currentUid) return;
      sessionsData = data || { summary: { thisWeekSeconds: 0, thisMonthSeconds: 0 }, calendar: [], sessions: [] };
      setMsg('');

      if (!selectedDate) {
        if (Array.isArray(sessionsData.sessions) && sessionsData.sessions.length > 0) {
          selectedDate = sessionsData.sessions[0].date;
        } else {
          selectedDate = t;
        }
      }

      renderSummary();
      renderCalendar();
      renderDaySessions();
    } catch (e) {
      if (reqUid !== currentUid) return;
      setMsg((e && e.message) || '연습 기록을 불러오지 못했어요', 'err');
    }
  }

  // -------------------- 탭 2: 곡 보관함 (Songs) --------------------
  async function loadSongsTab() {
    setMsg('곡 목록을 불러오는 중...');
    const reqUid = currentUid;
    try {
      const list = await window.ULData.songs.list(currentSongFilter);
      if (reqUid !== currentUid) return;
      songsCache = list || [];
      setMsg('');
      renderSongList();
    } catch (e) {
      if (reqUid !== currentUid) return;
      setMsg((e && e.message) || '곡 목록을 불러오지 못했어요', 'err');
    }
  }

  function renderSongList() {
    const listEl = document.getElementById('songList');
    if (!listEl) return;
    listEl.replaceChildren();

    const songs = songsCache || [];
    if (songs.length === 0) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = '등록된 연습 곡이 없어요.';
      listEl.appendChild(p);
      return;
    }

    songs.forEach(function (s) {
      const card = document.createElement('div');
      card.className = 'card song-card';

      // 1. 헤더: 제목 링크 + 이어서 연습 바로가기
      const head = document.createElement('div');
      head.className = 'song-card-head';

      const titleLink = document.createElement('a');
      titleLink.className = 'song-detail-link';
      titleLink.href = 'log.html?song=' + encodeURIComponent(s.id);
      const bTitle = document.createElement('b');
      bTitle.textContent = s.title;
      titleLink.appendChild(bTitle);

      if (s.artist) {
        const spanArtist = document.createElement('span');
        spanArtist.className = 'meta';
        spanArtist.textContent = ' · ' + s.artist;
        titleLink.appendChild(spanArtist);
      }
      head.appendChild(titleLink);

      const resumeLink = document.createElement('a');
      resumeLink.className = 'ghost mini';
      resumeLink.href = s.resumeUrl ? safeUrl(s.resumeUrl) : ('practice.html?v=' + encodeURIComponent(s.videoId));
      resumeLink.textContent = '▶ 이어서 연습';
      head.appendChild(resumeLink);

      card.appendChild(head);

      // 2. 요약 줄: 누적 시간 + 최근 연습일
      const metaDiv = document.createElement('div');
      metaDiv.className = 'meta';
      metaDiv.textContent = '누적 ' + fmtDuration(s.totalSeconds) + (s.lastDate ? ' · 최근 연습 ' + s.lastDate : ' · 연습 기록 없음');
      card.appendChild(metaDiv);

      // 3. 편집 줄: 상태 select + 메모 input + 메모 저장 + 곡 삭제
      const editRow = document.createElement('div');
      editRow.className = 'song-card-edit';

      const sel = document.createElement('select');
      sel.setAttribute('aria-label', '곡 상태');
      const optPracticing = new Option('연습 중', 'practicing');
      const optPaused = new Option('보류', 'paused');
      const optDone = new Option('완료', 'done');
      sel.add(optPracticing);
      sel.add(optPaused);
      sel.add(optDone);
      sel.value = s.statusCode || 'practicing';

      sel.addEventListener('change', function () {
        sel.disabled = true;
        window.ULData.songs.update(s.id, { status: sel.value })
          .then(function (updated) {
            if (updated) {
              s.statusCode = updated.statusCode;
              s.status = updated.status;
            }
          })
          .catch(function (err) {
            alert((err && err.message) || '상태 변경에 실패했어요');
            sel.value = s.statusCode || 'practicing';
          })
          .finally(function () {
            sel.disabled = false;
          });
      });
      editRow.appendChild(sel);

      const memoInput = document.createElement('input');
      memoInput.type = 'text';
      memoInput.className = 'inp';
      memoInput.maxLength = 2000;
      memoInput.placeholder = '곡 메모';
      memoInput.value = s.memo || '';
      editRow.appendChild(memoInput);

      const saveMemoBtn = document.createElement('button');
      saveMemoBtn.type = 'button';
      saveMemoBtn.className = 'ghost mini';
      saveMemoBtn.textContent = '메모 저장';
      saveMemoBtn.addEventListener('click', function () {
        saveMemoBtn.disabled = true;
        window.ULData.songs.update(s.id, { memo: memoInput.value })
          .then(function (updated) {
            if (updated) s.memo = updated.memo;
            saveMemoBtn.textContent = '저장됨';
            setTimeout(function () {
              saveMemoBtn.textContent = '메모 저장';
            }, 1500);
          })
          .catch(function (err) {
            alert((err && err.message) || '메모 저장에 실패했어요');
          })
          .finally(function () {
            saveMemoBtn.disabled = false;
          });
      });
      editRow.appendChild(saveMemoBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'ghost mini';
      delBtn.textContent = '곡 삭제';
      delBtn.addEventListener('click', function () {
        if (!window.confirm('이 곡과 모든 연습 기록·녹음 파일을 함께 삭제할까요?')) return;
        delBtn.disabled = true;
        window.ULData.songs.remove(s.id)
          .then(function () {
            card.remove();
            songsCache = (songsCache || []).filter(function (it) { return it.id !== s.id; });
            if (songsCache.length === 0) {
              renderSongList();
            }
          })
          .catch(function (err) {
            alert((err && err.message) || '곡 삭제에 실패했어요');
            delBtn.disabled = false;
          });
      });
      editRow.appendChild(delBtn);

      card.appendChild(editRow);
      listEl.appendChild(card);
    });
  }

  // -------------------- 탭 3: 곡 상세 (Song Detail) --------------------
  async function loadSongDetail(songId) {
    setMsg('곡 상세 정보를 불러오는 중...');
    const reqUid = currentUid;
    try {
      const data = await window.ULData.songs.get(songId);
      if (reqUid !== currentUid) return;
      currentDetailSong = data;
      setMsg('');
      renderSongDetail();
    } catch (e) {
      if (reqUid !== currentUid) return;
      setMsg((e && e.message) || '곡 상세 정보를 불러오지 못했어요', 'err');
    }
  }

  function renderSongDetail() {
    if (!currentDetailSong || !currentDetailSong.song) return;
    const song = currentDetailSong.song;
    const sessions = currentDetailSong.sessions || [];
    const takes = currentDetailSong.takes || [];

    // 1. 상단 정보
    const detailTitle = document.getElementById('detailTitle');
    const detailArtist = document.getElementById('detailArtist');
    const detailMeta = document.getElementById('detailMeta');
    const detailResume = document.getElementById('detailResume');
    const detailStatus = document.getElementById('detailStatus');
    const detailMemo = document.getElementById('detailMemo');
    const btnSaveSongMemo = document.getElementById('btnSaveSongMemo');
    const btnDeleteSong = document.getElementById('btnDeleteSong');
    const btnBackSongs = document.getElementById('btnBackSongs');

    if (detailTitle) detailTitle.textContent = song.title;
    if (detailArtist) detailArtist.textContent = song.artist ? ' · ' + song.artist : '';
    if (detailMeta) {
      detailMeta.textContent = '누적 ' + fmtDuration(song.totalSeconds) + (song.lastDate ? ' · 최근 연습 ' + song.lastDate : ' · 연습 기록 없음');
    }
    if (detailResume) {
      detailResume.href = song.resumeUrl ? safeUrl(song.resumeUrl) : ('practice.html?v=' + encodeURIComponent(song.videoId));
    }
    if (detailStatus) detailStatus.value = song.statusCode || 'practicing';
    if (detailMemo) detailMemo.value = song.memo || '';

    if (detailStatus) {
      detailStatus.onchange = function () {
        detailStatus.disabled = true;
        window.ULData.songs.update(song.id, { status: detailStatus.value })
          .then(function (updated) {
            if (updated) {
              song.statusCode = updated.statusCode;
              song.status = updated.status;
            }
          })
          .catch(function (err) {
            alert((err && err.message) || '상태 변경에 실패했어요');
            detailStatus.value = song.statusCode || 'practicing';
          })
          .finally(function () {
            detailStatus.disabled = false;
          });
      };
    }

    if (btnSaveSongMemo && detailMemo) {
      btnSaveSongMemo.onclick = function () {
        btnSaveSongMemo.disabled = true;
        window.ULData.songs.update(song.id, { memo: detailMemo.value })
          .then(function (updated) {
            if (updated) song.memo = updated.memo;
            btnSaveSongMemo.textContent = '저장됨';
            setTimeout(function () {
              btnSaveSongMemo.textContent = '저장';
            }, 1500);
          })
          .catch(function (err) {
            alert((err && err.message) || '메모 저장에 실패했어요');
          })
          .finally(function () {
            btnSaveSongMemo.disabled = false;
          });
      };
    }

    if (btnDeleteSong) {
      btnDeleteSong.onclick = function () {
        if (!window.confirm('이 곡과 모든 연습 기록·녹음 파일을 함께 삭제할까요?')) return;
        btnDeleteSong.disabled = true;
        window.ULData.songs.remove(song.id)
          .then(function () {
            history.pushState(null, '', 'log.html#songs');
            routeView();
          })
          .catch(function (err) {
            alert((err && err.message) || '곡 삭제에 실패했어요');
            btnDeleteSong.disabled = false;
          });
      };
    }

    if (btnBackSongs) {
      btnBackSongs.onclick = function () {
        history.pushState(null, '', 'log.html#songs');
        routeView();
      };
    }

    // 2. 날짜별 연습 시간 막대 타임라인 (FR-LIB-2)
    const tlContainer = document.getElementById('detailTimeline');
    if (tlContainer) {
      tlContainer.replaceChildren();
      if (sessions.length === 0) {
        const p = document.createElement('p');
        p.className = 'empty';
        p.textContent = '아직 연습 세션 기록이 없어요.';
        tlContainer.appendChild(p);
      } else {
        const maxSec = Math.max(60, ...sessions.map(function (s) { return s.seconds || 0; }));
        sessions.forEach(function (s) {
          const row = document.createElement('div');
          row.className = 'tl-row';

          const metaDiv = document.createElement('div');
          metaDiv.className = 'tl-meta';

          const leftSpan = document.createElement('span');
          let leftText = s.date;
          if (s.segment) leftText += ' · 구간 ' + s.segment;
          if (s.rate != null) leftText += ' · ' + s.rate + '×';
          leftSpan.textContent = leftText;
          metaDiv.appendChild(leftSpan);

          const rightSpan = document.createElement('span');
          rightSpan.className = 'meta';
          rightSpan.textContent = s.minutes + '분 (' + (s.loops || 0) + '회)';
          metaDiv.appendChild(rightSpan);

          row.appendChild(metaDiv);

          // CSP 준수를 위해 <progress> 요소 사용
          const bar = document.createElement('progress');
          bar.className = 'tl-bar';
          bar.max = maxSec;
          bar.value = s.seconds || 0;
          row.appendChild(bar);

          if (s.memo) {
            const memoDiv = document.createElement('div');
            memoDiv.className = 'tl-memo';
            memoDiv.textContent = s.memo;
            row.appendChild(memoDiv);
          }

          tlContainer.appendChild(row);
        });
      }
    }

    // 3. 전체 녹음 목록 & A/B 비교 듣기 (FR-LIB-3)
    renderDetailTakes(takes);
  }

  function renderDetailTakes(takes) {
    const takesContainer = document.getElementById('detailTakes');
    if (!takesContainer) return;
    takesContainer.replaceChildren();

    abSelected = [];
    detailTakesMap.clear();
    updateAbPanel();

    if (takes.length === 0) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = '아직 녹음된 테이크가 없어요.';
      takesContainer.appendChild(p);
      return;
    }

    takes.forEach(function (t) {
      detailTakesMap.set(t.id, t);
      const row = document.createElement('div');
      row.className = 'take-row';

      // A/B 체크박스
      const chkLabel = document.createElement('label');
      chkLabel.className = 'check';
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.className = 'ab-check';
      chk.setAttribute('data-take-id', t.id);

      chk.addEventListener('change', function () {
        if (chk.checked) {
          if (abSelected.length >= 2) {
            // 이미 2개 선택된 상태면 가장 먼저 선택한 것을 체크 해제
            const oldestId = abSelected.shift();
            const allChecks = takesContainer.querySelectorAll('.ab-check');
            for (let i = 0; i < allChecks.length; i++) {
              if (allChecks[i].getAttribute('data-take-id') === oldestId) {
                allChecks[i].checked = false;
                break;
              }
            }
          }
          abSelected.push(t.id);
        } else {
          abSelected = abSelected.filter(function (id) { return id !== t.id; });
        }
        updateAbPanel();
      });

      const spanText = document.createElement('span');
      spanText.textContent = '비교 선택';
      chkLabel.appendChild(chk);
      chkLabel.appendChild(spanText);
      row.appendChild(chkLabel);

      const label = document.createElement('span');
      label.className = 'take-meta';
      label.textContent = '🎙 ' + fmtTakeMeta(t);
      row.appendChild(label);

      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.className = 'ghost mini';
      playBtn.textContent = '▶ 듣기';
      row.appendChild(playBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'ghost mini';
      delBtn.textContent = '삭제';
      row.appendChild(delBtn);

      const msgSpan = document.createElement('span');
      msgSpan.className = 'meta';
      row.appendChild(msgSpan);

      const audio = document.createElement('audio');
      audio.controls = true;
      audio.preload = 'none';
      audio.hidden = true;
      row.appendChild(audio);

      playBtn.addEventListener('click', function () {
        if (t.storage === 'drive') {
          msgSpan.textContent = 'Google Drive 녹음은 드라이브 연동 단계(K6-1)에서 재생을 지원해요.';
          return;
        }
        if (t.storage === 'supabase') {
          if (!audio.src) {
            playBtn.disabled = true;
            msgSpan.textContent = '주소 요청 중...';
            window.ULData.takes.getUrl(t.id)
              .then(function (r) {
                if (r && r.url) {
                  audio.src = safeUrl(r.url);
                  audio.hidden = false;
                  msgSpan.textContent = '';
                  audio.play().catch(function () {});
                } else {
                  msgSpan.textContent = '주소 발급 실패';
                }
              })
              .catch(function (err) {
                msgSpan.textContent = (err && err.message) || '재생 실패';
              })
              .finally(function () {
                playBtn.disabled = false;
              });
          } else {
            audio.hidden = false;
            audio.play().catch(function () {});
          }
        }
      });

      delBtn.addEventListener('click', function () {
        if (!window.confirm('이 녹음을 삭제할까요?')) return;
        delBtn.disabled = true;
        window.ULData.takes.remove(t.id)
          .then(function () {
            abSelected = abSelected.filter(function (id) { return id !== t.id; });
            detailTakesMap.delete(t.id);
            if (currentDetailSong && Array.isArray(currentDetailSong.takes)) {
              currentDetailSong.takes = currentDetailSong.takes.filter(function (it) { return it.id !== t.id; });
            }
            row.remove();
            updateAbPanel();
            if (currentDetailSong && (!currentDetailSong.takes || currentDetailSong.takes.length === 0)) {
              renderDetailTakes([]);
            }
          })
          .catch(function (err) {
            alert((err && err.message) || '녹음 삭제에 실패했어요');
            delBtn.disabled = false;
          });
      });

      takesContainer.appendChild(row);
    });
  }

  // -------------------- A/B 교차 비교 듣기 패널 (FR-LIB-3) --------------------
  function updateAbPanel() {
    const abPanel = document.getElementById('abPanel');
    const audioA = document.getElementById('abAudioA');
    const audioB = document.getElementById('abAudioB');
    const labelA = document.getElementById('abLabelA');
    const labelB = document.getElementById('abLabelB');
    const playA = document.getElementById('abPlayA');
    const playB = document.getElementById('abPlayB');

    if (!abPanel) return;

    if (abSelected.length !== 2) {
      abPanel.hidden = true;
      if (audioA) { audioA.pause(); audioA.src = ''; }
      if (audioB) { audioB.pause(); audioB.src = ''; }
      return;
    }

    abPanel.hidden = false;

    const t1 = detailTakesMap.get(abSelected[0]);
    const t2 = detailTakesMap.get(abSelected[1]);
    if (!t1 || !t2) return;

    // recordedAt 오름차순: 먼저 녹음한 것 -> A (과거), 나중 녹음 -> B (최근)
    let takeA = t1;
    let takeB = t2;
    if (t1.recordedAt > t2.recordedAt) {
      takeA = t2;
      takeB = t1;
    }

    const descA = takeA.recordedAt ? takeA.recordedAt.slice(0, 16).replace('T', ' ') : '';
    const descB = takeB.recordedAt ? takeB.recordedAt.slice(0, 16).replace('T', ' ') : '';

    if (labelA) labelA.textContent = 'A (과거 녹음) · ' + descA + ' · ' + (takeA.durationSec || 0) + '초';
    if (labelB) labelB.textContent = 'B (최근 녹음) · ' + descB + ' · ' + (takeB.durationSec || 0) + '초';

    // 상호 배타 재생 이벤트 연결
    if (audioA && audioB) {
      audioA.onplay = function () {
        audioB.pause();
      };
      audioB.onplay = function () {
        audioA.pause();
      };
    }

    // 재생 버튼 연결
    async function playSlot(take, audio, btn) {
      if (!audio) return;
      if (!audio.src) {
        btn.disabled = true;
        try {
          const r = await window.ULData.takes.getUrl(take.id);
          if (r && r.url) {
            audio.src = safeUrl(r.url);
            await audio.play();
          }
        } catch (err) {
          alert((err && err.message) || '녹음 재생 주소를 받지 못했어요');
        } finally {
          btn.disabled = false;
        }
      } else {
        if (audio.paused) {
          await audio.play().catch(function () {});
        } else {
          audio.pause();
        }
      }
    }

    if (playA && audioA) {
      playA.onclick = function () {
        playSlot(takeA, audioA, playA);
      };
    }
    if (playB && audioB) {
      playB.onclick = function () {
        playSlot(takeB, audioB, playB);
      };
    }
  }

  // -------------------- 라우팅 & 탭 초기화 --------------------
  function routeView() {
    const paneLog = document.getElementById('pane-log');
    const paneSongs = document.getElementById('pane-songs');
    const paneDetail = document.getElementById('pane-song-detail');
    const tabs = document.getElementById('logTabs');
    const tabLog = document.getElementById('tab-log');
    const tabSongs = document.getElementById('tab-songs');
    const header = document.getElementById('logHeader');

    const params = new URLSearchParams(window.location.search);
    const songId = params.get('song');

    if (songId) {
      // 1. 곡 상세 화면
      if (tabs) tabs.hidden = true;
      if (paneLog) paneLog.hidden = true;
      if (paneSongs) paneSongs.hidden = true;
      if (paneDetail) paneDetail.hidden = false;
      if (header) header.hidden = true;
      loadSongDetail(songId);
    } else {
      // 2. 탭 화면
      if (header) header.hidden = false;
      if (tabs) tabs.hidden = false;
      if (paneDetail) paneDetail.hidden = true;

      const hash = window.location.hash;
      if (hash === '#songs' || activeTab === 'songs') {
        activeTab = 'songs';
        if (tabSongs) tabSongs.setAttribute('aria-selected', 'true');
        if (tabLog) tabLog.setAttribute('aria-selected', 'false');
        if (paneLog) paneLog.hidden = true;
        if (paneSongs) paneSongs.hidden = false;
        loadSongsTab();
      } else {
        activeTab = 'log';
        if (tabLog) tabLog.setAttribute('aria-selected', 'true');
        if (tabSongs) tabSongs.setAttribute('aria-selected', 'false');
        if (paneLog) paneLog.hidden = false;
        if (paneSongs) paneSongs.hidden = true;
        loadLog();
      }
    }
  }

  function initTabs() {
    const tabLog = document.getElementById('tab-log');
    const tabSongs = document.getElementById('tab-songs');

    if (tabLog) {
      tabLog.addEventListener('click', function () {
        if (activeTab !== 'log' || window.location.hash === '#songs') {
          activeTab = 'log';
          history.pushState(null, '', 'log.html');
          routeView();
        }
      });
    }

    if (tabSongs) {
      tabSongs.addEventListener('click', function () {
        if (activeTab !== 'songs' || window.location.hash !== '#songs') {
          activeTab = 'songs';
          history.pushState(null, '', 'log.html#songs');
          routeView();
        }
      });
    }

    // 상태 필터 버튼
    const filters = document.getElementById('songFilters');
    if (filters) {
      filters.addEventListener('click', function (e) {
        const btn = e.target.closest('button[data-status]');
        if (!btn) return;
        const status = btn.getAttribute('data-status') || '';
        currentSongFilter = status;
        filters.querySelectorAll('button[data-status]').forEach(function (b) {
          b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        });
        loadSongsTab();
      });
    }

    window.addEventListener('popstate', function () {
      routeView();
    });
  }

  async function start() {
    initTabs();

    if (window.ULAuth && typeof window.ULAuth.getAccessToken === 'function') {
      await window.ULAuth.getAccessToken().catch(function () {});
    }

    const u = window.ULAuth && typeof window.ULAuth.getUser === 'function' ? window.ULAuth.getUser() : null;
    currentUid = u ? u.id : null;

    if (!currentUid) {
      showGuest(true);
    } else {
      showGuest(false);
    }

    if (window.ULAuth && typeof window.ULAuth.onChange === 'function') {
      window.ULAuth.onChange(function (state) {
        const uid = state && state.user ? state.user.id : null;
        if (uid !== currentUid) {
          currentUid = uid;
          resetState();
          if (!currentUid) {
            showGuest(true);
          } else {
            showGuest(false);
          }
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
