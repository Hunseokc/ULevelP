// 학습 노트 상세(note.html): 인앱 학습 노트 상세 뷰어 및 SVG 다이어그램 렌더러
'use strict';
(function () {
  const ALL_TAGS = ['화성', '사운드 디자인', 'DAW/MIDI', '리듬', '편곡', '믹싱', 'TAB'];
  const $ = (id) => document.getElementById(id);
  const { safeUrl } = UL;

  const ALLOWED_SVG_TAGS = new Set(['svg', 'g', 'rect', 'line', 'path', 'circle', 'text']);
  const ALLOWED_SVG_ATTRS = new Set([
    'xmlns', 'width', 'height', 'viewBox', 'font-family', 'transform',
    'fill', 'stroke', 'stroke-width', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
    'cx', 'cy', 'r', 'd', 'font-size', 'font-weight', 'text-anchor'
  ]);
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function sanitizeSvgNode(srcNode) {
    if (srcNode.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(srcNode.textContent || '');
    }
    if (srcNode.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }
    const tag = srcNode.localName ? srcNode.localName.toLowerCase() : srcNode.tagName.toLowerCase();
    if (!ALLOWED_SVG_TAGS.has(tag)) {
      return null;
    }
    const el = document.createElementNS(SVG_NS, tag);
    for (let i = 0; i < srcNode.attributes.length; i++) {
      const attr = srcNode.attributes[i];
      const name = attr.name.toLowerCase();
      if (ALLOWED_SVG_ATTRS.has(name)) {
        const val = attr.value;
        if (!val.toLowerCase().includes('javascript:') && !name.startsWith('on')) {
          el.setAttribute(attr.name, val);
        }
      }
    }
    for (let i = 0; i < srcNode.childNodes.length; i++) {
      const cleanChild = sanitizeSvgNode(srcNode.childNodes[i]);
      if (cleanChild) {
        el.appendChild(cleanChild);
      }
    }
    return el;
  }

  function renderSanitizedSvg(container, svgText) {
    if (!container || typeof svgText !== 'string' || !svgText.trim()) return;
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgText, 'image/svg+xml');
      const parserError = doc.querySelector('parsererror');
      if (parserError) return;
      const root = doc.documentElement;
      if (!root) return;
      const cleanEl = sanitizeSvgNode(root);
      if (cleanEl) {
        container.appendChild(cleanEl);
      }
    } catch (err) {
      console.warn('SVG parse error', err);
    }
  }

  function parseTimestampSec(ts) {
    if (!ts || typeof ts !== 'string') return null;
    const parts = ts.trim().match(/\d+/g);
    if (!parts || parts.length < 2 || parts.length > 3) return null;
    let total = 0;
    for (const p of parts) {
      const num = parseInt(p, 10);
      if (isNaN(num)) return null;
      total = total * 60 + num;
    }
    return total;
  }

  function createTimeCell(ts, videoId) {
    const td = document.createElement('td');
    const sec = parseTimestampSec(ts);
    if (sec !== null && videoId) {
      const a = document.createElement('a');
      a.href = 'practice.html?v=' + encodeURIComponent(videoId) + '&t=' + encodeURIComponent(sec);
      a.textContent = ts;
      td.appendChild(a);
    } else {
      td.textContent = ts || '';
    }
    return td;
  }

  function createTableCell(text) {
    const td = document.createElement('td');
    td.textContent = text !== undefined && text !== null ? String(text) : '';
    return td;
  }

  let currentNote = null;
  const editSelectedTags = new Set();

  function clearNoteDom() {
    currentNote = null;
    editSelectedTags.clear();
    const memo = $('noteMemoInput');
    if (memo) memo.value = '';
    const msg = $('noteEditMsg');
    if (msg) {
      msg.textContent = '';
      msg.className = 'msg';
    }
    const title = $('noteTitle');
    if (title) title.textContent = '';
    const meta = $('noteMeta');
    if (meta) meta.textContent = '';
    const diff = $('noteDifficulty');
    if (diff) {
      diff.textContent = '';
      diff.hidden = true;
    }
    const tags = $('noteTags');
    if (tags) tags.textContent = '';
    const headline = $('noteHeadline');
    if (headline) headline.textContent = '';
    const points = $('notePoints');
    if (points) points.textContent = '';
    const keywords = $('noteKeywords');
    if (keywords) keywords.textContent = '';
    const sec = $('noteSections');
    if (sec) sec.textContent = '';
    const moments = $('noteMoments');
    if (moments) moments.textContent = '';
    const practice = $('notePractice');
    if (practice) practice.textContent = '';
    const editTags = $('editTags');
    if (editTags) editTags.textContent = '';
  }

  function showLoading(msg) {
    const el = $('noteLoadingMsg');
    if (el) {
      el.textContent = msg;
      el.hidden = false;
    }
    if ($('noteContent')) $('noteContent').hidden = true;
  }

  function hideLoading() {
    const el = $('noteLoadingMsg');
    if (el) el.hidden = true;
    if ($('noteContent')) $('noteContent').hidden = false;
  }

  function renderHeader(note) {
    $('noteTitle').textContent = note.title || note.url || '(제목 없음)';

    const metaParts = [];
    if (note.channel) metaParts.push(note.channel);
    if (note.model) metaParts.push(note.model);
    if (note.createdAt) metaParts.push(new Date(note.createdAt).toLocaleDateString('ko-KR'));
    $('noteMeta').textContent = metaParts.join(' · ');

    const diffEl = $('noteDifficulty');
    if (note.difficulty) {
      diffEl.textContent = note.difficulty;
      diffEl.hidden = false;
    } else {
      diffEl.hidden = true;
    }

    const tagsEl = $('noteTags');
    while (tagsEl.firstChild) tagsEl.removeChild(tagsEl.firstChild);
    if (Array.isArray(note.tags)) {
      note.tags.forEach((t) => {
        const span = document.createElement('span');
        span.className = 'badge';
        span.textContent = t;
        tagsEl.appendChild(span);
      });
    }

    const pracLink = $('notePracticeLink');
    if (note.videoId) {
      pracLink.href = 'practice.html?v=' + encodeURIComponent(note.videoId);
      pracLink.hidden = false;
    } else {
      pracLink.hidden = true;
    }

    const ytLink = $('noteYoutubeLink');
    if (note.url) {
      ytLink.href = safeUrl(note.url);
      ytLink.hidden = false;
    } else {
      ytLink.hidden = true;
    }
  }

  function renderSummary(note) {
    $('noteHeadline').textContent = note.headline || '';

    const pointsList = $('notePoints');
    while (pointsList.firstChild) pointsList.removeChild(pointsList.firstChild);
    if (Array.isArray(note.points)) {
      note.points.forEach((p) => {
        const li = document.createElement('li');
        li.textContent = p;
        pointsList.appendChild(li);
      });
    }

    const kwDiv = $('noteKeywords');
    while (kwDiv.firstChild) kwDiv.removeChild(kwDiv.firstChild);
    if (Array.isArray(note.keywords)) {
      note.keywords.forEach((k) => {
        const chip = document.createElement('span');
        chip.className = 'keyword-chip';
        chip.textContent = k;
        kwDiv.appendChild(chip);
      });
    }
  }

  function renderSections(note) {
    const secContainer = $('noteSections');
    while (secContainer.firstChild) secContainer.removeChild(secContainer.firstChild);

    const analysis = note.analysis || {};
    const tags = Array.isArray(note.tags) ? note.tags : [];
    const diagramsSvg = Array.isArray(note.diagramsSvg) ? note.diagramsSvg : [];

    tags.forEach((tag) => {
      if (tag === '화성' && analysis.harmony) {
        const card = document.createElement('div');
        card.className = 'card note-section';
        const h2 = document.createElement('h2');
        h2.textContent = '화성 (Harmony)';
        card.appendChild(h2);

        const progs = Array.isArray(analysis.harmony.progressions) ? analysis.harmony.progressions : [];
        progs.forEach((prog, pIdx) => {
          const progBox = document.createElement('div');
          progBox.className = 'progression-box';

          const h3 = document.createElement('h3');
          const pTitleParts = [prog.name || '진행'];
          if (prog.key) pTitleParts.push(`(${prog.key})`);
          if (prog.instrument) pTitleParts.push(`· ${prog.instrument}`);
          h3.textContent = pTitleParts.join(' ');
          progBox.appendChild(h3);

          const chords = Array.isArray(prog.chords) ? prog.chords : [];
          if (chords.length > 0) {
            const arrowP = document.createElement('p');
            arrowP.className = 'progression-arrows';
            arrowP.textContent = chords.map((c) => c.symbol || '').join(' → ');
            progBox.appendChild(arrowP);

            const tableWrap = document.createElement('div');
            tableWrap.className = 'scroll';
            const table = document.createElement('table');
            const thead = document.createElement('thead');
            const trh = document.createElement('tr');
            ['코드', '로마숫자', '기능', '보이싱', '뉘앙스', '근거', '시간'].forEach((thText) => {
              const th = document.createElement('th');
              th.textContent = thText;
              trh.appendChild(th);
            });
            thead.appendChild(trh);
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            chords.forEach((c) => {
              const tr = document.createElement('tr');
              tr.appendChild(createTableCell(c.symbol));
              tr.appendChild(createTableCell(c.roman));
              tr.appendChild(createTableCell(c.function));

              const voicingTd = document.createElement('td');
              let voicingStr = '';
              if (Array.isArray(c.frets) && c.frets.length > 0) {
                voicingStr = c.frets.join(' ');
              } else if (c.split) {
                voicingStr = `LH ${(c.lh || []).join(' ')} · RH ${(c.rh || []).join(' ')}`;
              } else {
                voicingStr = (c.lh || []).concat(c.rh || []).join(' ');
              }
              if (c.voicingNote) {
                voicingStr += ` (${c.voicingNote})`;
              }
              voicingTd.textContent = voicingStr;
              tr.appendChild(voicingTd);

              tr.appendChild(createTableCell(c.nuance));
              tr.appendChild(createTableCell(c.basis));
              tr.appendChild(createTimeCell(c.timestamp, note.videoId));
              tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            tableWrap.appendChild(table);
            progBox.appendChild(tableWrap);
          }

          if (diagramsSvg[pIdx]) {
            const svgBox = document.createElement('div');
            svgBox.className = 'scroll svg-box';
            renderSanitizedSvg(svgBox, diagramsSvg[pIdx]);
            progBox.appendChild(svgBox);
          }

          card.appendChild(progBox);
        });

        if (Array.isArray(analysis.harmony.concepts) && analysis.harmony.concepts.length > 0) {
          const cBox = document.createElement('div');
          cBox.className = 'concepts-box';
          const cH = document.createElement('h4');
          cH.textContent = '주요 화성 개념';
          cBox.appendChild(cH);
          const ul = document.createElement('ul');
          analysis.harmony.concepts.forEach((concept) => {
            const li = document.createElement('li');
            li.textContent = typeof concept === 'string' ? concept : (concept.term + ': ' + (concept.description || ''));
            ul.appendChild(li);
          });
          cBox.appendChild(ul);
          card.appendChild(cBox);
        }

        secContainer.appendChild(card);
      } else if (tag === '사운드 디자인' && analysis.sound_design) {
        const card = document.createElement('div');
        card.className = 'card note-section';
        const h2 = document.createElement('h2');
        h2.textContent = '사운드 디자인 (Sound Design)';
        card.appendChild(h2);

        const patches = Array.isArray(analysis.sound_design.patches) ? analysis.sound_design.patches : [];
        patches.forEach((patch) => {
          const pBox = document.createElement('div');
          pBox.className = 'patch-box';
          const h3 = document.createElement('h3');
          h3.textContent = `${patch.target || '패치'} · ${patch.instrument || ''}`;
          pBox.appendChild(h3);

          const steps = Array.isArray(patch.steps) ? patch.steps : [];
          if (steps.length > 0) {
            const tableWrap = document.createElement('div');
            tableWrap.className = 'scroll';
            const table = document.createElement('table');
            const thead = document.createElement('thead');
            const trh = document.createElement('tr');
            ['단계', '설정', '효과', '근거', '시간'].forEach((thText) => {
              const th = document.createElement('th');
              th.textContent = thText;
              trh.appendChild(th);
            });
            thead.appendChild(trh);
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            steps.forEach((s) => {
              const tr = document.createElement('tr');
              tr.appendChild(createTableCell(s.step));
              tr.appendChild(createTableCell(s.setting));
              tr.appendChild(createTableCell(s.effect));
              tr.appendChild(createTableCell(s.basis));
              tr.appendChild(createTimeCell(s.timestamp, note.videoId));
              tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            tableWrap.appendChild(table);
            pBox.appendChild(tableWrap);
          }
          card.appendChild(pBox);
        });
        secContainer.appendChild(card);
      } else if (tag === 'DAW/MIDI' && analysis.daw) {
        const card = document.createElement('div');
        card.className = 'card note-section';
        const h2 = document.createElement('h2');
        h2.textContent = 'DAW/MIDI';
        card.appendChild(h2);

        if (analysis.daw.daw_name) {
          const dawNameP = document.createElement('p');
          dawNameP.textContent = `사용 DAW: ${analysis.daw.daw_name}`;
          card.appendChild(dawNameP);
        }

        const actions = Array.isArray(analysis.daw.actions) ? analysis.daw.actions : [];
        if (actions.length > 0) {
          const tableWrap = document.createElement('div');
          tableWrap.className = 'scroll';
          const table = document.createElement('table');
          const thead = document.createElement('thead');
          const trh = document.createElement('tr');
          ['작업', '방법', '단축키', '시간'].forEach((thText) => {
            const th = document.createElement('th');
            th.textContent = thText;
            trh.appendChild(th);
          });
          thead.appendChild(trh);
          table.appendChild(thead);

          const tbody = document.createElement('tbody');
          actions.forEach((a) => {
            const tr = document.createElement('tr');
            tr.appendChild(createTableCell(a.action));
            tr.appendChild(createTableCell(a.method));
            tr.appendChild(createTableCell(a.shortcut));
            tr.appendChild(createTimeCell(a.timestamp, note.videoId));
            tbody.appendChild(tr);
          });
          table.appendChild(tbody);
          tableWrap.appendChild(table);
          card.appendChild(tableWrap);
        }

        if (Array.isArray(analysis.daw.tips) && analysis.daw.tips.length > 0) {
          const ul = document.createElement('ul');
          analysis.daw.tips.forEach((tip) => {
            const li = document.createElement('li');
            li.textContent = tip;
            ul.appendChild(li);
          });
          card.appendChild(ul);
        }
        secContainer.appendChild(card);
      } else if (tag === '리듬' && analysis.rhythm) {
        const card = document.createElement('div');
        card.className = 'card note-section';
        const h2 = document.createElement('h2');
        h2.textContent = '리듬 (Rhythm)';
        card.appendChild(h2);

        const patterns = Array.isArray(analysis.rhythm.patterns) ? analysis.rhythm.patterns : [];
        patterns.forEach((pat) => {
          const pBox = document.createElement('div');
          pBox.className = 'rhythm-box';
          const h3 = document.createElement('h3');
          h3.textContent = `${pat.name || '패턴'} (${pat.time_signature || '4/4'})`;
          pBox.appendChild(h3);

          if (pat.grid_16th) {
            const pre = document.createElement('pre');
            pre.className = 'mono-grid';
            pre.textContent = pat.grid_16th;
            pBox.appendChild(pre);
          }

          if (pat.feel) {
            const feelP = document.createElement('p');
            feelP.textContent = `그루브: ${pat.feel}`;
            pBox.appendChild(feelP);
          }

          if (pat.basis || pat.timestamp) {
            const metaP = document.createElement('p');
            metaP.className = 'sub';
            metaP.textContent = `근거: ${pat.basis || ''}`;
            if (pat.timestamp) {
              metaP.textContent += ` · 시간: `;
              const timeLink = createTimeCell(pat.timestamp, note.videoId).firstChild;
              if (timeLink) metaP.appendChild(timeLink);
            }
            pBox.appendChild(metaP);
          }
          card.appendChild(pBox);
        });

        if (Array.isArray(analysis.rhythm.concepts) && analysis.rhythm.concepts.length > 0) {
          const ul = document.createElement('ul');
          analysis.rhythm.concepts.forEach((c) => {
            const li = document.createElement('li');
            li.textContent = typeof c === 'string' ? c : (c.term + ': ' + (c.description || ''));
            ul.appendChild(li);
          });
          card.appendChild(ul);
        }
        secContainer.appendChild(card);
      } else if (tag === '편곡' && analysis.arrangement) {
        const card = document.createElement('div');
        card.className = 'card note-section';
        const h2 = document.createElement('h2');
        h2.textContent = '편곡 (Arrangement)';
        card.appendChild(h2);

        const sections = Array.isArray(analysis.arrangement.sections) ? analysis.arrangement.sections : [];
        if (sections.length > 0) {
          const tableWrap = document.createElement('div');
          tableWrap.className = 'scroll';
          const table = document.createElement('table');
          const thead = document.createElement('thead');
          const trh = document.createElement('tr');
          ['구간', '마디', '악기', '기법·의도', '시간'].forEach((thText) => {
            const th = document.createElement('th');
            th.textContent = thText;
            trh.appendChild(th);
          });
          thead.appendChild(trh);
          table.appendChild(thead);

          const tbody = document.createElement('tbody');
          sections.forEach((s) => {
            const tr = document.createElement('tr');
            tr.appendChild(createTableCell(s.name));
            tr.appendChild(createTableCell(s.bars));
            tr.appendChild(createTableCell(s.instrumentation));
            tr.appendChild(createTableCell(s.technique));
            tr.appendChild(createTimeCell(s.timestamp, note.videoId));
            tbody.appendChild(tr);
          });
          table.appendChild(tbody);
          tableWrap.appendChild(table);
          card.appendChild(tableWrap);
        }

        if (Array.isArray(analysis.arrangement.techniques) && analysis.arrangement.techniques.length > 0) {
          const ul = document.createElement('ul');
          analysis.arrangement.techniques.forEach((t) => {
            const li = document.createElement('li');
            li.textContent = typeof t === 'string' ? t : (t.term + ': ' + (t.description || ''));
            ul.appendChild(li);
          });
          card.appendChild(ul);
        }
        secContainer.appendChild(card);
      } else if (tag === '믹싱' && analysis.mixing) {
        const card = document.createElement('div');
        card.className = 'card note-section';
        const h2 = document.createElement('h2');
        h2.textContent = '믹싱 (Mixing)';
        card.appendChild(h2);

        const chains = Array.isArray(analysis.mixing.chains) ? analysis.mixing.chains : [];
        if (chains.length > 0) {
          const tableWrap = document.createElement('div');
          tableWrap.className = 'scroll';
          const table = document.createElement('table');
          const thead = document.createElement('thead');
          const trh = document.createElement('tr');
          ['트랙', '프로세서', '설정', '목적', '근거', '시간'].forEach((thText) => {
            const th = document.createElement('th');
            th.textContent = thText;
            trh.appendChild(th);
          });
          thead.appendChild(trh);
          table.appendChild(thead);

          const tbody = document.createElement('tbody');
          chains.forEach((ch) => {
            const tr = document.createElement('tr');
            tr.appendChild(createTableCell(ch.track));
            tr.appendChild(createTableCell(ch.processor));
            tr.appendChild(createTableCell(ch.setting));
            tr.appendChild(createTableCell(ch.purpose));
            tr.appendChild(createTableCell(ch.basis));
            tr.appendChild(createTimeCell(ch.timestamp, note.videoId));
            tbody.appendChild(tr);
          });
          table.appendChild(tbody);
          tableWrap.appendChild(table);
          card.appendChild(tableWrap);
        }

        if (Array.isArray(analysis.mixing.tips) && analysis.mixing.tips.length > 0) {
          const ul = document.createElement('ul');
          analysis.mixing.tips.forEach((tip) => {
            const li = document.createElement('li');
            li.textContent = tip;
            ul.appendChild(li);
          });
          card.appendChild(ul);
        }
        secContainer.appendChild(card);
      }
    });
  }

  function renderMoments(note) {
    const momentsList = $('noteMoments');
    while (momentsList.firstChild) momentsList.removeChild(momentsList.firstChild);

    const moments = note.analysis && Array.isArray(note.analysis.moments) ? note.analysis.moments : [];
    if (moments.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '등록된 주요 구간이 없어요.';
      momentsList.appendChild(li);
      return;
    }

    moments.forEach((m) => {
      const li = document.createElement('li');
      li.className = 'moment-item';
      const sec = parseTimestampSec(m.timestamp);
      if (sec !== null && note.videoId) {
        const a = document.createElement('a');
        a.className = 'badge';
        a.href = 'practice.html?v=' + encodeURIComponent(note.videoId) + '&t=' + encodeURIComponent(sec);
        a.textContent = m.timestamp;
        li.appendChild(a);
      } else {
        const span = document.createElement('span');
        span.className = 'badge';
        span.textContent = m.timestamp || '';
        li.appendChild(span);
      }
      const pSpan = document.createElement('span');
      pSpan.className = 'moment-point';
      pSpan.textContent = ' ' + (m.point || '');
      li.appendChild(pSpan);
      momentsList.appendChild(li);
    });
  }

  function renderPractice(note) {
    const pracContainer = $('notePractice');
    while (pracContainer.firstChild) pracContainer.removeChild(pracContainer.firstChild);

    const items = note.analysis && Array.isArray(note.analysis.practice) ? note.analysis.practice : [];
    if (items.length === 0) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = '등록된 연습 과제가 없어요.';
      pracContainer.appendChild(p);
      return;
    }

    items.forEach((pText) => {
      const label = document.createElement('label');
      label.className = 'check';
      const input = document.createElement('input');
      input.type = 'checkbox';
      const span = document.createElement('span');
      span.textContent = pText;
      label.appendChild(input);
      label.appendChild(span);
      pracContainer.appendChild(label);
    });
  }

  function renderEditPanel(note) {
    editSelectedTags.clear();
    if (Array.isArray(note.tags)) {
      note.tags.forEach((t) => editSelectedTags.add(t));
    }

    const tagsContainer = $('editTags');
    while (tagsContainer.firstChild) tagsContainer.removeChild(tagsContainer.firstChild);

    ALL_TAGS.forEach((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = t;
      b.setAttribute('aria-pressed', String(editSelectedTags.has(t)));
      b.addEventListener('click', () => {
        if (editSelectedTags.has(t)) {
          editSelectedTags.delete(t);
        } else {
          editSelectedTags.add(t);
        }
        b.setAttribute('aria-pressed', String(editSelectedTags.has(t)));
      });
      tagsContainer.appendChild(b);
    });

    $('noteMemoInput').value = note.memo || '';
    $('noteEditMsg').textContent = '';
  }

  function renderNote(note) {
    currentNote = note;
    renderHeader(note);
    renderSummary(note);
    renderSections(note);
    renderMoments(note);
    renderPractice(note);
    renderEditPanel(note);
    hideLoading();
  }

  // ---------- 삭제 핸들러 ----------
  $('btnDeleteNote').addEventListener('click', async () => {
    if (!currentNote || !currentNote.id) return;
    if (!confirm('이 학습 노트를 삭제할까요?')) return;
    try {
      await window.ULData.notes.remove(currentNote.id);
      location.href = 'notes.html';
    } catch (err) {
      alert(err.message || '노트 삭제에 실패했어요.');
    }
  });

  // ---------- 저장 핸들러 ----------
  $('btnSaveNote').addEventListener('click', async () => {
    if (!currentNote || !currentNote.id) return;
    const memo = $('noteMemoInput').value.trim();
    const tags = ALL_TAGS.filter((t) => editSelectedTags.has(t));
    const msgEl = $('noteEditMsg');
    msgEl.textContent = '저장하는 중...';
    msgEl.className = 'msg';
    const myUid = activeUid;
    try {
      const updated = await window.ULData.notes.update(currentNote.id, { memo, tags });
      if (myUid !== activeUid) return;
      msgEl.textContent = '저장되었습니다.';
      msgEl.className = 'msg ok';
      renderHeader(updated);
      currentNote = updated;
    } catch (err) {
      if (myUid !== activeUid) return;
      msgEl.textContent = err.message || '저장에 실패했어요.';
      msgEl.className = 'msg err';
    }
  });

  // ---------- 로드 ----------
  const q = new URLSearchParams(location.search);
  const noteId = q.get('id');
  let detailReqSeq = 0;
  let activeUid = null;

  async function loadDetail() {
    showLoading('학습 노트를 불러오는 중...');
    const mySeq = ++detailReqSeq;
    const myUid = activeUid;
    try {
      const note = await window.ULData.notes.get(noteId);
      if (mySeq !== detailReqSeq || myUid !== activeUid) return;
      if (!note) {
        showLoading('학습 노트를 찾을 수 없어요.');
        return;
      }
      renderNote(note);
    } catch (err) {
      if (mySeq !== detailReqSeq || myUid !== activeUid) return;
      showLoading(err.message || '학습 노트를 불러오지 못했어요.');
    }
  }

  async function start() {
    if (window.ULAuth && typeof window.ULAuth.getAccessToken === 'function') {
      await window.ULAuth.getAccessToken().catch(() => {});
    }

    const u = window.ULAuth && typeof window.ULAuth.getUser === 'function' ? window.ULAuth.getUser() : null;
    activeUid = u ? u.id : null;

    if (!noteId) {
      showLoading('노트 ID가 없어요.');
      return;
    }

    if (window.ULAuth && typeof window.ULAuth.onChange === 'function') {
      window.ULAuth.onChange((state) => {
        const uid = state && state.user ? state.user.id : null;
        if (uid !== activeUid) {
          activeUid = uid;
          detailReqSeq++;
          clearNoteDom();
          if (activeUid) {
            loadDetail();
          } else {
            showLoading('로그인이 필요해요.');
          }
        }
      });
    }

    if (!window.ULData || !window.ULData.isLoggedIn()) {
      clearNoteDom();
      showLoading('로그인이 필요해요.');
      return;
    }

    loadDetail();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
