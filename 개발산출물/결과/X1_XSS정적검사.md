# X1 결과: XSS 정적 검사 + 지금 화면 정리

- 날짜: 2026-10-29, 브랜치 `step/X1` (base `main` = `fefa6ef`, R2 머지 후)
- 입력: `결과/R2_설계개정.md` 7절(CSP 원문·옮길 것·허용 목록), `public/*.html`·`*.js`, `package.json`, docs/03 2.5
- 결과물: `test/security.test.js`(548줄, 의존성 없음), `test/fixtures/xss/` 틀린 예 8개, 이 파일, 확인 도구 `개발산출물/자료/csp_check.js`

## 1. 검사 목록 (`test/security.test.js`)

`npm test`(= `node --test test/*.test.js`)에 그대로 들어가서 CI `test` 작업(Node 20·22)에서 돈다. `package.json`은 바꾸지 않았다.

| 규칙 | 대상 | 내용 |
| --- | --- | --- |
| (a) | `public/*.html` | CSP meta가 정확히 1개, 원문(아래 3절)과 같고, `<link>`·`<script>`보다 앞. inline `<script>` 본문 없음, `on*=`·`style=` 속성 없음, `<style>` 요소 없음. JS로 만드는 HTML 문자열에도 `on*=`·`style=`·`<script` 없음, `setAttribute('style'|'on…')` 없음 |
| (b) | HTML·JS | 외부 `<script src="https://…">`는 `@x.y.z` 정확한 버전 + `integrity="sha384-/sha512-"` + `crossorigin`. 외부 stylesheet도 같은 규칙(Google Fonts 예외). JS로 만드는 `<script>`의 `src` 리터럴은 SRI 예외 목록만 |
| (c) | `public/**/*.js` | HTML 조각(`<`, `>`, `="`)이 든 문자열을 `+`로 이어 붙이는 모든 곳, 그리고 `innerHTML`/`outerHTML` 대입·`insertAdjacentHTML` 둘째 인자: 끼워 넣는 값은 `esc(`·`safeUrl(`·`encodeURIComponent(`·숫자 식·허용 목록만. 삼항·`||`·`&&`·괄호는 안까지 따라가고, `x.map(콜백)[.reverse()…].join()`은 콜백이 돌려주는 식을 검사. 템플릿 문자열로 HTML 만들기·`document.write` 금지 |
| (d) | JS·HTML | `href=`/`src=`(및 `action`·`formaction`·`poster`) 속성 값 안에 이어 붙이는 값, `.href =`/`.src =` 대입, `setAttribute('href'|'src', …)`: `safeUrl(`·`encodeURIComponent(`·`thumb(`(또는 `esc(safeUrl(…))`)·숫자·URL용 허용 목록만. `javascript:`/`data:`/`vbscript:` 리터럴 금지 |
| (e) | JS | `eval(`, `Function` 생성자, 문자열 첫 인자 `setTimeout`/`setInterval` 없음 |
| (f) | `public/` 모든 텍스트 파일 | `sb_secret_`, `service_role`, `ntn_…`, `secret_…`(영숫자 10+), `AIza…`(30+), `ghp_…`(30+), `github_pat_…`(20+). 자리 표시 `github_pat_...`는 안 잡힘 |
| (g) | JS | `localStorage`/`sessionStorage`의 `getItem/setItem/removeItem`, `raw`·`json`·`store` 래퍼의 `get/set` 첫 인자: `ulp:`·`sb-` 접두어 또는 옛 키 허용 목록. 키를 변수로 넘기면 허용 목록 필요. 복사 전용 옛 키는 `theme.js` 밖에 문자열로도 나오면 실패 |

추가 테스트: CSP 원문 자체 점검(`script-src`·`style-src`·`default-src`에 `'unsafe-*'`·`*`·`https:`·`data:`·`blob:` 없음, `object-src`·`base-uri`는 `'none'`), 비밀 정규식이 실제 모양을 잡는지(값은 실행할 때 조립 — 저장소에 비밀 모양을 두지 않으려고), **허용 목록에 안 쓰이는 항목이 있으면 실패**(코드를 지울 때 허용 항목도 같이 빼게 함), 틀린 예 폴더의 파일이 모두 표에 있는지.

