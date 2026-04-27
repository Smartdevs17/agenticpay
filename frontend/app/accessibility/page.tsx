import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, LifeBuoy, ShieldCheck } from 'lucide-react';
import { Navbar } from '@/components/landing/Navbar';

export const metadata: Metadata = {
  title: 'Accessibility Statement | AgenticPay',
  description:
    'Learn how AgenticPay approaches accessibility, inclusive design, keyboard support, and ongoing improvements.',
};

const commitments = [
  'Design flows that work with keyboard navigation and visible focus states.',
  'Use semantic structure, readable content, and clear labels for interactive elements.',
  'Review motion and contrast choices so the interface stays comfortable to use.',
  'Keep improving accessibility as new product areas and integrations ship.',
];

const supportItems = [
  'Tell us which page or feature caused trouble.',
  'Share the device, browser, and any assistive technology you were using.',
  'Include screenshots or exact steps when possible so we can reproduce the issue faster.',
];

export default function AccessibilityPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      <Navbar />

      <main className="pt-28 pb-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl">
            <Link
              href="/"
              className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition-colors hover:text-blue-600"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to home
            </Link>

            <div className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/90 shadow-xl shadow-blue-100/60 backdrop-blur-sm">
              <div className="border-b border-slate-100 bg-gradient-to-r from-blue-600 via-cyan-500 to-indigo-600 px-6 py-12 text-white sm:px-10">
                <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-medium">
                  <ShieldCheck className="h-4 w-4" />
                  Accessibility Statement
                </div>
                <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">
                  Building AgenticPay for more people, in more ways
                </h1>
                <p className="mt-4 max-w-3xl text-base leading-7 text-blue-50 sm:text-lg">
                  AgenticPay is committed to creating a product that is usable, understandable,
                  and inclusive for everyone. Accessibility is part of how we design, build, and
                  improve the platform.
                </p>
                <p className="mt-4 text-sm text-blue-100">Last updated: March 25, 2026</p>
              </div>

              <div className="space-y-12 px-6 py-10 sm:px-10 sm:py-12">
                <section aria-labelledby="commitment-heading">
                  <h2
                    id="commitment-heading"
                    className="text-2xl font-semibold tracking-tight text-slate-900"
                  >
                    Our commitment
                  </h2>
                  <p className="mt-4 text-base leading-7 text-slate-600">
                    We aim to provide an experience that supports a wide range of users,
                    including people who rely on assistive technologies such as screen readers,
                    keyboard navigation, zoom, and reduced motion settings.
                  </p>
                  <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    {commitments.map((item) => (
                      <div
                        key={item}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-5"
                      >
                        <div className="flex items-start gap-3">
                          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
                          <p className="text-sm leading-6 text-slate-700">{item}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section aria-labelledby="standards-heading">
                  <h2
                    id="standards-heading"
                    className="text-2xl font-semibold tracking-tight text-slate-900"
                  >
                    Standards and ongoing work
                  </h2>
                  <div className="mt-4 space-y-4 text-base leading-7 text-slate-600">
                    <p>
                      Our goal is to align with generally accepted accessibility best practices,
                      including the Web Content Accessibility Guidelines (WCAG), as the product
                      evolves.
                    </p>
                    <p>
                      Accessibility work is ongoing. Some areas of the platform may still be
                      improving, especially where third-party wallets, external integrations, or
                      rapidly changing product surfaces are involved.
                    </p>
                    <p>
                      We treat accessibility feedback as product feedback, which means we use it to
                      guide fixes, prioritization, and future design decisions.
                    </p>
                  </div>
                </section>

                <section aria-labelledby="assistance-heading">
                  <h2
                    id="assistance-heading"
                    className="text-2xl font-semibold tracking-tight text-slate-900"
                  >
                    Need help or want to report an issue?
                  </h2>
                  <div className="mt-4 rounded-3xl border border-blue-100 bg-blue-50/70 p-6">
                    <div className="flex items-start gap-3">
                      <LifeBuoy className="mt-1 h-5 w-5 shrink-0 text-blue-700" />
                      <div>
                        <p className="text-base leading-7 text-slate-700">
                          If you experience an accessibility barrier while using AgenticPay, please
                          report it through the project&apos;s{' '}
                          <a
                            href="https://github.com/Smartdevs17/agenticpay/issues"
                            target="_blank"
                            rel="noreferrer"
                            className="font-semibold text-blue-700 underline decoration-blue-300 underline-offset-4"
                          >
                            GitHub issue tracker
                          </a>
                          .
                        </p>
                        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600">
                          {supportItems.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                </section>

                <section aria-labelledby="review-heading">
                  <h2
                    id="review-heading"
                    className="text-2xl font-semibold tracking-tight text-slate-900"
                  >
                    Review and updates
                  </h2>
                  <p className="mt-4 text-base leading-7 text-slate-600">
                    We review this statement at least annually and update it as our product,
                    design system, and support processes mature.
                  </p>
                </section>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
