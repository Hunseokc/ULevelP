# R1 — GitHub Pages 처리 결정 문서

- **작성일:** 2026-11-03 (`RZ-M-0`)
- **결정할 것:** `결과/RZ-3-0_명세검토.md` §3-3 R1 — 운영에 UI가 두 벌(Cloud Run=React, Pages=레거시) 있는 상태를 어떻게 끝낼지
- **상태:** **결정 — A안** (2026-11-03 사용자). 결정 내용은 §6

## 1. 지금 Pages가 실제로 하는 일 (코드·실측 근거)

| # | 사실 | 근거 |
| --- | --- | --- |
| F1 | Pages는 main CI 통과 후 `public/` 폴더를 그대로 올린다. 레거시 HTML·JS만 있고 React 빌드(`dist/`)는 올리지 않는다 | `.github/workflows/ci.yml:155-182` (`path: public` `:180`) |
| F2 | **Pages에는 `/api`가 없다.** `config.js`의 `apiBaseUrl`이 `''`라 API 호출이 `https://hunseokc.github.io/api/...`로 가고 404. 처음 만든 커밋(`4b6ffc3`)부터 계속 `''` | `public/config.js:10`, `public/auth.js:8,170`, `public/data.js:114-115`, `ci.yml:177` 주석 "/api 는 Pages 에서 제공되지 않음". 실측 `curl https://hunseokc.github.io/api/v1/songs` → **404** |
| F3 | `apiBaseUrl`만 Cloud Run으로 바꿔도 안 된다. Pages HTML의 CSP `connect-src`가 `'self'`·Supabase·googleapis뿐이다 | `public/index.html:5` |
| F4 | 따라서 Pages에서 되는 것은 **비로그인(기기 저장) 기능뿐**이다. 로그인해도 곡 저장·녹음 업로드·노션·Gemini는 서버에 닿지 않는다 | F2·F3 |
| F5 | 노션 `연습 곡` 행의 **`이어서 연습` 링크는 Pages로 간다.** 서버가 `PUBLIC_APP_URL`(기본·운영 값 모두 Pages) + `practice.html?v=&t=…`로 만들고, 노션 push 때마다 그 행의 링크를 다시 쓴다 | `Main.kt:71`, `service/SongService.kt:476-484`, `notion/NotionPushWorker.kt:370`, `deploy-cloudrun.yml:43`. 운영 env `PUBLIC_APP_URL=https://hunseokc.github.io/ULevelP/`(2026-11-03 `gcloud run services describe`) |
| F6 | → **지금 로그인 사용자가 노션에서 `이어서 연습`을 누르면 서버 동기화가 안 되는 화면(F4)에 떨어진다.** R1을 미루면 이 상태가 계속된다 | F4 + F5 |
| F7 | Cloud Run은 iframe 임베드를 막는다(`X-Frame-Options: DENY` 전 응답, HTML에 `frame-ancestors 'none'`). 요구사항 NFR-SEC-1이 이를 요구한다 | `Main.kt:289`, `Main.kt:385`, `docs/02-requirements.md:140` |
| F8 | Pages는 응답 헤더를 못 정한다 → 임베드가 되는 유일한 곳. `ci.yml` 주석도 "노션 임베드·아이패드 웹뷰"를 Pages 사용처로 적었다. 레거시 `auth.js`는 iframe 안에서 로그인을 새 창으로 연다 | `ci.yml:170-171`, `public/auth.js:32-34,113-115,217-219`, `docs/01-project-plan.md:27` |
| F9 | **공식 노션 템플릿에는 임베드 블록이 없다.** 콜아웃·DB 3개(`연습 곡`·`연습 기록`·`학습 영상 노트`)·설정 안내뿐이고 앱으로 가는 길은 `이어서 연습` 링크다. (요구사항 FR-NX-1은 "플레이어 임베드가 포함된 템플릿"이라고 적었지만 실제 템플릿과 다르다) | 템플릿 `4097a337…` Notion fetch(최종 편집 2026-10-30), `docs/02-requirements.md:83` |
| F10 | React 빌드는 Pages 하위 경로(`/ULevelP/`)에서 그대로 못 돈다: `base` 미지정(절대 `/assets/…`), `/config.js` 절대 경로, `BrowserRouter`에 `basename` 없음 + 라우트가 `/practice.html` 등 루트 기준 | `vite.config.ts:5-15`, `frontend/index.html:13`, `frontend/src/App.tsx:26-36` |
| F11 | 레거시와 React를 같이 고쳐야 하는 비용은 이미 발생했다(R3-1이 `public/*.js`와 `frontend/src`를 둘 다 수정). Cloud Run 롤백 스위치(`ULP_UI=legacy`)도 `public/*.html`에 기대고 있어 레거시는 당분간 지울 수 없다 | `결과/RZ-3-0_명세검토.md` §3-3 R1, `Main.kt` SPA 서빙(RN-D11) |

