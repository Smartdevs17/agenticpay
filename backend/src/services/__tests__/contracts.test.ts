import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateContract,
  amendContract,
  getContractDiff,
  getContract,
  listContracts,
  searchContracts,
  batchGenerateContracts,
  validateContractConfig,
  getContractTemplate,
  listContractTemplates,
  getContractStats,
} from '../contracts.js';
import type { GenerateContractInput, ContractType } from '../contracts.js';

describe('Contracts Service', () => {
  const baseInput: GenerateContractInput = {
    projectId: 'proj-123',
    type: 'service',
    clientId: 'client-1',
    freelancerId: 'freelancer-1',
    createdBy: 'user-1',
    projectConfig: {
      name: 'Test Project',
      budget: 10000,
      currency: 'USD',
      startDate: '2024-01-01',
      endDate: '2024-06-30',
      paymentTerms: 'Net 30 upon milestone approval',
      milestones: [
        { name: 'Design Phase', amount: 3000 },
        { name: 'Development Phase', amount: 5000 },
        { name: 'Testing Phase', amount: 2000 },
      ],
    },
  };

  beforeEach(() => {
    // Clear contracts map between tests
    listContracts().forEach((c) => {
      // @ts-ignore - accessing internal map for testing
      contracts.delete(c.id);
    });
  });

  describe('generateContract', () => {
    it('should generate a service contract from project config', () => {
      const contract = generateContract(baseInput);

      expect(contract).toBeDefined();
      expect(contract.id).toMatch(/^contract_/);
      expect(contract.type).toBe('service');
      expect(contract.title).toContain('Test Project');
      expect(contract.clauses.length).toBeGreaterThan(0);
      expect(contract.status).toBe('draft');
      expect(contract.parties.clientId).toBe('client-1');
      expect(contract.parties.freelancerId).toBe('freelancer-1');
    });

    it('should render template variables in clauses', () => {
      const contract = generateContract(baseInput);

      const paymentClause = contract.clauses.find((c) => c.title === 'Payment Terms');
      expect(paymentClause?.body).toContain('Net 30 upon milestone approval');
      expect(paymentClause?.body).toContain('10000');
      expect(paymentClause?.body).toContain('USD');
    });

    it('should include conditional clauses when conditions are met', () => {
      const inputWithNonCompete = {
        ...baseInput,
        projectConfig: {
          ...baseInput.projectConfig,
          nonCompete: true,
          nonCompeteMonths: 12,
        },
      };

      const contract = generateContract(inputWithNonCompete);
      const nonCompeteClause = contract.clauses.find((c) => c.title === 'Non-Compete');
      expect(nonCompeteClause).toBeDefined();
      expect(nonCompeteClause?.body).toContain('12 months');
    });

    it('should exclude conditional clauses when conditions are not met', () => {
      const contract = generateContract(baseInput);
      const nonCompeteClause = contract.clauses.find((c) => c.title === 'Non-Compete');
      expect(nonCompeteClause).toBeUndefined();
    });

    it('should generate NDA contract', () => {
      const ndaInput = { ...baseInput, type: 'nda' as ContractType };
      const contract = generateContract(ndaInput);

      expect(contract.type).toBe('nda');
      expect(contract.title).toContain('Non-Disclosure');
      expect(contract.clauses.some((c) => c.title === 'Definition of Confidential Information')).toBe(true);
    });

    it('should generate employment contract', () => {
      const employmentInput = {
        ...baseInput,
        type: 'employment' as ContractType,
        projectConfig: {
          ...baseInput.projectConfig,
          companyName: 'Acme Corp',
          employeeName: 'John Doe',
          jobTitle: 'Senior Engineer',
          salary: 120000,
          salaryPeriod: 'year',
          benefitsList: 'Health insurance, 401k, PTO',
        },
      };

      const contract = generateContract(employmentInput);
      expect(contract.type).toBe('employment');
      expect(contract.clauses.some((c) => c.title === 'Position')).toBe(true);
    });

    it('should generate licensing contract', () => {
      const licensingInput = {
        ...baseInput,
        type: 'licensing' as ContractType,
        projectConfig: {
          ...baseInput.projectConfig,
          licensorName: 'Software Inc',
          licenseeName: 'Client Corp',
          softwareName: 'SuperTool',
          licenseType: 'non-exclusive',
          licenseDuration: '1 year',
          licenseFee: 5000,
        },
      };

      const contract = generateContract(licensingInput);
      expect(contract.type).toBe('licensing');
      expect(contract.clauses.some((c) => c.title === 'License Grant')).toBe(true);
    });
  });

  describe('batchGenerateContracts', () => {
    it('should generate multiple contracts from project configs', () => {
      const configs = [
        baseInput,
        { ...baseInput, projectId: 'proj-456', type: 'milestone' as ContractType },
        { ...baseInput, projectId: 'proj-789', type: 'nda' as ContractType },
      ];

      const contracts = batchGenerateContracts({ projectConfigs: configs });

      expect(contracts).toHaveLength(3);
      expect(contracts[0].type).toBe('service');
      expect(contracts[1].type).toBe('milestone');
      expect(contracts[2].type).toBe('nda');
    });

    it('should use default type when not specified', () => {
      const configs = [
        { ...baseInput, type: undefined },
        { ...baseInput, projectId: 'proj-456', type: undefined },
      ];

      const contracts = batchGenerateContracts({
        projectConfigs: configs,
        defaultType: 'service',
      });

      expect(contracts.every((c) => c.type === 'service')).toBe(true);
    });
  });

  describe('validateContractConfig', () => {
    it('should return valid for complete config', () => {
      const result = validateContractConfig(baseInput);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return errors for missing required fields', () => {
      const invalidInput = {
        ...baseInput,
        projectId: '',
        clientId: '',
        freelancerId: '',
      };

      const result = validateContractConfig(invalidInput);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should return warnings for optional but recommended fields', () => {
      const inputWithoutMilestones = {
        ...baseInput,
        projectConfig: {
          ...baseInput.projectConfig,
          milestones: [],
        },
      };

      const result = validateContractConfig(inputWithoutMilestones);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('getContractTemplate', () => {
    it('should return template for valid type', () => {
      const template = getContractTemplate('service');
      expect(template).toBeDefined();
      expect(template?.title).toBe('Service Agreement');
    });

    it('should return undefined for invalid type', () => {
      const template = getContractTemplate('invalid' as ContractType);
      expect(template).toBeUndefined();
    });
  });

  describe('listContractTemplates', () => {
    it('should list all available templates', () => {
      const templates = listContractTemplates();
      expect(templates.length).toBeGreaterThan(0);
      expect(templates.some((t) => t.type === 'service')).toBe(true);
      expect(templates.some((t) => t.type === 'milestone')).toBe(true);
      expect(templates.some((t) => t.type === 'nda')).toBe(true);
      expect(templates.some((t) => t.type === 'employment')).toBe(true);
      expect(templates.some((t) => t.type === 'licensing')).toBe(true);
    });
  });

  describe('getContractStats', () => {
    it('should return contract statistics', () => {
      generateContract(baseInput);
      generateContract({ ...baseInput, projectId: 'proj-2', type: 'milestone' });

      const stats = getContractStats();
      expect(stats.total).toBeGreaterThanOrEqual(2);
      expect(stats.byType['service']).toBeGreaterThanOrEqual(1);
      expect(stats.byType['milestone']).toBeGreaterThanOrEqual(1);
    });
  });

  describe('amendContract', () => {
    it('should add new clauses to existing contract', () => {
      const contract = generateContract(baseInput);
      const amended = amendContract({
        contractId: contract.id,
        createdBy: 'user-1',
        newClauses: [{ title: 'New Clause', body: 'New content', isRequired: false }],
      });

      expect(amended.currentVersion).toBe(2);
      expect(amended.clauses.length).toBe(contract.clauses.length + 1);
    });

    it('should remove clauses from existing contract', () => {
      const contract = generateContract(baseInput);
      const clauseToRemove = contract.clauses[contract.clauses.length - 1];

      const amended = amendContract({
        contractId: contract.id,
        createdBy: 'user-1',
        removedClauseIds: [clauseToRemove.id],
      });

      expect(amended.clauses.length).toBe(contract.clauses.length - 1);
    });
  });

  describe('getContractDiff', () => {
    it('should show differences between versions', () => {
      const contract = generateContract(baseInput);
      amendContract({
        contractId: contract.id,
        createdBy: 'user-1',
        newClauses: [{ title: 'Added Clause', body: 'Added content', isRequired: false }],
      });

      const diff = getContractDiff(1, 2, contract.id);
      expect(diff.added.length).toBe(1);
      expect(diff.added[0].title).toBe('Added Clause');
    });
  });
});
