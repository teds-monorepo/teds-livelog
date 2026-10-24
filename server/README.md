# Live Log — realtime server

Accepts logs over HTTP, keeps the newest ones per channel **in memory**, and
pushes them to everyone watching that channel over WebSocket. The viewer is a
static site, so it cannot hold a socket or share memory between viewers — this
process is what makes the stream possible.

**No database, no disk.** Restarting loses every log; that is the design.
**Run exactly one instance** — two processes each hold their own viewers and
their own `seq`, so a log sent to one never reaches viewers on the other.

---

## Quick start

```bash
cd server
npm install
cp tokens.example.json tokens.json     # then edit in your own tokens
LIVELOG_TOKENS_FILE=./tokens.json npm run dev
```

It listens on `http://localhost:4504` and prints:

```
[livelog] send test events in a browser: http://localhost:4504/
```

**Open that address.** Paste a token from `tokens.json`, and press one of the
`debug` / `info` / `warn` / `error` buttons. Each sends a sample log and shows
the response inline; the message and JSON `data` fields let you send anything
else. No token? Send anyway to see the 401.

## Connect the viewer

The viewer is a separate static app. Point it at this server either at build
time (`.env.local`) or, more conveniently, at runtime through its **Server**
dialog — that needs no rebuild:

```
VITE_LIVELOG_URL=http://localhost:4504
VITE_LIVELOG_WS_URL=ws://localhost:4504/ws
VITE_LIVELOG_CHANNELS=default
VITE_LIVELOG_DEFAULT_CHANNEL=default
```

Both sides must be on the same channel, or the logs land somewhere you are not
looking. Restarting the server drops the backlog, and the viewer notices the new
`instance` id and clears its own copy.

## Tokens

`tokens.json` holds one entry per project; each entry lists the channels it may
write to. Only sending needs a token — watching is open.

```json
{ "tokens": [{ "token": "tk_live_...", "label": "default client", "channels": ["default"] }] }
```

Generate a value worth using:

```bash
node -e "console.log('tk_live_' + require('crypto').randomBytes(24).toString('base64url'))"
```

Add an entry to create a token, remove it and restart to revoke. See
`env.example` for every option; they are all optional.

## API

### `POST /api/log`

```
Authorization: Bearer <token>
Content-Type: application/json

{ "channel": "default", "level": "info", "source": "GameClient",
  "message": "Player connected", "data": { "playerId": 123 } }

202 { "ok": true, "seq": 42, "timestamp": 1791330135123 }
401 invalid/missing token      403 token doesn't own that channel
400 bad channel/level/message  413 over a size cap
429 rate limited               503 channel capacity reached
```

`level` is one of `debug`, `info`, `warn`, `error`. `source` and `data` are
optional; `data` may be any JSON value.

### `GET /api/channels`

Channels with recent traffic — what the viewer lists in its sidebar.

```json
{ "channels": [{ "name": "default", "subscribers": 2, "recent": 184, "lastAt": 1791330135123 }] }
```

### `GET /healthz`

`{ "ok": true, "uptime": 3610, "channels": 2, "subscribers": 3 }` — use it as a
deploy health check.

### `WS /ws`

```
client → { "type": "subscribe", "channel": "default" }
         { "type": "unsubscribe" }
         { "type": "ping" }

server → { "type": "ready", "channel": "default", "instance": "<uuid>" }
         { "type": "backlog", "channel": "default", "logs": [ ...200 newest... ] }
         { "type": "log", "log": { "channel", "level", "message", "source", "data", "seq", "timestamp" } }
         { "type": "error", "code", "message" }
         { "type": "pong" }
```

The backlog arrives after `subscribe` (the channel is unknown before that) and
always before any live log, so a viewer can dedupe by `seq` and never reorder.

### `GET /` (also `/test.html`)

The built-in test sender described above. Read from `test.html` beside
`server.js` on each request; if that file is missing the route answers 404
rather than failing at startup. It carries no secret — the token is typed in.

## Limits

| Guard                    | Default                   | Env                                                         |
| ------------------------ | ------------------------- | ----------------------------------------------------------- |
| Message size             | 10 KB                     | `LIVELOG_MAX_MESSAGE_BYTES`                                 |
| `data` size (serialised) | 50 KB                     | `LIVELOG_MAX_DATA_BYTES`                                    |
| Logs kept per channel    | 5000                      | `LIVELOG_MAX_LOGS`                                          |
| Replayed on subscribe    | 200                       | `LIVELOG_REPLAY`                                            |
| Writes per token+channel | 20/s, burst 100           | `LIVELOG_RATE_PER_SEC`, `LIVELOG_RATE_BURST`                |
| Failed auth per IP       | 2/s, burst 20             | `LIVELOG_AUTH_PER_SEC`, `LIVELOG_AUTH_BURST`                |
| Channels                 | 200 (idle ones reclaimed) | `LIVELOG_MAX_CHANNELS`                                      |
| Viewers per channel      | 100                       | `LIVELOG_MAX_SUBSCRIBERS`                                   |
| Viewer sockets           | 500 total, 20 per IP      | `LIVELOG_MAX_CONNECTIONS`, `LIVELOG_MAX_CONNECTIONS_PER_IP` |

Bodies are refused as they stream past the cap rather than after buffering, and
tokens are compared as sha256 digests. Channel names are effectively public, so
use an unguessable one for anything sensitive.

## Deploy

### Fly.io (recommended)

WebSockets pass through Fly's proxy unchanged, and one machine can be pinned so
it never sleeps.

```bash
cd server
fly launch --no-deploy          # name it something unique, keep the Dockerfile
fly secrets set LIVELOG_ALLOWED_ORIGINS=https://livelog.example.com
fly secrets set LIVELOG_TOKENS='{"tokens":[{"token":"tk_live_...","label":"default","channels":["default"]}]}'
fly deploy
fly scale count 1               # exactly one instance, no autostop
```

`tokens.json` is not in the image (the Dockerfile copies only `server.js` and
`lib/`), so pass the config inline as above or mount it as a secret file. Add a
TLS domain with `fly certs add livelog.example.com` so the page can use `wss://`.

### Other hosts

- **Render** — Web Service, root directory `server`, build `npm install`, start
  `npm start`, health check `/healthz`. Use a **paid** instance: the free plan
  spins down when idle and drops every viewer and log.
- **Railway** — root directory `server`, add the env vars, keep one replica.
- **Any VPS** — `npm install --omit=dev`, then run under systemd/pm2 with
  `LIVELOG_TOKENS_FILE=./tokens.json PORT=4504 node server.js`. Put Caddy in
  front for TLS; it forwards the WebSocket upgrade and sets `x-forwarded-for`,
  which `LIVELOG_TRUST_PROXY` (on by default) expects:

  ```
  livelog.example.com {
    reverse_proxy 127.0.0.1:4504
  }
  ```

### After deploying

Set the viewer's build-time vars to the new origin and redeploy — they are
inlined at build time:

```
VITE_LIVELOG_URL=https://livelog.example.com
VITE_LIVELOG_WS_URL=wss://livelog.example.com/ws
```

It must be `https`/`wss`: an HTTPS page blocks a plain `ws://` connection as
mixed content.

## Getting a copy

The viewer's **Server** dialog offers `livelog-server.zip` with the files needed
to run this folder elsewhere — no clone required. Because of that, **everything
in this folder is world-readable**, so a real `tokens.json` must never be
committed (it is gitignored).
