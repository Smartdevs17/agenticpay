/**
 * comments.ts — Issue #596
 *
 * Comment service for project collaboration: threaded comments, inline file
 * annotations, @mention notifications, reactions, voting, and search.
 */

import { randomUUID } from 'node:crypto';
import { BaseService } from './BaseService.js';
import type { Result } from '../lib/result.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CommentTargetType = 'milestone' | 'deliverable' | 'project' | 'file_annotation';
export type ReactionEmoji = '👍' | '👎' | '❤️' | '🎉' | '🚀' | '👀' | '😕' | '🔥';

export interface FileAnnotation {
  filePath: string;
  lineStart: number;
  lineEnd?: number;
  commitHash?: string;
}

export interface CommentReaction {
  emoji: ReactionEmoji;
  userId: string;
  createdAt: string;
}

export interface Comment {
  id: string;
  projectId: string;
  targetType: CommentTargetType;
  targetId: string;       // milestoneId, deliverableId, etc.
  parentId?: string;      // for threaded replies
  authorId: string;
  authorName: string;
  body: string;
  mentions: string[];     // userId[]
  reactions: CommentReaction[];
  upvotes: number;
  downvotes: number;
  userVotes: Record<string, 'up' | 'down'>; // userId → vote
  annotation?: FileAnnotation;
  edited: boolean;
  editedAt?: string;
  deleted: boolean;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityEvent {
  id: string;
  projectId: string;
  type:
    | 'comment_added'
    | 'comment_edited'
    | 'comment_deleted'
    | 'reaction_added'
    | 'milestone_updated'
    | 'member_joined'
    | 'file_annotated';
  actorId: string;
  actorName: string;
  targetId?: string;
  targetType?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface MentionNotification {
  id: string;
  commentId: string;
  projectId: string;
  mentionedUserId: string;
  mentionedBy: string;
  commentSnippet: string;
  read: boolean;
  createdAt: string;
}

export interface CreateCommentInput {
  projectId: string;
  targetType: CommentTargetType;
  targetId: string;
  parentId?: string;
  authorId: string;
  authorName: string;
  body: string;
  annotation?: FileAnnotation;
}

// ── In-memory stores ──────────────────────────────────────────────────────────

const comments = new Map<string, Comment>();
const activityFeed = new Map<string, ActivityEvent[]>(); // projectId → events
const notifications: MentionNotification[] = [];

// ── Mention parser ────────────────────────────────────────────────────────────

function parseMentions(body: string): string[] {
  const matches = body.match(/@(\w+)/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(1)))];
}

// ── Activity helper ───────────────────────────────────────────────────────────

