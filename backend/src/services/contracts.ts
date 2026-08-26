import { randomUUID } from 'node:crypto';
import type {
  ContractRecord,
  ContractVersion,
  ContractClause,
  GenerateContractInput,
  AmendmentInput,
  ContractDiff,
  ContractType,
} from './contracts.js';

const contracts = new Map<string, ContractRecord>();

export interface ContractTemplate {
  title: string;
  clauses: Omit<ContractClause, 'id'>[];
  conditionalClauses?: ConditionalClause[];
}

export interface ConditionalClause {
  clause: Omit<ContractClause, 'id'>;
  condition: (context: Record<string, unknown>) => boolean;
}

export interface BatchGenerateInput {
  projectConfigs: GenerateContractInput[];
  defaultType?: ContractType;
}

export interface ContractValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const BASE_TEMPLATES: Record<ContractType, ContractTemplate> = {
  service: {
    title: 'Service Agreement',
    clauses: [
      { title: 'Parties', body: 'This agreement is between {{client_name}} ("Client") and {{freelancer_name}} ("Freelancer").', order: 1, isRequired: true },
      { title: 'Scope of Work', body: 'The Freelancer agrees to provide the services described in the project "{{project_name}}": {{scope_description}}.', order: 2, isRequired: true },
      { title: 'Payment Terms', body: '{{payment_terms}}. Total budget: {{budget}} {{currency}}. Payments are released upon milestone approval.', order: 3, isRequired: true },
      { title: 'Timeline', body: 'The project start date is {{start_date}}. The end date is {{end_date}} or upon completion of all milestones.', order: 4, isRequired: false },
      { title: 'Intellectual Property', body: 'All deliverables become the property of the Client upon full payment.', order: 5, isRequired: true },
      { title: 'Confidentiality', body: 'Both parties agree to keep project details confidential for {{confidentiality_period}} months.', order: 6, isRequired: false },
      { title: 'Dispute Resolution', body: 'Disputes are resolved through the AgenticPay escrow and dispute process.', order: 7, isRequired: true },
      { title: 'Termination', body: 'Either party may terminate with {{termination_notice_days}} days written notice. Outstanding milestones are evaluated for partial payment.', order: 8, isRequired: false },
    ],
    conditionalClauses: [
      {
        clause: { title: 'Non-Compete', body: 'The Freelancer agrees not to provide similar services to direct competitors for {{non_compete_months}} months after project completion.', order: 9, isRequired: false },
        condition: (ctx) => Boolean(ctx.non_compete),
      },
      {
        clause: { title: 'Source Code Ownership', body: 'All source code, documentation, and related materials become the exclusive property of the Client.', order: 10, isRequired: false },
        condition: (ctx) => Boolean(ctx.source_code_ip),
      },
    ],
  },
  milestone: {
    title: 'Milestone Agreement',
    clauses: [
      { title: 'Project Overview', body: 'Project "{{project_name}}": {{scope_description}}.', order: 1, isRequired: true },
      { title: 'Milestones', body: 'The project is divided into {{milestone_count}} milestones: {{milestone_list}}.', order: 2, isRequired: true },
      { title: 'Acceptance Criteria', body: 'Each milestone must meet the acceptance criteria described in its deliverable.', order: 3, isRequired: true },
      { title: 'Payment Schedule', body: 'Payments are released per milestone as defined in the project budget. Total: {{budget}} {{currency}}.', order: 4, isRequired: true },
      { title: 'Change Requests', body: 'Scope changes require written agreement and may adjust milestone amounts.', order: 5, isRequired: false },
    ],
  },
  nda: {
    title: 'Non-Disclosure Agreement',
    clauses: [
      { title: 'Parties', body: 'This agreement is between {{client_name}} and {{freelancer_name}}.', order: 1, isRequired: true },
      { title: 'Definition of Confidential Information', body: 'Confidential information includes project details, trade secrets, business plans, and all materials related to "{{project_name}}".', order: 2, isRequired: true },
      { title: 'Obligations', body: 'The receiving party must protect confidential information and not disclose it to third parties without prior written consent.', order: 3, isRequired: true },
      { title: 'Term', body: 'This agreement remains in effect for {{nda_term_years}} years from the date of signing.', order: 4, isRequired: true },
      { title: 'Return of Materials', body: 'Upon termination, all confidential materials must be returned or destroyed within {{return_period_days}} days.', order: 5, isRequired: false },
    ],
  },
  employment: {
    title: 'Employment Agreement',
    clauses: [
      { title: 'Parties', body: 'This agreement is between {{company_name}} ("Employer") and {{employee_name}} ("Employee").', order: 1, isRequired: true },
      { title: 'Position', body: 'Employee is hired as {{job_title}} starting {{start_date}}.', order: 2, isRequired: true },
      { title: 'Compensation', body: 'Base salary: {{salary}} {{currency}} per {{salary_period}}. Payment schedule: {{payment_schedule}}.', order: 3, isRequired: true },
      { title: 'Benefits', body: 'Employee is entitled to: {{benefits_list}}.', order: 4, isRequired: false },
      { title: 'Termination', body: 'Either party may terminate with {{termination_notice_days}} days written notice.', order: 5, isRequired: true },
    ],
  },
  licensing: {
    title: 'Software License Agreement',
    clauses: [
      { title: 'Parties', body: 'This agreement is between {{licensor_name}} ("Licensor") and {{licensee_name}} ("Licensee").', order: 1, isRequired: true },
      { title: 'License Grant', body: 'Licensor grants Licensee a {{license_type}} license to use "{{software_name}}" for {{license_duration}}.', order: 2, isRequired: true },
      { title: 'Restrictions', body: 'Licensee may not: reverse engineer, sublicense, or distribute the software.', order: 3, isRequired: true },
      { title: 'Fees', body: 'License fee: {{license_fee}} {{currency}}. Payment terms: {{payment_terms}}.', order: 4, isRequired: true },
      { title: 'Warranty', body: 'The software is provided "as is" without warranty of any kind.', order: 5, isRequired: false },
    ],
  },
  custom: {
    title: 'Custom Contract',
    clauses: [
      { title: 'Agreement Terms', body: 'Custom terms as defined by the parties.', order: 1, isRequired: true },
    ],
  },
};

