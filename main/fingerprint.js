const { kmeans } = require('ml-kmeans');

const FEATURE_NAMES = ['danceability', 'energy', 'loudness', 'speechiness', 'acousticness', 'instrumentalness', 'liveness', 'valence', 'tempo'];

function mergeWeights(parsedTracks, liveTracks) {
  const map = {};

  for (const t of parsedTracks) {
    const key = `${t.artistName.toLowerCase().trim()}|${t.trackName.toLowerCase().trim()}`;
    map[key] = { artistName: t.artistName, trackName: t.trackName, weight: t.weight || 0, plays: t.plays || 0, liked: t.liked || false };
  }

  for (const t of liveTracks) {
    if (!t.artistName || !t.trackName) continue;
    const key = `${t.artistName.toLowerCase().trim()}|${t.trackName.toLowerCase().trim()}`;
    if (map[key]) {
      map[key].weight = Math.min(50, map[key].weight + (t.weight || 0));
    } else {
      map[key] = { artistName: t.artistName, trackName: t.trackName, weight: Math.min(50, t.weight || 0), plays: 0, liked: false };
    }
    if (t.spotifyId) map[key].spotifyId = t.spotifyId;
  }

  return Object.values(map).sort((a, b) => b.weight - a.weight);
}

function computeFingerprint(tracksWithFeatures) {
  if (tracksWithFeatures.length === 0) return null;

  const totalWeight = tracksWithFeatures.reduce((s, t) => s + t.weight, 0);
  if (totalWeight === 0) return null;

  const avg = {};
  const variance = {};

  for (const feat of FEATURE_NAMES) {
    avg[feat] = tracksWithFeatures.reduce((s, t) => s + (t.features[feat] || 0) * t.weight, 0) / totalWeight;
  }

  for (const feat of FEATURE_NAMES) {
    variance[feat] = tracksWithFeatures.reduce((s, t) => {
      const diff = (t.features[feat] || 0) - avg[feat];
      return s + t.weight * diff * diff;
    }, 0) / totalWeight;
  }

  const std = {};
  for (const feat of FEATURE_NAMES) std[feat] = Math.sqrt(variance[feat]);

  const tasteScore = Math.round(
    (avg.energy * 30 + avg.danceability * 25 + avg.valence * 20 + avg.acousticness * 15 + avg.instrumentalness * 10) * 100
  ) / 100;

  return { avg, std, tasteScore, trackCount: tracksWithFeatures.length };
}

function clusterTracks(tracksWithFeatures) {
  if (tracksWithFeatures.length < 6) return fallbackClusters(tracksWithFeatures);

  const dataset = tracksWithFeatures.map(t => FEATURE_NAMES.map(f => t.features[f] || 0));

  let bestResult = null;
  let bestInertia = Infinity;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const result = kmeans(dataset, 6, { initialization: 'random', maxIterations: 50 });
      const inertia = computeInertia(dataset, result.clusters, result.centroids);
      if (inertia < bestInertia) {
        bestInertia = inertia;
        bestResult = result;
      }
    } catch (_) {}
  }

  if (!bestResult) return fallbackClusters(tracksWithFeatures);

  const clusters = Array.from({ length: 6 }, (_, i) => ({
    id: i,
    tracks: [],
    centroid: FEATURE_NAMES.reduce((obj, f, fi) => { obj[f] = bestResult.centroids[i][fi]; return obj; }, {}),
    label: '',
    totalWeight: 0,
    std: {},
  }));

  bestResult.clusters.forEach((clusterIdx, trackIdx) => {
    clusters[clusterIdx].tracks.push(tracksWithFeatures[trackIdx]);
    clusters[clusterIdx].totalWeight += tracksWithFeatures[trackIdx].weight;
  });

  const allWeight = clusters.reduce((s, c) => s + c.totalWeight, 0);

  for (const cluster of clusters) {
    cluster.label = assignLabel(cluster.centroid);
    cluster.weightPct = allWeight > 0 ? (cluster.totalWeight / allWeight * 100).toFixed(1) : '0';
    cluster.topTracks = [...cluster.tracks].sort((a, b) => b.weight - a.weight).slice(0, 5);
    cluster.std = computeClusterStd(cluster.tracks, cluster.centroid);
  }

  return clusters;
}

