
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from './ItemRow.jsx';
import LogRow from './LogRow.jsx';
import {
  DETAIL_HEIGHT,
  LEVELS,
  buildCopyText,
  collectSources,
  filterLogs,
  rowOffsets,
  visibleRange,
} from '../lib/livelog.js';

const GHOST =
  'whitespace-nowrap rounded-lg border border-border bg-panel2 px-2.5 py-1.5 text-[12px] text-muted hover:border-accent hover:text-text';
const GHOST_ON =
  'whitespace-nowrap rounded-lg border border-accent/40 bg-accent/[0.14] px-2.5 py-1.5 text-[12px] text-text';
const FIELD =
  'rounded-lg border border-border bg-bg px-2 py-1.5 text-[12.5px] text-text placeholder:text-muted focus:outline-none [color-scheme:dark]';

/** Chip colours per level — the same four accents LogRow uses for the badges. */
const CHIPS = {
  debug: {
    on: 'border-border bg-panel2 text-text',
    off: 'border-transparent text-muted hover:text-text',
  },
  info: {
    on: 'border-accent/40 bg-accent/15 text-accent',
    off: 'border-transparent text-muted hover:text-accent',
  },
  warn: {
    on: 'border-accent4/40 bg-accent4/15 text-accent4',
    off: 'border-transparent text-muted hover:text-accent4',
  },
  error: {
    on: 'border-red-400/40 bg-red-400/15 text-red-400',
    off: 'border-transparent text-muted hover:text-red-400',
  },
};

const STATUS = {
  connected: { text: 'Connected', tone: 'text-accent2', dot: 'bg-accent2' },
  connecting: { text: 'Connecting', tone: 'text-accent4', dot: 'bg-accent4' },
  disconnected: { text: 'Disconnected', tone: 'text-muted', dot: 'border border-muted' },
  idle: { text: 'Idle', tone: 'text-muted', dot: 'border border-muted' },
};

const FALLBACK_HEIGHT = 600;

/**
 * The log console: a sticky toolbar over a virtualised list.
 *
 * Rows are absolutely positioned inside a spacer of exactly `total` height, and
 * only the rows inside the viewport (plus a little overscan) are mounted. That
 * works because every row is one of two known heights — see LogRow — so offsets
 * never have to be measured, and 5000 retained logs cost the same to scroll as
 * fifty.
 *
 * Filter, search and expansion state is local to this component; the logs
 * themselves, and whether we are paused, come from `useLiveLog`.
 */
