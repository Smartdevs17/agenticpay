/**
 * compliance.module.ts — Issue #597
 *
 * Compliance domain DI module — registers controller, service, and repositories.
 */
import type { DIContainer } from '../container.js';

export function registerComplianceModule(c: DIContainer): void {
  c.register(
    'ComplianceAlertRepository',
    () => {
      const { ComplianceAlertRepository } = require('../../repositories/ComplianceRepository.js');
      return new ComplianceAlertRepository();
    },
    'singleton',
  );

  c.register(
    'ComplianceReportRepository',
    () => {
      const { ComplianceReportRepository } = require('../../repositories/ComplianceRepository.js');
      return new ComplianceReportRepository();
    },
    'singleton',
  );

  c.register(
    'AuditTrailRepository',
    () => {
      const { AuditTrailRepository } = require('../../repositories/ComplianceRepository.js');
      return new AuditTrailRepository();
    },
    'singleton',
  );

  c.register(
    'ComplianceService',
    () => {
      const { ComplianceService } = require('../../services/complianceService.js');
      return ComplianceService;
    },
    'singleton',
  );

  c.register(
    'ComplianceController',
    (c) => {
      const { ComplianceController } = require('../../controllers/ComplianceController.js');
      return new ComplianceController(c.get('ComplianceService'));
    },
    'singleton',
  );
}
