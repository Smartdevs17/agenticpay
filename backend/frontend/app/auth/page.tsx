'use client';

import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Wallet, Users } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
// DashboardProviders must be a static import so WagmiProvider is available
// synchronously before any child component calls useAccount() or useConnect().
// Dynamically importing it would cause a race where WalletConnect renders
// before the provider mounts, throwing a wagmi context error.
import { DashboardProviders } from '@/components/providers-dashboard';

// Dynamically import the heavy auth components — they pull in @web3auth/modal
// and wagmi connectors. Loading them on-demand keeps the auth page's initial
// JS small while the provider is already in place.
const SocialLogin = dynamic(
  () => import('@/components/auth/SocialLogin').then((m) => m.SocialLogin),
  {
    loading: () => (
      <div className="space-y-3 mt-6">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
    ),
    ssr: false,
  }
);

const WalletConnect = dynamic(
  () => import('@/components/auth/WalletConnect').then((m) => m.WalletConnect),
  {
    loading: () => (
      <div className="space-y-3 mt-6">
        <Skeleton className="h-12 w-full rounded-md" />
      </div>
    ),
    ssr: false,
  }
);

export default function AuthPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="text-center mb-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring' }}
              className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 mb-4"
            >
              <Wallet className="h-8 w-8 text-white" />
            </motion.div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Welcome to AgenticPay
            </h1>
            <p className="text-gray-600">Get paid instantly for your work</p>
          </div>

          {/* Provider must wrap the tabs so WalletConnect can call useConnect() */}
          <DashboardProviders>
            <Tabs defaultValue="social" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="social" className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Social Login
                </TabsTrigger>
                <TabsTrigger value="wallet" className="flex items-center gap-2">
                  <Wallet className="h-4 w-4" />
                  Web3 Wallet
                </TabsTrigger>
              </TabsList>

              <TabsContent value="social">
                <SocialLogin />
              </TabsContent>

              <TabsContent value="wallet">
                <WalletConnect />
              </TabsContent>
            </Tabs>
          </DashboardProviders>

          <p className="text-xs text-gray-500 text-center mt-6">
            By continuing, you agree to our Terms of Service and Privacy Policy
          </p>
        </div>
      </motion.div>
    </div>
  );
}
