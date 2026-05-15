const SpotifyWebApi = require('spotify-web-api-node');
const { getStore, cacheGet, cacheSet } = require('./store');
const { getValidAccessTokenOrRefresh } = require('./spotify-auth');

const DELAY_MS = 150;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createClient(accessToken) {
  const store = getStore();
  const creds = store.get('credentials.spotify');
  const client = new SpotifyWebApi({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    redirectUri: creds.redirectUri,
  });
  client.setAccessToken(accessToken);
  return client;
}

class SessionBudget {
  constructor() {
    this.limits = {
      search: 100,
      audioFeatures: 10,
      recommendations: 30,
      playlistWrite: 5,
      topTracks: 6,
      recentlyPlayed: 1,
      libraryRead: 3,
    };
    this.used = {
      search: 0, audioFeatures: 0, recommendations: 0,
      playlistWrite: 0, topTracks: 0, recentlyPlayed: 0, libraryRead: 0,
    };
  }

  canCall(category) {
    return this.used[category] < this.limits[category];
  }

  spend(category) {
    this.used[category]++;
  }

  remaining(category) {
    return this.limits[category] - this.used[category];
  }

  summary() {
    return Object.keys(this.limits).map(k =>
      `${k}: ${this.used[k]}/${this.limits[k]}`
    ).join(', ');
  }
}

async function apiCallWithRetry(fn) {
  await sleep(DELAY_MS);
  try {
    return await fn();
  } catch (err) {
    const status = err.statusCode || (err.response && err.response.status);
    if (status === 429) {
      const retryAfter = (err.response && err.response.headers && err.response.headers['retry-after'])
        ? parseInt(err.response.headers['retry-after'], 10) * 1000
        : 5000;
      await sleep(retryAfter);
      try {
        return await fn();
      } catch (err2) {
        throw Object.assign(err2, { budgetExhausted: true });
      }
    }
    if (status >= 500) {
      await sleep(2000);
      return await fn();
    }
    throw err;
  }
}

async function getTopTracks(budget, logFn) {
  const cacheKey1 = 'short_term';
  const cacheKey2 = 'medium_term';
  const cached = cacheGet('topTracks', 'all');
  if (cached) {
    logFn && logFn(`Top tracks loaded from cache`);
    return cached;
  }

  const accessToken = await getValidAccessTokenOrRefresh();
  if (!accessToken) return [];
  const client = createClient(accessToken);

  const results = [];

  for (const [range, weight] of [['short_term', 4], ['medium_term', 4], ['long_term', 4]]) {
    if (!budget.canCall('topTracks')) break;
    try {
      const data = await apiCallWithRetry(() => client.getMyTopTracks({ time_range: range, limit: 50 }));
      budget.spend('topTracks');
      for (const track of (data.body.items || [])) {
        results.push({ artistName: track.artists[0]?.name, trackName: track.name, spotifyId: track.id, weight });
      }
    } catch (err) {
      if (err.budgetExhausted) budget.used.topTracks = budget.limits.topTracks;
      logFn && logFn(`Top tracks (${range}) fetch failed: ${err.message}`);
    }
  }

  cacheSet('topTracks', 'all', results);
  return results;
}

async function getRecentlyPlayed(budget, logFn) {
  const cached = cacheGet('recentlyPlayed', 'all');
  if (cached) {
    logFn && logFn(`Recently played loaded from cache`);
    return cached;
  }

  const accessToken = await getValidAccessTokenOrRefresh();
  if (!accessToken) return [];
  const client = createClient(accessToken);

  if (!budget.canCall('recentlyPlayed')) return [];
  try {
    const data = await apiCallWithRetry(() => client.getMyRecentlyPlayedTracks({ limit: 50 }));
    budget.spend('recentlyPlayed');
    const results = (data.body.items || []).map(item => ({
      artistName: item.track.artists[0]?.name,
      trackName: item.track.name,
      spotifyId: item.track.id,
      weight: 3,
    }));
    cacheSet('recentlyPlayed', 'all', results);
    return results;
  } catch (err) {
    logFn && logFn(`Recently played fetch failed: ${err.message}`);
    return [];
  }
}

async function getLikedTracks(budget, logFn) {
  const accessToken = await getValidAccessTokenOrRefresh();
  if (!accessToken) return [];
  const client = createClient(accessToken);
  const results = [];
  let offset = 0;

  while (budget.canCall('libraryRead')) {
    try {
      const data = await apiCallWithRetry(() => client.getMySavedTracks({ limit: 50, offset }));
      budget.spend('libraryRead');
      const items = data.body.items || [];
      for (const item of items) {
        results.push({
          artistName: item.track.artists[0]?.name,
          trackName: item.track.name,
          spotifyId: item.track.id,
        });
      }
      if (items.length < 50) break;
      offset += 50;
    } catch (err) {
      logFn && logFn(`Library fetch failed at offset ${offset}: ${err.message}`);
      break;
    }
  }
  return results;
}

