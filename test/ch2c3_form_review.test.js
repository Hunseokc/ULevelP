// CH-2c-3: 정석 폼 사람 검토(유지보수) — 애매 비율 · 저장본 일치 · 자동 회피 · 판정 형식 · 반영 · 목록 재생성
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TABLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend/src/lib/engine/chordForms.json'), 'utf8'));

let R; // scripts/chord_form_review.mjs
let X; // engine/chordShapes.mjs
let P; // engine/progressionPath.mjs
let S; // chords/symbol.mts
before(async () => {
  R = await import('../scripts/chord_form_review.mjs');
  X = await import('../frontend/src/lib/engine/chordShapes.mjs');
  P = await import('../frontend/src/lib/engine/progressionPath.mjs');
  S = await import('../frontend/src/lib/chords/symbol.mts');
});

const fx = (frets) => frets.map((f) => (f < 0 ? 'x' : f)).join(' ');
const chord = (name) => { const c = S.parseChord(name); assert.equal(c.ok, true, name); return c; };

describe('CH-2c-3-1 애매 기준', () => {
  test('표에 없는 코드 중 애매(1등 폼에 드문 특징) ≤ 5% — 실측 68/1656', (t) => {
    const { rows, total, zero } = R.listAmbiguous(TABLE);
    t.diagnostic(`애매 ${rows.length}/${total} = ${((rows.length / total) * 100).toFixed(1)}% · 후보 0개 ${zero.length}`);
    assert.equal(total, 1656);
    assert.ok(rows.length / total <= 0.05, `${rows.length}/${total}`);
    assert.ok(rows.every((r) => r.표시 && r.후보1));
  });

  test('후보 0개는 7alt + 텐션 4종(48코드)뿐 — standard는 [], both는 compact로 대체', () => {
    const { zero } = R.listAmbiguous(TABLE);
    const qs = new Set(zero.map((n) => chord(n).quality));
    assert.deepEqual([...qs].sort(), ['7alt#11', '7alt11', '7alt13', '7alt9']);
    assert.equal(zero.length, 48);
    const c = chord(zero[0]);
    assert.equal(P.chordCandidates(c, { shapes: 'standard', formTable: TABLE }).voicings.length, 0);
    const b = P.chordCandidates(c, { shapes: 'both', formTable: TABLE }).voicings;
    assert.ok(b.length > 0 && b.every((v) => v.kind === 'compact'));
  });

  test('자동 회피: 1등이 드문 특징이면 1점 이내의 특징 없는 후보가 1등(점수도 1등 위로) — chordCandidates 정렬 뒤에도 유지', () => {
    let seen = 0;
    for (const c of R.ruleOnlyChords(TABLE)) {
      const g = X.ruleForms(c, {});
      if (!g.length || !g[0].avoided) continue;
      seen++;
      assert.deepEqual(g[0].flags, [], c.raw);
      assert.ok(g[0].score > g[1].score && g[0].score - g[1].score < 1.01, c.raw);
      if (seen <= 5) {
        const top = P.chordCandidates(c, { shapes: 'standard', formTable: TABLE }).voicings[0];
        assert.equal(fx(top.frets), fx(g[0].frets), c.raw);
      }
    }
    assert.ok(seen > 50, `회피 ${seen}`);
  });
});

describe('CH-2c-3-2 저장본 일치 (--check와 같음)', () => {
  test('검토 목록 CSV = 지금 규칙으로 다시 만든 목록, chordFormReview.json = 판정 반영 결과', () => {
    const rows = R.parseCsv(fs.readFileSync(R.CSV_PATH, 'utf8'));
    assert.equal(R.toCsv(R.regenerate(TABLE, rows).rows), R.toCsv(rows));
    assert.equal(fs.readFileSync(R.JSON_PATH, 'utf8'), JSON.stringify(R.applyDecisions(rows), null, 1) + '\n');
  });
});

