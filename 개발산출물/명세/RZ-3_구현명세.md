# RZ-3 구현 명세 — Cloud Run React 전환(SPA 서빙·롤백 스위치) · Vite CJS 변환 · E2E 2모드 · 레이아웃 보정

- **대상 Step:** RZ-3 (주니어, 권장 effort 중간)
- **작성일:** 2026-11-03 / **작성자:** 시니어 (RZ-3-0)
- **근거:** `개발산출물/결과/RZ-3-0_명세검토.md` §2·§3, `개발산출물/결과/RZ-2_최종통합및배포.md` §5-2
- **선행 조건:** PR #44(RZ-2) 머지. 브랜치는 최신 `origin/main`에서 `step/RZ-3`로 만든다
- **명세 작성 규칙 준수:** 기존 파일은 전부 **diff(바꿀 줄만)**로 준다. 각 전제에 확인한 `file:line`을 붙였다. 줄 번호는 2026-11-03 `main` + PR #44 기준이다. 어긋나면 인용한 코드 문자열로 찾는다

---

## 1. 파일 목록

| 구분 | 경로 | 내용 |
| --- | --- | --- |
| 수정 | `src/main/kotlin/ulevelp/Main.kt` | `module()`에 `uiMode` 매개변수(끝에 추가, 기본값 env), HTML 진입 경로 → `spa.html` 매핑 |
| 수정 | `src/test/kotlin/ulevelp/ChordEngineTest.kt` | `Z4`~`Z6` 추가 |
| 수정 | `server.js` | `ULP_UI=spa`일 때 HTML 진입 경로·`/assets/*`를 `dist/`에서 서빙 |
| 수정 | `vite.config.ts` | `build.commonjsOptions.include`에 `public/lib` 추가 |
| 수정 | `.github/workflows/ci.yml` | E2E job을 `ui: [legacy, spa]` matrix로, Docker 스모크에 SPA·롤백 확인 추가 |
| 수정 | `.github/workflows/deploy-cloudrun.yml` | env `ULP_UI` 추가, `ALLOWED_ORIGINS` 기본값에서 localhost 제거 |
| 수정 | `scripts/deploy-cloudrun.sh` | `ULP_UI`를 `--set-env-vars`에 포함, `ALLOWED_ORIGINS` 기본값에서 localhost 제거, 머리 주석 갱신 |
| 생성 | `test/e2e/layout.spec.js` | 390/768/1280px × 8화면 가로 스크롤 0건 |
| 수정 | `public/site.css` | `#btnOpenGeminiModal` 줄바꿈 허용 |
| 수정 | `frontend/src/pages/SettingsPage.module.css`, `frontend/src/pages/SettingsPage.tsx` | 같은 버튼 줄바꿈 허용 + `document.title` |
| 수정 | `frontend/src/pages/{ChordsPage,NotesPage,NoteDetailPage,PrivacyPage}.tsx` | `document.title` 설정 |
| 생성 | `test/rz3_spa.test.js` | 정적 계약 검사 `RZ3-1`~`RZ3-4` |
| 생성 | `개발산출물/결과/RZ-3_React전환및보정.md` | 결과 보고서 |
| 수정 | `개발산출물/진행_리액트및기능고도화.md` | RZ-3 상태·다음 지시 |

- 삭제 파일 없음. `public/*.html`·`public/*.js`는 GitHub Pages가 계속 서빙하므로 **유지**(RN-D11)
- **메뉴얼 변경(사용자 승인 대상):** `Application.module()` 시그니처에 기본값 있는 매개변수 `uiMode` 1개 추가, 운영 env `ULP_UI` 신설. 이 명세 PR 머지를 승인으로 본다

---

## 2. 파일별 상세

### 2.1 `src/main/kotlin/ulevelp/Main.kt`

전제: 정적 라우트는 `route("{path...}")`에서 `relPath`를 만들고 `File(canonicalPublicRoot, relPath)`를 서빙한다(`Main.kt:316-337`). `spa.html` 처리는 없다.

