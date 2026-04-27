const SpotifyWebApi = require('spotify-web-api-node');
const { store, TTL, getTrackIdCached, setTrackIdCached, getFeatureCached, setFeatureCached, getRecommendationCached, setRecommendationCached } = require('./store');
const { getValidToken, refreshAccessToken } = require('./spotify-auth');

const CALL_DELAY = 150;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function createBudget() {
  return {
    search: { used: 0, max: 100 },
    audioFeatures: { used: 0, max: 10 },
    recommendations: { used: 0, max: 30 },
    playlistWrite: { used: 0, max: 5 },
    topTracks: { used: 0, max: 4 },
    recentlyPlayed: { used: 0, max: 1 },
    libraryRead: { used: 0, max: 3 }
  };
}

function hasBudget(budget, category) {
  const b = budget[category];
  return b ? b.used < b.max : true;
}

function spendBudget(budget, category) {
  if (budget[category]) budget[category].used++;
}

async function getApi() {
  const token = await getValidToken();
  if (!token) throw new Error('Not authenticated — please connect Spotify first');
  const api = new SpotifyWebApi();
  api.setAccessToken(token);
  return api;
}

async function callWithRetry(api, method, args, budget, category) {
  await sleep(CALL_DELAY);
  let attempt = 0;
  while (attempt <= 1) {
    try {
      spendBudget(budget, category);
      return await api[method](...args);
    } catch (err) {
      if (err.statusCode === 401) {
        try {
          const newToken = await refreshAccessToken();
          api.setAccessToken(newToken);
          attempt++;
          continue;
        } catch {
          throw err;
        }
      }
      if (err.statusCode === 429) {
        if (attempt === 0) {
          const wait = parseInt((err.headers && err.headers['retry-after']) || '5', 10);
          await sleep(wait * 1000);
          attempt++;
          continue;
        }
        if (budget[category]) budget[category].used = budget[category].max;
        return null;
      }
      if (err.statusCode >= 500) {
        if (attempt === 0) {
          await sleep(2000);
          attempt++;
          continue;
        }
        return null;
      }
      throw err;
    }
  }
  return null;
}

async function getTopTracks(timeRange, limit, budget) {
  const cacheKey = `topTracks_${timeRange}`;
  const cached = store.get(`cache.topTracksData.${timeRange}`);
  if (cached && Date.now() - cached.ts < TTL.topTracks) return cached.data;

  if (!hasBudget(budget, 'topTracks')) return [];
  const api = await getApi();
  const res = await callWithRetry(api, 'getMyTopTracks', [{ time_range: timeRange, limit }], budget, 'topTracks');
  if (!res) return [];

  const tracks = res.body.items;
  store.set(`cache.topTracksData.${timeRange}`, { data: tracks, ts: Date.now() });
  return tracks;
}

async function getRecentlyPlayed(limit, budget) {
  const cached = store.get('cache.recentlyPlayedData');
  if (cached && Date.now() - cached.ts < TTL.recentlyPlayed) return cached.data;

  if (!hasBudget(budget, 'recentlyPlayed')) return [];
  const api = await getApi();
  const res = await callWithRetry(api, 'getMyRecentlyPlayedTracks', [{ limit }], budget, 'recentlyPlayed');
  if (!res) return [];

  const items = res.body.items;
  store.set('cache.recentlyPlayedData', { data: items, ts: Date.now() });
  return items;
}

async function resolveTrackId(artistName, trackName, budget) {
  const cacheKey = `${artistName.toLowerCase()}|${trackName.toLowerCase()}`;
  const cached = getTrackIdCached(cacheKey);
  if (cached) return { id: cached, fromCache: true };

  if (!hasBudget(budget, 'search')) return null;
  const api = await getApi();
  const query = `track:"${trackName}" artist:"${artistName}"`;
  const res = await callWithRetry(api, 'searchTracks', [query, { limit: 1 }], budget, 'search');
  if (!res) return null;

  const items = res.body.tracks.items;
  if (!items || items.length === 0) return null;

  const id = items[0].id;
  setTrackIdCached(cacheKey, id);
  return { id, fromCache: false };
}

