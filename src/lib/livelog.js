/**
 * Pure helpers behind the Live Log page: level handling, timestamp and line
 * formatting, filtering, the capped log buffer, the dedupe watermark and the
 * row offsets the virtualised list needs.
 *
 * Nothing here touches the DOM, `window` or React — `lib/useLiveLog.js` owns
 * the socket and the page/`components/*` own the rendering.
 *
 * The level *colour* classes deliberately live in `components/LogRow.jsx`
 * instead of here: `tailwind.config.js` only scans `index.html` and `src/`, so
 * a class name written in this file would never reach the stylesheet.
 */

export const LEVELS = ['debug', 'info', 'warn', 'error'];

/**
 * A collapsed row is always exactly ROW_HEIGHT tall and an expanded one adds
 * exactly DETAIL_HEIGHT on top of it. That is what lets the list compute exact
 * offsets instead of measuring rows — which in turn is why a log line is
 * clamped to a single line and the JSON detail scrolls inside a fixed box.
 */
export const ROW_HEIGHT = 22;
export const DETAIL_HEIGHT = 216;
export const OVERSCAN = 8;

export function normalizeLevel(level) {
  const value = typeof level === 'string' ? level.toLowerCase() : '';
  return LEVELS.includes(value) ? value : 'info';
}

/** `08:42:15.123` — the millisecond part is the point, so it is never dropped. */
export function formatTime(timestamp) {
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return '--:--:--.---';
  const pad = (value, width) => String(value).padStart(width, '0');
  const time = `${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}`;
  return `${time}.${pad(date.getMilliseconds(), 3)}`;
}