(1) `module(` 매개변수 목록 **맨 끝** `analyzeJobDispatcher: AnalyzeJobDispatcher? = null` 뒤에 추가한다(`Main.kt:132`, 위치 인자 호환 유지):
```kotlin
    analyzeJobDispatcher: AnalyzeJobDispatcher? = null,
    uiMode: String = System.getenv("ULP_UI").orEmpty()
) {
```

(2) 파일 최상위(`fun main` 위)에 상수를 추가한다:
```kotlin
// React 빌드(spa.html)가 대신 서빙하는 HTML 진입 경로 (RZ-3)
private val SPA_ENTRY_PAGES = setOf(
    "index.html", "chords.html", "practice.html", "log.html",
    "notes.html", "note.html", "settings.html", "privacy.html"
)
```

(3) `val canonicalPublicRoot = publicDir.canonicalFile`(`Main.kt:275`) 바로 아래에 추가:
```kotlin
    // ULP_UI=legacy면 spa.html이 있어도 옛 public/*.html을 서빙한다(재빌드 없는 롤백 스위치)
    val spaEnabled = uiMode.trim().lowercase() != "legacy" && File(canonicalPublicRoot, "spa.html").isFile
```

(4) 정적 라우트의 `val targetFile = File(canonicalPublicRoot, relPath).canonicalFile`(`Main.kt:336`)을 아래로 바꾼다:
```kotlin
                val servedPath = if (spaEnabled && relPath in SPA_ENTRY_PAGES) "spa.html" else relPath
                val targetFile = File(canonicalPublicRoot, servedPath).canonicalFile
```
- 이후 존재 확인, 확장자별 Content-Type, `no-cache`, `frame-ancestors 'none'`, HEAD 처리는 **그대로**(`servedPath`가 `.html`이므로 HTML 규칙을 탄다)
- `/spa.html` 직접 요청은 그대로 서빙된다(라우트가 없어 빈 화면이지만 무해). 막지 않는다

### 2.2 `src/test/kotlin/ulevelp/ChordEngineTest.kt` — `Z3` 아래에 추가

전제: `Z2`·`Z3`(`ChordEngineTest.kt:290-314`)가 `testApplication { application { module(dbConfig = null, authConfig = null) } }` 패턴을 쓴다. import는 기존 `io.ktor.client.request.*`, `io.ktor.client.statement.*`, `io.ktor.http.*`, `kotlin.test.*`로 충분하다.

```kotlin
    private fun spaPublicDir(withSpa: Boolean): java.io.File {
        val dir = kotlin.io.path.createTempDirectory("ulp-public").toFile()
        java.io.File(dir, "index.html").writeText("LEGACY-INDEX")
        java.io.File(dir, "practice.html").writeText("LEGACY-PRACTICE")
        java.io.File(dir, "lib").mkdirs()
        java.io.File(dir, "lib/theory.js").writeText("// theory")
        if (withSpa) java.io.File(dir, "spa.html").writeText("<div id=\"root\"></div>")
        return dir
    }

    @Test
    fun `Z4 spa_html이 있으면 HTML 진입 경로에 spa_html을 서빙한다`() = testApplication {
        application { module(publicDir = spaPublicDir(true), dbConfig = null, authConfig = null, uiMode = "") }
        for (path in listOf("/", "/index.html", "/practice.html", "/notes.html", "/note.html?id=x")) {
            val res = client.get(path)
            assertEquals(HttpStatusCode.OK, res.status, path)
            assertTrue(res.bodyAsText().contains("id=\"root\""), path)
            assertEquals("frame-ancestors 'none'", res.headers["Content-Security-Policy"], path)
            assertEquals("no-cache", res.headers["Cache-Control"], path)
        }
        val head = client.head("/practice.html")
        assertEquals(listOf("<div id=\"root\"></div>".length.toString()), head.headers.getAll(HttpHeaders.ContentLength))
        assertEquals("// theory", client.get("/lib/theory.js").bodyAsText())
        assertEquals(HttpStatusCode.NotFound, client.get("/unknown.html").status)
    }

    @Test
    fun `Z5 ULP_UI=legacy면 spa_html이 있어도 레거시 HTML을 서빙한다`() = testApplication {
        application { module(publicDir = spaPublicDir(true), dbConfig = null, authConfig = null, uiMode = "legacy") }
        assertEquals("LEGACY-INDEX", client.get("/").bodyAsText())
        assertEquals("LEGACY-PRACTICE", client.get("/practice.html").bodyAsText())
    }

    @Test
    fun `Z6 spa_html이 없으면 레거시 HTML을 서빙한다`() = testApplication {
        application { module(publicDir = spaPublicDir(false), dbConfig = null, authConfig = null, uiMode = "") }
        assertEquals("LEGACY-INDEX", client.get("/").bodyAsText())
        assertEquals(HttpStatusCode.NotFound, client.get("/notes.html").status)
    }
```
- 함수 이름에 `.`을 쓰지 않는다(JVM 금지 문자). `spa_html`로 쓴다

