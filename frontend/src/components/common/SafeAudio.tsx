import React, { useEffect, useRef } from 'react';
import { safeAudioUrl } from '../../lib/security';

export interface SafeAudioProps extends Omit<React.AudioHTMLAttributes<HTMLAudioElement>, 'src' | 'style'> {
  srcUrl: string | null | undefined;
  takeId?: string;
}

export function SafeAudio({
  srcUrl,
  takeId,
  controls = true,
  preload = 'metadata',
  ...rest
}: SafeAudioProps): React.ReactElement {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const valid = safeAudioUrl(srcUrl);
    if (!valid) {
      el.removeAttribute('src');
      delete el.dataset.loadedSrc;
      delete el.dataset.takeId;
      try {
        el.load();
      } catch {
        /* JSDOM/비브라우저 환경 무시 */
      }
      return;
    }
    const prevSrc = el.dataset.loadedSrc || '';
    const prevId = el.dataset.takeId || '';
    const nextId = takeId || valid;
    if (prevSrc !== valid || prevId !== nextId) {
      el['src'] = valid;
      el.dataset.loadedSrc = valid;
      el.dataset.takeId = nextId;
    }
  }, [srcUrl, takeId]);

  return <audio ref={audioRef} controls={controls} preload={preload} {...rest} />;
}

