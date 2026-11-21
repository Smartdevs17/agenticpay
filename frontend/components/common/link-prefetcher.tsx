"use client";

import { useEffect, useRef } from "react";
import Link, { LinkProps } from "next/link";
import { routePreloader } from "@/lib/preload";

interface PrefetchLinkProps extends LinkProps {
  children: React.ReactNode;
  className?: string;
  prefetchPriority?: "high" | "low";
}

export function PrefetchLink({
  children,
  href,
  prefetchPriority = "low",
  ...props
}: PrefetchLinkProps) {
  const linkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!linkRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          routePreloader.preloadRoute(href.toString(), prefetchPriority);
        }
      },
      { rootMargin: "50px" },
    );

    observer.observe(linkRef.current);

    return () => observer.disconnect();
  }, [href, prefetchPriority]);

  const handleMouseEnter = () => {
    routePreloader.preloadRoute(href.toString(), "high");
  };

  const handleTouchStart = () => {
    routePreloader.preloadRoute(href.toString(), "high");
  };

  return (
    <Link
      ref={linkRef}
      href={href}
      onMouseEnter={handleMouseEnter}
      onTouchStart={handleTouchStart}
      {...props}
    >
      {children}
    </Link>
  );
}
