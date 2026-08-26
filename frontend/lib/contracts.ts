import { Abi } from 'viem';
import { type EvmChain, loadAbi, preloadAbi } from '@/lib/contracts/abi-loader';
import { type SupportedChain, getChainConfig } from '@/lib/contracts/chain-config';

export const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`;

let cachedAbi: Abi | null = null;

export async function getContractAbi(chain?: SupportedChain): Promise<Abi> {
  if (cachedAbi) return cachedAbi;
  const abi = await loadAbi((chain || 'mainnet') as EvmChain, 'AgentPay');
  cachedAbi = abi;
  return abi;
}

export function preloadContractAbi(chain?: SupportedChain): void {
  preloadAbi((chain || 'mainnet') as EvmChain, 'AgentPay');
}

export const CONTRACT_ABI = new Proxy<Abi>({} as Abi, {
  get(_, prop) {
    void getContractAbi().then((abi) => {
      if (prop in abi) return Reflect.get(abi, prop);
    });
    return undefined;
  },
});
