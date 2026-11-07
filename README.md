# ULeveLP

코드 연습, 유튜브 구간 연습, 녹음·연습 기록, 학습 영상 노트를 한곳에 모은 웹 서비스입니다. 구글 로그인으로 쓰고, 연습 기록은 노션으로 내보냅니다.

**서비스:** https://ulevelp-d5ympfsmfq-du.a.run.app

- 화면: React + TypeScript(Vite 빌드)
- 서버: Kotlin Ktor, Google Cloud Run 컨테이너 1개가 화면과 API를 같이 서빙합니다
- 인증·DB·녹음: Supabase(Google OAuth, PostgreSQL, Storage), 녹음은 Google Drive 연결 시 사용자 드라이브에 저장
- 외부 연동: 노션(연습 곡·기록·학습 노트 push), Gemini(학습 노트 분석, 사용자 본인 키)

> GitHub Pages(`hunseokc.github.io/ULevelP`)는 폐지되었고, 옛 주소는 위 서비스의 같은 화면으로 이동합니다(쿼리 유지). 노션 임베드 안에서는 이동하지 못하므로 임베드 대신 링크를 쓰세요.

| 화면 | 하는 일 |
| --- | --- |
| `/` (`index.html`) | 홈. 유튜브 링크 붙여넣기, 주간 스트릭, 최근 연습 곡, BETTER(연습) · VAULT(학습) 대시보드 |
| `/chords.html` | 코드 연습실 (아래 탭 7개) |
| `/practice.html` | 유튜브 구간 연습 플레이어 + 녹음. 노션 "이어서 연습" 링크가 이 주소를 쓰므로 이름을 바꾸지 마세요 |
| `/log.html` | 기록: 12주 달력, 곡 보관함, 곡 상세(녹음 A/B 비교) |
| `/notes.html`, `/note.html` | 학습 영상 노트 목록·상세 (Gemini 분석) |
| `/settings.html` | 계정, 노션·Gemini·Google Drive 연결, 화면 모드 |
| `/privacy.html` | 개인정보처리방침 |

설계 문서(기획·요구사항·API·DB)는 [docs/](docs/README.md), 진행 기록과 다음 할 일은 [개발산출물/인수인계_메모.md](개발산출물/인수인계_메모.md)에 있습니다. 디자인 규칙(색·곡률 토큰)은 `frontend/src/styles/tokens.css`.

## 로컬 실행

필요: Node 22, JDK 21 (Docker만 쓸 때는 Docker만).

```bash
npm ci
npm test                 # 프런트 단위·정적 보안 테스트
./gradlew test           # Kotlin 서버 테스트
npm run test:e2e         # Playwright (XSS·CSP·레이아웃)
```

### 화면만 확인 (DB 없이)

```bash
npm run build
ULP_UI=spa node server.js     # http://localhost:3000 — React 빌드 + 코드 계산 API
node server.js                # 같은 주소, 옛 화면(public/*.html)
```

`server.js`는 화면·계산 API만 있는 테스트용 서버입니다. 로그인·곡·녹음·노션 API는 Ktor 서버에만 있습니다. `npm run dev:client`(vite dev)는 CSP와 CommonJS 변환 문제로 화면 확인에 쓰지 않습니다.

### 전체 서버 (Docker)

```bash
cp .env.example .env          # Supabase·DB 값 채우기
docker build -t ulevelp .
docker run --env-file .env -p 3000:3000 ulevelp
```

`ULP_UI=legacy`를 주면 React 대신 옛 화면을 서빙합니다(운영 롤백 스위치).

## CI / 검증

main에 머지되거나 PR이 생성되면 GitHub Actions CI(`ci.yml`)가 프론트엔드 단위/정적 테스트, Kotlin 서버 테스트, Playwright E2E(XSS·CSP·레이아웃), Docker 빌드 및 스모크 테스트를 자동으로 검증합니다.

