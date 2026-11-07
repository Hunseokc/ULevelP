-- analysis_jobs: 코드 진행 영상 분석 옵션 (개발산출물/진행_분석설정.md §3-2, GA-2)
-- 모두 NULL 허용. NULL이면 기존 동작(노트 분석·기존 행 영향 없음)
ALTER TABLE analysis_jobs
  ADD COLUMN start_sec INTEGER CHECK (start_sec BETWEEN 0 AND 86400),   -- 분석 구간 시작(초)
  ADD COLUMN end_sec   INTEGER CHECK (end_sec BETWEEN 0 AND 86400),     -- 분석 구간 끝(초)
  ADD COLUMN pace      TEXT CHECK (pace IN ('slow', 'normal', 'fast')), -- 코드 진행 변화 속도 → 초당 캡처량
  ADD CONSTRAINT analysis_jobs_range_chk CHECK (start_sec IS NULL OR end_sec IS NULL OR start_sec < end_sec);
