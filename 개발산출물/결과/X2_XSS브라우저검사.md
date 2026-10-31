# 결과: X2 — Playwright 기반 브라우저 XSS 페이로드 E2E 검사 및 CI e2e-security 작업 추가

- **작업일:** 2026-10-31
- **역할:** 주니어
- **브랜치:** `step/X2`
- **상태:** `완료`

---

## 1. 만든·고친 파일

| 구분 | 경로 | 하는 일 |
| --- | --- | --- |
| 수정 | `package.json` | `devDependencies`에 `@playwright/test: 1.51.1` 추가, `scripts`에 `"test:e2e": "playwright test"` 추가 (`"test"`는 그대로 유지) |
| 신규 | `package-lock.json` | `@playwright/test@1.51.1` 설치로 생성된 lock 파일 |
| 신규 | `playwright.config.js` | Playwright 설정 (`testDir: './test/e2e'`, `http://127.0.0.1:3000`, `node server.js` 자동 기동) |
| 신규 | `test/e2e/xss.spec.js` | 화면 4종(`index`, `practice`, `log`, `settings`) XSS 페이로드 4종 주입 및 CSP 위반 감시 E2E 테스트 (E1~E7) |
| 수정 | `.github/workflows/ci.yml` | `e2e-security` 작업 추가 및 `ci-ok`, `deploy-pages`의 `needs` 배열에 `e2e-security` 연결 |
| 신규 | `개발산출물/결과/X2_XSS브라우저검사.md` | 결과 파일 |
| 수정 | `개발산출물/진행_코틀린서버.md` | 3·5·6·7절 갱신 + 묶음 B 완료 문구 |

---

## 2. 검증 실행 결과

### 2.1 `npm run test:e2e` 실행 결과 (전체 출력)

```text
> guitar-chord-lab@1.0.0 test:e2e
> playwright test


Running 7 tests using 1 worker

     1 …/e2e/xss.spec.js:378:1 › E1 첫 화면(index.html) 곡 목록 및 노션 바로가기
  ✓  1 ….spec.js:378:1 › E1 첫 화면(index.html) 곡 목록 및 노션 바로가기 (722ms)
     2 …e/xss.spec.js:397:1 › E2 플레이어(practice.html) 곡 제목 및 곡 목록 서랍
  ✓  2 …ec.js:397:1 › E2 플레이어(practice.html) 곡 제목 및 곡 목록 서랍 (783ms)
     3 …2e/xss.spec.js:413:1 › E3 기록 화면(log.html) 기록 탭·세션 목록·녹음 URL
  ✓  3 …pec.js:413:1 › E3 기록 화면(log.html) 기록 탭·세션 목록·녹음 URL (845ms)
     4 …› test/e2e/xss.spec.js:434:1 › E4 기록 화면(log.html#songs) 곡 보관함 탭
  ✓  4 …2e/xss.spec.js:434:1 › E4 기록 화면(log.html#songs) 곡 보관함 탭 (692ms)
     5 ….spec.js:451:1 › E5 곡 상세 화면(log.html?song=...) 타임라인 및 A/B 비교
  ✓  5 …:451:1 › E5 곡 상세 화면(log.html?song=...) 타임라인 및 A/B 비교 (927ms)
     6 …est/e2e/xss.spec.js:472:1 › E6 설정 화면(settings.html) 계정 프로필 표시
  ✓  6 …xss.spec.js:472:1 › E6 설정 화면(settings.html) 계정 프로필 표시 (648ms)
     7 [chromium] › test/e2e/xss.spec.js:489:1 › E7 대조군(검출기 작동 확인)
  ✓  7 …mium] › test/e2e/xss.spec.js:489:1 › E7 대조군(검출기 작동 확인) (930ms)
  7 passed (6.0s)
```

### 2.2 `esc()` 고의 제거 시 실패 출력 (확인 후 즉시 원복 완료)

`public/home.js` 50행에서 `esc(s.title)`을 `s.title`로 임시 변경 후 `npm run test:e2e` 실행:

