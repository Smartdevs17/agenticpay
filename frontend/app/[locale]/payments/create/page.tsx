"use client";

import { WizardContainer } from "@/src/components/payments/wizard/WizardContainer";
import { PageTransition } from "@/components/ui/page-transition";

export default function CreatePaymentPage() {
  return (
    <PageTransition>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Create Payment
          </h1>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            Create a new payment using the multi-step wizard.
          </p>
        </div>
        <WizardContainer />
      </div>
    </PageTransition>
  );
}
