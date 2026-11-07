// frontend/src/pages/PrivacyPage.tsx
import React, { useEffect } from 'react';
import { AppShell } from '../components/layout/AppShell';
import styles from './SettingsPage.module.css';

export function PrivacyPage(): React.ReactElement {
  useEffect(() => {
    document.title = '개인정보처리방침 · ULeveLP';
  }, []);

  return (
    <AppShell variant="narrow" activeNav="privacy">
      <div className={styles.headerBlock} data-align-group="col: left">
        <h1 className={`page-title ${styles.pageTitle}`}>Privacy</h1>
        <p className={`page-sub ${styles.pageSub}`}>ULeveLP 개인정보처리방침</p>
      </div>

      <section className={`set-sec ${styles.setSec}`} data-align-group="col: left; secs: right" aria-labelledby="privH1">
        <h2 id="privH1">1. 수집하는 개인정보 항목</h2>
        <p>ULeveLP는 사용자의 원활한 악기 연습 지원 및 다중 기기 동기화를 위해 최소한의 정보를 수집합니다:</p>
        <ul>
          <li>
            <b>계정 정보:</b> Google OAuth 로그인 시 Supabase Auth를 경유하여 수집되는 이메일 주소 및 표시 이름.
          </li>
          <li>
            <b>서비스 이용 데이터:</b> 사용자가 직접 등록한 연습 곡 정보(유튜브 영상 ID, 곡명, 아티스트), 연습 세션 기록(연습 일시, 시간, 반복 횟수, 연습 구간, 재생 배속, 메모).
          </li>
          <li>
            <b>오디오 녹음:</b> 사용자가 연습 도중 직접 녹음한 오디오 파일.
          </li>
          <li>
            <b>외부 연동 키:</b> 사용자가 직접 등록한 Notion 토큰·DB ID 및 Gemini API 키(서버 마스터 키 기반 AES-256-GCM 암호화 보관).
          </li>
        </ul>
      </section>

      <section className={`set-sec ${styles.setSec}`} data-align-group="col: left; secs: right" aria-labelledby="privH2">
        <h2 id="privH2">2. 개인정보의 이용 목적</h2>
        <p>수집한 정보는 다음 목적 이외의 용도로 사용되지 않습니다:</p>
        <ul>
          <li>다중 기기 간 연습 진행 위치, 연습 구간, 연습 시간 및 녹음 파일의 실시간 동기화.</li>
          <li>사용자가 선택적으로 요청한 Notion 데이터베이스 실시간 동기화.</li>
          <li>사용자가 선택적으로 요청한 Gemini 기반 학습 영상 분석 및 지판/건반 다이어그램 생성.</li>
        </ul>
      </section>

      <section className={`set-sec ${styles.setSec}`} data-align-group="col: left; secs: right" aria-labelledby="privH3">
        <h2 id="privH3">3. 개인정보의 보관 및 제3자 제공</h2>
        <p>ULeveLP는 사용자의 개인정보를 외부에 판매하거나 무단으로 제3자에게 제공하지 않습니다:</p>
        <ul>
          <li>
            <b>보관 장소:</b> 서비스 데이터베이스(PostgreSQL) 및 스토리지(Supabase Storage 비공개 버킷 <code>takes</code> 또는 사용자가 선택한 본인 Google Drive).
          </li>
          <li>
            <b>암호화 보호:</b> 모든 외부 연동 시크릿은 AES-256-GCM 알고리즘으로 암호화되어 안전하게 보관됩니다.
          </li>
        </ul>
      </section>

      <section className={`set-sec ${styles.setSec}`} data-align-group="col: left; secs: right" aria-labelledby="privH4">
        <h2 id="privH4">4. 개인정보의 열람 및 영구 삭제 권리</h2>
        <p>사용자는 언제든지 자신의 개인정보를 열람하거나 영구 삭제를 요구할 수 있습니다:</p>
        <ul>
          <li>
            사용자는 <b>SETTING → 계정 → 계정 삭제</b> 메뉴에서 <code>&quot;삭제합니다&quot;</code>를 입력하여 언제든 즉시 탈퇴할 수 있습니다.
          </li>
          <li>
            탈퇴 즉시 해당 사용자의 모든 데이터베이스 레코드, 스토리지에 보관된 녹음 오디오 파일, 암호화된 API 연동 키가 지체 없이 영구 파기됩니다.
          </li>
        </ul>
      </section>
    </AppShell>
  );
}

export default PrivacyPage;
