// Playwright 기반 브라우저 XSS 페이로드 E2E 검사 및 CSP 위반 감시 (X2)
'use strict';
const { test, expect } = require('@playwright/test');

// 3.1 XSS 페이로드 4종
const PAYLOADS = {
  P_IMG: '<img src=x onerror="window.__xss=1">',
  P_SVG: '"><svg onload="window.__xss=1">',
  P_JS_URL: 'javascript:window.__xss=1',
  P_ATTR: "' onclick='window.__xss=1",
};

// 기본 모킹 데이터
const DEFAULT_ME = {
  id: '00000000-0000-4000-8000-000000000001',
  email: '<img src=x onerror="window.__xss=1">@example.com',
  displayName: '"><svg onload="window.__xss=1">',
  role: 'user',
  storageProvider: 'supabase',
  driveFolderId: null,
  takeUsedBytes: 1024,
  takeQuotaBytes: 209715200,
  migratedLocalAt: '2026-10-30T00:00:00Z',
  keys: { notion: null, gemini: null },
};

const DEFAULT_SONGS = [
  {
    id: 'c1a2b3c4-0000-4000-8000-000000000001',
    title: PAYLOADS.P_IMG,
    artist: PAYLOADS.P_IMG,
    status: '연습중',
    statusCode: 'practicing',
    videoId: 'jNQXAC9IVRw',
    pos: 10.5,
    a: 5.0,
    b: 15.0,
    rate: 1.0,
    lastDate: '2026-10-30',
    memo: PAYLOADS.P_IMG,
    totalSeconds: 3600,
    resumeUrl: 'javascript:window.__xss=1',
  },
  {
    id: 'c1a2b3c4-0000-4000-8000-000000000002',
    title: PAYLOADS.P_SVG,
    artist: PAYLOADS.P_SVG,
    status: '연습중',
    statusCode: 'practicing',
    videoId: 'dQw4w9WgXcQ',
    pos: 20.0,
    a: 10.0,
    b: 25.0,
    rate: 0.75,
    lastDate: '2026-10-29',
    memo: PAYLOADS.P_SVG,
    totalSeconds: 1800,
    resumeUrl: 'javascript:window.__xss=1',
  },
  {
    id: 'c1a2b3c4-0000-4000-8000-000000000003',
    title: PAYLOADS.P_JS_URL,
    artist: PAYLOADS.P_JS_URL,
    status: '완료',
    statusCode: 'mastered',
    videoId: '9bZkp7q19f0',
    pos: 0.0,
    a: null,
    b: null,
    rate: 1.0,
    lastDate: '2026-10-28',
    memo: PAYLOADS.P_JS_URL,
    totalSeconds: 7200,
    resumeUrl: 'javascript:window.__xss=1',
  },
  {
    id: 'c1a2b3c4-0000-4000-8000-000000000004',
    title: PAYLOADS.P_ATTR,
    artist: PAYLOADS.P_ATTR,
    status: '보류',
    statusCode: 'paused',
    videoId: 'kJQP7kiw5Fk',
    pos: 50.0,
    a: 30.0,
    b: 40.0,
    rate: 0.5,
    lastDate: '2026-10-27',
    memo: PAYLOADS.P_ATTR,
    totalSeconds: 900,
    resumeUrl: 'javascript:window.__xss=1',
  },
];

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

const DEFAULT_SESSIONS = {
  summary: { thisWeekSeconds: 3600, thisMonthSeconds: 7200 },
  calendar: [
    { date: '2026-10-30', totalSeconds: 3600, level: 4 },
    { date: todayStr(), totalSeconds: 3600, level: 4 },
  ],
  sessions: [
    {
      id: 's1',
      date: todayStr(),
      seconds: 1800,
      minutes: 30.0,
      loops: 10,
      a: 10.0,
      b: 20.0,
      segment: '0:10–0:20',
      rate: 0.75,
      songId: 'c1a2b3c4-0000-4000-8000-000000000001',
      songTitle: PAYLOADS.P_IMG,
      songArtist: PAYLOADS.P_SVG,
      memo: PAYLOADS.P_ATTR,
      takes: [
        {
          id: 't1',
          sessionId: 's1',
          recordedAt: todayStr() + 'T10:00:00Z',
          a: 10.0,
          b: 20.0,
          rate: 0.75,
          durationSec: 15,
          mime: 'audio/mp4',
          sizeBytes: 1000,
          storage: 'supabase',
          storageKey: 'u/t1.m4a',
          memo: PAYLOADS.P_IMG,
        },
      ],
    },
  ],
};

