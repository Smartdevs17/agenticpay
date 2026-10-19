import { cn } from '@/lib/utils';
import type { KycDocumentStatus, KycStatus } from '@/lib/kyc';

const STATUS_STYLES: Record<KycStatus | KycDocumentStatus, string> = {
  pending: 'bg-gray-100 text-gray-700',
  under_review: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  expired: 'bg-orange-100 text-orange-700',
};

export function KycStatusBadge({ status, className }: { status: KycStatus | KycDocumentStatus; className?: string }) {
  return (
    <span
      className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize', STATUS_STYLES[status], className)}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}
