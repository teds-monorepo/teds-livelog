import { useCallback, useEffect, useState } from 'react';
import {
  channelKey,
  normalizeChannelList,
  normalizeServerUrl,
  normalizeWsUrl,
} from './livelog.js';

const KEY = 'livelog.store.v1';

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

export function useLiveLogStore() {
  const [ready, setReady] = useState(false);
  const [db, setDb] = useState({});

  useEffect(() => {
    setDb(load());
    setReady(true);
  }, []);

  const persist = useCallback((next) => {
    setDb(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
  }, []);

  const setLivelogChannel = useCallback(
    (name, url = '') => {
      persist({
        ...db,
        livelogChannel: typeof name === 'string' ? name : '',
        livelogChannelUrl: normalizeServerUrl(url),
      });
    },
    [db, persist]
  );

  const addLivelogChannel = useCallback(
    (name, endpoint = {}) => {
      const clean = typeof name === 'string' ? name.trim() : '';
      if (!clean) return;

      const url = normalizeServerUrl(endpoint.url);
      const wsUrl = normalizeWsUrl(endpoint.wsUrl);
      const have = normalizeChannelList(db.livelogChannels);
      const key = channelKey(clean, url);
      const list = have.some((entry) => channelKey(entry.name, entry.url) === key)
        ? have
        : [...have, { name: clean, url, wsUrl }];

      persist({ ...db, livelogChannels: list, livelogChannel: clean, livelogChannelUrl: url });
    },
    [db, persist]
  );

  const removeLivelogChannel = useCallback(
    (key) => {
      const have = normalizeChannelList(db.livelogChannels);
      const next = {
        ...db,
        livelogChannels: have.filter((entry) => channelKey(entry.name, entry.url) !== key),
      };
      if (channelKey(db.livelogChannel || '', db.livelogChannelUrl) === key) {
        next.livelogChannel = '';
        next.livelogChannelUrl = '';
      }
      persist(next);
    },
    [db, persist]
  );

  const setLivelogServer = useCallback(
    ({ url, wsUrl }) => {
      persist({ ...db, livelogUrl: url || '', livelogWsUrl: wsUrl || '' });
    },
    [db, persist]
  );

  return {
    ready,
    livelogChannel: db.livelogChannel || '',
    livelogChannelUrl: db.livelogChannelUrl || '',
    livelogChannels: normalizeChannelList(db.livelogChannels),
    livelogUrl: db.livelogUrl || '',
    livelogWsUrl: db.livelogWsUrl || '',
    setLivelogChannel,
    addLivelogChannel,
    removeLivelogChannel,
    setLivelogServer,
  };
}
