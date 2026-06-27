import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateICS, downloadICS } from './generateICS';

// ─── generateICS ────────────────────────────────────────────────────────────

describe('generateICS', () => {
  it('wraps output in VCALENDAR', () => {
    const ics = generateICS([]);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('CALSCALE:GREGORIAN');
  });

  it('produces CRLF line endings', () => {
    const ics = generateICS([]);
    expect(ics).toContain('\r\n');
  });

  it('includes a VEVENT for each event', () => {
    const events = [
      { uid: 'a@test', summary: 'Event A', start: new Date('2025-01-15T00:00:00Z') },
      { uid: 'b@test', summary: 'Event B', start: new Date('2025-02-20T00:00:00Z') },
    ];
    const ics = generateICS(events);
    const beginCount = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
    const endCount = (ics.match(/END:VEVENT/g) ?? []).length;
    expect(beginCount).toBe(2);
    expect(endCount).toBe(2);
  });

  it('sets required VEVENT fields', () => {
    const start = new Date('2025-06-01T10:00:00Z');
    const ics = generateICS([{ uid: 'u1@test', summary: 'My Event', start }]);
    expect(ics).toContain('UID:u1@test');
    expect(ics).toContain('SUMMARY:My Event');
    expect(ics).toContain('DTSTART:20250601T100000Z');
    expect(ics).toContain('DTSTAMP:');
  });

  it('defaults DTEND to start + 1 day when end is omitted', () => {
    const start = new Date('2025-06-01T00:00:00Z');
    const ics = generateICS([{ uid: 'u2@test', summary: 'All Day', start }]);
    expect(ics).toContain('DTEND:20250602T000000Z');
  });

  it('uses the provided end date', () => {
    const start = new Date('2025-06-01T09:00:00Z');
    const end = new Date('2025-06-01T17:00:00Z');
    const ics = generateICS([{ uid: 'u3@test', summary: 'Work Day', start, end }]);
    expect(ics).toContain('DTEND:20250601T170000Z');
  });

  it('includes DESCRIPTION when provided', () => {
    const ics = generateICS([
      { uid: 'u4@test', summary: 'With Desc', start: new Date('2025-06-01T00:00:00Z'), description: 'Some details' },
    ]);
    expect(ics).toContain('DESCRIPTION:Some details');
  });

  it('omits DESCRIPTION when not provided', () => {
    const ics = generateICS([{ uid: 'u5@test', summary: 'No Desc', start: new Date('2025-06-01T00:00:00Z') }]);
    expect(ics).not.toContain('DESCRIPTION:');
  });

  it('escapes newlines in DESCRIPTION', () => {
    const ics = generateICS([
      { uid: 'u6@test', summary: 'Multi', start: new Date('2025-06-01T00:00:00Z'), description: 'Line1\nLine2' },
    ]);
    expect(ics).toContain('DESCRIPTION:Line1\\nLine2');
  });

  it('produces an empty calendar for an empty events array', () => {
    const ics = generateICS([]);
    expect(ics).not.toContain('BEGIN:VEVENT');
  });
});

// ─── downloadICS ────────────────────────────────────────────────────────────

describe('downloadICS', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.fn>;
  let appendChildSpy: ReturnType<typeof vi.fn>;
  let removeChildSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:fake-url');
    revokeObjectURL = vi.fn();
    clickSpy = vi.fn();
    appendChildSpy = vi.fn();
    removeChildSpy = vi.fn();

    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click: clickSpy,
    } as unknown as HTMLAnchorElement);

    vi.spyOn(document.body, 'appendChild').mockImplementation(appendChildSpy);
    vi.spyOn(document.body, 'removeChild').mockImplementation(removeChildSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('creates a Blob with text/calendar content type', () => {
    const BlobSpy = vi.spyOn(global, 'Blob');
    downloadICS('test.ics', 'ICS_CONTENT');
    expect(BlobSpy).toHaveBeenCalledWith(['ICS_CONTENT'], { type: 'text/calendar;charset=utf-8' });
  });

  it('sets the download attribute to the given filename', () => {
    const anchor = { href: '', download: '', click: clickSpy } as unknown as HTMLAnchorElement;
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);
    downloadICS('my-project.ics', 'ICS_CONTENT');
    expect(anchor.download).toBe('my-project.ics');
  });

  it('programmatically clicks the anchor element', () => {
    downloadICS('test.ics', 'ICS_CONTENT');
    expect(clickSpy).toHaveBeenCalledOnce();
  });

  it('revokes the object URL after clicking', () => {
    downloadICS('test.ics', 'ICS_CONTENT');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });
});

// ─── Integration: project milestone export ──────────────────────────────────

describe('generateICS – milestone export (integration)', () => {
  const milestones = [
    { id: 'm1', title: 'Design mockups', description: 'Create designs', dueDate: '2025-12-20' },
    { id: 'm2', title: 'Frontend dev', description: undefined, dueDate: '2025-12-30' },
    { id: 'm3', title: 'No date milestone', description: 'No dueDate', dueDate: undefined },
  ];

  it('skips milestones with missing dates', () => {
    const events = milestones
      .filter((m) => m.dueDate)
      .map((m) => ({
        uid: `milestone-${m.id}@agenticpay`,
        summary: `My Project — ${m.title}`,
        description: m.description ?? undefined,
        start: new Date(m.dueDate!),
      }));

    const ics = generateICS(events);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2);
    expect(ics).not.toContain('No date milestone');
  });

  it('includes all valid milestone events with correct UIDs', () => {
    const events = milestones
      .filter((m) => m.dueDate)
      .map((m) => ({
        uid: `milestone-${m.id}@agenticpay`,
        summary: `My Project — ${m.title}`,
        description: m.description ?? undefined,
        start: new Date(m.dueDate!),
      }));

    const ics = generateICS(events);
    expect(ics).toContain('UID:milestone-m1@agenticpay');
    expect(ics).toContain('UID:milestone-m2@agenticpay');
  });

  it('returns an empty VCALENDAR when all milestones lack dates', () => {
    const events = milestones
      .filter((m) => m.dueDate && !isNaN(new Date(m.dueDate).getTime()))
      .filter(() => false); // force empty

    const ics = generateICS(events);
    expect(ics).not.toContain('BEGIN:VEVENT');
    expect(ics).toContain('BEGIN:VCALENDAR');
  });
});
