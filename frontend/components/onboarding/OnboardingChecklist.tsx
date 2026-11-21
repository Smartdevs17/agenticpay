import { motion } from 'framer-motion';
import { CheckCircle, Circle, Upload, SkipForward, AlertCircle, Send } from 'lucide-react';
import { MerchantOnboarding, TaskStatus } from '@/lib/types/onboarding';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface OnboardingChecklistProps {
  onboarding: MerchantOnboarding;
  currentStep: number;
  onTaskUpdate: (taskId: string, status: TaskStatus, data?: any) => Promise<void>;
  onDocumentUpload: () => void;
  onSubmit?: () => Promise<void>;
}

export function OnboardingChecklist({
  onboarding,
  currentStep,
  onTaskUpdate,
  onDocumentUpload,
  onSubmit
}: OnboardingChecklistProps) {
  const currentTask = onboarding.tasks[currentStep];
  const canSubmit = onboarding.progress === 100 && onboarding.status === 'in_progress';

  const handleTaskAction = async (task: any, action: string) => {
    if (action === 'complete') {
      if (task.type === 'document_upload') {
        onDocumentUpload();
      } else {
        await onTaskUpdate(task.id, 'completed');
      }
    } else if (action === 'skip') {
      await onTaskUpdate(task.id, 'skipped');
    }
  };

  const getTaskTypeIcon = (type: string) => {
    switch (type) {
      case 'document_upload':
        return <Upload className="h-5 w-5" />;
      case 'form_submission':
        return <CheckCircle className="h-5 w-5" />;
      case 'verification':
        return <AlertCircle className="h-5 w-5" />;
      case 'compliance_check':
        return <CheckCircle className="h-5 w-5" />;
      default:
        return <Circle className="h-5 w-5" />;
    }
  };

  const getTaskTypeColor = (type: string) => {
    switch (type) {
      case 'document_upload':
        return 'text-blue-600';
      case 'form_submission':
        return 'text-green-600';
      case 'verification':
        return 'text-yellow-600';
      case 'compliance_check':
        return 'text-purple-600';
      default:
        return 'text-gray-600';
    }
  };

  if (!currentTask) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <CheckCircle className="h-16 w-16 text-green-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-900 mb-2">
            All Tasks Completed!
          </h3>
          <p className="text-gray-600 mb-6">
            You've completed all onboarding tasks. Ready to submit for review?
          </p>
          {canSubmit && onSubmit && (
            <Button onClick={onSubmit} className="bg-green-600 hover:bg-green-700">
              <Send className="mr-2 h-4 w-4" />
              Submit for Review
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Current Task Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className={cn("p-2 rounded-lg bg-gray-100", getTaskTypeColor(currentTask.type))}>
                {getTaskTypeIcon(currentTask.type)}
              </div>
              <div>
                <CardTitle className="text-xl">{currentTask.title}</CardTitle>
                <div className="flex items-center space-x-2 mt-1">
                  <Badge variant="outline" className={getTaskTypeColor(currentTask.type)}>
                    {currentTask.type.replace('_', ' ')}
                  </Badge>
                  {currentTask.required && (
                    <Badge variant="destructive">Required</Badge>
                  )}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-gray-500">Step {currentStep + 1} of {onboarding.tasks.length}</div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <div>
            <h4 className="text-lg font-medium text-gray-900 mb-2">Description</h4>
            <p className="text-gray-600">{currentTask.description}</p>
          </div>

          {/* Task-specific content */}
          {currentTask.type === 'document_upload' && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h5 className="font-medium text-blue-900 mb-2">Document Requirements</h5>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• File must be in PDF, JPG, or PNG format</li>
                <li>• Maximum file size: 10MB</li>
                <li>• Document must be clearly legible</li>
              </ul>
            </div>
          )}

          {currentTask.type === 'compliance_check' && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <h5 className="font-medium text-purple-900 mb-2">Automated Verification</h5>
              <p className="text-sm text-purple-800">
                This task will be completed automatically after all required documents are submitted and verified.
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex space-x-3">
            <Button
              onClick={() => handleTaskAction(currentTask, 'complete')}
              disabled={currentTask.status === 'completed'}
              className="flex-1"
            >
              {currentTask.type === 'document_upload' ? (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Document
                </>
              ) : (
                <>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Mark as Complete
                </>
              )}
            </Button>

            {!currentTask.required && currentTask.status !== 'completed' && (
              <Button
                variant="outline"
                onClick={() => handleTaskAction(currentTask, 'skip')}
                disabled={currentTask.status === 'skipped'}
              >
                <SkipForward className="mr-2 h-4 w-4" />
                Skip
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Submit Button */}
      {canSubmit && onSubmit && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-green-50 border border-green-200 rounded-lg p-6 text-center"
        >
          <CheckCircle className="h-12 w-12 text-green-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-green-900 mb-2">
            Ready to Submit for Review
          </h3>
          <p className="text-green-700 mb-4">
            All required tasks are completed. Submit your onboarding for admin review.
          </p>
          <Button onClick={onSubmit} className="bg-green-600 hover:bg-green-700">
            <Send className="mr-2 h-4 w-4" />
            Submit for Review
          </Button>
        </motion.div>
      )}
    </div>
  );
}