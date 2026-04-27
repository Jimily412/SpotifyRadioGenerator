const { resolveTrackId, getAudioFeaturesBatch, hasBudget } = require('./spotify-api');

const FEATURE_NAMES = ['danceability', 'energy', 'valence', 'acousticness', 'instrumentalness', 'liveness', 'speechiness', 'tempo', 'loudness'];

function normalizeFeatures(raw) {
  return {
    danceability: raw.danceability ?? 0,
    energy: raw.energy ?? 0,
    valence: raw.valence ?? 0,
    acousticness: raw.acousticness ?? 0,
    instrumentalness: raw.instrumentalness ?? 0,
    liveness: raw.liveness ?? 0,
    speechiness: raw.speechiness ?? 0,
    tempo: Math.min((raw.tempo ?? 0) / 200, 1),
    loudness: raw.loudness != null ? Math.min(Math.max((raw.loudness + 60) / 60, 0), 1) : 0
  };
}

async function resolveTrackIds(tracks, budget, sendProgress) {
  const top = tracks.slice(0, 300);
  const resolved = [];
  let cacheHits = 0;
  let liveCalls = 0;

  for (let i = 0; i < top.length; i++) {
    const t = top[i];
    const result = await resolveTrackId(t.artistName, t.trackName, budget);
    if (!result) continue;
    if (result.fromCache) cacheHits++;
    else liveCalls++;
    resolved.push({ ...t, spotifyId: result.id });

    if ((i + 1) % 20 === 0 || i === top.length - 1) {
      sendProgress(`Resolving track IDs (${i + 1}/${top.length}) — cache: ${cacheHits}, live: ${liveCalls}...`);
    }

    if (!hasBudget(budget, 'search') && liveCalls > 0) break;
  }

  sendProgress(`Track ID resolution complete — ${resolved.length} resolved (cache: ${cacheHits}, live: ${liveCalls})`);
  return resolved;
}

async function fetchFeaturesForTracks(resolvedTracks, budget, sendProgress) {
  const ids = resolvedTracks.map(t => t.spotifyId).filter(Boolean);
  sendProgress(`Fetching audio features for ${ids.length} tracks...`);

  const featuresMap = await getAudioFeaturesBatch(ids, budget);

  const result = [];
  for (const t of resolvedTracks) {
    const raw = featuresMap[t.spotifyId];
    if (!raw) continue;
    result.push({ ...t, features: normalizeFeatures(raw) });
  }

  sendProgress(`Audio features fetched — ${result.length} tracks have feature data`);
  return result;
}

function computeWeightedFingerprint(featuredTracks) {
  const totalWeight = featuredTracks.reduce((s, t) => s + t.weight, 0);
  if (totalWeight === 0) return null;

  const avg = {};
  const std = {};

  for (const feat of FEATURE_NAMES) {
    avg[feat] = featuredTracks.reduce((s, t) => s + t.features[feat] * t.weight, 0) / totalWeight;
  }

  for (const feat of FEATURE_NAMES) {
    const variance = featuredTracks.reduce((s, t) => {
      const diff = t.features[feat] - avg[feat];
      return s + t.weight * diff * diff;
    }, 0) / totalWeight;
    std[feat] = Math.sqrt(variance);
  }

  const tasteScore = Math.round(
    (avg.energy * 30 + avg.danceability * 25 + avg.valence * 20 +
     avg.acousticness * 15 + avg.instrumentalness * 10) * 100
  ) / 100;

  return { avg, std, tasteScore, totalWeight, trackCount: featuredTracks.length };
}

function labelCluster(centroid) {
  const { energy, danceability, valence, acousticness, instrumentalness } = centroid;
  if (energy > 0.7 && danceability > 0.6) return { label: 'Hype', emoji: '🔥' };
  if (energy < 0.4 && acousticness > 0.5) return { label: 'Chill', emoji: '😌' };
  if (valence > 0.65 && energy >= 0.4 && energy <= 0.7) return { label: 'Feel Good', emoji: '😊' };
  if (valence < 0.35 && energy < 0.5) return { label: 'Dark / Moody', emoji: '🌑' };
  if (instrumentalness > 0.4) return { label: 'Focus / Instrumental', emoji: '🎵' };
  return { label: 'Mixed', emoji: '🎶' };
}

