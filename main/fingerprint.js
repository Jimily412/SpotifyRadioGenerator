const { kmeans } = require('ml-kmeans');

const FEATURE_NAMES = ['danceability', 'energy', 'loudness', 'speechiness', 'acousticness', 'instrumentalness', 'liveness', 'valence', 'tempo'];
const FLAT_CENTROID = () => FEATURE_NAMES.reduce((o, f) => { o[f] = 0.5; return o; }, {});
const FLAT_STD      = () => FEATURE_NAMES.reduce((o, f) => { o[f] = 0.3; return o; }, {});

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

function computeFingerprint(tracks) {
  if (!tracks.length) return null;
  const totalWeight = tracks.reduce((s, t) => s + t.weight, 0);
  if (!totalWeight) return null;
  const avg = {}, std = {};
  for (const f of FEATURE_NAMES) {
    avg[f] = tracks.reduce((s, t) => s + (t.features[f] || 0) * t.weight, 0) / totalWeight;
    std[f] = Math.sqrt(tracks.reduce((s, t) => { const d = (t.features[f] || 0) - avg[f]; return s + t.weight * d * d; }, 0) / totalWeight);
  }
  const tasteScore = Math.round((avg.energy * 30 + avg.danceability * 25 + avg.valence * 20 + avg.acousticness * 15 + avg.instrumentalness * 10) * 100) / 100;
  return { avg, std, tasteScore, trackCount: tracks.length };
}

function clusterTracks(tracks) {
  if (tracks.length < 6) return [{ id: 0, tracks, centroid: FLAT_CENTROID(), label: 'Mixed', totalWeight: tracks.reduce((s, t) => s + t.weight, 0), weightPct: '100', topTracks: tracks.slice(0, 5), std: FLAT_STD() }];
  const dataset = tracks.map(t => FEATURE_NAMES.map(f => t.features[f] || 0));
  let best = null, bestInertia = Infinity;
  for (let i = 0; i < 5; i++) {
    try {
      const r = kmeans(dataset, 6, { initialization: 'random', maxIterations: 50 });
      const inertia = dataset.reduce((s, p, idx) => { const c = r.centroids[r.clusters[idx]]; return s + p.reduce((ss, v, fi) => ss + (v - c[fi]) ** 2, 0); }, 0);
      if (inertia < bestInertia) { bestInertia = inertia; best = r; }
    } catch {}
  }
  if (!best) return clusterTracks([]);
  const clusters = Array.from({ length: 6 }, (_, i) => ({ id: i, tracks: [], centroid: FEATURE_NAMES.reduce((o, f, fi) => { o[f] = best.centroids[i][fi]; return o; }, {}), totalWeight: 0 }));
  best.clusters.forEach((ci, ti) => { clusters[ci].tracks.push(tracks[ti]); clusters[ci].totalWeight += tracks[ti].weight; });
  const allW = clusters.reduce((s, c) => s + c.totalWeight, 0);
  for (const c of clusters) {
    const { energy, danceability, valence, acousticness, instrumentalness } = c.centroid;
    c.label = energy > 0.7 && danceability > 0.6 ? 'Hype' : energy < 0.4 && acousticness > 0.5 ? 'Chill' : valence > 0.65 ? 'Feel Good' : valence < 0.35 && energy < 0.5 ? 'Dark / Moody' : instrumentalness > 0.4 ? 'Focus / Instrumental' : 'Mixed';
    c.weightPct = allW > 0 ? (c.totalWeight / allW * 100).toFixed(1) : '0';
    c.topTracks = [...c.tracks].sort((a, b) => b.weight - a.weight).slice(0, 5);
    const tw = c.tracks.reduce((s, t) => s + t.weight, 0) || 1;
    c.std = FEATURE_NAMES.reduce((o, f) => { const v = c.tracks.reduce((s, t) => { const d = (t.features[f] || 0) - (c.centroid[f] || 0); return s + t.weight * d * d; }, 0) / tw; o[f] = Math.sqrt(v) || 0.1; return o; }, {});
  }
  return clusters;
}

const GENRE_LABELS = ['Hype', 'Chill', 'Feel Good', 'Dark / Moody', 'Focus / Instrumental', 'Mixed'];