구현 방법: 작은 JS 토크나이저(문자열·템플릿·정규식·주석·괄호 짝)로 `+` 이어 붙이기의 범위를 찾고, 리터럴은 글자로·나머지는 표시로 바꿔 이어 붙인 뒤 각 값이 HTML 본문/URL 속성/`on*` 속성 중 어디에 들어가는지 판단한다.

### 검사의 한계 (X2가 메움)

- 변수 흐름은 따라가지 않는다. `const h = ext; el.innerHTML = h`처럼 변수를 거치면 `h`가 허용 목록에 없을 때만 잡힌다(허용 목록의 `h`는 `app.js`에서만).
- 문자열 리터럴 없이 숫자와 더하는 `(i + 1)`·`(T + GAP * 2)`는 숫자로 본다. `(ext + 1)`은 놓친다.
- `.map(콜백)`의 블록 본문은 안에 있는 모든 `return`을 검사한다(안쪽 함수의 `return`까지 — 더 엄격한 쪽).
- DOM 메서드 `append`·`textContent`는 안전해서 보지 않는다. `srcdoc`·`Range.createContextualFragment`·`DOMParser`는 검사하지 않는다(지금 코드에 없음).

## 2. 허용 목록과 이유 (테스트 안 `HTML_ALLOW`·`STORAGE_LEGACY`·`STORAGE_ARG_ALLOW`)

줄 번호는 편집할 때마다 밀려서 **파일 + 식(정규식)** 으로 맞춘다(진행 파일 X1의 "파일·줄"에서 바꿈). `kind`가 `html`인 허용은 href·src에는 통하지 않는다.

| 파일 | kind | 식 | 이유 |
| --- | --- | --- | --- |
| `app.js` | html | `x`·`y`·`f`·`s`·`i`·`T`·`L`·`R`·`W`·`H`·`C`·`VW`·`GAP`·`xL`·`mid`·`rx`·`width`·`height`·`start`·`idx`·`iv`·`ci`·`pi`·`key`·`outs`·`x.i`·`p.d`·`m.f`·`n.f`·`m.pitch`·`open[m.s]`·`mx.span`·`k.key`·`xOf(…)`·`yOf(…)`·`fx(…)` | 지판 SVG 좌표·프렛·인덱스 숫자 |
| `app.js` | html | `NOTE[…]`(+`.replace`), `n`, `CT.TOP_DEG[iv]`, `CT.strName(…)`, `GE.fretStr(…)`, `fretText(…)`, `DOT_CLS(m|n)`, `cls`, `n.cls`, `q.id`, `s.id`, `t.id`, `g.F.label`, `p.ro.r` | 음이름·도수·코드 id·클래스 이름 상수 |
| `app.js` | html | `h`, `fretboard(…)`·`neck(…)`·`chordNeck(…)`·`box(…)`·`wheel(…)`·`scWheel(…)`·`rect(…)`·`cell(…)`·`row(…)`, `cells.join('')` | 같은 파일에서 이 검사를 통과한 이어 붙이기로 만든 SVG/HTML |
| `notes.js` | html | `cls`, `label` | `badge()`가 돌려주는 고정 값 |
| `practice.js` | url | `t.url` | `URL.createObjectURL`로 만든 `blob:` 주소 |

코드 연습실(`chords.html`·`app.js`)은 외부 입력이 없다(모든 값이 `lib/theory.js`·`voicing.js` 상수와 계산). 외부에서 오는 텍스트(곡 제목·노션 값·GitHub 응답·URL)는 모두 `home.js`·`notes.js`·`practice.js`에 있고, 거기에는 허용 목록이 `cls`·`label`·`t.url`뿐이다.

저장소 키:

