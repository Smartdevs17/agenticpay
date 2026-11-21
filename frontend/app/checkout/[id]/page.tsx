import React from 'react';
import { CheckoutPage } from '@/components/checkout/CheckoutPage';

interface PageProps {
  params: Promise<{ id: string }> | { id: string };
}

export default async function Page({ params }: PageProps) {
  const resolvedParams = await params;
  const { id } = resolvedParams;

  return <CheckoutPage id={id} />;
}
