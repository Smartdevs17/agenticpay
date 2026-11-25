import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'AgenticPay Developer Portal',
  description: 'Internal developer portal. The admin area is gated behind step-up WebAuthn.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          background: '#f6f7f9',
          color: '#111827',
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          lineHeight: 1.5,
        }}
      >
        {children}
      </body>
    </html>
  );
}
