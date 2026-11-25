'use client';

import { useCallback, useState } from 'react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

/**
 * Browser side of the two WebAuthn ceremonies the admin gate relies on.
 *
 * - `step-up` mints the short-lived assertion that unlocks the admin area;
 * - `enroll` registers an additional passkey (itself a privileged change, so
 *   the server only allows it after the first passkey exists *and* a step-up
 *   has been presented).
 *
 * All trust decisions live on the server; this component only relays the
 * options to the authenticator and posts the response back.
 */
export interface PasskeyCeremonyProps {
  mode: 'step-up' | 'enroll';
}

type CeremonyState =
  | { status: 'idle' }
  | { status: 'working'; message: string }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

interface ApiSuccess {
  ok: true;
  data: unknown;
}
interface ApiFailure {
  ok: false;
  message: string;
}

async function callApi(url: string, body?: unknown): Promise<ApiSuccess | ApiFailure> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch {
    return { ok: false, message: 'The portal could not be reached. Check your connection and retry.' };
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && typeof (payload as { message?: unknown }).message === 'string'
        ? (payload as { message: string }).message
        : `The request failed (HTTP ${response.status}).`;
    return { ok: false, message };
  }
  return { ok: true, data: payload };
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'The authenticator did not complete the ceremony.';
}

export function PasskeyCeremony({ mode }: PasskeyCeremonyProps) {
  const [state, setState] = useState<CeremonyState>({ status: 'idle' });

  const runStepUp = useCallback(async () => {
    setState({ status: 'working', message: 'Waiting for your passkey…' });
    const options = await callApi('/admin/api/step-up/options');
    if (!options.ok) {
      setState({ status: 'error', message: options.message });
      return;
    }
    try {
      const assertion = await startAuthentication({
        optionsJSON: options.data as Parameters<typeof startAuthentication>[0]['optionsJSON'],
      });
      const verified = await callApi('/admin/api/step-up/verify', assertion);
      if (!verified.ok) {
        setState({ status: 'error', message: verified.message });
        return;
      }
    } catch (error) {
      setState({ status: 'error', message: describeError(error) });
      return;
    }
    // Reload so the server re-evaluates the gate with the new step-up cookie.
    window.location.reload();
  }, []);

  const runEnroll = useCallback(async () => {
    setState({ status: 'working', message: 'Creating your passkey…' });
    const options = await callApi('/admin/api/enroll/options');
    if (!options.ok) {
      setState({ status: 'error', message: options.message });
      return;
    }
    let credentialId: string | undefined;
    try {
      const attestation = await startRegistration({
        optionsJSON: options.data as Parameters<typeof startRegistration>[0]['optionsJSON'],
      });
      const saved = await callApi('/admin/api/enroll/verify', attestation);
      if (!saved.ok) {
        setState({ status: 'error', message: saved.message });
        return;
      }
      credentialId =
        typeof saved.data === 'object' && saved.data !== null
          ? (saved.data as { credentialId?: string }).credentialId
          : undefined;
    } catch (error) {
      setState({ status: 'error', message: describeError(error) });
      return;
    }
    setState({
      status: 'success',
      message: credentialId ? `Passkey enrolled (${credentialId.slice(0, 8)}…).` : 'Passkey enrolled.',
    });
    if (mode === 'step-up') window.location.reload();
  }, [mode]);

  const busy = state.status === 'working';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'flex-start' }}>
      {mode === 'step-up' ? (
        <>
          <button type="button" onClick={runStepUp} disabled={busy} style={primaryButton}>
            Verify with a passkey
          </button>
          <button type="button" onClick={runEnroll} disabled={busy} style={secondaryButton}>
            Enroll a passkey
          </button>
        </>
      ) : (
        <button type="button" onClick={runEnroll} disabled={busy} style={primaryButton}>
          Enroll another passkey
        </button>
      )}

      {state.status === 'working' ? (
        <p role="status" style={{ color: '#4b5563', margin: 0 }}>
          {state.message}
        </p>
      ) : null}
      {state.status === 'error' ? (
        <p role="alert" style={{ color: '#b91c1c', margin: 0 }}>
          {state.message}
        </p>
      ) : null}
      {state.status === 'success' ? (
        <p role="status" style={{ color: '#15803d', margin: 0 }}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

const primaryButton = {
  padding: '0.6rem 1.1rem',
  borderRadius: 8,
  border: '1px solid #1d4ed8',
  background: '#1d4ed8',
  color: '#ffffff',
  fontSize: '0.95rem',
  cursor: 'pointer',
} as const;

const secondaryButton = {
  padding: '0.6rem 1.1rem',
  borderRadius: 8,
  border: '1px solid #d1d5db',
  background: '#ffffff',
  color: '#111827',
  fontSize: '0.95rem',
  cursor: 'pointer',
} as const;
