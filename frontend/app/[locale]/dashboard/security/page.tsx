'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TwoFactorSetup } from '@/components/auth/TwoFactorSetup';
import { useGet2FAStatus, useDisable2FA } from '@/lib/hooks/use2fa';
import { useAuthStore } from '@/store/useAuthStore';
import { toast } from 'sonner';
import { Shield, ShieldCheck, ShieldOff, Clock, KeyRound } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function SecurityPage() {
  const address = useAuthStore((state) => state.address);
  const userId = address ?? '';

  const { data: status, isLoading, refetch } = useGet2FAStatus(userId);
  const disable2FA = useDisable2FA();

  const [showDisableForm, setShowDisableForm] = useState(false);
  const [disableToken, setDisableToken] = useState('');
  const [disabling, setDisabling] = useState(false);

  const handleDisable = async () => {
    if (!disableToken || (disableToken.length !== 6 && disableToken.length !== 8)) {
      toast.error('Enter your 6-digit TOTP code or an 8-character backup code');
      return;
    }
    setDisabling(true);
    try {
      await disable2FA.mutateAsync({ userId, token: disableToken });
      toast.success('Two-factor authentication disabled');
      setShowDisableForm(false);
      setDisableToken('');
      refetch();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to disable 2FA');
    } finally {
      setDisabling(false);
    }
  };

  if (!userId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
        <Shield className="h-12 w-12 text-gray-400" />
        <h2 className="text-2xl font-bold">Connect your wallet</h2>
        <p className="text-gray-500">Connect your wallet to manage security settings.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8 pb-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Security</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Manage two-factor authentication and wallet security settings.
        </p>
      </div>

      {/* 2FA Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {status?.enabled ? (
              <ShieldCheck className="h-5 w-5 text-green-600" />
            ) : (
              <ShieldOff className="h-5 w-5 text-amber-500" />
            )}
            Two-Factor Authentication
          </CardTitle>
          <CardDescription>
            Protect sensitive wallet operations with a TOTP authenticator app.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <p className="text-sm text-gray-500">Loading status…</p>
          ) : status?.enabled ? (
            <>
              <Alert className="border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-800">
                <ShieldCheck className="h-4 w-4 text-green-600" />
                <AlertDescription>
                  2FA is active on your account. Sensitive operations require a verification code.
                </AlertDescription>
              </Alert>

              <div className="grid grid-cols-2 gap-4 text-sm">
                {status.verifiedAt && (
                  <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                    <Clock className="h-4 w-4" />
                    <span>Enabled {new Date(status.verifiedAt).toLocaleDateString()}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                  <KeyRound className="h-4 w-4" />
                  <span>{status.backupCodesRemaining} backup codes remaining</span>
                </div>
              </div>

              {!showDisableForm ? (
                <Button
                  variant="outline"
                  className="border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300"
                  onClick={() => setShowDisableForm(true)}
                >
                  <ShieldOff className="h-4 w-4 mr-2" />
                  Disable 2FA
                </Button>
              ) : (
                <div className="space-y-3 p-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-800">
                  <p className="text-sm font-medium text-red-700 dark:text-red-400">
                    Enter your current TOTP code or a backup code to disable 2FA:
                  </p>
                  <Input
                    placeholder="6-digit code or 8-char backup code"
                    value={disableToken}
                    onChange={(e) => setDisableToken(e.target.value.toUpperCase().replace(/\s/g, ''))}
                    maxLength={8}
                    className="font-mono tracking-widest text-center"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      onClick={handleDisable}
                      disabled={disabling}
                      className="flex-1"
                    >
                      {disabling ? 'Disabling…' : 'Confirm Disable'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowDisableForm(false);
                        setDisableToken('');
                      }}
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800">
                <ShieldOff className="h-4 w-4 text-amber-600" />
                <AlertDescription>
                  2FA is not enabled. Enable it to protect your wallet operations with an extra layer of security.
                </AlertDescription>
              </Alert>
              <TwoFactorSetup userId={userId} onSuccess={() => refetch()} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
