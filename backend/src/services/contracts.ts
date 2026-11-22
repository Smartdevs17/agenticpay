import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';
import {
  CONTRACT_TEMPLATES,
  PROJECT_CONFIG_TEMPLATES,
  type ContractClause,
  type ContractTemplate,
  type ContractType,
  type ProjectConfig,
  type ProjectConfigTemplate,
} from '../templates/contracts.js';

export type {
  ConditionalClause,
  ContractClause,
  ContractTemplate,
  ContractType,
  ProjectConfig,
  ProjectConfigTemplate,
  ProjectMilestone,
} from '../templates/contracts.js';

export type ContractStatus = 'draft' | 'pending_signature' | 'active' | 'completed' | 'terminated';

export interface ContractVersion {
  version: number;
  content: string;
  clauses: ContractClause[];
  createdAt: string;
  createdBy: string;
  changeDescription?: string;
}

export interface ContractRecord {
  id: string;
  projectId: string;
  type: ContractType;
  title: string;
  content: string;
  clauses: ContractClause[];
  versions: ContractVersion[];
  currentVersion: number;
  status: ContractStatus;
  parties: { clientId: string; freelancerId: string };
  metadata: {
    budget?: number;
    currency?: string;
    milestoneCount: number;
    templateId?: string;
    /** Placeholders the project config did not fill, e.g. `company_name`. */
    unresolvedPlaceholders: string[];
  };
  createdAt: string;
  updatedAt: string;
}

export interface GenerateContractInput {
  projectId: string;
  type: ContractType;
  clientId: string;
  freelancerId: string;
  projectConfig: ProjectConfig;
  createdBy: string;
}

export interface AmendmentInput {
  contractId: string;
  createdBy: string;
  changeDescription?: string;
  newClauses?: Array<Pick<ContractClause, 'title' | 'body'> & { isRequired?: boolean }>;
  removedClauseIds?: string[];
}

export interface ContractDiff {
  added: ContractClause[];
  removed: ContractClause[];
  modified: Array<{ clause: ContractClause; previous: ContractClause }>;
}

export interface GenerateFromTemplateInput {
  templateId: string;
  projectId: string;
  clientId: string;
  freelancerId: string;
  createdBy: string;
  /** Project config values; these override the template defaults. */
  overrides?: Partial<ProjectConfig>;
}

export class ContractTemplateError extends Error {
  constructor(message: string, readonly missingFields: string[] = []) {
    super(message);
    this.name = 'ContractTemplateError';
  }
}

const contracts = new Map<string, ContractRecord>();

export interface BatchGenerateInput {
  projectConfigs: Array<Omit<GenerateContractInput, 'type'> & { type?: ContractType }>;
  defaultType?: ContractType;
}

export interface ContractValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Resolve `{{snake_case}}` placeholders. A camelCase key from the project
 * config wins over the derived snake_case default, so `companyName` fills
 * `{{company_name}}`. Missing values leave the placeholder in place.
 */
function renderTemplate(body: string, context: Record<string, unknown>): string {
  return body.replace(PLACEHOLDER, (match, key: string) => {
    const value = context[snakeToCamel(key)] ?? context[key];
    return value === undefined || value === null || value === '' ? match : String(value);
  });
}

function findUnresolvedPlaceholders(clauses: ContractClause[]): string[] {
  const keys = new Set<string>();
  for (const clause of clauses) {
    for (const [, key] of clause.body.matchAll(PLACEHOLDER)) keys.add(key);
  }
  return [...keys].sort();
}

function buildClauses(type: ContractType, context: Record<string, unknown>): ContractClause[] {
  const template = CONTRACT_TEMPLATES[type];
  const clauses: ContractClause[] = [];

  // Add base clauses
  for (const clause of template.clauses) {
    clauses.push({
      id: `clause_${clauses.length + 1}`,
      title: clause.title,
      body: renderTemplate(clause.body, context),
      order: clause.order,
      isRequired: clause.isRequired,
    });
  }

  // Add conditional clauses if they match
  if (template.conditionalClauses) {
    for (const conditional of template.conditionalClauses) {
      if (conditional.condition(context)) {
        clauses.push({
          id: `clause_${clauses.length + 1}`,
          title: conditional.clause.title,
          body: renderTemplate(conditional.clause.body, context),
          order: conditional.clause.order,
          isRequired: conditional.clause.isRequired,
        });
      }
    }
  }

  return clauses;
}