function renderTemplate(body: string, context: Record<string, unknown>): string {
  let rendered = body;
  for (const [key, value] of Object.entries(context)) {
    const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    rendered = rendered.replace(placeholder, String(value));
  }
  return rendered;
}

function buildClauses(type: ContractType, context: Record<string, unknown>): ContractClause[] {
  const template = BASE_TEMPLATES[type];
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
  const milestones = input.projectConfig.milestones || [];
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
  clauses: ContractClause[],
  createdBy: string,
  changeDescription?: string,
): ContractVersion {
  return {
    version: 1,
    content: clauses.map((c) => `## ${c.title}\n\n${c.body}`).join('\n\n'),
    clauses,
    createdAt: new Date().toISOString(),
    createdBy,
    changeDescription,
  };
}

export function generateContract(input: GenerateContractInput): ContractRecord {
  const context = buildContextFromProjectConfig(input);

  const clauses = buildClauses(input.type, context);
  const version = buildVersion(clauses, input.createdBy, 'Initial version');

  const record: ContractRecord = {
    id: `contract_${randomUUID().slice(0, 8)}`,
    projectId: input.projectId,
    type: input.type,
    title: `${BASE_TEMPLATES[input.type].title} — ${input.projectConfig.name}`,
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
      milestoneCount: input.projectConfig.milestones.length,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  contracts.set(record.id, record);
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
  const version = buildVersion(nextClauses, input.createdBy, input.changeDescription);

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
  return BASE_TEMPLATES[type];
}

export function listContractTemplates(): Array<{ type: ContractType; title: string; clauseCount: number }> {
  return Object.entries(BASE_TEMPLATES).map(([type, template]) => ({
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
