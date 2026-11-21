/**
 * Project domain module — registers repository, service, and controller.
 */
import type { DIContainer } from '../container.js';

export function registerProjectModule(c: DIContainer): void {
  c.register(
    'ProjectRepository',
    () => {
      const { ProjectRepository } = require('../../repositories/ProjectRepository.js');
      return new ProjectRepository();
    },
    'singleton'
  );

  c.register(
    'ProjectService',
    (c) => {
      const { ProjectService } = require('../../services/ProjectService.js');
      return new ProjectService(c.get('ProjectRepository'));
    },
    'singleton'
  );

  c.register(
    'ProjectController',
    (c) => {
      const { ProjectController } = require('../../controllers/ProjectController.js');
      return new ProjectController(c.get('ProjectService'));
    },
    'singleton'
  );
}
