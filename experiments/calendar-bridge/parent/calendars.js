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

this.calendar_calendars = class extends ExtensionAPI {
  onStartup() {
    // Own the resource://experiments-calendar-<uuid>/ substitution directly
    // (rather than depending on a separate always-running experiment) so
    // utils.sys.mjs can be imported below by both this experiment and
    // items.js. Registering the same substitution twice is harmless.
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
      unwrapCalendar,
      resolveCalendarById,
      belongsToExtension,
      serializeCalendar,
    } = ChromeUtils.importESModule(sharedModuleUrl(context.extension));

    return {
      calendar: {
        calendars: {
          async query({ type, url, name, color, readOnly, enabled, visible }) {
            const calendars = cal.manager.getCalendars();

            let urlPattern = null;
            if (url) {
              try {
                urlPattern = new MatchPattern(url, { restrictSchemes: false });
              } catch {
                throw new ExtensionError(`Invalid url pattern: ${url}`);
              }
            }

            return calendars
              .filter(calendar => {
                if (type && calendar.type != type) return false;
                if (url && !urlPattern.matches(calendar.uri)) return false;
                if (name && !new MatchGlob(name).matches(calendar.name)) return false;
                if (color && color != calendar.getProperty("color")) return false;
                if (enabled != null && calendar.getProperty("disabled") == enabled) return false;
                if (visible != null && calendar.getProperty("calendar-main-in-composite") != visible) return false;
                if (readOnly != null && calendar.readOnly != readOnly) return false;
                return true;
              })
              .map(calendar => serializeCalendar(context.extension, calendar));
          },

          async get(id) {
            if (id.endsWith("#cache")) {
              const owner = unwrapCalendar(cal.manager.getCalendarById(id.substring(0, id.length - 6)));
              const isOwn = owner.offlineStorage && belongsToExtension(owner, context.extension);
              return isOwn ? serializeCalendar(context.extension, owner.offlineStorage) : null;
            }
            return serializeCalendar(context.extension, cal.manager.getCalendarById(id));
          },

          async create(createProperties) {
            let calendar = cal.manager.createCalendar(
              createProperties.type,
              Services.io.newURI(createProperties.url)
            );
            if (!calendar) {
              throw new ExtensionError(`Calendar type ${createProperties.type} is unknown`);
            }

            calendar.name = createProperties.name;
            if (createProperties.color != null) calendar.setProperty("color", createProperties.color);
            if (createProperties.readOnly != null) calendar.setProperty("readOnly", createProperties.readOnly);
            if (createProperties.enabled != null) calendar.setProperty("disabled", !createProperties.enabled);
            if (createProperties.visible != null) calendar.setProperty("calendar-main-in-composite", createProperties.visible);
            if (createProperties.showReminders != null) calendar.setProperty("suppressAlarms", !createProperties.showReminders);
            if (createProperties.capabilities != null) {
              if (!belongsToExtension(calendar, context.extension)) {
                throw new ExtensionError("Cannot set capabilities on foreign calendar types");
              }
              calendar.setProperty("overrideCapabilities", JSON.stringify(createProperties.capabilities));
            }

            cal.manager.registerCalendar(calendar);
            calendar = cal.manager.getCalendarById(calendar.id);
            return serializeCalendar(context.extension, calendar);
          },

          async update(id, updateProperties) {
            const calendar = cal.manager.getCalendarById(id);
            if (!calendar) {
              throw new ExtensionError(`Invalid calendar id: ${id}`);
            }

            if (updateProperties.capabilities && !belongsToExtension(calendar, context.extension)) {
              throw new ExtensionError("Cannot update capabilities for foreign calendars");
            }
            if (updateProperties.url && !belongsToExtension(calendar, context.extension)) {
              throw new ExtensionError("Cannot update url for foreign calendars");
            }

            if (updateProperties.url) calendar.uri = Services.io.newURI(updateProperties.url);
            if (updateProperties.enabled != null) calendar.setProperty("disabled", !updateProperties.enabled);
            if (updateProperties.visible != null) calendar.setProperty("calendar-main-in-composite", updateProperties.visible);
            if (updateProperties.showReminders != null) calendar.setProperty("suppressAlarms", !updateProperties.showReminders);

            for (const prop of ["readOnly", "name", "color"]) {
              if (updateProperties[prop] != null) {
                calendar.setProperty(prop, updateProperties[prop]);
              }
            }

            if (updateProperties.capabilities) {
              const unwrapped = calendar.wrappedJSObject.mUncachedCalendar.wrappedJSObject;
              let overrideCapabilities;
              try {
                overrideCapabilities = JSON.parse(calendar.getProperty("overrideCapabilities")) || {};
              } catch {
                overrideCapabilities = {};
              }
              for (const [key, value] of Object.entries(updateProperties.capabilities)) {
                if (value === null) continue;
                unwrapped.capabilities[key] = value;
                overrideCapabilities[key] = value;
              }
              calendar.setProperty("overrideCapabilities", JSON.stringify(overrideCapabilities));
            }

            if (updateProperties.lastError !== undefined) {
              if (updateProperties.lastError === null) {
                calendar.setProperty("currentStatus", Cr.NS_OK);
                calendar.setProperty("lastErrorMessage", "");
              } else {
                calendar.setProperty("currentStatus", Cr.NS_ERROR_FAILURE);
                calendar.setProperty("lastErrorMessage", updateProperties.lastError);
              }
            }
          },

          async remove(id) {
            const calendar = cal.manager.getCalendarById(id);
            if (!calendar) {
              throw new ExtensionError(`Invalid calendar id: ${id}`);
            }
            cal.manager.unregisterCalendar(calendar);
          },

          async clear(id) {
            if (!id.endsWith("#cache")) {
              throw new ExtensionError("Cannot clear non-cached calendar");
            }

            const offlineStorage = resolveCalendarById(context.extension, id);
            const calendar = cal.manager.getCalendarById(id.substring(0, id.length - 6));

            if (!belongsToExtension(calendar, context.extension)) {
              throw new ExtensionError("Cannot clear foreign calendar");
            }

            await new Promise((resolve, reject) => {
              offlineStorage.QueryInterface(Ci.calICalendarProvider).deleteCalendar(offlineStorage, {
                onDeleteCalendar(_calendar, status, detail) {
                  if (Components.isSuccessCode(status)) {
                    resolve();
                  } else {
                    reject(detail);
                  }
                },
              });
            });

            calendar.wrappedJSObject.mObservers.notify("onLoad", [calendar]);
          },

          synchronize(ids) {
            let calendars;
            if (ids) {
              const idList = Array.isArray(ids) ? ids : [ids];
              calendars = idList.map(id => {
                const calendar = cal.manager.getCalendarById(id);
                if (!calendar) {
                  throw new ExtensionError(`Invalid calendar id: ${id}`);
                }
                return calendar;
              });
            } else {
              calendars = cal.manager.getCalendars().filter(c => c.getProperty("calendar-main-in-composite"));
            }

            for (const calendar of calendars) {
              if (!calendar.getProperty("disabled") && calendar.canRefresh) {
                calendar.refresh();
              }
            }
          },

          onCreated: new EventManager({
            context,
            name: "calendar.calendars.onCreated",
            register: fire => {
              const observer = {
                QueryInterface: ChromeUtils.generateQI(["calICalendarManagerObserver"]),
                onCalendarRegistered(calendar) {
                  fire.sync(serializeCalendar(context.extension, calendar));
                },
                onCalendarUnregistering() {},
                onCalendarDeleting() {},
              };
              cal.manager.addObserver(observer);
              return () => cal.manager.removeObserver(observer);
            },
          }).api(),

          onUpdated: new EventManager({
            context,
            name: "calendar.calendars.onUpdated",
            register: fire => {
              const observer = makeCalendarObserver({
                onPropertyChanged(calendar, name, value) {
                  const serialized = serializeCalendar(context.extension, calendar);
                  switch (name) {
                    case "name":
                    case "color":
                    case "readOnly":
                      fire.sync(serialized, { [name]: value });
                      break;
                    case "uri":
                      fire.sync(serialized, { url: value?.spec });
                      break;
                    case "suppressAlarms":
                      fire.sync(serialized, { showReminders: !value });
                      break;
                    case "calendar-main-in-composite":
                      fire.sync(serialized, { visible: value });
                      break;
                    case "disabled":
                      fire.sync(serialized, { enabled: !value });
                      break;
                  }
                },
              });
              cal.manager.addCalendarObserver(observer);
              return () => cal.manager.removeCalendarObserver(observer);
            },
          }).api(),

          onRemoved: new EventManager({
            context,
            name: "calendar.calendars.onRemoved",
            register: fire => {
              const observer = {
                QueryInterface: ChromeUtils.generateQI(["calICalendarManagerObserver"]),
                onCalendarRegistered() {},
                onCalendarUnregistering(calendar) {
                  fire.sync(calendar.id);
                },
                onCalendarDeleting() {},
              };
              cal.manager.addObserver(observer);
              return () => cal.manager.removeObserver(observer);
            },
          }).api(),
        },
      },
    };
  }
};
