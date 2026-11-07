# CH-7b 결과 — 이미 만든 노션 기능 은닉 (앱_명세 §5 원칙 2)

- 날짜: 2026-11-05 (mac)
- 입력: `계획/앱_명세.md` §5, `결과/CH-7_노션폐기.md`
- 상태: **완료** — 로컬 §3 + PR #63 CI 전부 통과 — Node 22·24·Kotlin·E2E spa·legacy·Docker, run 41856272082, head `b7a1c04`
- 백엔드는 그대로(동결). 웹·앱 공통으로 화면에서만 숨긴다. 이미 노션을 쓰는 사용자는 고급 설정에서 그대로 관리할 수 있다

## 1. 바꾼 것

| 화면 | 내용 |
| --- | --- |
| 설정 `SettingsPage.tsx`·`.module.css` | 맨 아래 새 섹션 `#advanced` → **`<details id="advNotion">` "고급 설정 › 웹/노션 연동 (선택)", 기본 접힘**. 안으로 옮김: 노션 템플릿 복제(`#btnNotionTemplate`), 노션 연동 카드(키·DB ID·실시간 연동·pull/push, 새 id `#notion`), 노션 백업 가져오기(`#inpImportZip`…), 노션 바로가기(`#links`, h2→h3). 해시 `#advanced`·`#notion`·`#links`로 들어오면 펼친 채로 열림 |
| 설정(밖에 남김) | `#nx` = "데이터 백업"(ZIP 내보내기, "노션 호환 ZIP" → "백업 ZIP"), `#keys` 설명에서 노션 문구 삭제(Gemini만). Drive 충돌 안내(`#driveConflictNotice`)는 실시간 연동이 켜진 사용자에게만 보이므로 그대로 |
| 홈 `HomePage.tsx` | 큰 `NOTION` 링크(`#notionBig`)는 **노션 주소가 있을 때만**(없으면 `hidden`, 설정 유도 없음). PLAYER 칸 머리의 "노션 연결 →" → "곡 보관함 →"(`log.html#songs`) |
| 연습 `PracticePage.tsx`·`.module.css` | 곡 서랍 아래 "노션 연결 설정 →" 링크와 CSS 삭제 |
| 노트 `NotesPage.tsx` | 안내 "…노션에 자동 정리해요" 삭제("노션에서 보기"는 주소가 있을 때만 — 기존 동작) |

- 모든 id는 유지(옛 화면 `public/*`과 공유하는 정적 검사 그대로 통과). 옛 화면(`public/`)은 동결이라 안 고침

## 2. 테스트

- 단위 `r1_settings_notes` 새 테스트 1개: 노션 요소 6개가 `advNotion` 안, 고급 설정은 화면 섹션 뒤, 백업 ZIP은 밖, 기본 접힘·해시 펼침, 홈 NOTION `hidden={!mainNotionUrl}`, 연습·노트 화면 노션 유도 문구 없음
- e2e `settings-spacing`: 기본 접힘(`#ntnToken` 안 보임) → 펼친 뒤에도 간격 규칙(6·12·16) 검사. 접힘 안은 `.advBody`(세로 16px)로 감쌌다 — 처음엔 details 자식에 margin을 줘서 접힌 상태 측정이 0px로 잡혀 실패
- e2e `xss` E8(노션 백업 미리보기)·E9(연동 키 상태)는 `settings.html#advanced`로 열어 펼친 채 검사

## 3. 실행 결과 (로컬, mac)

```
npm run build / tsc                 통과
npm test                            383 pass (CH-7c 포함)
ULP_UI=spa CI=1 npx playwright test 74 passed
ULP_UI=legacy CI=1 npx playwright test 16 passed, 58 skipped
```

- 겪은 문제: 설정 파일에 `npx prettier`를 돌렸더니 설정 파일이 없어 기본값으로 파일 전체(1747줄)를 다시 포맷 → 되돌리고 변경만 다시 적용. 남은 diff가 큰 것(공백 무시 267/247줄)은 블록 4개를 옮기면서 들여쓰기가 바뀐 탓
