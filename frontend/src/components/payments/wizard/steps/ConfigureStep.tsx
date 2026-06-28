"use client";

import { useEffect, useMemo } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, ArrowRight, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useWizardStore, type PaymentType, type BatchPaymentEntry } from '@/store/wizard-store';

/* ---------- Per-type schemas ---------- */

const currencies = ['XLM', 'USDC', 'ETH', 'BTC', 'EURT'] as const;

const simpleSchema = z.object({
  amount: z
    .string()
    .min(1, 'Amount is required')
    .regex(/^\d+(\.\d{1,7})?$/, 'Enter a valid amount'),
  currency: z.string().min(1, 'Currency is required'),
  recipient: z
    .string()
    .min(1, 'Recipient is required')
    .regex(/^[G][a-km-zA-HJ-NP-Z1-9]{55}$/, 'Invalid Stellar public key'),
  description: z.string().min(1, 'Description is required'),
});

const escrowSchema = z.object({
  amount: z
    .string()
    .min(1, 'Amount is required')
    .regex(/^\d+(\.\d{1,7})?$/, 'Enter a valid amount'),
  currency: z.string().min(1, 'Currency is required'),
  recipient: z
    .string()
    .min(1, 'Recipient is required')
    .regex(/^[G][a-km-zA-HJ-NP-Z1-9]{55}$/, 'Invalid Stellar public key'),
  milestoneDescription: z.string().min(1, 'Milestone description is required'),
  releaseConditions: z.string().min(1, 'Release conditions are required'),
  arbitrator: z
    .string()
    .min(1, 'Arbitrator is required')
    .regex(/^[G][a-km-zA-HJ-NP-Z1-9]{55}$/, 'Invalid Stellar public key'),
});

const subscriptionSchema = z.object({
  amount: z
    .string()
    .min(1, 'Amount is required')
    .regex(/^\d+(\.\d{1,7})?$/, 'Enter a valid amount'),
  currency: z.string().min(1, 'Currency is required'),
  recipient: z
    .string()
    .min(1, 'Recipient is required')
    .regex(/^[G][a-km-zA-HJ-NP-Z1-9]{55}$/, 'Invalid Stellar public key'),
  interval: z.enum(['daily', 'weekly', 'monthly'], {
    required_error: 'Interval is required',
  }),
  maxPayments: z.coerce.number().int().positive('Must be at least 1'),
});

const batchEntrySchema = z.object({
  recipient: z
    .string()
    .min(1, 'Recipient is required')
    .regex(/^[G][a-km-zA-HJ-NP-Z1-9]{55}$/, 'Invalid Stellar public key'),
  amount: z
    .string()
    .min(1, 'Amount is required')
    .regex(/^\d+(\.\d{1,7})?$/, 'Enter a valid amount'),
});

const batchSchema = z.object({
  currency: z.string().min(1, 'Currency is required'),
  entries: z.array(batchEntrySchema).min(1, 'At least one recipient is required'),
});

/* ---------- Combined schema ---------- */

const getSchema = (type: PaymentType | null) => {
  switch (type) {
    case 'simple':
      return simpleSchema;
    case 'escrow':
      return escrowSchema;
    case 'subscription':
      return subscriptionSchema;
    case 'batch':
      return batchSchema;
    default:
      return simpleSchema;
  }
};

/* ---------- Field definitions ---------- */

interface FieldDef {
  name: string;
  label: string;
  type: 'text' | 'number' | 'textarea' | 'select';
  placeholder?: string;
  options?: readonly string[];
}

function getFields(type: PaymentType | null): FieldDef[] {
  switch (type) {
    case 'simple':
      return [
        { name: 'amount', label: 'Amount', type: 'text', placeholder: '0.00' },
        {
          name: 'currency',
          label: 'Currency',
          type: 'select',
          options: currencies,
        },
        {
          name: 'recipient',
          label: 'Recipient',
          type: 'text',
          placeholder: 'G...',
        },
        {
          name: 'description',
          label: 'Description',
          type: 'textarea',
          placeholder: 'Payment for...',
        },
      ];
    case 'escrow':
      return [
        { name: 'amount', label: 'Amount', type: 'text', placeholder: '0.00' },
        {
          name: 'currency',
          label: 'Currency',
          type: 'select',
          options: currencies,
        },
        {
          name: 'recipient',
          label: 'Recipient',
          type: 'text',
          placeholder: 'G...',
        },
        {
          name: 'milestoneDescription',
          label: 'Milestone Description',
          type: 'textarea',
          placeholder: 'Describe the milestone...',
        },
        {
          name: 'releaseConditions',
          label: 'Release Conditions',
          type: 'textarea',
          placeholder: 'Conditions for releasing funds...',
        },
        {
          name: 'arbitrator',
          label: 'Arbitrator',
          type: 'text',
          placeholder: 'G...',
        },
      ];
    case 'subscription':
      return [
        { name: 'amount', label: 'Amount', type: 'text', placeholder: '0.00' },
        {
          name: 'currency',
          label: 'Currency',
          type: 'select',
          options: currencies,
        },
        {
          name: 'recipient',
          label: 'Recipient',
          type: 'text',
          placeholder: 'G...',
        },
        {
          name: 'interval',
          label: 'Interval',
          type: 'select',
          options: ['daily', 'weekly', 'monthly'] as const,
        },
        {
          name: 'maxPayments',
          label: 'Max Payments',
          type: 'number',
          placeholder: '12',
        },
      ];
    case 'batch':
      return [
        {
          name: 'currency',
          label: 'Currency',
          type: 'select',
          options: currencies,
        },
      ];
    default:
      return [];
  }
}