const DEFAULT_SONG_DETAIL = {
  song: DEFAULT_SONGS[0],
  sessions: [
    {
      id: 's1',
      date: todayStr(),
      seconds: 1800,
      minutes: 30.0,
      loops: 10,
      a: 10.0,
      b: 20.0,
      segment: '0:10–0:20',
      rate: 0.75,
      memo: PAYLOADS.P_ATTR,
    },
  ],
  takes: [
    {
      id: 't1',
      sessionId: 's1',
      recordedAt: '2026-10-29T10:00:00Z',
      a: 10.0,
      b: 20.0,
      rate: 0.75,
      durationSec: 12,
      mime: 'audio/mp4',
      sizeBytes: 1000,
      storage: 'supabase',
      storageKey: 'u/t1.m4a',
      memo: PAYLOADS.P_IMG,
    },
    {
      id: 't2',
      sessionId: 's1',
      recordedAt: '2026-10-30T10:00:00Z',
      a: 10.0,
      b: 20.0,
      rate: 0.75,
      durationSec: 15,
      mime: 'audio/mp4',
      sizeBytes: 1200,
      storage: 'supabase',
      storageKey: 'u/t2.m4a',
      memo: PAYLOADS.P_SVG,
    },
  ],
};

/**
 * 가짜 인증 및 API 모킹 헬퍼 (X2 시그니처)
 * @param {import('@playwright/test').Page} page
 * @param {object} [opts]
 */
async function setupMockAuthAndApi(page, opts = {}) {
  // 1. 감시 스크립트 주입
  await page.addInitScript(() => {
    window.__xss = false;
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations.push(e.violatedDirective + ':' + e.blockedURI);
    });
  });

  // 2. HTML 서빙 시 integrity 속성 동적 제거 (가짜 스텁의 SRI 불일치 에러 방지)
  await page.route(
    (url) => url.pathname.endsWith('.html') || url.pathname === '/',
    async (route) => {
      const response = await route.fetch();
      const text = await response.text();
      const body = text.replace(/\sintegrity="[^"]*"/g, '');
      await route.fulfill({
        response,
        body,
        headers: {
          ...response.headers(),
          'content-length': String(Buffer.byteLength(body)),
        },
      });
    }
  );

  // 3. 외부 CDN 및 IFrame API 스텁
  await page.route(/https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@.*/, async (route) => {
    const stub = `
      window.supabase = {
        createClient: function() {
          const fakeSession = {
            access_token: 'fake-jwt-token',
            user: {
              id: '00000000-0000-4000-8000-000000000001',
              email: '<img src=x onerror="window.__xss=1">@example.com',
              user_metadata: { full_name: '"><svg onload="window.__xss=1">' }
            }
          };
          return {
            auth: {
              getSession: async function() { return { data: { session: fakeSession }, error: null }; },
              onAuthStateChange: function(cb) {
                return { data: { subscription: { unsubscribe: function() {} } } };
              },
              signInWithOAuth: async function() { return { error: null }; },
              signOut: async function() { return { error: null }; }
            }
          };
        }
      };
    `;
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stub });
  });

  await page.route(/https:\/\/(www\.)?youtube\.com\/.*/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.YT = { Player: function() { return { loadVideoById: () => {}, playVideo: () => {}, pauseVideo: () => {}, getCurrentTime: () => 0, getDuration: () => 100, setPlaybackRate: () => {} }; } };',
    });
  });

  await page.route(/https:\/\/i\.ytimg\.com\/.*/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from([]) });
  });

  // 4. API 응답 모킹
  const meData = opts.me !== undefined ? opts.me : DEFAULT_ME;
  const songsData = opts.songs !== undefined ? opts.songs : DEFAULT_SONGS;
  const sessionsData = opts.sessions !== undefined ? opts.sessions : DEFAULT_SESSIONS;
  const detailData = opts.songDetail !== undefined ? opts.songDetail : DEFAULT_SONG_DETAIL;
  const takeUrlData = opts.takeUrl !== undefined ? opts.takeUrl : { url: 'javascript:window.__xss=1', expiresIn: 3600 };

  await page.route(
    (url) => url.pathname.startsWith('/api/v1/me'),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(meData),
      });
    }
  );

  await page.route(
    (url) => url.pathname.startsWith('/api/v1/songs'),
    async (route) => {
      const urlObj = new URL(route.request().url());
      const path = urlObj.pathname;
      if (path.includes('/by-video/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({ song: songsData[0] || null }),
        });
      }
      if (path.includes('/migrate-local')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({ created: 0, skipped: 0, migratedLocalAt: '2026-10-30T00:00:00Z' }),
        });
      }
      const idMatch = path.match(/\/api\/v1\/songs\/([a-f0-9-]+)$/);
      if (idMatch) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(detailData),
        });
      }
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 201,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({ song: songsData[0], created: true }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ songs: songsData }),
      });
    }
  );

  await page.route(
    (url) => url.pathname.startsWith('/api/v1/sessions'),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(sessionsData),
      });
    }
  );

  await page.route(
    (url) => url.pathname.startsWith('/api/v1/takes'),
    async (route) => {
      const urlObj = new URL(route.request().url());
      if (urlObj.pathname.endsWith('/url')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(takeUrlData),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ ok: true }),
      });
    }
  );
}