function genreToCluster(g) {
  if (/hip.?hop|rap|trap|drill|grime|dancehall|bounce|crunk/.test(g))            return 0;
  if (/\bedm\b|house|techno|trance|drum.and.bass|dubstep|hardstyle|electro/.test(g)) return 0;
  if (/ambient|chill|lo.?fi|new.?age|downtempo|meditation|shoegaze|bossa/.test(g))   return 1;
  if (/dream.?pop|bedroom.?pop|folktronica|\bfolk\b|singer.songwriter|acoustic/.test(g)) return 1;
  if (/\bfunk\b|\bsoul\b|r&b|rhythm.and.blues|reggae|disco|motown/.test(g))      return 2;
  if (/\bpop\b/.test(g) && !/post.punk|noise.pop/.test(g))                        return 2;
  if (/metal|doom|thrash|grindcore/.test(g))                                       return 3;
  if (/punk|hardcore|screamo|emo|grunge|darkwave|gothic|goth|industrial/.test(g)) return 3;
  if (/\brock\b|alternative|garage/.test(g))                                       return 3;
  if (/classical|jazz|instrumental|post.rock|film.score|soundtrack|orchestral|piano|opera/.test(g)) return 4;
  if (/progressive|math.rock/.test(g))                                             return 4;
  return -1;
}

function clusterByGenre(tracks, artistGenreMap) {
  const bins = Array.from({ length: 6 }, () => []);
  for (const track of tracks) {
    const genres = artistGenreMap[track.artistName?.toLowerCase().trim()] || [];
    if (!genres.length) { bins[5].push(track); continue; }
    const votes = [0, 0, 0, 0, 0];
    for (const g of genres) { const c = genreToCluster(g); if (c >= 0) votes[c]++; }
    const max = Math.max(...votes);
    bins[max > 0 ? votes.indexOf(max) : 5].push(track);
  }
  const totalWeight = tracks.reduce((s, t) => s + t.weight, 0);
  return bins.map((bin, i) => {
    const sorted = [...bin].sort((a, b) => b.weight - a.weight);
    const bw = bin.reduce((s, t) => s + t.weight, 0);
    return { id: i, tracks: sorted, centroid: FLAT_CENTROID(), label: GENRE_LABELS[i], totalWeight: bw, pct: totalWeight > 0 ? bw / totalWeight : 0, weightPct: totalWeight > 0 ? (bw / totalWeight * 100).toFixed(1) : '0', topTracks: sorted.slice(0, 5), std: FLAT_STD() };
  });
}

const WEIGHT_LABELS = ['Top Picks', 'Heavy Rotation', 'Regular Plays', 'Occasional Plays', 'Light Plays', 'Discovery Seeds'];

function clusterByWeight(tracks) {
  if (!tracks.length) return WEIGHT_LABELS.map((label, i) => ({ id: i, tracks: [], centroid: FLAT_CENTROID(), label, totalWeight: 0, weightPct: '0', topTracks: [], std: FLAT_STD() }));
  const sorted = [...tracks].sort((a, b) => b.weight - a.weight);
  const totalWeight = sorted.reduce((s, t) => s + t.weight, 0);
  const bands = Array.from({ length: 6 }, () => []);
  let cumW = 0, band = 0;
  for (const t of sorted) {
    if (band < 5 && cumW >= totalWeight / 6 * (band + 1)) band++;
    bands[band].push(t);
    cumW += t.weight;
  }
  return bands.map((b, i) => {
    const bw = b.reduce((s, t) => s + t.weight, 0);
    return { id: i, tracks: b, centroid: FLAT_CENTROID(), label: WEIGHT_LABELS[i], totalWeight: bw, weightPct: totalWeight > 0 ? (bw / totalWeight * 100).toFixed(1) : '0', topTracks: b.slice(0, 5), std: FLAT_STD() };
  });
}

function computeQuotas(clusters, targetSize) {
  const allWeight = clusters.reduce((s, c) => s + c.totalWeight, 0);
  return clusters.map(c => ({ id: c.id, quota: allWeight > 0 ? Math.max(8, Math.round(targetSize * c.totalWeight / allWeight)) : 8 }));
}

module.exports = { mergeWeights, computeFingerprint, clusterTracks, clusterByGenre, clusterByWeight, computeQuotas, FEATURE_NAMES };