### 2.3 `server.js`

전제: `serveStatic`(`server.js:231-243`)은 `PUBLIC_DIR`만 서빙한다. Playwright `webServer`가 `node server.js`를 띄우고(`playwright.config.js:20-25`) 부모 프로세스 env를 물려받는다.

(1) `const PUBLIC_DIR = path.join(__dirname, 'public');`(`server.js:12`) 아래에 추가:
```js
// ULP_UI=spa면 HTML 진입 경로와 /assets/*를 React 빌드(dist/)에서 서빙한다 (RZ-3, Ktor와 같은 규칙)
const DIST_DIR = path.join(__dirname, 'dist');
const SPA_PAGES = new Set(['/index.html', '/chords.html', '/practice.html', '/log.html', '/notes.html', '/note.html', '/settings.html', '/privacy.html']);
const SPA_MODE = process.env.ULP_UI === 'spa' && fs.existsSync(path.join(DIST_DIR, 'index.html'));
```
(2) `serveStatic` 앞부분을 바꾼다:
```diff
   let rel = decodeURIComponent(pathname);
   if (rel === '/' || rel === '') rel = '/index.html';
-  const file = path.normalize(path.join(PUBLIC_DIR, rel));
-  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
+  let root = PUBLIC_DIR;
+  if (SPA_MODE && SPA_PAGES.has(rel)) { root = DIST_DIR; rel = '/index.html'; }
+  else if (SPA_MODE && rel.startsWith('/assets/')) root = DIST_DIR;
+  const file = path.normalize(path.join(root, rel));
+  if (!file.startsWith(root + path.sep)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
```
- 나머지(`fs.stat`, 헤더, HEAD)는 그대로
- `ULP_UI=spa`인데 `dist/index.html`이 없으면 레거시로 돈다. 시작 시 `console.log`로 모드를 한 줄 출력한다: `console.log('UI mode:', SPA_MODE ? 'spa (dist/)' : 'legacy (public/)');` `server.listen(...)` 콜백(`server.js:262`) 안 기존 로그 다음 줄에 둔다

### 2.4 `vite.config.ts`

전제: `frontend/src/lib/musicEngine.ts:3,5`가 `public/lib/theory.js`·`voicing.js`를 import한다. 두 파일은 `if (typeof module !== 'undefined') module.exports = …`(`theory.js:476`, `voicing.js` 끝) 형태다.
```diff
     emptyOutDir: true,
     sourcemap: false,
+    // public/lib/*.js는 브라우저 전역 겸용 CJS라 Rollup CJS 변환 대상에 넣는다 (RZ-3)
+    commonjsOptions: { include: [/node_modules/, /public[\\/]lib[\\/]/] },
   },
```

### 2.5 `.github/workflows/ci.yml`

