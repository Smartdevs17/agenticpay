'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { OnboardingChecklist } from '@/components/onboarding/OnboardingChecklist';
import { OnboardingProgress } from '@/components/onboarding/OnboardingProgress';
import { DocumentUpload } from '@/components/onboarding/DocumentUpload';
import { OnboardingHeader } from '@/components/onboarding/OnboardingHeader';
import { useOnboardingStore } from '@/store/useOnboardingStore';
import { Button } from '@/components/ui/button';
import { CheckCircle, ArrowRight } from 'lucide-react';

export default function OnboardingPage() {
  const {
    onboarding,
    currentStep,
    isLoading,
    error,
    fetchOnboarding,
    updateTask,
    submitForReview,
  } = useOnboardingStore();

  const [showDocumentUpload, setShowDocumentUpload] = useState(false);

  useEffect(() => {
    fetchOnboarding();
  }, [fetchOnboarding]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-red-600 mb-4">Error Loading Onboarding</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <Button onClick={fetchOnboarding}>Try Again</Button>
        </div>
      </div>
    );
  }

  if (!onboarding) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">No Onboarding Found</h2>
          <p className="text-gray-600 mb-4">Please contact support to start your merchant onboarding.</p>
        </div>
      </div>
    );
  }

  const currentTask = onboarding.tasks[currentStep];
  const isCompleted = onboarding.status === 'completed' || onboarding.status === 'approved';
  const canSubmit = onboarding.progress === 100 && onboarding.status === 'in_progress';

  return (
    <div className="min-h-screen bg-gray-50">
      <OnboardingHeader onboarding={onboarding} />

      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Progress Sidebar */}
          <div className="lg:col-span-1">
            <OnboardingProgress
              onboarding={onboarding}
              currentStep={currentStep}
              onStepClick={(step) => {
                // Handle step navigation
              }}
            />
          </div>

          {/* Main Content */}
          <div className="lg:col-span-2">
            {isCompleted ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-lg shadow-sm p-8 text-center"
              >
                <CheckCircle className="h-16 w-16 text-green-600 mx-auto mb-4" />
                <h2 className="text-2xl font-bold text-gray-900 mb-4">
                  Onboarding Complete!
                </h2>
                <p className="text-gray-600 mb-6">
                  Congratulations! Your merchant account has been successfully verified and is ready to use.
                </p>
                <Button className="bg-green-600 hover:bg-green-700">
                  Start Using AgenticPay
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </motion.div>
            ) : showDocumentUpload && currentTask?.type === 'document_upload' ? (
              <DocumentUpload
                task={currentTask}
                onComplete={() => setShowDocumentUpload(false)}
                onCancel={() => setShowDocumentUpload(false)}
              />
            ) : (
              <OnboardingChecklist
                onboarding={onboarding}
                currentStep={currentStep}
                onTaskUpdate={updateTask}
                onDocumentUpload={() => setShowDocumentUpload(true)}
                onSubmit={canSubmit ? submitForReview : undefined}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}