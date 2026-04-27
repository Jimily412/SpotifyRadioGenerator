const axios = require('axios');
const { store } = require('./store');

const BASE = 'https://ws.audioscrobbler.com/2.0/';

async function lfmGet(method, params) {
  const creds = store.get('credentials.lastfm');
  try {
    const res = await axios.get(BASE, {
      params: {
        method,
        api_key: creds.apiKey,
        format: 'json',
        ...params
      },
      timeout: 10000
    });
    return res.data;
  } catch (err) {
    throw new Error(`Last.fm ${method} failed: ${err.message}`);
  }
}

async function getRecentTracks(username, limit = 200) {
  const data = await lfmGet('user.getRecentTracks', { user: username, limit });
  const items = data?.recenttracks?.track;
  if (!items) return [];
  return (Array.isArray(items) ? items : [items]).filter(t => !t['@attr']?.nowplaying);
}

async function getTopTracks(username, period, limit = 100) {
  const data = await lfmGet('user.getTopTracks', { user: username, period, limit });
  const items = data?.toptracks?.track;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

function normalizeKey(artist, track) {
  return `${artist.toLowerCase().trim()}|${track.toLowerCase().trim()}`;
}

async function fetchLastfmData() {
  const creds = store.get('credentials.lastfm');
  if (!creds.username || !creds.apiKey) return null;

  const username = creds.username;
  const weightMap = {};

  function addWeight(artist, track, w) {
    const key = normalizeKey(artist, track);
    weightMap[key] = (weightMap[key] || 0) + w;
  }

  const [recent, top1m, top3m] = await Promise.all([
    getRecentTracks(username, 200),
    getTopTracks(username, '1month', 100),
    getTopTracks(username, '3month', 100)
  ]);

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const t of recent) {
    const ts = t.date ? new Date(t.date['#text']).getTime() : 0;
    if (ts >= thirtyDaysAgo) {
      addWeight(t.artist?.['#text'] || t.artist, t.name, 2);
    }
  }

  for (const t of top1m) {
    addWeight(t.artist?.name || t.artist, t.name, 6);
  }

  for (const t of top3m) {
    addWeight(t.artist?.name || t.artist, t.name, 4);
  }

  return {
    weightMap,
    counts: {
      recent: recent.length,
      top1m: top1m.length,
      top3m: top3m.length
    }
  };
}

module.exports = { fetchLastfmData, normalizeKey };
