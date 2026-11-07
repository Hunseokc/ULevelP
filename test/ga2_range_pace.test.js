// GA-2: 코드 진행 영상 분석 구간·속도 순수 함수(frontend/src/components/progressions/model.mts). 규칙: 개발산출물/완료/진행_분석설정.md §3-2
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let M;
before(async () => {
  M = await import('../frontend/src/components/progressions/model.mts');
});

test('GA2-1 시간 입력 파싱: 초·분:초·시:분:초, 빈 칸은 null', () => {
  assert.equal(M.parseTimeInput('80'), 80);
  assert.equal(M.parseTimeInput('1:20'), 80);
  assert.equal(M.parseTimeInput(' 0:05 '), 5);
  assert.equal(M.parseTimeInput('1:02:03'), 3723);
  assert.equal(M.parseTimeInput('0'), 0);
  assert.equal(M.parseTimeInput('24:00:00'), 86400);
  assert.equal(M.parseTimeInput(''), null);
  assert.equal(M.parseTimeInput('   '), null);
});

test('GA2-2 잘못된 시간 입력은 undefined', () => {
  for (const bad of ['1:60', '1.5', '-3', 'abc', '1:2:3:4', '24:00:01', '86401', ':20', '1:', '１:２０']) {
    assert.equal(M.parseTimeInput(bad), undefined, bad);
  }
  assert.equal(M.parseTimeInput(null), null);
  assert.equal(M.parseTimeInput(undefined), null);
});

test('GA2-3 구간 검사: 끝은 시작보다 1초 이상 뒤, 형식 오류 문구', () => {
  assert.deepEqual(M.checkRange('0:40', '1:20'), { startSec: 40, endSec: 80, error: '' });
  assert.deepEqual(M.checkRange('', ''), { startSec: null, endSec: null, error: '' });
  assert.deepEqual(M.checkRange('95', ''), { startSec: 95, endSec: null, error: '' });
  assert.match(M.checkRange('1:20', '80').error, /1초 이상 뒤/);
  assert.match(M.checkRange('', '0').error, /1초 이상 뒤/);
  assert.match(M.checkRange('1:99', '').error, /1:20 또는 80/);
});

test('GA2-4 작업 줄 표시: 구간·속도, 없으면 빈 문자열', () => {
  assert.equal(M.jobOptionsLabel({ startSec: 40, endSec: 80, pace: 'fast' }), '0:40–1:20 · 빠름');
  assert.equal(M.jobOptionsLabel({ startSec: 95, endSec: null, pace: 'slow' }), '1:35–끝 · 느림');
  assert.equal(M.jobOptionsLabel({ startSec: null, endSec: 30, pace: 'normal' }), '0:00–0:30 · 보통');
  assert.equal(M.jobOptionsLabel({ pace: 'normal' }), '보통');
  assert.equal(M.jobOptionsLabel({}), '');
  assert.equal(M.jobOptionsLabel({ startSec: null, endSec: null, pace: 'turbo' }), '');
  assert.deepEqual(M.PACES, ['slow', 'normal', 'fast']);
});
