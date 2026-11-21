'use client';

/**
 * 2FA Recovery Component
 * Handles account recovery when user loses access to their authenticator app
 */

import { useState } from 'react';
import { useRequestRecovery, useCompleteRecovery } from '@/lib/hooks/use2fa';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { AlertCircle, Mail, LifeBuoy, CheckCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface TwoFactorRecoveryProps {
  userId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function TwoFactorRecovery({
  userId,
  onSuccess,
  onCancel,
}: TwoFactorRecoveryProps) {
  const [step, setStep] = useState<'request' | 'confirm'>('request');
  const [recoveryMethod, setRecoveryMethod] = useState<'email' | 'support_ticket'>('email');
  const [recoveryToken, setRecoveryToken] = useState<string>('');
  const [displayedToken, setDisplayedToken] = useState<string>('');

  const requestRecovery = useRequestRecovery();
  const completeRecovery = useCompleteRecovery();

  const handleRequestRecovery = async () => {
    try {
      const result = await requestRecovery.mutateAsync({
        userId,
        method: recoveryMethod,
      });

      setDisplayedToken(result.recoveryToken);
      setStep('confirm');
      toast.success(
        recoveryMethod === 'email'
          ? 'Recovery instructions sent to your email'
          : 'Support ticket created successfully'
      );
    } catch (error: any) {
      toast.error(error?.message || 'Failed to request recovery');
    }
  };

  const handleCompleteRecovery = async () => {
    if (!recoveryToken) {
      toast.error('Please enter the recovery token from your email');
      return;
    }

    try {
      await completeRecovery.mutateAsync({
        userId,
        recoveryToken,
      });

      toast.success(
        'Recovery completed! You can now set up a new authenticator app.'
      );
      onSuccess?.();
      setStep('request');
      setRecoveryToken('');
      setDisplayedToken('');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to complete recovery');
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LifeBuoy className="w-5 h-5" />
          Account Recovery
        </CardTitle>
        <CardDescription>
          Recover access to your account if you've lost your authenticator app
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {step === 'request' && (
          <>
            <Alert className="border-yellow-200 bg-yellow-50">
              <AlertCircle className="h-4 w-4 text-yellow-600" />
              <AlertDescription>
                This process requires verification through your email or support ticket.
                It may take some time to verify your identity.
              </AlertDescription>
            </Alert>

            <Tabs
              value={recoveryMethod}
              onValueChange={(v) => setRecoveryMethod(v as 'email' | 'support_ticket')}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="email">
                  <Mail className="w-4 h-4 mr-2" />
                  Email
                </TabsTrigger>
                <TabsTrigger value="support_ticket">
                  <LifeBuoy className="w-4 h-4 mr-2" />
                  Support
                </TabsTrigger>
              </TabsList>

              <TabsContent value="email" className="space-y-3 mt-4">
                <div className="bg-blue-50 p-3 rounded-lg text-sm">
                  <p>
                    We'll send recovery instructions to the email address associated
                    with your account. Follow the link in the email to complete the
                    recovery process.
                  </p>
                </div>

                <Button
                  onClick={handleRequestRecovery}
                  disabled={requestRecovery.isPending}
                  className="w-full"
                >
                  {requestRecovery.isPending ? 'Sending...' : 'Send Recovery Email'}
                </Button>
              </TabsContent>

              <TabsContent value="support_ticket" className="space-y-3 mt-4">
                <div className="bg-blue-50 p-3 rounded-lg text-sm">
                  <p>
                    Our support team will help you regain access to your account. A ticket
                    will be created and you'll receive updates via email.
                  </p>
                </div>

                <Button
                  onClick={handleRequestRecovery}
                  disabled={requestRecovery.isPending}
                  className="w-full"
                >
                  {requestRecovery.isPending ? 'Creating...' : 'Create Support Ticket'}
                </Button>
              </TabsContent>
            </Tabs>

            {onCancel && (
              <Button
                onClick={onCancel}
                variant="ghost"
                className="w-full"
                disabled={requestRecovery.isPending}
              >
                Cancel
              </Button>
            )}
          </>
        )}

        {step === 'confirm' && (
          <>
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertDescription>
                Check your {recoveryMethod === 'email' ? 'email' : 'support ticket'} for
                recovery instructions. Enter the recovery token below.
              </AlertDescription>
            </Alert>

            <div>
              <label className="text-sm font-medium mb-2 block">Recovery Token</label>
              <Input
                type="password"
                placeholder="Paste your recovery token"
                value={recoveryToken}
                onChange={(e) => setRecoveryToken(e.target.value)}
                disabled={completeRecovery.isPending}
              />
              <p className="text-xs text-gray-500 mt-1">
                This token was sent to your {recoveryMethod === 'email' ? 'email' : 'support contact'}
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setStep('request');
                  setRecoveryToken('');
                  setDisplayedToken('');
                }}
                variant="outline"
                className="flex-1"
                disabled={completeRecovery.isPending}
              >
                Back
              </Button>

              <Button
                onClick={handleCompleteRecovery}
                disabled={completeRecovery.isPending || !recoveryToken}
                className="flex-1"
              >
                {completeRecovery.isPending ? 'Processing...' : 'Complete Recovery'}
              </Button>
            </div>

            {displayedToken && (
              <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                <p className="text-xs font-medium text-gray-600 mb-1">Your Recovery Token:</p>
                <code className="text-xs break-all text-gray-700">{displayedToken}</code>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
