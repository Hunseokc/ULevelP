# GA-2 결과 — 코드 진행 영상 구간 + 코드 진행 변화 속도 (V4)

- 날짜: 2026-11-05 (win)
- 입력: `진행_분석설정.md` §3-2, `결과/GA-1_실패원인.md`
- 상태: **완료** — 로컬 테스트 통과, PR #65 CI 전부 통과(§3)
- 스키마·API는 §3-2 승인 설계 그대로. 차이 하나: `endSec`만 있고 `startSec`이 없을 때 `endSec = 0`도 400(시작을 0으로 보고 "1초 이상" 적용)

## 1. 바꾼 것

| 파일 | 내용 |
| --- | --- |
| `src/main/resources/db/migration/V4__analysis_job_options.sql` (새) | `analysis_jobs.start_sec`·`end_sec`(0~86400)·`pace`(slow·normal·fast), `analysis_jobs_range_chk`(start < end). 모두 NULL 허용 |
| `src/main/kotlin/ulevelp/db/Tables.kt` | `AnalysisJobsTable.startSec`·`endSec`·`pace` (nullable) |
| `src/main/kotlin/ulevelp/note/GeminiClient.kt` | `data class GeminiVideoOptions(fps, startSec, endSec)`(모두 nullable). `generateNoteAnalysis(..., videoOptions: GeminiVideoOptions? = null)` — `video_metadata.fps = videoOptions?.fps ?: GEMINI_FRAME_FPS`, 구간이 있으면 `start_offset`·`end_offset` = `"40s"` |
| `src/main/kotlin/ulevelp/service/NoteService.kt` | `AnalysisJobOptions(startSec, endSec, pace="normal")`, `PACE_FPS = slow 0.5 · normal 1.0 · fast 3.0`. `requestAnalyze(..., options: AnalysisJobOptions? = null)`이 행에 저장. `executeJob`: `kind=progression`이면 `GeminiVideoOptions(PACE_FPS[pace ?: normal], startSec, endSec)`, 노트는 `null`. `AnalysisJobDto`에 `startSec`·`endSec`·`pace` (nullable) |
| `src/main/kotlin/ulevelp/routes/ProgressionRoutes.kt` | `parseAnalyzeOptions(body)`: 정수 초 0~86400(`requireInt` — 문자열·소수 400), `endSec > (startSec ?: 0)`, `pace` ∈ slow·normal·fast(없으면 normal). 노트 분석 라우트는 그대로(필드 무시) |
| `frontend/src/components/progressions/model.mts` | `parseTimeInput`(`80`·`1:20`·`1:02:03` → 초, 빈 칸 null, 틀리면 undefined), `checkRange(start, end)` → `{ startSec, endSec, error }`, `jobOptionsLabel(job)` → `0:40–1:20 · 빠름`, `PACES`·`PACE_LABEL` |
| `frontend/src/lib/apiClient.ts` | `progressions.analyze({ url, memo, startSec?, endSec?, pace? })` — 숫자일 때만 본문에 넣음. `AnalysisJobDto.startSec`·`endSec`·`pace` |
| `frontend/src/components/progressions/VideoAnalyzeForm.tsx` | 시작·끝 입력(`#progVideoStart`·`#progVideoEnd`, 2칸 grid), `코드 진행 변화` 3단 버튼(`#progVideoPace [data-pace]`, 기존 `.segment` 스타일, 기본 보통) + 안내 문구(§3-2 그대로). 잘못된 구간은 요청 전에 막고 `#progVideoMsg`에 문구. 항상 `pace`를 보냄 |
| `frontend/src/pages/ProgressionsPage.tsx` | `jobLine`: `youtu.be/… · 0:40–1:20 · 빠름` (진행·실패 줄 모두) |
| `docs/03-api-spec.md` | 8.5 `/progressions/analyze` 선택 필드·검증·fps, 8.2 `AnalysisJobDto` 13개 필드 |
| 테스트 | `NoteApiTest.n19`(400 7종 + 정상 3종 + 노트 회귀), `GeminiClientErrorTest.ga2_videoMetadata_fpsAndOffsets`(요청 본문), `DatabaseMigrationAndIntegrityTest`(target 4), `FakeGeminiClient.videoOptionsCalls`, `test/ga2_range_pace.test.js`(GA2-1~4), `test/e2e/progressions.spec.js` P5c + P5 본문에 `pace: 'normal'` |

