'use client';

import { create } from 'zustand';
import { devtools, persist, subscribeWithSelector, createJSONStorage } from 'zustand/middleware';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProviderType = 'injected' | 'walletconnect' | 'web3auth' | null;
export type TxStatus = 'pending' | 'confirmed' | 'failed';
export type SupportedChain = 'stellar' | 'ethereum' | 'polygon' | 'base' | 'arbitrum' | 'optimism';

export interface ChainBalance {
  chainType: SupportedChain;
  chainId: string;
  address: string;
  nativeBalance: string;
  nativeBalanceUSD: number;
  tokens: Array<{
    assetCode: string;
    balance: string;
    balanceUSD: number;
    decimals: number;
  }>;
  lastUpdated: string;
}

export interface AggregatedWalletState {
  totalUSD: number;
  chains: ChainBalance[];
  lastUpdated: string;
  isLoading: boolean;
  error: string | null;
}

export interface ConnectedWallet {
  id: string;
  chainType: SupportedChain;
  address: string;
  providerName: string;
  isActive: boolean;
}

export interface TransactionRecord {
  hash: string;
  status: TxStatus;
  description?: string;
  timestamp: number;
  chainId: number;
  from?: string;
  to?: string;
  value?: string;
}

interface Web3State {
  account: `0x${string}` | null;
  chainId: number | null;
  isConnected: boolean;
  isConnecting: boolean;
  isReconnecting: boolean;
  providerType: ProviderType;
  connectionError: string | null;
  transactions: TransactionRecord[];

  // ── Multi-chain state (Issue #593) ──────────────────────────────────────────
  connectedWallets: ConnectedWallet[];
  aggregatedBalance: AggregatedWalletState;
  activeChain: SupportedChain | null;
}

interface Web3Actions {
  setAccount: (account: `0x${string}` | null) => void;
  setChainId: (chainId: number | null) => void;
  setConnecting: (v: boolean) => void;
  setReconnecting: (v: boolean) => void;
  setConnected: (account: `0x${string}`, chainId: number, providerType: ProviderType) => void;
  setConnectionError: (error: string | null) => void;
  disconnect: () => void;
  addTransaction: (tx: Omit<TransactionRecord, 'timestamp'>) => void;
  updateTransaction: (hash: string, status: TxStatus) => void;
  clearTransactions: () => void;

  // ── Multi-chain actions (Issue #593) ────────────────────────────────────────
  addWallet: (wallet: ConnectedWallet) => void;
  removeWallet: (walletId: string) => void;
  setActiveChain: (chain: SupportedChain | null) => void;
  setAggregatedBalance: (balance: AggregatedWalletState) => void;
  fetchAggregatedBalance: (userId: string) => Promise<void>;
}

export type Web3Store = Web3State & Web3Actions;

// Persisted slice — only serialisable fields
type PersistedWeb3 = Pick<
  Web3State,
  'account' | 'chainId' | 'providerType' | 'isConnected' | 'transactions' | 'connectedWallets' | 'activeChain'
>;

// ─── Lightweight XOR-based storage encryption ─────────────────────────────────
// Obfuscates persisted data from casual localStorage inspection.

const CIPHER_KEY = 'agenticpay-w3-2024';

function xorCipher(str: string): string {
  return str
    .split('')
    .map((ch, i) =>
      String.fromCharCode(ch.charCodeAt(0) ^ CIPHER_KEY.charCodeAt(i % CIPHER_KEY.length))
    )
    .join('');
}

const encryptedStorage = createJSONStorage<PersistedWeb3>(() => ({
  getItem: (name: string): string | null => {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(name);
    if (!raw) return null;
    try {
      return xorCipher(atob(raw));
    } catch {
      // Fallback: return raw so an unencrypted legacy value still hydrates
      return raw;
    }
  },
  setItem: (name: string, value: string): void => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(name, btoa(xorCipher(value)));
  },
  removeItem: (name: string): void => {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(name);
  },
}));

// ─── BroadcastChannel cross-tab sync ─────────────────────────────────────────

type SyncMessage =
  | { type: 'CONNECTED'; account: string; chainId: number; providerType: ProviderType }
  | { type: 'DISCONNECTED' }
  | { type: 'CHAIN_CHANGED'; chainId: number }
  | { type: 'TX_UPDATE'; hash: string; status: TxStatus };

let _channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return null;
  if (!_channel) _channel = new BroadcastChannel('agenticpay-web3-sync');
  return _channel;
}

function broadcast(msg: SyncMessage): void {
  try {
    getChannel()?.postMessage(msg);
  } catch {
    // Private mode or iframe isolation — fail silently
  }
}

// ─── Initial state ────────────────────────────────────────────────────────────

const INITIAL_STATE: Web3State = {
  account: null,
  chainId: null,
  isConnected: false,
  isConnecting: false,
  isReconnecting: false,
  providerType: null,
  connectionError: null,
  transactions: [],

  // Multi-chain (Issue #593)
  connectedWallets: [],
  activeChain: null,
  aggregatedBalance: {
    totalUSD: 0,
    chains: [],
    lastUpdated: '',
    isLoading: false,
    error: null,
  },
};

// ─── Store ────────────────────────────────────────────────────────────────────

