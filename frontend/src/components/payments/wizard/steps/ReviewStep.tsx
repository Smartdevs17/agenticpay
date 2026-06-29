"use client";

import { ArrowLeft, CheckCircle, Edit3 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useWizardStore, type PaymentType } from '@/store/wizard-store';

/* ---------- Helpers ---------- */

const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  simple: 'Simple Payment',
  escrow: 'Escrow Payment',
  subscription: 'Subscription',
  batch: 'Batch Payment',
};

const INTERVAL_LABELS: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

interface Section {
  key: string;
  label: string;
  step: number;
  fields: { label: string; value: string | number | undefined | null }[];
}

/* ---------- Component ---------- */

export function ReviewStep() {
  const paymentType = useWizardStore((s) => s.paymentType);
  const formData = useWizardStore((s) => s.formData);
  const goToStep = useWizardStore((s) => s.goToStep);
  const prevStep = useWizardStore((s) => s.prevStep);
  const nextStep = useWizardStore((s) => s.nextStep);
  const setProcessingStatus = useWizardStore((s) => s.setProcessingStatus);

  const sections: Section[] = [
    {
      key: 'type',
      label: 'Payment Type',
      step: 0,
      fields: [
        {
          label: 'Type',
          value: paymentType ? PAYMENT_TYPE_LABELS[paymentType] : 'Not selected',
        },
      ],
    },
  ];

  if (paymentType === 'simple') {
    const d = formData as Record<string, string | undefined>;
    sections.push({
      key: 'details',
      label: 'Payment Details',
      step: 1,
      fields: [
        { label: 'Amount', value: d.amount },
        { label: 'Currency', value: d.currency },
        { label: 'Recipient', value: d.recipient },
        { label: 'Description', value: d.description },
      ],
    });
  } else if (paymentType === 'escrow') {
    const d = formData as Record<string, string | undefined>;
    sections.push({
      key: 'details',
      label: 'Escrow Details',
      step: 1,
      fields: [
        { label: 'Amount', value: d.amount },
        { label: 'Currency', value: d.currency },
        { label: 'Recipient', value: d.recipient },
        { label: 'Milestone Description', value: d.milestoneDescription },
        { label: 'Release Conditions', value: d.releaseConditions },
        { label: 'Arbitrator', value: d.arbitrator },
      ],
    });
  } else if (paymentType === 'subscription') {
    const d = formData as Record<string, string | number | undefined>;
    sections.push({
      key: 'details',
      label: 'Subscription Details',
      step: 1,
      fields: [
        { label: 'Amount', value: d.amount },
        { label: 'Currency', value: d.currency },
        { label: 'Recipient', value: d.recipient },
        {
          label: 'Interval',
          value: INTERVAL_LABELS[String(d.interval ?? '')] ?? d.interval,
        },
        { label: 'Max Payments', value: d.maxPayments },
      ],
    });
  } else if (paymentType === 'batch') {
    const d = formData as {
      currency?: string;
      entries?: { recipient: string; amount: string }[];
    };
    sections.push({
      key: 'details',
      label: 'Batch Details',
      step: 1,
      fields: [
        { label: 'Currency', value: d.currency },
        {
          label: 'Recipients',
          value: `${(d.entries ?? []).length} recipient(s)`,
        },
        {
          label: 'Total',
          value: (d.entries ?? [])
            .reduce(
              (sum, e) => sum + (Number.parseFloat(e.amount) || 0),
              0,
            )
            .toFixed(2),
        },
      ],
    });
  }

  const handleConfirm = () => {
    setProcessingStatus('processing');
    nextStep();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review Payment</CardTitle>
        <CardDescription>
          Please review all details before confirming the payment.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {sections.map((section) => (
          <div key={section.key} className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground">
                {section.label}
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => goToStep(section.step)}
                className="h-8 gap-1 text-xs"
              >
                <Edit3 className="h-3 w-3" />
                Edit
              </Button>
            </div>
            <div className="divide-y rounded-lg border">
              {section.fields.map((field) => (
                <div
                  key={field.label}
                  className="flex items-center justify-between px-4 py-2.5 text-sm"
                >
                  <span className="text-muted-foreground">{field.label}</span>
                  <span className="max-w-[60%] truncate font-medium">
                    {field.value ?? (
                      <span className="italic text-muted-foreground/60">
                        Not set
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Batch entries detail */}
        {paymentType === 'batch' && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">
              Recipients
            </h3>
            <div className="divide-y rounded-lg border">
              {(
                (formData as { entries?: { recipient: string; amount: string }[] })
                  .entries ?? []
              ).map((entry, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between px-4 py-2 text-sm"
                >
                  <span className="truncate font-mono text-xs">
                    {entry.recipient}
                  </span>
                  <Badge variant="secondary">{entry.amount}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-between pt-2">
          <Button type="button" variant="ghost" onClick={prevStep}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Button>
          <Button onClick={handleConfirm}>
            <CheckCircle className="mr-1 h-4 w-4" />
            Confirm &amp; Submit
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
