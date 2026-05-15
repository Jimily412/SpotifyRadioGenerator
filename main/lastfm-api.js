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
  if (resp.data.error) {
    throw new Error(`Last.fm API error ${resp.data.error}: ${resp.data.message}`);
  }
  return resp.data;
}

async function fetchLastfmData(logFn) {
  const creds = getCredentials();
  if (!creds || !creds.apiKey || !creds.username) return { tracks: [], errors: ['Last.fm not configured'] };

  logFn && logFn(`Last.fm: checking account "${creds.username}"...`);

  const results = [];
  const errors = [];

  try {
    const data = await lfmGet('user.getRecentTracks', { limit: 200 });
    const tracks = data.recenttracks?.track || [];
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let recentCount = 0;
    for (const t of tracks) {
      if (t['@attr']?.nowplaying) continue;
      const ts = t.date?.uts ? parseInt(t.date.uts, 10) * 1000 : 0;
      if (ts >= thirtyDaysAgo) {
        results.push({ artistName: t.artist['#text'], trackName: t.name, weight: 1 });
        recentCount++;
      }
    }
    logFn && logFn(`Last.fm recent tracks (last 30 days): ${recentCount} of ${tracks.length} total fetched`);
  } catch (err) {
    errors.push(err.message);
    logFn && logFn(`Last.fm recent tracks failed: ${err.message}`);
  }

  const topMonthTracks = [];
  try {
    const data = await lfmGet('user.getTopTracks', { period: '1month', limit: 100 });
    const tracks = data.toptracks?.track || [];
    for (const t of tracks) {
      topMonthTracks.push({ artistName: t.artist.name, trackName: t.name, weight: 3 });
    }
    logFn && logFn(`Last.fm top tracks (1 month): ${topMonthTracks.length}`);
    if (topMonthTracks.length === 0) logFn('Last.fm: no top tracks for 1 month — account may be new or username may be incorrect');
  } catch (err) {
    errors.push(err.message);
    logFn && logFn(`Last.fm top tracks (1 month) failed: ${err.message}`);
  }

  const top3MonthTracks = [];
  try {
    const data = await lfmGet('user.getTopTracks', { period: '3month', limit: 100 });
    const tracks = data.toptracks?.track || [];
    for (const t of tracks) {
      top3MonthTracks.push({ artistName: t.artist.name, trackName: t.name, weight: 3 });
    }
    logFn && logFn(`Last.fm top tracks (3 month): ${top3MonthTracks.length}`);
  } catch (err) {
    errors.push(err.message);
    logFn && logFn(`Last.fm top tracks (3 month) failed: ${err.message}`);
  }

  const top12MonthTracks = [];
  try {
    const data = await lfmGet('user.getTopTracks', { period: '12month', limit: 100 });
    const tracks = data.toptracks?.track || [];
    for (const t of tracks) {
      top12MonthTracks.push({ artistName: t.artist.name, trackName: t.name, weight: 4 });
    }
    logFn && logFn(`Last.fm top tracks (12 month): ${top12MonthTracks.length}`);
  } catch (err) {
    errors.push(err.message);
    logFn && logFn(`Last.fm top tracks (12 month) failed: ${err.message}`);
  }

  const topAllTimeTracks = [];
  try {
    const data = await lfmGet('user.getTopTracks', { period: 'overall', limit: 200 });
    const tracks = data.toptracks?.track || [];
    for (const t of tracks) {
      topAllTimeTracks.push({ artistName: t.artist.name, trackName: t.name, weight: 3 });
    }
    logFn && logFn(`Last.fm top tracks (all time): ${topAllTimeTracks.length}`);
  } catch (err) {
    errors.push(err.message);
    logFn && logFn(`Last.fm top tracks (all time) failed: ${err.message}`);
  }

  return {
    tracks: [...results, ...topMonthTracks, ...top3MonthTracks, ...top12MonthTracks, ...topAllTimeTracks],
    errors,
  };
}

module.exports = { fetchLastfmData };
