# Calendar export (#65)

The project detail page exposes an **Add to Calendar** button that downloads an
`.ics` file containing the project's deadlines so they can be added to Google,
Apple or Outlook calendars.

## Pieces

| Module | Responsibility |
|--------|----------------|
| `frontend/lib/generateICS.ts` | RFC 5545 serialisation: escaping, line folding, all-day/timed events, `downloadICS` |
| `frontend/lib/project-calendar.ts` | Turns a project into events: milestone due dates plus the project deadline, with stable UIDs |

Both the default and localized project pages call
`buildProjectCalendarEvents`, so the two routes no longer drift (they previously
emitted different `UID`s and descriptions for the same milestone, and only one of
them requested all-day events — a flag the generator used to ignore).

## What gets exported

- **One event per milestone due date** — `UID`
  `agenticpay-project-<projectId>-milestone-<milestoneId>@agenticpay`.
- **One event for the project deadline** — `UID`
  `agenticpay-project-<projectId>-deadline@agenticpay`. It is skipped when a
  milestone already falls on that same UTC day, because the contract currently
  maps the project deadline onto a single milestone and duplicating it would
  clutter the calendar.

UIDs are stable across exports, so re-importing updates existing entries instead
of creating duplicates.

## RFC 5545 details

- **TEXT escaping (§3.3.11).** `\`, `;`, `,` and newlines in
  `SUMMARY`/`DESCRIPTION`/`LOCATION` are escaped. Without this a title such as
  `Redesign, phase 2` is truncated by most clients.
- **Line folding (§3.1).** Content lines longer than 75 octets are folded with
  CRLF + a single space, and multi-byte UTF-8 characters are never split.
- **All-day events.** Due dates are dates, not instants, so they are emitted as
  `DTSTART;VALUE=DATE:YYYYMMDD` with an **exclusive** `DTEND` on the following
  day. Pass `allDay: false` for timed events (default duration one hour).
- **Invalid input is skipped.** Events with missing/unparseable dates, UIDs or
  summaries are dropped rather than emitting `NaN` fields, which would make the
  entire calendar unparseable.
- **CRLF line endings**, `VERSION:2.0`, `CALSCALE:GREGORIAN`, `METHOD:PUBLISH`
  and a `PRODID`.

## Tests

`frontend/lib/__tests__/generateICS.test.ts` covers escaping, folding,
all-day/timed rendering, invalid input and the envelope.

`frontend/lib/__tests__/project-calendar.test.ts` covers event building, the
deadline milestone deduplication rule, filenames and the end-to-end
project-to-`.ics` path (including titles containing commas).
