import React, { useEffect, useRef } from 'react';
import { renderSanitizedSvg } from '../../lib/security';

export interface SanitizedSvgProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'style' | 'dangerouslySetInnerHTML'> {
  svgText: string | null | undefined;
}

export function SanitizedSvg({ svgText, className, ...rest }: SanitizedSvgProps): React.ReactElement {
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.replaceChildren();
    if (svgText) {
      renderSanitizedSvg(el, svgText);
    }
  }, [svgText]);

  return <div ref={boxRef} className={className} {...rest} />;
}

