const { getRecommendations } = require('./spotify-api');
const { FEATURE_NAMES } = require('./fingerprint');

function euclideanDistance(a, b) {
  return Math.sqrt(FEATURE_NAMES.reduce((sum, f) => sum + ((a[f] || 0) - (b[f] || 0)) ** 2, 0));
}

async function harvestRecommendations(clusters, quotas, likedTrackIds, highPlayIds, budget, logFn) {
  const allCandidates = [];
  const seenIds = new Set([...likedTrackIds, ...highPlayIds]);
  const quotaMap = Object.fromEntries(quotas.map(q => [q.id, q.quota]));

  // Collect global top tracks as fallback seeds
  const globalTopTracks = clusters
    .flatMap(c => c.tracks)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 20);

  for (const cluster of clusters) {
    const clusterLabel = cluster.label;
    const clusterCandidates = [];
    const seedPool = [...cluster.tracks].sort((a, b) => b.weight - a.weight);

    logFn && logFn(`Harvesting recommendations — Cluster ${cluster.id + 1}/6 (${clusterLabel})...`);

    for (let call = 0; call < 5; call++) {
      if (!budget.canCall('recommendations')) break;

      // Pick 5 seeds for this call (rotate through pool)
      const start = call * 5;
      let seeds = seedPool.slice(start, start + 5).filter(t => t.spotifyId);

      if (seeds.length < 5) {
        const extras = globalTopTracks.filter(t => t.spotifyId && !seeds.find(s => s.spotifyId === t.spotifyId));
        seeds = [...seeds, ...extras].slice(0, 5);
      }
      if (seeds.length === 0) break;

      const seedIds = seeds.map(t => t.spotifyId).filter(Boolean);

      const minFeatures = {};
      const maxFeatures = {};
      for (const feat of FEATURE_NAMES) {
        const std = cluster.std[feat] || 0.1;
        minFeatures[feat] = cluster.centroid[feat] - 0.45 * std;
        maxFeatures[feat] = cluster.centroid[feat] + 0.45 * std;
      }

      const recs = await getRecommendations(seedIds, cluster.centroid, minFeatures, maxFeatures, budget, logFn);

      for (const track of recs) {
        if (!track.id || seenIds.has(track.id)) continue;
        seenIds.add(track.id);

        let dist = null;
        if (track.features) {
          dist = euclideanDistance(track.features, cluster.centroid);
        }

        clusterCandidates.push({
          id: track.id,
          name: track.name,
          artists: track.artists,
          features: track.features,
          clusterIdx: cluster.id,
          distance: dist,
        });
      }
    }

    // Sort by distance (closer = better), take quota
    clusterCandidates.sort((a, b) => {
      if (a.distance === null && b.distance === null) return 0;
      if (a.distance === null) return 1;
      if (b.distance === null) return -1;
      return a.distance - b.distance;
    });

    const quota = quotaMap[cluster.id] || 8;
    allCandidates.push({ clusterId: cluster.id, label: clusterLabel, quota, candidates: clusterCandidates });
  }

  return allCandidates;
}

function buildFinalPlaylist(harvestResults, targetSize) {
  // Fill quotas, then interleave
  const clusterBuckets = harvestResults.map(r => ({
    clusterId: r.clusterId,
    label: r.label,
    quota: r.quota,
    tracks: r.candidates.slice(0, r.quota),
    filled: Math.min(r.candidates.length, r.quota),
  }));

  // Redistribute unfilled quotas to highest-weight adjacent clusters
  let totalShortfall = clusterBuckets.reduce((s, b) => s + (b.quota - b.filled), 0);
  if (totalShortfall > 0) {
    const bestBucket = clusterBuckets.reduce((best, b) =>
      b.candidates.length > (best?.candidates.length || 0) ? b : best, null);
    if (bestBucket) {
      const extraTracks = bestBucket.candidates.slice(bestBucket.filled, bestBucket.filled + totalShortfall);
      bestBucket.tracks = [...bestBucket.tracks, ...extraTracks];
      bestBucket.filled = bestBucket.tracks.length;
    }
  }

  // Interleave: take one from each cluster bucket in rotation
  const interleaved = [];
  let maxLen = Math.max(...clusterBuckets.map(b => b.tracks.length));
  for (let i = 0; i < maxLen; i++) {
    for (const bucket of clusterBuckets) {
      if (i < bucket.tracks.length) interleaved.push(bucket.tracks[i]);
    }
  }

  // Collect new artist names for discovery report
  const newArtists = [];
  const seenArtists = new Set();
  for (const t of interleaved) {
    for (const a of (t.artists || [])) {
      if (!seenArtists.has(a)) {
        seenArtists.add(a);
        newArtists.push(a);
      }
    }
  }

  return {
    tracks: interleaved.slice(0, targetSize),
    clusterBreakdown: clusterBuckets.map(b => ({ label: b.label, quota: b.quota, filled: b.filled })),
    newArtists: newArtists.slice(0, 10),
  };
}

module.exports = { harvestRecommendations, buildFinalPlaylist };
