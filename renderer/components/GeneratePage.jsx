import React, { useState } from 'react';
import ProgressLog from './ProgressLog';

const CLUSTER_LABELS = ['Hype', 'Chill', 'Feel Good', 'Dark / Moody', 'Focus / Instrumental', 'Mixed'];

export default function GeneratePage() {
  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const [playlistName, setPlaylistName] = useState(`TasteEngine Mix — ${today}`);
  const [targetSize, setTargetSize] = useState(150);
  const [includeFamiliar, setIncludeFamiliar] = useState(false);
  const [moodBias, setMoodBias] = useState({});
  const [generating, setGenerating] = useState(false);
  const [logLines, setLogLines] = useState([]);
  const [result, setResult] = useState(null);

  const estimatedCalls = Math.round(4 + 1 + 3 + Math.min(100, Math.ceil(Math.min(300, targetSize * 2) / 3)) + 30 + 5);

  function setMoodBiasValue(idx, val) {
    setMoodBias(prev => ({ ...prev, [idx]: parseFloat(val) }));
  }

  async function generate() {
    setGenerating(true);
    setLogLines([]);
    setResult(null);

    window.electronAPI.removeProgressLog();
    window.electronAPI.onProgressLog(line => setLogLines(prev => [...prev, line]));

    const res = await window.electronAPI.generatePlaylist({
      playlistName,
      targetSize,
      includeFamiliar,
      moodBias: Object.keys(moodBias).length > 0 ? moodBias : {},
    });
    setGenerating(false);
    setResult(res);
  }

  return (
    <div>
      <h1>Generate Playlist</h1>
      <p style={{ marginBottom: 24 }}>Configure and generate your personalized discovery playlist.</p>

      <div className="card">
        <h2>Playlist Settings</h2>

        <div className="form-group">
          <label className="form-label">Playlist Name</label>
          <input
            className="form-input"
            value={playlistName}
            onChange={e => setPlaylistName(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Song Count — {targetSize} tracks</label>
          <div className="slider-wrapper">
            <span style={{ fontSize: 12, color: '#666' }}>50</span>
            <input
              type="range"
              className="slider"
              min={50}
              max={500}
              step={25}
              value={targetSize}
              onChange={e => setTargetSize(Number(e.target.value))}
            />
            <span style={{ fontSize: 12, color: '#666' }}>500</span>
            <span className="slider-value">{targetSize}</span>
          </div>
        </div>

        <div className="form-group">
          <div className="toggle-wrapper">
            <label className="toggle">
              <input type="checkbox" checked={includeFamiliar} onChange={e => setIncludeFamiliar(e.target.checked)} />
              <span className="toggle-slider" />
            </label>
            <span style={{ fontSize: 13 }}>Include familiar songs (already in library)</span>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Mood Bias (optional — drag to weight heavier/lighter)</label>
          <div className="mood-bias-grid">
            {CLUSTER_LABELS.map((label, i) => (
              <div key={i} className="mood-bias-row">
                <span className="mood-bias-label">{label}</span>
                <input
                  type="range"
                  className="slider"
                  min={0}
                  max={3}
                  step={0.1}
                  value={moodBias[i] ?? 1}
                  onChange={e => setMoodBiasValue(i, e.target.value)}
                />
                <span className="slider-value" style={{ minWidth: 30 }}>{(moodBias[i] ?? 1).toFixed(1)}×</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ fontSize: 12, color: '#666', marginBottom: 16 }}>
          Estimated API calls: ~{estimatedCalls} (budget: 153 max)
        </div>

        <button className="btn btn-primary" disabled={generating} onClick={generate} style={{ width: '100%', justifyContent: 'center' }}>
          {generating ? '⏳ Generating...' : '⬡ Generate Playlist'}
        </button>
      </div>

      {(generating || logLines.length > 0) && (
        <div className="card">
          <h2>Progress</h2>
          <ProgressLog lines={logLines} />
        </div>
      )}

      {result?.ok && (
        <div className="result-panel" style={{ marginTop: 16 }}>
          <h2 style={{ color: '#1DB954' }}>✓ Playlist Created!</h2>
          <div className="result-stats">
            <div>
              <div className="result-stat">{result.trackCount}</div>
              <div className="result-label">tracks added</div>
            </div>
            <div>
              <div className="result-stat" style={{ fontSize: 18, paddingTop: 6 }}>{result.playlistName}</div>
              <div className="result-label">playlist name</div>
            </div>
          </div>

          {result.clusterBreakdown && (
            <table className="cluster-table">
              <thead>
                <tr>
                  <th>Mood</th>
                  <th>Quota</th>
                  <th>Filled</th>
                </tr>
              </thead>
              <tbody>
                {result.clusterBreakdown.map((row, i) => (
                  <tr key={i}>
                    <td>{row.label}</td>
                    <td>{row.quota}</td>
                    <td style={{ color: row.filled >= row.quota ? '#1DB954' : '#f39c12' }}>{row.filled}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {result.newArtists && result.newArtists.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>TOP NEW DISCOVERIES</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {result.newArtists.map((a, i) => (
                  <span key={i} style={{ background: 'rgba(29,185,84,0.1)', border: '1px solid rgba(29,185,84,0.2)', borderRadius: 20, padding: '3px 10px', fontSize: 12, color: '#1DB954' }}>{a}</span>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 20 }}>
            <button className="btn btn-primary" onClick={() => window.electronAPI.openExternal(result.playlistUrl)}>
              Open in Spotify ↗
            </button>
          </div>
        </div>
      )}

      {result && !result.ok && (
        <div className="notice notice-error" style={{ marginTop: 16 }}>{result.error}</div>
      )}
    </div>
  );
}