(1) `e2e-security` job(`ci.yml:56-69`):
```diff
   e2e-security:
-    name: E2E XSS & CSP (Playwright)
+    name: E2E XSS & CSP (Playwright, ${{ matrix.ui }})
     needs: changes
     if: needs.changes.outputs.code == 'true'
     runs-on: ubuntu-latest
+    strategy:
+      fail-fast: false
+      matrix:
+        ui: [legacy, spa]
     steps:
       ...
       - run: npm ci
+      - if: matrix.ui == 'spa'
+        run: npm run build
       - run: npx playwright install --with-deps chromium
       - run: npm run test:e2e
+        env:
+          ULP_UI: ${{ matrix.ui }}
```
- ruleset 필수 체크는 `CI ok` 하나뿐이다(`개발산출물/자료/ruleset_main.json:38`). job 이름이 바뀌어도 머지는 막히지 않는다. `ci-ok`의 `needs`는 그대로 둔다(matrix 전체 결과로 판정된다)

(2) `docker` job의 `Index page responds` 단계(`ci.yml:114-115`)를 아래 두 단계로 바꾼다:
```yaml
      - name: SPA entry served (React)
        run: |
          curl -fsS http://127.0.0.1:3000/ | grep -q 'id="root"'
          ASSET=$(curl -fsS http://127.0.0.1:3000/practice.html | grep -oE '/assets/index-[^"]+\.js' | head -1)
          test -n "$ASSET"
          curl -fsS -o /dev/null "http://127.0.0.1:3000${ASSET}"
      - name: Rollback switch (ULP_UI=legacy)
        run: |
          docker run -d --name app-legacy -e ULP_UI=legacy -p 3001:3000 guitar-chord-lab:ci
          for _ in $(seq 1 20); do curl -fsS http://127.0.0.1:3001/api/health >/dev/null 2>&1 && break; sleep 1; done
          ! curl -fsS http://127.0.0.1:3001/ | grep -q 'id="root"'
```
`Cleanup`에 `docker rm -f app-legacy || true`를 추가한다.

### 2.6 `.github/workflows/deploy-cloudrun.yml`·`scripts/deploy-cloudrun.sh`

전제: 스크립트는 `--set-env-vars`로 서비스 env를 **통째로 교체**한다(`deploy-cloudrun.sh:115`). 콘솔에서만 `ULP_UI`를 바꾸면 다음 배포 때 사라진다.

워크플로 `jobs.deploy.env`:
```diff
-      ALLOWED_ORIGINS: ${{ vars.ALLOWED_ORIGINS || 'https://hunseokc.github.io,http://localhost:3000' }}
+      ALLOWED_ORIGINS: ${{ vars.ALLOWED_ORIGINS || 'https://hunseokc.github.io' }}
+      ULP_UI: ${{ vars.ULP_UI || 'spa' }}
```
스크립트:
```diff
-#   ALLOWED_ORIGINS      : CORS 허용 오리진 (기본: https://hunseokc.github.io,http://localhost:3000)
+#   ALLOWED_ORIGINS      : CORS 허용 오리진 (기본: https://hunseokc.github.io)
+#   ULP_UI               : 화면 모드 spa|legacy (기본: spa). legacy면 React 대신 옛 public/*.html 서빙
...
-ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-https://hunseokc.github.io,http://localhost:3000}"
+ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-https://hunseokc.github.io}"
+ULP_UI="${ULP_UI:-spa}"
...
-  --set-env-vars="^|^SUPABASE_URL=...|CLOUD_RUN_ANALYZE_JOB_URI=${ANALYZE_JOB_URI}" \
+  --set-env-vars="^|^SUPABASE_URL=...|CLOUD_RUN_ANALYZE_JOB_URI=${ANALYZE_JOB_URI}|ULP_UI=${ULP_UI}" \
```
(`...`은 기존 내용을 그대로 둔다는 뜻이다. `|` 구분자 형식은 KZ-1 수정(`77c8af6`) 그대로)

롤백 절차(결과 파일에 그대로 적는다):
- 즉시: `gcloud run services update ulevelp --region asia-northeast3 --update-env-vars ULP_UI=legacy`
- 다음 배포에도 유지: 저장소 Variables에 `ULP_UI=legacy` 설정

