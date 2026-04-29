'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FormRenderer } from './FormRenderer';
import { FormFieldSchema, FormSchema } from './types';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { GripVertical, Plus, Trash2 } from 'lucide-react';

const fieldTypes = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'file', label: 'File' },
  { value: 'select', label: 'Select' },
] as const;

function createEmptyField(index: number): FormFieldSchema {
  return {
    id: `field-${Date.now()}-${index}`,
    name: `field_${index + 1}`,
    label: `Field ${index + 1}`,
    type: 'text',
    required: false,
    placeholder: '',
    helpText: '',
    options: [],
  };
}

function parseOptions(optionsText: string) {
  return optionsText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, value] = line.split(':').map((item) => item.trim());
      return {
        label: label || value,
        value: value || label,
      };
    });
}

export function FormBuilder() {
  const [schema, setSchema] = useState<FormSchema>({
    name: 'New Custom Form',
    description: 'Use this builder to create a schema-based form.',
    fields: [createEmptyField(0)],
  });
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fieldNames = useMemo(
    () => schema.fields.map((field) => ({ value: field.name, label: field.label })),
    [schema.fields],
  );

  const updateField = (id: string, patch: Partial<FormFieldSchema>) => {
    setSchema((current) => ({
      ...current,
      fields: current.fields.map((field) => (field.id === id ? { ...field, ...patch } : field)),
    }));
  };

  const removeField = (id: string) => {
    setSchema((current) => ({
      ...current,
      fields: current.fields.filter((item) => item.id !== id),
    }));
  };

  const reorderFields = (sourceId: string, targetId: string) => {
    setSchema((current) => {
      const fields = [...current.fields];
      const fromIndex = fields.findIndex((item) => item.id === sourceId);
      const toIndex = fields.findIndex((item) => item.id === targetId);
      if (fromIndex === -1 || toIndex === -1) return current;
      const [moved] = fields.splice(fromIndex, 1);
      fields.splice(toIndex, 0, moved);
      return { ...current, fields };
    });
  };

  const handleAddField = () => {
    setSchema((current) => ({
      ...current,
      fields: [...current.fields, createEmptyField(current.fields.length)],
    }));
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      const result = await api.forms.createForm({
        name: schema.name,
        description: schema.description,
        fields: schema.fields.map((field) => ({
          ...field,
          options: field.type === 'select' ? field.options ?? [] : undefined,
        })),
      });
      setEmbedUrl(`/forms/embed/${result.id}`);
      toast.success('Form saved successfully');
    } catch (error) {
      console.error(error);
      toast.error('Failed to save form');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="grid gap-6 lg:grid-cols-[430px_1fr]">
        <section className="space-y-6 rounded-xl border border-input bg-background p-6 shadow-sm">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">Schema Builder</h2>
            <p className="text-sm text-muted-foreground">
              Drag fields to reorder, add validation rules, and preview how the form behaves.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <Label htmlFor="form-name">Form name</Label>
              <Input
                id="form-name"
                value={schema.name}
                onChange={(event) => setSchema((current) => ({ ...current, name: event.target.value }))}
              />
            </div>

            <div>
              <Label htmlFor="form-description">Description</Label>
              <textarea
                id="form-description"
                value={schema.description ?? ''}
                onChange={(event) =>
                  setSchema((current) => ({ ...current, description: event.target.value }))
                }
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                rows={3}
              />
            </div>
          </div>

          <div className="space-y-3">
            {schema.fields.map((field) => (
              <div
                key={field.id}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/plain', field.id);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceId = event.dataTransfer.getData('text/plain');
                  if (sourceId) reorderFields(sourceId, field.id);
                }}
                className="group rounded-xl border border-input/70 bg-surface/75 p-4 shadow-sm transition hover:border-primary"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <GripVertical className="h-4 w-4" />
                    <span>Field</span>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    type="button"
                    onClick={() => removeField(field.id)}
                    aria-label="Remove field"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid gap-4 pt-4">
                  <div>
                    <Label htmlFor={`${field.id}-label`}>Label</Label>
                    <Input
                      id={`${field.id}-label`}
                      value={field.label}
                      onChange={(event) => updateField(field.id, { label: event.target.value })}
                    />
                  </div>

                  <div>
                    <Label htmlFor={`${field.id}-name`}>Field name</Label>
                    <Input
                      id={`${field.id}-name`}
                      value={field.name}
                      onChange={(event) => updateField(field.id, { name: event.target.value })}
                    />
                  </div>

                  <div>
                    <Label htmlFor={`${field.id}-type`}>Field type</Label>
                    <Select
                      onValueChange={(value) => updateField(field.id, { type: value as FormFieldSchema['type'] })}
                      defaultValue={field.type}
                    >
                      <SelectTrigger id={`${field.id}-type`}>
                        <SelectValue placeholder="Choose type" />
                      </SelectTrigger>
                      <SelectContent>
                        {fieldTypes.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={field.required ?? false}
                        onChange={(event) => updateField(field.id, { required: event.target.checked })}
                        className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
                      />
                      Required
                    </label>
                    <div>
                      <Label htmlFor={`${field.id}-placeholder`}>Placeholder</Label>
                      <Input
                        id={`${field.id}-placeholder`}
                        value={field.placeholder ?? ''}
                        onChange={(event) => updateField(field.id, { placeholder: event.target.value })}
                      />
                    </div>
                  </div>

                  {field.type === 'select' ? (
                    <div>
                      <Label htmlFor={`${field.id}-options`}>Options</Label>
                      <textarea
                        id={`${field.id}-options`}
                        value={(field.options ?? []).map((option) => `${option.label}:${option.value}`).join('\n')}
                        onChange={(event) => updateField(field.id, { options: parseOptions(event.target.value) })}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                        rows={3}
                        placeholder="Label:value per line"
                      />
                    </div>
                  ) : null}

                  {field.type === 'file' ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor={`${field.id}-accept`}>Accept</Label>
                        <Input
                          id={`${field.id}-accept`}
                          value={field.accept ?? ''}
                          onChange={(event) => updateField(field.id, { accept: event.target.value })}
                          placeholder=".pdf,.docx,image/*"
                        />
                      </div>
                      <div>
                        <Label htmlFor={`${field.id}-max-size`}>Max size (bytes)</Label>
                        <Input
                          id={`${field.id}-max-size`}
                          type="number"
                          value={field.maxSizeBytes ?? ''}
                          onChange={(event) => updateField(field.id, { maxSizeBytes: Number(event.target.value) || undefined })}
                        />
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor={`${field.id}-pattern`}>Pattern</Label>
                      <Input
                        id={`${field.id}-pattern`}
                        value={field.pattern ?? ''}
                        onChange={(event) => updateField(field.id, { pattern: event.target.value || undefined })}
                        placeholder="^\\S+@\\S+\\.\\S+$"
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor={`${field.id}-min`}>Min</Label>
                        <Input
                          id={`${field.id}-min`}
                          type="number"
                          value={field.min ?? ''}
                          onChange={(event) => updateField(field.id, { min: event.target.value === '' ? undefined : Number(event.target.value) })}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`${field.id}-max`}>Max</Label>
                        <Input
                          id={`${field.id}-max`}
                          type="number"
                          value={field.max ?? ''}
                          onChange={(event) => updateField(field.id, { max: event.target.value === '' ? undefined : Number(event.target.value) })}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor={`${field.id}-visible-if`}>Show when field</Label>
                      <Select
                        onValueChange={(value) => updateField(field.id, {
                          visibleIf: value
                            ? { fieldName: value, value: field.visibleIf?.value ?? '' }
                            : undefined,
                        })}
                        defaultValue={field.visibleIf?.fieldName ?? ''}
                      >
                        <SelectTrigger id={`${field.id}-visible-if`}>
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">None</SelectItem>
                          {fieldNames
                            .filter((item) => item.value !== field.name)
                            .map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {field.visibleIf ? (
                      <div>
                        <Label htmlFor={`${field.id}-visible-value`}>When value</Label>
                        <Input
                          id={`${field.id}-visible-value`}
                          value={field.visibleIf.value}
                          onChange={(event) =>
                            updateField(field.id, {
                              visibleIf: {
                                fieldName: field.visibleIf?.fieldName ?? '',
                                value: event.target.value,
                              },
                            })
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" type="button" onClick={handleAddField}>
              <Plus className="h-4 w-4" /> Add field
            </Button>
            <Button type="button" onClick={handleSave} disabled={loading}>
              Save schema
            </Button>
          </div>

          {embedUrl ? (
            <div className="rounded-xl border border-input p-4 bg-surface/80">
              <p className="text-sm font-semibold">Embed code</p>
              <pre className="mt-2 overflow-x-auto rounded-md bg-black/5 p-3 text-xs text-slate-700">
                {`<iframe src="${window.location.origin}${embedUrl}" width="100%" height="800" frameborder="0"></iframe>`}
              </pre>
            </div>
          ) : null}
        </section>

        <section className="space-y-4">
          <div className="rounded-xl border border-input bg-background p-6 shadow-sm">
            <h3 className="text-lg font-semibold">Live Preview</h3>
            <p className="text-sm text-muted-foreground">
              The preview respects conditional visibility, required fields, patterns, and range validators.
            </p>
            <div className="mt-4">
              <FormRenderer
                form={schema}
                submitLabel="Preview Submit"
                onSubmit={async () => {
                  toast.success('Preview submission accepted');
                }}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
