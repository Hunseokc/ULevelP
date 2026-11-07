// Playwright 기반 브라우저 XSS 페이로드 E2E 검사 및 CSP 위반 감시 (X2)
'use strict';
const { test, expect } = require('@playwright/test');
const { mockApp } = require('./support/mock-app');

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

  // 2. integrity 제거·supabase/YouTube 스텁·API 응답은 공용 장치(test/e2e/support/mock-app.js)
  //    모르는 /api/v1/*는 예전처럼 실제 서버로 보낸다(unknownApi: 'pass')
  await mockApp(page, {
    auth: 'user',
    me: opts.me !== undefined ? opts.me : DEFAULT_ME,
    sessionUser: {
      id: (opts.me && opts.me.id) || '00000000-0000-4000-8000-000000000001',
      email: '<img src=x onerror="window.__xss=1">@example.com',
      user_metadata: { full_name: '"><svg onload="window.__xss=1">' },
    },
    songs: opts.songs !== undefined ? opts.songs : DEFAULT_SONGS,
    sessions: opts.sessions !== undefined ? opts.sessions : DEFAULT_SESSIONS,
    songDetail: opts.songDetail !== undefined ? opts.songDetail : DEFAULT_SONG_DETAIL,
    takeUrl: opts.takeUrl !== undefined ? opts.takeUrl : { url: 'javascript:window.__xss=1', expiresIn: 3600 },
    unknownApi: 'pass',
  });
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

test('E8 설정 화면(settings.html) 노션 백업 ZIP 미리보기 XSS 검사', async ({ page }) => {
  await setupMockAuthAndApi(page);

  await page.route(
    (url) => url.pathname === '/api/v1/import/notion/preview',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          ok: true,
          previewToken: 'f1000000-0000-4000-8000-000000000001',
          newSongs: 2,
          updatedSongs: 2,
          sessions: 4,
          takes: 2,
          songsSample: [
            { videoId: 'v1111111111', title: PAYLOADS.P_IMG, artist: PAYLOADS.P_SVG, status: 'practicing', isNew: true },
            { videoId: 'v2222222222', title: PAYLOADS.P_JS_URL, artist: PAYLOADS.P_ATTR, status: 'mastered', isNew: false },
          ],
          errors: [
            { file: PAYLOADS.P_IMG, row: 2, reason: PAYLOADS.P_SVG },
            { file: PAYLOADS.P_JS_URL, row: 3, reason: PAYLOADS.P_ATTR },
          ],
        }),
      });
    }
  );

  await page.goto('/settings.html#advanced');

  // 더미 파일 입력
  await page.setInputFiles('#inpImportZip', {
    name: 'backup.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('PK\x03\x04dummy'),
  });

  // 미리보기 버튼 클릭
  await page.click('#btnPreviewZip');

  // #nxPreviewBox 표시 확인
  const previewBox = page.locator('#nxPreviewBox');
  await expect(previewBox).toBeVisible();

  // #nxPreviewList 에 페이로드 원문 텍스트 포함 확인
  const list = page.locator('#nxPreviewList');
  await expect(list).toContainText(PAYLOADS.P_IMG);
  await expect(list).toContainText(PAYLOADS.P_SVG);
  await expect(list).toContainText(PAYLOADS.P_JS_URL);
  await expect(list).toContainText(PAYLOADS.P_ATTR);

  // XSS 미발생 및 CSP 단언
  await assertNoXssOrCsp(page);
});

