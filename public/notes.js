// 학습 노트(notes.html): 분석 요청 폼, GitHub Actions 최근 요청 목록
'use strict';
(function () {
  const TAGS = ['화성', '사운드 디자인', 'DAW/MIDI', '리듬', '편곡', '믹싱'];
  const WORKFLOW = 'analyze.yml';
  const $ = (id) => document.getElementById(id);
  const { raw, videoIdFrom, thumb, esc, safeUrl, gh } = UL;

  // ---------- 폼 ----------
  const selected = new Set();
  TAGS.forEach((t) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = t; b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      if (selected.has(t)) selected.delete(t); else selected.add(t);
      b.setAttribute('aria-pressed', String(selected.has(t)));
    });
    $('tags').append(b);
  });

  function preview() {
    const id = videoIdFrom($('url').value);
    $('preview').classList.toggle('show', !!id);
    if (id) $('preview').querySelector('img').src = thumb(id);
  }
  $('url').addEventListener('input', preview);

  function say(text, cls) { $('msg').textContent = text; $('msg').className = 'msg' + (cls ? ' ' + cls : ''); }

  let branch = '';
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = videoIdFrom($('url').value);
    if (!id) return say('유튜브 영상 링크가 아니에요.', 'err');
    if (!selected.size) return say('태그를 하나 이상 골라주세요.', 'err');
    if (!gh.ok()) return say('SETTING에서 GitHub 토큰을 먼저 넣어주세요.', 'err');

    $('submit').disabled = true; say('요청 보내는 중...');
    try {
      branch = branch || (await gh.call('')).default_branch;
      await gh.call('/actions/workflows/' + WORKFLOW + '/dispatches', {
        method: 'POST',
        body: JSON.stringify({
          ref: branch,
          inputs: {
            url: 'https://www.youtube.com/watch?v=' + id,
            tags: TAGS.filter((t) => selected.has(t)).join(','),
            memo: $('memo').value.trim(),
          },
        }),
      });
      say('요청했어요. 보통 1~3분 뒤에 노션에 정리돼요.', 'ok');
      $('url').value = ''; $('memo').value = ''; preview();
      watchUntil = Date.now() + 20000;
      refresh();
    } catch (err) {
      say(err.message, 'err');
    } finally {
      $('submit').disabled = false;
    }
  });

  // ---------- 최근 요청 ----------
  let timer = null, watchUntil = 0;

  function ago(iso) {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return '방금';
    if (s < 3600) return Math.floor(s / 60) + '분 전';
    if (s < 86400) return Math.floor(s / 3600) + '시간 전';
    return new Date(iso).toLocaleDateString('ko-KR');
  }

  function badge(run) {
    if (run.status !== 'completed') return ['run', '분석 중'];
    if (run.conclusion === 'success') return ['ok', '완료'];
    if (run.conclusion === 'cancelled') return ['fail', '취소됨'];
    return ['fail', '실패 · 로그 보기'];
  }

  async function refresh() {
    clearTimeout(timer);
    if (!gh.ok()) return;
    try {
      const runs = (await gh.call('/actions/workflows/' + WORKFLOW + '/runs?per_page=15')).workflow_runs;
      $('runs').innerHTML = runs.length ? runs.map((r) => {
        const [tags, url = ''] = r.display_title.split(' | ');
        const id = videoIdFrom(url);
        const [cls, label] = badge(r);
        return '<li class="run">' +
          (id ? '<a href="' + esc(safeUrl(url)) + '" target="_blank" rel="noopener"><img src="' + thumb(id) + '" alt=""></a>' : '<span></span>') +
          '<div><div class="t">' + esc(tags) + '</div><div class="sub">' + esc(ago(r.created_at)) + ' · ' + esc(url) + '</div></div>' +
          '<div class="acts">' + (id ? '<a class="badge" href="practice.html?v=' + encodeURIComponent(id) + '">▶ 연습</a>' : '') +
          '<a class="badge ' + cls + '" href="' + esc(safeUrl(r.html_url)) + '" target="_blank" rel="noopener">' + label + '</a></div>' +
          '</li>';
      }).join('') : '<li class="empty">아직 요청이 없어요.</li>';
      const active = runs.some((r) => r.status !== 'completed');
      if (active || Date.now() < watchUntil) timer = setTimeout(refresh, 5000);
    } catch (err) {
      $('runs').innerHTML = '<li class="empty">' + esc(err.message) + '</li>';
    }
  }

  // ---------- 시작 ----------
  const notionUrl = raw.get('ulp:notion-notes');
  $('notionLink').hidden = !safeUrl(notionUrl);
  if (safeUrl(notionUrl)) $('notionLink').href = safeUrl(notionUrl);

  // 첫 화면에서 '노트 만들기'로 왔을 때: notes.html?url=...
  const q = new URLSearchParams(location.search);
  if (q.get('url')) { $('url').value = q.get('url'); preview(); history.replaceState(null, '', location.pathname); }
  if (!gh.ok()) say('SETTING에서 GitHub 토큰을 넣으면 분석을 요청할 수 있어요.');
  refresh();
})();
