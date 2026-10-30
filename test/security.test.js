// XSS 정적 검사 X1 (D20·D22, docs/03 2.3·2.5·12장). 의존성 없음 → npm test에 그대로 들어간다.
// public/ 전체를 읽어 (a)~(g) 규칙을 확인하고, test/fixtures/xss/의 일부러 틀린 예마다 해당 검사가 실패하는지도 확인한다.
// 규칙을 바꾸거나 허용 목록을 늘리면 개발산출물/결과/X1_XSS정적검사.md도 같이 고친다.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// ================= 정책 값 =================

// 모든 public/*.html의 CSP meta 원문. step마다 docs/03 2.3 표대로 늘린다(R2 결과 7.2 = X1 시점 원문)
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js https://www.youtube.com/iframe_api https://www.youtube.com/s/player/",
  "style-src 'self' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data: https://i.ytimg.com",
  "media-src 'self' blob:",
  "connect-src 'self' https://vefrfhafmiiivpgjhqiu.supabase.co http://127.0.0.1:54321 https://script.google.com https://script.googleusercontent.com https://api.github.com",
  'frame-src https://www.youtube.com',
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "worker-src 'none'",
].join('; ');

// SRI를 걸 수 없는 외부 주소(제공자가 내용을 고정하지 않음). CSP에서 경로로만 허용한다 (docs/03 2.2)
const SRI_EXEMPT_SCRIPT = ['https://www.youtube.com/iframe_api', 'https://accounts.google.com/gsi/client'];
const SRI_EXEMPT_STYLE = ['https://fonts.googleapis.com/css2?'];

// (c)(d) HTML·URL에 끼워 넣어도 되는 식. file = public 기준 경로, expr = 식 원문(공백 하나로 줄임) 또는 정규식.
// 줄 번호는 편집할 때마다 밀려서 식으로 맞춘다. 어디에도 안 쓰이는 항목이 생기면 테스트가 실패한다(낡은 항목 정리)
// kind = 'html'(본문·일반 속성) 또는 'url'(href·src). html 허용은 href·src에는 통하지 않는다
const HTML_ALLOW = [
  // 코드 연습실(chords.html)은 외부 입력이 없다: 모든 값이 lib/theory.js·voicing.js 상수와 계산에서 나온다
  {
    file: 'public/app.js', kind: 'html',
    expr: /^(?:x|y|f|s|i|T|L|R|W|H|C|VW|GAP|xL|mid|rx|width|height|start|idx|iv|ci|pi|key|outs|x\.i|p\.d|m\.f|n\.f|m\.pitch|open\[m\.s\]|mx\.span|k\.key|(?:xOf|yOf|fx)\(.*\))$/,
    why: '지판 SVG 좌표·프렛·인덱스 숫자 (지역 변수라 숫자인지 정적으로는 모름)',
  },
  {
    file: 'public/app.js', kind: 'html',
    expr: /^(?:NOTE\[.+\](?:\.replace\(.*\))?|n|CT\.TOP_DEG\[iv\]|CT\.strName\(.+\)|GE\.fretStr\(.+\)|fretText\(.+\)|DOT_CLS\([mn]\)|cls|n\.cls|q\.id|s\.id|t\.id|g\.F\.label|p\.ro\.r)$/,
    why: '음이름·도수·코드 id·CSS 클래스 이름 상수 (theory.js NAMES·QBY·SCALES 등 고정 값)',
  },
  {
    file: 'public/app.js', kind: 'html',
    expr: /^(?:h|(?:fretboard|neck|chordNeck|box|wheel|scWheel|rect|cell|row)\(.*\)|cells\.join\(''\))$/,
    why: '같은 파일 안에서 이 검사를 통과한 이어 붙이기로 만든 SVG/HTML 문자열(그림 함수 결과·누적 변수)',
  },
  { file: 'public/notes.js', kind: 'html', expr: /^(?:cls|label)$/, why: 'badge()가 돌려주는 고정 클래스 이름·문구' },
  { file: 'public/practice.js', kind: 'url', expr: 't.url', why: 'URL.createObjectURL로 만든 blob: 주소(녹음 재생·파일 저장)' },
];