test('E9 설정 화면(settings.html) 외부 연동 키 상태·점검 결과 XSS 검사', async ({ page }) => {
  await setupMockAuthAndApi(page);

  let integrationsListCalls = 0;
  await page.route(
    (url) => url.pathname === '/api/v1/integrations',
    async (route) => {
      integrationsListCalls++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          integrations: [
            {
              provider: 'notion',
              hint: PAYLOADS.P_IMG,
              config: {
                songsDb: PAYLOADS.P_SVG,
                sessionsDb: PAYLOADS.P_ATTR,
                notesDb: null,
              },
              updatedAt: '2026-11-01T00:00:00Z',
            },
            {
              provider: 'gemini',
              hint: PAYLOADS.P_IMG,
              config: {
                model: PAYLOADS.P_JS_URL,
              },
              updatedAt: '2026-11-01T00:00:00Z',
            },
          ],
        }),
      });
    }
  );

  await page.route(
    (url) => url.pathname === '/api/v1/integrations/notion/check',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          ok: true,
          provider: 'notion',
          songsTitle: PAYLOADS.P_IMG,
          sessionsTitle: PAYLOADS.P_SVG,
          notesTitle: null,
          maxUploadMB: 5,
        }),
      });
    }
  );

  await page.goto('/settings.html#advanced');

  // #btnCheckNotionKey 클릭
  await page.click('#btnCheckNotionKey');

  // #notionKeyStatus 및 #ntnKeyMsg 에 페이로드 텍스트 존재 확인
  const keyStatus = page.locator('#notionKeyStatus');
  await expect(keyStatus).toBeVisible();
  await expect(keyStatus).toContainText(PAYLOADS.P_IMG);

  const ntnMsg = page.locator('#ntnKeyMsg');
  await expect(ntnMsg).toBeVisible();
  await expect(ntnMsg).toContainText(PAYLOADS.P_IMG);
  await expect(ntnMsg).toContainText(PAYLOADS.P_SVG);

  // #ntnSongsDb, #ntnSessionsDb, #gemModel 에도 value로 설정되었는지 확인
  await expect(page.locator('#ntnSongsDb')).toHaveValue(PAYLOADS.P_SVG);
  await expect(page.locator('#ntnSessionsDb')).toHaveValue(PAYLOADS.P_ATTR);
  await expect(page.locator('#gemModel')).toHaveValue(PAYLOADS.P_JS_URL);

  // 페이지 로드 및 버튼 동작 후에도 /api/v1/integrations 목록 조회가 1회만 호출되었는지 단언 (리뷰 1번)
  expect(integrationsListCalls).toBe(1);

  // img[src="x"], svg[onload], 인라인 핸들러 0개 및 CSP 위반 없음
  await assertNoXssOrCsp(page);
});

