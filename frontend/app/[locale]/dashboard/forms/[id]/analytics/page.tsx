'use client';

import { useParams } from 'next/navigation';
import { FormAnalytics } from '@/components/forms/FormAnalytics';

export default function FormAnalyticsPage() {
  const params = useParams();
  const formId = params?.id as string;

  if (!formId) {
    return <div className="p-8">Form ID not found</div>;
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Form Analytics</h1>
        <p className="text-muted-foreground">Track form performance and view submissions</p>
      </div>
      <FormAnalytics formId={formId} />
    </div>
  );
}
