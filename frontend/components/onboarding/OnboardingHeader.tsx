import { motion } from 'framer-motion';
import { Building2, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { MerchantOnboarding } from '@/lib/types/onboarding';
import { Badge } from '@/components/ui/badge';

interface OnboardingHeaderProps {
  onboarding: MerchantOnboarding;
}

export function OnboardingHeader({ onboarding }: OnboardingHeaderProps) {
  const getStatusIcon = () => {
    switch (onboarding.status) {
      case 'approved':
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'rejected':
        return <AlertCircle className="h-5 w-5 text-red-600" />;
      case 'under_review':
        return <Clock className="h-5 w-5 text-yellow-600" />;
      default:
        return <Building2 className="h-5 w-5 text-blue-600" />;
    }
  };

  const getStatusColor = () => {
    switch (onboarding.status) {
      case 'approved':
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'rejected':
        return 'bg-red-100 text-red-800';
      case 'under_review':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-blue-100 text-blue-800';
    }
  };

  const getStatusText = () => {
    switch (onboarding.status) {
      case 'draft':
        return 'Draft';
      case 'in_progress':
        return 'In Progress';
      case 'under_review':
        return 'Under Review';
      case 'approved':
        return 'Approved';
      case 'rejected':
        return 'Rejected';
      case 'completed':
        return 'Completed';
      default:
        return 'Unknown';
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white border-b border-gray-200 px-4 py-6"
    >
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-3">
              {getStatusIcon()}
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  Merchant Onboarding
                </h1>
                <p className="text-gray-600">{onboarding.businessName}</p>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="text-right">
              <div className="text-sm text-gray-500">Progress</div>
              <div className="text-2xl font-bold text-gray-900">
                {onboarding.progress}%
              </div>
            </div>

            <Badge className={getStatusColor()}>
              {getStatusText()}
            </Badge>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-6">
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>Onboarding Progress</span>
            <span>{onboarding.tasks.filter(t => t.status === 'completed').length} of {onboarding.tasks.length} tasks completed</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${onboarding.progress}%` }}
              transition={{ duration: 0.5 }}
              className="bg-blue-600 h-2 rounded-full"
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}