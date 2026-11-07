# CH-7 결과 — 노션 push 폐기 (문서 정리 + V3 노션 CHECK 삭제)

- 날짜: 2026-11-05 (mac)
- 입력: 사용자 결정(2026-11-05 "노션 push 폐기, 앞으로 노션 연동 기능 중단, 이미 만든 기능은 앱_명세 §5대로 은닉"), `계획/앱_명세.md` §5
- 상태: **완료** — 로컬 확인(아래 §3) + PR #63 CI 전부 통과 — Node 22·24·Kotlin·E2E spa·legacy·Docker, run 41856272082, head `b7a1c04`
- 처음 계획한 CH-7(노션 push: `코드 진행` DB ID, outbox `progression`, 템플릿 매핑)은 **하지 않는다**. 결과 파일 `CH-7_노션push.md`도 만들지 않음

## 1. 바꾼 것

| 파일 | 내용 |
| --- | --- |
| `src/main/resources/db/migration/V3__progressions.sql`, `docs/04-db-design.md` | **(스키마, 사용자 승인)** `notion_links`·`sync_outbox` entity CHECK에 `'progression'`을 넣던 4줄 삭제 → 두 표의 entity는 V1 그대로(`song·session·take·note`). 운영 DB에 V3가 아직 안 들어가 V3를 직접 고침(새 V4 불필요). 로컬에 옛 V3를 적용한 DB가 있으면 체크섬이 달라 Flyway가 멈춘다 → 그 DB는 지우고 다시 만든다(테스트는 매번 새 컨테이너라 상관없음) |
| `src/test/kotlin/ulevelp/db/DatabaseMigrationAndIntegrityTest.kt` | "outbox에 progression 허용" → **"progression·chord 둘 다 거부(23514)"** |
| `결과/CH-1b_설계.md` | §1 #1 entity CHECK 행·§2 SQL 4줄 삭제, §3-4·§3-7·§7을 "2026-11-05 폐기" 한 줄로, §9 CH-7 행 교체, Q1·Q2 문구. "노션 Scale/템플릿 규칙" 표현 → `KEYS` 24개 |
| `결과/CH-0_범위확정.md` | 노션 push 결정 → 폐기로, §4 템플릿 매핑 표·문구 정정 → 폐기 한 줄, 1차 제외의 "노션→앱 pull" 삭제 |
| `결과/CH-2·CH-3·CH-5·CH-5b·CH-6` | CH-7(노션)로 넘긴 항목 삭제, "노션 Scale" → `KEYS` |
| `docs/ULevelP 코드 진행 기능 기획 메모.md` | "노션에서 바로 수정" → "수정은 앱(CHORDS)에서" |
| `계획/앱_명세.md` | §5에 2026-11-05 결정(노션 연동 신규 구현 전면 중단, 기존은 원칙 1·2) 박스, M2-3의 "노션 설정 접이식 은닉" → CH-7b에서 먼저 완료 |
| `계획/l1_1.md`, `계획/언어지원_계획.md` | 노션 속성명 번역·호환 조항 → "노션은 동결, 노션 관련 코드·속성명은 건드리지 않음" |
| 코드 주석 | `roman.mts`·`model.mts`·`stats.mts`의 "노션 Scale/템플릿/multi_select" 표현 정리(동작 불변) |

- **안 바꾼 것**: 키 철자 규칙(`KEYS` 24개, 서버 정규화 `C# Major`→`Db Major`)·로마숫자 규칙 — 앱 규칙으로 남김. 노션 백엔드(`NotionPushWorker`·`NotionSyncService`·`IntegrationService`)는 앱_명세 §5 원칙 1대로 **동결**(삭제 안 함)
- `계획/` 폴더는 이번에 처음 git에 올림(사용자 승인 — 다른 PC에서 보이게)

## 2. 다음 step이 쓸 값

- 진행(`progression`)은 노션 대상이 아니다. 앞으로 새 도메인도 노션 매핑을 만들지 않는다

## 3. 실행 결과 (로컬, mac)

```
./gradlew test --rerun-tasks      219 tests, 0 fail
```

- 첫 실행에서 `NotionPushApiTest` NP8(429 Retry-After 재시도) 1개가 `노션 오류: 400`으로 실패 → 이번 변경과 무관(V3 CHECK·DB 테스트만 바꿈). 그 테스트만 2회 + 전체 재실행 모두 통과 → **가끔 실패하는 테스트**로 진행 파일 §5에 기록
