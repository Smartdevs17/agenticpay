/**
 * buildProjectCalendarEvents tests — Issue #65
 */
import { describe, expect, it } from 'vitest';

import { generateICS } from '@/lib/generateICS';
import {
  buildProjectCalendarEvents,
  buildProjectCalendarFilename,
  type CalendarMilestone,
} from '@/lib/project-calendar';

const DUE = '2026-04-15T00:00:00.000Z';

function milestone(overrides: Partial<CalendarMilestone> = {}): CalendarMilestone {
  return {
    id: '1',
    title: 'Project Deliverable',
    description: 'Build the thing',
    amount: '1.5',
    status: 'pending',
    dueDate: DUE,
    ...overrides,
  };
}

describe('buildProjectCalendarEvents — milestone dates', () => {
  it('creates one event per milestone with a due date', () => {
    const events = buildProjectCalendarEvents({
      projectId: '7',
      projectTitle: 'Redesign',
      currency: 'ETH',
      milestones: [milestone()],
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.uid).toBe('agenticpay-project-7-milestone-1@agenticpay');
    expect(events[0]!.summary).toBe('Redesign — Project Deliverable');
    expect(events[0]!.start.toISOString()).toBe(DUE);
    expect(events[0]!.allDay).toBe(true);
  });

  it('includes amount, status, description and repository in the details', () => {
    const events = buildProjectCalendarEvents({
      projectId: '7',
      projectTitle: 'Redesign',
      currency: 'ETH',
      githubRepo: 'https://github.com/a/b',
      milestones: [milestone()],
    });

    const description = events[0]!.description ?? '';
    expect(description).toContain('Build the thing');
    expect(description).toContain('Project: Redesign');
    expect(description).toContain('Amount: 1.5 ETH');
    expect(description).toContain('Status: pending');
    expect(description).toContain('Repository: https://github.com/a/b');
  });

  it('omits the currency when it is unknown', () => {
    const events = buildProjectCalendarEvents({
      projectId: '7',
      projectTitle: 'Redesign',
      milestones: [milestone()],
    });

    expect(events[0]!.description).toContain('Amount: 1.5');
    expect(events[0]!.description).not.toContain('Amount: 1.5 ');
  });

  it('includes multiple milestone dates', () => {
    const events = buildProjectCalendarEvents({
      projectId: '7',
      projectTitle: 'Redesign',
      milestones: [
        milestone({ id: '1', title: 'Design', dueDate: '2026-04-01T00:00:00.000Z' }),
        milestone({ id: '2', title: 'Build', dueDate: '2026-05-01T00:00:00.000Z' }),
      ],
    });

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.summary)).toEqual([
      'Redesign — Design',
      'Redesign — Build',
    ]);
  });

  it('skips milestones without a due date', () => {
    const events = buildProjectCalendarEvents({
      projectId: '7',
      projectTitle: 'Redesign',
      milestones: [milestone({ dueDate: undefined })],
    });

    expect(events).toEqual([]);
  });

  it('skips milestones with an unparseable due date', () => {
    const events = buildProjectCalendarEvents({
      projectId: '7',
      projectTitle: 'Redesign',
      milestones: [milestone({ dueDate: 'not-a-date' })],
    });

    expect(events).toEqual([]);
  });

  it('ignores duplicate milestone identifiers', () => {
    const events = buildProjectCalendarEvents({
      projectId: '7',
      projectTitle: 'Redesign',
      milestones: [milestone(), milestone()],
    });

    expect(events).toHaveLength(1);
  });
});

describe('buildProjectCalendarEvents — project deadline', () => {
  it('adds a deadline event when no milestone falls on that day', () => {
    const events = buildProjectCalendarEvents({
      projectId: '7',
      projectTitle: 'Redesign',
      deadline: '2026-06-30T00:00:00.000Z',
      milestones: [milestone({ dueDate: '2026-04-15T00:00:00.000Z' })],
    });

    expect(events).toHaveLength(2);
    const deadline = events.find((e) => e.uid === 'agenticpay-project-7-deadline@agenticpay')!;
    expect(deadline.summary).toBe('Redesign — project deadline');
    expect(deadline.start.toISOString()).toBe('2026-06-30T00:00:00.000Z');
  });

  it('does not duplicate the deadline when a milestone covers the same day', () => {
    const events = buildProjectCalendarEvents({
      projectId: '7',
      projectTitle: 'Redesign',
      deadline: DUE,
      milestones: [milestone()],
    });

    expect(events).toHaveLength(1);
    expect(events.some((e) => e.uid.includes('deadline'))).toBe(false);
  });

  it('still adds the deadline when a milestone is on a different time of the same day', () => {
    const events = buildProjectCalendarEvents({
      projectId: '7',
      projectTitle: 'Redesign',
      deadline: '2026-04-15T18:00:00.000Z',
      milestones: [milestone({ dueDate: DUE })],
    });

    // Same UTC day, so the milestone already represents it.
    expect(events).toHaveLength(1);
  });

  it('can be told to skip the deadline event', () => {
    const events = buildProjectCalendarEvents({
      projectId: '7',
      projectTitle: 'Redesign',
      deadline: '2026-06-30T00:00:00.000Z',
      milestones: [milestone()],
      includeDeadline: false,
    });

    expect(events).toHaveLength(1);
  });

  it('skips an invalid deadline', () => {
    const events = buildProjectCalendarEvents({
      projectId: '7',
      projectTitle: 'Redesign',
      deadline: 'not-a-date',
      milestones: [milestone({ dueDate: '2026-04-15T00:00:00.000Z' })],
    });

    expect(events).toHaveLength(1);
  });

  it('handles a project with only a deadline', () => {
    const events = buildProjectCalendarEvents({
      projectId: '7',
      projectTitle: 'Redesign',
      deadline: '2026-06-30T00:00:00.000Z',
      milestones: [],
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.uid).toBe('agenticpay-project-7-deadline@agenticpay');
  });
});

describe('buildProjectCalendarEvents → generateICS', () => {
  it('produces an importable calendar for milestone and deadline dates', () => {
    const events = buildProjectCalendarEvents({
      projectId: '7',
      projectTitle: 'Redesign, phase 2',
      currency: 'ETH',
      deadline: '2026-06-30T00:00:00.000Z',
      milestones: [milestone({ title: 'Design, round 1' })],
    });

    const ics = generateICS(events, new Date('2026-03-01T00:00:00Z'));

    expect(ics.split('BEGIN:VEVENT').length - 1).toBe(2);
    // Commas in user content are escaped, so the calendar stays parseable.
    expect(ics).toContain('SUMMARY:Redesign\\, phase 2 — Design\\, round 1');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260415');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260630');
  });
});

describe('buildProjectCalendarFilename', () => {
  it('slugifies the project title', () => {
    expect(buildProjectCalendarFilename('Website Redesign')).toBe('Website-Redesign.ics');
  });

  it('strips characters that are unsafe in filenames', () => {
    expect(buildProjectCalendarFilename('Redesign: phase 2 / v3?')).toBe('Redesign-phase-2-v3.ics');
  });

  it('falls back when the title slugifies to nothing', () => {
    expect(buildProjectCalendarFilename('///')).toBe('project.ics');
  });
});
