// 기타 코드 연습실 서버: 정적 파일 + 보이싱 계산 API (외부 의존성 없음)
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const GE = require('./public/lib/voicing.js');
const CT = require('./public/lib/theory.js');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ---------- 입력 해석 ----------
class BadRequest extends Error {}
function noteParam(v, name) {
  if (v == null || v === '') throw new BadRequest(name + ' 값이 필요합니다 (0~11 또는 C, Db, F# 같은 음이름)');
  if (/^\d+$/.test(v)) { const n = Number(v); if (n >= 0 && n < 12) return n; }
  const map = { C: 0, 'C#': 1, DB: 1, D: 2, 'D#': 3, EB: 3, E: 4, F: 5, 'F#': 6, GB: 6, G: 7, 'G#': 8, AB: 8, A: 9, 'A#': 10, BB: 10, B: 11 };
  const k = String(v).trim().toUpperCase();
  if (k in map) return map[k];
  throw new BadRequest(name + '=' + v + ' 를 음이름으로 읽을 수 없습니다');
}
function intParam(v, name, def, lo, hi) {
  if (v == null || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new BadRequest(name + ' 는 ' + lo + '~' + hi + ' 사이 정수여야 합니다');
  return n;
}
function stringParam(v, name, def) {
  // 1~6번줄 표기 -> 내부 인덱스(0 = 6번줄)
  const n = intParam(v, name, def, 1, 6);
  return 6 - n;
}

// ---------- API ----------
const routes = {
  '/api/health': () => ({ ok: true }),

  // 코드 하나의 보이싱 목록
  '/api/voicings': (q) => {
    const root = noteParam(q.get('root'), 'root');
    const quality = q.get('quality') || '7';
    if (!GE.CH[quality]) throw new BadRequest('quality 는 ' + Object.keys(GE.CH).join(', ') + ' 중 하나');
    const list = GE.genVoicings(root, quality, {
      lo: intParam(q.get('lo'), 'lo', 1, 0, 20), hi: intParam(q.get('hi'), 'hi', 12, 0, 22),
      maxSpan: intParam(q.get('span'), 'span', 3, 1, 6), maxNotes: intParam(q.get('notes'), 'notes', 4, 3, 6),
      needGuide: intParam(q.get('guide'), 'guide', 2, 0, 2),
    }).sort((a, b) => b.score - a.score).slice(0, intParam(q.get('limit'), 'limit', 30, 1, 500));
    return { chord: GE.chordName(root, quality), count: list.length, voicings: list.map(slimVoicing) };
  },

  // 프렛 창(+펜타) 안의 2-5-1
  '/api/two-five-one': (q) => {
    const pent = q.get('pent') ? { root: noteParam(q.get('pent'), 'pent'), type: q.get('pentType') === 'maj' ? 'maj' : 'min' } : null;
    const keys = q.get('key') ? [noteParam(q.get('key'), 'key')] : undefined;
    const res = GE.search251({
      kind: q.get('kind') === 'minor' ? 'minor' : 'major', keys,
      lo: intParam(q.get('lo'), 'lo', 5, 0, 20), hi: intParam(q.get('hi'), 'hi', 8, 0, 22),
      pent, outsideMax: pent ? intParam(q.get('outside'), 'outside', 2, 0, 4) : 99,
      needGuide: intParam(q.get('guide'), 'guide', 2, 1, 2), variants: q.get('variants') === '1', perKey: 3,
    });
    return res.map((k) => ({ key: CT.NAMES[k.key], paths: k.paths.map((p) => ({ score: +p.total.toFixed(2), chords: p.chords.map(slimVoicing) })) }));
  },

  // 탑노트 고정 도미넌트 전체
  '/api/top-note': (q) => {
    const s = stringParam(q.get('string'), 'string', 1);
    if (s < 3) throw new BadRequest('string 은 1~3번줄만 지원합니다');
    const f = intParam(q.get('fret'), 'fret', 8, 1, 19);
    const res = GE.topNoteDominants({ s, f, maxSpan: intParam(q.get('span'), 'span', 3, 2, 5), maxNotes: intParam(q.get('notes'), 'notes', 4, 3, 5), perChord: 3 });
    return { top: CT.NAMES[CT.pc(CT.OPEN[s] + f)], string: 6 - s, fret: f, chords: res.map((c) => ({ name: c.name, topDegree: c.topDeg, count: c.count, voicings: c.voicings.map(slimVoicing) })) };
  },

  // 5도권 탑노트 고정 진행
  '/api/circle': (q) => {
    const root = noteParam(q.get('root') || 'F', 'root');
    const iv = intParam(q.get('top'), 'top', 2, 0, 11);
    return CT.circleSteps(root, iv).map((s) => ({ chord: s.q ? s.name : CT.NAMES[s.root] + '7', root: CT.NAMES[s.root], topDegree: s.deg, possible: !!s.q }));
  },

  // 드롭 × 전위 × 줄세트 × 성질
  '/api/matrix': (q) => {
    const root = noteParam(q.get('root') || 'C', 'root');
    const drop = q.get('drop') || 'd2';
    if (!CT.DROPS.find((d) => d.id === drop)) throw new BadRequest('drop 은 ' + CT.DROPS.map((d) => d.id).join(', ') + ' 중 하나');
    const inv = intParam(q.get('inv'), 'inv', 0, 0, 3);
    const span = intParam(q.get('span'), 'span', 4, 2, 6);
    const st = CT.dropStructure(drop)[inv];
    return CT.playableSets(drop, inv, root, span).map((s) => {
      const R0 = s.placements[0].R0;
      return {
        strings: s.label, allQualities: s.full,
        qualities: CT.Q4.map((qq) => { const a = CT.atR0(st, s.set, R0, qq.id); return { chord: CT.NAMES[root] + qq.name, frets: fretStr(a.notes), degrees: a.notes.map((n) => n.deg), playable: a.valid && a.span <= span }; }),
      };
    });
  },

  // 스케일 구성음과 지판 위치. circle=5|4 면 5도권(또는 4도권) 12키 순환
  '/api/scale': (q) => {
    const root = noteParam(q.get('root') || 'C', 'root');
    const type = q.get('type') || 'major';
    if (!CT.SCALE_BY[type]) throw new BadRequest('type 은 ' + CT.SCALES.map((s) => s.id).join(', ') + ' 중 하나');
    const circle = q.get('circle');
    if (circle) {
      if (circle !== '5' && circle !== '4') throw new BadRequest('circle 은 5 또는 4');
      return CT.scaleCircle(root, type, circle === '4' ? -1 : 1).map((k) => ({ name: k.name, notes: k.notes.map((n) => n.name), added: k.added, removed: k.removed }));
    }
    const tuning = CT.TUNING_BY[q.get('tuning') || 'g6'];
    if (!tuning) throw new BadRequest('tuning 은 ' + CT.TUNINGS.map((t) => t.id).join(', ') + ' 중 하나');
    const lo = intParam(q.get('lo'), 'lo', 0, 0, tuning.frets), hi = intParam(q.get('hi'), 'hi', 12, lo, tuning.frets);
    const info = CT.scaleInfo(root, type);
    return {
      name: info.name, notes: info.notes.map((n) => ({ name: n.name, degree: n.deg })),
      positions: CT.scaleOnBoard(root, type, tuning.open, lo, hi).map((n) => ({ string: tuning.open.length - n.s, fret: n.f, note: n.name, degree: n.deg })),
    };
  },

  // 음 배열 재해석 (우기기). frets=x,x,4,2,2,4 (6번줄부터)
  '/api/interpret': (q) => {
    const raw = (q.get('frets') || '').split(/[,\s]+/).filter(Boolean);
    if (raw.length !== 6) throw new BadRequest('frets 는 6번줄부터 6개 값입니다. 예: x,x,4,2,2,4');
    const notes = raw.map((v, s) => {
      if (/^x$/i.test(v)) return null;
      const f = Number(v);
      if (!Number.isInteger(f) || f < 0 || f > 22) throw new BadRequest('frets 값은 0~22 또는 x');
      return { s, f, pitch: CT.OPEN[s] + f };
    }).filter(Boolean);
    return CT.interpret(notes).map((x) => ({ chord: x.name, family: x.famLabel, role: x.role, key: x.key != null ? CT.NAMES[x.key] + (x.keyMinor ? 'm' : '') : null, rootless: x.rootless, degrees: x.degs }));
  },
};

function fretStr(notes) { return [0, 1, 2, 3, 4, 5].map((s) => { const n = notes.find((m) => m.s === s); return n ? n.f : 'x'; }).join(' '); }
function slimVoicing(v) { return { chord: v.name, frets: GE.fretStr(v), degrees: v.notes.map((n) => n.deg), score: +v.score.toFixed(2) }; }

// ---------- HTTP ----------
function send(res, status, body, type, extra) {
  res.writeHead(status, Object.assign({ 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' }, extra || {}));
  res.end(body);
}
function sendJson(res, status, obj) { send(res, status, JSON.stringify(obj), MIME['.json'], { 'Cache-Control': 'no-store' }); }

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': rel === '/index.html' ? 'no-cache' : 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'GET 만 지원합니다' });
  const route = routes[url.pathname];
  if (route) {
    try { return sendJson(res, 200, route(url.searchParams)); }
    catch (e) {
      if (e instanceof BadRequest) return sendJson(res, 400, { error: e.message });
      console.error(e);
      return sendJson(res, 500, { error: '서버 오류' });
    }
  }
  if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: '없는 API입니다', apis: Object.keys(routes) });
  serveStatic(req, res, url.pathname);
});

if (require.main === module) {
  server.listen(PORT, HOST, () => console.log('기타 코드 연습실: http://localhost:' + PORT));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
module.exports = { server, routes };
