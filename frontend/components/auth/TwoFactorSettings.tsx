'use client';

/**
 * 2FA Settings Component
 * Allows users to manage their 2FA settings
 */

import { useState } from 'react';
import {
  useGet2FAStatus,
  useDisable2FA,
  useGetBackupCodes,
  useRegenerateBackupCodes,
  useGet2FALogs,
} from '@/lib/hooks/use2fa';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Shield, AlertCircle, RefreshCw, Download, Trash2, Eye, EyeOff } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';

interface TwoFactorSettingsProps {
  userId: string;
}

export function TwoFactorSettings({ userId }: TwoFactorSettingsProps) {
  const [verificationToken, setVerificationToken] = useState('');
  const [showBackupCodes, setShowBackupCodes] = useState(false);
  const [showDisableDialog, setShowDisableDialog] = useState(false);
  const [disableReason, setDisableReason] = useState('');

  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useGet2FAStatus(userId);
  const { data: logs, isLoading: logsLoading } = useGet2FALogs(userId);
  const disable2FA = useDisable2FA();
  const getBackupCodes = useGetBackupCodes();
  const regenerateBackupCodes = useRegenerateBackupCodes();

  const handleViewBackupCodes = async () => {
    if (!verificationToken || verificationToken.length !== 6) {
      toast.error('Please enter your verification code');
      return;
    }

    try {
      const result = await getBackupCodes.mutateAsync({
        userId,
        token: verificationToken,
      });
      toast.success('Backup codes retrieved');
      setShowBackupCodes(true);
      setVerificationToken('');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to retrieve backup codes');
    }
  };

  const handleRegenerateBackupCodes = async () => {
    if (!verificationToken || verificationToken.length !== 6) {
      toast.error('Please enter your verification code');
      return;
    }

    try {
      await regenerateBackupCodes.mutateAsync({
        userId,
        token: verificationToken,
      });
      toast.success('Backup codes regenerated');
      setVerificationToken('');
      setShowBackupCodes(true);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to regenerate backup codes');
    }
  };

  const handleDisable2FA = async () => {
    if (!verificationToken || verificationToken.length !== 6) {
      toast.error('Please enter your verification code');
      return;
    }

    try {
      await disable2FA.mutateAsync({
        userId,
        token: verificationToken,
        reason: disableReason,
      });
      toast.success('2FA has been disabled');
      setShowDisableDialog(false);
      setVerificationToken('');
      setDisableReason('');
      refetchStatus();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to disable 2FA');
    }
  };

  const downloadBackupCodes = () => {
    if (!getBackupCodes.data?.backupCodes) return;

    const content = getBackupCodes.data.backupCodes.join('\n');
    const element = document.createElement('a');
    element.setAttribute(
      'href',
      `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`
    );
    element.setAttribute('download', 'backup-codes.txt');
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    toast.success('Backup codes downloaded');
  };

  if (statusLoading) {
    return <div className="text-center py-8">Loading 2FA settings...</div>;
  }

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Two-Factor Authentication Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="font-medium">
                {status?.enabled ? '2FA Enabled' : '2FA Disabled'}
              </p>
              {status?.enabled && (
                <p className="text-sm text-gray-600">
                  Last verified:{' '}
                  {status.lastUsedAt
                    ? format(new Date(status.lastUsedAt), 'MMM dd, yyyy HH:mm')
                    : 'Never'}
                </p>
              )}
            </div>
            <Badge variant={status?.enabled ? 'default' : 'secondary'}>
              {status?.enabled ? 'Active' : 'Inactive'}
            </Badge>
          </div>

          {status?.enabled && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm">
                <strong>Backup Codes Remaining:</strong>{' '}
                {status.backupCodesRemaining}
              </p>
              {status.backupCodesRemaining < 3 && (
                <Alert className="mt-3 border-yellow-200 bg-yellow-50">
                  <AlertCircle className="h-4 w-4 text-yellow-600" />
                  <AlertDescription>
                    You have fewer than 3 backup codes remaining.
                    Consider regenerating them.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {status?.enabled && (
        <>
          {/* Backup Codes Management */}
          <Card>
            <CardHeader>
              <CardTitle>Backup Codes</CardTitle>
              <CardDescription>
                Use backup codes to access your account if you lose your authenticator app
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium mb-2 block">
                    Enter your verification code:
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
                    className="text-center text-lg tracking-widest"
                  />
                </div>

                {getBackupCodes.data?.backupCodes && showBackupCodes && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 bg-gray-50 p-4 rounded-lg max-h-48 overflow-y-auto">
                      {getBackupCodes.data.backupCodes.map((code, index) => (
                        <div
                          key={index}
                          className="bg-white p-2 rounded text-sm font-mono text-center border"
                        >
                          {code}
                        </div>
                      ))}
                    </div>

                    <div className="flex gap-2">
                      <Button
                        onClick={downloadBackupCodes}
                        variant="outline"
                        size="sm"
                        className="flex-1"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download
                      </Button>
                      <Button
                        onClick={() => {
                          const text = getBackupCodes.data.backupCodes.join('\n');
                          navigator.clipboard.writeText(text);
                          toast.success('Copied to clipboard');
                        }}
                        variant="outline"
                        size="sm"
                        className="flex-1"
                      >
                        Copy All
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleViewBackupCodes}
                  disabled={getBackupCodes.isPending || verificationToken.length !== 6}
                  className="flex-1"
                  variant="outline"
                >
                  {showBackupCodes ? (
                    <>
                      <EyeOff className="w-4 h-4 mr-2" />
                      Hide Codes
                    </>
                  ) : (
                    <>
                      <Eye className="w-4 h-4 mr-2" />
                      View Codes
                    </>
                  )}
                </Button>

                <Button
                  onClick={handleRegenerateBackupCodes}
                  disabled={
                    regenerateBackupCodes.isPending || verificationToken.length !== 6
                  }
                  className="flex-1"
                  variant="outline"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Regenerate
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Activity Logs */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>
                Recent 2FA-related activities on your account
              </CardDescription>
            </CardHeader>
            <CardContent>
              {logsLoading ? (
                <div className="text-center py-8 text-gray-500">Loading logs...</div>
              ) : logs?.logs && logs.logs.length > 0 ? (
                <div className="space-y-3">
                  {logs.logs.slice(0, 10).map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                    >
                      <div>
                        <p className="font-medium text-sm capitalize">
                          {log.action.replace(/_/g, ' ')}
                        </p>
                        <p className="text-xs text-gray-600">
                          {format(new Date(log.createdAt), 'MMM dd, yyyy HH:mm:ss')}
                        </p>
                        {log.ipAddress && (
                          <p className="text-xs text-gray-500">{log.ipAddress}</p>
                        )}
                      </div>
                      <Badge variant={log.success ? 'default' : 'destructive'}>
                        {log.success ? 'Success' : 'Failed'}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">No activity yet</div>
              )}
            </CardContent>
          </Card>

          {/* Disable 2FA */}
          <Card className="border-red-200">
            <CardHeader>
              <CardTitle className="text-red-600">Disable 2FA</CardTitle>
              <CardDescription>
                This will disable two-factor authentication on your account
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Alert className="mb-4 border-red-200 bg-red-50">
                <AlertCircle className="h-4 w-4 text-red-600" />
                <AlertDescription>
                  Disabling 2FA reduces your account security. Only do this if you're
                  certain you want to remove this protection.
                </AlertDescription>
              </Alert>

              <Button
                onClick={() => setShowDisableDialog(true)}
                variant="destructive"
                className="w-full"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Disable 2FA
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      {/* Disable Dialog */}
      <Dialog open={showDisableDialog} onOpenChange={setShowDisableDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm 2FA Disabling</DialogTitle>
            <DialogDescription>
              This action cannot be undone. Please confirm by entering your verification code.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">
                Reason for disabling (optional):
              </label>
              <Input
                placeholder="e.g., Lost device, setting up new device"
                value={disableReason}
                onChange={(e) => setDisableReason(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">
                Enter your verification code:
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
                className="text-center text-lg tracking-widest"
              />
            </div>

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setShowDisableDialog(false)}
                disabled={disable2FA.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDisable2FA}
                disabled={disable2FA.isPending || verificationToken.length !== 6}
              >
                {disable2FA.isPending ? 'Disabling...' : 'Disable 2FA'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
