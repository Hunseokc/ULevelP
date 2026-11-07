// frontend/src/lib/categories.ts
import type { CategoryDto } from './apiClient';

export const CATEGORY_NAME_MAX = 20;

const OPEN_CATEGORY_KEY = 'ulp:open-category';

// 서버 순서(sortOrder) 그대로, 홈에 켠 분류만
export function homeCategories(list: ReadonlyArray<CategoryDto>): CategoryDto[] {
  return [...list].sort((a, b) => a.sortOrder - b.sortOrder).filter((c) => c.onHome);
}

// 홈 분류 버튼 → 플레이어: URL을 바꾸지 않고 탭 단위로 한 번 넘긴다
export function setOpenCategory(id: string): void {
  try {
    sessionStorage.setItem(OPEN_CATEGORY_KEY, id);
  } catch {
    /* 저장 불가 무시 */
  }
}

// PracticePage가 처음 로그인 상태가 되면 한 번 읽고 지운 뒤, 곡 목록 서랍을 그 분류 폴더만 펼쳐 연다
export function takeOpenCategory(): string {
  try {
    const v = sessionStorage.getItem(OPEN_CATEGORY_KEY) || '';
    sessionStorage.removeItem(OPEN_CATEGORY_KEY);
    return v;
  } catch {
    return '';
  }
}
