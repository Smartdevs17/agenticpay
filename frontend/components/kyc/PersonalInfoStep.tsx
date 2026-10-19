'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { validatePersonalInfo, type FieldErrors, type KycPersonalInfo } from '@/lib/kyc';

interface PersonalInfoStepProps {
  initial?: KycPersonalInfo;
  disabled?: boolean;
  onSubmit: (info: KycPersonalInfo) => Promise<void>;
}

const EMPTY: KycPersonalInfo = {
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  nationality: '',
  countryOfResidence: '',
  address: { line1: '', line2: '', city: '', state: '', postalCode: '', country: '' },
};

const PERSON_FIELDS = [
  { name: 'firstName', label: 'First name', autoComplete: 'given-name' },
  { name: 'lastName', label: 'Last name', autoComplete: 'family-name' },
  { name: 'dateOfBirth', label: 'Date of birth', type: 'date', autoComplete: 'bday' },
  { name: 'nationality', label: 'Nationality (e.g. US)', maxLength: 2 },
  { name: 'countryOfResidence', label: 'Country of residence (e.g. US)', maxLength: 2 },
] as const;

const ADDRESS_FIELDS = [
  { name: 'line1', label: 'Address line 1', autoComplete: 'address-line1' },
  { name: 'line2', label: 'Address line 2 (optional)', autoComplete: 'address-line2' },
  { name: 'city', label: 'City', autoComplete: 'address-level2' },
  { name: 'state', label: 'State / region (optional)', autoComplete: 'address-level1' },
  { name: 'postalCode', label: 'Postal code', autoComplete: 'postal-code' },
  { name: 'country', label: 'Country (e.g. US)', maxLength: 2 },
] as const;

function withoutBlankOptionals(info: KycPersonalInfo): KycPersonalInfo {
  const { line2, state, ...address } = info.address;
  return {
    ...info,
    nationality: info.nationality.toUpperCase(),
    countryOfResidence: info.countryOfResidence.toUpperCase(),
    address: {
      ...address,
      country: address.country.toUpperCase(),
      ...(line2?.trim() ? { line2 } : {}),
      ...(state?.trim() ? { state } : {}),
    },
  };
}

export function PersonalInfoStep({ initial, disabled, onSubmit }: PersonalInfoStepProps) {
  const [form, setForm] = useState<KycPersonalInfo>(() => ({
    ...EMPTY,
    ...initial,
    address: { ...EMPTY.address, ...initial?.address },
  }));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const fieldErrors = validatePersonalInfo(form);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    setSaving(true);
    try {
      await onSubmit(withoutBlankOptionals(form));
    } finally {
      setSaving(false);
    }
  };

  const renderError = (key: string) =>
    errors[key] ? (
      <p id={`${key}-error`} className="text-xs text-red-600">
        {errors[key]}
      </p>
    ) : null;

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <fieldset disabled={disabled || saving} className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">About you</legend>
        {PERSON_FIELDS.map((field) => (
          <div key={field.name} className="space-y-1">
            <Label htmlFor={field.name}>{field.label}</Label>
            <Input
              id={field.name}
              type={'type' in field ? field.type : 'text'}
              autoComplete={'autoComplete' in field ? field.autoComplete : undefined}
              maxLength={'maxLength' in field ? field.maxLength : undefined}
              value={form[field.name]}
              aria-invalid={Boolean(errors[field.name])}
              aria-describedby={errors[field.name] ? `${field.name}-error` : undefined}
              onChange={(e) => setForm((f) => ({ ...f, [field.name]: e.target.value }))}
            />
            {renderError(field.name)}
          </div>
        ))}
      </fieldset>

      <fieldset disabled={disabled || saving} className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Residential address</legend>
        {ADDRESS_FIELDS.map((field) => {
          const key = `address.${field.name}`;
          return (
            <div key={key} className="space-y-1">
              <Label htmlFor={key}>{field.label}</Label>
              <Input
                id={key}
                autoComplete={'autoComplete' in field ? field.autoComplete : undefined}
                maxLength={'maxLength' in field ? field.maxLength : undefined}
                value={form.address[field.name] ?? ''}
                aria-invalid={Boolean(errors[key])}
                aria-describedby={errors[key] ? `${key}-error` : undefined}
                onChange={(e) =>
                  setForm((f) => ({ ...f, address: { ...f.address, [field.name]: e.target.value } }))
                }
              />
              {renderError(key)}
            </div>
          );
        })}
      </fieldset>

      <div className="flex justify-end">
        <Button type="submit" disabled={disabled || saving}>
          {saving ? 'Saving...' : 'Save and continue'}
        </Button>
      </div>
    </form>
  );
}
