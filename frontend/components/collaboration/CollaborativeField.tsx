'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import type { UseCollaborationReturn } from './useCollaboration';

interface CollaborativeFieldProps {
  label: string;
  fieldPath: string[];
  value: string;
  onChange: (value: string) => void;
  collaboration: UseCollaborationReturn;
  currentUserId: string;
  isCritical?: boolean;
  placeholder?: string;
  type?: 'text' | 'url' | 'password';
  disabled?: boolean;
  className?: string;
}

export function CollaborativeField({
  label,
  fieldPath,
  value,
  onChange,
  collaboration,
  currentUserId,
  isCritical = false,
  placeholder,
  type = 'text',
  disabled = false,
  className = '',
}: CollaborativeFieldProps) {
  const { lockedFields, participants, sendOperation, moveCursor, acquireLock, releaseLock } =
    collaboration;

  const fieldKey = fieldPath.join('.');
  const lockHolder = lockedFields[fieldKey];
  const isLockedByMe = lockHolder === currentUserId;
  const isLockedByOther = lockHolder && lockHolder !== currentUserId;

  const lockHolderUser = isLockedByOther
    ? participants.find((p) => p.userId === lockHolder)
    : null;

  const remoteEditor = participants.find(
    (p) => p.userId !== currentUserId && p.cursorField === fieldKey
  );

  const prevValueRef = useRef(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFocus = useCallback(async () => {
    moveCursor(fieldKey);

    if (isCritical) {
      const granted = await acquireLock(fieldKey);
      if (!granted) return; // blocked — input will be disabled via isLockedByOther
    }
  }, [fieldKey, isCritical, moveCursor, acquireLock]);

  const handleBlur = useCallback(() => {
    if (isCritical && isLockedByMe) {
      releaseLock(fieldKey);
    }
  }, [fieldKey, isCritical, isLockedByMe, releaseLock]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      onChange(newValue);

      // Debounce op emission to avoid spamming on every keystroke
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        sendOperation({
          path: fieldPath,
          type: 'set',
          value: newValue,
          previousValue: prevValueRef.current,
          version: collaboration.currentVersion,
        });
        prevValueRef.current = newValue;
      }, 300);
    },
    [onChange, sendOperation, fieldPath, collaboration.currentVersion]
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const isInputDisabled = disabled || (isCritical && !!isLockedByOther);

  return (
    <div className={`relative ${className}`}>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label}
        {isCritical && (
          <span className="ml-1 text-xs text-amber-500 font-normal">(critical)</span>
        )}
      </label>

      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          disabled={isInputDisabled}
          placeholder={placeholder}
          className={[
            'w-full px-3 py-2 rounded-lg border text-sm transition-colors',
            'focus:outline-none focus:ring-2',
            isLockedByOther
              ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20 cursor-not-allowed focus:ring-amber-300'
              : isLockedByMe
              ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20 focus:ring-blue-400'
              : remoteEditor
              ? 'border-violet-400 focus:ring-violet-400'
              : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-blue-500',
            disabled ? 'opacity-50 cursor-not-allowed' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        />

        {/* Lock indicator */}
        {isLockedByOther && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-xs font-medium">
              {lockHolderUser?.displayName ?? 'Another user'}
            </span>
          </div>
        )}

        {/* Remote cursor indicator */}
        {!isLockedByOther && remoteEditor && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-violet-500">
            <span className="w-1.5 h-4 bg-violet-500 animate-pulse rounded-sm" />
            <span className="text-xs">{remoteEditor.displayName}</span>
          </div>
        )}
      </div>

      {/* Status messages */}
      {isLockedByOther && (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
          Locked by {lockHolderUser?.displayName ?? 'another user'} — read-only
        </p>
      )}
      {isLockedByMe && (
        <p className="mt-1 text-xs text-blue-500">You hold the edit lock on this field.</p>
      )}
    </div>
  );
}
