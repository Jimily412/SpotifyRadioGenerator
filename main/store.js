const Store = require('electron-store');

const store = new Store({
  name: 'tasteengine',
  defaults: {
    credentials: {
      spotify: {
        clientId: '715f159d73c8495eb739c0e6ed082355',
        clientSecret: '78643b0ab4e64f3ca79ce0ab45a8310b',
        redirectUri: 'tasteengine://callback'
      },
      lastfm: {
        apiKey: '997e6d08e44b5ffcc53e962ee4100770',
        secret: 'fee1b69a05ecb6041c67b5a2c5828fc3',
        username: 'JimJeffords'
      }
    },
    settings: {
      defaultPlaylistSize: 150,
      defaultPlaylistNameTemplate: 'TasteEngine Mix — {date}'
    },
    cache: {
      trackIds: {},
      audioFeatures: {},
      recommendations: {}
    },
    auth: {
      accessToken: null,
      refreshToken: null,
      expiresAt: 0,
      displayName: null,
      userId: null,
      codeVerifier: null
    },
    lastPlaylist: null,
    lastfmLastSync: null
  }
});

const TTL = {
  audioFeatures: 90 * 24 * 60 * 60 * 1000,
  recommendations: 24 * 60 * 60 * 1000,
  topTracks: 6 * 60 * 60 * 1000,
  recentlyPlayed: 60 * 60 * 1000
};

function getTrackIdCached(key) {
  const cache = store.get('cache.trackIds', {});
  return cache[key] || null;
}

function setTrackIdCached(key, spotifyId) {
  const cache = store.get('cache.trackIds', {});
  cache[key] = spotifyId;
  store.set('cache.trackIds', cache);
}

function getFeatureCached(trackId) {
  const cache = store.get('cache.audioFeatures', {});
  const entry = cache[trackId];
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL.audioFeatures) return null;
  return entry.data;
}

function setFeatureCached(trackId, data) {
  const cache = store.get('cache.audioFeatures', {});
  cache[trackId] = { data, ts: Date.now() };
  store.set('cache.audioFeatures', cache);
}

function getRecommendationCached(key) {
  const cache = store.get('cache.recommendations', {});
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL.recommendations) return null;
  return entry.data;
}

function setRecommendationCached(key, data) {
  const cache = store.get('cache.recommendations', {});
  cache[key] = { data, ts: Date.now() };
  store.set('cache.recommendations', cache);
}

function clearCache(type) {
  if (type === 'trackIds') store.set('cache.trackIds', {});
  else if (type === 'audioFeatures') store.set('cache.audioFeatures', {});
  else if (type === 'recommendations') store.set('cache.recommendations', {});
  else if (type === 'all') {
    store.set('cache.trackIds', {});
    store.set('cache.audioFeatures', {});
    store.set('cache.recommendations', {});
  }
}

module.exports = {
  store,
  TTL,
  getTrackIdCached,
  setTrackIdCached,
  getFeatureCached,
  setFeatureCached,
  getRecommendationCached,
  setRecommendationCached,
  clearCache
};
