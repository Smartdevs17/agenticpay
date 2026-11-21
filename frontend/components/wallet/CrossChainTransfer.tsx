'use client';

/**
 * CrossChainTransfer.tsx — Issue #593
 *
 * UI for initiating cross-chain asset transfers with automatic routing.
 * Displays route options (cheapest / fastest / safest) and handles
 * gas abstraction (pay fees in any supported token).
 */

import React, { useState } from 'react';
import { useWeb3Store, SupportedChain } from '@/store/web3Store';

interface RouteOption {
  sourceChain: SupportedChain;
  destinationChain: SupportedChain;
  bridgeProtocol: string;
  estimatedFeeUSD: number;
  estimatedTimeMs: number;
  strategy: 'cheapest' | 'fastest' | 'safest';
  recommended: boolean;
}

const CHAIN_NAMES: Record<SupportedChain, string> = {
  stellar: 'Stellar',
  ethereum: 'Ethereum',
  polygon: 'Polygon',
  base: 'Base',
  arbitrum: 'Arbitrum',
  optimism: 'Optimism',
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

export function CrossChainTransfer() {
  const { connectedWallets } = useWeb3Store();

  const [sourceChain, setSourceChain] = useState<SupportedChain>('stellar');
  const [destinationChain, setDestinationChain] = useState<SupportedChain>('ethereum');
  const [amount, setAmount] = useState('');
  const [asset, setAsset] = useState('XLM');
  const [selectedStrategy, setSelectedStrategy] = useState<'cheapest' | 'fastest' | 'safest'>('cheapest');
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [txId, setTxId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sourceWallet = connectedWallets.find((w) => w.chainType === sourceChain);
  const destWallet = connectedWallets.find((w) => w.chainType === destinationChain);

  const loadRoutes = async () => {
    if (!amount || sourceChain === destinationChain) return;
    setLoadingRoutes(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/wallet/routes?source=${sourceChain}&destination=${destinationChain}&amount=${amount}`);
      if (!res.ok) throw new Error('Failed to fetch routes');
      const data = await res.json();
      setRoutes(data.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load routes');
    } finally {
      setLoadingRoutes(false);
    }
  };

  const handleTransfer = async () => {
    if (!sourceWallet || !destWallet || !amount) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/wallet/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceChain,
          destinationChain,
          sourceAddress: sourceWallet.address,
          destinationAddress: destWallet.address,
          assetCode: asset,
          amount,
          strategy: selectedStrategy,
        }),
      });
      if (!res.ok) throw new Error('Transfer initiation failed');
      const data = await res.json();
      setTxId(data.data?.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer failed');
    } finally {
      setSubmitting(false);
    }
  };

  const formatTime = (ms: number) => {
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    return `${Math.round(ms / 60_000)}m`;
  };

  const chains = Object.keys(CHAIN_NAMES) as SupportedChain[];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 max-w-lg">
      <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-5">Cross-Chain Transfer</h2>

      {txId ? (
        <div className="text-center py-6">
          <div className="text-4xl mb-3" aria-hidden="true">🚀</div>
          <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">Transfer initiated!</p>
          <p className="text-xs text-gray-500 font-mono">{txId}</p>
          <button
            onClick={() => { setTxId(null); setAmount(''); setRoutes([]); }}
            className="mt-4 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 focus:outline-none focus:underline"
          >
            Make another transfer
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Source chain */}
          <div>
            <label htmlFor="source-chain" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              From
            </label>
            <select
              id="source-chain"
              value={sourceChain}
              onChange={(e) => { setSourceChain(e.target.value as SupportedChain); setRoutes([]); }}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {chains.map((c) => (
                <option key={c} value={c}>{CHAIN_NAMES[c]}</option>
              ))}
            </select>
            {!sourceWallet && (
              <p className="mt-1 text-xs text-yellow-600 dark:text-yellow-400" role="alert">
                No {CHAIN_NAMES[sourceChain]} wallet connected.
              </p>
            )}
          </div>

          {/* Destination chain */}
          <div>
            <label htmlFor="dest-chain" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              To
            </label>
            <select
              id="dest-chain"
              value={destinationChain}
              onChange={(e) => { setDestinationChain(e.target.value as SupportedChain); setRoutes([]); }}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {chains.filter((c) => c !== sourceChain).map((c) => (
                <option key={c} value={c}>{CHAIN_NAMES[c]}</option>
              ))}
            </select>
            {!destWallet && (
              <p className="mt-1 text-xs text-yellow-600 dark:text-yellow-400" role="alert">
                No {CHAIN_NAMES[destinationChain]} wallet connected.
              </p>
            )}
          </div>

          {/* Amount & asset */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label htmlFor="transfer-amount" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Amount
              </label>
              <input
                id="transfer-amount"
                type="number"
                min="0"
                step="any"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setRoutes([]); }}
                placeholder="0.00"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="w-24">
              <label htmlFor="asset-code" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Asset
              </label>
              <input
                id="asset-code"
                type="text"
                value={asset}
                onChange={(e) => setAsset(e.target.value.toUpperCase())}
                placeholder="XLM"
                maxLength={12}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Get routes button */}
          <button
            onClick={loadRoutes}
            disabled={!amount || loadingRoutes || sourceChain === destinationChain}
            className="w-full py-2 text-sm font-medium text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
            {loadingRoutes ? 'Finding routes…' : 'Get Routes'}
          </button>

          {/* Route options */}
          {routes.length > 0 && (
            <fieldset>
              <legend className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Select Route</legend>
              <div className="space-y-2">
                {routes.map((route) => (
                  <label
                    key={route.strategy}
                    className={`flex items-center justify-between p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                      selectedStrategy === route.strategy
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-600 hover:border-blue-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="route-strategy"
                        value={route.strategy}
                        checked={selectedStrategy === route.strategy}
                        onChange={() => setSelectedStrategy(route.strategy)}
                        className="sr-only"
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 capitalize">
                          {route.strategy}
                          {route.recommended && (
                            <span className="ml-2 text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded">
                              Recommended
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{route.bridgeProtocol}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">${route.estimatedFeeUSD.toFixed(2)}</p>
                      <p className="text-xs text-gray-400">~{formatTime(route.estimatedTimeMs)}</p>
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>
          )}

          {/* Transfer button */}
          <button
            onClick={handleTransfer}
            disabled={submitting || !amount || !sourceWallet || !destWallet || sourceChain === destinationChain}
            className="w-full py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
            aria-label="Initiate cross-chain transfer"
          >
            {submitting ? 'Initiating…' : 'Transfer'}
          </button>
        </div>
      )}
    </div>
  );
}