/**
 * 공통 단언 함수 (X2 4절)
 * @param {import('@playwright/test').Page} page
 */
async function assertNoXssOrCsp(page) {
  // 1. window.__xss 미발생
  const xss = await page.evaluate(() => window.__xss);
  expect(xss).toBe(false);

  // 2. CSP 위반 0건
  const violations = await page.evaluate(() => window.__cspViolations);
  expect(violations).toEqual([]);

  // 3. 위험한 태그 미생성
  const badElements = await page.locator('img[src="x"], svg[onload]').count();
  expect(badElements).toBe(0);

  // 3-1. 인라인 이벤트 핸들러 속성 미생성 (PR #20 리뷰 2번: P_ATTR 및 미실행 인라인 핸들러 검출)
  const inlineHandlers = await page.locator('[onclick], [onerror], [onload], [onmouseover], [onfocus]').count();
  expect(inlineHandlers).toBe(0);

  // 4. 위험한 javascript: 속성 미생성
  const badLinks = await page.locator('a[href^="javascript:"], audio[src^="javascript:"]').count();
  expect(badLinks).toBe(0);
}

// -------------------- 테스트 케이스 표 (E1~E7) --------------------

test('E1 첫 화면(index.html) 곡 목록 및 노션 바로가기', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ulp:notion-practice', 'javascript:window.__xss=1');
  });
  await setupMockAuthAndApi(page);
  await page.goto('/');

  // 곡 목록 로드 대기 (첫 곡의 텍스트가 표시될 때까지)
  const songsList = page.locator('#songs');
  await expect(songsList).toContainText('<img src=x onerror="window.__xss=1">');

  // #nlPractice 숨김 확인
  const nlPractice = page.locator('#nlPractice');
  await expect(nlPractice).toBeHidden();

  // 안전 단언
  await assertNoXssOrCsp(page);
});

test('E2 플레이어(practice.html) 곡 제목 및 곡 목록 서랍', async ({ page }) => {
  await setupMockAuthAndApi(page);
  await page.goto('/practice.html?v=jNQXAC9IVRw');

  // 곡 제목에 페이로드가 텍스트로 표시되는지 확인
  const songTitle = page.locator('#songTitle');
  await expect(songTitle).toHaveText(PAYLOADS.P_IMG);

  // #libBtn 클릭해 곡 목록 서랍 열기
  await page.click('#libBtn');
  const libSongs = page.locator('#songs');
  await expect(libSongs).toContainText(PAYLOADS.P_SVG);

  await assertNoXssOrCsp(page);
});

