import { useEffect, useState } from 'react';
import { useAllowancesStore, TokenAllowance, ApprovalHistoryItem } from '@/store/useAllowancesStore';
import { useAuthStore } from '@/store/useAuthStore';

const riskColors = {
  low: 'bg-green-500',
  medium: 'bg-yellow-500',
  high: 'bg-red-500',
};

const riskLabels = {
  low: 'Low Risk',
  medium: 'Medium Risk',
  high: 'High Risk',
};

function formatAllowance(allowance: string, symbol: string, isUnlimited: boolean): string {
  if (isUnlimited) return 'Unlimited';
  const num = parseFloat(allowance);
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B ${symbol}`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M ${symbol}`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K ${symbol}`;
  return `${num.toFixed(4)} ${symbol}`;
}

function formatAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AllowancesPage() {
  const { address } = useAuthStore();
  const {
    allowances,
    summary,
    history,
    isLoading,
    error,
    fetchAllowances,
    fetchHistory,
    approve,
    revoke,
    batchRevoke,
  } = useAllowancesStore();

  const [activeTab, setActiveTab] = useState<'allowances' | 'history'>('allowances');
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showRevokeModal, setShowRevokeModal] = useState(false);
  const [selectedAllowance, setSelectedAllowance] = useState<TokenAllowance | null>(null);
  const [selectedAllowances, setSelectedAllowances] = useState<string[]>([]);
  const [approveForm, setApproveForm] = useState({
    spender: '',
    token: '',
    tokenSymbol: 'USDC',
    chainId: 1,
    amount: '',
    isUnlimited: false,
  });
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (address) {
      fetchAllowances(address);
      fetchHistory(address);
    }
  }, [address, fetchAllowances, fetchHistory]);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const handleApprove = async () => {
    if (!address || !approveForm.spender || !approveForm.token) return;
    try {
      await approve({
        owner: address,
        ...approveForm,
      });
      setShowApproveModal(false);
      setApproveForm({ spender: '', token: '', tokenSymbol: 'USDC', chainId: 1, amount: '', isUnlimited: false });
      await fetchAllowances(address);
      await fetchHistory(address);
      setNotification({ type: 'success', message: 'Approval successful!' });
    } catch (err) {
      setNotification({ type: 'error', message: (err as Error).message });
    }
  };

  const handleRevoke = async () => {
    if (!address || !selectedAllowance) return;
    try {
      await revoke({
        owner: address,
        spender: selectedAllowance.spender,
        token: selectedAllowance.token,
        chainId: selectedAllowance.chainId,
      });
      setShowRevokeModal(false);
      setSelectedAllowance(null);
      await fetchAllowances(address);
      await fetchHistory(address);
      setNotification({ type: 'success', message: 'Allowance revoked!' });
    } catch (err) {
      setNotification({ type: 'error', message: (err as Error).message });
    }
  };

  const handleBatchRevoke = async () => {
    if (!address || selectedAllowances.length === 0) return;
    try {
      const allowancesToRevoke = selectedAllowances
        .map(id => allowances.find(a => a.id === id))
        .filter((a): a is TokenAllowance => a !== undefined)
        .map(a => ({ spender: a.spender, token: a.token, chainId: a.chainId }));
      
      await batchRevoke({ owner: address, allowances: allowancesToRevoke });
      setSelectedAllowances([]);
      await fetchAllowances(address);
      await fetchHistory(address);
      setNotification({ type: 'success', message: 'Batch revocation complete!' });
    } catch (err) {
      setNotification({ type: 'error', message: (err as Error).message });
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedAllowances(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  if (!address) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-xl font-semibold">Connect your wallet to view allowances</h2>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {notification && (
        <div className={`p-4 rounded-lg ${
          notification.type === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
        }`}>
          {notification.message}
        </div>
      )}

      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Token Allowances</h1>
        <button
          onClick={() => setShowApproveModal(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium"
        >
          New Approval
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-500/20 text-red-400 rounded-lg">{error}</div>
      )}

      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="p-4 bg-gray-800 rounded-lg">
            <div className="text-gray-400 text-sm">Total Allowances</div>
            <div className="text-2xl font-bold">{summary.totalAllowances}</div>
          </div>
          <div className="p-4 bg-gray-800 rounded-lg">
            <div className="text-gray-400 text-sm">Total Value</div>
            <div className="text-2xl font-bold">${summary.totalAllowancesUsd.toLocaleString()}</div>
          </div>
          <div className="p-4 bg-gray-800 rounded-lg">
            <div className="text-gray-400 text-sm">High Risk</div>
            <div className="text-2xl font-bold text-red-400">{summary.highRisk}</div>
          </div>
          <div className="p-4 bg-gray-800 rounded-lg">
            <div className="text-gray-400 text-sm">Unlimited</div>
            <div className="text-2xl font-bold text-yellow-400">{summary.unlimitedAllowances}</div>
          </div>
        </div>
      )}

      <div className="flex gap-4 border-b border-gray-700">
        <button
          onClick={() => setActiveTab('allowances')}
          className={`pb-2 px-1 ${activeTab === 'allowances' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-gray-400'}`}
        >
          Allowances
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`pb-2 px-1 ${activeTab === 'history' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-gray-400'}`}
        >
          History
        </button>
      </div>

      {activeTab === 'allowances' && (
        <div className="space-y-4">
          {selectedAllowances.length > 0 && (
            <div className="flex items-center gap-4">
              <span className="text-gray-400">{selectedAllowances.length} selected</span>
              <button
                onClick={handleBatchRevoke}
                className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm"
              >
                Revoke Selected
              </button>
              <button
                onClick={() => setSelectedAllowances([])}
                className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                Clear Selection
              </button>
            </div>
          )}

          {isLoading ? (
            <div className="text-center py-8 text-gray-400">Loading allowances...</div>
          ) : allowances.length === 0 ? (
            <div className="text-center py-8 text-gray-400">No allowances found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-700">
                    <th className="pb-3 w-10">
                      <input
                        type="checkbox"
                        checked={selectedAllowances.length === allowances.length && allowances.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedAllowances(allowances.map(a => a.id));
                          } else {
                            setSelectedAllowances([]);
                          }
                        }}
                        className="rounded"
                      />
                    </th>
                    <th className="pb-3">Token</th>
                    <th className="pb-3">Spender</th>
                    <th className="pb-3">Chain</th>
                    <th className="pb-3">Allowance</th>
                    <th className="pb-3">Risk</th>
                    <th className="pb-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allowances.map((allowance) => (
                    <tr key={allowance.id} className="border-b border-gray-800">
                      <td className="py-4">
                        <input
                          type="checkbox"
                          checked={selectedAllowances.includes(allowance.id)}
                          onChange={() => toggleSelection(allowance.id)}
                          className="rounded"
                        />
                      </td>
                      <td className="py-4">
                        <div className="font-medium">{allowance.tokenSymbol}</div>
                        <div className="text-xs text-gray-400">{formatAddress(allowance.token)}</div>
                      </td>
                      <td className="py-4">
                        <span className="font-mono text-sm">{formatAddress(allowance.spender)}</span>
                      </td>
                      <td className="py-4 text-gray-400">{allowance.chainName}</td>
                      <td className="py-4">
                        <div>{formatAllowance(allowance.allowance, allowance.tokenSymbol, allowance.isUnlimited)}</div>
                        <div className="text-xs text-gray-400">${allowance.allowanceUsd.toLocaleString()}</div>
                      </td>
                      <td className="py-4">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs ${
                          allowance.riskLevel === 'high' ? 'bg-red-500/20 text-red-400' :
                          allowance.riskLevel === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-green-500/20 text-green-400'
                        }`}>
                          <span className={`w-2 h-2 rounded-full mr-1.5 ${riskColors[allowance.riskLevel]}`}></span>
                          {riskLabels[allowance.riskLevel]}
                        </span>
                      </td>
                      <td className="py-4">
                        <button
                          onClick={() => {
                            setSelectedAllowance(allowance);
                            setShowRevokeModal(true);
                          }}
                          className="px-3 py-1 bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded text-sm"
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="overflow-x-auto">
          {history.length === 0 ? (
            <div className="text-center py-8 text-gray-400">No approval history</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="pb-3">Token</th>
                  <th className="pb-3">Spender</th>
                  <th className="pb-3">Chain</th>
                  <th className="pb-3">Old</th>
                  <th className="pb-3">New</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.id} className="border-b border-gray-800">
                    <td className="py-4 font-medium">{item.tokenSymbol}</td>
                    <td className="py-4 font-mono text-sm">{formatAddress(item.spender)}</td>
                    <td className="py-4 text-gray-400">{item.chainName}</td>
                    <td className="py-4 text-gray-400">{formatAllowance(item.oldAllowance, item.tokenSymbol, false)}</td>
                    <td className="py-4">{formatAllowance(item.newAllowance, item.tokenSymbol, item.newAllowance === '115792089237316195423570985008687907853269984665640564039457.584007913129639935')}</td>
                    <td className="py-4">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs ${
                        item.status === 'confirmed' ? 'bg-green-500/20 text-green-400' :
                        item.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="py-4 text-gray-400 text-sm">{formatDate(item.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showApproveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">New Token Approval</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Spender Address</label>
                <input
                  type="text"
                  value={approveForm.spender}
                  onChange={(e) => setApproveForm(f => ({ ...f, spender: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2"
                  placeholder="0x..."
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Token Address</label>
                <input
                  type="text"
                  value={approveForm.token}
                  onChange={(e) => setApproveForm(f => ({ ...f, token: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2"
                  placeholder="0x..."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Token Symbol</label>
                  <input
                    type="text"
                    value={approveForm.tokenSymbol}
                    onChange={(e) => setApproveForm(f => ({ ...f, tokenSymbol: e.target.value }))}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2"
                    placeholder="USDC"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Chain ID</label>
                  <select
                    value={approveForm.chainId}
                    onChange={(e) => setApproveForm(f => ({ ...f, chainId: parseInt(e.target.value) }))}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2"
                  >
                    <option value={1}>Ethereum</option>
                    <option value={137}>Polygon</option>
                    <option value={56}>BSC</option>
                    <option value={42161}>Arbitrum</option>
                    <option value={10}>Optimism</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Amount (leave empty for unlimited)</label>
                <input
                  type="text"
                  value={approveForm.amount}
                  onChange={(e) => setApproveForm(f => ({ ...f, amount: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2"
                  placeholder="1000"
                  disabled={approveForm.isUnlimited}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="unlimited"
                  checked={approveForm.isUnlimited}
                  onChange={(e) => setApproveForm(f => ({ ...f, isUnlimited: e.target.checked, amount: '' }))}
                />
                <label htmlFor="unlimited" className="text-sm">Allow unlimited amount</label>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowApproveModal(false)}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
              >
                Cancel
              </button>
              <button
                onClick={handleApprove}
                disabled={!approveForm.spender || !approveForm.token || isLoading}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50"
              >
                {isLoading ? 'Approving...' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRevokeModal && selectedAllowance && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Revoke Allowance</h2>
            <div className="space-y-3 mb-6">
              <div className="flex justify-between">
                <span className="text-gray-400">Token:</span>
                <span>{selectedAllowance.tokenSymbol}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Spender:</span>
                <span className="font-mono text-sm">{formatAddress(selectedAllowance.spender)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Chain:</span>
                <span>{selectedAllowance.chainName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Current Allowance:</span>
                <span>{formatAllowance(selectedAllowance.allowance, selectedAllowance.tokenSymbol, selectedAllowance.isUnlimited)}</span>
              </div>
            </div>
            <p className="text-yellow-400 text-sm mb-4">This will revoke the token allowance. This action cannot be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowRevokeModal(false);
                  setSelectedAllowance(null);
                }}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
              >
                Cancel
              </button>
              <button
                onClick={handleRevoke}
                disabled={isLoading}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 rounded disabled:opacity-50"
              >
                {isLoading ? 'Revoking...' : 'Revoke'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}