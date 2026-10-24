
import { useCallback, useEffect, useRef, useState } from 'react';
import { acceptBatch, appendCapped, parseServerMessage, prepareLog } from '../lib/livelog.js';

const MAX_LOGS = 5000;
const FLUSH_BATCH = 400;
const MAX_PENDING = 5000;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 15000;
const PING_MS = 25000;
const SILENCE_MS = 70000;

function sendTo(socket, payload) {
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // A socket that died between the check and the send is the reconnect
    // handler's problem, not this call's.
  }
}

/**
 * Keeps one WebSocket subscription alive for `channel` and accumulates what it
 * delivers.
 *
 * Three things here are less obvious than they look:
 *
 *  - Arrivals are not written to state one by one. A burst would then cause a
 *    render per log; instead they queue in a ref and are appended in bounded
 *    batches on an animation frame. rAF is paused in a background tab, so the
 *    queue is capped and is also drained whenever the tab's visibility changes.
 *  - Every log is deduped by the server's `seq`. React StrictMode mounts effects
 *    twice in development and a reconnect replays a backlog that overlaps what is
 *    already on screen; both would otherwise show every row twice.
 *  - Pausing does not stop reading the socket. Logs keep arriving into a separate
 *    buffer and are merged in on resume, which is what lets the toolbar report
 *    how many are waiting.
 */
