// frontend/src/lib/security.ts
export type ULPStorageKey =
  | 'ulp:auth'
  | 'ulp:keys'
  | 'ulp:theme'
  | 'ulp:tab'
  | 'ulp:lead'
  | 'ulp:copied'
  | 'ulp:notion-practice'
  | 'ulp:notion-notes'
  | 'ulp:progressions'
  | `ulp:v:${string}`;

const LEGACY_KEY_MAP: ReadonlyArray<readonly [string, ULPStorageKey]> = [
  ['gv-theme', 'ulp:theme'],
  ['gv-tab', 'ulp:tab'],
  ['pp-lead', 'ulp:lead'],
  ['ul-notion-practice', 'ulp:notion-practice'],
  ['ul-notion-notes', 'ulp:notion-notes'],
];

export const raw = {
  get(k: ULPStorageKey): string {
    try {
      return localStorage.getItem(k) || '';
    } catch {
      return '';
    }
  },
  set(k: ULPStorageKey, v: string): void {
    try {
      if (v) localStorage.setItem(k, v);
      else localStorage.removeItem(k);
    } catch {
      /* 저장 불가 무시 */
    }
  },
};

export const json = {
  get<T>(k: ULPStorageKey, d: T): T {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : (JSON.parse(v) as T);
    } catch {
      return d;
    }
  },
  set<T>(k: ULPStorageKey, v: T): void {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* 저장 불가 무시 */
    }
  },
};

export function migrateLegacyStorageOnce(): void {
  try {
    if (!localStorage.getItem('ulp:copied')) {
      for (const [from, to] of LEGACY_KEY_MAP) {
        const v = localStorage.getItem(from);
        if (v != null && localStorage.getItem(to) == null) {
          localStorage.setItem(to, v);
        }
      }
      localStorage.setItem('ulp:copied', '1');
    }
    const t = localStorage.getItem('ulp:theme');
    if (typeof document !== 'undefined' && document.documentElement) {
      if (t === 'light' || t === 'dark') {
        document.documentElement.dataset.theme = t;
      } else {
        delete document.documentElement.dataset.theme;
      }
    }
  } catch {
    /* 저장소 접근 불가 시 무시 */
  }
}

export function getTheme(): 'light' | 'dark' | '' {
  const v = raw.get('ulp:theme');
  return v === 'light' || v === 'dark' ? v : '';
}

export const THEME_EVENT = 'ulp:themechange';

export function setTheme(theme: 'light' | 'dark' | ''): void {
  raw.set('ulp:theme', theme);
  if (typeof document !== 'undefined' && document.documentElement) {
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.dataset.theme = theme;
    } else {
      delete document.documentElement.dataset.theme;
    }
  }
  // 한 화면에 테마 컨트롤이 둘(하단 공통 + 설정 화면 섹션)일 때 눌림 표시를 맞춘다
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(THEME_EVENT));
}

export function videoIdFrom(text: unknown): string | null {
  const s = String(text ?? '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/(?:shorts|embed|live)\/)([\w-]{11})/);
  return m ? m[1] : null;
}

export function thumb(videoId: string): string {
  const id = videoIdFrom(videoId) || '';
  return id ? 'https://i.ytimg.com/vi/' + encodeURIComponent(id) + '/mqdefault.jpg' : '';
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[c] || c;
  });
}

/** 외부 절대 URL 정화: https: 프로토콜만 허용하고 javascript:, data:, http: 등은 빈 문자열 반환 */
export function safeUrl(u: unknown): string {
  try {
    const x = new URL(String(u ?? '').trim());
    return x.protocol === 'https:' ? x.href : '';
  } catch {
    return '';
  }
}

/** 내부 상대 경로 또는 외부 https URL 정화: javascript:, data:, vbscript:, // 차단 */
export function safeHref(u: unknown): string {
  const rawStr = String(u ?? '').trim();
  if (!rawStr) return '';
  if (/^(?:javascript|data|vbscript|blob|file):/i.test(rawStr) || rawStr.startsWith('//')) {
    return '';
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawStr)) {
    return safeUrl(rawStr);
  }
  return rawStr;
}

/** 오디오 재생용 URL 정화: blob: 또는 https: 만 허용 */
export function safeAudioUrl(u: unknown): string {
  const rawStr = String(u ?? '').trim();
  if (!rawStr) return '';
  if (rawStr.startsWith('blob:')) return rawStr;
  return safeUrl(rawStr);
}

export const ALLOWED_SVG_TAGS: ReadonlySet<string> = new Set([
  'svg', 'g', 'rect', 'line', 'path', 'circle', 'text',
]);

export const ALLOWED_SVG_ATTRS: ReadonlySet<string> = new Set([
  'xmlns', 'width', 'height', 'viewBox', 'font-family', 'transform',
  'fill', 'stroke', 'stroke-width', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'cx', 'cy', 'r', 'd', 'font-size', 'font-weight', 'text-anchor',
]);

const SVG_NS = 'http://www.w3.org/2000/svg';

export function sanitizeSvgNode(srcNode: Node, doc: Document = document): Node | null {
  if (srcNode.nodeType === 3 /* Node.TEXT_NODE */) {
    return doc.createTextNode(srcNode.textContent || '');
  }
  if (srcNode.nodeType !== 1 /* Node.ELEMENT_NODE */) {
    return null;
  }
  const elem = srcNode as Element;
  const tag = (elem.localName || elem.tagName || '').toLowerCase();
  if (!ALLOWED_SVG_TAGS.has(tag)) {
    return null;
  }
  const cleanEl = doc.createElementNS(SVG_NS, tag);
  for (let i = 0; i < elem.attributes.length; i++) {
    const attr = elem.attributes[i];
    const name = attr.name.toLowerCase();
    if (ALLOWED_SVG_ATTRS.has(name)) {
      const val = attr.value;
      if (!val.toLowerCase().includes('javascript:') && !name.startsWith('on')) {
        cleanEl.setAttribute(attr.name, val);
      }
    }
  }
  for (let i = 0; i < elem.childNodes.length; i++) {
    const cleanChild = sanitizeSvgNode(elem.childNodes[i], doc);
    if (cleanChild) {
      cleanEl.appendChild(cleanChild);
    }
  }
  return cleanEl;
}

export function renderSanitizedSvg(container: Element | null, svgText: string | null | undefined): void {
  if (!container || typeof svgText !== 'string' || !svgText.trim()) return;
  try {
    const parser = new DOMParser();
    const parsedDoc = parser.parseFromString(svgText, 'image/svg+xml');
    if (parsedDoc.querySelector('parsererror')) return;
    const root = parsedDoc.documentElement;
    if (!root) return;
    const cleanEl = sanitizeSvgNode(root, container.ownerDocument || document);
    if (cleanEl) {
      container.appendChild(cleanEl);
    }
  } catch {
    /* 잘못된 SVG XML 무시 */
  }
}

