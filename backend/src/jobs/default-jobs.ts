import { ethers } from 'ethers';
import type { JobDefinition } from './types.js';
import { SubscriptionProcessor } from './subscription-processor';
import { SubscriptionService } from './subscription.service.js';

export const defaultJobs: JobDefinition[] = [
  {
    id: 'system-heartbeat',
    name: 'System heartbeat log',
    schedule: { type: 'cron', expression: '*/5 * * * *' },
    handler: () => {
      console.log('[jobs] heartbeat', new Date().toISOString());
    },
  },
  {
    id: 'subscription-renewal-processor',
    name: 'Process Recurring Payments',
    // Run every hour to check for due subscriptions
    schedule: { type: 'cron', expression: '0 * * * *' },
    handler: async () => {
      const contractAddress = process.env.SUBSCRIPTION_CONTRACT_ADDRESS;
      const rpcUrl = process.env.EVM_RPC_URL;
      const privateKey = process.env.STELLAR_SECRET_KEY; // Reusing for EVM signer if applicable

      if (!contractAddress || !rpcUrl || !privateKey) {
        console.error('[jobs] Subscription processor missing environment variables');
        return;
      }

      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const signer = new ethers.Wallet(privateKey, provider);
      
      // Minimal ABI for the processor to execute payments
      const abi = ["function executePayment(address customer, uint256 planId) external"];
      const service = new SubscriptionService(contractAddress, abi, signer);
      const processor = new SubscriptionProcessor(service); 
      await processor.processPendingRenewals();
    },
  },
];
