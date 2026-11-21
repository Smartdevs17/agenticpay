# KYC Onboarding and Document Verification

Issue: [#921](https://github.com/Smartdevs17/agenticpay/issues/921)

A three-step identity verification flow for individual users: personal
information → document upload → review and status. Documents are checked
locally (file type, size, signature, number format, dates) and then by a
pluggable verification provider. Applications move through
`pending → under_review → approved | rejected`, and every decision carries
reasons.

Business verification (KYB) is separate and lives at `/api/v1/kyb`.

## Backend

Service: `backend/src/services/kyc.ts` (`KycService`, extends the existing KYC profile, risk and screening logic)
Verification: `backend/src/services/kyc-verification.ts` (format checks and providers)
Schemas: `backend/src/schemas/kyc.ts`
Routes: `backend/src/routes/kyc.ts` (mounted at `/api/v1/kyc`)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/requirements` | Document rules for building the upload form |
| `GET` | `/:userId` | Onboarding state: profile, requirements, `canSubmit` |
| `PUT` | `/:userId/personal-info` | Step 1 — save personal details and address |
| `POST` | `/:userId/documents` | Step 2 — upload and verify a document |
| `POST` | `/:userId/submit` | Step 3 — submit for review |
| `GET` | `/review/queue` | Applications waiting for a reviewer |
| `POST` | `/:userId/documents/:documentId/review` | Reviewer decision on one document |
| `POST` | `/:userId/review` | Reviewer decision on the application |

Service errors use the standard error envelope
(`{ error: { code, message, status, details } }`), with the individual
validation failures in `details`:

| Code | Status | When |
| --- | --- | --- |
| `INVALID_PERSONAL_INFO` | 422 | Under 18, date of birth in the future or implausible |
| `INVALID_DOCUMENT` | 422 | Any document format check failed |
| `DUPLICATE_DOCUMENT` | 409 | The identity document is already linked to another account |
| `PERSONAL_INFO_REQUIRED` | 409 | Documents uploaded or submitted before step 1 |
| `REQUIREMENTS_NOT_MET` | 422 | Submitted without both required documents |
| `KYC_LOCKED` | 409 | Editing while under review or approved |
| `INVALID_STATUS_TRANSITION` | 409 | A decision that the current status does not allow |
| `REJECTION_REASON_REQUIRED` | 400 | Rejecting without a reason |
| `KYC_NOT_FOUND` | 404 | No profile for the user |

### Uploading a document

```http
POST /api/v1/kyc/user-123/documents
Content-Type: application/json

{
  "type": "passport",
  "documentNumber": "A12345678",
  "issuingCountry": "US",
  "expiryDate": "2031-04-30",
  "fileName": "passport.pdf",
  "mimeType": "application/pdf",
  "fileSize": 482113,
  "fileContent": "<base64>"
}
```

Send the file either as base64 `fileContent` (a `data:` URL prefix is
accepted) or as an `https` `fileUrl` for files already held in storage. The
KYC routes accept JSON bodies up to 15 MB so a 10 MB document fits once
encoded. File contents are hashed (SHA-256) and passed to the provider; they
are not stored. Document numbers are stored masked (`*****5678`), and
`documentNumber`, `fileContent` and `dateOfBirth` are redacted from audit log
request bodies.

### Requirements

An application needs one of each before it can be submitted:

- **Identity document** — `passport`, `drivers_license` or `national_id`
- **Proof of address** — `utility_bill` or `bank_statement`

A document that was rejected does not count; uploading another document of the
same type replaces it.

### Document checks

| Check | Rule |
| --- | --- |
| File type | `image/jpeg`, `image/png`, `image/webp`, `application/pdf` (the `kyc` upload category), extension must match |
| File size | 1 KB – 10 MB; must equal the decoded content length |
| File signature | Magic bytes must match the declared type (shared with the upload middleware) |
| Issuing country | 2-letter ISO code |
| Document number (identity) | Required; letters and digits after removing spaces/hyphens. Passport 6–9, national ID 5–20, driver's license 4–20 characters. Country formats override these: US passport `A12345678`/`123456789`, GB passport 9 digits, IN passport letter + 7 digits, NG passport letter + 8 digits, NG national ID (NIN) 11 digits |
| Expiry (identity) | Required, must be after today and within 20 years; expiring within 30 days adds a warning |
| Issue date | Optional for identity documents (not in the future, before expiry); required for proof of address and must be within the last 90 days |
| Applicant age | At least 18 |

### Status transitions

| From | To | Trigger |
| --- | --- | --- |
| — | `pending` | Personal information saved |
| `pending` | `under_review` | Applicant submits |
| `under_review` | `approved` | Reviewer approves, or automatic approval |
| `under_review` | `rejected` | Reviewer rejects (reasons required) |
| `rejected` / `expired` | `pending` | Applicant edits details or uploads a document |
| `approved` | `expired` | One year after approval |

On submission the existing AML, sanctions and PEP checks run and the risk score
is recalculated. Nationality or residence in a high-risk jurisdiction adds 30
points. An application is approved automatically when every document was
approved by the provider, the risk level is `low`, and no high-risk
jurisdiction is involved; otherwise it waits in the review queue. Pass
`autoApprove: false` to `KycService` to send everything to manual review.
Every transition is recorded in `statusHistory` with the actor and reason.

### Verification providers

```ts
interface DocumentVerificationProvider {
  readonly name: string;
  verify(request: DocumentVerificationRequest): Promise<DocumentVerificationResult>;
}

// decision: 'approved' | 'rejected' | 'needs_review'
new KycService({ verificationProvider: new MyVendorProvider() });
```

The provider receives the decoded file (or `fileUrl`), its hash, the
normalized document number, dates and the applicant's personal information.
`approved` verifies the document, `rejected` stores the provider's reasons,
and `needs_review` leaves the document `pending` with the reasons as warnings.
A provider that throws is treated as `needs_review`.

The default `MockDocumentVerificationProvider` is deterministic, for local
development and tests:

| Document number ends in | Result |
| --- | --- |
| `000` | Rejected — "Document number is reported as lost or stolen" |
| `999` | Needs review — "Automated checks were inconclusive; manual review required" |
| anything else | Approved |

## Frontend

- Page: `frontend/app/dashboard/kyc/page.tsx` (linked from the sidebar as
  "Identity (KYC)" and from the onboarding wizard's identity step)
- Flow: `frontend/components/kyc/KycOnboardingFlow.tsx` with
  `PersonalInfoStep`, `DocumentUploadStep` and `ReviewStep`
- Client checks and API calls: `frontend/lib/kyc.ts`

The page resumes from the step the backend reports, runs the same file, number
and date checks in the browser before uploading, and shows per-document
statuses, warnings and rejection reasons.

## Tests

- `backend/src/services/__tests__/kyc-verification.test.ts` — format checks and the mock provider
- `backend/src/services/__tests__/kyc-onboarding.test.ts` — flow, transitions, auto-approval, review, expiry
- `backend/src/services/__tests__/kyc.test.ts` — existing KYC service behaviour
- `backend/src/routes/__tests__/kyc.test.ts` — HTTP API end to end
- `frontend/lib/kyc.test.ts` and `frontend/components/kyc/__tests__/KycOnboardingFlow.test.tsx`

```bash
cd backend && npx vitest run src/services/__tests__/kyc*.test.ts src/routes/__tests__/kyc.test.ts
cd frontend && npx vitest run lib/kyc.test.ts components/kyc
```