test('E10 학습 노트(notes.html) 및 노트 상세(note.html) XSS 페이로드 검사', async ({ page }) => {
  const meWithKey = {
    ...DEFAULT_ME,
    keys: { notion: null, gemini: { hint: '1234' } },
  };
  await setupMockAuthAndApi(page, { me: meWithKey });

  const mockJobs = [
    {
      id: 'job-xss-1',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      tags: [PAYLOADS.P_IMG, PAYLOADS.P_SVG],
      status: 'done',
      noteId: 'b1000000-0000-4000-8000-000000000001',
      createdAt: '2026-11-01T00:00:00Z',
    },
  ];

  const mockNotes = [
    {
      id: 'b1000000-0000-4000-8000-000000000001',
      videoId: 'dQw4w9WgXcQ',
      title: PAYLOADS.P_IMG,
      channel: PAYLOADS.P_SVG,
      headline: PAYLOADS.P_JS_URL,
      difficulty: '중급',
      tags: ['화성'],
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    },
  ];

  const mockNoteDetail = {
    id: 'b1000000-0000-4000-8000-000000000001',
    videoId: 'dQw4w9WgXcQ',
    url: 'javascript:window.__xss=1',
    title: PAYLOADS.P_IMG,
    channel: PAYLOADS.P_SVG,
    headline: PAYLOADS.P_JS_URL,
    difficulty: '중급',
    tags: ['화성'],
    memo: PAYLOADS.P_ATTR,
    points: [PAYLOADS.P_IMG, PAYLOADS.P_SVG],
    keywords: [PAYLOADS.P_JS_URL, PAYLOADS.P_ATTR],
    analysis: {
      summary: {
        headline: PAYLOADS.P_JS_URL,
        key_points: [PAYLOADS.P_IMG],
      },
      harmony: {
        progressions: [
          {
            name: PAYLOADS.P_IMG,
            key: 'C',
            instrument: PAYLOADS.P_SVG,
            chords: [
              {
                symbol: PAYLOADS.P_IMG,
                roman: 'I',
                function: 'T',
                frets: ['x', 'x', '10', '12', '12', '12'],
                voicingNote: PAYLOADS.P_ATTR,
                nuance: PAYLOADS.P_JS_URL,
                basis: '말함',
                timestamp: '0:15',
              },
            ],
          },
        ],
        concepts: [PAYLOADS.P_IMG],
      },
      moments: [
        {
          timestamp: '0:30',
          point: PAYLOADS.P_SVG,
        },
      ],
      practice: [PAYLOADS.P_ATTR],
    },
    diagramsSvg: [
      '<svg xmlns="http://www.w3.org/2000/svg" onload="window.__xss=1"><circle cx="50" cy="50" r="40"/><script>window.__xss=1</script></svg>',
    ],
    model: 'gemini-2.5-flash',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  };

  await page.route(
    (url) => url.pathname === '/api/v1/notes/jobs',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ jobs: mockJobs }),
      });
    }
  );

  await page.route(
    (url) => url.pathname === '/api/v1/notes',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ notes: mockNotes }),
      });
    }
  );

  await page.route(
    (url) => url.pathname === '/api/v1/notes/b1000000-0000-4000-8000-000000000001',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ note: mockNoteDetail }),
      });
    }
  );

  // 1. /notes.html 진입
  await page.goto('/notes.html');

  // 작업 행 및 노트 카드 렌더링 확인
  const jobsList = page.locator('#jobs');
  await expect(jobsList).toBeVisible();
  await expect(jobsList).toContainText(PAYLOADS.P_IMG);

  const notesList = page.locator('#notesList');
  await expect(notesList).toBeVisible();
  await expect(notesList).toContainText(PAYLOADS.P_IMG);
  await expect(notesList).toContainText(PAYLOADS.P_JS_URL);

  // notes.html XSS 및 CSP 검증
  await assertNoXssOrCsp(page);

  // 2. /note.html?id=... 진입
  await page.goto('/note.html?id=b1000000-0000-4000-8000-000000000001');

  // 제목, 채널, 요약, 표 렌더링 확인
  const noteHeader = page.locator('#noteHeader');
  await expect(noteHeader).toBeVisible();
  await expect(page.locator('#noteTitle')).toContainText(PAYLOADS.P_IMG);
  await expect(page.locator('#noteMeta')).toContainText(PAYLOADS.P_SVG);
  await expect(page.locator('#noteHeadline')).toContainText(PAYLOADS.P_JS_URL);

  // 표 및 타임스탬프 링크
  const sections = page.locator('#noteSections');
  await expect(sections).toBeVisible();
  await expect(sections).toContainText(PAYLOADS.P_IMG);

  // SVG 렌더링 확인 (악성 태그 script는 제거되고 circle만 마운트됨)
  const svgBox = page.locator('.svg-box');
  await expect(svgBox).toBeVisible();
  await expect(svgBox.locator('svg circle')).toBeVisible();
  expect(await svgBox.locator('script').count()).toBe(0);

  // 체크리스트
  const practiceBox = page.locator('#notePractice');
  await expect(practiceBox).toBeVisible();
  await expect(practiceBox).toContainText(PAYLOADS.P_ATTR);

  // note.html XSS 및 CSP 검증
  await assertNoXssOrCsp(page);
});

test('회귀 검증: note.html 조회 지연 중 계정 전환/로그아웃 시 이전 응답 무시 (K5-2 리뷰 1번)', async ({ page }) => {
  const meA = {
    ...DEFAULT_ME,
    id: 'user-a-00000000-0000-0000-0000-000000000001',
    displayName: '사용자A',
  };
  await setupMockAuthAndApi(page, { me: meA });

  const targetNoteId = 'b2000000-0000-4000-8000-000000000002';
  const mockNoteA = {
    id: targetNoteId,
    title: '사용자 A의 비밀 학습 노트',
    channel: '비밀 채널',
    headline: '사용자 A만 볼 수 있는 핵심 요약',
    difficulty: '중급',
    tags: ['화성'],
    analysis: {
      summary: { headline: '요약 A', key_points: ['포인트 A'] },
      harmony: { progressions: [], concepts: [] },
      moments: [],
      practice: [],
    },
    diagramsSvg: [],
  };

  let resolveDelayedResponse;
  const delayedPromise = new Promise((resolve) => {
    resolveDelayedResponse = resolve;
  });

  await page.route(
    (url) => url.pathname === `/api/v1/notes/${targetNoteId}`,
    async (route) => {
      await delayedPromise;
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ note: mockNoteA }),
      });
    }
  );

  // 1. 사용자 A로 note.html 진입 -> 아직 응답이 오지 않아 로딩 상태 유지
  await page.goto(`/note.html?id=${targetNoteId}`);
  await expect(page.locator('#noteLoadingMsg')).toContainText('학습 노트를 불러오는 중...');
  await expect(page.locator('#noteContent')).toBeHidden();

  // 2. 응답이 아직 도착하지 않은 상태에서 로그아웃 발생
  await page.evaluate(() => {
    if (window.ULAuth && typeof window.ULAuth.signOut === 'function') {
      window.ULAuth.signOut({ scope: 'local' });
    }
  });

  // 로딩 메시지가 '로그인이 필요해요.'로 변경되고 여전히 noteContent는 숨김 상태여야 함
  await expect(page.locator('#noteLoadingMsg')).toContainText('로그인이 필요해요.');
  await expect(page.locator('#noteContent')).toBeHidden();

  // 3. 사용자 A의 지연되었던 응답이 뒤늦게 도착
  const responsePromise = page.waitForResponse((res) => res.url().includes(`/api/v1/notes/${targetNoteId}`));
  resolveDelayedResponse();
  await responsePromise;

  // 충분한 시간 대기 후에도 이전 계정의 응답이 화면에 렌더링되지 않아야 함 (myUid !== activeUid, mySeq !== detailReqSeq)


  await expect(page.locator('#noteContent')).toBeHidden();
  await expect(page.locator('#noteLoadingMsg')).toContainText('로그인이 필요해요.');
  expect(await page.locator('#noteTitle').textContent()).not.toContain('사용자 A의 비밀 학습 노트');
  expect(await page.locator('#noteMemoInput').inputValue()).toBe('');
});

