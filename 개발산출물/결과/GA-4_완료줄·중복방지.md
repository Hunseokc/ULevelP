# GA-4 결과 — CHORDS 완료 줄 합치기 · 분석 요청 중복 방지

- 날짜: 2026-11-05 (win)
- 입력: `결과/GA-3_실영상확인.md` §4·§5, 진행 파일 GA-4 행
- 설계 승인: 2026-11-05 사용자 "그렇게 진행"(중복 기간 24시간 포함)
- 상태: **완료** — 로컬 테스트 + PR #66 CI 전부 통과(Node 22·24·Kotlin JDK 21·E2E spa·legacy·Docker smoke, run 41956183452, head `59b65f9`). 운영 반영은 머지·배포 뒤(GA-5)

## 1. 바뀐 동작

### ① 완료 줄 합치기 (화면)
- 끝난(done) 작업은 `#progJobs`에 **한 줄**(`li[data-status="done"]`, `data-done-count=k`)
  - 1건: `n개 수집 · 노트 보기` (기존 문구 그대로)
  - 2건 이상: `영상 k개 · n개 수집 · 최근 노트 보기` (n = 끝난 작업 노트들에서 온 진행 수 합, 링크 = 가장 최근 완료 작업의 노트)
  - 진행 0개: `진행을 찾지 못했습니다 · 노트 보기`(앞에 `영상 k개 · `)
- 대기·분석 중·실패 줄은 지금처럼 작업마다 한 줄(실패 원인·안내 표시)
- 순수 함수 `summarizeDoneJobs(jobs, items) → { jobCount, collected, latestNoteId }` (`model.mts`)

### ② 중복 요청 방지
| 틈 (GA-3 §4) | 막는 곳 | 동작 |
| --- | --- | --- |
| 같은 순간 두 번 클릭 | 화면 `VideoAnalyzeForm` | `useRef` 잠금 — state 반영 전 두 번째 submit 무시 |
| 분석 중 다시 누름 | 화면 | 진행 중인 작업이 있으면 버튼 잠금 + `분석 중…`(페이지가 `busy` 넘김) |
| 끝난 뒤 같은 영상·설정 재요청 | 서버 `NoteService.requestAnalyze` | 24시간 안 같은 사용자·영상·구간·속도의 queued·running·done 작업이 있으면 **409 `DUPLICATE_ANALYSIS`**. 프로필 행 `FOR UPDATE` 안에서 확인(동시 요청도 막음), 동시 1건(429)보다 먼저 |
| 일부러 다시 분석 | 화면 + API | 409를 받으면 안내 + 버튼 `다시 분석` → 한 번 더 누르면 `force: true`. 입력(링크·구간·속도)을 바꾸면 처음 상태 |

- 실패한 작업은 중복으로 보지 않음(바로 재시도 가능). 24시간 지난 작업도 중복 아님
- 메모는 비교하지 않음(설계대로 영상·구간·속도만)
- 노트 분석(`/notes/analyze`)은 중복 확인 없음(범위 밖, 회귀 테스트로 확인)

## 2. API·시그니처 변경 (승인됨)

- `POST /api/v1/progressions/analyze` 선택 필드 `force`(boolean, 기본 false). boolean 아니면 400 `INVALID_INPUT`
- 새 응답: 409 `DUPLICATE_ANALYSIS` "이미 같은 영상·구간·속도로 분석했어요. 다시 분석하려면 한 번 더 눌러 주세요."
- `NoteService.requestAnalyze(..., force: Boolean = false)`, 상수 `NoteService.DUPLICATE_WINDOW = 24h`
- `apiClient.progressions.analyze({ ..., force? })` — `true`일 때만 본문에 넣음
- DB 스키마 변경 없음

## 3. 바뀐 파일

- `src/main/kotlin/ulevelp/service/NoteService.kt`, `src/main/kotlin/ulevelp/routes/ProgressionRoutes.kt`
- `src/test/kotlin/ulevelp/note/NoteApiTest.kt` — `n20_progressionAnalyze_duplicateBlocked_forceAllows`
- `frontend/src/components/progressions/model.mts`, `VideoAnalyzeForm.tsx`, `frontend/src/pages/ProgressionsPage.tsx`, `frontend/src/lib/apiClient.ts`
- `test/ch5_progressions.test.js` — GA-4 3개, `test/e2e/progressions.spec.js` — 가짜 저장소 작업 여러 건·409 지원 + P5d

## 4. 검증 (win, 실제 실행)

```
./gradlew test                         BUILD SUCCESSFUL — 228 tests (GA-3 227 + n20)
  n20: 대기 중 같은 요청(주소 형식만 다름) 409 · 완료 뒤 409 · force:false 409 · force:"yes" 400
       · force:true 202 · 속도/끝 시간/구간 다르면 202 · 실패 뒤 202 · 25시간 전 완료 뒤 202 · 노트 분석 2회 202
node --test test/ch5_progressions.test.js   23 pass
npm test                               394 중 392 pass — 실패 2개는 CH-2c-1-1·CH-2c-3-2(win CRLF, 진행 파일 §5 기존 문제)
npm run build                          성공
ULP_UI=spa npx playwright test test/e2e/progressions.spec.js   20 passed (P5d 포함)
  P5d: dblclick → POST 1건, 분석 중 `분석 중…` 잠김, 같은 설정 409 → `다시 분석`, 속도 바꾸면 `분석 요청`으로 복귀,
       force:true 본문, 두 번째 완료 뒤에도 #progJobs li 1개 "영상 2개 · 4개 수집", 링크 = 최근 노트(n3)
```

## 5. 다음

- 머지 → 배포 뒤 운영에서 같은 영상 두 번 요청 → 409 안내·`다시 분석` 확인(별도 step 없이 쓰면서 확인 가능)
- 진행 파일 GA 단계는 GA-4로 끝. 남은 항목: 구간 타임스탬프 기준(GA-3 §3, 쓰면서 확인)
