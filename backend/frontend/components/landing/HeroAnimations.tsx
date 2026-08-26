'use client';

import { motion } from 'framer-motion';

/**
 * Purely decorative floating blobs on the hero section.
 * Isolated into a tiny client component so the rest of the landing page
 * can remain a Server Component.
 */
export function HeroAnimations() {
  return (
    <>
      <motion.div
        aria-hidden="true"
        animate={{ y: [0, -20, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-20 right-10 w-20 h-20 bg-blue-200 rounded-full opacity-20 blur-xl pointer-events-none"
      />
      <motion.div
        aria-hidden="true"
        animate={{ y: [0, 20, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute bottom-20 left-10 w-32 h-32 bg-purple-200 rounded-full opacity-20 blur-xl pointer-events-none"
      />
    </>
  );
}
