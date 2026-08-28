/**
 * category.module.ts — Issue #715
 *
 * Category domain DI module — registers repository, service, and controller.
 */
import type { DIContainer } from '../container.js';

export function registerCategoryModule(c: DIContainer): void {
  c.register(
    'CategoryRepository',
    () => {
      const { CategoryRepository } = require('../../repositories/CategoryRepository.js');
      return new CategoryRepository();
    },
    'singleton'
  );

  c.register(
    'CategoryService',
    (c) => {
      const { CategoryService } = require('../../services/CategoryService.js');
      return new CategoryService(c.get('CategoryRepository'));
    },
    'singleton'
  );

  c.register(
    'CategoryController',
    (c) => {
      const { CategoryController } = require('../../controllers/CategoryController.js');
      return new CategoryController(c.get('CategoryService'));
    },
    'singleton'
  );
}
