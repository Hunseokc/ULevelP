// 코드 진행 모음 화면 정렬 검사 (FT-2): 공통 검사 G0~G8. M2에서 다시 만드는 화면이라 배치 약속은 M2 step에서 쓴다
// 규격: 개발산출물/프론트_정렬규격.md · 점검 기록: 개발산출물/결과/FT-2_전화면점검.md
'use strict';
const { expect } = require('@playwright/test');
const { layoutSuite } = require('../support/layout-check');
const { STATES, LONG_TITLE } = require('../support/mock-app');

function json(route, body) {
  return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
}

// 긴 제목 진행 3개(레퍼런스 2 · AI 분석 1)
function rows() {
  const base = {
    kind: 'reference', origin: 'manual', route: 'manual', evidence: null, part: '', artist: 'Artist', album: '',
    channel: '', releaseDate: null, key: 'F Major', instrument: '건반', moods: ['몽환'], genres: ['네오소울'], tags: ['연습'],
    url: '', videoId: null, startSec: null, endSec: null, memo: '', noteId: null,
    createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z',
  };
  const chords = [
    { symbol: 'FM9', roman: 'IM9', source: '화면', timestamp: '0:42' },
    { symbol: 'Dm9', roman: 'vim9', source: '화면', timestamp: '0:44' },
    { symbol: 'Gm11', roman: 'iim11', source: '화면', timestamp: '0:46' },
    { symbol: 'C13sus4', roman: 'V13sus4', source: '화면', timestamp: '0:48' },
  ];
  return [
    { ...base, id: '00000000-0000-4000-8000-0000000000c1', title: `1 · ${LONG_TITLE}`, chords },
    { ...base, id: '00000000-0000-4000-8000-0000000000c2', title: `2 · ${LONG_TITLE}`, chords: chords.slice(0, 2), moods: [], genres: [], tags: [] },
    {
      ...base, id: '00000000-0000-4000-8000-0000000000c3', kind: 'analysis', origin: 'ai', route: 'video', evidence: '화면',
      title: `3 · ${LONG_TITLE}`, part: '인트로', channel: '채널A', chords,
      url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', videoId: 'jNQXAC9IVRw', startSec: 42, endSec: 60,
    },
  ];
}

const progRoute = (items) => [
  (url) => url.pathname === '/api/v1/progressions',
  (route) => json(route, { progressions: items }),
];

layoutSuite({
  name: 'progressions',
  path: '/progressions.html',
  states: [
    'guest',
    { name: 'user', mock: { ...STATES.user, routes: [progRoute([])] } },
    { name: 'userData', mock: { ...STATES.userData, routes: [progRoute(rows())] } },
  ],
  ready: async (page, state) => {
    // 기본 범위(레퍼런스)는 진행 2개. 비로그인은 예시 진행(seed) 목록
    if (state === 'user') await page.locator('#progEmpty').waitFor();
    else if (state === 'userData') await expect(page.locator('#progList > li')).toHaveCount(2);
    else await page.locator('#progList > li').first().waitFor();
  },
  dark: 'userData',
});
