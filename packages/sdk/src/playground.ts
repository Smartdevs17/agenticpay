import type { AgenticPaySDK } from './index.js';
import { SandboxApi } from './sandbox.js';

export interface PlaygroundExample {
  id: string;
  title: string;
  description: string;
  run: (sdk: AgenticPaySDK, args: string[]) => Promise<unknown>;
}

export const PLAYGROUND_EXAMPLES: PlaygroundExample[] = [
  {
    id: 'sandbox-status',
    title: 'Sandbox status',
    description: 'Check whether the sandbox environment is healthy.',
    run: (sdk) => new SandboxApi(sdk.client).getStatus(),
  },
  {
    id: 'refund-policy',
    title: 'Refund policy',
    description: 'Fetch the refund policy for a merchant. Args: <merchantId>.',
    run: (sdk, args) => sdk.refunds.getPolicy(requireArg(args, 0, 'merchantId')),
  },
  {
    id: 'merchant-splits',
    title: 'Merchant splits',
    description: 'List payment split configs for a merchant. Args: <merchantId>.',
    run: (sdk, args) => sdk.payments.listMerchantSplits(requireArg(args, 0, 'merchantId')),
  },
  {
    id: 'verification',
    title: 'Get verification',
    description: 'Fetch a work verification by id. Args: <verificationId>.',
    run: (sdk, args) => sdk.verification.getVerification(requireArg(args, 0, 'verificationId')),
  },
];

export function getPlaygroundExample(id: string): PlaygroundExample {
  const example = PLAYGROUND_EXAMPLES.find((item) => item.id === id);
  if (!example) {
    throw new Error(`Unknown playground example '${id}'. Available: ${PLAYGROUND_EXAMPLES.map((item) => item.id).join(', ')}`);
  }
  return example;
}

function requireArg(args: string[], index: number, name: string): string {
  const value = args[index];
  if (!value) {
    throw new Error(`Missing required argument '${name}'`);
  }
  return value;
}
