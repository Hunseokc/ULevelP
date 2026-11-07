# R1-A2 결과 — GitHub Pages를 Cloud Run 이동 페이지로 교체

- **날짜:** 2026-11-04
- **근거:** `결과/R1_Pages처리결정.md` §2 A·§6 (임베드 처리 = (c) 링크로 교체), `결과/R1-A1_공개URL전환.md`
- **상태:** **완료** — PR #54 머지(`5f7056d`) → main CI `Deploy to GitHub Pages` 성공, 실제 Pages 실측 통과(§4-1)

## 1. 설계 결정

| 항목 | 결정 | 이유 |
| --- | --- | --- |
| 저장소의 `public/` | **그대로 둔다.** Pages 업로드 대상만 `public` → `_site`(CI에서 조립) | Cloud Run 롤백 `ULP_UI=legacy`·E2E legacy 모드가 `public/*.html`을 쓴다(RN-D11·RN-D12) |
| 이동 페이지 파일 | `pages/redirect.{html,js,css}` 3개. CI가 `public/*.html` 파일명 + `404.html`로 `redirect.html`을 복사 | 같은 파일명 8개를 저장소에 두지 않음. 모르는 경로는 Pages가 `404.html`을 주므로 그것도 이동 |
| 이동 대상 | `redirect.js`의 `TARGET = 'https://ulevelp-d5ympfsmfq-du.a.run.app'` 고정 | 저장소 Variables가 비어 있어 `vars.PUBLIC_APP_URL` 주입 불가. 출처가 고정이라 open redirect 없음 |
| 경로 변환 | 마지막 경로 조각이 `PAGES`(레거시 8개)에 있으면 같은 파일명, 아니면 `/`. 쿼리·해시는 그대로 | 옛 노션 `이어서 연습` 링크(`practice.html?v=&t=&a=&b=&r=`)가 같은 화면·같은 구간으로 열림. `PAGES` = `public/*.html`은 테스트가 강제 |
| iframe 안 | **이동하지 않고** "새 창에서 열기" 링크(`target=_blank rel=noopener`)와 안내만 보임 | Cloud Run은 `X-Frame-Options: DENY`(F7) → iframe 안 이동은 빈 화면 |
| JS 꺼짐 | 정적 `<a href="…run.app/">` 링크가 보임 | meta refresh는 쿼리를 못 넘김 |
| CSP (meta) | `default-src 'none'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'` + `noindex` | 인라인 스크립트·스타일 없음(RN-D9). `frame-ancestors`는 meta로 안 걸리지만 위 iframe 처리로 충분 |
| 캐시 버전 | 기존 `Version asset URLs` 단계를 `_site/*.html` 대상으로 | Pages `max-age=600`. `redirect.css?v=<sha>`·`redirect.js?v=<sha>` |

## 2. 바뀐 파일

| 파일 | 내용 |
| --- | --- |
| `pages/redirect.html`, `pages/redirect.js`, `pages/redirect.css` (신규) | 이동 페이지 |
| `.github/workflows/ci.yml` | `deploy-pages`: `Build redirect pages` 단계 추가, 캐시 버전 대상 `_site`, 업로드 `path: _site` |
| `test/pages_redirect.test.js` (신규) | 주소 변환(쿼리·해시 보존, 루트, 이상한 입력 → `/`), `PAGES` = `public/*.html`, CSP·인라인 없음, ci.yml 업로드 대상 |
| `docs/02-requirements.md` FR-NX-1 | "플레이어 임베드 포함" 삭제 → `이어서 연습` 링크가 앱 진입로, iframe 임베드 안 씀(F9) |
| `README.md:12` | "폐지 예정" → 폐지·이동 안내 |

API·DB·함수 시그니처 변경 없음.

## 3. 확인 (실측)

**`npm run build` + `npm test`:** `tests 139 / pass 139 / fail 0` (새 파일 7개 포함)

**로컬 브라우저 확인:** CI와 같은 명령으로 `_site` 조립(파일 11개: HTML 9 + js + css, 각 HTML에 `?v=` 2개) → `/ULevelP/` 아래 정적 서빙(모르는 경로는 `404.html`, Pages 흉내) → Playwright chromium

```text
OK   /ULevelP/practice.html?v=abc&t=10&a=3&b=9.5&r=0.75#x → https://ulevelp-d5ympfsmfq-du.a.run.app/practice.html?v=abc&t=10&a=3&b=9.5&r=0.75#x
OK   /ULevelP/ → https://ulevelp-d5ympfsmfq-du.a.run.app/
OK   /ULevelP/note.html?id=n1 → https://ulevelp-d5ympfsmfq-du.a.run.app/note.html?id=n1
OK   /ULevelP/nope.html?q=1 → https://ulevelp-d5ympfsmfq-du.a.run.app/?q=1
Cloud Run #root: 1
iframe url 그대로: http://localhost:4791/ULevelP/practice.html?v=abc&t=10
iframe #framed 보임: true / #moving 보임: false
iframe #go: https://ulevelp-d5ympfsmfq-du.a.run.app/practice.html?v=abc&t=10 _blank noopener
JS 꺼짐 url: http://localhost:4791/ULevelP/practice.html?v=abc / 링크: https://ulevelp-d5ympfsmfq-du.a.run.app/ true
CSP 위반: 0
```

