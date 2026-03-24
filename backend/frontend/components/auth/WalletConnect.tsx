'use client';

import { useConnect, useAccount } from 'wagmi';
import { cronosTestnet } from 'wagmi/chains';
import { Button } from '@/components/ui/button';
import { Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { useEffect } from 'react';

export function WalletConnect() {
  const { connectors, connect } = useConnect();
  const { address, isConnected } = useAccount();
  const router = useRouter();
  const setAuth = useAuthStore((state) => state.setAuth);

  useEffect(() => {
    if (isConnected && address) {
      setAuth({
        address,
        loginType: 'wallet',
      });
      router.push('/dashboard');
    }
  }, [isConnected, address, setAuth, router]);

  return (
    <div className="space-y-3 mt-6">
      {connectors.map((connector) => (
        <Button
          key={connector.id}
          variant="outline"
          className="w-full justify-start gap-3 h-12"
          onClick={() => connect({ connector, chainId: cronosTestnet.id })}
        >
          <Wallet className="h-5 w-5" />
          Connect with {connector.name}
        </Button>
      ))}
    </div>
  );
}

