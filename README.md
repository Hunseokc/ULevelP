# 기타 코드 연습실

코드 연습용 웹 앱입니다. Node.js 기본 모듈만 쓰는 작은 서버가 화면과 계산 API를 함께 제공하고, 외부 npm 패키지는 없습니다.

## 실행

### Docker (권장)

```bash
docker compose up -d --build
```

브라우저에서 http://localhost:3000 을 엽니다. 끄려면 `docker compose down`.

compose 없이 쓸 때:

```bash
docker build -t guitar-chord-lab .
docker run -d -p 3000:3000 --name guitar-chord-lab guitar-chord-lab
```

포트를 바꾸려면 `-p 8080:3000`처럼 앞쪽 숫자만 바꾸면 됩니다.

### Node로 바로 (Node 20 이상)

```bash
npm start        # http://localhost:3000
npm run dev      # 파일 저장 시 자동 재시작
npm test         # 엔진·API 테스트
```

## 화면 구성

| 탭 | 하는 일 |
| --- | --- |
| 1 · 스케일 연습 | 지판 전체에 스케일 표시(음이름/도수, 확대·위치 슬라이더, 기타 6·7현/베이스 4·5현, 왼손잡이 반전). 단순 스케일 또는 5도권(4도권) 12키 순환 재생, 키마다 바뀐 음 표시, 근음만 보기 암기 연습 |
| 2 · 코드톤 지도 | 한 줄에 코드톤 두 개씩(2-note-per-string) 6번줄→1번줄 아르페지오. maj7 → 7 → m7 → m7(b5) → dim7 변환 시 움직인 음 표시, 메트로놈 재생 |
| 3 · 보이싱 매트릭스 | 드롭(Close, 2, 3, 4, 2&4, 2&3) × 전위 × 줄 세트 × 9개 성질. 같은 자리에서 maj7 → dim7 순환, 줄별 프렛 이동 표시, 자동 순환 재생 |
| 4 · 탑노트 5도권 | 탑노트를 고정하고 근음을 5도씩 내리며 텐션 역할 변화 연습. 베이스+탑노트 재생, 폼 힌트, 그 탑노트로 가능한 모든 도미넌트 |
| 5 · 우기기 | 지판에 찍은 음 배열을 여러 코드로 재해석, 같은 모양으로 2-5-1 치기, 퀴즈 |
| 6 · 2-5-1 탐색 | 프렛 창(+펜타토닉) 안에서 가이드톤 이동이 짧은 ii-V-I 보이싱 탐색 |

오른쪽 위 라이트/다크 버튼으로 화면 모드를 바꿀 수 있습니다(고르기 전엔 시스템 설정을 따름).

소리는 브라우저(Web Audio)에서 합성하므로 첫 재생 버튼을 누른 뒤부터 납니다.

## 폴더

```
server.js              정적 파일 + API 서버
public/
  index.html           화면
  styles.css
  app.js               화면 동작, 오디오, 재생 타이머
  lib/voicing.js       보이싱 생성, 2-5-1 탐색, 탑노트 고정 도미넌트
  lib/theory.js        드롭 매트릭스, 2-note-per-string, 재해석, 5도권, 스케일
test/engine.test.js    node:test 테스트
```

`public/lib/*.js`는 브라우저와 서버가 같은 파일을 씁니다. 계산 규칙을 바꾸면 화면과 API에 함께 반영됩니다.

## API

모든 응답은 JSON입니다. 음이름은 `C`, `F#`, `Bb` 또는 0~11 숫자로 받습니다. 줄 번호는 1번줄(가는 줄)~6번줄입니다.

| 경로 | 예시 | 내용 |
| --- | --- | --- |
| `/api/health` | | 상태 확인 |
| `/api/voicings` | `?root=G&quality=13&lo=3&hi=8` | 코드 하나의 보이싱 목록 (quality: maj7, m7, 7, 9, 13, 7b9, 7#9, 7#11, 7b13, 7sus4, m7b5, 6, m6 등) |
| `/api/two-five-one` | `?key=C&lo=5&hi=8&pent=A&outside=2` | 프렛 창 안의 2-5-1 |
| `/api/top-note` | `?string=1&fret=8` | 탑노트 고정 도미넌트 전체 |
| `/api/circle` | `?root=F&top=2` | 5도권 진행 (top: 근음 기준 탑노트 반음 수, 2 = 9th) |
| `/api/matrix` | `?root=C&drop=d2&inv=0&span=4` | 줄 세트별 9개 성질 폼 (drop: close, d2, d3, d4, d24, d23) |
| `/api/scale` | `?root=A&type=pentMin&tuning=g6&lo=5&hi=8`, `?root=C&type=major&circle=5` | 스케일 구성음과 지판 위치 (type: major, minor, pentMaj, pentMin, blues, majBlues, dorian, phrygian, lydian, mixolydian, locrian, harmMinor, melMinor, wholeTone / tuning: g6, g7, b4, b5). circle=5 또는 4 면 12키 순환과 키마다 바뀐 음 |
| `/api/interpret` | `?frets=x,x,4,2,2,4` | 음 배열 재해석 (6번줄부터) |

## 조정할 만한 곳

- 보이싱 점수(어떤 폼을 위로 올릴지): `public/lib/voicing.js`의 `finalize()` 안 점수 계산
- 손 폭 기본값, 프렛 범위: 각 탭의 입력값, `theory.js`의 `placeOn()` 기본 옵션
- 우기기에서 허용하는 텐션: `theory.js`의 `FAM`
