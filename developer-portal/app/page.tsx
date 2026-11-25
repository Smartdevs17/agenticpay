import Link from 'next/link';

/**
 * Landing page. Static, and intentionally free of any privileged data — the
 * admin surface is the only gated area of the portal.
 */
export default function HomePage() {
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '4rem 1.5rem' }}>
      <h1 style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>AgenticPay Developer Portal</h1>
      <p style={{ color: '#4b5563' }}>
        Operational console for AgenticPay. The admin area requires a signed-in operator session
        plus a fresh passkey assertion (step-up WebAuthn).
      </p>
      <p style={{ marginTop: '1.5rem' }}>
        <Link href="/admin" style={{ color: '#1d4ed8', fontWeight: 600 }}>
          Open the admin area
        </Link>
      </p>
    </main>
  );
}
