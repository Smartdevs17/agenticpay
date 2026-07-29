'use client';

/**
 * WalletManager.tsx — Issue #593
 *
 * Unified multi-chain wallet connection management UI.
 * Displays connected wallets, aggregated balance, and allows
 * connecting / disconnecting wallets across Stellar and EVM chains.
 */

import React, { useEffect } from 'react';
import { useWeb3Store, SupportedChain, ConnectedWallet } from '@/store/web3Store';

// ─── Chain metadata ───────────────────────────────────────────────────────────

interface ChainMeta {
  name: string;
  symbol: string;
  icon: string;
  color: string;
}

const CHAIN_META: Record<SupportedChain, ChainMeta> = {
  stellar: { name: 'Stellar', symbol: 'XLM', icon: '✦', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  ethereum: { name: 'Ethereum', symbol: 'ETH', icon: '⟠', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
  polygon: { name: 'Polygon', symbol: 'MATIC', icon: '⬡', color: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300' },
  base: { name: 'Base', symbol: 'ETH', icon: '🔵', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  arbitrum: { name: 'Arbitrum', symbol: 'ETH', icon: '🔷', color: 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300' },
  optimism: { name: 'Optimism', symbol: 'ETH', icon: '🔴', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function ChainBadge({ chainType }: { chainType: SupportedChain }) {
  const meta = CHAIN_META[chainType];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${meta.color}`}>
      <span aria-hidden="true">{meta.icon}</span>
      {meta.name}
    </span>
  );
}

function WalletRow({ wallet, onDisconnect }: { wallet: ConnectedWallet; onDisconnect: (id: string) => void }) {
  const shortAddress = `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`;

  return (
    <li className="flex items-center justify-between py-3 px-4 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <ChainBadge chainType={wallet.chainType} />
        <div className="min-w-0">
          <p className="text-sm font-mono text-gray-900 dark:text-gray-100 truncate">{shortAddress}</p>
          <p className="text-xs text-gray-400 capitalize">{wallet.providerName}</p>
        </div>
      </div>
      <button
        onClick={() => onDisconnect(wallet.id)}
        className="ml-3 shrink-0 text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400 font-medium focus:outline-none focus:underline"
        aria-label={`Disconnect ${wallet.chainType} wallet ${shortAddress}`}
      >
        Disconnect
      </button>
    </li>
  );
}

function BalanceRow({ chainType, nativeBalance, nativeBalanceUSD, symbol }: {
  chainType: SupportedChain;
  nativeBalance: string;
  nativeBalanceUSD: number;
  symbol: string;
}) {
  return (
    <li className="flex items-center justify-between py-2.5 px-4">
      <div className="flex items-center gap-2">
        <ChainBadge chainType={chainType} />
      </div>
      <div className="text-right">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {parseFloat(nativeBalance).toLocaleString(undefined, { maximumFractionDigits: 4 })} {symbol}
        </p>
        <p className="text-xs text-gray-400">
          ${nativeBalanceUSD.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </p>
      </div>
    </li>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function WalletManager({ userId }: { userId: string }) {
  const {
    connectedWallets,
    aggregatedBalance,
    activeChain,
    removeWallet,
    setActiveChain,
    fetchAggregatedBalance,
  } = useWeb3Store();

  useEffect(() => {
    if (userId) {
      void fetchAggregatedBalance(userId);
    }
  }, [userId, fetchAggregatedBalance]);

  const handleDisconnect = (walletId: string) => {
    removeWallet(walletId);
  };

  const handleRefresh = () => {
    void fetchAggregatedBalance(userId);
  };

  return (
    <div className="space-y-6">
      {/* Total balance card */}
      <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-6 text-white shadow-lg">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-medium text-blue-100">Total Portfolio Value</p>
          <button
            onClick={handleRefresh}
            disabled={aggregatedBalance.isLoading}
            className="text-xs text-blue-200 hover:text-white disabled:opacity-50 focus:outline-none focus:underline"
            aria-label="Refresh balances"
          >
            {aggregatedBalance.isLoading ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
        <p className="text-3xl font-bold">
          ${aggregatedBalance.totalUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        {aggregatedBalance.lastUpdated && (
          <p className="mt-1 text-xs text-blue-200">
            Last updated {new Date(aggregatedBalance.lastUpdated).toLocaleTimeString()}
          </p>
        )}
        {aggregatedBalance.error && (
          <p className="mt-1 text-xs text-red-300" role="alert">{aggregatedBalance.error}</p>
        )}
      </div>

      {/* Chain filter */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by chain">
        <button
          onClick={() => setActiveChain(null)}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            activeChain === null
              ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
          aria-pressed={activeChain === null}
        >
          All chains
        </button>
        {(Object.keys(CHAIN_META) as SupportedChain[]).map((chain) => (
          <button
            key={chain}
            onClick={() => setActiveChain(chain)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              activeChain === chain
                ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
            aria-pressed={activeChain === chain}
          >
            {CHAIN_META[chain].name}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Connected wallets */}
        <section className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden" aria-labelledby="wallets-heading">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <h2 id="wallets-heading" className="text-sm font-semibold text-gray-900 dark:text-white">
              Connected Wallets
              <span className="ml-2 text-xs font-normal text-gray-400">({connectedWallets.length})</span>
            </h2>
          </div>
          {connectedWallets.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">No wallets connected.</p>
              <p className="text-xs text-gray-400 mt-1">Use the Connect Wallet button to add one.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700" aria-label="Connected wallets list">
              {connectedWallets
                .filter((w) => !activeChain || w.chainType === activeChain)
                .map((wallet) => (
                  <WalletRow key={wallet.id} wallet={wallet} onDisconnect={handleDisconnect} />
                ))}
            </ul>
          )}
        </section>

        {/* Per-chain balances */}
        <section className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden" aria-labelledby="balances-heading">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <h2 id="balances-heading" className="text-sm font-semibold text-gray-900 dark:text-white">Chain Balances</h2>
          </div>
          {aggregatedBalance.isLoading ? (
            <div className="px-4 py-8 text-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto" aria-label="Loading balances" />
            </div>
          ) : aggregatedBalance.chains.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              Connect a wallet to see balances.
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700" aria-label="Chain balances">
              {aggregatedBalance.chains
                .filter((c) => !activeChain || c.chainType === activeChain)
                .map((chain) => (
                  <BalanceRow
                    key={chain.chainId}
                    chainType={chain.chainType}
                    nativeBalance={chain.nativeBalance}
                    nativeBalanceUSD={chain.nativeBalanceUSD}
                    symbol={CHAIN_META[chain.chainType]?.symbol ?? chain.chainType.toUpperCase()}
                  />
                ))}
            </ul>
          )}
        </section>
      </div>

      {/* Top assets across all chains */}
      {aggregatedBalance.topAssets && aggregatedBalance.topAssets.length > 0 && (
        <section className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden" aria-labelledby="assets-heading">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <h2 id="assets-heading" className="text-sm font-semibold text-gray-900 dark:text-white">Top Assets</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 dark:divide-gray-700" aria-label="Top assets across chains">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th scope="col" className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Asset</th>
                  <th scope="col" className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Balance</th>
                  <th scope="col" className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Value (USD)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {aggregatedBalance.topAssets.map((asset) => (
                  <tr key={asset.assetCode} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                    <td className="px-4 py-2.5 text-sm font-medium text-gray-900 dark:text-gray-100">{asset.assetCode}</td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-700 dark:text-gray-300">
                      {parseFloat(asset.balance).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right font-medium text-gray-900 dark:text-gray-100">
                      ${asset.balanceUSD.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