```text
> guitar-chord-lab@1.0.0 test:e2e
> playwright test


Running 7 tests using 1 worker

     1 …/e2e/xss.spec.js:378:1 › E1 첫 화면(index.html) 곡 목록 및 노션 바로가기
  ✘  1 …s.spec.js:378:1 › E1 첫 화면(index.html) 곡 목록 및 노션 바로가기 (5.7s)
     2 …e/xss.spec.js:397:1 › E2 플레이어(practice.html) 곡 제목 및 곡 목록 서랍
  ✓  2 …ec.js:397:1 › E2 플레이어(practice.html) 곡 제목 및 곡 목록 서랍 (896ms)
     3 …2e/xss.spec.js:413:1 › E3 기록 화면(log.html) 기록 탭·세션 목록·녹음 URL
  ✓  3 …pec.js:413:1 › E3 기록 화면(log.html) 기록 탭·세션 목록·녹음 URL (825ms)
     4 …› test/e2e/xss.spec.js:434:1 › E4 기록 화면(log.html#songs) 곡 보관함 탭
  ✓  4 …2e/xss.spec.js:434:1 › E4 기록 화면(log.html#songs) 곡 보관함 탭 (678ms)
     5 ….spec.js:451:1 › E5 곡 상세 화면(log.html?song=...) 타임라인 및 A/B 비교
  ✓  5 …:451:1 › E5 곡 상세 화면(log.html?song=...) 타임라인 및 A/B 비교 (822ms)
     6 …est/e2e/xss.spec.js:472:1 › E6 설정 화면(settings.html) 계정 프로필 표시
  ✓  6 …xss.spec.js:472:1 › E6 설정 화면(settings.html) 계정 프로필 표시 (840ms)
     7 [chromium] › test/e2e/xss.spec.js:489:1 › E7 대조군(검출기 작동 확인)
  ✓  7 …mium] › test/e2e/xss.spec.js:489:1 › E7 대조군(검출기 작동 확인) (921ms)

  1) [chromium] › test/e2e/xss.spec.js:378:1 › E1 첫 화면(index.html) 곡 목록 및 노션 바로가기 

    Error: Timed out 5000ms waiting for expect(locator).toContainText(expected)

    Locator: locator('#songs')
    Expected string: "<img src=x onerror=\"window.__xss=1\">"
    Received string: "연습중 · 1× · 10/30\">연습중 · 0.75× · 10/29javascript:window.__xss=1완료 · 1× · 10/28' onclick='window.__xss=1보류 · 0.5× · 10/27"
    Call log:
      - expect.toContainText with timeout 5000ms
      - waiting for locator('#songs')
        9 × locator resolved to <ul id="songs" class="frame-list">…</ul>
          - unexpected value "연습중 · 1× · 10/30">연습중 · 0.75× · 10/29javascript:window.__xss=1완료 · 1× · 10/28' onclick='window.__xss=1보류 · 0.5× · 10/27"


      385 |   // 곡 목록 로드 대기 (첫 곡의 텍스트가 표시될 때까지)
      386 |   const songsList = page.locator('#songs');
    > 387 |   await expect(songsList).toContainText('<img src=x onerror="window.__xss=1">');
          |                           ^
      388 |
      389 |   // #nlPractice 숨김 확인
      390 |   const nlPractice = page.locator('#nlPractice');
        at /Users/seokhunchoi/code/ULevelP/test/e2e/xss.spec.js:387:27

  1 failed
    [chromium] › test/e2e/xss.spec.js:378:1 › E1 첫 화면(index.html) 곡 목록 및 노션 바로가기 
  6 passed (11.5s)
```
(확인 후 `public/home.js`의 `esc(s.title)` 즉시 원복 완료)

### 2.3 `npm test` 실행 결과 (끝 10줄)

```text
✔ 틀린 예 bad-b.html → (b) 검사가 실패한다 (0.072167ms)
✔ 틀린 예 bad-c.js → (c) 검사가 실패한다 (0.073875ms)
✔ 틀린 예 bad-d.js → (d) 검사가 실패한다 (0.076917ms)
✔ 틀린 예 bad-e.js → (e) 검사가 실패한다 (0.0535ms)
✔ 틀린 예 bad-f.js → (f) 검사가 실패한다 (0.066625ms)
✔ 틀린 예 bad-g.js → (g) 검사가 실패한다 (0.055ms)
✔ 틀린 예 폴더의 파일이 모두 표에 있다 (0.08075ms)
ℹ tests 53
ℹ suites 0
ℹ pass 53
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 176.30025
```

### 2.4 `./gradlew test --no-daemon` 실행 결과 (끝 10줄)

```text
> Task :checkKotlinGradlePluginConfigurationErrors SKIPPED
> Task :compileKotlin UP-TO-DATE
> Task :compileJava NO-SOURCE
> Task :processResources UP-TO-DATE
> Task :classes UP-TO-DATE
> Task :jar UP-TO-DATE
> Task :compileTestKotlin UP-TO-DATE
> Task :compileTestJava NO-SOURCE
> Task :processTestResources NO-SOURCE
> Task :testClasses UP-TO-DATE
> Task :test UP-TO-DATE

BUILD SUCCESSFUL in 2s
5 actionable tasks: 5 up-to-date
```

---

## 3. C0가 쓸 값 (`setupMockAuthAndApi` 헬퍼 시그니처)

