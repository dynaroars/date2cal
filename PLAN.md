# Plan: Thunderbird "Detect date → create event" add-on

Goal: macOS-Mail-style date detection in Thunderbird. Dates/times in an email are
highlighted inline; one click creates a calendar event. Must be **accurate** (no
silently-wrong dates) and **easy** (one click, no dialog gauntlet).

Approach chosen: **fork `thunderbird_plugin_mail_to_event`**, keep its calendar
Experiment APIs + UI shell, **replace the detection core**.

---

## 1. Why the existing plugin detects nothing (measured, not guessed)

### A. It cannot even install — this alone explains "no dates ever"
`manifest.json` declares `strict_max_version: "152.*"`. Installed Thunderbird is
**154.0** (flatpak `org.mozilla.thunderbird`). Thunderbird refuses to enable the
add-on. Nothing runs.

### B. A fresh clone is missing its own build output
`.gitignore` excludes `dependencies/` and `content_scripts/highlight_dates/bundle/`.
Both are empty in the download. Every module does
`import ... from "../dependencies/extract-date.js"` → module resolution fails →
the background script never loads → silent total failure. `npm install &&
npm run bundle-dependencies` is mandatory and undocumented in the install path.

### C. The detection engine is wrong by design
Locale **and** date direction (MM/DD vs DD/MM) are derived from `franc`
language-guessing the email text. `franc` is unreliable on short strings and on
HTML/CSS-laden bodies. Measured on a real-world sample set (today = 2026-09-18,
timezone America/New_York):

| Input | Current result | Correct |
|---|---|---|
| `Can we sync tomorrow at 3pm?` | **no date found** | Sep 19, 15:00 |
| `Let's meet next Monday at 10am.` | **no date found** | Sep 21, 10:00 |
| `Reminder: 10/06/2026 at 14:00.` | **2026-06-10** (lang guessed `de`→DM) | Oct 6 |
| `Conference runs Oct 6-8, 2026.` | **2026-06-08** | Oct 6 → Oct 8 |
| `Office hours Thursday 2-4 PM.` | **2026-02-04** (parsed "2-4" as a date) | Thu, 14:00–16:00 |
| `Dissertation defense: Monday, September 28, 2026...` | right date, lang guessed `fr` | — |

Silently-wrong dates are worse than misses. Three of six realistic samples
produced a confidently wrong event.

### D. Timezones are faked
`common/format_dates.js` does
`d.setTime(d.getTime() - d.getTimezoneOffset()*60000)` then `.toISOString()`.
The resulting `Z` string is not UTC — it is local wall-clock wearing a UTC
suffix. It happens to round-trip into a `datetime-local` input, so the bug is
invisible in the UI and lands in the saved event.

### E. Brittle body extraction
`current_mail_to_date.js` does `emailBodyTextInline[0].content` with no guard.
Messages with no inline text part throw → the whole popup dies → "no dates found".

### F. Its own tests fail
`npm test`: **14 passing, 2 failing** on the author's fixtures (timezone-dependent
assertions). The suite does not protect the behavior that matters.

---

## 2. Replacement engine: layered, English-only

**Scope decision: English only.** No `franc`, no locale tables, no
`translateChunk`. Date order is fixed **MDY (US)**, configurable in options for
the rare DMY mail. This removes an entire class of bug — the current plugin's
worst failures all trace back to guessing the language.

Bundle impact, measured:

| | Size |
|---|---|
| Current (`extract-date` + `extract-time` + `franc`) | **4.7 MB** |
| chrono-node, all 14 locales | 403 KB |
| **chrono-node, English only** (`chrono-node/en`) | **95 KB** |

A ~50x reduction, verified to parse all the earlier cases identically.

### Detection runs in three layers, most-reliable first

**Layer 1 — Structured event data already in the email (no guessing).**
Most real invites *ship* the event; parsing prose is a fallback, not the
primary path. Check in order and short-circuit on a hit:
1. `text/calendar` MIME part or `.ics` attachment (Outlook, Google Calendar,
   Zoom, Teams, Webex invites all carry one) → read `DTSTART`/`DTEND`/`SUMMARY`/
   `LOCATION`/`RRULE` directly. 100% accurate.
2. JSON-LD / schema.org microdata in HTML bodies (`@type: Event`,
   `EventReservation`, `FlightReservation`) — Eventbrite, airlines, OpenTable,
   ticketing sites embed these. Also exact.

