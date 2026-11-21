'use client';

import { KycOnboardingFlow } from '@/components/kyc/KycOnboardingFlow';
import { useAuthStore } from '@/store/useAuthStore';

export default function KycVerificationPage() {
  const address = useAuthStore((state) => state.address);

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Identity Verification (KYC)</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Verify your identity to unlock payouts and higher payment limits.
        </p>
      </div>

      {address ? (
        <KycOnboardingFlow userId={address} />
      ) : (
        <p className="text-sm text-gray-600">Sign in to start identity verification.</p>
      )}
    </div>
  );
}
