import { Abi } from 'viem';
import AgentPay from './abi/AgentPay.json';

export const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`;
export const CONTRACT_ABI = AgentPay.abi as unknown as Abi;
