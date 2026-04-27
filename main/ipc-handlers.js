const { ipcMain, dialog, shell } = require('electron');
const { store, clearCache } = require('./store');
const { getAuthUrl, clearAuth, getValidToken } = require('./spotify-auth');
const {
  createBudget,
  getTopTracks,
  getRecentlyPlayed,
  getLikedTrackIds,
  getUserProfile,
  createPlaylist,
  addTracksToPlaylist
} = require('./spotify-api');
const { fetchLastfmData } = require('./lastfm-api');
const { parseFolder } = require('./data-parser');
const {
  resolveTrackIds,
  fetchFeaturesForTracks,
  computeWeightedFingerprint,
  clusterTracks,
  computeClusterQuotas
} = require('./fingerprint');
const { harvestAllClusters, filterCandidates, assignQuotasAndInterleave, getTopNewArtists } = require('./recommender');

let analysisResult = null;
let parsedData = null;
let mainWindowRef = null;

function getMainWindow() {
  return mainWindowRef;
}

function setMainWindow(win) {
  mainWindowRef = win;
}

function sendProgress(msg) {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  mainWindowRef?.webContents.send('progress', { message: msg, ts });
}

function setupIpcHandlers() {
  ipcMain.handle('store:get', (_, key) => store.get(key));
  ipcMain.handle('store:set', (_, key, value) => { store.set(key, value); });

  ipcMain.handle('spotify:getStatus', async () => {
    const token = await getValidToken();
    if (!token) return { connected: false };
    const displayName = store.get('auth.displayName');
    return { connected: true, displayName };
  });

  ipcMain.handle('spotify:connect', () => {
    const url = getAuthUrl();
    shell.openExternal(url);
    try { require('./index').startAuthTimeout(); } catch { /* no-op in early init */ }
    return { launched: true };
  });

  ipcMain.handle('spotify:disconnect', () => {
    clearAuth();
    return { disconnected: true };
  });

  ipcMain.handle('openExternal', (_, url) => {
    shell.openExternal(url);
  });

  ipcMain.handle('data:pickFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindowRef, {
      properties: ['openDirectory'],
      title: 'Select your Spotify Data Export folder'
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('data:loadFolder', async (_, folderPath) => {
    try {
      const data = parseFolder(folderPath);
      parsedData = data;
      analysisResult = null;
      return { success: true, ...data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('data:analyze', async () => {
    if (!parsedData) return { success: false, error: 'No data loaded — please select a folder first' };

    sendProgress('Starting taste analysis...');

    const budget = createBudget();
    const weightMap = {};

    for (const t of parsedData.tracks) {
      weightMap[t.key] = { ...t };
    }

    sendProgress('Fetching your top tracks from Spotify...');
    let spotifyTopCount = 0;
    try {
      const [shortTerm, medTerm] = await Promise.all([
        getTopTracks('short_term', 50, budget),
        getTopTracks('medium_term', 50, budget)
      ]);
      for (const t of shortTerm) {
        const key = `${t.artists[0]?.name?.toLowerCase().trim()}|${t.name?.toLowerCase().trim()}`;
        if (!weightMap[key]) weightMap[key] = { key, artistName: t.artists[0]?.name, trackName: t.name, weight: 0, playCount: 0, isLiked: false };
        weightMap[key].weight = (weightMap[key].weight || 0) + 8;
        spotifyTopCount++;
      }
      for (const t of medTerm) {
        const key = `${t.artists[0]?.name?.toLowerCase().trim()}|${t.name?.toLowerCase().trim()}`;
        if (!weightMap[key]) weightMap[key] = { key, artistName: t.artists[0]?.name, trackName: t.name, weight: 0, playCount: 0, isLiked: false };
        weightMap[key].weight = (weightMap[key].weight || 0) + 5;
        spotifyTopCount++;
      }
    } catch (err) {
      sendProgress(`Spotify top tracks error: ${err.message} — continuing`);
    }

    sendProgress('Fetching recently played from Spotify...');
    try {
      const recent = await getRecentlyPlayed(50, budget);
      for (const item of recent) {
        const t = item.track;
        const key = `${t.artists[0]?.name?.toLowerCase().trim()}|${t.name?.toLowerCase().trim()}`;
        if (!weightMap[key]) weightMap[key] = { key, artistName: t.artists[0]?.name, trackName: t.name, weight: 0, playCount: 0, isLiked: false };
        weightMap[key].weight = (weightMap[key].weight || 0) + 3;
      }
    } catch (err) {
      sendProgress(`Recently played error: ${err.message} — continuing`);
    }

    sendProgress('Fetching Last.fm data...');
    let lastfmCount = 0;
    let lastfmError = null;
    try {
      const lfm = await fetchLastfmData();
      if (lfm) {
        for (const [key, w] of Object.entries(lfm.weightMap)) {
          if (!weightMap[key]) {
            const [artist, track] = key.split('|');
            weightMap[key] = { key, artistName: artist, trackName: track, weight: 0, playCount: 0, isLiked: false };
          }
          weightMap[key].weight = (weightMap[key].weight || 0) + w;
          lastfmCount++;
        }
        store.set('lastfmLastSync', Date.now());
        sendProgress(`Last.fm: merged ${lfm.counts.recent} recent, ${lfm.counts.top1m} 1-month top, ${lfm.counts.top3m} 3-month top`);
      }
    } catch (err) {
      lastfmError = err.message;
      sendProgress(`Last.fm unavailable: ${err.message} — continuing with Spotify data only`);
    }

    const allTracks = Object.values(weightMap)
      .map(t => ({ ...t, weight: Math.min(t.weight || 0, 50) }))
      .filter(t => t.weight > 0)
      .sort((a, b) => b.weight - a.weight);

    sendProgress(`Merged dataset: ${allTracks.length} unique tracks`);

    sendProgress('Resolving track IDs on Spotify...');
    const resolved = await resolveTrackIds(allTracks, budget, sendProgress);

    sendProgress('Fetching audio features...');
    const featured = await fetchFeaturesForTracks(resolved, budget, sendProgress);

    if (featured.length < 6) {
      return { success: false, error: `Only ${featured.length} tracks with audio features — need at least 6 for clustering` };
    }

    sendProgress('Computing music fingerprint...');
    const fingerprint = computeWeightedFingerprint(featured);

    sendProgress('Running taste clustering (K-means, k=6)...');
    const clusters = clusterTracks(featured);
    if (!clusters) return { success: false, error: 'Clustering failed' };

    analysisResult = {
      tracks: featured,
      allTracks,
      fingerprint,
      clusters,
      likedKeys: new Set(parsedData.tracks.filter(t => t.isLiked).map(t => t.key)),
      highPlayKeys: new Set(parsedData.tracks.filter(t => t.playCount > 15).map(t => t.key))
    };

    sendProgress('Analysis complete!');

    const clusterSummary = clusters.map(c => ({
      id: c.id,
      label: c.label,
      emoji: c.emoji,
      trackCount: c.tracks.length,
      weightPercent: Math.round((c.totalWeight / fingerprint.totalWeight) * 100),
      topTracks: c.topTracks.map(t => ({ artist: t.artistName, track: t.trackName, weight: t.weight })),
      centroid: c.centroid,
      std: c.std
    }));

    return {
      success: true,
      fingerprint,
      clusters: clusterSummary,
      liveDataSummary: { spotifyTopCount, lastfmCount, lastfmError },
      budgetUsed: budget
    };
  });

  ipcMain.handle('generate:estimate', (_, { targetSize }) => {
    const clusterCount = analysisResult?.clusters?.length || 6;
    const recCalls = clusterCount * 5;
    const writeCalls = Math.ceil((targetSize || 150) / 100);
    return { estimated: recCalls + writeCalls + 10 };
  });

  ipcMain.handle('generate:run', async (_, options) => {
    if (!analysisResult) return { success: false, error: 'No analysis — run Analyze first' };

    const {
      playlistName = `TasteEngine Mix — ${new Date().toLocaleDateString()}`,
      targetSize = 150,
      includeFamiliar = false,
      clusterBias = {}
    } = options;

    sendProgress('Starting playlist generation...');
    const budget = createBudget();

    let profile;
    try {
      profile = await getUserProfile();
    } catch (err) {
      return { success: false, error: `Auth error: ${err.message}` };
    }

    sendProgress('Fetching liked track IDs for filtering...');
    const likedIds = await getLikedTrackIds(budget);

    const highPlayIds = new Set();
    for (const key of analysisResult.highPlayKeys) {
      for (const t of analysisResult.tracks) {
        if (t.key === key && t.spotifyId) highPlayIds.add(t.spotifyId);
      }
    }

    const { clusters, tracks: globalTracks } = analysisResult;
    const globalTopTracks = [...globalTracks].sort((a, b) => b.weight - a.weight).slice(0, 20);

    const allCandidates = await harvestAllClusters(
      clusters, globalTopTracks, budget, sendProgress, includeFamiliar, targetSize
    );

    sendProgress('Filtering and scoring candidates...');
    const totalCandidates = Object.values(allCandidates).reduce((s, c) => s + c.length, 0);
    sendProgress(`Total candidates before filter: ${totalCandidates}`);

    const filtered = filterCandidates(allCandidates, clusters, likedIds, highPlayIds, includeFamiliar, clusterBias);
    const quotas = computeClusterQuotas(clusters, targetSize);
    const { playlist, breakdown } = assignQuotasAndInterleave(filtered, clusters, quotas, clusterBias);

    sendProgress(`Creating playlist "${playlistName}" in Spotify...`);
    let spotifyPlaylist;
    try {
      spotifyPlaylist = await createPlaylist(profile.id, playlistName, budget);
    } catch (err) {
      return { success: false, error: `Failed to create playlist: ${err.message}` };
    }

    const trackUris = playlist.map(item => `spotify:track:${item.track.id}`);
    sendProgress(`Adding ${trackUris.length} tracks to playlist...`);
    await addTracksToPlaylist(spotifyPlaylist.id, trackUris, budget);

    const topArtists = getTopNewArtists(playlist, likedIds, highPlayIds);
    const playlistUrl = spotifyPlaylist.external_urls?.spotify || `https://open.spotify.com/playlist/${spotifyPlaylist.id}`;

    store.set('lastPlaylist', {
      name: playlistName,
      url: playlistUrl,
      id: spotifyPlaylist.id,
      trackCount: trackUris.length,
      createdAt: new Date().toISOString()
    });

    sendProgress(`Done! ${trackUris.length} tracks added to "${playlistName}"`);

    return {
      success: true,
      playlistName,
      playlistUrl,
      trackCount: trackUris.length,
      breakdown,
      topArtists,
      budgetUsed: budget
    };
  });

  ipcMain.handle('cache:clear', (_, type) => {
    clearCache(type);
    return { cleared: type };
  });

  ipcMain.handle('updates:install', () => {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.quitAndInstall();
    } catch { /* not packaged */ }
  });
}

module.exports = { setupIpcHandlers, setMainWindow, getMainWindow, sendProgress };
