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
      <div className="page-header">
        <div className="page-title">Generate Playlist</div>
        <div className="page-subtitle">Configure and generate your personalized discovery playlist.</div>
      </div>

      <div className="card">
        <h2>Playlist Settings</h2>

        <div className="form-group">
          <label className="form-label">Playlist Name</label>
          <input className="form-input" value={playlistName} onChange={e => setPlaylistName(e.target.value)} />
        </div>

        <div className="form-group">
          <label className="form-label">Song Count — {targetSize} tracks</label>
          <div className="slider-wrapper">
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>50</span>
            <input type="range" className="slider" min={50} max={500} step={25}
              value={targetSize} onChange={e => setTargetSize(Number(e.target.value))} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>500</span>
            <span className="slider-value">{targetSize}</span>
          </div>
        </div>

        <div className="form-group">
          <div className="toggle-wrapper">
            <label className="toggle">
              <input type="checkbox" checked={includeFamiliar} onChange={e => setIncludeFamiliar(e.target.checked)} />
              <span className="toggle-slider" />
            </label>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Include familiar songs (already in library)</span>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Mood Bias (optional — drag to weight heavier/lighter)</label>
          <div className="mood-bias-grid">
            {CLUSTER_LABELS.map((label, i) => (
              <div key={i} className="mood-bias-row">
                <span className="mood-bias-label">{label}</span>
                <input type="range" className="slider" min={0} max={3} step={0.1}
                  value={moodBias[i] ?? 1} onChange={e => setMoodBiasValue(i, e.target.value)} />
                <span className="slider-value" style={{ minWidth: 36 }}>{(moodBias[i] ?? 1).toFixed(1)}×</span>
              </div>
            ))}
          </div>
        </div>

        <button className="btn btn-primary btn-full btn-lg" disabled={generating} onClick={generate}>
          {generating ? 'Generating...' : '▶  Generate Playlist'}
        </button>
      </div>

      {(generating || logLines.length > 0) && (
        <div className="card">
          <h2>Progress</h2>
          <ProgressLog lines={logLines} />
        </div>
      )}

      {result?.ok && (
        <div className="result-panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <span style={{ fontSize: 18, color: 'var(--accent)' }}>✓</span>
            <span style={{ fontSize: 16, fontWeight: 700 }}>Playlist Created</span>
          </div>

          <div className="result-stats">
            <div>
              <div className="result-stat">{result.trackCount}</div>
              <div className="result-label">Tracks Added</div>
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>
                {result.playlistName}
              </div>
              <div className="result-label">Playlist Name</div>
            </div>
          </div>

          {result.clusterBreakdown && (
            <table className="cluster-table">
              <thead>
                <tr>
                  <th>Cluster</th>
                  <th>Target</th>
                  <th>Filled</th>
                </tr>
              </thead>
              <tbody>
                {result.clusterBreakdown.map((row, i) => (
                  <tr key={i}>
                    <td>{row.label}</td>
                    <td>{row.quota}</td>
                    <td style={{ color: row.filled >= row.quota ? 'var(--accent)' : 'var(--warn)' }}>
                      {row.filled}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {result.newArtists?.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div className="section-eyebrow" style={{ marginBottom: 8 }}>New Discoveries</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {result.newArtists.map((a, i) => (
                  <span key={i} style={{
                    background: 'var(--accent-dim)', border: '1px solid rgba(29,185,84,0.2)',
                    borderRadius: 20, padding: '3px 10px', fontSize: 12, color: 'var(--accent)',
                  }}>{a}</span>
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