test('회귀 검증: note.html 조회 지연 중 A -> B 계정 전환 시 이전 계정(A) 응답 무시 (K5-2 2차 리뷰)', async ({ page }) => {
  const meA = {
    ...DEFAULT_ME,
    id: 'user-a-00000000-0000-0000-0000-000000000001',
    displayName: '사용자A',
  };
  await setupMockAuthAndApi(page, { me: meA });

  const targetNoteId = 'b2000000-0000-4000-8000-000000000002';
  const mockNoteA = {
    id: targetNoteId,
    title: '사용자 A의 비밀 학습 노트',
    channel: '비밀 채널',
    headline: '사용자 A만 볼 수 있는 핵심 요약',
    difficulty: '중급',
    tags: ['화성'],
    memo: '사용자 A의 비밀 메모',
    analysis: {
      summary: { headline: '요약 A', key_points: ['포인트 A'] },
      harmony: { progressions: [], concepts: [] },
      moments: [],
      practice: [],
    },
    diagramsSvg: [],
  };

  let resolveDelayedResponseA;
  const delayedPromiseA = new Promise((resolve) => {
    resolveDelayedResponseA = resolve;
  });

  let requestCount = 0;
  await page.route(
    (url) => url.pathname === `/api/v1/notes/${targetNoteId}`,
    async (route) => {
      requestCount++;
      if (requestCount === 1) {
        await delayedPromiseA;
        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({ note: mockNoteA }),
        });
      } else {
        await route.fulfill({
          status: 404,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({ error: 'NOTE_NOT_FOUND', message: '학습 노트를 찾을 수 없어요.' }),
        });
      }
    }
  );

  // 1. 사용자 A로 note.html 진입 -> 아직 응답이 오지 않아 로딩 상태 유지
  await page.goto(`/note.html?id=${targetNoteId}`);
  await expect(page.locator('#noteLoadingMsg')).toContainText('학습 노트를 불러오는 중...');
  await expect(page.locator('#noteContent')).toBeHidden();

  // 2. 응답이 아직 도착하지 않은 상태에서 사용자 B로 계정 전환 발생
  await page.evaluate(() => {
    const sessionB = {
      access_token: 'fake-jwt-token-b',
      user: {
        id: 'user-b-00000000-0000-0000-0000-000000000002',
        email: 'userb@example.com',
      },
    };
    if (window.__supabaseAuthListener) {
      window.__supabaseAuthListener('SIGNED_IN', sessionB);
    }
  });

  // 3. 사용자 A의 지연되었던 첫 번째 응답이 뒤늦게 도착
  const responsePromiseA = page.waitForResponse((res) => res.url().includes(`/api/v1/notes/${targetNoteId}`));
  resolveDelayedResponseA();
  await responsePromiseA;

  // 4. B 화면에 A의 비밀 노트 내용이 렌더링되지 않아야 함 (myUid !== activeUid, mySeq !== detailReqSeq)
  await expect(page.locator('#noteContent')).toBeHidden();
  expect(await page.locator('#noteTitle').textContent()).not.toContain('사용자 A의 비밀 학습 노트');
  expect(await page.locator('#noteMemoInput').inputValue()).toBe('');
});