This is the single largest accuracy win available and carries near-zero risk:
when present, there is nothing to infer.

**Layer 2 — chrono-node (English) for prose.** Handles the whole natural-language
surface: `tomorrow at 3pm`, `next Monday`, `Oct 6-8`, `in 2 weeks`,
`Thursday 2-4 PM`, `2026-10-06T14:00`, `4.30pm on 22 Oct`.

**Layer 3 — custom parsers/refiners for the gaps chrono leaves.** Measured
failures on real email phrasing, and the fix for each — **all prototyped and
passing** in ~30 lines of `parsers`/`refiners`:

| Input | chrono alone | With custom rules |
|---|---|---|
| `Meeting on the 23rd at 4` | drops "the 23rd", **4 AM** | Sep 23, **16:00** |
| `10/6 at 2` | **2 AM** | Oct 6, **14:00** |
| `Please submit by EOD Thursday` | no time | Thu **17:00** |
| `30-min sync Tuesday 2pm` | no end | 14:00–**14:30** |
| `2-hour workshop on Oct 6 at 10am` | no end | 10:00–**12:00** |
| `Oct 6, 2026, 2-3:30pm ET` *(guard)* | correct | **unchanged** |
| `Meeting tomorrow at 9am` *(guard)* | correct | **unchanged, 9 AM** |

The rules to implement:
- **Business-hours meridiem refiner.** A bare hour 1–7 with no am/pm in a
  meeting context means PM. Must skip results where `isCertain('meridiem')` —
  the two guard rows above verify explicit times are untouched.
- **Bare ordinal day-of-month parser** — `on the 23rd`.
- **`EOD` / `EOW` / `COB` parser** → 17:00.
- **Duration-cue refiner** — `30-min`, `2-hour`, `quick 15 min` within ±40 chars
  of the match sets `end` when no explicit end exists.
- **`half past three`, `quarter to four`** spelled-out clock times.
- **Duplicate-timezone merge** — `11am PST / 2pm EST` currently yields a
  **spurious second event**; collapse to one.
- **Split-mention merge** — `in two weeks on Friday` returns two results; merge
  adjacent partial results into one.
- **Recurrence parser** — `every Monday`, `weekly`, `first Tuesday of the month`
  → emit an `RRULE` (see Phase 3a).

### Extras pulled from the surrounding text
- **Location & video link** — `Room 4705`, street addresses, and
  Zoom/Teams/Meet/Webex URLs → `LOCATION` (and `URL`). Layer 1 gives these for
  free when an `.ics` is present.
- **Smart title** — derive from the sentence containing the date; strip
  `Re:`/`Fwd:` noise; fall back to the subject.
- **Duration cues** — as above, instead of a blind default.
- **Recurrence** — real `RRULE`, not a single event.

## 3. Implementation phases

### Phase 0 — Make it run at all (unblocks everything)
1. Fork the repo into a new project dir; `git init`, commit the upstream tree as
   the base commit so the diff is reviewable.
2. `manifest.json`: set `strict_min_version: "140.0"` (current ESR), **remove**
   `strict_max_version` so it survives monthly releases.
3. Add a `postinstall`/`setup` script and README steps so `dependencies/` and the
   content-script bundle are always built before load. Commit the built bundles
   (they are review-visible vendored sources, not secrets).
4. Establish the dev loop: Thunderbird → Add-ons → gear → *Debug Add-ons* →
   **Load Temporary Add-on** → pick `manifest.json`. Experiments require a
   restart on each reload; script that as `npm run reload`.
5. **Checkpoint:** toolbar button appears on an open message and the popup opens
   without console errors.

### Phase 1 — New detection core (the heart of the work)
6. `npm rm @louis.jln/extract-date @louis.jln/extract-time franc`,
   `npm i chrono-node`. Bundle **English only**: entry point re-exports from
   `chrono-node/en` → `dependencies/chrono-en.js`, esm, unminified. **95 KB**
   (verified) replacing 4.7 MB. Delete `franc_locale_to_extract_date_locale.js`,
   `import/default-date.js`, `import/default-time.js`.
