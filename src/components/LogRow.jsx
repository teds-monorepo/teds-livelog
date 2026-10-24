
import { DETAIL_HEIGHT, ROW_HEIGHT, formatLogLine, formatTime, safeStringify } from '../lib/livelog.js';

/**
 * Level palette. It lives here rather than in `lib/livelog.js` because
 * `tailwind.config.js` only scans `index.html` and `src/` — a class name
 * written in `lib/` would never be generated.
 *
 * The colours follow docs/DESIGN.md: DEBUG is muted, INFO the primary accent,
 * WARN the orange accent, ERROR reserved `red-400` (the app's one error red).
 */
const PALETTE = {
  debug: { badge: 'border-border bg-panel2 text-muted', message: 'text-muted', row: '' },
  info: { badge: 'border-accent/30 bg-accent/15 text-accent', message: 'text-text', row: '' },
  warn: {
    badge: 'border-accent4/30 bg-accent4/15 text-accent4',
    message: 'text-accent4',
    row: 'bg-accent4/[0.05]',
  },
  error: {
    badge: 'border-red-400/30 bg-red-400/15 text-red-400',
    message: 'text-red-400',
    row: 'bg-red-400/[0.06]',
  },
};

const MINI_BTN =
  'rounded-md border border-border bg-panel2 px-2 py-0.5 text-[10px] text-muted hover:text-text hover:border-accent';

/**
 * One log line, positioned absolutely by the virtualised list. Row height is
 * exactly ROW_HEIGHT and the expanded detail exactly DETAIL_HEIGHT, which is
 * what lets `rowOffsets` compute positions without measuring anything — so the
 * message is clamped to a single line and the JSON scrolls inside its own box.
 * Only one row is ever expanded; see `LogConsole`.
 */
export default function LogRow({ log, top, expanded, onToggle, onCopy }) {
  const palette = PALETTE[log.level] || PALETTE.info;

  return (
    <div
      className={`absolute left-0 right-0 ${palette.row}`}
      style={{ top, height: expanded ? ROW_HEIGHT + DETAIL_HEIGHT : ROW_HEIGHT }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 border-b border-border/40 px-3 text-left font-mono text-[12px] hover:bg-panel2/60"
        style={{ height: ROW_HEIGHT }}
      >
        <span className="w-[92px] flex-shrink-0 text-[11px] tabular-nums text-muted">
          {formatTime(log.timestamp)}
        </span>
        <span
          className={`w-[52px] flex-shrink-0 rounded-[4px] border py-px text-center text-[10px] font-semibold tracking-wide ${palette.badge}`}
        >
          {log.level.toUpperCase()}
        </span>
        {log.source ? (
          <span className="max-w-[160px] flex-shrink-0 truncate text-[11px] text-muted">
            [{log.source}]
          </span>
        ) : null}
        <span className={`min-w-0 flex-1 truncate ${palette.message}`}>{log.message}</span>
        {log.hasData ? (
          <span className="flex-shrink-0 text-[10px] text-muted">{expanded ? '▾' : '▸'} data</span>
        ) : (
          <span className="w-[38px] flex-shrink-0" />
        )}
      </button>

      {expanded ? (
        <div className="px-3 py-2" style={{ height: DETAIL_HEIGHT }}>
          <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-panel">
            <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
                {formatTime(log.timestamp)} · {log.level.toUpperCase()}
                {log.source ? ` · ${log.source}` : ''}
                {log.channel ? ` · ${log.channel}` : ''}
              </span>
              <button type="button" onClick={() => onCopy(formatLogLine(log))} className={MINI_BTN}>
                Copy line
              </button>
              {log.hasData ? (
                <button
                  type="button"
                  onClick={() => onCopy(safeStringify(log.data, 2))}
                  className={MINI_BTN}
                >
                  Copy JSON
                </button>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2.5">
              <div className="mb-1.5 font-mono text-[11.5px] break-words text-text">
                {log.message}
              </div>
              {log.hasData ? (
                <pre className="font-mono text-[11px] whitespace-pre-wrap break-words text-accent2">
                  {safeStringify(log.data, 2)}
                </pre>
              ) : (
                <div className="font-mono text-[11px] text-muted">No structured data.</div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
