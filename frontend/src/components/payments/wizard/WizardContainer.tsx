"use client";

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useWizardStore } from '@/store/wizard-store';
import { SelectTypeStep } from './steps/SelectTypeStep';
import { ConfigureStep } from './steps/ConfigureStep';
import { ReviewStep } from './steps/ReviewStep';
import { ConfirmStep } from './steps/ConfirmStep';

const STEPS = [
  { id: 0, label: 'Select Type' },
  { id: 1, label: 'Configure' },
  { id: 2, label: 'Review' },
  { id: 3, label: 'Confirm' },
];

const stepVariants = {
  initial: { opacity: 0, x: 30 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -30 },
};

export function WizardContainer() {
  const currentStep = useWizardStore((s) => s.currentStep);
  const loadDraft = useWizardStore((s) => s.loadDraft);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!loaded) {
      loadDraft();
      setLoaded(true);
    }
  }, [loaded, loadDraft]);

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <SelectTypeStep />;
      case 1:
        return <ConfigureStep />;
      case 2:
        return <ReviewStep />;
      case 3:
        return <ConfirmStep />;
      default:
        return <SelectTypeStep />;
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* Progress indicator */}
      <div className="space-y-4">
        {/* Step circles + labels — horizontal on desktop, stacked on mobile */}
        <nav
          className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          aria-label="Payment wizard steps"
        >
          {STEPS.map((step, index) => (
            <div
              key={step.id}
              className="flex items-center gap-2 sm:flex-col sm:gap-1.5"
            >
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                  step.id <= currentStep
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {index + 1}
              </div>
              <span
                className={`text-xs font-medium ${
                  step.id === currentStep
                    ? 'text-foreground'
                    : 'text-muted-foreground'
                }`}
              >
                {step.label}
              </span>
            </div>
          ))}
        </nav>

        {/* Progress bar */}
        <div
          className="relative h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={((currentStep + 1) / STEPS.length) * 100}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
            style={{
              width: `${(currentStep / (STEPS.length - 1)) * 100}%`,
            }}
          />
        </div>
      </div>

      {/* Step content with animation */}
      <div className="min-h-[420px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            variants={stepVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.25, ease: 'easeInOut' }}
          >
            {renderStep()}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
