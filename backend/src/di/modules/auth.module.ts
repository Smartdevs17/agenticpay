/**
 * Auth domain module — registers lockout manager and audit service.
 */
import type { DIContainer } from '../container.js';

export function registerAuthModule(c: DIContainer): void {
  c.register(
    'LockoutManager',
    () => {
      const { LockoutManager } = require('../../services/auth/lockout-manager.js');
      return new LockoutManager();
    },
    'singleton'
  );

  c.register(
    'AuditService',
    () => {
      const { auditService } = require('../../services/auditService.js');
      return auditService;
    },
    'singleton'
  );
}
