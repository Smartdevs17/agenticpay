import { AdminGate } from './admin-gate';
import { PasskeyCeremony } from './passkey-ceremony';

/**
 * The protected admin console. Everything below this point is rendered only
 * after {@link AdminGate} has verified the base session *and* a fresh step-up.
 */
export const dynamic = 'force-dynamic';

export default function AdminPage() {
  return (
    <AdminGate>
      <section
        style={{
          padding: '1.5rem',
          borderRadius: 12,
          background: '#ffffff',
          border: '1px solid #e5e7eb',
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: '1.15rem' }}>Passkeys</h2>
        <p style={{ color: '#4b5563' }}>
          Passkeys are the second factor for this area. Keep at least two enrolled so losing one
          device does not lock you out.
        </p>
        <PasskeyCeremony mode="enroll" />
      </section>
    </AdminGate>
  );
}
