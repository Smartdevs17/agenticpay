'use client';

import { useEffect } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { useShallow } from 'zustand/react/shallow';
import {
  useWeb3Store,
  selectAccount,
  selectChainId,
  selectIsConnected,
  selectIsConnecting,
  selectIsReconnecting,
  selectProviderType,
  selectConnectionError,
  selectPendingTxs,
  type ProviderType,
  type TxStatus,
  type TransactionRecord,
} from '@/store/web3Store';

// ─── Auto-reconnect + wagmi sync ──────────────────────────────────────────────

/**
 * Syncs wagmi's live connection state into the Zustand Web3 store.
 * Auto-reconnection is handled by wagmi (ssr: true in wagmiConfig) — this hook
 * keeps the store consistent once wagmi resolves the reconnect attempt.
 *
 * Mount exactly once inside <WagmiProvider> via <Web3StoreProvider>.
 */
export function useWeb3Sync(): void {
  const { address, isConnected, isConnecting, isReconnecting } = useAccount();
  const chainId = useChainId();
  const { setConnected, setConnecting, setReconnecting, disconnect } = useWeb3Store();

  useEffect(() => {
    setConnecting(isConnecting);
  }, [isConnecting, setConnecting]);

  useEffect(() => {
    setReconnecting(isReconnecting);
  }, [isReconnecting, setReconnecting]);

  useEffect(() => {
    if (isConnected && address) {
      setConnected(address, chainId ?? 1, 'injected' as ProviderType);
    } else if (!isConnected && !isConnecting && !isReconnecting) {
      disconnect();
    }
  }, [isConnected, address, chainId, isConnecting, isReconnecting, setConnected, disconnect]);
}

// ─── Network change subscriber ────────────────────────────────────────────────

/**
 * Subscribes to chainId changes in the Web3 store.
 * Works outside React (no hook rules). Returns an unsubscribe function.
 *
 * @example
 * const unsub = subscribeToNetworkChange((chainId) => {
 *   if (chainId === 11155111) console.log('switched to Sepolia');
 * });
 * // later: unsub();
 */
export function subscribeToNetworkChange(
  handler: (chainId: number | null, prevChainId: number | null) => void
): () => void {
  return useWeb3Store.subscribe(selectChainId, handler);
}

/**
 * Subscribes to account changes in the Web3 store.
 * Works outside React (no hook rules). Returns an unsubscribe function.
 */
export function subscribeToAccountChange(
  handler: (account: `0x${string}` | null, prev: `0x${string}` | null) => void
): () => void {
  return useWeb3Store.subscribe(selectAccount, handler);
}

/**
 * Subscribes to connection status changes.
 */
export function subscribeToConnectionChange(
  handler: (isConnected: boolean, prev: boolean) => void
): () => void {
  return useWeb3Store.subscribe(selectIsConnected, handler);
}

// ─── React hook for Web3 state ────────────────────────────────────────────────

interface Web3HookResult {
  account: `0x${string}` | null;
  chainId: number | null;
  isConnected: boolean;
  isConnecting: boolean;
  isReconnecting: boolean;
  providerType: ProviderType;
  connectionError: string | null;
  pendingTransactions: TransactionRecord[];
  addTransaction: (tx: Omit<TransactionRecord, 'timestamp'>) => void;
  updateTransaction: (hash: string, status: TxStatus) => void;
  clearTransactions: () => void;
}

/**
 * Convenience hook. Re-renders only when selected fields change (shallow equality).
 */
export function useWeb3(): Web3HookResult {
  const state = useWeb3Store(
    useShallow((s) => ({
      account: s.account,
      chainId: s.chainId,
      isConnected: s.isConnected,
      isConnecting: s.isConnecting,
      isReconnecting: s.isReconnecting,
      providerType: s.providerType,
      connectionError: s.connectionError,
    }))
  );

  const pendingTransactions = useWeb3Store(selectPendingTxs);
  const addTransaction = useWeb3Store((s) => s.addTransaction);
  const updateTransaction = useWeb3Store((s) => s.updateTransaction);
  const clearTransactions = useWeb3Store((s) => s.clearTransactions);

  return { ...state, pendingTransactions, addTransaction, updateTransaction, clearTransactions };
}

// ─── Network change hook (React) ──────────────────────────────────────────────

/**
 * React hook that fires a callback whenever the connected chain changes.
 *
 * @example
 * useNetworkChangeEffect((chainId) => {
 *   toast(`Switched to chain ${chainId}`);
 * });
 */
export function useNetworkChangeEffect(
  handler: (chainId: number | null) => void
): void {
  useEffect(() => {
    const unsub = subscribeToNetworkChange(handler);
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// ─── Transaction queue hook ───────────────────────────────────────────────────

interface TransactionQueueResult {
  transactions: TransactionRecord[];
  pendingCount: number;
  addTransaction: (tx: Omit<TransactionRecord, 'timestamp'>) => void;
  updateTransaction: (hash: string, status: TxStatus) => void;
  clearTransactions: () => void;
}

/**
 * Hook scoped to the transaction queue slice — components that only care about
 * transactions won't re-render on account/chain changes.
 */
export function useTransactionQueue(): TransactionQueueResult {
  const transactions = useWeb3Store((s) => s.transactions);
  const addTransaction = useWeb3Store((s) => s.addTransaction);
  const updateTransaction = useWeb3Store((s) => s.updateTransaction);
  const clearTransactions = useWeb3Store((s) => s.clearTransactions);

  return {
    transactions,
    pendingCount: transactions.filter((tx) => tx.status === 'pending').length,
    addTransaction,
    updateTransaction,
    clearTransactions,
  };
}
