# Live Log

Realtime log viewer + broadcast server. Send log lines from any project and watch
them appear in the viewer in real time. Nothing is stored: logs live in the
server's memory and in the open page, and both are gone on the next restart or
refresh.

- Viewer: Vite + React static site (`src/`), deployable to Cloudflare Pages
- SDK: `public/livelog.js` (classic script) and `public/livelog.esm.js` (module)
- Realtime server: `server/` — its own deployable, downloadable from the viewer
  itself, with its own [README](server/README.md) covering hosting and ops

## Commands

```bash
pnpm install
pnpm dev
pnpm dev:server
pnpm build
```

`pnpm dev` serves the viewer on http://localhost:5174; `pnpm dev:server` runs
the realtime server on http://localhost:8787; `pnpm build` writes static files
to `dist/` (syncing `server/` into `public/server/` first).
```

Local end-to-end: run `dev:server` in one terminal and `dev` in another, set
`VITE_LIVELOG_URL=http://localhost:8787` in `.env.local`, then POST a log (see
`server/README.md`).

## Project structure

```
src/
  App.jsx             routes: index (viewer) + 404
  pages/
    LiveLogPage.jsx   viewer — realtime log console + channel list
  components/         LogConsole, LogRow, DocsModal, ServerModal, Code, Modal,
                      SubSidebar, Shared (Toast), ItemRow (EmptyState)
  lib/
    livelog.js        pure helpers (level/format/filter/row-offset maths, server allowlist)
    useLiveLog.js     socket hook — reconnect, rAF batching, pause, dedupe
    useLiveLogStore.js localStorage persistence for channels + server address
    zip.js            store-only ZIP writer + downloadBlob
public/
  livelog.js          standalone SDK (window.LiveLog, no dependencies)
  livelog.esm.js      module entry point that re-exports it
  server/             generated at build time from server/ (world-readable)
server/
  server.js           the realtime broadcast process
  lib/                broker (ring buffers) + guard (auth, limits, validation)
```

## Rules

- The viewer is static — no server runtime. The SDK posts straight to the
  realtime server; there is no API route and no database.
- Restarting the server drops every log. Run exactly one instance.
- Reads are open, so sensitive channels need unguessable names.
- `public/server/` is world-readable — never put a real `tokens.json` there.
