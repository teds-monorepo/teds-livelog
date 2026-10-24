/**
 * Ted's Tools — Live Log realtime server.
 *
 * One long-lived Node process that accepts logs over HTTP and fans them out to
 * viewers over WebSocket. It exists because Vercel's serverless functions can
 * neither hold a socket open nor share memory between invocations, so a log
 * POSTed to one instance could never reach a viewer connected to another.
 *
 * Everything lives in memory: no database, no Redis, no disk. Restarting drops
 * every log — deliberately. Run exactly ONE instance; a second would have its
 * own `seq` counter and its own viewers, so broadcasts would only reach the
 * viewers that happened to land on the same process.
 */
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { createBroker } from './lib/broker.js';
import {
  authorize,
  configuredChannels,
  createLimits,
  createRateLimiter,
  parseTokens,
  validateLog,
} from './lib/guard.js';

const PORT = Number(process.env.PORT || 4504);
const HOST = process.env.HOST || '0.0.0.0';
const WS_PATH = process.env.LIVELOG_WS_PATH || '/ws';
const LOG_PATH = process.env.LIVELOG_LOG_PATH || '/api/log';
const CHANNELS_PATH = '/api/channels';
const HEALTH_PATH = '/healthz';
// The built-in sender, served from beside this file. `/` is the friendly entry
// point; `/test.html` is kept so the address works when the server sits behind a
// sub-path proxy and `/` belongs to something else.
const TEST_PATHS = new Set(['/', '/test', '/test.html']);

// Identifies this process so viewers can reset their dedupe watermark when the
// server restarts and `seq` drops back to 1.
const INSTANCE = randomUUID();

const num = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const limits = createLimits(process.env);
const maxBodyBytes = limits.maxMessageBytes + limits.maxDataBytes + 4096;

const maxLogs = num(process.env.LIVELOG_MAX_LOGS, 5000);
const broker = createBroker({
  maxLogs,
  replay: num(process.env.LIVELOG_REPLAY, 200),
  maxChannels: num(process.env.LIVELOG_MAX_CHANNELS, 200),
  maxSubscribersPerChannel: num(process.env.LIVELOG_MAX_SUBSCRIBERS, 100),
});

const tokens = loadTokens();
const writeLimiter = createRateLimiter({
  perSec: num(process.env.LIVELOG_RATE_PER_SEC, 20),
  burst: num(process.env.LIVELOG_RATE_BURST, 100),
});
const authLimiter = createRateLimiter({
  perSec: num(process.env.LIVELOG_AUTH_PER_SEC, 2),
  burst: num(process.env.LIVELOG_AUTH_BURST, 20),
});

const maxConnections = num(process.env.LIVELOG_MAX_CONNECTIONS, 500);
const maxConnectionsPerIp = num(process.env.LIVELOG_MAX_CONNECTIONS_PER_IP, 20);
const trustProxy = process.env.LIVELOG_TRUST_PROXY !== '0';
const origins = parseOrigins(process.env.LIVELOG_ALLOWED_ORIGINS);

function parseOrigins(value) {
  const list = (value || '*')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return list.length ? list : ['*'];
}

/**
 * `tokens.json` next to this file is used when nothing is configured, so
 * `node server.js` works straight after copying the example — that file is
 * gitignored, since it holds real write tokens.
 */
function tokensFile() {
  if (process.env.LIVELOG_TOKENS_FILE) return process.env.LIVELOG_TOKENS_FILE;
  try {
    const beside = join(dirname(fileURLToPath(import.meta.url)), 'tokens.json');
    if (existsSync(beside)) return beside;
  } catch {}
  return '';
}

function loadTokens() {
  const file = tokensFile();
  let raw = process.env.LIVELOG_TOKENS;
  if (!raw && file) {
    try {
      raw = readFileSync(file, 'utf8');
    } catch (error) {
      console.error(`[livelog] could not read token file (${file}): ${error.message}`);
    }
  }
  if (!raw) {
    console.warn(
      '[livelog] no tokens configured — every write will be rejected. ' +
        'Set LIVELOG_TOKENS or LIVELOG_TOKENS_FILE.'
    );
    return [];
  }
  try {
    return parseTokens(JSON.parse(raw));
  } catch (error) {
    console.error(`[livelog] token config is not valid JSON: ${error.message}`);
    return [];
  }
}

/**
 * Behind Fly/Render/Railway the socket address is the proxy, so the client IP
 * comes from `x-forwarded-for`. Set LIVELOG_TRUST_PROXY=0 when the process is
 * exposed directly, since the header is trivially spoofed otherwise.
 */
function clientIp(headers, socket) {
  if (trustProxy) {
    const forwarded = headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  }
  return socket.remoteAddress || 'unknown';
}

