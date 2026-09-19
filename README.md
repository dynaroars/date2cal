# Detect Calendar Event — Thunderbird add-on

Detects dates and times in an email and turns them into calendar events with one
click, the way macOS Mail does.

Fork of [LouisJULIEN/thunderbird_plugin_mail_to_event](https://github.com/LouisJULIEN/thunderbird_plugin_mail_to_event)
(BSD-3-Clause) at `984800f`. The calendar Experiment API is upstream's, extended
with one new function; the detection engine and UI were rewritten. See `../PLAN.md`
for the full rationale and phase-by-phase history.

**English only** by design — no language auto-detection. Detection runs in three
layers (structured `.ics`/JSON-LD data, then chrono-node prose parsing, then a
handful of custom rules for gaps in real phrasing) — see `PLAN.md` section 2.

## Features

- **Three ways to create an event**: click a highlighted date inline in the
  message, use the calendar button in the message toolbar (a ranked list of
  everything detected), or select any text and right-click → "Create event
  from selection".
- Every path opens **Thunderbird's own New Event dialog**, prefilled — you see
  and can change the time, date, calendar, location, etc. before anything is
  saved. Nothing is ever written silently.
- Recognizes recurring events ("every Monday", "weekly", "daily until Dec 1")
  and video-call links (Zoom/Teams/Meet/Webex).
- **Options page** (Tools → Add-ons → this add-on → Preferences): default
  calendar, default event length, date order (MDY/DMY) for numeric dates, a
  toggle for whether a bare hour like "at 4" means 4 PM, and a toggle for
  inline highlighting.

## Requirements

- Thunderbird **140–165** (developed against 154)
- Node.js 20+

`manifest.json` pins `strict_max_version: "165.*"`. Thunderbird's add-on linter
*requires* a `strict_max_version` on any add-on shipping Experiment APIs, because
experiments reach into internals (`resource:///modules/calendar/*`) that can
change in any release. Upstream pinned `152.*`, which is why the original add-on
silently refused to install on current Thunderbird. When Thunderbird passes 165,
bump this one line and re-test the experiment — do not simply delete it.

## Build

```bash
npm install     # `prepare` hook builds dependencies/ and the content-script bundle automatically
```

> **Important:** the add-on will *not* work from a bare checkout. `dependencies/`
> and `content_scripts/highlight_dates/bundle/` are generated and gitignored; every
> module imports from them. Skipping the build makes the background script fail to
> load with no visible error — this is the single most common way to get "no dates
> are ever detected". The `prepare` hook exists so a plain `npm install` is enough.

Rebuild after changing source:

```bash
npm run setup   # one-shot rebuild
npm run dev     # watch + rebuild on change
```

## Install into Thunderbird (temporary, for development)

1. Thunderbird → **Tools → Developer Tools → Debug Add-ons**
   (or go to `about:debugging#/runtime/this-firefox`)
2. **Load Temporary Add-on…**
3. Select this directory's `manifest.json`

The add-on is removed when Thunderbird closes — reload it after each restart.

> **Experiment APIs require a full Thunderbird restart to pick up changes.**
> Reloading the temporary add-on is enough for plain JS/HTML/CSS edits, but any
> change under `experiments/` needs Thunderbird restarted.

### Flatpak Thunderbird

The flatpak sandbox cannot read `~/git` by default, so *Load Temporary Add-on*
will not see this directory. Grant read-only access once:

```bash
flatpak override --user \
  --filesystem=/home/tnguyen/git/projects/tbird_detect_cal_event:ro \
  org.mozilla.thunderbird
```

Undo with `flatpak override --user --reset org.mozilla.thunderbird`.

### Developing against a scratch profile (recommended)

Experiment APIs touch Thunderbird internals and a bad build can disturb a real
mail profile. Use a throwaway profile:

```bash
flatpak run org.mozilla.thunderbird -P     # profile manager: create "dev"
flatpak run org.mozilla.thunderbird -P dev -no-remote
```

## Test

```bash
npm test        # runs scripts/check_imports.mjs first, then mocha (TZ pinned; see below)
npm run check   # just the import/manifest reference check
npm run lint    # webext-linter
```

`TZ` is pinned to `America/New_York` in the `test` script. Upstream's suite was
timezone-dependent — it only passed in `Europe/Paris` — because
`common/format_dates.js` shifts a local `Date` by `getTimezoneOffset()` and then
calls `toISOString()`, so the trailing `Z` is local wall-clock rather than UTC.
(`format_dates.js` no longer exists; the new detection pipeline carries real
`Date` objects throughout.)

`npm run lint` reports one expected `[fail]`: `experiment-modified` on the
`calendar` namespace. The linter keeps hashes of the audited
`tb-web-ext-experiments` draft this experiment started from; since Phase 4
adds a `createWithDialog` function not in that draft, the hash no longer
matches and the linter correctly asks for manual review of the diff. This is
inherent to writing custom Experiment code, not a defect — see PLAN.md
section 4 ("Risks").
The two tests asserting that output are `it.skip`-ed with a comment; the bug and
those tests both go away in Phase 1.

## Status

All phases in `../PLAN.md` are implemented (0 through 6, including 3a). 80
automated tests passing (unit tests plus a 31-case golden corpus tracking
precision and recall separately, gated at ≥95% each). `npm run lint`: 0
errors, 1 expected manual-review note (see Test section above).

**Not yet verified: an actual run inside Thunderbird.** Everything here has
been checked by automated test (including DOM manipulation via jsdom and
mocked `messenger`/`browser` APIs) and by reading Thunderbird 154's own
packaged source to confirm the Experiment API calls are real, but nothing
has opened the add-on in a running Thunderbird window yet. Load it as a
temporary add-on (see above) and try it on a real message before trusting
it with your calendar.
