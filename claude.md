# Thunderbird Plugin: Mail to Calendar Event

Thunderbird add-on (manifest v3) that extracts dates from email content and offers to create calendar events. Two distinct UIs share common modules.

## Two UIs

### 1. Button popup (`create_event_button/`)
Triggered via `message_display_action` toolbar button. Loaded as ES modules directly — **no bundling needed**. Shows all dates found in the current email as selectable rows.

- `pop_up_button.html` — shell HTML; form fields injected by JS
- `pop_up_button.js` — orchestrator: injects form fields, imports interaction module, calls `showFoundDates`, handles session-storage save/restore
- `pop_up_interaction.js` — all event handlers: date selection, all-day toggle, create button
- `create_calendar_event.js` — jCal API call to `messenger.calendar.items`
- `pop_up_button.css` — shared CSS (also imported by bundle via esbuild)

**Load order matters**: `pop_up_button.js` injects DOM fields, then does `await import("./pop_up_interaction.js")`, then calls `showFoundDates`. Interaction handlers are registered before dates are rendered; use event delegation on `#dates-selector`.

### 2. In-email inline popup (`content_scripts/highlight_dates/`)
Injected into every open mail tab as a **bundled content script**. Highlights detected date text in the email body; clicking opens a draggable popup.

- `highlight_dates.js` — everything: highlights text, builds popup DOM, handles events
- `tag_dates.js` — wraps date text in `<span class="pluginMailToEvent-highlightDate">`
- **Must rebuild bundle after any change**: `npm run bundle-plugin` (or `bundle-content-script` only)

## Build System

```
npm run bundle-plugin        # full build: dependencies + content script + zip
npm run bundle-content-script # rebuilds highlight_dates.bundle.js only
npm run dev                  # watch mode
npm run lint                 # Thunderbird webext-linter (ATN review) on the built zip
npm test                     # mocha tests in tests/
```

Bundle output: `content_scripts/highlight_dates/bundle/highlight_dates.bundle.js`  
Dependencies bundled separately into `dependencies/` (franc, extract-date, extract-time).

## Common Modules (`common/`)

| File | Purpose |
|------|---------|
| `date_range_sync.js` | `setupDateRangeSync(startInput, endInput, initialEnd?)` — wires focus/input listeners so changing start shifts end by same delta. Returns `{ reset(start, end) }`. Used in both UIs. |
| `create_event_result.js` | `setCreating(btn)` + `handleCreateResult(btn, result, onSuccess)` — shared button state logic. Handles `<button>` (textContent) vs `<input type=submit>` (value) difference via `tagName` check. |
| `calendar_selector.js` | `populateCalendarSelector(selectEl, checkboxEl, getCalendars)` — takes a `getCalendars` async fn so content scripts can use message passing. |
| `timezone_selector.js` | `populateTimezoneSelector(selectEl, checkboxEl, getCurrentZone)` — same pattern; `getCurrentZone` fn required because `messenger` is not available in content scripts. |
| `event_form.js` | `createEventFormTop(idPrefix)` / `createEventFormBottom(idPrefix)` — build title/calendar/timezone and location/description fields. Used by both UIs; idPrefix avoids ID collisions in inline popup (multiple popups can coexist). |
| `find_dates.js` | `findDates(subject, content, removeDuplicates, timezone)` — NLP date extraction via extract-date + extract-time + franc language detection. |
| `format_dates.js` | `formatFoundDate` — converts raw extraction result to `{ startDateTime, endDateTime }` with ISO strings. |

## Background Scripts (`background/`)

Both run as ES modules (`"type": "module"` in manifest).

- `register_content_script_injector.js` — registers bundle as message display script; also injects into already-open tabs at startup.
- `register_message_listeners.js` — handles messages from content scripts:
  - `findDates` — runs date extraction (has `messenger` access)
  - `getCalendars` — queries `messenger.calendar.calendars`
  - `getTimezone` — returns `messenger.calendar.timezones.currentZone`
  - `createCalendarEvent` — calls `createEvent()`

## `messenger` API Availability

| Context | `messenger` available |
|---------|----------------------|
| Background scripts | ✅ Full access |
| Button popup (extension page) | ✅ Full access |
| Content scripts (bundle) | ❌ Not available — use `browser.runtime.sendMessage` |

**Pattern**: any function needing `messenger` in shared modules takes a callback param (e.g. `getCalendars`, `getCurrentZone`) so callers provide the right implementation for their context.

## Calendar API (jCal format)

Events are created via `messenger.calendar.items.create(calendarId, item)` using jCal:

```js
{
  format: "jcal",
  type: 'event',
  id: uid,
  item: ['vevent', properties, []]
}
```

Properties array entries: `[name, params, valueType, value]`

**Timed event**: `['dtstart', {tzid: 'Europe/Paris'}, 'date-time', '2026-05-17T10:00:00']`  
**All-day event**: `['dtstart', {}, 'date', '2026-05-17']`  
- No timezone param for `date` type  
- DTEND is exclusive: a 1-day event on May 17 has DTEND = May 18  
- Use `setUTCDate` to advance end day to avoid DST bugs

## Multi-date Selection (button popup only)

