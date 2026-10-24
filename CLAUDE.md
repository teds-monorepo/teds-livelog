# CLAUDE.md

Guidance for Claude (or any AI assistant) working in this repository.

## What this project is

Live Log — a realtime log viewer plus its broadcast server. Send log lines from
any project (via the standalone SDK in `public/`) and watch them appear in the
viewer in real time. React 18, Vite, Tailwind CSS. Nothing is stored: logs live
in the realtime server's memory and in the open page.

Dark theme, rounded cards, left sidebar nav with a collapse toggle.

## Commands

```bash
pnpm dev
pnpm dev:server
pnpm build
```

`pnpm dev` serves the viewer on http://localhost:4503; `pnpm dev:server` runs
the realtime server on http://localhost:4504; `pnpm build` writes production
static files to `dist/`.
```

There are no automated tests yet. If you add non-trivial logic (especially in
`lib/`), prefer writing it as a small pure function so it's easy to test later.

## Project structure

```
src/
  App.jsx             routes: index (viewer) + 404
  pages/
    LiveLogPage.jsx   viewer — realtime log console + channel list
  components/         console (LogConsole), one row (LogRow) and the setup
                      modals (DocsModal, ServerModal). The level colour classes
                      stay in LogRow.jsx — tailwind.config.js only scans src/,
                      so a class name written in lib/ would never be generated.
  lib/
    livelog.js        pure helpers (level/format/filter/row-offset maths,
                      server file allowlist)
    useLiveLog.js     socket hook — reconnect, rAF batching, pause, dedupe
    useLiveLogStore.js localStorage persistence for channels + server address
    zip.js            store-only ZIP writer + downloadBlob
public/
  livelog.js         standalone SDK — zero deps, defines window.LiveLog,
                     and deliberately has no import/export statements
  livelog.esm.js     module entry point: side-effect imports the above and
                     re-exports LiveLog (so both <script> and `import` work)
  server/            generated at build time from server/ (see
                     scripts/sync-server.mjs) so the viewer can download a zip —
                     treat the folder as world-readable
server/
  server.js          the realtime broadcast process (see server/README.md)
  lib/               broker (ring buffers) + guard (auth, limits, validation)
```

## Rules for changes in this repo

1. **The viewer is static — no server runtime.** Nothing runs on a Node server at
   request time.
2. **Keep tool logic in `lib/` as pure functions** (input in, output out, no
   DOM/state). Pages and components only wire them to inputs and buttons.
3. **Follow existing Tailwind token usage** (`bg-panel`, `bg-panel2`,
   `border-border`, `text-muted`, `text-accent`/`accent2`/`accent3`/`accent4`,
   `rounded-card`) instead of raw hex values or ad hoc radii.
4. Before calling a UI change done, run `pnpm build` — the app must compile
   cleanly.
5. **Live Log spans two deployables, and none of it is persisted.** The viewer
   and the SDK are static files; the socket, the token check, the rate limiting
   and the log buffers live in `server/`. So: don't add an API route for it,
   don't introduce a database, Redis or any disk storage, and don't make logs
   survive a restart — they exist only in that one process's memory and in the
   open page. At build time the sync script copies that folder's world-readable
   files into `public/server/` so the page serves them for download
   (`SERVER_FILES` in `lib/livelog.js` is the allowlist the zip is built from),
   which means **anything put there is world-readable** — keep real tokens in
   `tokens.json`, which is gitignored.
6. **Run exactly one server instance.** A second process has its own `seq`
   counter and its own viewers, so broadcasts only reach the viewers on the same
   process.

## Deployment

The viewer build emits static files (`dist/`), deployed to **Vercel** as a plain
static site (`vercel.json`: framework `vite`, output `dist`, catch-all rewrite to
`index.html` for React Router). `public/_redirects` is kept for Cloudflare
Pages, which ignores `vercel.json`; Vercel ignores `_redirects` and uses the
rewrite instead, so both hosts work from one build.

The realtime server is **not** deployed anywhere by this repo — whoever runs the
viewer downloads `livelog-server.zip` from the page and hosts it themselves
(local, Fly.io, a VPS). Vercel cannot host it: the broker holds sockets and
in-memory state in one process, while Vercel Functions cut WebSockets at the
300 s max duration and do not pin reconnects to the same instance.