7. Rewrite `common/find_dates.js` as a layered pipeline with one entry point:
   `detectEvents(message, { referenceDate, timezone, dateOrder })` returning a
   ranked `EventCandidate[]`.
   - `referenceDate` = the message's `Date:` header (`messenger.messages.get(id).date`),
     **not** `Date.now()` — mail read a week late must still resolve "tomorrow".
   - `dateOrder` = `'MDY'` default, from options. **Never** language-guessed.
   - `timezone` from `messenger.calendar.timezones.currentZone`.
8. **Layer 1 — structured extraction** (`common/extract_structured.js`), tried first:
   - `messenger.messages.listAttachments()` / `getFull()` → find `text/calendar`
     parts and `.ics` attachments; parse with **ical.js** (already available to
     the experiment as `resource:///modules/calendar/Ical.sys.mjs`, so no new
     dependency in the parent context) → `DTSTART`, `DTEND`, `SUMMARY`,
     `LOCATION`, `DESCRIPTION`, `RRULE`, `ORGANIZER`.
   - Scan HTML bodies for `<script type="application/ld+json">` and
     schema.org microdata → `Event` / `EventReservation` / `FlightReservation`.
   - A Layer-1 hit is marked `confidence: 'exact'` and **short-circuits** Layers
     2–3. This is the highest-value, lowest-risk step in the whole plan.
9. **Layer 2 — chrono** (`common/parse_prose.js`): build one configured
   `chrono.en.casual.clone()` instance, reused across calls.
10. **Layer 3 — custom parsers/refiners** (`common/chrono_rules.js`), each rule
    its own small exported unit with its own tests:
    `businessHoursMeridiem`, `bareOrdinalDay`, `eodEowCob`, `durationCue`,
    `spelledOutClock`, `mergeDuplicateTimezones`, `mergeSplitMentions`.
    The prototype for the first four is already validated — port it as-is.
11. **Noise filter** (`common/filter_noise.js`) — what keeps precision high:
    - Strip quoted replies (`> `, `On <date>, <person> wrote:`) and signatures.
      *(Verified need: chrono happily returns the `Sep 1, 2026` out of a reply header.)*
    - Strip `<style>`/`<script>` before text extraction.
    - Drop matches inside URLs, message-IDs, tracking numbers, version strings
      (`version 10.2`), order quantities, copyright lines, unsubscribe footers.
    - Drop all past dates relative to the reference date, even year-qualified
      ones (`March 3, 2021` in a newsletter is a reference to the past, not an
      event to add) — the original "unless year-qualified" exception was
      tested against a newsletter sample and let exactly that through.
    - Deduplicate overlapping spans, preferring the longest.
12. **Confidence scoring + ranking** (`common/rank.js`): `exact` (Layer 1) >
    explicit date+time range in body > date+time > bare date > bare weekday.
    The top-ranked candidate is what the one-click path uses.
13. **Extras** (`common/extract_details.js`): location (`Room \d+`, street
    addresses), video-call URLs (Zoom/Teams/Meet/Webex), and smart title from the
    sentence containing the match with `Re:`/`Fwd:` stripped. Subject is the fallback.
