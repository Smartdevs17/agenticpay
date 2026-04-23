'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatEther } from 'viem';

type ConfirmModalProps = {
  open: boolean;
  functionName: string;
  contractAddress: string;
  args: unknown[];
  gasEstimate?: bigint;
  value?: bigint;
  isSubmitting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const formatArg = (arg: unknown): string => {
  if (typeof arg === 'bigint') return arg.toString();
  if (typeof arg === 'string') return arg;
  if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
  if (Array.isArray(arg)) return JSON.stringify(arg.map((item) => formatArg(item)));
  if (arg && typeof arg === 'object') return JSON.stringify(arg);
  return String(arg);
};

export function ConfirmModal({
  open,
  functionName,
  contractAddress,
  args,
  gasEstimate,
  value,
  isSubmitting = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Confirm Transaction</DialogTitle>
          <DialogDescription>
            Review transaction details before signing with your wallet.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="rounded-lg border p-3">
            <p className="text-muted-foreground">Contract Function</p>
            <p className="font-medium">{functionName}</p>
          </div>

          <div className="rounded-lg border p-3">
            <p className="text-muted-foreground">Contract Address</p>
            <p className="font-mono break-all">{contractAddress}</p>
          </div>

          <div className="rounded-lg border p-3">
            <p className="text-muted-foreground mb-2">Transaction Parameters</p>
            {args.length === 0 ? (
              <p className="text-muted-foreground">No parameters</p>
            ) : (
              <div className="space-y-2">
                {args.map((arg, idx) => (
                  <div key={`${idx}-${formatArg(arg)}`} className="grid grid-cols-[auto,1fr] gap-2">
                    <span className="text-muted-foreground">arg{idx}:</span>
                    <span className="font-mono break-all">{formatArg(arg)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border p-3">
            <p className="text-muted-foreground">Estimated Gas</p>
            <p className="font-medium">{gasEstimate ? gasEstimate.toString() : 'Unavailable'}</p>
          </div>

          {value && value > 0n && (
            <div className="rounded-lg border p-3">
              <p className="text-muted-foreground">Native Value</p>
              <p className="font-medium">{formatEther(value)} ETH</p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={isSubmitting}>
            {isSubmitting ? 'Submitting...' : 'Confirm & Sign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