function buildContextFromProjectConfig(input: GenerateContractInput): Record<string, unknown> {
  const milestones = input.projectConfig.milestones ?? [];
  const milestoneList = milestones.map((m: { name?: string; title?: string }, i: number) =>
    `${i + 1}. ${m.name || m.title || `Milestone ${i + 1}`}`
  ).join(', ');

  return {
    payment_terms: input.projectConfig.paymentTerms || 'Net 30',
    start_date: input.projectConfig.startDate || new Date().toISOString().split('T')[0],
    end_date: input.projectConfig.endDate || 'TBD',
    nda_term_years: 3,
    client_name: input.projectConfig.clientName || 'Client',
    freelancer_name: input.projectConfig.freelancerName || 'Freelancer',
    project_name: input.projectConfig.name || 'Project',
    scope_description: input.projectConfig.scope || 'As described in the project brief',
    budget: input.projectConfig.budget || 0,
    currency: input.projectConfig.currency || 'USD',
    milestone_count: milestones.length,
    milestone_list: milestoneList,
    confidentiality_period: input.projectConfig.confidentialityPeriod || 12,
    termination_notice_days: input.projectConfig.terminationNoticeDays || 30,
    non_compete: input.projectConfig.nonCompete || false,
    non_compete_months: input.projectConfig.nonCompeteMonths || 6,
    source_code_ip: input.projectConfig.sourceCodeIP || false,
    ...input.projectConfig,
  };
}

function buildVersion(
  version: number,
  clauses: ContractClause[],
  createdBy: string,
  changeDescription?: string,
): ContractVersion {
  return {
    version,
    content: clauses.map((c) => `## ${c.title}\n\n${c.body}`).join('\n\n'),
    clauses,
    createdAt: new Date().toISOString(),
    createdBy,
    changeDescription,
  };
}