test('E3 기록 화면(log.html) 기록 탭·세션 목록·녹음 URL', async ({ page }) => {
  await setupMockAuthAndApi(page);
  await page.goto('/log.html');

  // 세션 목록 표시 대기
  const sessionTitle = page.locator('.session-title');
  await expect(sessionTitle.first()).toContainText('<img src=x onerror="window.__xss=1">');

  // 듣기 버튼 클릭
  const playBtn = page.locator('.take-row button', { hasText: '▶ 듣기' });
  await playBtn.first().click();

  // audio 태그의 src가 javascript: 가 아닌지 확인
  const audios = page.locator('.take-row audio');
  await expect(audios.first()).toBeAttached();
  const audioSrc = await audios.first().getAttribute('src');
  expect(audioSrc || '').not.toMatch(/^javascript:/i);

  await assertNoXssOrCsp(page);
});

test('E4 기록 화면(log.html#songs) 곡 보관함 탭', async ({ page }) => {
  await setupMockAuthAndApi(page);
  await page.goto('/log.html#songs');

  // 곡 카드 렌더링 확인
  const firstSongCard = page.locator('.song-card').first();
  await expect(firstSongCard).toContainText('<img src=x onerror="window.__xss=1">');

  // ▶ 이어서 연습 링크 확인
  const resumeLink = firstSongCard.locator('.song-card-head a.ghost');
  await expect(resumeLink).toHaveText('▶ 이어서 연습');
  const href = await resumeLink.getAttribute('href');
  expect(href || '').not.toMatch(/^javascript:/i);

  await assertNoXssOrCsp(page);
});

test('E5 곡 상세 화면(log.html?song=...) 타임라인 및 A/B 비교', async ({ page }) => {
  await setupMockAuthAndApi(page);
  await page.goto('/log.html?song=c1a2b3c4-0000-4000-8000-000000000001');

  // 곡 상세 상단 확인
  const detailTitle = page.locator('#detailTitle');
  await expect(detailTitle).toHaveText(PAYLOADS.P_IMG);

  // A/B 비교 녹음 2개 선택
  const checks = page.locator('.ab-check');
  await expect(checks).toHaveCount(2);
  await checks.nth(0).check();
  await checks.nth(1).check();

  // A/B 패널 표시 및 라벨 확인
  const abPanel = page.locator('#abPanel');
  await expect(abPanel).toBeVisible();

  await assertNoXssOrCsp(page);
});

test('E6 설정 화면(settings.html) 계정 프로필 표시', async ({ page }) => {
  await setupMockAuthAndApi(page);
  await page.goto('/settings.html');

  // 프로필 정보 표시 대기
  const accEmail = page.locator('#accEmail');
  await expect(accEmail).toHaveText('<img src=x onerror="window.__xss=1">@example.com');

  const accName = page.locator('#accName');
  await expect(accName).toContainText('"><svg onload="window.__xss=1">');

  const navAuth = page.locator('#navAuth');
  await expect(navAuth).toBeVisible();

  await assertNoXssOrCsp(page);
});

test('E7 대조군(검출기 작동 확인)', async ({ page }) => {
  await setupMockAuthAndApi(page);
  await page.goto('/');

  // 악성 요소 및 인라인 스타일 강제 삽입
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<img src=x onerror="window.__xss=1"><i style="color:red">x</i>');
  });

  // img[src="x"] 생성 확인
  const count = await page.locator('img[src="x"]').count();
  expect(count).toBeGreaterThan(0);

  // CSP 위반 최소 2건(인라인 이벤트 핸들러 + 인라인 스타일) 확인
  await page.waitForTimeout(200);
  const violations = await page.evaluate(() => window.__cspViolations);
  expect(violations.length).toBeGreaterThanOrEqual(2);
});

