// Background wake path. The alarm (scheduled by the app via b2g.alarmManager)
// fires here as a 'systemmessage'. A service worker CANNOT read geolocation, so
// we can't ping from here directly — instead we relaunch / wake the app page,
// which has navigator.geolocation, and let it do the fix + POST. If a window is
// already open we just message it; otherwise we open one (headless relaunch).
"use strict";

self.addEventListener("install", function (e) { e.waitUntil(self.skipWaiting()); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

function wakeApp() {
  return self.clients
    .matchAll({ includeUncontrolled: true, type: "window" })
    .then(function (list) {
      if (list && list.length) {
        // App already open — tell it to ping now.
        list.forEach(function (c) { c.postMessage({ type: "do-ping" }); });
        return;
      }
      // No window — relaunch the app so it can read GPS, flagged to ping + close.
      if (self.clients.openWindow) {
        return self.clients.openWindow("/index.html?bgping=1");
      }
    });
}

// KaiOS 3 delivers system messages (incl. scheduled alarms) here.
self.onsystemmessage = function (evt) {
  if (evt && evt.name === "alarm") {
    evt.waitUntil(wakeApp());
  }
};
// Some builds dispatch as an event instead of the onX property.
self.addEventListener("systemmessage", function (evt) {
  if (evt && evt.name === "alarm") {
    evt.waitUntil(wakeApp());
  }
});