### 2.7 `test/e2e/layout.spec.js` (생성 — 전체)
```js
// 반응형 가로 스크롤 검사 (RZ-3): 390·768·1280px × 8개 화면, 가로 스크롤 0건
'use strict';
const { test, expect } = require('@playwright/test');

const PAGES = [
  '/index.html',
  '/chords.html',
  '/practice.html?v=jNQXAC9IVRw',
  '/log.html',
  '/notes.html',
  '/note.html?id=00000000-0000-0000-0000-000000000001',
  '/settings.html',
  '/privacy.html',
];

for (const width of [390, 768, 1280]) {
  test(`L1 ${width}px 전 화면 가로 스크롤 0건`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route(/youtube\.com|ytimg\.com|doubleclick\.net/, (route) => route.abort());
    const over = [];
    for (const p of PAGES) {
      await page.goto(p, { waitUntil: 'load' });
      await page.waitForTimeout(300);
      const px = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (px > 0) over.push(`${p} +${px}px`);
    }
    expect(over).toEqual([]);
  });
}
```
- 수정 전에는 `390px`에서 `/settings.html +76px`(legacy)·`+64px`(spa)로 실패해야 한다. 실패를 먼저 확인하고 결과 파일에 적는다

### 2.8 설정 화면 390px 가로 스크롤 (P1)

전제: `.sec`는 `white-space: nowrap`(`public/site.css:22`), `.ghostBtn`도 `nowrap`(`frontend/src/styles/tokens.css:197-213`)이다.
- `public/site.css` 끝에 추가:
```css
/* 설정 Gemini 가이드 버튼: 문구가 길어 좁은 화면에서 줄바꿈 (RZ-3) */
#btnOpenGeminiModal { white-space: normal; max-width: 100%; text-align: center; padding-top: 10px; padding-bottom: 10px; }
```
- `frontend/src/pages/SettingsPage.module.css` 끝에 추가:
```css
.geminiGuideBtn {
  white-space: normal;
  max-width: 100%;
  text-align: center;
  padding-top: 10px;
  padding-bottom: 10px;
}
```
- `SettingsPage.tsx`의 `id="btnOpenGeminiModal"` 버튼(`SettingsPage.tsx:978-981`): `className="ghostBtn"` → ``className={`ghostBtn ${styles.geminiGuideBtn}`}``
- 시니어가 CSS 주입으로 legacy에서 확인한 결과: `+76px → 0`, 버튼 높이 75px. 필 형태(`9999px`)는 유지된다

### 2.9 React `document.title` (P2)

전제: `LogPage.tsx:534-535`, `PracticePage.tsx:943`이 `useEffect` 안에서 `document.title`을 설정한다. 같은 패턴으로 각 컴포넌트 본문 첫 `useEffect`로 추가한다(`useEffect` import가 없으면 추가). 값은 레거시 `<title>`과 같게 한다:

| 컴포넌트 | 값 (`public/*.html` `<title>`) |
| --- | --- |
| `ChordsPage` | `기타 코드 연습실` |
| `NotesPage` | `학습 노트 · ULeveLP` |
| `NoteDetailPage` | `학습 노트 상세 · ULeveLP` |
| `SettingsPage` | `설정 · ULeveLP` |
| `PrivacyPage` | `개인정보처리방침 · ULeveLP` |

```tsx
  useEffect(() => {
    document.title = '설정 · ULeveLP';
  }, []);
```
`HomePage`는 `frontend/index.html`의 `<title>ULeveLP</title>`과 레거시 값이 같으므로 바꾸지 않는다.

