// CH-5: CHORDS 화면 순수 함수(frontend/src/components/progressions/model.mts) + duplicatePitches + 메뉴·라우트 연결
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let M; // model.mts
let S; // symbol.mts

before(async () => {
  M = await import('../frontend/src/components/progressions/model.mts');
  S = await import('../frontend/src/lib/chords/symbol.mts');
});

const dto = (over = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'analysis',
  origin: 'ai',
  route: 'video',
  evidence: '화면',
  title: '네오소울 진행',
  part: '후렴',
  artist: '',
  album: '',
  channel: '채널',
  releaseDate: null,
  key: 'F Major',
  instrument: '건반',
  chords: [
    { symbol: 'FM9', roman: 'IM9', source: '화면', timestamp: '0:42' },
    { symbol: 'Dm9', roman: 'vim9', source: '말함', timestamp: '0:45' },
  ],
  moods: ['dreamy'],
  genres: [],
  tags: [],
  url: 'https://www.youtube.com/watch?v=abcdefghijk',
  videoId: 'abcdefghijk',
  startSec: 42,
  endSec: 60,
  memo: '',
  noteId: '22222222-2222-4222-8222-222222222222',
  createdAt: '2026-11-04T00:00:00Z',
  updatedAt: '2026-11-04T00:00:00Z',
  ...over,
});

describe('CH-5-1: splitChordInput — 하이픈·공백·마디선 구분, 괄호 텐션 보존', () => {
  test('정상 입력', () => {
    assert.deepEqual(M.splitChordInput('FM7 - E7 - Am7 - Gm7 C7'), ['FM7', 'E7', 'Am7', 'Gm7', 'C7']);
    assert.deepEqual(M.splitChordInput('FM7-E7-Am7'), ['FM7', 'E7', 'Am7']);
    assert.deepEqual(M.splitChordInput('| Dm7 | G7 | CM7 |'), ['Dm7', 'G7', 'CM7']);
    assert.deepEqual(M.splitChordInput('C7(b9, b13) → Fm'), ['C7(b9, b13)', 'Fm']);
    assert.deepEqual(M.splitChordInput('C-7 F7'), ['C-7', 'F7']); // C-7은 하이픈이 마이너
  });
  test('잘못된 입력: 못 읽는 토큰도 남기고 빈 입력은 빈 배열', () => {
    assert.deepEqual(M.splitChordInput(''), []);
    assert.deepEqual(M.splitChordInput('   -  '), []);
    assert.deepEqual(M.splitChordInput('C H7 Cxyz'), ['C', 'H7', 'Cxyz']);
  });
});

describe('CH-5-2: checkChord — 못 읽음·길이·같은 음 도수 경고', () => {
  test('정상 / 못 읽음 / 25자', () => {
    assert.deepEqual(M.checkChord('Am7'), { symbol: 'Am7', ok: true, warning: '' });
    const bad = M.checkChord('H7');
    assert.equal(bad.ok, false);
    assert.equal(bad.warning, '근음은 A~G로 시작해야 합니다');
    assert.equal(M.checkChord('Cxyz').warning, '모르는 코드 표기입니다');
    assert.equal(M.checkChord('C'.repeat(25)).ok, false);
  });
  test('duplicatePitches: b5 = #11, #5 = b13 은 경고만 (ok 유지)', () => {
    assert.deepEqual(S.duplicatePitches(S.parseChord('Cm7b5(#11)')), [['b5', '#11']]);
    assert.deepEqual(S.duplicatePitches(S.parseChord('C7#5(b13)')), [['#5', 'b13']]);
    assert.deepEqual(S.duplicatePitches(S.parseChord('C13')), []);
    assert.deepEqual(S.duplicatePitches(S.parseChord('C7alt')), []);
    const w = M.checkChord('Cm7b5(#11)');
    assert.equal(w.ok, true);
    assert.equal(w.warning, '도수 표기는 중복이지만 연주 음은 겹칩니다 (b5 = #11)');
  });
});

describe('CH-5-3: 로마숫자 계산·유지', () => {
  test('키가 있으면 계산, 없으면 빈 값 (읽는 법 안내 예시와 같음)', () => {
    const syms = ['FM7', 'E7', 'Am7', 'Gm7', 'C7'];
    assert.deepEqual(M.computeRomans(syms, 'A min'), ['bVIM7', 'V7', 'im7', 'bviim7', 'bIII7']);
    assert.deepEqual(M.computeRomans(syms, ''), ['', '', '', '', '']);
    const guide = read('frontend/src/components/progressions/ReadingGuide.tsx');
    assert.ok(guide.includes('bVIM7 - V7 - im7 - bviim7 - bIII7'));
  });
  test('keep: 같은 자리·같은 심볼이면 원래 roman(AI 값), 바뀐 자리만 계산', () => {
    const keep = [{ symbol: 'FM9', roman: 'I M9 (AI)' }, { symbol: 'Dm9', roman: 'vim9' }];
    assert.deepEqual(M.computeRomans(['FM9', 'Gm7'], 'F Major', keep), ['I M9 (AI)', 'iim7']);
  });
  test('키 추정 1등', () => {
    assert.equal(M.keyCandidates(['C', 'Am', 'F', 'G'])[0].key, 'C Major');
    assert.deepEqual(M.keyCandidates([]), []);
  });
});