export const useWeb3Store = create<Web3Store>()(
  devtools(
    subscribeWithSelector(
      persist(
        (set) => ({
          ...INITIAL_STATE,

          setAccount: (account) =>
            set({ account }, false, 'web3/setAccount'),

          setChainId: (chainId) => {
            set({ chainId }, false, 'web3/setChainId');
            if (chainId !== null) broadcast({ type: 'CHAIN_CHANGED', chainId });
          },

          setConnecting: (isConnecting) =>
            set({ isConnecting }, false, 'web3/setConnecting'),

          setReconnecting: (isReconnecting) =>
            set({ isReconnecting }, false, 'web3/setReconnecting'),

          setConnected: (account, chainId, providerType) => {
            set(
              { account, chainId, providerType, isConnected: true, isConnecting: false, connectionError: null },
              false,
              'web3/setConnected'
            );
            broadcast({ type: 'CONNECTED', account, chainId, providerType });
          },

          setConnectionError: (connectionError) =>
            set({ connectionError, isConnecting: false }, false, 'web3/setConnectionError'),

          disconnect: () => {
            set({ ...INITIAL_STATE }, false, 'web3/disconnect');
            broadcast({ type: 'DISCONNECTED' });
          },

          addTransaction: (tx) =>
            set(
              (state) => ({
                transactions: [{ ...tx, timestamp: Date.now() }, ...state.transactions].slice(0, 50),
              }),
              false,
              'web3/addTransaction'
            ),

          updateTransaction: (hash, status) => {
            set(
              (state) => ({
                transactions: state.transactions.map((tx) =>
                  tx.hash === hash ? { ...tx, status } : tx
                ),
              }),
              false,
              'web3/updateTransaction'
            );
            broadcast({ type: 'TX_UPDATE', hash, status });
          },

          clearTransactions: () =>
            set({ transactions: [] }, false, 'web3/clearTransactions'),

          // ── Multi-chain actions (Issue #593) ──────────────────────────────────

          addWallet: (wallet) =>
            set(
              (state) => ({
                connectedWallets: [
                  ...state.connectedWallets.filter((w) => w.id !== wallet.id),
                  wallet,
                ],
              }),
              false,
              'web3/addWallet',
            ),

          removeWallet: (walletId) =>
            set(
              (state) => ({
                connectedWallets: state.connectedWallets.filter((w) => w.id !== walletId),
              }),
              false,
              'web3/removeWallet',
            ),

          setActiveChain: (chain) =>
            set({ activeChain: chain }, false, 'web3/setActiveChain'),

          setAggregatedBalance: (balance) =>
            set({ aggregatedBalance: balance }, false, 'web3/setAggregatedBalance'),

          fetchAggregatedBalance: async (userId: string) => {
            set(
              (state) => ({
                aggregatedBalance: { ...state.aggregatedBalance, isLoading: true, error: null },
              }),
              false,
              'web3/fetchAggregatedBalance/start',
            );
            try {
              const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
              const res = await fetch(`${apiBase}/wallet/aggregated?userId=${userId}`);
              if (!res.ok) throw new Error(`API error: ${res.status}`);
              const data = await res.json();
              set(
                {
                  aggregatedBalance: {
                    ...data.data,
                    isLoading: false,
                    error: null,
                  },
                },
                false,
                'web3/fetchAggregatedBalance/success',
              );
            } catch (err) {
              set(
                (state) => ({
                  aggregatedBalance: {
                    ...state.aggregatedBalance,
                    isLoading: false,
                    error: err instanceof Error ? err.message : 'Failed to fetch balances',
                  },
                }),
                false,
                'web3/fetchAggregatedBalance/error',
              );
            }
          },
        }),
        {
          name: 'agenticpay-web3',
          storage: encryptedStorage,
          // Only persist serialisable, non-sensitive connection markers
          partialize: (state): PersistedWeb3 => ({
            account: state.account,
            chainId: state.chainId,
            providerType: state.providerType,
            isConnected: state.isConnected,
            transactions: state.transactions,
            connectedWallets: state.connectedWallets,
            activeChain: state.activeChain,
          }),
        }
      )
    ),
    {
      name: 'AgenticPay/Web3',
      enabled: process.env.NODE_ENV === 'development',
    }
  )
);

// ─── Cross-tab message handler ────────────────────────────────────────────────
// Uses setState directly (not actions) to avoid re-broadcasting.

if (typeof window !== 'undefined') {
  const ch = getChannel();
  if (ch) {
    ch.onmessage = (event: MessageEvent<SyncMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'CONNECTED':
          useWeb3Store.setState(
            {
              account: msg.account as `0x${string}`,
              chainId: msg.chainId,
              providerType: msg.providerType,
              isConnected: true,
              isConnecting: false,
              connectionError: null,
            },
            false
          );
          break;
        case 'DISCONNECTED':
          useWeb3Store.setState({ ...INITIAL_STATE }, false);
          break;
        case 'CHAIN_CHANGED':
          useWeb3Store.setState({ chainId: msg.chainId }, false);
          break;
        case 'TX_UPDATE':
          useWeb3Store.setState(
            (state) => ({
              transactions: state.transactions.map((tx) =>
                tx.hash === msg.hash ? { ...tx, status: msg.status } : tx
              ),
            }),
            false
          );
          break;
      }
    };
  }
}

// ─── Type-safe selectors ──────────────────────────────────────────────────────

export const selectAccount = (s: Web3Store) => s.account;
export const selectChainId = (s: Web3Store) => s.chainId;
export const selectIsConnected = (s: Web3Store) => s.isConnected;
export const selectIsConnecting = (s: Web3Store) => s.isConnecting;
export const selectIsReconnecting = (s: Web3Store) => s.isReconnecting;
export const selectProviderType = (s: Web3Store) => s.providerType;
export const selectConnectionError = (s: Web3Store) => s.connectionError;
export const selectTransactions = (s: Web3Store) => s.transactions;
export const selectPendingTxs = (s: Web3Store) =>
  s.transactions.filter((tx) => tx.status === 'pending');
export const selectConfirmedTxs = (s: Web3Store) =>
  s.transactions.filter((tx) => tx.status === 'confirmed');
export const selectFailedTxs = (s: Web3Store) =>
  s.transactions.filter((tx) => tx.status === 'failed');
