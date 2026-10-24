/**
 * Live Log SDK v1.0.0 — send log lines to a Ted's Tools Live Log server.
 *
 *   <script src="https://YOUR-DOMAIN/livelog.js"></script>
 *   <script>
 *     LiveLog.init({ channel: "default", token: "YOUR_TOKEN", source: "GameClient" });
 *     LiveLog.info("Player connected", { playerId: 123 });
 *   </script>
 *
 * For modules and bundlers use the sibling file instead, which re-exports this
 * one: `import { LiveLog } from "https://YOUR-DOMAIN/livelog.esm.js"`.
 *
 * Zero dependencies. Every public method is wrapped so a logging failure can
 * never surface in the host application: they return a boolean rather than
 * throwing, network errors are swallowed, and sends go through a bounded queue
 * that drops the oldest entries instead of growing without limit.
 *
 * Two deliberate choices worth knowing about:
 *
 *  - There are no `import`/`export` statements in this file. That is what lets
 *    the same file be loaded by a plain <script> tag *and* imported as an ES
 *    module (a module may contain no exports; the wrapper supplies them). Keep
 *    it that way.
 *  - Flushing on unload uses `fetch(..., { keepalive: true })`, not
 *    `navigator.sendBeacon`. A beacon cannot carry an Authorization header, and
 *    the server requires the token as a header rather than in the URL (where it
 *    would leak into logs and referrers).
 */
