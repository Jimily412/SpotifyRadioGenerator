const fs = require('fs');
const path = require('path');

function parseExportFolder(folderPath) {
  const files = fs.readdirSync(folderPath);

  const historyFiles = files.filter(f => /^StreamingHistory_music_\d+\.json$/i.test(f));
  const hasLibrary = files.includes('YourLibrary.json');

  if (historyFiles.length === 0 && !hasLibrary) {
    return {
      error: 'No recognized Spotify export files found. Expected StreamingHistory_music_*.json and/or YourLibrary.json.',
      tracks: [],
    };
  }

  const weightMap = {};
  const dateMap = {};

  // Parse streaming history
  for (const file of historyFiles) {
    let entries;
    try {
      entries = JSON.parse(fs.readFileSync(path.join(folderPath, file), 'utf-8'));
    } catch (e) {
      continue;
    }
    for (const entry of entries) {
      const artist = entry.artistName || entry.master_metadata_album_artist_name;
      const track = entry.trackName || entry.master_metadata_track_name;
      const ms = entry.msPlayed || entry.ms_played || 0;
      const ts = entry.ts || entry.endTime;

      if (!artist || !track) continue;
      if (ms < 30000) continue;

      const key = `${artist.toLowerCase().trim()}|${track.toLowerCase().trim()}`;
      const rawKey = `${artist.trim()}|${track.trim()}`;

      if (!weightMap[rawKey]) {
        weightMap[rawKey] = { artistName: artist.trim(), trackName: track.trim(), plays: 0 };
        dateMap[rawKey] = [];
      }
      weightMap[rawKey].plays++;
      if (ts) dateMap[rawKey].push(new Date(ts).getTime());
    }
  }

  // Parse YourLibrary
  let likedCount = 0;
  if (hasLibrary) {
    let lib;
    try {
      lib = JSON.parse(fs.readFileSync(path.join(folderPath, 'YourLibrary.json'), 'utf-8'));
    } catch (e) {}

    const liked = lib?.tracks || [];
    for (const item of liked) {
      const artist = (item.artist || '').trim();
      const track = (item.track || '').trim();
      if (!artist || !track) continue;
      const rawKey = `${artist}|${track}`;
      if (!weightMap[rawKey]) {
        weightMap[rawKey] = { artistName: artist, trackName: track, plays: 0 };
        dateMap[rawKey] = [];
      }
      weightMap[rawKey].liked = true;
      likedCount++;
    }
  }

  // Compute weighted scores with time decay
  const now = Date.now();
  const tracks = [];

  for (const [key, entry] of Object.entries(weightMap)) {
    let weight = entry.plays;

    // Time decay on plays
    const timestamps = dateMap[key] || [];
    if (timestamps.length > 0) {
      const avgTs = timestamps.reduce((a, b) => a + b, 0) / timestamps.length;
      const ageMs = now - avgTs;
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      let decayMultiplier = 1.0;
      if (ageDays <= 30) decayMultiplier = 1.5;
      else if (ageDays <= 90) decayMultiplier = 1.2;
      else if (ageDays <= 365) decayMultiplier = 1.0;
      else decayMultiplier = 0.7;
      weight = weight * decayMultiplier;
    }

    if (entry.liked) weight += 5;

    weight = Math.min(50, weight);
    if (weight < 0.01) continue;

    tracks.push({
      artistName: entry.artistName,
      trackName: entry.trackName,
      weight,
      plays: entry.plays,
      liked: !!entry.liked,
    });
  }

  tracks.sort((a, b) => b.weight - a.weight);

  const mode = hasLibrary && historyFiles.length > 0 ? 'Full Export'
    : hasLibrary ? 'Library Only'
    : 'Streaming History Only';

  // Date range from history
  let minDate = null, maxDate = null;
  for (const dts of Object.values(dateMap)) {
    for (const ts of dts) {
      if (!minDate || ts < minDate) minDate = ts;
      if (!maxDate || ts > maxDate) maxDate = ts;
    }
  }

  return {
    tracks,
    mode,
    trackCount: tracks.length,
    likedCount,
    historyFiles: historyFiles.length,
    dateRange: minDate ? { from: new Date(minDate).toISOString(), to: new Date(maxDate).toISOString() } : null,
    warning: tracks.length < 50 ? `Only ${tracks.length} weighted tracks found. Results may be limited.` : null,
  };
}

module.exports = { parseExportFolder };