describe('CH-5-4: 폼 ↔ API 본문', () => {
  test('validateForm: 필수·형식', () => {
    const f = { ...M.emptyForm('reference'), title: 'Just the Two of Us', artist: 'Grover', chordsText: 'FM7 E7' };
    assert.equal(M.validateForm(f, M.splitChordInput(f.chordsText)), '');
    assert.equal(M.validateForm({ ...f, title: ' ' }, ['C']), '곡 제목을 입력하세요.');
    assert.equal(M.validateForm({ ...f, artist: '' }, ['C']), '아티스트를 입력하세요.');
    assert.equal(M.validateForm({ ...f, kind: 'analysis', artist: '' }, ['C']), ''); // 분석은 아티스트 선택
    assert.equal(M.validateForm(f, []), '코드를 하나 이상 입력하세요.');
    assert.equal(M.validateForm(f, Array(65).fill('C')), '코드는 64개까지 넣을 수 있습니다.');
    assert.equal(M.validateForm({ ...f, url: 'ftp://x' }, ['C']), '링크는 http:// 또는 https://로 시작해야 합니다.');
    assert.equal(M.validateForm({ ...f, moods: Array(11).fill(0).map((_, i) => 'm' + i).join(',') }, ['C']), 'Mood는 10개까지 넣을 수 있습니다.');
  });
  test('splitList: 공백·중복 제거', () => {
    assert.deepEqual(M.splitList(' nostalgia, RnB ,RnB,, '), ['nostalgia', 'RnB']);
  });
  test('formToCreate: 직접 행 본문 (source 없음, key 빈 값은 null)', () => {
    const f = { ...M.emptyForm('reference'), title: ' T ', artist: 'A', chordsText: 'C G', moods: 'x, y' };
    const body = M.formToCreate(f, ['C', 'G'], ['I', 'V']);
    assert.deepEqual(body.chords, [{ symbol: 'C', roman: 'I' }, { symbol: 'G', roman: 'V' }]);
    assert.equal(body.title, 'T');
    assert.equal(body.key, null);
    assert.deepEqual(body.moods, ['x', 'y']);
  });
  test('formToPatch: 안 바꾸면 빈 본문, AI 행 코드를 그대로 두면 chords 안 보냄', () => {
    const p = dto();
    const f = M.formFromDto(p);
    const syms = M.splitChordInput(f.chordsText);
    const romans = M.computeRomans(syms, f.key, p.chords);
    assert.deepEqual(M.formToPatch(f, syms, romans, p), {});
  });
  test('formToPatch: 메모만 바꾸면 memo만, 코드를 바꾸면 timestamp는 같은 자리만 유지하고 직접 전환 경고', () => {
    const p = dto();
    const f = { ...M.formFromDto(p), memo: '좋음' };
    const syms = M.splitChordInput(f.chordsText);
    assert.deepEqual(M.formToPatch(f, syms, M.computeRomans(syms, f.key, p.chords), p), { memo: '좋음' });

    const syms2 = ['FM9', 'Bb7'];
    const patch = M.formToPatch({ ...M.formFromDto(p), chordsText: 'FM9 Bb7' }, syms2, M.computeRomans(syms2, 'F Major', p.chords), p);
    assert.deepEqual(patch.chords, [
      { symbol: 'FM9', roman: 'IM9', timestamp: '0:42' },
      { symbol: 'Bb7', roman: 'IV7' },
    ]);
    assert.equal(M.patchTurnsManual(patch, p), true);
    assert.equal(M.patchTurnsManual({ memo: 'x' }, p), false);
  });
  test('formToPatch: 키를 비우면 key null, 구분 변경', () => {
    const p = dto({ origin: 'manual', route: 'manual', evidence: null, kind: 'reference' });
    const f = { ...M.formFromDto(p), key: '', kind: 'analysis' };
    const syms = M.splitChordInput(f.chordsText);
    const patch = M.formToPatch(f, syms, M.computeRomans(syms, '', p.chords), p);
    assert.equal(patch.key, null);
    assert.equal(patch.kind, 'analysis');
  });
});

