'use client';

import React, { useState } from 'react';
import type { EditOperation } from './useCollaboration';
import type { CollabUser } from './useCollaboration';

interface EditHistoryPanelProps {
  history: EditOperation[];
  participants: CollabUser[];
  currentVersion: number;
  onRollback: (version: number) => void;
  isOpen: boolean;
  onClose: () => void;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatPath(path: string[]): string {
  return path.join(' › ');
}

export function EditHistoryPanel({
  history,
  participants,
  currentVersion,
  onRollback,
  isOpen,
  onClose,
}: EditHistoryPanelProps) {
  const [confirmRollback, setConfirmRollback] = useState<number | null>(null);

  if (!isOpen) return null;

  const userMap = new Map(participants.map((p) => [p.userId, p]));
  const reversed = [...history].reverse();

  return (
    <div className="fixed inset-y-0 right-0 w-80 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 className="font-semibold text-gray-800 dark:text-gray-100 text-sm">Edit History</h2>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          aria-label="Close history panel"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="text-xs text-gray-400 px-4 py-2 bg-gray-50 dark:bg-gray-800">
        Current version: <strong className="text-gray-700 dark:text-gray-200">v{currentVersion}</strong>
        {' · '}
        {history.length} operations
      </div>

      {/* Operations list */}
      <div className="flex-1 overflow-y-auto">
        {reversed.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-gray-400">
            No edits yet
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {reversed.map((op) => {
              const user = userMap.get(op.userId);
              const isLatest = op.version === currentVersion;

              return (
                <li
                  key={op.id ?? op.version}
                  className={`px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 group transition-colors ${
                    isLatest ? 'bg-blue-50 dark:bg-blue-900/10' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                          {user?.displayName ?? op.userId.slice(0, 8)}
                        </span>
                        <span className="text-xs text-gray-400">
                          {op.timestamp ? formatTimestamp(op.timestamp as string) : ''}
                        </span>
                        {isLatest && (
                          <span className="text-xs bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-300 px-1 rounded">
                            latest
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        <span className="font-mono">{formatPath(op.path)}</span>
                        {' '}
                        <span className="text-gray-400">{op.type}</span>
                        {op.value != null && (
                          <span className="text-gray-600 dark:text-gray-300">
                            {' → '}
                            {JSON.stringify(op.value).slice(0, 30)}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">v{op.version}</p>
                    </div>

                    {/* Rollback button */}
                    {!isLatest && (
                      <button
                        onClick={() => setConfirmRollback(op.version)}
                        className="opacity-0 group-hover:opacity-100 text-xs text-blue-500 hover:text-blue-700 transition-opacity shrink-0"
                        title={`Roll back to v${op.version}`}
                      >
                        Restore
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Rollback confirmation */}
      {confirmRollback !== null && (
        <div className="border-t border-gray-200 dark:border-gray-700 p-4 bg-amber-50 dark:bg-amber-900/20">
          <p className="text-sm text-amber-800 dark:text-amber-200 mb-3">
            Roll back to <strong>v{confirmRollback}</strong>? This will revert all changes after this point.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                onRollback(confirmRollback);
                setConfirmRollback(null);
              }}
              className="flex-1 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm rounded-lg transition-colors"
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirmRollback(null)}
              className="flex-1 py-1.5 border border-gray-300 dark:border-gray-600 text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
