# CH-5 결과 — CHORDS 페이지 (코드 진행 모음 화면)

- 날짜: 2026-11-04 (mac)
- 입력: `결과/CH-1a_프레임.md` §2, `결과/CH-1b_설계.md` §3·§8·§9, `결과/CH-3_진행API.md` §2·§3, `결과/CH-4_진행영상분석.md` §2
- 상태: **완료** — build·npm test 349·e2e spa 63 / legacy 16(+47 skip)·로컬 서버 확인. PR #63 CI 전부 통과(Node 22·24·Kotlin·E2E spa·legacy·Docker, run 41839703127, head `401321f`)

## 1. 만든 것

| 영역 | 내용 |
| --- | --- |
| 메뉴 | `AppShell` CHORDS → `progressions.html`(활성). 라우트 `App.tsx`, SPA 목록 `Main.kt`·`server.js`에 `progressions.html` |
| 목록 | `GET /progressions`(scope 생략) 한 번 → 범위 토글 **레퍼런스(기본)·분석·합산**은 브라우저에서 거름. 개수 표시. `?scope=analysis|all`로 열기·토글 시 URL 갱신 |
| 행 | 제목·아티스트(또는 채널)·구간, `구분 · 키 · 출처(AI/직접) · 근거`, 코드 줄 + 로마숫자 줄. 버튼: **▶ 연습실에서 직접 연주해볼까요?**(`chords.html#prog?c=&k=&t=&from=`), 구간 반복(`practice.html?v=&t=시작초`, 영상 행만), 노트(`noteId` 있을 때) |
| 행 상세 | 클릭해 펼침: 코드 칩(심볼·roman·근거·시간 + 경고), 수집 경로·악기·구간·앨범·발매일·Mood/Genre/Tag·링크·메모, 수정·삭제 |
| 진행 넣기 | 탭 3개. **코드 진행 영상**(URL+메모 → `POST /progressions/analyze`, Gemini 키 없으면 안내+잠금+1분 발급 모달) · **직접 입력** · **붙여넣기**(코드 줄 → 반복 후보 → "이 진행으로 입력" → 직접 입력 폼에 코드·구간 이름 채움) |
| 직접 입력 폼 | 구분(레퍼런스/분석), 제목*·아티스트*(레퍼런스만 필수), 코드(칩 미리보기: roman·경고), 키(추정 1등 자동 → 드롭다운 "모름 / 추정 3개 / 전체 24개"), 로마숫자 자동 계산, 접이식 "더 적기"(구간·앨범·Mood·Genre·Tag·발매일·링크·메모) |
| 저장 직후 | "방금 넣은 진행, 연습실에서 바로 연주해볼까요? [연주하기]" 배너 |
| 수정 | 같은 폼. 바뀐 필드만 PATCH(안 바뀌면 "바뀐 내용이 없습니다", 요청 안 함). AI 행에서 코드·키를 바꾸면 "출처가 직접으로 바뀝니다" 확인. 영상·노트에서 온 행은 레퍼런스 버튼 잠금 |
| 삭제 | 확인 후 `DELETE`. 노트에서 온 행은 "노트·토글은 그대로" 안내 |
| 영상 작업 | `/notes/jobs` 중 `kind=progression`만 목록 맨 위 줄로: 대기 중/분석 중 → 완료 시 목록 다시 읽고 "N개 수집 · 노트 보기" / 0개면 "진행을 찾지 못했습니다 · 노트 보기" / 실패·키 오류. 5초 폴링 |
| 읽는 법 안내 | 직접 입력·붙여넣기 탭 위 접이식(`ReadingGuide.tsx`) |
| 노트 상세 토글 | "코드 진행 수집에 넣기" 체크박스 → `PUT /notes/{id}/collect`. 켜면 "진행 N개를 모았어요" + "CHORDS에서 보기 (N개) →"(`progressions.html?scope=analysis`), 0개면 "이 노트에는 화성 진행이 없습니다". 끌 때 그 노트 행 수·고친 행(origin=manual) 수로 확인("고친 진행 N개도 같이 빠집니다") |
| 비로그인 | 기본 시드 10개(레퍼런스 5·분석 5, 키 표기 `A Minor`→`A min` 정규화·roman 계산), 연습실 링크는 됨, 수정 없음, 진행 넣기는 로그인 안내 |
| 취향 코드 진행 | 오른쪽(좁으면 아래) 자리만 — `TODO(stub): CH-6` |
| 같은 음 도수 | `symbol.mts`에 **`duplicatePitches(chord)`** export 추가(결정 기록 2026-11-04). 칩 경고 "도수 표기는 중복이지만 연주 음은 겹칩니다 (b5 = #11)" |

