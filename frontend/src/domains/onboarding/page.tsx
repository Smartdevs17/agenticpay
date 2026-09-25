'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';

export default function OnboardingPage() {
  const [step, setStep] = useState(0);

  const next = () => setStep((s) => Math.min(s + 1, 3));
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Welcome to AgenticPay</h1>
      <div>
        {step === 0 && (
          <div>
            <p className="text-sm text-gray-600">Let's get you set up quickly.</p>
          </div>
        )}
        {step === 1 && (
          <div>
            <p className="text-sm text-gray-600">Set up your profile information.</p>
          </div>
        )}
        {step === 2 && (
          <div>
            <p className="text-sm text-gray-600">Add a payment method to receive funds.</p>
          </div>
        )}
        {step === 3 && (
          <div>
            <p className="text-sm text-gray-600">Create your first report to get insights.</p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={prev} disabled={step === 0}>
          Back
        </Button>
        <Button onClick={next} className="ml-auto">
          {step === 3 ? 'Finish' : 'Next'}
        </Button>
      </div>
    </div>
  );
}
