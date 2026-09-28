import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KycOnboardingFlow } from '../KycOnboardingFlow';
import type { KycDocument, KycOnboardingState } from '@/lib/kyc';

// Rendered with react-dom directly so the suite only needs the frontend's
// declared dependencies (react, react-dom, jsdom).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const requirements = (identity: boolean, address: boolean): KycOnboardingState['requirements'] => [
  { id: 'identity_document', label: 'Government-issued photo ID', acceptedTypes: ['passport'], satisfied: identity },
  {
    id: 'proof_of_address',
    label: 'Proof of address issued in the last 90 days',
    acceptedTypes: ['utility_bill'],
    satisfied: address,
  },
];

const personalInfo = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  dateOfBirth: '1990-04-12',
  nationality: 'GB',
  countryOfResidence: 'GB',
  address: { line1: '1 Main St', city: 'London', postalCode: 'N1 9GU', country: 'GB' },
};

function makeState(overrides: Partial<KycOnboardingState['profile']> = {}, canSubmit = false): KycOnboardingState {
  return {
    profile: {
      userId: 'user-1',
      status: 'pending',
      onboardingStep: 'documents',
      personalInfo,
      documents: [],
      rejectionReasons: [],
      statusHistory: [],
      ...overrides,
    },
    requirements: requirements(false, false),
    canSubmit,
  };
}

const passportDoc: KycDocument = {
  id: 'doc-1',
  type: 'passport',
  status: 'approved',
  uploadedAt: '2026-06-15T00:00:00.000Z',
  documentNumberMasked: '*****6789',
};

const notFound = () => jsonResponse(404, { error: { code: 'KYC_NOT_FOUND', message: 'KYC profile not found' } });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// ── Minimal DOM helpers ─────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

async function render(ui: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(ui);
  });
}

const pageText = () => container.textContent ?? '';

async function waitFor(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`Timed out waiting; page text: ${pageText()}`);
}

function field(label: string | RegExp): HTMLInputElement {
  const match = Array.from(container.querySelectorAll('label')).find((l) =>
    typeof label === 'string' ? l.textContent === label : label.test(l.textContent ?? ''),
  );
  const input = match && container.querySelector<HTMLInputElement>(`[id="${match.htmlFor}"]`);
  if (!input) throw new Error(`No field labelled ${label}`);
  return input;
}

function button(name: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === name);
  if (!found) throw new Error(`No button named ${name}`);
  return found;
}

const hasButton = (name: string) =>
  Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.trim() === name);

