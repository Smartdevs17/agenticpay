import type { ReactNode } from 'react';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '2.5rem 1.5rem' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <p style={{ margin: 0, fontSize: '0.75rem', letterSpacing: '0.08em', color: '#6b7280' }}>
          AGENTICPAY
        </p>
        <h1 style={{ margin: '0.25rem 0 0', fontSize: '1.5rem' }}>Admin</h1>
      </header>
      {children}
    </div>
  );
}
