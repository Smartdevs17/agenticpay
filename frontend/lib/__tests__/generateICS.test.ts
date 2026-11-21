/**
 * generateICS tests — Issue #65
 */
import { describe, expect, it } from 'vitest';

import {
  escapeICSText,
  foldICSLine,
  formatICSDate,
  formatICSDateTime,
  generateICS,
  isValidDate,
  type ICSEvent,
} from '@/lib/generateICS';

const NOW = new Date('2026-03-01T09:30:00Z');

function event(overrides: Partial<ICSEvent> = {}): ICSEvent {
  return {
    uid: 'agenticpay-project-1-milestone-1@agenticpay',
    summary: 'Website redesign',
    start: new Date('2026-04-15T00:00:00Z'),
    ...overrides,
  };
}

describe('escapeICSText', () => {
  it('escapes commas so a summary is not truncated', () => {
    expect(escapeICSText('Redesign, phase 2')).toBe('Redesign\\, phase 2');
  });

  it('escapes semicolons and backslashes', () => {
    expect(escapeICSText('a;b\\c')).toBe('a\\;b\\\\c');
  });

  it('converts newlines to the \\n escape', () => {
    expect(escapeICSText('line one\nline two\r\nline three')).toBe('line one\\nline two\\nline three');
  });
});

describe('date formatting', () => {
  it('formats a UTC date as YYYYMMDD with zero padding', () => {
    expect(formatICSDate(new Date('2026-01-05T23:00:00Z'))).toBe('20260105');
  });

  it('formats a UTC date-time as YYYYMMDDTHHMMSSZ', () => {
    expect(formatICSDateTime(new Date('2026-01-05T04:07:09Z'))).toBe('20260105T040709Z');
  });

  it('recognises invalid dates', () => {
    expect(isValidDate(new Date('nope'))).toBe(false);
    expect(isValidDate(new Date('2026-01-05T00:00:00Z'))).toBe(true);
    expect(isValidDate(undefined)).toBe(false);
  });
});

describe('foldICSLine', () => {
  it('leaves short lines untouched', () => {
    expect(foldICSLine('SUMMARY:short')).toBe('SUMMARY:short');
  });

  it('folds long lines with CRLF plus a leading space', () => {
    const line = `DESCRIPTION:${'x'.repeat(200)}`;
    const folded = foldICSLine(line);

    expect(folded).toContain('\r\n ');
    for (const segment of folded.split('\r\n')) {
      expect(new TextEncoder().encode(segment).length).toBeLessThanOrEqual(75);
    }
  });

  it('round-trips when unfolded by a parser', () => {
    const line = `DESCRIPTION:${'y'.repeat(300)}`;
    const unfolded = foldICSLine(line).replace(/\r\n /g, '');

    expect(unfolded).toBe(line);
  });

  it('never splits a multi-byte character', () => {
    const line = `SUMMARY:${'é'.repeat(120)}`;
    const folded = foldICSLine(line);

    for (const segment of folded.split('\r\n')) {
      expect(segment).not.toContain('\uFFFD');
      expect(new TextEncoder().encode(segment).length).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n /g, '')).toBe(line);
  });
});

describe('generateICS', () => {
  it('emits a VCALENDAR envelope with the required properties', () => {
    const ics = generateICS([event()], NOW);
    const lines = ics.split('\r\n');

    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain('CALSCALE:GREGORIAN');
    expect(lines).toContain('PRODID:-//AgenticPay//Calendar Export//EN');
    expect(lines.at(-1)).toBe('END:VCALENDAR');
  });

  it('uses CRLF line endings', () => {
    const ics = generateICS([event()], NOW);
    const lines = ics.split('\n');

    expect(ics).toContain('\r\n');
    // Every line but the last is terminated by CRLF.
    expect(lines.slice(0, -1).every((line) => line.endsWith('\r'))).toBe(true);
    expect(lines.at(-1)).not.toContain('\r');
  });

  it('renders an all-day event with an exclusive DTEND', () => {
    const ics = generateICS([event({ start: new Date('2026-04-15T00:00:00Z') })], NOW);

    expect(ics).toContain('DTSTART;VALUE=DATE:20260415');
    expect(ics).toContain('DTEND;VALUE=DATE:20260416');
    expect(ics).not.toContain('DTSTART:2026');
  });

  it('respects an explicit end date for all-day events', () => {
    const ics = generateICS(
      [event({ start: new Date('2026-04-15T00:00:00Z'), end: new Date('2026-04-18T00:00:00Z') })],
      NOW
    );

    expect(ics).toContain('DTEND;VALUE=DATE:20260418');
  });

  it('renders a timed event when allDay is false', () => {
    const ics = generateICS(
      [
        event({
          allDay: false,
          start: new Date('2026-04-15T13:00:00Z'),
          end: new Date('2026-04-15T14:30:00Z'),
        }),
      ],
      NOW
    );

    expect(ics).toContain('DTSTART:20260415T130000Z');
    expect(ics).toContain('DTEND:20260415T143000Z');
  });

  it('defaults a timed event to one hour when no end is given', () => {
    const ics = generateICS([event({ allDay: false, start: new Date('2026-04-15T13:00:00Z') })], NOW);

    expect(ics).toContain('DTEND:20260415T140000Z');
  });

  it('defaults to an all-day event when allDay is omitted', () => {
    const ics = generateICS([event()], NOW);
    expect(ics).toContain('DTSTART;VALUE=DATE');
  });

  it('escapes the summary and description', () => {
    const ics = generateICS(
      [event({ summary: 'Redesign, phase 2', description: 'Line one\nLine two; done, maybe' })],
      NOW
    );

    expect(ics).toContain('SUMMARY:Redesign\\, phase 2');
    expect(ics).toContain('Line one\\nLine two\\; done\\, maybe');
  });

  it('stamps DTSTAMP from the provided clock', () => {
    expect(generateICS([event()], NOW)).toContain('DTSTAMP:20260301T093000Z');
  });

  it('keeps the UID stable so re-imports update instead of duplicating', () => {
    const ics = generateICS([event()], NOW);
    expect(ics).toContain('UID:agenticpay-project-1-milestone-1@agenticpay');
  });

  it('includes the location when provided', () => {
    expect(generateICS([event({ location: 'Remote' })], NOW)).toContain('LOCATION:Remote');
  });

  it('skips events with an invalid start date', () => {
    const ics = generateICS([event({ start: new Date('not-a-date') })], NOW);

    expect(ics).not.toContain('BEGIN:VEVENT');
    expect(ics).not.toContain('NaN');
  });

  it('skips events without a uid or summary', () => {
    const ics = generateICS([event({ uid: '' }), event({ summary: '' })], NOW);
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  it('keeps valid events when another event is invalid', () => {
    const ics = generateICS(
      [event({ start: new Date('bad') }), event({ uid: 'ok-1', summary: 'Good' })],
      NOW
    );

    const blocks = ics.split('BEGIN:VEVENT').length - 1;
    expect(blocks).toBe(1);
    expect(ics).toContain('SUMMARY:Good');
  });

  it('returns a valid empty calendar for no events', () => {
    const ics = generateICS([], NOW);
    expect(ics).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//AgenticPay//Calendar Export//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:AgenticPay',
        'END:VCALENDAR',
      ].join('\r\n')
    );
  });

  it('folds a very long description across multiple lines', () => {
    const ics = generateICS([event({ description: 'z'.repeat(400) })], NOW);

    expect(ics).toContain('\r\n ');
    expect(ics.replace(/\r\n /g, '')).toContain('z'.repeat(400));
  });
});
