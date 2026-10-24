/**
 * In-memory hub: one entry per channel holding that channel's viewers and its
 * most recent logs. Nothing here touches disk — restarting the process drops
 * every channel, which is the point of a log viewer that must not persist.
 *
 * `seq` is a process-wide monotonic counter. Viewers use it to ignore a log
 * they have already seen (the backlog overlaps a reconnect), so it must never
 * go backwards within one process; a restart resets it, which is why the
 * server also reports an `instance` id.
 */
export function createBroker({
  maxLogs = 5000,
  replay = 200,
  maxChannels = 200,
  maxSubscribersPerChannel = 100,
  maxBufferedBytes = 1 << 20,
  idleChannelMs = 10 * 60_000,
} = {}) {
  const channels = new Map();
  let seq = 0;

  /**
   * A channel is created on first write or first viewer, but only while under
   * `maxChannels`; past that an idle channel (no viewers, quiet for
   * `idleChannelMs`) is reclaimed instead, so an unauthenticated subscriber
   * cannot grow the map without limit.
   */
  function entryFor(name, create) {
    let entry = channels.get(name);
    if (entry || !create) return entry || null;
    if (channels.size >= maxChannels && !evictIdle()) return null;
    entry = { name, viewers: new Set(), logs: [], at: Date.now() };
    channels.set(name, entry);
    return entry;
  }

  function evictIdle() {
    const cutoff = Date.now() - idleChannelMs;
    for (const [name, entry] of channels) {
      if (entry.viewers.size === 0 && entry.at < cutoff) {
        channels.delete(name);
        return true;
      }
    }
    return false;
  }

  function publish(channel, log) {
    const entry = entryFor(channel, true);
    if (!entry) return null;

    const record = { ...log, channel, seq: ++seq, timestamp: Date.now() };
    entry.logs.push(record);
    if (entry.logs.length > maxLogs) entry.logs.splice(0, entry.logs.length - maxLogs);
    entry.at = record.timestamp;

    // One serialisation per log, not per viewer.
    const frame = JSON.stringify({ type: 'log', log: record });
    for (const socket of entry.viewers) {
      // A viewer that has stopped reading would otherwise queue frames in the
      // process until it is killed on memory.
      if (socket.bufferedAmount > maxBufferedBytes) {
        socket.terminate();
        continue;
      }
      socket.send(frame);
    }
    return record;
  }

  function subscribe(socket, channel) {
    const entry = entryFor(channel, true);
    if (!entry) return { ok: false, code: 'channel_limit' };
    if (entry.viewers.size >= maxSubscribersPerChannel) return { ok: false, code: 'channel_full' };
    entry.viewers.add(socket);
    return { ok: true };
  }

  function unsubscribe(socket, channel) {
    const entry = channels.get(channel);
    if (entry) entry.viewers.delete(socket);
  }

  function unsubscribeAll(socket) {
    for (const entry of channels.values()) entry.viewers.delete(socket);
  }

  function backlog(channel, limit = replay) {
    const entry = channels.get(channel);
    if (!entry) return [];
    return entry.logs.slice(-limit);
  }

  function snapshot() {
    const active = [];
    let subscribers = 0;
    for (const entry of channels.values()) {
      subscribers += entry.viewers.size;
      // Only channels that have actually carried a log are offered. An empty
      // channel has nothing to watch, and one that only ever had a viewer would
      // otherwise sit in the list for the whole idle window after that viewer
      // left — a row reading "1 viewer · 0 logs" that nothing can explain.
      if (entry.logs.length > 0 && Date.now() - entry.at < idleChannelMs) {
        active.push({
          name: entry.name,
          subscribers: entry.viewers.size,
          recent: entry.logs.length,
          lastAt: entry.at,
        });
      }
    }
    return { subscribers, active };
  }

  return {
    publish,
    subscribe,
    unsubscribe,
    unsubscribeAll,
    backlog,
    snapshot,
    channelCount: () => channels.size,
  };
}