### 2.10 `test/rz3_spa.test.js` (생성 — 전체)
```js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const ENTRY = ['index.html', 'chords.html', 'practice.html', 'log.html', 'notes.html', 'note.html', 'settings.html', 'privacy.html'];

describe('RZ3-1: Ktor·server.js SPA 진입 경로 목록 일치', () => {
  test('Main.kt SPA_ENTRY_PAGES와 server.js SPA_PAGES가 8개 진입 경로로 같다', () => {
    const kt = read('src/main/kotlin/ulevelp/Main.kt');
    const js = read('server.js');
    for (const p of ENTRY) {
      assert.ok(new RegExp(`SPA_ENTRY_PAGES[\\s\\S]*"${p.replace('.', '\\.')}"`).test(kt), `Main.kt에 ${p}`);
      assert.ok(js.includes(`'/${p}'`), `server.js에 /${p}`);
    }
    assert.match(kt, /uiMode\.trim\(\)\.lowercase\(\)\s*!=\s*"legacy"/);
    assert.match(js, /process\.env\.ULP_UI\s*===\s*'spa'/);
  });
});

describe('RZ3-2: Vite CJS 변환 대상에 public/lib 포함', () => {
  test('vite.config.ts commonjsOptions.include에 public/lib가 있다', () => {
    assert.match(read('vite.config.ts'), /commonjsOptions:\s*\{\s*include:\s*\[[^\]]*public/);
  });
});

describe('RZ3-3: CI·배포 계약', () => {
  test('E2E가 legacy·spa 2모드로 돌고 Docker 스모크가 SPA·롤백을 확인한다', () => {
    const ci = read('.github/workflows/ci.yml');
    assert.match(ci, /ui:\s*\[legacy,\s*spa\]/);
    assert.match(ci, /ULP_UI:\s*\$\{\{\s*matrix\.ui\s*\}\}/);
    assert.match(ci, /-e ULP_UI=legacy/);
  });
  test('배포가 ULP_UI를 전달하고 운영 기본 ALLOWED_ORIGINS에 localhost가 없다', () => {
    const wf = read('.github/workflows/deploy-cloudrun.yml');
    const sh = read('scripts/deploy-cloudrun.sh');
    assert.match(wf, /ULP_UI:\s*\$\{\{\s*vars\.ULP_UI\s*\|\|\s*'spa'\s*\}\}/);
    assert.match(sh, /ULP_UI=\$\{ULP_UI\}/);
    assert.ok(!/ALLOWED_ORIGINS[^\n]*localhost/.test(wf), 'deploy-cloudrun.yml 기본값에 localhost 금지');
    assert.ok(!/ALLOWED_ORIGINS=[^\n]*localhost/.test(sh), 'deploy-cloudrun.sh 기본값에 localhost 금지');
  });
});

describe('RZ3-4: React 화면 제목·설정 버튼 줄바꿈', () => {
  test('5개 React 화면이 레거시와 같은 document.title을 설정한다', () => {
    const want = {
      ChordsPage: '기타 코드 연습실',
      NotesPage: '학습 노트 · ULeveLP',
      NoteDetailPage: '학습 노트 상세 · ULeveLP',
      SettingsPage: '설정 · ULeveLP',
      PrivacyPage: '개인정보처리방침 · ULeveLP',
    };
    for (const [name, title] of Object.entries(want)) {
      assert.ok(read(`frontend/src/pages/${name}.tsx`).includes(`document.title = '${title}'`), name);
    }
  });
  test('#btnOpenGeminiModal이 legacy·React 모두 줄바꿈을 허용한다', () => {
    assert.match(read('public/site.css'), /#btnOpenGeminiModal\s*\{[^}]*white-space:\s*normal/);
    assert.match(read('frontend/src/pages/SettingsPage.module.css'), /\.geminiGuideBtn\s*\{[^}]*white-space:\s*normal/);
    assert.match(read('frontend/src/pages/SettingsPage.tsx'), /styles\.geminiGuideBtn/);
  });
});
```

---

## 3. 환경 변수

