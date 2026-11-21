"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

// ── Types ─────────────────────────────────────────────────────────────────────

type ReactionEmoji = "👍" | "👎" | "❤️" | "🎉" | "🚀" | "👀" | "😕" | "🔥";

interface FileAnnotation {
  filePath: string;
  lineStart: number;
  lineEnd?: number;
}

interface CommentReaction {
  emoji: ReactionEmoji;
  userId: string;
  createdAt: string;
}

interface Comment {
  id: string;
  projectId: string;
  targetType: string;
  targetId: string;
  parentId?: string;
  authorId: string;
  authorName: string;
  body: string;
  mentions: string[];
  reactions: CommentReaction[];
  upvotes: number;
  downvotes: number;
  userVotes: Record<string, "up" | "down">;
  annotation?: FileAnnotation;
  edited: boolean;
  editedAt?: string;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ThreadData {
  parent: Comment;
  replies: Comment[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const REACTIONS: ReactionEmoji[] = ["👍", "👎", "❤️", "🎉", "🚀", "👀", "😕", "🔥"];

function groupReactions(reactions: CommentReaction[]): Record<string, number> {
  return reactions.reduce<Record<string, number>>((acc, r) => {
    acc[r.emoji] = (acc[r.emoji] ?? 0) + 1;
    return acc;
  }, {});
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString();
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// ── CommentItem ───────────────────────────────────────────────────────────────

interface CommentItemProps {
  comment: Comment;
  currentUserId: string;
  onReact: (id: string, emoji: ReactionEmoji) => void;
  onVote: (id: string, dir: "up" | "down") => void;
  onEdit: (id: string, body: string) => void;
  onDelete: (id: string) => void;
  onReply?: (parentId: string) => void;
  isReply?: boolean;
}

function CommentItem({
  comment,
  currentUserId,
  onReact,
  onVote,
  onEdit,
  onDelete,
  onReply,
  isReply = false,
}: CommentItemProps) {
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const [showReactions, setShowReactions] = useState(false);
  const reactionCounts = groupReactions(comment.reactions);
  const userVote = comment.userVotes[currentUserId];

  if (comment.deleted) {
    return (
      <div className={`${isReply ? "ml-8 border-l-2 border-gray-100 pl-4" : ""} py-2`}>
        <span className="text-xs text-gray-400 italic">[deleted]</span>
      </div>
    );
  }

  return (
    <div
      className={`${isReply ? "ml-8 border-l-2 border-gray-100 dark:border-gray-700 pl-4" : ""} py-2`}
    >
      {/* Annotation badge */}
      {comment.annotation && (
        <div className="mb-1.5 text-xs bg-yellow-50 border border-yellow-200 text-yellow-700 rounded px-2 py-1 inline-flex items-center gap-1">
          📎 {comment.annotation.filePath}:{comment.annotation.lineStart}
          {comment.annotation.lineEnd ? `–${comment.annotation.lineEnd}` : ""}
        </div>
      )}

      <div className="flex gap-2.5">
        {/* Avatar */}
        <div
          className="w-7 h-7 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5"
          aria-hidden="true"
        >
          {initials(comment.authorName)}
        </div>

        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {comment.authorName}
            </span>
            <span className="text-xs text-gray-400">{formatDate(comment.createdAt)}</span>
            {comment.edited && (
              <span className="text-xs text-gray-400 italic">(edited)</span>
            )}
          </div>

          {/* Body */}
          {editing ? (
            <div className="mt-1.5 space-y-1.5">
              <textarea
                className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                rows={3}
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                aria-label="Edit comment"
              />
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => {
                    onEdit(comment.id, editBody);
                    setEditing(false);
                  }}
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs h-7"
                  onClick={() => {
                    setEditing(false);
                    setEditBody(comment.body);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5 whitespace-pre-wrap">
              {comment.body}
            </p>
          )}

          {/* Reaction bar */}
          {Object.keys(reactionCounts).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {Object.entries(reactionCounts).map(([emoji, count]) => (
                <button
                  key={emoji}
                  onClick={() => onReact(comment.id, emoji as ReactionEmoji)}
                  className="text-xs flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border border-gray-200 hover:bg-gray-50 transition-colors"
                  aria-label={`${count} ${emoji} reactions`}
                >
                  {emoji} <span className="text-gray-500">{count}</span>
                </button>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 mt-1.5">
            {/* Vote */}
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <button
                onClick={() => onVote(comment.id, "up")}
                className={`hover:text-green-600 transition-colors ${userVote === "up" ? "text-green-600 font-bold" : ""}`}
                aria-label="Upvote"
              >
                ▲
              </button>
              <span>{comment.upvotes}</span>
              <button
                onClick={() => onVote(comment.id, "down")}
                className={`hover:text-red-500 transition-colors ${userVote === "down" ? "text-red-500 font-bold" : ""}`}
                aria-label="Downvote"
              >
                ▼
              </button>
            </div>

            {/* React */}
            <div className="relative">
              <button
                onClick={() => setShowReactions((v) => !v)}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Add reaction"
              >
                😊
              </button>
              {showReactions && (
                <div className="absolute z-10 bottom-6 left-0 bg-white dark:bg-gray-800 shadow-lg rounded-lg border border-gray-200 dark:border-gray-600 flex gap-1 p-1.5">
                  {REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      className="text-base hover:scale-125 transition-transform"
                      onClick={() => {
                        onReact(comment.id, emoji);
                        setShowReactions(false);
                      }}
                      aria-label={`React with ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Reply */}
            {onReply && !isReply && (
              <button
                onClick={() => onReply(comment.id)}
                className="text-xs text-gray-400 hover:text-blue-600 transition-colors"
              >
                Reply
              </button>
            )}

            {/* Edit / Delete (own comments) */}
            {comment.authorId === currentUserId && !editing && (
              <>
                <button
                  onClick={() => setEditing(true)}
                  className="text-xs text-gray-400 hover:text-blue-600 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => onDelete(comment.id)}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── CommentThread ─────────────────────────────────────────────────────────────

interface CommentThreadProps {
  projectId: string;
  targetType: string;
  targetId: string;
  currentUserId: string;
  currentUserName: string;
  /** If provided, shows inline annotation support */
  filePath?: string;
}

export function CommentThread({
  projectId,
  targetType,
  targetId,
  currentUserId,
  currentUserName,
  filePath,
}: CommentThreadProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [threads, setThreads] = useState<Record<string, Comment[]>>({}); // parentId → replies
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [newBody, setNewBody] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Annotation state
  const [annotationLine, setAnnotationLine] = useState("");

  const loadComments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/comments/project/${projectId}?targetType=${targetType}&targetId=${targetId}`,
      );
      if (!res.ok) throw new Error("Failed to load comments");
      const data = await res.json();
      const allComments: Comment[] = data.data ?? [];

      const roots = allComments.filter((c) => !c.parentId);
      const replyMap: Record<string, Comment[]> = {};
      for (const c of allComments) {
        if (c.parentId) {
          if (!replyMap[c.parentId]) replyMap[c.parentId] = [];
          replyMap[c.parentId].push(c);
        }
      }

      setComments(roots);
      setThreads(replyMap);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load comments");
    } finally {
      setLoading(false);
    }
  }, [projectId, targetType, targetId]);

  const postComment = async (body: string, parentId?: string) => {
    if (!body.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const annotation =
        filePath && annotationLine
          ? { filePath, lineStart: parseInt(annotationLine) || 1 }
          : undefined;

      const res = await fetch(`${API_BASE}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          targetType,
          targetId,
          parentId,
          authorId: currentUserId,
          authorName: currentUserName,
          body,
          annotation,
        }),
      });
      if (!res.ok) throw new Error("Failed to post comment");

      if (parentId) {
        setReplyBody("");
        setReplyingTo(null);
      } else {
        setNewBody("");
        setAnnotationLine("");
      }

      await loadComments();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to post comment");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReact = async (commentId: string, emoji: ReactionEmoji) => {
    try {
      await fetch(`${API_BASE}/comments/${commentId}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUserId, emoji }),
      });
      await loadComments();
    } catch {
      // silent
    }
  };

  const handleVote = async (commentId: string, direction: "up" | "down") => {
    try {
      await fetch(`${API_BASE}/comments/${commentId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUserId, direction }),
      });
      await loadComments();
    } catch {
      // silent
    }
  };

  const handleEdit = async (commentId: string, body: string) => {
    try {
      await fetch(`${API_BASE}/comments/${commentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUserId, body }),
      });
      await loadComments();
    } catch {
      // silent
    }
  };

  const handleDelete = async (commentId: string) => {
    if (!confirm("Delete this comment?")) return;
    try {
      await fetch(`${API_BASE}/comments/${commentId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUserId }),
      });
      await loadComments();
    } catch {
      // silent
    }
  };

  return (
    <div className="space-y-3">
      {/* Load trigger */}
      {!loaded && (
        <button
          onClick={loadComments}
          disabled={loading}
          className="text-sm text-blue-600 hover:underline"
        >
          {loading ? "Loading comments…" : "Load comments"}
        </button>
      )}

      {error && (
        <div className="text-xs text-red-500 bg-red-50 rounded px-2 py-1">{error}</div>
      )}

      {/* Comment list */}
      {loaded && (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {comments.length === 0 ? (
            <p className="text-sm text-gray-400 py-2">
              No comments yet. Be the first to comment.
            </p>
          ) : (
            comments.map((comment) => (
              <div key={comment.id}>
                <CommentItem
                  comment={comment}
                  currentUserId={currentUserId}
                  onReact={handleReact}
                  onVote={handleVote}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onReply={(parentId) => {
                    setReplyingTo(parentId);
                    setReplyBody("");
                  }}
                />

                {/* Replies */}
                {(threads[comment.id] ?? []).map((reply) => (
                  <CommentItem
                    key={reply.id}
                    comment={reply}
                    currentUserId={currentUserId}
                    onReact={handleReact}
                    onVote={handleVote}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    isReply
                  />
                ))}

                {/* Reply input */}
                {replyingTo === comment.id && (
                  <div className="ml-8 mt-1.5 space-y-1.5">
                    <textarea
                      className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                      rows={2}
                      placeholder={`Reply to ${comment.authorName}…`}
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      aria-label="Reply text"
                    />
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        className="text-xs h-7"
                        disabled={submitting || !replyBody.trim()}
                        onClick={() => postComment(replyBody, comment.id)}
                      >
                        {submitting ? "Posting…" : "Reply"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs h-7"
                        onClick={() => setReplyingTo(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* New comment form */}
      <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-800">
        {filePath && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Line annotation:</span>
            <input
              type="number"
              min={1}
              placeholder="Line #"
              value={annotationLine}
              onChange={(e) => setAnnotationLine(e.target.value)}
              className="w-20 text-xs border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
              aria-label="Line number for annotation"
            />
          </div>
        )}

        <textarea
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
          rows={3}
          placeholder="Write a comment… (use @username to mention)"
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          aria-label="New comment"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              postComment(newBody);
            }
          }}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">⌘↵ to submit</span>
          <Button
            size="sm"
            disabled={submitting || !newBody.trim()}
            onClick={() => postComment(newBody)}
          >
            {submitting ? "Posting…" : "Comment"}
          </Button>
        </div>
      </div>
    </div>
  );
}
