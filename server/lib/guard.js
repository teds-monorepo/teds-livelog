import { createHash, timingSafeEqual } from 'node:crypto';

export const LEVELS = ['debug', 'info', 'warn', 'error'];

const fail = (code, message) => ({ ok: false, code, message });

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function digest(value) {
  return createHash('sha256').update(String(value)).digest();
}

export function createLimits(env = process.env) {
  return {
    levels: LEVELS,
    maxMessageBytes: positiveInt(env.LIVELOG_MAX_MESSAGE_BYTES, 10 * 1024),
    maxDataBytes: positiveInt(env.LIVELOG_MAX_DATA_BYTES, 50 * 1024),
    maxSourceChars: positiveInt(env.LIVELOG_MAX_SOURCE_CHARS, 64),
    channelPattern: /^[a-zA-Z0-9._-]{1,64}$/,
  };
}

/**
 * Turn `{ tokens: [{ token, label, channels }] }` into lookup records that hold
 * a sha256 digest rather than the plaintext, so a request only ever compares
 * fixed-length digests (and a dump of the process memory doesn't hand over
 * usable tokens).
 */
export function parseTokens(config) {
  const list = Array.isArray(config) ? config : Array.isArray(config?.tokens) ? config.tokens : [];
  const tokens = [];
  for (const entry of list) {
    if (!entry || typeof entry.token !== 'string' || !entry.token) continue;
    const channels = (Array.isArray(entry.channels) ? entry.channels : []).filter(
      (name) => typeof name === 'string' && name
    );
    if (channels.length === 0) continue;
    const hashed = digest(entry.token);
    tokens.push({
      id: hashed.toString('hex').slice(0, 16),
      label: typeof entry.label === 'string' ? entry.label : '',
      channels: new Set(channels),
      digest: hashed,
    });
  }
  return tokens;
}

export function configuredChannels(tokens) {
  const names = new Set();
  for (const token of tokens) for (const name of token.channels) names.add(name);
  return [...names];
}

/**
 * `channel` is the channel the log is addressed to, so a token that owns one
 * channel cannot write into another's. Every record is compared
 * — no early exit — and both sides are sha256 digests, so neither the length of
 * a guess nor the order of the token list leaks anything.
 */
export function authorize(tokens, header, channel) {
  if (typeof header !== 'string') return { ok: false, code: 'unauthorized' };
  const match = /^Bearer[ ]+(.+)$/i.exec(header.trim());
  if (!match) return { ok: false, code: 'unauthorized' };

  const candidate = digest(match[1]);
  let owner = null;
  for (const token of tokens) {
    if (timingSafeEqual(candidate, token.digest)) owner = token;
  }
  if (!owner) return { ok: false, code: 'unauthorized' };
  if (channel && !owner.channels.has(channel)) return { ok: false, code: 'forbidden' };
  return { ok: true, owner };
}

/**
 * Token bucket: `burst` is the bucket size, `perSec` the refill rate. Buckets
 * idle for two minutes are swept hourly-ish so a long-lived process can't keep
 * one entry per token or IP it has ever seen.
 */
export function createRateLimiter({ perSec, burst }) {
  const buckets = new Map();
  let sweptAt = Date.now();

  return function check(key, now = Date.now()) {
    if (now - sweptAt > 60_000) {
      for (const [name, bucket] of buckets) {
        if (now - bucket.at > 120_000) buckets.delete(name);
      }
      sweptAt = now;
    }

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: burst, at: now };
      buckets.set(key, bucket);
    }
    bucket.tokens = Math.min(burst, bucket.tokens + ((now - bucket.at) / 1000) * perSec);
    bucket.at = now;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  };
}

const utf8Bytes = (value) => Buffer.byteLength(value, 'utf8');

export function validateLog(body, limits) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail('bad_request', 'body must be a JSON object');
  }

  const { channel, level, message, source, data } = body;

  if (typeof channel !== 'string' || !limits.channelPattern.test(channel)) {
    return fail('bad_request', 'channel must match [a-zA-Z0-9._-]{1,64}');
  }
  if (!limits.levels.includes(level)) {
    return fail('bad_request', `level must be one of ${limits.levels.join(', ')}`);
  }
  if (typeof message !== 'string' || message.length === 0) {
    return fail('bad_request', 'message must be a non-empty string');
  }
  if (utf8Bytes(message) > limits.maxMessageBytes) {
    return fail('too_large', `message exceeds ${limits.maxMessageBytes} bytes`);
  }

  let cleanSource;
  if (source !== undefined && source !== null) {
    if (
      typeof source !== 'string' ||
      source.length === 0 ||
      source.length > limits.maxSourceChars
    ) {
      return fail(
        'bad_request',
        `source must be a string of 1-${limits.maxSourceChars} characters`
      );
    }
    cleanSource = source;
  }

  let cleanData;
  if (data !== undefined && data !== null) {
    // Any JSON value is accepted — the SDK's signature is `data?: any`, so a
    // bare string or number is legitimate and is rendered as JSON on the page.
    let encoded;
    try {
      encoded = JSON.stringify(data);
    } catch {
      return fail('bad_request', 'data is not JSON-serialisable');
    }
    if (encoded === undefined) return fail('bad_request', 'data is not JSON-serialisable');
    if (utf8Bytes(encoded) > limits.maxDataBytes) {
      return fail('too_large', `data exceeds ${limits.maxDataBytes} bytes`);
    }
    // Re-parse so what gets broadcast is a plain copy of exactly what was sent:
    // no prototypes, no accessors, nothing that survived only in memory.
    cleanData = JSON.parse(encoded);
  }

  return { ok: true, log: { channel, level, message, source: cleanSource, data: cleanData } };
}
