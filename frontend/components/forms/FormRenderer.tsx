'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormSchema, FormFieldSchema, FileFieldValue } from './types';
import { useFormDraft } from './useFormDraft';

interface FormRendererProps {
  form: FormSchema;
  submitLabel?: string;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}

function isFieldVisible(field: FormFieldSchema, values: Record<string, unknown>): boolean {
  if (!field.visibleIf) return true;
  const dependentValue = values[field.visibleIf.fieldName];
  return String(dependentValue) === field.visibleIf.value;
}

async function readFileAsBase64(file: File): Promise<FileFieldValue> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result;
      if (typeof content !== 'string') {
        reject(new Error('Unable to encode file')); 
        return;
      }
      resolve({
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        content: content.split(',')[1] || '',
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getDefaultValues(fields: FormFieldSchema[]) {
  return fields.reduce((acc, field) => {
    acc[field.name] = field.type === 'file' ? undefined : '';
    return acc;
  }, {} as Record<string, unknown>);
}

export function FormRenderer({ form, onSubmit, submitLabel = 'Submit' }: FormRendererProps) {
  const defaultValues = useMemo(() => getDefaultValues(form.fields), [form.fields]);
  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Record<string, unknown>>({
    defaultValues,
    mode: 'onBlur',
    shouldUnregister: true,
  });

  useFormDraft(form.id ?? 'anonymous-form', watch, reset);

  const watchedValues = watch();
  const visibleFields = useMemo(
    () => form.fields.filter((field) => isFieldVisible(field, watchedValues)),
    [form.fields, watchedValues],
  );

  const [submitStatus, setSubmitStatus] = useState<string | null>(null);

  useEffect(() => {
    reset(defaultValues);
  }, [defaultValues, reset]);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-background p-6 shadow-sm">
        <div className="mb-4 space-y-2">
          <h2 className="text-xl font-semibold">{form.name}</h2>
          {form.description ? <p className="text-sm text-muted-foreground">{form.description}</p> : null}
          {form.analytics ? (
            <p className="text-sm text-muted-foreground">
              Completion rate: {form.analytics.completionRate}% ({form.analytics.completions}/{form.analytics.views})
            </p>
          ) : null}
        </div>

        <form
          onSubmit={handleSubmit(async (values) => {
            setSubmitStatus(null);
            await onSubmit(values);
            setSubmitStatus('Form submitted successfully');
          })}
          className="space-y-6"
        >
          {visibleFields.map((field) => {
            const fieldError = errors[field.name]?.message as string | undefined;
            return (
              <div key={field.id} className="space-y-2 rounded-lg border border-input p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <Label htmlFor={field.name}>{field.label}</Label>
                  {field.helpText ? (
                    <span className="text-xs text-muted-foreground">{field.helpText}</span>
                  ) : null}
                </div>

                {field.type === 'select' ? (
                  <select
                    id={field.name}
                    {...register(field.name, {
                      required: field.required ? 'This field is required' : false,
                      validate: (value) => {
                        if (field.required && String(value).trim() === '') {
                          return 'This field is required';
                        }
                        return true;
                      },
                    })}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                    defaultValue=""
                  >
                    <option value="" disabled hidden>
                      Select an option
                    </option>
                    {field.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : field.type === 'file' ? (
                  <Controller
                    name={field.name}
                    control={control}
                    rules={{
                      validate: async (value) => {
                        if (field.required && !value) {
                          return 'File upload is required';
                        }
                        return true;
                      },
                    }}
                    render={({ field: controllerField }) => (
                      <div className="space-y-2">
                        <Input
                          id={field.name}
                          type="file"
                          accept={field.accept}
                          onChange={async (event) => {
                            const file = event.target.files?.[0];
                            if (!file) {
                              controllerField.onChange(undefined);
                              return;
                            }
                            const encoded = await readFileAsBase64(file);
                            controllerField.onChange(encoded);
                          }}
                        />
                        {controllerField.value ? (
                          <p className="text-sm text-muted-foreground">
                            Selected file: {(controllerField.value as FileFieldValue).filename}
                          </p>
                        ) : null}
                      </div>
                    )}
                  />
                ) : (
                  <Input
                    id={field.name}
                    type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                    placeholder={field.placeholder}
                    {...register(field.name, {
                      required: field.required ? 'This field is required' : false,
                      min: field.min,
                      max: field.max,
                      pattern: field.pattern ? { value: new RegExp(field.pattern), message: 'Value does not match required pattern' } : undefined,
                      valueAsNumber: field.type === 'number',
                    })}
                  />
                )}

                {fieldError ? <p className="text-sm text-destructive">{fieldError}</p> : null}
              </div>
            );
          })}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
              {submitLabel}
            </Button>
            {submitStatus ? <p className="text-sm text-green-600">{submitStatus}</p> : null}
          </div>
        </form>
      </div>
    </div>
  );
}