(function (root) {
  "use strict";

  var VERSION = "1.0.0";
  var MAX_MESSAGE_BYTES = 10 * 1024;
  var MAX_DATA_BYTES = 50 * 1024;
  var MAX_PENDING_INIT = 50;
  var UNLOAD_BATCH = 20;
  var LEVELS = { debug: true, info: true, warn: true, error: true };

  var DEFAULTS = {
    endpoint: "",
    fallbackOrigin: "",
    channel: "",
    token: "",
    source: "",
    debug: false,
    maxQueue: 200,
    maxRetries: 3,
    retryBaseMs: 500,
    flushMs: 250,
  };

  var config = copy({}, DEFAULTS);
  var queue = [];
  var pendingInit = [];
  var timer = null;
  var sending = false;
  var failures = 0;
  var lifecycleBound = false;

  function copy(target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i];
      if (!source) continue;
      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) {
          target[key] = source[key];
        }
      }
    }
    return target;
  }

  function log() {
    if (!config.debug) return;
    try {
      var args = Array.prototype.slice.call(arguments);
      args.unshift("[LiveLog]");
      console.log.apply(console, args);
    } catch (error) {
      // A logger cannot do anything about a broken console.
    }
  }

  function byteLength(value) {
    try {
      if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).length;
    } catch (error) {}
    return value.length;
  }

  /** The origin this script was served from, when `endpoint` wasn't supplied. */
  function scriptOrigin() {
    try {
      var doc = root.document;
      if (doc && doc.currentScript && doc.currentScript.src) {
        return new URL(doc.currentScript.src, root.location.href).origin;
      }
    } catch (error) {}
    return "";
  }

  function endpoint() {
    var base = config.endpoint || config.fallbackOrigin || scriptOrigin();
    return String(base).replace(/\/+$/, "");
  }

  function url(path) {
    var base = endpoint();
    return base ? base + path : "";
  }

  function normalizeLevel(level) {
    var value = typeof level === "string" ? level.toLowerCase() : "";
    return LEVELS[value] ? value : "info";
  }

  function toMessage(message) {
    if (typeof message === "string") return message;
    try {
      return String(message);
    } catch (error) {
      return "";
    }
  }

  function build(level, message, data, source, channel) {
    var entry = {
      channel: channel || config.channel,
      level: normalizeLevel(level),
      message: toMessage(message),
    };
    var from = source || config.source;
    if (from) entry.source = toMessage(from);
    if (data !== undefined && data !== null) entry.data = data;
    return entry;
  }

  /**
   * The server enforces these too; checking here means an oversized log is
   * dropped locally instead of costing a request that is certain to be refused.
   */
  function acceptable(entry) {
    if (!entry.channel) return drop("no channel is set", entry);
    if (!config.token) return drop("no token is set", entry);
    if (byteLength(entry.message) > MAX_MESSAGE_BYTES) return drop("message is over 10 KB", entry);
    if (entry.data !== undefined) {
      var encoded;
      try {
        encoded = JSON.stringify(entry.data);
      } catch (error) {
        return drop("data is not JSON-serialisable", entry);
      }
      if (encoded === undefined) return drop("data is not JSON-serialisable", entry);
      if (byteLength(encoded) > MAX_DATA_BYTES) return drop("data is over 50 KB", entry);
    }
    return true;
  }

  function drop(reason, entry) {
    log(reason + " — dropped:", entry.message);
    return false;
  }

  function enqueue(entry) {
    queue.push(entry);
    if (queue.length > config.maxQueue) queue.splice(0, queue.length - config.maxQueue);
    schedule(config.flushMs);
  }

  function schedule(delay) {
    if (timer !== null) return;
    try {
      timer = root.setTimeout(function () {
        timer = null;
        flush();
      }, delay);
    } catch (error) {
      timer = null;
    }
  }

  function post(entry, keepalive) {
    var target = url("/api/log");
    if (!target) return Promise.resolve(false);

    var body = JSON.stringify(entry);
    var headers = { "Content-Type": "application/json" };
    if (config.token) headers.Authorization = "Bearer " + config.token;

    return root
      .fetch(target, {
        method: "POST",
        headers: headers,
        body: body,
        mode: "cors",
        credentials: "omit",
        keepalive: keepalive || body.length < 60000,
      })
      .then(function (response) {
        if (response.ok) return true;
        // 400/401/403/413 will never succeed on a retry, so the entry is
        // treated as delivered (and dropped) rather than retried forever.
        log("server refused the log with HTTP " + response.status + ":", entry.message);
        return true;
      })
      .catch(function (error) {
        log("send failed:", error && error.message);
        return false;
      });
  }

  function flush() {
    if (sending || queue.length === 0) return;
    var entry = queue[0];
    sending = true;

    post(entry).then(function (delivered) {
      sending = false;

      if (delivered) {
        queue.shift();
        failures = 0;
        if (queue.length) schedule(0);
        return;
      }

      failures++;
      if (failures > config.maxRetries) {
        // Stop retrying so one bad entry can't stall everything behind it.
        queue.shift();
        failures = 0;
        log("gave up on a log after " + config.maxRetries + " attempts");
        if (queue.length) schedule(0);
        return;
      }
      schedule(Math.min(config.retryBaseMs * Math.pow(2, failures), 15000));
    });
  }

  /**
   * A page that navigates away mid-queue would lose the last few lines, so the
   * tail is flushed synchronously on the way out. Capped, because keepalive
   * requests share a small in-flight budget across the whole page.
   */
  function flushOnHide() {
    if (queue.length === 0) return;
    var draining = queue.slice(-UNLOAD_BATCH);
    queue.length = Math.max(0, queue.length - draining.length);
    for (var i = 0; i < draining.length; i++) {
      try {
        post(draining[i], true);
      } catch (error) {}
    }
  }

  function bindLifecycle() {
    if (lifecycleBound || !root.addEventListener) return;
    lifecycleBound = true;

    root.addEventListener("pagehide", flushOnHide);
    root.addEventListener("beforeunload", flushOnHide);
    if (root.document && root.document.addEventListener) {
      root.document.addEventListener("visibilitychange", function () {
        if (root.document.visibilityState === "hidden") flushOnHide();
      });
    }
  }

  function send(input) {
    try {
      if (!input || typeof input !== "object") return false;
      var entry = build(input.level, input.message, input.data, input.source, input.channel);

      // Keep a few early calls so `LiveLog.info(...)` before `init()` isn't
      // silently the one line that went missing.
      if (!config.token || !entry.channel) {
        pendingInit.push(entry);
        if (pendingInit.length > MAX_PENDING_INIT) pendingInit.shift();
        log("not configured yet — buffering:", entry.message);
        return false;
      }

      if (!acceptable(entry)) return false;
      enqueue(entry);
      return true;
    } catch (error) {
      log("send() threw and was swallowed:", error && error.message);
      return false;
    }
  }

  function shorthand(level, message, data) {
    try {
      return send({ level: level, message: message, data: data });
    } catch (error) {
      return false;
    }
  }

  function init(options) {
    try {
      if (!options || typeof options !== "object") return false;

      copy(config, {
        endpoint: options.endpoint !== undefined ? options.endpoint : options.url,
        channel: options.channel,
        token: options.token,
        source: options.source,
        debug: options.debug,
        maxQueue: options.maxQueue,
        maxRetries: options.maxRetries,
        retryBaseMs: options.retryBaseMs,
        flushMs: options.flushMs,
      });

      bindLifecycle();
      log("configured:", {
        version: VERSION,
        endpoint: endpoint(),
        channel: config.channel,
        source: config.source,
      });

      if (pendingInit.length) {
        var buffered = pendingInit;
        pendingInit = [];
        for (var i = 0; i < buffered.length; i++) send(buffered[i]);
      }

      return Boolean(config.channel && config.token);
    } catch (error) {
      log("init() threw and was swallowed:", error && error.message);
      return false;
    }
  }

  /**
   * Where this SDK was served from, used by `livelog.esm.js` (a module has no
   * `document.currentScript`, so it has to hand the origin over explicitly).
   * Only http(s) origins are accepted, so a `file://` import in Node can't set
   * a nonsense endpoint.
   */
  function useFallbackOrigin(origin) {
    try {
      if (typeof origin !== "string" || !/^https?:\/\//i.test(origin)) return false;
      config.fallbackOrigin = origin.replace(/\/+$/, "");
      return true;
    } catch (error) {
      return false;
    }
  }

  var LiveLog = {
    version: VERSION,

    /** Configure once at startup. Returns true when it has everything it needs. */
    init: init,
    configure: init,

    /** `send({ level, message, data, source, channel })` — true unless dropped. */
    send: send,
    debug: function (message, data) {
      return shorthand("debug", message, data);
    },
    info: function (message, data) {
      return shorthand("info", message, data);
    },
    warn: function (message, data) {
      return shorthand("warn", message, data);
    },
    error: function (message, data) {
      return shorthand("error", message, data);
    },

    /** Force a flush; returns how many entries are still queued. */
    flush: function () {
      try {
        flush();
      } catch (error) {}
      return queue.length;
    },

    /** How many entries are queued right now. */
    pending: function () {
      return queue.length;
    },

    /** Not for direct use — see livelog.esm.js. */
    useFallbackOrigin: useFallbackOrigin,
  };

  root.LiveLog = LiveLog;

  if (typeof module !== "undefined" && module.exports) module.exports = LiveLog;
  if (typeof define === "function" && define.amd) {
    define(function () {
      return LiveLog;
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
