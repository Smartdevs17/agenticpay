interface ICSEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end?: Date;
  allDay?: boolean;
}

function formatICSDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function formatICSAllDayDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function escapeICSValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function foldICSLine(line: string): string[] {
  const maxLength = 75;
  if (line.length <= maxLength) return [line];

  const folded: string[] = [];
  let remaining = line;
  folded.push(remaining.slice(0, maxLength));
  remaining = remaining.slice(maxLength);

  while (remaining.length > 0) {
    folded.push(` ${remaining.slice(0, maxLength - 1)}`);
    remaining = remaining.slice(maxLength - 1);
  }

  return folded;
}

export function generateICS(events: ICSEvent[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AgenticPay//Calendar Export//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const event of events) {
    const end = event.end ?? new Date(event.start.getTime() + 86400000);
    const startsAt = event.allDay
      ? `DTSTART;VALUE=DATE:${formatICSAllDayDate(event.start)}`
      : `DTSTART:${formatICSDate(event.start)}`;
    const endsAt = event.allDay
      ? `DTEND;VALUE=DATE:${formatICSAllDayDate(end)}`
      : `DTEND:${formatICSDate(end)}`;

    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeICSValue(event.uid)}`,
      `DTSTAMP:${formatICSDate(new Date())}`,
      startsAt,
      endsAt,
      `SUMMARY:${escapeICSValue(event.summary)}`,
      ...(event.description ? [`DESCRIPTION:${escapeICSValue(event.description)}`] : []),
      ...(event.location ? [`LOCATION:${escapeICSValue(event.location)}`] : []),
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.flatMap(foldICSLine).join('\r\n');
}

export function downloadICS(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[\\/:*?"<>|]+/g, '-');
  a.click();
  URL.revokeObjectURL(url);
}
