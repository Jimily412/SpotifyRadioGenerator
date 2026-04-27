const axios = require('axios');
const { getStore } = require('./store');

const BASE = 'https://ws.audioscrobbler.com/2.0/';

function getCredentials() {
  return getStore().get('credentials.lastfm');
}

async function lfmGet(method, extra = {}) {
  const creds = getCredentials();
  const params = {
    method,
    user: creds.username,
    api_key: creds.apiKey,
    format: 'json',
    ...extra,
  };
  const resp = await axios.get(BASE, { params, timeout: 15000 });
  return resp.data;
}

async function fetchLastfmData(logFn) {
  const creds = getCredentials();
  if (!creds || !creds.apiKey || !creds.username) return { tracks: [], error: 'Last.fm not configured' };

  const results = [];
  const errors = [];

  try {
    const data = await lfmGet('user.getRecentTracks', { limit: 200 });
    const tracks = data.recenttracks?.track || [];
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const t of tracks) {
      if (t['@attr']?.nowplaying) continue;
      const ts = t.date?.uts ? parseInt(t.date.uts, 10) * 1000 : 0;
      if (ts >= thirtyDaysAgo) {
        results.push({ artistName: t.artist['#text'], trackName: t.name, weight: 2 });
      }
    }
    logFn && logFn(`Last.fm recent tracks: ${results.length} (last 30 days)`);
  } catch (err) {
    errors.push(`Recent tracks: ${err.message}`);
  }

  const topMonthTracks = [];
  try {
    const data = await lfmGet('user.getTopTracks', { period: '1month', limit: 100 });
    for (const t of (data.toptracks?.track || [])) {
      topMonthTracks.push({ artistName: t.artist.name, trackName: t.name, weight: 6 });
    }
    logFn && logFn(`Last.fm top tracks (1 month): ${topMonthTracks.length}`);
  } catch (err) {
    errors.push(`Top tracks 1month: ${err.message}`);
  }

  const top3MonthTracks = [];
  try {
    const data = await lfmGet('user.getTopTracks', { period: '3month', limit: 100 });
    for (const t of (data.toptracks?.track || [])) {
      top3MonthTracks.push({ artistName: t.artist.name, trackName: t.name, weight: 4 });
    }
    logFn && logFn(`Last.fm top tracks (3 month): ${top3MonthTracks.length}`);
  } catch (err) {
    errors.push(`Top tracks 3month: ${err.message}`);
  }

  return {
    tracks: [...results, ...topMonthTracks, ...top3MonthTracks],
    errors,
  };
}

module.exports = { fetchLastfmData };
