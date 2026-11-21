/**
 * iCalendar (`.ics`) generation — Issue #65
 *
 * Produces RFC 5545 calendars for project deadlines and milestone due dates so
 * they can be added to Google/Apple/Outlook calendars.
 *
 * Conformance details that matter in practice:
 *
 * - **TEXT escaping (§3.3.11)** — backslashes, semicolons, commas and newlines
 *   must be escaped inside `SUMMARY`/`DESCRIPTION`/`LOCATION`. A title such as
 *   `Redesign, phase 2` otherwise truncates the field in most clients.
 * - **Line folding (§3.1)** — lines longer than 75 octets must be folded with
 *   CRLF + a single space, without splitting a UTF-8 sequence.
 * - **All-day events** — due dates are dates, not instants, so they are emitted
 *   as `DTSTART;VALUE=DATE:YYYYMMDD` with an **exclusive** `DTEND` on the
 *   following day. Previously an `allDay` flag was accepted by callers but
 *   silently ignored by the generator.
 * - Invalid dates are skipped rather than emitted as `NaNundefinedZ`, which
 *   makes the whole calendar unparseable.
 */

export interface ICSEvent {
  /** Globally unique identifier; stable so re-imports update instead of duplicate. */
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  /** Only used for timed events; ignored when `allDay` is true. */
  end?: Date;
  /** Emit a date-only event. Defaults to `true`, since these are due dates. */
  allDay?: boolean;
}

/** Maximum octets per content line before folding (RFC 5545 §3.1). */
const MAX_LINE_OCTETS = 75;

const uidDomain = 'agenticpay';

/** Escape a value for use in an iCalendar TEXT property (RFC 5545 §3.3.11). */
export function escapeICSText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `YYYYMMDD` in UTC — used for `VALUE=DATE` properties. */
export function formatICSDate(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

/** `YYYYMMDDTHHMMSSZ` in UTC — used for date-time properties. */
export function formatICSDateTime(date: Date): string {
  return (
    `${formatICSDate(date)}T` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** True when the value is a usable calendar date. */
export function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Fold a content line at 75 octets, continuing with a leading space. Multi-byte
 * UTF-8 characters are never split across a fold.
 */
export function foldICSLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= MAX_LINE_OCTETS) return line;

  const folded: string[] = [];
  let current = '';
  let currentOctets = 0;
  // Continuation lines start with a space, leaving 74 octets for content.
  let limit = MAX_LINE_OCTETS;

  for (const character of line) {
    const octets = encoder.encode(character).length;
    if (currentOctets + octets > limit) {
      folded.push(current);
      current = '';
      currentOctets = 0;
      limit = MAX_LINE_OCTETS - 1;
      current = ' ';
      currentOctets = 1;
    }
    current += character;
    currentOctets += octets;
  }

  if (current) folded.push(current);
  return folded.join('\r\n');
}

/** Serialize a single event block. Returns `undefined` for unusable events. */
function serializeEvent(event: ICSEvent, now: Date): string[] | undefined {
  if (!event.uid || !event.summary || !isValidDate(event.start)) return undefined;

  const allDay = event.allDay ?? true;
  const lines = ['BEGIN:VEVENT', `UID:${escapeICSText(event.uid)}`];

  lines.push(`DTSTAMP:${formatICSDateTime(now)}`);

  if (allDay) {
    // DTEND is exclusive: the day after the due date.
    const endDate = isValidDate(event.end)
      ? event.end
      : new Date(event.start.getTime() + 24 * 60 * 60 * 1000);
    lines.push(`DTSTART;VALUE=DATE:${formatICSDate(event.start)}`);
    lines.push(`DTEND;VALUE=DATE:${formatICSDate(endDate)}`);
  } else {
    const end = isValidDate(event.end)
      ? event.end
      : new Date(event.start.getTime() + 60 * 60 * 1000);
    lines.push(`DTSTART:${formatICSDateTime(event.start)}`);
    lines.push(`DTEND:${formatICSDateTime(end)}`);
  }

  lines.push(`SUMMARY:${escapeICSText(event.summary)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeICSText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeICSText(event.location)}`);
  lines.push('END:VEVENT');

  return lines;
}

/**
 * Build an `.ics` document. Events with missing or invalid dates are dropped so
 * one bad deadline cannot corrupt the export.
 */
export function generateICS(events: ICSEvent[], now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//AgenticPay//Calendar Export//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeICSText('AgenticPay')}`,
  ];

  for (const event of events) {
    const serialized = serializeEvent(event, now);
    if (serialized) lines.push(...serialized);
  }

  lines.push('END:VCALENDAR');

  return lines.map(foldICSLine).join('\r\n');
}

/** Trigger a browser download of generated calendar content. */
export function downloadICS(filename: string, content: string): void {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return;

  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.ics') ? filename : `${filename}.ics`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** UID for a milestone due date, stable across exports. */
export function milestoneEventUid(projectId: string, milestoneId: string): string {
  return `agenticpay-project-${projectId}-milestone-${milestoneId}@${uidDomain}`;
}

/** UID for a project deadline, stable across exports. */
export function deadlineEventUid(projectId: string): string {
  return `agenticpay-project-${projectId}-deadline@${uidDomain}`;
}

export default generateICS;
