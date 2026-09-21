# Date2Cal — working notes for Claude

Thunderbird add-on (manifest v3) that detects dates/times in email and offers
to create calendar events from them via Thunderbird's own New Event dialog.
See `ARCHITECTURE.md` for the full design; this file is quick orientation for
making changes.

## Layout

```
src/detect/          detection engine (pure JS, no messenger/browser calls)
  index.js           detectEvents() -- the single entry point
  structured.js       Layer 1: .ics / JSON-LD
  prose.js            Layer 2: chrono-node over free text
  rules.js             Layer 3: custom chrono parsers/refiners
  date-lists.js        "Month D1, D2" list pre-pass
  filters.js            false-positive rejection + dedup
  details.js             title/location/video-link extraction
  recurrence.js            RRULE + label detection
  rank.js                    confidence scoring/sorting
src/settings.js       shared storage.local defaults + getSettings()
src/i18n.js           data-i18n="" -> browser.i18n.getMessage() for HTML pages

src/background/       background scripts (manifest "background.scripts")
  content-script-injector.js   registers/injects the highlight bundle
  context-menu.js              "Create event from selection"
  message-router.js            runtime.onMessage dispatch

src/content/highlight/  inline highlighter, BUNDLED before use
  dom-text-walker.js    flat-text <-> DOM range mapping
  tag-dates.js          runs detectEvents() against the flat text, wraps matches
  highlight.js          entry point; bundled to bundle/highlight.bundle.js

src/popup/             message-toolbar button popup
  popup.html/css/js     candidate list UI
  mail-context.js       message body/attachment/metadata extraction
  create-event.js       jCal payload + calendar.items.createWithDialog

src/options/           options page (writes the src/settings.js defaults)

experiments/calendar-bridge/  Thunderbird Experiment API (privileged, reaches
                               into resource:///modules/calendar/*)
  utils.sys.mjs          shared helpers, loaded via a resource:// substitution
  parent/{calendars,items,timezones}.js
  child/timezones.js
  schema/*.json           WebExtension schema for each namespace

tests/                 mocha + chai, run under plain Node (jsdom for DOM tests)
  fixtures/corpus.js    golden corpus (see ARCHITECTURE.md)
```

## Build

Content-script changes need a rebuild before they take effect:
`npm run bundle-content-script` (or `npm run dev` to watch). Everything else
(`src/background/`, `src/popup/`, `src/options/`) loads as plain ES modules
with no bundling step. `npm install` regenerates `dependencies/chrono-en.js`
and the content-script bundle via the `prepare` hook. See `BUILD.md`.

## Key rules

- **The golden corpus is the spec.** `tests/corpus.test.js` gates on
  precision/recall >= 0.95 against `tests/fixtures/corpus.js`. Any detection
  change should be run against `npm test` before considering it done; a
  passing corpus doesn't mean "good enough to skip a targeted unit test" and
  a failing corpus is a real regression, not noise to relax.
- **English-only detection, on purpose.** No language auto-detection for
  date grammar; `dateOrder` (MDY/DMY) is an explicit setting, never guessed
  from text. This was a deliberate, previously-litigated choice -- don't
  reintroduce language detection to "improve" ambiguous-date handling.
- **`referenceDate` is the message's Date: header, never `Date.now()`.**
  Relative expressions ("tomorrow", "next Monday") must resolve against when
  the mail was sent, not when it's read.
- **Content scripts have no `messenger` access.** `src/content/highlight/`
  gets everything it needs (subject, reference date, settings, .ics texts)
  via `browser.runtime.sendMessage({action: 'getDetectionContext'})` to
  `src/background/message-router.js`, which calls into `src/popup/
  mail-context.js`. Don't reach for `messenger.*` directly from content-
  script code -- it throws.
- **Detected events are never saved silently.** Every path (inline
  highlight click, popup row click, context-menu selection) ends at
  `calendar.items.createWithDialog`, which opens Thunderbird's own New Event
  dialog for the user to review/edit/cancel. Don't add a code path that
  calls `calendar.items.create` directly for a detected/inferred event.
- **jCal date-time values are ISO-8601 strings, not arrays.** See
  `src/popup/create-event.js` and `tests/create-event.test.js` -- this is a
  real bug this project hit once already (Thunderbird's ICAL.js slices
  fixed character positions out of the string).
- **DOM highlighting must keep offsets in the same coordinate space as the
  text detection actually ran against.** `src/content/highlight/
  dom-text-walker.js` builds a flat-text view and range table specifically
  so match indices from `detectEvents()` map back to real DOM positions;
  don't reintroduce a separate plain-text fetch + `indexOf()` re-anchoring
  step. Wrap matches back-to-front (highest index first) since wrapping
  mutates the DOM and invalidates not-yet-processed ranges otherwise.
- **The Experiment API surface in `experiments/calendar-bridge/` must stay
  stable.** It mirrors `messenger.calendar.calendars` / `calendar.items` /
  `calendar.timezones` as consumed by `src/popup/` and `src/background/`;
  changing a function name/shape there means updating every caller and the
  schema JSON together.
- **`calendar_calendars` and `calendar_items` each own their
  `resource://experiments-calendar-<uuid>/` substitution independently**
  (registered in `onStartup`, torn down in `onShutdown`). Don't reintroduce
  a shared "one experiment registers it for the others" dependency -- that
  was a fragile startup-ordering bug in an earlier version of this add-on.
- **Build explicit `calIObserver` objects**, not `cal.createAdapter()` --
  removed in Thunderbird >=148. See `makeCalendarObserver()` in
  `experiments/calendar-bridge/utils.sys.mjs`.
