'use client';

import { useState, useEffect } from 'react';
import { useConnect, useAccount, useSwitchChain } from 'wagmi';
import { Button } from '@/components/ui/button';
import { Wallet, Loader2, AlertCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';

export function WalletConnect() {
  const { connectors, connect, isPending, error, variables } = useConnect();
  const { address, isConnected, chain } = useAccount();
  const { chains, switchChain } = useSwitchChain();
  const router = useRouter();
  const setAuth = useAuthStore((state) => state.setAuth);

  // Prevent hydration mismatch errors in Next.js
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timer);
  }, []);

  // Preserve the original auth & redirect logic!
  useEffect(() => {
    if (isConnected && address) {
      setAuth({
        address,
        loginType: 'wallet',
      });
      router.push('/dashboard');
    }
  }, [isConnected, address, setAuth, router]);

  if (!mounted) return null;

  return (
    <div className="space-y-4 w-full">
      {/* 1. Connection Buttons with Progress States */}
      <div className="space-y-3">
        {connectors.map((connector) => {
          // Track exactly which button was clicked for the loading spinner
          // FIX: Changed .uid to .name to bypass TypeScript errors
          const isThisLoading = isPending && variables?.connector?.name === connector.name;

          return (
            <Button
              // FIX: Changed .uid to .name to bypass TypeScript errors
              key={connector.name}
              variant="outline"
              className="w-full justify-start gap-3 h-12 relative transition-all"
              onClick={() => connect({ connector })}
              disabled={isPending}
            >
              {isThisLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
              ) : (
                <Wallet className="h-5 w-5 text-gray-700" />
              )}
              <span className="font-medium">
                {isThisLoading ? 'Connecting...' : `Connect with ${connector.name}`}
              </span>
            </Button>
          );
        })}
      </div>

      {/* 2. Graceful Error Handling */}
      {error && (
        <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md border border-red-100 flex items-start gap-2 animate-in fade-in slide-in-from-top-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p className="leading-tight">
            {error.message.split('.')[0] || 'Failed to connect wallet. Please try again.'}
          </p>
        </div>
      )}

      {/* 3. Network Switching Support */}
      {/* This will show up if the user cancels a signature or before the redirect fires */}
      {switchChain && (
        <div className="pt-2">
          <p className="text-xs text-gray-500 mb-2 font-medium">Available Networks</p>
          <div className="flex flex-wrap gap-2">
            {chains.map((x) => (
              <Button
                key={x.id}
                variant={x.id === chain?.id ? "default" : "outline"}
                size="sm"
                onClick={() => switchChain({ chainId: x.id })}
                disabled={x.id === chain?.id}
                className="flex-1 text-xs h-8"
              >
                {x.name}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}