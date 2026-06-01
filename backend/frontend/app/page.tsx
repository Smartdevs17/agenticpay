/**
 * Landing page — Server Component.
 * Only the animated sub-components (HeroCTA, HeroAnimations, Navbar) are
 * client components, keeping framer-motion out of the initial HTML payload
 * for the static sections.
 */

import Link from 'next/link';
import { ArrowRight, Shield, Zap, Wallet, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Navbar } from '@/components/landing/Navbar';
import { HeroCTA } from '@/components/landing/HeroCTA';
import { HeroAnimations } from '@/components/landing/HeroAnimations';

const features = [
  {
    icon: Zap,
    title: 'Instant Payments',
    description:
      'Receive payments instantly upon milestone completion. No waiting, no delays.',
  },
  {
    icon: Shield,
    title: 'Secure & Transparent',
    description:
      'Blockchain-powered escrow ensures your funds are safe and transactions are transparent.',
  },
  {
    icon: Wallet,
    title: 'Multiple Payment Methods',
    description:
      'Connect with social login or your Web3 wallet. Choose what works for you.',
  },
  {
    icon: CheckCircle2,
    title: 'Milestone Tracking',
    description:
      'Track project progress with clear milestones and automated invoicing.',
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <Navbar />

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-grid-pattern opacity-5" aria-hidden="true" />
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 pt-32 pb-32">
          {/* Animated headline + CTA — client island */}
          <HeroCTA />
          {/* Decorative blobs — client island */}
          <HeroAnimations />
        </div>
      </section>

      {/* Features Section — fully static, no JS needed */}
      <section id="features" className="py-24 bg-white scroll-mt-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-4">
              Why Choose AgenticPay?
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Everything you need to get paid faster and more securely
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="p-8 rounded-2xl bg-gradient-to-br from-gray-50 to-white border border-gray-100 hover:shadow-xl transition-all hover:-translate-y-2"
              >
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center mb-6">
                  <feature.icon className="h-7 w-7 text-white" aria-hidden="true" />
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-3">{feature.title}</h3>
                <p className="text-gray-600 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section — static */}
      <section className="py-24 bg-gradient-to-r from-blue-600 to-purple-600">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto">
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6">
              Ready to Get Started?
            </h2>
            <p className="text-xl text-blue-100 mb-8">
              Join thousands of freelancers getting paid instantly with AgenticPay
            </p>
            <Link href="/auth" aria-label="Start earning with AgenticPay">
              <Button
                size="lg"
                className="text-lg px-8 py-6 bg-white text-blue-600 hover:bg-gray-100 shadow-xl"
              >
                Start Earning Today
                <ArrowRight className="ml-2 h-5 w-5" aria-hidden="true" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer — static */}
      <footer className="py-12 bg-gray-900 text-gray-400">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="mb-4 md:mb-0">
              <h3 className="text-xl font-bold text-white mb-2">AgenticPay</h3>
              <p className="text-sm">Secure payments for freelancers</p>
            </div>
            <div className="flex gap-6 text-sm">
              <a href="#" className="hover:text-white transition-colors">Terms</a>
              <a href="#" className="hover:text-white transition-colors">Privacy</a>
              <a href="#" className="hover:text-white transition-colors">Support</a>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t border-gray-800 text-center text-sm">
            <p>&copy; 2025 AgenticPay. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