describe('CH-2c-3-3 판정 형식', () => {
  let row;
  before(() => { row = R.listAmbiguous(TABLE).rows[0]; });

  test('빈칸 · ok · 2 · 3 · 직접 · 빼기', () => {
    assert.deepEqual(R.decide({ ...row, 판정: '' }), { kind: 'todo' });
    assert.deepEqual(R.decide({ ...row, 판정: '빼기' }), { kind: 'none' });
    assert.equal(fx(R.decide({ ...row, 판정: 'ok' }).frets), row.후보1);
    assert.equal(fx(R.decide({ ...row, 판정: 'OK' }).frets), row.후보1);
    assert.equal(fx(R.decide({ ...row, 판정: '2' }).frets), row.후보2);
    assert.equal(fx(R.decide({ ...row, 판정: '3' }).frets), row.후보3);
    assert.equal(fx(R.decide({ ...row, 판정: `직접:${row.후보2}` }).frets), row.후보2);
  });

  test('잘못된 판정 → 오류: 모르는 말 · 6줄 아님 · 음 검증 실패 · 없는 후보 · id와 코드 불일치', () => {
    assert.throws(() => R.decide({ ...row, 판정: '좋음' }), /모름/);
    assert.throws(() => R.decide({ ...row, 판정: '직접:x 3 2' }), /6줄/);
    assert.throws(() => R.decide({ ...row, 판정: '직접:x 3 2 0 1 0' }), /음 검증/); // C 폼은 이 코드가 아님
    assert.throws(() => R.decide({ ...row, 후보3: '', 판정: '3' }), /후보3/);
    assert.throws(() => R.decide({ ...row, id: '0:maj', 판정: 'ok' }), /id/);
    assert.throws(() => R.applyDecisions([{ ...row, 판정: '4' }]), /모름/);
  });

  test('CSV 왕복: 쉼표·따옴표·줄바꿈이 든 메모, 머리줄이 다르면 오류', () => {
    const rows = [{ ...row, 메모: '바레, "검지" 어려움\n둘째 줄' }];
    assert.deepEqual(R.parseCsv(R.toCsv(rows)), rows.map((r) => ({ ...r, 메모: r.메모 })));
    assert.throws(() => R.parseCsv('a,b\n1,2\n'), /머리줄/);
  });
});

describe('CH-2c-3-4 반영 → 엔진', () => {
  test('승인 폼은 표 폼(kind table, src review)으로 1등, 빼기는 standard 후보 0개(both는 compact)', () => {
    const rows = R.listAmbiguous(TABLE).rows;
    const [a, b] = rows;
    const review = R.applyDecisions([{ ...a, 판정: '2' }, { ...b, 판정: '빼기' }]);
    assert.deepEqual(Object.keys(review.forms).sort(), [a.id, b.id].sort());
    const table = X.withReview(TABLE, review);
    assert.equal(Object.keys(table.forms).length, Object.keys(TABLE.forms).length + 2);
    assert.equal(TABLE.forms[a.id], undefined, '원본 표는 그대로');

    const va = X.standardForms(chord(a.코드), table, { lo: 0, hi: 24 });
    assert.equal(va.length, 1);
    assert.equal(va[0].kind, 'table'); assert.equal(va[0].src, `review ${a.코드}`);
    assert.equal(fx(va[0].frets), a.후보2);
    const ca = P.chordCandidates(chord(a.코드), { shapes: 'standard', formTable: table });
    assert.equal(fx(ca.voicings[0].frets), a.후보2);

    assert.deepEqual(X.standardForms(chord(b.코드), table, {}), []);
    assert.equal(P.chordCandidates(chord(b.코드), { shapes: 'standard', formTable: table }).voicings.length, 0);
    assert.ok(P.chordCandidates(chord(b.코드), { shapes: 'both', formTable: table }).voicings.every((v) => v.kind === 'compact'));
  });

  test('withReview: 같은 id는 표가 우선, 검토 없음·표 없음도 안전', () => {
    const review = { forms: { '0:maj': { name: 'C', forms: [], none: true } } };
    assert.equal(X.withReview(TABLE, review).forms['0:maj'], TABLE.forms['0:maj']);
    assert.equal(Object.keys(X.withReview(TABLE, null).forms).length, Object.keys(TABLE.forms).length);
    assert.equal(X.withReview(null, review), null);
  });
});

describe('CH-2c-3-5 목록 재생성(유지보수 — 규칙이 바뀌어도 판정이 남는다)', () => {
  test('같은 id 판정·메모 유지, 번호 판정인데 후보가 바뀌면 "직접:예전 프렛", 목록에서 빠진 판정 행은 "판정 보존"', () => {
    const rows = R.listAmbiguous(TABLE).rows;
    const [a, b] = rows;
    const old = [
      { ...a, 판정: 'ok', 메모: '좋음' },
      { ...b, 후보2: '9 9 9 9 9 9', 판정: '2' }, // 예전 후보2가 지금과 다름
      { id: '0:gone', 코드: 'Cgone', 표시: '', 후보1: '1 1 1 1 1 1', 후보2: '', 후보3: '', 판정: 'ok', 메모: '' },
      { id: '0:empty', 코드: 'Cempty', 표시: '', 후보1: '', 후보2: '', 후보3: '', 판정: '', 메모: '' },
    ];
    const g = R.regenerate(TABLE, old);
    const by = new Map(g.rows.map((r) => [r.id, r]));
    assert.equal(by.get(a.id).판정, 'ok'); assert.equal(by.get(a.id).메모, '좋음');
    assert.equal(by.get(b.id).판정, '직접:9 9 9 9 9 9');
    assert.equal(by.get(b.id).후보2, b.후보2);
    assert.equal(by.get('0:gone').표시, '판정 보존');
    assert.equal(by.get('0:gone').판정, '직접:1 1 1 1 1 1');
    assert.equal(by.has('0:empty'), false);
    assert.equal(g.ambiguous, rows.length);
  });
});
