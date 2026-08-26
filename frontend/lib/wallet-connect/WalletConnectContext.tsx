'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { createWeb3Modal, defaultConfig } from '@web3modal/ethers/react';

interface ChainInfo {
  id: number;
  name: string;
  icon?: string;
}

const CHAINS: ChainInfo[] = [
  { id: 1, name: 'Ethereum' },
  { id: 137, name: 'Polygon' },
  { id: 56, name: 'BSC' },
  { id: 42161, name: 'Arbitrum' },
  { id: 10, name: 'Optimism' },
  { id: 8453, name: 'Base' },
];

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo-project-id';

const metadata = {
  name: 'AgenticPay',
  description: 'Decentralized payment platform',
  url: typeof window !== 'undefined' ? window.location.origin : 'https://agenticpay.com',
  icons: ['https://agenticpay.com/icon.png'],
};

export interface WalletConnectState {
  address: string | null;
  chainId: number | null;
  isConnected: boolean;
  isConnecting: boolean;
  chains: ChainInfo[];
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  switchChain: (chainId: number) => Promise<void>;
}

const WalletConnectContext = createContext<WalletConnectState | null>(null);

export function useWalletConnect() {
  const context = useContext(WalletConnectContext);
  if (!context) {
    throw new Error('useWalletConnect must be used within a WalletConnectProvider');
  }
  return context;
}

interface WalletConnectProviderProps {
  children: ReactNode;
}

export function WalletConnectProvider({ children }: WalletConnectProviderProps) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || isInitialized) return;

    const initWeb3Modal = async () => {
      try {
        const { BrowserProvider } = await import('ethers');
        
        createWeb3Modal({
          ethersConfig: {
            metadata,
          },
          chains: CHAINS.map(c => c.id),
          projectId,
          enableAnalytics: true,
          enableOnramp: false,
        });
        
        setIsInitialized(true);

        const checkConnection = async () => {
          const provider = new BrowserProvider((window as any).ethereum);
          if (provider) {
            try {
              const accounts = await provider.listAccounts();
              if (accounts.length > 0) {
                setAddress(accounts[0].address);
                setIsConnected(true);
                const network = await provider.getNetwork();
                setChainId(Number(network.chainId));
              }
            } catch (e) {
              console.log('Could not check wallet connection');
            }
          }
        };

        checkConnection();

        if ((window as any).ethereum) {
          (window as any).ethereum.on('accountsChanged', (accounts: string[]) => {
            if (accounts.length > 0) {
              setAddress(accounts[0]);
              setIsConnected(true);
            } else {
              setAddress(null);
              setIsConnected(false);
            }
          });

          (window as any).ethereum.on('chainChanged', (newChainId: string) => {
            setChainId(parseInt(newChainId, 16));
          });
        }
      } catch (error) {
        console.error('Failed to initialize Web3Modal:', error);
      }
    };

    initWeb3Modal();
  }, [isInitialized]);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    try {
      if (typeof window !== 'undefined' && (window as any).ethereum) {
        const { BrowserProvider } = await import('ethers');
        const provider = new BrowserProvider((window as any).ethereum);
        const accounts = await provider.send('eth_requestAccounts', []);
        if (accounts.length > 0) {
          setAddress(accounts[0]);
          setIsConnected(true);
          const network = await provider.getNetwork();
          setChainId(Number(network.chainId));
        }
      }
    } catch (error) {
      console.error('Failed to connect:', error);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setAddress(null);
    setChainId(null);
    setIsConnected(false);
  }, []);

  const switchChain = useCallback(async (newChainId: number) => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      const chain = CHAINS.find(c => c.id === newChainId);
      if (!chain) return;

      try {
        await (window as any).ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${newChainId.toString(16)}` }],
        });
        setChainId(newChainId);
      } catch (error: any) {
        if (error.code === 4902) {
          console.log('Chain not added to wallet');
        } else {
          console.error('Failed to switch chain:', error);
        }
      }
    }
  }, []);

  return (
    <WalletConnectContext.Provider
      value={{
        address,
        chainId,
        isConnected,
        isConnecting,
        chains: CHAINS,
        connect,
        disconnect,
        switchChain,
      }}
    >
      {children}
    </WalletConnectContext.Provider>
  );
}

export function formatAddress(addr: string): string {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function formatChainId(chainId: number | null): string {
  if (!chainId) return 'Unknown';
  return `Chain ${chainId}`;
}