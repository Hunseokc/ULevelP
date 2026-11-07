// GA-1: 분석 작업 실패 문자열(`analysis_jobs.error`) → 화면 문구. 서버 규칙은 `개발산출물/진행_분석설정.md` §3-1
// 서버는 `<코드>: 문장 (HTTP n). — Google 문구` 형식으로 저장한다. 코드가 없으면 문장을 그대로 보여 준다.

export type JobErrorCode =
  | 'GEMINI_BILLING'
  | 'GEMINI_RATE_LIMIT'
  | 'GEMINI_OVERLOADED'
  | 'PROVIDER_KEY_INVALID'
  | 'GEMINI_API_ERROR'
  | 'UNKNOWN';

export interface JobErrorView {
  code: JobErrorCode;
  /** 짧은 원인(배지·줄 앞) */
  title: string;
  /** 다음 행동 안내 */
  hint: string;
  /** 서버 원문(코드 접두 제외) — title 속성 등 */
  detail: string;
}

const KNOWN: Record<Exclude<JobErrorCode, 'UNKNOWN'>, { title: string; hint: string }> = {
  GEMINI_BILLING: {
    title: '크레딧 부족',
    hint: 'Gemini 크레딧이 부족해요. AI Studio에서 결제·크레딧을 확인한 뒤 다시 시도해 주세요.',
  },
  GEMINI_RATE_LIMIT: {
    title: '호출 한도 초과',
    hint: '잠시 뒤 다시 시도해 주세요. 무료 등급 키라면 짧은 영상이나 구간으로 나눠 보세요.',
  },
  GEMINI_OVERLOADED: {
    title: 'Gemini 일시 장애',
    hint: 'Google 쪽 서버가 붐벼 응답하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
  },
  PROVIDER_KEY_INVALID: {
    title: 'Gemini 키 오류',
    hint: '키가 유효하지 않거나 거부됐어요. 설정에서 Gemini 키를 확인해 주세요.',
  },
  GEMINI_API_ERROR: {
    title: '분석 실패',
    hint: '영상이 비공개·삭제됐거나 Gemini가 요청을 거절했어요.',
  },
};

const PREFIX = /^([A-Z][A-Z_]+):\s*/;

export function describeJobError(error: unknown): JobErrorView {
  const raw = typeof error === 'string' ? error.trim() : '';
  const m = PREFIX.exec(raw);
  const code = m && m[1] in KNOWN ? (m[1] as Exclude<JobErrorCode, 'UNKNOWN'>) : null;
  if (code) {
    return { code, ...KNOWN[code], detail: raw.slice(m![0].length) };
  }
  return {
    code: 'UNKNOWN',
    title: '분석 실패',
    hint: raw || '원인을 알 수 없어요. 잠시 뒤 다시 시도해 주세요.',
    detail: raw,
  };
}

export function isKeyInvalidError(error: unknown): boolean {
  return describeJobError(error).code === 'PROVIDER_KEY_INVALID';
}
