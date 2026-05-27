import { SIGNATURE_SAFETY_NOTICE } from '@/lib/signatures';

export default function SignatureSafetyPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <h1 className="text-2xl font-semibold text-slate-900">Wallet Signature Safety</h1>
      <p className="text-slate-700">{SIGNATURE_SAFETY_NOTICE}</p>
      <ul className="list-disc space-y-2 pl-6 text-slate-700">
        <li>Check the full domain in your browser before signing.</li>
        <li>Only approve typed-data prompts that reference AgenticPay and your expected action.</li>
        <li>Reject prompts with unexpected nonce, payload hash, or expiration windows.</li>
        <li>Signatures are domain-bound and expire quickly to reduce phishing risk.</li>
      </ul>
    </main>
  );
}
