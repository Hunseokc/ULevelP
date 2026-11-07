# GA-1 결과 — Gemini 실패 원인 표시

- 날짜: 2026-11-05 (win)
- 입력: `진행_분석설정.md` §3-1
- 상태: **완료** — 로컬 테스트 통과, PR #65 CI 전부 통과(§3)
- 스키마·API 모양 변경 없음(`analysis_jobs.error` 문자열 앞에 코드만 붙임)

## 1. 바꾼 것

| 파일 | 내용 |
| --- | --- |
| `src/main/kotlin/ulevelp/note/GeminiClient.kt` | 402 → `GEMINI_BILLING`(재시도 없음), 429 → `GEMINI_RATE_LIMIT`, 500·503 → `GEMINI_OVERLOADED`(둘 다 기존 4회 재시도 뒤), 그 밖·네트워크 → `GEMINI_API_ERROR`. 문장 형식 `<코드>: 문장 (HTTP n). — Google error.message(200자)`. 키 오류(`PROVIDER_KEY_INVALID:`)는 그대로. 코드 상수 `HttpGeminiClient.CODE_*` |
| `frontend/src/lib/jobError.mts` (새) | `describeJobError(error) → { code, title, hint, detail }`, `isKeyInvalidError(error)`. 모르는 코드·코드 없는 문장은 `UNKNOWN` + 문장 그대로 안내 |
| `frontend/src/pages/ProgressionsPage.tsx` · `.module.css` | 실패 줄: `제목 · youtu.be/…` + 안내 줄(`.jobHint`, `data-error-code`), 원문은 제목 `title` |
| `frontend/src/pages/NotesPage.tsx` · `.module.css` | 작업 배지: 원인 제목(예 `크레딧 부족`), 아래 안내 줄(`.runHint`). 키 오류 판별을 `isKeyInvalidError`로 |
| `src/test/kotlin/ulevelp/note/GeminiClientErrorTest.kt` (새) | 가짜 Gemini 서버로 402(1회)·429(4회)·503(4회)·500 본문 비JSON·400 일반·401 — 6개 |
| `test/ga1_job_error.test.js` (새) | GA1-1~4: 코드별 문구, 코드 없는 문장, 잘못된 입력(null·빈 값·숫자·객체·모르는 코드), 키 오류 판별 |
| `test/e2e/progressions.spec.js` | `fakeStore(initial, { failWith })` + P5b: 402 실패 → "크레딧 부족"·"AI Studio에서 결제"·`data-error-code=GEMINI_BILLING`, "분석 실패" 없음 |

화면 문구(제목 / 안내)는 `진행_분석설정.md` §3-1 표와 같다.

## 2. 로컬 실행 결과 (win, 브랜치 `fix/gemini-analysis-options`)

```
./gradlew test                         BUILD SUCCESSFUL — tests=225 skipped=0 failures=0 errors=0 (기존 219 + GA-1 6)
npm test                               tests 387 · pass 385 · fail 2 (아래 — win 줄바꿈, GA-1과 무관)
npm run build                          ✓ built
ULP_UI=spa npx playwright test         75 passed (1.6m) — P5b 포함
```

- `npm test` 실패 2개: `CH-2c-1-1 원본 재현`, `CH-2c-3-2 저장본 일치`. 원인: win `core.autocrlf=true`로 `chordForms.json`·`정석폼_검토목록.csv` 작업 사본이 CRLF(`git ls-files --eol` → `i/lf w/crlf`)인데 테스트는 LF 문자열과 비교. 저장소(LF)·CI(Linux)는 영향 없음. 해결 제안: `.gitattributes`에 두 파일 `eol=lf` (범위 밖 — 제안만)

## 3. PR·CI

- PR #65 (Draft) `fix/gemini-analysis-options` → `main`, head `9037bce`
- CI run 41948536298 전부 통과 — Node 22·24·Kotlin(JDK 21)·E2E spa·legacy·Docker build & smoke

## 4. GA-2에 넘길 것

- 작업 실패 줄에 구간·속도 표시를 붙일 자리: `ProgressionsPage.tsx` `jobLine`(진행·실패 줄 모두)
- `GeminiClient.generateNoteAnalysis`는 아직 인자 그대로 — GA-2에서 `videoOptions` 추가
