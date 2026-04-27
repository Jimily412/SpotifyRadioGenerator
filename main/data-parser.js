const fs = require('fs');
const path = require('path');

function detectFiles(folderPath) {
  let files;
  try {
    files = fs.readdirSync(folderPath);
  } catch {
    throw new Error('Cannot read the selected folder');
  }

  const streamingFiles = files.filter(f => /^StreamingHistory_music_\d+\.json$/i.test(f));
  const hasLibrary = files.includes('YourLibrary.json');
  const hasStreamingHistory = streamingFiles.length > 0;

  if (!hasStreamingHistory && !hasLibrary) {
    throw new Error(
      'No recognizable Spotify export files found. Expected: StreamingHistory_music_*.json and/or YourLibrary.json'
    );
  }

  return {
    streamingFiles: streamingFiles.map(f => path.join(folderPath, f)),
    libraryFile: hasLibrary ? path.join(folderPath, 'YourLibrary.json') : null,
    mode: hasLibrary ? 'full' : 'streaming-only'
  };
}

function parseStreamingHistory(files) {
  const playMap = {};

  for (const file of files) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }

    if (!Array.isArray(data)) continue;

    for (const entry of data) {
      const { artistName, trackName, msPlayed, ts } = entry;
      if (!artistName || !trackName) continue;
      if ((msPlayed || 0) < 30000) continue;

      const key = `${artistName.toLowerCase().trim()}|${trackName.toLowerCase().trim()}`;
      if (!playMap[key]) {
        playMap[key] = {
          artistName: artistName.trim(),
          trackName: trackName.trim(),
          playCount: 0,
          totalMs: 0,
          timestamps: [],
          likedBonus: 0
        };
      }
      playMap[key].playCount++;
      playMap[key].totalMs += msPlayed || 0;
      if (ts) playMap[key].timestamps.push(new Date(ts).getTime());
    }
  }

  return playMap;
}

function parseLikedSongs(libraryFile) {
  const liked = new Set();
  if (!libraryFile) return liked;
  try {
    const data = JSON.parse(fs.readFileSync(libraryFile, 'utf8'));
    const tracks = data.tracks || data.songs || [];
    for (const t of tracks) {
      if (t.artist && t.track) {
        liked.add(`${t.artist.toLowerCase().trim()}|${t.track.toLowerCase().trim()}`);
      }
    }
  } catch {
    /* ignore parse errors */
  }
  return liked;
}

function applyTimeDecay(timestamps) {
  if (!timestamps || timestamps.length === 0) return 1.0;
  const now = Date.now();
  const d30 = 30 * 24 * 60 * 60 * 1000;
  const d90 = 90 * 24 * 60 * 60 * 1000;
  const d365 = 365 * 24 * 60 * 60 * 1000;

  let totalDecay = 0;
  for (const ts of timestamps) {
    const age = now - ts;
    if (age <= d30) totalDecay += 1.5;
    else if (age <= d90) totalDecay += 1.2;
    else if (age <= d365) totalDecay += 1.0;
    else totalDecay += 0.7;
  }
  return timestamps.length > 0 ? totalDecay / timestamps.length : 1.0;
}

function buildWeightedTracks(playMap, liked) {
  const tracks = [];

  for (const [key, entry] of Object.entries(playMap)) {
    const likedBonus = liked.has(key) ? 5 : 0;
    const decayMultiplier = applyTimeDecay(entry.timestamps);
    let weight = (likedBonus + entry.playCount) * decayMultiplier;
    weight = Math.min(weight, 50);

    if (weight > 0) {
      tracks.push({
        key,
        artistName: entry.artistName,
        trackName: entry.trackName,
        weight: Math.round(weight * 100) / 100,
        playCount: entry.playCount,
        isLiked: liked.has(key)
      });
    }
  }

  for (const key of liked) {
    if (!playMap[key]) {
      const [artist, track] = key.split('|');
      tracks.push({
        key,
        artistName: artist,
        trackName: track,
        weight: 5,
        playCount: 0,
        isLiked: true
      });
    }
  }

  tracks.sort((a, b) => b.weight - a.weight);
  return tracks;
}

function getDateRange(playMap) {
  let earliest = Infinity;
  let latest = -Infinity;
  for (const entry of Object.values(playMap)) {
    for (const ts of entry.timestamps) {
      if (ts < earliest) earliest = ts;
      if (ts > latest) latest = ts;
    }
  }
  if (earliest === Infinity) return null;
  return { from: new Date(earliest), to: new Date(latest) };
}

function parseFolder(folderPath) {
  const { streamingFiles, libraryFile, mode } = detectFiles(folderPath);
  const playMap = parseStreamingHistory(streamingFiles);
  const liked = parseLikedSongs(libraryFile);
  const tracks = buildWeightedTracks(playMap, liked);
  const dateRange = getDateRange(playMap);

  if (tracks.length < 50) {
    return {
      tracks,
      mode,
      trackCount: tracks.length,
      dateRange,
      likedCount: liked.size,
      warning: `Only ${tracks.length} weighted tracks found. Analysis may be less accurate with small datasets.`
    };
  }

  return { tracks, mode, trackCount: tracks.length, dateRange, likedCount: liked.size };
}

module.exports = { parseFolder, parseLikedSongs, normalizeKey: (a, t) => `${a.toLowerCase().trim()}|${t.toLowerCase().trim()}` };
