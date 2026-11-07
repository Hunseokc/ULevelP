// 연습 화면 정렬 검사 (FT-2): 공통 검사 G0~G8. M2에서 다시 만드는 화면이라 배치 약속은 M2 step에서 쓴다
// 규격: 개발산출물/프론트_정렬규격.md · 점검 기록: 개발산출물/결과/FT-2_전화면점검.md
'use strict';
const { layoutSuite } = require('../support/layout-check');

// 영상 없이 연 빈 화면
layoutSuite({
  name: 'practice-empty',
  path: '/practice.html',
  states: ['guest'],
  ready: async (page) => {
    await page.locator('#emptyState').waitFor();
  },
});

// 영상을 연 화면(기기 저장 진행 있음 · 로그인 곡 있음)
layoutSuite({
  name: 'practice',
  path: '/practice.html?v=jNQXAC9IVRw',
  states: ['guest', 'guestLocal', 'userData'],
  ready: async (page) => {
    await page.locator('#seekRow').waitFor();
  },
  dark: 'userData',
  // 알려진 실패(FT-2 기록, M2에서 다시 만들 때 data-layout-ignore로 표기). 결과/FT-2_전화면점검.md §3
  known: [{ match: /^G3 #songTitle /, why: '곡 제목은 의도한 한 줄 말줄임(nowrap+ellipsis). 예외 표기만 없음' }],
});