(iframe은 다른 출처 `127.0.0.1`에서 `localhost` 이동 페이지를 임베드. 확인 스크립트는 세션 임시 폴더에만 두었고 저장소에는 넣지 않았다 — 같은 내용은 머지 후 §4로 실제 Pages에서 다시 본다)

## 4. 머지 후 할 것 (실제 Pages)

main CI `Deploy to GitHub Pages` 성공 후:

```bash
curl -s https://hunseokc.github.io/ULevelP/practice.html | grep -c 'redirect.js?v='   # 1
curl -s -o /dev/null -w "%{http_code}\n" https://hunseokc.github.io/ULevelP/nope.html  # 404 (본문은 이동 페이지)
```

브라우저로 `https://hunseokc.github.io/ULevelP/practice.html?v=dQw4w9WgXcQ&t=42` → `https://ulevelp-d5ympfsmfq-du.a.run.app/practice.html?v=dQw4w9WgXcQ&t=42`로 바뀌는지 본다.

## 4-1. 실제 Pages 실측 (2026-11-04, 머지 후)

main CI `5f7056d`(PR #54)·`71e1b48`(PR #55) 모두 `Deploy to GitHub Pages` success. 실측 시점 Pages 배포본 = `71e1b48`(`redirect.{js,css}?v=71e1b48`). `da355b7`(PR #56) CI는 진행 중이었으나 `pages/` 변경 없음 — 캐시 버전만 바뀐다.

**curl:**

```text
/              200 redirect.js?v=1 id=root:0
index.html     200 redirect.js?v=1 id=root:0
practice.html  200 redirect.js?v=1 id=root:0
chords.html    200 redirect.js?v=1 id=root:0
log.html       200 redirect.js?v=1 id=root:0
notes.html     200 redirect.js?v=1 id=root:0
note.html      200 redirect.js?v=1 id=root:0
settings.html  200 redirect.js?v=1 id=root:0
login.html     404 redirect.js?v=1 id=root:0     ← 레거시 목록에 없는 경로 = 404.html(이동 페이지)
nope.html      404 redirect.js?v=1 id=root:0
redirect.js    200  Content-Type: application/javascript; charset=utf-8  Cache-Control: max-age=600
               const TARGET = 'https://ulevelp-d5ympfsmfq-du.a.run.app';
```

**Playwright chromium (실제 Pages → Cloud Run):**

```text
OK   /practice.html?v=dQw4w9WgXcQ&t=42 → https://ulevelp-d5ympfsmfq-du.a.run.app/practice.html?v=dQw4w9WgXcQ&t=42 (#root 1)
OK   /practice.html?v=abc&t=10&a=3&b=9.5&r=0.75#x → https://ulevelp-d5ympfsmfq-du.a.run.app/practice.html?v=abc&t=10&a=3&b=9.5&r=0.75#x (#root 1)
OK   / → https://ulevelp-d5ympfsmfq-du.a.run.app/ (#root 1)
OK   /note.html?id=n1 → https://ulevelp-d5ympfsmfq-du.a.run.app/note.html?id=n1 (#root 1)
OK   /privacy.html → https://ulevelp-d5ympfsmfq-du.a.run.app/privacy.html (#root 1)
OK   /nope.html?q=1 → https://ulevelp-d5ympfsmfq-du.a.run.app/?q=1 (#root 1)
iframe url 그대로: https://hunseokc.github.io/ULevelP/practice.html?v=abc&t=10
iframe #framed 보임: true / #moving 보임: false
iframe #go: https://ulevelp-d5ympfsmfq-du.a.run.app/practice.html?v=abc&t=10 _blank noopener
JS 꺼짐 url: https://hunseokc.github.io/ULevelP/practice.html?v=abc / 링크: https://ulevelp-d5ympfsmfq-du.a.run.app/ true
CSP 위반: 0 []
```

(iframe은 `about:blank` 페이지에서 Pages를 임베드. 확인 스크립트는 세션 임시 폴더에만 두고 저장소에 넣지 않음)

→ 완료 기준(옛 Pages 링크가 쿼리·해시 포함 Cloud Run 같은 화면으로 이동, 임베드는 새 창 링크) 충족.

## 5. 노션 임베드 조사 결과 (§6 질문 2 재확인)

Notion 검색(`hunseokc.github.io ULevelP`, `github.io/ULevelP practice.html`)과 페이지 조회 결과:

- **이 저장소 Pages(`hunseokc.github.io/ULevelP/…`)를 임베드하거나 링크한 노션 페이지는 찾지 못했다.**
- 임베드가 있는 곳은 노션 `🎸 악기 연습` 페이지(`3fe7a337-e26f-817e-842d-f10c9d9b264b`, 최종 편집 2026-10-30)다. 그런데 대상이 **별도 저장소 `Hunseokc/guitar-practice`의 Pages**다:
  - `<embed source="https://hunseokc.github.io/guitar-practice/chords.html#scale" />`
  - 콜아웃 링크 4개: `…/guitar-practice/`, `…/chords.html`, `…/practice.html`, `github.com/Hunseokc/guitar-practice`
  - `gh api repos/Hunseokc/guitar-practice/pages` → `build_type: workflow`, `https://hunseokc.github.io/guitar-practice/` (200, 마지막 push 2026-10-28). ULevelP Pages와 다른 배포
- → **R1-A2 PR은 이 임베드를 깨지 않는다.**
- **처리 (2026-11-04, 사용자 승인 → Notion 연결로 수정, §6 (c)):** `악기 연습` 페이지에서
  - 임베드 블록 → 링크 `[▶ 코드 연습실 열기 (스케일)](https://ulevelp-d5ympfsmfq-du.a.run.app/chords.html#scale)`
  - 콜아웃 링크 4개 → `run.app/`, `run.app/chords.html`, `run.app/practice.html`, `github.com/Hunseokc/ULevelP`
  - 다시 fetch해 반영 확인(편집 시각 2026-11-04T01:27Z, `guitar-practice` 문자열 0개). 새 링크 3개는 `curl` 200 + `id="root"`
  - `guitar-practice` 저장소 Pages 자체는 그대로(이 저장소 범위 밖)
- 공식 템플릿 `악기 연습 템플릿`(`4097a337…`, 설정 화면 링크 대상)에도 Pages 주소는 없다(fetch 확인)
- 그 페이지의 `연습 곡` DB(`collection://3274bad2-…`) 행의 `이어서 연습` 링크는 서버 push가 쓰므로 R1-A1 이후 push된 행부터 run.app(옛 행은 R1-A1 이전 값)

## 5-1. 설정 화면 노션 연결 안내 (사용자 요청 추가, 2026-11-04)

- **템플릿 링크:** `public/config.js:14` `notionTemplateUrl` = `https://app.notion.com/p/4097a337e26f8167aa10eb435edb676e?source=copy_link`. 사용자가 지정한 값과 같아 그대로 둔다(2026-10-30 `215d753`에서 들어옴). 테스트가 이 값을 고정
- **연동 방식(조사):** 서버는 템플릿을 복제하거나 DB를 찾지 않는다. 사용자가 설정에 넣은 토큰 + DB ID 3개(`songsDb`·`sessionsDb`·`notesDb`)만 쓴다(`NotionSyncService.kt:194-197`). 서버는 32자리 16진수(대시 허용)만 받는다(`IntegrationService.kt:111-115`)
- **바뀐 것 (`frontend/src/pages/SettingsPage.tsx`, API·서버 변경 없음):**
  - 노션 연동 카드 첫 줄을 템플릿 기준 5단계 안내(`#ntnGuide`)로 교체: ① 공식 템플릿 복제 ② my-integrations 토큰 ③ 페이지 `···`→연결 ④ DB 3개를 전체 페이지로 열어 링크 복사·붙여넣기 ⑤ 저장→연결 확인
  - `notionDbIdFromInput`: DB **링크를 그대로 붙여넣어도** 마지막 경로 끝의 ID만 꺼내 보낸다(`?v=` 보기 ID는 무시). URL이 아니거나 ID가 없으면 입력 그대로 → 서버 400
  - placeholder "32자리 DB ID" → "DB 링크 또는 32자리 ID"
  - 레거시 `public/settings.js`·`settings.html`은 롤백용이라 고치지 않음
- **확인:** `test/r1_settings_notes.test.js` R1-S10(링크 4형식·직접 ID·잘못된 입력 2건·저장 호출·안내 5단계·템플릿 URL), `tsc --noEmit` 0, `npm run build`, `npm test` 140/140. `ULP_UI=spa node server.js` + Playwright: 1280·390px 모두 `#ntnGuide li` 5, 링크 2개 `_blank noopener noreferrer`, scrollWidth = 뷰포트, CSP 위반 0
- **공식 템플릿 페이지의 SETTING 안내(노션):** DB 링크 단계가 없어 앱 안내와 맞추려 했으나 자동 수정 권한이 거부되어 **미반영** — 사용자가 직접 수정하거나 권한 허용 후 다시 진행

## 6. 남은 것

- ~~머지 후 §4 실측~~ → §4-1 통과
- 공식 템플릿 SETTING 안내(노션)에 DB 링크 단계 반영 — 사용자 직접(§5-1)
- (선택) `guitar-practice` 저장소 Pages 정리 — 노션 링크는 §5에서 이미 run.app으로 바꿈
- ~~PR ② `PUBLIC_APP_URL` 기본값 run.app 전환~~ → PR #55 머지(`71e1b48`)
- `ALLOWED_ORIGINS`에서 `github.io` 제거·레거시 `public/*.js` 정리는 결정 문서 §2 A ③(롤백 기간 뒤, 별도 결정)
