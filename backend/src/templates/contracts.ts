/**
 * Contract templates — Issue #1366
 *
 * CONTRACT_TEMPLATES holds the clause text for each contract type. Clause
 * bodies use {{snake_case}} placeholders; the generator resolves each one from
 * the project configuration (camelCase keys) or the derived context.
 *
 * PROJECT_CONFIG_TEMPLATES are ready-made project configurations: a contract
 * type, sensible defaults and the fields a caller must still supply. They let
 * a project spin up its contract in one call from a template id.
 */

export type ContractType = 'service' | 'milestone' | 'nda' | 'employment' | 'licensing' | 'custom';

export interface ContractClause {
  id: string;
  title: string;
  body: string;
  order: number;
  isRequired: boolean;
}

export interface ContractTemplate {
  title: string;
  clauses: Omit<ContractClause, 'id'>[];
  conditionalClauses?: ConditionalClause[];
}

export interface ConditionalClause {
  clause: Omit<ContractClause, 'id'>;
  condition: (context: Record<string, unknown>) => boolean;
}

export interface ProjectMilestone {
  name?: string;
  title?: string;
  amount?: number;
  dueDate?: string;
}

export interface ProjectConfig {
  name?: string;
  description?: string;
  scope?: string;
  budget?: number;
  currency?: string;
  milestones: ProjectMilestone[];
  paymentTerms?: string;
  startDate?: string;
  endDate?: string;
  clientName?: string;
  freelancerName?: string;
  confidentialityPeriod?: number;
  terminationNoticeDays?: number;
  nonCompete?: boolean;
  nonCompeteMonths?: number;
  sourceCodeIP?: boolean;
  [key: string]: unknown;
}

export interface ProjectConfigTemplate {
  id: string;
  name: string;
  description: string;
  contractType: ContractType;
  defaults: Partial<ProjectConfig>;
  /** Project config keys that must be present after defaults and overrides are merged. */
  requiredFields: string[];
}

export const CONTRACT_TEMPLATES: Record<ContractType, ContractTemplate> = {
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

export const PROJECT_CONFIG_TEMPLATES: Record<string, ProjectConfigTemplate> = {
  'fixed-price-build': {
    id: 'fixed-price-build',
    name: 'Fixed price build',
    description: 'One deliverable for a fixed budget, client owns the source code.',
    contractType: 'service',
    defaults: {
      paymentTerms: '50% on signing and 50% on final delivery',
      confidentialityPeriod: 12,
      terminationNoticeDays: 14,
      sourceCodeIP: true,
      milestones: [],
    },
    requiredFields: ['name', 'scope', 'budget', 'currency', 'clientName', 'freelancerName'],
  },
  'milestone-delivery': {
    id: 'milestone-delivery',
    name: 'Milestone delivery',
    description: 'Work split into milestones, each released from escrow on approval.',
    contractType: 'milestone',
    defaults: {
      paymentTerms: 'Released per approved milestone',
    },
    requiredFields: ['name', 'scope', 'budget', 'currency', 'milestones'],
  },
  'mutual-nda': {
    id: 'mutual-nda',
    name: 'Mutual NDA',
    description: 'Confidentiality agreement signed before project details are shared.',
    contractType: 'nda',
    defaults: {
      ndaTermYears: 2,
      returnPeriodDays: 30,
      milestones: [],
    },
    requiredFields: ['name', 'clientName', 'freelancerName'],
  },
  'software-license': {
    id: 'software-license',
    name: 'Software license',
    description: 'Non-exclusive license to use delivered software for a fee.',
    contractType: 'licensing',
    defaults: {
      licenseType: 'non-exclusive',
      licenseDuration: '12 months',
      paymentTerms: 'Net 30',
      milestones: [],
    },
    requiredFields: ['softwareName', 'licensorName', 'licenseeName', 'licenseFee', 'currency'],
  },
};