function corsHeaders(origin) {
  const allowAll = origins.includes('*');
  const allowed = allowAll ? '*' : origins.includes(origin) ? origin : '';
  if (!allowed) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(res, status, payload, extra) {
  try {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      ...extra,
    });
    res.end(body);
  } catch {
    // The socket may already be gone (a body we aborted for being oversized).
    try {
      res.destroy();
    } catch {}
  }
}

/**
 * Reads the body but never buffers past `limit`: an oversized payload is
 * refused as it arrives rather than after being held in memory, which is the
 * whole point of an unauthenticated endpoint having a size cap.
 */
function readBody(req, limit) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settle({ ok: false, code: 'too_large', message: `body exceeds ${limit} bytes` });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => settle({ ok: true, text: Buffer.concat(chunks).toString('utf8') }));
    req.on('error', () => settle({ ok: false, code: 'bad_request', message: 'request aborted' }));
    req.on('aborted', () => settle({ ok: false, code: 'bad_request', message: 'request aborted' }));
  });
}

async function handleLog(req, res, cors) {
  // Cheapest possible refusal: no token at all never reaches the body.
  if (typeof req.headers.authorization !== 'string') {
    return json(
      res,
      401,
      { ok: false, code: 'unauthorized', message: 'missing bearer token' },
      cors
    );
  }

  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBodyBytes) {
    return json(
      res,
      413,
      { ok: false, code: 'too_large', message: `body exceeds ${maxBodyBytes} bytes` },
      cors
    );
  }

  const body = await readBody(req, maxBodyBytes);
  if (!body.ok) {
    return json(
      res,
      body.code === 'too_large' ? 413 : 400,
      { ok: false, code: body.code, message: body.message },
      cors
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return json(
      res,
      400,
      { ok: false, code: 'bad_request', message: 'body is not valid JSON' },
      cors
    );
  }

  const valid = validateLog(parsed, limits);
  if (!valid.ok) {
    const status = valid.code === 'too_large' ? 413 : 400;
    return json(res, status, { ok: false, code: valid.code, message: valid.message }, cors);
  }

  const auth = authorize(tokens, req.headers.authorization, valid.log.channel);
  if (!auth.ok) {
    // Throttle guessing separately from legitimate writes.
    if (!authLimiter(`ip:${clientIp(req.headers, req.socket)}`)) {
      return json(
        res,
        429,
        { ok: false, code: 'rate_limited', message: 'too many failed attempts' },
        cors
      );
    }
    return json(
      res,
      auth.code === 'forbidden' ? 403 : 401,
      {
        ok: false,
        code: auth.code,
        message:
          auth.code === 'forbidden'
            ? `token is not allowed to write to channel "${valid.log.channel}"`
            : 'invalid token',
      },
      cors
    );
  }

  if (!writeLimiter(`${auth.owner.id}:${valid.log.channel}`)) {
    return json(
      res,
      429,
      {
        ok: false,
        code: 'rate_limited',
        message: 'rate limit exceeded for this token and channel',
      },
      cors
    );
  }

  const record = broker.publish(valid.log.channel, valid.log);
  if (!record) {
    return json(
      res,
      503,
      { ok: false, code: 'channel_limit', message: 'channel capacity reached' },
      cors
    );
  }

  // Deliberately does not echo the message back or log it to stdout.
  return json(res, 202, { ok: true, seq: record.seq, timestamp: record.timestamp }, cors);
}

/**
 * The sender page. The file is optional — someone who copies only `server.js`
 * + `lib/` gets a 404 with a readable hint rather than a crash at startup — and
 * it is read per request rather than cached, so editing `test.html` shows up on
 * the next reload without restarting the process (`node --watch` only watches
 * the modules the process imported).
 */
const TEST_PAGE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'test.html');

function sendTestPage(res) {
  let page;
  try {
    page = readFileSync(TEST_PAGE_PATH);
  } catch {
    return json(res, 404, {
      ok: false,
      code: 'not_found',
      message: 'test.html is not next to server.js — the built-in sender is unavailable.',
    });
  }

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': page.length,
    // Never cached: it is a local debugging tool, and a stale copy after an
    // update would be confusing. It also carries nothing sensitive itself —
    // the token is typed in per tab and kept in sessionStorage.
    'Cache-Control': 'no-store',
  });
  res.end(page);
}

