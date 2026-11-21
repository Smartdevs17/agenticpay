import { cn } from '@/lib/utils';
import type { KycDocumentStatus, KycStatus } from '@/lib/kyc';
import { assertNever } from '@/components/common/discriminated-union';

export type KycBadgeStatus = KycStatus | KycDocumentStatus;

export interface KycStatusBadgeProps {
  status: KycBadgeStatus;
  className?: string;
}

const STATUS_STYLES: Record<KycBadgeStatus, string> = {
  pending: 'bg-gray-100 text-gray-700',
  under_review: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  expired: 'bg-orange-100 text-orange-700',
};

export function KycStatusBadge({ status, className }: KycStatusBadgeProps) {
  let styleClass: string;
  switch (status) {
    case 'pending':
    case 'under_review':
    case 'approved':
    case 'rejected':
    case 'expired':
      styleClass = STATUS_STYLES[status];
      break;
    default: {
      const _exhaustive: never = status;
      return assertNever(_exhaustive);
    }
  }

  return (
    <span
      className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize', styleClass, className)}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}