/* ---------- Component ---------- */

export function ConfigureStep() {
  const paymentType = useWizardStore((s) => s.paymentType);
  const formData = useWizardStore((s) => s.formData);
  const updateFormData = useWizardStore((s) => s.updateFormData);
  const nextStep = useWizardStore((s) => s.nextStep);
  const prevStep = useWizardStore((s) => s.prevStep);

  const schema = useMemo(() => getSchema(paymentType), [paymentType]);
  const fields = useMemo(() => getFields(paymentType), [paymentType]);
  const isBatch = paymentType === 'batch';

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: formData as Record<string, unknown>,
    mode: 'onBlur',
  });

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isValid },
    watch,
    reset,
  } = form;

  const { fields: entryFields, append, remove } = useFieldArray({
    control,
    name: 'entries' as never,
  });

  useEffect(() => {
    reset(formData as Record<string, unknown>);
  }, [paymentType, reset, formData]);

  const batchEntries = watch('entries') as BatchPaymentEntry[] | undefined;
  const batchTotal = useMemo(
    () =>
      (batchEntries ?? []).reduce(
        (sum, e) => sum + (Number.parseFloat(e.amount) || 0),
        0,
      ),
    [batchEntries],
  );

  const onSubmit = (data: Record<string, unknown>) => {
    updateFormData(data);
    nextStep();
  };

  const onError = () => {
    /* RHF will show field-level messages */
  };

  const renderField = (field: FieldDef) => {
    const errorMsg = (errors as Record<string, { message?: string }>)[field.name]?.message;

    if (field.type === 'select') {
      return (
        <div key={field.name} className="space-y-2">
          <Label htmlFor={field.name}>{field.label}</Label>
          <Select
            onValueChange={(val) => form.setValue(field.name, val, { shouldValidate: true })}
            defaultValue={(formData as Record<string, string>)[field.name] ?? ''}
          >
            <SelectTrigger id={field.name} className={errorMsg ? 'border-destructive' : ''}>
              <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {(field.options ?? []).map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errorMsg && (
            <p className="text-sm text-destructive" role="alert">
              {errorMsg}
            </p>
          )}
        </div>
      );
    }

    if (field.type === 'textarea') {
      return (
        <div key={field.name} className="space-y-2">
          <Label htmlFor={field.name}>{field.label}</Label>
          <Textarea
            id={field.name}
            placeholder={field.placeholder}
            className={errorMsg ? 'border-destructive' : ''}
            {...register(field.name)}
          />
          {errorMsg && (
            <p className="text-sm text-destructive" role="alert">
              {errorMsg}
            </p>
          )}
        </div>
      );
    }

    return (
      <div key={field.name} className="space-y-2">
        <Label htmlFor={field.name}>{field.label}</Label>
        <Input
          id={field.name}
          type={field.type}
          placeholder={field.placeholder}
          className={errorMsg ? 'border-destructive' : ''}
          {...register(field.name)}
        />
        {errorMsg && (
          <p className="text-sm text-destructive" role="alert">
            {errorMsg}
          </p>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configure Payment</CardTitle>
        <CardDescription>
          {paymentType === 'simple' && 'Enter the details for your one-time payment.'}
          {paymentType === 'escrow' && 'Set up the escrow conditions and parties involved.'}
          {paymentType === 'subscription' && 'Configure the recurring payment schedule.'}
          {paymentType === 'batch' && 'Add recipients and amounts for the batch payment.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit, onError)} className="space-y-6">
          {fields.map(renderField)}

          {/* Batch entry rows */}
          {isBatch && (
            <div className="space-y-3">
              <Label>Recipients</Label>
              {entryFields.map((entry, index) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 rounded-lg border p-3"
                >
                  <div className="flex-1 space-y-2">
                    <Label className="text-xs" htmlFor={`entries.${index}.recipient`}>
                      Recipient
                    </Label>
                    <Input
                      id={`entries.${index}.recipient`}
                      placeholder="G..."
                      {...register(`entries.${index}.recipient` as const)}
                    />
                    {(errors.entries as Record<string, { recipient?: { message?: string } }>)?.[index]?.recipient?.message && (
                      <p className="text-xs text-destructive">
                        {
                          (errors.entries as Record<string, { recipient?: { message?: string } }>)[index].recipient
                            ?.message
                        }
                      </p>
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <Label className="text-xs" htmlFor={`entries.${index}.amount`}>
                      Amount
                    </Label>
                    <Input
                      id={`entries.${index}.amount`}
                      placeholder="0.00"
                      {...register(`entries.${index}.amount` as const)}
                    />
                    {(errors.entries as Record<string, { amount?: { message?: string } }>)?.[index]?.amount?.message && (
                      <p className="text-xs text-destructive">
                        {
                          (errors.entries as Record<string, { amount?: { message?: string } }>)[index].amount?.message
                        }
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="mt-6 shrink-0"
                    onClick={() => remove(index)}
                    aria-label="Remove recipient"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ recipient: '', amount: '' })}
              >
                <Plus className="mr-1 h-4 w-4" />
                Add Recipient
              </Button>

              <div className="rounded-lg bg-muted p-3 text-sm">
                <span className="font-medium">Total: </span>
                {batchTotal.toFixed(2)}
              </div>
            </div>
          )}

          <div className="flex justify-between pt-2">
            <Button type="button" variant="ghost" onClick={prevStep}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back
            </Button>
            <Button type="submit">
              Continue
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
