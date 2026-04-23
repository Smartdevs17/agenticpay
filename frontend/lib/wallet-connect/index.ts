'use client';

import { useEffect, useState } from 'react';
import { useWalletConnect, formatAddress } from './WalletConnectContext';
import { Wallet, ChevronDown, LogOut, RefreshCw, Copy, Check } from 'lucide-react';

export function WalletConnectButton() {
  const { address, isConnected, isConnecting, connect, disconnect, chainId } = useWalletConnect();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isConnecting) {
    return (
      <button disabled className="flex items-center gap-2 px-4 py-2 bg-gray-800 rounded-lg">
        <RefreshCw className="w-4 h-4 animate-spin" />
        Connecting...
      </button>
    );
  }

  if (isConnected && address) {
    return (
      <div className="relative">
        <button
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
        >
          <Wallet className="w-4 h-4" />
          <span>{formatAddress(address)}</span>
          <ChevronDown className="w-4 h-4" />
        </button>

        {isDropdownOpen && (
          <div className="absolute right-0 mt-2 w-56 bg-gray-800 rounded-lg shadow-xl border border-gray-700 py-2 z-50">
            <div className="px-4 py-2 border-b border-gray-700">
              <div className="text-sm text-gray-400">Connected</div>
              <div className="font-mono text-sm truncate">{address}</div>
              {chainId && <div className="text-xs text-gray-400">Chain ID: {chainId}</div>}
            </div>
            
            <button
              onClick={handleCopy}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-700 transition-colors"
            >
              {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied!' : 'Copy Address'}
            </button>
            
            <button
              onClick={() => {
                disconnect();
                setIsDropdownOpen(false);
              }}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-gray-700 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={connect}
      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
    >
      <Wallet className="w-4 h-4" />
      Connect Wallet
    </button>
  );
}

export function useWallet() {
  return useWalletConnect();
}

export function ChainSwitcher() {
  const { chains, chainId, switchChain, isConnected } = useWalletConnect();
  const [isOpen, setIsOpen] = useState(false);

  if (!isConnected) return null;

  const currentChain = chains.find(c => c.id === chainId);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors"
      >
        <span>{currentChain?.name || `Chain ${chainId}`}</span>
        <ChevronDown className="w-4 h-4" />
      </button>

      {isOpen && (
        <div className="absolute top-full mt-2 w-40 bg-gray-800 rounded-lg shadow-xl border border-gray-700 py-1 z-50">
          {chains.map((chain) => (
            <button
              key={chain.id}
              onClick={() => {
                switchChain(chain.id);
                setIsOpen(false);
              }}
              className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-700 transition-colors ${
                chain.id === chainId ? 'text-blue-400' : 'text-gray-300'
              }`}
            >
              {chain.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function WalletMultiChainConnector() {
  const { address, isConnected, connect, chains, chainId, switchChain } = useWalletConnect();
  const [showQR, setShowQR] = useState(false);
  const [sessionExpiry, setSessionExpiry] = useState<Date | null>(null);

  useEffect(() => {
    const checkExpiry = () => {
      const stored = localStorage.getItem('wc_session_expiry');
      if (stored) {
        const expiry = new Date(stored);
        if (expiry < new Date()) {
          localStorage.removeItem('wc_session_expiry');
          localStorage.removeItem('wc_session');
          setSessionExpiry(null);
        } else {
          setSessionExpiry(expiry);
        }
      }
    };
    checkExpiry();
    const interval = setInterval(checkExpiry, 60000);
    return () => clearInterval(interval);
  }, []);

  const generateQRData = () => {
    if (!address) return '';
    const uri = `wc:${address}@${chainId}`;
    return uri;
  };

  return (
    <div className="p-4 bg-gray-800 rounded-lg">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">WalletConnect v2</h3>
        {sessionExpiry && (
          <span className="text-xs text-yellow-400">
            Session expires: {sessionExpiry.toLocaleTimeString()}
          </span>
        )}
      </div>

      {!isConnected ? (
        <div className="space-y-4">
          <button
            onClick={connect}
            className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium"
          >
            Connect Wallet
          </button>
          
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-700"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-gray-800 text-gray-400">or scan QR</span>
            </div>
          </div>

          <button
            onClick={() => setShowQR(!showQR)}
            className="w-full px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium"
          >
            Show QR Code
          </button>

          {showQR && (
            <div className="flex justify-center p-4 bg-white rounded-lg">
              <div className="text-center">
                <div className="w-48 h-48 bg-gray-200 flex items-center justify-center mb-2">
                  <span className="text-gray-500 text-sm">QR Code</span>
                </div>
                <p className="text-xs text-gray-500">Scan with WalletConnect compatible wallet</p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-gray-900 rounded-lg">
            <div>
              <div className="text-sm text-gray-400">Connected Wallet</div>
              <div className="font-mono">{formatAddress(address!)}</div>
            </div>
            <button
              onClick={connect}
              className="p-2 hover:bg-gray-700 rounded"
              title="Refresh connection"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          <div>
            <div className="text-sm text-gray-400 mb-2">Switch Chain</div>
            <div className="grid grid-cols-2 gap-2">
              {chains.map((chain) => (
                <button
                  key={chain.id}
                  onClick={() => switchChain(chain.id)}
                  className={`p-2 rounded-lg text-sm transition-colors ${
                    chain.id === chainId
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 hover:bg-gray-600'
                  }`}
                >
                  {chain.name}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => {
              localStorage.removeItem('wc_session_expiry');
              localStorage.removeItem('wc_session');
              window.location.reload();
            }}
            className="w-full px-4 py-2 bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded-lg text-sm"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}