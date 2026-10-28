// 사이트 공통: 브라우저 저장, 노션 중계 서버(Apps Script), GitHub Actions(학습 노트) 호출
// 저장 키: pp-api·pp-key(연습 플레이어, JSON으로 저장), sn-token·sn-repo(학습 노트), ul-notion-*(노션 바로가기), gv-theme(화면 모드)
'use strict';
window.UL = (function () {
  const raw = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* 저장 불가 무시 */ } },
  };
  // practice.js가 JSON.stringify로 저장하므로 그 형식에 맞춤
  const json = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 무시 */ } },
  };

  function videoIdFrom(text) {
    const s = String(text || '').trim();
    if (/^[\w-]{11}$/.test(s)) return s;
    const m = s.match(/(?:youtu\.be\/|[?&]v=|\/(?:shorts|embed|live)\/)([\w-]{11})/);
    return m ? m[1] : null;
  }
  const thumb = (id) => 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Apps Script는 커스텀 헤더·preflight를 못 받아서 text/plain POST 하나로 보냄 (practice.js와 같은 형식)
  const notion = {
    url() { return String(json.get('pp-api', '') || '').trim(); },
    key() { return json.get('pp-key', ''); },
    ok() { return !!(this.url() && this.key()); },
    async call(path, body) {
      if (!this.ok()) throw new Error('노션 연결 설정이 필요해요');
      const res = await fetch(this.url(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ key: this.key(), path, method: body ? 'POST' : 'GET', query: {}, body: body || {} }),
      });
      const data = await res.json().catch(() => ({ error: '서버 응답을 읽지 못했어요 (' + res.status + ')' }));
      if (data.error) throw new Error(data.error);
      return data;
    },
  };

  // 학습 노트: 이 저장소의 analyze.yml 워크플로를 실행. 저장소는 github.io 주소에서 알아냄
  function inferRepo() {
    const { hostname, pathname } = location;
    if (!hostname.endsWith('.github.io')) return '';
    return hostname.split('.')[0] + '/' + (pathname.split('/')[1] || hostname);
  }
  const gh = {
    token() { return raw.get('sn-token'); },
    repo() { return raw.get('sn-repo') || inferRepo(); },
    inferRepo,
    ok() { return !!(this.token() && this.repo()); },
    async call(path, opts) {
      opts = opts || {};
      const res = await fetch('https://api.github.com/repos/' + this.repo() + path, Object.assign({}, opts, {
        headers: Object.assign({
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + this.token(),
          'X-GitHub-Api-Version': '2022-11-28',
        }, opts.body ? { 'Content-Type': 'application/json' } : {}),
      }));
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        const hint = { 401: '토큰이 잘못됐거나 만료됐어요.', 403: '토큰에 Actions 쓰기 권한이 없어요.', 404: '저장소나 워크플로를 찾지 못했어요.' }[res.status] || '';
        throw new Error((hint + ' (' + res.status + ' ' + (detail.message || res.statusText) + ')').trim());
      }
      return res.status === 204 ? null : res.json();
    },
  };

  return { raw, json, videoIdFrom, thumb, esc, notion, gh };
})();
