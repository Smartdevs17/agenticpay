"use client";

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowLeft,
  Home,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useWizardStore } from '@/store/wizard-store';

/* ---------- Simulated processing ---------- */

function simulateProcessing(): Promise<{
  hash: string;
  success: boolean;
}> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        hash: '0x' + Array.from({ length: 64 }, () =>
          Math.floor(Math.random() * 16).toString(16),
        ).join(''),
        success: true,
      });
    }, 2500);
  });
}

/* ---------- Component ---------- */

export function ConfirmStep() {
  const processingStatus = useWizardStore((s) => s.processingStatus);
  const setProcessingStatus = useWizardStore((s) => s.setProcessingStatus);
  const transactionHash = useWizardStore((s) => s.transactionHash);
  const setTransactionHash = useWizardStore((s) => s.setTransactionHash);
  const errorMessage = useWizardStore((s) => s.errorMessage);
  const setErrorMessage = useWizardStore((s) => s.setErrorMessage);
  const reset = useWizardStore((s) => s.reset);
  const prevStep = useWizardStore((s) => s.prevStep);

  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (processingStatus !== 'processing') return;

    let cancelled = false;

    simulateProcessing()
      .then((result) => {
        if (cancelled) return;
        if (result.success) {
          setTransactionHash(result.hash);
          setProcessingStatus('success');
        } else {
          setErrorMessage('Transaction failed. Please try again.');
          setProcessingStatus('error');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : 'An unexpected error occurred');
        setProcessingStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [processingStatus, retryCount, setProcessingStatus, setTransactionHash, setErrorMessage]);

  const handleRetry = () => {
    setErrorMessage(null);
    setTransactionHash(null);
    setProcessingStatus('processing');
    setRetryCount((c) => c + 1);
  };

  const handleReset = () => {
    reset();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Confirm Payment</CardTitle>
        <CardDescription>
          {processingStatus === 'idle' && 'Ready to process your payment.'}
          {processingStatus === 'processing' && 'Processing your payment...'}
          {processingStatus === 'success' && 'Payment completed successfully!'}
          {processingStatus === 'error' && 'Something went wrong.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <AnimatePresence mode="wait">
          {processingStatus === 'processing' && (
            <motion.div
              key="processing"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex flex-col items-center justify-center gap-6 py-12"
            >
              <div className="relative">
                <Loader2 className="h-16 w-16 animate-spin text-primary" />
                <motion.div
                  className="absolute inset-0 rounded-full border-2 border-primary/20"
                  animate={{ scale: [1, 1.2, 1], opacity: [0.4, 0, 0.4] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                Please wait while your transaction is being processed...
              </p>
            </motion.div>
          )}

          {processingStatus === 'success' && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex flex-col items-center gap-4 py-8"
            >
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <CheckCircle2 className="h-10 w-10 text-green-600 dark:text-green-400" />
              </div>
              <div className="text-center">
                <h3 className="text-lg font-semibold">Transaction Submitted</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your payment has been submitted to the network.
                </p>
              </div>

              <div className="w-full max-w-md rounded-lg bg-muted p-4">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Transaction Hash</span>
                    <span className="font-mono text-xs">
                      {transactionHash?.slice(0, 16)}...
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={`https://stellar.expert/explorer/public/tx/${transactionHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="mr-1 h-4 w-4" />
                    View on Explorer
                  </a>
                </Button>
                <Button size="sm" onClick={handleReset}>
                  <Home className="mr-1 h-4 w-4" />
                  New Payment
                </Button>
              </div>
            </motion.div>
          )}

          {processingStatus === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex flex-col items-center gap-4 py-8"
            >
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                <XCircle className="h-10 w-10 text-red-600 dark:text-red-400" />
              </div>
              <div className="text-center">
                <h3 className="text-lg font-semibold">Transaction Failed</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {errorMessage ?? 'An unexpected error occurred. Please try again.'}
                </p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button variant="outline" onClick={prevStep}>
                  <ArrowLeft className="mr-1 h-4 w-4" />
                  Go Back
                </Button>
                <Button onClick={handleRetry}>
                  <RefreshCw className="mr-1 h-4 w-4" />
                  Retry
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}
