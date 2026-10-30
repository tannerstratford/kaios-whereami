// WhereAmI — KaiOS UI. Center key pings now, left toggles tracking on/off,
// right opens the menu. The "Starting motion" action forces 5-min cadence.
// Background pings: the service worker relaunches this page with ?bgping=1 (or
// messages an open page) when the alarm fires; we ping, then close if headless.
"use strict";

var $ = function (id) { return document.getElementById(id); };
var busy = false;
var viewStack = [];
var bgMode = /[?&]bgping=1/.test(location.search);

function status(text, ok) {
  $("status").textContent = text;
  $("status").classList.toggle("err", ok === false);
}
function softkeys(l, c, r) { $("sk-left").textContent = l || ""; $("sk-center").textContent = c || ""; $("sk-right").textContent = r || ""; }
function push(v) { viewStack.push(v); show(); }
function pop() { if (viewStack.length > 1) viewStack.pop(); show(); }
function topView() { return viewStack[viewStack.length - 1]; }
function show() { var v = topView(); $("title").textContent = v.title(); $("view").innerHTML = ""; v.render($("view")); }
window.addEventListener("keydown", function (e) { if (topView().key(e) !== false) e.preventDefault(); });
function esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

function ago(ts) {
  if (!ts) return "never";
  var s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.round(s / 60) + "m ago";
  return Math.round(s / 3600) + "h ago";
}

// ---------------------------------------------------------------- home

var HomeView = {
  title: function () { return "WhereAmI"; },
  render: function (el) {
    var cfg = Tracker.loadConfig();
    var last = Tracker.lastResult();
    softkeys(cfg.enabled ? "Stop" : "Start", "Ping now", "Menu");
    var mode = (last && last.mode) || "idle";
    var rows = [
      ["Tracking", cfg.enabled ? "ON" : "off"],
      ["Mode", mode === "moving" ? "moving (5 min)" : "idle (1 hr)"],
      ["Last ping", last ? (last.ok ? ago(last.ts) : "failed " + ago(last.ts)) : "never"],
    ];
    if (last && last.ok) rows.push(["Battery", last.battery != null ? last.battery + "%" : "—"]);
    if (last && !last.ok) rows.push(["Error", last.error || "?"]);

    var html = '<div class="card">';
    rows.forEach(function (r) {
      html += '<div class="row"><span class="k">' + r[0] + '</span><span class="v">' + esc(String(r[1])) + "</span></div>";
    });
    html += "</div>";
    html += '<div class="big" id="motion">▶ Starting motion</div>';
    html += '<div class="hint">Press OK to ping now. Open <b>Menu</b> to set API + token.</div>';
    el.innerHTML = html;
  },
  key: function (e) {
    switch (e.key) {
      case "Enter": return doPing(false);
      case "SoftLeft": return toggleTracking();
      case "SoftRight": return push(MenuView());
      case "ArrowUp": case "ArrowDown": return; // reserved
      case "Backspace": return;
      case "*": return doPing(true); // quick manual-motion shortcut
      default: return false;
    }
  },
};

// A dedicated "Starting motion" trigger: the on-screen button is activated by
// pressing the pound key, matching the hint. (D-pad OK = normal ping.)
HomeView.key = (function (orig) {
  return function (e) {
    if (e.key === "#") return doPing(true);
    return orig.call(HomeView, e);
  };
})(HomeView.key);

// ---------------------------------------------------------------- actions

function doPing(manual) {
  if (busy) return;
  busy = true;
  status(manual ? "Starting motion — locating…" : "Locating…");
  Tracker.ping({ manualMotion: !!manual }).then(function (r) {
    status((manual ? "Motion on · " : "") + "Pinged · " + (r.mode === "moving" ? "5 min" : "1 hr"));
    if (topView() === HomeView) show();
  }).catch(function (err) {
    status("Ping failed: " + err.message, false);
    if (topView() === HomeView) show();
  }).then(function () {
    busy = false;
    if (bgMode) setTimeout(function () { try { window.close(); } catch (e) {} }, 1500);
  });
}

function toggleTracking() {
  var cfg = Tracker.loadConfig();
  cfg.enabled = !cfg.enabled;
  Tracker.saveConfig(cfg);
  if (cfg.enabled) {
    status("Tracking on");
    doPing(false); // immediate fix + schedules the next alarm
  } else {
    Tracker.clearAlarms();
    status("Tracking off");
    show();
  }
}

