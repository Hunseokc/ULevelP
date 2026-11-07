// GA-1: 분석 작업 실패 문자열 → 화면 문구(frontend/src/lib/jobError.mts). 규칙: 개발산출물/완료/진행_분석설정.md §3-1
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let J;
before(async () => {
  J = await import('../frontend/src/lib/jobError.mts');
});

test('GA1-1 서버 코드별 제목·안내·원문', () => {
  const v = J.describeJobError('GEMINI_BILLING: Gemini 크레딧이 부족합니다 (HTTP 402). — Your prepayment credits are depleted.');
  assert.equal(v.code, 'GEMINI_BILLING');
  assert.equal(v.title, '크레딧 부족');
  assert.match(v.hint, /AI Studio/);
  assert.equal(v.detail, 'Gemini 크레딧이 부족합니다 (HTTP 402). — Your prepayment credits are depleted.');

  assert.equal(J.describeJobError('GEMINI_RATE_LIMIT: x').title, '호출 한도 초과');
  assert.equal(J.describeJobError('GEMINI_OVERLOADED: x').title, 'Gemini 일시 장애');
  assert.equal(J.describeJobError('GEMINI_API_ERROR: x — Video is private').code, 'GEMINI_API_ERROR');
  assert.equal(J.describeJobError('PROVIDER_KEY_INVALID: API 키가 잘못되었습니다.').title, 'Gemini 키 오류');
});

test('GA1-2 코드 없는 문장은 그대로 안내로', () => {
  const v = J.describeJobError('분석 제한 시간(54분)을 초과하여 중단되었습니다.');
  assert.equal(v.code, 'UNKNOWN');
  assert.equal(v.title, '분석 실패');
  assert.equal(v.hint, '분석 제한 시간(54분)을 초과하여 중단되었습니다.');
});

test('GA1-3 잘못된 입력: 빈 값·null·숫자·모르는 코드', () => {
  for (const bad of [null, undefined, '', '   ', 42, {}]) {
    const v = J.describeJobError(bad);
    assert.equal(v.code, 'UNKNOWN');
    assert.equal(v.title, '분석 실패');
    assert.ok(v.hint.length > 0);
  }
  const unknown = J.describeJobError('SOMETHING_NEW: 처음 보는 오류');
  assert.equal(unknown.code, 'UNKNOWN');
  assert.equal(unknown.hint, 'SOMETHING_NEW: 처음 보는 오류');
});

test('GA1-4 키 오류 판별', () => {
  assert.equal(J.isKeyInvalidError('PROVIDER_KEY_INVALID: x'), true);
  assert.equal(J.isKeyInvalidError('GEMINI_BILLING: x'), false);
  assert.equal(J.isKeyInvalidError(null), false);
});