## 2. 파일

- 새: `frontend/src/pages/ProgressionsPage.tsx`·`.module.css`, `frontend/src/components/progressions/`(`model.mts` 순수 함수, `ProgressionEditor.tsx`, `ProgressionRow.tsx`, `PastePanel.tsx`, `VideoAnalyzeForm.tsx`, `ReadingGuide.tsx`, `Progressions.module.css`), `test/ch5_progressions.test.js`, `test/e2e/progressions.spec.js`
- 고침: `App.tsx`, `AppShell.tsx`, `apiClient.ts`, `NoteDetailPage.tsx`(+`.module.css` 스타일), `Main.kt`·`server.js`(SPA 목록), `frontend/src/lib/chords/symbol.mts`(`duplicatePitches`)
- §9 목록 밖(직접 결과): `test/rz3_spa.test.js`(진입 경로 9개), `test/e2e/layout.spec.js`(가로 스크롤 검사에 `progressions.html`)

## 3. 다음 step이 쓸 값

- **CH-5b(연습실)**: 진행 → 연습실 링크 = `model.mts`의 `playHref(p)` → `chords.html#prog?c=<심볼 ,구분>&k=<키>&t=<제목>&from=<진행 id>`(URLSearchParams 인코딩: `,`→`%2C`, 공백→`+`). 시드 행은 `from=ref-seed-1` 같은 시드 id. **돌아오기**: `progressions.html#p-<id>`(UUID)로 열면 그 행을 펼치고 가운데로 스크롤(`?id=<id>`도 됨). 범위가 맞아야 보이므로 돌아오기 링크에 `?scope=all`을 붙이는 것을 권함(`progressions.html?scope=all#p-<id>`)
- **CH-6(취향·홈)**: 페이지 `#progTaste` aside에 붙임. 목록은 페이지 `items`(로그인) / `SEEDS`(비로그인) 그대로 쓰면 됨. 시드 변환 `seedToDto`
- apiClient: `apiClient.progressions.{list(scope?), create, update, remove, analyze}`, `apiClient.notes.setCollect(noteId, collect)`, 타입 `ProgressionDto`·`ProgressionChordDto`·`ProgressionInput`·`ProgressionScope`·`NoteCollectResult`, `AnalysisJobDto.kind`, `NoteSummaryDto.collectProgressions`

## 4. 정한 것 (설계에 없음)