function runKMeans(data, k, restarts = 5) {
  const { kmeans } = require('ml-kmeans');
  let best = null;
  let bestInertia = Infinity;

  for (let r = 0; r < restarts; r++) {
    try {
      const result = kmeans(data, k, { maxIterations: 100, initialization: 'random' });
      let inertia = 0;
      for (let i = 0; i < data.length; i++) {
        const ci = result.clusters[i];
        const centroid = result.centroids[ci].centroid;
        for (let j = 0; j < data[i].length; j++) {
          const diff = data[i][j] - centroid[j];
          inertia += diff * diff;
        }
      }
      if (inertia < bestInertia) { bestInertia = inertia; best = result; }
    } catch { continue; }
  }

  return best;
}

function clusterTracks(featuredTracks) {
  if (featuredTracks.length < 6) {
    return [{
      id: 0,
      label: 'Mixed',
      emoji: '🎶',
      centroid: {},
      tracks: featuredTracks,
      totalWeight: featuredTracks.reduce((s, t) => s + t.weight, 0),
      std: {}
    }];
  }

  const vectors = featuredTracks.map(t => FEATURE_NAMES.map(f => t.features[f]));
  const k = Math.min(6, featuredTracks.length);
  const result = runKMeans(vectors, k);
  if (!result) return null;

  const clusters = Array.from({ length: k }, (_, i) => ({
    id: i,
    label: '',
    emoji: '',
    centroid: {},
    tracks: [],
    totalWeight: 0,
    std: {}
  }));

  for (let i = 0; i < featuredTracks.length; i++) {
    const ci = result.clusters[i];
    clusters[ci].tracks.push(featuredTracks[i]);
    clusters[ci].totalWeight += featuredTracks[i].weight;
  }

  for (let ci = 0; ci < k; ci++) {
    const rawCentroid = result.centroids[ci].centroid;
    const centroidObj = {};
    for (let j = 0; j < FEATURE_NAMES.length; j++) {
      centroidObj[FEATURE_NAMES[j]] = rawCentroid[j];
    }
    clusters[ci].centroid = centroidObj;

    const { label, emoji } = labelCluster(centroidObj);
    clusters[ci].label = label;
    clusters[ci].emoji = emoji;

    const std = {};
    for (const feat of FEATURE_NAMES) {
      const clusterTotalWeight = clusters[ci].totalWeight || 1;
      const variance = clusters[ci].tracks.reduce((s, t) => {
        const diff = t.features[feat] - centroidObj[feat];
        return s + t.weight * diff * diff;
      }, 0) / clusterTotalWeight;
      std[feat] = Math.sqrt(variance);
    }
    clusters[ci].std = std;

    clusters[ci].topTracks = [...clusters[ci].tracks]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 5);
  }

  return clusters;
}

function computeClusterQuotas(clusters, targetSize) {
  const totalWeight = clusters.reduce((s, c) => s + c.totalWeight, 0);
  const MIN_PER_CLUSTER = 8;
  let quotas = clusters.map(c => ({
    id: c.id,
    quota: Math.max(MIN_PER_CLUSTER, Math.round(targetSize * (c.totalWeight / totalWeight)))
  }));

  const total = quotas.reduce((s, q) => s + q.quota, 0);
  if (total > targetSize) {
    const excess = total - targetSize;
    const largest = [...quotas].sort((a, b) => b.quota - a.quota);
    for (let i = 0; i < excess && i < largest.length; i++) {
      const qi = quotas.findIndex(q => q.id === largest[i].id);
      if (quotas[qi].quota > MIN_PER_CLUSTER) quotas[qi].quota--;
    }
  }

  return quotas;
}

module.exports = {
  resolveTrackIds,
  fetchFeaturesForTracks,
  computeWeightedFingerprint,
  clusterTracks,
  computeClusterQuotas,
  normalizeFeatures,
  FEATURE_NAMES
};
