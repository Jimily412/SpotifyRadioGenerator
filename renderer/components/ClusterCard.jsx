import React from 'react';

const MOOD_EMOJI = {
  'Hype': '⚡',
  'Chill': '🌙',
  'Feel Good': '☀️',
  'Dark / Moody': '🌑',
  'Focus / Instrumental': '🎹',
  'Mixed': '🎵',
};

export default function ClusterCard({ cluster }) {
  const emoji = MOOD_EMOJI[cluster.label] || '🎵';
  const pct = parseFloat(cluster.weightPct) || 0;

  return (
    <div className="cluster-card">
      <div className="cluster-header">
        <span className="cluster-label">{emoji} {cluster.label}</span>
        <span className="cluster-pct">{pct.toFixed(1)}% weight</span>
      </div>
      <div className="cluster-bar-bg">
        <div className="cluster-bar" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>{cluster.trackCount} tracks</div>
      <ul className="cluster-tracks">
        {(cluster.topTracks || []).map((t, i) => (
          <li key={i}>
            {t.trackName} <span>— {t.artistName}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