| 항목 | 결정 | 이유 |
| --- | --- | --- |
| 코드 입력 나누기 | 공백·`|`·`,`·`→`·단독 `-`, 하이픈 붙여쓰기는 조각이 모두 코드일 때만 나눔(`C-7`은 마이너). 못 읽는 토큰도 **남겨 저장**(칩 빨간 테두리 + "로마숫자·연습실에서 빠집니다") | 설계 §2-1 "입력 표기 그대로 저장, 파싱은 화면" |
| 로마숫자 수정 | 칸별 직접 수정은 안 함. 자동 계산 + 수정 시 같은 자리·같은 심볼·같은 키면 원래 roman 유지 + "로마숫자 다시 계산" 버튼 | 범위를 줄임. AI roman(`V7/ii` 등)을 화면이 덮어쓰지 않게 |
| AI 행 timestamp | 수정 때 같은 자리·같은 심볼이면 `timestamp` 유지해서 보냄 | 서버가 코드 비교에 timestamp를 포함(CH-3 §3) → 안 보내면 메모만 고쳐도 직접 전환 |
| 아티스트 필수 | 레퍼런스만 필수(화면 규칙), 분석은 선택 | 프레임 "곡·아티스트(필수)"는 레퍼런스 기준 |
| 노트 화면 작업 목록 | **그대로**(진행 작업도 태그 `화성` 작업으로 보이고 "노트 보기"로 이어짐) | 결과가 일반 노트라 문제없음, §9 목록 밖 파일을 안 건드림 |
| 영상 요청 후 범위 | 레퍼런스 범위였으면 분석으로 바꿈 | 결과 행이 분석이라 바로 보이게 |
| 저장 후 범위 | 저장한 구분과 다른 범위면 그 구분으로 바꿈 | 저장한 행이 안 보이는 혼란 방지 |
| 시드 키 | `A Minor`→`A min`, `F Dominant`→키 없음(roman 빈칸) | 키 24개(`KEYS`) 표기만 roman 계산 |

## 5. 실행 결과 (로컬, mac)

```
npm run build                          ✓ built (tsc --noEmit 통과)
node --test test/ch5_progressions.test.js   tests 20 pass 20
npm test                               tests 349 pass 349 fail 0
ULP_UI=spa npx playwright test         63 passed (progressions.spec 11 포함)
ULP_UI=legacy npx playwright test      16 passed, 47 skipped
./gradlew test                         219 tests, failures 0 (Main.kt SPA 목록 변경)
```

- e2e `progressions.spec.js` 11개: P1 비로그인(메뉴 활성·시드 범위 토글 5/5/10·로그인 안내) · P2 직접 입력(칩 5·H7 오류 칩·키 추정 C Major·roman `I - vi - IV - V7 - ?` → **빈 제목은 요청 안 보냄** → 저장·POST 본문·연주 배너 링크) · P3 수정(메모만 PATCH `{memo}`, 코드 변경 시 확인·timestamp 유지·직접 전환, 영상 행 레퍼런스 잠금, 삭제) · P4 붙여넣기(가사 줄 건너뜀, `Chorus: 4코드 ×3` → 폼) · P5 영상(**유튜브 아닌 URL 거절**, 요청 본문, kind=note 작업 숨김, 대기 → "2개 수집 · 노트 보기") · P6 키 없음 잠금 · P7 노트 토글(켜기 2개·링크, 끄기 취소/확인 "고친 진행 1개") · P8 4폭(1280·1150·768·390) 가로 스크롤 0 + 스크린샷
- 스크린샷 확인: 1280·1150은 목록 + 오른쪽 취향 칸 2단, 768·390은 세로 쌓임. 버튼·칩 줄바꿈 정상. 경로 `test-results/progressions-P8-*/progressions-<폭>.png`(gitignore — 다시 보려면 P8 재실행)
- **로컬 서버(로컬 DB)**: postgres 컨테이너(55433) + `env -u` 원격 변수 + `DATABASE_URL` 로컬 + `PUBLIC_DIR`=public 사본 + `dist/index.html`→`spa.html`(Dockerfile과 같은 배치)로 `./gradlew run`(3099):
  - `GET /progressions.html` 200 + `id="root"`(SPA), `/chords.html` SPA 그대로, `/progression.html`(오타) 404
  - `GET /api/v1/progressions`·`PUT /api/v1/notes/{id}/collect` 무토큰 401 `UNAUTHORIZED`
  - 로컬 DB Flyway 최대 버전 3(원격 미적용). 끝나고 컨테이너 삭제
  - 토큰이 있는 API 응답 모양은 CH-3·CH-4에서 curl로 확인한 것과 같은 필드를 화면이 씀(e2e 가짜 저장소도 그 모양)

## 6. 남은 것·제안

- 실제 Gemini 키로 영상 1개 → 화면에 행이 생기는지는 CH-8 통합 때(CH-4 §5와 같이)
- 제안(범위 밖): 목록 검색·정렬(곡명·키)
