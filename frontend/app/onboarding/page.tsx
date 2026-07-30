'use client';

/**
 * Onboarding wizard entry page — Issue #591
 *
 * Role selection gateway. After selecting a role, the user is directed
 * to the step-by-step wizard (/onboarding/wizard).
 */

import React from 'react';
import { useRouter } from 'next/navigation';
import { useOnboardingStore } from '@/store/useOnboardingStore';
import type { UserRole } from '@/store/useOnboardingStore';

interface RoleCard {
  role: NonNullable<UserRole>;
  title: string;
  description: string;
  icon: string;
  highlights: string[];
}

const ROLE_CARDS: RoleCard[] = [
  {
    role: 'freelancer',
    title: 'Freelancer',
    description: 'Find projects, submit work, and get paid instantly via Stellar.',
    icon: '💻',
    highlights: ['Browse & apply to projects', 'Get paid in crypto or fiat', 'Build your portfolio'],
  },
  {
    role: 'client',
    title: 'Client',
    description: 'Post projects, hire freelancers, and release payments from escrow.',
    icon: '🏢',
    highlights: ['Post projects', 'Escrow-secured payments', 'AI work verification'],
  },
  {
    role: 'merchant',
    title: 'Merchant / Business',
    description: 'Accept payments, manage subscriptions, and integrate via API.',
    icon: '🛒',
    highlights: ['Accept crypto & fiat', 'Subscription billing', 'Developer API'],
  },
];

export default function OnboardingPage() {
  const router = useRouter();
  const { initWizard, analytics } = useOnboardingStore();

  const handleSelectRole = (role: NonNullable<UserRole>) => {
    initWizard(role);
    router.push('/onboarding/wizard');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center px-4 py-12">
      <div className="max-w-4xl w-full">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Welcome to AgenticPay</h1>
          <p className="mt-3 text-lg text-gray-600 dark:text-gray-300">
            Tell us how you'll use the platform so we can personalise your experience.
          </p>
          {/* A/B variant indicator (dev only) */}
          {process.env.NODE_ENV === 'development' && (
            <p className="mt-1 text-xs text-gray-400">A/B Variant: {analytics.variant} · Session: {analytics.sessionId}</p>
          )}
        </div>

        {/* Role cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {ROLE_CARDS.map(({ role, title, description, icon, highlights }) => (
            <button
              key={role}
              onClick={() => handleSelectRole(role)}
              className="group relative bg-white dark:bg-gray-800 rounded-2xl shadow-md p-6 text-left border-2 border-transparent hover:border-blue-500 focus:border-blue-500 transition-all duration-200 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              aria-label={`Select role: ${title}`}
            >
              <div className="text-4xl mb-3" aria-hidden="true">{icon}</div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                {title}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{description}</p>
              <ul className="space-y-1.5">
                {highlights.map((h) => (
                  <li key={h} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                    <svg className="w-3.5 h-3.5 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    {h}
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex items-center gap-1 text-sm font-medium text-blue-600 dark:text-blue-400 group-hover:gap-2 transition-all">
                Get started <span aria-hidden="true">→</span>
              </div>
            </button>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-gray-500 dark:text-gray-400">
          Already have an account?{' '}
          <a href="/login" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 font-medium focus:outline-none focus:underline">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
