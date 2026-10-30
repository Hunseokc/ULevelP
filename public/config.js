// 공개 설정: 브라우저에 노출되어도 안전한 값만 둡니다(NFR-SEC-3).
// 비밀 값(마스터 키, DB 비밀번호, 서버 전용 키 등)은 절대 넣지 않습니다.
'use strict';
window.ULEVELP_CONFIG = {
  // Supabase 프로젝트 주소 (Auth Google OAuth 및 JWKS 발급원)
  supabaseUrl: 'https://vefrfhafmiiivpgjhqiu.supabase.co',
  // Supabase 대시보드 Project Settings → API → Publishable key (또는 anon public key)
  supabaseAnonKey: 'sb_publishable_MmTjc8Xk831VCYkVvMT6nw_jhnmrfE-',
  // Ktor API 서버 Base URL (비어 있으면 현재 페이지와 같은 Origin 사용, GitHub Pages 배포 시 Cloud Run URL 입력)
  apiBaseUrl: '',
  // Google Drive 연동용 OAuth 클라이언트 ID (K6-1에서 사용)
  googleClientId: '696282514694-nfb3u9aodvi70hmvgtlridvgt55omgaf.apps.googleusercontent.com',
  // 공식 노션 템플릿 공개 URL (K3-1에서 사용)
  notionTemplateUrl: 'https://app.notion.com/p/4097a337e26f8167aa10eb435edb676e?source=copy_link',
};
