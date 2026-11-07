import React from 'react';
import { safeUrl, safeHref } from '../../lib/security';

export interface SafeLinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'style'> {
  href: string | null | undefined;
  external?: boolean;
  children: React.ReactNode;
}

export function SafeLink({
  href,
  external = false,
  target,
  rel,
  children,
  ...rest
}: SafeLinkProps): React.ReactElement {
  const sanitized = external ? safeUrl(href) : safeHref(href);
  const isExternalHttps = sanitized.startsWith('https://');
  const finalTarget = target ?? (external || isExternalHttps ? '_blank' : undefined);
  const finalRel = rel ?? (finalTarget === '_blank' ? 'noopener noreferrer' : undefined);

  if (!sanitized) {
    return (
      <a {...rest} aria-disabled="true">
        {children}
      </a>
    );
  }

  return (
    <a {...rest} href={sanitized} target={finalTarget} rel={finalRel}>
      {children}
    </a>
  );
}

