var { ExtensionCommon: { ExtensionAPI } } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { ExtensionUtils: { ExtensionError } } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionUtils.sys.mjs"
);
var { cal } = ChromeUtils.importESModule("resource:///modules/calendar/calUtils.sys.mjs");
var { CalEvent } = ChromeUtils.importESModule("resource:///modules/CalEvent.sys.mjs");
var { CalTodo } = ChromeUtils.importESModule("resource:///modules/CalTodo.sys.mjs");
var { default: ICAL } = ChromeUtils.importESModule("resource:///modules/calendar/Ical.sys.mjs");

function supportsType(calendar, type) {
  const key = type == "task" ? "capabilities.tasks.supported" : "capabilities.events.supported";
  return calendar.getProperty(key) !== false;
}

function writableCalendars(type) {
  return cal.manager
    .getCalendars()
    .filter(calendar => {
      return (
        calendar &&
        !calendar.readOnly &&
        !calendar.getProperty("disabled") &&
        supportsType(calendar, type)
      );
    })
    .sort((a, b) => {
      const aVisible = a.getProperty("calendar-main-in-composite") ? 1 : 0;
      const bVisible = b.getProperty("calendar-main-in-composite") ? 1 : 0;
      return bVisible - aVisible;
    });
}

function itemFromICS(ics, type) {
  let root;
  try {
    root = new ICAL.Component(ICAL.parse(ics));
  } catch (err) {
    throw new ExtensionError("Could not parse iCalendar", { cause: err });
  }

  const componentName = type == "task" ? "vtodo" : "vevent";
  const component =
    root.name == componentName
      ? root
      : root.getAllSubcomponents().find(sub => sub.name == componentName);

  if (!component) {
    throw new ExtensionError(`No ${componentName.toUpperCase()} component found`);
  }

  const item = type == "task" ? new CalTodo() : new CalEvent();
  const icalComponent = cal.icsService.createIcalComponent(componentName);
  icalComponent.wrappedJSObject.innerObject = component;
  item.icalComponent = icalComponent;
  return item;
}

this.thunderclawCalendar = class extends ExtensionAPI {
  getAPI() {
    return {
      thunderclawCalendar: {
        async createFromICS(ics, type) {
          const calendars = writableCalendars(type);
          if (calendars.length == 0) {
            throw new ExtensionError(
              type == "task" ? "No writable task calendar found" : "No writable event calendar found"
            );
          }

          let lastError;
          for (const calendar of calendars) {
            try {
              const item = itemFromICS(ics, type);
              item.calendar = calendar.superCalendar;
              const created =
                typeof calendar.adoptItem == "function"
                  ? await calendar.adoptItem(item)
                  : await calendar.addItem(item);
              return {
                ok: true,
                calendarId: calendar.id,
                calendarName: calendar.name,
                itemId: created?.id || item.id,
              };
            } catch (err) {
              lastError = err;
              console.warn("[ThunderClaw] direct calendar create failed for", calendar.name, err);
            }
          }

          throw new ExtensionError(
            lastError?.message || "Could not create calendar item in any writable calendar"
          );
        },
      },
    };
  }

  onShutdown(isAppShutdown) {
    if (!isAppShutdown) {
      Services.obs.notifyObservers(null, "startupcache-invalidate");
    }
  }
};
