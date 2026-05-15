const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

// Recursively find all files matching a predicate under a directory
function findFiles(dir, predicate, results = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (_) { return results; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findFiles(full, predicate, results);
    } else if (entry.isFile() && predicate(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

function isHistoryFile(name) {
  // Standard account data export: StreamingHistory_music_0.json
  // Extended streaming history (older): endsong_0.json
  // Extended streaming history (newer): Streaming_History_Audio_2023-2024_8.json
  return /^StreamingHistory_music_\d+\.json$/i.test(name) ||
         /^endsong_\d+\.json$/i.test(name) ||
         /^Streaming_History_Audio_.*\.json$/i.test(name);
}

function isLibraryFile(name) {
  return name === 'YourLibrary.json';
}

// Parse a streaming history JSON array (handles both export formats)
function parseHistoryEntries(entries, weightMap, dateMap) {
  for (const entry of entries) {
    const artist = (entry.artistName || entry.master_metadata_album_artist_name || '').trim();
    const track  = (entry.trackName  || entry.master_metadata_track_name        || '').trim();
    const ms     = entry.msPlayed    || entry.ms_played    || 0;
    const ts     = entry.ts          || entry.endTime;

    if (!artist || !track) continue;
    if (ms < 30000) continue;

    const rawKey = `${artist}|${track}`;

    if (!weightMap[rawKey]) {
      weightMap[rawKey] = { artistName: artist, trackName: track, plays: 0 };
      dateMap[rawKey] = [];
    }
    weightMap[rawKey].plays++;
    if (ts) dateMap[rawKey].push(new Date(ts).getTime());
  }
}

function parseLibraryEntries(lib, weightMap, dateMap) {
  const liked = lib?.tracks || [];
  let count = 0;
  for (const item of liked) {
    const artist = (item.artist || '').trim();
    const track  = (item.track  || '').trim();
    if (!artist || !track) continue;
    const rawKey = `${artist}|${track}`;
    if (!weightMap[rawKey]) {
      weightMap[rawKey] = { artistName: artist, trackName: track, plays: 0 };
      dateMap[rawKey] = [];
    }
    weightMap[rawKey].liked = true;
    count++;
  }
  return count;
}

function buildResults(weightMap, dateMap, historyFileCount, likedCount, hasLibrary) {
  const now = Date.now();
  const tracks = [];

  for (const [key, entry] of Object.entries(weightMap)) {
    let weight = entry.plays;

    const timestamps = dateMap[key] || [];
    if (timestamps.length > 0) {
      const avgTs = timestamps.reduce((a, b) => a + b, 0) / timestamps.length;
      const ageDays = (now - avgTs) / 86400000;
      const mult = ageDays <= 30 ? 1.1 : ageDays <= 90 ? 1.05 : ageDays <= 365 ? 1.0 : 0.9;
      weight *= mult;
    }

    if (entry.liked) weight += 5;
    weight = Math.min(50, weight);
    if (weight < 0.01) continue;

    tracks.push({
      artistName: entry.artistName,
      trackName:  entry.trackName,
      weight,
      plays: entry.plays,
      liked: !!entry.liked,
    });
  }

  tracks.sort((a, b) => b.weight - a.weight);

  let minDate = null, maxDate = null;
  for (const dts of Object.values(dateMap)) {
    for (const ts of dts) {
      if (!minDate || ts < minDate) minDate = ts;
      if (!maxDate || ts > maxDate) maxDate = ts;
    }
  }

  const mode = hasLibrary && historyFileCount > 0 ? 'Full Export'
    : hasLibrary ? 'Library Only'
    : 'Streaming History Only';

  return {
    tracks,
    mode,
    trackCount: tracks.length,
    likedCount,
    historyFiles: historyFileCount,
    dateRange: minDate
      ? { from: new Date(minDate).toISOString(), to: new Date(maxDate).toISOString() }
      : null,
    warning: tracks.length < 50
      ? `Only ${tracks.length} weighted tracks found after filtering. Results may be limited.`
      : null,
  };
}

// ── Main entry: accepts a folder path OR a .zip file path ──────────────────

function parseExport(inputPath) {
  const stat = fs.statSync(inputPath);

  if (stat.isFile() && inputPath.toLowerCase().endsWith('.zip')) {
    return parseZip(inputPath);
  }

  if (stat.isDirectory()) {
    return parseExportFolder(inputPath);
  }

  return { error: 'Please select a folder or a .zip file.', tracks: [] };
}

function parseExportFolder(folderPath) {
  const historyPaths = findFiles(folderPath, isHistoryFile);
  const libraryPaths = findFiles(folderPath, isLibraryFile);

  if (historyPaths.length === 0 && libraryPaths.length === 0) {
    return {
      error:
        'No Spotify export files found anywhere inside that folder. ' +
        'Expected StreamingHistory_music_*.json, endsong_*.json, or YourLibrary.json.',
      tracks: [],
    };
  }

  const weightMap = {};
  const dateMap   = {};

  for (const filePath of historyPaths) {
    try {
      const entries = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      parseHistoryEntries(entries, weightMap, dateMap);
    } catch (_) {}
  }

  let likedCount = 0;
  if (libraryPaths.length > 0) {
    try {
      const lib = JSON.parse(fs.readFileSync(libraryPaths[0], 'utf-8'));
      likedCount = parseLibraryEntries(lib, weightMap, dateMap);
    } catch (_) {}
  }

  return buildResults(weightMap, dateMap, historyPaths.length, likedCount, libraryPaths.length > 0);
}

function parseZip(zipPath) {
  let zip;
  try { zip = new AdmZip(zipPath); }
  catch (e) { return { error: `Could not open ZIP file: ${e.message}`, tracks: [] }; }

  const entries = zip.getEntries();
  const weightMap = {};
  const dateMap   = {};
  let historyCount = 0;
  let likedCount   = 0;
  let hasLibrary   = false;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = path.basename(entry.entryName);

    if (isHistoryFile(name)) {
      try {
        const data = JSON.parse(entry.getData().toString('utf-8'));
        parseHistoryEntries(data, weightMap, dateMap);
        historyCount++;
      } catch (_) {}
    } else if (isLibraryFile(name)) {
      try {
        const lib = JSON.parse(entry.getData().toString('utf-8'));
        likedCount = parseLibraryEntries(lib, weightMap, dateMap);
        hasLibrary = true;
      } catch (_) {}
    }
  }

  if (historyCount === 0 && !hasLibrary) {
    return {
      error:
        'No Spotify export files found inside the ZIP. ' +
        'Expected StreamingHistory_music_*.json, endsong_*.json, or YourLibrary.json.',
      tracks: [],
    };
  }

  return buildResults(weightMap, dateMap, historyCount, likedCount, hasLibrary);
}

module.exports = { parseExport, parseExportFolder };
