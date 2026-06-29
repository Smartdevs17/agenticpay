"use client";

import { useState } from 'react';
import { z } from 'zod';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Send,
  Shield,
  Repeat,
  ClipboardList,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useWizardStore, type PaymentType } from '@/store/wizard-store';

const selectTypeSchema = z.object({
  paymentType: z.enum(['simple', 'escrow', 'subscription', 'batch'], {
    required_error: 'Please select a payment type',
  }),
});

interface PaymentTypeOption {
  value: PaymentType;
  label: string;
  description: string;
  icon: LucideIcon;
}

const OPTIONS: PaymentTypeOption[] = [
  {
    value: 'simple',
    label: 'Simple Payment',
    description: 'Send a one-time payment to any recipient.',
    icon: Send,
  },
  {
    value: 'escrow',
    label: 'Escrow Payment',
    description: 'Hold funds in escrow until milestone conditions are met.',
    icon: Shield,
  },
  {
    value: 'subscription',
    label: 'Subscription',
    description: 'Set up recurring payments on a custom schedule.',
    icon: Repeat,
  },
  {
    value: 'batch',
    label: 'Batch Payment',
    description: 'Pay multiple recipients in a single transaction.',
    icon: ClipboardList,
  },
];

export function SelectTypeStep() {
  const paymentType = useWizardStore((s) => s.paymentType);
  const setPaymentType = useWizardStore((s) => s.setPaymentType);
  const nextStep = useWizardStore((s) => s.nextStep);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = (value: PaymentType) => {
    setPaymentType(value);
    setError(null);
  };

  const handleNext = () => {
    const result = selectTypeSchema.safeParse({ paymentType });
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Please select a payment type');
      return;
    }
    nextStep();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Select Payment Type</CardTitle>
        <CardDescription>
          Choose the type of payment you want to create.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {OPTIONS.map((option, index) => {
            const Icon = option.icon;
            const selected = paymentType === option.value;

            return (
              <motion.button
                key={option.value}
                type="button"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.08, duration: 0.25 }}
                onClick={() => handleSelect(option.value)}
                className={`relative flex flex-col items-start gap-3 rounded-xl border p-5 text-left transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  selected
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border bg-card'
                }`}
              >
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                    selected
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <span className="block font-semibold">{option.label}</span>
                  <span className="block text-sm text-muted-foreground">
                    {option.description}
                  </span>
                </div>
                {selected && (
                  <motion.div
                    layoutId="selected-check"
                    className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary"
                    initial={false}
                  >
                    <svg
                      className="h-3 w-3 text-primary-foreground"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </motion.div>
                )}
              </motion.button>
            );
          })}
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end">
          <Button onClick={handleNext} disabled={!paymentType}>
            Continue
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