describe('CH-5-5: 목록·링크·시드', () => {
  test('filterScope', () => {
    const list = [dto({ id: 'a', kind: 'reference' }), dto({ id: 'b' })];
    assert.deepEqual(M.filterScope(list, 'reference').map((x) => x.id), ['a']);
    assert.deepEqual(M.filterScope(list, 'analysis').map((x) => x.id), ['b']);
    assert.equal(M.filterScope(list, 'all').length, 2);
  });
  test('playHref: chords.html#prog?c=…&k=…&t=…&from=… (CH-1a §3-1)', () => {
    const href = M.playHref(dto({ title: 'A & B', chords: [{ symbol: 'C7(b9, b13)', roman: '' }, { symbol: 'F#m7', roman: '' }] }));
    assert.ok(href.startsWith('chords.html#prog?'));
    const qs = new URLSearchParams(href.split('#prog?')[1]);
    assert.equal(qs.get('c'), 'C7(b9, b13),F#m7');
    assert.equal(qs.get('k'), 'F Major');
    assert.equal(qs.get('t'), 'A & B');
    assert.equal(qs.get('from'), '11111111-1111-4111-8111-111111111111');
    assert.equal(new URLSearchParams(M.playHref({ chords: [{ symbol: 'C', roman: '' }], key: null }).split('#prog?')[1]).has('k'), false);
  });
  test('loopHref: 영상 행만, 시작 초 포함 / 잘못된 videoId는 빈 값', () => {
    assert.equal(M.loopHref(dto()), 'practice.html?v=abcdefghijk&t=42');
    assert.equal(M.loopHref(dto({ startSec: null })), 'practice.html?v=abcdefghijk');
    assert.equal(M.loopHref(dto({ videoId: null })), '');
    assert.equal(M.loopHref(dto({ videoId: 'bad"id' })), '');
  });
  test('formatSec', () => {
    assert.equal(M.formatSec(42), '0:42');
    assert.equal(M.formatSec(3725), '1:02:05');
    assert.equal(M.formatSec(null), '');
  });
  test('seedToDto: 시드 10개 → 키 표기 정규화·로마숫자 계산', () => {
    assert.equal(M.seedKey('A Minor'), 'A min');
    assert.equal(M.seedKey('C Major'), 'C Major');
    assert.equal(M.seedKey('F Dominant'), null);
    const s = M.seedToDto({ id: 'ref-seed-2', category: 'REFERENCE', chordsText: 'FM9 - E7b9 - Am9 - C13', title: 'T', keyLabel: 'A Minor' });
    assert.equal(s.kind, 'reference');
    assert.equal(s.key, 'A min');
    assert.deepEqual(s.chords.map((c) => c.roman), ['bVIM9', 'V7(b9)', 'im9', 'bIII13']);
    const a = M.seedToDto({ id: 'arch-seed-3', category: 'ARCHIVE', chordsText: 'F9 - Bb13', title: 'T', keyLabel: 'F Dominant' });
    assert.equal(a.kind, 'analysis');
    assert.deepEqual(a.chords.map((c) => c.roman), ['', '']);
  });
});

describe('CH-5-6: 메뉴·라우트·API 연결', () => {
  test('CHORDS 메뉴가 progressions.html로 켜졌고 라우트가 있다', () => {
    assert.match(read('frontend/src/components/layout/AppShell.tsx'), /key: 'chords', label: 'CHORDS', href: 'progressions\.html'/);
    assert.match(read('frontend/src/App.tsx'), /path="\/progressions\.html" element={<ProgressionsPage \/>}/);
  });
  test('apiClient가 설계 §3 경로를 쓴다', () => {
    const src = read('frontend/src/lib/apiClient.ts');
    for (const s of ["'/api/v1/progressions'", "'/api/v1/progressions/analyze'", "'/collect'", "method: 'PATCH'", 'collectProgressions?: boolean', "kind?: 'note' | 'progression'"]) {
      assert.ok(src.includes(s), s);
    }
  });
});

describe('GA-4: 끝난 작업 한 줄로 합치기(summarizeDoneJobs)', () => {
  test('끝난 작업만 세고, 그 노트들에서 온 진행 수를 더하며, 최근 노트는 맨 앞 완료 작업', () => {
    const jobs = [
      { status: 'running', noteId: null },
      { status: 'done', noteId: 'n3' },
      { status: 'failed', noteId: null },
      { status: 'done', noteId: 'n2' },
    ];
    const items = [{ noteId: 'n2' }, { noteId: 'n2' }, { noteId: 'n3' }, { noteId: 'other' }, { noteId: null }];
    assert.deepEqual(M.summarizeDoneJobs(jobs, items), { jobCount: 2, collected: 3, latestNoteId: 'n3' });
  });
  test('완료 작업 없음 · 노트 없는 완료(진행 0개) · 빈 입력', () => {
    assert.deepEqual(M.summarizeDoneJobs([{ status: 'queued' }], [{ noteId: 'n1' }]), { jobCount: 0, collected: 0, latestNoteId: null });
    assert.deepEqual(M.summarizeDoneJobs([{ status: 'done', noteId: null }], [{ noteId: null }]), { jobCount: 1, collected: 0, latestNoteId: null });
    assert.deepEqual(M.summarizeDoneJobs([], []), { jobCount: 0, collected: 0, latestNoteId: null });
  });
  test('apiClient가 force를 true일 때만 보낸다', () => {
    assert.ok(read('frontend/src/lib/apiClient.ts').includes('if (input?.force === true) body.force = true;'));
  });
});
