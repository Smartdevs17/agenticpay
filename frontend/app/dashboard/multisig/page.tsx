'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Plus,
  Users,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
  FileText,
  Send,
  Signature,
  User,
  CheckCheck,
  X as XIcon,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { EmptyState } from '@/components/empty/EmptyState';
import { formatDateInTimeZone } from '@/lib/utils';
import { useAuthStore } from '@/store/useAuthStore';

type ApprovalStatus = 'pending' | 'approved' | 'rejected';

type Approver = {
  address: string;
  status: ApprovalStatus;
  approvedAt?: string;
};

type MultisigPayment = {
  id: string;
  paymentId: string;
  projectTitle: string;
  recipient: string;
  amount: number;
  currency: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected' | 'executed';
  requiredApprovals: number;
  approvers: Approver[];
  createdAt: string;
  updatedAt: string;
};

const MOCK_MULTISIG_DATA: MultisigPayment[] = [
  {
    id: 'ms-001',
    paymentId: 'pay-001',
    projectTitle: 'Website Redesign - Phase 1',
    recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f42bEd',
    amount: 2000,
    currency: 'USD',
    description: 'Milestone completion and delivery',
    status: 'pending',
    requiredApprovals: 2,
    approvers: [
      { address: '0x8ba1f109551bD432803012645Ac136ddd64DBA72', status: 'approved', approvedAt: '2026-04-27T10:00:00Z' },
      { address: '0x742d35Cc6634C0532925a3b844Bc9e7595f42bEd', status: 'pending' },
      { address: '0x1234567890123456789012345678901234567890', status: 'pending' },
    ],
    createdAt: '2026-04-27T08:00:00Z',
    updatedAt: '2026-04-27T10:30:00Z',
  },
  {
    id: 'ms-002',
    paymentId: 'pay-002',
    projectTitle: 'Mobile App MVP - Phase 2',
    recipient: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    amount: 4000,
    currency: 'USD',
    description: 'Core features implementation',
    status: 'pending',
    requiredApprovals: 3,
    approvers: [
      { address: '0x742d35Cc6634C0532925a3b844Bc9e7595f42bEd', status: 'approved', approvedAt: '2026-04-26T14:00:00Z' },
      { address: '0x8ba1f109551bD432803012645Ac136ddd64DBA72', status: 'approved', approvedAt: '2026-04-26T15:30:00Z' },
      { address: '0x1234567890123456789012345678901234567890', status: 'pending' },
    ],
    createdAt: '2026-04-26T12:00:00Z',
    updatedAt: '2026-04-26T15:30:00Z',
  },
  {
    id: 'ms-003',
    paymentId: 'pay-003',
    projectTitle: 'API Integration',
    recipient: '0x1234567890123456789012345678901234567890',
    amount: 1500,
    currency: 'USD',
    description: 'Third-party API integration',
    status: 'approved',
    requiredApprovals: 2,
    approvers: [
      { address: '0x742d35Cc6634C0532925a3b844Bc9e7595f42bEd', status: 'approved', approvedAt: '2026-04-25T09:00:00Z' },
      { address: '0x8ba1f109551bD432803012645Ac136ddd64DBA72', status: 'approved', approvedAt: '2026-04-25T11:00:00Z' },
    ],
    createdAt: '2026-04-25T08:00:00Z',
    updatedAt: '2026-04-25T11:00:00Z',
  },
];

