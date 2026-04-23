import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface TokenAllowance {
  id: string;
  owner: string;
  spender: string;
  token: string;
  tokenSymbol: string;
  chainId: number;
  chainName: string;
  allowance: string;
  allowanceUsd: number;
  isUnlimited: boolean;
  lastUpdated: Date;
  riskLevel: 'low' | 'medium' | 'high';
  txHash?: string;
  blockNumber?: number;
}

export interface AllowanceSummary {
  totalAllowances: number;
  totalAllowancesUsd: number;
  highRisk: number;
  mediumRisk: number;
  lowRisk: number;
  unlimitedAllowances: number;
}

export interface ApprovalHistoryItem {
  id: string;
  owner: string;
  spender: string;
  token: string;
  tokenSymbol: string;
  chainId: number;
  chainName: string;
  oldAllowance: string;
  newAllowance: string;
  txHash: string;
  timestamp: Date;
  status: 'confirmed' | 'pending' | 'failed';
}

export interface SupportedChain {
  id: number;
  name: string;
}

interface AllowancesState {
  allowances: TokenAllowance[];
  summary: AllowanceSummary | null;
  history: ApprovalHistoryItem[];
  isLoading: boolean;
  error: string | null;
  selectedChainIds: number[];
  setAllowances: (allowances: TokenAllowance[]) => void;
  setSummary: (summary: AllowanceSummary | null) => void;
  setHistory: (history: ApprovalHistoryItem[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSelectedChainIds: (chainIds: number[]) => void;
  fetchAllowances: (owner: string) => Promise<void>;
  fetchHistory: (owner: string, chainIds?: number[]) => Promise<void>;
  approve: (data: ApproveParams) => Promise<TokenAllowance>;
  revoke: (data: RevokeParams) => Promise<void>;
  batchRevoke: (data: BatchRevokeParams) => Promise<BatchRevokeResult>;
  clearAllowances: () => void;
}

interface ApproveParams {
  owner: string;
  spender: string;
  token: string;
  tokenSymbol: string;
  chainId: number;
  amount?: string;
  isUnlimited: boolean;
}

interface RevokeParams {
  owner: string;
  spender: string;
  token: string;
  chainId: number;
}

interface BatchRevokeParams {
  owner: string;
  allowances: { spender: string; token: string; chainId: number }[];
}

interface BatchRevokeResult {
  success: boolean;
  results: { spender: string; token: string; chainId: number; success: boolean; error?: string }[];
  summary: { total: number; successful: number; failed: number };
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export const useAllowancesStore = create<AllowancesState>()(
  persist(
    (set, get) => ({
      allowances: [],
      summary: null,
      history: [],
      isLoading: false,
      error: null,
      selectedChainIds: [],

      setAllowances: (allowances) => set({ allowances }),
      setSummary: (summary) => set({ summary }),
      setHistory: (history) => set({ history }),
      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
      setSelectedChainIds: (selectedChainIds) => set({ selectedChainIds }),

      fetchAllowances: async (owner: string) => {
        set({ isLoading: true, error: null });
        try {
          const { selectedChainIds } = get();
          const chainIdsParam = selectedChainIds.length > 0 ? `&chainIds=${selectedChainIds.join(',')}` : '';
          const response = await fetch(
            `${API_BASE}/api/v1/allowances?owner=${owner}${chainIdsParam}`
          );
          if (!response.ok) {
            throw new Error('Failed to fetch allowances');
          }
          const data = await response.json();
          set({ 
            allowances: data.allowances.map((a: TokenAllowance) => ({
              ...a,
              lastUpdated: new Date(a.lastUpdated),
            })), 
            summary: data.summary,
            isLoading: false 
          });
        } catch (error) {
          set({ error: (error as Error).message, isLoading: false });
        }
      },

      fetchHistory: async (owner: string, chainIds?: number[]) => {
        try {
          const chainIdsParam = chainIds ? `&chainIds=${chainIds.join(',')}` : '';
          const response = await fetch(
            `${API_BASE}/api/v1/allowances/history/${owner}?limit=50${chainIdsParam}`
          );
          if (!response.ok) {
            throw new Error('Failed to fetch history');
          }
          const data = await response.json();
          set({ 
            history: data.history.map((h: ApprovalHistoryItem) => ({
              ...h,
              timestamp: new Date(h.timestamp),
            })) 
          });
        } catch (error) {
          set({ error: (error as Error).message });
        }
      },

      approve: async (data: ApproveParams) => {
        set({ isLoading: true, error: null });
        try {
          const response = await fetch(`${API_BASE}/api/v1/allowances/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Failed to approve');
          }
          const result = await response.json();
          set({ isLoading: false });
          return result.allowance;
        } catch (error) {
          set({ error: (error as Error).message, isLoading: false });
          throw error;
        }
      },

      revoke: async (data: RevokeParams) => {
        set({ isLoading: true, error: null });
        try {
          const response = await fetch(`${API_BASE}/api/v1/allowances/revoke`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Failed to revoke');
          }
          set({ isLoading: false });
        } catch (error) {
          set({ error: (error as Error).message, isLoading: false });
          throw error;
        }
      },

      batchRevoke: async (data: BatchRevokeParams) => {
        set({ isLoading: true, error: null });
        try {
          const response = await fetch(`${API_BASE}/api/v1/allowances/batch-revoke`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Failed to batch revoke');
          }
          const result = await response.json();
          set({ isLoading: false });
          return result;
        } catch (error) {
          set({ error: (error as Error).message, isLoading: false });
          throw error;
        }
      },

      clearAllowances: () => set({ allowances: [], summary: null, history: [] }),
    }),
    {
      name: 'agenticpay-allowances',
      partialize: (state) => ({ selectedChainIds: state.selectedChainIds }),
    }
  )
);