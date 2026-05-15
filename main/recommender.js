const { getTracksByArtistNames } = require('./spotify-api');
const { getSimilarArtists } = require('./lastfm-api');

async function harvestRecommendations(clusters, quotas, likedTrackIds, highPlayIds, budget, logFn) {
  const allCandidates = [];
  const seenIds = new Set([...likedTrackIds, ...highPlayIds]);
  const quotaMap = Object.fromEntries(quotas.map(q => [q.id, q.quota]));

  for (const cluster of clusters) {
    const clusterCandidates = [];
    logFn && logFn(`Finding recommendations — Cluster ${cluster.id + 1}/6 (${cluster.label})...`);

    // Pick top seed artists from this cluster
    const seedTracks = [...cluster.tracks].sort((a, b) => b.weight - a.weight).slice(0, 10);
    const seedArtists = [...new Set(seedTracks.map(t => t.artistName).filter(Boolean))].slice(0, 3);

    // Find similar artists via Last.fm
    const similarArtists = [];
    const seenArtists = new Set(seedArtists.map(a => a.toLowerCase()));
    for (const artist of seedArtists) {
      const sims = await getSimilarArtists(artist, 6);
      for (const sim of sims) {
        if (!seenArtists.has(sim.toLowerCase())) {
          seenArtists.add(sim.toLowerCase());
          similarArtists.push(sim);
        }
      }
      if (similarArtists.length >= 12) break;
    }

    // Search Spotify for tracks by similar artists
    const recs = await getTracksByArtistNames(similarArtists.slice(0, 10), 5, budget, logFn);

    for (const track of recs) {
      if (!track.id || seenIds.has(track.id)) continue;
      seenIds.add(track.id);
      clusterCandidates.push({ ...track, clusterIdx: cluster.id, distance: null });
    }

    logFn && logFn(`Cluster ${cluster.id + 1}: ${clusterCandidates.length} candidates via ${similarArtists.length} similar artists`);

    const quota = quotaMap[cluster.id] || 8;
    allCandidates.push({ clusterId: cluster.id, label: cluster.label, quota, candidates: clusterCandidates });
  }

  return allCandidates;
}

function buildFinalPlaylist(harvestResults, targetSize) {
  const clusterBuckets = harvestResults.map(r => ({
    clusterId: r.clusterId,
    label: r.label,
    quota: r.quota,
    candidates: r.candidates,
    tracks: r.candidates.slice(0, r.quota),
    filled: Math.min(r.candidates.length, r.quota),
  }));

  // Redistribute unfilled quota to the cluster with the most candidates
  const totalShortfall = clusterBuckets.reduce((s, b) => s + (b.quota - b.filled), 0);
  if (totalShortfall > 0) {
    const bestBucket = clusterBuckets.reduce((best, b) =>
      b.candidates.length > (best?.candidates.length || 0) ? b : best, null);
    if (bestBucket) {
      const extra = bestBucket.candidates.slice(bestBucket.filled, bestBucket.filled + totalShortfall);
      bestBucket.tracks = [...bestBucket.tracks, ...extra];
      bestBucket.filled = bestBucket.tracks.length;
    }
  }

  // Interleave: one track from each cluster in rotation
  const interleaved = [];
  const maxLen = clusterBuckets.reduce((m, b) => Math.max(m, b.tracks.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const bucket of clusterBuckets) {
      if (i < bucket.tracks.length) interleaved.push(bucket.tracks[i]);
    }
  }

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