14. Default duration policy: explicit end → use it; duration cue → use it; time
    but no end → **1 hour**; no time → all-day. (Current code's "round to next
    half hour" rule produces odd 09:00–09:30 events.)

### Phase 2 — Body extraction that doesn't fall over
13. Rewrite `getCurrentMailDates()`:
    - Guard `listInlineTextParts()` — handle empty/missing parts.
    - Prefer `text/plain`; fall back to `text/html` →
      `messengerUtilities.convertToPlainText`; fall back to the subject alone.
    - Never let one failure kill the popup — catch, log, degrade.
14. Parse **subject and body separately**, tagging the source, so a date in the
    subject can be ranked above body noise.

### Phase 3 — The three UI surfaces (all three requested)

Simplified by the Phase 4 design change: since the native dialog already
provides the calendar picker, timezone, all-day toggle, recurrence editor, and
location/description fields, **no surface needs its own event-editing form**.
Each surface's job shrinks to *detect → (disambiguate if needed) → open the
native dialog*. `common/event_form.js`, `calendar_selector.js`,
`timezone_selector.js`, `all_day_toggle.js`, `date_range_sync.js`, and
`create_event_result.js` are mostly dead code once Phase 4 lands — drop them
rather than port them, keeping only whatever this turns out to still need for
Phase 3's disambiguation step.

15. **Inline highlight (primary, macOS-like).** Rewrite
    `content_scripts/highlight_dates/tag_dates.js` to wrap matches using chrono's
    `index`/`text` offsets via a TreeWalker over text nodes — replacing the
    current `indexOf(originalText)` search, which mis-anchors whenever the date
    text repeats or spans elements. Style as a subtle dotted underline. Click on
    a highlighted date → call `calendar.items.createWithDialog(...)` directly
    with that candidate. No intermediate custom popup — one click, native
    dialog, exactly the macOS-Mail feel.
16. **Toolbar button popup.** Keep `message_display_action`, but slim it down to
    a plain ranked list of detected candidates (one line each: date, time,
    snippet of surrounding text). Clicking a row opens the native dialog for
    that candidate. This is also the fallback when inline highlighting can't
    attach to the message's DOM.
17. **Context menu on selection.** Add `menus` permission +
    `messenger.menus.create({contexts:["selection"]})` → "Create event from
    selection"; parse the selected text with the message date as reference, then
    open the native dialog directly (selection is unambiguous — no candidate
    list needed). This is the escape hatch when detection misses.

### Phase 3a — Recurrence (RRULE)
Folded in after the core is proven, since it is the largest extra:
- Recurrence parser for `every Monday`, `weekly`, `every other Tuesday`,
  `first Tuesday of the month`, `daily until Dec 1`.
- Emit `RRULE` into the jCal `vevent`; Layer 1 passes through any `RRULE` the
  `.ics` already contains.
- UI: a plain-English recurrence line ("Repeats weekly on Monday") with a
  one-click toggle to create a single occurrence instead. Never silently create
  an infinite series.

### Phase 4 — Event creation via the native dialog (design change)

**Decided (superseding the earlier "direct create + undo toast"):** hand the
detected event to Thunderbird's own **New Event dialog**, prefilled, instead of
writing it silently. The user sees and can change time/date/calendar/location/
etc. before anything is saved — the review step this repo asked for — and we
get Thunderbird's own save/cancel/undo/recurrence-editor UI for free instead of
reimplementing it.

**How, confirmed against the installed Thunderbird 154 build
(`omni.ja` → `chrome/calendar/content/calendar-item-editing.js` +
`chrome/calendar/content/calendar-extract.js`):**

- Thunderbird already ships exactly this pattern natively — a "Create Event"/
  "Create Task" message context-menu entry and an "Add to Calendar" toolbar
  button (`add-to-calendar-button.mjs`), both calling
  `calendarExtract.extractFromEmail()`, which builds a `CalEvent`, fills in a
  guessed start/end, and calls:
  ```js
  createEventWithDialog(calendar, startDate, endDate, summary, item, forceAllDay)
  ```
  `createEventWithDialog` is defined in `calendar-item-editing.js`, loaded as a
  plain (non-ESM) global into the main 3-pane window and the message-view
  windows (`messenger.xhtml`, `messageWindow.xhtml`, `aboutMessage.xhtml`) —
  reachable from an Experiment via
  `Services.wm.getMostRecentWindow("mail:3pane").createEventWithDialog(...)`.
  It opens the real `chrome://calendar/content/calendar-event-dialog.xhtml`
  window in "new" mode with the given `CalEvent` as a template; the dialog's own
  Save button drives `doTransaction("add", item, calendar, ...)` — Thunderbird's
  normal save path, including its own undo stack.
- **Thunderbird's native extractor (`calExtract.sys.mjs`, 1420 lines) is
  regex + locale-property-file based** — the same class of design as the
  broken plugin's `extract-date`, just older. It's why the built-in feature
  exists but isn't reliably accurate either. The value this project adds is
  strictly the **detection engine** (Phases 1–3a); the review-dialog UX is
  Thunderbird's own, already correct, and not worth rebuilding.
19. Add one function to `experiments/calendar/parent/ext-calendar-items.js` (or
    a new small experiment), e.g. `calendar.items.createWithDialog(calendarId,
    jcalItem)`, that: resolves the calendar, builds a `CalEvent` from our
    detected candidate (title, start, end, all-day, location, description,
    RRULE if any), and calls `createEventWithDialog` on the most recent
    `mail:3pane` window as above.
20. `create_calendar_event.js` becomes the caller of that new function instead
    of `calendar.items.create` — no direct silent write, no undo toast needed
    (Thunderbird's own dialog and undo stack cover it).
21. Remember last-used calendar in `storage.local` (partly present) purely to
    **pre-select** it in the dialog's calendar picker — the user can still
    change it there before saving.

**Note:** since the dialog itself now owns save/cancel, `messenger.calendar.
items.remove` (Phase 5 corpus item) is no longer needed for an undo toast, but
keep it available for a later "recent events" quick-undo if wanted.

### Phase 5 — Accuracy harness (this is what makes it "very accurate")
22. Build a **golden corpus**: ~60–100 real English email snippets in
    `tests/corpus/*.json`, each `{text, referenceDate, timezone, expected[]}`.
    Seed it from your own mail — meeting invites (with and without `.ics`),
    seminar announcements, appointment confirmations, newsletters (which must
    yield **zero** events), receipts, shipping notices, version-release mail.
    Include the adversarial cases already found: `version 10.2`,
    `12/19 items shipped`, `Thursday 2-4 PM`, quoted reply headers.
23. Test runner reports **precision and recall separately**, and **per layer** —
    so a Layer-1 regression is never masked by Layer-2 luck. A false positive on
    a newsletter is a worse failure than a miss; track them apart.
24. Fix the 2 currently-failing tests by pinning `TZ` in the test runner; keep the
    upstream cases that still encode correct behavior, delete the ones asserting
    the fake-UTC output.
25. Regression gate: `npm test` must hold precision ≥ 0.95 before any release.

### Phase 6 — Polish
26. i18n scaffolding via `_locales/en/` for **UI strings only** — detection is
    English-only by decision, but the add-on review guidelines still want strings
    externalized, and it costs little now.
27. Options page: date order (MDY/DMY), default calendar, default duration,
    business-hours-meridiem toggle, toggle inline highlighting.
28. `npm run lint` (webext-linter) clean; rebuild the XPI via `npm run build`.
29. Update README with the real install steps, including the build prerequisite
    that upstream omits.

---

## 4. Risks

- **Experiment APIs are version-fragile.** `experiments/calendar/parent/*.js`
  reach into `resource:///modules/calendar/*` internals. These can break on any
  Thunderbird update, and you are on the *standard* release (154), not ESR — the
  project's own skill file recommends targeting ESR when using Experiments.
  Mitigation: wrap every experiment call in try/catch with a visible error, and
  keep an ICS-export fallback path in reserve. **Lower risk than a from-scratch
  jCal writer**, though: `createEventWithDialog` (Phase 4) is the exact function
  Thunderbird's own "Create Event from message" feature calls — it's a
  maintained, first-party code path, not a private internal we're the only
  caller of.
- **`createEventWithDialog` is a plain global, not an ESM export** — it's loaded
  as a `<script>` into specific chrome windows (`messenger.xhtml`,
  `messageWindow.xhtml`, `aboutMessage.xhtml`), reached via
  `Services.wm.getMostRecentWindow("mail:3pane")`. Verify a message-view popup
  window also exposes it before relying on this path from every surface in
  Phase 3 — fall back to the main 3-pane window's instance if a given window
  doesn't have its own.
- **Recall vs precision tension.** Aggressive detection creates junk events from
  newsletters. The corpus in Phase 5 is what keeps this honest; resist tuning
  recall without re-running it.
- **Custom refiners can regress explicit cases.** The business-hours meridiem
  rule in particular rewrites hours. Every rule ships with a guard test proving
  it leaves explicitly-qualified times alone (`tomorrow at 9am` must stay 9 AM).
- **Recurrence is a footgun.** A wrong `RRULE` spams the calendar indefinitely.
  Always show the plain-English recurrence and offer single-occurrence creation.

## 5. Suggested order

Phase 0 → 1 → 2 → 5 (corpus early, so Phase 1 is verifiable) → 3 → 4 → 3a → 6.

Within Phase 1, do **Layer 1 (structured) before Layer 2/3**. If a large share of
the mail you care about carries `.ics` parts, Layer 1 alone may cover most of
your real usage with zero parsing risk — worth measuring before investing in
the refiner work.

Phases 0–2 should already give working, correct detection. Stop and test on real
mail there before building out all three UI surfaces. Recurrence (3a) is
deliberately last — it is the biggest extra and the easiest to get wrong.
