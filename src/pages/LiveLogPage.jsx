import { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from '../components/Modal.jsx';
import { EmptyState } from '../components/ItemRow.jsx';
import { ContentPane, SubAction, SubItem, SubSidebar } from '../components/SubSidebar.jsx';
import { Toast, useToast } from '../components/Shared.jsx';
import Code from '../components/Code.jsx';
import DocsModal from '../components/DocsModal.jsx';
import LogConsole from '../components/LogConsole.jsx';
import ServerModal from '../components/ServerModal.jsx';
import { downloadServerZip } from '../components/downloadServer.js';
import {
  SERVER_FOLDER,
  channelKey,
  normalizeServerUrl,
  normalizeWsUrl,
  resolveWsUrl,
  serverLabel,
} from '../lib/livelog.js';
import { useLiveLog, useActiveChannels } from '../lib/useLiveLog.js';
import { useLiveLogStore } from '../lib/useLiveLogStore.js';

const ENV_URL = normalizeServerUrl(import.meta.env.VITE_LIVELOG_URL || '');
const ENV_WS = import.meta.env.VITE_LIVELOG_WS_URL || '';
const ENV_CHANNELS = (import.meta.env.VITE_LIVELOG_CHANNELS || '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const DEFAULT_CHANNEL = (import.meta.env.VITE_LIVELOG_DEFAULT_CHANNEL || '').trim();

const CHANNEL_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
const FIELD =
  'w-full rounded-lg border border-border bg-bg px-2.5 py-2 text-[13px] text-text placeholder:text-muted focus:outline-none [color-scheme:dark]';

export function LiveLogPage() {
  const {
    ready,
    livelogChannel,
    livelogChannelUrl,
    livelogChannels,
    livelogUrl,
    livelogWsUrl,
    setLivelogChannel,
    addLivelogChannel,
    removeLivelogChannel,
    setLivelogServer,
  } = useLiveLogStore();
  const { toast, show } = useToast();

  const [docsOpen, setDocsOpen] = useState(false);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftUrl, setDraftUrl] = useState('');
  const [draftError, setDraftError] = useState('');
  const [serverOpen, setServerOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [sdkOrigin, setSdkOrigin] = useState('');

  useEffect(() => {
    setSdkOrigin(window.location.origin);
  }, []);

  const channelUrl = ready ? livelogChannelUrl : '';
  const savedUrl = ready ? livelogUrl : '';
  const savedWs = ready ? livelogWsUrl : '';
  const explicitUrl = channelUrl || savedUrl;
  const serverUrl = explicitUrl || ENV_URL;
  const savedChannel = ready
    ? livelogChannels.find(
        (entry) => channelKey(entry.name, entry.url) === channelKey(livelogChannel, channelUrl)
      ) || null
    : null;
  const serverWs =
    (savedChannel && savedChannel.wsUrl) ||
    (channelUrl ? resolveWsUrl(channelUrl) : '') ||
    savedWs ||
    resolveWsUrl(serverUrl, ENV_WS);

  const active = useActiveChannels(ready ? serverUrl : '');

  const rows = useMemo(() => {
    const list = [];
    const seen = new Set();
    const push = (name, url, wsUrl = '') => {
      if (!name) return;
      const key = channelKey(name, url);
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ key, name, url, wsUrl });
    };

    if (ready) for (const entry of livelogChannels) push(entry.name, entry.url, entry.wsUrl);
    for (const name of ENV_CHANNELS) push(name, '');
    push(DEFAULT_CHANNEL, '');
    if (ready) for (const entry of active) push(entry.name, explicitUrl);

    return list;
  }, [ready, livelogChannels, active, explicitUrl]);

  const rememberedKey = ready && livelogChannel ? channelKey(livelogChannel, channelUrl) : '';
  const selectedRow =
    rows.find((row) => row.key === rememberedKey) ||
    rows.find((row) => row.name === DEFAULT_CHANNEL && !row.url) ||
    rows[0] ||
    null;
  const channel = selectedRow ? selectedRow.name : '';
  const live = useLiveLog({ url: serverWs, channel });

  const trafficByName = useMemo(
    () => new Map(active.map((entry) => [entry.name, entry])),
    [active]
  );

  const configured = Boolean(serverUrl && serverWs);
  const setupSnippet = [
    `VITE_LIVELOG_URL=${ENV_URL || 'https://livelog.example.com'}`,
    `VITE_LIVELOG_WS_URL=${ENV_WS || 'wss://livelog.example.com/ws'}`,
    `VITE_LIVELOG_CHANNELS=${ENV_CHANNELS.join(',') || 'default'}`,
    `VITE_LIVELOG_DEFAULT_CHANNEL=${DEFAULT_CHANNEL || 'default'}`,
  ].join('\n');

  const copy = useCallback(
    async (text) => {
      try {
        await navigator.clipboard.writeText(text);
        show('Copied');
      } catch {
        show('Copy failed', 'error');
      }
    },
    [show]
  );

  const saveServer = useCallback(
    ({ url, wsUrl }) => {
      setLivelogServer({ url, wsUrl });
      show(url || wsUrl ? 'Server address saved' : 'Using the default server');
    },
    [setLivelogServer, show]
  );

  const downloadServer = useCallback(async () => {
    setDownloading(true);
    try {
      show(`Saved ${await downloadServerZip()}`);
    } catch (error) {
      show(`Could not build the server zip — ${error.message}`, 'error');
    } finally {
      setDownloading(false);
    }
  }, [show]);

  const selectChannel = useCallback(
    (name, url = '') => {
      setLivelogChannel(name, url);
      setChannelsOpen(false);
    },
    [setLivelogChannel]
  );

  const submitChannel = useCallback(() => {
    const name = draft.trim();
    if (!CHANNEL_PATTERN.test(name)) {
      setDraftError('Use 1-64 characters: letters, digits, dot, dash or underscore.');
      return;
    }

    const endpoint = draftUrl.trim();
    if (endpoint && !normalizeServerUrl(endpoint)) {
      setDraftError('Enter a full address, starting with http:// or https://');
      return;
    }

    addLivelogChannel(name, { url: endpoint });
    setDraft('');
    setDraftUrl('');
    setDraftError('');
    setChannelsOpen(false);
    show(endpoint ? `Watching ${name} on ${serverLabel(endpoint)}` : `Watching ${name}`);
  }, [draft, draftUrl, addLivelogChannel, show]);

  return (
    <>
      <SubSidebar
        title="Live Log"
        action={
          <div className="flex flex-shrink-0 items-center gap-1">
            <SubAction title="Setup and SDK docs" onClick={() => setDocsOpen(true)}>
              ?
            </SubAction>
            <SubAction title="Add a channel" onClick={() => setChannelsOpen(true)}>
              +
            </SubAction>
          </div>
        }
      >
        {rows.length === 0 ? <EmptyState text="No channels yet" /> : null}
        {rows.map((row) => {
          const isSelected = Boolean(selectedRow) && row.key === selectedRow.key;
          const info =
            (row.url || ENV_URL) === serverUrl ? trafficByName.get(row.name) || null : null;
          const host = row.url ? serverLabel(row.url) : '';
          const sub =
            [
              host,
              isSelected
                ? live.status
                : info
                  ? `${info.subscribers} viewer${info.subscribers === 1 ? '' : 's'} · ${info.recent} logs`
                  : '',
            ]
              .filter(Boolean)
              .join(' · ') || 'no traffic yet';

          return (
            <SubItem
              key={row.key}
              active={isSelected}
              onClick={() => selectChannel(row.name, row.url)}
              label={row.name}
              sub={sub}
              icon={
                <span
                  className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${
                    isSelected && live.status === 'connected'
                      ? 'bg-accent2'
                      : isSelected
                        ? 'bg-accent4'
                        : info
                          ? 'bg-accent2/40'
                          : 'bg-border'
                  }`}
                />
              }
            />
          );
        })}
      </SubSidebar>

      <ContentPane padded={false} scroll={false}>
        <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
          <header>
            <div className="text-[15px] font-semibold">Live Log</div>
            <div className="mt-0.5 text-[12.5px] text-muted">
              Realtime log stream from other projects. Nothing is stored — close or refresh this
              page and the history is gone.
            </div>
          </header>

          {!configured ? (
            <div className="overflow-y-auto rounded-card border border-border bg-panel p-5">
              <div className="text-[15px] font-semibold">No Live Log server yet</div>
              <p className="mt-1.5 max-w-[680px] text-[12.5px] text-muted">
                This page is only the viewer — the stream comes from a small standalone Node
                app, because a static site can hold no socket open.
                Run it somewhere, then point this page at it.
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={downloadServer}
                  disabled={downloading}
                  className="rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-white disabled:opacity-60"
                >
                  {downloading ? 'Building zip…' : `Download ${SERVER_FOLDER}.zip`}
                </button>
                <button
                  type="button"
                  onClick={() => setServerOpen(true)}
                  className="rounded-lg border border-border bg-panel2 px-3.5 py-2 text-[12.5px] text-muted hover:border-accent hover:text-text"
                >
                  I already have a server — set its address
                </button>
              </div>

              <ol className="mt-4 flex max-w-[680px] list-decimal flex-col gap-1 pl-5 text-[12.5px] text-muted">
                <li>
                  Unzip it, then copy{' '}
                  <span className="font-mono text-text">tokens.example.json</span> to{' '}
                  <span className="font-mono text-text">tokens.json</span> and put your own token in
                  it
                </li>
                <li>
                  <span className="font-mono text-text">npm install</span>, then{' '}
                  <span className="font-mono text-text">npm start</span> — it listens on{' '}
                  <span className="font-mono text-text">http://localhost:4504</span>
                </li>
                <li>
                  Come back here and set the server address to{' '}
                  <span className="font-mono text-text">http://localhost:4504</span>
                </li>
              </ol>

              <p className="mt-4 max-w-[680px] text-[12.5px] text-muted">
                Deploying this viewer itself? The same pair can be set as build-time defaults —
                inlined at build time, so changing them needs a redeploy. An address entered in
                the Server dialog wins over these:
              </p>
              <div className="mt-2 max-w-[680px]">
                <Code text={setupSnippet} onCopy={copy} />
              </div>
              <p className="mt-2 max-w-[680px] text-[11.5px] text-muted">
                Locally they belong in <span className="font-mono text-text">.env.local</span>.
              </p>
            </div>
          ) : !channel ? (
            <div className="flex flex-1 items-center justify-center rounded-card border border-border bg-panel">
              <div className="flex flex-col items-center gap-3">
                <EmptyState text="No channels yet." />
                <button
                  type="button"
                  onClick={() => setChannelsOpen(true)}
                  className="rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-white"
                >
                  Add a channel
                </button>
              </div>
            </div>
          ) : (
            <LogConsole
              status={live.status}
              entries={live.entries}
              paused={live.paused}
              pausedCount={live.pausedCount}
              channel={channel}
              server={serverLabel(serverWs)}
              onTogglePause={() => live.setPaused(!live.paused)}
              onClear={live.clear}
              onCopy={copy}
              onOpenDocs={() => setDocsOpen(true)}
              onOpenServer={() => setServerOpen(true)}
            />
          )}
        </div>
      </ContentPane>

      <DocsModal
        open={docsOpen}
        onClose={() => setDocsOpen(false)}
        onCopy={copy}
        sdkOrigin={sdkOrigin}
        endpoint={serverUrl}
        channel={channel}
      />

      <ServerModal
        open={serverOpen}
        onClose={() => setServerOpen(false)}
        url={savedUrl}
        wsUrl={ready ? livelogWsUrl : ''}
        defaultUrl={ENV_URL}
        defaultWsUrl={ENV_WS}
        effectiveUrl={serverUrl}
        effectiveWs={serverWs}
        channelHost={selectedRow && selectedRow.url ? serverLabel(selectedRow.url) : ''}
        onSave={saveServer}
        onReset={() => saveServer({ url: '', wsUrl: '' })}
        onDownload={downloadServer}
        downloading={downloading}
        onCopy={copy}
      />

      <Modal open={channelsOpen} title="Channels" onClose={() => setChannelsOpen(false)}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <div className="text-[12.5px] text-muted">
              Watch another channel. The name has to match what the sending project uses, and what
              that server&apos;s token config allows: letters, digits, dot, dash or underscore.
            </div>

            <div>
              <label
                className="mb-1 block text-[11px] tracking-wide text-muted uppercase"
                htmlFor="channel-name"
              >
                Channel
              </label>
              <input
                id="channel-name"
                autoFocus
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setDraftError('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submitChannel();
                }}
                placeholder="default"
                className={FIELD}
              />
            </div>

            <div>
              <label
                className="mb-1 block text-[11px] tracking-wide text-muted uppercase"
                htmlFor="channel-server"
              >
                Server — optional
              </label>
              <input
                id="channel-server"
                value={draftUrl}
                onChange={(event) => {
                  setDraftUrl(event.target.value);
                  setDraftError('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submitChannel();
                }}
                placeholder={ENV_URL || 'the default server'}
                className={FIELD}
              />
              <div className="mt-1 text-[11.5px] text-muted">
                Set it when the channel lives on another machine; leave it empty to use the default
                server.
              </div>
            </div>

            {draftError ? <div className="text-[11.5px] text-red-400">{draftError}</div> : null}

            <div>
              <button
                type="button"
                onClick={submitChannel}
                className="rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-white"
              >
                Add
              </button>
            </div>
          </div>

          {ready && livelogChannels.length > 0 ? (
            <div>
              <div className="mb-1.5 text-[12.5px] text-muted">Saved channels</div>
              <div className="flex flex-col gap-1">
                {livelogChannels.map((entry) => {
                  const key = channelKey(entry.name, entry.url);
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border bg-panel2 px-2.5 py-1.5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[12px] text-text">
                          {entry.name}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-muted">
                          {entry.url ? serverLabel(entry.url) : 'default server'}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeLivelogChannel(key)}
                        title={`Stop watching ${entry.name}`}
                        className="flex-shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 text-base leading-none text-muted hover:bg-red-400/10 hover:text-red-400"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </Modal>

      <Toast toast={toast} />
    </>
  );
}
