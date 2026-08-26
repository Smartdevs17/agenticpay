"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

// ── Types ─────────────────────────────────────────────────────────────────────

type ActivityType =
  | "comment_added"
  | "comment_edited"
  | "comment_deleted"
  | "reaction_added"
  | "milestone_updated"
  | "member_joined"
  | "file_annotated";

interface ActivityEvent {
  id: string;
  projectId: string;
  type: ActivityType;
  actorId: string;
  actorName: string;
  targetId?: string;
  targetType?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface MentionNotification {
  id: string;
  commentId: string;
  projectId: string;
  mentionedUserId: string;
  mentionedBy: string;
  commentSnippet: string;
  read: boolean;
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function activityIcon(type: ActivityType): string {
  const icons: Record<ActivityType, string> = {
    comment_added: "💬",
    comment_edited: "✏️",
    comment_deleted: "🗑️",
    reaction_added: "😄",
    milestone_updated: "🎯",
    member_joined: "👋",
    file_annotated: "📎",
  };
  return icons[type] ?? "📌";
}

function activityLabel(event: ActivityEvent): string {
  const actor = event.actorName ?? "Someone";
  switch (event.type) {
    case "comment_added":
      return `${actor} added a comment`;
    case "comment_edited":
      return `${actor} edited a comment`;
    case "comment_deleted":
      return `${actor} deleted a comment`;
    case "reaction_added":
      return `${actor} reacted ${event.payload.emoji ?? ""}`;
    case "milestone_updated":
      return `${actor} updated a milestone`;
    case "member_joined":
      return `${actor} joined the project`;
    case "file_annotated":
      return `${actor} annotated a file`;
    default:
      return `${actor} performed an action`;
  }
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const AVATAR_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) & 0xffffffff;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ── ActivityItem ──────────────────────────────────────────────────────────────

function ActivityItem({ event }: { event: ActivityEvent }) {
  const snippet = event.payload.snippet as string | undefined;

  return (
    <div className="flex gap-2.5 py-2.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
      {/* Avatar */}
      <div
        className={`w-7 h-7 rounded-full text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5 ${avatarColor(event.actorName)}`}
        aria-hidden="true"
      >
        {initials(event.actorName)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm">{activityIcon(event.type)}</span>
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {activityLabel(event)}
            </span>
          </div>
          <span className="text-xs text-gray-400 shrink-0">{formatRelativeTime(event.createdAt)}</span>
        </div>

        {snippet && (
          <p className="text-xs text-gray-500 mt-0.5 italic truncate">
            &quot;{snippet}&quot;
          </p>
        )}

        {event.targetType && event.targetId && (
          <div className="text-xs text-gray-400 mt-0.5 capitalize">
            {event.targetType} · {event.targetId.slice(0, 8)}…
          </div>
        )}
      </div>
    </div>
  );
}

// ── ActivityFeed ──────────────────────────────────────────────────────────────

interface ActivityFeedProps {
  projectId: string;
  currentUserId: string;
  /** Auto-refresh interval in ms. Set to 0 to disable. */
  refreshInterval?: number;
  /** Show notifications panel */
  showNotifications?: boolean;
  limit?: number;
  className?: string;
}

export function ActivityFeed({
  projectId,
  currentUserId,
  refreshInterval = 30_000,
  showNotifications = true,
  limit = 50,
  className = "",
}: ActivityFeedProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [notifications, setNotifications] = useState<MentionNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"activity" | "mentions">("activity");
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchFeed = useCallback(async () => {
    setError(null);
    try {
      const [feedRes, notifsRes] = await Promise.all([
        fetch(`${API_BASE}/comments/project/${projectId}/activity?limit=${limit}`),
        showNotifications
          ? fetch(`${API_BASE}/comments/notifications/${currentUserId}`)
          : Promise.resolve(null),
      ]);

      if (feedRes.ok) {
        const data = await feedRes.json();
        setEvents(data.data ?? []);
      }

      if (notifsRes?.ok) {
        const data = await notifsRes.json();
        const notifs: MentionNotification[] = data.data ?? [];
        setNotifications(notifs);
        setUnreadCount(notifs.filter((n) => !n.read).length);
      }
    } catch {
      setError("Could not load activity feed.");
    } finally {
      setLoading(false);
    }
  }, [projectId, currentUserId, limit, showNotifications]);

  useEffect(() => {
    setLoading(true);
    fetchFeed();
  }, [fetchFeed]);

  useEffect(() => {
    if (refreshInterval <= 0) return;
    timerRef.current = setInterval(fetchFeed, refreshInterval);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchFeed, refreshInterval]);

  const markAllRead = async () => {
    try {
      await fetch(`${API_BASE}/comments/notifications/${currentUserId}/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      // silent
    }
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-800 dark:text-gray-200 text-sm">Activity</h3>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs h-6"
          onClick={fetchFeed}
          disabled={loading}
          aria-label="Refresh feed"
        >
          {loading ? "⟳" : "Refresh"}
        </Button>
      </div>

      {error && (
        <div className="text-xs text-red-500 bg-red-50 rounded px-2 py-1">{error}</div>
      )}

      {/* Tabs */}
      {showNotifications && (
        <div className="flex gap-1 border-b border-gray-100 dark:border-gray-800">
          {(["activity", "mentions"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`text-xs px-3 py-1.5 font-medium capitalize transition-colors relative ${
                activeTab === tab
                  ? "border-b-2 border-blue-500 text-blue-600"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab}
              {tab === "mentions" && unreadCount > 0 && (
                <span className="ml-1 bg-red-500 text-white text-[10px] rounded-full px-1 py-0 leading-none">
                  {unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Activity feed */}
      {(!showNotifications || activeTab === "activity") && (
        <div>
          {events.length === 0 ? (
            <p className="text-xs text-gray-400 py-3 text-center">
              No activity yet.
            </p>
          ) : (
            <div>
              {events.map((event) => (
                <ActivityItem key={event.id} event={event} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Mentions / notifications */}
      {showNotifications && activeTab === "mentions" && (
        <div>
          {unreadCount > 0 && (
            <div className="flex justify-end mb-2">
              <button
                onClick={markAllRead}
                className="text-xs text-blue-600 hover:underline"
              >
                Mark all read
              </button>
            </div>
          )}

          {notifications.length === 0 ? (
            <p className="text-xs text-gray-400 py-3 text-center">No mentions.</p>
          ) : (
            <div className="space-y-2">
              {notifications.map((notif) => (
                <div
                  key={notif.id}
                  className={`text-xs rounded-lg px-3 py-2 border transition-colors ${
                    notif.read
                      ? "bg-gray-50 border-gray-100 text-gray-500"
                      : "bg-blue-50 border-blue-100 text-blue-900"
                  }`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <span>
                      <strong>{notif.mentionedBy}</strong> mentioned you
                    </span>
                    <span className="text-gray-400 shrink-0">
                      {formatRelativeTime(notif.createdAt)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-gray-600 italic truncate">
                    &quot;{notif.commentSnippet}&quot;
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Live indicator */}
      {refreshInterval > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          Live · updates every {Math.floor(refreshInterval / 1000)}s
        </div>
      )}
    </div>
  );
}
