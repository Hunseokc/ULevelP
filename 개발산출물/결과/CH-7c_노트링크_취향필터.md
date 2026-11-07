# CH-7c 결과 — 진행 연주 링크의 원본 노트(n=) + 취향 통계 줄로 목록 거르기

- 날짜: 2026-11-05 (mac)
- 입력: `결과/CH-5b_연습실연동.md` §6 제안(n=), `결과/CH-6_취향진행.md` §6 제안(통계 줄 필터), 사용자 요청 2026-11-05
- 상태: **완료** — 로컬 §3 + PR #63 CI 전부 통과 — Node 22·24·Kotlin·E2E spa·legacy·Docker, run 41856272082, head `b7a1c04`

## 1. 만든 것

| 영역 | 내용 |
| --- | --- |
| 링크 형식(확정 형식에 추가 — 사용자 요청을 승인으로 봄) | `playHref(p)`: `p.noteId`가 UUID면 **`&n=<노트 id>`** 추가 → `chords.html#prog?c=…&k=…&t=…&from=<진행 id>&n=<노트 id>`. `parseProgHash`가 `note`(UUID만, 아니면 `''`)를 돌려줌 — `ProgHash`에 `note` 필드 |
| 진행 연주 탭 | `n`이 있으면 안내 줄(`#pp-note-hint`)에 **"원본 노트에서 보이싱 보기 →"**(`#pp-note-link` → `note.html?id=<n>`), 없으면 옛 안내 그대로. URL에 악기 정보는 없어 문구는 "영상 속 보이싱(건반 영상이면 건반 보이싱)" |
| 입구 | 진행 행 "연습실…" 버튼·저장 직후 안내·CHORDS 꺼낸 진행·홈 취향 카드가 모두 `playHref(p)`라 자동으로 `n` 포함(시드는 노트가 없어 없음) |
| 통계 → 목록 | `stats.mts` 새 export `sequenceOf(label)`·**`hasSequence(p, label)`**: "I - V - vi"(묶음)·"I → V"(이동)를 칸 이름(로마숫자 우선, 없으면 심볼) 열에서 이어서 찾음 |
| CHORDS 화면 | 취향 패널 "자주 나오는 진행"·"코드 이동" 줄이 버튼(`aria-pressed`). 누르면 목록이 그 묶음이 든 진행만(`#progTasteFilter` "X 묶음/이동이 들어 있는 진행만 보는 중" + `#progTasteFilterClear` 해제), 같은 줄을 다시 누르면 해제, 범위를 바꾸면 해제. 검색·정렬과 같이 적용("N개 중 M개"), 목록 도구 쪽으로 스크롤 |

## 2. 파일

- 고침: `frontend/src/components/progressions/model.mts`, `frontend/src/components/chords/ProgressionPlayTab.tsx`, `frontend/src/lib/chords/stats.mts`, `frontend/src/components/progressions/TastePanel.tsx`·`Progressions.module.css`, `frontend/src/pages/ProgressionsPage.tsx`, `test/ch5b_progression_play.test.js`(`note: ''` 기대값), `test/e2e/progressions.spec.js`(P13·P14)
- 새: `test/ch7c_note_link_taste_filter.test.js`(9개)

## 3. 실행 결과 (로컬, mac)

```
node --test test/ch7c_note_link_taste_filter.test.js   9 pass
npm test                                               383 pass (374 + 9)
ULP_UI=spa CI=1 npx playwright test                    74 passed (P13·P14 포함)
```

- 단위: `n` 왕복·노트 없는/시드 진행은 `n` 없음·**잘못된 `n`**(`"><script>`, `123`, `not-a-uuid`) 버림 / `hasSequence` 묶음·이동·심볼 대체·떨어진 순서·빈 입력·null 행 / 통계 줄 이름 그대로 넣으면 그 줄을 센 진행이 걸림
- e2e P13: 묶음 `I - V - vi - IV` → 3개 중 2개, 다시 누르면 해제, 이동 `IM9 → vim9` → 1개, 검색과 같이 → 맞는 진행 없음, 해제 버튼, 범위 바꾸면 해제. P14: AI 행 연습실 링크 `&n=<노트 id>` → 진행 연주 탭 `#pp-note-link` = `note.html?id=…`, 시드 진행은 링크 없음
