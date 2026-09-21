# Architecture

Date2Cal is a Thunderbird MailExtension (manifest v3) with two main parts:
a date/time **detection engine** that runs entirely in JavaScript with no
Thunderbird API access, and a thin **UI + Experiment API bridge** layer that
gets detected dates in front of the user and hands them to Thunderbird's own
calendar UI.

## Detection engine (`src/detect/`)

`detectEvents({subject, body, referenceDate, ...})` in `src/detect/index.js`
is the single entry point, used by the toolbar popup, the inline highlighter,
and the "create event from selection" context menu. It runs three layers in
order, returning as soon as one produces results:

1. **Structured data** (`structured.js`) — a hand-written reader for
   `text/calendar` (.ics) attachments and schema.org `Event` JSON-LD markup
   in an HTML body. Most real invites (Outlook, Google Calendar, Zoom,
   Teams, Webex, Eventbrite, airlines) ship one of these. When present,
   there's nothing left to infer, so these results are marked
   `confidence: 'exact'` and short-circuit the rest of the pipeline.

2. **Prose parsing** (`prose.js`) — [chrono-node](https://github.com/wanasit/chrono)
   (English build only, vendored into `dependencies/chrono-en.js`) over
   free-text. English-only is a deliberate choice: guessing the input
   language to pick a date grammar is a much larger source of wrong dates
   than just committing to one language and letting the user set date order
   explicitly via the options page.

3. **Custom rules** (`rules.js`) — chrono-node parsers/refiners for the
   handful of real-world phrasings chrono doesn't cover on its own: a bare
   hour 1-7 defaulting to PM in business contexts, bare ordinal days ("the
   23rd"), EOD/COB shorthand, spelled-out clock fractions ("quarter past
   three"), duration cues setting an end time ("30-min sync"), and
   collapsing a value restated in a second timezone into one event.

Two more passes run alongside prose parsing:

- `date-lists.js` recognizes "Month D1, D2[, ...]" shorthand ("Oct 14, 21")
  as a pre-pass, since a single chrono match can only ever produce one date
  and this pattern needs to produce several.
- `filters.js` drops likely false positives (version numbers, order/tracking
  numbers, copyright lines, anything in the past) and deduplicates
  overlapping matches.

`details.js` pulls a title, location, and video-call link from the text
around a match; `recurrence.js` looks for a nearby recurrence phrase
("every Monday", "daily until Dec 1") and returns an RRULE plus a
human-readable label; `rank.js` scores and sorts the final candidate list
(structured > timed range > timed > date-only).

`src/settings.js` holds the shared `storage.local`-backed options
(`defaultDateOrder`, `defaultCalendarId`, `defaultDurationMinutes`,
`businessHoursMeridiem`) that flow into `detectEvents()` and event creation.

This whole layer is plain JavaScript with no `messenger`/`browser` calls, so
it's tested directly with mocha/chai under Node — see `tests/detect.test.js`
and `tests/corpus.test.js`.

## Golden corpus (`tests/fixtures/corpus.js`)

A fixed set of realistic email subject/body pairs, each labeled `event` (must
produce a candidate, optionally on a specific date) or `none` (must produce
zero candidates). `tests/corpus.test.js` runs `detectEvents()` against every
case and computes recall (fraction of `event` cases that fired) and precision
(fraction of `none` cases that correctly fired nothing), failing the build if
either drops below 0.95. This is the actual specification of "detect enough,
but don't invent events out of newsletters and receipts" — treat a corpus
change as a behavior change, not a text edit.

## UI layer (`src/background/`, `src/content/highlight/`, `src/popup/`, `src/options/`)

- `src/background/` — three background scripts (loaded as ES modules):
  `content-script-injector.js` registers the highlight content script for
  message display and injects it into already-open tabs, with retry/backoff
  in case `messenger.scripting` isn't ready yet on a cold Thunderbird
  launch; `context-menu.js` adds "Create event from selection"; and
  `message-router.js` answers `runtime.onMessage` requests
  (`detectEvents`, `getDetectionContext`, `getTimezone`,
  `createCalendarEvent`) from the popup and content script.

- `src/content/highlight/` — the inline highlighter, injected into every
  message view as a bundled content script (esbuild, `npm run
  bundle-content-script`). `dom-text-walker.js` builds a flat-text view of
  the message body and maps character ranges back to real DOM text nodes,
  so detected match offsets line up exactly with what gets wrapped — no
  re-finding matched strings with `indexOf()`, which mis-anchors whenever
  text repeats or a match spans elements. `tag-dates.js` runs detection
  against that flat text and wraps matches back-to-front (so earlier,
  not-yet-processed ranges stay valid as the DOM mutates), splitting each
  overlapping text node into up to three parts. `highlight.js` wires the
  background message round-trip for context and routes clicks to event
  creation.

- `src/popup/` — the message-toolbar button's popup: a ranked list of every
  candidate found in the current message (`popup.js`/`.html`/`.css`),
  `mail-context.js` (extracts body/HTML/.ics attachments and message
  metadata via `messenger.messages.*`), and `create-event.js` (builds the
  jCal payload and calls `calendar.items.createWithDialog`).

- `src/options/` — the options page, the only writer of the shared
  `storage.local` settings.

## Experiment API bridge (`experiments/calendar-bridge/`)

Thunderbird's WebExtension API doesn't expose calendar read/write access, so
this add-on uses a Thunderbird "Experiment API" — privileged JS that reaches
into `resource:///modules/calendar/*` — to bridge three narrow namespaces:

- `calendar.calendars` — query/get/create/update/remove/synchronize
  calendars, plus onCreated/onUpdated/onRemoved events.
- `calendar.items` — query/get/create/update/move/remove calendar items,
  `createWithDialog` (opens Thunderbird's own "New Event" dialog prefilled,
  instead of writing an item directly), and onCreated/onUpdated/onRemoved/
  onAlarm events.
- `calendar.timezones` — the current default timezone and its change event
  (parent + child scope, since the child/content-script side needs
  `currentZone` without a message round-trip in some contexts).

`utils.sys.mjs` holds the shared helpers (calendar/item serialization, jCal
parsing, and building explicit `calIObserver` objects — Thunderbird ≥148
removed `cal.createAdapter()`, which older code used to build these on the
fly). Both `calendar_calendars` and `calendar_items` register/unregister the
`resource://experiments-calendar-<uuid>/` substitution that lets them import
`utils.sys.mjs`, each independently in their own `onStartup`/`onShutdown` --
neither depends on the other's startup order.

`create-event.js` builds jCal date-time values as ISO-8601 **strings**
(`"2015-01-02T03:04:05Z"`), not arrays of numbers — Thunderbird's own
ICAL.js parses jCal DATE/DATE-TIME values by slicing fixed character
positions out of a string, so an array produces empty slices and a parse
error. This is a real bug this project hit and fixed; `tests/create-event.test.js`
guards it directly against the same jCal shape Thunderbird's ICAL.js expects.
