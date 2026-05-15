import React, { useState } from 'react';
import ProgressLog from './ProgressLog';

const CLUSTER_LABELS = ['Hype', 'Chill', 'Feel Good', 'Dark / Moody', 'Focus / Instrumental', 'Mixed'];
const CLUSTER_COLORS = ['#ff6b35', '#74b9ff', '#55efc4', '#a29bfe', '#fdcb6e', '#1DB954'];

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
        <h3 style={{ marginBottom: 20 }}>Playlist Settings</h3>

        <div className="form-group">
          <label className="form-label">Playlist Name</label>
          <input className="form-input" value={playlistName} onChange={e => setPlaylistName(e.target.value)} />
        </div>

        <div className="form-group">
          <label className="form-label">Track Count</label>
          <div className="slider-wrapper">
            <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 28 }}>50</span>
            <input type="range" className="slider" min={50} max={500} step={25}
              value={targetSize} onChange={e => setTargetSize(Number(e.target.value))} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 28, textAlign: 'right' }}>500</span>
            <span className="slider-value">{targetSize}</span>
          </div>
        </div>

        <div className="form-group">
          <div className="toggle-wrapper">
            <label className="toggle">
              <input type="checkbox" checked={includeFamiliar} onChange={e => setIncludeFamiliar(e.target.checked)} />
              <span className="toggle-slider" />
            </label>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Include familiar songs</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Include tracks already in your Spotify library</div>
            </div>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Mood Bias</label>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
            Drag to weight each cluster heavier or lighter. Default is 1.0×.
          </div>
          <div className="mood-bias-grid">
            {CLUSTER_LABELS.map((label, i) => (
              <div key={i} className="mood-bias-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 160, flexShrink: 0 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: CLUSTER_COLORS[i], flexShrink: 0 }} />
                  <span className="mood-bias-label" style={{ width: 'auto' }}>{label}</span>
                </div>
                <input type="range" className="slider" min={0} max={3} step={0.1}
                  value={moodBias[i] ?? 1} onChange={e => setMoodBiasValue(i, e.target.value)} />
                <span className="slider-value" style={{ minWidth: 40 }}>{(moodBias[i] ?? 1).toFixed(1)}×</span>
              </div>
            ))}
          </div>
        </div>

        <button
          className="btn btn-primary btn-full btn-lg"
          style={{ marginTop: 8 }}
          disabled={generating}
          onClick={generate}
        >
          {generating ? 'Generating…' : '▶  Generate Playlist'}
        </button>
      </div>

      {(generating || logLines.length > 0) && (
        <div className="card">
          <h3 style={{ marginBottom: 16 }}>Progress</h3>
          <ProgressLog lines={logLines} />
        </div>
      )}

      {result?.ok && (
        <div className="result-panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
            <span style={{ fontSize: 20, color: 'var(--accent)' }}>✓</span>
            <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.3px' }}>Playlist Created</span>
          </div>

          <div className="result-stats">
            <div>
              <div className="result-stat">{result.trackCount}</div>
              <div className="result-label">Tracks Added</div>
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 4, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {result.playlistName}
              </div>
              <div className="result-label">Playlist Name</div>
            </div>
          </div>

          {result.clusterBreakdown && (
            <table className="cluster-table" style={{ marginBottom: 20 }}>
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
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: CLUSTER_COLORS[i % CLUSTER_COLORS.length], flexShrink: 0 }} />
                        {row.label}
                      </div>
                    </td>
                    <td>{row.quota}</td>
                    <td style={{ color: row.filled >= row.quota ? 'var(--accent)' : 'var(--warn)', fontWeight: 700 }}>
                      {row.filled}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {result.newArtists?.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>
                New Discoveries
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {result.newArtists.map((a, i) => (
                  <span key={i} style={{
                    background: 'var(--accent-dim)', border: '1px solid var(--accent-glow)',
                    borderRadius: 500, padding: '4px 12px', fontSize: 12, color: 'var(--accent)', fontWeight: 600,
                  }}>{a}</span>
                ))}
              </div>
            </div>
          )}

          <button className="btn btn-primary" onClick={() => window.electronAPI.openExternal(result.playlistUrl)}>
            Open in Spotify ↗
          </button>
        </div>
      )}

      {result && !result.ok && (
        <div className="notice notice-error" style={{ marginTop: 16 }}>{result.error}</div>
      )}
    </div>
  );
}
