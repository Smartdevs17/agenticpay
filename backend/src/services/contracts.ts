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

const BASE_TEMPLATES: Record<ContractType, { title: string; clauses: Omit<ContractClause, 'id'>[] }> = {
  service: {
    title: 'Service Agreement',
    clauses: [
      { title: 'Parties', body: 'This agreement is between the Client and the Freelancer identified in the metadata.', order: 1, isRequired: true },
      { title: 'Scope of Work', body: 'The Freelancer agrees to provide the services described in the project configuration.', order: 2, isRequired: true },
      { title: 'Payment Terms', body: '{{payment_terms}}. Payments are released upon milestone approval.', order: 3, isRequired: true },
      { title: 'Timeline', body: 'The project start date is {{start_date}}. The end date is {{end_date}} or upon completion of all milestones.', order: 4, isRequired: false },
      { title: 'Intellectual Property', body: 'All deliverables become the property of the Client upon full payment.', order: 5, isRequired: true },
      { title: 'Confidentiality', body: 'Both parties agree to keep project details confidential.', order: 6, isRequired: false },
      { title: 'Dispute Resolution', body: 'Disputes are resolved through the AgenticPay escrow and dispute process.', order: 7, isRequired: true },
      { title: 'Termination', body: 'Either party may terminate with written notice. Outstanding milestones are evaluated for partial payment.', order: 8, isRequired: false },
    ],
  },
  milestone: {
    title: 'Milestone Agreement',
    clauses: [
      { title: 'Milestones', body: 'The project is divided into the milestones listed in the project configuration.', order: 1, isRequired: true },
      { title: 'Acceptance Criteria', body: 'Each milestone must meet the acceptance criteria described in its deliverable.', order: 2, isRequired: true },
      { title: 'Payment Schedule', body: 'Payments are released per milestone as defined in the project budget.', order: 3, isRequired: true },
      { title: 'Change Requests', body: 'Scope changes require written agreement and may adjust milestone amounts.', order: 4, isRequired: false },
    ],
  },
  nda: {
    title: 'Non-Disclosure Agreement',
    clauses: [
      { title: 'Definition of Confidential Information', body: 'Confidential information includes project details, trade secrets, and business plans.', order: 1, isRequired: true },
      { title: 'Obligations', body: 'The receiving party must protect confidential information and not disclose it to third parties.', order: 2, isRequired: true },
      { title: 'Term', body: 'This agreement remains in effect for {{nda_term_years}} years.', order: 3, isRequired: true },
      { title: 'Return of Materials', body: 'Upon termination, all confidential materials must be returned or destroyed.', order: 4, isRequired: false },
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
  return template.clauses.map((clause, index) => ({
    id: `clause_${index + 1}`,
    title: clause.title,
    body: renderTemplate(clause.body, context),
    order: clause.order,
    isRequired: clause.isRequired,
  }));
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
  const context = {
    payment_terms: input.projectConfig.paymentTerms,
    start_date: input.projectConfig.startDate,
    end_date: input.projectConfig.endDate || 'TBD',
    nda_term_years: 3,
    ...input.projectConfig,
  };

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
