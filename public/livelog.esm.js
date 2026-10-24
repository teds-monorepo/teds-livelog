/**
 * ES-module entry point for the Live Log SDK.
 *
 *   import { LiveLog } from "https://YOUR-DOMAIN/livelog.esm.js";
 *
 * `livelog.js` has no imports or exports of its own — that is what allows a
 * plain <script> tag to load it — so importing it here runs it for its side
 * effect (it assigns `globalThis.LiveLog`) and this file re-exports that.
 *
 * Named `.esm.js` rather than `.mjs` on purpose: module scripts are rejected
 * unless the response has a JavaScript MIME type, and `.mjs` has no guaranteed
 * mapping on static hosts, whereas `.js` always does.
 */
import "./livelog.js";

const LiveLog = globalThis.LiveLog;

// A module has no `document.currentScript`, so the SDK can't work out where it
// was served from. Hand it over, since that origin is the default endpoint when
// `init()` is called without one. Skipped for file:// URLs (Node, SSR).
try {
  if (LiveLog && typeof import.meta !== "undefined" && import.meta.url) {
    LiveLog.useFallbackOrigin(new URL(import.meta.url).origin);
  }
} catch {
  // No usable origin — pass `endpoint` to init() instead.
}

export { LiveLog };
export default LiveLog;
