'use client';

import React from 'react';
import type { CollabUser } from './useCollaboration';

interface PresenceIndicatorsProps {
  participants: CollabUser[];
  currentUserId: string;
  maxVisible?: number;
}

const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
];

function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) & 0xffffffff;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function PresenceIndicators({
  participants,
  currentUserId,
  maxVisible = 5,
}: PresenceIndicatorsProps) {
  const others = participants.filter((p) => p.userId !== currentUserId);
  const visible = others.slice(0, maxVisible);
  const overflow = others.length - maxVisible;

  if (others.length === 0) {
    return (
      <span className="text-xs text-gray-400 dark:text-gray-500">
        Only you are editing
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1" aria-label="Active collaborators">
      <span className="text-xs text-gray-500 dark:text-gray-400 mr-1">
        {others.length === 1 ? '1 other' : `${others.length} others`} editing
      </span>
      <div className="flex -space-x-2">
        {visible.map((user) => (
          <div
            key={user.userId}
            className="relative group"
            title={user.displayName}
          >
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.displayName}
                className="w-7 h-7 rounded-full ring-2 ring-white dark:ring-gray-900 object-cover"
              />
            ) : (
              <div
                className={`w-7 h-7 rounded-full ring-2 ring-white dark:ring-gray-900 flex items-center justify-center text-white text-xs font-semibold ${colorForUser(user.userId)}`}
              >
                {user.displayName.slice(0, 2).toUpperCase()}
              </div>
            )}

            {/* Active indicator dot */}
            <span className="absolute bottom-0 right-0 w-2 h-2 bg-green-400 rounded-full ring-1 ring-white" />

            {/* Tooltip */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-gray-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
              {user.displayName}
              {user.cursorField && (
                <span className="text-gray-300"> — editing {user.cursorField}</span>
              )}
            </div>
          </div>
        ))}

        {overflow > 0 && (
          <div className="w-7 h-7 rounded-full ring-2 ring-white dark:ring-gray-900 bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs text-gray-600 dark:text-gray-300 font-medium">
            +{overflow}
          </div>
        )}
      </div>
    </div>
  );
}