async function type(label: string | RegExp, value: string) {
  const input = field(label);
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function chooseFile(file: File) {
  const input = field(/^File/);
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function click(target: HTMLElement) {
  await act(async () => {
    target.click();
  });
}

function requestBody(call: number) {
  return JSON.parse(String(fetchMock.mock.calls[call][1].body));
}

// ── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('KycOnboardingFlow', () => {
  it('starts on personal info and blocks invalid input before calling the API', async () => {
    fetchMock.mockResolvedValueOnce(notFound());
    await render(<KycOnboardingFlow userId="user-1" />);
    await waitFor(() => hasButton('Save and continue'));

    await type('Date of birth', '2015-01-01');
    await click(button('Save and continue'));

    expect(pageText()).toContain('You must be at least 18 years old');
    expect(pageText()).toContain('First name is required');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('saves personal info and moves to the document step', async () => {
    fetchMock.mockResolvedValueOnce(notFound()).mockResolvedValueOnce(jsonResponse(200, makeState()));
    await render(<KycOnboardingFlow userId="user-1" />);
    await waitFor(() => hasButton('Save and continue'));

    await type('First name', 'Ada');
    await type('Last name', 'Lovelace');
    await type('Date of birth', '1990-04-12');
    await type('Nationality (e.g. US)', 'gb');
    await type('Country of residence (e.g. US)', 'gb');
    await type('Address line 1', '1 Main St');
    await type('City', 'London');
    await type('Postal code', 'N1 9GU');
    await type('Country (e.g. US)', 'gb');
    await click(button('Save and continue'));

    await waitFor(() => pageText().includes('Required documents'));
    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toMatch(/\/kyc\/user-1\/personal-info$/);
    expect(init.method).toBe('PUT');
    expect(requestBody(1)).toMatchObject({ nationality: 'GB', address: { country: 'GB' } });
    expect(requestBody(1).address).not.toHaveProperty('line2');
  });

  it('validates the document form before uploading', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, makeState()));
    await render(<KycOnboardingFlow userId="user-1" />);
    await waitFor(() => pageText().includes('Required documents'));

    await chooseFile(new File([new Uint8Array(4096)], 'id.gif', { type: 'image/gif' }));
    await click(button('Upload and verify'));

    expect(pageText()).toContain('Upload a JPEG, PNG, WebP, or PDF file');
    expect(pageText()).toContain('Document number is required');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uploads a document and shows the verification result', async () => {
    const afterUpload = { ...makeState({ documents: [passportDoc] }), requirements: requirements(true, false) };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, makeState()))
      .mockResolvedValueOnce(jsonResponse(201, { document: passportDoc, state: afterUpload }));
    await render(<KycOnboardingFlow userId="user-1" />);
    await waitFor(() => pageText().includes('Required documents'));

    await type('Document number', '123456789');
    await type('Expiry date', '2031-01-01');
    await chooseFile(new File([new Uint8Array(4096)], 'passport.pdf', { type: 'application/pdf' }));
    await click(button('Upload and verify'));

    await waitFor(() => pageText().includes('Passport · *****6789'));
    expect(requestBody(1)).toMatchObject({
      type: 'passport',
      documentNumber: '123456789',
      issuingCountry: 'GB',
      expiryDate: '2031-01-01',
      mimeType: 'application/pdf',
      fileSize: 4096,
    });
    expect(requestBody(1).fileContent).toBeTruthy();
    expect(field('Document number').value).toBe('');
    expect(button('Continue to review').disabled).toBe(true);
  });

  it('shows server-side rejection reasons and keeps the form', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, makeState())).mockResolvedValueOnce(
      jsonResponse(422, {
        error: {
          code: 'INVALID_DOCUMENT',
          message: 'Document failed validation',
          details: ['Document number is reported as lost or stolen'],
        },
      }),
    );
    await render(<KycOnboardingFlow userId="user-1" />);
    await waitFor(() => pageText().includes('Required documents'));

    await type('Document number', '123456000');
    await type('Expiry date', '2031-01-01');
    await chooseFile(new File([new Uint8Array(4096)], 'passport.pdf', { type: 'application/pdf' }));
    await click(button('Upload and verify'));

    await waitFor(() => container.querySelector('[role="alert"]') !== null);
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Document failed validation');
    expect(alert.textContent).toContain('Document number is reported as lost or stolen');
    expect(field('Document number').value).toBe('123456000');
  });

  it('submits a complete application and shows the approved status', async () => {
    const ready = {
      ...makeState({ onboardingStep: 'review', documents: [passportDoc] }, true),
      requirements: requirements(true, true),
    };
    const approved: KycOnboardingState = {
      ...ready,
      canSubmit: false,
      profile: { ...ready.profile, status: 'approved', onboardingStep: 'complete', expiresAt: '2027-06-15T00:00:00.000Z' },
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, ready)).mockResolvedValueOnce(jsonResponse(200, approved));
    await render(<KycOnboardingFlow userId="user-1" />);
    await waitFor(() => hasButton('Submit for verification'));

    await click(button('Submit for verification'));

    await waitFor(() => pageText().includes('Your identity is verified.'));
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/kyc\/user-1\/submit$/);
    expect(hasButton('Submit for verification')).toBe(false);
  });

  it('shows rejection reasons and lets the applicant edit documents', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        200,
        makeState({ status: 'rejected', onboardingStep: 'review', rejectionReasons: ['Photo page is cropped'] }),
      ),
    );
    await render(<KycOnboardingFlow userId="user-1" />);
    await waitFor(() => pageText().includes('Photo page is cropped'));

    const editButtons = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent === 'Edit');
    expect(editButtons).toHaveLength(2);
    await click(editButtons[1]);

    expect(pageText()).toContain('Required documents');
  });
});
