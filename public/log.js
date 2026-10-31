// public/log.js — 최근 12주 연습 달력, 주간/월간 요약, 날짜별 세션·녹음 재생·메모 저장
(function () {
  'use strict';

  const safeUrl = (window.UL && window.UL.safeUrl) || function (u) { return String(u || ''); };

  let currentUid = null;
  let sessionsData = null; // { summary, calendar, sessions }
  let selectedDate = null;
  let activeTab = 'log'; // 'log' | 'songs'

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

    if (guestEl) guestEl.hidden = !isGuest;
    if (isGuest) {
      if (paneLog) paneLog.hidden = true;
      if (paneSongs) paneSongs.hidden = true;
      if (paneDetail) paneDetail.hidden = true;
      if (tabs) tabs.hidden = true;
    } else {
      if (tabs) tabs.hidden = false;
      if (activeTab === 'log') {
        if (paneLog) paneLog.hidden = false;
        if (paneSongs) paneSongs.hidden = true;
      } else {
        if (paneLog) paneLog.hidden = true;
        if (paneSongs) paneSongs.hidden = false;
      }
    }
  }

  function resetState() {
    sessionsData = null;
    selectedDate = null;
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
  }

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

      // 2. 메타: minutes분 (seconds초) · 반복 loops회 [· 구간 segment] [· rate×]
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

      // 기본 선택 날짜 결정: 아직 없거나 세션에 맞춤
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

  function initTabs() {
    const tabLog = document.getElementById('tab-log');
    const tabSongs = document.getElementById('tab-songs');
    const paneLog = document.getElementById('pane-log');
    const paneSongs = document.getElementById('pane-songs');

    if (!tabLog || !tabSongs) return;

    tabLog.addEventListener('click', function () {
      activeTab = 'log';
      tabLog.setAttribute('aria-selected', 'true');
      tabSongs.setAttribute('aria-selected', 'false');
      if (paneLog) paneLog.hidden = false;
      if (paneSongs) paneSongs.hidden = true;
    });

    tabSongs.addEventListener('click', function () {
      activeTab = 'songs';
      tabSongs.setAttribute('aria-selected', 'true');
      tabLog.setAttribute('aria-selected', 'false');
      if (paneLog) paneLog.hidden = true;
      if (paneSongs) paneSongs.hidden = false;
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
      loadLog();
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
            loadLog();
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