const server = http.createServer(async (req, res) => {
  const cors = corsHeaders(req.headers.origin);
  const path = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;

  // The preflight a browser sends before POST /api/log with a JSON content type
  // and an Authorization header.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }

  if (path === HEALTH_PATH && req.method === 'GET') {
    const { subscribers, active } = broker.snapshot();
    return json(
      res,
      200,
      { ok: true, uptime: Math.round(process.uptime()), channels: active.length, subscribers },
      cors
    );
  }

  if (path === CHANNELS_PATH && req.method === 'GET') {
    // Only channels with recent traffic — configured-but-silent names are not
    // advertised, and channel names are effectively public anyway (reads are
    // open), so docs say to make sensitive ones unguessable.
    return json(res, 200, { channels: broker.snapshot().active }, cors);
  }

  if (path === LOG_PATH) {
    if (req.method !== 'POST') {
      return json(res, 405, { ok: false, code: 'method_not_allowed', message: 'use POST' }, cors);
    }
    return handleLog(req, res, cors);
  }

  if (TEST_PATHS.has(path) && (req.method === 'GET' || req.method === 'HEAD')) {
    return sendTestPage(res);
  }

  return json(res, 404, { ok: false, code: 'not_found' }, cors);
});

/**
 * `maxPayload` bounds client frames at the protocol layer, so an oversized
 * message is refused before JSON.parse ever sees it. Viewers only ever send a
 * small subscribe or ping frame, so 8 KB is generous.
 */
const wss = new WebSocketServer({
  server,
  path: WS_PATH,
  maxPayload: 8 * 1024,
  perMessageDeflate: false,
});

const connectionsPerIp = new Map();

function send(socket, payload) {
  try {
    socket.send(JSON.stringify(payload));
  } catch {}
}

function handleMessage(socket, raw) {
  let message;
  try {
    message = JSON.parse(raw.toString('utf8'));
  } catch {
    return send(socket, { type: 'error', code: 'bad_request', message: 'message must be JSON' });
  }
  if (!message || typeof message !== 'object') return;

  if (message.type === 'ping') return send(socket, { type: 'pong' });

  if (message.type === 'unsubscribe') {
    if (socket.channel) broker.unsubscribe(socket, socket.channel);
    socket.channel = null;
    return;
  }

  if (message.type !== 'subscribe') return;

  if (typeof message.channel !== 'string' || !limits.channelPattern.test(message.channel)) {
    return send(socket, { type: 'error', code: 'bad_request', message: 'invalid channel' });
  }
  // Re-subscribing to the channel we are already on must not replay the
  // backlog a second time (React StrictMode double-invokes effects in dev).
  if (socket.channel === message.channel) return;

  if (socket.channel) {
    broker.unsubscribe(socket, socket.channel);
    socket.channel = null;
  }

  const result = broker.subscribe(socket, message.channel);
  if (!result.ok) {
    return send(socket, {
      type: 'error',
      code: result.code,
      message: 'channel is not accepting more viewers',
    });
  }

  socket.channel = message.channel;
  send(socket, { type: 'ready', channel: message.channel, instance: INSTANCE });

  // Backlog goes out before any live log can interleave: same socket, and
  // WebSocket preserves order.
  const logs = broker.backlog(message.channel);
  if (logs.length) send(socket, { type: 'backlog', channel: message.channel, logs });
}

wss.on('connection', (socket, req) => {
  const ip = clientIp(req.headers, req.socket);
  const open = connectionsPerIp.get(ip) || 0;

  if (wss.clients.size > maxConnections || open >= maxConnectionsPerIp) {
    socket.close(1008, 'connection limit reached');
    return;
  }
  connectionsPerIp.set(ip, open + 1);

  socket.isAlive = true;
  socket.channel = null;

  socket.on('pong', () => {
    socket.isAlive = true;
  });
  socket.on('message', (raw) => handleMessage(socket, raw));
  socket.on('error', () => {
    try {
      socket.terminate();
    } catch {}
  });
  socket.on('close', () => {
    broker.unsubscribeAll(socket);
    const left = (connectionsPerIp.get(ip) || 1) - 1;
    if (left <= 0) connectionsPerIp.delete(ip);
    else connectionsPerIp.set(ip, left);
  });
});

/**
 * Terminates half-open connections (laptop sleep, a proxy that dropped the
 * upstream silently). Without this the viewer would sit on a dead socket and
 * never trigger its own reconnect.
 */
const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    try {
      socket.ping();
    } catch {}
  }
}, 30_000);

function shutdown(signal) {
  console.log(`[livelog] ${signal} — closing`);
  clearInterval(heartbeat);
  for (const socket of wss.clients) {
    try {
      socket.close(1001, 'server shutting down');
    } catch {}
  }
  wss.close(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, HOST, () => {
  const channels = configuredChannels(tokens);
  console.log(`[livelog] listening on http://${HOST}:${PORT}`);
  console.log(`[livelog] send test events in a browser: http://localhost:${PORT}/`);
  console.log(
    `[livelog] POST ${LOG_PATH} · WS ${WS_PATH} · GET ${CHANNELS_PATH} · GET ${HEALTH_PATH}`
  );
  console.log(
    `[livelog] ${tokens.length} token(s) · channels: ${channels.length ? channels.join(', ') : '(none configured)'}`
  );
  console.log(`[livelog] origins: ${origins.join(', ')} · keeping ${maxLogs} logs per channel`);
});