| 옛 키 | 지우는 step | 이유 |
| --- | --- | --- |
| `pp:v:*` (접두어) | P1-2 | 비로그인 기기 기록. P1-2에서 `ulp:v:`, P1-4 가져오기에서 읽기만 |
| `pp-api`, `pp-key` | P4-5 | Apps Script 칸, `practice.html#api=` |
| `sn-token`, `sn-repo` | P5-3 | 학습 노트 칸 |
| `gv-theme`, `gv-tab`, `pp-lead`, `ul-notion-practice`, `ul-notion-notes` | 지우지 않음 | `theme.js`에서만(처음 한 번 복사). guitar-practice가 같은 Origin에서 씀 |

키를 변수로 넘기는 곳: `site.js`·`practice.js`의 `k`(래퍼 안), `theme.js`의 `from`·`to`(복사 표).

## 3. CSP 원문 (모든 `public/*.html`, `<meta charset>` 바로 다음 줄)

R2 결과 7.2 그대로. 테스트의 `CSP` 상수가 원본이고 HTML과 글자까지 같아야 한다.

```
default-src 'self'; script-src 'self' https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js https://www.youtube.com/iframe_api https://www.youtube.com/s/player/; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://i.ytimg.com; media-src 'self' blob:; connect-src 'self' https://vefrfhafmiiivpgjhqiu.supabase.co https://script.google.com https://script.googleusercontent.com https://api.github.com; frame-src https://www.youtube.com; object-src 'none'; base-uri 'none'; form-action 'self'; worker-src 'none'
```

**다음 step에서 CSP를 늘리는 법:** `test/security.test.js`의 `CSP` 배열과 HTML 5개의 meta를 같이 고친다(테스트가 둘이 다르면 실패). 외부 스크립트(supabase-js, JSZip)는 `<script src="…@x.y.z/…" integrity="sha384-…" crossorigin="anonymous" defer>`로 넣으면 (b)를 통과한다. 늘리는 순서는 docs/03 2.3 표.

## 4. 바꾼 화면 코드

| 파일 | 바뀐 것 |
| --- | --- |
| 새 `theme.js` | 모든 HTML `<head>`에서 `defer` 없이. 옛 키 5개를 `ulp:`로 **처음 한 번** 복사(새 키가 비어 있을 때만, 옛 키는 지우지 않음, 끝나면 `ulp:copied=1`) 후 `ulp:theme` 적용. 예전 inline 테마 한 줄을 대신함 |
| 새 `home.js` | `index.html` inline 스크립트 그대로 + `gv-tab`→`ulp:tab`, `ul-notion-*`→`ulp:notion-*`, 노션 링크 `safeUrl`(https 아니면 숨김), `practice.html?v=`·`chords.html#`에 `encodeURIComponent`, `songsNote(t, href)` → `songsNote(t, toSettings)`(href를 고정 문자열로), 엔터 이동 `location.href = …` → `$('goPlay').click()` |
| 새 `notes.js` | `notes.html` inline 스크립트 그대로 + `notes.html:142` 영상 링크·실행 로그 링크 `esc(safeUrl(…))`, `ago()` 결과 `esc`, `practice.html?v=`에 `encodeURIComponent`, 노션 링크 `safeUrl` |
| 새 `settings.js` | `settings.html` inline 스크립트 그대로 + `gv-theme`·`ul-notion-*` → `ulp:` 키 |
| `site.js` | `safeUrl(u)` 추가(`new URL` → `https:`면 `href`, 아니면 `''`), `UL.safeUrl`로 내보냄 |
| `app.js` | 줄 굵기 `style="stroke-width:…"` 2곳 → SVG 속성 `stroke-width="…"`(`.str`에 CSS stroke-width 없음 확인). `gv-tab`·`gv-theme` → `ulp:tab`·`ulp:theme` |
| `chords.html` + `styles.css` | `style="gap:10px"` → `.quiz > .field { gap: 10px; }` |
| `practice.js` | `pp-lead` → `ulp:lead` |
| HTML 5개 | CSP meta, `theme.js`, 화면 스크립트를 `<script src>`로 |

inline 스크립트 옮기기는 원본과 diff해서 위 의도한 줄만 다른 것을 확인했다.