## 2. 선택지

### A. Pages 폐지 → Cloud Run 일원화 (Pages는 이동 안내만 남김)
- **할 일:** ① `PUBLIC_APP_URL`을 Cloud Run URL로(코드 변경 없음, `deploy-cloudrun.sh`·Variables 값만) → 노션 push 되는 행부터 링크가 Cloud Run으로 바뀐다(F5) ② Pages `public/*.html` 대신 **이동 페이지**를 올린다: 같은 파일명 8개 + 외부 `redirect.js`(쿼리·해시를 그대로 붙여 `location.replace`, CSP `script-src 'self'` 안에서 가능). 아직 push 안 된 옛 노션 링크도 살아난다 ③ 롤백 기간이 끝나면 `ALLOWED_ORIGINS`에서 `github.io` 제거, 레거시 `public/*.js` 정리(별도 결정)
- **좋은 점:** UI 한 벌·출처 한 곳(CORS preflight 없음, `docs/01-project-plan.md:124` KC-D3), 보안 헤더 유지(F7), F6 문제가 ①만으로 바로 풀림. 공식 템플릿은 임베드를 안 쓰므로(F9) 템플릿 수정 불필요
- **나쁜 점:** 사용자가 손으로 Pages를 노션에 임베드해 둔 경우 깨진다(이동 페이지도 iframe 안에선 Cloud Run이 `DENY`). Cloud Run `min-instances=0`(`scripts/deploy-cloudrun.sh:113`)이라 첫 접속 콜드 스타트
- **바뀌는 파일(예상):** `ci.yml`(Pages 업로드 대상), 이동 페이지용 신규 파일, `deploy-cloudrun.yml:43`·`scripts/deploy-cloudrun.sh` 기본값, 문서(`docs/02-requirements.md` FR-NX-1·`docs/03-api-spec.md` resumeUrl 예시). **API·DB 변경 없음**

### B. React 빌드를 Pages에도 올림 (UI 한 벌, 호스팅 두 곳)
- **할 일:** Pages용 빌드(`base: '/ULevelP/'`, `BrowserRouter basename`, `config.js` 상대 경로 — F10), Pages 전용 `config.js`(`apiBaseUrl`=Cloud Run), CSP `connect-src`에 Cloud Run 추가(F3), Supabase OAuth 리디렉트 URL에 Pages 추가 확인, CI에 Pages용 빌드 단계
- **좋은 점:** 노션 임베드가 계속 된다(F8). 레거시 코드 중복은 사라진다
- **나쁜 점:** Pages에는 보안 헤더가 없다(`docs/01-project-plan.md:27`) — NFR-SEC-1의 clickjacking 방어가 Pages에선 없음. 빌드·배포 경로 두 개, 교차 출처 API(preflight), iframe 안 저장소 분리로 임베드 안 로그인은 여전히 불안정(F8의 새 창 로그인 세션이 iframe에 안 보일 수 있음 — 미실측). 바뀌는 파일 5개 이상
- **임베드가 꼭 필요할 때만** 의미가 있다. 그 경우에도 대안으로 "Cloud Run에서 `practice.html`만 `frame-ancestors https://www.notion.so …` 허용"(요구사항 변경)이 있다

