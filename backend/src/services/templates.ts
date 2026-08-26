import { randomUUID } from 'node:crypto';

// ── Types ────────────────────────────────────────────────────────────────────

export type TemplateStep = {
  id: string;
  name: string;
  type: 'action' | 'notification' | 'condition' | 'delay';
  config: Record<string, unknown>;
  order: number;
};

export type ProjectTemplate = {
  id: string;
  name: string;
  description: string;
  category: string;
  steps: TemplateStep[];
  createdBy: string;
  isPublic: boolean;
  variables: TemplateVariable[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type TemplateVariable = {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  defaultValue?: unknown;
  required: boolean;
};

type TemplateCloneOptions = {
  name?: string;
  overrides?: Partial<Pick<ProjectTemplate, 'description' | 'category' | 'isPublic'>>;
  stepOverrides?: Record<string, Partial<TemplateStep['config']>>;
};

// ── In-Memory Store ──────────────────────────────────────────────────────────

const templateStore = new Map<string, ProjectTemplate>();
const usageIndex = new Map<string, Set<string>>();

// ── CRUD Operations ──────────────────────────────────────────────────────────

export function createTemplate(input: {
  name: string;
  description: string;
  category: string;
  steps: Omit<TemplateStep, 'id'>[];
  createdBy: string;
  isPublic?: boolean;
  variables?: TemplateVariable[];
}): ProjectTemplate {
  const id = randomUUID();
  const now = new Date().toISOString();

  const steps: TemplateStep[] = input.steps.map((step, idx) => ({
    ...step,
    id: randomUUID(),
    order: step.order ?? idx,
  }));

  const template: ProjectTemplate = {
    id,
    name: input.name,
    description: input.description,
    category: input.category,
    steps,
    createdBy: input.createdBy,
    isPublic: input.isPublic ?? false,
    variables: input.variables ?? [],
    version: 1,
    createdAt: now,
    updatedAt: now,
  };

  templateStore.set(id, template);
  return template;
}

export function getTemplate(templateId: string): ProjectTemplate | undefined {
  return templateStore.get(templateId);
}

export function listTemplates(options?: { category?: string; createdBy?: string; isPublic?: boolean }): ProjectTemplate[] {
  let results = Array.from(templateStore.values());
  if (options?.category) results = results.filter((t) => t.category === options.category);
  if (options?.createdBy) results = results.filter((t) => t.createdBy === options.createdBy);
  if (options?.isPublic !== undefined) results = results.filter((t) => t.isPublic === options.isPublic);
  return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function updateTemplate(
  templateId: string,
  patch: Partial<Pick<ProjectTemplate, 'name' | 'description' | 'category' | 'isPublic' | 'variables'>>,
): ProjectTemplate | undefined {
  const existing = templateStore.get(templateId);
  if (!existing) return undefined;

  const updated: ProjectTemplate = {
    ...existing,
    ...patch,
    id: existing.id,
    createdBy: existing.createdBy,
    steps: existing.steps,
    version: existing.version + 1,
    updatedAt: new Date().toISOString(),
  };

  templateStore.set(templateId, updated);
  return updated;
}

export function deleteTemplate(templateId: string): boolean {
  return templateStore.delete(templateId);
}

// ── Step Management ──────────────────────────────────────────────────────────

export function addStep(
  templateId: string,
  step: Omit<TemplateStep, 'id'>,
): TemplateStep | undefined {
  const template = templateStore.get(templateId);
  if (!template) return undefined;

  const newStep: TemplateStep = {
    ...step,
    id: randomUUID(),
    order: step.order ?? template.steps.length,
  };

  template.steps.push(newStep);
  template.version += 1;
  template.updatedAt = new Date().toISOString();
  templateStore.set(templateId, template);

  return newStep;
}

export function updateStep(
  templateId: string,
  stepId: string,
  patch: Partial<Pick<TemplateStep, 'name' | 'type' | 'config' | 'order'>>,
): TemplateStep | undefined {
  const template = templateStore.get(templateId);
  if (!template) return undefined;

  const step = template.steps.find((s) => s.id === stepId);
  if (!step) return undefined;

  Object.assign(step, patch);
  template.version += 1;
  template.updatedAt = new Date().toISOString();
  templateStore.set(templateId, template);

  return step;
}

export function removeStep(templateId: string, stepId: string): boolean {
  const template = templateStore.get(templateId);
  if (!template) return false;

  const idx = template.steps.findIndex((s) => s.id === stepId);
  if (idx === -1) return false;

  template.steps.splice(idx, 1);
  template.version += 1;
  template.updatedAt = new Date().toISOString();
  templateStore.set(templateId, template);

  return true;
}

export function reorderSteps(templateId: string, stepIds: string[]): boolean {
  const template = templateStore.get(templateId);
  if (!template) return false;

  const stepMap = new Map(template.steps.map((s) => [s.id, s]));
  const reordered: TemplateStep[] = [];
  for (let i = 0; i < stepIds.length; i++) {
    const step = stepMap.get(stepIds[i]);
    if (!step) return false;
    step.order = i;
    reordered.push(step);
  }

  template.steps = reordered;
  template.version += 1;
  template.updatedAt = new Date().toISOString();
  templateStore.set(templateId, template);

  return true;
}

// ── Clone & Customize ────────────────────────────────────────────────────────

export function cloneTemplate(templateId: string, options: TemplateCloneOptions = {}): ProjectTemplate | undefined {
  const source = templateStore.get(templateId);
  if (!source) return undefined;

  const steps = source.steps.map((step) => {
    const config = options.stepOverrides?.[step.id]
      ? { ...step.config, ...options.stepOverrides[step.id] }
      : { ...step.config };
    return { ...step, id: randomUUID(), config };
  });

  return createTemplate({
    name: options.name ?? `${source.name} (Copy)`,
    description: options.overrides?.description ?? source.description,
    category: options.overrides?.category ?? source.category,
    steps,
    createdBy: source.createdBy,
    isPublic: options.overrides?.isPublic ?? false,
    variables: source.variables.map((v) => ({ ...v })),
  });
}

// ── Usage Tracking ───────────────────────────────────────────────────────────

export function trackUsage(templateId: string, workspaceId: string): void {
  const set = usageIndex.get(templateId) ?? new Set<string>();
  set.add(workspaceId);
  usageIndex.set(templateId, set);
}

export function getUsageCount(templateId: string): number {
  return usageIndex.get(templateId)?.size ?? 0;
}

// ── Validation ───────────────────────────────────────────────────────────────

export function validateTemplate(template: ProjectTemplate): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!template.name.trim()) errors.push('Template name is required');
  if (!template.steps.length) errors.push('Template must have at least one step');

  const requiredVars = template.variables.filter((v) => v.required);
  for (const v of requiredVars) {
    if (v.defaultValue === undefined) {
      errors.push(`Required variable "${v.name}" must have a default value`);
    }
  }

  const stepNames = template.steps.map((s) => s.name);
  const duplicates = stepNames.filter((name, i) => stepNames.indexOf(name) !== i);
  if (duplicates.length) errors.push(`Duplicate step names: ${[...new Set(duplicates)].join(', ')}`);

  return { valid: errors.length === 0, errors };
}

// ── Test Helpers ─────────────────────────────────────────────────────────────

export function resetForTests(): void {
  templateStore.clear();
  usageIndex.clear();
}
