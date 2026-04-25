'use client';

import { useEffect, useCallback, useRef, useState } from 'react';
import { createAsyncLocalStorage } from '@walletconnect/async-storage-binding';
import { buildSafeMath, type UniversalProvider } from '@walletconnect/universal-provider';
import { EIP155 } from '@walletconnect/universal-provider/dist/types';
import { Web3Modal } from '@web3modal/ethers';
import { formatWsUrl, createMessageHash } from '@walletconnect/utils';
import { BrowserProvider, Contract } from 'ethers';
import { mainnet, sepolia } from 'wagmi/chains';
import { http, createConfig } from 'wagmi';
import { useWagmiConfig } from '@/lib/wagmi';

const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '';
const DEFAULT_METADATA = {
  name: 'AgenticPay',
  description: 'AI-powered payment verification',
  url: 'https://agenticpay.com',
  icons: ['https://agenticpay.com/icons/icon-192.png'],
};

const CHAIN_ALIASES: Record<string, number> = {
  eip155: 1,
  'eip155:11155111': 11155111,
  'eip155:10': 10,
  'eip155:42161': 42161,
  'eip155:8453': 8453,
  'eip155:137': 137,
  'eip155:80002': 80002,
};

interface ChainNamespace {
  eip155: {
    methods: string[];
    chains: string[];
    events: string[];
  };
}

interface SessionNamespace {
  accounts: string[];
  methods: string[];
  events: string[];
  chains: string[];
}

interface WalletConnectSession {
  topic: string;
  pairingTopic: string;
  relay: { protocol: string; data?: string };
  expiry: number;
  namespaces: Record<string, SessionNamespace>;
  metadata: typeof DEFAULT_METADATA;
}

interface WalletConnectState {
  provider: UniversalProvider | null;
  sessions: WalletConnectSession[];
  currentSession: WalletConnectSession | null;
  isConnecting: boolean;
  isInitialized: boolean;
}

const initialState: WalletConnectState = {
  provider: null,
  sessions: [],
  currentSession: null,
  isConnecting: false,
  isInitialized: false,
};

const SESSION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'walletconnect_state';

export const wc = {
  async init(options?: { projectId?: string; metadata?: typeof DEFAULT_METADATA }) {
    const projectId = options?.projectId || WALLETCONNECT_PROJECT_ID;
    const metadata = options?.metadata || DEFAULT_METADATA;
    const storage = createAsyncLocalStorage();

    const provider = awaitUniversalProvider.init({
      projectId,
      metadata,
      storage,
    });

    await provider.connect({
      namespaces: {
        eip155: {
          methods: [
            'eth_sendTransaction',
            'eth_sign',
            'personal_sign',
          ],
          chains: ['eip155:1', 'eip155:11155111'],
          events: ['chainChanged', 'accountsChanged'],
        },
      },
    });

    return provider;
  },

  async getSessions(): Promise<WalletConnectSession[]> {
    const storage = createAsyncLocalStorage();
    const stored = await storage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  },

  async persistSession(session: WalletConnectSession) {
    const storage = createAsyncLocalStorage();
    const sessions = await this.getSessions();
    const existing = sessions.findIndex((s) => s.topic === session.topic);

    if (existing >= 0) {
      sessions[existing] = session;
    } else {
      sessions.push(session);
    }

    await storage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  },

  async deleteSession(topic: string) {
    const storage = createAsyncLocalStorage();
    const sessions = (await this.getSessions()).filter((s) => s.topic !== topic);
    await storage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  },

  isSessionValid(session: WalletConnectSession): boolean {
    return session.expiry > Date.now() / 1000;
  },

  calculateExpiry(): number {
    return Math.floor((Date.now() + SESSION_EXPIRY_MS) / 1000);
  },

  async switchChain(chainId: number) {
    const provider = awaitUniversalProvider.getProvider();
    if (!provider) return;

    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${chainId.toString(16)}` }],
    });
  },

  async estimateGas(transaction: { to: string; value?: string; data?: string }) {
    const provider = await BrowserProvider.getBrowserProvider();
    const estimate = await provider.estimateGas(transaction);
    return estimate;
  },

  async signMessage(message: string, address: string) {
    const provider = await BrowserProvider.getBrowserProvider();
    const signature = await provider.signMessage(message, address);
    return signature;
  },

  generateQRCodeUri(topic: string, chainId?: number): string {
    const params = new URLSearchParams({
      bridge: 'https://bridge.walletconnect.org',
      topic,
    });

    if (chainId) {
      params.set('chainId', `eip155:${chainId}`);
    }

    return `wc:${topic}@${params.toString()}`;
  },

  async handleDeepLink(url: string) {
    if (!url) return;

    const match = url.match(/wc:([a-z0-9-]+)/);
    if (match) {
      const topic = match[1];
      return topic;
    }
    return null;
  },

  getEventSubscriber(provider: UniversalProvider) {
    return {
      on(event: string, callback: (params: unknown) => void) {
        provider.on(event, callback);
      },
      off(event: string, callback: (params: unknown) => void) {
        provider.off(event, callback);
      },
    };
  },
};

export const walletConnect = {
  async init() {
    'use client';
    const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '';
    
    if (!projectId) {
      console.warn('WalletConnect project ID not configured');
      return null;
    }

    try {
      const { UniversalProvider } = await import('@walletconnect/universal-provider');
      
      const provider = await UniversalProvider.init({
        projectId,
        metadata: DEFAULT_METADATA,
      });

      return provider;
    } catch (error) {
      console.error('Failed to init WalletConnect:', error);
      return null;
    }
  },

  async connect(
    provider: UniversalProvider,
    chains: string[] = ['eip155:1', 'eip155:11155111']
  ) {
    const namespaces: Record<string, { methods: string[]; chains: string[]; events: string[] }> = {};

    chains.forEach((chain) => {
      namespaces[chain.split(':')[0]] = {
        methods: ['eth_sendTransaction', 'eth_sign', 'personal_sign'],
        chains: chains.filter((c) => c.startsWith(chain.split(':')[0])),
        events: ['chainChanged', 'accountsChanged'],
      };
    });

    try {
      const session = await provider.connect({ namespaces });
      return session;
    } catch (error) {
      console.error('WalletConnect connection failed:', error);
      throw error;
    }
  },

  async disconnect(provider: UniversalProvider) {
    if (provider) {
      await provider.disconnect();
    }
  },

  async switchChain(provider: UniversalProvider, chainId: number) {
    const chainHex = `0x${chainId.toString(16)}`;
    
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainHex }],
      });
    } catch (switchError: unknown) {
      const error = switchError as { code?: number; message?: string };
      if (error.code === 4902) {
        throw new Error('Chain not added to wallet');
      }
      throw switchError;
    }
  },

  getSupportedChains() {
    return [
      { id: 1, name: 'Ethereum', symbol: 'ETH', namespace: 'eip155' },
      { id: 11155111, name: 'Sepolia', symbol: 'ETH', namespace: 'eip155' },
      { id: 10, name: 'Optimism', symbol: 'ETH', namespace: 'eip155' },
      { id: 42161, name: 'Arbitrum', symbol: 'ETH', namespace: 'eip155' },
      { id: 8453, name: 'Base', symbol: 'ETH', namespace: 'eip155' },
      { id: 137, name: 'Polygon', symbol: 'MATIC', namespace: 'eip155' },
    ];
  },
};