# 노션 중계 서버 (Cloudflare Worker)

연습 플레이어(`practice.html`)가 노션에 저장할 때 거치는 작은 서버입니다. 노션 토큰을 공개 페이지(github.io)에 넣지 않으려고 씁니다. 무료 플랜으로 충분합니다.

## 대시보드에서 만들기 (터미널 없이)

1. https://dash.cloudflare.com 가입/로그인 → 왼쪽 **Workers & Pages** → **Create** → **Create Worker**
2. 이름을 `practice-notion`으로 하고 **Deploy** (기본 코드로 일단 배포됨)
3. **Edit code** → 기존 코드를 전부 지우고 `notion-proxy.js` 내용을 붙여넣기 → **Deploy**
4. 워커 화면 **Settings → Variables and Secrets → Add**에서 두 개를 **Secret**으로 추가 → **Deploy**
   - `NOTION_TOKEN`: 노션 통합 토큰 (notion.so/my-integrations에서 만든 것, `ntn_…`)
   - `PRACTICE_KEY`: 아무 긴 문자열 (비밀번호처럼. 플레이어에 한 번 넣음)
5. 워커 주소(`https://practice-notion.<계정이름>.workers.dev`)를 복사

노션 **악기 연습** 페이지 `···` → **연결**에 그 통합이 추가돼 있어야 합니다.

## 플레이어에 연결

연습 플레이어 → **곡 목록** → 맨 아래 **노션 연결 설정** → 워커 주소와 `PRACTICE_KEY` 입력 → **저장 후 연결 확인**.
기기(아이패드, PC)마다 한 번씩 하면 됩니다.

한 번에 넣는 주소도 있습니다. 아래를 그 기기 브라우저에서 한 번 열면 저장되고 주소창에서는 지워집니다.

```
https://hunseokc.github.io/guitar-practice/practice.html#api=워커주소&k=비밀키
```

## 선택 변수

| 이름 | 기본값 | 용도 |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | `https://hunseokc.github.io,http://localhost:3000` | 접속을 허용할 사이트 |
| `SONGS_DB` / `SESSIONS_DB` | 지금 쓰는 노션 데이터베이스 ID | 데이터베이스를 새로 만들었을 때 |

## 경로

모든 요청에 `X-Practice-Key` 헤더가 필요합니다.

| 경로 | 내용 |
| --- | --- |
| `GET /health` | 노션 연결과 속성 이름 확인 |
| `GET /songs` | 연습 곡 목록 (연습 중 → 보류 → 완료, 최근 연습 순) |
| `GET /song?v=영상ID` | 영상으로 곡 찾기 |
| `POST /song` | 곡 추가 `{videoId, title?, artist?}` (제목이 없으면 유튜브에서 가져옴) |
| `POST /save` | 위치·구간·속도 저장 + 오늘 연습 기록에 시간·반복 횟수 더하기 |
