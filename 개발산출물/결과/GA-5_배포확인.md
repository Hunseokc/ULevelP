# GA-5 결과 — GA-4 운영 배포 · 중복 방지·완료 줄 확인

- 날짜: 2026-11-05 (win)
- 입력: `결과/GA-4_완료줄·중복방지.md`
- 상태: **완료** — 배포·운영 로그(409 1건·force 202 1건)·화면 확인(사용자 "전부 잘 동작"). 코드 변경 없음(문서만)

## 1. 배포 (main `737f385` = PR #66 머지 커밋)

```
docker build + push   asia-northeast3-docker.pkg.dev/ulevelp/ulevelp/server:737f385  (digest sha256:9f0ebf8a…)
deploy-cloudrun.sh    exit 0 — revision ulevelp-00010-zgn, Job analyze 이미지도 server:737f385
curl /api/health      {"ok":true} 200
POST /progressions/analyze (토큰 없음, force:true)   401
```

- DB 스키마 변경 없음(Flyway v4 그대로)

## 2. 운영 로그 (revision `ulevelp-00010-zgn`, `/progressions/analyze`)

| 시각(UTC) | 요청 | 응답 | 의미 |
| --- | --- | --- | --- |
| 02:47:53 | POST (토큰 없음, 자동 확인) | 401 | 인증 먼저 |
| 02:52:33 | POST `youtu.be/oWQZopUx0fA` 보통·구간 없음 | **409** | GA-3 02:13 완료 작업과 같은 영상·설정(24시간 안) → `DUPLICATE_ANALYSIS` |
| 02:52:45 | POST 같은 설정 + `force:true` (`다시 분석`) | **202** | 재분석 허용 |

- Job 로그: `02:53:13 Gemini 분석 완료 jobId=c0a2a181… pace=normal range=-~- fps=1.0` — 영상 토큰 2181·프롬프트 2999(GA-3 같은 설정과 동일), 출력 2261
- 분석 중 추가 클릭으로 들어온 POST 없음(버튼 잠금이 막음)

## 3. 화면 확인 (사용자)

| 항목 | 결과 |
| --- | --- |
| 이미 분석한 링크로 요청 | 409 안내 + 버튼이 `다시 분석`으로 바뀜 |
| `다시 분석` | 분석 시작, 분석 중 버튼 완전 비활성(`분석 중…`) |
| 완료 줄 | 한 줄 `2개 수집 · 노트 보기` |

- 완료 줄이 `영상 k개 · …` 형식이 아닌 이유: 화면은 **이 페이지를 연 뒤 지켜본 작업**만 보여 준다(`ProgressionsPage.tsx` `refreshJobs` — 진행 중이거나 `trackedRef`에 든 작업). 이번엔 끝난 작업 1건이라 설계(§3-4)의 1건 문구 그대로. 2건 이상 지켜보면 `영상 k개 · n개 수집 · 최근 노트 보기`(e2e P5d로 확인됨)

## 4. 남은 것

- 구간 타임스탬프 기준(GA-3 §3) — 시작이 0이 아닌 구간을 쓸 때 확인
- 분석 설정 작업(GA-1~5)은 이것으로 끝
