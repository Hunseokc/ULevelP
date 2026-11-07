# CH-E 결과 — 음악 엔진 이전 (`public/lib` → `frontend/src/lib/engine`)

- 날짜: 2026-11-04 (win)
- 입력: `결과/CH-1b_설계.md` §6-1·§9, 진행 파일 §3
- 상태: 로컬 확인 완료. CI(Node 22·24에서 CJS 테스트의 `await import('.mjs')`)는 이 브랜치 첫 CI에서 확인

## 1. 바꾼 파일

| 파일 | 내용 |
| --- | --- |
| ★`frontend/src/lib/engine/theory.mjs` | `public/lib/theory.js` 복사. 마지막 줄 `if (typeof module …) module.exports = CT;` → `export default CT;`만 다름 |
| ★`frontend/src/lib/engine/voicing.mjs` | `public/lib/voicing.js` 복사. 마지막 줄 → `export default GE;`만 다름 |
| `frontend/src/lib/musicEngine.ts` | `import rawCT from './engine/theory.mjs'`·`import rawGE from './engine/voicing.mjs'`(`@ts-ignore` 유지), `CT_MOD = rawCT`(`.default ||` 대체 제거). 내보내는 API 그대로 |
| `vite.config.ts` | `commonjsOptions`(public/lib CJS 변환) 줄 삭제 → Vite 기본값 |
| `Dockerfile` | 1단계 `COPY public/lib ./public/lib` 삭제(3단계 `COPY public ./public`은 옛 화면용으로 그대로) |
| ★`test/che_engine_port.test.js` | 옛·새 엔진 동일성 테스트(아래 §2) |
| `test/rz3_spa.test.js` | **§9 목록 밖, 이 변경의 직접 결과**: RZ3-2가 "vite 설정에 public/lib가 있다"를 검사하던 것을 "없다"로 바꿈 |

- `public/lib/*.js`는 **동결**(옛 화면·`server.js`·`test/engine.test.js`·`test/r2_chords.test.js`가 계속 읽음). 엔진 수정은 이제 `frontend/src/lib/engine/`에서만

## 2. 동일성 테스트 (`test/che_engine_port.test.js`, 18개)

- CH-E-1: 두 파일이 마지막 export 줄만 다르고 나머지 줄이 같음(CRLF 무시)
- CH-E-2: export 키 목록·상수(Q4·DROPS·SCALES·TUNINGS·CH·DEG·DOMS …) 같음
- CH-E-3 theory: `dropStructure`·`placeOn`·`atR0`·`mutation`(드롭 6 × 전위 4 × 줄세트 15 × 성질 전체), `countPlayable`(12루트), `playableSets`, `arpeggio2nps`·`arpeggioAs`, `interpret`·`transposeShape`, `circleSteps`·`topFret`, `scale*`(모든 스케일 × 루트 × 튜닝 5), `doubleStops`
- CH-E-4 voicing: `genVoicings`(12루트 × `CH` 전체 × 기본·넓은 옵션), `chordName`, `pentPcs`, `fretStr`, `search251`(메이저·마이너 × 기본·변형 + 펜타 제한), `topNoteDominants`
- CH-E-5: `musicEngine.ts`가 새 경로를 import, `vite.config.ts`·`Dockerfile`에 `public/lib` 없음
- 변이 확인: 새 `voicing.mjs`의 `DEF.maxSpan` 3→4로 바꾸면 CH-E-1·CH-E-4 실패(2개) → 원복 후 18개 통과

## 3. 실행 결과 (로컬, Node 26.8.1)

```
node --test test/che_engine_port.test.js   → tests 18, pass 18, fail 0 (약 1초)
npm test                                   → tests 158, pass 158, fail 0
npm run build                              → ✓ 110 modules, built in 987ms (번들에 "Drop 2&4" 1회, module.exports 0회)
ULP_UI=spa CI=1 npx playwright test        → 52 passed (56.9s)
docker build -t ulevelp:che .              → exit 0 (§4)
```

## 4. Docker

- `docker build -t ulevelp:che .` exit 0. 1단계 `[frontend-build 7/7] RUN npm run build` → `✓ built in 1.40s` (`public/lib` 없이 빌드됨)
- 컨테이너 실행 스모크는 CI Docker 잡에 맡김(로컬은 빌드까지)

## 5. 다음 step(CH-2b)에 넘길 것

- CH-2b에서 `voicing.mjs`를 고치면 **CH-E-1(줄 동일)·CH-E-2(export 키 — `trans` 추가)는 깨지는 게 맞다**. 그때 CH-E-1은 지우고, CH-E-2는 "옛 키 ⊂ 새 키"로, CH-E-3·4(같은 입력 → 같은 출력)는 회귀 테스트로 남긴다
- `musicEngine.ts`의 엔진 import는 `@ts-ignore` + `any`. CH-2b에서 새 함수 타입은 `musicEngine.ts` 래퍼에 둔다(§9)