// ---------------------------------------------------------------- menu + prompts

function ListView(title, items) {
  var s = 0;
  var v = {
    title: function () { return title; },
    render: function (el) {
      softkeys("", "Select", "Back");
      var ul = document.createElement("ul"); ul.className = "list";
      items.forEach(function (it, i) {
        var li = document.createElement("li");
        li.className = it.head ? "head" : (i === s ? "sel" : "");
        li.textContent = it.label;
        if (it.sub) { var d = document.createElement("div"); d.className = "sub"; d.textContent = it.sub; li.appendChild(d); }
        ul.appendChild(li);
      });
      el.appendChild(ul);
      if (ul.children[s]) ul.children[s].scrollIntoView({ block: "nearest" });
    },
    key: function (e) {
      switch (e.key) {
        case "ArrowDown": s = (s + 1) % items.length; show(); return;
        case "ArrowUp": s = (s - 1 + items.length) % items.length; show(); return;
        case "Enter": return items[s] && !items[s].head && items[s].run();
        case "SoftRight": case "Backspace": return pop();
        default: return false;
      }
    },
  };
  return v;
}

function PromptView(title, hint, value, onSubmit) {
  return {
    title: function () { return title; },
    render: function (el) {
      softkeys("Cancel", "OK", "");
      el.innerHTML = '<div class="form"><p></p><input></div>';
      el.querySelector("p").textContent = hint;
      var input = el.querySelector("input");
      input.value = value || "";
      setTimeout(function () { input.focus(); }, 50);
    },
    key: function (e) {
      var input = document.querySelector(".form input");
      if (e.key === "Enter") return onSubmit(input.value.trim());
      if (e.key === "SoftLeft" || (e.key === "Backspace" && !input.value)) return pop();
      return false;
    },
  };
}

function MenuView() {
  var cfg = Tracker.loadConfig();
  return ListView("Menu", [
    { label: cfg.enabled ? "Stop tracking" : "Start tracking", run: function () { pop(); toggleTracking(); } },
    { label: "Ping now", run: function () { pop(); doPing(false); } },
    { label: "Starting motion", sub: "force 5-min pings", run: function () { pop(); doPing(true); } },
    { head: true, label: "SETTINGS" },
    { label: "API URL", sub: cfg.apiBase, run: function () {
        push(PromptView("API URL", "Base URL of the service, e.g. https://whereami-xxx.run.app", cfg.apiBase, function (val) {
          if (!/^https?:\/\/.+/.test(val)) return status("Must start with https://", false);
          cfg.apiBase = val.replace(/\/$/, ""); Tracker.saveConfig(cfg); pop(); status("API set");
        })); } },
    { label: "Write token", sub: cfg.writeToken ? "set" : "NOT set", run: function () {
        push(PromptView("Write token", "Paste the phone's write token", cfg.writeToken, function (val) {
          cfg.writeToken = val; Tracker.saveConfig(cfg); pop(); status("Token saved");
        })); } },
    { label: "Diagnostics", run: function () { push(DiagView()); } },
    { label: "Exit", run: function () { try { window.close(); } catch (e) {} } },
  ]);
}

function DiagView() {
  var lines = [
    "geolocation: " + ("geolocation" in navigator),
    "alarmManager: " + Tracker.alarmsAvailable(),
    "serviceWorker: " + ("serviceWorker" in navigator),
    "mozSystem XHR: ok",
    "bg relaunch mode: " + bgMode,
  ];
  var last = Tracker.lastResult();
  if (last) lines.push("last: " + (last.ok ? ("ok " + last.mode) : ("ERR " + last.error)));
  return ListView("Diagnostics", lines.map(function (l) { return { label: l, run: function () {} }; }));
}

// ---------------------------------------------------------------- start

function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("service_worker.js").catch(function () {});
  navigator.serviceWorker.addEventListener("message", function (e) {
    if (e.data && e.data.type === "do-ping") doPing(false);
  });
}

(function start() {
  registerSW();
  viewStack = [HomeView];
  show();
  var cfg = Tracker.loadConfig();
  if (bgMode) {
    // Relaunched by the SW alarm: ping and (doPing) self-close.
    doPing(false);
  } else if (cfg.enabled) {
    status("Tracking on");
    // make sure an alarm exists; a fresh ping also reschedules
    doPing(false);
  } else {
    status("Tracking off — Menu to set up");
  }
}());