**공통 파일(D17):** `app.js`·`chords.html`·`styles.css`의 `style=` 수정은 커밋 `c5e7ee2`(그 세 파일만)로 따로 뒀다 → guitar-practice에서 `git cherry-pick c5e7ee2` 가능(guitar-practice도 CSP를 넣으면 필요). `app.js`의 키 이름(`ulp:tab`·`ulp:theme`) 3줄은 ULevelP 전용이라 그 뒤 커밋에 있고, guitar-practice 쪽 `app.js`와는 이 3줄만 다르다. 사용자가 알아챌 차이가 아니라 `공통기능_변경기록.md`는 만들지 않았다.

## 5. 검증 (실제 실행)

### 5.1 `npm test`

```
✔ (a) public/: CSP meta·inline 스크립트·on*·style 속성 없음
✔ (b) public/: 외부 스크립트는 정확한 버전 + SRI
✔ (c) public/: HTML에 끼우는 값은 esc 등
✔ (d) public/: href·src 값은 safeUrl 등
✔ (e) public/: eval·Function·문자열 setTimeout 없음
✔ (f) public/: 비밀 값 모양 없음
✔ (g) public/: 저장소 키는 ulp:/sb- 또는 옛 키 허용 목록
✔ 허용 목록에 안 쓰이는 항목이 없다 (지운 코드의 허용 항목은 같이 뺀다)
✔ 틀린 예 bad-a.html → (a) 검사가 실패한다   … bad-g.js까지 8개
ℹ tests 32
ℹ pass 32
ℹ fail 0
```

### 5.2 틀린 예 (`test/fixtures/xss/`) — 테스트가 "그 검사가 실패함"을 확인

| 파일 | 규칙 | 잡아야 하는 것 |
| --- | --- | --- |
| `bad-a.html` | a | CSP meta 0개, inline `<script>`, `onclick`, `style` 속성 |
| `bad-a.js` | a | JS HTML의 `style=`·`onerror=`, `setAttribute('style')` |
| `bad-b.html` | b | 버전 없는 jsDelivr 스크립트, integrity·crossorigin 없음 |
| `bad-c.js` | c | `'<li>' + song.title`, `innerHTML = note.text`, `innerHTML = rows.join('')` |
| `bad-d.js` | d | `href="' + esc(url)`(esc만으로는 안 됨), `link.href = data.url`, `'javascript:…'` |
| `bad-e.js` | e | 문자열 `setTimeout`, `eval`, `new Function` |
| `bad-f.js` | f | `service_role` |
| `bad-g.js` | g | 접두어 없는 `my-theme`, `theme.js` 밖의 `gv-theme`, 변수 키 |

### 5.3 실제 코드를 일부러 망가뜨리면 실패하는지 (확인 후 원래대로 되돌림)

```
home.js  esc(s.title) -> s.title                 → (c) public/home.js:40 HTML에 esc 없이 넣음: s.title
notes.js esc(safeUrl(r.html_url)) -> esc(r.html_url) → (d) public/notes.js:94 URL에 safeUrl/encodeURIComponent/thumb 없이 넣음: esc(r.html_url)
app.js   esc(o.label) -> o.label                 → (c) public/app.js:635 HTML에 esc 없이 넣음: o.label
app.js   esc(x.degs[k]) -> x.degs[k]             → (c) public/app.js:563 HTML에 esc 없이 넣음: x.degs[k]
home.js  $(id).href = safeUrl(href) -> … = href  → (d) public/home.js:50 URL에 … 없이 넣음: href
practice.js store.get('ulp:lead') -> 'pp-lead'   → (g) public/practice.js:39 옛 키 pp-lead는 public/theme.js에서만
```

### 5.4 브라우저 CSP 확인 (로컬 `npm start`, `node 개발산출물/자료/csp_check.js`)

헤드리스 Chrome 156으로 화면을 열어 `securitypolicyviolation` 이벤트·콘솔 `Refused to`·스크립트 오류를 모았다(CDP로 넣는 감시 스크립트는 페이지 CSP를 받지 않음).