function addActivity(
  projectId: string,
  event: Omit<ActivityEvent, 'id' | 'createdAt'>,
): void {
  const entry: ActivityEvent = {
    ...event,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const arr = activityFeed.get(projectId) ?? [];
  arr.push(entry);
  if (arr.length > 500) arr.shift(); // keep last 500 events per project
  activityFeed.set(projectId, arr);
}

// ── Service ───────────────────────────────────────────────────────────────────

export class CommentService extends BaseService {

  // ── Add a comment ─────────────────────────────────────────────────────────

  addComment(input: CreateCommentInput): Result<Comment> {
    if (!input.body.trim()) {
      return this.validationFailure('Comment body cannot be empty');
    }

    // Validate parent exists and belongs to same project/target
    if (input.parentId) {
      const parent = comments.get(input.parentId);
      if (!parent) return this.notFoundFailure('ParentComment', input.parentId);
      if (parent.deleted) return this.validationFailure('Cannot reply to a deleted comment');
      if (parent.projectId !== input.projectId) {
        return this.validationFailure('Parent comment belongs to a different project');
      }
    }

    const mentions = parseMentions(input.body);
    const now = new Date().toISOString();
    const id = randomUUID();

    const comment: Comment = {
      id,
      projectId: input.projectId,
      targetType: input.targetType,
      targetId: input.targetId,
      parentId: input.parentId,
      authorId: input.authorId,
      authorName: input.authorName,
      body: input.body,
      mentions,
      reactions: [],
      upvotes: 0,
      downvotes: 0,
      userVotes: {},
      annotation: input.annotation,
      edited: false,
      deleted: false,
      createdAt: now,
      updatedAt: now,
    };

    comments.set(id, comment);

    // Create mention notifications
    for (const userId of mentions) {
      notifications.push({
        id: randomUUID(),
        commentId: id,
        projectId: input.projectId,
        mentionedUserId: userId,
        mentionedBy: input.authorName,
        commentSnippet: input.body.slice(0, 140),
        read: false,
        createdAt: now,
      });
    }

    addActivity(input.projectId, {
      type: input.annotation ? 'file_annotated' : 'comment_added',
      projectId: input.projectId,
      actorId: input.authorId,
      actorName: input.authorName,
      targetId: id,
      targetType: input.targetType,
      payload: { commentId: id, snippet: input.body.slice(0, 80) },
    });

    return this.ok(comment);
  }

  // ── Edit a comment ────────────────────────────────────────────────────────

  editComment(commentId: string, userId: string, body: string): Result<Comment> {
    const comment = comments.get(commentId);
    if (!comment) return this.notFoundFailure('Comment', commentId);
    if (comment.deleted) return this.validationFailure('Cannot edit a deleted comment');
    if (comment.authorId !== userId) return this.forbiddenFailure('You can only edit your own comments');
    if (!body.trim()) return this.validationFailure('Comment body cannot be empty');

    const now = new Date().toISOString();
    comment.body = body;
    comment.mentions = parseMentions(body);
    comment.edited = true;
    comment.editedAt = now;
    comment.updatedAt = now;
    comments.set(commentId, comment);

    addActivity(comment.projectId, {
      type: 'comment_edited',
      projectId: comment.projectId,
      actorId: userId,
      actorName: comment.authorName,
      targetId: commentId,
      targetType: comment.targetType,
      payload: { commentId },
    });

    return this.ok(comment);
  }

  // ── Soft delete ───────────────────────────────────────────────────────────

  deleteComment(commentId: string, userId: string): Result<Comment> {
    const comment = comments.get(commentId);
    if (!comment) return this.notFoundFailure('Comment', commentId);
    if (comment.authorId !== userId) return this.forbiddenFailure('You can only delete your own comments');
    if (comment.deleted) return this.validationFailure('Comment already deleted');

    const now = new Date().toISOString();
    comment.deleted = true;
    comment.deletedAt = now;
    comment.body = '[deleted]';
    comment.updatedAt = now;
    comments.set(commentId, comment);

    addActivity(comment.projectId, {
      type: 'comment_deleted',
      projectId: comment.projectId,
      actorId: userId,
      actorName: comment.authorName,
      targetId: commentId,
      targetType: comment.targetType,
      payload: { commentId },
    });

    return this.ok(comment);
  }

  // ── Add reaction ──────────────────────────────────────────────────────────

  addReaction(commentId: string, userId: string, emoji: ReactionEmoji): Result<Comment> {
    const comment = comments.get(commentId);
    if (!comment) return this.notFoundFailure('Comment', commentId);
    if (comment.deleted) return this.validationFailure('Cannot react to a deleted comment');

    // Remove existing reaction from this user for this emoji
    comment.reactions = comment.reactions.filter(
      (r) => !(r.userId === userId && r.emoji === emoji),
    );

    // Toggle: if the user didn't have this reaction, add it; otherwise it's removed above
    const alreadyHad = comment.reactions.some((r) => r.userId === userId && r.emoji === emoji);
    if (!alreadyHad) {
      comment.reactions.push({ emoji, userId, createdAt: new Date().toISOString() });
    }

    comment.updatedAt = new Date().toISOString();
    comments.set(commentId, comment);

    addActivity(comment.projectId, {
      type: 'reaction_added',
      projectId: comment.projectId,
      actorId: userId,
      actorName: userId,
      targetId: commentId,
      targetType: 'comment',
      payload: { emoji, commentId },
    });

    return this.ok(comment);
  }

  // ── Vote ──────────────────────────────────────────────────────────────────

  vote(commentId: string, userId: string, direction: 'up' | 'down'): Result<Comment> {
    const comment = comments.get(commentId);
    if (!comment) return this.notFoundFailure('Comment', commentId);
    if (comment.deleted) return this.validationFailure('Cannot vote on a deleted comment');
    if (comment.authorId === userId) return this.validationFailure('Cannot vote on your own comment');

    const existing = comment.userVotes[userId];

    // Undo existing vote
    if (existing === 'up') comment.upvotes--;
    if (existing === 'down') comment.downvotes--;

    if (existing === direction) {
      // Toggle off
      delete comment.userVotes[userId];
    } else {
      comment.userVotes[userId] = direction;
      if (direction === 'up') comment.upvotes++;
      else comment.downvotes++;
    }

    comment.updatedAt = new Date().toISOString();
    comments.set(commentId, comment);
    return this.ok(comment);
  }

  // ── List comments for a target ────────────────────────────────────────────

  listComments(
    projectId: string,
    targetType: CommentTargetType,
    targetId: string,
    options?: { includeDeleted?: boolean; threadedOnly?: boolean },
  ): Comment[] {
    return Array.from(comments.values())
      .filter((c) => {
        if (c.projectId !== projectId) return false;
        if (c.targetType !== targetType) return false;
        if (c.targetId !== targetId) return false;
        if (!options?.includeDeleted && c.deleted) return false;
        if (options?.threadedOnly && c.parentId) return false;
        return true;
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  // ── Get thread (parent + all replies) ────────────────────────────────────

  getThread(parentId: string): Result<{ parent: Comment; replies: Comment[] }> {
    const parent = comments.get(parentId);
    if (!parent) return this.notFoundFailure('Comment', parentId);

    const replies = Array.from(comments.values())
      .filter((c) => c.parentId === parentId && !c.deleted)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    return this.ok({ parent, replies });
  }

  // ── Search ────────────────────────────────────────────────────────────────

  search(projectId: string, query: string, limit = 20): Comment[] {
    const lower = query.toLowerCase();
    return Array.from(comments.values())
      .filter(
        (c) =>
          c.projectId === projectId &&
          !c.deleted &&
          c.body.toLowerCase().includes(lower),
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  // ── Activity feed ─────────────────────────────────────────────────────────

  getActivityFeed(projectId: string, limit = 50): ActivityEvent[] {
    const events = activityFeed.get(projectId) ?? [];
    return events.slice(-limit).reverse();
  }

  // ── Mention notifications ──────────────────────────────────────────────────

  getUserNotifications(
    userId: string,
    options?: { unreadOnly?: boolean; limit?: number },
  ): MentionNotification[] {
    let all = notifications.filter((n) => n.mentionedUserId === userId);
    if (options?.unreadOnly) all = all.filter((n) => !n.read);
    return all
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, options?.limit ?? 50);
  }

  markNotificationsRead(userId: string, notificationIds?: string[]): number {
    let count = 0;
    for (const n of notifications) {
      if (n.mentionedUserId !== userId) continue;
      if (notificationIds && !notificationIds.includes(n.id)) continue;
      if (!n.read) {
        n.read = true;
        count++;
      }
    }
    return count;
  }

  // ── Get a single comment ──────────────────────────────────────────────────

  getComment(commentId: string): Result<Comment> {
    const comment = comments.get(commentId);
    if (!comment) return this.notFoundFailure('Comment', commentId);
    return this.ok(comment);
  }
}

export const commentService = new CommentService();
