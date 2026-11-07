const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function listFiles(dir, extFilter) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, extFilter));
    else if (!extFilter || extFilter.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

describe('RZ2-1: Dockerfile 3단계 멀티스테이지 빌드 및 런타임 보안 검증', () => {
  test('node:22-alpine 프론트엔드 빌드 + temurin JDK 빌드 + temurin JRE 런타임 스테이지를 포함한다', () => {
    const dockerfile = read('Dockerfile');
    assert.match(dockerfile, /FROM\s+node:22-alpine\s+AS\s+frontend-build/);
    assert.match(dockerfile, /RUN\s+npm\s+ci/);
    assert.match(dockerfile, /RUN\s+npm\s+run\s+build/);
    assert.match(dockerfile, /FROM\s+eclipse-temurin:21-jdk-alpine\s+AS\s+build/);
    assert.match(dockerfile, /installDist\s+--no-daemon/);
    assert.match(dockerfile, /FROM\s+eclipse-temurin:21-jre-alpine/);
    assert.match(dockerfile, /COPY\s+--from=frontend-build\s+\/workspace\/dist\/assets\s+\.\/public\/assets/);
    assert.match(dockerfile, /COPY\s+--from=frontend-build\s+\/workspace\/dist\/index\.html\s+\.\/public\/spa\.html/);
    assert.match(dockerfile, /USER\s+app/);
    assert.match(dockerfile, /HEALTHCHECK[\s\S]*\/api\/health/);
    assert.match(dockerfile, /-XX:MaxRAMPercentage=75\.0/);
  });
});

describe('RZ2-2: deploy-cloudrun.yml workflow_run 트리거 및 배포 가드 검증', () => {
  test('CI 성공 후에만 실행되도록 workflow_run 트리거와 conclusion == success 가드를 갖는다', () => {
    const wf = read('.github/workflows/deploy-cloudrun.yml');
    assert.match(wf, /workflow_run:/);
    assert.match(wf, /workflows:\s*\["CI"\]/);
    assert.match(wf, /types:\s*\n\s*-\s*completed/);
    assert.match(wf, /workflow_dispatch:/);
    assert.match(wf, /vars\.GCP_PROJECT_ID\s*!=\s*''/);
    assert.match(wf, /github\.event\.workflow_run\.conclusion\s*==\s*'success'/);
    assert.match(wf, /github\.event\.workflow_run\.event\s*!=\s*'pull_request'/);
    assert.match(wf, /ref:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\|\|\s*github\.sha\s*\}\}/);
    assert.match(wf, /google-github-actions\/auth@v2/);
    assert.match(wf, /scripts\/deploy-cloudrun\.sh/);
    assert.match(wf, /\/api\/health/);
    assert.match(wf, /\/config\.js/);
  });
});

describe('RZ2-3: frontend/index.html SDK 스크립트 및 main.tsx 전역 초기화 검증', () => {
  test('frontend/index.html에 /config.js, Supabase UMD(SRI 포함), Google GIS 스크립트가 포함된다', () => {
    const html = read('frontend/index.html');
    assert.match(html, /<script\s+src="\/config\.js"><\/script>/);
    assert.match(html, /@supabase\/supabase-js@2\.118\.0\/dist\/umd\/supabase\.js/);
    assert.match(html, /integrity="sha384-[^"]+"/);
    assert.match(html, /crossorigin="anonymous"/);
    assert.match(html, /https:\/\/accounts\.google\.com\/gsi\/client/);
  });

  test('frontend/src/main.tsx가 auth, apiClient, drive 모듈을 부트스트랩한다', () => {
    const mainTsx = read('frontend/src/main.tsx');
    assert.match(mainTsx, /import\s+['"]\.\/lib\/auth['"]/);
    assert.match(mainTsx, /import\s+['"]\.\/lib\/apiClient['"]/);
    assert.match(mainTsx, /import\s+['"]\.\/lib\/drive['"]/);
  });

  test('HomePage.tsx가 #goUrl에 native input 이벤트 리스너를 등록한다', () => {
    const homeTsx = read('frontend/src/pages/HomePage.tsx');
    assert.match(homeTsx, /addEventListener\(\s*['"]input['"]/);
  });
});

describe('RZ2-4: 전체 React 페이지 CSP/인라인 스타일 금지 및 전체 라우트 전환 완료 검증', () => {
  test('frontend/src 하위 모든 파일에 금지 패턴(style={{, dangerouslySetInnerHTML, innerHTML, eval)이 없다', () => {
    const files = listFiles(path.join(ROOT, 'frontend/src'), ['.ts', '.tsx']);
    assert.ok(files.length >= 15);
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      const rel = path.relative(ROOT, file);
      assert.ok(!src.includes('style={{'), `${rel}: style={{ 금지`);
      assert.ok(!/\bdangerouslySetInnerHTML\s*=/.test(src), `${rel}: dangerouslySetInnerHTML 금지`);
      assert.ok(!/\.innerHTML\s*=/.test(src), `${rel}: innerHTML 대입 금지`);
      assert.ok(!/\beval\s*\(/.test(src), `${rel}: eval 호출 금지`);
    }
  });

  test('App.tsx가 7개 페이지를 모두 라우팅하고 coming-soon 플레이스홀더가 남아있지 않다', () => {
    const appTsx = read('frontend/src/App.tsx');
    assert.ok(!appTsx.includes('coming-soon'), 'App.tsx에 coming-soon 플레이스홀더가 없어야 함');
    for (const pageName of ['HomePage', 'PracticePage', 'ChordsPage', 'SettingsPage', 'LogPage', 'NoteDetailPage', 'PrivacyPage']) {
      assert.ok(appTsx.includes(pageName), `App.tsx에 ${pageName} 라우팅이 포함되어야 함`);
    }
  });
});