export function useLiveLog({ url, channel, maxLogs = MAX_LOGS }) {
  const [status, setStatus] = useState(url && channel ? 'connecting' : 'idle');
  const [entries, setEntries] = useState([]);
  const [paused, setPausedState] = useState(false);
  const [pausedCount, setPausedCount] = useState(0);
  const [instance, setInstance] = useState('');

  const socketRef = useRef(null);
  const connectRef = useRef(null);
  const reconnectRef = useRef(null);
  const frameRef = useRef(0);
  const timerRef = useRef(0);
  const pendingRef = useRef([]);
  const pausedStoreRef = useRef([]);
  const pausedRef = useRef(false);
  const maxLogsRef = useRef(maxLogs);
  const channelRef = useRef(channel);
  const instanceRef = useRef('');
  const watermarkRef = useRef({ instance: '', seq: 0 });
  const attemptRef = useRef(0);
  const closedRef = useRef(false);
  const lastSeenRef = useRef(0);

  maxLogsRef.current = maxLogs;

  const flushPending = useCallback(() => {
    // Whichever trigger got here first cancels the other.
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    if (timerRef.current) clearTimeout(timerRef.current);
    frameRef.current = 0;
    timerRef.current = 0;

    const queue = pendingRef.current;
    if (queue.length === 0) return;

    const batch = queue.splice(0, Math.min(queue.length, FLUSH_BATCH));
    setEntries((current) => appendCapped(current, batch, maxLogsRef.current));
    if (queue.length) timerRef.current = setTimeout(flushPending, 0);
  }, []);

  /**
   * Two triggers on purpose. The animation frame is what keeps a burst to one
   * render per frame — but it does not fire at all when no frames are being
   * produced (a backgrounded tab, an occluded window, a pane that isn't
   * compositing), and the view would then sit frozen while the socket kept
   * receiving. The timer is the safety net that still drains the queue there.
   */
  const scheduleFlush = useCallback(() => {
    if (frameRef.current || timerRef.current) return;
    frameRef.current = requestAnimationFrame(flushPending);
    timerRef.current = setTimeout(flushPending, 250);
  }, [flushPending]);

  const hold = useCallback(
    (batch) => {
      if (batch.length === 0) return;
      pendingRef.current.push(...batch);
      if (pendingRef.current.length > MAX_PENDING) {
        pendingRef.current.splice(0, pendingRef.current.length - MAX_PENDING);
      }
      scheduleFlush();
    },
    [scheduleFlush]
  );

  const ingest = useCallback(
    (records, fromInstance) => {
      const current = channelRef.current;
      // Switching channel on an open socket leaves frames for the previous
      // channel in flight.
      const relevant = records.filter(
        (record) => record && (!current || record.channel === current)
      );
      if (relevant.length === 0) return;

      const result = acceptBatch(watermarkRef.current, fromInstance, relevant);
      watermarkRef.current = result.watermark;
      if (result.accepted.length === 0) return;

      const prepared = result.accepted.map(prepareLog);
      if (pausedRef.current) {
        pausedStoreRef.current = appendCapped(pausedStoreRef.current, prepared, maxLogsRef.current);
        setPausedCount(pausedStoreRef.current.length);
        return;
      }
      hold(prepared);
    },
    [hold]
  );

  const scheduleReconnect = useCallback(() => {
    if (closedRef.current) return;
    clearTimeout(reconnectRef.current);
    const attempt = Math.min(attemptRef.current++, 5);
    const delay =
      Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS) + Math.random() * 250;
    reconnectRef.current = setTimeout(() => {
      if (!closedRef.current) connectRef.current?.();
    }, delay);
  }, []);

  const connect = useCallback(() => {
    if (!url || !channelRef.current) return;

    clearTimeout(reconnectRef.current);
    try {
      socketRef.current?.close();
    } catch {}

    setStatus('connecting');

    let socket;
    try {
      socket = new WebSocket(url);
    } catch {
      setStatus('disconnected');
      scheduleReconnect();
      return;
    }
    socketRef.current = socket;

    socket.onopen = () => {
      if (socketRef.current !== socket) return;
      attemptRef.current = 0;
      lastSeenRef.current = Date.now();
      setStatus('connected');
      sendTo(socket, { type: 'subscribe', channel: channelRef.current });
      // Anything queued before the swap is still owed to the screen.
      scheduleFlush();
    };

    socket.onmessage = (event) => {
      // Frames from a socket we already replaced are ignored: its subscription
      // no longer reflects the channel on screen.
      if (socketRef.current !== socket) return;
      lastSeenRef.current = Date.now();
      const message = parseServerMessage(event.data);
      if (!message) return;

      if (message.type === 'ready') {
        if (message.instance && message.instance !== instanceRef.current) {
          const restarted = Boolean(instanceRef.current);
          instanceRef.current = message.instance;
          setInstance(message.instance);
          if (restarted) {
            // A different process is serving this channel now, so its `seq`
            // numbering has nothing to do with what is on screen: keeping the
            // old rows would collide with the new ones and hide real logs.
            watermarkRef.current = { instance: message.instance, seq: 0 };
            pendingRef.current = [];
            pausedStoreRef.current = [];
            setPausedCount(0);
            setEntries([]);
          }
        }
        return;
      }
      if (message.type === 'backlog') {
        ingest(
          Array.isArray(message.logs) ? message.logs : [],
          message.instance || instanceRef.current
        );
        return;
      }
      if (message.type === 'log') {
        ingest([message.log], instanceRef.current);
      }
    };

    socket.onclose = () => {
      // Only the socket that is still current may move the status. A socket we
      // deliberately replaced — or one React StrictMode's double-mount left
      // behind — closes later, and without this guard it would report
      // Disconnected over a healthy connection and schedule a reconnect that
      // replaces that connection in turn, churning sockets forever.
      if (socketRef.current !== socket) return;
      socketRef.current = null;
      if (closedRef.current) return;
      setStatus('disconnected');
      scheduleReconnect();
    };

    socket.onerror = () => {
      // onclose always follows, and that is where the reconnect gets scheduled.
      try {
        socket.close();
      } catch {}
    };
  }, [url, ingest, scheduleReconnect]);

  connectRef.current = connect;

  // One socket for the lifetime of the page; the effect (not `channel`) owns it
  // so switching channel re-subscribes instead of reconnecting.
  useEffect(() => {
    closedRef.current = false;
    channelRef.current = channel;
    connect();
    return () => {
      closedRef.current = true;
      clearTimeout(reconnectRef.current);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      if (timerRef.current) clearTimeout(timerRef.current);
      frameRef.current = 0;
      timerRef.current = 0;
      // Note what is *not* cleared here: the queued arrivals. They have already
      // been accepted past the dedupe watermark, so a replay of the backlog will
      // skip them — dropping them here would lose them for good. The socket swap
      // drains the queue instead (see onopen), and unmounting makes it moot.
      try {
        socketRef.current?.close();
      } catch {}
      socketRef.current = null;
    };
  }, [connect]);

  // Switching channel: drop what is on screen (it belongs to the old channel)
  // and move the subscription over. When there is no live socket yet — the
  // first connect ran before the channel/address was known (e.g. restored from
  // localStorage after mount) — dial instead of subscribing.
  useEffect(() => {
    if (channelRef.current === channel) return;
    channelRef.current = channel;
    pendingRef.current = [];
    pausedStoreRef.current = [];
    setPausedCount(0);
    setEntries([]);

    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      sendTo(socket, { type: 'subscribe', channel });
    } else {
      connect();
    }
  }, [channel, connect]);

  // Drains the queue whenever visibility changes, in either direction.
  useEffect(() => {
    const onVisibility = () => flushPending();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [flushPending]);

  /**
   * Keepalive plus a liveness check. The server answers every ping, so a socket
   * that stays open but silent has been dropped somewhere in between and is
   * closed here to hand it to the reconnect path.
   */
  useEffect(() => {
    const id = setInterval(() => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastSeenRef.current > SILENCE_MS) {
        try {
          socket.close();
        } catch {}
        return;
      }
      sendTo(socket, { type: 'ping' });
    }, PING_MS);
    return () => clearInterval(id);
  }, []);

  const setPaused = useCallback(
    (next) => {
      pausedRef.current = next;
      setPausedState(next);
      if (next) return;

      const held = pausedStoreRef.current;
      pausedStoreRef.current = [];
      setPausedCount(0);
      hold(held);
    },
    [hold]
  );

  const clear = useCallback(() => {
    pendingRef.current = [];
    pausedStoreRef.current = [];
    setPausedCount(0);
    setEntries([]);
  }, []);

  return {
    status,
    entries,
    paused,
    pausedCount,
    instance,
    setPaused,
    clear,
    reconnect: connect,
  };
}

/**
 * Channels with recent traffic, refreshed on a timer while the tab is visible.
 * This is only a convenience for the channel list — a channel with nothing in it
 * yet is still selectable, it just shows as empty.
 */
export function useActiveChannels(url, intervalMs = 20000) {
  const [channels, setChannels] = useState([]);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`${String(url).replace(/\/+$/, '')}/api/channels`, {
          cache: 'no-store',
        });
        if (!response.ok) return;
        const payload = await response.json();
        if (!cancelled) setChannels(Array.isArray(payload?.channels) ? payload.channels : []);
      } catch {
        // Offline or the server is down — the socket's status dot already says so.
      }
    };

    load();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [url, intervalMs]);

  return channels;
}
