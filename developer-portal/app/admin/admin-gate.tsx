import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { WebAuthnConfigError } from '@/lib/webauthn';
import { evaluateAdminHeaders } from './guard';
import { getPortalRuntime } from './runtime';
import { PasskeyCeremony } from './passkey-ceremony';

/**
 * Wraps every admin page. The page content renders only when both the base
 * operator session and an unexpired step-up session are present; otherwise the
 * operator sees the step-up (or sign-in) prompt instead.
 *
 * The gate reads and evaluates the request on the server, so a client can never
 * reach the protected markup without passing through it.
 */
export async function AdminGate({ children }: { children: ReactNode }) {
  let result;
  try {
    result = await evaluateAdminHeaders(await headers(), getPortalRuntime());
  } catch (error) {
    if (error instanceof WebAuthnConfigError) {
      return (
        <Panel title="Admin area unavailable">
          <p style={{ margin: 0 }}>
            Step-up WebAuthn is not configured for this deployment, so the admin area is closed.
            Set <code>WEBAUTHN_RP_ID</code> and <code>WEBAUTHN_ORIGIN</code> and restart the portal.
          </p>
        </Panel>
      );
    }
    throw error;
  }

  if (result.kind === 'unauthenticated') {
    return (
      <Panel title="Sign-in required">
        <p style={{ margin: 0 }}>
          Sign in to the developer portal before using the admin area. After signing in you will be
          asked to assert a passkey to complete the step-up.
        </p>
      </Panel>
    );
  }

  if (result.kind === 'step-up-required') {
    return (
      <Panel title="Step-up required">
        <p style={{ marginTop: 0, color: '#4b5563' }}>
          Assert a registered passkey to unlock the admin area. The unlock lasts a few minutes and is
          bound to your operator session.
        </p>
        <PasskeyCeremony mode="step-up" />
      </Panel>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <p style={{ margin: 0, fontSize: '0.875rem', color: '#6b7280' }}>
        Signed in as <strong style={{ color: '#111827' }}>{result.operatorId}</strong> · step-up active
      </p>
      {children}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      style={{
        maxWidth: 560,
        margin: '3rem auto',
        padding: '1.5rem',
        borderRadius: 12,
        background: '#ffffff',
        border: '1px solid #e5e7eb',
      }}
    >
      <h2 style={{ marginTop: 0, fontSize: '1.25rem' }}>{title}</h2>
      {children}
    </section>
  );
}
