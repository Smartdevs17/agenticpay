'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Plus,
  Lock,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
  FileText,
  Send,
  CheckCheck,
  X,
} from 'lucide-react';
import { motion } from 'framer-motion';
import link from 'next/link';
import { EmptyState } from '@/components/empty/EmptyState';
import { formatDateInTimeZone } from '@/lib/utils';
import { useAuthStore } from '@/store/useAuthStore';

type EscrowAgreement = {
  id: string;
  projectId: string;
  projectTitle: string;
  amount: number;
  currency: string;
  status: 'pending' | 'active' | 'milestone_submitted' | 'completed' | 'disputed';
  milestones: Array<{
    id: string;
    title: string;
    amount: number;
    status: 'pending' | 'submitted' | 'approved' | 'disputed';
  }>;
  createdAt: string;
  updatedAt: string;
};

const MOCK_ESCROW_DATA: EscrowAgreement[] = [
  {
    id: 'esc-001',
    projectId: 'proj-001',
    projectTitle: 'Website Redesign',
    amount: 5000,
    currency: 'USD',
    status: 'active',
    milestones: [
      { id: 'm-1', title: 'Design Phase', amount: 1500, status: 'approved' },
      { id: 'm-2', title: 'Development', amount: 2000, status: 'submitted' },
      { id: 'm-3', title: 'Testing & Deploy', amount: 1500, status: 'pending' },
    ],
    createdAt: '2026-04-10T10:00:00Z',
    updatedAt: '2026-04-25T14:30:00Z',
  },
  {
    id: 'esc-002',
    projectId: 'proj-002',
    projectTitle: 'Mobile App MVP',
    amount: 8000,
    currency: 'USD',
    status: 'milestone_submitted',
    milestones: [
      { id: 'm-4', title: 'Architecture & Setup', amount: 2000, status: 'approved' },
      { id: 'm-5', title: 'Core Features', amount: 4000, status: 'submitted' },
      { id: 'm-6', title: 'Polish & Release', amount: 2000, status: 'pending' },
    ],
    createdAt: '2026-04-01T09:00:00Z',
    updatedAt: '2026-04-28T11:00:00Z',
  },
];

export default function EscrowPage() {
  const timezone = useAuthStore((state) => state.timezone);
  const [agreements, setAgreements] = useState<EscrowAgreement[]>(MOCK_ESCROW_DATA);
  const [loading, setLoading] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  const filteredAgreements = useMemo(() => {
    if (selectedStatus === 'all') return agreements;
    return agreements.filter((a) => a.status === selectedStatus);
  }, [agreements, selectedStatus]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'active':
        return <Lock className="h-5 w-5 text-blue-600" />;
      case 'milestone_submitted':
        return <Clock className="h-5 w-5 text-yellow-600" />;
      case 'disputed':
        return <AlertCircle className="h-5 w-5 text-red-600" />;
      default:
        return <Clock className="h-5 w-5 text-gray-600" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-700 border-green-200';
      case 'active':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'milestone_submitted':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'disputed':
        return 'bg-red-100 text-red-700 border-red-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getMilestoneStatusColor = (status: string) => {
    switch (status) {
      case 'approved':
        return 'bg-green-50 border-green-200';
      case 'submitted':
        return 'bg-yellow-50 border-yellow-200';
      case 'disputed':
        return 'bg-red-50 border-red-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  const handleApproveMilestone = (agreementId: string, milestoneId: string) => {
    setAgreements((prev) =>
      prev.map((agreement) => {
        if (agreement.id === agreementId) {
          return {
            ...agreement,
            milestones: agreement.milestones.map((m) =>
              m.id === milestoneId ? { ...m, status: 'approved' as const } : m
            ),
          };
        }
        return agreement;
      })
    );
  };

  const handleDisputeMilestone = (agreementId: string, milestoneId: string) => {
    setAgreements((prev) =>
      prev.map((agreement) => {
        if (agreement.id === agreementId) {
          return {
            ...agreement,
            status: 'disputed' as const,
            milestones: agreement.milestones.map((m) =>
              m.id === milestoneId ? { ...m, status: 'disputed' as const } : m
            ),
          };
        }
        return agreement;
      })
    );
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Escrow Agreements</h1>
          <p className="text-gray-600 mt-1">Manage secure milestone-based payments</p>
          <div className="mt-2 inline-flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading agreements...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Escrow Agreements</h1>
          <p className="text-gray-600 mt-1">Manage secure milestone-based payments</p>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700">
          <Plus className="h-4 w-4 mr-2" />
          New Agreement
        </Button>
      </div>

      <div className="flex gap-2">
        {['all', 'active', 'milestone_submitted', 'completed', 'disputed'].map((status) => (
          <Button
            key={status}
            variant={selectedStatus === status ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedStatus(status)}
            className="capitalize"
          >
            {status.replace('_', ' ')}
          </Button>
        ))}
      </div>

      <div className="space-y-4">
        {filteredAgreements.map((agreement, index) => (
          <motion.div
            key={agreement.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <Card className="border border-gray-200 hover:shadow-lg transition-all">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-3">
                    {getStatusIcon(agreement.status)}
                    <div>
                      <CardTitle className="text-lg">{agreement.projectTitle}</CardTitle>
                      <p className="text-sm text-gray-600 mt-1">
                        {agreement.currency} {agreement.amount.toFixed(2)}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(
                      agreement.status
                    )}`}
                  >
                    {agreement.status.replace('_', ' ')}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-xs text-gray-500">
                  Created {formatDateInTimeZone(agreement.createdAt, timezone)} • Updated{' '}
                  {formatDateInTimeZone(agreement.updatedAt, timezone)}
                </div>

                <div className="space-y-3">
                  <p className="font-semibold text-gray-900 text-sm">Milestones</p>
                  {agreement.milestones.map((milestone, idx) => (
                    <div
                      key={milestone.id}
                      className={`rounded-lg border p-4 ${getMilestoneStatusColor(milestone.status)}`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-medium text-gray-900">{milestone.title}</p>
                          <p className="text-sm text-gray-600">
                            {agreement.currency} {milestone.amount.toFixed(2)}
                          </p>
                        </div>
                        <span className="text-xs font-medium text-gray-600 capitalize">
                          {milestone.status}
                        </span>
                      </div>

                      {milestone.status === 'submitted' && (
                        <div className="flex gap-2 mt-3">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleApproveMilestone(agreement.id, milestone.id)}
                            className="flex-1"
                          >
                            <CheckCheck className="h-3 w-3 mr-1" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDisputeMilestone(agreement.id, milestone.id)}
                            className="flex-1"
                          >
                            <X className="h-3 w-3 mr-1" />
                            Dispute
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {agreement.status === 'milestone_submitted' && (
                  <Button className="w-full" size="sm">
                    <Send className="h-4 w-4 mr-2" />
                    Review & Action Required
                  </Button>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {filteredAgreements.length === 0 && (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={FileText}
              title="No escrow agreements"
              description="Create an escrow agreement to secure milestone-based payments."
              action={{
                label: 'Create Agreement',
                onClick: () => {},
              }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
