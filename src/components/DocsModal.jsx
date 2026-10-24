
import Modal from './Modal.jsx';
import Code from './Code.jsx';

function Section({ title, children }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/**
 * The quick-reference shown from the console toolbar. The full version — server
 * deployment, tokens, limits — lives in `docs/LIVE-LOG.md`.
 *
 * Two origins matter here, and they are usually different: `sdkOrigin` is this
 * hub, which serves the SDK files; `endpoint` is the realtime server the logs
 * are posted to.
 */
export default function DocsModal({ open, onClose, onCopy, sdkOrigin, endpoint, channel }) {
  const sdk = sdkOrigin || 'https://YOUR-HUB';
  const server = endpoint || 'https://livelog.example.com';
  const name = channel || 'default';

  return (
    <Modal open={open} title="Live Log — setup" onClose={onClose}>
      <div className="flex flex-col gap-5">
        <p className="text-[12.5px] text-muted">
          Load the SDK in any project, point it at this hub, and its logs appear on this page in
          real time. Logs are never stored: they exist only while this page is open.
        </p>

        <Section title="1. Install">
          <Code text={`<script src="${sdk}/livelog.js"></script>`} onCopy={onCopy} />
          <p className="text-[12px] text-muted">Or as a module:</p>
          <Code text={`import { LiveLog } from "${sdk}/livelog.esm.js";`} onCopy={onCopy} />
        </Section>

        <Section title="2. Initialise">
          <Code
            text={`LiveLog.init({
  endpoint: "${server}",
  channel: "${name}",
  token: "YOUR_TOKEN",
  source: "GameClient"
});`}
            onCopy={onCopy}
          />
          <p className="text-[12px] text-muted">
            <span className="font-mono text-text">endpoint</span> is the realtime server that
            carries the logs — leave it off when the SDK is served from that same origin. The token
            comes from the server&apos;s <span className="font-mono text-text">tokens.json</span>{' '}
            and is only needed to <em>send</em> logs: watching a channel here needs no token.
          </p>
        </Section>

        <Section title="3. Send">
          <Code
            text={`LiveLog.debug("Loading configuration", { version: "1.0.0" });
LiveLog.info("Player connected", { playerId: 123 });
LiveLog.warn("Missing configuration", { key: "gameConfig" });
LiveLog.error("Connection failed", { error: "Network timeout" });`}
            onCopy={onCopy}
          />
          <Code
            text={`LiveLog.send({
  level: "info",
  message: "Player connected",
  data: { playerId: 123, roomId: "room_01" }
});`}
            onCopy={onCopy}
          />
          <p className="text-[12px] text-muted">
            Calls never throw and never break the host app: if the server is unreachable they are
            queued, retried a few times, then dropped. Turn on{' '}
            <span className="font-mono text-text">debug: true</span> in{' '}
            <span className="font-mono text-text">init()</span> to see what the SDK is doing in the
            console.
          </p>
        </Section>

        <Section title="4. Watch">
          <p className="text-[12.5px] text-muted">
            Pick the channel in the sidebar on this page. The status dot shows the socket at a
            glance — <span className="text-accent2">● Connected</span> or{' '}
            <span className="text-muted">○ Disconnected</span> — and it reconnects on its own. Only
            events that arrive while the page is open are kept, up to 5000 lines.
          </p>
        </Section>

        <Section title="5. Before you rely on it">
          <ul className="flex list-disc flex-col gap-1 pl-5 text-[12.5px] text-muted">
            <li>
              Channel names are effectively public (anyone with the page can pick one), so use an
              unguessable name for anything sensitive.
            </li>
            <li>
              A token can only write to the channels it lists; anything else is refused with a 403.
            </li>
            <li>
              Per log: message ≤ 10 KB, data ≤ 50 KB. Per token and channel: 20 logs/s sustained,
              burst 100. Older logs are discarded once a channel holds 5000.
            </li>
            <li>
              Logs live in the realtime server&apos;s memory only. Restarting it — or refreshing
              this page — loses them. That is the design, not a bug.
            </li>
          </ul>
        </Section>
      </div>
    </Modal>
  );
}
