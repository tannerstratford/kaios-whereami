// Adaptive ping cadence — plain-JS port of the API's src/lib/cadence.ts.
// Keep the two in sync: phone and server must agree on what "moving" means.
// idle = hourly, moving = every 5 min. See that file for the transition table.
(function (root) {
  "use strict";

  var IDLE_SEC = 3600;
  var MOVING_SEC = 300;
  var MOVE_M = 250;
  var MOVE_MPS = 1.5;
  var STATIONARY_LIMIT = 3;
  var EARTH_M = 6371008.8;

  function haversine(a, b) {
    var toRad = function (d) { return (d * Math.PI) / 180; };
    var dLat = toRad(b.lat - a.lat);
    var dLon = toRad(b.lon - a.lon);
    var la1 = toRad(a.lat), la2 = toRad(b.lat);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function moved(prev, fix) {
    var dist = haversine(prev, fix);
    if (dist >= MOVE_M) return true;
    var dtSec = (fix.ts - prev.ts) / 1000;
    return dtSec > 0 && dist / dtSec >= MOVE_MPS;
  }

  function initialState() { return { mode: "idle", last: null, stationaryCount: 0 }; }

  function finish(state, moving) {
    return { state: state, moving: moving, intervalSec: state.mode === "moving" ? MOVING_SEC : IDLE_SEC };
  }

  // step(state, fix, {manualMotion}) -> {state, moving, intervalSec}
  function step(state, fix, opts) {
    opts = opts || {};
    if (opts.manualMotion) {
      return finish({ mode: "moving", last: fix, stationaryCount: 0 }, true);
    }
    if (!state.last) {
      return finish({ mode: state.mode, last: fix, stationaryCount: 0 }, false);
    }
    var didMove = moved(state.last, fix);
    if (state.mode === "moving") {
      if (didMove) return finish({ mode: "moving", last: fix, stationaryCount: 0 }, true);
      var count = state.stationaryCount + 1;
      if (count >= STATIONARY_LIMIT) return finish({ mode: "idle", last: fix, stationaryCount: 0 }, false);
      return finish({ mode: "moving", last: fix, stationaryCount: count }, false);
    }
    if (didMove) return finish({ mode: "moving", last: fix, stationaryCount: 0 }, true);
    return finish({ mode: "idle", last: fix, stationaryCount: 0 }, false);
  }

  root.Cadence = {
    step: step, moved: moved, haversine: haversine, initialState: initialState,
    IDLE_SEC: IDLE_SEC, MOVING_SEC: MOVING_SEC,
  };
}(typeof self !== "undefined" ? self : this));
