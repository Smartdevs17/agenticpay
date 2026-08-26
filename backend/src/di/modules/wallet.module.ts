/**
 * wallet.module.ts — Issue #597
 *
 * Wallet domain DI module — registers controller and service.
 */
import type { DIContainer } from '../container.js';

export function registerWalletModule(c: DIContainer): void {
  c.register(
    'WalletAggregationService',
    () => {
      const { WalletAggregationService } = require('../../services/walletAggregation.js');
      return WalletAggregationService;
    },
    'singleton',
  );

  c.register(
    'WalletController',
    (c) => {
      const { WalletController } = require('../../controllers/WalletController.js');
      return new WalletController(c.get('WalletAggregationService'));
    },
    'singleton',
  );
}
