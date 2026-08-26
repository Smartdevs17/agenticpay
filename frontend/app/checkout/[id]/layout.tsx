import React from 'react';
import type { Metadata } from 'next';
import '../checkout.css';

export const metadata: Metadata = {
  title: 'Secure Checkout — AgenticPay',
  description: 'Hosted checkout page powered by AgenticPay. Pay using crypto, cards, or web3 wallets instantly.',
  robots: {
    index: false,
    follow: false,
  },
  openGraph: {
    title: 'Secure Checkout — AgenticPay',
    description: 'Secure, instant collection gateway. Pay via crypto, cards, or web3 wallets.',
    type: 'website',
  },
};

interface CheckoutLayoutProps {
  children: React.ReactNode;
}

export default function CheckoutLayout({ children }: CheckoutLayoutProps) {
  return (
    <div style={{ minHeight: '100vh', width: '100%', display: 'flex', flexDirection: 'column' }}>
      {children}
    </div>
  );
}
