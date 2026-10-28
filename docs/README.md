# ULeveLP 다음 단계 문서

ULeveLP를 **누구나 로그인해서 쓰는 서비스**로 바꾸기 위한 기획·요구사항·설계 문서입니다. 이 폴더만 읽고 구현할 수 있도록 썼습니다. 2026-10-28 기준이고, 아직 구현은 시작하지 않았습니다.

| 문서 | 내용 |
| --- | --- |
| [01-plan.md](01-plan.md) | 기획: 배경, 목표, 사용자, 결정 사항과 그 이유, 단계별 일정 |
| [02-requirements.md](02-requirements.md) | 요구사항: 기능 요구사항(ID, 인수 조건), 비기능 요구사항 |
| [03-design.md](03-design.md) | 설계: 구성, 인증, 저장, 노션 템플릿·내보내기·가져오기·연동, Gemini, 화면, 외부 설정 |
| [04-data-model.md](04-data-model.md) | DB 모델: 테이블 DDL, RLS, 함수, 저장소 정책, 노션 속성 대응표, CSV 형식 |

읽는 순서는 01 → 02 → 04 → 03입니다. 구현은 [01-plan.md의 단계](01-plan.md#7-단계별-일정)를 따릅니다.

## 지금 코드의 위치 (as-is)

| 경로 | 역할 |
| --- | --- |
| `public/index.html` | 첫 화면 (링크 붙여넣기, CHORDS·PLAYER 프레임) |
| `public/chords.html`, `app.js`, `lib/*.js` | 코드 연습실. 계산은 전부 브라우저에서 함 |
| `public/practice.html/.js/.css` | 유튜브 구간 연습 플레이어, 녹음. 노션 링크가 이 주소를 씀 (이름 바꾸지 말 것) |
| `public/notes.html` | 학습 노트 요청 (GitHub Actions 실행) |
| `public/settings.html`, `site.js`, `site.css` | 설정, 공통 메뉴·호출 |
| `apps-script/Code.gs` | 노션 중계 서버 (Google Apps Script). `/songs` `/song` `/save` `/record` `/health` |
| `scripts/analyze.py`, `schemas.py`, `guitar.py`, `keyboard.py` | Gemini 영상 분석 → 노션 페이지 (GitHub Actions `analyze.yml`) |
| `server.js` | 로컬 개발용 정적 서버 + 코드 계산 API. Docker 이미지도 이것 |
| `DESIGN.md` | 디자인 규칙. 새 화면도 이 규칙을 따름 |
