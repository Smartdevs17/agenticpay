'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/useAuthStore';

export default function OAuthCallbackPage() {
  const router = useRouter();
  const params = useSearchParams();
  const setAuth = useAuthStore((state) => state.setAuth);

  useEffect(() => {
    const token = params.get('token');
    const provider = params.get('provider');

    if (!token || !provider) {
      toast.error('OAuth login failed.');
      router.replace('/auth');
      return;
    }

    localStorage.setItem('auth_token', token);
    setAuth({
      address: '',
      email: params.get('email') ?? undefined,
      name: params.get('name') ?? undefined,
      profileImage: params.get('avatarUrl') ?? undefined,
      loginType: 'social',
    });
    toast.success(`Signed in with ${provider}.`);
    router.replace('/dashboard');
  }, [params, router, setAuth]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex items-center gap-3 text-sm text-gray-600">
        <Loader2 className="h-5 w-5 animate-spin" />
        Completing sign in...
      </div>
    </div>
  );
}
