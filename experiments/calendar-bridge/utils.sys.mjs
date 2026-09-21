/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Shared helpers for the calendar-bridge Experiment APIs
 * (calendar.calendars / calendar.items / calendar.timezones).
 *
 * NOTE: this module is loaded through a `resource://experiments-calendar-<uuid>/`
 * substitution registered by each experiment that needs it (see
 * registerSharedModuleRoot/unregisterSharedModuleRoot below). It does not
 * live-reload, so Thunderbird needs a restart after edits during development.
 */

const { ExtensionUtils: { ExtensionError } } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionUtils.sys.mjs"
);

const { cal } = ChromeUtils.importESModule("resource:///modules/calendar/calUtils.sys.mjs");
const { CalEvent } = ChromeUtils.importESModule("resource:///modules/CalEvent.sys.mjs");
const { CalTodo } = ChromeUtils.importESModule("resource:///modules/CalTodo.sys.mjs");
const { default: ICAL } = ChromeUtils.importESModule("resource:///modules/calendar/Ical.sys.mjs");

const SHARED_MODULE_ROOT_PREFIX = "experiments-calendar-";

/**
 * Register the `resource://experiments-calendar-<uuid>/` substitution that
 * lets sibling scripts in this experiment (parent/child) import this module
 * without hard-coding a chrome-relative path. Safe to call more than once
 * per extension instance (e.g. once from calendars.js and once from
 * items.js) since it always sets the same target.
 *
 * @param {object} extension
 * @returns {string} the registered resource host, e.g. "experiments-calendar-<uuid>"
 */
export function registerSharedModuleRoot(extension) {
  const root = SHARED_MODULE_ROOT_PREFIX + extension.uuid;
  Services.io
    .getProtocolHandler("resource")
    .QueryInterface(Ci.nsIResProtocolHandler)
    .setSubstitution(root, extension.rootURI);
  return root;
}

export function unregisterSharedModuleRoot(extension) {
  const root = SHARED_MODULE_ROOT_PREFIX + extension.uuid;
  Services.io
    .getProtocolHandler("resource")
    .QueryInterface(Ci.nsIResProtocolHandler)
    .setSubstitution(root, null);
}

export function belongsToExtension(calendar, extension) {
  return calendar.superCalendar.type === "ext-" + extension.id;
}

export function unwrapCalendar(calendar) {
  let unwrapped = calendar.wrappedJSObject;
  if (unwrapped.mUncachedCalendar) {
    unwrapped = unwrapped.mUncachedCalendar.wrappedJSObject;
  }
  return unwrapped;
}

export function isCacheId(id) {
  return id.endsWith("#cache");
}

export function resolveCalendarById(extension, id) {
  let calendar;
  if (isCacheId(id)) {
    const owner = cal.manager.getCalendarById(id.slice(0, -"#cache".length));
    calendar = owner && belongsToExtension(owner, extension) && owner.wrappedJSObject.mCachedCalendar;
  } else {
    calendar = cal.manager.getCalendarById(id);
  }

  if (!calendar) {
    throw new ExtensionError("Invalid calendar: " + id);
  }
  return calendar;
}

export function offlineStorageOf(calendar) {
  return calendar.wrappedJSObject.mCachedCalendar || calendar;
}

export function serializeCalendar(extension, calendar) {
  if (!calendar) {
    return null;
  }

  const result = {
    id: calendar.id,
    type: calendar.type,
    name: calendar.name,
    url: calendar.uri.spec,
    readOnly: calendar.readOnly,
    visible: !!calendar.getProperty("calendar-main-in-composite"),
    showReminders: !calendar.getProperty("suppressAlarms"),
    enabled: !calendar.getProperty("disabled"),
    color: calendar.getProperty("color") || "#A8C2E1",
  };

  if (belongsToExtension(calendar, extension)) {
    result.cacheId = calendar.superCalendar.id + "#cache";
    result.capabilities = unwrapCalendar(calendar.superCalendar).capabilities;
  }

  return result;
}

function buildItemFromComponent(component) {
  if (component.name === "vevent" || component.name === "vtodo") {
    return instantiateItem(component);
  }

  if (component.name !== "vcalendar") {
    throw new ExtensionError("Don't know how to handle component type " + component.name);
  }

  let mainItem;
  const exceptionComponents = [];
  for (const sub of component.getAllSubcomponents()) {
    if (sub.name !== "vevent" && sub.name !== "vtodo") {
      continue;
    }
    if (sub.hasProperty("recurrence-id")) {
      exceptionComponents.push(sub);
      continue;
    }
    if (mainItem) {
      throw new ExtensionError("Cannot parse more than one parent item");
    }
    mainItem = instantiateItem(sub);
  }

  if (!mainItem) {
    throw new ExtensionError("TODO need to retrieve a parent item from storage");
  }
  if (exceptionComponents.length && !mainItem.recurrenceInfo) {
    throw new ExtensionError("Exceptions were supplied to a non-recurring item");
  }

  for (const exceptionComponent of exceptionComponents) {
    const exceptionItem = instantiateItem(exceptionComponent);
    if (exceptionItem.id !== mainItem.id || mainItem.isEvent() !== exceptionItem.isEvent()) {
      throw new ExtensionError("Exception does not relate to parent item");
    }
    mainItem.recurrenceInfo.modifyException(exceptionItem, true);
  }

  return mainItem;
}

