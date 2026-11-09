// Keeps a JSON copy of app data on phone storage, which survives uninstalling
// the app. Writes alternate between two files, so a failed write cannot destroy
// the most recent good copy.
(function (root) {
  "use strict";

  function request(r) {
    return new Promise(function (resolve, reject) {
      if (r && typeof r.then === "function") { r.then(resolve, reject); return; }
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error || new Error("storage error")); };
    });
  }

  function readText(file) {
    if (file && typeof file.text === "function") return file.text();
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsText(file);
    });
  }

  function FileBackup(app, nav) {
    this.app = app;
    this.nav = nav;
    this.names = [app + "-backup-a.json", app + "-backup-b.json"];
    this.next = 0;
    this.queue = Promise.resolve();
    this.lastText = null;
  }

  FileBackup.prototype.storage = function () {
    var n = this.nav;
    if (n.b2g && n.b2g.getDeviceStorage) return n.b2g.getDeviceStorage("sdcard");
    if (n.getDeviceStorage) return n.getDeviceStorage("sdcard");
    return null;
  };

  FileBackup.prototype.readSlot = function (ds, i) {
    var self = this;
    return request(ds.get(this.names[i])).then(readText).then(function (text) {
      var doc = JSON.parse(text);
      if (doc.app !== self.app || !doc.data) throw new Error("not a backup");
      return { slot: i, savedAt: doc.savedAt, data: doc.data };
    });
  };

  // Resolves with the newest valid backup's data, or null when none is readable.
  FileBackup.prototype.load = function () {
    var self = this, ds = this.storage();
    if (!ds) return Promise.reject(new Error("no device storage"));
    var problems = [];
    function attempt(i) {
      return self.readSlot(ds, i).catch(function (e) {
        problems.push(e && (e.name || e.message) || String(e));
        return null;
      });
    }
    return attempt(0).then(function (a) {
      return attempt(1).then(function (b) {
        var best = a && b ? (b.savedAt > a.savedAt ? b : a) : (a || b);
        self.problems = problems;
        if (!best) return null;
        self.next = best.slot === 0 ? 1 : 0;
        return best.data;
      });
    });
  };

  FileBackup.prototype.save = function (data) {
    var self = this, text = JSON.stringify(data);
    if (text === this.lastText) return Promise.resolve(false);
    this.lastText = text;
    var run = this.queue.catch(function () {}).then(function () {
      var ds = self.storage();
      if (!ds) throw new Error("no device storage");
      var name = self.names[self.next];
      var blob = new Blob([JSON.stringify({ app: self.app, savedAt: Date.now(), data: data })], { type: "application/json" });
      return request(ds.delete(name)).catch(function () {}).then(function () {
        return request(ds.addNamed(blob, name));
      }).then(function () {
        self.next = self.next === 0 ? 1 : 0;
        return true;
      });
    });
    run.catch(function () { if (self.lastText === text) self.lastText = null; });
    this.queue = run;
    return run;
  };

  if (typeof module !== "undefined" && module.exports) module.exports = { FileBackup: FileBackup };
  else root.FileBackup = FileBackup;
}(this));