// (g) localStorage 키. 새 키는 이 접두어만
const STORAGE_PREFIXES = ['ulp:', 'sb-'];
// 옛 키 허용 목록 (R2 결과 7.3, docs/03 2.5). until = 이 키를 지우는 step. onlyIn = 이 파일에서만(처음 한 번 복사할 때 읽기)
const COPY_ONLY = { onlyIn: ['public/theme.js'], until: '지우지 않음(guitar-practice가 같은 Origin에서 씀)' };
const STORAGE_LEGACY = [
  { key: 'pp:v:', prefix: true, until: 'P1-2', why: '비로그인 기기 기록. P1-2에서 ulp:v:로 바꾸고, 옛 키는 P1-4 가져오기에서 읽기만' },
  { key: 'pp-api', until: 'P4-5', why: 'Apps Script 중계 주소(SETTING 노션 연결 칸, practice.html#api=)' },
  { key: 'pp-key', until: 'P4-5', why: 'Apps Script 공유 비밀(같은 칸)' },
  { key: 'sn-token', until: 'P5-3', why: 'GitHub 토큰(SETTING 학습 노트 칸)' },
  { key: 'sn-repo', until: 'P5-3', why: 'GitHub 저장소(같은 칸)' },
  { key: 'gv-theme', ...COPY_ONLY, why: '→ ulp:theme 복사' },
  { key: 'gv-tab', ...COPY_ONLY, why: '→ ulp:tab 복사' },
  { key: 'pp-lead', ...COPY_ONLY, why: '→ ulp:lead 복사' },
  { key: 'ul-notion-practice', ...COPY_ONLY, why: '→ ulp:notion-practice 복사' },
  { key: 'ul-notion-notes', ...COPY_ONLY, why: '→ ulp:notion-notes 복사' },
];
// 저장소 함수에 키를 변수로 넘기는 곳(래퍼 내부 등)
const STORAGE_ARG_ALLOW = [
  { file: 'public/site.js', expr: 'k', why: 'UL.raw·UL.json 래퍼 안. 부르는 쪽의 키를 검사한다' },
  { file: 'public/practice.js', expr: 'k', why: 'store 래퍼 안. 부르는 쪽의 키를 검사한다' },
  { file: 'public/theme.js', expr: 'from', why: '옛 키 복사 표(이 파일 안 상수)' },
  { file: 'public/theme.js', expr: 'to', why: '옛 키 복사 표(이 파일 안 상수)' },
];

// (f) 브라우저에 있으면 안 되는 비밀 값 모양
const SECRET_PATTERNS = [
  /sb_secret_/, /service_role/, /\bntn_[A-Za-z0-9]{10,}/, /\bsecret_[A-Za-z0-9]{10,}/,
  /AIza[0-9A-Za-z_-]{30,}/, /\bghp_[A-Za-z0-9]{30,}/, /\bgithub_pat_[A-Za-z0-9_]{20,}/,
];

// ================= JS 토큰 나누기 (검사에 필요한 만큼만) =================

const PUNCT = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=',
  '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>'];
const BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'else', 'do', 'yield', 'await']);
const ESCAPES = { n: '\n', t: '\t', r: '\r' };

function tokenize(src) {
  const out = [];
  let i = 0, line = 1;
  const regexOk = () => {
    const p = out[out.length - 1];
    if (!p) return true;
    if (p.type === 'ident') return BEFORE_REGEX.has(p.value);
    if (p.type !== 'punct') return false;
    return !(p.value === ')' || p.value === ']' || p.value === '}');
  };
  while (i < src.length) {
    const c = src[i], start = i, startLine = line;
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2), end = e < 0 ? src.length : e + 2;
      line += (src.slice(i, end).match(/\n/g) || []).length; i = end; continue;
    }
    let type, value;
    if (c === '"' || c === "'") {
      let v = ''; i++;
      while (i < src.length && src[i] !== c && src[i] !== '\n') {
        if (src[i] === '\\') { v += ESCAPES[src[i + 1]] || src[i + 1]; i += 2; } else v += src[i++];
      }
      i++; type = 'str'; value = v;
    } else if (c === '`') {
      let depth = 0; i++;
      while (i < src.length && !(depth === 0 && src[i] === '`')) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '\n') line++;
        if (src[i] === '$' && src[i + 1] === '{') { depth++; i += 2; continue; }
        if (depth > 0 && src[i] === '{') depth++;
        if (depth > 0 && src[i] === '}') depth--;
        i++;
      }
      i++; type = 'tmpl'; value = src.slice(start + 1, i - 1);
    } else if (c === '/' && regexOk()) {
      let inClass = false; i++;
      while (i < src.length && (inClass || src[i] !== '/') && src[i] !== '\n') {
        if (src[i] === '\\') i++;
        else if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        i++;
      }
      i++;
      while (/[a-z]/.test(src[i] || '')) i++;
      type = 'regex'; value = src.slice(start, i);
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = src.slice(i).match(/^(?:0[xXbBoO][\da-fA-F_]+|\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)n?/);
      i += m[0].length; type = 'num'; value = m[0];
    } else if (/[A-Za-z_$]/.test(c)) {
      const m = src.slice(i).match(/^[\w$]+/);
      i += m[0].length; type = 'ident'; value = m[0];
    } else {
      value = PUNCT.find((p) => src.startsWith(p, i)) || c;
      i += value.length; type = 'punct';
    }
    out.push({ type, value, line: startLine, start, end: i });
  }
  // 괄호 짝
  const stack = [], pair = { ')': '(', ']': '[', '}': '{' };
  out.forEach((t, k) => {
    if (t.type !== 'punct') return;
    if ('([{'.includes(t.value)) stack.push(k);
    else if (pair[t.value]) { const o = stack.pop(); if (o != null) { out[o].match = k; t.match = o; } }
  });
  return out;
}

