
import { useCallback, useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import Code from './Code.jsx';
import {
  SERVER_DIR,
  SERVER_FOLDER,
  normalizeServerUrl,
  normalizeWsUrl,
  resolveWsUrl,
} from '../lib/livelog.js';

const FIELD =
  'w-full rounded-lg border border-border bg-bg px-2.5 py-2 font-mono text-[12.5px] text-text placeholder:text-muted focus:outline-none [color-scheme:dark]';
const LABEL = 'mb-1 block text-[11px] tracking-wide text-muted uppercase';
const PRIMARY =
  'rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-white disabled:opacity-60';
const GHOST =
  'rounded-lg border border-border bg-panel2 px-3.5 py-2 text-[12.5px] text-muted hover:border-accent hover:text-text disabled:opacity-60';

const RUN = ['npm install', 'npm start'].join('\n');

function Section({ title, children }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/**
 * The Server dialog: where /livelog connects, and how to get a server of your
 * own. The address here is stored per browser (through useLiveLogStore), so it beats
 * the build-time VITE_LIVELOG_* values without needing a rebuild.
 */
export default function ServerModal({
  open,
  onClose,
  url,
  wsUrl,
  defaultUrl,
  defaultWsUrl,
  effectiveUrl,
  effectiveWs,
  channelHost,
  onSave,
  onReset,
  onDownload,
  downloading,
  onCopy,
}) {
  const [draftUrl, setDraftUrl] = useState('');
  const [draftWs, setDraftWs] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraftUrl(url || '');
    setDraftWs(wsUrl || '');
    setError('');
  }, [open, url, wsUrl]);

  const typedUrl = normalizeServerUrl(draftUrl);
  const typedWs = draftWs.trim() ? normalizeWsUrl(draftWs) : '';

  // "In use" has to state the truth: the draft being typed (with its socket
  // derived — the default socket belongs to the default server and must not be
  // shown against another one), or, when nothing is being typed, the pair the
  // page is actually on. For a channel that carries its own server that is not
  // this dialog's default.
  let inUseUrl;
  let inUseWs;
  if (typedUrl || typedWs) {
    inUseUrl = typedUrl || defaultUrl;
    inUseWs = typedWs || resolveWsUrl(inUseUrl, '');
  } else {
    inUseUrl = effectiveUrl || defaultUrl;
    inUseWs = effectiveWs || resolveWsUrl(inUseUrl, defaultWsUrl);
  }

  const save = useCallback(() => {
    const cleanUrl = normalizeServerUrl(draftUrl);
    if (draftUrl.trim() && !cleanUrl) {
      setError('Enter a full address, starting with http:// or https://');
      return;
    }
    const cleanWs = draftWs.trim() ? normalizeWsUrl(draftWs) : '';
    if (draftWs.trim() && !cleanWs) {
      setError('The socket address must start with ws:// or wss://');
      return;
    }
    onSave({ url: cleanUrl, wsUrl: cleanWs });
    onClose();
  }, [draftUrl, draftWs, onSave, onClose]);

  return (
    <Modal open={open} title="Live Log server" onClose={onClose}>
      <div className="flex flex-col gap-6">
        <Section title="Default server">
          <p className="text-[12.5px] text-muted">
            Where this page sends its socket whenever the channel being watched does not carry an
            address of its own. Saved in this browser, so it works without rebuilding the app —
            leave a field empty to fall back to the deployed default.
          </p>
          <p className="text-[12px] text-muted">
            A channel added with its own server (a channel on another machine) keeps using that one,
            so this stays the fallback for everything else. The{' '}
            <span className="text-text">In use</span> box below always shows the pair actually in
            effect.
          </p>

          <div>
            <label className={LABEL} htmlFor="livelog-url">
              Server (http)
            </label>
            <input
              id="livelog-url"
              value={draftUrl}
              onChange={(event) => {
                setDraftUrl(event.target.value);
                setError('');
              }}
              placeholder={defaultUrl || 'http://localhost:8787'}
              className={FIELD}
            />
          </div>

          <div>
            <label className={LABEL} htmlFor="livelog-ws">
              Socket (ws) — optional
            </label>
            <input
              id="livelog-ws"
              value={draftWs}
              onChange={(event) => {
                setDraftWs(event.target.value);
                setError('');
              }}
              placeholder={
                draftUrl.trim()
                  ? 'derived from the server address'
                  : defaultWsUrl || 'derived from the server address'
              }
              className={FIELD}
            />
          </div>

          {channelHost ? (
            <p className="text-[12px] text-accent4">
              The channel on screen carries its own server ({channelHost}), so that one is in use
              and the default below is not.
            </p>
          ) : null}

          <div className="rounded-lg border border-border bg-panel2 px-2.5 py-2">
            <div className="text-[11px] tracking-wide text-muted uppercase">In use</div>
            <div className="mt-1 font-mono text-[12px] break-all text-text">
              {inUseUrl || '— none —'}
            </div>
            <div className="font-mono text-[11.5px] break-all text-muted">
              {inUseWs || '— none —'}
            </div>
          </div>

          {error ? <div className="text-[11.5px] text-red-400">{error}</div> : null}

          <div className="flex gap-2">
            <button type="button" onClick={save} className={PRIMARY}>
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setDraftUrl('');
                setDraftWs('');
                setError('');
                onReset();
              }}
              className={GHOST}
            >
              Use defaults
            </button>
          </div>
        </Section>

        <Section title="Run your own server">
          <p className="text-[12.5px] text-muted">
            The realtime server is a small standalone Node app — one dependency, no database.
            Download it, start it anywhere, then point the address above at it.
          </p>

          <ol className="flex list-decimal flex-col gap-1 pl-5 text-[12.5px] text-muted">
            <li>Unzip {SERVER_FOLDER}.zip</li>
            <li>
              Copy <span className="font-mono text-text">tokens.example.json</span> to{' '}
              <span className="font-mono text-text">tokens.json</span> and set your own token
            </li>
            <li>Run it — it listens on http://localhost:8787</li>
          </ol>

          <Code text={RUN} onCopy={onCopy} />

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={onDownload} disabled={downloading} className={PRIMARY}>
              {downloading ? 'Building zip…' : `Download ${SERVER_FOLDER}.zip`}
            </button>
            <a
              href={`${SERVER_DIR}/README.md`}
              target="_blank"
              rel="noopener noreferrer"
              className={GHOST}
            >
              Read the README
            </a>
          </div>
          <p className="text-[11.5px] text-muted">
            Deploying it to a host that keeps a process alive (Fly.io, Render, Railway, a VPS)? The
            README covers that, plus the tokens and limits.
          </p>
        </Section>
      </div>
    </Modal>
  );
}
