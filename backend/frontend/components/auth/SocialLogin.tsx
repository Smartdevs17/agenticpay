'use client';

import { useState } from 'react';
import { web3auth } from '@/lib/web3auth';
import { WALLET_ADAPTERS } from "@web3auth/base";

import { Button } from '@/components/ui/button';
import { Mail, Chrome, Twitter } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { toast } from 'sonner';

export function SocialLogin() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const setAuth = useAuthStore((state) => state.setAuth);

  const handleLogin = async (loginProvider: string) => {
    if (!web3auth) {
      toast.error('Web3Auth is not configured. Please add NEXT_PUBLIC_WEB3AUTH_CLIENT_ID to your .env.local file.');
      return;
    }

    try {
      setLoading(true);

      await web3auth.initModal();
      const web3authProvider = await web3auth.connectTo(WALLET_ADAPTERS.AUTH as any, {
        loginProvider,
      });

      if (web3authProvider) {
        // Get user info
        const user = await web3auth.getUserInfo();
        const accounts = await web3authProvider.request({
          method: 'eth_accounts',
        });

        // Save to store
        setAuth({
          address: (accounts as string[])[0],
          email: user.email,
          name: user.name,
          profileImage: user.profileImage,
          loginType: 'social',
        });

        toast.success('Login successful!');
        // Redirect to dashboard
        router.push('/dashboard');
      }
    } catch (error) {
      console.error('Login failed:', error);
      toast.error('Login failed. Please check your Web3Auth configuration.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3 mt-6">
      <Button
        variant="outline"
        className="w-full justify-start gap-3 h-12"
        onClick={() => handleLogin('google')}
        disabled={loading}
      >
        <Chrome className="h-5 w-5" />
        Continue with Google
      </Button>
      <Button
        variant="outline"
        className="w-full justify-start gap-3 h-12"
        onClick={() => handleLogin('twitter')}
        disabled={loading}
      >
        <Twitter className="h-5 w-5" />
        Continue with Twitter
      </Button>
      <Button
        variant="outline"
        className="w-full justify-start gap-3 h-12"
        onClick={() => handleLogin('email_passwordless')}
        disabled={loading}
      >
        <Mail className="h-5 w-5" />
        Continue with Email
      </Button>
    </div>
  );
}