function instantiateItem(subComponent) {
  let item;
  if (subComponent.name === "vevent") {
    item = new CalEvent();
  } else if (subComponent.name === "vtodo") {
    item = new CalTodo();
  } else {
    throw new ExtensionError("Invalid item component");
  }

  const icalComponent = cal.icsService.createIcalComponent(subComponent.name);
  icalComponent.wrappedJSObject.innerObject = subComponent;
  item.icalComponent = icalComponent;
  return item;
}

export function deserializeItem(props) {
  if (props.format === "ical") {
    try {
      return buildItemFromComponent(new ICAL.Component(ICAL.parse(props.item)));
    } catch (e) {
      throw new ExtensionError("Could not parse iCalendar", { cause: e });
    }
  }

  if (props.format === "jcal") {
    try {
      return buildItemFromComponent(new ICAL.Component(props.item));
    } catch (e) {
      throw new ExtensionError("Could not parse jCal", { cause: e });
    }
  }

  throw new ExtensionError("Invalid item format: " + props.format);
}

export function serializeItem(item, options, extension) {
  if (!item) {
    return null;
  }

  const result = {};

  if (item.isEvent()) {
    result.type = "event";
  } else if (item.isTodo()) {
    result.type = "task";
  } else {
    throw new ExtensionError(`Encountered unknown item type for ${item.calendar.id}/${item.id}`);
  }

  result.id = item.id;
  result.calendarId = item.calendar.superCalendar.id;

  const recurrenceIdIcal = item.recurrenceId?.getInTimezone(cal.timezoneService.UTC)?.icalString;
  if (recurrenceIdIcal) {
    const kind = recurrenceIdIcal.length === 8 ? "date" : "date-time";
    result.instance = ICAL.design.icalendar.value[kind].fromICAL(recurrenceIdIcal);
  }

  if (belongsToExtension(item.calendar, extension)) {
    result.metadata = {};
    try {
      result.metadata = JSON.parse(offlineStorageOf(item.calendar).getMetaData(item.id)) ?? {};
    } catch {
      // metadata is best-effort; ignore malformed JSON
    }
  }

  if (options?.returnFormat) {
    result.format = options.returnFormat;

    const serializer = Cc["@mozilla.org/calendar/ics-serializer;1"].createInstance(Ci.calIIcsSerializer);
    serializer.addItems([item]);
    const icalText = serializer.serializeToString();

    if (options.returnFormat === "ical") {
      result.item = icalText;
    } else if (options.returnFormat === "jcal") {
      result.item = ICAL.parse(icalText);
    } else {
      throw new ExtensionError("Invalid format specified: " + options.returnFormat);
    }
  }

  return result;
}

const ALARM_RELATED_NAMES = {
  [Ci.calIAlarm.ALARM_RELATED_ABSOLUTE]: "absolute",
  [Ci.calIAlarm.ALARM_RELATED_START]: "start",
  [Ci.calIAlarm.ALARM_RELATED_END]: "end",
};

export function serializeAlarm(item, alarm) {
  return {
    itemId: item.id,
    action: alarm.action.toLowerCase(),
    date: alarm.alarmDate?.icalString,
    offset: alarm.offset?.icalString,
    related: ALARM_RELATED_NAMES[alarm.related],
  };
}

/**
 * Thunderbird >=148 removed cal.createAdapter(), which older forks of this
 * kind of experiment used to build calICalendarObserver/calIObserver stubs
 * on the fly. Build the interface explicitly instead so this keeps working
 * on both ESR and rapid-release channels.
 *
 * @param {object} overrides methods to override on the default no-op observer
 * @returns {calIObserver}
 */
export function makeCalendarObserver(overrides = {}) {
  return Object.assign(
    {
      QueryInterface: ChromeUtils.generateQI(["calIObserver"]),
      onStartBatch() {},
      onEndBatch() {},
      onLoad() {},
      onAddItem() {},
      onModifyItem() {},
      onDeleteItem() {},
      onError() {},
      onPropertyChanged() {},
      onPropertyDeleting() {},
    },
    overrides
  );
}