```
[OK] 옛 키 복사(theme.js) (index.html)
  값: {"theme":"dark","copied":"dark","tab":"matrix","lead":"2","oldKept":"dark","flag":"1","practiceLinkHidden":true,"notesLink":"https://www.notion.so/x","cur":"chords.html#matrix"}
[OK] 첫 화면 링크 붙여넣기 (index.html)          값: {"thumb":"https://i.ytimg.com/vi/jNQXAC9IVRw/mqdefault.jpg","play":"practice.html?v=jNQXAC9IVRw"}
[OK] 첫 화면 + Apps Script 연결(connect-src)     값: {"songs":"Failed to fetch"}   ← 가짜 배포 주소라 CORS 실패, CSP 위반 아님
[OK] 코드 연습실 전체 탭 (chords.html)            값: {"svgs":130,"strokeAttr":true,"styleAttr":0}
[OK] 플레이어 + 유튜브 (practice.html?v=…)        값: {"iframe":true,"title":"Me at the zoo"}
[OK] 학습 노트 + GitHub API(connect-src)          값: {"preview":"https://i.ytimg.com/…","runs":"토큰이 잘못됐거나 만료됐어요. (401 Bad credentials)"}
[OK] 설정 + 테마 버튼 (settings.html)             값: {"theme":"light","saved":"light","old":null}
[OK] 대조군(막혀야 함): example.com fetch → connect-src 위반, style 속성 → style-src 위반 (검출기 동작 확인)
화면 8개 중 실패 0개
```

각 화면 줄에는 `CSP 위반: 없음 | 콘솔 Refused: 없음 | 오류: 없음 | __xss: false`가 찍혔다. `ul-notion-practice`에 넣은 `javascript:` 주소는 링크가 숨겨졌다.

### 5.5 아직 못 한 것

- **Pages 배포본 CSP 확인:** Pages는 main 머지 후에만 배포된다. 머지 뒤 `node 개발산출물/자료/csp_check.js https://hunseokc.github.io/ULevelP/`로 확인한다(진행 파일 7절 시작 지시에 넣음). Z1에서도 다시 돈다.
- 실제 노션(Apps Script) 응답이 있는 상태의 화면은 확인하지 않았다(가짜 주소). `connect-src`의 두 주소는 R2 7.2 그대로이고, 리다이렉트 주소(`script.googleusercontent.com`)도 들어 있다. 소유자 기기에서 첫 화면 곡 목록이 뜨는지 한 번 보면 된다.

## 6. 다음 step 메모

- **P0-5:** supabase-js를 `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@<버전>/dist/umd/supabase.js" integrity="sha384-…" crossorigin="anonymous" defer>`로 넣고, 테스트 `CSP` 배열 + HTML 5개 meta에 `script-src` 경로·`connect-src` Supabase 주소를 같이 추가. 새 `auth.js`의 외부 텍스트(이메일·이름)는 `textContent`로.
- **P1-2:** `pp:v:` → `ulp:v:`로 바꾸면 테스트의 `STORAGE_LEGACY` `pp:v:` 항목은 P1-4 가져오기 코드가 읽는 동안 남긴다(쓰는 곳이 없어지면 낡은 항목 검사가 알려 줌).
- **화면 step(P2-1~):** 새 화면 스크립트는 처음부터 별도 `.js`, 외부 값은 `esc`/`textContent`, 링크는 `safeUrl`. 허용 목록을 늘려야 하면 이 파일 2절 표도 같이 고친다.
- **P4-5·P5-3:** `pp-api`·`pp-key`·`sn-token`·`sn-repo`를 코드에서 지우면 `STORAGE_LEGACY`에서도 빼야 테스트가 통과한다. CSP `connect-src`에서 Apps Script·`api.github.com`도 뺀다.
- **X2:** 위 한계(변수 흐름 등)는 페이로드 테스트가 메운다. `csp_check.js`의 화면 목록·대조군을 Playwright로 옮기면 된다.
