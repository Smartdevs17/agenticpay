/**
 * Project → calendar events — Issue #65
 *
 * Both project detail pages (default and localized) previously built their own
 * event lists, which drifted: they used different `UID`s for the same milestone,
 * different descriptions, and only one of them asked for all-day events. This
 * module is the single source for the export, and it covers both acceptance
 * criteria — **project deadlines** and **milestone dates** — without producing
 * duplicate entries, because the contract currently maps the project deadline
 * onto a single milestone.
 */

import {
  deadlineEventUid,
  isValidDate,
  milestoneEventUid,
  type ICSEvent,
} from '@/lib/generateICS';
import type { Milestone } from '@/lib/types';

/** The subset of a milestone the calendar needs. */
export type CalendarMilestone = Pick<
  Milestone,
  'id' | 'title' | 'description' | 'amount' | 'status' | 'dueDate'
>;

export interface ProjectCalendarInput {
  projectId: string;
  projectTitle: string;
  currency?: string;
  githubRepo?: string;
  /** Project-level deadline (ISO 8601). */
  deadline?: string | null;
  milestones: CalendarMilestone[];
  /** Include the project deadline event. Defaults to `true`. */
  includeDeadline?: boolean;
}

function toDate(value?: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return isValidDate(date) ? date : undefined;
}

function sameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function detailLines(input: ProjectCalendarInput, extra: Array<string | undefined>): string {
  return [
    ...extra,
    `Project: ${input.projectTitle}`,
    input.githubRepo ? `Repository: ${input.githubRepo}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

/**
 * Build calendar events for a project: one per milestone due date plus the
 * project deadline itself.
 *
 * The deadline event is skipped when a milestone already falls on that same day
 * (the current contract shape), so the calendar stays free of duplicates. Events
 * with missing or unparseable dates are omitted.
 */
export function buildProjectCalendarEvents(input: ProjectCalendarInput): ICSEvent[] {
  const deadline = toDate(input.deadline);
  const events: ICSEvent[] = [];
  const seenUids = new Set<string>();
  const milestoneDays: Date[] = [];

  for (const milestone of input.milestones) {
    const dueDate = toDate(milestone.dueDate);
    if (!dueDate) continue;

    milestoneDays.push(dueDate);

    const uid = milestoneEventUid(input.projectId, milestone.id);
    if (seenUids.has(uid)) continue;
    seenUids.add(uid);

    events.push({
      uid,
      summary: `${input.projectTitle} — ${milestone.title}`,
      description: detailLines(input, [
        milestone.description,
        input.currency ? `Amount: ${milestone.amount} ${input.currency}` : `Amount: ${milestone.amount}`,
        `Status: ${milestone.status}`,
      ]),
      start: dueDate,
      allDay: true,
    });
  }

  const deadlineCoveredByMilestone =
    deadline !== undefined && milestoneDays.some((day) => sameUtcDay(day, deadline));

  if (deadline && input.includeDeadline !== false && !deadlineCoveredByMilestone) {
    const uid = deadlineEventUid(input.projectId);
    if (!seenUids.has(uid)) {
      events.push({
        uid,
        summary: `${input.projectTitle} — project deadline`,
        description: detailLines(input, [`Deadline: ${deadline.toISOString().slice(0, 10)}`]),
        start: deadline,
        allDay: true,
      });
    }
  }

  return events;
}

/** Filesystem-safe `.ics` filename for a project. */
export function buildProjectCalendarFilename(projectTitle: string): string {
  const slug = projectTitle
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return `${slug || 'project'}.ics`;
}

export default buildProjectCalendarEvents;
