'use client';

import { CSSProperties, ReactNode } from 'react';

interface FadeInProps {
  children: ReactNode;
  /** Delay in seconds */
  delay?: number;
  className?: string;
}

/**
 * Lightweight CSS-only fade-in + slide-up animation.
 * Use this instead of framer-motion <motion.div> for simple entrance
 * animations in list items and cards — it adds zero JS weight.
 */
export function FadeIn({ children, delay = 0, className = '' }: FadeInProps) {
  const style: CSSProperties = {
    animationDelay: `${delay}s`,
  };

  return (
    <div
      className={`animate-fade-in-up ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}
