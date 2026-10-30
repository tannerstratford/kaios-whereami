// Tracker: config + cadence state (localStorage), GPS fix, POST to the API,
// and alarm scheduling. No DOM here. app.js drives it and renders.
(function (root) {
  "use strict";

  var CFG_KEY = "wai.cfg";
  var STATE_KEY = "wai.state";
  var LAST_KEY = "wai.last";

  function loadJSON(k, dflt) {
    try { var v = JSON.parse(localStorage.getItem(k)); return v || dflt; } catch (e) { return dflt; }
  }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function loadConfig() {
    var c = loadJSON(CFG_KEY, {});
    if (!c.apiBase) c.apiBase = "https://CHANGE-ME.run.app";
    if (!c.writeToken) c.writeToken = "";
    if (typeof c.enabled !== "boolean") c.enabled = false;
    return c;
  }
  function saveConfig(c) { saveJSON(CFG_KEY, c); }

  function getState() { return loadJSON(STATE_KEY, Cadence.initialState()); }
  function setState(s) { saveJSON(STATE_KEY, s); }
  function lastResult() { return loadJSON(LAST_KEY, null); }
  function setLast(r) { saveJSON(LAST_KEY, r); }

  // --- alarms (b2g.alarmManager) ---

  function alarmsAvailable() {
    return !!(navigator.b2g && navigator.b2g.alarmManager);
  }

  function clearAlarms() {
    if (!alarmsAvailable()) return Promise.resolve();
    try {
      return navigator.b2g.alarmManager.getAll().then(function (alarms) {
        (alarms || []).forEach(function (a) {
          if (a && a.data && a.data.type === "wai-ping") {
            try { navigator.b2g.alarmManager.remove(a.id); } catch (e) {}
          }
        });
      }).catch(function () {});
    } catch (e) { return Promise.resolve(); }
  }

  function scheduleAlarm(sec) {
    if (!alarmsAvailable()) return Promise.resolve(false);
    var when = new Date(Date.now() + sec * 1000);
    return clearAlarms().then(function () {
      return navigator.b2g.alarmManager.add({
        date: when,
        ignoreTimezone: true,
        data: { type: "wai-ping" },
      });
    }).then(function () { return true; }).catch(function () { return false; });
  }

  // --- battery (best effort) ---

  function battery() {
    try {
      var b = (navigator.b2g && navigator.b2g.battery) || navigator.battery;
      if (b && typeof b.level === "number") return Math.round(b.level * 100);
    } catch (e) {}
    return undefined;
  }

  // --- GPS ---

  function getFix() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) return reject(new Error("no geolocation"));
      navigator.geolocation.getCurrentPosition(
        function (pos) { resolve(pos); },
        function (err) { reject(new Error(err.message || ("geo " + err.code))); },
        { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
      );
    });
  }

  // --- POST ---

  function post(cfg, body) {
    return new Promise(function (resolve, reject) {
      var r = new XMLHttpRequest({ mozSystem: true }); // bypass CORS from app:// origin
      r.open("POST", cfg.apiBase.replace(/\/$/, "") + "/api/ping");
      r.timeout = 25000;
      r.setRequestHeader("Content-Type", "application/json");
      r.setRequestHeader("Authorization", "Bearer " + cfg.writeToken);
      r.onload = function () {
        if (r.status >= 200 && r.status < 300) {
          var j = null; try { j = JSON.parse(r.responseText); } catch (e) {}
          resolve(j || {});
        } else { reject(new Error("HTTP " + r.status)); }
      };
      r.onerror = function () { reject(new Error("network")); };
      r.ontimeout = function () { reject(new Error("timeout")); };
      r.send(JSON.stringify(body));
    });
  }

  // ping(opts) -> Promise<result>. opts.manualMotion forces moving cadence.
  function ping(opts) {
    opts = opts || {};
    var cfg = loadConfig();
    if (!cfg.writeToken || /CHANGE-ME/.test(cfg.apiBase)) {
      return Promise.reject(new Error("set API URL + token in Settings"));
    }
    return getFix().then(function (pos) {
      var c = pos.coords;
      var fix = { lat: c.latitude, lon: c.longitude, ts: pos.timestamp || Date.now() };
      var r = Cadence.step(getState(), fix, { manualMotion: !!opts.manualMotion });
      setState(r.state);
      var body = {
        lat: round(fix.lat, 6), lon: round(fix.lon, 6), ts: fix.ts,
        accuracyM: c.accuracy != null ? round(c.accuracy, 1) : undefined,
        speedMps: c.speed != null && c.speed >= 0 ? round(c.speed, 2) : undefined,
        battery: battery(),
        moving: r.moving,
      };
      return post(cfg, body).then(function (resp) {
        var result = {
          ts: Date.now(), ok: true, lat: body.lat, lon: body.lon,
          mode: r.state.mode, moving: r.moving, intervalSec: r.intervalSec,
          battery: body.battery,
        };
        setLast(result);
        return scheduleAlarm(r.intervalSec).then(function () { return result; });
      });
    }).catch(function (err) {
      var result = { ts: Date.now(), ok: false, error: err.message };
      setLast(result);
      // keep the schedule alive even on failure so we retry next cycle
      var iv = getState().mode === "moving" ? Cadence.MOVING_SEC : Cadence.IDLE_SEC;
      return scheduleAlarm(iv).then(function () { throw err; });
    });
  }

  function round(n, d) { var f = Math.pow(10, d); return Math.round(n * f) / f; }

  root.Tracker = {
    loadConfig: loadConfig, saveConfig: saveConfig,
    getState: getState, lastResult: lastResult,
    ping: ping, scheduleAlarm: scheduleAlarm, clearAlarms: clearAlarms,
    alarmsAvailable: alarmsAvailable,
  };
}(window));