// ================= JS 식 검사 =================

const isP = (t, v) => !!t && t.type === 'punct' && (v == null || (Array.isArray(v) ? v.includes(t.value) : t.value === v));
const isOpen = (t) => isP(t, ['(', '[', '{']);
const isClose = (t) => isP(t, [')', ']', '}']);
const endsOperand = (t) => t && (t.type === 'ident' || t.type === 'num' || t.type === 'str' || t.type === 'tmpl' || t.type === 'regex' || isP(t, [')', ']', '}']));
const ASSIGN = ['=', '+=', '-=', '*=', '/=', '%=', '&&=', '||=', '??=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^='];
const CMP = ['==', '===', '!=', '!==', '<', '>', '<=', '>=', 'instanceof', 'in'];
// '+' 이어 붙이기의 경계가 되는 것 (이보다 결합이 약한 연산자, 구분 기호)
const STOP = new Set([',', ';', '?', ':', '&&', '||', '??', '=>', '...', ...ASSIGN, ...CMP]);
const STOP_WORDS = new Set(['return', 'case', 'throw', 'else', 'do', 'in', 'of', 'instanceof', 'yield', 'await', 'typeof', 'void', 'delete']);

// [a, b)를 깊이 0의 ops로 나눈다. '+'·'-'는 이항일 때만
function splitTop(T, a, b, ops) {
  const parts = []; let s = a;
  for (let k = a; k < b; k++) {
    const t = T[k];
    if (isOpen(t) && t.match != null) { k = t.match; continue; }
    const hit = (t.type === 'punct' || t.type === 'ident') && ops.includes(t.value) && k > s;
    if (hit && (t.value === '+' || t.value === '-') && !endsOperand(T[k - 1])) continue;
    if (hit) { parts.push([s, k]); s = k + 1; }
  }
  parts.push([s, b]);
  return parts;
}
// 깊이 0의 삼항 연산자 → { then, else }
function splitTernary(T, a, b) {
  let q = -1, nest = 0;
  for (let k = a; k < b; k++) {
    const t = T[k];
    if (isOpen(t) && t.match != null) { k = t.match; continue; }
    if (isP(t, '?')) { if (q < 0) q = k; else nest++; }
    if (isP(t, ':') && q >= 0) { if (nest) nest--; else return { then: [q + 1, k], else: [k + 1, b] }; }
  }
  return null;
}
// 식의 끝(오른쪽): 깊이 0에서 닫는 괄호·, ; 를 만나기 전까지
function exprEnd(T, a, stopAtTernary) {
  let k = a;
  for (; k < T.length; k++) {
    const t = T[k];
    if (isOpen(t) && t.match != null) { k = t.match; continue; }
    if (isClose(t) || isP(t, [',', ';'])) break;
    if (stopAtTernary && t.type === 'punct' && STOP.has(t.value)) break;
  }
  return k;
}
// '+' 이어 붙이기 하나의 범위(토큰 k를 포함)
function chainRange(T, k) {
  let a = k;
  while (a > 0) {
    const t = T[a - 1];
    if (isClose(t) && t.match != null) { a = t.match; continue; }
    if (isOpen(t) || (t.type === 'punct' && STOP.has(t.value)) || (t.type === 'ident' && STOP_WORDS.has(t.value))) break;
    a--;
  }
  return [a, exprEnd(T, k, true)];
}