export function safeStringify(value, space = 2) {
  try {
    const text = JSON.stringify(value, null, space);
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
}

/** `08:42:15.123  INFO   [GameClient] Player connected` */
export function formatLogLine(entry) {
  const level = normalizeLevel(entry.level).toUpperCase().padEnd(5);
  const source = entry.source ? ` [${entry.source}]` : '';
  return `${formatTime(entry.timestamp)}  ${level}${source} ${entry.message}`;
}

export function buildCopyText(entries) {
  return entries.map(formatLogLine).join('\n');
}

export function parseServerMessage(raw) {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Reshape a wire record for rendering. The lowercase search string is built
 * once, here, so typing in the search box doesn't re-serialise every log's data
 * on each keystroke.
 */
export function prepareLog(record) {
  const message =
    typeof record.message === 'string' ? record.message : String(record.message ?? '');
  const source = typeof record.source === 'string' ? record.source : '';
  const hasData = record.data !== undefined && record.data !== null;
  let dataText = '';
  if (hasData) {
    try {
      dataText = JSON.stringify(record.data) ?? '';
    } catch {
      dataText = '';
    }
  }

  return {
    seq: Number(record.seq) || 0,
    channel: typeof record.channel === 'string' ? record.channel : '',
    level: normalizeLevel(record.level),
    timestamp: Number(record.timestamp) || Date.now(),
    message,
    source,
    data: record.data,
    hasData,
    haystack: `${message}\n${source}\n${dataText}`.toLowerCase(),
  };
}

/**
 * `filters.level` is a Set of visible levels, `filters.source` is a source name
 * or "" for all, `filters.query` is a case-insensitive term. Every word in the
 * query has to appear — "warn player" narrows faster than one substring does.
 */
export function matchesFilters(entry, filters) {
  if (!entry) return false;
  if (filters.levels && !filters.levels.has(entry.level)) return false;
  if (filters.source && entry.source !== filters.source) return false;

  const query = filters.query ? filters.query.trim().toLowerCase() : '';
  if (!query) return true;
  for (const word of query.split(/\s+/)) {
    if (!entry.haystack.includes(word)) return false;
  }
  return true;
}

export function filterLogs(entries, filters) {
  const query = filters.query && filters.query.trim();
  const allLevels = !filters.levels || filters.levels.size === LEVELS.length;
  if (!query && allLevels && !filters.source) return entries;
  return entries.filter((entry) => matchesFilters(entry, filters));
}

export function collectSources(entries) {
  const sources = new Set();
  for (const entry of entries) if (entry.source) sources.add(entry.source);
  return [...sources].sort((a, b) => a.localeCompare(b));
}

/** Append a batch, dropping the oldest logs once `max` is reached. */
export function appendCapped(entries, batch, max) {
  if (batch.length === 0) return entries;
  const next = entries.concat(batch);
  return next.length > max ? next.slice(next.length - max) : next;
}

/**
 * `seq` is monotonic within one server process, and a reconnect replays a
 * backlog that overlaps what we already hold — so anything at or below the
 * watermark is a repeat. A restarted server reports a new `instance` id and
 * `seq` starts over from 1, which is why the watermark is keyed to it: without
 * that, every log after a restart would look like a duplicate and be dropped.
 */
export function acceptBatch(watermark, instance, records) {
  let current = watermark.instance === instance ? watermark.seq : 0;
  const accepted = [];
  for (const record of records) {
    const seq = Number(record.seq) || 0;
    if (seq > current) {
      current = seq;
      accepted.push(record);
    }
  }
  return { watermark: { instance, seq: current }, accepted };
}

/** Top offset of every row, given the seq of the single expanded row (if any). */
export function rowOffsets(entries, expandedSeq) {
  const offsets = new Array(entries.length + 1);
  let top = 0;
  for (let i = 0; i < entries.length; i++) {
    offsets[i] = top;
    top += entries[i].seq === expandedSeq ? ROW_HEIGHT + DETAIL_HEIGHT : ROW_HEIGHT;
  }
  offsets[entries.length] = top;
  return offsets;
}

/**
 * Index of the row containing `y`. `offsets` is strictly ascending because every
 * row is at least ROW_HEIGHT tall, so a binary search is safe.
 */
export function findRowAt(offsets, y) {
  if (offsets.length < 2 || y < 0 || y >= offsets[offsets.length - 1]) return -1;
  let low = 0;
  let high = offsets.length - 2;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (offsets[mid] <= y && y < offsets[mid + 1]) return mid;
    if (y < offsets[mid]) high = mid - 1;
    else low = mid + 1;
  }
  return -1;
}

/** `{ start, end, total }` for `entries.slice(start, end)`, `end` exclusive. */
export function visibleRange(offsets, scrollTop, viewportHeight, overscan = OVERSCAN) {
  const rows = offsets.length - 1;
  if (rows <= 0) return { start: 0, end: 0, total: 0 };

  const total = offsets[rows];
  const top = Math.max(0, Math.min(scrollTop, total - 1));
  const bottom = Math.max(0, Math.min(scrollTop + viewportHeight - 1, total - 1));

  const first = findRowAt(offsets, top);
  const last = findRowAt(offsets, bottom);
  const start = Math.max(0, (first === -1 ? 0 : first) - overscan);
  const end = Math.min(rows, (last === -1 ? first : last) + 1 + overscan);

  return { start, end, total };
}

/**
 * Where the realtime server lives so the page can hand out a runnable copy.
 *
 * This is an explicit allowlist rather than a directory listing: the same folder
 * also holds `node_modules` and, on a machine that runs it, a real
 * `tokens.json` — and neither may ever end up in a download.
 */
export const SERVER_DIR = '/server';
export const SERVER_FOLDER = 'livelog-server';
export const SERVER_FILES = [
  'package.json',
  'server.js',
  'lib/broker.js',
  'lib/guard.js',
  'tokens.example.json',
  'env.example',
  'README.md',
  'Dockerfile',
  'fly.toml',
];

/**
 * Clean up a user-typed server address. Returns "" for anything that isn't an
 * http(s) URL or is empty, which callers read as "no override, use the
 * default". A path is kept (the server can sit behind a sub-path proxy) but a
 * trailing slash is dropped so `…/base` and `…/base/` behave the same.
 */
export function normalizeServerUrl(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.origin + url.pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/** Same idea for the socket address — `ws://` or `wss://`, empty for "derive". */
export function normalizeWsUrl(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  return /^wss?:\/\/\S+$/i.test(text) ? text.replace(/\/+$/, '') : '';
}

/**
 * The socket address that belongs to a REST base: `wss://` whenever the address
 * is https, because a plain `ws://` connection is blocked as mixed content on
 * an https page. `explicit` is used untouched when it is set.
 */
export function resolveWsUrl(rest, explicit = '') {
  if (explicit) return explicit;
  if (!rest) return '';
  try {
    const url = new URL(rest);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/ws`;
    url.search = '';
    return url.toString();
  } catch {
    return '';
  }
}

/** `localhost:4504` — what to show in the toolbar, without the scheme. */
export function serverLabel(url) {
  try {
    return new URL(url).host;
  } catch {
    return typeof url === 'string' ? url : '';
  }
}

/**
 * Identity of a channel row. The same name on two servers is two different
 * channels — each server keeps its own ring buffer — so the address is part of
 * the key. An empty `url` means the default server.
 */
export function channelKey(name, url) {
  return `${name}@${url || ''}`;
}

/**
 * A saved channel is `{ name, url, wsUrl }`, where `url` is the server that
 * channel lives on and empty means "whatever the default is". Data saved before
 * channels carried an address stored bare names, so a string is read as a name
 * with no server of its own.
 */
export function normalizeChannelList(value) {
  if (!Array.isArray(value)) return [];

  const list = [];
  const seen = new Set();
  for (const entry of value) {
    const record = typeof entry === 'string' ? { name: entry } : entry;
    const name = record && typeof record.name === 'string' ? record.name.trim() : '';
    if (!name) continue;

    const url = normalizeServerUrl(record.url);
    const key = channelKey(name, url);
    if (seen.has(key)) continue;
    seen.add(key);

    list.push({ name, url, wsUrl: normalizeWsUrl(record.wsUrl) });
  }
  return list;
}