async function getAudioFeaturesBatch(trackIds, budget) {
  const uncached = [];
  const result = {};

  for (const id of trackIds) {
    const cached = getFeatureCached(id);
    if (cached) result[id] = cached;
    else uncached.push(id);
  }

  for (let i = 0; i < uncached.length; i += 100) {
    if (!hasBudget(budget, 'audioFeatures')) break;
    const batch = uncached.slice(i, i + 100);
    const api = await getApi();
    const res = await callWithRetry(api, 'getAudioFeaturesForTracks', [batch], budget, 'audioFeatures');
    if (!res) break;

    const features = res.body.audio_features;
    if (!features) break;
    for (const f of features) {
      if (f && f.id) {
        setFeatureCached(f.id, f);
        result[f.id] = f;
      }
    }
  }

  return result;
}

async function getRecommendations(seeds, targetFeatures, clusterStd, limit, budget) {
  if (!hasBudget(budget, 'recommendations')) return null;
  const sortedKey = [...seeds].sort().join('|');
  const cached = getRecommendationCached(sortedKey);
  if (cached) return { tracks: cached, fromCache: true };

  const api = await getApi();
  const params = { seed_tracks: seeds, limit };

  const featureNames = ['danceability', 'energy', 'valence', 'acousticness', 'instrumentalness', 'liveness', 'speechiness', 'tempo', 'loudness'];
  for (const feat of featureNames) {
    if (targetFeatures[feat] !== undefined) {
      params[`target_${feat}`] = targetFeatures[feat];
      if (clusterStd && clusterStd[feat] !== undefined) {
        const spread = 0.45 * clusterStd[feat];
        params[`min_${feat}`] = Math.max(0, targetFeatures[feat] - spread);
        params[`max_${feat}`] = Math.min(1, targetFeatures[feat] + spread);
      }
    }
  }

  const res = await callWithRetry(api, 'getRecommendations', [params], budget, 'recommendations');
  if (!res) return null;

  const tracks = res.body.tracks || [];
  setRecommendationCached(sortedKey, tracks);
  return { tracks, fromCache: false };
}

async function getUserProfile() {
  const api = await getApi();
  const res = await api.getMe();
  return res.body;
}

async function getLikedTrackIds(budget) {
  const ids = new Set();
  let offset = 0;
  while (hasBudget(budget, 'libraryRead')) {
    const api = await getApi();
    await sleep(CALL_DELAY);
    spendBudget(budget, 'libraryRead');
    let res;
    try {
      res = await api.getMySavedTracks({ limit: 50, offset });
    } catch {
      break;
    }
    const items = res.body.items;
    if (!items || items.length === 0) break;
    for (const item of items) ids.add(item.track.id);
    if (items.length < 50) break;
    offset += 50;
  }
  return ids;
}

async function createPlaylist(userId, name, budget) {
  if (!hasBudget(budget, 'playlistWrite')) throw new Error('Playlist write budget exhausted');
  const api = await getApi();
  await sleep(CALL_DELAY);
  spendBudget(budget, 'playlistWrite');
  const res = await api.createPlaylist(userId, {
    name,
    public: false,
    description: `Generated by TasteEngine on ${new Date().toLocaleDateString()}`
  });
  return res.body;
}

async function addTracksToPlaylist(playlistId, trackUris, budget) {
  for (let i = 0; i < trackUris.length; i += 100) {
    if (!hasBudget(budget, 'playlistWrite')) break;
    const batch = trackUris.slice(i, i + 100);
    const api = await getApi();
    await sleep(CALL_DELAY);
    spendBudget(budget, 'playlistWrite');
    try {
      await api.addTracksToPlaylist(playlistId, batch);
    } catch (err) {
      if (err.statusCode === 429) {
        const wait = parseInt((err.headers && err.headers['retry-after']) || '5', 10);
        await sleep(wait * 1000);
        try {
          const api2 = await getApi();
          await api2.addTracksToPlaylist(playlistId, batch);
        } catch {
          /* skip batch */
        }
      }
    }
  }
}

module.exports = {
  createBudget,
  hasBudget,
  spendBudget,
  getTopTracks,
  getRecentlyPlayed,
  resolveTrackId,
  getAudioFeaturesBatch,
  getRecommendations,
  getUserProfile,
  getLikedTrackIds,
  createPlaylist,
  addTracksToPlaylist
};
