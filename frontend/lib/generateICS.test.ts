import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateICS, downloadICS } from './generateICS';

describe('generateICS', () => {
  it('produces valid ICS envelope', () => {
    const ics = generateICS([]);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('PRODID:-//AgenticPay//Calendar Export//EN');
  });

  it('generates a VEVENT for each event', () => {
    const ics = generateICS([
      { uid: 'evt-1@test', summary: 'Milestone A', start: new Date('2026-01-15T00:00:00Z') },
      { uid: 'evt-2@test', summary: 'Milestone B', start: new Date('2026-02-01T00:00:00Z') },
    ]);
    const beginCount = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
    const endCount = (ics.match(/END:VEVENT/g) ?? []).length;
    expect(beginCount).toBe(2);
    expect(endCount).toBe(2);
  });

  it('includes UID, SUMMARY, DTSTART, DTEND in each event', () => {
    const ics = generateICS([
      { uid: 'u1@ap', summary: 'Test Event', start: new Date('2026-03-10T00:00:00Z') },
    ]);
    expect(ics).toContain('UID:u1@ap');
    expect(ics).toContain('SUMMARY:Test Event');
    expect(ics).toContain('DTSTART:20260310T000000Z');
    // default end = start + 1 day
    expect(ics).toContain('DTEND:20260311T000000Z');
  });

  it('uses provided end date when supplied', () => {
    const ics = generateICS([
      {
        uid: 'u2@ap',
        summary: 'Ranged Event',
        start: new Date('2026-04-01T00:00:00Z'),
        end: new Date('2026-04-03T00:00:00Z'),
      },
    ]);
    expect(ics).toContain('DTEND:20260403T000000Z');
  });

  it('includes DESCRIPTION when provided', () => {
    const ics = generateICS([
      {
        uid: 'u3@ap',
        summary: 'With Desc',
        start: new Date('2026-05-01T00:00:00Z'),
        description: 'Some details here',
      },
    ]);
    expect(ics).toContain('DESCRIPTION:Some details here');
  });

  it('omits DESCRIPTION when not provided', () => {
    const ics = generateICS([
      { uid: 'u4@ap', summary: 'No Desc', start: new Date('2026-05-01T00:00:00Z') },
    ]);
    expect(ics).not.toContain('DESCRIPTION:');
  });

  it('escapes newlines in description', () => {
    const ics = generateICS([
      {
        uid: 'u5@ap',
        summary: 'Multi-line',
        start: new Date('2026-06-01T00:00:00Z'),
        description: 'Line1\nLine2',
      },
    ]);
    expect(ics).toContain('DESCRIPTION:Line1\\nLine2');
  });

  it('uses CRLF line endings (RFC 5545)', () => {
    const ics = generateICS([
      { uid: 'u6@ap', summary: 'CRLF Check', start: new Date('2026-07-01T00:00:00Z') },
    ]);
    expect(ics).toContain('\r\n');
  });

  it('produces no duplicate UIDs for distinct events', () => {
    const events = [
      { uid: 'a@ap', summary: 'A', start: new Date('2026-01-01T00:00:00Z') },
      { uid: 'b@ap', summary: 'B', start: new Date('2026-02-01T00:00:00Z') },
    ];
    const ics = generateICS(events);
    const uids = [...ics.matchAll(/^UID:(.+)$/gm)].map((m) => m[1]);
    expect(new Set(uids).size).toBe(uids.length);
  });

  it('returns only the envelope for an empty events array', () => {
    const ics = generateICS([]);
    expect(ics).not.toContain('BEGIN:VEVENT');
  });
});

describe('downloadICS', () => {
  beforeEach(() => {
    // Stub browser APIs not present in jsdom
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    });
  });

  it('creates a link element and triggers download', () => {
    const clickSpy = vi.fn();
    const createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockReturnValue({ href: '', download: '', click: clickSpy } as unknown as HTMLAnchorElement);

    downloadICS('export.ics', 'BEGIN:VCALENDAR\r\nEND:VCALENDAR');

    expect(createElementSpy).toHaveBeenCalledWith('a');
    expect(clickSpy).toHaveBeenCalledOnce();

    createElementSpy.mockRestore();
  });

  it('sets the correct filename on the anchor element', () => {
    const anchor = { href: '', download: '', click: vi.fn() } as unknown as HTMLAnchorElement;
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);

    downloadICS('my-project.ics', 'BEGIN:VCALENDAR\r\nEND:VCALENDAR');

    expect(anchor.download).toBe('my-project.ics');

    vi.restoreAllMocks();
  });

  it('revokes the object URL after triggering download', () => {
    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click: vi.fn(),
    } as unknown as HTMLAnchorElement);

    downloadICS('export.ics', 'BEGIN:VCALENDAR\r\nEND:VCALENDAR');

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    vi.restoreAllMocks();
  });
});