### C. 현상 유지 (Pages=레거시)
- **좋은 점:** 할 일 없음
- **나쁜 점:** F6(노션 링크 → 서버 동기화 안 되는 화면)이 그대로, 기능 수정마다 두 벌 수정(F11). 최소한 `PUBLIC_APP_URL`만이라도 Cloud Run으로 바꾸지 않으면 로그인 사용자 흐름이 깨진 채로 남는다

## 3. 비교

| 기준 | A 폐지·일원화 | B React를 Pages에도 | C 유지 |
| --- | --- | --- | --- |
| 노션 `이어서 연습` → 서버 동기화 | 됨 | 됨 | **안 됨**(F6) |
| 노션 iframe 임베드 | 안 됨 | 됨(로그인은 불안정) | 됨(비로그인만) |
| 보안 헤더(NFR-SEC-1) | 전부 | Pages엔 없음 | Pages엔 없음 |
| UI 코드 벌 수 | 1 (레거시는 롤백용) | 1 | 2 |
| 작업량 | 작음(env 1개 + 이동 페이지) | 중간 이상 | 0 |

## 4. 추천: **A안**, 두 단계로

1. **RZ-M 직후(env만):** `PUBLIC_APP_URL=https://ulevelp-d5ympfsmfq-du.a.run.app/`로 재배포. F6가 바로 풀린다. 되돌리기도 env 하나
2. **다음 step:** Pages를 이동 페이지로 교체(`ci.yml` + 신규 파일, API·DB 변경 없음), 요구사항 FR-NX-1 문구를 실제 템플릿(F9)에 맞게 정정
- 이유: 공식 템플릿이 임베드를 쓰지 않아(F9) A의 유일한 손실이 작고, 보안 헤더를 포기하지 않으며, 지금 깨져 있는 로그인 흐름(F6)을 가장 적은 변경으로 고친다
- **대안 한 줄:** 노션 안에서 플레이어를 띄우는 임베드가 제품의 핵심이면 B안(또는 Cloud Run `practice.html`만 노션 출처 framing 허용)

## 5. 사용자에게 묻는 것

1. A / B / C 중 무엇으로 할지
2. 노션에 Pages를 직접 임베드해 둔 페이지가 있는지(있으면 A는 그 임베드가 깨진다)
3. A라면 1단계(`PUBLIC_APP_URL` 변경)를 RZ-M 항목 1의 배포와 같이 할지, RZ-M 통과 후 따로 할지

## 6. 결정 (2026-11-03 사용자 답)

| 질문 | 답 | 영향 |
| --- | --- | --- |
| 1. A/B/C | **A** (Pages 폐지 → Cloud Run 일원화) | |
| 2. Pages를 노션에 직접 임베드한 페이지 | **있음** | A 2단계(Pages를 이동 페이지로 교체)를 그대로 하면 그 임베드가 깨진다. 이동 페이지도 iframe 안에선 Cloud Run이 `DENY`(F7) |
| 3. `PUBLIC_APP_URL` 변경 시점 | 추천대로 — **RZ-M 통과 후 따로** | RZ-M 배포는 `PUBLIC_APP_URL` 기본값(Pages) 그대로 |

**2단계 진행 전에 정할 것 (질문 2 때문에 추가):** 임베드를 살리는 방법 하나를 고른다.
- (a) Cloud Run에서 임베드 대상 화면(예: `practice.html`)만 `frame-ancestors`에 노션 출처를 허용하고 그 응답에서 `X-Frame-Options`를 뺀다(`Main.kt:289,385`). 요구사항 NFR-SEC-1(`docs/02-requirements.md:140`) 변경 + 노션 iframe의 실제 출처 실측 필요
- (b) 임베드 페이지만 Pages 레거시로 남긴다(이동 페이지 대상에서 제외). 그 화면은 비로그인 기능만 된다(F4)
- (c) 임베드를 링크로 바꾼다(노션 페이지 수동 수정)