const SAFE_FN = { html: ['esc', 'safeUrl', 'encodeURIComponent'], url: ['safeUrl', 'encodeURIComponent', 'thumb'] };
const NUM_FN = ['Number', 'parseInt', 'parseFloat'];
const URL_ATTR = /\s(?:href|src|action|formaction|xlink:href|poster)\s*=\s*["']?[^"'\s>]*$/i;
const EVENT_ATTR = /\son[a-z]+\s*=\s*["']?[^"'>]*$/i;
const HTMLISH = /[<>]|=\s*["']/;

function makeJsChecker(file, src, report, allowUsed) {
  const T = tokenize(src);
  const text = (a, b) => src.slice(T[a].start, T[b - 1].end).replace(/\s+/g, ' ').trim();
  const allowed = (a, b, kind) => {
    const s = text(a, b);
    const hit = HTML_ALLOW.find((e) => e.file === file && e.kind === kind && (e.expr instanceof RegExp ? e.expr.test(s) : e.expr === s));
    if (hit) allowUsed.add(hit);
    return !!hit;
  };
  const isCall = (a, b, names) => T[a].type === 'ident' && names.includes(T[a].value) && isP(T[a + 1], '(') && T[a + 1].match === b - 1 && !isP(T[a - 1], '.');
  const isNumeric = (a, b) => {
    if (b - a === 1 && T[a].type === 'num') return true;
    if (isP(T[a], ['-', '+', '!', '~'])) return true;
    if (splitTop(T, a, b, ['-', '*', '/', '%', '**']).length > 1) return true;
    const last = T[b - 1];
    if (last.type === 'ident' && last.value === 'length' && isP(T[b - 2], '.')) return true;
    if (isP(last, ')') && T[last.match - 1] && T[last.match - 1].value === 'toFixed' && isP(T[last.match - 2], '.')) return true;
    if (T[a].value === 'Math' && isP(T[a + 1], '.')) return true;
    return isCall(a, b, NUM_FN);
  };

  // HTML(kind = 'html') 또는 URL 속성(kind = 'url')에 들어가는 식 [a, b)
  function checkValue(a, b, kind, rule) {
    if (a >= b) return;
    const tern = splitTernary(T, a, b);
    if (tern) { checkValue(...tern.then, kind, rule); checkValue(...tern.else, kind, rule); return; }
    const ors = splitTop(T, a, b, ['||', '??']);
    if (ors.length > 1) { ors.forEach(([x, y]) => checkValue(x, y, kind, rule)); return; }
    const ands = splitTop(T, a, b, ['&&']);
    if (ands.length > 1) { checkValue(...ands[ands.length - 1], kind, rule); return; }
    if (splitTop(T, a, b, CMP).length > 1) return; // true/false
    const parts = splitTop(T, a, b, ['+']);
    // 문자열 리터럴 없이 숫자와 더하는 것(i + 1, T + GAP * 2)은 숫자로 본다
    const isLit = ([x, y]) => y - x === 1 && (T[x].type === 'str' || T[x].type === 'tmpl');
    if (parts.length > 1 && !parts.some(isLit) && parts.some(([x, y]) => isNumeric(x, y))) return;
    if (parts.length > 1) { checkChain(parts, kind, rule); return; }
    checkOperand(a, b, kind, rule);
  }
  function checkChain(parts, kind, rule) {
    let composed = '';
    parts.forEach(([x, y], i) => {
      const lit = y - x === 1 && T[x].type === 'str';
      if (lit) { composed += T[x].value; return; }
      let k = kind;
      if (HTMLISH.test(composed)) k = EVENT_ATTR.test(composed) ? 'event' : URL_ATTR.test(composed) ? 'url' : 'html';
      if (k === 'event') report(rule, T[x].line, 'on* 속성 안에 값을 넣음: ' + text(x, y));
      else checkOperand(x, y, k, k === 'url' ? 'd' : rule);
      composed += '\u0000' + i + '\u0000';
    });
    if (kind === 'url' && parts.length && /^\s*(?:javascript|data|vbscript):/i.test(T[parts[0][0]].type === 'str' ? T[parts[0][0]].value : '')) {
      report('d', T[parts[0][0]].line, '위험한 URL 스킴');
    }
  }
  function checkOperand(a, b, kind, rule) {
    if (b - a === 1 && (T[a].type === 'str' || T[a].type === 'num')) {
      if (kind === 'url' && T[a].type === 'str' && /^\s*(?:javascript|data|vbscript):/i.test(T[a].value)) report('d', T[a].line, '위험한 URL 스킴: ' + T[a].value);
      return;
    }
    if (b - a === 1 && T[a].type === 'tmpl' && !T[a].value.includes('${')) return;
    if (isP(T[a], '(') && T[a].match === b - 1) { checkValue(a + 1, b - 1, kind, rule); return; }
    if (isCall(a, b, SAFE_FN[kind])) return;
    // esc(safeUrl(x))처럼 URL 함수를 esc로 한 번 더 감싼 것
    if (kind === 'url' && isCall(a, b, ['esc']) && isCall(a + 2, b - 1, SAFE_FN.url)) return;
    if (isNumeric(a, b)) return;
    if (kind === 'html' && isMapJoin(a, b)) return;
    if (allowed(a, b, kind)) return;
    report(rule, T[a].line, (kind === 'url' ? 'URL에 safeUrl/encodeURIComponent/thumb 없이 넣음: ' : 'HTML에 esc 없이 넣음: ') + text(a, b));
  }
  // .map(콜백)이면 콜백이 돌려주는 식을 검사
  function checkMapCallback(open) {
    const a = open + 1, b = T[open].match;
    let arrow = -1;
    for (let k = a; k < b; k++) {
      if (isOpen(T[k]) && T[k].match != null) { k = T[k].match; continue; }
      if (isP(T[k], '=>')) { arrow = k; break; }
    }
    if (arrow < 0) return false;
    if (isP(T[arrow + 1], '{')) {
      for (let k = arrow + 2; k < T[arrow + 1].match; k++) {
        if (T[k].type === 'ident' && T[k].value === 'return') checkValue(k + 1, exprEnd(T, k + 1, false), 'html', 'c');
      }
    } else checkValue(arrow + 1, exprEnd(T, arrow + 1, false), 'html', 'c');
    return true;
  }
  // x.map(콜백)[.reverse()|.slice(…)|.filter(…)].join(…) → 콜백을 검사했으면 true
  function isMapJoin(a, b) {
    const name = (close) => (isP(T[close], ')') && T[close].match > a && isP(T[T[close].match - 2], '.') ? T[T[close].match - 1].value : null);
    let close = b - 1;
    if (name(close) !== 'join') return false;
    close = T[close].match - 3;
    while (['reverse', 'slice', 'filter'].includes(name(close))) close = T[close].match - 3;
    if (name(close) !== 'map') return false;
    const open = T[close].match;
    // .map(esc)
    if (T[close].match + 2 === close && T[open + 1].type === 'ident' && SAFE_FN.html.includes(T[open + 1].value)) return true;
    return checkMapCallback(open);
  }
  const checkHtmlSink = (a, b) => checkValue(a, b, 'html', 'c');

  return { T, text, checkValue, checkHtmlSink, allowed };
}

// ================= 파일 검사 =================

function scan(files) {
  const problems = [];
  const report = (file) => (rule, line, msg) => problems.push({ rule, file, line, msg });
  const allowUsed = new Set(), legacyUsed = new Set(), argUsed = new Set();
  for (const f of files) {
    const rep = report(f.name);
    if (f.name.endsWith('.html')) scanHtml(f, rep);
    if (f.name.endsWith('.js')) scanJs(f, rep, allowUsed, legacyUsed, argUsed);
    // (f) 비밀 값 모양
    f.text.split('\n').forEach((ln, i) => SECRET_PATTERNS.forEach((re) => { if (re.test(ln)) rep('f', i + 1, '비밀 값 모양 ' + re); }));
  }
  // 같은 곳을 두 번 알리지 않음
  const seen = new Set();
  return { problems: problems.filter((p) => { const k = p.rule + p.file + p.line + p.msg; if (seen.has(k)) return false; seen.add(k); return true; }), allowUsed, legacyUsed, argUsed };
}

const TAG_RE = /<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g;
const ATTR_RE = /([^\s=>/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
function attrsOf(s) {
  const out = {};
  for (const m of s.matchAll(ATTR_RE)) out[m[1].toLowerCase()] = m[2] == null ? '' : m[2].replace(/^["']|["']$/g, '');
  return out;
}
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

function scanHtml(f, rep) {
  const s = f.text;
  // (a) CSP meta: 하나, 원문과 같음, 다른 리소스보다 앞
  const metas = [...s.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/gi)];
  if (metas.length !== 1) rep('a', 1, 'CSP meta가 ' + metas.length + '개');
  else {
    if (metas[0][1] !== CSP) rep('a', lineOf(s, metas[0].index), 'CSP 원문과 다름');
    const firstRes = Math.min(...['<link', '<script', '<style'].map((x) => { const i = s.indexOf(x); return i < 0 ? Infinity : i; }));
    if (metas[0].index > firstRes) rep('a', lineOf(s, metas[0].index), 'CSP meta가 link/script보다 뒤에 있음');
  }
  for (const m of s.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const at = attrsOf(m[1]), ln = lineOf(s, m.index);
    if (m[2].trim() || at.src == null) rep('a', ln, 'inline <script>');
    // (b) 외부 스크립트: 정확한 버전 + integrity + crossorigin
    if (/^https?:/i.test(at.src || '') && !SRI_EXEMPT_SCRIPT.includes(at.src)) {
      if (!/@\d+\.\d+\.\d+(?:[-+][\w.]+)?\//.test(at.src)) rep('b', ln, '버전이 고정되지 않은 외부 스크립트: ' + at.src);
      if (!/^sha(?:384|512)-/.test(at.integrity || '')) rep('b', ln, 'integrity 없음: ' + at.src);
      if (at.crossorigin == null) rep('b', ln, 'crossorigin 없음: ' + at.src);
    }
  }
  if (/<style\b/i.test(s)) rep('a', lineOf(s, s.search(/<style\b/i)), '<style> 요소 (CSP에 unsafe-inline 없음)');
  for (const m of s.matchAll(TAG_RE)) {
    const at = attrsOf(m[2]), ln = lineOf(s, m.index);
    for (const name of Object.keys(at)) {
      if (/^on/.test(name)) rep('a', ln, 'on* 속성: ' + name);
      if (name === 'style') rep('a', ln, 'style 속성');
      if ((name === 'href' || name === 'src') && /^\s*(?:javascript|data|vbscript):/i.test(at[name])) rep('d', ln, '위험한 URL 스킴: ' + at[name]);
    }
    if (m[1].toLowerCase() === 'link' && /stylesheet/i.test(at.rel || '') && /^https?:/i.test(at.href || '') && !SRI_EXEMPT_STYLE.some((p) => at.href.startsWith(p))) {
      if (!/^sha(?:384|512)-/.test(at.integrity || '') || at.crossorigin == null) rep('b', ln, '외부 스타일에 integrity/crossorigin 없음: ' + at.href);
    }
  }
}

const STORAGE_RECV = ['raw', 'json', 'store'];
function scanJs(f, rep, allowUsed, legacyUsed, argUsed) {
  const { T, text, checkValue, checkHtmlSink } = makeJsChecker(f.name, f.text, rep, allowUsed);
  const at = (k, v) => T[k] && T[k].value === v;
  const hasScriptEl = T.some((t, k) => t.type === 'ident' && t.value === 'createElement' && T[k + 2] && T[k + 2].type === 'str' && T[k + 2].value === 'script');
  for (let k = 0; k < T.length; k++) {
    const t = T[k];
    // (c) HTML 조각이 든 문자열을 이어 붙이는 곳 전부
    if (t.type === 'str' && HTMLISH.test(t.value)) {
      const [a, b] = chainRange(T, k);
      if (splitTop(T, a, b, ['+']).length > 1) checkValue(a, b, 'html', 'c');
      // (a) JS로 만드는 HTML에도 on*·style 속성, <script> 금지
      if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(t.value) || /^\s*on[a-z]+\s*=/i.test(t.value)) rep('a', t.line, 'JS HTML에 on* 속성');
      if (/<[a-z][^>]*\sstyle\s*=/i.test(t.value) || /^\s*style\s*=/i.test(t.value)) rep('a', t.line, 'JS HTML에 style 속성');
      if (/<script/i.test(t.value)) rep('a', t.line, 'JS HTML에 <script>');
    }
    if (t.type === 'tmpl' && HTMLISH.test(t.value) && t.value.includes('${')) rep('c', t.line, '템플릿 문자열로 HTML을 만듦');
    // (c) innerHTML / outerHTML / insertAdjacentHTML / document.write
    if (t.type === 'ident' && (t.value === 'innerHTML' || t.value === 'outerHTML') && isP(T[k - 1], '.') && isP(T[k + 1], ['=', '+='])) {
      checkHtmlSink(k + 2, exprEnd(T, k + 2, false));
    }
    if (t.type === 'ident' && t.value === 'insertAdjacentHTML' && isP(T[k + 1], '(')) {
      const args = splitTop(T, k + 2, T[k + 1].match, [',']);
      if (args[1]) checkHtmlSink(...args[1]);
    }
    if (t.type === 'ident' && (t.value === 'write' || t.value === 'writeln') && at(k - 2, 'document') && isP(T[k - 1], '.')) rep('c', t.line, 'document.write');
    // (d) href·src 속성에 대입
    if (t.type === 'ident' && (t.value === 'href' || t.value === 'src') && isP(T[k - 1], '.') && isP(T[k + 1], '=')) {
      const end = exprEnd(T, k + 2, false);
      checkValue(k + 2, end, 'url', 'd');
      // (b) JS로 넣는 외부 스크립트도 SRI 예외 목록 아니면 안 됨
      if (hasScriptEl && end - (k + 2) === 1 && T[k + 2].type === 'str' && /^https?:/i.test(T[k + 2].value) && !SRI_EXEMPT_SCRIPT.includes(T[k + 2].value) && !f.text.includes('.integrity')) {
        rep('b', t.line, 'SRI 없는 동적 외부 스크립트: ' + T[k + 2].value);
      }
    }
    if (t.type === 'ident' && t.value === 'setAttribute' && isP(T[k + 1], '(') && T[k + 2] && T[k + 2].type === 'str') {
      const name = T[k + 2].value.toLowerCase();
      if (name === 'style' || /^on/.test(name)) rep('a', t.line, "setAttribute('" + name + "')");
      if (name === 'href' || name === 'src') { const args = splitTop(T, k + 2, T[k + 1].match, [',']); if (args[1]) checkValue(...args[1], 'url', 'd'); }
    }
    // (e) 문자열을 코드로 실행
    if (t.type === 'ident' && t.value === 'eval' && isP(T[k + 1], '(') && !isP(T[k - 1], '.')) rep('e', t.line, 'eval');
    if (t.type === 'ident' && t.value === 'Function' && (at(k - 1, 'new') || isP(T[k + 1], '(')) && !isP(T[k - 1], '.')) rep('e', t.line, 'Function 생성자');
    if (t.type === 'ident' && (t.value === 'setTimeout' || t.value === 'setInterval') && isP(T[k + 1], '(') && T[k + 2] && (T[k + 2].type === 'str' || T[k + 2].type === 'tmpl')) rep('e', t.line, '문자열 ' + t.value);
    // (g) 저장소 키
    const direct = t.type === 'ident' && (t.value === 'localStorage' || t.value === 'sessionStorage') && isP(T[k + 1], '.') && ['getItem', 'setItem', 'removeItem'].includes((T[k + 2] || {}).value);
    const wrapped = t.type === 'ident' && STORAGE_RECV.includes(t.value) && !isP(T[k - 1], '.') && isP(T[k + 1], '.') && ['get', 'set'].includes((T[k + 2] || {}).value);
    if ((direct || wrapped) && isP(T[k + 3], '(')) {
      const [a, b] = splitTop(T, k + 4, T[k + 3].match, [','])[0];
      checkStorageArg(f.name, T, a, b, text, rep, legacyUsed, argUsed);
    }
    // (g) 처음 한 번 복사할 때만 읽는 옛 키는 그 파일 밖에 나오면 안 됨
    if (t.type === 'str') {
      const leg = STORAGE_LEGACY.find((e) => e.onlyIn && e.key === t.value);
      if (leg) { if (leg.onlyIn.includes(f.name)) legacyUsed.add(leg); else rep('g', t.line, '옛 키 ' + t.value + '는 ' + leg.onlyIn.join(', ') + '에서만'); }
    }
  }
}

function checkStorageArg(file, T, a, b, text, rep, legacyUsed, argUsed) {
  if (a >= b) return;
  let key = null, prefix = false;
  if (b - a === 1 && T[a].type === 'str') key = T[a].value;
  else if (T[a].type === 'str' && isP(T[a + 1], '+')) { key = T[a].value; prefix = true; }
  if (key == null) {
    const s = text(a, b);
    const hit = STORAGE_ARG_ALLOW.find((e) => e.file === file && e.expr === s);
    if (hit) argUsed.add(hit); else rep('g', T[a].line, '저장소 키를 변수로 넘김(허용 목록 없음): ' + s);
    return;
  }
  if (STORAGE_PREFIXES.some((p) => key.startsWith(p))) return;
  const leg = STORAGE_LEGACY.find((e) => (e.prefix ? key.startsWith(e.key) : !prefix && e.key === key));
  if (!leg) { rep('g', T[a].line, '허용 안 된 저장소 키: ' + key + (prefix ? '*' : '')); return; }
  if (leg.onlyIn && !leg.onlyIn.includes(file)) { rep('g', T[a].line, '옛 키 ' + key + '는 ' + leg.onlyIn.join(', ') + '에서만'); return; }
  legacyUsed.add(leg);
}

// ================= 파일 읽기 =================

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const TEXT_EXT = ['.html', '.js', '.css', '.json', '.svg', '.txt', '.md', '.webmanifest'];
const load = (dir) => walk(dir).filter((p) => TEXT_EXT.includes(path.extname(p)))
  .map((p) => ({ name: path.relative(ROOT, p).split(path.sep).join('/'), text: fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') }));
const fmt = (ps) => ps.map((p) => `  (${p.rule}) ${p.file}:${p.line} ${p.msg}`).join('\n');

// ================= 테스트 =================

const pub = load(path.join(ROOT, 'public'));
const res = scan(pub);
const RULES = { a: 'CSP meta·inline 스크립트·on*·style 속성 없음', b: '외부 스크립트는 정확한 버전 + SRI', c: 'HTML에 끼우는 값은 esc 등', d: 'href·src 값은 safeUrl 등', e: 'eval·Function·문자열 setTimeout 없음', f: '비밀 값 모양 없음', g: '저장소 키는 ulp:/sb- 또는 옛 키 허용 목록' };

for (const [rule, name] of Object.entries(RULES)) {
  test(`(${rule}) public/: ${name}`, () => {
    const ps = res.problems.filter((p) => p.rule === rule);
    assert.equal(ps.length, 0, '\n' + fmt(ps));
  });
}

test('public/*.html 5개 이상을 실제로 읽었다', () => {
  assert.ok(pub.filter((f) => /^public\/[^/]+\.html$/.test(f.name)).length >= 5);
  assert.ok(pub.some((f) => f.name === 'public/app.js'));
});

test('허용 목록에 안 쓰이는 항목이 없다 (지운 코드의 허용 항목은 같이 뺀다)', () => {
  const stale = [
    ...HTML_ALLOW.filter((e) => !res.allowUsed.has(e)).map((e) => 'HTML_ALLOW ' + e.file + ' ' + e.expr),
    ...STORAGE_LEGACY.filter((e) => !res.legacyUsed.has(e)).map((e) => 'STORAGE_LEGACY ' + e.key),
    ...STORAGE_ARG_ALLOW.filter((e) => !res.argUsed.has(e)).map((e) => 'STORAGE_ARG_ALLOW ' + e.file + ' ' + e.expr),
  ];
  assert.deepEqual(stale, []);
});

test('CSP 원문: 스크립트·스타일에 unsafe-* / 와일드카드 없음, object·base는 none', () => {
  const d = Object.fromEntries(CSP.split(';').map((x) => x.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  for (const k of ['script-src', 'style-src', 'default-src']) {
    for (const bad of ["'unsafe-inline'", "'unsafe-eval'", '*', 'https:', 'http:', 'data:', 'blob:']) assert.ok(!d[k].includes(bad), k + ' ' + bad);
  }
  assert.deepEqual(d['object-src'], ["'none'"]);
  assert.deepEqual(d['base-uri'], ["'none'"]);
});

test('(f) 비밀 값 정규식이 실제 모양을 잡고, 자리 표시는 안 잡는다', () => {
  // 진짜 같은 값은 저장소에 두지 않으려고 실행할 때 만든다
  const fake = ['sb_' + 'secret_abc', 'ntn_' + 'A1'.repeat(10), 'AI' + 'za' + 'x'.repeat(35), 'gh' + 'p_' + 'a'.repeat(36), 'github_' + 'pat_' + 'b'.repeat(30)];
  fake.forEach((s) => assert.ok(SECRET_PATTERNS.some((re) => re.test(s)), s.slice(0, 6)));
  assert.ok(!SECRET_PATTERNS.some((re) => re.test('placeholder="github_pat_..."')));
});

// 일부러 틀린 예: 파일마다 그 검사가 실패해야 한다
const FIXTURES = {
  'bad-a.html': { rule: 'a', must: ['CSP meta가 0개', 'inline <script>', 'on* 속성: onclick', 'style 속성'] },
  'bad-a.js': { rule: 'a', must: ['JS HTML에 style 속성', 'JS HTML에 on* 속성', "setAttribute('style')"] },
  'bad-b.html': { rule: 'b', must: ['버전이 고정되지 않은', 'integrity 없음', 'crossorigin 없음'] },
  'bad-c.js': { rule: 'c', must: ['song.title', 'note.text', 'rows.join'] },
  'bad-d.js': { rule: 'd', must: ['esc(url)', 'data.url', '위험한 URL 스킴'] },
  'bad-e.js': { rule: 'e', must: ['eval', 'Function 생성자', '문자열 setTimeout'] },
  'bad-f.js': { rule: 'f', must: ['service_role'] },
  'bad-g.js': { rule: 'g', must: ['my-theme', 'gv-theme', '변수로 넘김'] },
};
const fixDir = path.join(ROOT, 'test', 'fixtures', 'xss');
for (const [file, exp] of Object.entries(FIXTURES)) {
  test(`틀린 예 ${file} → (${exp.rule}) 검사가 실패한다`, () => {
    const f = { name: 'test/fixtures/xss/' + file, text: fs.readFileSync(path.join(fixDir, file), 'utf8').replace(/\r\n/g, '\n') };
    const ps = scan([f]).problems.filter((p) => p.rule === exp.rule);
    for (const m of exp.must) assert.ok(ps.some((p) => p.msg.includes(m)), `"${m}"를 못 잡음. 잡은 것:\n` + fmt(ps));
  });
}
test('틀린 예 폴더의 파일이 모두 표에 있다', () => {
  assert.deepEqual(fs.readdirSync(fixDir).sort(), Object.keys(FIXTURES).sort());
});