function computeInertia(dataset, assignments, centroids) {
  return dataset.reduce((sum, point, i) => {
    const c = centroids[assignments[i]];
    return sum + point.reduce((s, v, fi) => s + (v - c[fi]) ** 2, 0);
  }, 0);
}

function computeClusterStd(tracks, centroid) {
  if (tracks.length === 0) return FEATURE_NAMES.reduce((o, f) => { o[f] = 0.1; return o; }, {});
  const totalWeight = tracks.reduce((s, t) => s + t.weight, 0) || 1;
  const std = {};
  for (const feat of FEATURE_NAMES) {
    const variance = tracks.reduce((s, t) => {
      const diff = (t.features[feat] || 0) - (centroid[feat] || 0);
      return s + t.weight * diff * diff;
    }, 0) / totalWeight;
    std[feat] = Math.sqrt(variance) || 0.1;
  }
  return std;
}

function assignLabel(centroid) {
  const { energy, danceability, valence, acousticness, instrumentalness } = centroid;
  if (energy > 0.7 && danceability > 0.6) return 'Hype';
  if (energy < 0.4 && acousticness > 0.5) return 'Chill';
  if (valence > 0.65 && energy >= 0.4 && energy <= 0.7) return 'Feel Good';
  if (valence < 0.35 && energy < 0.5) return 'Dark / Moody';
  if (instrumentalness > 0.4) return 'Focus / Instrumental';
  return 'Mixed';
}

function fallbackClusters(tracks) {
  return Array.from({ length: 6 }, (_, i) => ({
    id: i,
    tracks: i === 0 ? tracks : [],
    centroid: FEATURE_NAMES.reduce((o, f) => { o[f] = 0.5; return o; }, {}),
    label: i === 0 ? 'Mixed' : 'Mixed',
    totalWeight: i === 0 ? tracks.reduce((s, t) => s + t.weight, 0) : 0,
    weightPct: i === 0 ? '100' : '0',
    topTracks: i === 0 ? tracks.slice(0, 5) : [],
    std: FEATURE_NAMES.reduce((o, f) => { o[f] = 0.3; return o; }, {}),
  }));
}

const WEIGHT_BAND_LABELS = ['Top Picks', 'Heavy Rotation', 'Regular Plays', 'Occasional Plays', 'Light Plays', 'Discovery Seeds'];

// Used when Spotify audio features are unavailable — splits tracks into 6
// weight bands so recommendations can still be seeded meaningfully.
function clusterByWeight(tracks) {
  if (tracks.length === 0) return fallbackClusters([]);
  const sorted = [...tracks].sort((a, b) => b.weight - a.weight);
  const totalWeight = sorted.reduce((s, t) => s + t.weight, 0);

  // Split into 6 roughly equal-weight bands
  const bands = Array.from({ length: 6 }, () => []);
  let cumWeight = 0;
  let band = 0;
  const bandTarget = totalWeight / 6;

  for (const t of sorted) {
    if (band < 5 && cumWeight >= bandTarget * (band + 1)) band++;
    bands[band].push(t);
    cumWeight += t.weight;
  }

  return bands.map((bandTracks, i) => {
    const bw = bandTracks.reduce((s, t) => s + t.weight, 0);
    return {
      id: i,
      tracks: bandTracks,
      centroid: FEATURE_NAMES.reduce((o, f) => { o[f] = 0.5; return o; }, {}),
      label: WEIGHT_BAND_LABELS[i],
      totalWeight: bw,
      weightPct: totalWeight > 0 ? (bw / totalWeight * 100).toFixed(1) : '0',
      topTracks: bandTracks.slice(0, 5),
      std: FEATURE_NAMES.reduce((o, f) => { o[f] = 0.3; return o; }, {}),
    };
  });
}

function computeQuotas(clusters, targetSize) {
  const allWeight = clusters.reduce((s, c) => s + c.totalWeight, 0);
  const MIN_PER_CLUSTER = 8;
  const quotas = clusters.map(c => ({
    id: c.id,
    quota: allWeight > 0 ? Math.max(MIN_PER_CLUSTER, Math.round(targetSize * c.totalWeight / allWeight)) : MIN_PER_CLUSTER,
  }));
  return quotas;
}

module.exports = { mergeWeights, computeFingerprint, clusterTracks, clusterByWeight, computeQuotas, FEATURE_NAMES };
