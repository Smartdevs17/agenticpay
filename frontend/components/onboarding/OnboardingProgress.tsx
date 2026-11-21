import { motion } from 'framer-motion';
import { CheckCircle, Circle, Clock, AlertCircle } from 'lucide-react';
import { MerchantOnboarding } from '@/lib/types/onboarding';
import { cn } from '@/lib/utils';

interface OnboardingProgressProps {
  onboarding: MerchantOnboarding;
  currentStep: number;
  onStepClick: (step: number) => void;
}

export function OnboardingProgress({ onboarding, currentStep, onStepClick }: OnboardingProgressProps) {
  const getTaskIcon = (task: any, index: number) => {
    const isCompleted = task.status === 'completed';
    const isCurrent = index === currentStep;
    const isSkipped = task.status === 'skipped';
    const isFailed = task.status === 'failed';

    if (isCompleted) {
      return <CheckCircle className="h-5 w-5 text-green-600" />;
    } else if (isFailed) {
      return <AlertCircle className="h-5 w-5 text-red-600" />;
    } else if (isSkipped) {
      return <Circle className="h-5 w-5 text-gray-400" />;
    } else if (isCurrent) {
      return <Clock className="h-5 w-5 text-blue-600" />;
    } else {
      return <Circle className="h-5 w-5 text-gray-300" />;
    }
  };

  const getTaskStatusColor = (task: any) => {
    if (task.status === 'completed') return 'text-green-600';
    if (task.status === 'failed') return 'text-red-600';
    if (task.status === 'skipped') return 'text-gray-400';
    if (task.status === 'in_progress') return 'text-blue-600';
    return 'text-gray-400';
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Onboarding Steps</h3>

      <div className="space-y-4">
        {onboarding.tasks.map((task, index) => (
          <motion.div
            key={task.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            className={cn(
              "flex items-start space-x-3 p-3 rounded-lg cursor-pointer transition-colors",
              index === currentStep ? "bg-blue-50 border border-blue-200" : "hover:bg-gray-50"
            )}
            onClick={() => onStepClick(index)}
          >
            <div className="flex-shrink-0 mt-0.5">
              {getTaskIcon(task, index)}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <h4 className={cn(
                  "text-sm font-medium",
                  getTaskStatusColor(task)
                )}>
                  {task.title}
                  {task.required && <span className="text-red-500 ml-1">*</span>}
                </h4>

                {task.status === 'completed' && (
                  <span className="text-xs text-green-600 font-medium">Done</span>
                )}
                {task.status === 'skipped' && (
                  <span className="text-xs text-gray-500 font-medium">Skipped</span>
                )}
                {task.status === 'failed' && (
                  <span className="text-xs text-red-600 font-medium">Failed</span>
                )}
              </div>

              <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                {task.description}
              </p>

              {task.status === 'in_progress' && (
                <div className="mt-2">
                  <div className="w-full bg-gray-200 rounded-full h-1">
                    <div className="bg-blue-600 h-1 rounded-full w-1/2"></div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Summary */}
      <div className="mt-6 pt-4 border-t border-gray-200">
        <div className="flex justify-between text-sm text-gray-600">
          <span>Completed</span>
          <span>{onboarding.tasks.filter(t => t.status === 'completed').length}</span>
        </div>
        <div className="flex justify-between text-sm text-gray-600">
          <span>Remaining</span>
          <span>{onboarding.tasks.filter(t => t.status !== 'completed' && t.status !== 'skipped').length}</span>
        </div>
        <div className="flex justify-between text-sm font-medium text-gray-900 mt-2">
          <span>Progress</span>
          <span>{onboarding.progress}%</span>
        </div>
      </div>
    </div>
  );
}