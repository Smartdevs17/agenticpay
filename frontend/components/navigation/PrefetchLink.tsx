'use client';

import { forwardRef, useCallback, useRef } from 'react';
import Link, { type LinkProps } from 'next/link';
import { useRouter } from 'next/navigation';

type PrefetchLinkProps = LinkProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & {
    children: React.ReactNode;
  };

/**
 * Wraps next/link with hover/focus prefetching for critical routes.
 * Next's default `prefetch` only fires when the link enters the viewport;
 * this triggers `router.prefetch()` as soon as intent is signalled
 * (pointer hover or keyboard focus), so navigation feels instant.
 */
export const PrefetchLink = forwardRef<HTMLAnchorElement, PrefetchLinkProps>(
  ({ href, prefetch = false, onMouseEnter, onFocus, ...props }, ref) => {
    const router = useRouter();
    const prefetched = useRef(false);

    const triggerPrefetch = useCallback(() => {
      if (prefetched.current) return;
      prefetched.current = true;
      const url = typeof href === 'string' ? href : href.pathname ?? '';
      if (url) router.prefetch(url);
    }, [href, router]);

    return (
      <Link
        ref={ref}
        href={href}
        prefetch={prefetch}
        onMouseEnter={(e) => {
          triggerPrefetch();
          onMouseEnter?.(e);
        }}
        onFocus={(e) => {
          triggerPrefetch();
          onFocus?.(e);
        }}
        {...props}
      />
    );
  },
);

PrefetchLink.displayName = 'PrefetchLink';
