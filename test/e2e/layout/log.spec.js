// 연습 기록 화면 정렬 검사 (FT-2): 공통 검사 G0~G8. M2에서 다시 만드는 화면이라 배치 약속은 M2 step에서 쓴다
// 규격: 개발산출물/프론트_정렬규격.md · 점검 기록: 개발산출물/결과/FT-2_전화면점검.md
'use strict';
const { layoutSuite } = require('../support/layout-check');

layoutSuite({
  name: 'log',
  path: '/log.html',
  states: ['guest', 'user', 'userData'],
  ready: async (page, state) => {
    await page.locator(state === 'guest' ? '#logGuest' : '#calGrid').waitFor();
  },
  dark: 'userData',
  // 알려진 실패(FT-2 기록, M2에서 다시 만들 때 처리). 결과/FT-2_전화면점검.md §3
  known: [{ match: /^G6 #logGuest 제목 아래 /, why: '비로그인 안내 패널: gap 14px에 <p> 기본 여백 14px가 더해져 28px' }],
});