export default function LogConsole({
  status = 'idle',
  entries = [],
  paused = false,
  pausedCount = 0,
  channel = '',
  server = '',
  onTogglePause,
  onClear,
  onCopy,
  onOpenDocs,
  onOpenServer,
}) {
  const [levels, setLevels] = useState(() => new Set(LEVELS));
  const [source, setSource] = useState('');
  const [query, setQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedSeq, setExpandedSeq] = useState(0);
  const [view, setView] = useState({ top: 0, height: 0 });

  const scrollRef = useRef(null);
  const anchorRef = useRef(null);

  const sources = useMemo(() => collectSources(entries), [entries]);
  const visible = useMemo(
    () => filterLogs(entries, { levels, source, query }),
    [entries, levels, source, query]
  );
  const offsets = useMemo(() => rowOffsets(visible, expandedSeq), [visible, expandedSeq]);
  const range = useMemo(
    () => visibleRange(offsets, view.top, view.height || FALLBACK_HEIGHT),
    [offsets, view]
  );

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const measure = () =>
      setView((current) =>
        current.height === element.clientHeight
          ? current
          : { ...current, height: element.clientHeight }
      );
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const handleScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    // Pin to the bottom while the user is at (or very near) the bottom; the
    // moment they scroll up, leave the view where they put it.
    const atBottom = element.scrollHeight - element.clientHeight - element.scrollTop <= 4;
    setAutoScroll(atBottom);
    setView((current) =>
      current.top === element.scrollTop ? current : { ...current, top: element.scrollTop }
    );
  }, []);

  useLayoutEffect(() => {
    if (!autoScroll) return;
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    setView((current) =>
      current.top === element.scrollTop ? current : { ...current, top: element.scrollTop }
    );
  }, [autoScroll, offsets, visible.length]);

  const jumpToLatest = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    setAutoScroll(true);
    element.scrollTop = element.scrollHeight;
    setView((current) => ({ ...current, top: element.scrollTop }));
  }, []);

  /**
   * Expanding a row above the viewport pushes everything down, so the scroll
   * position is corrected by the same amount — otherwise opening a detail
   * scrolls the list under you.
   */
  const toggleRow = useCallback(
    (seq) => {
      const element = scrollRef.current;
      const index = visible.findIndex((entry) => entry.seq === seq);
      const next = expandedSeq === seq ? 0 : seq;
      if (element && index >= 0 && offsets[index] < element.scrollTop) {
        anchorRef.current = { delta: next ? DETAIL_HEIGHT : -DETAIL_HEIGHT };
      }
      setExpandedSeq(next);
    },
    [expandedSeq, offsets, visible]
  );

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    anchorRef.current = null;
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop += anchor.delta;
    setView((current) => ({ ...current, top: element.scrollTop }));
  }, [offsets]);

  const toggleLevel = useCallback((level) => {
    setLevels((current) => {
      const next = new Set(current);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      // Never leave all four off — an empty console with no visible reason
      // reads as broken.
      return next.size === 0 ? new Set([level]) : next;
    });
  }, []);

  const state = STATUS[status] || STATUS.idle;
  const hidden = visible.length !== entries.length;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-border bg-panel">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-panel2 px-3 py-2">
        <span className={`flex items-center gap-1.5 text-[12px] ${state.tone}`}>
          <span className={`h-2 w-2 flex-shrink-0 rounded-full ${state.dot}`} />
          {state.text}
        </span>
        {channel ? <span className="font-mono text-[12px] text-text">{channel}</span> : null}
        {server ? <span className="font-mono text-[11px] text-muted">{server}</span> : null}
        <span className="text-[11px] text-muted">
          {visible.length.toLocaleString()}
          {hidden ? ` / ${entries.length.toLocaleString()}` : ''} logs
        </span>

        <span className="mx-1 h-4 w-px bg-border" />

        {LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => toggleLevel(level)}
            title={`Show or hide ${level} logs`}
            className={`rounded-[7px] border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${
              levels.has(level) ? CHIPS[level].on : CHIPS[level].off
            }`}
          >
            {level.toUpperCase()}
          </button>
        ))}

        <select
          value={source}
          onChange={(event) => setSource(event.target.value)}
          title="Filter by source"
          className={`${FIELD} max-w-[150px]`}
        >
          <option value="">All sources</option>
          {sources.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search…"
          className={`${FIELD} w-[150px]`}
        />

        <span className="min-w-2 flex-1" />

        <button type="button" onClick={onTogglePause} className={paused ? GHOST_ON : GHOST}>
          {paused
            ? `Resume${pausedCount ? ` · ${pausedCount.toLocaleString()} new` : ''}`
            : 'Pause'}
        </button>
        <button
          type="button"
          onClick={() => setAutoScroll((current) => !current)}
          className={autoScroll ? GHOST_ON : GHOST}
        >
          Auto Scroll
        </button>
        <button type="button" onClick={onClear} className={GHOST}>
          Clear
        </button>
        <button type="button" onClick={() => onCopy(buildCopyText(visible))} className={GHOST}>
          Copy All
        </button>
        <button type="button" onClick={onOpenServer} className={GHOST}>
          Server
        </button>
        <button type="button" onClick={onOpenDocs} className={GHOST}>
          Docs
        </button>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative min-h-0 flex-1 overflow-y-auto bg-bg"
      >
        {visible.length === 0 ? (
          <div className="p-4">
            <EmptyState
              text={
                entries.length === 0
                  ? `Waiting for logs on ${channel || 'this channel'}…`
                  : 'No logs match the current filters.'
              }
            />
          </div>
        ) : (
          <div className="relative" style={{ height: range.total }}>
            {visible.slice(range.start, range.end).map((entry, index) => (
              <LogRow
                key={entry.seq}
                log={entry}
                top={offsets[range.start + index]}
                expanded={entry.seq === expandedSeq}
                onToggle={() => toggleRow(entry.seq)}
                onCopy={onCopy}
              />
            ))}
          </div>
        )}
      </div>

      {!autoScroll && visible.length > 0 ? (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-4 right-6 rounded-lg border border-accent/40 bg-panel2 px-2.5 py-1.5 text-[12px] text-text"
        >
          ↓ Jump to latest
        </button>
      ) : null}
    </div>
  );
}
