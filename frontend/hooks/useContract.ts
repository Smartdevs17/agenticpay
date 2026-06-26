'use client';

import { useState, useEffect, useCallback } from 'react';
import { Abi } from 'viem';
import { loadAbi, type EvmChain } from '@/lib/contracts/abi-loader';
import { getChainConfig, type SupportedChain } from '@/lib/contracts/chain-config';
import { useWeb3Store, selectChainId } from '@/store/web3Store';

interface UseContractResult {
  abi: Abi | null;
  isLoading: boolean;
  error: Error | null;
  chainConfig: ReturnType<typeof getChainConfig> | null;
  retry: () => void;
}

const chainIdToSupported: Record<number, SupportedChain> = {
  1: 'mainnet',
  11155111: 'sepolia',
  137: 'polygon',
  42161: 'arbitrum',
  10: 'optimism',
  8453: 'base',
};

export function useContract(contractName: string): UseContractResult {
  const chainId = useWeb3Store(selectChainId);
  const [abi, setAbi] = useState<Abi | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const chain = chainId != null ? (chainIdToSupported[chainId] ?? null) : null;
  const chainConfig = chain ? getChainConfig(chain) : null;

  const load = useCallback(async () => {
    if (!chain) {
      setAbi(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await loadAbi(chain as EvmChain, contractName);
      setAbi(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load ABI'));
    } finally {
      setIsLoading(false);
    }
  }, [chain, contractName]);

  useEffect(() => {
    load();
  }, [load, retryCount]);

  const retry = useCallback(() => {
    setRetryCount((c) => c + 1);
  }, []);

  return { abi, isLoading, error, chainConfig, retry };
}

export function useEvmContract(contractName: string, chainOverride?: SupportedChain): UseContractResult {
  const chainId = useWeb3Store(selectChainId);
  const [abi, setAbi] = useState<Abi | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const resolvedChain = chainOverride ?? (chainId != null ? (chainIdToSupported[chainId] ?? null) : null);
  const chainConfig = resolvedChain ? getChainConfig(resolvedChain) : null;

  const load = useCallback(async () => {
    if (!resolvedChain) {
      setAbi(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await loadAbi(resolvedChain as EvmChain, contractName);
      setAbi(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load ABI'));
    } finally {
      setIsLoading(false);
    }
  }, [resolvedChain, contractName]);

  useEffect(() => {
    load();
  }, [load, retryCount]);

  const retry = useCallback(() => {
    setRetryCount((c) => c + 1);
  }, []);

  return { abi, isLoading, error, chainConfig, retry };
}
