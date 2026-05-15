const fs   = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

function findFiles(dir, predicate, results = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) findFiles(full, predicate, results);
    else if (e.isFile() && predicate(e.name)) results.push(full);
  }
  return results;
}

function isHistoryFile(name) {
  return /^StreamingHistory_music_\d+\.json$/i.test(name) ||
         /^endsong_\d+\.json$/i.test(name) ||
         /^Streaming_History_Audio_.*\.json$/i.test(name);
}

function isLibraryFile(name) { return name === 'YourLibrary.json'; }

function looksLikeHistory(entries) {
  if (!Array.isArray(entries) || !entries[0]) return false;
  const s = entries[0];
  return ('msPlayed' in s || 'ms_played' in s) && ('trackName' in s || 'master_metadata_track_name' in s);
}

function parseHistoryEntries(entries, weightMap, dateMap) {
  for (const e of entries) {
    const artist = (e.artistName || e.master_metadata_album_artist_name || '').trim();
    const track  = (e.trackName  || e.master_metadata_track_name        || '').trim();
    const ms     = e.msPlayed    || e.ms_played || 0;
    if (!artist || !track || ms < 30000) continue;
    const key = `${artist}|${track}`;
    if (!weightMap[key]) { weightMap[key] = { artistName: artist, trackName: track, plays: 0 }; dateMap[key] = []; }
    weightMap[key].plays++;
    const ts = e.ts || e.endTime;
    if (ts) dateMap[key].push(new Date(ts).getTime());
  }
}

function parseLibraryEntries(lib, weightMap, dateMap) {
  let count = 0;
  for (const item of (lib?.tracks || [])) {
    const artist = (item.artist || '').trim();
    const track  = (item.track  || '').trim();
    if (!artist || !track) continue;
    const key = `${artist}|${track}`;
    if (!weightMap[key]) { weightMap[key] = { artistName: artist, trackName: track, plays: 0 }; dateMap[key] = []; }
    weightMap[key].liked = true;
    count++;
  }
  return count;
}

function buildResults(weightMap, dateMap, historyFileCount, likedCount, hasLibrary) {
  const now = Date.now();
  const tracks = Object.entries(weightMap).map(([key, e]) => {
    const timestamps = dateMap[key] || [];
    let weight = e.plays;
    if (timestamps.length > 0) {
      const ageDays = (now - timestamps.reduce((a, b) => a + b, 0) / timestamps.length) / 86400000;
      weight *= ageDays <= 30 ? 1.1 : ageDays <= 90 ? 1.05 : ageDays <= 365 ? 1.0 : 0.9;
    }
    if (e.liked) weight += 5;
    return { artistName: e.artistName, trackName: e.trackName, weight: Math.min(50, weight), plays: e.plays, liked: !!e.liked };
  }).filter(t => t.weight >= 0.01).sort((a, b) => b.weight - a.weight);

  let minDate = null, maxDate = null;
  for (const dts of Object.values(dateMap)) for (const ts of dts) {
    if (!minDate || ts < minDate) minDate = ts;
    if (!maxDate || ts > maxDate) maxDate = ts;
  }

  return {
    tracks,
    mode: hasLibrary && historyFileCount > 0 ? 'Full Export' : hasLibrary ? 'Library Only' : 'Streaming History Only',
    trackCount: tracks.length,
    likedCount,
    historyFiles: historyFileCount,
    dateRange: minDate ? { from: new Date(minDate).toISOString(), to: new Date(maxDate).toISOString() } : null,
    warning: tracks.length < 50 ? `Only ${tracks.length} tracks found — results may be limited.` : null,
  };
}

function parseExport(inputPath) {
  const stat = fs.statSync(inputPath);
  if (stat.isFile() && inputPath.toLowerCase().endsWith('.zip')) return parseZip(inputPath);
  if (stat.isDirectory()) return parseExportFolder(inputPath);
  return { error: 'Please select a folder or a .zip file.', tracks: [] };
}

function parseExportFolder(folderPath) {
  const historyPaths = findFiles(folderPath, isHistoryFile);
  const libraryPaths = findFiles(folderPath, isLibraryFile);
  const allJson      = findFiles(folderPath, n => n.toLowerCase().endsWith('.json'));

  const weightMap = {}, dateMap = {};
  const knownPaths = new Set([...historyPaths, ...libraryPaths]);

  for (const p of historyPaths) {
    try { parseHistoryEntries(JSON.parse(fs.readFileSync(p, 'utf-8')), weightMap, dateMap); } catch {}
  }
  for (const p of allJson.filter(p => !knownPaths.has(p))) {
    try {
      const entries = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (looksLikeHistory(entries)) parseHistoryEntries(entries, weightMap, dateMap);
    } catch {}
  }

  let likedCount = 0;
  if (libraryPaths[0]) {
    try { likedCount = parseLibraryEntries(JSON.parse(fs.readFileSync(libraryPaths[0], 'utf-8')), weightMap, dateMap); } catch {}
  }

  if (historyPaths.length === 0 && likedCount === 0) {
    return { error: 'No Spotify export files found. Expected StreamingHistory_music_*.json, endsong_*.json, or YourLibrary.json.', tracks: [] };
  }

  return buildResults(weightMap, dateMap, historyPaths.length, likedCount, libraryPaths.length > 0);
}

function parseZip(zipPath) {
  let zip;
  try { zip = new AdmZip(zipPath); } catch (e) { return { error: `Could not open ZIP: ${e.message}`, tracks: [] }; }

  const weightMap = {}, dateMap = {};
  let historyCount = 0, likedCount = 0, hasLibrary = false;
  const unclassified = [];

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = path.basename(entry.entryName);
    try {
      const parsed = JSON.parse(entry.getData().toString('utf-8'));
      if (isHistoryFile(name)) {
        parseHistoryEntries(parsed, weightMap, dateMap);
        historyCount++;
      } else if (isLibraryFile(name)) {
        likedCount = parseLibraryEntries(parsed, weightMap, dateMap);
        hasLibrary = true;
      } else if (name.endsWith('.json')) {
        unclassified.push(parsed);
      }
    } catch {}
  }

  // Content-based fallback for unclassified JSON entries
  for (const parsed of unclassified) {
    if (looksLikeHistory(parsed)) { parseHistoryEntries(parsed, weightMap, dateMap); historyCount++; }
  }

  if (historyCount === 0 && !hasLibrary) {
    return { error: 'No Spotify export files found inside the ZIP.', tracks: [] };
  }

  return buildResults(weightMap, dateMap, historyCount, likedCount, hasLibrary);
}

module.exports = { parseExport, parseExportFolder };