| 이름 | 위치 | 기본 | 설명 |
| --- | --- | --- | --- |
| `ULP_UI` | Cloud Run env(배포 스크립트), GitHub Variable(선택) | `spa` | `legacy`면 Ktor가 `public/*.html` 서빙(롤백) |
| `ULP_UI` | `server.js`(로컬·CI E2E) | 없음(=legacy) | `spa`이고 `dist/index.html`이 있으면 React 서빙 |

---

## 4. 검증·에러 표

| 항목 | 조건 | 기대 |
| --- | --- | --- |
| SPA 서빙 | `spa.html` 있음, `ULP_UI` 비었음 | 8개 진입 경로 200 + `id="root"`, 헤더 `no-cache`·`frame-ancestors 'none'` |
| 롤백 | `ULP_UI=legacy` | 레거시 HTML |
| 이미지 밖 실행 | `spa.html` 없음(로컬 `./gradlew run`) | 레거시 HTML (`Z2`·`Z3` 그대로 통과) |
| 잘못된 입력 | `/unknown.html`, `/../../etc/passwd` | 404, 403 (기존과 같음) |
| 코드 연습실 | React 빌드 | 크래시 없음, csp_check `svgs` ≥ 50 |

---

## 5. 처리 순서

1. `vite.config.ts` → `npm run build` → `ULP_UI=spa node server.js`를 띄우고 `node 개발산출물/자료/csp_check.js http://127.0.0.1:3000/` 실행. 13개 실패 0, 코드 연습실 `svgs` 값 확인
2. `server.js` 수정 → `npx playwright test`(legacy)와 `ULP_UI=spa npx playwright test`(spa) 각각 실행
3. `test/e2e/layout.spec.js` 추가 → 두 모드에서 **수정 전 실패**(settings 390px) 확인
4. P1 CSS·TSX 수정 → 두 모드 layout 통과 확인
5. P2 `document.title` 5곳
6. `Main.kt` + `Z4`~`Z6` → `./gradlew test --no-daemon`
7. `ci.yml`, `deploy-cloudrun.yml`, `deploy-cloudrun.sh` 수정
8. `test/rz3_spa.test.js` → `npm test`
9. `docker build -t ulevelp:rz3 .`
   - `docker run -p 3000:3000`: `/`에 `id="root"` 있음, `/assets/index-*.js` 200, csp_check 13개 실패 0
   - `-e ULP_UI=legacy`로 다시 띄워 `/`가 레거시인지 확인
10. 결과 파일·진행 파일 작성 → PR (base `main`)

---

## 6. 체크리스트
- [ ] `Main.kt` SPA 매핑 + `uiMode` 매개변수가 끝에 있고 기본값이 env다
- [ ] `server.js`는 `ULP_UI=spa`일 때만 `dist/`를 서빙한다
- [ ] E2E가 legacy·spa 두 모드 모두 통과(xss 12 + layout 3)
- [ ] csp_check: legacy·spa(server.js)·Docker 컨테이너 3곳 모두 13개 실패 0
- [ ] `./gradlew test`(Z4~Z6 포함), `npm test`(RZ3 포함), `npm run build` 통과
- [ ] Docker: SPA 서빙·롤백 스위치 실측
- [ ] 운영 기본 `ALLOWED_ORIGINS`에 localhost 0건
- [ ] 결과 파일에 롤백 절차 2줄 기재

## 7. 결과 파일
`개발산출물/결과/RZ-3_React전환및보정.md`: 파일 목록, 위 실행 출력(두 모드 E2E, layout 수정 전 실패/후 통과, csp_check 3곳, Docker 2모드, gradle/npm), 롤백 절차, 명세와 달라진 점

## 8. 금지 사항
1. CSP에 `'unsafe-inline'` 추가 금지(vite dev 편의를 위해서라도)
2. `public/*.html`·`public/*.js` 삭제 금지(Pages가 서빙)
3. `server.js` 기본 모드를 spa로 바꾸지 않는다(로컬 `npm start`가 빌드 유무에 따라 몰래 바뀌면 안 된다)
4. 이 명세 밖 화면·기능 수정 금지. 발견한 문제는 결과 파일에 적고 멈춘다
