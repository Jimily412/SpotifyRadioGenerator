let _store = null;

function initStore() {
  const Store = require('electron-store');
  _store = new Store({
    defaults: {
      credentials: {
        spotify: {
          clientId: '715f159d73c8495eb739c0e6ed082355',
          redirectUri: 'tasteengine://callback',
        },
        lastfm: {
          apiKey: '997e6d08e44b5ffcc53e962ee4100770',
        },
      },
      tokens: {},
      cache: {
        trackIds: {},
        audioFeatures: {},
        recommendations: {},
        topTracks: null,
        recentlyPlayed: null,
      },
      settings: {
        defaultPlaylistSize: 150,
        defaultPlaylistNameTemplate: 'TasteEngine Mix — {date}',
      },
      onboarding: { completed: false },
      playlists: [],
      lastPlaylist: null,
      stats: null,
      parsedData: null,
      fingerprint: null,
    },
  });

  // Migration: existing users who already have a valid token skip onboarding
  const tokens = _store.get('tokens');
  if (tokens && tokens.access_token && !_store.get('onboarding.completed')) {
    _store.set('onboarding.completed', true);
  }

  return _store;
}

function getStore() {
  if (!_store) throw new Error('Store not initialized');
  return _store;
}

// Cache helpers
const CACHE_TTL = {
  trackIds: Infinity,
  audioFeatures: 90 * 24 * 60 * 60 * 1000,
  recommendations: 24 * 60 * 60 * 1000,
  topTracks: 6 * 60 * 60 * 1000,
  recentlyPlayed: 60 * 60 * 1000,
};

function cacheGet(category, key) {
  const store = getStore();
  if (category === 'topTracks' || category === 'recentlyPlayed') {
    const entry = store.get(`cache.${category}`);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL[category]) return null;
    return entry.data;
  }
  const entry = store.get(`cache.${category}.${sanitizeKey(key)}`);
  if (!entry) return null;
  if (CACHE_TTL[category] !== Infinity && Date.now() - entry.ts > CACHE_TTL[category]) return null;
  return entry.data;
}

function cacheSet(category, key, data) {
  const store = getStore();
  if (category === 'topTracks' || category === 'recentlyPlayed') {
    store.set(`cache.${category}`, { ts: Date.now(), data });
    return;
  }
  store.set(`cache.${category}.${sanitizeKey(key)}`, { ts: Date.now(), data });
}

function cacheClear(category) {
  const store = getStore();
  if (category === 'all') {
    store.set('cache', { trackIds: {}, audioFeatures: {}, recommendations: {}, topTracks: null, recentlyPlayed: null });
  } else {
    store.set(`cache.${category}`, category === 'topTracks' || category === 'recentlyPlayed' ? null : {});
  }
}

function sanitizeKey(key) {
  return String(key).replace(/\./g, '_').replace(/[^a-zA-Z0-9_\-|]/g, '_').slice(0, 200);
}

module.exports = { initStore, getStore, cacheGet, cacheSet, cacheClear };