## 2. 로컬 실행 결과 (win, 브랜치 `fix/gemini-analysis-options`)

```
./gradlew test                         BUILD SUCCESSFUL — tests=227 skipped=0 failures=0 errors=0 (GA-1 225 + GA-2 2)
npm test                               tests 391 · pass 389 · fail 2 (CH-2c-1-1·CH-2c-3-2 — win CRLF, GA-1 결과 §2와 같음)
npm run build                          ✓ built (tsc --noEmit 통과)
ULP_UI=spa npx playwright test         75 passed · 1 failed (2.1m) — P5c 포함. 실패는 player-category P4b-2 `page.goto` 30초 시간 초과(GA-2와 무관한 화면)
  재실행 player-category + progressions  25 passed (34.6s) → 일시적 실패
```

- n19 400 입력: `startSec=endSec=80`, `startSec=-1`, `endSec=86401`, `startSec="80"`, `startSec=1.5`, `pace="turbo"`, `endSec=0` → 모두 `400 INVALID_INPUT`, 디스패치 0건
- n19 정상: `40~80 fast` → DTO 그대로 + Gemini `fps 3, 40, 80` / 필드 없음 → DTO `pace=normal`·구간 null + `fps 1` / `startSec 95 slow` → `fps 0.5, 95` / 노트 분석에 같은 필드 → 무시, 옵션 `null`
- 요청 본문: 옵션 없음 `{"fps":0.2}`, `{"fps":3.0,"start_offset":"40s","end_offset":"80s"}`, `{"fps":1.0}`

## 3. PR·CI

- PR #65 `fix/gemini-analysis-options` → `main`, head `3117b85` — CI run 41950675408 전부 통과(Node 22·24·Kotlin JDK 21·E2E spa·legacy·Docker build & smoke)
- GA-2로 코드는 끝 → 머지 가능한 상태. PR은 아직 Draft(자동 모드에서 `gh pr ready`가 거부됨 — 사용자가 Ready로 바꾼 뒤 머지). 배포·실영상 확인은 GA-3

## 4. GA-3에 넘길 것

- 운영 배포 뒤 Flyway 로그에 `Migrating schema "public" to version "4 - analysis job options"` 확인
- 같은 영상(`youtu.be/oWQZopUx0fA`)으로 ① 보통(구간 없음) ② 빠름 ③ 구간 지정(예 0:40–1:20, 보통) → 4마디 4코드가 잡히는지
- 구간 지정 시 응답 `start`·`end`·코드 `timestamp`가 **원본 기준인지 구간 기준인지** 확인(구간 기준이면 진행 행 `startSec`이 어긋남 → 서버에서 `startSec` 더하기 필요할 수 있음 — 그때 판단)
- 토큰 사용량: `executeJob`이 Gemini 성공 직후 한 줄 INFO 로그를 남긴다(GA-2 추가, 사용자 요청) —
  `Gemini 분석 완료 jobId=… kind=progression pace=fast range=40~80 fps=3.0 usage={…usageMetadata…}`(노트 분석은 `pace=- range=-~- fps=default`).
  GA-3에서 Cloud Run Job 로그를 `textPayload:"Gemini 분석 완료"`로 찾아 `promptTokenCount`를 §3-2 추정치와 비교
- 기존(V4 이전) progression 작업 행은 `pace = NULL` → 실행 시 normal(fps 1)로 처리(남은 queued 행이 있을 때만 해당)
