// 사이트 공통: 브라우저 저장, GitHub Actions(학습 노트) 호출
// 저장 키: sn-token·sn-repo(학습 노트), ulp:notion-*(노션 바로가기), ulp:theme(화면 모드)
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
  // href·src에 넣는 외부 URL: https:만 통과, 나머지(javascript:, data: 등)는 빈 문자열
  function safeUrl(u) {
    try { const x = new URL(String(u || '').trim()); return x.protocol === 'https:' ? x.href : ''; } catch (e) { return ''; }
  }

  return { raw, json, videoIdFrom, thumb, esc, safeUrl };
})();
