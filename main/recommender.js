const { getTracksByArtistNames } = require('./spotify-api');
const { getSimilarArtists } = require('./lastfm-api');

async function harvestRecommendations(clusters, quotas, likedTrackIds, highPlayIds, budget, logFn) {
  const seenIds = new Set([...likedTrackIds, ...highPlayIds]);
  const quotaMap = Object.fromEntries(quotas.map(q => [q.id, q.quota]));
  const allCandidates = [];

  for (const cluster of clusters) {
    logFn?.(`Finding recommendations — Cluster ${cluster.id + 1}/6 (${cluster.label})...`);

    const seedArtists = [...new Set(
      [...cluster.tracks].sort((a, b) => b.weight - a.weight).slice(0, 10).map(t => t.artistName).filter(Boolean)
    )].slice(0, 3);

    const seenArtists = new Set(seedArtists.map(a => a.toLowerCase()));
    const similarArtists = [];
    for (const artist of seedArtists) {
      for (const sim of await getSimilarArtists(artist, 6)) {
        if (!seenArtists.has(sim.toLowerCase())) { seenArtists.add(sim.toLowerCase()); similarArtists.push(sim); }
      }
      if (similarArtists.length >= 12) break;
    }

    const recs = await getTracksByArtistNames(similarArtists.slice(0, 10), 5, budget, logFn);
    const candidates = [];
    for (const t of recs) {
      if (t.id && !seenIds.has(t.id)) { seenIds.add(t.id); candidates.push({ ...t, clusterIdx: cluster.id }); }
    }

    logFn?.(`Cluster ${cluster.id + 1}: ${candidates.length} candidates via ${similarArtists.length} similar artists`);
    allCandidates.push({ clusterId: cluster.id, label: cluster.label, quota: quotaMap[cluster.id] ?? 8, candidates });
  }

  return allCandidates;
}

function buildFinalPlaylist(harvestResults, targetSize) {
  const buckets = harvestResults.map(r => ({
    ...r,
    tracks: r.candidates.slice(0, r.quota),
    filled: Math.min(r.candidates.length, r.quota),
  }));

  const shortfall = buckets.reduce((s, b) => s + (b.quota - b.filled), 0);
  if (shortfall > 0) {
    const best = buckets.reduce((a, b) => b.candidates.length > a.candidates.length ? b : a, buckets[0]);
    const extra = best.candidates.slice(best.filled, best.filled + shortfall);
    best.tracks = [...best.tracks, ...extra];
    best.filled = best.tracks.length;
  }

  const maxLen = buckets.reduce((m, b) => Math.max(m, b.tracks.length), 0);
  const interleaved = [];
  for (let i = 0; i < maxLen; i++) {
    for (const b of buckets) { if (i < b.tracks.length) interleaved.push(b.tracks[i]); }
  }

  const seenArtists = new Set();
  const newArtists = [];
  for (const t of interleaved) {
    for (const a of (t.artists || [])) {
      if (!seenArtists.has(a)) { seenArtists.add(a); newArtists.push(a); }
    }
  }

  return {
    tracks: interleaved.slice(0, targetSize),
    clusterBreakdown: buckets.map(b => ({ label: b.label, quota: b.quota, filled: b.filled })),
    newArtists: newArtists.slice(0, 10),
  };
}

module.exports = { harvestRecommendations, buildFinalPlaylist };
