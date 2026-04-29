'use client';

/**
 * 2FA Verification Component
 * Handles TOTP verification during login
 */

import { useState } from 'react';
import { useVerify2FA, useCheckDevice } from '@/lib/hooks/use2fa';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { AlertCircle, Smartphone } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface TwoFactorVerificationProps {
  userId: string;
  onSuccess: (deviceHash?: string) => void;
  onCancel?: () => void;
}

export function TwoFactorVerification({
  userId,
  onSuccess,
  onCancel,
}: TwoFactorVerificationProps) {
  const [verificationToken, setVerificationToken] = useState<string>('');
  const [backupCode, setBackupCode] = useState<string>('');
  const [rememberDevice, setRememberDevice] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'totp' | 'backup'>('totp');

  const verify2FA = useVerify2FA();

  const handleVerify = async (isBackupCode: boolean = false) => {
    const token = isBackupCode ? backupCode : verificationToken;

    if (!token || token.length < 6) {
      toast.error('Please enter a valid code');
      return;
    }

    setLoading(true);
    try {
      const result = await verify2FA.mutateAsync({
        userId,
        token,
        rememberDevice,
      });

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      toast.success('Verification successful!');
      onSuccess(result.deviceHash);
    } catch (error: any) {
      const message = error?.details?.message || error?.message || 'Verification failed';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="w-5 h-5" />
          Two-Factor Authentication
        </CardTitle>
        <CardDescription>
          Enter the code from your authenticator app
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Open your authenticator app and enter the 6-digit code shown.
          </AlertDescription>
        </Alert>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'totp' | 'backup')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="totp">Authenticator Code</TabsTrigger>
            <TabsTrigger value="backup">Backup Code</TabsTrigger>
          </TabsList>

          <TabsContent value="totp" className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">
                6-Digit Code
              </label>
              <Input
                type="text"
                placeholder="000000"
                value={verificationToken}
                onChange={(e) =>
                  setVerificationToken(
                    e.target.value.replace(/\D/g, '').slice(0, 6)
                  )
                }
                maxLength={6}
                className="text-center text-2xl tracking-widest"
                disabled={loading}
                autoFocus
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
                className="rounded"
                disabled={loading}
              />
              <span className="text-sm text-gray-600">
                Trust this device for 30 days
              </span>
            </label>

            <Button
              onClick={() => handleVerify(false)}
              disabled={loading || verificationToken.length !== 6}
              className="w-full"
            >
              {loading ? 'Verifying...' : 'Verify'}
            </Button>
          </TabsContent>

          <TabsContent value="backup" className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">
                Backup Code
              </label>
              <Input
                type="text"
                placeholder="XXXXXXXX"
                value={backupCode}
                onChange={(e) =>
                  setBackupCode(
                    e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
                  )
                }
                maxLength={8}
                className="text-center text-lg tracking-widest"
                disabled={loading}
              />
            </div>

            <p className="text-sm text-gray-600">
              Enter one of the 8-character backup codes from your saved list.
            </p>

            <Button
              onClick={() => handleVerify(true)}
              disabled={loading || backupCode.length !== 8}
              className="w-full"
              variant="outline"
            >
              {loading ? 'Verifying...' : 'Use Backup Code'}
            </Button>
          </TabsContent>
        </Tabs>

        {onCancel && (
          <Button
            onClick={onCancel}
            variant="ghost"
            className="w-full"
            disabled={loading}
          >
            Cancel
          </Button>
        )}

        <div className="pt-4 border-t">
          <p className="text-xs text-gray-500 text-center">
            Lost your authenticator app?{' '}
            <button className="text-blue-600 hover:text-blue-700 font-medium">
              Account Recovery
            </button>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
