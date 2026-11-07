// 학습 노트(notes.html): Gemini 분석 요청 폼, 작업 상태 폴링, 내 학습 노트 보관함
'use strict';
(function () {
  const FORM_TAGS = ['화성', '사운드 디자인', 'DAW/MIDI', '리듬', '편곡', '믹싱', 'TAB'];
  const FILTER_TAGS = ['', '화성', '사운드 디자인', 'DAW/MIDI', '리듬', '편곡', '믹싱', 'TAB'];
  const $ = (id) => document.getElementById(id);
  const { videoIdFrom, thumb, safeUrl } = UL;

  let activeUid = null;
  let notesReqSeq = 0;
  let jobsReqSeq = 0;
  let pollTimer = null;
  let activeJobIds = new Set();
  let currentFilterTag = '';
  let localHasKeyOverride = false;

  function say(text, cls) {
    const el = $('msg');
    if (!el) return;
    el.textContent = text;
    el.className = 'msg' + (cls ? ' ' + cls : '');
  }

  function hasGeminiKey() {
    if (!window.ULData || !window.ULData.isLoggedIn()) return false;
    if (localHasKeyOverride) return true;
    const cached = window.ULData.getCachedKeys ? window.ULData.getCachedKeys() : null;
    if (cached && cached.gemini) return true;
    const me = window.ULAuth && typeof window.ULAuth.getMe === 'function' ? window.ULAuth.getMe() : null;
    if (me && me.keys && me.keys.gemini) return true;
    return false;
  }

  function updateKeyGate() {
    const box = $('keyGateBox');
    const msg = $('keyGateMsg');
    const submitBtn = $('submit');
    if (!box || !submitBtn) return;

    if (!window.ULData || !window.ULData.isLoggedIn()) {
      submitBtn.disabled = true;
      box.hidden = false;
      if (msg) msg.textContent = '로그인하고 SETTING에서 Gemini 키를 등록하면 영상 분석을 요청할 수 있어요.';
      return;
    }

    if (!hasGeminiKey()) {
      submitBtn.disabled = true;
      box.hidden = false;
      if (msg) msg.textContent = '학습 노트 분석을 쓰려면 Gemini API 키가 필요해요.';
      return;
    }

    box.hidden = true;
    submitBtn.disabled = false;
  }

  // ---------- 폼 태그 선택 ----------
  const selectedTags = new Set();
  const tagsContainer = $('tags');
  if (tagsContainer) {
    FORM_TAGS.forEach((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = t;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        if (selectedTags.has(t)) {
          selectedTags.delete(t);
        } else {
          selectedTags.add(t);
        }
        b.setAttribute('aria-pressed', String(selectedTags.has(t)));
      });
      tagsContainer.appendChild(b);
    });
  }

  function preview() {
    const urlVal = $('url') ? $('url').value : '';
    const id = videoIdFrom(urlVal);
    const prev = $('preview');
    if (!prev) return;
    prev.classList.toggle('show', !!id);
    const img = prev.querySelector('img');
    if (img && id) {
      img.src = thumb(id);
    }
  }
  if ($('url')) {
    $('url').addEventListener('input', preview);
  }

  if ($('form')) {
    $('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const urlInput = $('url');
      const memoInput = $('memo');
      const submitBtn = $('submit');
      const rawUrl = urlInput ? urlInput.value.trim() : '';
      const id = videoIdFrom(rawUrl);

      if (!id) return say('유튜브 영상 링크가 아니에요.', 'err');
      if (!selectedTags.size) return say('태그를 하나 이상 골라주세요.', 'err');
      if (!hasGeminiKey()) {
        updateKeyGate();
        return say('Gemini API 키가 필요해요. SETTING에서 등록해 주세요.', 'err');
      }

      submitBtn.disabled = true;
      say('분석 요청을 보내는 중...', '');
      try {
        const ordered = FORM_TAGS.filter((t) => selectedTags.has(t));
        const res = await window.ULData.notes.analyze({
          url: 'https://www.youtube.com/watch?v=' + id,
          tags: ordered,
          memo: memoInput ? memoInput.value.trim() : '',
        });
        say('분석을 요청했어요. 보통 1~3분 뒤에 정리가 완료돼요.', 'ok');
        if (urlInput) urlInput.value = '';
        if (memoInput) memoInput.value = '';
        preview();
        refreshJobsAndNotes();
      } catch (err) {
        if (err && (err.code === 'NO_KEY' || err.status === 412)) {
          updateKeyGate();
        }
        say(err.message || '요청 실패', 'err');
      } finally {
        updateKeyGate();
      }
    });
  }

  // ---------- 시간 포맷 ----------
  function ago(iso) {
    if (!iso) return '';
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return '방금';
    if (s < 3600) return Math.floor(s / 60) + '분 전';
    if (s < 86400) return Math.floor(s / 3600) + '시간 전';
    return new Date(iso).toLocaleDateString('ko-KR');
  }

  // ---------- 작업 및 노트 렌더링 ----------
  function renderJobs(jobs) {
    const listEl = $('jobs');
    if (!listEl) return;
    while (listEl.firstChild) {
      listEl.removeChild(listEl.firstChild);
    }

    if (!jobs || jobs.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '진행 중이거나 최근 요청한 작업이 없어요.';
      listEl.appendChild(li);
      return;
    }

    jobs.forEach((job) => {
      const li = document.createElement('li');
      li.className = 'run';

      const vid = videoIdFrom(job.url || '');
      if (vid) {
        const aImg = document.createElement('a');
        aImg.href = 'https://www.youtube.com/watch?v=' + encodeURIComponent(vid);
        aImg.target = '_blank';
        aImg.rel = 'noopener';
        const img = document.createElement('img');
        img.src = thumb(vid);
        img.alt = '영상 썸네일';
        aImg.appendChild(img);
        li.appendChild(aImg);
      } else {
        const sp = document.createElement('span');
        li.appendChild(sp);
      }

      const infoDiv = document.createElement('div');
      const titleDiv = document.createElement('div');
      titleDiv.className = 't';
      const tagStr = Array.isArray(job.tags) ? job.tags.join(', ') : '';
      titleDiv.textContent = tagStr || '(태그 없음)';
      infoDiv.appendChild(titleDiv);

      const subDiv = document.createElement('div');
      subDiv.className = 'sub';
      const timeStr = ago(job.createdAt);
      subDiv.textContent = (timeStr ? timeStr + ' · ' : '') + (job.url || '');
      infoDiv.appendChild(subDiv);
      li.appendChild(infoDiv);

      const actsDiv = document.createElement('div');
      actsDiv.className = 'acts';

      const st = job.status;
      const statusBadge = document.createElement('span');
      if (st === 'queued') {
        statusBadge.className = 'badge';
        statusBadge.textContent = '대기 중';
      } else if (st === 'running') {
        statusBadge.className = 'badge run';
        statusBadge.textContent = '분석 중';
      } else if (st === 'done') {
        statusBadge.className = 'badge ok';
        statusBadge.textContent = '완료';
        if (job.noteId) {
          const noteLink = document.createElement('a');
          noteLink.className = 'badge ok';
          noteLink.href = 'note.html?id=' + encodeURIComponent(job.noteId);
          noteLink.textContent = '노트 보기 →';
          actsDiv.appendChild(noteLink);
        }
      } else {
        statusBadge.className = 'badge fail';
        statusBadge.textContent = '실패';
        if (typeof job.error === 'string' && job.error.startsWith('PROVIDER_KEY_INVALID:')) {
          statusBadge.textContent = '키 오류';
        }
      }
      actsDiv.appendChild(statusBadge);
      li.appendChild(actsDiv);

      listEl.appendChild(li);
    });
  }

  function renderNotes(notes) {
    const listEl = $('notesList');
    if (!listEl) return;
    while (listEl.firstChild) {
      listEl.removeChild(listEl.firstChild);
    }

    if (!notes || notes.length === 0) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = currentFilterTag ? `"${currentFilterTag}" 태그의 학습 노트가 없어요.` : '저장된 학습 노트가 없어요.';
      listEl.appendChild(p);
      return;
    }

    notes.forEach((n) => {
      const card = document.createElement('div');
      card.className = 'card note-card';

      const head = document.createElement('div');
      head.className = 'note-card-head';

      const titleLink = document.createElement('a');
      titleLink.className = 'note-card-title';
      titleLink.href = 'note.html?id=' + encodeURIComponent(n.id);
      titleLink.textContent = n.title || '(제목 없음)';
      head.appendChild(titleLink);

      const meta = document.createElement('div');
      meta.className = 'note-card-meta';
      if (n.channel) {
        const ch = document.createElement('span');
        ch.className = 'sub';
        ch.textContent = n.channel;
        meta.appendChild(ch);
      }
      if (n.difficulty) {
        const diff = document.createElement('span');
        diff.className = 'badge';
        diff.textContent = n.difficulty;
        meta.appendChild(diff);
      }
      if (Array.isArray(n.tags)) {
        n.tags.forEach((t) => {
          const tb = document.createElement('span');
          tb.className = 'badge';
          tb.textContent = t;
          meta.appendChild(tb);
        });
      }
      head.appendChild(meta);
      card.appendChild(head);

      if (n.headline) {
        const hl = document.createElement('p');
        hl.className = 'note-card-headline';
        hl.textContent = n.headline;
        card.appendChild(hl);
      }

      const acts = document.createElement('div');
      acts.className = 'row note-card-acts';

      if (n.videoId) {
        const pracLink = document.createElement('a');
        pracLink.className = 'cta';
        pracLink.href = 'practice.html?v=' + encodeURIComponent(n.videoId);
        pracLink.textContent = '▶ 연습';
        acts.appendChild(pracLink);
      }

      const viewLink = document.createElement('a');
      viewLink.className = 'sec';
      viewLink.href = 'note.html?id=' + encodeURIComponent(n.id);
      viewLink.textContent = '상세 보기';
      acts.appendChild(viewLink);

      card.appendChild(acts);
      listEl.appendChild(card);
    });
  }

  // ---------- 태그 필터 버튼 초기화 ----------
  function initFilterButtons() {
    const filterContainer = $('noteTagFilter');
    if (!filterContainer) return;
    while (filterContainer.firstChild) {
      filterContainer.removeChild(filterContainer.firstChild);
    }
    FILTER_TAGS.forEach((tag) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = tag || '전체';
      b.setAttribute('aria-pressed', String(currentFilterTag === tag));
      b.addEventListener('click', () => {
        if (currentFilterTag === tag) return;
        currentFilterTag = tag;
        filterContainer.querySelectorAll('button').forEach((btn) => {
          btn.setAttribute('aria-pressed', String(btn.textContent === (tag || '전체')));
        });
        notesReqSeq++;
        loadNotesOnly();
      });
      filterContainer.appendChild(b);
    });
  }

  async function loadNotesOnly() {
    if (!window.ULData || !window.ULData.isLoggedIn()) {
      renderNotes([]);
      return;
    }
    const mySeq = ++notesReqSeq;
    const myUid = activeUid;
    try {
      const notes = await window.ULData.notes.list(currentFilterTag);
      if (mySeq !== notesReqSeq || myUid !== activeUid) return;
      renderNotes(notes);
    } catch (err) {
      if (mySeq !== notesReqSeq || myUid !== activeUid) return;
      console.warn('노트 목록 로드 실패', err);
    }
  }

  async function refreshJobsAndNotes() {
    clearTimeout(pollTimer);
    if (!window.ULData || !window.ULData.isLoggedIn()) {
      updateKeyGate();
      renderJobs([]);
      renderNotes([]);
      return;
    }

    const mySeq = ++jobsReqSeq;
    const myUid = activeUid;
    try {
      const jobs = await window.ULData.notes.listJobs();
      if (Array.isArray(jobs) && jobs.some((j) => j && j.status === 'failed' && typeof j.error === 'string' && j.error.startsWith('PROVIDER_KEY_INVALID:'))) {
        localHasKeyOverride = false;
      }
      if (mySeq !== jobsReqSeq || myUid !== activeUid) return;
      updateKeyGate();
      renderJobs(jobs);

      const hasActive = jobs.some((j) => j && (j.status === 'queued' || j.status === 'running'));
      const newlyFinished = jobs.some((j) => j && j.status === 'done' && activeJobIds.has(j.id));
      activeJobIds = new Set(jobs.filter((j) => j && (j.status === 'queued' || j.status === 'running')).map((j) => j.id));

      if (newlyFinished || !jobs.some((j) => activeJobIds.has(j.id))) {
        // 완료 작업이 생겼거나 최초 로드 시 최신 필터로 노트 목록 새로고침
        loadNotesOnly();
      }

      if (hasActive) {
        pollTimer = setTimeout(refreshJobsAndNotes, 5000);
      }
    } catch (err) {
      if (mySeq !== jobsReqSeq || myUid !== activeUid) return;
      console.warn('작업 및 노트 조회 실패', err);
    }
  }

  // ---------- 초기화 및 이벤트 리스너 ----------
  initFilterButtons();

  // 첫 화면에서 '노트 만들기'로 왔을 때: notes.html?url=...
  const q = new URLSearchParams(location.search);
  if (q.get('url') && $('url')) {
    $('url').value = q.get('url');
    preview();
    history.replaceState(null, '', location.pathname);
  }

  if (window.ULAuth && typeof window.ULAuth.onChange === 'function') {
    window.ULAuth.onChange((state) => {
      const newUid = state && state.user ? state.user.id : null;
      if (newUid !== activeUid) {
        clearTimeout(pollTimer);
        activeUid = newUid;
        notesReqSeq++;
        jobsReqSeq++;
        activeJobIds.clear();
        localHasKeyOverride = false;
        updateKeyGate();
        refreshJobsAndNotes();
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

  if ($('btnKeyGateModal')) {
    $('btnKeyGateModal').addEventListener('click', openGeminiModal);
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
      if (!window.ULData || !window.ULData.isLoggedIn()) {
        if ($('gemModalResultMsg')) {
          $('gemModalResultMsg').textContent = '로그인 후 키를 저장할 수 있어요.';
          $('gemModalResultMsg').className = 'msg err';
        }
        return;
      }
      const btn = $('btnModalSaveGemini');
      btn.disabled = true;
      if ($('gemModalResultMsg')) {
        $('gemModalResultMsg').textContent = 'Gemini API 키 유효성을 실시간으로 확인하는 중…';
        $('gemModalResultMsg').className = 'msg';
      }
      try {
        const dto = await window.ULData.integrations.saveGemini({
          apiKey: validKey,
          model: 'gemini-flash-latest',
          verify: true,
        });
        localHasKeyOverride = true;
        if ($('gemModalResultMsg')) {
          const modelLabel = dto && dto.displayName ? ' · ' + dto.displayName : '';
          $('gemModalResultMsg').textContent = '✓ 연결 완료! 무료 Gemini 모델이 정상 작동합니다 (끝 4자리 ' + ((dto && dto.hint) || '') + modelLabel + ')';
          $('gemModalResultMsg').className = 'msg ok';
        }
        if ($('gemModalKeyInput')) $('gemModalKeyInput').value = '';
        closeGeminiModal();
        updateKeyGate();
      } catch (e) {
        if ($('gemModalResultMsg')) {
          $('gemModalResultMsg').textContent = e.message || 'Gemini API 키 검증 및 저장에 실패했어요.';
          $('gemModalResultMsg').className = 'msg err';
        }
      } finally {
        btn.disabled = false;
      }
    });
  }

  async function start() {
    if (window.ULAuth && typeof window.ULAuth.getAccessToken === 'function') {
      await window.ULAuth.getAccessToken().catch(() => {});
    }
    activeUid = window.ULAuth && typeof window.ULAuth.getUser === 'function' && window.ULAuth.getUser() ? window.ULAuth.getUser().id : null;
    updateKeyGate();
    refreshJobsAndNotes();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