`test/e2e/xss.spec.js`의 모킹 헬퍼는 K3-1(노션 ZIP 미리보기), K4-1(연동 키 관리), K5-2(학습 노트 뷰어)에서 E2E 테스트 케이스를 추가할 때 다음과 같이 사용합니다:

```js
const { test, expect } = require('@playwright/test');
const { setupMockAuthAndApi, assertNoXssOrCsp, PAYLOADS } = require('./xss.spec.js');

test('K3-1 노션 백업 ZIP 미리보기 XSS 검사 예시', async ({ page }) => {
  // 1. 필요한 응답 오버라이드
  await setupMockAuthAndApi(page, {
    me: { /* 커스텀 프로필 */ },
    songs: [ /* 커스텀 곡 목록 */ ],
    // C0/K3-1에서 추가할 모킹 핸들러:
    // zipPreview: { ... }
  });

  // 2. 추가 라우트가 필요한 경우 자유롭게 확장 가능
  await page.route('**/api/v1/import/notion/preview', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        preview: [
          { title: PAYLOADS.P_IMG, artist: PAYLOADS.P_SVG }
        ]
      })
    });
  });

  // 3. 페이지 탐색 및 상호작용
  await page.goto('/settings.html#import');
  
  // 4. 공통 XSS·CSP 단언 호출
  await assertNoXssOrCsp(page);
});
```

### `setupMockAuthAndApi(page, opts)` 인자 명세

- `opts.me`: `GET /api/v1/me` 응답 객체 (기본값: 페이로드 포함된 `DEFAULT_ME`)
- `opts.songs`: `GET /api/v1/songs` 및 `GET /api/v1/songs/by-video/*` 응답 곡 목록 (기본값: `DEFAULT_SONGS` 4곡)
- `opts.songDetail`: `GET /api/v1/songs/{id}` 응답 객체 (기본값: `DEFAULT_SONG_DETAIL`)
- `opts.sessions`: `GET /api/v1/sessions` 응답 객체 (기본값: 당일 날짜 포함 `DEFAULT_SESSIONS`)
- `opts.takeUrl`: `GET /api/v1/takes/{id}/url` 응답 객체 (기본값: `{ url: 'javascript:window.__xss=1', expiresIn: 3600 }`)

---

## 4. 명세와 달라진 점 및 겪은 문제

1. **Playwright Chromium 설치 시 Node.js 번들 압축 해제 멈춤 현상:**
   - **문제:** `npx playwright install chromium` 실행 시 다운로드는 100% 완료되나, Node.js 번들 unzip(zip.js)이 대용량(130MB+) 압축 해제 중 macOS 스트림 버퍼링으로 인해 멈추는 현상 발생.
   - **해결:** 온전하게 받아진 다운로드 zip 파일들을 시스템 C 바이너리인 `unzip` 명령을 통해 캐시 경로(`/Users/.../Library/Caches/ms-playwright/chromium_headless_shell-1161` 등)로 2초 만에 압축 해제하고 `INSTALLATION_COMPLETE` 마커를 생성하여 설치 완료함.
2. **Subresource Integrity (SRI) 속성으로 인한 CDN 스텁 차단:**
   - **문제:** `public/*.html`의 `<script src="https://cdn.jsdelivr.net/.../supabase.js" integrity="sha384-...">` 태그에 SRI 해시가 지정되어 있어, `page.route`로 오프라인 가짜 스텁을 반환할 때 브라우저가 해시 불일치로 스크립트 실행을 거부함.
   - **해결:** 프로덕션 코드(`public/*.html`)를 수정하지 않고, `test/e2e/xss.spec.js`의 `setupMockAuthAndApi`에서 HTML 라우팅 시 정규식으로 `integrity` 속성을 제거하여 브라우저에 서빙함으로써 오프라인/CI에서도 외부 네트워크 의존성 없이 스텁이 100% 원활하게 동작하도록 처리함.
3. **Playwright URL 매칭 시 경로 세그먼트 매칭:**
   - **문제:** `**/api/v1/songs**` glob 패턴이 `api/v1/songs/by-video/{id}` 및 `api/v1/songs/{id}`와 정확히 매칭되지 않고 실제 백엔드로 전달되어 404가 발생함.
   - **해결:** `url => url.pathname.startsWith('/api/v1/songs')` 함수 핸들러로 URL을 수신하여 내부에서 `by-video`, `migrate-local`, 단일 id, 목록 조회를 명확하게 분기 처리함.

---

## 5. 단계 완료 및 다음 단계

B 묶음(K2-1, K2-2, X2) 단계 완료하였습니다. 다음 진행은 문서 보강 및 검토 후 진행이 필요합니다.