롤백: `gcloud run services update ulevelp --region asia-northeast3 --update-env-vars ULP_UI=legacy`

## 코드 연습실 (`chords.html`)

| 탭 | 하는 일 |
| --- | --- |
| 1 · 스케일 연습 | 지판 전체 스케일(음이름/도수), 기타 6·7현·베이스 4·5·6현, 왼손잡이 반전, 5도권(4도권) 12키 순환, CAGED 5블럭 시퀀스 재생 |
| 2 · 코드톤 지도 | 줄당 코드톤 2개 아르페지오, maj7 → 7 → m7 → m7(b5) → dim7 변환 시 움직인 음 표시 |
| 3 · 보이싱 매트릭스 | 드롭(Close, 2, 3, 4, 2&4, 2&3) × 전위 × 줄 세트 × 9개 성질 |
| 4 · 탑노트 5도권 | 탑노트를 고정하고 근음을 5도씩 내리며 텐션 역할 변화 연습 |
| 5 · 코드 재해석 | 지판에 찍은 음 배열을 여러 코드로 재해석, 퀴즈 |
| 6 · 2-5-1 탐색 | 프렛 창(+펜타토닉) 안에서 가이드톤 이동이 짧은 ii-V-I 보이싱 |
| 7 · 더블 스탑 연습 | 3도·6도·4도 더블 스탑, 두 음 동시 재생 |

소리는 브라우저(Web Audio)에서 합성하므로 첫 재생 버튼을 누른 뒤부터 납니다.

## 폴더

```
frontend/src/          React 화면 (pages/, components/, lib/, styles/tokens.css)
public/                옛 화면(롤백용) + 공용 파일 (config.js, lib/theory.js·voicing.js)
src/main/kotlin/ulevelp/  Ktor 서버 (routes/, service/, auth/, db/, notion/, note/, storage/)
server.js              테스트·화면 확인용 Node 서버
test/                  node:test 단위 테스트, test/e2e/ Playwright
scripts/deploy-cloudrun.sh  Cloud Run 배포
docs/                  설계 문서
개발산출물/             단계별 명세·결과·진행 파일
```

`public/lib/*.js`(음악 계산)는 브라우저와 Node 서버가 같은 파일을 쓰고, Kotlin 서버는 `chord/ChordTheory.kt`에 같은 규칙을 옮겨 둡니다. 계산 규칙을 바꾸면 둘 다 고칩니다.

## API

서비스 API(`/api/v1/*`: 곡, 연습 세션, 녹음, 노션, 학습 노트, 연동 키)는 [docs/03-api-spec.md](docs/03-api-spec.md)에 있습니다. 로그인 없이 쓰는 코드 계산 API:

| 경로 | 예시 | 내용 |
| --- | --- | --- |
| `/api/health` | | 상태 확인 |
| `/api/voicings` | `?root=G&quality=13&lo=3&hi=8` | 코드 하나의 보이싱 목록 |
| `/api/two-five-one` | `?key=C&lo=5&hi=8&pent=A&outside=2` | 프렛 창 안의 2-5-1 |
| `/api/top-note` | `?string=1&fret=8` | 탑노트 고정 도미넌트 전체 |
| `/api/circle` | `?root=F&top=2` | 5도권 진행 |
| `/api/matrix` | `?root=C&drop=d2&inv=0&span=4` | 줄 세트별 9개 성질 폼 |
| `/api/scale` | `?root=A&type=pentMin&tuning=g6&lo=5&hi=8` | 스케일 구성음과 지판 위치 (tuning: g6, g7, b4, b5, b6) |
| `/api/interpret` | `?frets=x,x,4,2,2,4` | 음 배열 재해석 (6번줄부터) |
| `/api/double-stops` | `?root=C&type=major&interval=3rd&pair=1-2` | 더블 스탑 쌍 (interval: 3rd, 6th, 4th) |

예: https://ulevelp-d5ympfsmfq-du.a.run.app/api/scale?root=C&type=major&tuning=g6