export function generateContract(input: GenerateContractInput, templateId?: string): ContractRecord {
  const context = buildContextFromProjectConfig(input);

  const clauses = buildClauses(input.type, context);
  const version = buildVersion(1, clauses, input.createdBy, 'Initial version');
  const unresolvedPlaceholders = findUnresolvedPlaceholders(clauses);

  const record: ContractRecord = {
    id: `contract_${randomUUID().slice(0, 8)}`,
    projectId: input.projectId,
    type: input.type,
    title: `${CONTRACT_TEMPLATES[input.type].title} — ${context.project_name}`,
    content: version.content,
    clauses,
    versions: [version],
    currentVersion: 1,
    status: 'draft',
    parties: {
      clientId: input.clientId,
      freelancerId: input.freelancerId,
    },
    metadata: {
      budget: input.projectConfig.budget,
      currency: input.projectConfig.currency,
      milestoneCount: input.projectConfig.milestones?.length ?? 0,
      templateId,
      unresolvedPlaceholders,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  contracts.set(record.id, record);
  logger.info('[contracts] generated', {
    contractId: record.id,
    projectId: record.projectId,
    type: record.type,
    templateId,
  });
  if (unresolvedPlaceholders.length > 0) {
    logger.warn('[contracts] unresolved placeholders', { contractId: record.id, unresolvedPlaceholders });
  }
  return record;
}

export function amendContract(input: AmendmentInput): ContractRecord {
  const existing = contracts.get(input.contractId);
  if (!existing) throw new Error(`Contract ${input.contractId} not found`);

  let nextClauses = [...existing.clauses];

  if (input.removedClauseIds?.length) {
    nextClauses = nextClauses.filter((c) => !input.removedClauseIds!.includes(c.id));
  }

  if (input.newClauses?.length) {
    const maxOrder = nextClauses.reduce((max, c) => Math.max(max, c.order), 0);
    nextClauses.push(
      ...input.newClauses.map((c, i) => ({
        id: `clause_${randomUUID().slice(0, 6)}`,
        title: c.title!,
        body: c.body!,
        order: maxOrder + i + 1,
        isRequired: c.isRequired ?? false,
      })),
    );
  }

  const nextVersion = existing.currentVersion + 1;
  const version = buildVersion(nextVersion, nextClauses, input.createdBy, input.changeDescription);

  existing.versions.push(version);
  existing.clauses = nextClauses;
  existing.currentVersion = nextVersion;
  existing.content = version.content;
  existing.updatedAt = new Date().toISOString();

  contracts.set(existing.id, existing);
  return existing;
}

export function getContractDiff(fromVersion: number, toVersion: number, contractId: string): ContractDiff {
  const contract = contracts.get(contractId);
  if (!contract) throw new Error(`Contract ${contractId} not found`);

  const from = contract.versions.find((v) => v.version === fromVersion);
  const to = contract.versions.find((v) => v.version === toVersion);
  if (!from || !to) throw new Error('Version not found');

  const fromMap = new Map(from.clauses.map((c) => [c.id, c]));
  const toMap = new Map(to.clauses.map((c) => [c.id, c]));

  const added = to.clauses.filter((c) => !fromMap.has(c.id));
  const removed = from.clauses.filter((c) => !toMap.has(c.id));
  const modified = to.clauses.filter((c) => {
    const prev = fromMap.get(c.id);
    return prev && (prev.title !== c.title || prev.body !== c.body || prev.order !== c.order);
  }).map((c) => ({ clause: c, previous: fromMap.get(c.id)! }));

  return { added, removed, modified };
}

export function getContract(id: string): ContractRecord | undefined {
  return contracts.get(id);
}

export function listContracts(): ContractRecord[] {
  return Array.from(contracts.values());
}

export function resetContracts(): void {
  contracts.clear();
}

export function searchContracts(query: { projectId?: string; status?: string; type?: string }): ContractRecord[] {
  return listContracts().filter((c) => {
    if (query.projectId && c.projectId !== query.projectId) return false;
    if (query.status && c.status !== query.status) return false;
    if (query.type && c.type !== query.type) return false;
    return true;
  });
}

export function batchGenerateContracts(input: BatchGenerateInput): ContractRecord[] {
  const results: ContractRecord[] = [];

  for (const config of input.projectConfigs) {
    const contractType = config.type || input.defaultType || 'service';
    const contract = generateContract({ ...config, type: contractType });
    results.push(contract);
  }

  return results;
}

export function validateContractConfig(input: GenerateContractInput): ContractValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.projectId) errors.push('projectId is required');
  if (!input.type) errors.push('contract type is required');
  if (!input.createdBy) errors.push('createdBy is required');
  if (!input.clientId) errors.push('clientId is required');
  if (!input.freelancerId) errors.push('freelancerId is required');

  if (!input.projectConfig?.name) warnings.push('project name is missing, using default');
  if (!input.projectConfig?.budget) warnings.push('budget is not set');
  if (!input.projectConfig?.startDate) warnings.push('start date is not set');
  if (!input.projectConfig?.milestones?.length) warnings.push('no milestones defined');

  if (input.type === 'service' && !input.projectConfig?.paymentTerms) {
    warnings.push('payment terms not specified for service contract');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function getContractTemplate(type: ContractType): ContractTemplate | undefined {
  return CONTRACT_TEMPLATES[type];
}

export function listContractTemplates(): Array<{ type: ContractType; title: string; clauseCount: number }> {
  return Object.entries(CONTRACT_TEMPLATES).map(([type, template]) => ({
    type: type as ContractType,
    title: template.title,
    clauseCount: template.clauses.length,
  }));
}

export function getContractStats(): {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
} {
  const all = listContracts();
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};

  for (const contract of all) {
    byType[contract.type] = (byType[contract.type] || 0) + 1;
    byStatus[contract.status] = (byStatus[contract.status] || 0) + 1;
  }

  return { total: all.length, byType, byStatus };
}

// ─── Project configuration templates ─────────────────────────────────────────

export function listProjectConfigTemplates(): ProjectConfigTemplate[] {
  return Object.values(PROJECT_CONFIG_TEMPLATES);
}

export function getProjectConfigTemplate(id: string): ProjectConfigTemplate | undefined {
  return Object.prototype.hasOwnProperty.call(PROJECT_CONFIG_TEMPLATES, id) ? PROJECT_CONFIG_TEMPLATES[id] : undefined;
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

/**
 * Generate a contract from a project configuration template. Template defaults
 * are merged under the caller's overrides; generation fails with
 * ContractTemplateError if a required field is still missing.
 */
export function generateContractFromTemplate(input: GenerateFromTemplateInput): ContractRecord {
  const template = getProjectConfigTemplate(input.templateId);
  if (!template) throw new ContractTemplateError(`Unknown project config template: ${input.templateId}`);

  const projectConfig: ProjectConfig = {
    milestones: [],
    ...template.defaults,
    ...input.overrides,
  } as ProjectConfig;

  const missingFields = template.requiredFields.filter((field) => isMissing(projectConfig[field]));
  if (missingFields.length > 0) {
    throw new ContractTemplateError(
      `Template ${template.id} is missing required fields: ${missingFields.join(', ')}`,
      missingFields,
    );
  }

  const validation = validateContractConfig({
    projectId: input.projectId,
    type: template.contractType,
    clientId: input.clientId,
    freelancerId: input.freelancerId,
    createdBy: input.createdBy,
    projectConfig,
  });
  if (!validation.valid) throw new ContractTemplateError(validation.errors.join('; '));

  return generateContract(
    {
      projectId: input.projectId,
      type: template.contractType,
      clientId: input.clientId,
      freelancerId: input.freelancerId,
      createdBy: input.createdBy,
      projectConfig,
    },
    template.id,
  );
}
