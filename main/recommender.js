const { getRecommendations, hasBudget } = require('./spotify-api');
const { computeClusterQuotas } = require('./fingerprint');

async function harvestCluster(cluster, globalTopTracks, budget, sendProgress, includeFamiliar, targetSize) {
  const seeds = [...cluster.tracks]
    .sort((a, b) => b.weight - a.weight)
    .map(t => t.spotifyId)
    .filter(Boolean);

  if (seeds.length === 0) {
    sendProgress(`Cluster ${cluster.id + 1} (${cluster.label}): no seeds available, skipping`);
    return [];
  }

  const candidates = [];
  const batchSize = 5;
  const maxCalls = 5;

  const seedPool = [...seeds];
  if (seedPool.length < batchSize) {
    const extras = globalTopTracks
      .map(t => t.spotifyId)
      .filter(id => id && !seedPool.includes(id));
    seedPool.push(...extras.slice(0, batchSize - seedPool.length));
  }

  for (let call = 0; call < maxCalls; call++) {
    if (!hasBudget(budget, 'recommendations')) break;
    const start = (call * batchSize) % Math.max(seedPool.length, 1);
    const batchSeeds = [];
    for (let i = 0; i < batchSize; i++) {
      batchSeeds.push(seedPool[(start + i) % seedPool.length]);
    }
    const uniqueSeeds = [...new Set(batchSeeds)].slice(0, 5);

    const result = await getRecommendations(
      uniqueSeeds,
      cluster.centroid,
      cluster.std,
      20,
      budget
    );

    if (!result) continue;
    const label = result.fromCache ? '(cached)' : '';
    sendProgress(`  Harvesting cluster ${cluster.id + 1}/${6} (${cluster.label}) — batch ${call + 1}/5 ${label}`);

    for (const track of result.tracks) {
      if (track && track.id) candidates.push(track);
    }
  }

  return candidates;
}

async function harvestAllClusters(clusters, globalTopTracks, budget, sendProgress, includeFamiliar, targetSize) {
  const allCandidates = {};
  for (const c of clusters) allCandidates[c.id] = [];

  for (const cluster of clusters) {
    sendProgress(`Harvesting recommendations — Cluster ${cluster.id + 1}/6 (${cluster.label})...`);
    const results = await harvestCluster(cluster, globalTopTracks, budget, sendProgress, includeFamiliar, targetSize);
    allCandidates[cluster.id].push(...results);
  }

  return allCandidates;
}

function filterCandidates(allCandidates, clusters, likedIds, highPlayIds, includeFamiliar, clusterBias) {
  const seen = new Set();
  const filtered = {};

  for (const cluster of clusters) {
    const cands = allCandidates[cluster.id] || [];
    const bias = clusterBias ? (clusterBias[cluster.id] ?? 1.0) : 1.0;
    const kept = [];

    for (const track of cands) {
      if (seen.has(track.id)) continue;
      if (!includeFamiliar && likedIds.has(track.id)) continue;
      if (highPlayIds.has(track.id)) continue;
      seen.add(track.id);
      kept.push({ track, clusterId: cluster.id, score: Math.random() * bias });
    }

    kept.sort((a, b) => b.score - a.score);
    filtered[cluster.id] = kept;
  }

  return filtered;
}

function assignQuotasAndInterleave(filtered, clusters, quotas, clusterBias) {
  const byCluster = {};
  for (const q of quotas) {
    byCluster[q.id] = {
      items: filtered[q.id] || [],
      quota: Math.round(q.quota * (clusterBias ? (clusterBias[q.id] ?? 1.0) : 1.0)),
      filled: 0
    };
  }

  let totalQuota = quotas.reduce((s, q) => s + q.quota, 0);
  for (const q of quotas) {
    const avail = byCluster[q.id].items.length;
    const deficit = Math.max(0, byCluster[q.id].quota - avail);
    if (deficit > 0) {
      byCluster[q.id].quota = avail;
      let remaining = deficit;
      const sorted = [...quotas].sort((a, b) => byCluster[b.id].items.length - byCluster[a.id].items.length);
      for (const other of sorted) {
        if (other.id === q.id) continue;
        const canGive = Math.max(0, byCluster[other.id].items.length - byCluster[other.id].quota);
        const give = Math.min(canGive, remaining);
        byCluster[other.id].quota += give;
        remaining -= give;
        if (remaining <= 0) break;
      }
    }
  }

  const playlist = [];
  const clusterIds = clusters.map(c => c.id);
  let anyLeft = true;

  while (anyLeft) {
    anyLeft = false;
    for (const id of clusterIds) {
      const bucket = byCluster[id];
      if (!bucket) continue;
      if (bucket.filled < bucket.quota && bucket.items.length > bucket.filled) {
        playlist.push(bucket.items[bucket.filled]);
        bucket.filled++;
        anyLeft = true;
      }
    }
  }

  const breakdown = quotas.map(q => ({
    clusterId: q.id,
    label: clusters.find(c => c.id === q.id)?.label || '',
    emoji: clusters.find(c => c.id === q.id)?.emoji || '',
    quota: q.quota,
    filled: byCluster[q.id]?.filled || 0
  }));

  return { playlist, breakdown };
}

function getTopNewArtists(playlist, likedIds, highPlayIds, limit = 10) {
  const artistCounts = {};
  for (const item of playlist) {
    const artists = item.track?.artists || [];
    for (const a of artists) {
      artistCounts[a.name] = (artistCounts[a.name] || 0) + 1;
    }
  }
  return Object.entries(artistCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

module.exports = {
  harvestAllClusters,
  filterCandidates,
  assignQuotasAndInterleave,
  getTopNewArtists
};
