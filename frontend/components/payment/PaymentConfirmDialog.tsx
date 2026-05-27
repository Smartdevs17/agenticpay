'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CheckCircle2, ExternalLink } from 'lucide-react';

export interface ParsedPayment {
  destination: string;
  amount: string | null;
  currency: string;
  memo: string | null;
  label: string | null;
}

interface PaymentConfirmDialogProps {
  payment: ParsedPayment | null;
  onConfirm: (payment: ParsedPayment) => void;
  onCancel: () => void;
}

export function PaymentConfirmDialog({ payment, onConfirm, onCancel }: PaymentConfirmDialogProps) {
  if (!payment) return null;

  return (
    <Dialog open={!!payment} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            Confirm Payment
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <Row label="To" value={<code className="text-xs font-mono break-all">{payment.destination}</code>} />
          {payment.amount && (
            <Row label="Amount" value={`${payment.amount} ${payment.currency}`} />
          )}
          {payment.memo && <Row label="Memo" value={payment.memo} />}
          {payment.label && <Row label="Label" value={payment.label} />}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onConfirm(payment)}>Confirm & Pay</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-4 text-sm">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="text-gray-900 text-right">{value}</span>
    </div>
  );
}
