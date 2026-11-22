import { describe, it, expect, beforeEach, vi } from 'vitest';

const { info, warn } = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({ logger: { info, warn, error: vi.fn() } }));

import {
  generateContract,
  generateContractFromTemplate,
  listProjectConfigTemplates,
  getProjectConfigTemplate,
  amendContract,
  getContractDiff,
  resetContracts,
  ContractTemplateError,
  type GenerateContractInput,
} from '../contracts.js';
import { CONTRACT_TEMPLATES, PROJECT_CONFIG_TEMPLATES } from '../../templates/contracts.js';

const parties = {
  projectId: 'proj-1',
  clientId: 'client-1',
  freelancerId: 'freelancer-1',
  createdBy: 'user-1',
};

describe('contract generation from project config templates', () => {
  beforeEach(() => {
    resetContracts();
    info.mockClear();
    warn.mockClear();
  });

  describe('template catalogue', () => {
    it('lists every project config template', () => {
      const ids = listProjectConfigTemplates().map((t) => t.id);
      expect(ids).toEqual(Object.keys(PROJECT_CONFIG_TEMPLATES));
    });

    it('points every template at a known contract type', () => {
      for (const template of listProjectConfigTemplates()) {
        expect(CONTRACT_TEMPLATES[template.contractType]).toBeDefined();
      }
    });

    it('returns undefined for unknown or inherited ids', () => {
      expect(getProjectConfigTemplate('nope')).toBeUndefined();
      expect(getProjectConfigTemplate('toString')).toBeUndefined();
    });
  });

  describe('generateContractFromTemplate', () => {
    it('merges template defaults under caller overrides', () => {
      const contract = generateContractFromTemplate({
        ...parties,
        templateId: 'fixed-price-build',
        overrides: {
          name: 'Landing page',
          scope: 'Design and build a marketing site',
          budget: 4000,
          currency: 'USDC',
          clientName: 'Acme',
          freelancerName: 'Ada',
          terminationNoticeDays: 7,
        },
      });

      expect(contract.type).toBe('service');
      expect(contract.title).toBe('Service Agreement — Landing page');
      expect(contract.metadata.templateId).toBe('fixed-price-build');

      const payment = contract.clauses.find((c) => c.title === 'Payment Terms');
      expect(payment?.body).toContain('50% on signing and 50% on final delivery');
      expect(payment?.body).toContain('4000 USDC');

      const termination = contract.clauses.find((c) => c.title === 'Termination');
      expect(termination?.body).toContain('7 days');

      // sourceCodeIP default switches on the conditional clause
      expect(contract.clauses.some((c) => c.title === 'Source Code Ownership')).toBe(true);
      expect(contract.metadata.unresolvedPlaceholders).toEqual([]);
    });

    it('builds a milestone agreement listing each milestone', () => {
      const contract = generateContractFromTemplate({
        ...parties,
        templateId: 'milestone-delivery',
        overrides: {
          name: 'Mobile app',
          scope: 'iOS and Android client',
          budget: 9000,
          currency: 'USD',
          milestones: [{ title: 'Design' }, { title: 'Build' }, { title: 'Launch' }],
        },
      });

      const milestones = contract.clauses.find((c) => c.title === 'Milestones');
      expect(milestones?.body).toContain('3 milestones: 1. Design, 2. Build, 3. Launch');
      expect(contract.metadata.milestoneCount).toBe(3);
    });

    it('fills snake_case placeholders from camelCase config keys', () => {
      const contract = generateContractFromTemplate({
        ...parties,
        templateId: 'software-license',
        overrides: {
          softwareName: 'SuperTool',
          licensorName: 'Software Inc',
          licenseeName: 'Client Corp',
          licenseFee: 5000,
          currency: 'EUR',
        },
      });

      const grant = contract.clauses.find((c) => c.title === 'License Grant');
      expect(grant?.body).toBe(
        'Licensor grants Licensee a non-exclusive license to use "SuperTool" for 12 months.',
      );
      expect(contract.metadata.unresolvedPlaceholders).toEqual([]);
    });

    it('lets a template default override a built in context default', () => {
      const contract = generateContractFromTemplate({
        ...parties,
        templateId: 'mutual-nda',
        overrides: { name: 'Stealth project', clientName: 'Acme', freelancerName: 'Ada' },
      });

      const term = contract.clauses.find((c) => c.title === 'Term');
      expect(term?.body).toContain('2 years');
    });

    it('reports every missing required field', () => {
      try {
        generateContractFromTemplate({ ...parties, templateId: 'milestone-delivery', overrides: { name: 'X' } });
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ContractTemplateError);
        expect((error as ContractTemplateError).missingFields).toEqual(['scope', 'budget', 'currency', 'milestones']);
      }
    });

    it('treats empty strings and empty lists as missing', () => {
      expect(() =>
        generateContractFromTemplate({
          ...parties,
          templateId: 'mutual-nda',
          overrides: { name: '', clientName: 'Acme', freelancerName: 'Ada' },
        }),
      ).toThrow(/name/);
    });

    it('rejects an unknown template id', () => {
      expect(() => generateContractFromTemplate({ ...parties, templateId: 'missing' })).toThrow(
        /Unknown project config template/,
      );
    });

    it('rejects missing parties', () => {
      expect(() =>
        generateContractFromTemplate({
          ...parties,
          clientId: '',
          templateId: 'mutual-nda',
          overrides: { name: 'P', clientName: 'Acme', freelancerName: 'Ada' },
        }),
      ).toThrow(/clientId is required/);
    });

    it('logs each generated contract', () => {
      const contract = generateContractFromTemplate({
        ...parties,
        templateId: 'mutual-nda',
        overrides: { name: 'P', clientName: 'Acme', freelancerName: 'Ada' },
      });
      expect(info).toHaveBeenCalledWith(
        '[contracts] generated',
        expect.objectContaining({ contractId: contract.id, templateId: 'mutual-nda', type: 'nda' }),
      );
    });
  });

  describe('unresolved placeholders', () => {
    it('records and warns about placeholders the config did not fill', () => {
      const input: GenerateContractInput = {
        ...parties,
        type: 'employment',
        projectConfig: { name: 'Hire', milestones: [], companyName: 'Acme' },
      };

      const contract = generateContract(input);
      expect(contract.metadata.unresolvedPlaceholders).toContain('employee_name');
      expect(contract.metadata.unresolvedPlaceholders).not.toContain('company_name');
      expect(warn).toHaveBeenCalledWith(
        '[contracts] unresolved placeholders',
        expect.objectContaining({ contractId: contract.id }),
      );
    });
  });

  describe('versioning', () => {
    it('numbers each amendment as a new version so diffs resolve', () => {
      const contract = generateContractFromTemplate({
        ...parties,
        templateId: 'mutual-nda',
        overrides: { name: 'P', clientName: 'Acme', freelancerName: 'Ada' },
      });
      amendContract({
        contractId: contract.id,
        createdBy: 'user-1',
        newClauses: [{ title: 'Governing Law', body: 'Laws of England and Wales.' }],
      });

      expect(contract.versions.map((v) => v.version)).toEqual([1, 2]);
      expect(getContractDiff(1, 2, contract.id).added.map((c) => c.title)).toEqual(['Governing Law']);
    });
  });
});
