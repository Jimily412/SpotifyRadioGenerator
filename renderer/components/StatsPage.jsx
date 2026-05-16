import React, { useState, useEffect } from 'react';

const CLUSTER_COLORS = ['#ff6b35', '#74b9ff', '#55efc4', '#a29bfe', '#fdcb6e', '#1DB954'];

function Bar({ value, max, color }) {
  return (
    <div className="stats-bar-bg">
      <div className="stats-bar-fill" style={{ width: `${Math.round((value / max) * 100)}%`, background: color || 'var(--accent)' }} />
    </div>
  );
}

export default function StatsPage() {
  const [stats, setStats] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    window.electronAPI.getStats().then(s => { setStats(s); setLoaded(true); });
  }, []);

  if (!loaded) return null;

  if (!stats) {
    return (
      <div>
        <div className="page-header">
          <div className="page-title">Your Stats</div>
          <div className="page-subtitle">Run Analyze to see your listening stats.</div>
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">📊</div>
          <div className="empty-state-title">No data yet</div>
          <div className="empty-state-sub">Head to Analyze and run an analysis first.</div>
        </div>
      </div>
    );
  }

  const maxArtistWeight = stats.topArtists[0]?.weight || 1;
  const maxTrackWeight = stats.topTracks[0]?.weight || 1;
  const analyzedDate = new Date(stats.analyzedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Your Stats</div>
        <div className="page-subtitle">Based on your last analysis · {analyzedDate}</div>
      </div>

      {/* Summary chips */}
      <div className="stats-summary-row">
        <div className="stats-chip">
          <div className="stats-chip-value">{stats.totalArtists.toLocaleString()}</div>
          <div className="stats-chip-label">Artists</div>
        </div>
        <div className="stats-chip">
          <div className="stats-chip-value">{stats.totalTracks.toLocaleString()}</div>
          <div className="stats-chip-label">Tracks</div>
        </div>
        <div className="stats-chip">
          <div className="stats-chip-value">{stats.clusters?.length || 0}</div>
          <div className="stats-chip-label">Mood Clusters</div>
        </div>
        <div className="stats-chip">
          <div className="stats-chip-value">{stats.clusters?.reduce((m, c) => c.weightPct > m.pct ? { pct: c.weightPct, label: c.label } : m, { pct: 0, label: '—' }).label}</div>
          <div className="stats-chip-label">Dominant Mood</div>
        </div>
      </div>

      {/* Mood breakdown */}
      {stats.clusters?.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 20 }}>Taste Profile</h3>
          <div className="stats-cluster-grid">
            {stats.clusters.map((c, i) => (
              <div key={i} className="stats-cluster-row">
                <div className="stats-cluster-name">
                  <div className="stats-cluster-dot" style={{ background: CLUSTER_COLORS[c.id] }} />
                  {c.label}
                </div>
                <div className="stats-cluster-bar-wrap">
                  <div className="stats-bar-bg">
                    <div className="stats-bar-fill" style={{ width: `${Math.round(c.weightPct)}%`, background: CLUSTER_COLORS[c.id] }} />
                  </div>
                </div>
                <div className="stats-cluster-pct">{Math.round(c.weightPct)}%</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Artists + Top Tracks side by side */}
      <div className="stats-split">
        <div className="card" style={{ flex: 1 }}>
          <h3 style={{ marginBottom: 20 }}>Top Artists</h3>
          <div className="stats-list">
            {stats.topArtists.map((a, i) => (
              <div key={i} className="stats-list-row">
                <div className="stats-rank">{i + 1}</div>
                <div className="stats-list-info">
                  <div className="stats-list-name">{a.name}</div>
                  <Bar value={a.weight} max={maxArtistWeight} />
                </div>
                <div className="stats-list-meta">{a.trackCount} tracks</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ flex: 1 }}>
          <h3 style={{ marginBottom: 20 }}>Top Tracks</h3>
          <div className="stats-list">
            {stats.topTracks.map((t, i) => (
              <div key={i} className="stats-list-row">
                <div className="stats-rank">{i + 1}</div>
                <div className="stats-list-info">
                  <div className="stats-list-name">{t.trackName}</div>
                  <div className="stats-list-sub">{t.artistName}</div>
                  <Bar value={t.weight} max={maxTrackWeight} />
                </div>
                {t.plays > 0 && <div className="stats-list-meta">{t.plays}×</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
