/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var { ExtensionCommon: { ExtensionAPI, EventManager } } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { ExtensionUtils: { ExtensionError } } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionUtils.sys.mjs"
);
var { cal } = ChromeUtils.importESModule("resource:///modules/calendar/calUtils.sys.mjs");

function sharedModuleRoot(extension) {
  return `experiments-calendar-${extension.uuid}`;
}

function sharedModuleUrl(extension) {
  const root = sharedModuleRoot(extension);
  const query = extension.manifest.version;
  return `resource://${root}/experiments/calendar-bridge/utils.sys.mjs?${query}`;
}

this.calendar_items = class extends ExtensionAPI {
  onStartup() {
    // See calendars.js: both experiments own this registration so neither
    // depends on the other's startup order.
    Services.io
      .getProtocolHandler("resource")
      .QueryInterface(Ci.nsIResProtocolHandler)
      .setSubstitution(sharedModuleRoot(this.extension), this.extension.rootURI);
  }

  onShutdown(isAppShutdown) {
    if (isAppShutdown) {
      return;
    }
    Services.io
      .getProtocolHandler("resource")
      .QueryInterface(Ci.nsIResProtocolHandler)
      .setSubstitution(sharedModuleRoot(this.extension), null);
  }

  getAPI(context) {
    const {
      makeCalendarObserver,
      resolveCalendarById,
      offlineStorageOf,
      isCacheId,
      belongsToExtension,
      deserializeItem,
      serializeItem,
      serializeAlarm,
    } = ChromeUtils.importESModule(sharedModuleUrl(context.extension));

    return {
      calendar: {
        items: {
          async query(queryProps) {
            let calendars;
            if (typeof queryProps.calendarId == "string") {
              calendars = [resolveCalendarById(context.extension, queryProps.calendarId)];
            } else if (Array.isArray(queryProps.calendarId)) {
              calendars = queryProps.calendarId.map(id => resolveCalendarById(context.extension, id));
            } else {
              calendars = cal.manager.getCalendars().filter(calendar => !calendar.getProperty("disabled"));
            }

            let calendarItems;
            if (queryProps.id) {
              calendarItems = await Promise.all(calendars.map(calendar => calendar.getItem(queryProps.id)));
            } else {
              calendarItems = await Promise.all(
                calendars.map(async calendar => {
                  let filter = Ci.calICalendar.ITEM_FILTER_COMPLETED_ALL;
                  if (queryProps.type == "event") {
                    filter |= Ci.calICalendar.ITEM_FILTER_TYPE_EVENT;
                  } else if (queryProps.type == "task") {
                    filter |= Ci.calICalendar.ITEM_FILTER_TYPE_TODO;
                  } else {
                    filter |= Ci.calICalendar.ITEM_FILTER_TYPE_ALL;
                  }

                  if (queryProps.expand) {
                    filter |= Ci.calICalendar.ITEM_FILTER_CLASS_OCCURRENCES;
                  }

                  const rangeStart = queryProps.rangeStart ? cal.createDateTime(queryProps.rangeStart) : null;
                  const rangeEnd = queryProps.rangeEnd ? cal.createDateTime(queryProps.rangeEnd) : null;

                  return calendar.getItemsAsArray(filter, queryProps.limit ?? 0, rangeStart, rangeEnd);
                })
              );
            }

            return calendarItems.flat().map(item => serializeItem(item, queryProps, context.extension));
          },

          async get(calendarId, id, options) {
            const calendar = resolveCalendarById(context.extension, calendarId);
            const item = await calendar.getItem(id);
            return serializeItem(item, options, context.extension);
          },

          async create(calendarId, createProperties) {
            const calendar = resolveCalendarById(context.extension, calendarId);
            const item = deserializeItem(createProperties);
            item.calendar = calendar.superCalendar;

            if (createProperties.metadata && belongsToExtension(calendar, context.extension)) {
              offlineStorageOf(calendar).setMetaData(item.id, JSON.stringify(createProperties.metadata));
            }

            const createdItem = isCacheId(calendarId)
              ? await calendar.modifyItem(item, null)
              : await calendar.adoptItem(item);

            return serializeItem(createdItem, createProperties, context.extension);
          },

          /**
           * Opens Thunderbird's own "New Event" dialog prefilled with
           * createProperties instead of writing the item silently, so the
           * user can review/adjust time, date, calendar, location, etc.
           * before anything is saved. `createEventWithDialog` is the same
           * global Thunderbird's built-in "Create Event from message"
           * feature (calendar-extract.js) calls; it's a maintained,
           * first-party entry point rather than a private internal we're
           * the only caller of. It's loaded as a plain (non-module) global
           * into chrome windows (messenger.xhtml, messageWindow.xhtml,
           * aboutMessage.xhtml), so it's reached via the most recent main
           * window rather than an import. createProperties uses the same
           * jCal shape as create() above.
           */
          async createWithDialog(calendarId, createProperties) {
            const calendar = resolveCalendarById(context.extension, calendarId);
            const item = deserializeItem(createProperties);
            item.calendar = calendar.superCalendar;

            const win = Services.wm.getMostRecentWindow("mail:3pane");
            if (!win || typeof win.createEventWithDialog !== "function") {
              throw new ExtensionError(
                "createEventWithDialog is not available on the main window " +
                "(no 3-pane window open, or Thunderbird's calendar UI changed)."
              );
            }

            const forceAllDay = createProperties.allDay === true;
            win.createEventWithDialog(item.calendar, null, null, null, item, forceAllDay);
          },

          async update(calendarId, id, updateProperties) {
            const calendar = resolveCalendarById(context.extension, calendarId);

            const oldItem = await calendar.getItem(id);
            if (!oldItem) {
              throw new ExtensionError("Could not find item " + id);
            }
            if (oldItem.isEvent()) {
              updateProperties.type = "event";
            } else if (oldItem.isTodo()) {
              updateProperties.type = "task";
            } else {
              throw new ExtensionError(`Encountered unknown item type for ${calendarId}/${id}`);
            }

            const newItem = deserializeItem(updateProperties);
            newItem.calendar = calendar.superCalendar;

            if (updateProperties.metadata && belongsToExtension(calendar, context.extension)) {
              offlineStorageOf(calendar).setMetaData(newItem.id, JSON.stringify(updateProperties.metadata));
            }

            const modifiedItem = await calendar.modifyItem(newItem, oldItem);
            return serializeItem(modifiedItem, updateProperties, context.extension);
          },

          async move(fromCalendarId, id, toCalendarId) {
            if (fromCalendarId == toCalendarId) {
              return;
            }

            const fromCalendar = cal.manager.getCalendarById(fromCalendarId);
            const toCalendar = cal.manager.getCalendarById(toCalendarId);
            const item = await fromCalendar.getItem(id);
            if (!item) {
              throw new ExtensionError("Could not find item " + id);
            }

            if (belongsToExtension(toCalendar, context.extension) && belongsToExtension(fromCalendar, context.extension)) {
              const fromStorage = offlineStorageOf(fromCalendar);
              const toStorage = offlineStorageOf(toCalendar);
              toStorage.setMetaData(item.id, fromStorage.getMetaData(item.id));
            }
            await toCalendar.addItem(item);
            await fromCalendar.deleteItem(item);
          },

          async remove(calendarId, id) {
            const calendar = resolveCalendarById(context.extension, calendarId);
            const item = await calendar.getItem(id);
            if (!item) {
              throw new ExtensionError("Could not find item " + id);
            }
            await calendar.deleteItem(item);
          },

          async getCurrent(options) {
            try {
              const item = context.browsingContext.embedderElement.ownerGlobal.calendarItem;
              return serializeItem(item, options, context.extension);
            } catch (e) {
              console.error(e);
              return null;
            }
          },

          onCreated: new EventManager({
            context,
            name: "calendar.items.onCreated",
            register: (fire, options) => {
              const observer = makeCalendarObserver({
                onAddItem: item => fire.sync(serializeItem(item, options, context.extension)),
              });
              cal.manager.addCalendarObserver(observer);
              return () => cal.manager.removeCalendarObserver(observer);
            },
          }).api(),

          onUpdated: new EventManager({
            context,
            name: "calendar.items.onUpdated",
            register: (fire, options) => {
              const observer = makeCalendarObserver({
                onModifyItem: newItem => {
                  fire.sync(serializeItem(newItem, options, context.extension), {});
                },
              });
              cal.manager.addCalendarObserver(observer);
              return () => cal.manager.removeCalendarObserver(observer);
            },
          }).api(),

          onRemoved: new EventManager({
            context,
            name: "calendar.items.onRemoved",
            register: fire => {
              const observer = makeCalendarObserver({
                onDeleteItem: item => fire.sync(item.calendar.id, item.id),
              });
              cal.manager.addCalendarObserver(observer);
              return () => cal.manager.removeCalendarObserver(observer);
            },
          }).api(),

          onAlarm: new EventManager({
            context,
            name: "calendar.items.onAlarm",
            register: (fire, options) => {
              const observer = {
                QueryInterface: ChromeUtils.generateQI(["calIAlarmServiceObserver"]),
                onAlarm(item, alarm) {
                  fire.sync(serializeItem(item, options, context.extension), serializeAlarm(item, alarm));
                },
                onRemoveAlarmsByItem() {},
                onRemoveAlarmsByCalendar() {},
                onAlarmsLoaded() {},
              };
              const alarmService = Cc["@mozilla.org/calendar/alarm-service;1"].getService(Ci.calIAlarmService);
              alarmService.addObserver(observer);
              return () => alarmService.removeObserver(observer);
            },
          }).api(),
        },
      },
    };
  }
};
