'use client';

/**
 * 2FA Setup Component
 * Handles TOTP setup with QR code display and backup codes
 */

import { useState } from 'react';
import { useSetup2FA, useConfirm2FA } from '@/lib/hooks/use2fa';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import QRCode from 'qrcode.react';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle, Copy } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface TwoFactorSetupProps {
  userId: string;
  onSuccess?: () => void;
}

export function TwoFactorSetup({ userId, onSuccess }: TwoFactorSetupProps) {
  const [step, setStep] = useState<'setup' | 'confirm' | 'backup-codes' | 'complete'>('setup');
  const [qrCode, setQrCode] = useState<string>('');
  const [secret, setSecret] = useState<string>('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verificationToken, setVerificationToken] = useState<string>('');
  const [backupCodesConfirmed, setBackupCodesConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);

  const setup2FA = useSetup2FA();
  const confirm2FA = useConfirm2FA();

  const handleSetupClick = async () => {
    setLoading(true);
    try {
      const result = await setup2FA.mutateAsync(userId);
      setQrCode(result.qrCode);
      setSecret(result.secret);
      setBackupCodes(result.backupCodes);
      setStep('confirm');
      toast.success('QR code generated successfully');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to setup 2FA');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!verificationToken || verificationToken.length !== 6) {
      toast.error('Please enter a valid 6-digit code');
      return;
    }

    if (!backupCodesConfirmed) {
      toast.error('Please confirm that you have saved your backup codes');
      return;
    }

    setLoading(true);
    try {
      await confirm2FA.mutateAsync({
        userId,
        token: verificationToken,
        backupCodesConfirmed: true,
      });

      setStep('complete');
      toast.success('2FA setup completed successfully!');
      onSuccess?.();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to confirm 2FA');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      {step === 'setup' && (
        <Card>
          <CardHeader>
            <CardTitle>Set up Two-Factor Authentication</CardTitle>
            <CardDescription>
              Secure your account with an authenticator app
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Alert className="border-blue-200 bg-blue-50">
              <AlertCircle className="h-4 w-4 text-blue-600" />
              <AlertDescription>
                Two-factor authentication adds an extra layer of security to your account.
                You'll need to enter a code from your authenticator app in addition to your password.
              </AlertDescription>
            </Alert>

            <div>
              <h3 className="font-semibold mb-2">Step 1: Download an Authenticator App</h3>
              <p className="text-sm text-gray-600 mb-4">
                Download one of these apps on your smartphone:
              </p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full" />
                  Google Authenticator
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full" />
                  Microsoft Authenticator
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full" />
                  Authy
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full" />
                  FreeOTP
                </li>
              </ul>
            </div>

            <Button
              onClick={handleSetupClick}
              disabled={loading}
              className="w-full"
            >
              {loading ? 'Generating...' : 'Step 2: Generate QR Code'}
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 'confirm' && qrCode && (
        <Card>
          <CardHeader>
            <CardTitle>Scan QR Code</CardTitle>
            <CardDescription>
              Use your authenticator app to scan this QR code
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-col items-center gap-4">
              <div className="bg-white p-4 rounded-lg border">
                <QRCode value={qrCode} size={256} level="H" />
              </div>

              <div>
                <p className="text-sm text-gray-600 mb-2">
                  Can't scan? Enter this key manually:
                </p>
                <div className="flex items-center gap-2 bg-gray-100 p-3 rounded-lg">
                  <code className="text-sm font-mono flex-1 break-all">{secret}</code>
                  <button
                    onClick={() => copyToClipboard(secret)}
                    className="flex-shrink-0 p-2 hover:bg-gray-200 rounded"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Save your backup codes before confirming. You'll need them if you lose access to your authenticator app.
              </AlertDescription>
            </Alert>

            <div>
              <h3 className="font-semibold mb-2">Backup Codes</h3>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {backupCodes.map((code, index) => (
                  <div
                    key={index}
                    className="bg-gray-100 p-2 rounded text-sm font-mono text-center"
                  >
                    {code}
                  </div>
                ))}
              </div>
              <button
                onClick={() => {
                  const text = backupCodes.join('\n');
                  copyToClipboard(text);
                }}
                className="text-sm text-blue-600 hover:text-blue-700"
              >
                Copy all codes
              </button>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">
                Enter the 6-digit code from your authenticator app:
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
              />
            </div>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={backupCodesConfirmed}
                onChange={(e) => setBackupCodesConfirmed(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm">
                I have saved my backup codes in a safe place
              </span>
            </label>

            <Button
              onClick={handleConfirm}
              disabled={loading || !backupCodesConfirmed}
              className="w-full"
            >
              {loading ? 'Verifying...' : 'Complete Setup'}
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 'complete' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="w-6 h-6 text-green-600" />
              Setup Complete
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertDescription>
                Two-factor authentication has been successfully enabled on your account.
                You'll be required to enter a verification code on your next login.
              </AlertDescription>
            </Alert>

            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-sm text-gray-600 mb-2">
                <strong>Important:</strong> Keep your backup codes somewhere safe.
                If you lose access to your authenticator app, you can use backup codes to regain access to your account.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
