const axios = require('axios');
const { getStore } = require('./store');

const BASE = 'https://ws.audioscrobbler.com/2.0/';

function getCredentials() {
  return getStore().get('credentials.lastfm');
}

async function lfmGet(method, extra = {}) {
  const creds = getCredentials();
  const resp = await axios.get(BASE, {
    params: { method, user: creds.username, api_key: creds.apiKey, format: 'json', ...extra },
    timeout: 15000,
  });
  if (resp.data.error) throw new Error(`Last.fm ${resp.data.error}: ${resp.data.message}`);
  return resp.data;
}

const TOP_PERIODS = [
  { period: '1month',  weight: 3, label: '1 month' },
  { period: '3month',  weight: 3, label: '3 months' },
  { period: '12month', weight: 4, label: '12 months' },
  { period: 'overall', weight: 3, label: 'all time', limit: 200 },
];

async function fetchLastfmData(logFn) {
  const creds = getCredentials();
  if (!creds?.apiKey || !creds?.username) return { tracks: [], errors: ['Last.fm not configured'] };

  logFn?.(`Last.fm: checking account "${creds.username}"...`);

  const results = [];
  const errors = [];
  const THIRTY_DAYS_AGO = Date.now() - 30 * 24 * 60 * 60 * 1000;

  try {
    const data = await lfmGet('user.getRecentTracks', { limit: 200 });
    const recent = (data.recenttracks?.track || []).filter(t =>
      !t['@attr']?.nowplaying &&
      (t.date?.uts ? parseInt(t.date.uts, 10) * 1000 : 0) >= THIRTY_DAYS_AGO
    );
    results.push(...recent.map(t => ({ artistName: t.artist['#text'], trackName: t.name, weight: 1 })));
    logFn?.(`Last.fm recent (30 days): ${recent.length}`);
  } catch (err) {
    errors.push(err.message);
    logFn?.(`Last.fm recent tracks failed: ${err.message}`);
  }

  for (const { period, weight, label, limit = 100 } of TOP_PERIODS) {
    try {
      const data = await lfmGet('user.getTopTracks', { period, limit });
      const tracks = data.toptracks?.track || [];
      results.push(...tracks.map(t => ({ artistName: t.artist.name, trackName: t.name, weight })));
      logFn?.(`Last.fm top tracks (${label}): ${tracks.length}`);
    } catch (err) {
      errors.push(err.message);
      logFn?.(`Last.fm top tracks (${label}) failed: ${err.message}`);
    }
  }

  return { tracks: results, errors };
}

async function getSimilarArtists(artistName, limit = 8) {
  const creds = getCredentials();
  if (!creds?.apiKey) return [];
  try {
    const resp = await axios.get(BASE, {
      params: { method: 'artist.getSimilar', artist: artistName, api_key: creds.apiKey, format: 'json', limit, autocorrect: 1 },
      timeout: 10000,
    });
    return (resp.data?.similarartists?.artist || []).map(a => a.name);
  } catch {
    return [];
  }
}

module.exports = { fetchLastfmData, getSimilarArtists };
