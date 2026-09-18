# Thunderbird Calendar MailExtension APIs
(content copied from https://docs.google.com/document/d/15awbKiVfdOTmsRpgD1dxm3gvOt08EQZDSnMl8QRBFoY/edit?tab=t.0 )

Here is a draft proposal on various calendar related APIs that should become MailExtensions. We don’t aim for absolute completeness. There is some functionality that might not be exposed as an extension initially. Other functionality might be worth not exposing an API for at all, even if there are select use cases for it.

On a general level we should decide if everything should be in the messenger namespace (e.g. messenger.calendars, messenger.calendarItems), or if we have a whole sub-level (e.g. messenger.calendar.calendars, messenger.calendar.items). The former is shorter to write out, but the latter will avoid long names due to clashing terminology. Developers can still do var calendar = messenger.calendar; if they want to shorten things.



⚠️ There is an implementation draft available here ⚠️

https://github.com/thundernest/tb-web-ext-experiments/tree/master/calendar

## Shortcomings
Nothing is perfect. The APIs were initially created without an implementation, based on similarities to Firefox and Thunderbird WebExtensions APIs.

## Core APIs
messenger.calendar.calendars.*
This API will be used to access the data model around the calendars list, mainly backed by calICalendarManager. It also provides support for defining calendar providers.
Permissions
I haven’t figured this out yet. Getting calendar information is likely ok without a permission sans the URL, maybe even creating calendars. Removing and updating is debatable, but I’m sure there will be some sort of permission involved in this.
Types
Calendar
Represents a calendar object, but not any of the item related methods
Properties
id - The calendar id. TODO is this a unique id, or a numeric id like the tab id?
cacheId - The id of the associated calendar cache. Only visible for calendar provider extensions, and only for calendars created by them. This is used so that calendar providers can add/remove/modify items directly in the calendar cache.
name, readOnly, enabled, color
url - The calendar url
capabilities - CalendarCapabilities object, see below. Only visible for calendar provider extensions, and only for calendars created by them.
type - For extension providers this is `ext-${extension.id}`, for built-in ones it remains e.g. ics,caldav. TODO see note in providers section.
TODO some properties around calendar scheduling. Maybe defer to later
CalendarCapabilities
An object containing the manifest entry capabilities.

Functions
✅ create(createProps) - Creates a calendar and registers a calendar
createProps -  Properties for creation. A Calendar object but without the id
✅ get(id) - Retrieves a calendar object by id
id - The calendar id to retrieve
✅ update(id, updateProps) - Updates  various calendar properties.
updateProps - Calendar but without the id
✅ remove(id) - Unsubscribes a calendar, removing it from the list
id - The calendar id to delete
TODO do we want to expose unsubscribe vs delete?
✅ clear(id) - Remove all items from a calendar
TODO Could be quite long-running and dangerous for network calendars. Possibly limit this to cached calendars, and maybe a special case for storage calendars.
✅ query(queryProps) - Finds calendars matching criteria
queryProps.type - Find by type
queryProps.url - Find by calendar uri, this takes a MatchPattern
queryProps.name - Find by calendar name, this takes a MatchGlob
queryProps.color - Find by color.
queryProps.readOnly - Find by read only state.
queryProps.enabled - Find by disabled state.
Events
✅ onCreated(calendar) - The calendar was registered, either by the user or via an extension
calendar - The created Calendar object
✅ onUpdated(calendar, changeInfo) - The calendar metadata was changed in some way.
Calendar - The calendar that changed.
changeInfo - Lists the changes to the state of the calendar that was updated. Most Calendar object members apply.
TODO Compare tabs.onUpdated, it has tabId and tab separate. I don’t see a reason for this, maybe the tab object was added later.
✅ onRemoved(id) - A calendar was unregistered, either by extension or by the user.
id - The calendar id that was unregistered
TODO most WX remove functions don’t hold the full calendar/tab/etc object at removal, because it was already removed. If extensions need to have info during removal, they’ll have to track onUpdated. I’d say we keep it this way for consistency
Examples
var { calendar } = messenger;
let redCalendar = await calendar.calendars.create({
name: "RedCalendar",
type: "ics",
url: "https://example.com/calendar.ics",
color: "red"
});


messenger.calendar.items.*
This API is centered around creating, reading, updating and deleting items from a calendar.

TODO add a property to be able to make operations part of the undo/redo stack. Or maybe some sort of start/endTransaction call, so that multiple operations can be grouped into one undo/redo operation? Or the ability to create a transaction and pass its identifier to the create/update/delete functions?

TODO something about batch requests, unless we limit this to what providers automatically get. Not sure this needs to be exposed separately for now.
Permissions
There are a few permissions around items. If the extension is a calendar provider, it has implicit access to all calendars of its own type, without the need for an extra permission.

TODO I haven’t thought about these in detail yet.

calendarItemsRead: Retrieve items from all calendars
calendarItemsWrite: Read and write items to all calendars

Types
🚧 CalendarItem
Represents a calendar item in a calendar
properties
id - The id of the item, unique to the calendar. This is the UID used for scheduling.
calendarId - The id of the calendar this item belongs to
type - Choice of event, task. Also defines other property schema
TODO various properties we actually use in the UI or backend. Possibly model this based on the jscalendar draft.
raw - RawCalendarItem Object to set/get the raw ical representation.
metadata - CalendarItemMetadata object, only available to providers for their own.
✅ RawCalendarItem
Used from within an item to access or set calendar data based on a raw representation.
Can be requested in get/query functions.
More properties could be supported in the future, e.g. jscalendar.
properties
use - accepts null or "ical" or “jcal”. Null is the default. When you get an item, change a non-raw property, then update again, it should take the values from the non-raw properties, which is what happens when use = null. If use = "ical", then it will ignore the non-raw properties and use the ical string.
ical - The raw ical string with event data
jcal - The raw jcal object
🚧 CalendarItemMetadata
An object to hold additional metadata. This is persisted in the local storage cache, and useful for providers to save additional information such as an item etag.
There can be any number of properties, there is no fixed schema.
This object is only available to extensions that are calendar providers, for their own calendars.
Setting members to null removes that metadata item.
🚧 CalendarItemAlarm
An alarm, for example during the onAlarm notification
Properties
TODO haven’t thought about these in detail. Maybe something more generic than what calIAlarm offers
itemId - the id of the item this alarm belongs to
action - the alarm action (display, email, etc)
date - the alarm date, if absolute (TODO maybe make this a sub-property… )
offset - the alarm offset, if relative (TODO ^^... together with offset...)
related - absolute, start or end. (TODO ^... and related)

Functions
TODO consider a way to control if actions should be added to the undo/redo manager.

✅ get(calendarId, id, options) - Retrieves a calendar object by calendar id and item id
calendarId - The calendar id of the item to retrieve
id - The id of the item to retrieve
options - Optional object with additional get options
options.format - string or array with additional raw formats to serialize (ical for now. jcal, jscalendar, etc as supported). If not specified, CalendarItem.formats will be unset.
✅ create(calendarId, createProps) - Creates an item in the specified calendar. Returns created object, potentially changed by provider.
calendarId - The calendar id to create the item in
createProps -  Properties for creation. Looks mostly like a CalendarItem object
createProps.returnFormat - String or array of formats to return in the resulting item
✅ update(calendarId, id, updateProps) - Updates  various calendar properties.
calendarId - The calendar id of the item to update
id - The id of the item to update
updateProps - Mostly CalendarItem but without the id or calendarId
updateProps.returnFormat - String or array of formats to return in the resulting item
✅ move(fromCalendarId, id, toCalendarId) - Move an item from one calendar to the next
This is a convenience function. Currently no difference to a simple create+remove.
This function will not take cacheId calendars. Providers can remove/create themselves if necessary.
fromCalendarId - The calendar id to move from
id - The id of the item to move
toCalendarId - The calendar id to move to
✅ remove(calendarId, id) - Removes an item from a calendar
calendarId - The calendar id of the item to delete
id - The id of the item to delete
TODO do we want to expose unsubscribe vs delete?
✅ query(queryProps) - Find items
TODO This function may have major perf and memory impact, unclear if we can offer it to query across all calendars. May need to make calendar id mandatory.
TODO as it may return many items, we might need to do something like for email messages
queryProps.id - find using a specific item id
queryProps.calendarId - find items within a specific calendar, or array thereof.
queryProps.type - find by specific item type, or array thereof
queryProps.rangeStart - find with a start date range
queryProps.rangeEnd - find with an end date range
queryProps.format - string or array with additional raw formats to serialize (ical for now. jcal, jscalendar, etc as supported). If not specified, CalendarItem.formats will be unset.
queryProps.returnFormat - String or array of formats to return in the resulting item



Events
The addListener functions need an extra argument with listenerOptions. Currently the only listenerOptions option is format, an array or string noting which formats should be serialized when calling the listener

TODO maybe a set of onBeforeCreated/Updated etc to cancel or modify items before they are manipulated. Not sure we currently have the capability.

✅ onCreated.addListener((item) => {...}, options) - An item was created
Callback parameters
item - The created CalendarItem object
Listener parameters
options.returnFormat - String or array of formats to return in the resulting item
✅ onUpdated(item, changeInfo) - The item was changed in some way.
Callback parameters
item - The item that changed.
changeInfo - Lists the changes to the state of the item that was updated. Most CalendarItem object members apply.
TODO Compare tabs.onUpdated, it has tabId and tab separate. I don’t see a reason for this, maybe the tab object was added later.
Listener parameters
options.returnFormat - String or array of formats to return in the resulting item
✅ onRemoved(calendarId, id) - An item was removed from a calendar.
calendarId - The calendar id of the item that was removed
id - The id of the item that was removed
TODO most WX remove functions don’t hold the full calendar/tab/etc object at removal, because it was already removed. If extensions need to have info during removal, they’ll have to track onUpdated. I’d say we keep it this way for consistency
🚧 onAlarm(item, alarm) - An alarm on the item fired
Callback parameters
item - The CalendarItem the alarm is firing for
alarm - the CalendarItemAlarm that is firing.
Listener parameters
options.returnFormat - String or array of formats to return in the resulting item

Item format proposals
Not quite clear yet how to do item formats. The above has one proposal, but we have a few different options:

#1 - Just common properties for convenience, raw formats otherwise
get/query allows selection of formats through an options parameter. When passing to create/update, developers either do not pass formats if they want to manipulate using simple properties, or pass formats and set the use property to the authoritative format. This allows for simple use cases, but also opens up the more advanced properties through the formats and doesn’t require us to jump to jscalendar now.

Which formats are serialized can be requested through the functions.

{
id: "calendar-uid",
calendarId: 3,
type: "event",
title: "summary",
description: "description",
...
formats: {
use: null,
ical: "BEGIN:VCALENDAR....",
jcal: [["vcalendar", ...]],
jscalendar: { "@type": "jsevent", ... }
}
}

Downsides:
There is ambiguity that is confusing between the simple props and the advanced ones

#2 - Full jscalendar [NOT RECOMMENDED]
calendarId would either be injected here when returned from query. Having this as a vendor prop risks it being serialized somewhere. It also means we need to take the plunge to jscalendar compat.

{
"@type": "jsevent",
"mozilla.org:calendarId": 3,
"uid": "2a358cee-6489-4f14-a57f-c104db4dc2f1",
"updated": "2018-01-15T18:00:00Z",
"title": "Some event",
"start": "2018-01-15T13:00:00",
"timeZone": "America/New_York",
"duration": "PT1H"
}

#3 - Item within shell
Like #2, but having the id and calendar id separate and a format specifier. Allows for only one serialized format. Could optionally have a “simple” format that just serializes a few common properties.

let item = {
id: "2a358cee-6489-4f14-a57f-c104db4dc2f1",
calendarId: 3,
format: "ical",
metadata: {},
item: "BEGIN:VCALENDAR..."
};
messenger.calendar.items.create(calendarId, item);
messenger.calendar.items.update(calendarId, item);
messenger.calendar.items.get(
calendarId,
"2a358cee-6489-4f14-a57f-c104db4dc2f1",
{ format: "ical" }
);
messenger.calendar.items.query({
format: "ical",
calendarId: 3,
id: "2a358cee-6489-4f14-a57f-c104db4dc2f1"
});

#4 - Just formats
create/update would take an extra options parameter that specifies which format the item is in. query/get would likewise have an options parameter that defines which format it is in. query would need to have a shell to hold calendar id at least. This also has some similarities to #3. There might also be a “simple” format to hold some simple properties.

messenger.calendar.items.create(calendarId, "BEGIN:VCALENDAR...", { format: "ical" });
messenger.calendar.items.update(calendarId, id, “BEGIN:VCALENDAR…”, { format: “ical” });

Alternative:
messenger.calendar.items.create(calendarId, “ical”, "BEGIN:VCALENDAR...");
messenger.calendar.items.update(calendarId, id, “ical”, “BEGIN:VCALENDAR…”);




messenger.calendar.provider.*
We’ll cover providers with the following use cases:
Push providers: The providers are responsible for updating the local storage cache, and don’t need to do so on a schedule. They can just randomly update whenever they need to.
Poll providers: These will be updated on a regular interval, or when the user forces a sync

The calendar type will be `ext-${extension.id}`. Calendars can be migrated using the legacy_type manifest key.

Each calendar will have a cacheId property, which is in turn an id for a calendar. This property is only filled for calendars that belong to the extension. These cached calendars are not listed through calendars.query(), but can be used for mutation and retrieval operations in calendar.items.*. Likewise, events such as onCreated are not fired for cached calendars.

TODO figure out batch operations and avoid excess listener calls.
Manifest Entry
The manifest entry is used to define a calendar provider. The add-on MUST have an applications.gecko.id or browser_specific_settings.gecko.id, otherwise providers will only be registered for that instance since they’ll have a different id each time.

The manifest capabilities are meant to provide a default for calendars created using that provider. They can also be updated using messenger.calendar.calendars.update(), provided the calendar belongs to the extension.

"calendar_provider": {
"legacy_type": "gdata", // Temporary, will migrate calendars from this type
"capabilities": {
"timezones": {  // Mainly to not support the floating time zone.
"floating": false, // Maybe rename to “local”. Default is true.
"UTC": true
},
"attachments": false, // Can attachments be added to events? Default true
"priority": false, // Priority field. Default true, using standard values
"privacy": ["default", "public", "private"], // privacy values, or false if not supported
// or true if default values
"categories": {
"count": 3 // Maximum categories. 0 = disabled, -1 = no limit
},
"alarms": {
"count": 5, // Maximum alarms. 0 = disabled, -1 = no limit
"actions": ["display", "email"], // Allowed alarm actions. TODO localize somehow?
},
"tasks": true, // Are tasks or events supported. TODO make this an array or object?
"events": true,
"remove_modes": ["unsubscribe"], // unsubscribe, delete, or both
"requires_network": true, // UI hint if network is required for requests.
"minimum_refresh_interval": 1800 // 30 minutes before it automatically refreshes.
}
}

Events
These events are not a general notification when an item is manipulated, but specific to the calendar provider when it should add/update/delete the passed item from e.g. the remote service.

The event listeners are called with a calendar and item(s). The provider then has the opportunity to contact its potentially remote service and add/remove/update the item from that service. The provider can then either return the passed item as is if the remote service accepted it that way, or return a different item that represents how the service perceives it. This allows you to for example change or set the id of the item when it is added to the server, if the server determines the item id.

onItemCreated(calendar, item) - An item needs to be added to the service/provider
Returns the item created, which is either the passed argument, or if the service modified the item then a newly serialized item. This is usually an async listener.
Callback parameters
calendar - The calendar of the item that was added
item - The CalendarItem object to add.
Listener Parameters
options.returnFormat - String or array of formats to return in the resulting item
onItemUpdated(calendar, item, oldItem) - An item needs to be modified in the service.
Returns the newly modified item, which can either be the passed item, or if the service modified the item then a newly serialized item. This is usually an async listener.
Callback parameters
calendar - The calendar of the item that was changed
item - The item that changed.
oldItem - The item that changed.
Listener Parameters
options.returnFormat - String or array of formats to return in the resulting item
onItemRemoved(calendar, item) - An item was removed and needs to be removed from the service
calendar - The calendar of the item that was removed
item - The item that was removed.
TODO most WX remove functions don’t hold the full calendar/tab/etc object at removal, because it was already removed. If extensions need to have info during removal, they’ll have to track onUpdated. I’d say we keep it this way for consistency
onSync(calendar, syncProperties) - The calendar was synchronized (either manually or via refresh)
calendar - The calendar of the item that was synced
syncProperties - Object with additional properties of the sync
syncProperties.type - manual or auto, determine how the sync was triggered
syncProperties.last - Date when the last sync occurred

How to Build a Provider
Here is a simple example on how to build either a push-based or poll-based provider. It leaves out any kind of error processing for brevity, but error processing is something we shouldn’t forget.


var { calendar } = messenger;

// This is an example of a push calendar that doesn’t make use of polling.
// It does not listen to calendar.calendars.onSync.
async function pushCalendar() {
let socket = new WebSocket("wss://example.com/calendar");
let calendar = await calendar.calendars.query({ url: "wss://example.com/calendar"});

socket.onmessage = async (event) => {
let message = JSON.parse(event.data);

    switch (message.operation) {
      case "add":
        await calendar.items.create(calendar.cacheId, message.item);
    	  break;
  	case "modify":
    	  await calendar.items.update(calendar.cacheId, message.id, message.item);
    	  break;
  	case "remove":
    	  await calendar.items.remove(calendar.cacheId, message.id);
    	  break;
    }

    await messenger.storage.local.set({ ["syncToken-" + calendar.id]: message.syncToken });
};
}

// This is an example for a calendar that relies on polling and regular updates
async function pollCalendar() {
calendar.calendars.onSync(async (calendar) => {
let prefs = await messenger.storage.local.get({ ["syncToken-" + calendar.id]: null });
let response = await fetch(calendar.uri +
"?syncToken=" + prefs["syncToken-" + calendar.id]);
let message = await response.json();

    if (message.noPartialSync) {
  	await calendar.items.clear({ calendarId: calendar.cacheId });
    }

    for (let operation of message.operations) {
  	switch (operation.action) {
        case "add":
          await calendar.items.create(calendar.cacheId, message.item);
          break;
    	  case "modify":
          await calendar.items.update(calendar.cacheId, message.id, message.item);
          break;
    	  case "remove":
          await calendar.items.remove(calendar.cacheId, message.id);
          break;
      }
    }
    await messenger.storage.local.set({ ["syncToken-" + calendar.id]: message.syncToken });
});
}

// PROPOSAL: new calendar.provider.on* event listeners for handling user-triggered changes.
calendar.provider.onItemAdded.addListener(async (calendarData, item) => {
let response = await fetch(`${calendarData.url}/${item.id}.ics`, {
method: "PUT"
headers: {
"Content-Type": "text/calendar",
},
body: item.raw.ical
});

let itemData = response.text();
return {
type: "event",
raw: {
use: "ical",
ical: itemData
}
};
});




How do I…?
Signal the provider needs to do a full resync?
When synchronizing, call calendar.calendars.clear() on the cached calendar
Optionally, use calendar.items.getIds() to retrieve all ids, calculate differences on your own, then update all items as necessary. Avoid loading all items into memory.
Fix the url of the calendar if it changed
calendar.calendars.update(calendarId, { url: "googleapi://this_is_new" });



TODO Various other core services
I need to write these out while I think about them more, but wanted to list them to get started:
Freebusy providers
Calendar search service
Invitations
Exposing the timezone database in some way

## Timezone Service
We shouldn’t put the burden of shipping an up to date timezone database on add-on authors. We should provide something consistent with what Thunderbird uses. Just throwing out a few ideas for now:

messenger.calendar.timezones.getUTCOffset(dateTime, tzid) -> Number
Get the UTC offset in seconds for a dateTime and zone
messenger.calendar.timezones.convertTime(dateTime, fromTzId, toTzId) -> dateTime


dateTime - not sure what this should look like, could depend on the item format proposal. We could support multiple input formats (ical, jcal, javascript date), or stick with one (jcal object).


## Calendar Providers
This is mainly described by messenger.calendar.provider.*

## UI Surface APIs
These UI surfaces may make sense to expose to MailExtension APIs. They should be easy to separate, e.g. adding an iframe that points to a moz-extension URL instead of deep integration. We also want to keep them future proof

Creating new calendar views
Full replace of the calendar view area, with a tab being added next to day/week/multiweek/month. Might need to make that area customizable to allow views to be added/removed, and/or an overflow menu
Ability to react to next/prev buttons, and to display a text describing the date range or week number. Possibly move week number to the left to keep that as one area.
contextMenus - additional area to the existing API
calendar list and item context menu
Alarm window actions?
browserAction - have the ability to have multiple action items, or some other way to have the button also show up in the calendar and task tabs.
Calendar and task tab toolbar buttons
Event Dialog toolbar buttons
Extra frame in the event dialog
an iframe that can be displayed in the event dialog, so that providers can add their custom fields without disrupting the remaining flow.
Add this as a tab in the Description/Attachments/Attendees area.
Possibly with the option for a full takeover of the dialog content for extension-registered providers?
Related: Capabilities API will allow hiding specific fields completely. We’ll also need to keep the summary dialog in mind.
Extra frame in the calendar properties dialog
Keep in mind that it may eventually make sense to meld the calendar properties dialog into the Thunderbird account preferences dialog. Iframe allows for maximum flexibility.
Task list and unifinder filters
Importers and exporters
Print views

## Settings APIs
These might end up on an API similar to the browserSettings API.
Alarm sound, showing alarms, showing missed alarms
default alarms
default  start/end dates
Predefined calendar categories
Calendar view options

## Utility functions/APIs
There is some commonly used functionality which might be worth exposing utility functions for. We need to be careful not to make this the kitchen sink of all the utility functions in calendar though.
Recurrence expansion
ICS parsing and serializing

## Functionality that should become an external library
Some calendar functionality wouldn’t make sense to expose as an API, but may make sense to move to an external library that developers can re-use.
Item boxes and day/week/month view, as a Web Component
More advanced date/time pickers
