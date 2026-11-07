# G-4a 결과: 홈 분류 바로가기 + 분류 관리 팝업

- **날짜:** 2026-11-04 · **브랜치:** `feat/song-genre` (base `main`)
- **설계:** `개발산출물/결과/G-3c_분류설계.md` §3, API는 `결과/G-3d_분류백엔드.md` §2

## 1. 바뀐 파일

| 파일 | 내용 |
| --- | --- |
| `frontend/src/lib/genres.ts` → `frontend/src/lib/categories.ts` (git mv) | 고정 `GENRES`·기기 저장(`ulp:home-genres`) 삭제. `CATEGORY_NAME_MAX`(20), `homeCategories(list)`, `setOpenCategory/takeOpenCategory`(sessionStorage `ulp:open-category`, take는 G-4b용 stub) |
| `frontend/src/lib/apiClient.ts` | `CategoryDto`, `apiClient.categories.{list,create,update,reorder,remove}`, `songs.update(id, { categoryIds })` |
| `frontend/src/lib/security.ts` | 저장 키 타입에서 `ulp:home-genres` 제거 |
| `frontend/src/pages/HomePage.tsx` | `GenreShortcuts` → `CategoryShortcuts({ uid })` |
| `frontend/src/pages/HomePage.module.css` | 안내 칸·이름 말줄임·추가 입력·오류·삭제 확인·팝업 280px·목록 최대 240px 스크롤 (클래스 이름은 `genre*` 그대로) |
| `test/e2e/home-genre.spec.js` → 삭제, `test/e2e/home-category.spec.js` (새) | C4a-1~6 |
| `test/e2e/home-align.spec.js` | H4 짝 `#genreRow` → `#categoryRow` |

## 2. 화면 동작 (G-4b가 알아야 할 것)

- 줄 id `#categoryRow`, 분류 링크 `a[data-category=<id>]`(href `practice.html`, 누르면 `setOpenCategory(id)`), 설정 버튼 `#categorySettingsBtn`, 팝업 `#categorySettings`, 안내 `#categoryHint`
- 비로그인: 줄 전체에 "로그인하면 곡을 분류할 수 있어요"(+ 없음). 로그인 + 분류 0개: "+를 눌러 분류를 만들어 보세요". 모두 꺼짐: "홈에 보일 분류를 켜 주세요". 목록 실패: "분류를 불러오지 못했어요"
- 팝업: 추가(빈 이름은 보내지 않음, 서버 409 문구 표시) · 체크=홈 표시 · ✎ 이름 바꾸기(Enter/blur 저장, Esc는 편집만 취소) · ▲▼ 순서(PUT order) · × 삭제(한 번 더 눌러 확인). 실패하면 `#categoryError`에 문구 + 서버 목록으로 되돌림
- 플레이어 쪽은 아직 아무것도 읽지 않는다: `takeOpenCategory()`는 G-4b에서 `PracticePage`가 호출

## 3. 검증 (실행 출력)

- `npm run build`(tsc + vite) → `✓ built in 872ms`
- `npm test` → `tests 140, pass 140, fail 0`
- `npx playwright test`(전체, `ULP_UI=spa node server.js`) → `46 passed (1.1m)`. 팝업 목록 최대 높이 추가 뒤 `home-category`+`home-align` 재실행 → `20 passed`
- 스크린샷 1280·390(로그인, 분류 4개, 팝업 열림): 줄·팝업 넘침 없음, 긴 이름은 말줄임. × 글자에 보이는 파랑/주황은 ClearType 글자 번짐(실제 색 아님)

## 4. 참고
- e2e 분류 API는 `home-category.spec.js`의 `fakeCategoryStore()`(테스트 프로세스 메모리라 새로고침해도 유지)
- `getByLabel('분류 이름')`은 "새 분류 이름"에도 걸린다 → `{ exact: true }`