Dates from email are rendered as rows in `#dates-selector`. Each row has:
- `.start-date-input` — datetime-local input with two custom properties set in `pop_up_button.js`'s `showFoundDates`:
  - `.endDate` — string `YYYY-MM-DDTHH:MM` (original end from email, sliced to 16 chars)
  - `._syncer` — return value of `setupDateRangeSync(dateInput, endDateEl, dateInput.endDate)`
- `.submit-start-date` — "select" button

Selection state: `aria-selected="true"` on the active `.start-date-input`.

**Auto-select on edit**: editing an unselected start input auto-selects it (via delegated `input` handler in `pop_up_interaction.js`). The per-input syncer listener fires first (child before parent in bubbling), so the delta is already applied to the end input before the delegation handler marks the row selected — the delegation handler only needs to set `ariaSelected` and enable the button.

When clicking "select": call `_syncer.reset(value, endDate)` to reinitialise tracked baseline (needed in case end was manually edited while this row was previously active), then set `#end-date-input` to `endDate`.

## All-Day Toggle (both popups)

Shared logic in `common/all_day_toggle.js` → `setupAllDayToggle(checkbox, getStartInputs, endInput, onToggle)`.

On change:
1. Switches all start inputs and end input between `datetime-local` ↔ `date`
2. Preserves date portion (`value.slice(0, 10)`) when going to all-day; appends `T00:00` when reverting
3. If all-day and end date empty → defaults to `startInputs[0]` + 1 day
4. Calls `onToggle(allDay, endInput)` — caller resets the syncer there

Button popup: checkbox is `#all-day` in HTML. `onToggle` resets `selected._syncer`.  
In-email popup: checkbox built in JS as `${uid}-all-day` (uid-prefixed — multiple popups can coexist). `onToggle` resets the local `syncer`.

When creating an all-day event, dates are passed without `:00` suffix and `allDay=true` is the last arg. The in-email popup includes it as the last element of `message.args`; `register_message_listeners.js` does `createEvent(calendarId, ...message.args)` — no change needed there.

Both `input[type="date"]` and `input[type="datetime-local"]` must be in the CSS input selector.

## State Persistence

**Button popup** — uses `browser.storage.session` keyed by `emailFormData_${messageId}` (lost on Thunderbird close). Saves: title, location, comment, all startDate values, selectedDateIndex, selectedEndDate, allDay. Restore runs after `showFoundDates`; re-clicks the "select" button to restore selection, then dispatches `change` on `#all-day` if needed (triggers the handler registered in `pop_up_interaction.js`). `formContainer.addEventListener('input', saveFormData)` catches most field changes. The all-day checkbox uses `change` not `input` — separately registered.

**In-email popup** — uses an in-memory `Map` (`savedValues`, keyed by `htmlContainerIdValue`). Values survive the popup being closed and reopened within the same Thunderbird session but are lost on reload. No `browser.storage` involved. Saves: title, startDate, endDate, location, comment, allDay. The all-day checkbox fires `change` not `input` — a separate `change` listener triggers `save()` alongside the `setupAllDayToggle` listener.

## CSS Notes

- All styles in `pop_up_button.css`; imported by button popup via `<link>` and by content script bundle via esbuild CSS import (`import cssText from "...css"`)
- `.end-date-header` uses flex + `justify-content: space-between` for "End date" label and "All day" label on the same row — avoids the block-label stacking issue
- Button states: `.success` (green), `.error` (red), default accent (blue). Always remove the opposite class before adding one. `setCreating()` removes both before going to disabled state.
- `.pluginMailToEvent-create-btn` is the CSS class for the in-email popup submit button (`<input type=submit>`); `#create-calendar-event` is the button popup button (`<button>`)

## Key Quirks / Rules

- **Never duplicate logic between the two UIs** — extract to `common/`. The two UIs have diverged before and caused bugs.
- **Content script needs bundling** — changes to any file imported by `highlight_dates.js` (including anything in `common/`) are invisible until `npm run bundle-content-script` is run.
- **`messenger` in content scripts throws a ReferenceError** — crashes the entire function. Use the callback pattern already established (caller provides the right implementation). Do not use `typeof` guards as a workaround; fix the architecture instead.
- **`<input type=submit>` vs `<button>`** — in-email popup uses `input.value`; button popup uses `button.textContent`. `handleCreateResult` and `setCreating` handle both via `btn.tagName === 'INPUT'` check.
- **Date input type switching** — switching `input.type` from `datetime-local` to `date` resets the value. Always set `input.value` after changing `input.type`.
- **UTC vs local for all-day end date** — use `setUTCDate` not `setDate` when advancing end day by 1, to avoid DST midnight boundary issues.
- **`endDate` custom property** — `.start-date-input` elements have a non-standard `.endDate` string property (the original end from email). It's set on creation and used when the row is selected/auto-selected to initialise `_syncer`.
- **Event delegation** — `pop_up_interaction.js` uses delegated listeners on `#dates-selector` because start inputs are created after the module is imported.
- **No `messenger.calendar` in child scope** — `calendar_timezones` experiment has both parent and child scopes, but `currentZone` is only reliable from the parent (background). Always get it via `getTimezone` message in content scripts.
