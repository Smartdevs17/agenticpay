'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

type KYBStatus = 'pending' | 'documents_submitted' | 'under_review' | 'approved' | 'rejected' | 'requires_more_info' | 'expired';

interface KYBRecord {
  id: string;
  businessName: string;
  status: KYBStatus;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  submittedAt: string;
  expiresAt?: string;
  reviewerNotes?: string;
}

const statusColors: Record<KYBStatus, string> = {
  pending: 'bg-gray-100 text-gray-700',
  documents_submitted: 'bg-blue-100 text-blue-700',
  under_review: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  requires_more_info: 'bg-orange-100 text-orange-700',
  expired: 'bg-gray-100 text-gray-500',
};

const riskColors = { low: 'text-green-600', medium: 'text-yellow-600', high: 'text-red-600' };

export default function KYBVerificationPage() {
  const [step, setStep] = useState<'form' | 'result'>('form');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [record, setRecord] = useState<KYBRecord | null>(null);

  const [form, setForm] = useState({
    businessId: '',
    businessName: '',
    registrationNumber: '',
    registrationCountry: '',
    businessType: 'llc',
    incorporationDate: '',
    contactEmail: '',
    website: '',
    uboName: '',
    uboOwnership: '',
    uboNationality: '',
    uboDob: '',
    uboDocType: 'passport',
    uboDocNumber: '',
    docType: 'registration_certificate',
    docUrl: '',
    docName: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const payload = {
      businessId: form.businessId,
      businessName: form.businessName,
      registrationNumber: form.registrationNumber,
      registrationCountry: form.registrationCountry,
      businessType: form.businessType,
      incorporationDate: form.incorporationDate,
      contactEmail: form.contactEmail,
      ...(form.website ? { website: form.website } : {}),
      ubos: [{
        name: form.uboName,
        ownershipPercentage: Number(form.uboOwnership),
        nationality: form.uboNationality,
        dateOfBirth: form.uboDob,
        documentType: form.uboDocType,
        documentNumber: form.uboDocNumber,
      }],
      documents: [{
        type: form.docType,
        url: form.docUrl,
        name: form.docName,
      }],
    };

    try {
      const res = await fetch(`${API_BASE}/kyb/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'Submission failed');
      setRecord(data);
      setStep('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'result' && record) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-4">
        <h1 className="text-2xl font-bold">KYB Submitted</h1>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              {record.businessName}
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColors[record.status]}`}>
                {record.status.replace(/_/g, ' ')}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p><span className="font-medium">Record ID:</span> {record.id}</p>
            <p>
              <span className="font-medium">Risk Score:</span>{' '}
              <span className={riskColors[record.riskLevel]}>{record.riskScore}/100 ({record.riskLevel})</span>
            </p>
            <p><span className="font-medium">Submitted:</span> {new Date(record.submittedAt).toLocaleString()}</p>
            {record.reviewerNotes && (
              <p><span className="font-medium">Notes:</span> {record.reviewerNotes}</p>
            )}
            {record.expiresAt && (
              <p><span className="font-medium">Expires:</span> {new Date(record.expiresAt).toLocaleDateString()}</p>
            )}
          </CardContent>
        </Card>
        <Button variant="outline" onClick={() => setStep('form')}>Submit Another</Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Business Verification (KYB)</h1>
        <p className="text-sm text-muted-foreground mt-1">Required for high-value payments and compliance.</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-3">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Business Info */}
        <Card>
          <CardHeader><CardTitle className="text-base">Business Information</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            {[
              { name: 'businessId', label: 'Business ID' },
              { name: 'businessName', label: 'Business Name' },
              { name: 'registrationNumber', label: 'Registration Number' },
              { name: 'registrationCountry', label: 'Country Code (e.g. US)' },
              { name: 'incorporationDate', label: 'Incorporation Date (YYYY-MM-DD)' },
              { name: 'contactEmail', label: 'Contact Email' },
              { name: 'website', label: 'Website (optional)' },
            ].map(({ name, label }) => (
              <div key={name} className="space-y-1">
                <Label htmlFor={name}>{label}</Label>
                <Input id={name} name={name} value={(form as any)[name]} onChange={handleChange}
                  required={name !== 'website'} />
              </div>
            ))}
            <div className="space-y-1">
              <Label htmlFor="businessType">Business Type</Label>
              <select id="businessType" name="businessType" value={form.businessType} onChange={handleChange}
                className="w-full border rounded px-3 py-2 text-sm bg-background">
                {['llc', 'corporation', 'partnership', 'sole_proprietorship', 'other'].map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        {/* UBO */}
        <Card>
          <CardHeader><CardTitle className="text-base">Ultimate Beneficial Owner (UBO)</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            {[
              { name: 'uboName', label: 'Full Name' },
              { name: 'uboOwnership', label: 'Ownership %' },
              { name: 'uboNationality', label: 'Nationality (e.g. US)' },
              { name: 'uboDob', label: 'Date of Birth (YYYY-MM-DD)' },
              { name: 'uboDocNumber', label: 'Document Number' },
            ].map(({ name, label }) => (
              <div key={name} className="space-y-1">
                <Label htmlFor={name}>{label}</Label>
                <Input id={name} name={name} value={(form as any)[name]} onChange={handleChange} required />
              </div>
            ))}
            <div className="space-y-1">
              <Label htmlFor="uboDocType">Document Type</Label>
              <select id="uboDocType" name="uboDocType" value={form.uboDocType} onChange={handleChange}
                className="w-full border rounded px-3 py-2 text-sm bg-background">
                {['passport', 'national_id', 'drivers_license'].map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        {/* Document */}
        <Card>
          <CardHeader><CardTitle className="text-base">Business Document</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="docType">Document Type</Label>
              <select id="docType" name="docType" value={form.docType} onChange={handleChange}
                className="w-full border rounded px-3 py-2 text-sm bg-background">
                {['registration_certificate', 'articles_of_incorporation', 'proof_of_address', 'tax_id', 'other'].map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="docName">Document Name</Label>
              <Input id="docName" name="docName" value={form.docName} onChange={handleChange} required />
            </div>
            <div className="col-span-2 space-y-1">
              <Label htmlFor="docUrl">Document URL</Label>
              <Input id="docUrl" name="docUrl" type="url" value={form.docUrl} onChange={handleChange} required
                placeholder="https://..." />
            </div>
          </CardContent>
        </Card>

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Submitting...' : 'Submit KYB Application'}
        </Button>
      </form>
    </div>
  );
}