async function resolveTrackIds(tracks, budget, logFn) {
  const accessToken = await getValidAccessTokenOrRefresh();
  if (!accessToken) return {};
  const client = createClient(accessToken);

  const idMap = {};
  let cacheHits = 0;
  let liveCalls = 0;

  for (const track of tracks) {
    const key = `${track.artistName}|${track.trackName}`;
    const cached = cacheGet('trackIds', key);
    if (cached) {
      idMap[key] = cached;
      cacheHits++;
      continue;
    }

    if (!budget.canCall('search')) continue;

    const q = `track:"${track.trackName.replace(/"/g, '')}" artist:"${track.artistName.replace(/"/g, '')}"`;
    try {
      const data = await apiCallWithRetry(() => client.searchTracks(q, { limit: 1 }));
      budget.spend('search');
      liveCalls++;
      const item = data.body.tracks?.items?.[0];
      if (item) {
        idMap[key] = item.id;
        cacheSet('trackIds', key, item.id);
      }
    } catch (err) {
      if (err.budgetExhausted) { budget.used.search = budget.limits.search; break; }
    }
  }

  logFn && logFn(`Resolved track IDs — cache: ${cacheHits}, live: ${liveCalls}, total: ${Object.keys(idMap).length}`);
  return idMap;
}

async function getAudioFeatures(trackIds, budget, logFn) {
  const accessToken = await getValidAccessTokenOrRefresh();
  if (!accessToken) return {};

  const featureMap = {};
  const uncached = [];
  let cacheHits = 0;

  for (const id of trackIds) {
    const cached = cacheGet('audioFeatures', id);
    if (cached) {
      featureMap[id] = cached;
      cacheHits++;
    } else {
      uncached.push(id);
    }
  }

  const batches = [];
  for (let i = 0; i < uncached.length; i += 100) {
    batches.push(uncached.slice(i, i + 100));
  }

  let liveCalls = 0;
  for (const batch of batches) {
    if (!budget.canCall('audioFeatures')) break;
    await sleep(DELAY_MS);
    try {
      const axios = require('axios');
      const resp = await axios.get('https://api.spotify.com/v1/audio-features', {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { ids: batch.join(',') },
        timeout: 15000,
      });
      budget.spend('audioFeatures');
      liveCalls++;
      for (const f of (resp.data.audio_features || [])) {
        if (!f) continue;
        const normalized = normalizeFeatures(f);
        featureMap[f.id] = normalized;
        cacheSet('audioFeatures', f.id, normalized);
      }
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.error?.message || err.message;
      logFn && logFn(`Audio features failed [HTTP ${status || 'network'}]: ${msg}`);
      if (status === 403) {
        logFn && logFn('Audio features endpoint is not available for this Spotify app — using weight-based clustering instead.');
        break;
      }
      if (status === 429) {
        const wait = parseInt(err.response?.headers?.['retry-after'] || '5', 10) * 1000;
        await sleep(wait);
      }
    }
  }

  logFn && logFn(`Audio features — cache: ${cacheHits}, live batches: ${liveCalls}, total: ${Object.keys(featureMap).length}`);
  return featureMap;
}

function normalizeFeatures(f) {
  return {
    danceability: f.danceability,
    energy: f.energy,
    loudness: Math.max(0, Math.min(1, (f.loudness + 60) / 60)),
    speechiness: f.speechiness,
    acousticness: f.acousticness,
    instrumentalness: f.instrumentalness,
    liveness: f.liveness,
    valence: f.valence,
    tempo: Math.min(1, f.tempo / 200),
  };
}

async function getTracksByArtistNames(artistNames, tracksPerArtist, budget, logFn) {
  if (artistNames.length === 0) return [];
  const accessToken = await getValidAccessTokenOrRefresh();
  if (!accessToken) return [];
  const client = createClient(accessToken);

  const results = [];
  const seenIds = new Set();

  for (const name of artistNames) {
    if (!budget.canCall('search')) break;
    const q = `artist:"${name.replace(/"/g, '')}"`;
    try {
      const data = await apiCallWithRetry(() => client.searchTracks(q, { limit: tracksPerArtist }));
      budget.spend('search');
      for (const t of (data.body.tracks?.items || [])) {
        if (!seenIds.has(t.id)) {
          seenIds.add(t.id);
          results.push({ id: t.id, name: t.name, artists: t.artists.map(a => a.name), features: null });
        }
      }
    } catch (err) {
      logFn && logFn(`Artist search failed for "${name}": ${err.message}`);
    }
  }
  return results;
}

async function createPlaylist(name, trackIds, budget, logFn) {
  const accessToken = await getValidAccessTokenOrRefresh();
  if (!accessToken) throw new Error('No access token');
  const client = createClient(accessToken);

  const meData = await apiCallWithRetry(() => client.getMe());
  const userId = meData.body.id;

  const playlist = await apiCallWithRetry(() =>
    client.createPlaylist(name, { public: false, description: 'Generated by TasteEngine' })
  );
  const playlistId = playlist.body.id;

  const uris = trackIds.map(id => `spotify:track:${id}`);
  const batches = [];
  for (let i = 0; i < uris.length; i += 100) batches.push(uris.slice(i, i + 100));

  for (const batch of batches) {
    if (!budget.canCall('playlistWrite')) break;
    await apiCallWithRetry(() => client.addTracksToPlaylist(playlistId, batch));
    budget.spend('playlistWrite');
    logFn && logFn(`Added ${batch.length} tracks to playlist...`);
  }

  return { id: playlistId, url: playlist.body.external_urls?.spotify, uri: playlist.body.uri };
}

module.exports = {
  SessionBudget,
  getTopTracks,
  getRecentlyPlayed,
  getLikedTracks,
  resolveTrackIds,
  getAudioFeatures,
  getTracksByArtistNames,
  createPlaylist,
};