export default function MultisigPage() {
  const timezone = useAuthStore((state) => state.timezone);
  const [payments, setPayments] = useState<MultisigPayment[]>(MOCK_MULTISIG_DATA);
  const [loading, setLoading] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<string>('pending');

  const filteredPayments = useMemo(() => {
    if (selectedStatus === 'all') return payments;
    return payments.filter((p) => p.status === selectedStatus);
  }, [payments, selectedStatus]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'executed':
      case 'approved':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'pending':
        return <Clock className="h-5 w-5 text-yellow-600" />;
      case 'rejected':
        return <AlertCircle className="h-5 w-5 text-red-600" />;
      default:
        return <Clock className="h-5 w-5 text-gray-600" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'executed':
      case 'approved':
        return 'bg-green-100 text-green-700 border-green-200';
      case 'pending':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'rejected':
        return 'bg-red-100 text-red-700 border-red-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getApprovalPercentage = (payment: MultisigPayment) => {
    const approved = payment.approvers.filter((a) => a.status === 'approved').length;
    return Math.round((approved / payment.requiredApprovals) * 100);
  };

  const currentUserAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f42bEd';

  const handleApprove = (paymentId: string) => {
    setPayments((prev) =>
      prev.map((payment) => {
        if (payment.id === paymentId) {
          const updated = {
            ...payment,
            approvers: payment.approvers.map((a) =>
              a.address === currentUserAddress
                ? { ...a, status: 'approved' as const, approvedAt: new Date().toISOString() }
                : a
            ),
          };
          const approvedCount = updated.approvers.filter((a) => a.status === 'approved').length;
          if (approvedCount >= payment.requiredApprovals) {
            updated.status = 'approved' as const;
          }
          return updated;
        }
        return payment;
      })
    );
  };

  const handleReject = (paymentId: string) => {
    setPayments((prev) =>
      prev.map((payment) => {
        if (payment.id === paymentId) {
          return {
            ...payment,
            status: 'rejected' as const,
            approvers: payment.approvers.map((a) =>
              a.address === currentUserAddress
                ? { ...a, status: 'rejected' as const, approvedAt: new Date().toISOString() }
                : a
            ),
          };
        }
        return payment;
      })
    );
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Multisig Approvals</h1>
          <p className="text-gray-600 mt-1">Review and approve enterprise payments</p>
          <div className="mt-2 inline-flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading payments...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Multisig Approvals</h1>
          <p className="text-gray-600 mt-1">Review and approve enterprise payments</p>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700">
          <Plus className="h-4 w-4 mr-2" />
          New Payment Request
        </Button>
      </div>

      <div className="flex gap-2">
        {['pending', 'approved', 'rejected', 'all'].map((status) => (
          <Button
            key={status}
            variant={selectedStatus === status ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedStatus(status)}
            className="capitalize"
          >
            {status}
          </Button>
        ))}
      </div>

      <div className="space-y-4">
        {filteredPayments.map((payment, index) => {
          const userApprover = payment.approvers.find((a) => a.address === currentUserAddress);
          const approvedCount = payment.approvers.filter((a) => a.status === 'approved').length;

          return (
            <motion.div
              key={payment.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <Card className="border border-gray-200 hover:shadow-lg transition-all">
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3">
                      {getStatusIcon(payment.status)}
                      <div>
                        <CardTitle className="text-lg">{payment.projectTitle}</CardTitle>
                        <p className="text-sm text-gray-600 mt-1">
                          {payment.currency} {payment.amount.toFixed(2)} → {payment.recipient.slice(0, 6)}...{payment.recipient.slice(-4)}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(
                        payment.status
                      )}`}
                    >
                      {payment.status}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-gray-700">{payment.description}</p>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs text-gray-600">
                      <span>
                        Approvals: {approvedCount}/{payment.requiredApprovals}
                      </span>
                      <span>{getApprovalPercentage(payment)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all"
                        style={{ width: `${getApprovalPercentage(payment)}%` }}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-gray-900">Approvers</p>
                    <div className="space-y-2">
                      {payment.approvers.map((approver) => {
                        const isCurrentUser = approver.address === currentUserAddress;
                        return (
                          <div
                            key={approver.address}
                            className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm"
                          >
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-gray-600" />
                              <div>
                                <p className="font-medium text-gray-900">
                                  {approver.address.slice(0, 6)}...{approver.address.slice(-4)}
                                  {isCurrentUser && ' (You)'}
                                </p>
                                {approver.approvedAt && (
                                  <p className="text-xs text-gray-500">
                                    {formatDateInTimeZone(approver.approvedAt, timezone)}
                                  </p>
                                )}
                              </div>
                            </div>
                            <span
                              className={`px-2 py-1 rounded text-xs font-medium ${
                                approver.status === 'approved'
                                  ? 'bg-green-100 text-green-700'
                                  : approver.status === 'rejected'
                                    ? 'bg-red-100 text-red-700'
                                    : 'bg-gray-200 text-gray-700'
                              }`}
                            >
                              {approver.status}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {userApprover && userApprover.status === 'pending' && payment.status === 'pending' && (
                    <div className="flex gap-2 pt-2">
                      <Button
                        onClick={() => handleApprove(payment.id)}
                        className="flex-1 bg-green-600 hover:bg-green-700"
                      >
                        <CheckCheck className="h-4 w-4 mr-2" />
                        Approve
                      </Button>
                      <Button
                        onClick={() => handleReject(payment.id)}
                        variant="destructive"
                        className="flex-1"
                      >
                        <XIcon className="h-4 w-4 mr-2" />
                        Reject
                      </Button>
                    </div>
                  )}

                  <div className="text-xs text-gray-500 pt-2 border-t border-gray-200">
                    Created {formatDateInTimeZone(payment.createdAt, timezone)}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {filteredPayments.length === 0 && (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={FileText}
              title="No payments to review"
              description="Multisig payment approvals will appear here."
              action={{
                label: 'Create Payment',
                onClick: () => {},
              }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
