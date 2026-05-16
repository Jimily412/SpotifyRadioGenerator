const { ipcMain, dialog, shell, app } = require('electron');
const { getStore, cacheClear } = require('./store');
const { startOAuth, clearTokens, getValidAccessTokenOrRefresh } = require('./spotify-auth');
const { parseExport } = require('./data-parser');
const { fetchLastfmData } = require('./lastfm-api');
const {
  SessionBudget, getTopTracks, getRecentlyPlayed, getLikedTracks,
  resolveTrackIds, getAudioFeatures, getArtistGenres, createPlaylist,
} = require('./spotify-api');
const { mergeWeights, computeFingerprint, clusterTracks, clusterByGenre, clusterByWeight, computeQuotas } = require('./fingerprint');
const { harvestRecommendations, buildFinalPlaylist } = require('./recommender');

let mainWindow_ = null;
let lastFingerprintData = null;
let lastBuiltPlaylist = null;

function log(mainWindow, msg) {
  const ts = new Date().toLocaleTimeString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  mainWindow && mainWindow.webContents.send('progress-log', line);
}

function registerIpcHandlers(mainWindow) {
  mainWindow_ = mainWindow;

  ipcMain.handle('spotify-connect', async () => {
    startOAuth(mainWindow);
    return { ok: true };
  });

  ipcMain.handle('spotify-status', async () => {
    const store = getStore();
    const tokens = store.get('tokens');
    if (!tokens || !tokens.access_token) return { connected: false };
    try {
      const token = await getValidAccessTokenOrRefresh();
      if (!token) return { connected: false };
      const axios = require('axios');
      const resp = await axios.get('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { connected: true, displayName: resp.data.display_name };
    } catch {
      return { connected: false };
    }
  });

  ipcMain.handle('spotify-reauthorize', async () => {
    clearTokens();
    startOAuth(mainWindow);
    return { ok: true };
  });

  ipcMain.handle('pick-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select your Spotify export folder',
    });
    if (result.canceled) return { canceled: true };
    return { path: result.filePaths[0] };
  });

  ipcMain.handle('pick-zip', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Spotify Export ZIP', extensions: ['zip'] }],
      title: 'Select your Spotify export .zip file',
    });
    if (result.canceled) return { canceled: true };
    return { path: result.filePaths[0] };
  });

  ipcMain.handle('parse-export', async (_, folderPath) => {
    try {
      const result = parseExport(folderPath);
      if (!result.error) {
        getStore().set('parsedData', result);
      }
      return result;
    } catch (err) {
      return { error: err.message, tracks: [] };
    }
  });

  ipcMain.handle('analyze-fingerprint', async () => {
    const logFn = (msg) => log(mainWindow, msg);
    const budget = new SessionBudget();

    try {
      const store = getStore();
      const parsedData = store.get('parsedData');
      const parsedTracks = parsedData ? parsedData.tracks || [] : [];

      logFn('Fetching your top tracks from Spotify...');
      const topTracks = await getTopTracks(budget, logFn);

      logFn('Fetching recently played from Spotify...');
      const recentTracks = await getRecentlyPlayed(budget, logFn);

      logFn('Fetching Last.fm data...');
      let lastfmResult = { tracks: [], errors: [] };
      try {
        lastfmResult = await fetchLastfmData(logFn);
        if (lastfmResult.errors.length > 0) logFn(`Last.fm notice: ${lastfmResult.errors.join(', ')}`);
      } catch (err) {
        logFn(`Last.fm unavailable: ${err.message}`);
      }

      const liveTracks = [...topTracks, ...recentTracks, ...lastfmResult.tracks];
      const merged = mergeWeights(parsedTracks, liveTracks);
      const top300 = merged.slice(0, 300);

      logFn(`Resolving track IDs (${top300.length} tracks)...`);
      const { trackIds, artistIds } = await resolveTrackIds(top300, budget, logFn);

      // Augment tracks with spotifyId
      for (const t of top300) {
        const key = `${t.artistName.trim()}|${t.trackName.trim()}`;
        if (trackIds[key]) t.spotifyId = trackIds[key];
      }

      const resolvedIds = Object.values(trackIds);
      logFn(`Fetching audio features (${resolvedIds.length} tracks)...`);
      const featureMap = await getAudioFeatures(resolvedIds, budget, logFn);

      const tracksWithFeatures = top300.filter(t => t.spotifyId && featureMap[t.spotifyId])
        .map(t => ({ ...t, features: featureMap[t.spotifyId] }));

      const resolvedTracks = top300.filter(t => t.spotifyId);
      const audioFeaturesAvailable = tracksWithFeatures.length > 0;

      let fingerprint, clusters;
      if (audioFeaturesAvailable) {
        logFn(`Running audio-feature clustering on ${tracksWithFeatures.length} tracks...`);
        fingerprint = computeFingerprint(tracksWithFeatures);
        clusters = clusterTracks(tracksWithFeatures);
      } else {
        logFn(`Fetching artist genres for mood clustering...`);
        const genreMap = await getArtistGenres(artistIds, budget, logFn);
        const hasGenres = Object.values(genreMap).some(g => g.length > 0);
        if (hasGenres) {
          logFn(`Running genre-based clustering on ${resolvedTracks.length} tracks...`);
          clusters = clusterByGenre(resolvedTracks, genreMap);
        } else {
          logFn(`No genre data — falling back to weight clustering...`);
          clusters = clusterByWeight(resolvedTracks);
        }
        fingerprint = null;
      }

      lastFingerprintData = { fingerprint, clusters, tracksWithFeatures: audioFeaturesAvailable ? tracksWithFeatures : resolvedTracks, merged };
      store.set('fingerprint', { fingerprint, clusters: clusters.map(c => ({ ...c, tracks: undefined, topTracks: c.topTracks })) });

      logFn('Analysis complete!');
      return {
        ok: true,
        audioFeaturesAvailable,
        fingerprint,
        clusters: clusters.map(c => ({
          id: c.id,
          label: c.label,
          trackCount: c.tracks.length,
          weightPct: c.weightPct,
          topTracks: c.topTracks.map(t => ({ artistName: t.artistName, trackName: t.trackName, weight: t.weight })),
          centroid: c.centroid,
          std: c.std,
        })),
        liveDataSummary: {
          spotifyTopTracks: topTracks.length,
          spotifyRecent: recentTracks.length,
          lastfmTracks: lastfmResult.tracks.length,
        },
        budgetUsed: budget.summary(),
      };
    } catch (err) {
      logFn(`Analysis error: ${err.message}`);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('build-playlist', async (_, opts) => {
    const logFn = (msg) => log(mainWindow, msg);
    const budget = new SessionBudget();

    try {
      if (!lastFingerprintData) {
        return { ok: false, error: 'Please run Analyze first' };
      }

      const { clusters, tracksWithFeatures } = lastFingerprintData;
      const targetSize = opts.targetSize || 150;
      const includeFamiliar = opts.includeFamiliar || false;
      const moodBias = opts.moodBias || {};

      let quotas = computeQuotas(clusters, targetSize);
      if (Object.keys(moodBias).length > 0) {
        let totalBias = 0;
        for (const q of quotas) totalBias += (moodBias[q.id] ?? 1);
        quotas = quotas.map(q => ({
          id: q.id,
          quota: Math.max(8, Math.round(targetSize * (moodBias[q.id] ?? 1) / totalBias)),
        }));
      }

      logFn(`Target playlist size: ${targetSize} tracks, ${clusters.length} clusters`);

      logFn('Building exclusion sets...');
      let likedIds = new Set();
      let highPlayIds = new Set();
      if (!includeFamiliar) {
        const liked = await getLikedTracks(budget, logFn);
        for (const t of liked) if (t.spotifyId) likedIds.add(t.spotifyId);
        for (const t of (tracksWithFeatures || [])) {
          if (t.plays > 15 && t.spotifyId) highPlayIds.add(t.spotifyId);
        }
      }

      const idLookup = Object.fromEntries(
        tracksWithFeatures.map(t => [`${t.artistName.toLowerCase().trim()}|${t.trackName.toLowerCase().trim()}`, t])
      );
      for (const cluster of clusters) {
        for (const t of cluster.tracks) {
          if (!t.spotifyId) {
            const k = `${t.artistName.toLowerCase().trim()}|${t.trackName.toLowerCase().trim()}`;
            if (idLookup[k]) t.spotifyId = idLookup[k].spotifyId;
          }
        }
      }

      const harvestResults = await harvestRecommendations(clusters, quotas, likedIds, highPlayIds, budget, logFn);

      logFn('Filtering and scoring candidates...');
      const { tracks, clusterBreakdown, newArtists } = buildFinalPlaylist(harvestResults, targetSize);

      lastBuiltPlaylist = { tracks, clusterBreakdown, newArtists };

      logFn(`Built ${tracks.length} tracks — review and add to Spotify when ready.`);
      return {
        ok: true,
        tracks: tracks.map(t => ({
          id: t.id,
          name: t.name,
          artist: Array.isArray(t.artists) ? t.artists[0] || '' : '',
          clusterIdx: t.clusterIdx ?? 0,
        })),
        clusterBreakdown,
        newArtists,
      };
    } catch (err) {
      logFn(`Build error: ${err.message}`);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('push-playlist', async (_, { playlistName, trackIds }) => {
    const logFn = (msg) => log(mainWindow, msg);
    const budget = new SessionBudget();
    try {
      const name = playlistName || `TasteEngine Mix — ${new Date().toLocaleDateString()}`;
      logFn(`Creating "${name}" in Spotify (${trackIds.length} tracks)...`);
      const playlistInfo = await createPlaylist(name, trackIds, budget, logFn);

      const entry = {
        playlistName: name,
        trackCount: trackIds.length,
        playlistUrl: playlistInfo.url,
        playlistUri: playlistInfo.uri,
        date: new Date().toISOString(),
      };

      const store = getStore();
      const history = store.get('playlists') || [];
      history.unshift(entry);
      if (history.length > 50) history.length = 50;
      store.set('playlists', history);
      store.set('lastPlaylist', entry);

      logFn(`Done! "${name}" added to Spotify.`);
      return { ok: true, ...entry };
    } catch (err) {
      logFn(`Push error: ${err.message}`);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('get-playlists', async () => {
    return getStore().get('playlists') || [];
  });

  ipcMain.handle('get-settings', async () => {
    const store = getStore();
    return {
      credentials: store.get('credentials'),
      settings: store.get('settings'),
      version: app.getVersion(),
    };
  });

  ipcMain.handle('save-settings', async (_, newSettings) => {
    const store = getStore();
    if (newSettings.credentials) {
      const current = store.get('credentials') || {};
      const merged = { ...current };
      for (const [key, val] of Object.entries(newSettings.credentials)) {
        merged[key] = { ...(current[key] || {}), ...val };
      }
      store.set('credentials', merged);
    }
    if (newSettings.settings) store.set('settings', newSettings.settings);
    return { ok: true };
  });

  ipcMain.handle('clear-cache', async (_, type) => {
    cacheClear(type || 'all');
    return { ok: true };
  });

  ipcMain.handle('open-external', async (_, url) => {
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle('get-last-playlist', async () => {
    return getStore().get('lastPlaylist') || null;
  });

  ipcMain.handle('install-update', async () => {
    if (app.isPackaged) {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.quitAndInstall();
    }
    return { ok: true };
  });

  ipcMain.handle('check-for-updates', async () => {
    if (!app.isPackaged) {
      return { ok: false, message: 'Auto-update only works in the installed app, not in dev mode.' };
    }
    try {
      const { autoUpdater } = require('electron-updater');
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });

  ipcMain.handle('get-onboarding-state', async () => {
    const store = getStore();
    return {
      completed: store.get('onboarding.completed') === true,
      credentials: store.get('credentials'),
    };
  });

  ipcMain.handle('complete-onboarding', async () => {
    getStore().set('onboarding.completed', true);
    return { ok: true };
  });

  ipcMain.handle('reset-onboarding', async () => {
    getStore().set('onboarding.completed', false);
    return { ok: true };
  });
}

module.exports = { registerIpcHandlers };
