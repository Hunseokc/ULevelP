// CH-5: 코드 사이트·악보에서 진행을 읽는 법 (접이식 안내 — CH-1a §2)
import React from 'react';
import styles from './Progressions.module.css';

export function ReadingGuide(): React.ReactElement {
  return (
    <details className={styles.guide} data-testid="readingGuide">
      <summary>코드 진행 읽는 법</summary>
      <ul>
        <li>
          <b>마디는 몰라도 됩니다.</b> 코드가 바뀌는 <b>순서</b>만 적으면 됩니다. 같은 코드가 이어지면 한 번만 적어도 괜찮아요.
        </li>
        <li>
          코드 사이트에서는 가사 위에 <b>코드만 적힌 줄</b>을 보세요. 가사 줄은 건너뜁니다. <code>|</code>(마디선),{' '}
          <code>x2</code>(반복), <code>N.C.</code>(코드 없음)는 빼도 됩니다.
        </li>
        <li>
          후렴처럼 <b>여러 번 반복되는 묶음</b>(보통 2~8개)이 그 곡의 대표 진행입니다. 붙여넣기 탭이 반복 묶음을 찾아 줍니다.
        </li>
        <li>
          코드 사이는 <code>-</code>나 공백으로 나눕니다. <code>FM7 - E7 - Am7 - Gm7 C7</code>처럼 섞어 써도 됩니다.
        </li>
        <li>
          키는 코드를 보고 자동으로 추정합니다. 틀리면 드롭다운에서 고르세요. 로마숫자는 키 기준으로 자동 계산됩니다.
        </li>
      </ul>
      <p className={styles.guideExample}>
        예: 악보 줄 <code>| FM7 | E7 | Am7 | Gm7 C7 |</code> → 입력 <code>FM7 - E7 - Am7 - Gm7 - C7</code> · 키 A min →{' '}
        <code>bVIM7 - V7 - im7 - bviim7 - bIII7</code>
      </p>
    </details>
  );
}
